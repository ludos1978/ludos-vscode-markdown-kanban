# Unified Change State Machine Design

## Problem Statement

**Current Issues:**
1. ⚠️ Multiple entry points for similar operations (not truly unified)
   - File system watchers → `handleFileSystemChange()`
   - User edits → message handlers
   - Save events → `SaveEventCoordinator`
   - Switch operations → direct message handler
2. ⚠️ Unsaved content verification not consistently applied across all change types

**Goal:** Single state machine that handles ALL file change scenarios through one unified flow.

---

## State Machine Architecture

### Core Principle
**ONE Entry Point** → `ChangeStateMachine.processChange(event)`

All change sources route through this single method, which then orchestrates the state transitions.

---

## States

```
┌─────────────────────────────────────────────────────────────┐
│                    CHANGE STATE MACHINE                      │
└─────────────────────────────────────────────────────────────┘

    [IDLE]
      ↓
    (any change event)
      ↓
    [RECEIVING_CHANGE] ──────────────┐
      ↓                               │
    (classify change)                 │
      ↓                               │
    [ANALYZING_IMPACT]                │
      ↓                               │
    (check edit state)                │
      ↓                               │
    ┌─────────────────┐               │
    │ Is user editing?│               │
    └────┬───────┬────┘               │
         │ YES   │ NO                 │
         ↓       ↓                    │
    [CAPTURING_EDIT] [SKIP]           │
         ↓                            │
    (apply to baseline)               │
         ↓                            │
    [CHECKING_UNSAVED] ←──────────────┘
      ↓
    ┌──────────────────────┐
    │ Has unsaved includes?│
    └────┬──────────┬──────┘
         │ YES      │ NO
         ↓          ↓
    [PROMPTING_USER] [SKIP]
         ↓
    ┌──────────────────┐
    │ User choice?     │
    └─┬────┬─────┬─────┘
      │Save│Disc.│Cancel
      ↓    ↓     ↓
    [SAVING] [SKIP] [CANCELLED]
      ↓      ↓
      └──────┘
         ↓
    [CLEARING_CACHE]
      ↓
    (unset old includes, clear backend & frontend)
      ↓
    [LOADING_NEW]
      ↓
    (set new includes, load from disk)
      ↓
    [UPDATING_BACKEND]
      ↓
    (update board state, file registry)
      ↓
    [SYNCING_FRONTEND]
      ↓
    (send targeted updates to webview)
      ↓
    [COMPLETE]
      ↓
    [IDLE]
```

---

## State Definitions

### 1. **IDLE**
- **Description**: Waiting for any change event
- **Entry**: None (initial state)
- **Exit Events**: Any change event arrives
- **Next State**: `RECEIVING_CHANGE`

### 2. **RECEIVING_CHANGE**
- **Description**: Collecting information about the change
- **Actions**:
  - Capture event source (file watcher, user edit, save, switch)
  - Capture event parameters (file path, change type, etc.)
  - Create `ChangeContext` object
- **Next State**: `ANALYZING_IMPACT`

### 3. **ANALYZING_IMPACT**
- **Description**: Classify the change and determine impact
- **Actions**:
  - Determine: Is main file changed?
  - Determine: Are include files changed?
  - Determine: Are includes being switched?
  - Calculate which files will be unloaded/loaded
- **Next State**: `CHECKING_EDIT_STATE`

### 4. **CHECKING_EDIT_STATE**
- **Description**: Check if user is currently editing any affected files
- **Actions**:
  - Check main file edit mode flag
  - Check all include files edit mode flags
  - If any file is in edit mode → `CAPTURING_EDIT`
  - Otherwise → `CHECKING_UNSAVED`
- **Next State**: `CAPTURING_EDIT` or `CHECKING_UNSAVED`

### 5. **CAPTURING_EDIT**
- **Description**: User is editing, capture current edit value
- **Actions**:
  - Request frontend to stop editing
  - Capture edit value from frontend
  - Apply edit to baseline (memory only, not disk)
  - Keep edit mode flag for conflict detection
- **Next State**: `CHECKING_UNSAVED`

### 6. **CHECKING_UNSAVED**
- **Description**: Check if any include files being unloaded have unsaved changes
- **Actions**:
  - Get list of files being unloaded (from switch operations)
  - Filter to files with `hasUnsavedChanges() === true`
  - If unsaved files found → `PROMPTING_USER`
  - Otherwise → `CLEARING_CACHE`
- **Next State**: `PROMPTING_USER` or `CLEARING_CACHE`

### 7. **PROMPTING_USER**
- **Description**: Show dialog asking user what to do with unsaved changes
- **Actions**:
  - Show modal dialog with unsaved file list
  - Options: Save, Discard, Cancel
  - Wait for user response
- **Next State**:
  - `SAVING_UNSAVED` (if Save)
  - `CLEARING_CACHE` (if Discard)
  - `CANCELLED` (if Cancel)

### 8. **SAVING_UNSAVED**
- **Description**: Save unsaved files per user request
- **Actions**:
  - For each unsaved file: call `file.save()`
  - Wait for all saves to complete
- **Next State**: `CLEARING_CACHE`

### 9. **CLEARING_CACHE**
- **Description**: Clear old include files from cache
- **Actions**:
  - **Frontend**: Clear column.tasks = [] or task.description = ''
  - **Backend**: Call `file.discardChanges()` on old includes
  - Unset include file references
- **Next State**: `LOADING_NEW`

### 10. **LOADING_NEW**
- **Description**: Load new include file content
- **Actions**:
  - Set new include file references
  - Load content from disk
  - Parse content (presentation format for columns, etc.)
  - Update board state with loaded content
- **Next State**: `UPDATING_BACKEND`

### 11. **UPDATING_BACKEND**
- **Description**: Update backend state with all changes
- **Actions**:
  - Update board object with new structure
  - Sync include file registry
  - Mark unsaved changes if needed
  - Invalidate board cache
- **Next State**: `SYNCING_FRONTEND`

### 12. **SYNCING_FRONTEND**
- **Description**: Send targeted updates to frontend
- **Actions**:
  - Send only modified content to webview
  - Use specific message types: `updateTaskContent`, `updateColumnContent`, `fullBoardRefresh`
  - Wait for frontend acknowledgment
- **Next State**: `COMPLETE`

### 13. **COMPLETE**
- **Description**: Change handling completed successfully
- **Actions**:
  - Clear change context
  - Log completion
  - Emit completion event (for testing/monitoring)
- **Next State**: `IDLE`

### 14. **CANCELLED**
- **Description**: User cancelled the operation
- **Actions**:
  - Roll back any partial changes
  - Log cancellation
  - Emit cancellation event
- **Next State**: `IDLE`

### 15. **ERROR**
- **Description**: Error occurred during processing
- **Actions**:
  - Log error with full context
  - Show error dialog to user
  - Attempt recovery (reload from disk)
- **Next State**: `IDLE`

---

## Event Routing - The Unified Entry Point

### All Events Route Through One Method

```typescript
class ChangeStateMachine {
    /**
     * SINGLE ENTRY POINT for all changes
     * All change sources must call this method
     */
    public async processChange(event: ChangeEvent): Promise<ChangeResult> {
        // Start state machine from RECEIVING_CHANGE
        return await this._stateMachine.transition(State.RECEIVING_CHANGE, event);
    }
}
```

### Event Types

```typescript
type ChangeEvent =
    | FileSystemChangeEvent
    | UserEditEvent
    | SaveEvent
    | IncludeSwitchEvent;

interface FileSystemChangeEvent {
    type: 'file_system_change';
    file: MarkdownFile;
    changeType: 'modified' | 'deleted' | 'created';
    timestamp: number;
}

interface UserEditEvent {
    type: 'user_edit';
    editType: 'task_title' | 'task_description' | 'column_title';
    params: {
        taskId?: string;
        columnId?: string;
        value: string;
        includeSwitch?: {
            oldFiles: string[];
            newFiles: string[];
        };
    };
}

interface SaveEvent {
    type: 'save';
    file: MarkdownFile;
    source: 'user_command' | 'auto_save' | 'pre_unload';
}

interface IncludeSwitchEvent {
    type: 'include_switch';
    target: 'column' | 'task';
    targetId: string;
    columnIdForTask?: string;
    oldFiles: string[];
    newFiles: string[];
    newTitle?: string;
}
```

### Routing Implementation

```typescript
// OLD: Multiple entry points ❌
handleFileSystemChange(file, changeType) { /* ... */ }
handleUserEdit(message) { /* ... */ }
handleSaveEvent(file) { /* ... */ }
handleIncludeSwitch(switchInfo) { /* ... */ }

// NEW: Single entry point ✅
stateMachine.processChange({
    type: 'file_system_change',
    file: file,
    changeType: 'modified',
    timestamp: Date.now()
});

stateMachine.processChange({
    type: 'user_edit',
    editType: 'task_title',
    params: { taskId, columnId, value, includeSwitch }
});

stateMachine.processChange({
    type: 'save',
    file: file,
    source: 'user_command'
});

stateMachine.processChange({
    type: 'include_switch',
    target: 'task',
    targetId: taskId,
    oldFiles: [...],
    newFiles: [...]
});
```

---

## Implementation Strategy

### Phase 1: Create State Machine Core
1. Create `src/core/ChangeStateMachine.ts`
2. Define state enum and transition map
3. Implement state transition engine
4. Add comprehensive logging

### Phase 2: Migrate Entry Points
1. **File System Watcher** → Convert to `processChange({ type: 'file_system_change' })`
2. **Message Handler (user edits)** → Convert to `processChange({ type: 'user_edit' })`
3. **Save Coordinator** → Convert to `processChange({ type: 'save' })`
4. **Include Switch** → Convert to `processChange({ type: 'include_switch' })`

### Phase 3: State Handlers
Implement handler for each state:
- `handleReceivingChange(context)`
- `handleAnalyzingImpact(context)`
- `handleCheckingEditState(context)`
- `handleCapturingEdit(context)`
- `handleCheckingUnsaved(context)`
- `handlePromptingUser(context)`
- `handleSavingUnsaved(context)`
- `handleClearingCache(context)`
- `handleLoadingNew(context)`
- `handleUpdatingBackend(context)`
- `handleSyncingFrontend(context)`
- `handleComplete(context)`
- `handleCancelled(context)`
- `handleError(context, error)`

### Phase 4: Integration & Testing
1. Update all existing entry points to use state machine
2. Remove old direct handlers
3. Add state machine tests
4. Verify unsaved content prompt appears for all switch types

---

## Benefits

### ✅ Solves PARTIAL Compliance Issues

1. **Single Entry Point**: ✅ ALL changes go through `stateMachine.processChange()`
2. **Consistent Unsaved Check**: ✅ `CHECKING_UNSAVED` state is ALWAYS executed before switches
3. **Predictable Flow**: ✅ Every change follows same state sequence
4. **Easier Testing**: ✅ Test state transitions independently
5. **Better Logging**: ✅ Every state transition is logged
6. **Clear Debugging**: ✅ Current state is always known

---

## Example Flow: User Edits Task Title with Include Switch

```
Event: User changes "task" → "!!!include(./file.md)!!!"

IDLE
  → RECEIVING_CHANGE
      • Capture: type='user_edit', editType='task_title'
      • Detect: oldFiles=[], newFiles=['./file.md']

  → ANALYZING_IMPACT
      • mainFileChanged = false
      • includeFilesChanged = false
      • includesSwitched = true (task include switch)

  → CHECKING_EDIT_STATE
      • Check: Is user editing this task? → NO (title edit just completed)
      • Skip CAPTURING_EDIT

  → CHECKING_UNSAVED
      • oldFiles = [] (no files being unloaded)
      • Skip PROMPTING_USER

  → CLEARING_CACHE
      • Clear task.description = ''
      • Clear task.displayTitle = ''

  → LOADING_NEW
      • Load './file.md' content from disk
      • Parse content → task.description

  → UPDATING_BACKEND
      • Update task object in board
      • Mark main file as having unsaved changes

  → SYNCING_FRONTEND
      • Send updateTaskContent message

  → COMPLETE
      • Log success

  → IDLE
```

---

## Example Flow: External File Change While Editing

```
Event: Include file modified externally while user is editing it

IDLE
  → RECEIVING_CHANGE
      • Capture: type='file_system_change', file=includeFile, changeType='modified'

  → ANALYZING_IMPACT
      • mainFileChanged = false
      • includeFilesChanged = true
      • includesSwitched = false

  → CHECKING_EDIT_STATE
      • Check: Is user editing includeFile? → YES
      • file._isInEditMode = true

  → CAPTURING_EDIT
      • Request frontend: stopEditing()
      • Capture: editValue from frontend
      • Apply: includeFile._baseline = editValue
      • Keep: _isInEditMode = true (for conflict detection)

  → CHECKING_UNSAVED
      • No files being unloaded
      • Skip PROMPTING_USER

  → CLEARING_CACHE
      • Skip (no cache to clear)

  → LOADING_NEW
      • Load external content from disk
      • Detect conflict: _baseline !== diskContent
      • Show conflict dialog: baseline (user edit) vs disk (external)

  → UPDATING_BACKEND
      • Apply user's choice (keep edit / accept external / merge)
      • Update includeFile content

  → SYNCING_FRONTEND
      • Send updateTaskContent with resolved content

  → COMPLETE
      • Log success with conflict resolution

  → IDLE
```

---

## Migration Checklist

- [ ] Create `ChangeStateMachine.ts` with state definitions
- [ ] Implement state transition engine
- [ ] Create `ChangeEvent` type hierarchy
- [ ] Implement all state handlers
- [ ] Migrate file system watcher to use state machine
- [ ] Migrate message handler (user edits) to use state machine
- [ ] Migrate save coordinator to use state machine
- [ ] Migrate include switch operations to use state machine
- [ ] Remove old direct handler methods
- [ ] Add state machine unit tests
- [ ] Add integration tests for each event type
- [ ] Verify unsaved prompt appears for all switch scenarios
- [ ] Update documentation

---

## Success Criteria

✅ **FULL Compliance Achieved When:**

1. **Single Entry Point**: Only `stateMachine.processChange()` is called from external sources
2. **No Direct Handlers**: No direct calls to `handleFileSystemChange()`, message handlers do not directly modify state
3. **Consistent Unsaved Check**: `CHECKING_UNSAVED` state is reached for ALL include switch operations
4. **Predictable Flow**: Every change follows documented state sequence
5. **All Tests Pass**: State machine unit tests + integration tests all green

---

## Notes

- The state machine is **synchronous** in its state transitions (one state at a time)
- States can perform **asynchronous operations** (file I/O, user prompts)
- **Cancellation** is supported - user can cancel during `PROMPTING_USER` state
- **Error handling** transitions to `ERROR` state from any state
- **Concurrency**: Multiple changes queued → processed sequentially by state machine
