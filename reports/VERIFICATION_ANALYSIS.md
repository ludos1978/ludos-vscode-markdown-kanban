# SaveOptions Implementation Verification

## Critical Bug Found! 🔴

### Scenario: Save Fails After Setting Flag

**Current Code Flow**:
```typescript
// Line 671: Flag set FIRST
if (skipReloadDetection) {
    this._skipNextReloadDetection = true;  // ← Set here
}

try {
    // Line 696-700: Validation (could throw!)
    const validation = this.validate(this._content);
    if (!validation.valid) {
        throw new Error(...);  // ← Throws here!
    }

    // Line 702: Write to disk (could throw!)
    await this.writeToDisk(this._content);

} catch (error) {
    // Rollback state...
    // ❌ Flag NOT reset here!
    throw error;
}
```

**The Problem**:

```
1. save() called
2. Flag set: _skipNextReloadDetection = true  ✅
3. Validation fails and throws error  ❌
4. Catch block: Rollback state, but flag still TRUE  ❌
5. File NOT written (no change on disk)
6. Watcher doesn't fire (nothing to detect)
7. Flag remains TRUE  ❌

Later:
8. External user edits file
9. Watcher fires _onFileSystemChange('modified')
10. Checks flag: _skipNextReloadDetection = TRUE  ❌
11. Skips external change handling!  ❌
12. LEGITIMATE EXTERNAL CHANGE IGNORED!  🔴
```

### Impact

- If a save operation fails (validation error, disk error, etc.)
- The flag remains set
- The next legitimate external change will be incorrectly ignored
- User edits externally → UI doesn't reload → Data loss potential!

---

## The Fix

### Option 1: Reset Flag in Catch Block

```typescript
public async save(options: SaveOptions = {}): Promise<void> {
    const skipReloadDetection = options.skipReloadDetection ?? true;

    if (skipReloadDetection) {
        this._skipNextReloadDetection = true;
    }

    try {
        // ... validation and write ...
    } catch (error) {
        // FIX: Reset flag on error!
        if (skipReloadDetection) {
            this._skipNextReloadDetection = false;  ✅
        }
        throw error;
    }
}
```

### Option 2: Set Flag AFTER Write Succeeds (Better!)

```typescript
public async save(options: SaveOptions = {}): Promise<void> {
    const skipReloadDetection = options.skipReloadDetection ?? true;

    try {
        // ... validation ...
        await this.writeToDisk(this._content);

        // FIX: Set flag AFTER successful write!
        if (skipReloadDetection) {
            this._skipNextReloadDetection = true;  ✅
        }

        // ... update state ...
    } catch (error) {
        // Flag never set, so no need to reset
        throw error;
    }
}
```

**Option 2 is better** because:
- Flag only set if write succeeds
- No need to reset in catch block
- Simpler logic
- Can't forget to reset

---

## Timing Analysis - Does Option 2 Work?

### Question: Will the watcher fire BEFORE we set the flag?

**Save sequence with Option 2**:
```
1. save() called
2. Stop watcher
3. writeToDisk() completes  ← File written here
4. Set flag: _skipNextReloadDetection = true  ← Flag set AFTER write
5. Restart watcher  ← Watcher starts AFTER flag is set
6. Watcher detects change (sees new timestamp)
7. Fires _onFileSystemChange('modified')
8. Checks flag: TRUE  ✅
9. Returns early (no reload)
```

**Key point**: Watcher is restarted in the `finally` block, which runs AFTER the try block completes. So:
- writeToDisk() completes (line 702)
- Flag set (new position, after line 702)
- State updated (lines 705-708)
- try block finishes
- finally block runs → watcher restarted (line 731)

The flag is set BEFORE the finally block runs, so it's set BEFORE the watcher is restarted. This should work!

### But wait - what about async timing?

```typescript
await this.writeToDisk(this._content);  // Returns when write completes
this._skipNextReloadDetection = true;   // Executes synchronously
// ... more sync code ...
// try block finishes
// finally block runs, restarts watcher
```

The watcher is a VS Code FileSystemWatcher that fires events asynchronously. When we restart it:
1. Watcher starts listening
2. Watcher checks file timestamp
3. If timestamp changed while stopped, fires event
4. Event calls _onFileSystemChange() asynchronously

So there's a race condition:
- We set the flag synchronously after writeToDisk()
- We restart the watcher in finally block
- Watcher fires event asynchronously

**Will the flag be set before the watcher event fires?**

YES! Because:
1. Flag is set synchronously in the try block
2. finally block runs synchronously after try block
3. Watcher event fires asynchronously (on next event loop tick)

JavaScript event loop guarantees that synchronous code finishes before async callbacks run.

So Option 2 should work correctly!

---

## Additional Verification - _onFileSystemChange Logic

```typescript
protected async _onFileSystemChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
    // Check instance flag (not global registry!)
    if (this._skipNextReloadDetection && changeType === 'modified') {
        console.log(`✓ Skipping reload detection - this is our own save`);
        this._skipNextReloadDetection = false; // Reset flag
        this._hasFileSystemChanges = false;
        return; // Skip external change handling
    }

    // Mark as having external changes
    this._hasFileSystemChanges = true;
    this._emitChange('external');

    // Delegate to subclass for specific handling
    await this.handleExternalChange(changeType);
}
```

**Question**: What if changeType is 'created' or 'deleted'?

For normal saves, changeType should always be 'modified' because we're writing to an existing file. The condition `&& changeType === 'modified'` is correct.

But what if someone deletes the file while we're saving? The flag would be set, but changeType would be 'deleted', so we wouldn't skip it. That's actually CORRECT behavior - we want to know if the file was deleted!

**Verdict**: Logic is correct ✅

---

## Remaining Issues to Check

### 1. Multiple Rapid Saves

**Scenario**: Two saves called in quick succession

```
Save 1: Sets flag → writes → watcher fires → flag reset
Save 2: Sets flag → writes → watcher fires → flag reset
```

Each save manages its own flag lifecycle independently. Should work fine ✅

### 2. Save While External Change Pending

**Scenario**: External change happened, then we save

```
1. External edit happens
2. Watcher fires, sets _hasFileSystemChanges = true
3. Before we handle it, our save() is called
4. Our save sets flag, writes, watcher fires again
5. Our save's watcher event is skipped (flag = true)
6. But the external change flag is STILL set from step 2!
```

Looking at _onFileSystemChange():
```typescript
if (this._skipNextReloadDetection && changeType === 'modified') {
    this._hasFileSystemChanges = false;  // ← Clears the flag!
    return;
}
```

Wait, we're clearing `_hasFileSystemChanges` even for our own saves! Is this correct?

If an external change set this flag, and then we save, we clear it. But our save overwrites the external content, so clearing it is actually CORRECT! ✅

### 3. Conflict Dialog Flow

**Scenario**: User selects "Save my changes and overwrite"

```
1. User edits in UI (cached board exists)
2. External edit happens
3. Conflict detected, dialog appears
4. User selects "Save my changes"
5. showConflictDialog() calls this.save()
6. save() uses default skipReloadDetection: true
7. Flag set, file written
8. Watcher fires, flag checked, returns early
9. UI stays stable ✅
```

Looks correct!

---

## Verdict

### Current Implementation: 🔴 **HAS CRITICAL BUG**

**Bug**: Flag set BEFORE write, not reset on error

### Fix Required: ✅ **Move flag setting to AFTER successful write**

This ensures:
- Flag only set if write actually succeeds
- No flag lingering if save fails
- Simpler error handling
- No chance of skipping legitimate external changes after a failed save

### Fix Location

**File**: [src/files/MarkdownFile.ts:671-702](src/files/MarkdownFile.ts#L671-L702)

**Change**: Move lines 670-673 to AFTER line 702 (after writeToDisk succeeds)

---

## Summary

The SaveOptions architecture is sound, but has one critical implementation bug:

❌ **Current**: Flag set BEFORE write → Bug if write fails
✅ **Fixed**: Flag set AFTER write → Safe, no bugs

Need to fix before testing!
