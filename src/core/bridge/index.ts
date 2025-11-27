/**
 * Bridge Exports
 *
 * Unified webview communication layer with typed messages.
 */

// Message type definitions
export {
    // Base types
    BaseMessage,
    RequestMessage,
    ResponseMessage,

    // Outgoing messages (Backend → Frontend)
    BoardUpdateMessage,
    FocusTarget,
    UpdateColumnContentMessage,
    UpdateTaskContentMessage,
    UndoRedoStatusMessage,
    FileInfoMessage,
    OperationStartedMessage,
    OperationProgressMessage,
    OperationCompletedMessage,
    StopEditingRequestMessage,
    UnfoldColumnsRequestMessage,
    ExportResultMessage,
    MarpThemesMessage,
    MarpStatusMessage,
    ShowMessageMessage,
    TrackedFilesDebugInfoMessage,
    TrackedFileInfo,
    ContentVerificationResultMessage,
    FileVerificationResult,

    // Incoming messages (Frontend → Backend)
    UndoMessage,
    RedoMessage,
    RequestBoardUpdateMessage,
    BoardUpdateFromFrontendMessage,
    EditTaskMessage,
    MoveTaskMessage,
    AddTaskMessage,
    DeleteTaskMessage,
    AddColumnMessage,
    MoveColumnMessage,
    DeleteColumnMessage,
    EditColumnTitleMessage,
    EditModeStartMessage,
    EditModeEndMessage,
    EditingStoppedMessage,
    ColumnsUnfoldedMessage,
    OpenFileLinkMessage,
    OpenWikiLinkMessage,
    OpenExternalLinkMessage,
    SaveBoardStateMessage,
    SaveUndoStateMessage,
    RequestIncludeFileMessage,
    ExportMessage,
    RenderCompletedMessage,
    RenderSkippedMessage,

    // Type unions
    OutgoingMessage,
    IncomingMessage,
    OutgoingMessageType,
    IncomingMessageType,

    // Type guards
    isRequestMessage,
    isResponseMessage,
    isMessageType
} from './MessageTypes';

// WebviewBridge
export {
    WebviewBridge,
    WebviewBridgeOptions,
    WebviewBridgeState,
    PendingRequest
} from './WebviewBridge';
