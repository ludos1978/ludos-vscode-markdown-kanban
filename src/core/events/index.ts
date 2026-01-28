/**
 * Event System Exports
 *
 * Central export point for the event-driven architecture.
 */

export { EventBus, eventBus } from './EventBus';
export { ScopedEventBus } from './ScopedEventBus';
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
    // Event-driven architecture events
    WebviewUpdateRequestedEvent,
    WebviewHtmlRequestedEvent,
    PanelClosingEvent,
    ConfigRefreshRequestedEvent,
    AppEvent,
    createEvent,
} from './EventTypes';
export { BoardSyncHandler, BoardSyncDependencies } from './BoardSyncHandler';
export { FileSyncHandler, FileSyncDependencies, FileSyncOptions, FileSyncResult } from './FileSyncHandler';
// NEW: Event-driven handlers (LinkReplacementHandler moved to services/LinkReplacementService)
export { BoardInitializationHandler, BoardInitializationDependencies, BoardInitializationResult } from './BoardInitializationHandler';
export { FileRegistryChangeHandler, FileRegistryChangeDependencies } from './FileRegistryChangeHandler';
