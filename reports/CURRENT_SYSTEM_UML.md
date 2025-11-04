# Current System Architecture - UML Diagrams

**Date**: 2025-11-01
**Status**: BROKEN DESIGN - Needs parameter-based solution

---

## Class Diagram - Save System

```plantuml
@startuml

class MarkdownFile {
  - _content: string
  - _baseline: string
  - _fileWatcher: FileSystemWatcher
  - _isWatching: boolean

  + save(): Promise<void>
  + reload(): Promise<void>
  + writeToDisk(content): Promise<void>
  + handleExternalChange(type): Promise<void>
  + getPath(): string
}

class MainKanbanFile {
  - _cachedBoardFromWebview?: KanbanBoard
  - _board?: KanbanBoard

  + save(): Promise<void>
  + setCachedBoardFromWebview(board): void
  + getCachedBoardFromWebview(): KanbanBoard
  + showConflictDialog(): Promise<Resolution>
}

class SaveCoordinator {
  - legitimateSaves: Map<string, SaveMarking>
  - static instance: SaveCoordinator

  + markSaveAsLegitimate(path: string): void
  + isLegitimateSave(path: string): boolean
  + performSave(file): Promise<void>
}

class UnifiedChangeHandler {
  - saveCoordinator: SaveCoordinator
  - static instance: UnifiedChangeHandler

  + handleExternalChange(file, type): Promise<void>
  + handleFileModified(file): Promise<void>
}

class FileSystemWatcher {
  + onDidChange: Event
  + onDidCreate: Event
  + onDidDelete: Event
}

class kanbanWebviewPanel {
  + save files before content change
  + save files before switch
}

class includeFileManager {
  + save column includes
  + save task includes
}

class messageHandler {
  + save and continue (5 places)
}

class MarkdownFileRegistry {
  + saveAll(): Promise<void>
}

' Relationships
MainKanbanFile --|> MarkdownFile
MarkdownFile --> FileSystemWatcher : watches
MarkdownFile ..> SaveCoordinator : ❌ should mark
UnifiedChangeHandler --> SaveCoordinator : checks marking
FileSystemWatcher ..> MarkdownFile : triggers handleExternalChange

' Callers (15+ places)
kanbanWebviewPanel ..> MarkdownFile : calls save() ❌ no marking
includeFileManager ..> MarkdownFile : calls save() ❌ no marking
messageHandler ..> MarkdownFile : calls save() ❌ no marking
MarkdownFileRegistry ..> MarkdownFile : calls save() ❌ no marking

note right of SaveCoordinator
  PROBLEM: Hidden global state!
  Callers must remember to call
  markSaveAsLegitimate() separately

  85% of callers forget!
end note

@enduml
```

---

## Sequence Diagram - BROKEN Current Flow (Save → Reload Loop)

```plantuml
@startuml

participant "Caller\n(15+ places)" as Caller
participant MarkdownFile
participant FileSystemWatcher
participant UnifiedChangeHandler
participant SaveCoordinator
participant UI

Caller -> MarkdownFile: save()
note right: ❌ Caller forgets to mark!

activate MarkdownFile
MarkdownFile -> MarkdownFile: stopWatching()
MarkdownFile -> MarkdownFile: writeToDisk()
note right: vscode.workspace.fs.writeFile()
MarkdownFile -> MarkdownFile: startWatching()
MarkdownFile --> Caller: done
deactivate MarkdownFile

FileSystemWatcher -> MarkdownFile: onDidChange()
note right: Detects filesystem change

activate MarkdownFile
MarkdownFile -> MarkdownFile: _onFileSystemChange()
MarkdownFile -> MarkdownFile: handleExternalChange()
MarkdownFile -> UnifiedChangeHandler: handleExternalChange()
deactivate MarkdownFile

activate UnifiedChangeHandler
UnifiedChangeHandler -> SaveCoordinator: isLegitimateSave(path)
activate SaveCoordinator
SaveCoordinator --> UnifiedChangeHandler: FALSE ❌
deactivate SaveCoordinator

UnifiedChangeHandler -> MarkdownFile: reload()
note right: WRONG! Triggers reload loop

activate MarkdownFile
MarkdownFile -> MarkdownFile: readFromDisk()
MarkdownFile -> UI: emit 'reloaded'
note right: UI reloads unnecessarily ❌
deactivate MarkdownFile

deactivate UnifiedChangeHandler

@enduml
```

---

## Sequence Diagram - HACKY Current "Fix" (markSaveAsLegitimate)

```plantuml
@startuml

participant Caller
participant SaveCoordinator
participant MarkdownFile
participant FileSystemWatcher
participant UnifiedChangeHandler

Caller -> SaveCoordinator: markSaveAsLegitimate(path)
note right: ❌ Caller must remember!

activate SaveCoordinator
SaveCoordinator -> SaveCoordinator: legitimateSaves.set(path, {...})
SaveCoordinator -> SaveCoordinator: setTimeout(() => delete, 2000ms)
deactivate SaveCoordinator

Caller -> MarkdownFile: save()

activate MarkdownFile
MarkdownFile -> MarkdownFile: writeToDisk()
MarkdownFile --> Caller: done
deactivate MarkdownFile

FileSystemWatcher -> UnifiedChangeHandler: onDidChange()

activate UnifiedChangeHandler
UnifiedChangeHandler -> SaveCoordinator: isLegitimateSave(path)
activate SaveCoordinator
SaveCoordinator -> SaveCoordinator: check legitimateSaves Map
SaveCoordinator --> UnifiedChangeHandler: TRUE ✅
deactivate SaveCoordinator

UnifiedChangeHandler --> UnifiedChangeHandler: return early (no reload)
deactivate UnifiedChangeHandler

note right of SaveCoordinator
  PROBLEM:
  - Hidden global state
  - Temporal coupling (2 sec timeout)
  - Easy to forget marking
  - 85% of callers don't mark!
  - NOT thread-safe
  - Hard to debug
end note

@enduml
```

---

## Component Diagram - The Mess

```plantuml
@startuml

package "File System" {
  [MarkdownFile]
  [MainKanbanFile]
  [IncludeFile]
}

package "Coordination Layer" {
  [SaveCoordinator] <<Singleton>>
  [UnifiedChangeHandler] <<Singleton>>
  [SaveEventCoordinator] <<Singleton>>
}

package "Callers (15+ places)" {
  [kanbanWebviewPanel]
  [includeFileManager]
  [messageHandler]
  [MarkdownFileRegistry]
  [conflictDialog]
}

package "VS Code API" {
  [FileSystemWatcher]
  [workspace.fs.writeFile]
}

[kanbanWebviewPanel] ..> [MarkdownFile] : calls save() ❌
[includeFileManager] ..> [MarkdownFile] : calls save() ❌
[messageHandler] ..> [MarkdownFile] : calls save() ❌
[MarkdownFileRegistry] ..> [MarkdownFile] : calls save() ❌
[conflictDialog] ..> [MarkdownFile] : calls save() ❌

[MarkdownFile] --> [workspace.fs.writeFile] : writes
[workspace.fs.writeFile] ..> [FileSystemWatcher] : triggers
[FileSystemWatcher] ..> [MarkdownFile] : onDidChange
[MarkdownFile] --> [UnifiedChangeHandler] : handleExternalChange
[UnifiedChangeHandler] --> [SaveCoordinator] : isLegitimateSave?

note right of [SaveCoordinator]
  ❌ BROKEN DESIGN:

  Global registry with timeouts
  Callers must mark separately
  No explicit contract
  Hard to test
  Race conditions possible
end note

note left of [MarkdownFile]
  SHOULD BE:

  save(options: {
    markAsLegitimate?: boolean
    source?: 'ui' | 'conflict' | 'system'
  })

  Explicit, testable, clear!
end note

@enduml
```

---

## State Diagram - Save Lifecycle (Current Broken Design)

```plantuml
@startuml

[*] --> Editing : User edits

Editing --> CallerCallsSave : save() triggered
note right of CallerCallsSave
  15+ different callers
  Most forget to mark!
end note

CallerCallsSave --> MarkedAsLegitimate : ❓ Did caller mark?
CallerCallsSave --> NotMarked : ❓ Caller forgot

MarkedAsLegitimate --> WritingToDisk : save() executes
NotMarked --> WritingToDisk : save() executes

WritingToDisk --> FileWatcherFires : filesystem change
note right of FileWatcherFires
  Even though watcher stopped/restarted,
  can still detect the change
end note

FileWatcherFires --> CheckingLegitimacy : handleExternalChange()

CheckingLegitimacy --> ReloadLoop : isLegitimate = false ❌
CheckingLegitimacy --> NoReload : isLegitimate = true ✅

ReloadLoop --> Editing : reload() called\nUI updates\nBROKEN!
NoReload --> Editing : early return\nUI stable

note right of CheckingLegitimacy
  PROBLEM: Decision based on
  hidden global state with timeout

  Not based on save() parameters!
end note

@enduml
```

---

## Call Graph - Who Calls save() (15+ Entry Points)

```
save() Entry Points:
│
├─ kanbanWebviewPanel.ts:1721 ────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Before content change
│
├─ kanbanWebviewPanel.ts:2098 ────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Before switch
│
├─ includeFileManager.ts:162 ─────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Save column include
│
├─ includeFileManager.ts:190 ─────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Save task include
│
├─ messageHandler.ts:1973 ────────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Save and continue
│
├─ messageHandler.ts:2008 ────────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Save old file
│
├─ messageHandler.ts:2234 ────────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Save and switch column
│
├─ messageHandler.ts:2330 ────────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Save and switch column
│
├─ messageHandler.ts:2428 ────────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Save task include
│
├─ MarkdownFileRegistry.ts:302 ───────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ Save all files
│
├─ MarkdownFile.ts:749 ───────────────► [MarkdownFile.save()] ❌ NO MARKING
│   └─ resolveConflict('save')
│
├─ MarkdownFile.ts:797 ───────────────► [MarkdownFile.save()] ✅ MARKS (in conflict dialog)
│   └─ showConflictDialog() → save
│
├─ MainKanbanFile.ts:602 ─────────────► [MainKanbanFile.save()] ✅ MARKS (in conflict dialog)
│   └─ showConflictDialog() → save
│
├─ SaveCoordinator.ts:74 ─────────────► [MarkdownFile.save()] ✅ MARKS (before calling)
│   └─ performSave()
│
└─ ... more places ...

TOTAL: 15+ callers
MARKED: 2 callers (13%)
NOT MARKED: 13+ callers (87%) ❌
```

---

## Data Flow Diagram - Hidden Global State Problem

```
┌─────────────────────────────────────────────────────────────────┐
│                      GLOBAL SHARED STATE                         │
│                   SaveCoordinator (Singleton)                    │
│                                                                   │
│   legitimateSaves: Map<string, {timestamp, timeout}>             │
│                                                                   │
│   ❌ Problems:                                                   │
│   - Race conditions (2 sec timeout)                              │
│   - Hidden coupling                                              │
│   - Hard to test                                                 │
│   - No explicit contract                                         │
│   - Temporal dependency                                          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
           ▲                                    ▲
           │                                    │
           │ markSaveAsLegitimate()            │ isLegitimateSave()
           │                                    │
    ┌──────┴────────┐                  ┌───────┴──────────┐
    │   WRITERS     │                  │    READERS       │
    │               │                  │                  │
    │ - Caller 1    │                  │ - FileWatcher    │
    │ - Caller 2    │                  │ - UnifiedChange  │
    │ - Caller 3    │                  │                  │
    │ - ...         │                  └──────────────────┘
    │ - Caller 15   │
    │               │
    │ ❌ Most forget│
    │    to mark!   │
    └───────────────┘
```

---

## PROPER Design (What It SHOULD Be)

```typescript
// PROPER INTERFACE:

interface SaveOptions {
  // Explicit flag - no hidden marking!
  markAsLegitimate?: boolean;

  // Or better: source context
  source?: 'ui-edit' | 'conflict-resolution' | 'auto-save' | 'external-trigger';

  // Conflict handling
  conflictStrategy?: 'overwrite' | 'merge' | 'ask';

  // Performance
  skipValidation?: boolean;
  skipWatcherPause?: boolean;
}

class MarkdownFile {
  public async save(options: SaveOptions = {}): Promise<void> {
    // EXPLICIT - no hidden side effects!
    const shouldMarkLegitimate = options.markAsLegitimate ??
                                 (options.source === 'ui-edit' || options.source === 'conflict-resolution');

    if (shouldMarkLegitimate) {
      // Mark inline, not globally
      this._isLegitimateOwnSave = true;
    }

    // ... save logic ...
  }

  private handleExternalChange(): void {
    // Check explicit flag, not global registry
    if (this._isLegitimateOwnSave) {
      this._isLegitimateOwnSave = false;
      return; // Skip reload
    }

    // ... handle actual external change ...
  }
}

// CLEAN USAGE:

// UI edit
await file.save({ markAsLegitimate: true });

// Or with source
await file.save({ source: 'ui-edit' }); // Auto-marks as legitimate

// Conflict resolution
await file.save({ source: 'conflict-resolution', conflictStrategy: 'overwrite' });

// External trigger (shouldn't mark)
await file.save({ source: 'external-trigger' });
```

---

## Summary - Current Design Flaws

### ❌ Problems with Current Design

1. **Hidden Global State**: SaveCoordinator singleton with Map
2. **Temporal Coupling**: 2-second timeout to clear markings
3. **No Explicit Contract**: Callers must "remember" to mark
4. **85% Failure Rate**: 13 of 15 callers don't mark
5. **Hard to Test**: Global state, timeouts, race conditions
6. **Not Thread-Safe**: Multiple saves can conflict
7. **Hard to Debug**: Hidden side effects
8. **Violates SRP**: Save() does saving, marking is separate

### ✅ What SHOULD Happen

1. **Explicit Parameters**: `save(options: SaveOptions)`
2. **No Global State**: Instance-level flags
3. **Clear Contract**: Parameters document intent
4. **Self-Contained**: Each save knows its own legitimacy
5. **Testable**: No singletons, no timeouts
6. **Thread-Safe**: No shared mutable state
7. **Debuggable**: Explicit parameters in logs
8. **SRP**: Save logic includes legitimacy decision

---

**Current Status**: 🔴 **FUNDAMENTALLY BROKEN ARCHITECTURE**

The markSaveAsLegitimate() pattern is a band-aid on a design flaw. Need parameter-based solution!
