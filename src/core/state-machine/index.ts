/**
 * File State Machine Module
 *
 * Provides hierarchical state machine system for file lifecycle management:
 * - FileStateMachine: Base state machine for all files
 * - IncludeFileStateMachine: Extended with include-specific states
 * - MainFileCoordinator: Orchestrates all file changes through unified flow
 */

export { FileStateMachine } from './FileStateMachine';
export { IncludeFileStateMachine } from './IncludeFileStateMachine';
export { MainFileCoordinator } from './MainFileCoordinator';
export type { IncludeFileRef, CoordinatorContext } from './MainFileCoordinator';

export {
    FileState,
    IncludeFileState,
    CoordinatorState,
    CacheState,
    ChangeType
} from './FileStateTypes';

export type {
    StateTransition,
    StateMachineContext,
    ChangeAnalysis,
    StateMachineConfig
} from './FileStateTypes';
