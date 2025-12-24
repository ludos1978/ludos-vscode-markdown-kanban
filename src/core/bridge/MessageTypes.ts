/**
 * MessageTypes - Typed Message Definitions for Webview Communication
 *
 * Defines all message types exchanged between the VS Code backend and the webview frontend.
 * Messages are categorized by direction and purpose.
 *
 * Categories:
 * - Outgoing (Backend → Frontend): Messages sent from VS Code to webview
 * - Incoming (Frontend → Backend): Messages sent from webview to VS Code
 * - Request/Response: Paired messages with correlation IDs for async operations
 */

import { KanbanBoard, KanbanTask, KanbanColumn } from '../../markdownParser';
import { CapturedEdit } from '../../files/FileInterfaces';

// ============= BASE TYPES =============

/**
 * Base interface for all messages
 */
export interface BaseMessage {
    type: string;
}

/**
 * Base interface for request messages (require a response)
 */
export interface RequestMessage extends BaseMessage {
    requestId: string;
}

/**
 * Base interface for response messages
 */
export interface ResponseMessage extends BaseMessage {
    requestId: string;
}

// ============= OUTGOING MESSAGES (Backend → Frontend) =============

/**
 * Board update message - sends full board state to webview
 * Includes all view configuration from getBoardViewConfig()
 */
export interface BoardUpdateMessage extends BaseMessage {
    type: 'boardUpdate';
    board: KanbanBoard;
    // Core view settings
    columnBorder: string;
    taskBorder: string;
    tagVisibility: string;
    taskMinHeight: string;
    sectionHeight: string;
    taskSectionHeight: string;
    fontSize: string;
    fontFamily: string;
    columnWidth: string;
    layoutRows: number;
    rowHeight: string;
    layoutPreset: string;
    arrowKeyFocusScroll: string;
    // Additional config from getBoardViewConfig()
    layoutPresets?: Record<string, unknown>;
    maxRowHeight?: number;
    whitespace?: string;
    htmlCommentRenderMode?: string;
    htmlContentRenderMode?: string;
    tagColors?: Record<string, string>;
    enabledTagCategoriesColumn?: Record<string, boolean>;
    enabledTagCategoriesTask?: Record<string, boolean>;
    customTagCategories?: Record<string, unknown>;
    exportTagVisibility?: boolean;
    openLinksInNewTab?: boolean;
    pathGeneration?: 'relative' | 'absolute';
    imageMappings?: Record<string, string>;
    // Optional fields for full board loads
    isFullRefresh?: boolean;
    applyDefaultFolding?: boolean;
    version?: string;
    focusTargets?: FocusTarget[];
}

/**
 * Focus target for board update
 */
export interface FocusTarget {
    type: 'task' | 'column';
    id: string;
    operation: 'created' | 'modified' | 'deleted' | 'moved';
}

/**
 * Single column content update
 */
export interface UpdateColumnContentMessage extends BaseMessage {
    type: 'updateColumnContent';
    columnId: string;
    column: KanbanColumn;
    imageMappings: Record<string, string>;
}

/**
 * Single task content update
 */
export interface UpdateTaskContentMessage extends BaseMessage {
    type: 'updateTaskContent';
    taskId: string;
    columnId: string;
    task: KanbanTask;
    imageMappings: Record<string, string>;
}

/**
 * Undo/redo status update
 */
export interface UndoRedoStatusMessage extends BaseMessage {
    type: 'undoRedoStatus';
    canUndo: boolean;
    canRedo: boolean;
}

/**
 * File information update
 */
export interface FileInfoMessage extends BaseMessage {
    type: 'fileInfo';
    fileName: string;
    filePath: string;
    documentPath: string;
    isLocked: boolean;
}

/**
 * Operation started notification
 */
export interface OperationStartedMessage extends BaseMessage {
    type: 'operationStarted';
    operationId: string;
    operationType: string;
    description: string;
}

/**
 * Operation progress update
 */
export interface OperationProgressMessage extends BaseMessage {
    type: 'operationProgress';
    operationId: string;
    progress: number;
    message?: string;
}

/**
 * Operation completed notification
 */
export interface OperationCompletedMessage extends BaseMessage {
    type: 'operationCompleted';
    operationId: string;
}

/**
 * Request to stop editing (for capturing edit value before operations)
 */
export interface StopEditingRequestMessage extends RequestMessage {
    type: 'stopEditing';
    captureValue: boolean;
}

/**
 * Request to unfold columns before update
 */
export interface UnfoldColumnsRequestMessage extends RequestMessage {
    type: 'unfoldColumnsBeforeUpdate';
    columnIds: string[];
}

/**
 * Export result notification
 */
export interface ExportResultMessage extends BaseMessage {
    type: 'exportResult';
    success: boolean;
    message: string;
    path?: string;
}

/**
 * Marp themes list
 */
export interface MarpThemesMessage extends BaseMessage {
    type: 'marpThemes';
    themes: string[];
}

/**
 * Marp status
 */
export interface MarpStatusMessage extends BaseMessage {
    type: 'marpStatus';
    isAvailable: boolean;
    version?: string;
}

/**
 * Show message notification
 */
export interface ShowMessageMessage extends BaseMessage {
    type: 'showMessage';
    severity: 'info' | 'warning' | 'error';
    message: string;
}

/**
 * Tracked files debug info
 */
export interface TrackedFilesDebugInfoMessage extends BaseMessage {
    type: 'trackedFilesDebugInfo';
    files: TrackedFileInfo[];
}

export interface TrackedFileInfo {
    path: string;
    relativePath: string;
    isMainFile: boolean;
    hasUnsavedChanges: boolean;
    hasExternalChanges: boolean;
    contentLength: number;
}

/**
 * Content verification result
 */
export interface ContentVerificationResultMessage extends BaseMessage {
    type: 'contentVerificationResult';
    success: boolean;
    totalFiles: number;
    matchingFiles: number;
    mismatchedFiles: number;
    summary: string;
    fileResults: FileVerificationResult[];
}

export interface FileVerificationResult {
    path: string;
    matches: boolean;
    frontendContentLength: number;
    backendContentLength: number;
}

/**
 * Update include file content in frontend cache
 */
export interface UpdateIncludeContentMessage extends BaseMessage {
    type: 'updateIncludeContent';
    filePath: string;
    content: string;
}

/**
 * Dirty column info for sync
 */
export interface SyncDirtyColumnInfo {
    columnId: string;
    title: string;
    displayTitle?: string;
    includeMode?: boolean;
    includeFiles?: string[];
}

/**
 * Dirty task info for sync
 */
export interface SyncDirtyTaskInfo {
    columnId: string;
    taskId: string;
    displayTitle?: string;
    description?: string;
}

/**
 * Sync dirty items to frontend
 */
export interface SyncDirtyItemsMessage extends BaseMessage {
    type: 'syncDirtyItems';
    columns: SyncDirtyColumnInfo[];
    tasks: SyncDirtyTaskInfo[];
}

/**
 * Update keyboard shortcuts
 */
export interface UpdateShortcutsMessage extends BaseMessage {
    type: 'updateShortcuts';
    shortcuts: Record<string, string>;
}

/**
 * Extended column content update for include files
 */
export interface UpdateColumnContentExtendedMessage extends BaseMessage {
    type: 'updateColumnContent';
    columnId: string;
    tasks: KanbanTask[];
    columnTitle: string;
    displayTitle?: string;
    includeMode: boolean;
    includeFiles?: string[];
    isLoadingContent?: boolean;
    loadError?: boolean;
}

/**
 * Extended task content update for include files
 */
export interface UpdateTaskContentExtendedMessage extends BaseMessage {
    type: 'updateTaskContent';
    columnId: string;
    taskId: string;
    title?: string;
    description?: string;
    displayTitle?: string;
    taskTitle?: string;
    originalTitle?: string;
    includeMode: boolean;
    includeFiles?: string[];
    regularIncludeFiles?: string[];
    isLoadingContent?: boolean;
    loadError?: boolean;
}

/**
 * Configuration update message - sends view configuration to webview
 */
export interface ConfigurationUpdateMessage extends BaseMessage {
    type: 'configurationUpdate';
    config: Record<string, unknown>;
}

/**
 * Trigger snippet insertion in webview
 */
export interface TriggerSnippetMessage extends BaseMessage {
    type: 'triggerSnippet';
}

/**
 * Notify frontend that includes have been updated
 */
export interface IncludesUpdatedMessage extends BaseMessage {
    type: 'includesUpdated';
}

// ============= INCOMING MESSAGES (Frontend → Backend) =============

/**
 * Undo request
 */
export interface UndoMessage extends BaseMessage {
    type: 'undo';
}

/**
 * Redo request
 */
export interface RedoMessage extends BaseMessage {
    type: 'redo';
}

/**
 * Webview ready notification - sent by frontend when DOM is loaded and ready to receive messages
 */
export interface WebviewReadyMessage extends BaseMessage {
    type: 'webviewReady';
}

/**
 * Request board update
 */
export interface RequestBoardUpdateMessage extends BaseMessage {
    type: 'requestBoardUpdate';
}

/**
 * Board update from frontend (user edits)
 */
export interface BoardUpdateFromFrontendMessage extends BaseMessage {
    type: 'boardUpdate';
    board: KanbanBoard;
}

/**
 * Edit task request
 */
export interface EditTaskMessage extends BaseMessage {
    type: 'editTask';
    taskId: string;
    columnId: string;
    taskData: Partial<KanbanTask>;
}

/**
 * Move task request
 */
export interface MoveTaskMessage extends BaseMessage {
    type: 'moveTask';
    taskId: string;
    fromColumnId: string;
    toColumnId: string;
    newIndex: number;
}

/**
 * Add task request
 */
export interface AddTaskMessage extends BaseMessage {
    type: 'addTask';
    columnId: string;
    taskData: {
        title?: string;
        description?: string;
        [key: string]: unknown;
    };
}

/**
 * Delete task request
 */
export interface DeleteTaskMessage extends BaseMessage {
    type: 'deleteTask';
    taskId: string;
    columnId: string;
}

/**
 * Add task at specific position
 */
export interface AddTaskAtPositionMessage extends BaseMessage {
    type: 'addTaskAtPosition';
    columnId: string;
    taskData: {
        title?: string;
        description?: string;
        [key: string]: unknown;
    };
    insertionIndex: number;
}

/**
 * Duplicate task request
 */
export interface DuplicateTaskMessage extends BaseMessage {
    type: 'duplicateTask';
    taskId: string;
    columnId: string;
}

/**
 * Insert task before another task
 */
export interface InsertTaskBeforeMessage extends BaseMessage {
    type: 'insertTaskBefore';
    taskId: string;
    columnId: string;
}

/**
 * Insert task after another task
 */
export interface InsertTaskAfterMessage extends BaseMessage {
    type: 'insertTaskAfter';
    taskId: string;
    columnId: string;
}

/**
 * Move task to a different column
 */
export interface MoveTaskToColumnMessage extends BaseMessage {
    type: 'moveTaskToColumn';
    taskId: string;
    fromColumnId: string;
    toColumnId: string;
}

/**
 * Move task to top of column
 */
export interface MoveTaskToTopMessage extends BaseMessage {
    type: 'moveTaskToTop';
    taskId: string;
    columnId: string;
}

/**
 * Move task up in column
 */
export interface MoveTaskUpMessage extends BaseMessage {
    type: 'moveTaskUp';
    taskId: string;
    columnId: string;
}

/**
 * Move task down in column
 */
export interface MoveTaskDownMessage extends BaseMessage {
    type: 'moveTaskDown';
    taskId: string;
    columnId: string;
}

/**
 * Move task to bottom of column
 */
export interface MoveTaskToBottomMessage extends BaseMessage {
    type: 'moveTaskToBottom';
    taskId: string;
    columnId: string;
}

/**
 * Edit task title
 */
export interface EditTaskTitleMessage extends BaseMessage {
    type: 'editTaskTitle';
    taskId: string;
    columnId: string;
    title: string;
}

/**
 * Update task from strikethrough deletion
 */
export interface UpdateTaskFromStrikethroughDeletionMessage extends BaseMessage {
    type: 'updateTaskFromStrikethroughDeletion';
    taskId: string;
    columnId: string;
    newContent: string;
    contentType: 'title' | 'description';
}

/**
 * Add column request
 */
export interface AddColumnMessage extends BaseMessage {
    type: 'addColumn';
    title: string;
    position?: number;
}

/**
 * Move column request
 */
export interface MoveColumnMessage extends BaseMessage {
    type: 'moveColumn';
    fromIndex: number;
    toIndex: number;
    fromRow: number;
    toRow: number;
}

/**
 * Delete column request
 */
export interface DeleteColumnMessage extends BaseMessage {
    type: 'deleteColumn';
    columnId: string;
}

/**
 * Edit column title request
 */
export interface EditColumnTitleMessage extends BaseMessage {
    type: 'editColumnTitle';
    columnId: string;
    title: string;
}

/**
 * Move column with row update
 */
export interface MoveColumnWithRowUpdateMessage extends BaseMessage {
    type: 'moveColumnWithRowUpdate';
    columnId: string;
    newPosition: number;
    newRow: number;
}

/**
 * Reorder columns request
 */
export interface ReorderColumnsMessage extends BaseMessage {
    type: 'reorderColumns';
    newOrder: string[];
    movedColumnId: string;
    targetRow: number;
}

/**
 * Insert column before another column
 */
export interface InsertColumnBeforeMessage extends BaseMessage {
    type: 'insertColumnBefore';
    columnId: string;
    title: string;
}

/**
 * Insert column after another column
 */
export interface InsertColumnAfterMessage extends BaseMessage {
    type: 'insertColumnAfter';
    columnId: string;
    title: string;
}

/**
 * Sort column request
 */
export interface SortColumnMessage extends BaseMessage {
    type: 'sortColumn';
    columnId: string;
    sortType: 'unsorted' | 'title' | 'numericTag';
}

/**
 * Update column title from strikethrough deletion
 */
export interface UpdateColumnTitleFromStrikethroughDeletionMessage extends BaseMessage {
    type: 'updateColumnTitleFromStrikethroughDeletion';
    columnId: string;
    newTitle: string;
}

/**
 * Get templates request
 */
export interface GetTemplatesMessage extends BaseMessage {
    type: 'getTemplates';
}

/**
 * Apply template request
 */
export interface ApplyTemplateMessage extends BaseMessage {
    type: 'applyTemplate';
    templatePath: string;
    templateName?: string;
    isEmptyColumn?: boolean;
    targetRow?: number;
    insertAfterColumnId?: string;
    insertBeforeColumnId?: string;
    position?: 'first' | 'last';
    /** True if dropping on a drop zone (between stacks) - creates new stack, not joining existing */
    isDropZone?: boolean;
}

/**
 * Submit template variables request
 */
export interface SubmitTemplateVariablesMessage extends BaseMessage {
    type: 'submitTemplateVariables';
    templatePath: string;
    templateName?: string;
    variables: Record<string, string>;
    targetRow?: number;
    insertAfterColumnId?: string;
    insertBeforeColumnId?: string;
    position?: 'first' | 'last';
    /** True if dropping on a drop zone (between stacks) - creates new stack, not joining existing */
    isDropZone?: boolean;
}

/**
 * Render PlantUML request
 */
export interface RenderPlantUMLMessage extends RequestMessage {
    type: 'renderPlantUML';
    code: string;
    taskId?: string;
    columnId?: string;
}

/**
 * Convert PlantUML to SVG request
 */
export interface ConvertPlantUMLToSVGMessage extends BaseMessage {
    type: 'convertPlantUMLToSVG';
    plantUMLCode: string;
    filePath: string;
    svgContent: string;
}

/**
 * Convert Mermaid to SVG request
 */
export interface ConvertMermaidToSVGMessage extends BaseMessage {
    type: 'convertMermaidToSVG';
    mermaidCode: string;
    filePath: string;
    svgContent: string;
}

/**
 * Mermaid export success response
 */
export interface MermaidExportSuccessMessage extends BaseMessage {
    type: 'mermaidExportSuccess';
    requestId: string;
    svg: string;
}

/**
 * Mermaid export error response
 */
export interface MermaidExportErrorMessage extends BaseMessage {
    type: 'mermaidExportError';
    requestId: string;
    error: string;
}

/**
 * Request Draw.io render
 */
export interface RequestDrawIORenderMessage extends RequestMessage {
    type: 'requestDrawIORender';
    filePath: string;
    pageIndex?: number;
}

/**
 * Request Excalidraw render
 */
export interface RequestExcalidrawRenderMessage extends RequestMessage {
    type: 'requestExcalidrawRender';
    filePath: string;
}

/**
 * Request PDF page render
 */
export interface RequestPDFPageRenderMessage extends RequestMessage {
    type: 'requestPDFPageRender';
    filePath: string;
    pageNumber: number;
}

/**
 * Request PDF info
 */
export interface RequestPDFInfoMessage extends RequestMessage {
    type: 'requestPDFInfo';
    filePath: string;
}

// ============= UI MESSAGES =============

/**
 * Save board state request
 */
export interface SaveBoardStateMessage extends BaseMessage {
    type: 'saveBoardState';
    board: KanbanBoard;
}

/**
 * Show message request
 */
export interface ShowMessageRequestMessage extends BaseMessage {
    type: 'showMessage';
    text: string;
    messageType?: 'info' | 'warning' | 'error';
}

/**
 * Show error request
 */
export interface ShowErrorMessage extends BaseMessage {
    type: 'showError';
    text: string;
}

/**
 * Show info request
 */
export interface ShowInfoMessage extends BaseMessage {
    type: 'showInfo';
    text: string;
}

/**
 * Set preference request
 */
export interface SetPreferenceMessage extends BaseMessage {
    type: 'setPreference';
    key: string;
    value: unknown;
}

/**
 * Set context request
 */
export interface SetContextMessage extends BaseMessage {
    type: 'setContext';
    key: string;
    value: unknown;
}

/**
 * Request configuration refresh
 */
export interface RequestConfigurationRefreshMessage extends BaseMessage {
    type: 'requestConfigurationRefresh';
}

// ============= CLIPBOARD MESSAGES =============

/**
 * Drop position coordinates
 */
export interface DropPosition {
    x: number;
    y: number;
}

/**
 * Save clipboard image
 */
export interface SaveClipboardImageMessage extends BaseMessage {
    type: 'saveClipboardImage';
    imageData: string;
    imagePath: string;
    mediaFolderPath: string;
    dropPosition: DropPosition;
    imageFileName?: string;
    mediaFolderName?: string;
}

/**
 * Save clipboard image with path
 */
export interface SaveClipboardImageWithPathMessage extends BaseMessage {
    type: 'saveClipboardImageWithPath';
    imageData: string;
    imageType: string;
    dropPosition: DropPosition;
    md5Hash?: string;
}

/**
 * Paste image into field
 */
export interface PasteImageIntoFieldMessage extends BaseMessage {
    type: 'pasteImageIntoField';
    imageData: string;
    imageType: string;
    md5Hash?: string;
    cursorPosition?: number;
}

/**
 * Save dropped image from contents
 */
export interface SaveDroppedImageFromContentsMessage extends BaseMessage {
    type: 'saveDroppedImageFromContents';
    imageData: string;
    originalFileName: string;
    dropPosition: DropPosition;
}

/**
 * Copy image to media
 */
export interface CopyImageToMediaMessage extends BaseMessage {
    type: 'copyImageToMedia';
    sourcePath: string;
    originalFileName: string;
    dropPosition: DropPosition;
}

/**
 * Handle file URI drop
 */
export interface HandleFileUriDropMessage extends BaseMessage {
    type: 'handleFileUriDrop';
    sourcePath: string;
    originalFileName: string;
    dropPosition: DropPosition;
}

/**
 * Save dropped file from contents
 */
export interface SaveDroppedFileFromContentsMessage extends BaseMessage {
    type: 'saveDroppedFileFromContents';
    fileData: string;
    originalFileName: string;
    dropPosition: DropPosition;
}

/**
 * Request file drop dialogue
 */
export interface RequestFileDropDialogueMessage extends BaseMessage {
    type: 'requestFileDropDialogue';
    dropId: string;
    fileName: string;
    fileSize?: number;
    isImage: boolean;
    hasSourcePath: boolean;
    sourcePath?: string;
    partialHashData?: string;
    dropPosition: DropPosition;
}

/**
 * Execute file drop copy
 */
export interface ExecuteFileDropCopyMessage extends BaseMessage {
    type: 'executeFileDropCopy';
    sourcePath: string;
    fileName: string;
    isImage: boolean;
    dropPosition: DropPosition;
}

/**
 * Execute file drop link
 */
export interface ExecuteFileDropLinkMessage extends BaseMessage {
    type: 'executeFileDropLink';
    sourcePath: string;
    fileName: string;
    isImage: boolean;
    dropPosition: DropPosition;
}

/**
 * Link existing file
 */
export interface LinkExistingFileMessage extends BaseMessage {
    type: 'linkExistingFile';
    existingFile: string;
    fileName: string;
    isImage: boolean;
    dropPosition: DropPosition;
}

/**
 * Open media folder
 */
export interface OpenMediaFolderMessage extends BaseMessage {
    type: 'openMediaFolder';
}

/**
 * Create diagram file (Excalidraw or Draw.io)
 */
export interface CreateDiagramFileMessage extends BaseMessage {
    type: 'createDiagramFile';
    diagramType: 'excalidraw' | 'drawio';
    columnId: string;
    insertionIndex: number;
    dropPosition: DropPosition;
    sourceFilePath: string | null;  // null means use main file
}

// ============= EXPORT MESSAGES =============

/**
 * Stop auto export
 */
export interface StopAutoExportMessage extends BaseMessage {
    type: 'stopAutoExport';
}

/**
 * Get export default folder
 */
export interface GetExportDefaultFolderMessage extends BaseMessage {
    type: 'getExportDefaultFolder';
}

/**
 * Select export folder
 */
export interface SelectExportFolderMessage extends BaseMessage {
    type: 'selectExportFolder';
    defaultPath?: string;
}

/**
 * Get Marp themes
 */
export interface GetMarpThemesMessage extends BaseMessage {
    type: 'getMarpThemes';
}

/**
 * Poll Marp themes
 */
export interface PollMarpThemesMessage extends BaseMessage {
    type: 'pollMarpThemes';
}

/**
 * Open in Marp preview
 */
export interface OpenInMarpPreviewMessage extends BaseMessage {
    type: 'openInMarpPreview';
    filePath: string;
}

/**
 * Check Marp status
 */
export interface CheckMarpStatusMessage extends BaseMessage {
    type: 'checkMarpStatus';
}

/**
 * Get Marp available classes
 */
export interface GetMarpAvailableClassesMessage extends BaseMessage {
    type: 'getMarpAvailableClasses';
}

/**
 * Ask open export folder
 */
export interface AskOpenExportFolderMessage extends BaseMessage {
    type: 'askOpenExportFolder';
    path: string;
}

// ============= INCLUDE MESSAGES =============

/**
 * Confirm disable include mode
 */
export interface ConfirmDisableIncludeModeMessage extends BaseMessage {
    type: 'confirmDisableIncludeMode';
    message: string;
    columnId: string;
}

/**
 * Register inline include
 */
export interface RegisterInlineIncludeMessage extends BaseMessage {
    type: 'registerInlineInclude';
    filePath: string;
    content: string;
}

/**
 * Request include file name
 */
export interface RequestIncludeFileNameMessage extends BaseMessage {
    type: 'requestIncludeFileName';
    columnId?: string;
}

/**
 * Request edit include file name
 */
export interface RequestEditIncludeFileNameMessage extends BaseMessage {
    type: 'requestEditIncludeFileName';
    currentFile?: string;
    columnId?: string;
}

/**
 * Request edit task include file name
 */
export interface RequestEditTaskIncludeFileNameMessage extends BaseMessage {
    type: 'requestEditTaskIncludeFileName';
    currentFile?: string;
    taskId?: string;
    columnId?: string;
}

/**
 * Request task include file name
 */
export interface RequestTaskIncludeFileNameMessage extends BaseMessage {
    type: 'requestTaskIncludeFileName';
    taskId: string;
    columnId: string;
}

/**
 * Reload all included files
 */
export interface ReloadAllIncludedFilesMessage extends BaseMessage {
    type: 'reloadAllIncludedFiles';
}

/**
 * Save individual file
 */
export interface SaveIndividualFileMessage extends BaseMessage {
    type: 'saveIndividualFile';
    filePath: string;
    isMainFile: boolean;
    forceSave: boolean;
}

/**
 * Reload individual file
 */
export interface ReloadIndividualFileMessage extends BaseMessage {
    type: 'reloadIndividualFile';
    filePath: string;
    isMainFile: boolean;
}

// ============= EDIT MODE MESSAGES =============

/**
 * Editing started notification
 */
export interface EditingStartedMessage extends BaseMessage {
    type: 'editingStarted';
    taskId?: string;
    columnId?: string;
}

/**
 * Editing stopped normal
 */
export interface EditingStoppedNormalMessage extends BaseMessage {
    type: 'editingStoppedNormal';
    taskId: string;
    columnId: string;
}

/**
 * Mark unsaved changes
 */
export interface MarkUnsavedChangesMessage extends BaseMessage {
    type: 'markUnsavedChanges';
    cachedBoard?: KanbanBoard;
}

/**
 * Page hidden with unsaved changes
 */
export interface PageHiddenWithUnsavedChangesMessage extends BaseMessage {
    type: 'pageHiddenWithUnsavedChanges';
}

/**
 * Update Marp global setting
 */
export interface UpdateMarpGlobalSettingMessage extends BaseMessage {
    type: 'updateMarpGlobalSetting';
    key: string;
    value: unknown;
}

/**
 * Trigger VS Code snippet
 */
export interface TriggerVSCodeSnippetMessage extends BaseMessage {
    type: 'triggerVSCodeSnippet';
}

/**
 * Handle editor shortcut
 */
export interface HandleEditorShortcutMessage extends BaseMessage {
    type: 'handleEditorShortcut';
}

/**
 * Perform sort
 */
export interface PerformSortMessage extends BaseMessage {
    type: 'performSort';
}

/**
 * Runtime tracking report
 */
export interface RuntimeTrackingReportMessage extends BaseMessage {
    type: 'runtimeTrackingReport';
}

// ============= DEBUG MESSAGES =============

/**
 * Force write all content
 */
export interface ForceWriteAllContentMessage extends BaseMessage {
    type: 'forceWriteAllContent';
}

/**
 * Verify content sync
 */
export interface VerifyContentSyncMessage extends BaseMessage {
    type: 'verifyContentSync';
    frontendBoard: unknown;
}

/**
 * Get tracked files debug info
 */
export interface GetTrackedFilesDebugInfoMessage extends BaseMessage {
    type: 'getTrackedFilesDebugInfo';
}

/**
 * Clear tracked files cache
 */
export interface ClearTrackedFilesCacheMessage extends BaseMessage {
    type: 'clearTrackedFilesCache';
}

/**
 * Edit mode start notification
 */
export interface EditModeStartMessage extends BaseMessage {
    type: 'editModeStart';
    itemType: 'task' | 'column';
    itemId: string;
}

/**
 * Edit mode end notification
 */
export interface EditModeEndMessage extends BaseMessage {
    type: 'editModeEnd';
    itemType: 'task' | 'column';
    itemId: string;
}

/**
 * Editing stopped response (with captured value)
 */
export interface EditingStoppedMessage extends ResponseMessage {
    type: 'editingStopped';
    capturedEdit?: CapturedEdit;
}

/**
 * Columns unfolded response
 */
export interface ColumnsUnfoldedMessage extends ResponseMessage {
    type: 'columnsUnfolded';
}

/**
 * Open file link request
 */
export interface OpenFileLinkMessage extends BaseMessage {
    type: 'openFileLink';
    href: string;
    linkIndex?: number;
    taskId?: string;
    columnId?: string;
    includeContext?: {
        columnId?: string;
        taskId?: string;
        filePath?: string;
    };
}

/**
 * Open wiki link request
 */
export interface OpenWikiLinkMessage extends BaseMessage {
    type: 'openWikiLink';
    documentName: string;
    linkIndex?: number;
    taskId?: string;
    columnId?: string;
}

/**
 * Open external link request
 */
export interface OpenExternalLinkMessage extends BaseMessage {
    type: 'openExternalLink';
    href: string;
}

/**
 * Save board state request
 */
export interface SaveBoardStateMessage extends BaseMessage {
    type: 'saveBoardState';
}

/**
 * Save undo state request
 */
export interface SaveUndoStateMessage extends BaseMessage {
    type: 'saveUndoState';
    board?: KanbanBoard;
    currentBoard?: KanbanBoard;
}

/**
 * Request include file
 */
export interface RequestIncludeFileMessage extends BaseMessage {
    type: 'requestIncludeFile';
    columnId: string;
    filePath?: string;
}

/**
 * Export request
 */
export interface ExportMessage extends BaseMessage {
    type: 'export';
    format: string;
    options: Record<string, unknown>;
}

/**
 * Render completed notification
 */
export interface RenderCompletedMessage extends BaseMessage {
    type: 'renderCompleted';
    columnIds?: string[];
    taskIds?: string[];
    itemType?: 'task' | 'column';
    itemId?: string;
}

/**
 * Render skipped notification
 */
export interface RenderSkippedMessage extends BaseMessage {
    type: 'renderSkipped';
    reason: string;
    columnId?: string;
    taskId?: string;
    itemType?: 'task' | 'column';
    itemId?: string;
}

/**
 * Open file in editor request
 */
export interface OpenFileMessage extends BaseMessage {
    type: 'openFile';
    filePath: string;
}

/**
 * Open include file request
 */
export interface OpenIncludeFileMessage extends BaseMessage {
    type: 'openIncludeFile';
    filePath: string;
}

/**
 * Editor drop position info for file drops into editor fields
 */
export interface EditorDropPosition {
    columnId?: string;
    taskId?: string;
    position?: 'title' | 'description';
}

/**
 * Handle file drop request
 */
export interface HandleFileDropMessage extends BaseMessage {
    type: 'handleFileDrop';
    fileName: string;
    dropPosition?: EditorDropPosition;
    activeEditor?: {
        taskId?: string;
        columnId?: string;
        position?: string;
    };
}

/**
 * Handle URI drop request
 */
export interface HandleUriDropMessage extends BaseMessage {
    type: 'handleUriDrop';
    uris: string[];
    dropPosition?: EditorDropPosition;
    activeEditor?: {
        taskId?: string;
        columnId?: string;
        position?: string;
    };
}

/**
 * Toggle file lock request
 */
export interface ToggleFileLockMessage extends BaseMessage {
    type: 'toggleFileLock';
}

/**
 * Select file request
 */
export interface SelectFileMessage extends BaseMessage {
    type: 'selectFile';
}

/**
 * Request file info
 */
export interface RequestFileInfoMessage extends BaseMessage {
    type: 'requestFileInfo';
}

/**
 * Initialize file request
 */
export interface InitializeFileMessage extends BaseMessage {
    type: 'initializeFile';
}

/**
 * Resolve and copy path request
 */
export interface ResolveAndCopyPathMessage extends BaseMessage {
    type: 'resolveAndCopyPath';
    path: string;
}

/**
 * Convert paths in a single file
 */
export interface ConvertPathsMessage extends BaseMessage {
    type: 'convertPaths';
    filePath?: string;
    isMainFile?: boolean;
    direction: 'relative' | 'absolute';
}

/**
 * Convert paths in main file and all include files
 */
export interface ConvertAllPathsMessage extends BaseMessage {
    type: 'convertAllPaths';
    direction: 'relative' | 'absolute';
}

/**
 * Convert a single image/link path
 */
export interface ConvertSinglePathMessage extends BaseMessage {
    type: 'convertSinglePath';
    imagePath: string;
    direction: 'relative' | 'absolute';
    skipRefresh?: boolean;
}

/**
 * Open a file path directly
 */
export interface OpenPathMessage extends BaseMessage {
    type: 'openPath';
    filePath: string;
}

/**
 * Search for a file by name
 */
export interface SearchForFileMessage extends BaseMessage {
    type: 'searchForFile';
    filePath: string;
    taskId?: string;
    columnId?: string;
}

/**
 * Reveal a file path in the system file explorer
 */
export interface RevealPathInExplorerMessage extends BaseMessage {
    type: 'revealPathInExplorer';
    filePath: string;
}

/**
 * Browse for an image file to replace a broken image path
 */
export interface BrowseForImageMessage extends BaseMessage {
    type: 'browseForImage';
    oldPath: string;
    taskId?: string;
    columnId?: string;
}

/**
 * Delete an element (image, link, include) from the markdown source
 */
export interface DeleteFromMarkdownMessage extends BaseMessage {
    type: 'deleteFromMarkdown';
    path: string;
}

// ============= TYPE UNIONS =============

/**
 * All outgoing message types (Backend → Frontend)
 */
export type OutgoingMessage =
    | BoardUpdateMessage
    | UpdateColumnContentMessage
    | UpdateTaskContentMessage
    | UndoRedoStatusMessage
    | FileInfoMessage
    | OperationStartedMessage
    | OperationProgressMessage
    | OperationCompletedMessage
    | StopEditingRequestMessage
    | UnfoldColumnsRequestMessage
    | ExportResultMessage
    | MarpThemesMessage
    | MarpStatusMessage
    | ShowMessageMessage
    | TrackedFilesDebugInfoMessage
    | ContentVerificationResultMessage
    | UpdateIncludeContentMessage
    | SyncDirtyItemsMessage
    | UpdateShortcutsMessage
    | UpdateColumnContentExtendedMessage
    | UpdateTaskContentExtendedMessage
    | ConfigurationUpdateMessage
    | TriggerSnippetMessage
    | IncludesUpdatedMessage;

/**
 * All incoming message types (Frontend → Backend)
 */
export type IncomingMessage =
    | UndoMessage
    | RedoMessage
    | RequestBoardUpdateMessage
    | BoardUpdateFromFrontendMessage
    | EditTaskMessage
    | MoveTaskMessage
    | AddTaskMessage
    | DeleteTaskMessage
    | AddTaskAtPositionMessage
    | DuplicateTaskMessage
    | InsertTaskBeforeMessage
    | InsertTaskAfterMessage
    | MoveTaskToColumnMessage
    | MoveTaskToTopMessage
    | MoveTaskUpMessage
    | MoveTaskDownMessage
    | MoveTaskToBottomMessage
    | EditTaskTitleMessage
    | UpdateTaskFromStrikethroughDeletionMessage
    | AddColumnMessage
    | MoveColumnMessage
    | DeleteColumnMessage
    | EditColumnTitleMessage
    | MoveColumnWithRowUpdateMessage
    | ReorderColumnsMessage
    | InsertColumnBeforeMessage
    | InsertColumnAfterMessage
    | SortColumnMessage
    | UpdateColumnTitleFromStrikethroughDeletionMessage
    | GetTemplatesMessage
    | ApplyTemplateMessage
    | SubmitTemplateVariablesMessage
    | RenderPlantUMLMessage
    | ConvertPlantUMLToSVGMessage
    | ConvertMermaidToSVGMessage
    | MermaidExportSuccessMessage
    | MermaidExportErrorMessage
    | RequestDrawIORenderMessage
    | RequestExcalidrawRenderMessage
    | RequestPDFPageRenderMessage
    | RequestPDFInfoMessage
    | EditModeStartMessage
    | EditModeEndMessage
    | EditingStoppedMessage
    | ColumnsUnfoldedMessage
    | OpenFileLinkMessage
    | OpenWikiLinkMessage
    | OpenExternalLinkMessage
    | OpenFileMessage
    | OpenIncludeFileMessage
    | HandleFileDropMessage
    | HandleUriDropMessage
    | ToggleFileLockMessage
    | SelectFileMessage
    | RequestFileInfoMessage
    | InitializeFileMessage
    | ResolveAndCopyPathMessage
    | SaveBoardStateMessage
    | SaveUndoStateMessage
    | RequestIncludeFileMessage
    | ExportMessage
    | RenderCompletedMessage
    | RenderSkippedMessage
    | UpdateIncludeContentMessage
    | SyncDirtyItemsMessage
    | UpdateShortcutsMessage
    | UpdateColumnContentExtendedMessage
    | UpdateTaskContentExtendedMessage
    // UI messages
    | ShowMessageRequestMessage
    | ShowErrorMessage
    | ShowInfoMessage
    | SetPreferenceMessage
    | SetContextMessage
    | RequestConfigurationRefreshMessage
    // Clipboard messages
    | SaveClipboardImageMessage
    | SaveClipboardImageWithPathMessage
    | PasteImageIntoFieldMessage
    | SaveDroppedImageFromContentsMessage
    | CopyImageToMediaMessage
    | HandleFileUriDropMessage
    | SaveDroppedFileFromContentsMessage
    | RequestFileDropDialogueMessage
    | ExecuteFileDropCopyMessage
    | ExecuteFileDropLinkMessage
    | LinkExistingFileMessage
    | OpenMediaFolderMessage
    | CreateDiagramFileMessage
    // Export messages
    | StopAutoExportMessage
    | GetExportDefaultFolderMessage
    | SelectExportFolderMessage
    | GetMarpThemesMessage
    | PollMarpThemesMessage
    | OpenInMarpPreviewMessage
    | CheckMarpStatusMessage
    | GetMarpAvailableClassesMessage
    | AskOpenExportFolderMessage
    // Include messages
    | ConfirmDisableIncludeModeMessage
    | RegisterInlineIncludeMessage
    | RequestIncludeFileNameMessage
    | RequestEditIncludeFileNameMessage
    | RequestEditTaskIncludeFileNameMessage
    | RequestTaskIncludeFileNameMessage
    | ReloadAllIncludedFilesMessage
    | SaveIndividualFileMessage
    | ReloadIndividualFileMessage
    // EditMode messages
    | EditingStartedMessage
    | EditingStoppedNormalMessage
    | MarkUnsavedChangesMessage
    | PageHiddenWithUnsavedChangesMessage
    | UpdateMarpGlobalSettingMessage
    | TriggerVSCodeSnippetMessage
    | HandleEditorShortcutMessage
    | PerformSortMessage
    | RuntimeTrackingReportMessage
    // Debug messages
    | ForceWriteAllContentMessage
    | VerifyContentSyncMessage
    | GetTrackedFilesDebugInfoMessage
    | ClearTrackedFilesCacheMessage
    // Path conversion messages
    | ConvertPathsMessage
    | ConvertAllPathsMessage
    | ConvertSinglePathMessage
    | OpenPathMessage
    | SearchForFileMessage
    | RevealPathInExplorerMessage
    | BrowseForImageMessage
    | DeleteFromMarkdownMessage;

/**
 * Message type string literals for type-safe checking
 */
export type OutgoingMessageType = OutgoingMessage['type'];
export type IncomingMessageType = IncomingMessage['type'];

// ============= TYPE GUARDS =============

/**
 * Check if message is a request (has requestId)
 */
export function isRequestMessage(message: BaseMessage): message is RequestMessage {
    return 'requestId' in message && typeof (message as RequestMessage).requestId === 'string';
}

/**
 * Check if message is a response
 */
export function isResponseMessage(message: BaseMessage): message is ResponseMessage {
    return 'requestId' in message && typeof (message as ResponseMessage).requestId === 'string';
}

/**
 * Type guard for specific message types
 */
export function isMessageType<T extends BaseMessage>(
    message: BaseMessage,
    type: T['type']
): message is T {
    return message.type === type;
}
