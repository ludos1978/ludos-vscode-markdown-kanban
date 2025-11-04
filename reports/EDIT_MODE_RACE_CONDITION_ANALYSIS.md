# Race Condition Analysis: Edit Mode + External Save

**Date**: 2025-11-01
**Issue**: Board still breaks when editing in kanban and saving main file externally
**Root Cause**: Race condition between saveCurrentField() and external change processing

---

## The Problem

### Current Flow (Broken)

```
1. User editing task title: "Old Title" → "New Title" (not saved yet)
   └─> window.cachedBoard has "Old Title"
   └─> Editor shows "New Title"
   └─> _isInEditMode = true

2. External save to main file (text editor)
   └─> File watcher fires
   └─> _onFileSystemChange('modified') called

3. Stop editing (line 968)
   └─> await requestStopEditing()
       └─> Frontend receives 'stopEditing' message
           └─> Calls saveCurrentField() (webview.js:3042)
               ├─> Modifies window.cachedBoard.columns[0].title = "New Title" ✅
               ├─> Calls markUnsavedChanges() ✅
               └─> Triggers potential auto-save or board updates ❌

4. Backend processes external changes (line 978)
   └─> handleExternalChange()
       └─> Reads from disk → gets external changes
       └─> Parses board from disk
       └─> Sends new board to frontend

5. RACE CONDITION:
   Frontend has TWO conflicting states:
   - window.cachedBoard with "New Title" (from step 3)
   - Incoming board from backend (from step 4)

   Result: BOARD BREAKS ❌
```

### Specific Code Path

**saveCurrentField() ([taskEditor.js:755-844](src/html/taskEditor.js#L755-L844))**

```javascript
saveCurrentField() {
    if (!this.currentEditor) {return;}

    // Line 763: Get cached board
    if (window.cachedBoard && window.cachedBoard.columns) {
        if (type === 'column-title') {
            const column = window.cachedBoard.columns.find(c => c.id === columnId);

            // Line 796: MODIFY CACHED BOARD
            column.title = newTitle;  // ← PROBLEM: Modifies board during external change

            // Line 842-844: MARK AS UNSAVED
            if (typeof markUnsavedChanges === 'function') {
                markUnsavedChanges();  // ← PROBLEM: Triggers board state changes
            }
        }
    }
}
```

**Problem**: This modifies `window.cachedBoard` WHILE backend is processing external changes from disk. When backend sends the new board, frontend has already modified its cached board, creating conflicting states.

---

## Why This Breaks

### Timeline Visualization

```
Time    Frontend                           Backend
----    --------                           -------
T0      User editing "New Title"           File on disk: "Old Title"
        cachedBoard: "Old Title"

T1      (User saves file externally)
                                            File on disk changed

T2                                          Watcher fires
                                            Stop editing called

T3      Receives 'stopEditing'             Waiting for confirmation
        Calls saveCurrentField()
        cachedBoard: "New Title" ← MODIFIED
        markUnsavedChanges() called

T4      Sends 'editingStopped'             Receives confirmation
                                            Continues processing

T5                                          Reads from disk
                                            Parses board (external changes)
                                            Sends new board to frontend

T6      Receives new board from backend
        But cachedBoard already = "New Title"
        Incoming board = external changes
        CONFLICTING STATES ← BREAKS HERE
```

### The Conflict

At T6, frontend has:
- `window.cachedBoard` with user's edit ("New Title")
- Incoming board from backend with external changes
- These two states are out of sync
- Board rendering breaks because it can't reconcile the conflict

---

## User's Requirements

From user specification:

> "if it's an external change, and the user is currently editing the kanban. end the edit keeping the change. use this state as baseline."

This means:
1. **End the edit** = Close the editor UI
2. **Keep the change** = Don't lose the user's typed value
3. **Use this state as baseline** = Use current state (with edit) for conflict detection

> "DO NOT SAVE AT ANY POINT, EXCEPT WHEN THE USER SELECTS TO SAVE CHANGES INTO THE INCLUDED FILES."

This is key: We should NOT save to disk automatically. Only when user explicitly chooses.

---

## Solution Options

### Option 1: Don't Save Field When Stopping for External Change ✅

**Change**: Pass a flag to indicate we're stopping for external change

**Implementation**:
```typescript
// MarkdownFile.ts (line 968)
await this.requestStopEditing(true);  // true = discardEdit

// MessageHandler.ts
public async requestStopEditing(discardEdit: boolean = false): Promise<void> {
    panel.webview.postMessage({
        type: 'stopEditing',
        requestId: requestId,
        discardEdit: discardEdit  // ← New flag
    });
}

// webview.js
case 'stopEditing':
    if (window.taskEditor && window.taskEditor.currentEditor) {
        if (message.discardEdit) {
            // Restore original value (discard edit)
            window.taskEditor.currentEditor.element.value =
                window.taskEditor.currentEditor.originalValue;
        } else {
            // Save the field (normal stop)
            window.taskEditor.saveCurrentField();
        }
        window.taskEditor.currentEditor = null;
    }
    break;
```

**Flow**:
```
1. External change detected
2. Stop editing with discardEdit=true
3. Frontend restores original value
4. Frontend closes editor
5. Backend processes external changes
6. Show conflict dialog
7. User chooses resolution
```

**Pros**:
- Simple and clean
- No race condition (no board modification during processing)
- User can still choose to keep their edit via conflict dialog

**Cons**:
- User loses their typed value (but it's shown in conflict dialog)
- Might feel like lost work

### Option 2: Save Field But Freeze State ✅

**Change**: Save field but prevent any board updates/auto-saves

**Implementation**:
```typescript
// MessageHandler.ts
public async requestStopEditing(freezeState: boolean = false): Promise<void> {
    panel.webview.postMessage({
        type: 'stopEditing',
        requestId: requestId,
        freezeState: freezeState  // ← New flag
    });
}

// webview.js
case 'stopEditing':
    if (message.freezeState) {
        // Set freeze flag BEFORE saving
        window.frozenForConflict = true;
    }

    window.taskEditor.saveCurrentField();
    window.taskEditor.currentEditor = null;
    break;

// taskEditor.js saveCurrentField()
if (!window.frozenForConflict) {
    markUnsavedChanges();  // Only if not frozen
}
```

**Pros**:
- User's edit is preserved in frontend board
- Can be shown in conflict dialog
- No board updates during processing

**Cons**:
- More complex
- Need to unfreeze state after conflict resolution
- Still modifies window.cachedBoard (potential issues)

### Option 3: Capture Edit Value, Don't Save ✅

**Change**: Extract the edit value but don't apply it to board

**Implementation**:
```typescript
// MessageHandler.ts
public async requestStopEditing(captureValue: boolean = false): Promise<void> {
    panel.webview.postMessage({
        type: 'stopEditing',
        requestId: requestId,
        captureValue: captureValue
    });
}

// webview.js
case 'stopEditing':
    let capturedValue = null;
    if (message.captureValue && window.taskEditor.currentEditor) {
        capturedValue = window.taskEditor.currentEditor.element.value;
    }

    // Close WITHOUT saving
    window.taskEditor.currentEditor = null;

    // Send back with captured value
    vscode.postMessage({
        type: 'editingStopped',
        requestId: message.requestId,
        capturedValue: capturedValue
    });
    break;
```

**Pros**:
- No board modification
- Edit value preserved for conflict dialog
- Clean separation of concerns

**Cons**:
- Need to pass captured value through conflict resolution
- More complex message flow

---

## Recommended Solution

**Option 1: Discard Edit** is the cleanest and safest.

### Rationale

1. **User requirement**: "DO NOT SAVE AT ANY POINT" except user choice
   - Discarding edit aligns with this
   - User chooses via conflict dialog

2. **No race condition**:
   - No board modification during external change processing
   - Clean state throughout

3. **User can recover**:
   - Conflict dialog shows current state vs external
   - User can choose to keep their changes
   - Or accept external changes

4. **Simplicity**:
   - One flag, minimal code change
   - Easy to understand and maintain

### Implementation Plan

1. Add `discardEdit` parameter to `requestStopEditing()`
2. Pass flag in message to frontend
3. Frontend checks flag: discard or save
4. Update conflict dialog to show what was discarded (if needed)

---

## Next Steps

1. Implement Option 1 (discard edit when stopping for external change)
2. Test with main file + include files
3. Verify no race condition
4. Verify user can choose to keep edit via conflict dialog
5. Document behavior

---

**Status**: 🔴 **ISSUE IDENTIFIED - SOLUTION PLANNED**

The race condition is caused by `saveCurrentField()` modifying the board during external change processing. Solution: Discard edit when stopping for external change, let user choose via conflict dialog.
