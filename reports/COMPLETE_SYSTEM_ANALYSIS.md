# Complete System Analysis - Save/Reload/Conflict Architecture

**Date**: 2025-11-01
**Critical Issue**: Normal saves don't work - trigger reload loop
**Root Cause**: markSaveAsLegitimate() added in wrong locations

---

## UML Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    SAVE ENTRY POINTS (15+)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. kanbanWebviewPanel.ts:1721  ─┐                               │
│  2. kanbanWebviewPanel.ts:2098  ─┤                               │
│  3. includeFileManager.ts:162   ─┤                               │
│  4. messageHandler.ts (5 places)─┼──→ await file.save()          │
│  5. MarkdownFileRegistry.ts:302 ─┤                               │
│  6. Conflict Dialog (2 places)  ─┤                               │
│  7. resolveConflict('save')     ─┘                               │
│                                                                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              MarkdownFile.save() / MainKanbanFile.save()         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Stop file watcher                                             │
│  2. writeToDisk(content) ← vscode.workspace.fs.writeFile()      │
│  3. Update baseline                                               │
│  4. Restart file watcher  ← PROBLEM STARTS HERE!                │
│  5. Emit 'saved' event                                            │
│                                                                   │
│  ❌ NO markSaveAsLegitimate() HERE!                             │
│                                                                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FILE WATCHER RESTARTS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  File watcher detects filesystem change from writeToDisk()       │
│  → Calls _onFileSystemChange('modified')                         │
│  → Calls handleExternalChange()                                  │
│                                                                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              UnifiedChangeHandler.handleExternalChange()         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  const isLegitimateSave = SaveCoordinator.isLegitimateSave()    │
│                                                                   │
│  ❌ Returns FALSE (save not marked!)                             │
│                                                                   │
│  → Proceeds to CASE 3: Auto-reload                               │
│  → Calls file.reload()                                           │
│  → UI reloads unnecessarily ❌                                   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Where markSaveAsLegitimate() IS Called (Only 2 Places!)

### ✅ Location 1: SaveCoordinator.performSave()
**File**: src/core/SaveCoordinator.ts:63
**Flow**:
```typescript
private async performSave(file: MarkdownFile, content?: string): Promise<void> {
    // Mark this save as legitimate for conflict detection
    this.markSaveAsLegitimate(filePath);  ✅

    await file.save();
}
```

**Used by**: ???
**Problem**: Almost nothing uses SaveCoordinator!

---

### ✅ Location 2: showConflictDialog() (MY ADDITION)
**Files**:
- src/files/MarkdownFile.ts:792
- src/files/MainKanbanFile.ts:602

**Flow**:
```typescript
if (resolution.shouldSave) {
    SaveCoordinator.getInstance().markSaveAsLegitimate(this.getPath());  ✅
    await this.save();
}
```

**Used by**: Only conflict resolution!
**Problem**: Only works for conflict dialog saves!

---

## Where markSaveAsLegitimate() is NOT Called (15+ Places!)

### ❌ Direct file.save() Calls

1. **kanbanWebviewPanel.ts:1721** - Save before content change
2. **kanbanWebviewPanel.ts:2098** - Save before switch
3. **includeFileManager.ts:162** - Save column include file
4. **includeFileManager.ts:190** - Save task include file
5. **messageHandler.ts:1973** - Save and continue
6. **messageHandler.ts:2008** - Save old file
7. **messageHandler.ts:2234** - Save and switch column
8. **messageHandler.ts:2330** - Save and switch column
9. **messageHandler.ts:2428** - Save task include
10. **MarkdownFileRegistry.ts:302** - Save all files
11. **MarkdownFile.ts:749** - resolveConflict('save')

**Result**: ALL these saves trigger file watcher → reload loop! ❌

---

## The Fundamental Architectural Problem

### WRONG DESIGN (Current):
```
save() caller MUST remember to call:
  SaveCoordinator.getInstance().markSaveAsLegitimate(path)
  await file.save()

Problem: 15+ callers, only 2 remember to mark!
```

### CORRECT DESIGN (Should be):
```
save() method ITSELF should mark as legitimate:

  public async save(): Promise<void> {
      SaveCoordinator.getInstance().markSaveAsLegitimate(this.getPath());  ✅

      await super.save();
  }
```

**Benefit**: ALL saves automatically marked, no matter who calls!

---

## Why File Watcher Fires After Save

### The Timing Issue

```
1. save() called
2. Stop file watcher
3. writeToDisk() → vscode.workspace.fs.writeFile(uri, bytes)
   ↓
   OS writes file to disk
   ↓
4. Restart file watcher
   ↓
5. File watcher sees filesystem timestamp changed
6. Fires change event
7. handleExternalChange() called
```

**Key**: Even though we stop/restart watcher, it CAN still detect the change because the filesystem modification happened WHILE it was stopped, and when it restarts it sees the new timestamp.

---

## Why vscode.workspace.fs.writeFile Doesn't Fire onDidSaveTextDocument

```
onDidSaveTextDocument only fires when:
  - User presses Ctrl+S in editor
  - Code calls document.save() on TextDocument object

It does NOT fire when:
  - vscode.workspace.fs.writeFile() is called ❌
  - Direct filesystem writes ❌
```

**This means**: SaveHandler (kanbanFileService.ts) never runs for our saves!

Only way to prevent reload: **markSaveAsLegitimate()** before save.

---

## The Solution Architecture

### Option A: Mark in Every Caller (Current - BROKEN)
```
Pros: None
Cons:
  - 15+ callers must remember
  - Easy to forget
  - Breaks when new callers added
  - CURRENTLY BROKEN ❌
```

### Option B: Mark in save() Method (CORRECT)
```
Pros:
  - Automatic for ALL saves
  - Can't forget
  - Future-proof
  - Simple ✅

Cons: None
```

---

## Complete Flow Diagrams

### CURRENT (BROKEN) - Normal UI Edit → Save

```
1. User edits task in UI
   → Panel calls file.save()

2. file.save()
   → writeToDisk()
   → Restart watcher
   → ❌ NO markSaveAsLegitimate()

3. File watcher fires
   → isLegitimateSave = FALSE ❌
   → Triggers reload
   → UI reloads (appears broken!)
```

---

### CORRECT - Normal UI Edit → Save

```
1. User edits task in UI
   → Panel calls file.save()

2. file.save()
   → ✅ markSaveAsLegitimate() FIRST
   → writeToDisk()
   → Restart watcher

3. File watcher fires
   → isLegitimateSave = TRUE ✅
   → Returns early, no reload
   → UI stays stable ✅
```

---

## All System Entry Points

### Save Paths (Who calls save())

| Caller | File | Line | Marked? |
|--------|------|------|---------|
| Content change handler | kanbanWebviewPanel.ts | 1721 | ❌ NO |
| Before switch | kanbanWebviewPanel.ts | 2098 | ❌ NO |
| Column include update | includeFileManager.ts | 162 | ❌ NO |
| Task include update | includeFileManager.ts | 190 | ❌ NO |
| Save and continue | messageHandler.ts | 1973 | ❌ NO |
| Save old file | messageHandler.ts | 2008 | ❌ NO |
| Save and switch column | messageHandler.ts | 2234 | ❌ NO |
| Save and switch column | messageHandler.ts | 2330 | ❌ NO |
| Save task include | messageHandler.ts | 2428 | ❌ NO |
| Save all files | MarkdownFileRegistry.ts | 302 | ❌ NO |
| resolveConflict('save') | MarkdownFile.ts | 749 | ❌ NO |
| Conflict dialog | MarkdownFile.ts | 792 | ✅ YES |
| Conflict dialog | MainKanbanFile.ts | 602 | ✅ YES |

**Result**: 11/13 = 85% of saves NOT marked! ❌

---

## The Fix

### Move markSaveAsLegitimate() INTO save()

**MainKanbanFile.save():**
```typescript
public async save(): Promise<void> {
    const boardToSave = this._cachedBoardFromWebview || this._board;

    if (boardToSave) {
        const content = this._generateMarkdownFromBoard(boardToSave);
        this._content = content;
    }

    // CRITICAL: Mark BEFORE save so file watcher knows it's our own save
    SaveCoordinator.getInstance().markSaveAsLegitimate(this.getPath());  ✅

    await super.save();

    this._cachedBoardFromWebview = undefined;
}
```

**MarkdownFile.save():**
```typescript
public async save(): Promise<void> {
    // CRITICAL: Mark BEFORE save so file watcher knows it's our own save
    SaveCoordinator.getInstance().markSaveAsLegitimate(this.getPath());  ✅

    // ... existing save logic ...

    await this.writeToDisk(this._content);

    // ... rest of save ...
}
```

**Result**: ALL saves automatically marked! ✅

---

## Rollback Plan

If moving to save() causes issues:

1. Keep in save() for normal saves
2. REMOVE from showConflictDialog() (duplicate)
3. Add flag to skip marking if already marked
4. Add logging to track who marked what

---

**Status**: 🔴 **CRITICAL ARCHITECTURAL FLAW IDENTIFIED**

The design of requiring callers to mark saves is fundamentally broken. Must move marking into the save() method itself.

**Next Step**: Implement the fix by moving markSaveAsLegitimate() into save() methods.
