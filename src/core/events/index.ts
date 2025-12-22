/**
 * Event System Exports
 *
 * Central export point for the event-driven architecture.
 */

export { EventBus, eventBus } from './EventBus';
export {
    EventType,
    BoardChangeTrigger,
    BaseEvent,
    BoardChangedEvent,
    BoardLoadedEvent,
    BoardInvalidatedEvent,
    FileContentChangedEvent,
    FileExternalChangeEvent,
    FileSavedEvent,
    MediaChangedEvent,
    FocusGainedEvent,
    FocusLostEvent,
    // NEW: Event-driven architecture events
    LinkReplaceRequestedEvent,
    WebviewUpdateRequestedEvent,
    WebviewHtmlRequestedEvent,
    PanelClosingEvent,
    ConfigRefreshRequestedEvent,
    AppEvent,
    createEvent,
} from './EventTypes';
export { BoardSyncHandler, BoardSyncDependencies } from './BoardSyncHandler';
export { FileSyncHandler, FileSyncDependencies, FileSyncOptions, FileSyncResult } from './FileSyncHandler';
// NEW: Event-driven handlers
export { LinkReplacementHandler, LinkReplacementDependencies } from './LinkReplacementHandler';
export { BoardInitializationHandler, BoardInitializationDependencies, BoardInitializationResult } from './BoardInitializationHandler';
