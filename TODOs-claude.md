# Event-Driven Architecture Refactoring - Three C3 Implementation Plans

## Overview

Complete replacement of the current messy sync architecture with a clean event-driven system. **All old code will be deleted** - no wrappers, no facades, no backwards compatibility.

---

# CRITICAL ANALYSIS (After AGENT.md Review)

## AGENT.md Rules That Affect Our Plans

1. **NO LAZY REFACTORINGS** - Must copy complete code and verify line-by-line
2. **NO WRAPPERS** - Can't leave old code and add wrappers around it
3. **MUST COMPLETELY FINISH** - Can't stop mid-refactoring
4. **MUST CHECK EXISTING FUNCTIONS** - Before adding new, verify similar doesn't exist
5. **KISS** - Keep code simple
6. **UPDATE agent/FUNCTIONS.md** - After all changes
7. **SINGLE SOURCE OF TRUTH** - Never store same data in multiple places

## Existing Infrastructure Discovered

**SaveEventDispatcher** (`src/SaveEventDispatcher.ts`):
- Already implements handler-based event pattern!
- Handlers registered by ID
- Single dispatcher, multiple handlers
- Currently only for save events

**WatcherCoordinator** (`src/files/WatcherCoordinator.ts`):
- Operation queuing/coordination
- Conflict prevention
- Singleton pattern

**CONCLUSION**: Per AGENT.md rules, we should consider EXTENDING/REFACTORING `SaveEventDispatcher` into a general EventDispatcher rather than creating completely new EventBus system.

---

## Open Questions For Each Plan

### C3-A (Central EventBus)
| Question | Risk | Answer Needed |
|----------|------|---------------|
| Should we extend SaveEventDispatcher or create new? | Medium | Extend to avoid duplication |
| How to handle async vs sync events? | Low | All async with try/catch |
| What happens to ChangeStateMachine dependencies? | High | Need to trace all usages |
| How to preserve undo/redo functionality? | High | BoardStore must continue working |

### C3-B (Domain Channels)
| Question | Risk | Answer Needed |
|----------|------|---------------|
| Does adding 4 channel files violate KISS? | Medium | Possibly too complex |
| How to coordinate cross-channel events? | Medium | Orchestrator adds complexity |
| Why not just use SaveEventDispatcher pattern? | High | No clear benefit over C3-A |

### C3-C (Reactive Streams)
| Question | Risk | Answer Needed |
|----------|------|---------------|
| Is custom RxJS implementation needed? | High | Adds ~200 lines of new code |
| Does debounce/throttle justify complexity? | Medium | Maybe not needed |
| Learning curve for maintenance? | High | Future devs need to understand |

---

## Confidence Assessment

| Plan | Confidence I Can Implement | Why |
|------|---------------------------|-----|
| **C3-A** | 85% | SaveEventDispatcher already proves pattern works, simplest approach |
| **C3-B** | 70% | More files/complexity, but manageable |
| **C3-C** | 60% | Custom Observable implementation is risky, debugging harder |

---

# DEPENDENCY INVESTIGATION RESULTS

## 1. ChangeStateMachine.ts - CRITICAL DEPENDENCY

**Location:** `src/core/ChangeStateMachine.ts:643-647`

```typescript
if (context.impact.includesSwitched) {
    const board = this._webviewPanel.getBoard?.();
    if (board && this._webviewPanel.syncBoardToBackend) {
        this._webviewPanel.syncBoardToBackend(board);
    }
}
```

**Analysis:**
- Called when `includesSwitched` is true (when include file paths change)
- Gets reference to `syncBoardToBackend` via `_webviewPanel` interface
- This is a direct interface dependency - must be migrated

**Migration Impact:**
- Must update `ChangeTypes.ts:40` interface definition
- ChangeStateMachine must either emit event or call new method
- CRITICAL: This handles the include file switching scenario

---

## 2. BoardStore.ts - INDEPENDENT (Safe)

**Location:** `src/core/stores/BoardStore.ts`

**Analysis:**
- Manages `undoStack` and `redoStack` for undo/redo
- Manages `dirtyColumns` and `dirtyTasks` for change tracking
- Has `setBoard()`, `undo()`, `redo()`, `canUndo()`, `canRedo()`
- **Does NOT call syncBoardToBackend directly**
- UICommands.ts calls both `boardStore.undo()` AND `syncBoardToBackend()` separately

**Migration Impact:** NONE - BoardStore is independent

---

## 3. BackupManager.ts - INDEPENDENT (Safe)

**Location:** `src/services/BackupManager.ts`

**Analysis:**
- Creates backup files based on document content
- Methods: `createBackup(document)`, `createFileBackup(filePath, content)`
- Triggered by timer (periodic backup) and explicit calls
- **Does NOT call or depend on syncBoardToBackend**

**Migration Impact:** NONE - BackupManager is independent

---

## 4. MessageHandler/CommandContext - PASSTHROUGH DEPENDENCY

**Location:** `src/messageHandler.ts:32, 57, 74, 102`

```typescript
// Line 32: Stores reference
private _syncBoardToBackend: (board: KanbanBoard) => void;

// Line 57: Receives in callbacks
syncBoardToBackend: (board: KanbanBoard) => void;

// Line 74: Stores from constructor
this._syncBoardToBackend = callbacks.syncBoardToBackend;

// Line 102: Passes to command context
syncBoardToBackend: this._syncBoardToBackend,
```

**Analysis:**
- MessageHandler receives `syncBoardToBackend` as callback from KanbanWebviewPanel
- Passes it through to CommandContext for all commands
- All commands access it via `context.syncBoardToBackend(board)`

**Migration Impact:**
- Must update `MessageCommand.ts:50` interface
- Can replace with `context.emitBoardChanged(board)` or similar
- All 10 command call sites go through this context

---

## 5. Command Call Pattern

**All 10 call sites follow identical pattern:**

```typescript
// Current pattern in all commands:
context.syncBoardToBackend(board);
await context.onBoardUpdate();  // Optional: sends to frontend
```

**Key insight:** `onBoardUpdate` is bound to `sendBoardUpdate()` at line 410:
```typescript
onBoardUpdate: this.sendBoardUpdate.bind(this),
```

**Two separate concerns:**
1. `syncBoardToBackend` → Persist board state to files
2. `onBoardUpdate` → Send current board to frontend webview

---

## COMPLETE CALL SITE ANALYSIS

| # | File | Line | Current Call | After Migration |
|---|------|------|--------------|-----------------|
| 1 | `kanbanWebviewPanel.ts` | 422 | Definition passed to MessageHandler | Define `emitBoardChanged()` instead |
| 2 | `MessageCommand.ts` | 308 | `context.syncBoardToBackend(currentBoard)` | `eventBus.emit('board:changed', ...)` |
| 3 | `UICommands.ts` | 95 | undo → `context.syncBoardToBackend(previousBoard)` | `eventBus.emit('board:changed', ...)` |
| 4 | `UICommands.ts` | 123 | redo → `context.syncBoardToBackend(nextBoard)` | `eventBus.emit('board:changed', ...)` |
| 5 | `EditModeCommands.ts` | 158 | exit edit with cache | `eventBus.emit('board:changed', ...)` |
| 6 | `EditModeCommands.ts` | 206 | exit edit without cache | `eventBus.emit('board:changed', ...)` |
| 7 | `TemplateCommands.ts` | 245 | template applied | `eventBus.emit('board:changed', ...)` |
| 8 | `TemplateCommands.ts` | 353 | template applied | `eventBus.emit('board:changed', ...)` |
| 9 | `ChangeStateMachine.ts` | 644 | includes switched | `eventBus.emit('board:changed', ...)` |
| 10 | `messageHandler.ts` | 324 | fallback sync | `eventBus.emit('board:changed', ...)` |

---

## DEPENDENCY SAFETY SUMMARY

| Component | Depends on syncBoardToBackend? | Migration Risk |
|-----------|-------------------------------|----------------|
| ChangeStateMachine | **YES** - interface | HIGH - must update interface |
| BoardStore | NO | NONE |
| BackupManager | NO | NONE |
| MessageHandler | YES - passthrough | MEDIUM - update callback |
| CommandContext | YES - provides to commands | MEDIUM - update interface |
| All 10 call sites | YES - call it | LOW - find/replace pattern |

---

## RECOMMENDATION FOR PLAN C3-A

Based on dependency analysis, C3-A (Central EventBus) is still the best choice:

1. **SaveEventDispatcher exists** - Can extend the pattern
2. **Only 2 interfaces need updating** - ChangeTypes.ts and MessageCommand.ts
3. **BoardStore is independent** - No risk to undo/redo
4. **BackupManager is independent** - No risk to backups
5. **All call sites follow same pattern** - Easy migration

**Risk Mitigation:**
- ChangeStateMachine is the critical dependency
- Must test include switching thoroughly after migration
- All other call sites are straightforward replacements

---

## Current State: What Must Be Deleted

### Functions to DELETE (9 total)

| File | Function | Lines | Why Delete |
|------|----------|-------|------------|
| `kanbanWebviewPanel.ts` | `_syncMainFileToRegistry()` | ~100 | Replace with `FileStateManager.initialize()` |
| `kanbanWebviewPanel.ts` | `syncBoardToBackend()` | ~50 | Replace with `board:changed` event |
| `kanbanWebviewPanel.ts` | `_checkIncludeFilesForExternalChanges()` | ~60 | Replace with `focus:gained` event |
| `kanbanWebviewPanel.ts` | `_checkMediaFilesForChanges()` | ~25 | Replace with `focus:gained` event |
| `kanbanWebviewPanel.ts` | `_updateMediaTrackingFromIncludes()` | ~25 | Replace with `file:content-changed` event |
| `IncludeFileCoordinator.ts` | `syncIncludeFilesWithRegistry()` | ~55 | Replace with `FileStateManager._registerIncludeFiles()` |
| `IncludeFileCoordinator.ts` | `_updateIncludeFilesContent()` | ~30 | Merge into `FileStateManager._updateAllIncludeContent()` |
| `MarkdownFileRegistry.ts` | `trackIncludeFileUnsavedChanges()` | ~65 | Merge into `FileStateManager._updateAllIncludeContent()` |

### Call Sites to Migrate (10 total)

| # | Location | Current Call | New Pattern |
|---|----------|--------------|-------------|
| 1 | `kanbanWebviewPanel.ts:422` | `syncBoardToBackend(board)` | `emit('board:changed', { board })` |
| 2 | `MessageCommand.ts:308` | `context.syncBoardToBackend(currentBoard)` | `emit('board:changed', { board })` |
| 3 | `UICommands.ts:95` | `context.syncBoardToBackend(previousBoard)` | `emit('board:changed', { board })` |
| 4 | `UICommands.ts:123` | `context.syncBoardToBackend(nextBoard)` | `emit('board:changed', { board })` |
| 5 | `EditModeCommands.ts:158` | `context.syncBoardToBackend(message.cachedBoard)` | `emit('board:changed', { board })` |
| 6 | `EditModeCommands.ts:206` | `context.syncBoardToBackend(board)` | `emit('board:changed', { board })` |
| 7 | `TemplateCommands.ts:245` | `context.syncBoardToBackend(currentBoard)` | `emit('board:changed', { board })` |
| 8 | `TemplateCommands.ts:353` | `context.syncBoardToBackend(currentBoard)` | `emit('board:changed', { board })` |
| 9 | `ChangeStateMachine.ts:644` | `this._webviewPanel.syncBoardToBackend(board)` | `emit('board:changed', { board })` |
| 10 | `messageHandler.ts:324` | `this._syncBoardToBackend(board)` | `emit('board:changed', { board })` |

---

# PLAN C3-A: Central EventBus Architecture

## Quality Rating: ⭐⭐⭐⭐ (4/5)
## Effort: 5-6 days
## Complexity: Medium
## Best For: Projects that want simplicity with good decoupling

### Concept

Single global `EventBus` that all components use. Simple pub/sub pattern. Components emit events and subscribe to events they care about.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SINGLE EventBus                                  │
│                                                                          │
│  Events: board:changed, board:loaded, file:content-changed,             │
│          file:external-change, file:saved, media:changed,               │
│          include:loaded, focus:gained, error:occurred                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│  FileStateManager │     │ MediaStateManager │     │ KanbanWebviewPanel│
│  (file operations)│     │ (media tracking)  │     │ (UI coordination) │
└───────────────────┘     └───────────────────┘     └───────────────────┘
```

### New File Structure

```
src/
├── core/
│   ├── events/
│   │   ├── EventBus.ts              # NEW: Central event bus
│   │   └── EventTypes.ts            # NEW: All event type definitions
│   ├── FileStateManager.ts          # NEW: Owns all file state
│   ├── MediaStateManager.ts         # NEW: Owns media tracking
│   └── BoardStateManager.ts         # NEW: Owns board state (extracted from BoardStore)
├── panel/
│   └── IncludeFileCoordinator.ts    # MODIFIED: Only parsing/formatting, no state
└── kanbanWebviewPanel.ts            # MODIFIED: UI coordination only
```

### Implementation Steps

#### Step 1: Create EventBus (Day 1 - 4 hours)

```typescript
// src/core/events/EventTypes.ts
export type EventType =
    | 'board:changed'           // Board state changed (from UI edit)
    | 'board:loaded'            // Board initially loaded from file
    | 'board:invalidated'       // Board cache needs refresh
    | 'file:content-changed'    // File content updated in memory
    | 'file:external-change'    // File changed on disk externally
    | 'file:saved'              // File saved to disk
    | 'media:changed'           // Media file (image/diagram) changed
    | 'media:tracking-updated'  // Media tracking list updated
    | 'include:registered'      // Include file added to registry
    | 'include:loaded'          // Include file content loaded from disk
    | 'include:content-updated' // Include file content changed
    | 'focus:gained'            // Panel gained focus
    | 'focus:lost'              // Panel lost focus
    | 'error:occurred';         // Error occurred in any component

export interface BaseEvent {
    type: EventType;
    source: string;
    timestamp: number;
}

export interface BoardChangedEvent extends BaseEvent {
    type: 'board:changed';
    data: { board: KanbanBoard; trigger: 'edit' | 'undo' | 'redo' | 'template' | 'sort' };
}

export interface FileExternalChangeEvent extends BaseEvent {
    type: 'file:external-change';
    data: { changedFiles: Array<{ path: string; type: 'main' | 'include' }> };
}

export interface MediaChangedEvent extends BaseEvent {
    type: 'media:changed';
    data: { changedFiles: Array<{ path: string; absolutePath: string; type: string }> };
}

// ... more event interfaces

export type AppEvent = BoardChangedEvent | FileExternalChangeEvent | MediaChangedEvent | /* ... */;
```

```typescript
// src/core/events/EventBus.ts
export class EventBus {
    private _listeners = new Map<EventType, Set<(event: AppEvent) => void>>();
    private _eventLog: AppEvent[] = [];
    private _maxLogSize = 100;

    on<T extends AppEvent>(type: T['type'], handler: (event: T) => void): () => void {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }
        this._listeners.get(type)!.add(handler as any);
        return () => this._listeners.get(type)?.delete(handler as any);
    }

    emit<T extends AppEvent>(event: T): void {
        // Log for debugging
        this._eventLog.push(event);
        if (this._eventLog.length > this._maxLogSize) {
            this._eventLog.shift();
        }
        console.log(`[EventBus] ${event.type} from ${event.source}`, event);

        // Notify listeners
        const handlers = this._listeners.get(event.type);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(event);
                } catch (error) {
                    this.emit({
                        type: 'error:occurred',
                        source: 'EventBus',
                        timestamp: Date.now(),
                        data: { error, originalEvent: event }
                    } as any);
                }
            }
        }
    }

    // Debug helpers
    getEventLog(): AppEvent[] { return [...this._eventLog]; }
    clearLog(): void { this._eventLog = []; }
}

// Singleton instance
export const eventBus = new EventBus();
```

#### Step 2: Create FileStateManager (Day 1-2 - 8 hours)

```typescript
// src/core/FileStateManager.ts
import { eventBus } from './events/EventBus';

export class FileStateManager {
    private _mainFile: MainKanbanFile | null = null;
    private _includeFiles = new Map<string, IncludeFile>();
    private _registry: MarkdownFileRegistry;
    private _subscriptions: (() => void)[] = [];

    constructor(registry: MarkdownFileRegistry) {
        this._registry = registry;
        this._setupEventListeners();
    }

    private _setupEventListeners(): void {
        // When board changes, persist to files
        this._subscriptions.push(
            eventBus.on('board:changed', async (event) => {
                await this._persistBoardToFiles(event.data.board);
            })
        );

        // When focus gained, check for external changes
        this._subscriptions.push(
            eventBus.on('focus:gained', async () => {
                await this._checkForExternalChanges();
            })
        );
    }

    // === PUBLIC API ===

    async initialize(document: vscode.TextDocument): Promise<KanbanBoard> {
        // 1. Create/load main file
        this._mainFile = await this._initializeMainFile(document);

        // 2. Parse initial board
        const board = this._mainFile.getBoard();
        if (!board || !board.valid) {
            throw new Error('Failed to parse kanban board');
        }

        // 3. Register all include files
        await this._registerAllIncludes(board);

        // 4. Load all include content from disk
        await this._loadAllIncludeContent();

        // 5. Emit board loaded event
        eventBus.emit({
            type: 'board:loaded',
            source: 'FileStateManager',
            timestamp: Date.now(),
            data: { board }
        });

        return board;
    }

    dispose(): void {
        this._subscriptions.forEach(unsub => unsub());
        this._subscriptions = [];
        this._includeFiles.clear();
        this._mainFile = null;
    }

    // === PRIVATE: Board → Files ===

    private async _persistBoardToFiles(board: KanbanBoard): Promise<void> {
        if (!this._mainFile) return;

        // 1. Update ALL include files (column, task, AND regular)
        await this._updateAllIncludeContent(board);

        // 2. Generate markdown from board
        const markdown = MarkdownKanbanParser.generateMarkdown(board);

        // 3. Update main file in-memory
        this._mainFile.setContent(markdown, false);

        // 4. Emit content changed event (for MediaStateManager to react)
        eventBus.emit({
            type: 'file:content-changed',
            source: 'FileStateManager',
            timestamp: Date.now(),
            data: {
                mainFileContent: markdown,
                includeFiles: Array.from(this._includeFiles.values()).map(f => ({
                    path: f.getPath(),
                    content: f.getContent()
                }))
            }
        });
    }

    private async _updateAllIncludeContent(board: KanbanBoard): Promise<void> {
        // Column includes
        for (const column of board.columns) {
            if (column.includeFiles?.length) {
                for (const path of column.includeFiles) {
                    const file = this._includeFiles.get(this._normalizePath(path));
                    if (file) {
                        const content = file.generateFromTasks(column.tasks);
                        if (content.trim() || !file.getContent()?.trim()) {
                            file.setContent(content, false);
                        }
                    }
                }
            }
        }

        // Task includes
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles?.length) {
                    for (const path of task.includeFiles) {
                        const file = this._includeFiles.get(this._normalizePath(path));
                        if (file) {
                            const content = task.description || '';
                            if (content.trim() || !file.getContent()?.trim()) {
                                file.setContent(content, false);
                            }
                        }
                    }
                }
            }
        }

        // Regular includes - ensure loaded (THIS FIXES THE BUG!)
        for (const [path, file] of this._includeFiles) {
            if (file.getFileType() === 'include-regular') {
                if (!file.getContent()) {
                    await file.forceSyncBaseline();
                }
            }
        }
    }

    // === PRIVATE: External Change Detection ===

    private async _checkForExternalChanges(): Promise<void> {
        const changedFiles: Array<{ path: string; type: 'main' | 'include' }> = [];

        // Check main file
        if (this._mainFile) {
            const mainChanged = await this._mainFile.checkForExternalChanges();
            if (mainChanged) {
                await this._mainFile.forceSyncBaseline();
                changedFiles.push({ path: this._mainFile.getPath(), type: 'main' });
            }
        }

        // Check all include files
        for (const [path, file] of this._includeFiles) {
            const changed = await file.checkForExternalChanges();
            if (changed) {
                await file.forceSyncBaseline();
                changedFiles.push({ path, type: 'include' });
            }
        }

        if (changedFiles.length > 0) {
            eventBus.emit({
                type: 'file:external-change',
                source: 'FileStateManager',
                timestamp: Date.now(),
                data: { changedFiles }
            });
        }
    }

    // ... helper methods
}
```

#### Step 3: Create MediaStateManager (Day 2 - 4 hours)

```typescript
// src/core/MediaStateManager.ts
import { eventBus } from './events/EventBus';

export class MediaStateManager {
    private _tracker: MediaTracker | null = null;
    private _subscriptions: (() => void)[] = [];

    constructor() {
        this._setupEventListeners();
    }

    private _setupEventListeners(): void {
        // Scan content when files change
        this._subscriptions.push(
            eventBus.on('file:content-changed', (event) => {
                this._updateTracking(event.data.mainFileContent, event.data.includeFiles);
            })
        );

        // Check for media changes on focus
        this._subscriptions.push(
            eventBus.on('focus:gained', () => {
                this._checkForChanges();
            })
        );

        // Initial setup when board loads
        this._subscriptions.push(
            eventBus.on('board:loaded', (event) => {
                // MediaTracker is created per-board, so we might need to initialize here
            })
        );
    }

    initialize(kanbanFilePath: string): void {
        this._tracker?.dispose();
        this._tracker = new MediaTracker(kanbanFilePath);

        // Set up callback for real-time changes (file watchers)
        this._tracker.setOnMediaChanged((changedFiles) => {
            eventBus.emit({
                type: 'media:changed',
                source: 'MediaStateManager',
                timestamp: Date.now(),
                data: { changedFiles }
            });
        });
    }

    private _updateTracking(mainContent: string, includeFiles: Array<{ path: string; content: string }>): void {
        if (!this._tracker) return;

        // Track from main file
        this._tracker.updateTrackedFiles(mainContent);

        // Track from all includes
        for (const file of includeFiles) {
            if (file.content) {
                this._tracker.addTrackedFiles(file.content);
            }
        }

        // Set up file watchers
        this._tracker.setupFileWatchers();

        eventBus.emit({
            type: 'media:tracking-updated',
            source: 'MediaStateManager',
            timestamp: Date.now(),
            data: { trackedCount: this._tracker.getTrackedFiles().length }
        });
    }

    private _checkForChanges(): void {
        if (!this._tracker) return;

        // This internally triggers the callback if files changed
        this._tracker.checkForChanges();
    }

    dispose(): void {
        this._subscriptions.forEach(unsub => unsub());
        this._tracker?.dispose();
    }
}
```

#### Step 4: Update KanbanWebviewPanel (Day 3 - 6 hours)

```typescript
// src/kanbanWebviewPanel.ts - SIMPLIFIED
export class KanbanWebviewPanel {
    private _fileStateManager: FileStateManager;
    private _mediaStateManager: MediaStateManager;
    private _subscriptions: (() => void)[] = [];

    constructor(/* ... */) {
        // Create managers
        this._fileStateManager = new FileStateManager(this._fileRegistry);
        this._mediaStateManager = new MediaStateManager();

        this._setupEventListeners();
    }

    private _setupEventListeners(): void {
        // React to external file changes - update UI
        this._subscriptions.push(
            eventBus.on('file:external-change', () => {
                this._boardStore.invalidateCache();
                this.sendBoardUpdate(false, true);
            })
        );

        // React to media changes - notify frontend
        this._subscriptions.push(
            eventBus.on('media:changed', (event) => {
                this._panel?.webview.postMessage({
                    type: 'mediaFilesChanged',
                    changedFiles: event.data.changedFiles
                });
            })
        );
    }

    // Called when loading a file
    async loadMarkdownFile(document: vscode.TextDocument): Promise<void> {
        const board = await this._fileStateManager.initialize(document);
        this._mediaStateManager.initialize(document.uri.fsPath);
        this._boardStore.setBoard(board, false);
        this.sendBoardUpdate(false, false);
    }

    // Called when panel gains focus - SIMPLIFIED!
    private _handleFocus(): void {
        eventBus.emit({
            type: 'focus:gained',
            source: 'KanbanWebviewPanel',
            timestamp: Date.now()
        });
    }

    // Called from commands/message handlers
    public onBoardChanged(board: KanbanBoard, trigger: string): void {
        this._boardStore.setBoard(board, false);
        eventBus.emit({
            type: 'board:changed',
            source: 'KanbanWebviewPanel',
            timestamp: Date.now(),
            data: { board, trigger }
        });
    }
}
```

#### Step 5: Migrate All Call Sites (Day 4 - 4 hours)

Replace all 10 call sites:

```typescript
// BEFORE (all 10 locations):
context.syncBoardToBackend(board);

// AFTER (all 10 locations):
eventBus.emit({
    type: 'board:changed',
    source: 'CommandName',  // Different per location
    timestamp: Date.now(),
    data: { board, trigger: 'edit' }  // trigger varies
});

// OR use helper method on panel:
context.onBoardChanged(board, 'edit');
```

#### Step 6: Delete Old Code (Day 5 - 4 hours)

1. Delete `_syncMainFileToRegistry()` from `kanbanWebviewPanel.ts`
2. Delete `syncBoardToBackend()` from `kanbanWebviewPanel.ts`
3. Delete `_checkIncludeFilesForExternalChanges()` from `kanbanWebviewPanel.ts`
4. Delete `_checkMediaFilesForChanges()` from `kanbanWebviewPanel.ts`
5. Delete `_updateMediaTrackingFromIncludes()` from `kanbanWebviewPanel.ts`
6. Delete `syncIncludeFilesWithRegistry()` from `IncludeFileCoordinator.ts`
7. Delete `_updateIncludeFilesContent()` from `IncludeFileCoordinator.ts`
8. Delete `trackIncludeFileUnsavedChanges()` from `MarkdownFileRegistry.ts`

#### Step 7: Testing (Day 5-6 - 8 hours)

- Test initial load
- Test editing tasks
- Test undo/redo
- Test template drops
- Test focus/blur cycles
- Test external file changes
- Test media file changes
- Test include file changes

### Pros
- Simple pub/sub pattern - easy to understand
- Single event bus - one place to debug
- Good decoupling
- Moderate complexity

### Cons
- All events share one bus - could get noisy
- Less type safety than domain-specific channels
- Global singleton (testability concerns)

---

# PLAN C3-B: Domain-Driven Event Channels

## Quality Rating: ⭐⭐⭐⭐½ (4.5/5)
## Effort: 6-7 days
## Complexity: Medium-High
## Best For: Large projects with multiple developers

### Concept

Instead of one EventBus, create **separate event channels** for each domain. Each channel is strongly typed and focused on one concern.

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  BoardChannel   │  │   FileChannel   │  │  MediaChannel   │
│                 │  │                 │  │                 │
│ board:changed   │  │ file:loaded     │  │ media:changed   │
│ board:loaded    │  │ file:saved      │  │ media:tracked   │
│ board:invalid   │  │ file:external   │  │                 │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Orchestrator   │
                    │  (coordinates)  │
                    └─────────────────┘
```

### New File Structure

```
src/
├── core/
│   ├── channels/
│   │   ├── BoardChannel.ts          # Board-specific events
│   │   ├── FileChannel.ts           # File-specific events
│   │   ├── MediaChannel.ts          # Media-specific events
│   │   ├── UIChannel.ts             # UI-specific events (focus, etc)
│   │   └── index.ts                 # Export all channels
│   ├── managers/
│   │   ├── FileStateManager.ts      # Subscribes to BoardChannel, emits to FileChannel
│   │   ├── MediaStateManager.ts     # Subscribes to FileChannel, emits to MediaChannel
│   │   └── Orchestrator.ts          # Coordinates cross-channel communication
│   └── types/
│       └── Events.ts                # All event type definitions
```

### Implementation Steps

#### Step 1: Create Typed Event Channels (Day 1 - 6 hours)

```typescript
// src/core/channels/Channel.ts
export class TypedChannel<TEvents extends Record<string, any>> {
    private _name: string;
    private _listeners = new Map<keyof TEvents, Set<(data: any) => void>>();

    constructor(name: string) {
        this._name = name;
    }

    on<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): () => void {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event)!.add(handler);
        return () => this._listeners.get(event)?.delete(handler);
    }

    emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
        console.log(`[${this._name}] ${String(event)}`, data);
        const handlers = this._listeners.get(event);
        handlers?.forEach(h => h(data));
    }
}
```

```typescript
// src/core/channels/BoardChannel.ts
interface BoardEvents {
    'changed': { board: KanbanBoard; trigger: 'edit' | 'undo' | 'redo' | 'template' | 'sort' };
    'loaded': { board: KanbanBoard };
    'invalidated': { reason: string };
    'saved': { board: KanbanBoard };
}

export const boardChannel = new TypedChannel<BoardEvents>('Board');
```

```typescript
// src/core/channels/FileChannel.ts
interface FileEvents {
    'main:loaded': { file: MainKanbanFile; content: string };
    'main:content-changed': { content: string };
    'main:external-change': { newContent: string };
    'include:registered': { path: string; type: 'column' | 'task' | 'regular' };
    'include:loaded': { path: string; content: string };
    'include:content-changed': { path: string; content: string };
    'include:external-change': { path: string; newContent: string };
    'all-includes:loaded': { files: Array<{ path: string; content: string }> };
}

export const fileChannel = new TypedChannel<FileEvents>('File');
```

```typescript
// src/core/channels/MediaChannel.ts
interface MediaEvents {
    'tracking:updated': { trackedFiles: MediaFileInfo[] };
    'files:changed': { changedFiles: ChangedMediaFile[] };
    'watcher:setup': { count: number };
}

export const mediaChannel = new TypedChannel<MediaEvents>('Media');
```

```typescript
// src/core/channels/UIChannel.ts
interface UIEvents {
    'focus:gained': {};
    'focus:lost': {};
    'webview:ready': {};
    'webview:destroyed': {};
}

export const uiChannel = new TypedChannel<UIEvents>('UI');
```

#### Step 2: Create Orchestrator (Day 2 - 4 hours)

```typescript
// src/core/managers/Orchestrator.ts
import { boardChannel, fileChannel, mediaChannel, uiChannel } from '../channels';

export class Orchestrator {
    private _subscriptions: (() => void)[] = [];

    constructor() {
        this._setupCrossChannelCommunication();
    }

    private _setupCrossChannelCommunication(): void {
        // When board changes → file needs to persist
        this._subscriptions.push(
            boardChannel.on('changed', (data) => {
                // FileStateManager listens to this directly
            })
        );

        // When file content changes → media needs to scan
        this._subscriptions.push(
            fileChannel.on('main:content-changed', (data) => {
                // MediaStateManager listens to this directly
            })
        );

        // When external file change detected → board needs invalidation
        this._subscriptions.push(
            fileChannel.on('main:external-change', () => {
                boardChannel.emit('invalidated', { reason: 'External file change' });
            })
        );

        // When focus gained → check for external changes
        this._subscriptions.push(
            uiChannel.on('focus:gained', () => {
                // FileStateManager and MediaStateManager listen directly
            })
        );
    }

    dispose(): void {
        this._subscriptions.forEach(unsub => unsub());
    }
}
```

#### Step 3: Update Managers to Use Channels (Day 3-4 - 8 hours)

```typescript
// src/core/managers/FileStateManager.ts
import { boardChannel, fileChannel, uiChannel } from '../channels';

export class FileStateManager {
    private _subscriptions: (() => void)[] = [];

    constructor() {
        this._setupSubscriptions();
    }

    private _setupSubscriptions(): void {
        // React to board changes
        this._subscriptions.push(
            boardChannel.on('changed', async ({ board }) => {
                await this._persistBoardToFiles(board);
            })
        );

        // React to focus
        this._subscriptions.push(
            uiChannel.on('focus:gained', async () => {
                await this._checkForExternalChanges();
            })
        );
    }

    private async _persistBoardToFiles(board: KanbanBoard): Promise<void> {
        // ... update files ...

        // Emit to file channel
        fileChannel.emit('main:content-changed', { content: markdown });

        for (const [path, content] of updatedIncludes) {
            fileChannel.emit('include:content-changed', { path, content });
        }
    }
}
```

#### Step 4-7: Same as C3-A (migrate call sites, delete old code, test)

### Pros
- **Strong typing** per channel - better IDE support
- **Separation of concerns** - each channel is focused
- **Easier debugging** - filter by channel
- **Better for teams** - clear ownership of channels

### Cons
- More files to create
- Cross-channel coordination needed
- Slightly more complex than single bus

---

# PLAN C3-C: Reactive Streams (RxJS-style)

## Quality Rating: ⭐⭐⭐⭐⭐ (5/5)
## Effort: 7-8 days
## Complexity: High
## Best For: Complex async flows, need for debounce/throttle/merge

### Concept

Use **Observable streams** instead of simple events. Each stream can be transformed, combined, debounced, etc. Gives maximum control over async flows.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Reactive Streams                               │
│                                                                          │
│  boardChanges$ ──┬──► debounce(300ms) ──► persistToFiles$               │
│                  │                                                       │
│  focusEvents$ ───┴──► throttle(1000ms) ──► checkExternalChanges$        │
│                                                                          │
│  fileChanges$ ──────► merge(mainFile$, includes$) ──► updateMedia$      │
│                                                                          │
│  mediaChanges$ ─────► distinctUntilChanged() ──► notifyFrontend$        │
└─────────────────────────────────────────────────────────────────────────┘
```

### New File Structure

```
src/
├── core/
│   ├── streams/
│   │   ├── Observable.ts            # Minimal RxJS-like implementation
│   │   ├── operators.ts             # map, filter, debounce, throttle, merge
│   │   ├── BoardStreams.ts          # Board-related streams
│   │   ├── FileStreams.ts           # File-related streams
│   │   ├── MediaStreams.ts          # Media-related streams
│   │   └── UIStreams.ts             # UI-related streams
│   ├── managers/
│   │   ├── FileStateManager.ts      # Subscribes to streams
│   │   ├── MediaStateManager.ts     # Subscribes to streams
│   │   └── StreamCoordinator.ts     # Wires streams together
```

### Implementation Steps

#### Step 1: Create Minimal Observable Implementation (Day 1 - 6 hours)

```typescript
// src/core/streams/Observable.ts
export type Observer<T> = (value: T) => void;
export type Unsubscribe = () => void;

export class Observable<T> {
    private _subscribers = new Set<Observer<T>>();

    subscribe(observer: Observer<T>): Unsubscribe {
        this._subscribers.add(observer);
        return () => this._subscribers.delete(observer);
    }

    next(value: T): void {
        this._subscribers.forEach(observer => observer(value));
    }

    // Operators return new Observables
    pipe<R>(...operators: Array<(source: Observable<any>) => Observable<any>>): Observable<R> {
        return operators.reduce((acc, op) => op(acc), this as any) as Observable<R>;
    }
}

export class Subject<T> extends Observable<T> {
    emit(value: T): void {
        this.next(value);
    }
}

export class BehaviorSubject<T> extends Subject<T> {
    constructor(private _value: T) {
        super();
    }

    get value(): T { return this._value; }

    next(value: T): void {
        this._value = value;
        super.next(value);
    }
}
```

```typescript
// src/core/streams/operators.ts
export function map<T, R>(fn: (value: T) => R) {
    return (source: Observable<T>): Observable<R> => {
        const result = new Observable<R>();
        source.subscribe(value => result.next(fn(value)));
        return result;
    };
}

export function filter<T>(predicate: (value: T) => boolean) {
    return (source: Observable<T>): Observable<T> => {
        const result = new Observable<T>();
        source.subscribe(value => {
            if (predicate(value)) result.next(value);
        });
        return result;
    };
}

export function debounce<T>(ms: number) {
    return (source: Observable<T>): Observable<T> => {
        const result = new Observable<T>();
        let timeout: NodeJS.Timeout | null = null;
        source.subscribe(value => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => result.next(value), ms);
        });
        return result;
    };
}

export function throttle<T>(ms: number) {
    return (source: Observable<T>): Observable<T> => {
        const result = new Observable<T>();
        let lastEmit = 0;
        source.subscribe(value => {
            const now = Date.now();
            if (now - lastEmit >= ms) {
                lastEmit = now;
                result.next(value);
            }
        });
        return result;
    };
}

export function merge<T>(...sources: Observable<T>[]): Observable<T> {
    const result = new Observable<T>();
    sources.forEach(source => source.subscribe(value => result.next(value)));
    return result;
}

export function distinctUntilChanged<T>(compare?: (a: T, b: T) => boolean) {
    return (source: Observable<T>): Observable<T> => {
        const result = new Observable<T>();
        let last: T | undefined;
        let hasLast = false;
        const eq = compare || ((a, b) => a === b);
        source.subscribe(value => {
            if (!hasLast || !eq(last!, value)) {
                hasLast = true;
                last = value;
                result.next(value);
            }
        });
        return result;
    };
}
```

#### Step 2: Create Domain Streams (Day 2 - 4 hours)

```typescript
// src/core/streams/BoardStreams.ts
import { Subject, BehaviorSubject } from './Observable';

export interface BoardChange {
    board: KanbanBoard;
    trigger: 'edit' | 'undo' | 'redo' | 'template' | 'sort';
    timestamp: number;
}

export const boardChanges$ = new Subject<BoardChange>();
export const currentBoard$ = new BehaviorSubject<KanbanBoard | null>(null);
export const boardInvalidated$ = new Subject<{ reason: string }>();
```

```typescript
// src/core/streams/FileStreams.ts
export interface FileChange {
    path: string;
    content: string;
    type: 'main' | 'include';
    timestamp: number;
}

export interface ExternalChange {
    path: string;
    type: 'main' | 'include';
    newContent: string;
}

export const fileContentChanged$ = new Subject<FileChange>();
export const externalFileChanges$ = new Subject<ExternalChange>();
export const allIncludesLoaded$ = new Subject<{ files: Map<string, string> }>();
```

```typescript
// src/core/streams/MediaStreams.ts
export interface MediaChange {
    changedFiles: Array<{ path: string; absolutePath: string; type: string }>;
}

export const mediaFilesChanged$ = new Subject<MediaChange>();
export const mediaTrackingUpdated$ = new Subject<{ count: number }>();
```

```typescript
// src/core/streams/UIStreams.ts
export const focusGained$ = new Subject<void>();
export const focusLost$ = new Subject<void>();
export const webviewReady$ = new Subject<void>();
```

#### Step 3: Create Stream Coordinator (Day 3 - 6 hours)

```typescript
// src/core/managers/StreamCoordinator.ts
import { boardChanges$, boardInvalidated$ } from '../streams/BoardStreams';
import { fileContentChanged$, externalFileChanges$ } from '../streams/FileStreams';
import { mediaFilesChanged$ } from '../streams/MediaStreams';
import { focusGained$ } from '../streams/UIStreams';
import { debounce, throttle, merge, map, filter } from '../streams/operators';

export class StreamCoordinator {
    private _subscriptions: (() => void)[] = [];
    private _fileStateManager: FileStateManager;
    private _mediaStateManager: MediaStateManager;

    constructor(
        fileStateManager: FileStateManager,
        mediaStateManager: MediaStateManager
    ) {
        this._fileStateManager = fileStateManager;
        this._mediaStateManager = mediaStateManager;
        this._setupStreamPipelines();
    }

    private _setupStreamPipelines(): void {
        // Board changes → debounced file persistence
        // Prevents rapid-fire updates during fast typing
        const debouncedBoardChanges$ = boardChanges$.pipe(
            debounce(100)  // Wait 100ms after last change
        );

        this._subscriptions.push(
            debouncedBoardChanges$.subscribe(async ({ board }) => {
                await this._fileStateManager.persistBoardToFiles(board);
            })
        );

        // Focus events → throttled external change check
        // Prevents checking too frequently
        const throttledFocus$ = focusGained$.pipe(
            throttle(1000)  // Max once per second
        );

        this._subscriptions.push(
            throttledFocus$.subscribe(async () => {
                await this._fileStateManager.checkForExternalChanges();
                this._mediaStateManager.checkForChanges();
            })
        );

        // File content changes → media tracking update
        this._subscriptions.push(
            fileContentChanged$.subscribe(({ content, path, type }) => {
                this._mediaStateManager.updateTracking(content);
            })
        );

        // External changes → board invalidation
        this._subscriptions.push(
            externalFileChanges$.pipe(
                filter(change => change.type === 'main')
            ).subscribe(() => {
                boardInvalidated$.next({ reason: 'External file change' });
            })
        );

        // Media changes → notify frontend (already distinct)
        this._subscriptions.push(
            mediaFilesChanged$.pipe(
                distinctUntilChanged((a, b) =>
                    JSON.stringify(a.changedFiles) === JSON.stringify(b.changedFiles)
                )
            ).subscribe(({ changedFiles }) => {
                // Notify frontend
            })
        );
    }

    dispose(): void {
        this._subscriptions.forEach(unsub => unsub());
    }
}
```

#### Step 4: Update FileStateManager (Day 4 - 4 hours)

```typescript
// src/core/managers/FileStateManager.ts
import { fileContentChanged$, externalFileChanges$, allIncludesLoaded$ } from '../streams/FileStreams';

export class FileStateManager {
    // No internal subscriptions - StreamCoordinator calls methods directly

    async persistBoardToFiles(board: KanbanBoard): Promise<void> {
        // ... update files ...

        // Emit to stream
        fileContentChanged$.next({
            path: this._mainFile!.getPath(),
            content: markdown,
            type: 'main',
            timestamp: Date.now()
        });
    }

    async checkForExternalChanges(): Promise<void> {
        // ... check files ...

        if (changedFiles.length > 0) {
            for (const file of changedFiles) {
                externalFileChanges$.next({
                    path: file.path,
                    type: file.type,
                    newContent: file.content
                });
            }
        }
    }
}
```

#### Step 5: Update KanbanWebviewPanel (Day 5 - 4 hours)

```typescript
// src/kanbanWebviewPanel.ts
import { boardChanges$, boardInvalidated$ } from './core/streams/BoardStreams';
import { mediaFilesChanged$ } from './core/streams/MediaStreams';
import { focusGained$ } from './core/streams/UIStreams';

export class KanbanWebviewPanel {
    private _streamCoordinator: StreamCoordinator;
    private _subscriptions: (() => void)[] = [];

    constructor() {
        // ... setup ...

        this._setupStreamSubscriptions();
    }

    private _setupStreamSubscriptions(): void {
        // React to board invalidation
        this._subscriptions.push(
            boardInvalidated$.subscribe(() => {
                this._boardStore.invalidateCache();
                this.sendBoardUpdate(false, true);
            })
        );

        // React to media changes
        this._subscriptions.push(
            mediaFilesChanged$.subscribe(({ changedFiles }) => {
                this._panel?.webview.postMessage({
                    type: 'mediaFilesChanged',
                    changedFiles
                });
            })
        );
    }

    // Called when board changes
    public onBoardChanged(board: KanbanBoard, trigger: string): void {
        this._boardStore.setBoard(board, false);
        boardChanges$.next({ board, trigger, timestamp: Date.now() });
    }

    // Called on focus
    private _handleFocus(): void {
        focusGained$.next();
    }
}
```

#### Step 6-8: Migrate call sites, delete old code, test

### Pros
- **Powerful operators** - debounce, throttle, merge, etc.
- **Composable** - build complex flows from simple streams
- **Best async handling** - perfect for timing-sensitive operations
- **Familiar pattern** - many devs know RxJS

### Cons
- **Highest complexity** - need to understand reactive programming
- **Learning curve** - team needs training
- **Custom implementation** - or add RxJS dependency
- **Debugging** - stream flows can be hard to trace

---

# FINAL COMPARISON

| Aspect | C3-A (EventBus) | C3-B (Channels) | C3-C (Streams) |
|--------|-----------------|-----------------|----------------|
| **Complexity** | Medium | Medium-High | High |
| **Effort** | 5-6 days | 6-7 days | 7-8 days |
| **Type Safety** | Good | Excellent | Good |
| **Async Control** | Basic | Basic | Excellent |
| **Testability** | Good | Good | Excellent |
| **Debugging** | Easy | Easy | Medium |
| **Learning Curve** | Low | Low-Medium | High |
| **Best For** | Most projects | Large teams | Complex async flows |

---

# CHECKLIST FOR ALL PLANS

## Before Starting
- [ ] Create feature branch
- [ ] Set up test coverage baseline
- [ ] Document current behavior

## During Implementation
- [ ] Write unit tests for new code
- [ ] Keep old code working until new code is tested
- [ ] Migrate one call site at a time
- [ ] Run full test suite after each change

## After Completion
- [ ] All 9 old functions deleted
- [ ] All 10 call sites migrated
- [ ] No duplicate logic remains
- [ ] Test coverage maintained or improved
- [ ] Documentation updated

## Test Scenarios
- [ ] Initial load - board displays correctly
- [ ] Edit task - changes persist
- [ ] Undo/redo - works correctly
- [ ] Template drop - new card added
- [ ] Focus/blur - no unnecessary reloads
- [ ] External file change - detected and updated
- [ ] Media file change - re-rendered
- [ ] Include file change - content updated
- [ ] Regular include - no longer causes bug
- [ ] Save - all files saved correctly
