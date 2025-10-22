# Data Instances Documentation

This document catalogs ALL singleton instances, global state, and data instances (actual runtime instances, not just type definitions) in the Markdown Kanban Obsidian extension.

**Last Updated:** 2025-10-21

---

## 1. SINGLETON INSTANCES

### 1.1 FileStateManager
**File:** `/src/fileStateManager.ts`
**Lines:** 68-78

**Instance Name:** `FileStateManager.instance`
**Type:** `FileStateManager` (singleton)
**Scope:** Singleton - accessible via `getInstance()`

**Purpose:**
- Central state manager for all file tracking (main and include files)
- Tracks backend state (file system & VS Code editor changes)
- Tracks frontend state (Kanban UI modifications)
- Manages conflict detection and resolution logic

**Data Held:**
```typescript
private static instance: FileStateManager;
private fileStates: Map<string, FileState> = new Map();
```

**Key Data:**
- `fileStates`: Map of file paths to FileState objects containing:
  - Backend state: exists, lastModified, isDirtyInEditor, documentVersion, hasFileSystemChanges
  - Frontend state: hasUnsavedChanges, content, baseline, isInEditMode
  - Computed state: needsReload, needsSave, hasConflict

---

### 1.2 ExternalFileWatcher
**File:** `/src/externalFileWatcher.ts`
**Lines:** 27-52

**Instance Name:** `ExternalFileWatcher.instance`
**Type:** `ExternalFileWatcher` (singleton)
**Scope:** Singleton - accessible via `getInstance()`

**Purpose:**
- Centralized file watcher system for all external file changes
- Monitors main kanban files and include files
- Replaces multiple individual file watching systems
- Registers with SaveEventCoordinator for immediate change detection

**Data Held:**
```typescript
private static instance: ExternalFileWatcher | undefined;
private watchers: Map<string, vscode.FileSystemWatcher> = new Map();
private watchedFiles: Map<string, WatchedFile> = new Map();
private disposables: vscode.Disposable[] = [];
private fileListenerEnabled: boolean = true;
private _onFileChanged = new vscode.EventEmitter<FileChangeEvent>();
```

**Key Data:**
- `watchers`: Map of file paths to VS Code FileSystemWatcher instances
- `watchedFiles`: Map of file paths to WatchedFile objects (contains path, type, Set of panels)
- `disposables`: Array of disposable resources
- `fileListenerEnabled`: Global toggle for file watching
- `_onFileChanged`: Event emitter for file change notifications

---

### 1.3 SaveEventCoordinator
**File:** `/src/saveEventCoordinator.ts`
**Lines:** 33-47

**Instance Name:** `SaveEventCoordinator.instance`
**Type:** `SaveEventCoordinator` (singleton)
**Scope:** Singleton - accessible via `getInstance()`

**Purpose:**
- Centralized coordinator for all document save events
- Replaces multiple individual onDidSaveTextDocument listeners
- Dispatches save events to registered handlers
- Eliminates duplication between ExternalFileWatcher, KanbanWebviewPanel, and MessageHandler

**Data Held:**
```typescript
private static instance: SaveEventCoordinator | undefined;
private saveListener: vscode.Disposable | null = null;
private handlers: Map<string, SaveEventHandler> = new Map();
```

**Key Data:**
- `saveListener`: Single VS Code save event listener
- `handlers`: Map of handler IDs to SaveEventHandler objects

---

### 1.4 ConflictResolver
**File:** `/src/conflictResolver.ts`
**Lines:** 58-70

**Instance Name:** `ConflictResolver.instance`
**Type:** `ConflictResolver` (singleton)
**Scope:** Singleton - accessible via `getInstance()`

**Purpose:**
- Centralized conflict resolution system
- Handles all file change protection scenarios
- Prevents multiple dialog appearances through deduplication
- Manages dialogs for panel close, external changes, pre-save checks

**Data Held:**
```typescript
private static instance: ConflictResolver | undefined;
private activeDialogs = new Set<string>();
private pendingResolutions = new Map<string, Promise<ConflictResolution>>();
```

**Key Data:**
- `activeDialogs`: Set of active dialog keys (for deduplication)
- `pendingResolutions`: Map of dialog keys to pending resolution promises

---

### 1.5 ConfigurationService
**File:** `/src/configurationService.ts`
**Lines:** 78-132

**Instance Name:** `ConfigurationService.instance` (exported as `configService`)
**Type:** `ConfigurationService` (singleton)
**Scope:** Singleton - accessible via `getInstance()` or exported `configService`

**Purpose:**
- Centralized configuration service for all VS Code settings
- Provides unified access with caching and type safety
- Listens for configuration changes and clears cache accordingly

**Data Held:**
```typescript
private static instance: ConfigurationService;
private cache: Map<string, any> = new Map();
private readonly CONFIGURATION_SECTION = 'markdown-kanban';
private readonly defaults: ConfigurationDefaults = { /* ... */ };
```

**Key Data:**
- `cache`: Map of configuration keys to cached values
- `defaults`: Default configuration values object
- Caches all user settings from VS Code workspace configuration

---

### 1.6 MarpExportService
**File:** `/src/services/MarpExportService.ts`
**Lines:** 30-34

**Instance Name:** `MarpExportService.marpProcessPids`
**Type:** Static class data
**Scope:** Module-level (static class member)

**Purpose:**
- Track Marp CLI process PIDs for watch mode
- Allows stopping/managing long-running Marp preview processes

**Data Held:**
```typescript
private static marpProcessPids = new Map<string, number>();
```

**Key Data:**
- Map of file paths to Marp process PIDs

---

## 2. STATIC PANEL REGISTRY (KanbanWebviewPanel)

### 2.1 KanbanWebviewPanel Static Registry
**File:** `/src/kanbanWebviewPanel.ts`
**Lines:** 23-24

**Instance Name:** Multiple static class members
**Type:** Static class data
**Scope:** Module-level (static class members)

**Purpose:**
- Track all active webview panels across the extension
- Map document URIs to their corresponding panels
- Store panel states for serialization/revival
- Track revived URIs to prevent duplicate panels

**Data Held:**
```typescript
private static panels: Map<string, KanbanWebviewPanel> = new Map();
private static panelStates: Map<string, any> = new Map();
private static _revivedUris: Set<string> = new Set();
```

**Key Data:**
- `panels`: Map of document URI strings to KanbanWebviewPanel instances
- `panelStates`: Map of document URI strings to serialized panel state
- `_revivedUris`: Set of URIs that have been revived from saved state

---

## 3. CLASS MEMBER DATA INSTANCES

### 3.1 KanbanWebviewPanel Instance Data
**File:** `/src/kanbanWebviewPanel.ts`
**Lines:** 30-70

**Instance Name:** Various private members per panel instance
**Type:** Class instance members
**Scope:** Per KanbanWebviewPanel instance

**Purpose:**
- Manage individual panel state and operations
- Track document changes, unsaved state, file watching
- Coordinate between frontend (webview) and backend (VS Code)

**Data Held:**
```typescript
private _disposables: vscode.Disposable[] = [];
private _board?: KanbanBoard;
private _isInitialized: boolean = false;
private _lastDocumentVersion: number = -1;
private _isUndoRedoOperation: boolean = false;
private _unsavedChangesCheckInterval?: NodeJS.Timeout;
private _hasUnsavedChanges: boolean = false;
private _cachedBoardFromWebview: any = null;
private _isClosingPrevented: boolean = false;
private _lastDocumentUri?: string;
private _filesToRemoveAfterSave: string[] = [];
private _unsavedFilesToPrompt: string[] = [];
private _panelId: string;
private _trackedDocumentUri: string | undefined;
private _recentlyReloadedFiles: Set<string> = new Set();
private _activeConflictDialog: Promise<any> | null = null;
private _lastDialogTimestamp: number = 0;
private _lastKnownFileContent: string = '';
private _hasExternalUnsavedChanges: boolean = false;
```

**Key Instance Data:**
- `_disposables`: Array of VS Code disposables for cleanup
- `_board`: Current parsed KanbanBoard object
- `_cachedBoardFromWebview`: Latest board state from frontend
- `_filesToRemoveAfterSave`: Array of file paths to clean up
- `_unsavedFilesToPrompt`: Array of files needing user confirmation
- `_recentlyReloadedFiles`: Set of recently reloaded file paths

---

### 3.2 MessageHandler Instance Data
**File:** `/src/messageHandler.ts`
**Lines:** 26-42

**Instance Name:** MessageHandler instance members
**Type:** Class instance members
**Scope:** Per MessageHandler instance (one per KanbanWebviewPanel)

**Purpose:**
- Track active operations (for progress tracking)
- Store auto-export settings
- Cache previous board state for focus restoration

**Data Held:**
```typescript
private _previousBoardForFocus?: KanbanBoard;
private _activeOperations = new Map<string, { type: string, startTime: number }>();
private _autoExportSettings: any = null;
```

**Key Data:**
- `_activeOperations`: Map of operation IDs to operation metadata (type, startTime)
- `_autoExportSettings`: Auto-export configuration object
- `_previousBoardForFocus`: Cached board for UI focus operations

---

### 3.3 BackupManager Instance Data
**File:** `/src/backupManager.ts`
**Lines:** 13-16

**Instance Name:** BackupManager instance members
**Type:** Class instance members
**Scope:** Per BackupManager instance (one per KanbanWebviewPanel)

**Purpose:**
- Manage backup timing and content tracking
- Track when backups were last created
- Detect content changes to avoid duplicate backups

**Data Held:**
```typescript
private _backupTimer: NodeJS.Timer | null = null;
private _lastBackupTime: Date | null = null;
private _lastContentHash: string | null = null;
private _lastUnsavedChangeTime: Date | null = null;
```

**Key Data:**
- `_backupTimer`: NodeJS timer for periodic backups
- `_lastBackupTime`: Timestamp of last backup creation
- `_lastContentHash`: Hash of last backed-up content
- `_lastUnsavedChangeTime`: Timestamp when unsaved changes occurred

---

### 3.4 UndoRedoManager Instance Data
**File:** `/src/undoRedoManager.ts`
**Lines:** 8-13

**Instance Name:** UndoRedoManager instance members
**Type:** Class instance members
**Scope:** Per UndoRedoManager instance (one per KanbanWebviewPanel)

**Purpose:**
- Maintain undo/redo history for board operations
- Track board state snapshots
- Enable undo/redo functionality in the UI

**Data Held:**
```typescript
private _undoStack: KanbanBoard[] = [];
private _redoStack: KanbanBoard[] = [];
private readonly _maxUndoStackSize = 100;
private _webview: vscode.Webview;
private _document?: vscode.TextDocument;
```

**Key Data:**
- `_undoStack`: Array of KanbanBoard snapshots (max 100)
- `_redoStack`: Array of KanbanBoard snapshots for redo operations

---

### 3.5 BoardOperations Instance Data
**File:** `/src/boardOperations.ts`
**Lines:** 4-5

**Instance Name:** BoardOperations instance members
**Type:** Class instance members
**Scope:** Per BoardOperations instance (one per KanbanWebviewPanel)

**Purpose:**
- Track original task ordering for operations
- Maintain state during drag-and-drop and reordering

**Data Held:**
```typescript
private _originalTaskOrder: Map<string, string[]> = new Map();
```

**Key Data:**
- `_originalTaskOrder`: Map of column IDs to arrays of task IDs (original order)

---

### 3.6 FileManager Instance Data
**File:** `/src/fileManager.ts`
**Lines:** 34-38

**Instance Name:** FileManager instance members
**Type:** Class instance members
**Scope:** Per FileManager instance (one per KanbanWebviewPanel)

**Purpose:**
- Track current document and file path
- Manage file lock state
- Store references to VS Code resources

**Data Held:**
```typescript
private _document?: vscode.TextDocument;
private _filePath?: string;
private _isFileLocked: boolean = false;
private _webview: vscode.Webview;
private _extensionUri: vscode.Uri;
```

**Key Data:**
- `_document`: Current VS Code TextDocument
- `_filePath`: File path (persists even when document is closed)
- `_isFileLocked`: File lock state

---

## 4. MODULE-LEVEL VARIABLES

### 4.1 Extension Module State
**File:** `/src/extension.ts`
**Lines:** 8-30

**Instance Name:** Various module-level variables
**Type:** Function-scoped variables
**Scope:** Module-level (within activate function)

**Purpose:**
- Track extension-level state during activation
- Store global file listener status
- Maintain references to key services

**Data Held:**
```typescript
let fileListenerEnabled = true;
const fileWatcher = ExternalFileWatcher.getInstance();
(globalThis as any).kanbanFileListener = {
    getStatus: getFileListenerStatus,
    setStatus: setFileListenerStatus
};
```

**Key Data:**
- `fileListenerEnabled`: Boolean flag for global file listening
- `fileWatcher`: Reference to singleton ExternalFileWatcher
- `globalThis.kanbanFileListener`: Global object exposed for file listener control

---

## 5. STATIC CONSTANTS & DATA

### 5.1 ExportService Static Data
**File:** `/src/exportService.ts`
**Lines:** 98-100

**Instance Name:** Static readonly arrays
**Type:** Static class constants
**Scope:** Module-level (static class members)

**Purpose:**
- Define file type categories for asset detection
- Used throughout export operations

**Data Held:**
```typescript
private static readonly IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];
private static readonly VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
```

---

## SUMMARY STATISTICS

**Total Singleton Instances:** 6
- FileStateManager
- ExternalFileWatcher
- SaveEventCoordinator
- ConflictResolver
- ConfigurationService
- MarpExportService (process tracking)

**Static Class Registries:** 1
- KanbanWebviewPanel (panels, panelStates, _revivedUris)

**Per-Panel Instance Data Holders:** 6
- KanbanWebviewPanel (19 instance fields)
- MessageHandler (3 instance fields)
- BackupManager (4 instance fields)
- UndoRedoManager (2 stacks + 3 fields)
- BoardOperations (1 Map)
- FileManager (5 instance fields)

**Module-Level State:** 1
- Extension activation state (fileListenerEnabled, globalThis.kanbanFileListener)

**Total Data Instances Documented:** 14 major categories

---

## KEY INSIGHTS

1. **Singleton Pattern Dominance:** Most state management uses singleton pattern for centralization
2. **Per-Panel Duplication:** Each webview panel maintains its own instance of managers (Backup, Undo, Board Operations, File, Message)
3. **Global Registry:** KanbanWebviewPanel maintains static maps to track all active panels
4. **Event Coordination:** SaveEventCoordinator and ExternalFileWatcher centralize event handling to prevent duplication
5. **State Separation:** FileStateManager separates backend (file system) from frontend (UI) state tracking

## POTENTIAL ISSUES

1. **Memory Leaks Risk:** Multiple panels can accumulate state in singleton maps if not properly cleaned up
2. **Circular References:** Panel instances reference singletons, singletons track panels
3. **State Synchronization:** State is distributed across FileStateManager singleton and per-panel instances
4. **Global State Pollution:** `globalThis.kanbanFileListener` exposes internal state globally

---

**End of Documentation**
