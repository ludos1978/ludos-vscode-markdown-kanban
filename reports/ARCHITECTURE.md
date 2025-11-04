# Kanban Markdown Extension - Architecture Documentation

## Table of Contents
1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [State Machine Design](#state-machine-design)
4. [File System](#file-system)
5. [Change Handling Flow](#change-handling-flow)
6. [Data Synchronization](#data-synchronization)
7. [Include Files System](#include-files-system)

---

## Overview

The Kanban Markdown extension is built on a **state machine architecture** that provides:
- Single unified entry point for all file changes
- Predictable state transitions
- Consistent handling of unsaved changes
- Conflict resolution for concurrent edits
- Separation of concerns between layers

### Key Components

```
┌─────────────────────────────────────────────────────────┐
│                    VSCode Extension                      │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────┐       ┌────────────────────┐      │
│  │  File Watcher    │───┐   │  Message Handler   │      │
│  │  (External)      │   │   │  (User Actions)    │      │
│  └──────────────────┘   │   └────────────────────┘      │
│                         │              │                 │
│                         ↓              ↓                 │
│              ┌────────────────────────────┐              │
│              │  CHANGE STATE MACHINE      │              │
│              │  (Single Entry Point)      │              │
│              └────────────────────────────┘              │
│                         │                                │
│         ┌───────────────┼───────────────┐                │
│         ↓               ↓               ↓                │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐           │
│  │   Main   │    │  Column  │    │   Task   │           │
│  │   File   │    │ Includes │    │ Includes │           │
│  └──────────┘    └──────────┘    └──────────┘           │
│         │               │               │                │
│         └───────────────┴───────────────┘                │
│                         │                                │
│                         ↓                                │
│              ┌────────────────────────────┐              │
│              │   Webview (Frontend)       │              │
│              │   - Kanban Board UI        │              │
│              │   - Drag & Drop            │              │
│              │   - Edit Capture           │              │
│              └────────────────────────────┘              │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## Core Architecture

### 1. State Machine Pattern

**Location**: [src/core/ChangeStateMachine.ts](src/core/ChangeStateMachine.ts)

The state machine is the **single source of truth** for all file change operations.

#### Why State Machine?

**Previous Architecture (Scattered Entry Points):**
```typescript
// ❌ Multiple uncoordinated entry points
handleFileSystemChange(file, changeType)  // File watcher
handleUserEdit(message)                    // User actions
handleSaveEvent(file)                      // Save operations
handleIncludeSwitch(switchInfo)            // Include switches
```

**Problems:**
- Inconsistent unsaved change verification
- Race conditions between different entry points
- Difficult to debug (unclear execution order)
- Duplicate logic across handlers

**New Architecture (Unified State Machine):**
```typescript
// ✅ Single unified entry point
stateMachine.processChange(event)
```

**Benefits:**
- **Guaranteed execution order**: Every change follows same state sequence
- **Consistent unsaved check**: `CHECKING_UNSAVED` state always executed
- **Clear debugging**: Current state always known
- **No race conditions**: Events queued and processed sequentially
- **Testable**: Each state can be tested independently

### 2. State Flow

See [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) for complete state definitions.

**Abbreviated Flow:**
```
[IDLE]
  ↓ (any change event)
[RECEIVING_CHANGE]
  ↓ (classify change)
[ANALYZING_IMPACT]
  ↓ (check edit state)
[CHECKING_EDIT_STATE]
  ↓ (if editing)
[CAPTURING_EDIT]
  ↓ (check unsaved)
[CHECKING_UNSAVED] ← ✅ ALWAYS executed for switches
  ↓ (if unsaved found)
[PROMPTING_USER]
  ↓ (user choice: save/discard/cancel)
[SAVING_UNSAVED] or [CANCELLED]
  ↓
[CLEARING_CACHE]
  ↓ (unset old, clear caches)
[LOADING_NEW]
  ↓ (load new content)
[UPDATING_BACKEND]
  ↓ (update board state)
[SYNCING_FRONTEND]
  ↓ (send targeted updates)
[COMPLETE]
  ↓
[IDLE]
```

### 3. Event Types

All changes are represented as one of four event types:

```typescript
type ChangeEvent =
    | FileSystemChangeEvent    // External file modifications
    | UserEditEvent           // User edits in webview
    | SaveEvent               // File save operations
    | IncludeSwitchEvent;     // Include file switches
```

---

## File System

### File Type Hierarchy

```
MarkdownFile (base class)
    │
    ├── MainKanbanFile
    │   └── Contains: Board structure, columns, tasks
    │
    └── IncludeFile (base for includes)
        │
        ├── ColumnIncludeFile
        │   └── Contains: Presentation format (Marp slides)
        │
        └── TaskIncludeFile
            └── Contains: Task description content
```

### File Registry

**Location**: [src/files/MarkdownFileRegistry.ts](src/files/MarkdownFileRegistry.ts)

Central registry for all file instances:
- **Main file**: One per workspace
- **Include files**: Multiple, managed per column/task
- **Lifecycle**: Created on demand, cached, cleared when unloaded

### File State Management

Each file maintains:
- `_content`: Current in-memory content
- `_baseline`: Last saved content (disk state)
- `_isInEditMode`: Flag indicating user is actively editing
- `_exists`: Whether file exists on disk

**Unsaved Detection:**
```typescript
hasUnsavedChanges(): boolean {
    return this._content !== this._baseline;
}
```

---

## Change Handling Flow

### Entry Point Migration

**Old Code (Multiple Paths):**
```typescript
// File watcher
vscode.workspace.onDidChangeTextDocument(event => {
    handleFileSystemChange(file, 'modified');
});

// Message handler
case 'editTaskTitle':
    handleUserEdit(message);
    break;

// Save coordinator
await file.save();
```

**New Code (Unified):**
```typescript
// File watcher
vscode.workspace.onDidChangeTextDocument(event => {
    stateMachine.processChange({
        type: 'file_system_change',
        file: file,
        changeType: 'modified',
        timestamp: Date.now()
    });
});

// Message handler
case 'editTaskTitle':
    stateMachine.processChange({
        type: 'user_edit',
        editType: 'task_title',
        params: { taskId, columnId, value }
    });
    break;

// Save coordinator
stateMachine.processChange({
    type: 'save',
    file: file,
    source: 'user_command'
});
```

### Conflict Resolution

When external changes occur while user is editing:

1. **Detect Edit State** (`CHECKING_EDIT_STATE`)
   - Check `file._isInEditMode` flag
   - If true → proceed to capture

2. **Capture Edit** (`CAPTURING_EDIT`)
   - Request frontend: `stopEditing()`
   - Frontend returns current edit value
   - Backend: `applyEditToBaseline(editValue)`
   - Result: Edit preserved in baseline (memory)

3. **Load External Change** (`LOADING_NEW`)
   - Load external content from disk
   - Detect conflict: `baseline !== diskContent`
   - Show conflict dialog with both versions

4. **User Resolution**
   - Keep edit (discard external)
   - Accept external (discard edit)
   - Manual merge

---

## Data Synchronization

### Two-Way Sync Architecture

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND                           │
│  - Kanban Board UI (HTML/JS)                        │
│  - User interactions                                │
│  - Visual updates                                   │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
               │ Messages             │ Messages
               ↓                      ↑
┌──────────────────────────┐  ┌──────────────────────┐
│   Message Handler        │  │   Panel Webview      │
│   (Frontend → Backend)   │  │   (Backend → Frontend)│
└──────────────┬───────────┘  └───────────┬──────────┘
               │                           │
               ↓                           ↑
┌─────────────────────────────────────────────────────┐
│                   STATE MACHINE                      │
│  - Processes all changes                            │
│  - Maintains consistency                            │
└──────────────┬──────────────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────────────┐
│                FILE SYSTEM (Backend)                 │
│  - MainKanbanFile                                   │
│  - IncludeFiles (Column/Task)                       │
│  - File Registry                                    │
└─────────────────────────────────────────────────────┘
```

### Message Types

**Backend → Frontend:**
- `boardUpdate`: Full board refresh
- `updateTaskContent`: Specific task updated
- `updateColumnContent`: Specific column updated
- `batch`: Multiple messages batched for performance

**Frontend → Backend:**
- `editTaskTitle`: User edited task title
- `editTaskDescription`: User edited task description
- `editingStarted`: User began editing (block backend updates)
- `editingStoppedNormal`: User finished editing (resume backend updates)

### Targeted Updates

Only modified content is sent to frontend:

```typescript
// ❌ OLD: Always send full board
panel.webview.postMessage({
    type: 'boardUpdate',
    board: fullBoard  // Large payload
});

// ✅ NEW: Send only changed task
panel.webview.postMessage({
    type: 'updateTaskContent',
    columnId: 'col-1',
    taskId: 'task-5',
    description: newDescription  // Small payload
});
```

---

## Include Files System

### Overview

Include files allow splitting board content across multiple files:

1. **Column Includes**: Entire column's tasks stored in external file
2. **Task Includes**: Task description stored in external file
3. **Regular Includes**: Content embedded in task/column headers

### Syntax

```markdown
## Column Title #stack
- [ ] Task with include
  !!!include(./path/to/file.md)!!!

## Column Include #stack !!!include(./column-content.md)!!!

## Normal Column
- [ ] !!!include(./task-content.md)!!!
```

### Column Include Format

Column includes use **Marp presentation format**:

```markdown
# Slide 1 Title
Content for task 1
@person @due:2025-03-27

---

# Slide 2 Title
Content for task 2
@sticky

---
```

Each slide (separated by `---`) becomes one task in the Kanban column.

### Include File Lifecycle

```
1. User adds include to title
   ↓
2. State Machine: ANALYZING_IMPACT
   → Detects include switch
   ↓
3. State Machine: CHECKING_UNSAVED
   → Check if old include has unsaved changes
   ↓
4. State Machine: PROMPTING_USER (if unsaved)
   → User chooses: Save / Discard / Cancel
   ↓
5. State Machine: CLEARING_CACHE
   → Unset old include references
   → Clear frontend (column.tasks = [])
   → Clear backend (file.discardChanges())
   ↓
6. State Machine: LOADING_NEW
   → Load new include file from disk
   → Parse presentation format
   → Update board state
   ↓
7. State Machine: SYNCING_FRONTEND
   → Send updateColumnContent message
   ↓
8. Frontend displays new tasks
```

### Relative Paths

- **Main file includes**: Paths relative to main kanban file
- **Include file includes**: Paths relative to the include file itself

**Example:**
```
/workspace/
  kanban.md                    (main file)
  includes/
    column-tasks.md            (column include)
    nested/
      task-description.md      (task include)
```

```markdown
<!-- In kanban.md -->
## My Column !!!include(./includes/column-tasks.md)!!!

<!-- In includes/column-tasks.md -->
# Task 1
Description with nested include
!!!include(./nested/task-description.md)!!!
```

Path `./nested/task-description.md` is relative to `column-tasks.md`, not `kanban.md`.

---

## Key Design Principles

### 1. Single Point of Entry
**Rule**: All file changes MUST go through `stateMachine.processChange()`

**Enforcement**:
- Remove direct handler methods
- All subsystems call state machine
- Tests verify single entry point

### 2. No Auto-Save
**Rule**: Never save files without explicit user action

**Implementation**:
- `setContent(content, false)` → `false` = mark as unsaved, don't save
- Edits captured to baseline (memory only)
- User must explicitly choose "Save" in dialogs

### 3. Baseline Capture
**Rule**: External changes during editing → capture edit to baseline

**Flow**:
```
User editing task → External save → Backend detects edit mode
  → Request stop editing → Frontend returns edit value
  → Backend: _baseline = editValue (memory)
  → Load external content from disk
  → Conflict detected: baseline vs disk
  → Show dialog: Keep edit / Accept external
```

### 4. Consistent Unsaved Check
**Rule**: Before unloading any include file, check for unsaved changes

**Implementation**: `CHECKING_UNSAVED` state is ALWAYS executed before `CLEARING_CACHE`

### 5. Targeted Updates
**Rule**: Send only modified content to frontend

**Implementation**:
- Use specific message types: `updateTaskContent`, `updateColumnContent`
- Avoid full board refreshes when possible
- Batch multiple small updates for performance

---

## Testing Strategy

### State Machine Tests
- Unit test each state handler independently
- Test all state transitions
- Test event queueing
- Test error recovery

### Integration Tests
- Test each event type end-to-end
- Verify unsaved prompts appear correctly
- Test conflict resolution flows
- Test include file switches

### Current Test Suite
Location: [tests/](tests/)

Run tests:
```bash
npm test
```

---

## Migration Status

### ✅ Completed
1. State machine design and documentation
2. State machine skeleton implementation
3. Requirement compliance analysis
4. Bug fixes for include file handling:
   - Loading overlay hang (batch message handler)
   - Include files not saving (content sync)
   - Edit mode detection for includes
   - Edit capture to baseline

### 🚧 In Progress
1. State machine handler implementations
2. Entry point migration to state machine

### 📋 Planned
1. Remove old direct handlers
2. Full integration testing
3. Performance optimization
4. Additional conflict resolution strategies

---

## Related Documentation

- [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) - Complete state machine specification
- [AGENT.md](AGENT.md) - Development rules and guidelines
- [agent/FUNCTIONS.md](agent/FUNCTIONS.md) - Function catalog
- [agent/DATASTRUCTURE.md](agent/DATASTRUCTURE.md) - Data structure definitions
- [agent/DATAINSTANCES.md](agent/DATAINSTANCES.md) - Data instance tracking

---

## Contributing

When adding new features:

1. **Consult Documentation First**
   - Read [AGENT.md](AGENT.md) for coding rules
   - Check [agent/FUNCTIONS.md](agent/FUNCTIONS.md) for existing functions
   - Check [agent/DATASTRUCTURE.md](agent/DATASTRUCTURE.md) for data structures

2. **Follow State Machine Pattern**
   - All file changes → `stateMachine.processChange()`
   - Create new event type if needed
   - Add state handlers as needed

3. **Update Documentation**
   - Update [agent/FUNCTIONS.md](agent/FUNCTIONS.md) with new functions
   - Update [agent/DATASTRUCTURE.md](agent/DATASTRUCTURE.md) with new structures
   - Update this document if architecture changes

4. **Test Thoroughly**
   - Add unit tests for new states
   - Add integration tests for new event types
   - Verify unsaved change handling

---

## Version History

- **v6.0** (Current): State machine architecture, include file fixes
- **v5.0**: Baseline capture implementation
- **v4.0**: Source code restructuring
- **v3.0**: UnifiedChangeHandler introduction
- **v2.0**: Include files system
- **v1.0**: Initial release
