# Kanban Extension Function Reference

This document lists all functions and methods in the TypeScript codebase for the Markdown Kanban extension.

**Last Updated:** 2026-01-28

## Format
Each entry follows: `path_to_filename-classname_functionname` or `path_to_filename-functionname` (when not in a class)

---

## Recent Updates (2026-01-28) - Puppeteer → Playwright Migration

### New File: `src/services/BrowserService.ts`
Centralized browser detection & management for Playwright-based features (Excalidraw, Handout PDF).

**Static Methods:**
- `BrowserService.findBrowserExecutable()` - Resolves browser path: user config → system Chrome/Chromium → Playwright-managed browser
- `BrowserService.ensureBrowser()` - Calls findBrowserExecutable(); if not found, runs `npx playwright install chromium` then retries
- `BrowserService.launchHeadless(options?)` - Convenience: resolves path and launches headless Playwright browser

### Updates to `src/services/export/ExcalidrawService.ts`
- `ExcalidrawService.convertToSVG()` now resolves browser path via `BrowserService.ensureBrowser()` and passes `browserPath` in stdin JSON to the worker

### Updates to `src/services/export/excalidraw-worker.js`
- Migrated from Puppeteer to Playwright (`chromium.launch`)
- Accepts `browserPath` in stdin JSON for explicit executable path
- Changed `waitUntil: 'networkidle0'` → `waitUntil: 'networkidle'` (Playwright API)

### Updates to `marp-engine/engine/handout-postprocess.js`
- Migrated from Puppeteer to Playwright (`chromium.launch`)
- Reads `BROWSER_PATH` environment variable for executable path
- Changed `headless: 'new'` → `headless: true` (Playwright API)
- Changed `waitUntil: 'networkidle0'` → `waitUntil: 'networkidle'` (Playwright API)

### Updates to `src/services/ConfigurationService.ts`
- Added `browser: { executablePath: string }` to `KanbanConfiguration` interface
- Added default `browser: { executablePath: '' }` (auto-detect)

---

## Recent Updates (2026-01-28) - Excel Spreadsheet Embedding Feature

### New File: `src/services/export/XlsxService.ts`
Service for converting Excel spreadsheets (.xlsx, .xls, .ods) to PNG images using LibreOffice CLI.

**Methods:**
- `XlsxService.getConfigKey()` - Returns 'libreOfficePath' config key
- `XlsxService.getDefaultCliName()` - Returns 'soffice' CLI name
- `XlsxService.getServiceName()` - Returns 'XlsxService' for logging
- `XlsxService.getVersionCheckArgs()` - Returns ['--version'] for CLI check
- `XlsxService.getCliNotFoundWarning()` - Returns LibreOffice installation warning
- `XlsxService.getInstallationUrl()` - Returns LibreOffice download URL
- `XlsxService.getCommonPaths()` - Returns platform-specific LibreOffice paths
- `XlsxService.showCliWarning()` - Shows platform-specific installation instructions
- `XlsxService.renderPNG(filePath, sheetNumber)` - Converts xlsx to PNG using LibreOffice
- `XlsxService.findSheetOutputFile(tempDir, baseName, sheetNumber)` - Finds output file for specific sheet
- `XlsxService.cleanupGeneratedFiles(tempDir, baseName)` - Cleans up temp PNG files
- `XlsxService.getSupportedExtensions()` - Returns ['.xlsx', '.xls', '.ods']

### Updates to `src/shared/regexPatterns.ts`
- Added `DiagramPatterns.xlsx()` - Regex pattern for Excel file references with optional attributes: `![alt](path.xlsx "title"){page=1}`

### Updates to `src/services/export/DiagramPreprocessor.ts`
- Added `XlsxService` import and instance
- Extended `DiagramBlock` interface with `'xlsx'` type and `attributes` property
- Added xlsx extraction in `extractAllDiagrams()` with attribute parsing
- Added `renderXlsxBatch()` method for parallel xlsx rendering to PNG
- Added xlsx case to `getUnconvertedDiagramNote()` for error messages

### Updates to `src/commands/DiagramCommands.ts`
- Added `RequestXlsxRenderMessage` import
- Added `'requestXlsxRender'` to metadata messageTypes
- Added `handleRenderXlsx()` handler for webview xlsx render requests

### Updates to `src/core/bridge/MessageTypes.ts`
- Added `RequestXlsxRenderMessage` interface for xlsx render requests
- Added `RequestXlsxRenderMessage` to `IncomingMessage` union type

### Updates to `src/html/markdownRenderer.js`
- Added `renderXlsxSheet(filePath, sheetNumber, includeDir)` - Requests xlsx render from backend
- Added `queueXlsxRender(id, filePath, sheetNumber, includeDir)` - Queues xlsx for async rendering
- Added xlsx file detection in image rendering (`.xlsx`, `.xls`, `.ods` extensions)
- Added xlsx case to `processDiagramQueue()` render logic
- Added xlsx message handlers for `xlsxRenderSuccess` and `xlsxRenderError`
- Added xlsx to error type labels

**Usage Syntax:** `![optional alt](path/to/spreadsheet.xlsx){page=2 width=400px}`
- `page=N` selects sheet number (1-indexed, default: 1)
- Standard image attributes (width, height, etc.) are supported

**Dependencies:** LibreOffice CLI (user-installed)

---

## Recent Updates (2026-01-27)
- `src/services/export/ExportService.ts` adds `excludeTags?: string[]` to `NewExportOptions` interface for excluding content from export.
- `src/services/export/ExportService.ts` adds `hasExcludeTag()` - helper to check if text contains any exclude tag using word boundary matching.
- `src/services/export/ExportService.ts` adds `filterExcludedFromBoard()` - filters board object by removing columns, tasks, and task content lines containing exclude tags.
- `src/services/export/ExportService.ts` adds `filterExcludedFromMarkdown()` - filters raw markdown by removing columns, task blocks, and lines containing exclude tags.
- `src/services/export/ExportService.ts` `transformContent()` now integrates exclude tag filtering in all three paths (board-based, file-based, simple).
- `src/html/exportMarpUI.js` adds `parseExcludeTags()` - parses comma-separated tags input into normalized array.
- `src/html/exportMarpUI.js` adds localStorage persistence for export exclude settings (enabled toggle + tag list).
- `src/html/webview.html` adds export exclude UI: toggle checkbox and comma-separated tag input field.

---

## Recent Updates (2026-01-07)
- `src/kanbanSearchProvider.ts` now renders the search mode buttons with Search on the left and Broken on the right.
- `src/html/searchPanel.js` now keeps the current search on Ctrl/Cmd+F (selects text), and supports Ctrl+G / Ctrl+Shift+G to navigate results with an active highlight; `src/html/searchPanel.css` styles the active result.
- `src/kanbanSearchProvider.ts` now searches regular include file contents (include-regular) and uses `src/html` assets in development when available; `src/services/BoardContentScanner.ts` accepts include content maps to search within regular include files.
- `src/kanbanSearchProvider.ts` and `src/html/searchPanel.js` now default the sidebar search panel to text search mode on load.
- `src/services/BoardContentScanner.ts` now de-duplicates broken include results by type/path/location to avoid duplicate entries in the broken embedded search.
- `src/html/webview.html` file search modal now guards option updates when controls are missing, preventing classList null errors.
- `src/html/webview.js` `scrollToAndHighlight()` now targets `.task-item` and `.kanban-full-height-column` selectors to match the actual DOM and find search results reliably.
- `src/kanbanWebviewPanel.ts` now tracks the last active panel and exposes `getActivePanel()` so search/navigation targets the correct board; `src/kanbanSearchProvider.ts` remembers the panel used for search results and navigates within it.
- `src/kanbanSearchProvider.ts` now reveals the main kanban webview panel before navigating to a search result, ensuring focus switches to the board.
- `src/commands/UICommands.ts` now handles `openSearchPanel` messages to reveal the Kanban Search sidebar, and `src/html/webview.js` routes Ctrl/Cmd+F to that sidebar instead of the in-webview search overlay.
- `src/kanbanWebviewPanel.ts` now initializes PanelContext, ConcurrencyManager, and WebviewBridge debug mode as disabled by default (debug must be toggled manually).
- `src/html/taskEditor.js` now handles Tab/Shift+Tab to indent/unindent with spaces (no field switching) and Alt+Enter to end editing; indentation uses a two-space unit and preserves selections.
- `src/html/webview.html` version menu item now toggles debug mode via click, and `src/html/webview.js` updates the displayed version to append "(debug)" while active.
- `src/html/webview.js` now maintains `window.kanbanDebug` state and sends `setDebugMode` messages to the backend on toggle; board updates apply debugMode and refresh the version label.
- `src/core/bridge/MessageTypes.ts` adds `debugMode` to `BoardUpdateMessage` and introduces `SetDebugModeMessage` for frontend-initiated debug toggles.
- `src/commands/DebugCommands.ts` now handles `setDebugMode` messages to enable/disable backend debug logging.
- `src/kanbanWebviewPanel.ts` adds `setDebugMode()` and `getDebugMode()` to update PanelContext, ConcurrencyManager, WebviewBridge, and EventBus debug flags.
- `src/panel/PanelContext.ts` adds `debugMode` getter and `setDebugMode()` for runtime debug toggling.
- `src/panel/ConcurrencyManager.ts` and `src/core/bridge/WebviewBridge.ts` now support runtime debug mode changes.
- `src/services/WebviewUpdateService.ts` includes `debugMode` in board updates to keep webview debug state in sync after reloads.
- `src/panel/IncludeFileCoordinator.ts`, `src/core/events/BoardSyncHandler.ts`, `src/html/webview.js`, `src/html/boardRenderer.js`, and `src/html/markdown-it-include-browser.js` now gate verbose debug logs behind the debug mode flag.
- `src/core/events/BoardSyncHandler.ts` `_handleBoardChanged()` and `_propagateEditsToIncludeFiles()` now log undo/redo execution order and include update/missing paths, and resolve include paths via decoded lookups for undo/redo.
- `src/files/MarkdownFileRegistry.ts` `generateBoard()` now resolves include files using decoded paths with absolute fallbacks to keep include columns/tasks in sync.
- `src/panel/IncludeFileCoordinator.ts` `_sendColumnIncludeUpdate()` and `_sendTaskIncludeUpdate()` now match include references against both relative and absolute paths to avoid missed updates.
- `src/commands/UICommands.ts` `handleUndo()` and `handleRedo()` now log when they emit board:changed for undo/redo sequencing.
- `src/services/WebviewUpdateService.ts` `sendBoardUpdate()` now logs refresh options to track post-undo full refreshes.
- `src/kanbanFileService.ts` `setupDocumentChangeListener()` now syncs cached include-file content into newly opened include documents when they have unsaved changes (absolute/relative lookup), preventing stale disk content after undo.
- `src/commands/FileCommands.ts` `handleOpenFileLink()` and `handleOpenIncludeFile()` now apply cached include-file content to opened editors when the include file has unsaved changes, keeping include file views consistent after undo.
- `src/core/events/BoardSyncHandler.ts` `_propagateEditsToIncludeFiles()` now compares include content against current cached content (not baseline) so undo restores include file content correctly, and updates open include documents to keep editors in sync.
- `src/html/webview.js` updateColumnContent handler now logs cache/column state, task IDs, and clears stale loading/error flags when task payloads arrive (fixed switch scoping to avoid syntax errors).
- `src/html/boardRenderer.js` `renderSingleColumn()` now logs rendered task IDs after replacement to compare DOM vs data.
- `src/html/boardRenderer.js` `renderSingleColumn()` now logs missing DOM elements and triggers a full re-render from cached board when the column element is missing.
- `src/commands/UICommands.ts` `tryTargetedUpdate()` now logs per-column target resolution for undo/redo column updates.
- `src/panel/WebviewManager.ts` `generateHtml()` now prefers `src/html` assets in development when available, falling back to `dist/src/html` for generated files.
- `src/extension.ts` now refreshes all webview panels on `src/html` file changes in development mode to keep assets current.
- `src/panel/WebviewManager.ts` `generateHtml()` now preserves `enableCommandUris` when setting webview options.
- `src/commands/CommandRegistry.ts` now orders handlers per message type by priority and respects `canHandle()` when dispatching.
- `src/services/WebviewUpdateService.ts` now reads extension version from VS Code extension metadata instead of a local package.json require.
- `src/core/stores/UndoCapture.ts` added `TaskMovePayload` + `forTaskMove()` to capture drag move positions for undo/redo.
- `src/core/stores/BoardStore.ts` added `cloneBoard()` helper for undo/redo state snapshots.
- `src/commands/EditModeCommands.ts` now captures drag move undo entries whenever from/to columns are available, resolving indices from the saved board when needed.
- `src/commands/UICommands.ts` now logs redo stack state and redo results for debugging.
- `src/html/dragDrop.js` now logs task drag undo payloads for troubleshooting.
- `src/core/stores/BoardStore.ts` now logs task-move undo payloads and targets.
- `src/commands/UICommands.ts` now logs targeted column update ids for undo/redo updates.
- `src/commands/EditModeCommands.ts` now logs resolved drag undo payload values.

---

## Recent Critical Fixes & New Functions (State Consolidation)

### PanelContext: Unified Panel State Management (2025-12-14)

**File:** [src/panel/PanelContext.ts](src/panel/PanelContext.ts)

**Purpose:** Consolidates PanelStateModel and DocumentStateModel into a single source of truth for all panel-related state. Eliminates state duplication and coordination bugs between KanbanWebviewPanel and KanbanFileService.

**Panel Flag Properties:**
- `initialized` - Panel has completed initialization
- `updatingFromPanel` - Currently updating from webview
- `undoRedoOperation` - Undo/redo in progress
- `closingPrevented` - Panel close prevented for unsaved changes
- `disposed` - Panel has been disposed
- `editingInProgress` - User is editing content
- `initialBoardLoad` - First board load in progress
- `includeSwitchInProgress` - Include file switch in progress
- `webviewReady` - Webview is ready to receive messages

**Document State Properties:**
- `lastDocumentVersion` - Tracked document version
- `lastDocumentUri` - Last loaded document URI
- `trackedDocumentUri` - URI for panel tracking/mapping
- `pendingBoardUpdate` - Queued board update for webview
- `panelId` - Unique panel identifier

**Public Methods:**
- `constructor(panelId?, debugMode?)` - Create new instance
- Flag setters: `setInitialized()`, `setUpdatingFromPanel()`, etc.
- Document setters: `setLastDocumentVersion()`, `setLastDocumentUri()`, etc.
- `consumePendingBoardUpdate()` - Get and clear pending update atomically
- `toSnapshot()` - Create serializable snapshot for panel restoration
- `fromSnapshot(snapshot)` - Restore state from snapshot
- `static fromSnapshot(snapshot, debugMode?)` - Create new instance from snapshot

**Interfaces:**
- `PendingBoardUpdate` - Structure for queued board updates (applyDefaultFolding, isFullRefresh)
- `PanelContextSnapshot` - Serializable state for persistence

**Integration:**
- Created in `KanbanWebviewPanel` constructor
- Passed to `KanbanFileService` constructor (shared reference)
- Both classes access same instance directly (no sync needed)

**Benefits:**
- Single source of truth (eliminates sync bugs)
- Combines panel flags + document tracking in one place
- Supports serialization for panel restoration
- Debug mode logging for state changes

---

### Event-Driven Board Sync: EventBus Architecture (2025-12-18)

**Files:**
- [src/core/events/EventBus.ts](src/core/events/EventBus.ts) - Central pub/sub event bus
- [src/core/events/EventTypes.ts](src/core/events/EventTypes.ts) - Event type definitions
- [src/core/events/BoardSyncHandler.ts](src/core/events/BoardSyncHandler.ts) - Handles board:changed, board:loaded events
- [src/core/events/FileSyncHandler.ts](src/core/events/FileSyncHandler.ts) - Handles focus:gained, unified INIT/FOCUS sync
- [src/core/events/FileRegistryChangeHandler.ts](src/core/events/FileRegistryChangeHandler.ts) - Routes file reload events and registers new include files after main file reload
- [src/kanbanWebviewPanel.ts](src/kanbanWebviewPanel.ts) - Emits events, creates handlers
- [src/commands/interfaces/MessageCommand.ts](src/commands/interfaces/MessageCommand.ts) - `BoardContext.emitBoardChanged`
- All command files in [src/commands/](src/commands/) - Use `context.emitBoardChanged()`

**Purpose:** Replaced direct sync function calls with event-driven architecture for cleaner decoupling.

**Old Pattern (DELETED):**
```typescript
// Commands called this directly
context.syncBoardToBackend(board);
```

**New Pattern:**
```typescript
// Commands emit events
context.emitBoardChanged(board, 'edit');  // or 'undo', 'redo', 'template', 'sort', etc.
```

**What BoardSyncHandler Does (handles board:changed events):**
1. Normalizes board (sorts columns by row)
2. Updates `boardStore` with the board
3. Updates `MainKanbanFile.cachedBoardFromWebview` for conflict detection
4. Updates include file content from board
5. Generates markdown and updates `MainKanbanFile._content`
6. Updates media tracking
7. Creates auto-backup

**Event Types:**
- `board:changed` - Board state changed (triggers full sync)
- `board:loaded` - Board initially loaded (triggers media tracking update)
- `focus:gained` - Panel gained focus (triggers external change detection)
- `file:content-changed` - File content updated in memory
- `media:changed` - Media file changed

**Handler Subscriptions:**

*BoardSyncHandler:*
- `board:changed` - Performs full sync (normalize, save, backup)
- `board:loaded` - Updates media tracking for include files

*FileSyncHandler:*
- `focus:gained` - Checks for external file changes and reloads if needed
  - External changes now route through `handleExternalChange()` to preserve conflict handling and avoid baseline overwrites

**Unified INIT/FOCUS Code Path:**
Both INIT (initial load) and FOCUS (window focus) now use `FileSyncHandler.syncAllFiles()`:
- INIT: `syncAllFiles({ force: true })` - Load all include files
- FOCUS: `syncAllFiles({ force: false })` - Check and reload only changed files

**Migrated Functions:**
- `syncBoardToBackend()` → `BoardSyncHandler._handleBoardChanged()`
- `trackIncludeFileUnsavedChanges()` → `BoardSyncHandler._updateIncludeFileContent()`
- `_updateMediaTrackingFromIncludes()` → `BoardSyncHandler._updateMediaTrackingFromIncludes()`
- `_checkIncludeFilesForExternalChanges()` → `FileSyncHandler._syncIncludeFiles()`
- `_checkMediaFilesForChanges()` → `FileSyncHandler._syncMediaFiles()`
- `loadIncludeContentAsync()` → `FileSyncHandler.syncAllFiles({ force: true })`

**Benefits:**
- Decoupled components (commands don't need to know sync details)
- Single handler for all board changes
- Easy to add new listeners for events
- Better debugging via event log
- No more duplicate code (all sync logic in handlers)
- **INIT and FOCUS share the same unified code path**

---

## Recent Critical Fixes & New Functions (Phase 1-7)

### Phase 7: Marp Style Template System (2025-11-13)

#### MARP-STYLES: Configurable CSS Class Directives
**Files:**
- [src/services/export/PresentationGenerator.ts](src/services/export/PresentationGenerator.ts)
- [src/configurationService.ts](src/configurationService.ts)
- [package.json](package.json)

**New Configuration Settings:**
- `marp.availableClasses` - List of available CSS class names (default: font8-80, invert, center, highlight, etc.)
- `marp.globalClasses` - Global CSS classes applied to all slides via YAML frontmatter (`class: ...`)
- `marp.localClasses` - Local CSS classes applied to specific slides via scoped directive (`<!-- _class: ... -->`)

**Modified Interfaces:**
- `MarpOptions` - Extended to include:
  - `globalClasses?: string[]` - Classes for all slides
  - `localClasses?: string[]` - Classes for specific slides
  - `perSlideClasses?: Map<number, string[]>` - Per-slide class overrides

**Modified Functions:**
- `PresentationGenerator.formatOutput()` - Now injects local class directives before slide content
- `PresentationGenerator.buildYamlFrontmatter()` - Now adds global class directive to YAML
- `ExportService` (lines 1057-1067, 1627-1638) - Reads config and passes classes to PresentationGenerator

**How It Works:**
1. User configures classes in VS Code settings
2. During Marp export, global classes are added to YAML frontmatter: `class: "font24 center"`
3. Local classes are injected as scoped directives: `<!-- _class: invert highlight -->`
4. Per-slide overrides allow fine-grained control per slide index

**Benefits:**
- No manual directive editing required
- Theme-aware with predefined classes from style-roboto-light.css
- Supports both global (persistent) and local (scoped) directives
- Extensible: users can add custom classes to availableClasses

---

## Recent Critical Fixes & New Functions (Phase 1-6)

### Phase 6: State Machine Architecture (2025-11-02) - Simplified (2025-12-20)

#### STATE-MACHINE: Unified Change Handler
**File:** [src/core/ChangeStateMachine.ts](src/core/ChangeStateMachine.ts)
- **New**: `ChangeStateMachine` - SINGLE ENTRY POINT for all file changes in the system
- **Why**: Eliminates scattered entry points (file watcher, user edits, saves, switches)
- **Solution**: Simplified state machine with 4 states (VALIDATE → LOAD → UPDATE → COMPLETE)
- **Impact**: All changes follow predictable flow, unsaved check ALWAYS executed before switches
- **Architecture**: See [STATE_MACHINE_DESIGN.md](../STATE_MACHINE_DESIGN.md) for complete design

**Simplified States (2025-12-20):**
| State | Responsibility |
|-------|---------------|
| `VALIDATE` | Capture edits, check unsaved, prompt user, save if needed |
| `LOAD` | Clear old includes, register files, reload content, parse |
| `UPDATE` | Update backend, emit events, sync frontend |
| `COMPLETE` | Clear flags, return success |
| `CANCELLED` | Handle user cancellation |
| `ERROR` | Handle errors and rollback |

**Public Methods:**
- `constructor(fileRegistry, webviewPanel)` - Create per-panel instance (NOT singleton)
- `processChange(event)` - **SINGLE ENTRY POINT** - Process any file change event (queued events now resolve after processing instead of failing)

**State Handlers (Private):**
- `_handleValidate()` - Analyze impact, capture edit, check unsaved, prompt user, save
- `_handleLoad()` - Clear cache, load includes using unifiedLoad (ALWAYS reloads)
- `_handleUpdate()` - Sync registry, update main file, emit events, send frontend updates
- `_handleComplete()` - Clear flags and return to IDLE
- `_handleCancelled()` - Handle user cancellation
- `_handleError()` - Handle errors and attempt rollback

**Event Types:**
- `FileSystemChangeEvent` - External file modifications
- `UserEditEvent` - User edits in webview
- `SaveEvent` - File save operations
- `IncludeSwitchEvent` - Include file switches

**Documentation:**
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Complete architecture overview
- [STATE_MACHINE_DESIGN.md](../STATE_MACHINE_DESIGN.md) - State machine specification

---

## Recent Critical Fixes & New Functions (Phase 1-5)

### Phase 5: Critical Cleanup (2025-10-29)

#### CLEANUP-3: Code Simplification
**File:** [src/kanbanWebviewPanel.ts:2388-2429](src/kanbanWebviewPanel.ts#L2388-L2429)
- **New**: `_sendBoardUpdate()` - Consolidates board update message logic
- **Why**: Was duplicated in 3 places (23, 20, and 32 lines each)
- **Solution**: Single helper method includes ALL 15+ config fields
- **Bug Fixed**: _handleContentChange was missing columnBorder, taskBorder, htmlRenderMode

**File:** [src/kanbanWebviewPanel.ts:1563-1763](src/kanbanWebviewPanel.ts#L1563-L1763)
- **Simplified**: `_handleContentChange()` - Reduced from 229 lines to 201 lines
- Added inline `clearFileCache()` helper (eliminates switch duplication)
- Simplified verbose comments

#### CLEANUP-2: Bug Fixes
**File:** [src/files/MainKanbanFile.ts:258](src/files/MainKanbanFile.ts#L258)
- **Fixed Bug**: `hasIncludeUnsavedChanges()` - Now properly queries registry
- **Why**: Was returning undefined (broken TODO marker)
- **Impact**: Critical data loss prevention

**File:** [src/files/MainKanbanFile.ts:326](src/files/MainKanbanFile.ts#L326)
- **Refactored**: `generateMarkdown()` - Reuses MarkdownKanbanParser.generateMarkdown()
- **Why**: Removed 38 lines of duplicate markdown generation
- **Impact**: Single source of truth, DRY principle

### Phase 2: Unify Column Include Switch (2025-10-26)

#### SWITCH-1: Unified Handler
**File:** [src/kanbanWebviewPanel.ts:1956-2148](src/kanbanWebviewPanel.ts#L1956-L2148)
- **New**: `updateColumnIncludeFile()` - SINGLE unified function for column include file switches
- **Why**: Eliminates dual-path bug (messageHandler + handleIncludeSwitchRequest)
- **Solution**: Direct board object update preserves column IDs
- 9-step complete flow in ONE place
- No more ID regeneration issues

### Phase 1: Foundation Fixes (2025-10-26)

#### FOUNDATION-1: Path Normalization
**File:** [src/files/MarkdownFile.ts](src/files/MarkdownFile.ts)
- **New**: `getNormalizedRelativePath()` - Central path normalization
- **New**: `isSameFile(other)` - Compare files using normalized paths
- **Why**: Eliminates 20+ scattered normalization calls
- **Impact**: Handles platform differences (Windows/Unix)

#### FOUNDATION-2: Cancellation System
**File:** [src/files/MarkdownFile.ts](src/files/MarkdownFile.ts)
- **New**: `_startNewReload()` - Start new reload, cancel previous
- **New**: `_checkReloadCancelled(sequence)` - Check if reload cancelled
- **Why**: Protects against rapid file switching (A→B→C shows only C)
- **Impact**: Zero race conditions, automatic protection for all subclasses

### Earlier Fixes (2025-10-26)

#### Column Include Switch Fix
**File:** [src/messageHandler.ts:445-448](src/messageHandler.ts#L445-L448)
- Changed from `performBoardActionSilent()` to direct `editColumnTitle()` call
- **Why**: `performBoardActionSilent` triggers save → board reload → ID regeneration
- **Solution**: Direct board object update preserves column IDs

#### Edit Mode Protection
**Files:** [src/html/webview.js:2650-2677](src/html/webview.js#L2650-L2677), [src/html/webview.js:2732-2759](src/html/webview.js#L2732-L2759)
- Added `isEditing` guards to `updateColumnContent` and `updateTaskContent`
- **Why**: DOM re-rendering during edit mode destroys active editor
- **Solution**: Skip rendering when `window.taskEditor.currentEditor` is active

---

## src/kanbanWebviewPanel.ts - KanbanWebviewPanel

### Phase 1-5 New Functions:
- src/kanbanWebviewPanel-KanbanWebviewPanel_updateColumnIncludeFile - (Phase 2, SWITCH-1) SINGLE unified function for column include file switches, 9-step flow, eliminates dual-path bug
- src/kanbanWebviewPanel-KanbanWebviewPanel_sendBoardUpdate - (Phase 5, CLEANUP-3) Consolidates board update message logic with ALL 15+ config fields, replaces 3 duplicated code blocks
- src/kanbanWebviewPanel-KanbanWebviewPanel_handleContentChange - (Phase 3, STATE-1 + Phase 5, CLEANUP-3) UNIFIED handler for ALL content changes (column/task switches, include changes), reduced from 229 to 201 lines

### Existing Functions:
- src/kanbanWebviewPanel-KanbanWebviewPanel_createOrShow - Static factory method to create or show webview panel for a document
- src/kanbanWebviewPanel-KanbanWebviewPanel_revive - Static method to revive panel from serialized state
- src/kanbanWebviewPanel-KanbanWebviewPanel_getPanelForDocument - Get panel instance for specific document URI
- src/kanbanWebviewPanel-KanbanWebviewPanel_getAllPanels - Get array of all active panel instances
- src/kanbanWebviewPanel-KanbanWebviewPanel_getPanelId - Get unique identifier for this panel instance
- src/kanbanWebviewPanel-KanbanWebviewPanel_refreshWebviewContent - Force refresh webview HTML and board state
- src/kanbanWebviewPanel-KanbanWebviewPanel_handleLinkReplacement - Handle link/image path replacement in tasks/columns
- src/kanbanWebviewPanel-KanbanWebviewPanel_setupDocumentCloseListener - Listen for document close events
- src/kanbanWebviewPanel-KanbanWebviewPanel_setupWorkspaceChangeListener - Listen for workspace configuration changes
- src/kanbanWebviewPanel-KanbanWebviewPanel_updateWebviewPermissions - Update webview permission settings
- src/kanbanWebviewPanel-KanbanWebviewPanel_updateWebviewPermissionsForAssets - Update asset directory permissions
- src/kanbanWebviewPanel-KanbanWebviewPanel_buildLocalResourceRoots - Build list of allowed local resource directories
- src/kanbanWebviewPanel-KanbanWebviewPanel_getLayoutPresetsConfiguration - Get layout preset configuration
- src/kanbanWebviewPanel-KanbanWebviewPanel_isFileLocked - Check if file is locked for editing
- src/kanbanWebviewPanel-KanbanWebviewPanel_toggleFileLock - Toggle file lock state
- src/kanbanWebviewPanel-KanbanWebviewPanel_getCurrentDocumentUri - Get current document URI
- src/kanbanWebviewPanel-KanbanWebviewPanel_isEditingInProgress - Check if an edit session is active in the panel
- src/kanbanWebviewPanel-KanbanWebviewPanel_syncIncludeFilesWithBoard - Register include files referenced by the current board
- src/kanbanWebviewPanel-KanbanWebviewPanel_setUndoRedoOperation - Flag undo/redo operation state on the panel context
- src/kanbanWebviewPanel-KanbanWebviewPanel_getWebviewBridge - Get the panel’s WebviewBridge instance
- src/kanbanWebviewPanel-KanbanWebviewPanel__cleanupPanelStateEntry - Remove persisted panel document entry from global state on dispose
- src/kanbanWebviewPanel-KanbanWebviewPanel_getMessageHandler - Provide message handler access without reaching into private fields
- src/kanbanWebviewPanel-KanbanWebviewPanel_initialize - Initialize panel state and listeners
- src/kanbanWebviewPanel-KanbanWebviewPanel_setupEventListeners - Setup message and event listeners
- src/kanbanWebviewPanel-KanbanWebviewPanel_ensureBoardAndSendUpdate - Ensure board exists and send update to webview
- src/kanbanWebviewPanel-KanbanWebviewPanel_loadMarkdownFile - Load markdown file into panel
- src/kanbanWebviewPanel-KanbanWebviewPanel_sendBoardUpdate - Send board data to webview
- src/kanbanWebviewPanel-KanbanWebviewPanel_generateImageMappings - Generate image path mappings for webview
- src/kanbanWebviewPanel-KanbanWebviewPanel_saveToMarkdown - Save board state to markdown file
- src/kanbanWebviewPanel-KanbanWebviewPanel_initializeFile - Initialize new kanban file
- src/kanbanWebviewPanel-KanbanWebviewPanel_getHtmlForWebview - Generate HTML content for webview
- src/kanbanWebviewPanel-KanbanWebviewPanel_collectAssetDirectories - Collect asset directories for permissions
- src/kanbanWebviewPanel-KanbanWebviewPanel_extractAssetDirs - Extract asset directories from content
- src/kanbanWebviewPanel-KanbanWebviewPanel_getNonce - Generate nonce for CSP
- src/kanbanWebviewPanel-KanbanWebviewPanel_handlePanelClose - Handle panel close event
- src/kanbanWebviewPanel-KanbanWebviewPanel_tryAutoLoadActiveMarkdown - Try to auto-load active markdown file
- src/kanbanWebviewPanel-KanbanWebviewPanel_dispose - Dispose panel and cleanup resources
- src/kanbanWebviewPanel-KanbanWebviewPanel_debugWebviewPermissions - Debug webview permission configuration
- src/kanbanWebviewPanel-KanbanWebviewPanel_setupDocumentChangeListener - Setup listener for document changes
- src/kanbanWebviewPanel-KanbanWebviewPanel_forceReloadFromFile - Force reload file from disk
- src/kanbanWebviewPanel-KanbanWebviewPanel_reprocessTaskIncludes - Reprocess all task includes
- src/kanbanWebviewPanel-KanbanWebviewPanel_checkTaskIncludeUnsavedChanges - Check if task has unsaved include changes
- src/kanbanWebviewPanel-KanbanWebviewPanel_checkColumnIncludeUnsavedChanges - Check if column has unsaved include changes
- src/kanbanWebviewPanel-KanbanWebviewPanel_hasUnsavedIncludeFileChanges - Check if specific include has unsaved changes
- src/kanbanWebviewPanel-KanbanWebviewPanel_saveTaskIncludeChanges - Save changes to task include file
- src/kanbanWebviewPanel-KanbanWebviewPanel_updateIncludeContentUnified - Update include content in unified system
- src/kanbanWebviewPanel-KanbanWebviewPanel_loadNewTaskIncludeContent - Load content from new task include files
- src/kanbanWebviewPanel-KanbanWebviewPanel_saveAllColumnIncludeChanges - Save all column include changes
- src/kanbanWebviewPanel-KanbanWebviewPanel_saveAllTaskIncludeChanges - Save all task include changes
- src/kanbanWebviewPanel-KanbanWebviewPanel_ensureIncludeFileRegistered - Ensure include file is registered
- src/kanbanWebviewPanel-KanbanWebviewPanel_saveMainKanbanChanges - Save main kanban file changes
- src/kanbanWebviewPanel-KanbanWebviewPanel_openFileWithReuseCheck - Open file with editor reuse check
- src/kanbanWebviewPanel-KanbanWebviewPanel_setFileHidden - Set file as hidden in explorer
- src/kanbanWebviewPanel-KanbanWebviewPanel_triggerSnippetInsertion - Trigger snippet insertion

## src/includeFileManager.ts - IncludeFileManager

- src/includeFileManager-IncludeFileManager_getOrCreateIncludeFile - Get or create FileState for include file
- src/includeFileManager-IncludeFileManager_getIncludeFilesByType - Get list of include files by type (regular, column, task)
- src/includeFileManager-IncludeFileManager_updateIncludeFileContent - Update include file content and track changes
- src/includeFileManager-IncludeFileManager_normalizeIncludePath - Normalize include path for consistent lookup
- src/includeFileManager-IncludeFileManager_findIncludeFile - Find include file by normalized path
- src/includeFileManager-IncludeFileManager_isSameIncludePath - Check if two include paths are equivalent
- src/includeFileManager-IncludeFileManager_handleUnsavedIncludeFileChanges - Handle unsaved changes in include files
- src/includeFileManager-IncludeFileManager_removeTrackedFiles - Remove tracked files from FileStateManager
- src/includeFileManager-IncludeFileManager_initializeUnifiedIncludeContents - Initialize include file contents from disk
- src/includeFileManager-IncludeFileManager_getAllIncludeFilePaths - Get all tracked include file paths
- src/includeFileManager-IncludeFileManager_updateUnifiedIncludeSystem - Update unified include tracking system
- src/includeFileManager-IncludeFileManager_ensureIncludeFileRegistered - Ensure include file is registered
- src/includeFileManager-IncludeFileManager_loadNewIncludeContent - Load content from new column include files
- src/includeFileManager-IncludeFileManager_loadNewTaskIncludeContent - Load content from new task include files
- src/includeFileManager-IncludeFileManager_readAndUpdateIncludeContent - Read and update include file content
- src/includeFileManager-IncludeFileManager__readFileContent - Read file content from disk (internal helper with documentGetter)
- src/includeFileManager-IncludeFileManager_readFileContent - Read content from a file on disk
- src/includeFileManager-IncludeFileManager_refreshIncludeFileContents - Refresh include file contents without affecting board
- src/includeFileManager-IncludeFileManager_recheckIncludeFileChanges - Re-check if include files have changed after reload
- src/includeFileManager-IncludeFileManager_saveColumnIncludeChanges - Save changes to column include file
- src/includeFileManager-IncludeFileManager_saveTaskIncludeChanges - Save changes to task include file
- src/includeFileManager-IncludeFileManager_saveAllColumnIncludeChanges - Save all column include changes
- src/includeFileManager-IncludeFileManager_saveAllTaskIncludeChanges - Save all task include changes
- src/includeFileManager-IncludeFileManager_saveIncludeFileChanges - Save include file changes to disk
- src/includeFileManager-IncludeFileManager_saveIncludeFileAsBackup - Save include file as backup
- src/includeFileManager-IncludeFileManager_checkColumnIncludeUnsavedChanges - Check if column has unsaved include changes
- src/includeFileManager-IncludeFileManager_checkTaskIncludeUnsavedChanges - Check if task has unsaved include changes
- src/includeFileManager-IncludeFileManager_hasUnsavedIncludeFileChanges - Check if specific include has unsaved changes
- src/includeFileManager-IncludeFileManager_trackIncludeFileUnsavedChanges - Track unsaved changes in include files
- src/includeFileManager-IncludeFileManager_checkForExternalIncludeFileChanges - Check for external changes in include files
- src/includeFileManager-IncludeFileManager_hasExternalChanges - Check if include file has external changes
- src/includeFileManager-IncludeFileManager_hasExternalChangesForContent - Check external changes against specific content
- src/includeFileManager-IncludeFileManager_updateIncludeContentUnified - Update include content in unified system
- src/includeFileManager-IncludeFileManager_updateIncludeFile - Update include file from external change
- src/includeFileManager-IncludeFileManager_updateInlineIncludeFile - Update inline include file
- src/includeFileManager-IncludeFileManager_updateTaskIncludeWithConflictDetection - Update task include with conflict detection
- src/includeFileManager-IncludeFileManager_reprocessTaskIncludes - Reprocess all task includes
- src/includeFileManager-IncludeFileManager_handleIncludeFileConflict - Handle include file conflict
- src/includeFileManager-IncludeFileManager_isColumnIncludeFile - Check if file is column include
- src/includeFileManager-IncludeFileManager_isTaskIncludeFile - Check if file is task include
- src/includeFileManager-IncludeFileManager_handleExternalFileChange - Handle external file change event
- src/includeFileManager-IncludeFileManager_writeFileContent - Write file content to disk
- src/includeFileManager-IncludeFileManager_getRecentlyReloadedFiles - Get recently reloaded files set
- src/includeFileManager-IncludeFileManager_addRecentlyReloadedFile - Add file to recently reloaded set
- src/includeFileManager-IncludeFileManager_clearRecentlyReloadedFiles - Clear recently reloaded files set

## src/kanbanFileService.ts - KanbanFileService

- src/kanbanFileService-KanbanFileService_initializeState - Initialize state tracking values
- src/kanbanFileService-KanbanFileService_getState - Get current state values for syncing back to panel
- src/kanbanFileService-KanbanFileService_isFileLocked - Check if file is locked
- src/kanbanFileService-KanbanFileService_toggleFileLock - Toggle file lock state
- src/kanbanFileService-KanbanFileService_getCurrentDocumentUri - Get current document URI
- src/kanbanFileService-KanbanFileService_ensureBoardAndSendUpdate - Ensure board is loaded and send update to webview
- src/kanbanFileService-KanbanFileService_loadMarkdownFile - Load markdown file and parse into board structure
- src/kanbanFileService-KanbanFileService_forceReloadFromFile - Force reload the board from file (user-initiated)
- src/kanbanFileService-KanbanFileService_saveToMarkdown - Save board to markdown file
- src/kanbanFileService-KanbanFileService_saveMainKanbanChanges - Save main kanban changes
- src/kanbanFileService-KanbanFileService_initializeFile - Initialize a new kanban file with header
- src/kanbanFileService-KanbanFileService_setupDocumentChangeListener - Setup document change listener for tracking modifications
- src/kanbanFileService-KanbanFileService_registerSaveHandler - Register handler with SaveEventCoordinator for version tracking
- src/kanbanFileService-KanbanFileService_updateKnownFileContent - Update the known file content baseline
- src/kanbanFileService-KanbanFileService_openFileWithReuseCheck - Open a file with reuse check (focus existing editor if already open)
- src/kanbanFileService-KanbanFileService_setFileHidden - Set file as hidden on Windows using attrib command
- src/kanbanFileService-KanbanFileService_checkForExternalUnsavedChanges - Check for external unsaved changes when about to save; shows conflict dialog if both webview and external have changes; respects user choice to proceed or abort

## src/conflictService.ts - ConflictService

- src/conflictService-ConflictService_showConflictDialog - Centralized dialog manager to prevent duplicate conflict dialogs
- src/conflictService-ConflictService_notifyExternalChanges - Notify user about external changes without forcing reload
- src/conflictService-ConflictService_handleInlineIncludeFileChange - Handle changes to inline include files
- src/conflictService-ConflictService_createUnifiedBackup - Create unified backup (conflict or other types)
- src/conflictService-ConflictService_createBoardStateBackup - Create board state backup file
- src/conflictService-ConflictService_handlePanelClose - Handle panel close with unsaved changes check
- src/conflictService-ConflictService_openFileWithReuseCheck - Open a file with reuse check (internal)
- src/conflictService-ConflictService_setFileHidden - Set file as hidden on Windows using attrib command (internal)

## src/utils/linkOperations.ts - LinkOperations

- src/utils/linkOperations-LinkOperations_replaceSingleLink - Replace only the specific occurrence (by index) of a specific link in text
- src/utils/linkOperations-LinkOperations_replaceMatchAtPosition - Replace a specific match at its exact position with the new path

## src/fileStateManager.ts - FileStateManager

- src/fileStateManager-FileStateManager_getInstance - Get singleton instance
- src/fileStateManager-FileStateManager_registerFile - Register file for tracking
- src/fileStateManager-FileStateManager_updateFileContent - Update file content and track changes
- src/fileStateManager-FileStateManager_getFileState - Get file state by path
- src/fileStateManager-FileStateManager_hasUnsavedChanges - Check if file has unsaved changes
- src/fileStateManager-FileStateManager_getUnsavedChanges - Get unsaved changes content
- src/fileStateManager-FileStateManager_clearUnsavedChanges - Clear unsaved changes flag
- src/fileStateManager-FileStateManager_markAsSaved - Mark file as saved with baseline update
- src/fileStateManager-FileStateManager_hasExternalChanges - Check for external changes
- src/fileStateManager-FileStateManager_getExternalChanges - Get external changes content
- src/fileStateManager-FileStateManager_updateBaseline - Update baseline content
- src/fileStateManager-FileStateManager_unregisterFile - Unregister file from tracking
- src/fileStateManager-FileStateManager_getAllFiles - Get all tracked file paths
- src/fileStateManager-FileStateManager_getFilesWithUnsavedChanges - Get files with unsaved changes
- src/fileStateManager-FileStateManager_clearAllUnsavedFlags - Clear all unsaved flags
- src/fileStateManager-FileStateManager_clearCache - Clear internal cache
- src/fileStateManager-FileStateManager_getDebugInfo - Get debug information
- src/fileStateManager-FileStateManager_readFromDisk - Read current file content from disk
- src/fileStateManager-FileStateManager_refreshBaseline - Refresh baseline from disk

## src/conflictResolver.ts - ConflictResolver

- src/conflictResolver-ConflictResolver_detectConflict - Detect conflict between versions
- src/conflictResolver-ConflictResolver_resolveConflict - Resolve conflict with chosen strategy
- src/conflictResolver-ConflictResolver_mergeChanges - Merge changes with auto-resolution
- src/conflictResolver-ConflictResolver_createDiffView - Create diff view for comparison
- src/conflictResolver-ConflictResolver_hasConflict - Check if content has conflicts
- src/conflictResolver-ConflictResolver_extractConflictMarkers - Extract conflict markers from content

## src/externalFileWatcher.ts - ExternalFileWatcher

- src/externalFileWatcher-ExternalFileWatcher_constructor - Initialize file watcher
- src/externalFileWatcher-ExternalFileWatcher_watchFile - Add file to watch list
- src/externalFileWatcher-ExternalFileWatcher_unwatchFile - Remove file from watch list
- src/externalFileWatcher-ExternalFileWatcher_dispose - Dispose watcher and cleanup
- src/externalFileWatcher-ExternalFileWatcher_onDidChange - Get change event emitter

## src/saveEventCoordinator.ts - SaveEventCoordinator

- src/saveEventCoordinator-SaveEventCoordinator_constructor - Initialize coordinator
- src/saveEventCoordinator-SaveEventCoordinator_beginSave - Begin save operation
- src/saveEventCoordinator-SaveEventCoordinator_completeSave - Complete save operation
- src/saveEventCoordinator-SaveEventCoordinator_cancelSave - Cancel save operation
- src/saveEventCoordinator-SaveEventCoordinator_isSaving - Check if save in progress
- src/saveEventCoordinator-SaveEventCoordinator_isSavingFile - Check if specific file is being saved
- src/saveEventCoordinator-SaveEventCoordinator_shouldIgnoreChange - Check if change should be ignored
- src/saveEventCoordinator-SaveEventCoordinator_getActiveSaves - Get list of active saves

## src/fileManager.ts - FileManager

- src/fileManager-FileManager_constructor - Initialize file manager
- src/fileManager-FileManager_readFile - Read file from disk
- src/fileManager-FileManager_writeFile - Write file to disk
- src/fileManager-FileManager_fileExists - Check if file exists
- src/fileManager-FileManager_deleteFile - Delete file from disk
- src/fileManager-FileManager_copyFile - Copy file to new location
- src/fileManager-FileManager_ensureDirectory - Ensure directory exists

## src/messageHandler.ts - MessageHandler

- src/messageHandler-MessageHandler_handleMessage - Main message routing handler
- src/messageHandler-MessageHandler_startOperation - Start operation with progress tracking
- src/messageHandler-MessageHandler_updateOperationProgress - Update operation progress
- src/messageHandler-MessageHandler_endOperation - End operation and clear progress
- src/messageHandler-MessageHandler_handleUndo - Handle undo operation
- src/messageHandler-MessageHandler_detectBoardChanges - Detect changes between board states
- src/messageHandler-MessageHandler_unfoldColumnsForFocusTargets - Unfold columns for focus targets
- src/messageHandler-MessageHandler_sendFocusTargets - Send focus targets to webview
- src/messageHandler-MessageHandler_handleRedo - Handle redo operation
- src/messageHandler-MessageHandler_handleSelectFile - Handle file selection dialog
- src/messageHandler-MessageHandler_handleEditModeStart - Handle edit mode start
- src/messageHandler-MessageHandler_handleEditModeEnd - Handle edit mode end
- src/messageHandler-MessageHandler_handleOpenFile - Handle file open request
- src/messageHandler-MessageHandler_handleSaveBoardState - Handle board state save
- src/messageHandler-MessageHandler_performBoardAction - Perform board action with undo
- src/messageHandler-MessageHandler_performBoardActionSilent - Perform board action silently
- src/messageHandler-MessageHandler_handlePageHiddenWithUnsavedChanges - Handle page hidden with unsaved changes
- src/messageHandler-MessageHandler_handleSetPreference - Handle preference update
- src/messageHandler-MessageHandler_handleSetContext - Handle context variable update
- src/messageHandler-MessageHandler_handleVSCodeSnippet - Handle snippet insertion
- src/messageHandler-MessageHandler_getSnippetNameForShortcut - Get snippet name for keyboard shortcut
- src/messageHandler-MessageHandler_loadVSCodeKeybindings - Load VSCode keybindings
- src/messageHandler-MessageHandler_getUserKeybindingsPath - Get user keybindings file path
- src/messageHandler-MessageHandler_getWorkspaceKeybindingsPath - Get workspace keybindings path
- src/messageHandler-MessageHandler_matchesShortcut - Check if keybinding matches shortcut
- src/messageHandler-MessageHandler_resolveSnippetContent - Resolve snippet content
- src/messageHandler-MessageHandler_loadMarkdownSnippets - Load markdown snippets
- src/messageHandler-MessageHandler_getUserSnippetsPath - Get user snippets path
- src/messageHandler-MessageHandler_getWorkspaceSnippetsPath - Get workspace snippets path
- src/messageHandler-MessageHandler_getVSCodeUserDataDir - Get VSCode user data directory
- src/messageHandler-MessageHandler_loadSnippetsFromFile - Load snippets from file
- src/messageHandler-MessageHandler_loadExtensionSnippets - Load extension snippets
- src/messageHandler-MessageHandler_processSnippetBody - Process snippet body with variables
- src/messageHandler-MessageHandler_handleRuntimeTrackingReport - Handle runtime tracking report
- src/messageHandler-MessageHandler_handleSaveClipboardImage - Handle clipboard image save
- src/messageHandler-MessageHandler_handleSaveClipboardImageWithPath - Handle clipboard image save with path
- src/messageHandler-MessageHandler_handlePasteImageIntoField - Handle image paste into field
- src/messageHandler-MessageHandler_handleBoardUpdate - Handle board update from webview
- src/messageHandler-MessageHandler__checkUnsavedIncludeFiles - Scan full board include usage and prompt when removed include files have unsaved changes
- src/messageHandler-MessageHandler_handleConfirmDisableIncludeMode - Handle include mode disable confirmation
- src/messageHandler-MessageHandler_handleRequestIncludeFile - Handle include file request
- src/messageHandler-MessageHandler_handleRegisterInlineInclude - Handle inline include registration
- src/messageHandler-MessageHandler_handleRequestIncludeFileName - Handle include filename request
- src/messageHandler-MessageHandler_handleRequestEditIncludeFileName - Handle edit include filename request
- src/messageHandler-MessageHandler_handleRequestEditTaskIncludeFileName - Handle edit task include filename
- src/messageHandler-MessageHandler_handleRequestTaskIncludeFileName - Handle task include filename request
- src/messageHandler-MessageHandler_handleGetExportDefaultFolder - Get default export folder
- src/messageHandler-MessageHandler_handleSelectExportFolder - Handle export folder selection
- src/messageHandler-MessageHandler_handleAskOpenExportFolder - Ask to open export folder
- src/messageHandler-MessageHandler_handleGetTrackedFilesDebugInfo - Get tracked files debug info
- src/messageHandler-MessageHandler_handleClearTrackedFilesCache - Clear tracked files cache
- src/messageHandler-MessageHandler_handleReloadAllIncludedFiles - Reload all included files
- src/messageHandler-MessageHandler_handleSaveIndividualFile - Save individual file
- src/messageHandler-MessageHandler_handleReloadIndividualFile - Reload individual file
- src/messageHandler-MessageHandler_getUnifiedFileState - Get unified file state info
- src/messageHandler-MessageHandler_collectTrackedFilesDebugInfo - Collect debug info for tracked files
- src/messageHandler-MessageHandler_clearAllTrackedFileCaches - Clear all tracked file caches
- src/messageHandler-MessageHandler_handleUpdateTaskFromStrikethroughDeletion - Handle task strikethrough deletion
- src/messageHandler-MessageHandler_handleUpdateColumnTitleFromStrikethroughDeletion - Handle column title strikethrough
- src/messageHandler-MessageHandler_handleGetMarpThemes - Get available Marp themes
- src/messageHandler-MessageHandler_handlePollMarpThemes - Poll for Marp themes
- src/messageHandler-MessageHandler_handleOpenInMarpPreview - Open file in Marp preview
- src/messageHandler-MessageHandler_handleCheckMarpStatus - Check Marp extension status
- src/messageHandler-MessageHandler_handleStopAutoExport - Stop auto-export mode
- src/messageHandler-MessageHandler_handleStopAutoExportForOtherKanbanFiles - Stop auto-export for other files
- src/messageHandler-MessageHandler_handleStopAutoExportForFile - Stop auto-export for specific file
- src/messageHandler-MessageHandler_handleExport - Handle export operation
- src/messageHandler-MessageHandler_handleAutoExportMode - Handle auto-export mode
- src/messageHandler-MessageHandler_handleSwitchColumnIncludeFile - Switch column include file without saving main file, save old file if needed, create/load new file, update column content
- src/messageHandler-MessageHandler_handleSwitchTaskIncludeFile - Switch task include file without saving main file, save old file if needed, create/load new file, update task content
- src/messageHandler-MessageHandler_handleForceWriteAllContent - (NEW 2025-11-05) Force write all content from frontend to backend files unconditionally, bypasses change detection when sync is broken
- src/messageHandler-MessageHandler_handleVerifyContentSync - (NEW 2025-11-05) Verify content synchronization between frontend and backend, compares actual content not just flags

## src/extension.ts

- src/extension-activate - Extension activation entry point, registers kanban sidebar and all commands
- src/extension-deactivate - Extension deactivation entry point

## src/kanbanSidebarProvider.ts - KanbanSidebarProvider (NEW 2025-11-22)

### Overview
Sidebar TreeView for listing and managing kanban boards in workspace. Supports auto-discovery, manual additions, drag & drop, and persistent storage.

### Classes

**KanbanBoardItem** - TreeItem representing a kanban board in sidebar
- Properties: uri, label, isValid (shows warning icon if not a kanban file)
- Command: Opens kanban board when clicked

**KanbanDragAndDropController** - Handles drag & drop of markdown files and reordering
- dropMimeTypes: ['text/uri-list', 'application/vnd.code.tree.kanbanBoardsSidebar']
- dragMimeTypes: ['application/vnd.code.tree.kanbanBoardsSidebar']
- handleDrag: Creates drag data for internal reordering
- handleDrop: Validates .md files and adds to sidebar, or reorders items if dragged internally

**KanbanSidebarProvider** - Main TreeDataProvider for sidebar
- Implements: vscode.TreeDataProvider<KanbanBoardItem>
- Features: Auto-scan, manual discovery, file watching, workspace state persistence

### Enums & Utilities

**FileCategory** - Enum for file type categories
- All, Regular, Backups, Conflicts, Autosaves, UnsavedChanges

**FileTypeDetector** - Static utility class for file categorization
- detectCategory(filePath) - Detect category from filename patterns (.{name}-autosave.md, .{name}-backup-{timestamp}.md, etc.)
- getCategoryLabel(category) - Get display label for category
- getCategoryIcon(category) - Get VS Code icon name for category

### Methods

- src/kanbanSidebarProvider-KanbanSidebarProvider_constructor - Initialize sidebar with context and auto-scan setting
- src/kanbanSidebarProvider-KanbanSidebarProvider_hasScannedBefore - Check if workspace has been scanned before (first-time auto-scan)
- src/kanbanSidebarProvider-KanbanSidebarProvider_markAsScanned - Mark workspace as scanned to prevent repeated auto-scans
- src/kanbanSidebarProvider-KanbanSidebarProvider_loadFromWorkspaceState - Load kanban file list from workspaceState on activation
- src/kanbanSidebarProvider-KanbanSidebarProvider_saveToWorkspaceState - Save kanban file list to workspaceState for persistence
- src/kanbanSidebarProvider-KanbanSidebarProvider_getTreeItem - Get TreeItem for display (required by TreeDataProvider)
- src/kanbanSidebarProvider-KanbanSidebarProvider_getChildren - Get children items for tree (kanban file list with filter applied)
- src/kanbanSidebarProvider-KanbanSidebarProvider_refresh - Refresh tree view display
- src/kanbanSidebarProvider-KanbanSidebarProvider_scanWorkspace - Scan workspace for markdown files with kanban-plugin: board header (max 500 files)
- src/kanbanSidebarProvider-KanbanSidebarProvider_isKanbanFile - Validate if file is kanban board by checking YAML header (with 24h cache)
- src/kanbanSidebarProvider-KanbanSidebarProvider_addFile - Add kanban file manually to sidebar (validates header, prompts if invalid)
- src/kanbanSidebarProvider-KanbanSidebarProvider_removeFile - Remove kanban file from sidebar and stop watching
- src/kanbanSidebarProvider-KanbanSidebarProvider_watchFile - Start FileSystemWatcher for file (onDidChange, onDidDelete)
- src/kanbanSidebarProvider-KanbanSidebarProvider_unwatchFile - Stop FileSystemWatcher and dispose
- src/kanbanSidebarProvider-KanbanSidebarProvider_handleWorkspaceFolderChanges - Handle workspace folder add/remove events
- src/kanbanSidebarProvider-KanbanSidebarProvider_clear - Clear all kanban files from sidebar (with confirmation)
- src/kanbanSidebarProvider-KanbanSidebarProvider_setFilter - (NEW 2025-11-22) Set active filter category and refresh display
- src/kanbanSidebarProvider-KanbanSidebarProvider_showFilterMenu - (NEW 2025-11-22) Show quick pick menu with all filter categories and counts
- src/kanbanSidebarProvider-KanbanSidebarProvider_getActiveFilter - (NEW 2025-11-22) Get current active filter category
- src/kanbanSidebarProvider-KanbanSidebarProvider_getCategoryCounts - (NEW 2025-11-22) Get map of category counts
- src/kanbanSidebarProvider-KanbanSidebarProvider_reorderFiles - (NEW 2025-11-22) Reorder files via drag & drop, insert dragged items before target
- src/kanbanSidebarProvider-KanbanSidebarProvider_addFile - Add kanban file manually to sidebar (updated to maintain custom order)
- src/kanbanSidebarProvider-KanbanSidebarProvider_dispose - Dispose all file watchers and resources

### Features
- **Auto-discovery**: Optional one-time workspace scan on first activation (configurable via markdown-kanban.sidebar.autoScan)
- **Manual additions**: Drag & drop or "Add File" button
- **YAML validation**: Checks for "kanban-plugin: board" in frontmatter
- **Validation caching**: 24-hour TTL cache to avoid repeated file reads
- **File watching**: Monitors added files for changes/deletion
- **Workspace awareness**: Handles multi-root workspaces and folder changes
- **Persistence**: Stores file list AND custom order in workspaceState (survives VS Code restart)
- **Filtering**: (NEW 2025-11-22) Filter boards by category: Regular (default), All, Backups, Conflicts, Autosaves, Unsaved Changes
  - Default filter: Regular Kanbans (hides backup/conflict/autosave files)
  - Real-time category counts
  - Persistent filter state per session
  - Quick pick menu with icons and descriptions
- **Drag & Drop Reordering**: (NEW 2025-11-22) Reorder kanban boards by dragging items in the list
  - Drag items to new positions
  - Custom order persists in workspaceState
  - Falls back to alphabetical if no custom order

### File Categories (NEW 2025-11-22)
- **Regular**: Normal kanban files (e.g., `myboard.md`)
- **Backups**: `.{filename}-backup-{timestamp}.md` (e.g., `.myboard-backup-20251122T143055.md`)
- **Conflicts**: `{filename}-conflict-{timestamp}.md` (e.g., `myboard-conflict-20251122T143055.md`)
- **Autosaves**: `.{filename}-autosave.md` (e.g., `.myboard-autosave.md`)
- **Unsaved Changes**: `{filename}-unsavedchanges.md` (e.g., `myboard-unsavedchanges.md`)

### Commands
- markdown-kanban.sidebar.filter - (NEW 2025-11-22) Show filter menu to select category (toolbar button)
- markdown-kanban.sidebar.scanWorkspace - Scan workspace for kanban boards (toolbar button)
- markdown-kanban.sidebar.addFile - Add files via file picker (toolbar button)
- markdown-kanban.sidebar.removeFile - Remove file from sidebar (context menu)
- markdown-kanban.sidebar.clear - Clear all files from sidebar (overflow menu)
- markdown-kanban.sidebar.refresh - Refresh sidebar display (toolbar button)

## src/boardOperations.ts - BoardOperations

- src/boardOperations-BoardOperations_constructor - Initialize board operations
- src/boardOperations-BoardOperations_addColumn - Add new column to board
- src/boardOperations-BoardOperations_removeColumn - Remove column from board
- src/boardOperations-BoardOperations_moveColumn - Move column to new position
- src/boardOperations-BoardOperations_updateColumnTitle - Update column title
- src/boardOperations-BoardOperations_addTask - Add new task to column
- src/boardOperations-BoardOperations_removeTask - Remove task from column
- src/boardOperations-BoardOperations_moveTask - Move task between columns
- src/boardOperations-BoardOperations_updateTaskTitle - Update task title
- src/boardOperations-BoardOperations_updateTaskDescription - Update task description
- src/boardOperations-BoardOperations_toggleTaskComplete - Toggle task completion state

## src/markdownParser.ts

- src/markdownParser-parseKanbanBoard - Parse markdown into kanban board structure
- src/markdownParser-kanbanBoardToMarkdown - Convert kanban board to markdown
- src/markdownParser-extractYamlFrontmatter - Extract YAML frontmatter from markdown
- src/markdownParser-parseColumn - Parse column from markdown
- src/markdownParser-parseTask - Parse task from markdown
- src/markdownParser-columnToMarkdown - Convert column to markdown
- src/markdownParser-taskToMarkdown - Convert task to markdown

## src/undoRedoManager.ts - UndoRedoManager

- src/undoRedoManager-UndoRedoManager_constructor - Initialize undo/redo manager
- src/undoRedoManager-UndoRedoManager_saveState - Save board state to history
- src/undoRedoManager-UndoRedoManager_undo - Undo to previous state
- src/undoRedoManager-UndoRedoManager_redo - Redo to next state
- src/undoRedoManager-UndoRedoManager_canUndo - Check if undo is available
- src/undoRedoManager-UndoRedoManager_canRedo - Check if redo is available
- src/undoRedoManager-UndoRedoManager_clear - Clear undo/redo history

## src/backupManager.ts - BackupManager

- src/backupManager-BackupManager_constructor - Initialize backup manager
- src/backupManager-BackupManager_createBackup - Create backup of current state
- src/backupManager-BackupManager_autoBackup - Create automatic backup
- src/backupManager-BackupManager_restoreBackup - Restore from backup
- src/backupManager-BackupManager_listBackups - List available backups
- src/backupManager-BackupManager_deleteBackup - Delete backup file
- src/backupManager-BackupManager_cleanOldBackups - Clean old backups based on retention

## src/linkHandler.ts - LinkHandler

- src/linkHandler-LinkHandler_constructor - Initialize link handler
- src/linkHandler-LinkHandler_handleLink - Handle link click
- src/linkHandler-LinkHandler_resolveLink - Resolve link path
- src/linkHandler-LinkHandler_openLink - Open link in editor or browser
- src/linkHandler-LinkHandler_isExternalLink - Check if link is external URL
- src/linkHandler-LinkHandler_updateLinkPath - Update link path in content

## src/fileSearchService.ts - FileSearchService

- src/fileSearchService-FileSearchService_searchFiles - Search for files by pattern
- src/fileSearchService-FileSearchService_findMarkdownFiles - Find markdown files in workspace
- src/fileSearchService-FileSearchService_quickPick - Show file quick pick dialog
- src/fileSearchService-FileSearchService_getRelativePath - Get relative path for file

## src/configurationService.ts - ConfigurationService

- src/configurationService-ConfigurationService_getInstance - Get singleton instance
- src/configurationService-ConfigurationService_getConfig - Get configuration value with caching
- src/configurationService-ConfigurationService_getNestedConfig - Get nested config using dot notation
- src/configurationService-ConfigurationService_updateConfig - Update configuration value
- src/configurationService-ConfigurationService_getAllConfig - Get all configuration as typed object
- src/configurationService-ConfigurationService_clearCache - Clear configuration cache
- src/configurationService-ConfigurationService_getTagConfiguration - Get tag configuration
- src/configurationService-ConfigurationService_getEnabledTagCategoriesColumn - Get enabled tag categories for columns
- src/configurationService-ConfigurationService_getEnabledTagCategoriesTask - Get enabled tag categories for tasks
- src/configurationService-ConfigurationService_getCustomTagCategories - Get custom tag categories
- src/configurationService-ConfigurationService_getLayoutConfiguration - Get layout configuration
- src/configurationService-ConfigurationService_getBackupConfiguration - Get backup configuration
- src/configurationService-ConfigurationService_getLinkConfiguration - Get link configuration
- src/configurationService-ConfigurationService_getPathGenerationMode - Get path generation mode
- src/configurationService-ConfigurationService_validateConfig - Validate configuration value
- src/configurationService-ConfigurationService_getNestedProperty - Get nested property from object

## src/presentationParser.ts - PresentationParser

- src/presentationParser-PresentationParser_parsePresentation - Parse presentation markdown into slides
- src/presentationParser-PresentationParser_slidesToTasks - Convert slides to kanban tasks
- src/presentationParser-PresentationParser_tasksToPresentation - Convert tasks to presentation format
- src/presentationParser-PresentationParser_parseMarkdownToTasks - Parse markdown file to tasks

## src/utils/idGenerator.ts - IdGenerator

- src/utils/idGenerator-IdGenerator_generateUUID - Generate RFC4122 UUID v4
- src/utils/idGenerator-IdGenerator_generateColumnId - Generate column ID with prefix
- src/utils/idGenerator-IdGenerator_generateTaskId - Generate task ID with prefix
- src/utils/idGenerator-IdGenerator_isValidUUID - Validate UUID format
- src/utils/idGenerator-IdGenerator_isValidColumnId - Validate column ID format
- src/utils/idGenerator-IdGenerator_isValidTaskId - Validate task ID format
- src/utils/idGenerator-IdGenerator_extractUUID - Extract UUID from prefixed ID
- src/utils/idGenerator-IdGenerator_getShortId - Generate short display ID

## src/utils/tagUtils.ts - TagUtils

- src/utils/tagUtils-TagUtils_filterTagsFromText - Remove tags based on visibility setting
- src/utils/tagUtils-TagUtils_removeConfiguredTags - Remove configured tags from text
- src/utils/tagUtils-TagUtils_processMarkdownContent - Process markdown content to filter tags

## src/utils/fileTypeUtils.ts - FileTypeUtils

- src/utils/fileTypeUtils-FileTypeUtils_getFileExtension - Get file extension using path module

## src/utils/columnUtils.ts

- src/utils/columnUtils-getColumnRow - Extract row number from column title
- src/utils/columnUtils-sortColumnsByRow - Sort columns by row number

## src/services/PathResolver.ts - PathResolver

- src/services/PathResolver-PathResolver_resolve - Resolve relative path to absolute
- src/services/PathResolver-PathResolver_normalize - Normalize path with ./ prefix
- src/services/PathResolver-PathResolver_removePrefix - Remove ./ prefix from path
- src/services/PathResolver-PathResolver_areEqual - Check if two paths are equivalent
- src/services/PathResolver-PathResolver_findMatch - Find matching path in array
- src/services/PathResolver-PathResolver_getVariations - Get all equivalent path variations
- src/services/PathResolver-PathResolver_getRelativePath - Get relative path between files
- src/services/PathResolver-PathResolver_isAbsolute - Check if path is absolute
- src/services/PathResolver-PathResolver_getBaseName - Get base name from path
- src/services/PathResolver-PathResolver_getDirName - Get directory name from path
- src/services/PathResolver-PathResolver_join - Join path segments
- src/services/PathResolver-PathResolver_normalizeSeparators - Normalize path separators

## src/services/FileWriter.ts - FileWriter

- src/services/FileWriter-FileWriter_writeFile - Write content to file with error handling
- src/services/FileWriter-FileWriter_writeBatch - Write multiple files in batch
- src/services/FileWriter-FileWriter_createBackup - Create backup of file
- src/services/FileWriter-FileWriter_fileExists - Check if file exists
- src/services/FileWriter-FileWriter_directoryExists - Check if directory exists
- src/services/FileWriter-FileWriter_getUniqueFilePath - Generate unique filename
- src/services/FileWriter-FileWriter_deleteFile - Safely delete file
- src/services/FileWriter-FileWriter_readFile - Read file content
- src/services/FileWriter-FileWriter_ensureDirectory - Create directory if needed

## src/services/OperationOptions.ts - OperationOptionsBuilder

- src/services/OperationOptions-OperationOptionsBuilder_operation - Set operation type
- src/services/OperationOptions-OperationOptionsBuilder_source - Set source file path
- src/services/OperationOptions-OperationOptionsBuilder_targetDir - Set target directory
- src/services/OperationOptions-OperationOptionsBuilder_targetFilename - Set target filename
- src/services/OperationOptions-OperationOptionsBuilder_format - Set format strategy
- src/services/OperationOptions-OperationOptionsBuilder_scope - Set export scope
- src/services/OperationOptions-OperationOptionsBuilder_includes - Set include processing mode
- src/services/OperationOptions-OperationOptionsBuilder_createDirs - Enable/disable directory creation
- src/services/OperationOptions-OperationOptionsBuilder_notify - Enable/disable notifications
- src/services/OperationOptions-OperationOptionsBuilder_overwrite - Enable/disable overwrite
- src/services/OperationOptions-OperationOptionsBuilder_backup - Enable/disable backup
- src/services/OperationOptions-OperationOptionsBuilder_exportOptions - Set export-specific options
- src/services/OperationOptions-OperationOptionsBuilder_backupOptions - Set backup-specific options
- src/services/OperationOptions-OperationOptionsBuilder_build - Build and validate options
- src/services/OperationOptions-OperationOptionsBuilder_quickExport - Create quick export options
- src/services/OperationOptions-OperationOptionsBuilder_quickSave - Create quick save options
- src/services/OperationOptions-OperationOptionsBuilder_quickBackup - Create quick backup options

## src/services/MarpConverter.ts - MarpConverter

- src/services/MarpConverter-MarpConverter_kanbanToMarp - Convert kanban board to Marp presentation
- src/services/MarpConverter-MarpConverter_createMarpFrontmatter - Create Marp YAML frontmatter
- src/services/MarpConverter-MarpConverter_columnToSlides - Convert column to Marp slides
- src/services/MarpConverter-MarpConverter_taskToSlide - Convert task to Marp slide
- src/services/MarpConverter-MarpConverter_convertMarkdownToMarp - Convert kanban markdown to Marp
- src/services/MarpConverter-MarpConverter_addMarpDirectives - Add Marp directives to markdown

## src/services/MarpExtensionService.ts - MarpExtensionService

- src/services/MarpExtensionService-MarpExtensionService_isMarpExtensionInstalled - Check if Marp extension is installed
- src/services/MarpExtensionService-MarpExtensionService_isMarpExtensionActive - Check if Marp extension is active
- src/services/MarpExtensionService-MarpExtensionService_openInMarpPreview - Open file in Marp preview
- src/services/MarpExtensionService-MarpExtensionService_saveAndOpenInMarpPreview - Save and open in Marp preview
- src/services/MarpExtensionService-MarpExtensionService_promptInstallMarpExtension - Prompt to install Marp extension
- src/services/MarpExtensionService-MarpExtensionService_exportUsingMarpExtension - Export using Marp extension
- src/services/MarpExtensionService-MarpExtensionService_getMarpStatus - Get Marp extension status
- src/services/MarpExtensionService-MarpExtensionService_createMarpStatusBarItem - Create Marp status bar item

## src/services/AssetHandler.ts - AssetHandler

- src/services/AssetHandler-AssetHandler_findAssets - Find all assets in markdown content
- src/services/AssetHandler-AssetHandler_processAssets - Process assets according to strategy
- src/services/AssetHandler-AssetHandler_copyAsset - Copy asset to target directory
- src/services/AssetHandler-AssetHandler_embedAsset - Embed asset as base64 data URL
- src/services/AssetHandler-AssetHandler_calculateMD5 - Calculate MD5 hash for file
- src/services/AssetHandler-AssetHandler_detectAssetType - Detect asset type from extension
- src/services/AssetHandler-AssetHandler_isRemoteUrl - Check if path is remote URL
- src/services/AssetHandler-AssetHandler_getMimeType - Get MIME type for extension
- src/services/AssetHandler-AssetHandler_getAssetsByType - Get assets of specific type
- src/services/AssetHandler-AssetHandler_getTotalSize - Calculate total size of assets
- src/services/AssetHandler-AssetHandler_validateAssets - Validate asset paths in content

## src/services/MarpExportService.ts - MarpExportService

- src/services/MarpExportService-MarpExportService_storeMarpPid - Store Marp process PID
- src/services/MarpExportService-MarpExportService_getMarpPid - Get Marp process PID
- src/services/MarpExportService-MarpExportService_stopMarpWatch - Stop Marp watch process
- src/services/MarpExportService-MarpExportService_isWatching - Check if file is being watched
- src/services/MarpExportService-MarpExportService_stopAllMarpWatches - Stop all Marp watch processes
- src/services/MarpExportService-MarpExportService_stopAllMarpWatchesExcept - Stop all Marp watch processes except specified file
- src/services/MarpExportService-MarpExportService_export - Export markdown using Marp CLI
- src/services/MarpExportService-MarpExportService_buildMarpCliArgs - Build Marp CLI arguments
- src/services/MarpExportService-MarpExportService_getDefaultEnginePath - Get default engine path
- src/services/MarpExportService-MarpExportService_ensureMarpBuildFiles - Ensure required build files exist
- src/services/MarpExportService-MarpExportService_isMarpCliAvailable - Check if Marp CLI is available
- src/services/MarpExportService-MarpExportService_engineFileExists - Check if engine file exists
- src/services/MarpExportService-MarpExportService_getMarpVersion - Get Marp CLI version
- src/services/MarpExportService-MarpExportService_getAvailableThemes - Get available Marp themes

## src/services/export/PandocExportService.ts - PandocExportService

**Document Export Service** (Added 2026-01-03)
Exports markdown to document formats (DOCX, ODT, EPUB) using Pandoc CLI.

- src/services/export/PandocExportService-PandocExportService_isPandocAvailable - Check if Pandoc is installed on system
- src/services/export/PandocExportService-PandocExportService_getPandocVersion - Get installed Pandoc version string
- src/services/export/PandocExportService-PandocExportService_resetCache - Reset cached availability and version
- src/services/export/PandocExportService-PandocExportService_export - Export markdown to DOCX/ODT/EPUB via Pandoc CLI
- src/services/export/PandocExportService-PandocExportService_buildCliArgs - Build Pandoc command line arguments
- src/services/export/PandocExportService-PandocExportService_getPandocPath - Get configured or default Pandoc binary path
- src/services/export/PandocExportService-PandocExportService_getExtensionForFormat - Get file extension for format
- src/services/export/PandocExportService-PandocExportService_getFormatDisplayName - Get human-readable format name

## src/constants/IncludeConstants.ts

**Centralized Constants** (Added 2025-11-04, Updated 2025-12-22)
- **INCLUDE_SYNTAX** - Include directive constants (PREFIX, SUFFIX, REGEX, REGEX_SINGLE)
  - PREFIX: '!!!include('
  - SUFFIX: ')!!!'
  - REGEX: Global regex pattern for matching include directives
  - REGEX_SINGLE: Non-global regex for single match
- **FILE_TYPES** - File type constants (MAIN, INCLUDE_COLUMN, INCLUDE_TASK, INCLUDE_REGULAR)
- **Purpose**: Eliminates 783+ duplicate string instances across the codebase
- **Used by**: markdownParser.ts, messageHandler.ts, boardOperations.ts, ColumnCommands.ts, TaskCommands.ts

**Functions:**
- **extractIncludeFiles(title: string): string[]** - Extract include file paths from a title string
  - Returns array of file paths found in !!!include(path)!!! syntax
  - Added 2025-12-22 to consolidate duplicate implementations from ColumnCommands and TaskCommands

**Note**: All include syntax pattern matching should use INCLUDE_SYNTAX constants instead of hardcoded strings.

---

## Summary

Total functions documented: **495**

### Files analyzed:
1. kanbanWebviewPanel.ts - 39 methods (reduced from 93)
2. includeFileManager.ts - 42 methods (NEW)
3. kanbanFileService.ts - 17 methods (NEW)
4. conflictService.ts - 6 methods (NEW, renamed from partial conflictResolver)
5. utils/linkOperations.ts - 2 methods (NEW)
6. fileStateManager.ts - 17 methods
7. conflictResolver.ts - 6 methods
8. externalFileWatcher.ts - 5 methods
9. saveEventCoordinator.ts - 7 methods
10. fileManager.ts - 6 methods
11. messageHandler.ts - 50+ methods
12. extension.ts - 2 functions
13. boardOperations.ts - 10 methods
14. markdownParser.ts - 7 functions
15. undoRedoManager.ts - 7 methods
16. backupManager.ts - 6 methods
17. linkHandler.ts - 6 methods
18. fileSearchService.ts - 4 methods
19. configurationService.ts - 14 methods
20. presentationParser.ts - 4 methods
21. utils/idGenerator.ts - 7 methods
22. utils/tagUtils.ts - 3 methods
23. utils/fileTypeUtils.ts - 1 method
24. utils/columnUtils.ts - 2 functions
25. services/PathResolver.ts - 14 methods
26. services/FileWriter.ts - 9 methods
27. services/OperationOptions.ts - 16 methods
28. services/MarpConverter.ts - 6 methods
29. services/MarpExtensionService.ts - 8 methods
30. services/AssetHandler.ts - 11 methods
31. services/MarpExportService.ts - 17 methods

### Refactoring Summary:
- **kanbanWebviewPanel.ts**: Reduced from 93 to 39 methods (54 methods extracted)
- **New classes created**:
  - IncludeFileManager (42 methods) - All include file operations
  - KanbanFileService (17 methods) - File loading, saving, and state management
  - ConflictService (8 methods) - Conflict resolution and backup operations
  - LinkOperations (2 static methods) - Link replacement utilities
  - ExportService (50+ methods) - Export operations


## src/files/MarkdownFile.ts - MarkdownFile (Abstract Base)

### Phase 1 New Methods (FOUNDATION-1 & FOUNDATION-2):
- src/files/MarkdownFile-MarkdownFile_getNormalizedRelativePath - (Phase 1, FOUNDATION-1) Central path normalization, handles platform differences, eliminates 20+ scattered calls
- src/files/MarkdownFile-MarkdownFile_isSameFile - (Phase 1, FOUNDATION-1) Compare files using normalized paths, replaces 4 array.includes() patterns
- src/files/MarkdownFile-MarkdownFile_startNewReload - (Phase 1, FOUNDATION-2) Start new reload operation, cancel previous, returns sequence number for cancellation checks
- src/files/MarkdownFile-MarkdownFile_checkReloadCancelled - (Phase 1, FOUNDATION-2) Check if reload cancelled by newer operation, protects against race conditions in rapid switching

### Existing Methods:
- src/files/MarkdownFile-MarkdownFile_getPath - Get absolute file path
- src/files/MarkdownFile-MarkdownFile_getRelativePath - Get relative file path
- src/files/MarkdownFile-MarkdownFile_getFileName - Get file name only
- src/files/MarkdownFile-MarkdownFile_exists - Check if file exists
- src/files/MarkdownFile-MarkdownFile_getLastModified - Get last modified timestamp
- src/files/MarkdownFile-MarkdownFile_getContent - Get current file content
- src/files/MarkdownFile-MarkdownFile_getBaseline - Get baseline (last saved) content
- src/files/MarkdownFile-MarkdownFile_setContent - Set content (optionally update baseline)
- src/files/MarkdownFile-MarkdownFile_hasUnsavedChanges - Check if file has unsaved changes
- src/files/MarkdownFile-MarkdownFile_hasExternalChanges - Check if file changed on disk
- src/files/MarkdownFile-MarkdownFile_isInEditMode - Check if user is actively editing
- src/files/MarkdownFile-MarkdownFile_setEditMode - Set edit mode state
- src/files/MarkdownFile-MarkdownFile_isDirtyInEditor - Check if VS Code editor is dirty
- src/files/MarkdownFile-MarkdownFile_hasConflict - Check for conflict (local + external changes)
- src/files/MarkdownFile-MarkdownFile_needsReload - Check if file needs reload from disk
- src/files/MarkdownFile-MarkdownFile_needsSave - Check if file needs save to disk
- src/files/MarkdownFile-MarkdownFile_reload - Reload content from disk
- src/files/MarkdownFile-MarkdownFile_save - Save current content to disk
- src/files/MarkdownFile-MarkdownFile_discardChanges - Discard unsaved changes
- src/files/MarkdownFile-MarkdownFile_resolveConflict - Resolve conflict with action (save/discard/backup)
- src/files/MarkdownFile-MarkdownFile_showConflictDialog - Show conflict dialog and resolve
- src/files/MarkdownFile-MarkdownFile_createBackup - Create backup of current content
- src/files/MarkdownFile-MarkdownFile_startWatching - Start watching file for external changes
- src/files/MarkdownFile-MarkdownFile_stopWatching - Stop watching file
- src/files/MarkdownFile-MarkdownFile_checkForExternalChanges - Check if content changed on disk
- src/files/MarkdownFile-MarkdownFile_toFileState - Convert to FileState interface (compatibility)
- src/files/MarkdownFile-MarkdownFile_fromFileState - Update from FileState interface (compatibility)
- src/files/MarkdownFile-MarkdownFile_dispose - Dispose all resources

## src/files/MainKanbanFile.ts - MainKanbanFile

- src/files/MainKanbanFile-MainKanbanFile_getBoard - Get parsed board structure (cached)
- src/files/MainKanbanFile-MainKanbanFile_parseToBoard - Parse content to KanbanBoard structure
- src/files/MainKanbanFile-MainKanbanFile_updateFromBoard - Update content from board structure
- src/files/MainKanbanFile-MainKanbanFile_getYamlHeader - Get YAML frontmatter
- src/files/MainKanbanFile-MainKanbanFile_setYamlHeader - Set YAML frontmatter
- src/files/MainKanbanFile-MainKanbanFile_getKanbanFooter - Get kanban footer
- src/files/MainKanbanFile-MainKanbanFile_setKanbanFooter - Set kanban footer
- src/files/MainKanbanFile-MainKanbanFile_readFromDisk - Read from VS Code document or file system
- src/files/MainKanbanFile-MainKanbanFile_writeToDisk - Write to disk using VS Code API
- src/files/MainKanbanFile-MainKanbanFile_handleExternalChange - Handle external file change (modified/deleted/created)
- src/files/MainKanbanFile-MainKanbanFile_validate - Validate kanban markdown content
- src/files/MainKanbanFile-MainKanbanFile_getConflictContext - Get conflict context for dialog

## src/files/IncludeFile.ts - IncludeFile (Abstract Base for Includes)

- src/files/IncludeFile-IncludeFile_getParentFile - Get parent MainKanbanFile
- src/files/IncludeFile-IncludeFile_getParentPath - Get parent file path
- src/files/IncludeFile-IncludeFile_getAbsolutePath - Get absolute path (resolved from relative)
- src/files/IncludeFile-IncludeFile_isInline - Check if this is inline include
- src/files/IncludeFile-IncludeFile_readFromDisk - Read include file from disk
- src/files/IncludeFile-IncludeFile_writeToDisk - Write include file to disk
- src/files/IncludeFile-IncludeFile_handleExternalChange - Handle external change (include-specific)
- src/files/IncludeFile-IncludeFile_notifyParentOfChange - Notify parent of changes
- src/files/IncludeFile-IncludeFile_getConflictContext - Get include conflict context

## src/files/ColumnIncludeFile.ts - ColumnIncludeFile

- src/files/ColumnIncludeFile-ColumnIncludeFile_setColumnId - Set column ID this include belongs to
- src/files/ColumnIncludeFile-ColumnIncludeFile_getColumnId - Get column ID
- src/files/ColumnIncludeFile-ColumnIncludeFile_setColumnTitle - Set column title
- src/files/ColumnIncludeFile-ColumnIncludeFile_getColumnTitle - Get column title
- src/files/ColumnIncludeFile-ColumnIncludeFile_parseToTasks - Parse presentation format to tasks array
- src/files/ColumnIncludeFile-ColumnIncludeFile_generateFromTasks - Generate presentation format from tasks
- src/files/ColumnIncludeFile-ColumnIncludeFile_updateTasks - Update tasks (regenerate content)
- src/files/ColumnIncludeFile-ColumnIncludeFile_validate - Validate presentation format content

## src/files/TaskIncludeFile.ts - TaskIncludeFile

- src/files/TaskIncludeFile-TaskIncludeFile_setTaskId - Set task ID this include belongs to
- src/files/TaskIncludeFile-TaskIncludeFile_getTaskId - Get task ID
- src/files/TaskIncludeFile-TaskIncludeFile_setTaskTitle - Set task title
- src/files/TaskIncludeFile-TaskIncludeFile_getTaskTitle - Get task title
- src/files/TaskIncludeFile-TaskIncludeFile_setColumnId - Set column ID containing task
- src/files/TaskIncludeFile-TaskIncludeFile_getColumnId - Get column ID
- src/files/TaskIncludeFile-TaskIncludeFile_getTaskDescription - Get task description content
- src/files/TaskIncludeFile-TaskIncludeFile_setTaskDescription - Set task description content
- src/files/TaskIncludeFile-TaskIncludeFile_validate - Validate task include content

## src/files/RegularIncludeFile.ts - RegularIncludeFile

- src/files/RegularIncludeFile-RegularIncludeFile_getBoard - Get parsed board (cached)
- src/files/RegularIncludeFile-RegularIncludeFile_parseToBoard - Parse kanban format to board
- src/files/RegularIncludeFile-RegularIncludeFile_generateFromBoard - Generate markdown from board
- src/files/RegularIncludeFile-RegularIncludeFile_boardUpdate - Update board (regenerate content)
- src/files/RegularIncludeFile-RegularIncludeFile_validate - Validate kanban format content

## src/files/MarkdownFileRegistry.ts - MarkdownFileRegistry

- src/files/MarkdownFileRegistry-MarkdownFileRegistry_register - Register file in registry
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_unregister - Unregister file from registry
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_clear - Clear all files and registration cache
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_get - Get file by absolute path
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getByRelativePath - Get file by relative path
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getAll - Get all files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_has - Check if file registered by path
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_hasByRelativePath - Check if file registered by relative path
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_size - Get number of registered files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getByType - Get files by type (generic)
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getMainFile - Get main kanban file
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getIncludeFiles - Get all include files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getColumnIncludeFiles - Get column include files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getTaskIncludeFiles - Get task include files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getRegularIncludeFiles - Get regular include files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getFilesWithConflicts - Get files with conflicts
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getFilesWithUnsavedChanges - Get files with unsaved changes
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getFilesWithExternalChanges - Get files with external changes
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getFilesThatNeedReload - Get files needing reload
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getFilesThatNeedSave - Get files needing save
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getFilesInEditMode - Get files in edit mode
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_saveAll - Save all files with unsaved changes
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_reloadAll - Reload all files with external changes
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_forceWriteAll - (NEW 2025-11-05) Force write ALL files unconditionally, ignores change detection flags, emergency recovery function
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_checkAllForExternalChanges - Check all files for external changes
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_startWatchingAll - Start watching all files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_stopWatchingAll - Stop watching all files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_backupAll - Create backups for all files
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_getStatistics - Get registry statistics
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_logStatistics - Log current statistics
- src/files/MarkdownFileRegistry-MarkdownFileRegistry_dispose - Dispose all resources

## src/files/FileFactory.ts - FileFactory

- src/files/FileFactory-FileFactory_createMainFile - Create MainKanbanFile instance
- src/files/FileFactory-FileFactory_createColumnInclude - Create ColumnIncludeFile instance
- src/files/FileFactory-FileFactory_createTaskInclude - Create TaskIncludeFile instance
- src/files/FileFactory-FileFactory_createRegularInclude - Create RegularIncludeFile instance
- src/files/FileFactory-FileFactory_createInclude - Create include file with type auto-detection

---

## Frontend JavaScript Functions

## src/html/debugOverlay.js - Debug Overlay System

### Existing Functions:
- src/html/debugOverlay-showDebugOverlay - Create and show the debug overlay panel
- src/html/debugOverlay-hideDebugOverlay - Hide and remove the debug overlay
- src/html/debugOverlay-refreshDebugOverlay - Update debug overlay with fresh data
- src/html/debugOverlay-updateTrackedFilesData - Update tracked files data from backend
- src/html/debugOverlay-saveIndividualFile - Save individual file (main or include)
- src/html/debugOverlay-reloadIndividualFile - Reload individual file from disk
- src/html/debugOverlay-reloadAllIncludedFiles - Reload all included files (images, videos, includes)
- src/html/debugOverlay-openFile - Open file in VS Code editor
- src/html/debugOverlay-reloadImages - Force reload all images and media content
- src/html/debugOverlay-clearDebugCache - Clear debug cache and request fresh data
- src/html/debugOverlay-toggleDebugOverlaySticky - Toggle sticky/pin state of debug overlay

### New Functions (2025-11-05):
- src/html/debugOverlay-forceWriteAllContent - (NEW) Force write complete board state from frontend to backend files unconditionally, bypasses broken change detection
- src/html/debugOverlay-verifyContentSync - (NEW) Request content synchronization verification between frontend and backend, compares actual content
- src/html/debugOverlay-showVerificationResults - (NEW) Display verification results in modal overlay showing which files match/differ
- src/html/debugOverlay-showForceWriteConfirmation - (NEW) Show confirmation dialog before force write operation with affected files list

---

## src/html/markdown-it-include-browser.js - Markdown-it Include Plugin

### New Functions (2026-01-06):
- src/html/markdown-it-include-browser-formatIncludeLabel - Build standardized include label text for markdown-it include render paths

### Modified Functions (2026-01-06):
- src/html/dragDrop-setupTaskDragHandle - Store original task index based on task-item order for reliable drag restore/undo positioning
- src/html/dragDrop-processTaskDrop - Use task-only indices for final position tracking and undo payload from-index consistency
- src/core/stores/BoardStore-undo - Restore task-move undos from stored snapshot while preserving targeted column updates
- src/core/stores/BoardStore-redo - Restore task-move redos from stored snapshot while preserving targeted column updates

---

## src/html/boardRenderer.js - Board Rendering and Layout System

### New Functions (2025-11-22):
- src/html/boardRenderer-waitForStackImagesAndRecalculate - Wait for ALL images in a stack to load, then recalculate stack heights once; ensures final column positions are correct after all images have loaded (overlaps during loading are acceptable); handles cached images and failed images (5s timeout)
- src/html/boardRenderer-setupImageLoadingWatchers - Set up image loading watchers for all stacks; each stack waits for ALL its images before recalculating once; called AFTER initial stack calculation (at 50ms)

### Modified Functions (2025-11-22):
- src/html/menuOperations-deleteTask - Added stack height recalculation after task deletion to update positions of all columns in the stack
- src/html/dragDrop-handleVSCodeFileDrop - Enhanced to detect image files and read contents to save to MEDIA folder instead of creating broken links; works for external file drops (Finder/Explorer)
- src/html/dragDrop-handleVSCodeUriDrop - Enhanced to detect image URIs and intelligently copy or link files; checks if image is already in workspace before copying
- src/messageHandler-handleMessage - Added cases for 'saveDroppedImageFromContents' and 'copyImageToMedia' to handle dropped images
- src/html/webview-messageHandler - Added case for 'droppedImageSaved' to create task with proper markdown image link; shows notification if image was copied vs linked
- src/messageHandler-handleCopyImageToMedia - Enhanced to check if image is already in workspace directory; only copies if outside workspace, otherwise creates relative link and shows "linked" notification

### New Functions (2025-11-22 - Image Drop):
- src/messageHandler-handleSaveDroppedImageFromContents - Save dropped image from base64 contents (external drops); reads file contents, saves to [kanban]-MEDIA folder with unique filename
- src/messageHandler-handleCopyImageToMedia - Copy dropped image from file path (VS Code Explorer drops); copies file to [kanban]-MEDIA folder with unique filename
- src/messageHandler-_sendImageDropError - Helper to send error message to frontend when image drop fails

### New/Modified Functions (2025-12-05 - File Drop Dialogue):
- src/html/dragDrop-handleVSCodeFileDrop - Modified to show dialogue instead of immediately reading file; calculates partial hash (first 1MB) for matching; stores File object in pendingFileDrops map
- src/html/dragDrop-handleVSCodeUriDrop - Modified to request dialogue for external files; files in workspace are auto-linked without dialogue
- src/html/dragDrop-readPartialFileForHash - Read first 1MB of file for hash calculation (safe for large files); returns base64 encoded data
- src/html/dragDrop-executeFileObjectCopy - Execute file copy after user confirms in dialogue (for File objects); reads file and sends to backend
- src/html/dragDrop-cancelPendingFileDrop - Cancel pending file drop when user cancels dialogue
- src/html/dragDrop-formatFileSize - Format bytes to human readable size (KB, MB, GB)
- src/html/dragDrop-showFileDropDialogue - Show modal with options: Link existing file (if found), Open media folder, Cancel
- src/messageHandler-handleRequestFileDropDialogue - Backend handler; checks workspace (auto-link), calculates hash, searches media folder for existing matching file
- src/messageHandler-handleExecuteFileDropCopy - Backend handler for user's copy action (URI drops)
- src/messageHandler-handleExecuteFileDropLink - Backend handler for user's link action (URI drops)
- src/messageHandler-handleLinkExistingFile - Backend handler to link existing file found in media folder
- src/messageHandler-handleOpenMediaFolder - Open media folder in OS file explorer (Finder/Explorer)
- src/messageHandler-_calculatePartialHash - Calculate hash for file; uses first 1MB + size for large files (>1MB)
- src/messageHandler-_calculatePartialHashFromData - Calculate hash from provided partial data buffer and file size
- src/messageHandler-_loadHashCache - Load .hash_cache file from media folder
- src/messageHandler-_saveHashCache - Save .hash_cache file to media folder
- src/messageHandler-_updateHashCache - Update cache for all files in media folder; recalculates stale entries (by mtime)
- src/messageHandler-_findMatchingFileByHash - Search media folder for file with matching hash (checks filename first, then all files)
- src/html/webview-messageHandler (showFileDropDialogue case) - Handle dialogue options from backend, call showFileDropDialogue

---

## Plugin System (2025-11-25)

### Overview
Plugin-based architecture for import/export operations. Provides unified interfaces for include file detection, creation, and export format handling. Plugins are registered at extension activation and used throughout the application.

### Architecture
- **PluginRegistry**: Singleton managing all registered plugins
- **ImportPlugin**: Interface for include file handling (detection, creation, parsing)
- **ExportPlugin**: Interface for export format handling (PDF, PPTX, HTML via Marp)
- **PluginLoader**: Static class that loads built-in plugins at activation

## src/plugins/interfaces/ImportPlugin.ts - ImportPlugin Interface

### Types:
- **ImportPluginMetadata** - Plugin metadata (id, name, version, priority, fileType, extensions, includePattern, contextLocation)
- **IncludeContextLocation** - Where includes are valid: 'column-header' | 'task-title' | 'description' | 'any'
- **ImportContext** - Context for detection (location, lineNumber, parentFile, lineContent)
- **IncludeMatch** - Detection result (pluginId, filePath, fullMatch, startIndex, endIndex, context)
- **PluginDependencies** - Injected dependencies (conflictResolver, backupManager, isInline)
- **ParseOptions** - Parsing options (filePath, mainFilePath, existingTasks, columnId)
- **ParseResult** - Parse result (success, data, error)
- **GenerateOptions** - Generation options (filterIncludes, includeMarpDirectives)
- **PluginContext** - Plugin lifecycle context (extensionContext, logger)

### Interface Methods:
- src/plugins/interfaces/ImportPlugin-ImportPlugin_canHandle - Check if plugin can handle path in context
- src/plugins/interfaces/ImportPlugin-ImportPlugin_detectIncludes - Detect all includes in content
- src/plugins/interfaces/ImportPlugin-ImportPlugin_createFile - Create MarkdownFile instance
- src/plugins/interfaces/ImportPlugin-ImportPlugin_parseContent - (Optional) Parse file content to data
- src/plugins/interfaces/ImportPlugin-ImportPlugin_generateContent - (Optional) Generate content from data
- src/plugins/interfaces/ImportPlugin-ImportPlugin_activate - (Optional) Plugin activation
- src/plugins/interfaces/ImportPlugin-ImportPlugin_deactivate - (Optional) Plugin deactivation

## src/plugins/interfaces/ExportPlugin.ts - ExportPlugin Interface

### Types:
- **ExportFormat** - Format definition (id, name, extension, mimeType, description)
- **ExportPluginMetadata** - Plugin metadata (id, name, version, formats, requiresExternalTool, externalToolName)
- **ExportOptions** - Export options (formatId, inputPath, outputPath, watchMode, pptxEditable, theme, enginePath, additionalArgs, pluginOptions)
- **ExportResult** - Export result (success, outputPath, error, metadata)
- **PreviewOptions** - Preview options (formatId, maxSize, quality)

### Interface Methods:
- src/plugins/interfaces/ExportPlugin-ExportPlugin_getSupportedFormats - Get list of supported formats
- src/plugins/interfaces/ExportPlugin-ExportPlugin_canExport - Check if plugin can export board to format
- src/plugins/interfaces/ExportPlugin-ExportPlugin_isAvailable - (Optional) Check external tool availability
- src/plugins/interfaces/ExportPlugin-ExportPlugin_getToolVersion - (Optional) Get external tool version
- src/plugins/interfaces/ExportPlugin-ExportPlugin_export - Export board to format
- src/plugins/interfaces/ExportPlugin-ExportPlugin_preview - (Optional) Generate preview HTML
- src/plugins/interfaces/ExportPlugin-ExportPlugin_stopWatch - (Optional) Stop watch process for file
- src/plugins/interfaces/ExportPlugin-ExportPlugin_stopAllWatches - (Optional) Stop all watch processes
- src/plugins/interfaces/ExportPlugin-ExportPlugin_isWatching - (Optional) Check if file is being watched
- src/plugins/interfaces/ExportPlugin-ExportPlugin_getAvailableThemes - (Optional) Get available themes

## src/plugins/registry/PluginRegistry.ts - PluginRegistry

### Static Methods:
- src/plugins/registry/PluginRegistry-PluginRegistry_getInstance - Get singleton instance
- src/plugins/registry/PluginRegistry-PluginRegistry_resetInstance - Reset singleton (for testing)

### Instance Methods:
- src/plugins/registry/PluginRegistry-PluginRegistry_initialize - Initialize registry with context
- src/plugins/registry/PluginRegistry-PluginRegistry_isInitialized - Check if registry is initialized
- src/plugins/registry/PluginRegistry-PluginRegistry_registerImportPlugin - Register import plugin
- src/plugins/registry/PluginRegistry-PluginRegistry_unregisterImportPlugin - Unregister import plugin
- src/plugins/registry/PluginRegistry-PluginRegistry_getImportPlugin - Get import plugin by ID
- src/plugins/registry/PluginRegistry-PluginRegistry_getAllImportPlugins - Get all import plugins
- src/plugins/registry/PluginRegistry-PluginRegistry_getImportPluginsByPriority - Get plugins sorted by priority
- src/plugins/registry/PluginRegistry-PluginRegistry_registerExportPlugin - Register export plugin
- src/plugins/registry/PluginRegistry-PluginRegistry_unregisterExportPlugin - Unregister export plugin
- src/plugins/registry/PluginRegistry-PluginRegistry_getExportPlugin - Get export plugin by ID
- src/plugins/registry/PluginRegistry-PluginRegistry_getAllExportPlugins - Get all export plugins
- src/plugins/registry/PluginRegistry-PluginRegistry_findImportPlugin - Find best plugin for path/context
- src/plugins/registry/PluginRegistry-PluginRegistry_findImportPluginByFileType - Find plugin by file type
- src/plugins/registry/PluginRegistry-PluginRegistry_detectIncludes - Detect includes using all plugins (replaces INCLUDE_SYNTAX.REGEX)
- src/plugins/registry/PluginRegistry-PluginRegistry_findExportPlugin - Find export plugin for format
- src/plugins/registry/PluginRegistry-PluginRegistry_getSupportedExportFormats - Get all supported export formats
- src/plugins/registry/PluginRegistry-PluginRegistry_getDebugInfo - Get debug info about plugins

## src/plugins/PluginLoader.ts - PluginLoader

### Static Methods:
- src/plugins/PluginLoader-PluginLoader_loadBuiltinPlugins - Load all built-in plugins (called at extension activation)
- src/plugins/PluginLoader-PluginLoader_initializePlugins - Initialize registry with context
- src/plugins/PluginLoader-PluginLoader_isLoaded - Check if plugins are loaded
- src/plugins/PluginLoader-PluginLoader_reset - Reset loader state (for testing)
- src/plugins/PluginLoader-PluginLoader_getDebugInfo - Get debug info about loaded plugins

## src/plugins/import/ColumnIncludePlugin.ts - ColumnIncludePlugin

### Properties:
- metadata.id: 'column-include'
- metadata.priority: 100 (highest)
- metadata.fileType: 'include-column'
- metadata.contextLocation: 'column-header'

### Methods:
- src/plugins/import/ColumnIncludePlugin-ColumnIncludePlugin_canHandle - Only handles column-header context
- src/plugins/import/ColumnIncludePlugin-ColumnIncludePlugin_detectIncludes - Detect !!!include()!!! in column headers
- src/plugins/import/ColumnIncludePlugin-ColumnIncludePlugin_createFile - Create ColumnIncludeFile instance
- src/plugins/import/ColumnIncludePlugin-ColumnIncludePlugin_parseContent - Parse presentation to KanbanTask[] (preserves IDs by position)
- src/plugins/import/ColumnIncludePlugin-ColumnIncludePlugin_generateContent - Generate presentation from KanbanTask[]

## src/plugins/import/TaskIncludePlugin.ts - TaskIncludePlugin

### Properties:
- metadata.id: 'task-include'
- metadata.priority: 90
- metadata.fileType: 'include-task'
- metadata.contextLocation: 'task-title'

### Methods:
- src/plugins/import/TaskIncludePlugin-TaskIncludePlugin_canHandle - Only handles task-title context
- src/plugins/import/TaskIncludePlugin-TaskIncludePlugin_detectIncludes - Detect !!!include()!!! in task titles
- src/plugins/import/TaskIncludePlugin-TaskIncludePlugin_createFile - Create TaskIncludeFile instance
- src/plugins/import/TaskIncludePlugin-TaskIncludePlugin_parseContent - Returns raw content (used as task description)

## src/plugins/import/RegularIncludePlugin.ts - RegularIncludePlugin

### Properties:
- metadata.id: 'regular-include'
- metadata.priority: 80 (lowest)
- metadata.fileType: 'include-regular'
- metadata.contextLocation: 'description'

### Methods:
- src/plugins/import/RegularIncludePlugin-RegularIncludePlugin_canHandle - Only handles description context
- src/plugins/import/RegularIncludePlugin-RegularIncludePlugin_detectIncludes - Detect !!!include()!!! in descriptions
- src/plugins/import/RegularIncludePlugin-RegularIncludePlugin_createFile - Create RegularIncludeFile instance (always inline)
- src/plugins/import/RegularIncludePlugin-RegularIncludePlugin_parseContent - Returns raw content (frontend renders)

## src/plugins/export/MarpExportPlugin.ts - MarpExportPlugin

### Properties:
- metadata.id: 'marp'
- metadata.formats: ['marp-pdf', 'marp-pptx', 'marp-html']
- metadata.requiresExternalTool: true
- metadata.externalToolName: 'Marp CLI (@marp-team/marp-cli)'

### Methods:
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_getSupportedFormats - Get PDF, PPTX, HTML formats
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_canExport - Check format supported and board has columns
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_isAvailable - Check Marp CLI availability
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_getToolVersion - Get Marp CLI version
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_export - Export board (delegates to MarpExportService)
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_stopWatch - Stop Marp watch process
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_stopAllWatches - Stop all Marp watch processes
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_isWatching - Check if file is being watched
- src/plugins/export/MarpExportPlugin-MarpExportPlugin_getAvailableThemes - Get available Marp themes

## Modified Files for Plugin Integration

### src/files/FileFactory.ts - FileFactory (Modified)
- src/files/FileFactory-FileFactory_createIncludeViaPlugin - (NEW) Create include using plugin system
- src/files/FileFactory-FileFactory_createInclude - (MODIFIED) Now tries plugins first, falls back to switch
- src/files/FileFactory-FileFactory__typeToContextLocation - (NEW) Map type to context location

### src/markdownParser.ts - MarkdownKanbanParser (Modified)
- src/markdownParser-MarkdownKanbanParser_detectIncludesWithFallback - (NEW) Detect includes with plugin fallback to regex
- src/markdownParser-MarkdownKanbanParser_getIncludeMatches - (NEW) Get detailed include matches with plugin fallback
- Column header detection (line ~245) - Now uses detectIncludesWithFallback('column-header')
- Task title detection (line ~420) - Now uses detectIncludesWithFallback('task-title')
- Description detection (line ~487) - Now uses detectIncludesWithFallback('description')

### src/extension.ts - Extension Activation (Modified)
- Plugin initialization added after output channel creation
- PluginLoader.loadBuiltinPlugins() called at extension activation
- Error handling for plugin initialization failure

---

## Core Architecture: Bridge (2025-11-27)

### Overview
WebviewBridge provides a typed, promise-based interface for webview communication between VS Code backend and the webview frontend. Supports message batching and request/response patterns.

## src/core/bridge/MessageTypes.ts - Message Type Definitions

### Types:
- **BaseMessage** - Base interface for all messages
- **RequestMessage** - Base interface for request messages (with requestId)
- **ResponseMessage** - Base interface for response messages
- **OutgoingMessage** - Union of all backend → frontend messages
- **IncomingMessage** - Union of all frontend → backend messages
- **OutgoingMessageType** - String literal type for outgoing message types
- **IncomingMessageType** - String literal type for incoming message types

### Outgoing Messages (Backend → Frontend):
- **BoardUpdateMessage** - Full board state update
- **UpdateColumnContentMessage** - Single column content update
- **UpdateTaskContentMessage** - Single task content update
- **UndoRedoStatusMessage** - Undo/redo availability status
- **FileInfoMessage** - File information update
- **OperationStartedMessage** - Operation started notification
- **OperationProgressMessage** - Operation progress update
- **OperationCompletedMessage** - Operation completed notification
- **StopEditingRequestMessage** - Request to capture edit value (request/response)
- **UnfoldColumnsRequestMessage** - Request to unfold columns (request/response)
- **ExportResultMessage** - Export result notification
- **MarpThemesMessage** - Available Marp themes
- **MarpStatusMessage** - Marp extension status
- **ShowMessageMessage** - Show message notification
- **TrackedFilesDebugInfoMessage** - Debug info for tracked files
- **ContentVerificationResultMessage** - Content sync verification result

### Incoming Messages (Frontend → Backend):
- **UndoMessage** - Undo request
- **RedoMessage** - Redo request
- **RequestBoardUpdateMessage** - Request board update
- **BoardUpdateFromFrontendMessage** - Board update from user edits
- **EditTaskMessage** - Edit task request
- **MoveTaskMessage** - Move task request
- **AddTaskMessage** - Add task request
- **DeleteTaskMessage** - Delete task request
- **AddColumnMessage** - Add column request
- **MoveColumnMessage** - Move column request
- **DeleteColumnMessage** - Delete column request
- **EditColumnTitleMessage** - Edit column title request
- **EditModeStartMessage** - Edit mode started notification
- **EditModeEndMessage** - Edit mode ended notification
- **EditingStoppedMessage** - Response with captured edit value
- **ColumnsUnfoldedMessage** - Response confirming columns unfolded
- **OpenFileLinkMessage** - Open file link request
- **OpenWikiLinkMessage** - Open wiki link request
- **OpenExternalLinkMessage** - Open external link request
- **SaveBoardStateMessage** - Save board state request
- **SaveUndoStateMessage** - Save undo state request
- **RequestIncludeFileMessage** - Request include file
- **ExportMessage** - Export request
- **RenderCompletedMessage** - Render completed notification
- **RenderSkippedMessage** - Render skipped notification

### Type Guards:
- src/core/bridge/MessageTypes-isRequestMessage - Check if message has requestId
- src/core/bridge/MessageTypes-isResponseMessage - Check if message is a response
- src/core/bridge/MessageTypes-isMessageType - Type guard for specific message types

## src/core/bridge/WebviewBridge.ts - WebviewBridge

### Properties:
- _webview: vscode.Webview | null - Current webview instance
- _isReady: boolean - Whether bridge is ready to send
- _isDisposed: boolean - Whether bridge has been disposed
- _pendingRequests: Map - Pending request/response operations
- _batchedMessages: OutgoingMessage[] - Messages awaiting batch flush
- _defaultTimeout: number - Default request timeout (5000ms)
- _maxBatchSize: number - Max messages before auto-flush (10)
- _batchFlushDelay: number - Batch flush delay (16ms)

### Methods:
- src/core/bridge/WebviewBridge-WebviewBridge_setWebview - Set the webview instance, mark bridge as ready
- src/core/bridge/WebviewBridge-WebviewBridge_clearWebview - Clear webview, cancel pending requests
- src/core/bridge/WebviewBridge-WebviewBridge_isReady - Check if bridge is ready to send
- src/core/bridge/WebviewBridge-WebviewBridge_state - Get current bridge state
- src/core/bridge/WebviewBridge-WebviewBridge_send - Send message immediately
- src/core/bridge/WebviewBridge-WebviewBridge_sendBatched - Send message with batching
- src/core/bridge/WebviewBridge-WebviewBridge_flushBatch - Flush all batched messages
- src/core/bridge/WebviewBridge-WebviewBridge_request - Send request and wait for response (promise-based)
- src/core/bridge/WebviewBridge-WebviewBridge_handleResponse - Handle incoming response message
- src/core/bridge/WebviewBridge-WebviewBridge_onMessage - Set message handler for incoming messages
- src/core/bridge/WebviewBridge-WebviewBridge_processIncomingMessage - Process incoming message (routes responses)
- src/core/bridge/WebviewBridge-WebviewBridge_dispose - Dispose bridge and cleanup

### Features:
- **Type-safe messaging**: Compile-time type checking for all messages
- **Request/Response pattern**: Promise-based async operations with timeout
- **Message batching**: Collect messages and send together for performance
- **Ready state handling**: Tracks webview availability
- **Incremental migration**: Coexists with existing postMessage calls

---
