/**
 * File State Machine Types
 *
 * Defines all states, transitions, and metadata for the file state machine system.
 */

/**
 * Base file states (shared by all file types)
 */
export enum FileState {
    /** File not yet initialized */
    IDLE = 'IDLE',
    /** File is being loaded from disk */
    LOADING = 'LOADING',
    /** File loaded and ready, cache is valid */
    LOADED = 'LOADED',
    /** File has unsaved changes */
    DIRTY = 'DIRTY',
    /** File is being saved to disk */
    SAVING = 'SAVING',
    /** File has conflict (external + unsaved changes) */
    CONFLICTED = 'CONFLICTED'
}

/**
 * Additional states specific to include files
 */
export enum IncludeFileState {
    /** Include file is being switched out (before unload) */
    SWITCHING_OUT = 'SWITCHING_OUT',
    /** Include file is being unloaded (cache clearing) */
    UNLOADING = 'UNLOADING',
    /** Include file has been disposed */
    DISPOSED = 'DISPOSED',
    /** Include file is being reloaded (after switch) */
    RELOADING = 'RELOADING'
}

/**
 * Main file coordinator states
 */
export enum CoordinatorState {
    /** System is stable, no changes being processed */
    STABLE = 'STABLE',
    /** Detecting what changed (main file, includes, switches) */
    DETECTING_CHANGES = 'DETECTING_CHANGES',
    /** Analyzing changes to determine proper flow */
    ANALYZING = 'ANALYZING',
    /** Coordinating include file operations */
    COORDINATING_INCLUDES = 'COORDINATING_INCLUDES',
    /** Updating UI with new data */
    UPDATING_UI = 'UPDATING_UI',
    /** Resolving conflicts */
    CONFLICT_RESOLUTION = 'CONFLICT_RESOLUTION'
}

/**
 * Cache state tracking
 */
export enum CacheState {
    /** Cache is valid and up-to-date */
    VALID = 'VALID',
    /** Cache has been invalidated */
    INVALID = 'INVALID',
    /** Cache is partially valid (some includes stale) */
    PARTIAL = 'PARTIAL'
}

/**
 * Change types for tracking modifications
 */
export enum ChangeType {
    /** Content changed (no structure modifications) */
    CONTENT = 'CONTENT',
    /** Structure changed (columns/tasks added/removed/reordered) */
    STRUCTURE = 'STRUCTURE',
    /** Include file paths changed (switches) */
    INCLUDES = 'INCLUDES',
    /** External file modification detected */
    EXTERNAL = 'EXTERNAL',
    /** Internal modification from UI */
    INTERNAL = 'INTERNAL'
}

/**
 * State transition metadata
 */
export interface StateTransition {
    /** Source state */
    from: FileState | IncludeFileState | CoordinatorState;
    /** Target state */
    to: FileState | IncludeFileState | CoordinatorState;
    /** Timestamp of transition */
    timestamp: number;
    /** Reason for transition */
    reason?: string;
    /** Change type that triggered transition */
    changeType?: ChangeType;
}

/**
 * State machine context (extended state data)
 */
export interface StateMachineContext {
    /** Current file state */
    state: FileState | IncludeFileState;
    /** Cache validity state */
    cacheState: CacheState;
    /** Last change type */
    lastChangeType?: ChangeType;
    /** Previous state (for rollback) */
    previousState?: FileState | IncludeFileState;
    /** Previous content (for rollback) */
    previousContent?: string;
    /** Error during last operation */
    lastError?: Error;
    /** Transition history (for debugging) */
    transitionHistory: StateTransition[];
}

/**
 * Change analysis result from coordinator
 */
export interface ChangeAnalysis {
    /** Main file content changed */
    hasMainContentChange: boolean;
    /** Main file structure changed (columns/tasks) */
    hasMainStructureChange: boolean;
    /** Include file content changed */
    hasIncludeContentChange: boolean;
    /** Include file paths switched */
    hasSwitchedIncludes: boolean;
    /** List of switched include files */
    switchedFiles: Array<{
        oldPath: string;
        newPath: string;
        includeType: 'column' | 'task' | 'regular';
    }>;
    /** List of include files with content changes */
    changedIncludeFiles: string[];
    /** Whether changes came from legitimate save */
    isLegitimateSave: boolean;
}

/**
 * State machine configuration
 */
export interface StateMachineConfig {
    /** Enable transition logging */
    enableLogging: boolean;
    /** Maximum transition history size */
    maxHistorySize: number;
    /** Enable automatic rollback on errors */
    enableAutoRollback: boolean;
}
