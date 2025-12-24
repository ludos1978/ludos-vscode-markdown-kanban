import * as vscode from 'vscode';

export type ConflictType = 'panel_close' | 'external_main' | 'external_include' | 'presave_check' | 'watcher_failure' | 'permission_denied' | 'file_missing' | 'circular_dependency' | 'batch_conflict' | 'network_timeout' | 'crash_recovery';
/**
 * File type for conflict resolution context.
 * Note: This is different from IncludeConstants.FileType which has specific include subtypes.
 * ConflictFileType is simpler: just 'main' vs any kind of 'include'.
 */
export type ConflictFileType = 'main' | 'include';

export interface ConflictContext {
    type: ConflictType;
    fileType: ConflictFileType;
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
    action: 'save' | 'discard_local' | 'discard_external' | 'ignore' | 'cancel' | 'backup_and_reload' | 'backup_external_and_save';
    shouldProceed: boolean;
    shouldCreateBackup: boolean;
    shouldBackupExternal?: boolean;  // Optional: backup external file before saving
    shouldSave: boolean;
    shouldReload: boolean;
    shouldIgnore: boolean;
    customAction?: string;
}

/**
 * Centralized conflict resolution system that handles all file change protection scenarios
 * with consistent dialogs and unified logic to prevent multiple dialog appearances.
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
                shouldBackupExternal: false,
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
     */
    private async showExternalMainFileDialog(context: ConflictContext): Promise<ConflictResolution> {
        const hasAnyUnsavedChanges = context.hasMainUnsavedChanges || context.hasIncludeUnsavedChanges;
        const isInEditMode = context.isInEditMode || false;

        // Check if external change was a legitimate save operation
        const isLegitimateExternalSave = this.isLegitimateExternalSave(context);

        // If external change was a legitimate save AND we have unsaved changes,
        // treat external save as authoritative and auto-reload (don't show dialog)
        if (isLegitimateExternalSave && hasAnyUnsavedChanges && !isInEditMode) {
            return {
                action: 'discard_local',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: true,
                shouldIgnore: false
            };
        }

        // Auto-reload if no unsaved changes AND not in edit mode (no dialog)
        if (!hasAnyUnsavedChanges && !isInEditMode) {
            return {
                action: 'discard_local',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: true,
                shouldIgnore: false
            };
        }

        // Has unsaved changes OR in edit mode - show full 4-option dialog
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

        const saveAndOverwrite       = 'Save my changes (discard external changes)';
        const backupExternalAndSave  = 'Save my changes (backup external changes)';
        const saveAsBackupAndReload  = 'Load external changes (backup current board)';
        const discardMyChanges       = 'Load external changes (discard current board)';

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            saveAndOverwrite,
            backupExternalAndSave,
            saveAsBackupAndReload,
            discardMyChanges
        );

        if (!choice) {
            // Esc pressed - ignore external changes and continue
            return {
                action: 'ignore',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldBackupExternal: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: true
            };
        }

        switch (choice) {
            case saveAndOverwrite:
                return {
                    action: 'discard_external',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldBackupExternal: false,
                    shouldSave: true,
                    shouldReload: false,
                    shouldIgnore: false
                };
            case backupExternalAndSave:
                return {
                    action: 'backup_external_and_save',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldBackupExternal: true,
                    shouldSave: true,
                    shouldReload: false,
                    shouldIgnore: false
                };
            case saveAsBackupAndReload:
                return {
                    action: 'backup_and_reload',
                    shouldProceed: true,
                    shouldCreateBackup: true,
                    shouldBackupExternal: false,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            case discardMyChanges:
                return {
                    action: 'discard_local',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldBackupExternal: false,
                    shouldSave: false,
                    shouldReload: true,
                    shouldIgnore: false
                };
            default:
                return {
                    action: 'ignore',
                    shouldProceed: true,
                    shouldCreateBackup: false,
                    shouldBackupExternal: false,
                    shouldSave: false,
                    shouldReload: false,
                    shouldIgnore: true
                };
        }
    }

    /**
     * External include file change dialog
     */
    private async showExternalIncludeFileDialog(context: ConflictContext): Promise<ConflictResolution> {
        const hasIncludeChanges = context.hasIncludeUnsavedChanges;
        const hasExternalChanges = context.hasExternalChanges ?? true;
        const isInEditMode = context.isInEditMode || false;

        if (!hasIncludeChanges && !hasExternalChanges) {
            return {
                action: 'ignore',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: false,
                shouldIgnore: true
            };
        }

        // Auto-reload if no unsaved changes AND not in edit mode AND has external changes
        if (!hasIncludeChanges && !isInEditMode && hasExternalChanges) {
            return {
                action: 'discard_local',
                shouldProceed: true,
                shouldCreateBackup: false,
                shouldSave: false,
                shouldReload: true,
                shouldIgnore: false
            };
        }

        // Has unsaved include file changes OR is in edit mode - show conflict dialog
        const ignoreExternal = 'Ignore external changes (default)';
        const overwriteExternal = 'Overwrite external file with kanban contents';
        const saveAsBackup = 'Save kanban as backup and reload from external';
        const discardMyChanges = 'Discard kanban changes and reload from external';

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

        let message: string;
        if (context.fileType === 'include') {
            message = `The include file "${context.fileName}" has been modified externally. Saving your kanban changes will overwrite these external changes.`;
        } else {
            message = `The file "${context.fileName}" has unsaved external modifications. Saving kanban changes will overwrite these external changes.`;
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
     * Check if external change was a legitimate save operation
     * that should take precedence over internal unsaved changes
     */
    private isLegitimateExternalSave(context: ConflictContext): boolean {
        if (!context.lastExternalSaveTime || !context.externalChangeTime) {
            return false;
        }

        const timeDiff = context.externalChangeTime.getTime() - context.lastExternalSaveTime.getTime();
        const timeDiffSeconds = timeDiff / 1000;

        const LEGITIMATE_SAVE_THRESHOLD_SECONDS = 30;
        return timeDiffSeconds > LEGITIMATE_SAVE_THRESHOLD_SECONDS;
    }
}
