import { ConflictResolution } from './types/ConflictTypes';
import { ConflictContext } from '../conflictResolver';
import { IStateManager } from './types/ApplicationState';

// Define Conflict interface locally to match what we need
interface Conflict {
    id: string;
    type: string;
    severity: string;
    description: string;
    details: string;
    context: ConflictContext;
    timestamp: Date;
    suggestedResolutions: ConflictResolution[];
}

/**
 * Conflict Engine - Centralized Conflict Detection
 *
 * Single source for all conflict detection logic to ensure consistency
 * across all components and scenarios.
 */
export class ConflictEngine {
    constructor(private stateManager: IStateManager) {}

    /**
     * Detect conflicts for a given context
     * SINGLE ALGORITHM - used by all components
     */
    detectConflicts(context: ConflictContext): Conflict[] {
        const conflicts: Conflict[] = [];

        console.log(`[ConflictEngine] Detecting conflicts for ${context.fileType}:${context.fileName}`);

        // Check for concurrent modification conflicts
        const concurrentConflict = this._detectConcurrentModification(context);
        if (concurrentConflict) {
            conflicts.push(concurrentConflict);
        }

        // Check for external change conflicts
        const externalConflict = this._detectExternalChange(context);
        if (externalConflict) {
            conflicts.push(externalConflict);
        }

        // Check for file system conflicts
        const fileSystemConflict = this._detectFileSystemConflict(context);
        if (fileSystemConflict) {
            conflicts.push(fileSystemConflict);
        }

        console.log(`[ConflictEngine] Detected ${conflicts.length} conflict(s)`);
        return conflicts;
    }

    /**
     * Detect concurrent modification conflicts
     * User has unsaved changes AND file was modified externally
     */
    private _detectConcurrentModification(context: ConflictContext): Conflict | null {
        const hasUnsavedChanges = context.hasMainUnsavedChanges || context.hasIncludeUnsavedChanges;
        const hasExternalChanges = context.hasExternalChanges || false;

        if (hasUnsavedChanges && hasExternalChanges) {
            // Check if this is a legitimate external save (should take precedence)
            const isLegitimateSave = this._isLegitimateExternalSave(context);

            if (!isLegitimateSave) {
                // This is a true concurrent modification conflict
                return {
                    id: `concurrent_${Date.now()}`,
                    type: 'concurrent-modification',
                    severity: 'high',
                    description: 'File has both local changes and external modifications',
                    details: 'You have unsaved changes and the file was modified externally. Choose how to resolve this conflict.',
                    context,
                    timestamp: new Date(),
                    suggestedResolutions: [
                        {
                            action: 'save',
                            description: 'Save my changes and ignore external',
                            shouldProceed: true,
                            shouldCreateBackup: false,
                            shouldSave: true,
                            shouldReload: false,
                            shouldIgnore: false
                        },
                        {
                            action: 'discard_local',
                            description: 'Discard my changes and reload',
                            shouldProceed: true,
                            shouldCreateBackup: false,
                            shouldSave: false,
                            shouldReload: true,
                            shouldIgnore: false
                        },
                        {
                            action: 'backup_and_reload',
                            description: 'Save my changes as backup and reload',
                            shouldProceed: true,
                            shouldCreateBackup: true,
                            shouldSave: false,
                            shouldReload: true,
                            shouldIgnore: false
                        }
                    ]
                };
            }
        }

        return null;
    }

    /**
     * Detect external change conflicts
     * File was modified externally but no local changes
     */
    private _detectExternalChange(context: ConflictContext): Conflict | null {
        const hasExternalChanges = context.hasExternalChanges || false;
        const hasUnsavedChanges = context.hasMainUnsavedChanges || context.hasIncludeUnsavedChanges;
        const isInEditMode = context.isInEditMode || false;

        // Auto-reload if no unsaved changes and not in edit mode
        if (hasExternalChanges && !hasUnsavedChanges && !isInEditMode) {
            console.log(`[ConflictEngine] Auto-reload: external changes, no unsaved changes, not in edit mode`);
            return null; // No conflict - auto-resolve
        }

        // Conflict if external changes but user is actively editing
        if (hasExternalChanges && isInEditMode) {
            return {
                id: `external_edit_${Date.now()}`,
                type: 'external-change',
                severity: 'medium',
                description: 'File modified externally while editing',
                details: 'The file was modified externally while you were actively editing. You can continue editing or reload the external changes.',
                context,
                timestamp: new Date(),
                suggestedResolutions: [
                    {
                        action: 'ignore',
                        description: 'Continue editing (ignore external changes)',
                        shouldProceed: true,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: false,
                        shouldIgnore: true
                    },
                    {
                        action: 'discard_local',
                        description: 'Reload external changes',
                        shouldProceed: true,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: true,
                        shouldIgnore: false
                    }
                ]
            };
        }

        return null;
    }

    /**
     * Detect file system conflicts
     * File deleted, permission issues, etc.
     */
    private _detectFileSystemConflict(context: ConflictContext): Conflict | null {
        // Check if file exists using state manager
        const fileState = this.stateManager.getFileState(context.filePath);

        if (fileState && !fileState.exists) {
            return {
                id: `file_deleted_${Date.now()}`,
                type: 'file-deleted',
                severity: 'high',
                description: 'File was deleted externally',
                details: 'The file has been deleted externally. You can save your current changes as a new file.',
                context,
                timestamp: new Date(),
                suggestedResolutions: [
                    {
                        action: 'save',
                        description: 'Save current changes',
                        shouldProceed: true,
                        shouldCreateBackup: false,
                        shouldSave: true,
                        shouldReload: false,
                        shouldIgnore: false
                    },
                    {
                        action: 'discard_local',
                        description: 'Discard changes',
                        shouldProceed: true,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: false,
                        shouldIgnore: false
                    }
                ]
            };
        }

        return null;
    }

    /**
     * Check if external change was a legitimate save operation
     * Used to distinguish between saves and concurrent editing
     */
    private _isLegitimateExternalSave(context: ConflictContext): boolean {
        // If no timestamp information available, assume concurrent editing
        if (!context.lastExternalSaveTime || !context.externalChangeTime) {
            console.log(`[ConflictEngine] No timestamp info - assuming concurrent editing`);
            return false;
        }

        // Calculate time difference between last known external save and current change detection
        const timeDiff = context.externalChangeTime.getTime() - context.lastExternalSaveTime.getTime();
        const timeDiffSeconds = timeDiff / 1000;

        console.log(`[ConflictEngine] Time analysis:`, {
            lastExternalSave: context.lastExternalSaveTime.toISOString(),
            externalChangeDetected: context.externalChangeTime.toISOString(),
            timeDiffSeconds,
            thresholdSeconds: 30
        });

        // If external change happened more than 30 seconds after last known external save,
        // it's likely a new legitimate save operation that should take precedence
        const LEGITIMATE_SAVE_THRESHOLD_SECONDS = 30;
        const isLegitimate = timeDiffSeconds > LEGITIMATE_SAVE_THRESHOLD_SECONDS;

        console.log(`[ConflictEngine] Result: ${isLegitimate ? 'LEGITIMATE SAVE' : 'CONCURRENT EDITING'}`);

        return isLegitimate;
    }

    /**
     * Resolve a conflict using the engine's logic
     */
    resolveConflict(conflict: Conflict): ConflictResolution {
        console.log(`[ConflictEngine] Resolving conflict: ${conflict.id} (${conflict.type})`);

        // For auto-resolvable conflicts, return the resolution directly
        switch (conflict.type) {
            case 'external-change':
                // If no unsaved changes and not in edit mode, auto-reload
                if (!conflict.context.hasMainUnsavedChanges &&
                    !conflict.context.hasIncludeUnsavedChanges &&
                    !conflict.context.isInEditMode) {
                    return {
                        action: 'discard_local',
                        description: 'Auto-reload external changes',
                        shouldProceed: true,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: true,
                        shouldIgnore: false
                    };
                }
                break;

            case 'concurrent-modification':
                // Check if legitimate external save
                if (this._isLegitimateExternalSave(conflict.context)) {
                    return {
                        action: 'discard_local',
                        description: 'Auto-reload legitimate external save',
                        shouldProceed: true,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: true,
                        shouldIgnore: false
                    };
                }
                break;
        }

        // For conflicts requiring user input, return the first suggested resolution
        // (caller should show dialog if needed)
        if (conflict.suggestedResolutions && conflict.suggestedResolutions.length > 0) {
            return conflict.suggestedResolutions[0];
        }

        // Fallback - ignore the conflict
        return {
            action: 'ignore',
            description: 'Ignore conflict',
            shouldProceed: true,
            shouldCreateBackup: false,
            shouldSave: false,
            shouldReload: false,
            shouldIgnore: true
        };
    }

    /**
     * Get conflict statistics
     */
    getStats(): {
        activeConflicts: number;
        lastConflictCheck: Date | null;
    } {
        const state = this.stateManager.getState();
        return {
            activeConflicts: state.conflicts.activeConflicts.length,
            lastConflictCheck: state.conflicts.lastConflictCheck
        };
    }
}
