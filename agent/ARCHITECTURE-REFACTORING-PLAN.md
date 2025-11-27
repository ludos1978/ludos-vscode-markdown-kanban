# Architecture Refactoring Plan: Event-Driven Component System

**Created:** 2024-11-27
**Status:** PLANNING
**Goal:** Refactor KanbanWebviewPanel god class into focused, event-driven components

---

## Executive Summary

This plan details the migration from the current monolithic `KanbanWebviewPanel` (2000+ lines) to a modular, event-driven architecture. The migration is designed to be:

- **Incremental**: Each phase delivers working code
- **Safe**: Rollback possible at each phase
- **Testable**: Each component can be tested in isolation
- **Non-breaking**: Existing functionality preserved throughout

### Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  KanbanPanelShell                            │
│    (VS Code lifecycle ONLY: create, dispose, reveal)        │
│                      ~200 lines                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     PanelEventBus                            │
│         (typed events, middleware, correlation IDs)         │
│                      ~400 lines                              │
└─────────────────────────────────────────────────────────────┘
        │               │               │               │
        ▼               ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ BoardStore  │ │FileCoordina-│ │WebviewBridge│ │EditSession  │
│   ~350 ln   │ │ tor ~500 ln │ │   ~400 ln   │ │   ~250 ln   │
│             │ │             │ │             │ │             │
│ • board     │ │ • registry  │ │ • messages  │ │ • undo/redo │
│ • cache     │ │ • includes  │ │ • HTML gen  │ │ • dirty     │
│ • selectors │ │ • watchers  │ │ • batching  │ │ • conflicts │
│ • commands  │ │ • conflicts │ │ • request/  │ │ • checkpts  │
│             │ │             │ │   response  │ │             │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

### Quality Targets

| Component | Target Quality | Key Metrics |
|-----------|---------------|-------------|
| PanelEventBus | 98% | Type safety, testability, observability |
| BoardStore | 97% | Immutability, undo support, validation |
| WebviewBridge | 96% | Reliability, batching, request/response |
| FileCoordinator | 95% | Conflict handling, operation queue |
| EditSession | 96% | Undo/redo, checkpoint management |
| KanbanPanelShell | 97% | Minimal responsibility, clean lifecycle |

---

## Phase Dependencies

```
Phase 1: EventBus ──────┬──────────────────────────────────────┐
                        │                                      │
Phase 2: BoardStore ────┼──► Phase 5: EditSession             │
                        │         │                            │
Phase 3: WebviewBridge ─┤         │                            │
                        │         ▼                            │
Phase 4: FileCoordinator┴──► Phase 6: Shell Integration ◄─────┘
                                  │
                                  ▼
                         Phase 7: Cleanup & Tests
```

---

## Phase 1: PanelEventBus (Foundation)

### Session 1.1: Core EventBus Implementation

**Duration:** ~2-3 hours
**Risk Level:** Low (additive, no existing code modified)

#### Files to Create

```
src/core/events/
├── index.ts                 # Barrel export
├── PanelEventBus.ts         # Main implementation
├── EventDefinitions.ts      # All event type definitions
├── middleware/
│   ├── index.ts
│   ├── loggingMiddleware.ts
│   └── performanceMiddleware.ts
└── testing/
    ├── index.ts
    └── MockEventBus.ts
```

#### Implementation Steps

1. **Create EventDefinitions.ts** - All typed events
   ```typescript
   // Board events, File events, Edit events, Webview events, etc.
   export interface EventDefinitions { ... }
   ```

2. **Create PanelEventBus.ts** - Core implementation
   - Priority-based handler execution
   - WeakRef handler support
   - Correlation ID tracking
   - Middleware chain
   - Event history
   - Metrics collection

3. **Create MockEventBus.ts** - Testing utilities
   - Event recording
   - Assertions (expectEmitted, waitFor)
   - Reset functionality

4. **Create middleware** - Built-in middleware
   - Logging middleware
   - Performance monitoring middleware

#### Success Criteria

- [ ] All events strongly typed
- [ ] Handlers execute in priority order
- [ ] WeakRef handlers auto-cleanup
- [ ] Correlation IDs link related events
- [ ] MockEventBus passes all test scenarios
- [ ] No compile errors
- [ ] Unit tests pass (create alongside)

#### Test Scenarios

```typescript
// Test file: src/test/unit/PanelEventBus.test.ts
describe('PanelEventBus', () => {
    it('should emit events with correct payload types');
    it('should execute handlers in priority order');
    it('should support once() subscriptions');
    it('should auto-cleanup WeakRef handlers');
    it('should track correlation IDs');
    it('should record event history when enabled');
    it('should timeout slow handlers');
    it('should execute middleware chain');
});
```

#### Rollback Plan

- Simply delete `src/core/events/` folder
- No existing code depends on it yet

---

### Session 1.2: Integration with Existing Code

**Duration:** ~1-2 hours
**Risk Level:** Low-Medium (additive integration)

#### Steps

1. **Add EventBus to KanbanWebviewPanel** (alongside existing code)
   ```typescript
   // In KanbanWebviewPanel constructor
   private _eventBus: PanelEventBus;

   constructor(...) {
       this._eventBus = new PanelEventBus();
       // Enable logging in development
       if (isDevelopment) {
           this._eventBus.use(createLoggingMiddleware());
       }
   }
   ```

2. **Start emitting events** (parallel to existing behavior)
   ```typescript
   // Example: In loadMarkdownFile
   async loadMarkdownFile(document: vscode.TextDocument) {
       this._eventBus.emit('board:loading', { path: document.uri.fsPath });
       // ... existing code ...
       this._eventBus.emit('board:loaded', { board, source: 'file' });
   }
   ```

3. **Verify events fire correctly** via logging middleware

#### Success Criteria

- [ ] EventBus instantiated in KanbanWebviewPanel
- [ ] Events emitting alongside existing behavior
- [ ] Logging shows event flow
- [ ] No regression in existing functionality

---

## Phase 2: BoardStore (State Management)

### Session 2.1: Core BoardStore Implementation

**Duration:** ~3-4 hours
**Risk Level:** Low (new component, parallel to existing)

#### Files to Create

```
src/core/stores/
├── index.ts
├── BoardStore.ts           # Main store
├── BoardSelectors.ts       # Memoized selectors
├── BoardValidator.ts       # Validation logic
└── BoardCommands.ts        # Command definitions for undo
```

#### Implementation Steps

1. **Create BoardValidator.ts**
   - Validate board structure
   - Check for duplicate IDs
   - Return structured errors

2. **Create BoardSelectors.ts**
   - Memoized getColumn, getTask, etc.
   - WeakMap-based caching

3. **Create BoardStore.ts**
   - Immer-based state updates
   - Command pattern for undo/redo
   - Event emission on changes
   - Subscriber support

#### Key Design Decisions

```typescript
// Use immer for immutable updates
import { produce, Draft } from 'immer';

// Command pattern for undo/redo
interface BoardCommand {
    type: string;
    execute: (draft: Draft<KanbanBoard>) => void;
    undo: (draft: Draft<KanbanBoard>) => void;
    description: string;
}

// Memoized selectors to avoid recomputation
class BoardSelectors {
    private static cache = new WeakMap<BoardState, Map<string, any>>();
    static getColumn(state: BoardState, id: string): KanbanColumn | undefined;
    // ...
}
```

#### Success Criteria

- [ ] State updates are immutable
- [ ] Undo/redo works correctly
- [ ] Selectors are memoized
- [ ] Validation catches invalid boards
- [ ] Events emit on state changes
- [ ] Unit tests pass

#### Dependencies

- Requires: Phase 1 (EventBus)
- Requires: npm install immer

---

### Session 2.2: Migrate Board State to BoardStore

**Duration:** ~2-3 hours
**Risk Level:** Medium (modifying existing behavior)

#### Steps

1. **Create BoardStore in KanbanWebviewPanel**
   ```typescript
   private _boardStore: BoardStore;

   constructor(...) {
       this._boardStore = new BoardStore(this._eventBus);
   }
   ```

2. **Redirect board access through store**
   - Replace `this._cachedBoard` with `this._boardStore.getBoard()`
   - Replace direct mutations with store methods

3. **Migrate dirty tracking**
   - Remove `this._dirtyColumns`, `this._dirtyTasks`
   - Use `this._boardStore.isDirty()`

4. **Connect undo/redo to store**
   - Replace `this._undoRedoManager` usage with store commands

#### Migration Checklist

- [ ] `_cachedBoard` → `_boardStore.getBoard()`
- [ ] `_boardCacheValid` → `_boardStore.state.cacheValid`
- [ ] `_dirtyColumns` → `_boardStore.state.dirtyColumns`
- [ ] `_dirtyTasks` → `_boardStore.state.dirtyTasks`
- [ ] `_undoRedoManager.saveState()` → `_boardStore.executeCommand()`
- [ ] `_undoRedoManager.undo()` → `_boardStore.undo()`
- [ ] `_undoRedoManager.redo()` → `_boardStore.redo()`

#### Rollback Plan

- Keep original properties commented but present
- Revert by uncommenting and removing BoardStore usage

---

## Phase 3: WebviewBridge (Message Routing)

### Session 3.1: Core WebviewBridge Implementation

**Duration:** ~3-4 hours
**Risk Level:** Low (new component)

#### Files to Create

```
src/core/bridge/
├── index.ts
├── WebviewBridge.ts        # Main bridge
├── MessageTypes.ts         # Incoming/Outgoing message types
└── HtmlGenerator.ts        # HTML generation (extracted)
```

#### Implementation Steps

1. **Create MessageTypes.ts**
   - Define IncomingMessages (frontend → backend)
   - Define OutgoingMessages (backend → frontend)
   - Define RequestTypes for request/response pattern

2. **Create WebviewBridge.ts**
   - Message batching with deduplication
   - Request/response pattern with timeout
   - Ready state handling with message queue
   - Handler registration

3. **Create HtmlGenerator.ts**
   - Extract `_getHtmlForWebview()` from KanbanWebviewPanel
   - Make it a pure function

#### Key Features

```typescript
// Typed message sending
send<K extends keyof OutgoingMessages>(type: K, payload: OutgoingMessages[K]): void;

// Request/response pattern
async request<K extends keyof RequestTypes>(type: K, payload?: any): Promise<RequestTypes[K]['response']>;

// Message batching (16ms default)
private queueMessage(type: string, payload: any): void;
```

#### Success Criteria

- [ ] All messages strongly typed
- [ ] Request/response works with timeout
- [ ] Message batching reduces traffic
- [ ] Ready state queues messages
- [ ] Unit tests pass

---

### Session 3.2: Migrate Message Handling

**Duration:** ~3-4 hours
**Risk Level:** Medium-High (core functionality)

#### Steps

1. **Create WebviewBridge in KanbanWebviewPanel**
   ```typescript
   private _webviewBridge: WebviewBridge;

   constructor(...) {
       this._webviewBridge = new WebviewBridge(this._eventBus, panel.webview);
   }
   ```

2. **Migrate message handlers incrementally**
   - Start with simple messages (ready, configUpdate)
   - Progress to complex messages (boardUpdate, editColumnTitle)
   - Keep MessageHandler.ts working during migration

3. **Replace postMessage calls**
   - `this._panel.webview.postMessage()` → `this._webviewBridge.send()`

4. **Extract HTML generation**
   - Move `_getHtmlForWebview()` to HtmlGenerator.ts

#### Migration Order (by risk)

1. Low risk: `configUpdate`, `undoRedoState`, `error`
2. Medium risk: `boardUpdate`, `updateColumnContent`, `updateTaskContent`
3. High risk: `saveBoardState`, `editColumnTitle`, `moveTask`

#### Rollback Plan

- Keep MessageHandler.ts intact
- Bridge delegates to MessageHandler for unmigrated messages

---

## Phase 4: FileCoordinator (File Operations)

### Session 4.1: Core FileCoordinator Implementation

**Duration:** ~4-5 hours
**Risk Level:** Low (new component)

#### Files to Create

```
src/core/files/
├── index.ts
├── FileCoordinator.ts      # Main coordinator
├── FileOperationQueue.ts   # Operation serialization
└── ConflictHandler.ts      # Conflict detection & resolution
```

#### Implementation Steps

1. **Create FileOperationQueue.ts**
   - Serialize file operations
   - Prevent race conditions
   - Support operation cancellation

2. **Create ConflictHandler.ts**
   - Detect conflicts (local + external changes)
   - Prompt user for resolution
   - Handle backup creation

3. **Create FileCoordinator.ts**
   - Load/save main file
   - Load/save include files
   - Handle external file changes
   - Coordinate with FileRegistry

#### Key Design

```typescript
class FileCoordinator {
    // Operation queue prevents race conditions
    private async queueOperation(op: () => Promise<void>): Promise<void>;

    // Load with conflict checking
    async loadFile(options: FileLoadOptions): Promise<void>;

    // Save with backup support
    async saveAll(options: FileSaveOptions): Promise<void>;

    // Include file management
    async switchInclude(payload: IncludeSwitchPayload): Promise<void>;
}
```

#### Success Criteria

- [ ] Operations are serialized
- [ ] Conflicts detected correctly
- [ ] External changes handled
- [ ] Include files managed
- [ ] Unit tests pass

---

### Session 4.2: Migrate File Operations

**Duration:** ~4-5 hours
**Risk Level:** High (critical functionality)

#### Steps

1. **Create FileCoordinator in KanbanWebviewPanel**

2. **Migrate file loading**
   - `loadMarkdownFile()` → `FileCoordinator.loadFile()`

3. **Migrate file saving**
   - `saveToMarkdown()` → `FileCoordinator.saveAll()`

4. **Migrate include handling**
   - `updateColumnIncludeFile()` → `FileCoordinator.switchInclude()`

#### Critical Test Scenarios

- [ ] Load file with no includes
- [ ] Load file with column includes
- [ ] Load file with task includes
- [ ] Save with unsaved changes
- [ ] External file change detection
- [ ] Conflict resolution dialog
- [ ] Include switch with unsaved changes

#### Rollback Plan

- Keep original methods as `_legacyLoadMarkdownFile()`, etc.
- FileCoordinator can delegate to legacy methods

---

## Phase 5: EditSession (Undo/Redo & Edit Mode)

### Session 5.1: Core EditSession Implementation

**Duration:** ~2-3 hours
**Risk Level:** Low (new component)

#### Files to Create

```
src/core/session/
├── index.ts
├── EditSession.ts          # Main session manager
└── EditState.ts            # State interfaces
```

#### Implementation Steps

1. **Create EditSession.ts**
   - Track edit mode state
   - Manage checkpoints
   - Coordinate with BoardStore for undo/redo
   - Handle dirty state

#### Key Design

```typescript
class EditSession {
    // Edit mode tracking
    startEdit(target: EditTarget): void;
    completeEdit(value: string): void;
    cancelEdit(): void;

    // Checkpoint management
    saveCheckpoint(description: string): void;

    // Undo/redo delegation to BoardStore
    undo(): void;
    redo(): void;
}
```

---

### Session 5.2: Migrate Edit State

**Duration:** ~2 hours
**Risk Level:** Medium

#### Steps

1. **Create EditSession in KanbanWebviewPanel**

2. **Migrate edit tracking**
   - `_isEditingInProgress` → `EditSession.state.isEditing`

3. **Connect to WebviewBridge**
   - Handle `edit:started`, `edit:completed` messages

---

## Phase 6: KanbanPanelShell (Final Assembly)

### Session 6.1: Create Shell & Wire Components

**Duration:** ~3-4 hours
**Risk Level:** High (major restructure)

#### Steps

1. **Create KanbanPanelShell.ts** (new file)
   - Instantiate all components
   - Wire event handlers
   - Manage lifecycle

2. **Migrate from KanbanWebviewPanel**
   - Move remaining logic to appropriate components
   - Reduce KanbanWebviewPanel to shell

3. **Update extension.ts**
   - Use KanbanPanelShell instead of KanbanWebviewPanel

#### Target Shell Size

```typescript
// ~200 lines total
class KanbanPanelShell {
    // Component instances
    private eventBus: PanelEventBus;
    private boardStore: BoardStore;
    private fileCoordinator: FileCoordinator;
    private webviewBridge: WebviewBridge;
    private editSession: EditSession;

    constructor(...) { /* ~50 lines: create components */ }
    private setupMessageHandlers() { /* ~80 lines: wire handlers */ }
    private setupLifecycle() { /* ~30 lines: VS Code events */ }
    dispose() { /* ~20 lines: cleanup */ }
}
```

---

### Session 6.2: Cleanup & Remove Legacy Code

**Duration:** ~2-3 hours
**Risk Level:** Medium

#### Steps

1. **Remove legacy code from KanbanWebviewPanel**
   - Delete migrated methods
   - Delete migrated properties
   - Rename to KanbanPanelShell if keeping file

2. **Update imports across codebase**

3. **Remove unused dependencies**

4. **Update agent/FUNCTIONS.md**

---

## Phase 7: Testing & Documentation

### Session 7.1: Integration Tests

**Duration:** ~3-4 hours

#### Test Suites to Create

```
src/test/integration/
├── PanelIntegration.test.ts    # Full panel lifecycle
├── FileOperations.test.ts      # Load/save scenarios
├── EditOperations.test.ts      # Edit/undo/redo scenarios
└── ConflictScenarios.test.ts   # Conflict resolution
```

---

### Session 7.2: Documentation Update

**Duration:** ~2 hours

#### Files to Update

- `agent/FUNCTIONS.md` - Update with new components
- `agent/DATASTRUCTURE.md` - Update with new interfaces
- `ARCHITECTURE.md` - Create/update with new architecture

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Regression in file saving | Medium | Critical | Extensive testing, rollback plan |
| Performance degradation | Low | Medium | Benchmark before/after |
| Event ordering issues | Medium | Medium | Correlation IDs, logging |
| Migration takes longer than expected | High | Low | Phases are independent |
| Memory leaks from handlers | Low | Medium | WeakRef support, disposal testing |

---

## Estimated Total Effort

| Phase | Sessions | Hours | Cumulative |
|-------|----------|-------|------------|
| Phase 1: EventBus | 2 | 4-5h | 4-5h |
| Phase 2: BoardStore | 2 | 5-7h | 9-12h |
| Phase 3: WebviewBridge | 2 | 6-8h | 15-20h |
| Phase 4: FileCoordinator | 2 | 8-10h | 23-30h |
| Phase 5: EditSession | 2 | 4-5h | 27-35h |
| Phase 6: Shell | 2 | 5-7h | 32-42h |
| Phase 7: Testing | 2 | 5-6h | 37-48h |

**Total: 14 sessions, 37-48 hours**

---

## Quick Reference: Event Types

```typescript
// Core events to implement
'board:loading' | 'board:loaded' | 'board:updated' | 'board:dirty' | 'board:clean' | 'board:error'
'file:load_requested' | 'file:save_requested' | 'file:saved' | 'file:changed' | 'file:conflict'
'include:loaded' | 'include:saved' | 'include:switch_requested' | 'include:switched'
'edit:started' | 'edit:completed' | 'edit:cancelled'
'undo:requested' | 'redo:requested' | 'undoredo:state_changed'
'webview:ready' | 'webview:message'
'panel:initialized' | 'panel:disposing'
```

---

## Checklist: Before Starting Each Session

- [ ] Read this plan
- [ ] Check current phase status
- [ ] Create git branch for session
- [ ] Review previous session's code
- [ ] Run existing tests to ensure baseline

## Checklist: After Each Session

- [ ] Run all tests
- [ ] Manually test affected functionality
- [ ] Commit with descriptive message
- [ ] Update this plan with progress
- [ ] Note any issues for next session

---

## Progress Tracking

| Phase | Session | Status | Date | Notes |
|-------|---------|--------|------|-------|
| 1.1 | EventBus Core | NOT STARTED | - | - |
| 1.2 | EventBus Integration | NOT STARTED | - | - |
| 2.1 | BoardStore Core | NOT STARTED | - | - |
| 2.2 | BoardStore Migration | NOT STARTED | - | - |
| 3.1 | WebviewBridge Core | NOT STARTED | - | - |
| 3.2 | WebviewBridge Migration | NOT STARTED | - | - |
| 4.1 | FileCoordinator Core | NOT STARTED | - | - |
| 4.2 | FileCoordinator Migration | NOT STARTED | - | - |
| 5.1 | EditSession Core | NOT STARTED | - | - |
| 5.2 | EditSession Migration | NOT STARTED | - | - |
| 6.1 | Shell Assembly | NOT STARTED | - | - |
| 6.2 | Cleanup | NOT STARTED | - | - |
| 7.1 | Integration Tests | NOT STARTED | - | - |
| 7.2 | Documentation | NOT STARTED | - | - |
