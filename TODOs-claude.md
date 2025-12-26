# Cross-Kanban Content Contamination Fix Plan

## Implementation Status

### Issue 1: Global EventBus Singleton - ✅ COMPLETED
**Implemented: Option C - Per-Panel Scoped EventBus (Plan 2: Panel Context Object)**

Changes made:
- Created `src/core/events/ScopedEventBus.ts` - Panel-isolated event bus
- Added `scopedEventBus` to `src/panel/PanelContext.ts` - Each panel gets its own event bus
- Updated handlers to subscribe to panel's scopedEventBus:
  - `BoardSyncHandler.ts`
  - `FileSyncHandler.ts`
  - `WebviewUpdateService.ts`
  - `LinkReplacementHandler.ts`
- Updated emitters to use scopedEventBus:
  - `KanbanWebviewPanel.ts` (focus:gained, board:changed, board:loaded)
  - `LinkHandler.ts` (link:replace-requested)
- Global EventBus kept for truly global events (file:externally-changed)

### Issue 2: FileSaveService Singleton - ✅ COMPLETED
**Implemented: Per-Panel FileSaveService via PanelContext**

Changes made:
- Removed singleton pattern from `src/core/FileSaveService.ts`
- Added `fileSaveService` to `src/panel/PanelContext.ts`
- Updated all users to get FileSaveService from PanelContext:
  - `ChangeStateMachine.ts`
  - `MarkdownFileRegistry.ts`
  - `MessageHandler.ts`
  - `KanbanFileService.ts`

### Issue 3: ConflictResolver Singleton - ✅ COMPLETED
**Implemented: Per-Panel ConflictResolver via PanelContext**

Changes made:
- Removed singleton pattern from `src/services/ConflictResolver.ts`
- Added `conflictResolver` to `src/panel/PanelContext.ts`
- Updated `KanbanWebviewPanel.ts` to use `panelContext.conflictResolver`

### Issue 4: SaveEventDispatcher Singleton - ✅ NO CHANGES NEEDED
**Analysis: Already panel-safe by design**

SaveEventDispatcher correctly remains a global singleton because:
1. VS Code `onDidSaveTextDocument` is a global event
2. Each panel registers its own handler with unique ID
3. Handlers already filter by their panel's files (main doc + include files)

### Phase 3: Panel Tracking Map - ✅ NO CHANGES NEEDED
**Analysis: Already prevents duplicate panels**

Line 95 checks if panel exists for document URI before creating:
```typescript
const existingPanel = KanbanWebviewPanel.panels.get(document.uri.toString());
if (existingPanel) { existingPanel.reveal(); return; }
```
Same file cannot be opened in two panels - the second just reveals the first.

### Phase 4: Cleanup on Panel Close - ✅ VERIFIED
**Analysis: All handlers properly disposed**

`dispose()` method (lines 523-556) properly cleans up:
- `this._context.setDisposed(true)` triggers ScopedEventBus.dispose()
- All handlers disposed in reverse order
- SaveEventDispatcher handler unregistered

### Phase 5: CommandContext - ✅ NO CHANGES NEEDED
**Analysis: Commands use callbacks that emit on scopedEventBus**

Commands don't emit events directly. They use:
- `emitBoardChanged()` callback → KanbanWebviewPanel → scopedEventBus
- `fileSaveService` → already per-panel via PanelContext

---

## ✅ ALL ISSUES RESOLVED

The cross-kanban content contamination should now be fixed. Each panel has:
1. Its own `ScopedEventBus` - events only trigger handlers on same panel
2. Its own `FileSaveService` - save operations isolated
3. Its own `ConflictResolver` - conflict dialogs isolated

---

# Issue 1: Global EventBus Singleton - 3 Implementation Options

## Option A: Minimal Fix - Add Panel ID Filter to Handlers Only

**Quality: ⭐⭐ (Low)**
**Effort: 1-2 hours**
**Risk: Medium**

### Approach
Keep the global EventBus as-is. Modify each handler to check if the event originated from "its" panel by comparing file paths.

### Implementation

1. Each handler stores reference to its panel's main file path
2. Events already contain file path info - use that to filter
3. Handler ignores events where file path doesn't match its registry

```typescript
// In BoardSyncHandler constructor
this._mainFilePath = fileRegistry.getMainFile()?.getPath();

// In event handler
eventBus.on('board:changed', async (event: BoardChangedEvent) => {
  // Filter by checking if the file belongs to this panel
  if (event.filePath !== this._mainFilePath) {
    return;  // Not our panel's event
  }
  await this._handleBoardChanged(event);
});
```

### Files to Modify
- `src/core/events/BoardSyncHandler.ts`
- `src/core/events/FileSyncHandler.ts`
- `src/core/events/FileRegistryChangeHandler.ts`
- `src/core/events/IncludeSyncHandler.ts`

### Pros
- Minimal code changes
- No new infrastructure needed
- Quick to implement

### Cons
- Relies on file path matching (fragile if paths change)
- Doesn't solve root cause
- Include files shared between panels could still cause issues
- No protection for events that don't have file path
- Hacky - not a proper architectural fix

### When to Use
- Emergency hotfix needed immediately
- Temporary solution while planning proper fix

---

## Option B: Medium Fix - Add Panel ID to Events and Filter

**Quality: ⭐⭐⭐⭐ (Good)**
**Effort: 3-4 hours**
**Risk: Low**

### Approach
Add explicit `panelId` to all event types. Each panel gets a unique ID at construction. Handlers filter events by panelId.

### Implementation

#### Step 1: Add panelId to KanbanWebviewPanel

```typescript
// src/kanbanWebviewPanel.ts
export class KanbanWebviewPanel {
  private readonly _panelId: string;

  constructor(...) {
    this._panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // Pass panelId to all handlers
  }

  public get panelId(): string {
    return this._panelId;
  }
}
```

#### Step 2: Update Event Types

```typescript
// src/core/events/EventTypes.ts
export interface BaseEvent {
  panelId: string;
}

export interface BoardChangedEvent extends BaseEvent {
  board: KanbanBoard;
  source: string;
}

export interface BoardLoadedEvent extends BaseEvent {
  board: KanbanBoard;
}
// ... update all event interfaces
```

#### Step 3: Update Event Emissions

```typescript
// Wherever events are emitted
eventBus.emit('board:changed', {
  panelId: this._panelId,
  board: board,
  source: 'user-edit'
});
```

#### Step 4: Filter in Handlers

```typescript
// In each handler
constructor(panelId: string, ...) {
  this._panelId = panelId;

  this._unsubscribeChanged = eventBus.on('board:changed', async (event) => {
    if (event.panelId !== this._panelId) return;
    await this._handleBoardChanged(event);
  });
}
```

### Files to Modify
- `src/kanbanWebviewPanel.ts` - Add panelId generation
- `src/core/events/EventTypes.ts` - Add panelId to interfaces
- `src/core/events/BoardSyncHandler.ts` - Accept panelId, filter events
- `src/core/events/FileSyncHandler.ts` - Accept panelId, filter events
- `src/core/events/FileRegistryChangeHandler.ts` - Accept panelId, filter events
- `src/core/events/IncludeSyncHandler.ts` - Accept panelId, filter events
- All files that emit events - Include panelId

### Pros
- Explicit panel identity - no guessing
- Clean architectural solution
- Easy to debug (panelId visible in logs)
- Low risk - additive changes
- Future-proof

### Cons
- More files to modify
- Need to update all event emissions
- Slight overhead (extra property in events)

### When to Use
- Recommended for production fix
- Good balance of effort vs quality

---

## Option C: Full Fix - Per-Panel Scoped EventBus

**Quality: ⭐⭐⭐⭐⭐ (Excellent)**
**Effort: 6-8 hours**
**Risk: Medium**

### Approach
Replace global singleton EventBus with per-panel instances. Each panel has its own isolated event channel. Global events (like VS Code file changes) are routed to appropriate panels.

### Implementation

#### Step 1: Create ScopedEventBus

```typescript
// src/core/events/ScopedEventBus.ts
export class ScopedEventBus {
  private _panelId: string;
  private _handlers: Map<string, Set<Function>> = new Map();

  constructor(panelId: string) {
    this._panelId = panelId;
  }

  public emit<T>(event: string, data: T): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  public on<T>(event: string, handler: (data: T) => void): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event)!.add(handler);

    return () => {
      this._handlers.get(event)?.delete(handler);
    };
  }

  public dispose(): void {
    this._handlers.clear();
  }
}
```

#### Step 2: Create GlobalEventRouter

```typescript
// src/core/events/GlobalEventRouter.ts
export class GlobalEventRouter {
  private static _instance: GlobalEventRouter;
  private _panelBuses: Map<string, ScopedEventBus> = new Map();

  public static getInstance(): GlobalEventRouter {
    if (!this._instance) {
      this._instance = new GlobalEventRouter();
    }
    return this._instance;
  }

  public registerPanel(panelId: string, bus: ScopedEventBus): void {
    this._panelBuses.set(panelId, bus);
  }

  public unregisterPanel(panelId: string): void {
    this._panelBuses.delete(panelId);
  }

  // Route external events to specific panel by file path
  public routeToPanel(filePath: string, event: string, data: any): void {
    // Find panel that owns this file
    for (const [panelId, bus] of this._panelBuses) {
      if (this._panelOwnsFile(panelId, filePath)) {
        bus.emit(event, data);
        break;
      }
    }
  }

  // Broadcast to all panels (for truly global events)
  public broadcast(event: string, data: any): void {
    for (const bus of this._panelBuses.values()) {
      bus.emit(event, data);
    }
  }
}
```

#### Step 3: Update KanbanWebviewPanel

```typescript
// src/kanbanWebviewPanel.ts
export class KanbanWebviewPanel {
  private readonly _panelId: string;
  private readonly _eventBus: ScopedEventBus;

  constructor(...) {
    this._panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this._eventBus = new ScopedEventBus(this._panelId);

    // Register with global router
    GlobalEventRouter.getInstance().registerPanel(this._panelId, this._eventBus);

    // Pass scoped bus to handlers
    this._boardSyncHandler = new BoardSyncHandler(this._eventBus, ...);
  }

  public dispose(): void {
    GlobalEventRouter.getInstance().unregisterPanel(this._panelId);
    this._eventBus.dispose();
    // ... rest of cleanup
  }
}
```

#### Step 4: Update All Handlers

```typescript
// Each handler receives scoped bus instead of using global
export class BoardSyncHandler {
  constructor(eventBus: ScopedEventBus, ...) {
    // No filtering needed - events are already scoped!
    this._unsubscribeChanged = eventBus.on('board:changed', async (event) => {
      await this._handleBoardChanged(event);
    });
  }
}
```

### Files to Modify
- NEW: `src/core/events/ScopedEventBus.ts`
- NEW: `src/core/events/GlobalEventRouter.ts`
- `src/core/events/EventBus.ts` - Deprecate or remove singleton
- `src/kanbanWebviewPanel.ts` - Create scoped bus per panel
- All handler files - Accept bus as parameter instead of using global
- All event emitters - Use passed bus instance

### Pros
- Complete isolation - impossible for events to leak
- Clean architecture - each panel is self-contained
- No filtering needed in handlers
- Easier to test (mock bus per test)
- Proper solution for the root cause

### Cons
- Most effort to implement
- Need to handle global events (VS Code file watcher) specially
- Risk of missing some event paths during migration
- Need careful testing of disposal

### When to Use
- Long-term solution
- When doing major refactoring anyway
- If other issues keep appearing due to shared state

---

## Recommendation

| Criteria | Option A | Option B | Option C |
|----------|----------|----------|----------|
| Quality | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Effort | 1-2 hrs | 3-4 hrs | 6-8 hrs |
| Risk | Medium | Low | Medium |
| Maintainability | Poor | Good | Excellent |
| Completeness | Partial | Full | Full |

**Recommended: Option B** - Best balance of quality, effort, and risk. Provides complete fix with reasonable effort.

**Use Option A** only as emergency hotfix.
**Use Option C** if planning major architecture improvements.

---

# Option C Implementation: 3 Approaches

## Approach C1: Big Bang Migration

**Quality: ⭐⭐⭐ (Medium)**
**Effort: 6-8 hours**
**Risk: HIGH**

### Overview
Replace the entire event system in one commit. Remove global EventBus, create ScopedEventBus, update all handlers and emitters simultaneously.

### Implementation Steps

#### Step 1: Create New Event Infrastructure (1 hour)

```typescript
// src/core/events/ScopedEventBus.ts
export class ScopedEventBus {
  private readonly _panelId: string;
  private _handlers: Map<string, Set<Function>> = new Map();

  constructor(panelId: string) {
    this._panelId = panelId;
  }

  get panelId(): string { return this._panelId; }

  emit<T extends object>(event: string, data: T): void {
    const handlers = this._handlers.get(event);
    handlers?.forEach(h => h({ ...data, panelId: this._panelId }));
  }

  on<T>(event: string, handler: (data: T) => void): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event)!.add(handler);
    return () => this._handlers.get(event)?.delete(handler);
  }

  dispose(): void {
    this._handlers.clear();
  }
}
```

```typescript
// src/core/events/GlobalEventRouter.ts
export class GlobalEventRouter {
  private static _instance: GlobalEventRouter;
  private _panelBuses: Map<string, ScopedEventBus> = new Map();
  private _fileToPanel: Map<string, string> = new Map();

  static getInstance(): GlobalEventRouter {
    return this._instance ??= new GlobalEventRouter();
  }

  registerPanel(panelId: string, bus: ScopedEventBus, mainFilePath: string): void {
    this._panelBuses.set(panelId, bus);
    this._fileToPanel.set(mainFilePath, panelId);
  }

  unregisterPanel(panelId: string, mainFilePath: string): void {
    this._panelBuses.delete(panelId);
    this._fileToPanel.delete(mainFilePath);
  }

  getPanelForFile(filePath: string): ScopedEventBus | undefined {
    const panelId = this._fileToPanel.get(filePath);
    return panelId ? this._panelBuses.get(panelId) : undefined;
  }

  broadcastToAll(event: string, data: any): void {
    this._panelBuses.forEach(bus => bus.emit(event, data));
  }
}
```

#### Step 2: Update KanbanWebviewPanel (1 hour)

```typescript
// src/kanbanWebviewPanel.ts
export class KanbanWebviewPanel {
  private readonly _panelId: string;
  private readonly _scopedEventBus: ScopedEventBus;

  constructor(...) {
    this._panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this._scopedEventBus = new ScopedEventBus(this._panelId);

    const mainFilePath = document.uri.fsPath;
    GlobalEventRouter.getInstance().registerPanel(
      this._panelId,
      this._scopedEventBus,
      mainFilePath
    );

    // Pass scoped bus to ALL handlers
    this._boardSyncHandler = new BoardSyncHandler(this._scopedEventBus, ...);
    this._fileSyncHandler = new FileSyncHandler(this._scopedEventBus, ...);
    // ... etc
  }

  dispose(): void {
    GlobalEventRouter.getInstance().unregisterPanel(this._panelId, this._mainFilePath);
    this._scopedEventBus.dispose();
    // ... rest
  }
}
```

#### Step 3: Update ALL Handlers Simultaneously (3-4 hours)

```typescript
// BEFORE (every handler)
import { eventBus } from './EventBus';
export class BoardSyncHandler {
  constructor(...) {
    eventBus.on('board:changed', ...);
  }
}

// AFTER (every handler)
import { ScopedEventBus } from './ScopedEventBus';
export class BoardSyncHandler {
  constructor(eventBus: ScopedEventBus, ...) {
    eventBus.on('board:changed', ...);
  }
}
```

Files to update:
- `src/core/events/BoardSyncHandler.ts`
- `src/core/events/FileSyncHandler.ts`
- `src/core/events/FileRegistryChangeHandler.ts`
- `src/core/events/IncludeSyncHandler.ts`
- `src/core/UnifiedChangeHandler.ts`
- `src/core/ChangeStateMachine.ts`
- All files that emit events

#### Step 4: Update All Event Emitters (1-2 hours)

Find every `eventBus.emit()` and replace with scoped bus.

#### Step 5: Delete Old EventBus (5 min)

Remove or deprecate `src/core/events/EventBus.ts`.

### Pros
- Clean break - no legacy code
- No compatibility overhead
- Simpler final architecture

### Cons
- **HIGH RISK** - All or nothing, one mistake breaks everything
- Hard to test incrementally
- Large diff, hard to review
- If something breaks, hard to bisect

### When to Use
- Small team, can coordinate easily
- Good test coverage exists
- Can afford downtime for debugging

---

## Approach C2: Incremental Migration with Compatibility Layer

**Quality: ⭐⭐⭐⭐⭐ (Excellent)**
**Effort: 8-10 hours**
**Risk: LOW**

### Overview
Create new scoped system alongside old global system. Add compatibility layer that bridges both. Migrate handlers one-by-one. Remove old system only after all migrations complete.

### Implementation Steps

#### Step 1: Create New Infrastructure (Same as C1) (1 hour)

Create `ScopedEventBus.ts` and `GlobalEventRouter.ts`.

#### Step 2: Create Compatibility Bridge (1 hour)

```typescript
// src/core/events/EventBusCompat.ts
import { eventBus as globalEventBus } from './EventBus';
import { ScopedEventBus } from './ScopedEventBus';
import { GlobalEventRouter } from './GlobalEventRouter';

/**
 * Compatibility layer during migration.
 * Forwards events between old global bus and new scoped buses.
 */
export class EventBusCompat {
  private static _instance: EventBusCompat;
  private _forwardedEvents: Set<string> = new Set();

  static getInstance(): EventBusCompat {
    return this._instance ??= new EventBusCompat();
  }

  /**
   * Forward global events to scoped buses (for events not yet migrated)
   */
  forwardGlobalToScoped(eventName: string): void {
    if (this._forwardedEvents.has(eventName)) return;
    this._forwardedEvents.add(eventName);

    globalEventBus.on(eventName, (data: any) => {
      // Route to appropriate panel based on file path in event
      const filePath = data.filePath || data.file?.getPath?.();
      if (filePath) {
        const bus = GlobalEventRouter.getInstance().getPanelForFile(filePath);
        bus?.emit(eventName, data);
      }
    });
  }

  /**
   * Forward scoped events to global bus (for handlers not yet migrated)
   */
  forwardScopedToGlobal(scopedBus: ScopedEventBus, eventName: string): void {
    scopedBus.on(eventName, (data: any) => {
      globalEventBus.emit(eventName, data);
    });
  }
}
```

#### Step 3: Update KanbanWebviewPanel to Use Both (1 hour)

```typescript
// src/kanbanWebviewPanel.ts
export class KanbanWebviewPanel {
  private readonly _panelId: string;
  private readonly _scopedEventBus: ScopedEventBus;

  constructor(...) {
    this._panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this._scopedEventBus = new ScopedEventBus(this._panelId);

    GlobalEventRouter.getInstance().registerPanel(...);

    // Setup compatibility forwarding for events still using global bus
    const compat = EventBusCompat.getInstance();
    compat.forwardGlobalToScoped('board:changed');
    compat.forwardGlobalToScoped('board:loaded');
    // ... other events

    // GRADUALLY migrate handlers - start with one
    this._boardSyncHandler = new BoardSyncHandler(this._scopedEventBus, ...);

    // These still use global bus (migrate later)
    this._fileSyncHandler = new FileSyncHandler(/* old style */);
  }
}
```

#### Step 4: Migrate Handlers One-by-One (4-5 hours)

**Migration order (safest first):**

1. `BoardSyncHandler` - Most critical, test thoroughly
2. `FileSyncHandler` - Test file operations
3. `IncludeSyncHandler` - Test include files
4. `FileRegistryChangeHandler` - Test external changes
5. Event emitters in various files

For each handler:
```typescript
// 1. Update constructor to accept ScopedEventBus
// 2. Test with single panel
// 3. Test with multiple panels
// 4. Commit
// 5. Move to next handler
```

#### Step 5: Migrate Event Emitters (1-2 hours)

```typescript
// BEFORE
eventBus.emit('board:changed', { board, source });

// AFTER (pass scoped bus through context)
this._scopedEventBus.emit('board:changed', { board, source });
```

#### Step 6: Remove Compatibility Layer (30 min)

Once all handlers and emitters migrated:
1. Remove `EventBusCompat.ts`
2. Remove forwarding setup in panel
3. Delete old `EventBus.ts`

### Pros
- **LOW RISK** - Can stop at any point, rollback individual changes
- Testable at each step
- Easy to review (small commits)
- Can ship partially migrated (old+new coexist)

### Cons
- More total effort
- Temporary complexity with two systems
- Need to track migration progress

### When to Use
- **RECOMMENDED** for production systems
- When stability is critical
- When team needs to review changes carefully

---

## Approach C3: Hybrid Architecture (Keep Global + Add Scoped)

**Quality: ⭐⭐⭐⭐ (Good)**
**Effort: 5-6 hours**
**Risk: LOW**

### Overview
Keep the global EventBus for truly global events (VS Code file watcher, extension lifecycle). Add ScopedEventBus only for panel-specific events. Clear separation of concerns.

### Implementation Steps

#### Step 1: Categorize Events (30 min)

**Global Events (keep on global bus):**
- `vscode:file:changed` - External file changes from VS Code
- `vscode:file:saved` - VS Code document saves
- `extension:activated` - Extension lifecycle
- `extension:deactivated`

**Panel Events (move to scoped bus):**
- `board:changed` - Board content changed
- `board:loaded` - Board loaded from file
- `include:changed` - Include file changed
- `include:loaded` - Include file loaded
- `focus:gained` - Panel gained focus
- `focus:lost` - Panel lost focus

#### Step 2: Create Scoped Infrastructure (1 hour)

Same as C1/C2 - create `ScopedEventBus.ts` and `GlobalEventRouter.ts`.

#### Step 3: Create Event Routing Layer (1 hour)

```typescript
// src/core/events/EventRouter.ts
import { eventBus as globalBus } from './EventBus';
import { GlobalEventRouter } from './GlobalEventRouter';

/**
 * Routes external events to appropriate panels.
 * Global bus remains for VS Code events, scoped buses for panel events.
 */
export class EventRouter {
  private static _instance: EventRouter;

  static getInstance(): EventRouter {
    return this._instance ??= new EventRouter();
  }

  initialize(): void {
    // Listen to global VS Code events and route to panels
    globalBus.on('vscode:file:changed', (event: { filePath: string }) => {
      const panelBus = GlobalEventRouter.getInstance().getPanelForFile(event.filePath);
      if (panelBus) {
        panelBus.emit('external:file:changed', event);
      }
    });

    globalBus.on('vscode:file:saved', (event: { filePath: string }) => {
      const panelBus = GlobalEventRouter.getInstance().getPanelForFile(event.filePath);
      if (panelBus) {
        panelBus.emit('external:file:saved', event);
      }
    });
  }
}
```

#### Step 4: Update Handlers to Use Appropriate Bus (2-3 hours)

```typescript
// Handlers that deal with panel-specific events use scoped bus
export class BoardSyncHandler {
  constructor(scopedBus: ScopedEventBus, ...) {
    // Panel events - scoped
    scopedBus.on('board:changed', this._handleBoardChanged);
    scopedBus.on('board:loaded', this._handleBoardLoaded);
  }
}

// Handlers that deal with VS Code events still use global
// but route to panel via EventRouter
export class FileWatcherHandler {
  constructor() {
    // This emits to global bus, EventRouter forwards to correct panel
    vscode.workspace.onDidChangeTextDocument(doc => {
      globalBus.emit('vscode:file:changed', { filePath: doc.uri.fsPath });
    });
  }
}
```

#### Step 5: Update Panel to Use Both Buses (1 hour)

```typescript
export class KanbanWebviewPanel {
  constructor(...) {
    this._scopedEventBus = new ScopedEventBus(this._panelId);
    GlobalEventRouter.getInstance().registerPanel(...);

    // Initialize routing from global to scoped
    EventRouter.getInstance().initialize();

    // Handlers use scoped bus for panel events
    this._boardSyncHandler = new BoardSyncHandler(this._scopedEventBus, ...);
  }
}
```

### Pros
- Clear separation: global vs panel events
- Minimal changes to VS Code integration code
- Easy to understand architecture
- Lower risk than full migration

### Cons
- Two event systems permanently (slight complexity)
- Need to decide which events are "global" vs "panel"
- Some events might be ambiguous

### When to Use
- When VS Code integration is complex
- When you want minimal changes to external event handling
- Good long-term architecture

---

## Comparison: C1 vs C2 vs C3

| Criteria | C1: Big Bang | C2: Incremental | C3: Hybrid |
|----------|--------------|-----------------|------------|
| Quality | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Effort | 6-8 hrs | 8-10 hrs | 5-6 hrs |
| Risk | HIGH | LOW | LOW |
| Rollback | Hard | Easy | Easy |
| Final Complexity | Simple | Simple | Medium |
| Testability | Hard | Easy | Easy |
| Review Difficulty | Hard | Easy | Easy |

## Recommendation

**For Production: C2 (Incremental Migration)**
- Safest approach
- Can test at each step
- Easy to rollback if issues found
- Best for critical systems

**For Quick Implementation: C3 (Hybrid)**
- Less total effort
- Good enough solution
- Acceptable long-term architecture

**Avoid C1 (Big Bang)** unless:
- You have comprehensive test coverage
- Small codebase
- Can afford debugging time

---

# C1 Implementation: 3 Code Structure Plans

## Analysis: What Needs to Change

### Current Architecture (Problem)

```
┌─────────────────────────────────────────────────────────────┐
│                    GLOBAL SINGLETON                          │
│                      EventBus                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  handlers: Map<event, Set<callback>>                │    │
│  │  emit() → calls ALL registered handlers             │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
        ▲                    ▲                    ▲
        │                    │                    │
   Panel A               Panel B               Panel C
   handlers              handlers              handlers
   (all receive          (all receive          (all receive
    ALL events)           ALL events)           ALL events)
```

### Target Architecture (Solution)

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Panel A    │    │   Panel B    │    │   Panel C    │
│ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │
│ │ Scoped   │ │    │ │ Scoped   │ │    │ │ Scoped   │ │
│ │ EventBus │ │    │ │ EventBus │ │    │ │ EventBus │ │
│ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │
│      ▲       │    │      ▲       │    │      ▲       │
│      │       │    │      │       │    │      │       │
│  Panel A     │    │  Panel B     │    │  Panel C     │
│  handlers    │    │  handlers    │    │  handlers    │
│  (isolated)  │    │  (isolated)  │    │  (isolated)  │
└──────────────┘    └──────────────┘    └──────────────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ▼
                   ┌──────────────────┐
                   │ GlobalEventRouter│
                   │ (for VS Code     │
                   │  file events)    │
                   └──────────────────┘
```

### Files That Import EventBus (Must Change)

```bash
# Direct imports of eventBus singleton
src/core/events/BoardSyncHandler.ts      - subscribes to board:changed, board:loaded
src/core/events/FileSyncHandler.ts       - subscribes to focus:gained, focus:lost
src/core/events/FileRegistryChangeHandler.ts - subscribes to file changes
src/core/events/IncludeSyncHandler.ts    - subscribes to include events
src/core/UnifiedChangeHandler.ts         - emits and subscribes
src/core/ChangeStateMachine.ts           - emits state changes
src/core/stores/BoardStore.ts            - emits board:changed
src/files/MarkdownFileRegistry.ts        - emits file events
src/kanbanWebviewPanel.ts                - creates handlers
src/messageHandler.ts                    - may emit events
```

### Handler Constructor Signatures (Current)

```typescript
// BoardSyncHandler.ts
constructor(
    fileRegistry: IMarkdownFileRegistry,
    boardStore: BoardStore,
    onBoardUpdate: () => Promise<void>
)

// FileSyncHandler.ts
constructor(
    fileRegistry: IMarkdownFileRegistry,
    getWebviewPanel: () => KanbanWebviewPanel | undefined
)

// FileRegistryChangeHandler.ts
constructor(
    fileRegistry: IMarkdownFileRegistry,
    onBoardUpdate: () => Promise<void>
)

// IncludeSyncHandler.ts
constructor(
    fileRegistry: IMarkdownFileRegistry,
    boardStore: BoardStore,
    postMessage: (msg: any) => void
)
```

---

## Plan 1: Direct Dependency Injection

**Quality: ⭐⭐⭐⭐ (Good)**
**Complexity: Low**
**Refactoring Effort: Medium**

### Approach
Pass `ScopedEventBus` as first parameter to every handler constructor. Simple and explicit.

### New Constructor Signatures

```typescript
// BoardSyncHandler.ts
constructor(
    eventBus: ScopedEventBus,  // NEW - first param
    fileRegistry: IMarkdownFileRegistry,
    boardStore: BoardStore,
    onBoardUpdate: () => Promise<void>
)

// FileSyncHandler.ts
constructor(
    eventBus: ScopedEventBus,  // NEW - first param
    fileRegistry: IMarkdownFileRegistry,
    getWebviewPanel: () => KanbanWebviewPanel | undefined
)

// FileRegistryChangeHandler.ts
constructor(
    eventBus: ScopedEventBus,  // NEW - first param
    fileRegistry: IMarkdownFileRegistry,
    onBoardUpdate: () => Promise<void>
)

// IncludeSyncHandler.ts
constructor(
    eventBus: ScopedEventBus,  // NEW - first param
    fileRegistry: IMarkdownFileRegistry,
    boardStore: BoardStore,
    postMessage: (msg: any) => void
)
```

### Handler Implementation Pattern

```typescript
// src/core/events/BoardSyncHandler.ts
import { ScopedEventBus } from './ScopedEventBus';

export class BoardSyncHandler {
    private readonly _eventBus: ScopedEventBus;
    private readonly _fileRegistry: IMarkdownFileRegistry;
    private _unsubscribeChanged: (() => void) | null = null;
    private _unsubscribeLoaded: (() => void) | null = null;

    constructor(
        eventBus: ScopedEventBus,
        fileRegistry: IMarkdownFileRegistry,
        boardStore: BoardStore,
        onBoardUpdate: () => Promise<void>
    ) {
        this._eventBus = eventBus;
        this._fileRegistry = fileRegistry;
        // ... other assignments

        // Subscribe using instance bus (not global)
        this._unsubscribeChanged = this._eventBus.on('board:changed',
            async (event) => this._handleBoardChanged(event)
        );
        this._unsubscribeLoaded = this._eventBus.on('board:loaded',
            async (event) => this._handleBoardLoaded(event)
        );
    }

    public dispose(): void {
        this._unsubscribeChanged?.();
        this._unsubscribeLoaded?.();
    }
}
```

### Panel Creation Pattern

```typescript
// src/kanbanWebviewPanel.ts
export class KanbanWebviewPanel {
    private readonly _panelId: string;
    private readonly _eventBus: ScopedEventBus;

    constructor(...) {
        // Generate unique panel ID
        this._panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Create scoped event bus for this panel
        this._eventBus = new ScopedEventBus(this._panelId);

        // Register with global router (for external events)
        GlobalEventRouter.getInstance().registerPanel(
            this._panelId,
            this._eventBus,
            document.uri.fsPath
        );

        // Create handlers with scoped bus
        this._boardSyncHandler = new BoardSyncHandler(
            this._eventBus,  // Pass scoped bus
            this._fileRegistry,
            this._boardStore,
            () => this._onBoardUpdate()
        );

        this._fileSyncHandler = new FileSyncHandler(
            this._eventBus,  // Pass scoped bus
            this._fileRegistry,
            () => this
        );

        // ... create other handlers similarly
    }
}
```

### Event Emission Pattern

```typescript
// Anywhere that currently does: eventBus.emit('board:changed', data)

// BEFORE (global)
import { eventBus } from './EventBus';
eventBus.emit('board:changed', { board, source: 'user-edit' });

// AFTER (scoped - need access to panel's bus)
this._eventBus.emit('board:changed', { board, source: 'user-edit' });
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/core/events/ScopedEventBus.ts` | NEW FILE |
| `src/core/events/GlobalEventRouter.ts` | NEW FILE |
| `src/core/events/BoardSyncHandler.ts` | Add eventBus param, use instance |
| `src/core/events/FileSyncHandler.ts` | Add eventBus param, use instance |
| `src/core/events/FileRegistryChangeHandler.ts` | Add eventBus param, use instance |
| `src/core/events/IncludeSyncHandler.ts` | Add eventBus param, use instance |
| `src/kanbanWebviewPanel.ts` | Create bus, pass to handlers |
| `src/core/stores/BoardStore.ts` | Accept eventBus, use for emit |
| `src/files/MarkdownFileRegistry.ts` | Accept eventBus, use for emit |
| `src/core/UnifiedChangeHandler.ts` | Accept eventBus, use for emit |
| `src/core/ChangeStateMachine.ts` | Accept eventBus, use for emit |

### Pros
- Simple, explicit dependency
- Easy to understand
- No magic - clear data flow
- Easy to test (mock eventBus)

### Cons
- Many constructor signature changes
- Need to thread eventBus through all layers
- Some classes need eventBus just to pass it down

---

## Plan 2: Panel Context Object

**Quality: ⭐⭐⭐⭐⭐ (Excellent)**
**Complexity: Medium**
**Refactoring Effort: Medium-High**

### Approach
Create a `PanelContext` object that bundles all panel-specific dependencies. Pass this single object instead of multiple parameters.

### New Types

```typescript
// src/core/PanelContext.ts
import { ScopedEventBus } from './events/ScopedEventBus';
import { IMarkdownFileRegistry } from '../files/FileInterfaces';
import { BoardStore } from './stores/BoardStore';

export interface PanelContext {
    readonly panelId: string;
    readonly eventBus: ScopedEventBus;
    readonly fileRegistry: IMarkdownFileRegistry;
    readonly boardStore: BoardStore;
    readonly postMessage: (msg: any) => void;
    readonly onBoardUpdate: () => Promise<void>;
    readonly getWebviewPanel: () => any;
}

export function createPanelContext(
    panelId: string,
    fileRegistry: IMarkdownFileRegistry,
    boardStore: BoardStore,
    postMessage: (msg: any) => void,
    onBoardUpdate: () => Promise<void>,
    getWebviewPanel: () => any
): PanelContext {
    const eventBus = new ScopedEventBus(panelId);

    return {
        panelId,
        eventBus,
        fileRegistry,
        boardStore,
        postMessage,
        onBoardUpdate,
        getWebviewPanel
    };
}
```

### New Constructor Signatures

```typescript
// All handlers get simplified to single context param

// BoardSyncHandler.ts
constructor(context: PanelContext)

// FileSyncHandler.ts
constructor(context: PanelContext)

// FileRegistryChangeHandler.ts
constructor(context: PanelContext)

// IncludeSyncHandler.ts
constructor(context: PanelContext)
```

### Handler Implementation Pattern

```typescript
// src/core/events/BoardSyncHandler.ts
import { PanelContext } from '../PanelContext';

export class BoardSyncHandler {
    private readonly _context: PanelContext;
    private _unsubscribeChanged: (() => void) | null = null;

    constructor(context: PanelContext) {
        this._context = context;

        // Access eventBus through context
        this._unsubscribeChanged = this._context.eventBus.on('board:changed',
            async (event) => this._handleBoardChanged(event)
        );
    }

    private async _handleBoardChanged(event: BoardChangedEvent): Promise<void> {
        // Access other dependencies through context
        const mainFile = this._context.fileRegistry.getMainFile();
        const board = this._context.boardStore.getBoard();
        await this._context.onBoardUpdate();
    }

    public dispose(): void {
        this._unsubscribeChanged?.();
    }
}
```

### Panel Creation Pattern

```typescript
// src/kanbanWebviewPanel.ts
import { createPanelContext, PanelContext } from './core/PanelContext';

export class KanbanWebviewPanel {
    private readonly _context: PanelContext;

    constructor(...) {
        const panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Create context with all dependencies
        this._context = createPanelContext(
            panelId,
            this._fileRegistry,
            this._boardStore,
            (msg) => this._webview?.postMessage(msg),
            () => this._onBoardUpdate(),
            () => this
        );

        // Register with global router
        GlobalEventRouter.getInstance().registerPanel(
            panelId,
            this._context.eventBus,
            document.uri.fsPath
        );

        // Create handlers with context
        this._boardSyncHandler = new BoardSyncHandler(this._context);
        this._fileSyncHandler = new FileSyncHandler(this._context);
        this._fileRegistryChangeHandler = new FileRegistryChangeHandler(this._context);
        this._includeSyncHandler = new IncludeSyncHandler(this._context);
    }
}
```

### Event Emission Pattern

```typescript
// Components that need to emit use context.eventBus

// In BoardStore
export class BoardStore {
    private readonly _context: PanelContext;

    constructor(context: PanelContext) {
        this._context = context;
    }

    public updateBoard(board: KanbanBoard, source: string): void {
        this._board = board;
        this._context.eventBus.emit('board:changed', { board, source });
    }
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/core/PanelContext.ts` | NEW FILE |
| `src/core/events/ScopedEventBus.ts` | NEW FILE |
| `src/core/events/GlobalEventRouter.ts` | NEW FILE |
| `src/core/events/BoardSyncHandler.ts` | Use context |
| `src/core/events/FileSyncHandler.ts` | Use context |
| `src/core/events/FileRegistryChangeHandler.ts` | Use context |
| `src/core/events/IncludeSyncHandler.ts` | Use context |
| `src/kanbanWebviewPanel.ts` | Create context, pass to all |
| `src/core/stores/BoardStore.ts` | Use context for eventBus |
| `src/files/MarkdownFileRegistry.ts` | Use context for eventBus |
| `src/core/UnifiedChangeHandler.ts` | Use context |
| `src/core/ChangeStateMachine.ts` | Use context |
| `src/messageHandler.ts` | Access context.eventBus |

### Pros
- Single dependency to pass around
- Easy to add new panel-scoped services later
- Cleaner constructor signatures
- Natural grouping of panel resources
- Easier to test (mock entire context)

### Cons
- New abstraction layer
- Context object can become a "god object"
- Need to update all constructors
- Slightly more indirection

---

## Plan 3: Factory + Registry Pattern

**Quality: ⭐⭐⭐ (Medium)**
**Complexity: High**
**Refactoring Effort: High**

### Approach
Use a `PanelRegistry` that tracks all panels. Components look up their panel's eventBus via the registry using a panelId token.

### New Types

```typescript
// src/core/PanelRegistry.ts
import { ScopedEventBus } from './events/ScopedEventBus';

interface PanelEntry {
    panelId: string;
    eventBus: ScopedEventBus;
    mainFilePath: string;
}

export class PanelRegistry {
    private static _instance: PanelRegistry;
    private _panels: Map<string, PanelEntry> = new Map();
    private _currentPanelId: string | null = null;

    static getInstance(): PanelRegistry {
        return this._instance ??= new PanelRegistry();
    }

    registerPanel(panelId: string, mainFilePath: string): ScopedEventBus {
        const eventBus = new ScopedEventBus(panelId);
        this._panels.set(panelId, { panelId, eventBus, mainFilePath });
        return eventBus;
    }

    unregisterPanel(panelId: string): void {
        const entry = this._panels.get(panelId);
        entry?.eventBus.dispose();
        this._panels.delete(panelId);
    }

    getEventBus(panelId: string): ScopedEventBus | undefined {
        return this._panels.get(panelId)?.eventBus;
    }

    // For handlers that don't have panelId, use "current" context
    setCurrentPanel(panelId: string): void {
        this._currentPanelId = panelId;
    }

    getCurrentEventBus(): ScopedEventBus | undefined {
        return this._currentPanelId ? this.getEventBus(this._currentPanelId) : undefined;
    }

    getPanelForFile(filePath: string): PanelEntry | undefined {
        for (const entry of this._panels.values()) {
            if (entry.mainFilePath === filePath) {
                return entry;
            }
        }
        return undefined;
    }
}
```

### Handler Implementation Pattern

```typescript
// src/core/events/BoardSyncHandler.ts
import { PanelRegistry } from '../PanelRegistry';

export class BoardSyncHandler {
    private readonly _panelId: string;
    private _unsubscribeChanged: (() => void) | null = null;

    constructor(
        panelId: string,  // Just need the ID
        fileRegistry: IMarkdownFileRegistry,
        boardStore: BoardStore,
        onBoardUpdate: () => Promise<void>
    ) {
        this._panelId = panelId;

        // Look up eventBus from registry
        const eventBus = PanelRegistry.getInstance().getEventBus(panelId);
        if (!eventBus) {
            throw new Error(`No event bus for panel ${panelId}`);
        }

        this._unsubscribeChanged = eventBus.on('board:changed',
            async (event) => this._handleBoardChanged(event)
        );
    }

    private async _handleBoardChanged(event: BoardChangedEvent): Promise<void> {
        // Get current eventBus when needed
        const eventBus = PanelRegistry.getInstance().getEventBus(this._panelId);
        // ... handle event
    }
}
```

### Panel Creation Pattern

```typescript
// src/kanbanWebviewPanel.ts
import { PanelRegistry } from './core/PanelRegistry';

export class KanbanWebviewPanel {
    private readonly _panelId: string;
    private readonly _eventBus: ScopedEventBus;

    constructor(...) {
        this._panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Register panel and get its eventBus
        this._eventBus = PanelRegistry.getInstance().registerPanel(
            this._panelId,
            document.uri.fsPath
        );

        // Set as current panel for any code that needs implicit context
        PanelRegistry.getInstance().setCurrentPanel(this._panelId);

        // Create handlers with just panelId
        this._boardSyncHandler = new BoardSyncHandler(
            this._panelId,
            this._fileRegistry,
            this._boardStore,
            () => this._onBoardUpdate()
        );
    }

    public dispose(): void {
        PanelRegistry.getInstance().unregisterPanel(this._panelId);
    }
}
```

### Event Emission Pattern

```typescript
// Components can emit via registry lookup

// Option A: Explicit panelId
const eventBus = PanelRegistry.getInstance().getEventBus(this._panelId);
eventBus?.emit('board:changed', { board, source });

// Option B: Current panel context (implicit)
const eventBus = PanelRegistry.getInstance().getCurrentEventBus();
eventBus?.emit('board:changed', { board, source });
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/core/PanelRegistry.ts` | NEW FILE |
| `src/core/events/ScopedEventBus.ts` | NEW FILE |
| `src/core/events/BoardSyncHandler.ts` | Add panelId, use registry |
| `src/core/events/FileSyncHandler.ts` | Add panelId, use registry |
| `src/core/events/FileRegistryChangeHandler.ts` | Add panelId, use registry |
| `src/core/events/IncludeSyncHandler.ts` | Add panelId, use registry |
| `src/kanbanWebviewPanel.ts` | Register panel, pass panelId |
| `src/core/stores/BoardStore.ts` | Use registry for emit |
| `src/files/MarkdownFileRegistry.ts` | Use registry for emit |
| `src/core/UnifiedChangeHandler.ts` | Use registry |
| `src/core/ChangeStateMachine.ts` | Use registry |

### Pros
- Minimal constructor changes (just add panelId)
- Flexible - can look up eventBus when needed
- Supports "current panel" pattern for legacy code

### Cons
- Service locator anti-pattern (hidden dependencies)
- "Current panel" is implicit/magic
- Harder to test (global state)
- Runtime errors if panel not registered
- Less explicit than DI

---

## Comparison: Plan 1 vs Plan 2 vs Plan 3

| Criteria | Plan 1: Direct DI | Plan 2: Context | Plan 3: Registry |
|----------|-------------------|-----------------|------------------|
| Quality | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Complexity | Low | Medium | High |
| Constructor Changes | Many params | Single param | One param |
| Explicit Dependencies | Yes | Yes | No (hidden) |
| Testability | Good | Excellent | Poor |
| Future Extensibility | Medium | Excellent | Medium |
| Risk of Bugs | Low | Low | Medium |
| Refactoring Effort | Medium | Medium-High | High |

## Recommendation

**Best Choice: Plan 2 (Panel Context Object)**

Reasons:
1. Single `PanelContext` param is cleaner than multiple params
2. Easy to extend with new panel-scoped services
3. Explicit dependencies (unlike registry pattern)
4. Excellent testability
5. Natural encapsulation of panel resources
6. Constructor signatures become simpler, not more complex

**Second Choice: Plan 1 (Direct DI)**

Use if:
- You prefer explicit over abstraction
- Don't anticipate adding more panel services
- Want minimal new concepts

**Avoid Plan 3 (Registry)** unless:
- You have legacy code that can't accept constructor params
- Need "current panel" implicit context

---

## Problem Summary

When multiple kanban panels are open, content from one kanban can be written to another kanban's file. This is caused by shared global state (singletons) and event handlers that don't properly isolate panel identity.

---

## Phase 1: Add Panel Identity to Event System (CRITICAL)

### 1.1 Create Panel Identity Type

**File:** `src/core/events/EventTypes.ts`

- Add `panelId: string` to base event interface
- All events must include the originating panel's ID

```typescript
interface BaseEvent {
  panelId: string;  // Unique identifier for the originating panel
}

interface BoardChangedEvent extends BaseEvent {
  board: KanbanBoard;
  // ...
}
```

### 1.2 Generate Unique Panel IDs

**File:** `src/kanbanWebviewPanel.ts`

- Generate unique panel ID in constructor (e.g., `uuid` or `Date.now() + random`)
- Store as instance property: `private readonly _panelId: string`
- Pass panelId to all child components (handlers, services)

```typescript
constructor(...) {
  this._panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
```

### 1.3 Include Panel ID in All Event Emissions

**Files to modify:**
- `src/core/events/BoardSyncHandler.ts`
- `src/core/events/FileSyncHandler.ts`
- `src/core/events/FileRegistryChangeHandler.ts`
- `src/core/events/IncludeSyncHandler.ts`
- Any other event emitters

Every `eventBus.emit()` call must include `panelId`:

```typescript
eventBus.emit('board:changed', {
  panelId: this._panelId,  // ADD THIS
  board: board,
  // ...
});
```

### 1.4 Filter Events by Panel ID in Handlers

**Files to modify:** Same as 1.3

All event handlers must check panel ID and ignore events from other panels:

```typescript
eventBus.on('board:changed', async (event: BoardChangedEvent) => {
  // IGNORE events from other panels
  if (event.panelId !== this._panelId) {
    return;
  }
  await this._handleBoardChanged(event);
});
```

---

## Phase 2: Make Singletons Panel-Aware (CRITICAL)

### 2.1 FileSaveService - Add Panel Context

**File:** `src/core/FileSaveService.ts`

Option A (Preferred): Make save keys include panel ID
```typescript
const saveKey = `${panelId}:${file.getFileType()}:${filePath}`;
```

Option B: Create per-panel instances instead of singleton

### 2.2 ConflictResolver - Add Panel Context

**File:** `src/services/ConflictResolver.ts`

- Include panel ID in dialog key generation
- Separate `activeDialogs` and `pendingResolutions` per panel

```typescript
private generateDialogKey(context: ConflictContext, panelId: string): string {
  const fileIdentifier = context.fileType === 'main' ? 'main' : context.filePath;
  return `${panelId}_${context.type}_${fileIdentifier}`;
}
```

### 2.3 SaveEventDispatcher - Add Panel Context

**File:** `src/SaveEventDispatcher.ts`

- Include panel ID in handler registration
- Handler IDs must be unique per panel

```typescript
const handlerId = `${panelId}-${document.uri.fsPath}`;
```

---

## Phase 3: Fix Panel Tracking Map (HIGH)

### 3.1 Use Panel ID as Map Key

**File:** `src/kanbanWebviewPanel.ts`

Change from document URI key to panel ID key:

```typescript
// BEFORE (can be overwritten if same file opened twice)
private static panels: Map<string, KanbanWebviewPanel> = new Map();
KanbanWebviewPanel.panels.set(docUri, kanbanPanel);

// AFTER (unique per panel instance)
private static panels: Map<string, KanbanWebviewPanel> = new Map();
KanbanWebviewPanel.panels.set(this._panelId, kanbanPanel);
```

### 3.2 Add URI-to-Panel Lookup (if needed)

If code needs to find panel by document URI:

```typescript
private static panelsByUri: Map<string, Set<string>> = new Map();  // URI -> Set of panelIds

public static getPanelsByUri(uri: string): KanbanWebviewPanel[] {
  const panelIds = this.panelsByUri.get(uri) || new Set();
  return Array.from(panelIds).map(id => this.panels.get(id)).filter(Boolean);
}
```

---

## Phase 4: Ensure Proper Cleanup on Panel Close (HIGH)

### 4.1 Unsubscribe All Event Handlers

**File:** `src/kanbanWebviewPanel.ts` - `dispose()` method

Ensure all handlers properly unsubscribe:

```typescript
public dispose(): void {
  // Unsubscribe from all events FIRST
  this._boardSyncHandler?.dispose();
  this._fileSyncHandler?.dispose();
  this._fileRegistryChangeHandler?.dispose();
  this._includeSyncHandler?.dispose();

  // Remove from panel maps
  KanbanWebviewPanel.panels.delete(this._panelId);

  // ... rest of cleanup
}
```

### 4.2 Verify Handler Disposal

**Files:** All handler classes in `src/core/events/`

Each handler must properly call unsubscribe functions:

```typescript
public dispose(): void {
  if (this._unsubscribeChanged) {
    this._unsubscribeChanged();
    this._unsubscribeChanged = null;
  }
  if (this._unsubscribeLoaded) {
    this._unsubscribeLoaded();
    this._unsubscribeLoaded = null;
  }
  // ... all other unsubscribes
}
```

---

## Phase 5: Pass Panel Context Through Command Chain (MEDIUM)

### 5.1 Add Panel ID to CommandContext

**File:** `src/commands/interfaces.ts`

```typescript
interface CommandContext {
  panelId: string;  // ADD THIS
  fileManager: FileManager;
  boardStore: BoardStore;
  // ...
}
```

### 5.2 Update MessageHandler Construction

**File:** `src/messageHandler.ts`

Ensure panelId is included in context creation.

---

## Phase 6: Testing and Verification

### 6.1 Create Multi-Panel Test Scenarios

1. Open two different kanban files
2. Edit content in Panel A
3. Verify Panel B's file is NOT modified
4. Edit content in Panel B
5. Verify Panel A's file is NOT modified

### 6.2 Stress Testing

1. Rapid edits alternating between panels
2. External file changes while both panels open
3. Close one panel while other is saving

### 6.3 Add Debug Logging

Add temporary logging to verify panel isolation:

```typescript
console.log(`[${this._panelId}] Processing board:changed event from panel ${event.panelId}`);
if (event.panelId !== this._panelId) {
  console.log(`[${this._panelId}] IGNORING event from different panel`);
  return;
}
```

---

## Implementation Order

1. **Phase 1.1-1.2** - Add panel ID infrastructure (low risk)
2. **Phase 1.3-1.4** - Add panel ID to events and filters (CRITICAL FIX)
3. **Phase 4** - Ensure proper cleanup (prevents stale handlers)
4. **Phase 2** - Make singletons panel-aware (prevents shared state issues)
5. **Phase 3** - Fix panel tracking map (prevents overwriting)
6. **Phase 5** - Pass panel context through commands (completeness)
7. **Phase 6** - Testing and verification

---

## Files Requiring Modification

### Core Event System
- [ ] `src/core/events/EventBus.ts` - Add panelId to event types
- [ ] `src/core/events/EventTypes.ts` - Update event interfaces
- [ ] `src/core/events/BoardSyncHandler.ts` - Filter by panelId
- [ ] `src/core/events/FileSyncHandler.ts` - Filter by panelId
- [ ] `src/core/events/FileRegistryChangeHandler.ts` - Filter by panelId
- [ ] `src/core/events/IncludeSyncHandler.ts` - Filter by panelId

### Singleton Services
- [ ] `src/core/FileSaveService.ts` - Add panel context to save keys
- [ ] `src/services/ConflictResolver.ts` - Add panel context to dialog keys
- [ ] `src/SaveEventDispatcher.ts` - Add panel context to handler IDs

### Panel Management
- [ ] `src/kanbanWebviewPanel.ts` - Generate panelId, update tracking map
- [ ] `src/messageHandler.ts` - Include panelId in CommandContext

### Command Interfaces
- [ ] `src/commands/interfaces.ts` - Add panelId to CommandContext

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 | Low | Adding properties is backwards compatible |
| 2 | Medium | Test singleton behavior thoroughly |
| 3 | Medium | Ensure all panel lookups are updated |
| 4 | Low | Cleanup is already partially implemented |
| 5 | Low | Context is already passed through |
| 6 | N/A | Testing only |

---

## Estimated Effort

- Phase 1: 2-3 hours (many files to update)
- Phase 2: 1-2 hours (3 files, careful testing needed)
- Phase 3: 30 minutes
- Phase 4: 30 minutes
- Phase 5: 30 minutes
- Phase 6: 1-2 hours testing

**Total: ~6-8 hours**
