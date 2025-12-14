/**
 * Core module barrel file
 * Centralized exports for core infrastructure
 */

// Change handling
export { UnifiedChangeHandler } from './UnifiedChangeHandler';
export {
    ChangeStateMachine,
    ChangeState,
    FileSystemChangeEvent,
    UserEditEvent,
    SaveEvent,
    IncludeSwitchEvent,
    ChangeEvent,
    ChangeContext,
    ChangeResult
} from './ChangeStateMachine';

// Include loading
export {
    IncludeLoadingProcessor,
    TargetResolution,
    IncludeLoadingDependencies
} from './IncludeLoadingProcessor';

// File save service
export { FileSaveService } from './FileSaveService';

// Sub-modules
export * from './stores';
export * from './bridge';
export * from './events';
