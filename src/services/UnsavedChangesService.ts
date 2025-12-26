/**
 * UnsavedChangesService - Handles unsaved changes detection, dialogs, and backups
 *
 * Extracts unsaved changes logic from KanbanWebviewPanel to reduce God class size.
 * This service:
 * 1. Checks if there are unsaved changes in main file or include files
 * 2. Shows dialog asking user what to do
 * 3. Creates backup files for unsaved changes
 *
 * Previously: Parts of KanbanWebviewPanel._handlePanelClose() and saveUnsavedChangesBackup()
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import { getUnsavedChangesPath } from '../constants/FileNaming';

/**
 * Result of showing the unsaved changes dialog
 */
export type UnsavedChangesChoice = 'save' | 'discard' | 'cancel';

/**
 * Information about unsaved changes
 */
export interface UnsavedChangesInfo {
    hasMainFileChanges: boolean;
    hasIncludeFileChanges: boolean;
    changedIncludeFiles: string[];
}

export class UnsavedChangesService {
    private _fileRegistry: MarkdownFileRegistry;

    constructor(fileRegistry: MarkdownFileRegistry) {
        this._fileRegistry = fileRegistry;
    }

    /**
     * Check if there are any unsaved changes
     */
    public checkForUnsavedChanges(): UnsavedChangesInfo {
        const mainFile = this._fileRegistry.getMainFile();
        const hasMainFileChanges = mainFile?.hasUnsavedChanges() || false;

        const includeStatus = this._fileRegistry.getIncludeFilesUnsavedStatus();

        return {
            hasMainFileChanges,
            hasIncludeFileChanges: includeStatus.hasChanges,
            changedIncludeFiles: includeStatus.changedFiles
        };
    }

    /**
     * Check if any files have unsaved changes
     */
    public hasAnyUnsavedChanges(): boolean {
        return this._fileRegistry.hasAnyUnsavedChanges();
    }

    /**
     * Show dialog asking user what to do with unsaved changes
     *
     * @returns 'save' | 'discard' | 'cancel'
     */
    public async showUnsavedChangesDialog(info: UnsavedChangesInfo): Promise<UnsavedChangesChoice> {
        // If no unsaved changes, no dialog needed
        if (!info.hasMainFileChanges && !info.hasIncludeFileChanges) {
            return 'discard'; // Nothing to save
        }

        // Build message for unsaved changes
        let message = '';
        if (info.hasMainFileChanges && info.hasIncludeFileChanges) {
            message = `You have unsaved changes in the main file and in column include files:\n${info.changedIncludeFiles.join('\n')}\n\nDo you want to save before closing?`;
        } else if (info.hasMainFileChanges) {
            message = `You have unsaved changes in the main file. Do you want to save before closing?`;
        } else if (info.hasIncludeFileChanges) {
            message = `You have unsaved changes in column include files:\n${info.changedIncludeFiles.join('\n')}\n\nDo you want to save before closing?`;
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
            return 'cancel';
        } else if (choice === saveAndClose) {
            return 'save';
        } else {
            return 'discard';
        }
    }

    /**
     * Discard all unsaved changes
     */
    public discardAllChanges(): void {
        const mainFile = this._fileRegistry.getMainFile();
        if (mainFile) {
            mainFile.discardChanges();
        }

        // Include files handle their own discard logic when their parent is disposed
    }

    /**
     * Save unsaved changes to backup files with ".{name}-unsavedchanges" naming (hidden)
     * Creates a safety backup before closing
     *
     * @param mainFileUri - URI of the main kanban file
     */
    public async saveBackups(mainFileUri: vscode.Uri | undefined): Promise<void> {
        try {
            // Save main file backup
            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile && mainFile.hasUnsavedChanges() && mainFileUri) {
                const filePath = mainFileUri.fsPath;
                const content = mainFile.getContent();

                // Create backup filename: "file.md" -> ".file-unsavedchanges.md" (hidden)
                const backupPath = this._createBackupPath(filePath);
                fs.writeFileSync(backupPath, content, 'utf8');
            }

            // Save include files backups
            const includeStatus = this._fileRegistry.getIncludeFilesUnsavedStatus();
            if (includeStatus.hasChanges) {
                for (const fileWithChanges of includeStatus.changedFiles) {
                    const includeFile = this._fileRegistry.getIncludeFile(fileWithChanges);
                    if (includeFile && includeFile.hasUnsavedChanges()) {
                        const filePath = includeFile.getPath();
                        if (filePath) {
                            const content = includeFile.getContent();
                            const backupPath = this._createBackupPath(filePath);
                            fs.writeFileSync(backupPath, content, 'utf8');
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[UnsavedChangesService] Failed to save unsaved changes backup:', error);
            // Don't throw - we want to continue with the close process even if backup fails
        }
    }

    /**
     * Create backup path for a file
     * "file.md" -> ".file-unsavedchanges.md" (hidden file)
     */
    private _createBackupPath(filePath: string): string {
        return getUnsavedChangesPath(filePath);
    }
}
