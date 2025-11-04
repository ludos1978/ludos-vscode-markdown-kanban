/**
 * Conflict Types and Interfaces
 *
 * Defines all types related to conflict detection and resolution.
 */

/**
 * Conflict context - information about the current state when checking for conflicts
 */
export interface ConflictContext {
    /** Path to the file being checked */
    filePath: string;

    /** Whether there are unsaved changes in the current session */
    hasUnsavedChanges: boolean;

    /** Whether the user is currently editing the file */
    isEditing: boolean;

    /** Timestamp when the conflict check was initiated */
    timestamp: Date;

    /** Additional context-specific data */
    metadata?: Record<string, any>;
}

/**
 * Conflict severity levels
 */
export type ConflictSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Conflict types
 */
export type ConflictType =
    | 'concurrent-modification'
    | 'external-change'
    | 'file-deleted'
    | 'permission-denied'
    | 'network-error'
    | 'file-locked'
    | 'corrupted-content';

/**
 * Conflict information
 */
export interface Conflict {
    /** Unique identifier for this conflict */
    id: string;

    /** Type of conflict */
    type: ConflictType;

    /** Severity level */
    severity: ConflictSeverity;

    /** Human-readable description */
    description: string;

    /** Detailed explanation */
    details: string;

    /** Context in which the conflict was detected */
    context: ConflictContext;

    /** Timestamp when conflict was detected */
    timestamp: Date;

    /** Suggested resolution options */
    suggestedResolutions: ConflictResolution[];

    /** Additional conflict-specific data */
    metadata?: Record<string, any>;
}

/**
 * Conflict resolution actions
 */
export type ConflictResolutionAction =
    | 'save'              // Save current changes
    | 'discard_local'     // Discard local changes, use external
    | 'discard_external'  // Keep local changes, ignore external
    | 'backup_and_save'  // Backup current, then save
    | 'backup_and_reload' // Backup current, then reload external
    | 'merge'             // Attempt to merge changes
    | 'ignore'            // Ignore the conflict
    | 'cancel';           // Cancel operation

/**
 * Conflict resolution
 */
export interface ConflictResolution {
    /** The chosen action */
    action: ConflictResolutionAction;

    /** Human-readable description of the resolution */
    description: string;

    /** Whether the resolution should proceed with the operation */
    shouldProceed: boolean;

    /** Whether a backup should be created */
    shouldCreateBackup: boolean;

    /** Whether changes should be saved */
    shouldSave: boolean;

    /** Whether external changes should be loaded */
    shouldReload: boolean;

    /** Whether the conflict should be ignored */
    shouldIgnore: boolean;

    /** Custom action data (for complex resolutions) */
    customAction?: string;

    /** Additional resolution-specific data */
    metadata?: Record<string, any>;
}

/**
 * Predefined conflict resolution options
 */
export const CONFLICT_RESOLUTIONS = {
    SAVE: {
        action: 'save' as ConflictResolutionAction,
        description: 'Save current changes',
        shouldProceed: true,
        shouldCreateBackup: false,
        shouldSave: true,
        shouldReload: false,
        shouldIgnore: false
    },

    DISCARD_LOCAL: {
        action: 'discard_local' as ConflictResolutionAction,
        description: 'Discard local changes and reload',
        shouldProceed: true,
        shouldCreateBackup: false,
        shouldSave: false,
        shouldReload: true,
        shouldIgnore: false
    },

    BACKUP_AND_RELOAD: {
        action: 'backup_and_reload' as ConflictResolutionAction,
        description: 'Save backup and reload external changes',
        shouldProceed: true,
        shouldCreateBackup: true,
        shouldSave: false,
        shouldReload: true,
        shouldIgnore: false
    },

    IGNORE: {
        action: 'ignore' as ConflictResolutionAction,
        description: 'Ignore conflict and continue',
        shouldProceed: true,
        shouldCreateBackup: false,
        shouldSave: false,
        shouldReload: false,
        shouldIgnore: true
    },

    CANCEL: {
        action: 'cancel' as ConflictResolutionAction,
        description: 'Cancel operation',
        shouldProceed: false,
        shouldCreateBackup: false,
        shouldSave: false,
        shouldReload: false,
        shouldIgnore: false
    }
} as const;