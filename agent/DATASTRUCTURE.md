# Data Structure Documentation

This document provides a comprehensive overview of all interfaces, types, classes, and enums that define data structures in the Markdown Kanban codebase.

**Last Updated:** 2025-11-04

---

## IMPORTANT: Include Syntax System

The Markdown Kanban extension uses a **unified position-based include syntax**:

- **User-facing syntax**: ALWAYS `!!!include(filepath.md)!!!`
- **Behavior determined by position**:
  - **Column header** (`## Title !!!include(file.md)!!!`) → Column include (Marp presentation format, slides become tasks)
  - **Task title** (`- [ ] !!!include(file.md)!!!`) → Task include (first line becomes task title)
  - **Task description** (within description) → Regular include (full content embedded)

- **Internal routing**: TypeScript uses `includeType: 'columninclude' | 'taskinclude' | 'include'` for internal logic, but the user NEVER sees these type names. The syntax is always `!!!include()!!!`.

- **NEVER use `!!!columninclude()!!!` or `!!!taskinclude()!!!`** - these are deprecated and have been removed from the codebase.

### Include Constants (2025-11-04)

**File:** `/src/constants/IncludeConstants.ts`

All include syntax patterns are now centralized in constants to avoid 783+ duplicate string instances:

```typescript
export const INCLUDE_SYNTAX = {
    PREFIX: '!!!include(',
    SUFFIX: ')!!!',
    REGEX: /!!!include\(([^)]+)\)!!!/g,
    REGEX_SINGLE: /!!!include\(([^)]+)\)!!!/,
} as const;

export const FILE_TYPES = {
    MAIN: 'main',
    INCLUDE_COLUMN: 'include-column',
    INCLUDE_TASK: 'include-task',
    INCLUDE_REGULAR: 'include-regular',
} as const;
```

**Usage:** Import these constants instead of hardcoding strings:
```typescript
import { INCLUDE_SYNTAX, FILE_TYPES } from './constants/IncludeConstants';
```

---

## Table of Contents

1. [Core Kanban Structures](#core-kanban-structures)
2. [File Management](#file-management)
3. [Export and Operation Options](#export-and-operation-options)
4. [Configuration](#configuration)
5. [Conflict Resolution](#conflict-resolution)
6. [File Watching](#file-watching)
7. [Backup Management](#backup-management)
8. [Tag Utilities](#tag-utilities)
9. [File Type Utilities](#file-type-utilities)
10. [Message Handler](#message-handler)
11. [Save Coordination](#save-coordination)
12. [State Management](#state-management)

---

## Core Kanban Structures

### `/src/markdownParser.ts`

#### `KanbanTask`
Represents a task in a Kanban column.

```typescript
interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  includeMode?: boolean;      // When true, content is generated from included files
  includeFiles?: string[];     // Paths to included files
  originalTitle?: string;      // Original title before include processing
  displayTitle?: string;       // Cleaned title for display (without include syntax)
}
```

**Purpose**: Core task entity with support for include files and dynamic content.

#### `KanbanColumn`
Represents a column in a Kanban board.

```typescript
interface KanbanColumn {
  id: string;
  title: string;
  tasks: KanbanTask[];
  includeMode?: boolean;      // When true, tasks are generated from included files
  includeFiles?: string[];    // Paths to included presentation files
  originalTitle?: string;     // Original title before include processing
  displayTitle?: string;      // Cleaned title for display (without include syntax)
}
```

**Purpose**: Core column entity with support for include files and generated tasks.

#### `KanbanBoard`
Represents the entire Kanban board.

```typescript
interface KanbanBoard {
  valid: boolean;
  title: string;
  columns: KanbanColumn[];
  yamlHeader: string | null;
  kanbanFooter: string | null;
}
```

**Purpose**: Top-level data structure representing the entire board state.

---

## File Management

### `/src/fileManager.ts`

#### `FileInfo`
Basic file information displayed in the UI.

```typescript
interface FileInfo {
    fileName: string;
    filePath: string;
    documentPath: string;
    isLocked: boolean;
}
```

**Purpose**: Tracks file metadata for UI display.

#### `FileDropInfo`
Information about a dropped file in the UI.

```typescript
interface FileDropInfo {
    fileName: string;
    relativePath: string;
    isImage: boolean;
    activeEditor?: any;
    dropPosition?: { x: number; y: number };
}
```

**Purpose**: Handles drag-and-drop file operations.

#### `ImagePathMapping`
Maps original image paths to their resolved webview URIs.

```typescript
interface ImagePathMapping {
    [originalPath: string]: string;
}
```

**Purpose**: Translates file paths for webview display.

#### `FileResolutionResult`
Result of path resolution with debugging information.

```typescript
interface FileResolutionResult {
    resolvedPath: string;
    exists: boolean;
    isAbsolute: boolean;
    attemptedPaths: string[]; // Track all attempted paths for debugging
}
```

**Purpose**: Provides detailed information about file path resolution attempts.

---

## Services Organization (Phase 5, 2025-10-29)

### Services Directory Structure

**Location**: `/src/services/`

The services directory is organized by functionality into subdirectories:

```
src/services/
├── export/                      (Export-related services)
│   ├── MarpExportService.ts     - Marp CLI integration (592 lines)
│   ├── FormatConverter.ts       - Format transformations (336 lines)
│   ├── MarpConverter.ts         - Kanban → Marp conversion (273 lines)
│   ├── MarpExtensionService.ts  - VS Code Marp extension (203 lines)
│   └── index.ts                 - Barrel export
├── content/                     (Content processing services)
│   ├── ContentPipelineService.ts - Content pipeline (456 lines)
│   ├── IncludeProcessor.ts       - Include processing (404 lines)
│   └── index.ts                  - Barrel export
├── assets/                      (Asset handling services)
│   ├── AssetHandler.ts           - Asset operations (410 lines)
│   └── index.ts                  - Barrel export
├── OperationOptions.ts          - Type definitions (416 lines)
├── FileWriter.ts                - File writing utilities (309 lines)
└── PathResolver.ts              - Path resolution (242 lines)
```

**Purpose**: Clear organization by functionality (export vs content vs assets). Utilities and types remain at services/ root for easy access.

**Note**: This restructuring was completed in Phase 5 (CLEANUP-4). 22 import statements were updated across 9 files.

---

## Export and Operation Options

### `/src/services/OperationOptions.ts`

#### `OperationOptions`
Unified options for all save/backup/export operations.

```typescript
interface OperationOptions {
    operation: 'save' | 'backup' | 'export';
    sourcePath: string;
    targetDir?: string;
    targetFilename?: string;
    formatStrategy?: FormatStrategy;
    scope?: ExportScope;
    includeMode?: IncludeMode;
    createDirectories?: boolean;
    showNotifications?: boolean;
    overwriteExisting?: boolean;
    createBackup?: boolean;
    exportOptions?: ExportSpecificOptions;
    backupOptions?: BackupSpecificOptions;
}
```

**Purpose**: Centralized configuration for all file operations.

#### `FormatStrategy`
Format conversion strategy.

```typescript
type FormatStrategy = 'keep' | 'kanban' | 'presentation';
```

#### `ExportScope`
Scope of export operation.

```typescript
type ExportScope = 'full' | 'row' | 'stack' | 'column' | 'task';
```

#### `IncludeMode`
Configuration for include file processing.

```typescript
interface IncludeMode {
    strategy: 'merge' | 'separate' | 'ignore';
    processTypes?: IncludeType[];
    resolveNested?: boolean;
    maxDepth?: number;
}
```

#### `IncludeType`
Types of include markers.

```typescript
type IncludeType = 'include' | 'columninclude' | 'taskinclude';
```

#### `ExportSpecificOptions`
Export-specific configuration.

```typescript
interface ExportSpecificOptions {
    selectedItems?: ExportItem[];
    includeAssets?: boolean;
    assetStrategy?: AssetStrategy;
    preserveYaml?: boolean;
    metadata?: Record<string, any>;
}
```

#### `BackupSpecificOptions`
Backup-specific configuration.

```typescript
interface BackupSpecificOptions {
    namingStrategy?: 'timestamp' | 'sequential' | 'custom';
    customSuffix?: string;
    maxBackups?: number;
    compress?: boolean;
}
```

#### `ExportItem`
Represents an item selected for export.

```typescript
interface ExportItem {
    type: 'row' | 'stack' | 'column' | 'task';
    id: string;
    name: string;
    parent?: string;
    children?: ExportItem[];
}
```

#### `AssetStrategy`
Asset handling strategy for exports.

```typescript
type AssetStrategy = 'embed' | 'copy' | 'reference' | 'ignore';
```

#### `OperationResult`
Result of an operation.

```typescript
interface OperationResult {
    success: boolean;
    operation: 'save' | 'backup' | 'export';
    filesWritten: FileWriteInfo[];
    totalBytes: number;
    executionTime: number;
    errors?: string[];
    warnings?: string[];
    metadata?: Record<string, any>;
}
```

#### `FileWriteInfo`
Information about a written file.

```typescript
interface FileWriteInfo {
    path: string;
    size: number;
    type: 'main' | 'include' | 'asset' | 'backup';
    isNew: boolean;
}
```

### `/src/exportService.ts`

#### `ExportScope` (Export Service)
```typescript
type ExportScope = 'full' | 'row' | 'stack' | 'column' | 'task';
```

#### `ExportFormat`
```typescript
type ExportFormat = 'keep' | 'kanban' | 'presentation' | 'marp-markdown' | 'marp-pdf' | 'marp-pptx' | 'marp-html';
```

#### `NewExportOptions`
Unified export options system.

```typescript
interface NewExportOptions {
    columnIndexes?: number[];
    scope?: 'board' | 'column' | 'task';
    selection?: {
        columnIndex?: number;
        taskId?: string;
    };
    mode: 'copy' | 'save' | 'auto' | 'preview';
    format: 'kanban' | 'presentation' | 'marp';
    marpFormat?: 'markdown' | 'html' | 'pdf' | 'pptx';
    mergeIncludes?: boolean;
    tagVisibility: TagVisibility;
    linkHandlingMode?: 'rewrite-only' | 'pack-linked' | 'pack-all' | 'no-modify';
    packAssets: boolean;
    packOptions?: {
        includeFiles?: boolean;
        includeImages?: boolean;
        includeVideos?: boolean;
        includeOtherMedia?: boolean;
        includeDocuments?: boolean;
        fileSizeLimitMB?: number;
    };
    targetFolder?: string;
    openAfterExport?: boolean;
    marpTheme?: string;
    marpBrowser?: string;
    marpEnginePath?: string;
    marpWatch?: boolean;
}
```

**Purpose**: Single unified system for ALL export operations.

#### `ExportResult`
Result of export operation.

```typescript
interface ExportResult {
    success: boolean;
    message: string;
    content?: string;           // For mode: 'copy'
    exportedPath?: string;      // For mode: 'save'
}
```

#### `AssetInfo`
Information about an asset referenced in markdown.

```typescript
interface AssetInfo {
    originalPath: string;
    resolvedPath: string;
    relativePath: string;
    type: 'image' | 'video' | 'audio' | 'document' | 'file' | 'markdown';
    size: number;
    exists: boolean;
    md5?: string;
}
```

---

## Configuration

### `/src/configurationService.ts`

#### `KanbanConfiguration`
Complete configuration interface for Markdown Kanban.

```typescript
interface KanbanConfiguration {
    enableBackups: boolean;
    backupInterval: number;
    backupLocation: string;
    openLinksInNewTab: boolean;
    pathGeneration: 'relative' | 'absolute';
    whitespace: string;
    maxRowHeight: number;
    tagColors: { [key: string]: string };
    taskMinHeight: string;
    sectionHeight: string;
    taskSectionHeight: string;
    fontSize: string;
    fontFamily: string;
    columnWidth: string;
    columnBorder: string;
    taskBorder: string;
    layoutRows: number;
    rowHeight: string;
    layoutPreset: string;
    layoutPresets: { [key: string]: any };
    tagVisibility: string;
    exportTagVisibility: boolean;
    htmlCommentRenderMode: string;
    htmlContentRenderMode: string;
    arrowKeyFocusScroll: string;
    marp: {
        enginePath: string;
        defaultTheme: string;
        allowLocalFiles: boolean;
        browser: 'auto' | 'chrome' | 'edge' | 'firefox';
        themeFolders: string[];
        availableClasses: string[];
        globalClasses: string[];
        localClasses: string[];
    };
}
```

**Purpose**: Type-safe access to all configuration values.

**Marp Style Classes (2025-11-13):**
- `availableClasses`: List of available CSS class names that can be used in Marp presentations (e.g., 'font24', 'invert', 'center')
- `globalClasses`: CSS classes applied to all slides via global directive (`class:` in YAML frontmatter)
- `localClasses`: CSS classes applied to specific slides via scoped directive (`<!-- _class: ... -->`)

#### `ConfigurationDefaults`
Default values for all configuration options.

```typescript
interface ConfigurationDefaults {
    enableBackups: boolean;
    backupInterval: number;
    backupLocation: string;
    openLinksInNewTab: boolean;
    pathGeneration: 'relative' | 'absolute';
    whitespace: string;
    maxRowHeight: number;
    taskMinHeight: string;
    sectionHeight: string;
    taskSectionHeight: string;
    fontSize: string;
    fontFamily: string;
    columnWidth: string;
    columnBorder: string;
    taskBorder: string;
    layoutRows: number;
    rowHeight: string;
    layoutPreset: string;
    tagVisibility: string;
    exportTagVisibility: boolean;
    htmlCommentRenderMode: string;
    htmlContentRenderMode: string;
    arrowKeyFocusScroll: string;
    marp: {
        enginePath: string;
        defaultTheme: string;
        allowLocalFiles: boolean;
        browser: 'auto' | 'chrome' | 'edge' | 'firefox';
        themeFolders: string[];
        availableClasses: string[];
        globalClasses: string[];
        localClasses: string[];
    };
}
```

---

## Conflict Resolution

### `/src/conflictResolver.ts`

#### `ConflictType`
Types of conflicts that can occur.

```typescript
type ConflictType = 'panel_close' | 'external_main' | 'external_include' | 'presave_check' | 'watcher_failure' | 'permission_denied' | 'file_missing' | 'circular_dependency' | 'batch_conflict' | 'network_timeout' | 'crash_recovery';
```

#### `FileType` (Conflict Resolver)
```typescript
type FileType = 'main' | 'include';
```

#### `ConflictContext`
Context information for resolving a conflict.

```typescript
interface ConflictContext {
    type: ConflictType;
    fileType: FileType;
    filePath: string;
    fileName: string;
    hasMainUnsavedChanges: boolean;
    hasIncludeUnsavedChanges: boolean;
    hasExternalChanges?: boolean;
    changedIncludeFiles: string[];
    isClosing?: boolean;
    isInEditMode?: boolean;  // User is actively editing (cursor in editor)
}
```

**Purpose**: Provides context for conflict resolution decisions.

#### `ConflictResolution`
Resolution decision for a conflict.

```typescript
interface ConflictResolution {
    action: 'save' | 'discard_local' | 'discard_external' | 'ignore' | 'cancel' | 'backup_and_reload';
    shouldProceed: boolean;
    shouldCreateBackup: boolean;
    shouldSave: boolean;
    shouldReload: boolean;
    shouldIgnore: boolean;
    customAction?: string;
}
```

**Purpose**: Specifies how to handle a conflict.

---

## File Watching

### `/src/externalFileWatcher.ts`

#### `FileChangeType`
Types of file changes.

```typescript
type FileChangeType = 'modified' | 'deleted' | 'created';
```

#### `FileType` (External File Watcher)
```typescript
type FileType = 'main' | 'include' | 'dependency';
```

#### `WatchedFile`
Information about a file being watched.

```typescript
interface WatchedFile {
    path: string;
    type: FileType;
    panels: Set<KanbanWebviewPanel>;
}
```

**Purpose**: Tracks which panels are watching each file.

#### `FileChangeEvent`
Event data when a file changes.

```typescript
interface FileChangeEvent {
    path: string;
    changeType: FileChangeType;
    fileType: FileType;
    panels: KanbanWebviewPanel[];
}
```

**Purpose**: Notifies panels of external file changes.

---

## Backup Management

### `/src/backupManager.ts`

#### `BackupOptions`
Options for creating backups.

```typescript
interface BackupOptions {
    label?: string;           // 'backup', 'conflict', etc.
    forceCreate?: boolean;    // Skip time/content checks
    minIntervalMinutes?: number;  // Minimum time since last backup
}
```

**Purpose**: Configures backup creation behavior.

---

## Tag Utilities

### `/src/utils/tagUtils.ts`

#### `TagVisibility`
Tag visibility settings.

```typescript
type TagVisibility = 'all' | 'allexcludinglayout' | 'customonly' | 'mentionsonly' | 'none';
```

**Purpose**: Controls which tags are displayed/exported.

---

## File Type Utilities

### `/src/shared/fileTypeDefinitions.ts`

#### `FileCategory`
Categories for file types.

```typescript
type FileCategory = 'image' | 'video' | 'audio' | 'text' | 'document' | 'code' | 'archive' | 'unknown';
```

**Purpose**: Classifies files by their category.

---

## Message Handler

### `/src/messageHandler.ts`

#### `FocusTarget`
Target for focus operations.

```typescript
interface FocusTarget {
    type: 'task' | 'column';
    id: string;
    operation: 'created' | 'modified' | 'deleted' | 'moved';
}
```

**Purpose**: Specifies where to focus after an operation.

---

## Save Coordination

### `/src/saveEventCoordinator.ts`

#### `SaveEventHandler`
Interface for handlers that respond to save events.

```typescript
interface SaveEventHandler {
    id: string;
    handleSave(document: vscode.TextDocument): Promise<void> | void;
    isEnabled?(): boolean;
}
```

**Purpose**: Centralized save event coordination across the extension.

---

## State Management

### `/src/fileStateManager.ts`

#### `FileState`
Complete state of a file (backend + frontend).

```typescript
interface FileState {
    // File identification
    path: string;
    relativePath: string;
    isMainFile: boolean;
    fileType: 'main' | 'include-regular' | 'include-column' | 'include-task';

    // Backend states (file system & VS Code editor)
    backend: {
        exists: boolean;
        lastModified: Date | null;
        isDirtyInEditor: boolean;      // VS Code editor has unsaved changes
        documentVersion: number;        // VS Code document version
        hasFileSystemChanges: boolean; // File changed on disk outside VS Code
    };

    // Frontend states (Kanban UI)
    frontend: {
        hasUnsavedChanges: boolean;    // Kanban UI has modifications
        content: string;                // Current content in Kanban
        baseline: string;               // Last known saved content
        isInEditMode: boolean;          // User is actively editing (cursor in task/column editor)
    };

    // Computed state
    needsReload: boolean;              // Backend changes need to be loaded into frontend
    needsSave: boolean;                // Frontend changes need to be saved to backend
    hasConflict: boolean;              // Both backend and frontend have changes
}
```

**Purpose**: Single source of truth for all file state tracking, clearly separating backend (file system) changes from frontend (Kanban UI) changes.

---

## Summary

This documentation covers **42 distinct data structures** across the codebase:

### By Category:
- **Core Kanban**: 3 structures (KanbanTask, KanbanColumn, KanbanBoard)
- **File Management**: 4 structures (FileInfo, FileDropInfo, ImagePathMapping, FileResolutionResult)
- **Export/Operations**: 13 structures (OperationOptions, ExportItem, NewExportOptions, AssetInfo, etc.)
- **Configuration**: 2 structures (KanbanConfiguration, ConfigurationDefaults)
- **Conflict Resolution**: 4 structures (ConflictContext, ConflictResolution, + 2 types)
- **File Watching**: 4 structures (WatchedFile, FileChangeEvent, + 2 types)
- **State Management**: 1 structure (FileState)
- **Utilities**: 4 structures (BackupOptions, TagVisibility, FileCategory, FocusTarget)
- **Coordination**: 1 structure (SaveEventHandler)

### By File Type:
- **Interfaces**: 30
- **Type Aliases**: 12
- **Classes**: All define data structures through their properties

Total documented data structures: **42**

---

## File Abstraction Classes

### `/src/files/MarkdownFile.ts`

#### `FileChangeEvent`
Event emitted when file state changes.

```typescript
interface FileChangeEvent {
    file: MarkdownFile;
    changeType: 'content' | 'external' | 'saved' | 'reloaded' | 'conflict';
    timestamp: Date;
}
```

**Purpose**: Notification event for file state changes.

#### `MarkdownFile` (Abstract Class)
Abstract base class for all markdown files with integrated change detection.

**Purpose**: Encapsulates file state, operations, and change detection in a single class.

**Key Features**:
- Content state (current, baseline, unsaved changes)
- Backend state (file system, VS Code editor)
- Frontend state (Kanban UI modifications)
- Integrated file watching and change detection
- Event emitter for state changes
- Polymorphic file operations
- **Path normalization** (Phase 1, FOUNDATION-1): getNormalizedRelativePath(), isSameFile()
- **Cancellation system** (Phase 1, FOUNDATION-2): _startNewReload(), _checkReloadCancelled()

**Phase 1 Enhancements** (2025-10-26):

1. **Path Normalization Methods**:
   - `getNormalizedRelativePath(): string` - Returns normalized relative path for consistent lookups
   - `isSameFile(other: MarkdownFile): boolean` - Compares files using normalized paths
   - **Purpose**: Eliminates 20+ scattered normalization calls, handles platform differences

2. **Cancellation System**:
   - `_currentReloadSequence: number` - Sequence counter for cancellation
   - `_startNewReload(): number` - Starts new reload, cancels previous operations
   - `_checkReloadCancelled(sequence: number): boolean` - Checks if reload cancelled
   - **Purpose**: Protects against race conditions in rapid file switching (A→B→C shows only C)
   - **Automatic protection**: All subclasses inherit cancellation (ColumnIncludeFile, TaskIncludeFile, MainKanbanFile)

### `/src/files/MainKanbanFile.ts`

#### `MainKanbanFile` (Class)
Represents the main kanban markdown file.

**Purpose**: Main kanban file with board parsing and conflict handling.

**Extends**: `MarkdownFile`

**Key Features**:
- Parse markdown ↔ KanbanBoard structure
- YAML frontmatter and footer management
- VS Code document integration
- Main file conflict resolution

### `/src/files/IncludeFile.ts`

#### `IncludeFile` (Abstract Class)
Abstract base for all include files.

**Purpose**: Common functionality for column, task, and regular includes.

**Extends**: `MarkdownFile`

**Key Features**:
- Parent-child relationship with MainKanbanFile
- Relative path resolution
- Include-specific conflict handling
- Parent notification system

### `/src/files/ColumnIncludeFile.ts`

#### `ColumnIncludeFile` (Class)
Column include file (presentation format → tasks).

**Purpose**: Manage column includes with presentation format.

**Extends**: `IncludeFile`

**Key Features**:
- Parse presentation format to tasks
- Generate presentation from tasks
- Column association tracking

### `/src/files/TaskIncludeFile.ts`

#### `TaskIncludeFile` (Class)
Task include file (markdown description).

**Purpose**: Manage task includes with markdown content.

**Extends**: `IncludeFile`

**Key Features**:
- Task description content
- Task and column association tracking

### `/src/files/RegularIncludeFile.ts`

#### `RegularIncludeFile` (Class)
Regular include file (kanban format → board).

**Purpose**: Manage regular includes with full kanban format.

**Extends**: `IncludeFile`

**Key Features**:
- Parse kanban format to board
- Generate kanban from board
- Board merge capability

### `/src/files/MarkdownFileRegistry.ts`

#### `MarkdownFileRegistry` (Class)
Central registry for all markdown files.

**Purpose**: Type-safe file management and query operations.

**Key Features**:
- File registration and lifecycle management
- Type-specific queries (getColumnIncludeFiles(), etc.)
- State queries (getFilesWithConflicts(), etc.)
- Bulk operations (saveAll(), reloadAll(), etc.)
- Statistics and monitoring
- Event aggregation

**Phase 1 Enhancement** (2025-10-26):
- **Normalized keys**: Registry now uses `file.getNormalizedRelativePath()` as keys
- **Platform-independent**: Eliminates duplicate entries for same file (Windows vs Unix paths)
- **Consistent lookups**: All lookups normalized automatically
- **Impact**: Fixes path comparison bugs across platforms

### `/src/files/FileFactory.ts`

#### `FileFactory` (Class)
Factory for creating file instances with dependency injection.

**Purpose**: Centralized file creation with proper dependencies.

**Key Features**:
- Create MainKanbanFile
- Create include files (column, task, regular)
- Auto-detection based on file type
- Dependency injection

---

**New Data Structures Added**: 8 classes + 1 interface
**Total Data Structures**: 50+

---

## Force Write & Verification System (2025-11-05)

### `/src/messageHandler.ts`

#### `ForceWriteResult`
Result of force write operation.

```typescript
interface ForceWriteResult {
    success: boolean;
    filesWritten: number;
    errors: string[];
    backupCreated: boolean;
    backupPath?: string;
    timestamp: Date;
}
```

**Purpose**: Provides detailed information about force write operation results including backup details.

#### `FileVerificationResult`
Individual file verification result.

```typescript
interface FileVerificationResult {
    path: string;
    relativePath: string;
    isMainFile: boolean;
    matches: boolean;
    frontendContentLength: number;
    backendContentLength: number;
    differenceSize: number;
    frontendHash: string;
    backendHash: string;
}
```

**Purpose**: Detailed comparison result for a single file showing exact differences.

#### `ContentVerificationResult`
Complete verification result for all files.

```typescript
interface ContentVerificationResult {
    success: boolean;
    timestamp: Date;
    totalFiles: number;
    matchingFiles: number;
    mismatchedFiles: number;
    missingFiles: number;
    fileResults: FileVerificationResult[];
    summary: string;
}
```

**Purpose**: Aggregated verification results showing sync status across all files.

### Frontend Message Types

#### `ForceWriteAllContentMessage`
Message from frontend requesting force write.

```typescript
interface ForceWriteAllContentMessage {
    type: 'forceWriteAllContent';
    board: KanbanBoard;
    includeFiles: Map<string, string>;  // path -> content
    confirmed: boolean;
}
```

**Purpose**: Carries complete board state and all include file contents from frontend to backend for unconditional write.

#### `VerifyContentSyncMessage`
Message from frontend requesting verification.

```typescript
interface VerifyContentSyncMessage {
    type: 'verifyContentSync';
    frontendState: {
        boardMarkdown: string;
        includeFiles: Map<string, string>;  // path -> content
    };
}
```

**Purpose**: Carries frontend content for comparison with backend state.
