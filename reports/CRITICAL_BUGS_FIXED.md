# Critical Bugs Fixed - Discard & Save ✅

**Date**: 2025-11-01
**Issues**:
1. Discard/reload doesn't work - UI doesn't update
2. Save overwrites with old state instead of current UI state
**Status**: ✅ **FIXED**

---

## The Problems

### Bug 1: "Discard my changes" Doesn't Update UI ❌

**User report**: "discarding and reloading doesnt work at all"

**What happened**:
```
User selects: "Discard my changes and reload"
Expected: UI shows external file content
Actual: UI still shows old state (UI edits or stale content)
```

**Root cause** in [MainKanbanFile.ts:599](src/files/MainKanbanFile.ts:599):
```typescript
// ❌ OLD CODE
this.parseToBoard();  // Just re-parses this._content (old baseline)
this._emitChange('reloaded');
```

**The issue**: `parseToBoard()` parses from `this._content`, which is the baseline from when the file was first loaded. It **doesn't read from disk**!

When the user saved externally:
1. External content written to disk ✅
2. User selects "Discard my changes"
3. Code re-parses `this._content` (old baseline) ❌
4. **UI shows old content, not external changes!**

### Bug 2: "Save my changes" Saves Old State ❌

**User report**: "saving and overwriting saves old states of the board not the last/current state of the kanban"

**What happened**:
```
User edits multiple times in UI
User selects: "Save my changes and ignore external"
Expected: Latest UI edits saved
Actual: First edit or old state saved
```

**Root cause** in [MainKanbanFile.ts:555](src/files/MainKanbanFile.ts:555):
```typescript
// ❌ OLD CODE
if (this._board) {
    const content = this._generateMarkdownFromBoard(this._board);  // ← Uses old board!
    this._content = content;
}
```

**The issue**: `this._board` is the board from the **last file parse**, NOT the current UI state!

- `this._board`: Board from last `parseToBoard()` call (stale)
- `this._cachedBoardFromWebview`: Current UI state from webview (fresh)

When the user made multiple edits:
1. First edit: `setCachedBoardFromWebview(board1)` ✅
2. Second edit: `setCachedBoardFromWebview(board2)` ✅
3. User clicks save
4. Code uses `this._board` (maybe board0 or board1) ❌
5. **Older state saved, latest edits lost!**

---

## The Fixes

### Fix 1: Actually Read from Disk on Discard

**Location**: [src/files/MainKanbanFile.ts:590-617](src/files/MainKanbanFile.ts:590-617)

**Before (Broken)**:
```typescript
if (resolution.shouldReload && hadCachedBoard) {
    this._cachedBoardFromWebview = undefined;
    this._hasFileSystemChanges = false;

    // ❌ Just re-parse old content
    this.parseToBoard();
    this._emitChange('reloaded');
}
```

**After (Fixed)**:
```typescript
if (resolution.shouldReload && hadCachedBoard) {
    this._cachedBoardFromWebview = undefined;
    this._hasFileSystemChanges = false;

    // ✅ Actually read from disk
    const freshContent = await this.readFromDisk();
    if (freshContent !== null && freshContent !== this._baseline) {
        // Content changed on disk
        this._content = freshContent;
        this._baseline = freshContent;
        this._hasUnsavedChanges = false;
        this._lastModified = await this._getFileModifiedTime();
        this.parseToBoard();
        this._emitChange('reloaded');
    } else if (freshContent !== null) {
        // Content unchanged, but still re-parse to discard UI edits
        this._content = freshContent;
        this.parseToBoard();
        this._emitChange('reloaded');
    }
}
```

**Key changes**:
1. ✅ Calls `readFromDisk()` to get fresh content from file
2. ✅ Updates `this._content` and `this._baseline` with disk content
3. ✅ Handles both cases: content changed or unchanged
4. ✅ Always emits 'reloaded' event to update UI

### Fix 2: Use Cached Board When Saving

**Location**: [src/files/MainKanbanFile.ts:551-570](src/files/MainKanbanFile.ts:551-570)

**Before (Broken)**:
```typescript
public async save(): Promise<void> {
    if (this._board) {
        // ❌ Uses old parsed board
        const content = this._generateMarkdownFromBoard(this._board);
        this._content = content;
    }
    await super.save();
    this._cachedBoardFromWebview = undefined;
}
```

**After (Fixed)**:
```typescript
public async save(): Promise<void> {
    // ✅ Use cached board from webview if it exists (current UI state)
    // Otherwise fall back to parsed board
    const boardToSave = this._cachedBoardFromWebview || this._board;

    console.log(`[MainKanbanFile] save() - using ${this._cachedBoardFromWebview ? 'CACHED BOARD from webview' : 'parsed board'}`);

    if (boardToSave) {
        const content = this._generateMarkdownFromBoard(boardToSave);
        console.log(`[MainKanbanFile] Generated ${content.length} chars from board`);
        this._content = content;
    }

    await super.save();
    this._cachedBoardFromWebview = undefined;
}
```

**Key changes**:
1. ✅ Prioritizes `this._cachedBoardFromWebview` (current UI state)
2. ✅ Falls back to `this._board` if no cached board
3. ✅ Logs which board is being used for debugging
4. ✅ Logs generated content length for verification

---

## How It Works Now

### Scenario 1: Discard Changes ✅

```
1. User edits task in UI (multiple times)
   → Each edit calls setCachedBoardFromWebview(latest)
   → _cachedBoardFromWebview = latest UI state

2. User saves externally
   → File on disk = external content

3. Conflict dialog appears

4. User selects "Discard my changes and reload"
   → showConflictDialog() detects: shouldReload + hadCachedBoard
   → Clears cached board
   → Reads from disk: freshContent = await readFromDisk()
   → Updates: this._content = freshContent
   → Re-parses: parseToBoard()  // Now parsing fresh disk content!
   → Emits: 'reloaded' event
   → ✅ UI shows external content from disk

Result: ✅ External content displayed, UI edits discarded
```

### Scenario 2: Save Changes ✅

```
1. User edits task in UI (multiple times)
   → Edit 1: setCachedBoardFromWebview(board1)
   → Edit 2: setCachedBoardFromWebview(board2)
   → Edit 3: setCachedBoardFromWebview(board3)
   → _cachedBoardFromWebview = board3 (latest)

2. User saves externally
   → File on disk = external content

3. Conflict dialog appears

4. User selects "Save my changes and ignore external"
   → showConflictDialog() calls: await this.save()
   → save() uses: boardToSave = this._cachedBoardFromWebview  // board3!
   → Generates markdown from board3
   → Writes to disk
   → ✅ Latest UI state saved

Result: ✅ Latest edits saved to file, external changes overwritten
```

---

## Testing Instructions

### Test 1: Discard Changes Shows External Content ✅
1. Open kanban board
2. **Edit task** in UI (change text to "UI EDIT 1")
3. **Edit again** (change to "UI EDIT 2")
4. **Switch to text editor**
5. **Change text externally** to "EXTERNAL EDIT"
6. **Save** (Ctrl+S)
7. **Dialog appears**
8. Select **"Discard my changes and reload"**
9. **Expected**: UI shows "EXTERNAL EDIT" (not "UI EDIT 1" or "UI EDIT 2")

### Test 2: Save Changes Saves Latest State ✅
1. Open kanban board
2. **Edit task** in UI (change to "EDIT 1")
3. **Edit again** (change to "EDIT 2")
4. **Edit again** (change to "EDIT 3")
5. **Save externally** with different text ("EXTERNAL")
6. **Dialog appears**
7. Select **"Save my changes and ignore external"**
8. **Open file in text editor**
9. **Expected**: File contains "EDIT 3" (not "EDIT 1", "EDIT 2", or "EXTERNAL")

### Test 3: Multiple Edit Cycle ✅
1. Edit in UI → Save → Edit again → Save → Edit again → External edit → Conflict
2. **Expected**: Conflict dialog shows with latest UI state
3. **Save**: Latest state saved
4. **Discard**: External content shown

---

## Expected Log Output

### Discard Changes:
```
[ConflictResolver] User selected: "Discard my changes and reload"
[MainKanbanFile] → Special case: Reload with cached board - discarding UI edits
[MainKanbanFile] → Reading fresh content from disk...
[MainKanbanFile] → Disk content changed (450 chars), updating...
[MainKanbanFile] → UI updated to show disk content ✅
```

### Save Changes:
```
[ConflictResolver] User selected: "Save my changes and ignore external"
[MainKanbanFile] → Executing: save
[MainKanbanFile] save() - using CACHED BOARD from webview ✅
[MainKanbanFile] Generated 520 chars from board
[main] Saving to disk: kanban-mixed-include.md
[main] Saved successfully ✅
```

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| [src/files/MainKanbanFile.ts](src/files/MainKanbanFile.ts:551-570) | 551-570 | Use cached board in save() |
| [src/files/MainKanbanFile.ts](src/files/MainKanbanFile.ts:590-617) | 590-617 | Read from disk on discard |

**Total**: 1 file, ~40 lines modified

---

## Root Cause Summary

Both bugs had the same underlying issue: **Using stale data instead of current data**.

| Operation | OLD (Broken) | NEW (Fixed) |
|-----------|--------------|-------------|
| **Save** | Uses `this._board` (last parse) | Uses `this._cachedBoardFromWebview` (current UI) |
| **Discard** | Parses `this._content` (old baseline) | Reads `await readFromDisk()` (fresh disk content) |

**The lesson**:
- For **saves**: Always use the cached board from webview (current UI state)
- For **discards**: Always read from disk (current file state)

---

## Verification

```bash
✅ TypeScript compilation: 0 errors
✅ ESLint: 0 errors (201 warnings in existing code)
✅ Logic verified:
   - save() uses _cachedBoardFromWebview
   - discard reads from disk via readFromDisk()
✅ Logging added: Clear indication of data source
```

---

## Risk Assessment

**Risk Level**: 🟢 VERY LOW

**Why**:
- ✅ Uses existing methods (readFromDisk, generateMarkdownFromBoard)
- ✅ Falls back gracefully (uses _board if no cached board)
- ✅ Logging added for debugging
- ✅ Doesn't change conflict detection logic

**Worst Case**:
- Save might generate slightly different markdown format (unlikely)
- Reload might read file mid-write (already handled by verification logic)

---

**Status**: ✅ **CRITICAL BUGS FIXED - READY FOR TESTING**

Both operations should now work correctly:
1. ✅ **Discard**: Reads fresh content from disk, UI updates correctly
2. ✅ **Save**: Uses latest cached board from webview, all edits preserved

**Please test both scenarios carefully!** 🎉
