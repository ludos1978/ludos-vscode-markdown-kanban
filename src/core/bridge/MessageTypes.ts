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
 */
export interface BoardUpdateMessage extends BaseMessage {
    type: 'boardUpdate';
    board: KanbanBoard;
    imageMappings: Record<string, string>;
    columnBorder: string;
    taskBorder: string;
    htmlRenderMode: string;
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
    sourceColumnId: string;
    targetColumnId: string;
    targetIndex: number;
}

/**
 * Add task request
 */
export interface AddTaskMessage extends BaseMessage {
    type: 'addTask';
    columnId: string;
    title: string;
    description?: string;
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
    columnId: string;
    targetIndex: number;
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
    capturedEdit?: {
        type: 'task' | 'column';
        id: string;
        value: string;
    };
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
    path: string;
}

/**
 * Open wiki link request
 */
export interface OpenWikiLinkMessage extends BaseMessage {
    type: 'openWikiLink';
    link: string;
}

/**
 * Open external link request
 */
export interface OpenExternalLinkMessage extends BaseMessage {
    type: 'openExternalLink';
    url: string;
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
    board: KanbanBoard;
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
    options: Record<string, any>;
}

/**
 * Render completed notification
 */
export interface RenderCompletedMessage extends BaseMessage {
    type: 'renderCompleted';
    columnIds?: string[];
    taskIds?: string[];
}

/**
 * Render skipped notification
 */
export interface RenderSkippedMessage extends BaseMessage {
    type: 'renderSkipped';
    reason: string;
    columnId?: string;
    taskId?: string;
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
    | ContentVerificationResultMessage;

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
    | AddColumnMessage
    | MoveColumnMessage
    | DeleteColumnMessage
    | EditColumnTitleMessage
    | EditModeStartMessage
    | EditModeEndMessage
    | EditingStoppedMessage
    | ColumnsUnfoldedMessage
    | OpenFileLinkMessage
    | OpenWikiLinkMessage
    | OpenExternalLinkMessage
    | SaveBoardStateMessage
    | SaveUndoStateMessage
    | RequestIncludeFileMessage
    | ExportMessage
    | RenderCompletedMessage
    | RenderSkippedMessage;

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
