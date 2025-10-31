import * as vscode from 'vscode';
import * as path from 'path';

export type ConflictType = 'panel_close' | 'external_main' | 'external_include' | 'presave_check' | 'watcher_failure' | 'permission_denied' | 'file_missing' | 'circular_dependency' | 'batch_conflict' | 'network_timeout' | 'crash_recovery';
export type FileType = 'main' | 'include';

export interface ConflictContext {
    type: ConflictType;
    fileType: FileType;
    filePath: string;
    fileName: string;
    hasMainUnsavedChanges: boolean;
    hasIncludeUnsavedChanges: boolean;
    hasExternalChanges?: boolean;
    changedIncludeFiles: string[];
    isClosing?: boolean;
    isInEditMode?: boolean;  // User is actively editing (cursor in editor)
    lastExternalSaveTime?: Date;  // When external file was last legitimately saved
    externalChangeTime?: Date;    // When current external change was detected
}

export interface ConflictResolution {
    action: 'save' | 'discard_local' | 'discard_external' | 'ignore' | 'cancel' | 'backup_and_reload';
    shouldProceed: boolean;
    shouldCreateBackup: boolean;
    shouldSave: boolean;
    shouldReload: boolean;
    shouldIgnore: boolean;
    customAction?: string;
}

/**
 * Centralized conflict resolution system that handles all file change protection scenarios
 * with consistent dialogs and unified logic to prevent multiple dialog appearances.
 *
 * ===== SPECIFICATION (ONLY CORRECT BEHAVIOR) =====
 *
 * For ALL File Types (Main Kanban, ColumnInclude, TaskInclude, RegularInclude):
 *
 * 1. External file modified + File has unsaved changes OR is in edit mode:
 *    → SHOW CONFLICT DIALOG with 4 options:
 *      a) Ignore external changes (DEFAULT/ESC) - nothing happens, keeps current changes
 *      b) Overwrite external file - save current contents to file (becomes unedited state)
 *      c) Save as backup + reload - current content saved to backup, external changes loaded
 *      d) Discard + reload - discard current changes, reload from external
 *
 * 2. External file modified + File has NO unsaved changes AND is NOT in edit mode:
 *    → AUTO-RELOAD IMMEDIATELY (no dialog)
 *
 * 3. File modified and saved + External file has unsaved changes (later saved):
 *    → Rely on VSCode's default change detection
 *
 * NOTE: All four file types (Main, ColumnInclude, TaskInclude, RegularInclude) follow
 * the SAME conflict tracking behavior as specified above.
 *
 * =================================================
 */
export class ConflictResolver {
    private static instance: ConflictResolver | undefined;
    private activeDialogs = new Set<string>();
    private pendingResolutions = new Map<string, Promise<ConflictResolution>>();

    protected constructor() {}

    public static getInstance(): ConflictResolver {
        if (!ConflictResolver.instance) {
            ConflictResolver.instance = new ConflictResolver();
        }
        return ConflictResolver.instance;
    }

    /**
     * Resolve a conflict with deduplication to prevent multiple dialogs
     */
    public async resolveConflict(context: ConflictContext): Promise<ConflictResolution> {
        const dialogKey = this.generateDialogKey(context);

        // Check if a dialog for this context is already active
        if (this.activeDialogs.has(dialogKey)) {
            const existing = this.pendingResolutions.get(dialogKey);
            if (existing) {
                return await existing;
            }
        }

        // Mark dialog as active and create resolution promise
        this.activeDialogs.add(dialogKey);
        const resolutionPromise = this.showConflictDialog(context);
        this.pendingResolutions.set(dialogKey, resolutionPromise);

        try {
            const resolution = await resolutionPromise;
            return resolution;
        } finally {
            // Clean up tracking
            this.activeDialogs.delete(dialogKey);
            this.pendingResolutions.delete(dialogKey);
        }
    }

    /**
     * Generate a unique key for dialog deduplication
     */
    private generateDialogKey(context: ConflictContext): string {
        const fileIdentifier = context.fileType === 'main' ? 'main' : context.filePath;
        return `${context.type}_${fileIdentifier}`;
    }

    /**
     * Show appropriate conflict dialog based on context
     */
    private async showConflictDialog(context: ConflictContext): Promise<ConflictResolution> {
        switch (context.type) {
            case 'panel_close':
                return this.showPanelCloseDialog(context);
            case 'external_main':
                return this.showExternalMainFileDialog(context);
            case 'external_include':
                return this.showExternalIncludeFileDialog(context);
            case 'presave_check':
                return this.showPresaveCheckDialog(context);
            default:
                throw new Error(`Unknown conflict type: ${context.type}`);
        }
    }

    /**
     * Panel close dialog - handles unsaved changes when panel is being closed
     */
    private async showPanelCloseDialog(context: ConflictContext): Promise<ConflictResolution> {
        let message = '';

        // Build include files list if present
        const includeFilesList = context.changedIncludeFiles && context.changedIncludeFiles.length > 0
            ? '\n\nChanged include files:\n' + context.changedIncludeFiles.map(f => `  • ${f}`).join('\n')
            : '';

        if (context.hasMainUnsavedChanges && context.hasIncludeUnsavedChanges) {
            message = `You have unsaved changes in "${context.fileName}" and in column include files.${includeFilesList}\n\nDo you want to save before closing?`;
        } else if (context.hasMainUnsavedChanges) {
            message = `You have unsaved changes in "${context.fileName}". Do you want to save before closing?`;
        } else if (context.hasIncludeUnsavedChanges) {
            message = `You have unsaved changes in column include files.${includeFilesList}\n\nDo you want to save before closing?`;
        } else {
            // No unsaved changes - allow close
            return {
                action: 'ignore',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: true
            };
        }

        const saveAndClose = 'Save and close';
        const closeWithoutSaving = 'Close without saving';
        const cancel = 'Cancel (Esc)';

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            saveAndClose,
            closeWithoutSaving,
            cancel
        );

        if (!choice || choice === cancel) {
            return {
                action: 'cancel',
                shouldProceed: false,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: false
            };
        }

        switch (choice) {
            case saveAndClose:
                return {
                    action: 'save',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: true,
                    shouldReload: false,
                    shouldIgnore: false
                };
            case closeWithoutSaving:
                return {
                    action: 'discard_local',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            default:
                return {
                    action: 'cancel',
                    shouldProceed: false,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: false,
                    shouldIgnore: false
                };
        }
    }

    /**
     * External main file change dialog
     *
     * SOLUTION 1.1: Timestamp-Based Conflict Resolution
     * - Detect legitimate external saves that should take precedence
     * - Auto-reload for external saves, show dialog only for concurrent editing
     */
    private async showExternalMainFileDialog(context: ConflictContext): Promise<ConflictResolution> {
        const hasAnyUnsavedChanges = context.hasMainUnsavedChanges || context.hasIncludeUnsavedChanges;
        const isInEditMode = context.isInEditMode || false;

        console.log('[ConflictResolver.showExternalMainFileDialog] ENTRY:', {
            fileName: context.fileName,
            hasMainUnsaved: context.hasMainUnsavedChanges,
            hasIncludeUnsaved: context.hasIncludeUnsavedChanges,
            hasAnyUnsavedChanges,
            isInEditMode,
            lastExternalSaveTime: context.lastExternalSaveTime,
            externalChangeTime: context.externalChangeTime
        });

        // SOLUTION 1.1: Check if external change was a legitimate save operation
        const isLegitimateExternalSave = this.isLegitimateExternalSave(context);

        // If external change was a legitimate save AND we have unsaved changes,
        // treat external save as authoritative and auto-reload (don't show dialog)
        if (isLegitimateExternalSave && hasAnyUnsavedChanges && !isInEditMode) {
            console.log('[ConflictResolver.showExternalMainFileDialog] AUTO-RELOAD: Legitimate external save detected, discarding local changes');
            return {
                action: 'discard_local',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: true,
                shouldIgnore: false
            };
        }

        // SPEC: Auto-reload if no unsaved changes AND not in edit mode (no dialog)
        if (!hasAnyUnsavedChanges && !isInEditMode) {
            console.log('[ConflictResolver.showExternalMainFileDialog] AUTO-RELOAD: No unsaved changes + not in edit mode');
            // Auto-reload immediately without showing dialog
            return {
                action: 'discard_local',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: true,
                shouldIgnore: false
            };
        }

        console.log('[ConflictResolver.showExternalMainFileDialog] SHOW-DIALOG: Concurrent editing or rapid changes detected');

        // Has unsaved changes OR in edit mode - show full 4-option dialog
        // Build include files list if present
        const includeFilesList = context.changedIncludeFiles && context.changedIncludeFiles.length > 0
            ? '\n\nChanged include files:\n' + context.changedIncludeFiles.map(f => `  • ${f}`).join('\n')
            : '';

        let message = `"${context.fileName}"\nhas been modified externally.`;
        if (context.hasMainUnsavedChanges && context.hasIncludeUnsavedChanges) {
            message += ` Your current kanban changes and column include file changes may be lost if you reload.${includeFilesList}`;
        } else if (context.hasMainUnsavedChanges) {
            message += ` Your current kanban changes may be lost if you reload.`;
        } else {
            message += ` Your current column include file changes may be lost if you reload.${includeFilesList}`;
        }

        const discardMyChanges = 'Discard my changes and reload';
        const saveAsBackup = 'Save my changes as backup and reload';
        const saveAndIgnoreExternal = 'Save my changes and ignore external';
        const ignoreExternal = 'Ignore external changes (Esc)';

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            discardMyChanges,
            saveAsBackup,
            saveAndIgnoreExternal,
            ignoreExternal
        );

        if (!choice || choice === ignoreExternal) {
            return {
                action: 'ignore',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: true
            };
        }

        switch (choice) {
            case discardMyChanges:
                return {
                    action: 'discard_local',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            case saveAsBackup:
                return {
                    action: 'backup_and_reload',
                    shouldProceed: true,
                    shouldCreateBackup: true,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            case saveAndIgnoreExternal:
                return {
                    action: 'discard_external',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: true,
                    shouldReload: false,
                    shouldIgnore: false
                };
            default:
                return {
                    action: 'ignore',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: false,
                    shouldIgnore: true
                };
        }
    }

    /**
     * External include file change dialog
     *
     * SPEC REQUIREMENT:
     * - ALL include types (Regular, Column, Task) follow the SAME conflict tracking:
     *   - Auto-reload if: no unsaved changes AND not in edit mode
     *   - Show 4-option dialog if: has unsaved changes OR is in edit mode
     *
     * NOTE: Edit mode tracking is implemented via isInEditMode flag
     */
    private async showExternalIncludeFileDialog(context: ConflictContext): Promise<ConflictResolution> {
        const hasIncludeChanges = context.hasIncludeUnsavedChanges;
        const hasExternalChanges = context.hasExternalChanges ?? true; // Default to true for safety
        const isInEditMode = context.isInEditMode || false;

        console.log('[ConflictResolver.showExternalIncludeFileDialog] ENTRY:', {
            fileName: context.fileName,
            hasIncludeChanges,
            hasExternalChanges,
            isInEditMode
        });

        if (!hasIncludeChanges && !hasExternalChanges) {
            console.log('[ConflictResolver.showExternalIncludeFileDialog] AUTO-IGNORE: No internal or external changes detected');
            // No unsaved changes and no external changes - nothing to do
            return {
                action: 'ignore',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: true
            };
        }

        // SPEC: Auto-reload if no unsaved changes AND not in edit mode AND has external changes
        if (!hasIncludeChanges && !isInEditMode && hasExternalChanges) {
            console.log('[ConflictResolver.showExternalIncludeFileDialog] AUTO-RELOAD: No unsaved changes + not in edit mode + has external changes');
            // External changes but no internal changes and not in edit mode - auto-reload immediately
            return {
                action: 'discard_local',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: true,
                shouldIgnore: false
            };
        }

        console.log('[ConflictResolver.showExternalIncludeFileDialog] SHOW-DIALOG: Has unsaved changes or is in edit mode');

        // Has unsaved include file changes OR is in edit mode - show conflict dialog per specification
        // Option order matches specification with "ignore external changes" as default
        const ignoreExternal = 'Ignore external changes (default)';
        const overwriteExternal = 'Overwrite external file with kanban contents';
        const saveAsBackup = 'Save kanban as backup and reload from external';
        const discardMyChanges = 'Discard kanban changes and reload from external';

        // Message focuses on the conflict without suggesting data loss
        const message = `"${context.fileName}"\nhas been modified externally`;

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            discardMyChanges,
            saveAsBackup,
            overwriteExternal,
            ignoreExternal
        );

        if (!choice || choice === ignoreExternal) {
            return {
                action: 'ignore',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: true
            };
        }

        switch (choice) {
            case discardMyChanges:
                return {
                    action: 'discard_local',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            case saveAsBackup:
                return {
                    action: 'backup_and_reload',
                    shouldProceed: true,
                    shouldCreateBackup: true,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            case overwriteExternal:
                return {
                    action: 'discard_external',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: true,
                    shouldReload: false,
                    shouldIgnore: false
                };
            default:
                return {
                    action: 'ignore',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldSave: false,
                    shouldReload: false,
                    shouldIgnore: true
                };
        }
    }

    /**
     * Pre-save check dialog - shown when about to save but external changes detected
     */
    private async showPresaveCheckDialog(context: ConflictContext): Promise<ConflictResolution> {
        const overwriteExternal = 'Overwrite external changes';
        const cancelSave = 'Cancel save';

        // Customize message based on file type
        let message: string;
        if (context.fileType === 'include') {
            message = `⚠️ CONFLICT: The include file "${context.fileName}" has been modified externally. Saving your kanban changes will overwrite these external changes.`;
        } else {
            message = `⚠️ CONFLICT: The file "${context.fileName}" has unsaved external modifications. Saving kanban changes will overwrite these external changes.`;
        }

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            overwriteExternal,
            cancelSave
        );

        if (choice === overwriteExternal) {
            return {
                action: 'discard_external',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: true,
                shouldReload: false,
                shouldIgnore: false
            };
        } else {
            return {
                action: 'cancel',
                shouldProceed: false,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: false
            };
        }
    }

    /**
     * SOLUTION 1.1: Check if external change was a legitimate save operation
     * that should take precedence over internal unsaved changes
     */
    private isLegitimateExternalSave(context: ConflictContext): boolean {
        // If no timestamp information available, assume concurrent editing
        if (!context.lastExternalSaveTime || !context.externalChangeTime) {
            console.log('[ConflictResolver.isLegitimateExternalSave] No timestamp info - assuming concurrent editing');
            return false;
        }

        // Calculate time difference between last known external save and current change detection
        const timeDiff = context.externalChangeTime.getTime() - context.lastExternalSaveTime.getTime();
        const timeDiffSeconds = timeDiff / 1000;

        console.log('[ConflictResolver.isLegitimateExternalSave] Time analysis:', {
            lastExternalSave: context.lastExternalSaveTime.toISOString(),
            externalChangeDetected: context.externalChangeTime.toISOString(),
            timeDiffSeconds,
            thresholdSeconds: 30
        });

        // If external change happened more than 30 seconds after last known external save,
        // it's likely a new legitimate save operation that should take precedence
        const LEGITIMATE_SAVE_THRESHOLD_SECONDS = 30;
        const isLegitimate = timeDiffSeconds > LEGITIMATE_SAVE_THRESHOLD_SECONDS;

        console.log(`[ConflictResolver.isLegitimateExternalSave] Result: ${isLegitimate ? 'LEGITIMATE SAVE' : 'CONCURRENT EDITING'}`);

        return isLegitimate;
    }

    /**
     * Clear all active dialogs (used for cleanup or reset)
     */
    public clearActiveDialogs(): void {
        this.activeDialogs.clear();
        this.pendingResolutions.clear();
    }
}
