/**
 * Event System Exports
 *
 * Central event bus infrastructure for the Kanban panel.
 * This is NEW infrastructure - no existing code is being replaced.
 */

// Main exports
export {
    PanelEventBus,
    PanelEvent,
    HandlerPriority,
    HandlerOptions,
    EventBusOptions,
    Middleware,
    MiddlewareContext,
    EventBusMetrics
} from './PanelEventBus';

export {
    EventDefinitions,
    EventType,
    EventPayload,
    // Individual payload types for convenience
    BoardLoadingPayload,
    BoardLoadedPayload,
    BoardUpdatedPayload,
    BoardDirtyPayload,
    BoardErrorPayload,
    FileLoadRequestedPayload,
    FileSaveRequestedPayload,
    FileChangedPayload,
    FileConflictPayload,
    FileSavedPayload,
    FileSaveErrorPayload,
    FileReloadRequestedPayload,
    FileReloadedPayload,
    FileUnsavedOnClosePayload,
    IncludeLoadedPayload,
    IncludeSavedPayload,
    IncludeErrorPayload,
    IncludeSwitchRequestedPayload,
    IncludeSwitchedPayload,
    EditStartedPayload,
    EditCompletedPayload,
    EditCancelledPayload,
    UndoRedoStateChangedPayload,
    UndoCompletedPayload,
    RedoCompletedPayload,
    WebviewMessagePayload,
    DebugEventSlowPayload,
    DebugHandlerErrorPayload
} from './EventDefinitions';

// Middleware
export * from './middleware';

// Testing utilities
export * from './testing';
