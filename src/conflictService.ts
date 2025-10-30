import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { KanbanBoard } from './markdownParser';
import { FileManager } from './fileManager';
import { ConflictResolver, ConflictContext, ConflictResolution } from './conflictResolver';
import { BackupManager } from './backupManager';
import { MarkdownFileRegistry } from './files';
import { IncludeFileManager } from './includeFileManager';
import { MarkdownKanbanParser } from './markdownParser';

/**
 * ConflictService
 *
 * Handles all conflict-related operations for the Kanban board:
 * - Conflict dialog management
 * - External change notifications
 * - Include file change handling
 * - Backup creation
 * - Panel close handling with unsaved changes
 */
export class ConflictService {
    // Centralized dialog management to prevent duplicate dialogs
    private _activeConflictDialog: Promise<any> | null = null;
    private _lastDialogTimestamp: number = 0;
    private readonly _MIN_DIALOG_INTERVAL = 2000; // 2 seconds minimum between dialogs

    constructor(
        private fileRegistry: MarkdownFileRegistry,
        private conflictResolver: ConflictResolver,
        private backupManager: BackupManager,
        private board: () => KanbanBoard | undefined,
        private fileManager: FileManager,
        private saveToMarkdown: () => Promise<void>,
        private forceReloadFromFile: () => Promise<void>,
        private includeFileManager: IncludeFileManager,
        private context: vscode.ExtensionContext
    ) {}

    /**
     * Centralized dialog manager - prevents duplicate conflict dialogs
     */
    public async showConflictDialog(context: ConflictContext): Promise<ConflictResolution | null> {
        const now = Date.now();

        // If there's already an active dialog, wait for it to complete first
        if (this._activeConflictDialog) {
            await this._activeConflictDialog;
        }

        // Throttle dialog frequency to prevent spam
        const timeSinceLastDialog = now - this._lastDialogTimestamp;
        if (timeSinceLastDialog < this._MIN_DIALOG_INTERVAL) {
            return null; // Skip this dialog
        }

        // Update timestamp before showing dialog
        this._lastDialogTimestamp = now;

        // Start the new dialog and track it
        this._activeConflictDialog = this.conflictResolver.resolveConflict(context);

        try {
            const resolution = await this._activeConflictDialog;
            return resolution;
        } finally {
            this._activeConflictDialog = null;
        }
    }

    /**
     * Notify user about external changes without forcing reload
     */
    public async notifyExternalChanges(document: vscode.TextDocument, getUnifiedFileState: () => any, _undoRedoManager: any, cachedBoardFromWebview: any): Promise<void> {
        const fileName = path.basename(document.fileName);

        // Get unified file state from message handler - ALL SYSTEMS MUST USE THIS!
        const fileState = getUnifiedFileState();

        const filesWithUnsaved = this.fileRegistry.getFilesWithUnsavedChanges();
        const hasIncludeUnsavedChanges = filesWithUnsaved.some(f => f.getFileType() !== 'main');
        const changedIncludeFiles = filesWithUnsaved
            .filter(f => f.getFileType() !== 'main')
            .map(f => f.getRelativePath());

        // Check if main file is in edit mode
        const mainFile = this.fileRegistry.getMainFile();
        const isInEditMode = mainFile?.isInEditMode() || false;

        // Use the unified conflict resolver with consistent data
        const context: ConflictContext = {
            type: 'external_main',
            fileType: 'main',
            filePath: document.uri.fsPath,
            fileName: fileName,
            hasMainUnsavedChanges: fileState?.hasInternalChanges || false,
            hasIncludeUnsavedChanges: hasIncludeUnsavedChanges,
            changedIncludeFiles: changedIncludeFiles,
            isInEditMode: isInEditMode
        };

        try {
            const resolution = await this.showConflictDialog(context);

            if (!resolution) {
                // Dialog was throttled/skipped
                return;
            }

            if (resolution.shouldIgnore) {
                // User wants to keep working with current state - do nothing
                return;
            } else if (resolution.shouldSave && !resolution.shouldReload) {
                // User wants to save current kanban state and ignore external changes
                // Don't update version tracking to continue detecting future external changes
                await this.saveToMarkdown();
                return;
            } else if (resolution.shouldCreateBackup && resolution.shouldReload) {
                // Save current board state as backup before reloading


                await this.createUnifiedBackup('conflict');



                // /* this._includeFiles removed */ removed /* preservedIncludeState removed */;

                // Save current state to undo history before reloading
                const currentBoard = this.board();
                if (currentBoard) {
                    _undoRedoManager.saveStateForUndo(currentBoard);
                }
                await this.forceReloadFromFile();
                return;
            } else if (resolution.shouldReload && !resolution.shouldCreateBackup) {
                // User chose to discard current changes and reload from external file
                // Save current state to undo history before reloading
                const currentBoard = this.board();
                if (currentBoard) {
                    _undoRedoManager.saveStateForUndo(currentBoard);
                }
                await this.forceReloadFromFile();
                return;
            }
        } catch (error) {
            console.error('[notifyExternalChanges] Error in conflict resolution:', error);
            vscode.window.showErrorMessage(`Error handling external file changes: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle changes to inline include files (!!!include(file)!!! statements)
     */
    public async handleInlineIncludeFileChange(filePath: string, changeType: string, sendBoardUpdate: () => Promise<void>): Promise<void> {
        try {
            const currentDocument = this.fileManager.getDocument();
            if (!currentDocument) {
                return;
            }

            const basePath = path.dirname(currentDocument.uri.fsPath);
            let relativePath = path.relative(basePath, filePath);

            // Normalize path format to match how includes are stored (with ./ prefix for relative paths)
            if (!path.isAbsolute(relativePath) && !relativePath.startsWith('.')) {
                relativePath = './' + relativePath;
            }

            // Ensure the inline include file is registered in the unified system
            this.includeFileManager.ensureIncludeFileRegistered(relativePath, 'regular', () => this.fileManager.getDocument());

            // Read the new external content
            const newExternalContent = await this.includeFileManager.readFileContent(relativePath, () => this.fileManager.getDocument());

            if (newExternalContent !== null) {
                // Update the include file
                const file = this.fileRegistry.getByRelativePath(relativePath);
                if (file) {
                    // Check if content actually changed
                    if (newExternalContent !== file.getContent()) {
                        // Update the file - registry handles this automatically
                        await file.reload();

                        // Automatically update the content in the frontend
                        await this.includeFileManager.updateInlineIncludeFile(filePath, relativePath);

                        // Trigger a board refresh to re-render with the new content
                        await sendBoardUpdate();

                    }
                }
            }

        } catch (error) {
            console.error('[InlineInclude] Error handling inline include file change:', error);
        }
    }

    /**
     * Create unified backup (conflict or other types)
     */
    public async createUnifiedBackup(label: string = 'conflict'): Promise<void> {
        const document = this.fileManager.getDocument();
        if (!document) {return;}

        try {
            const currentBoard = this.board();
            if (label === 'conflict' && currentBoard) {
                // For conflict backups, save the current board state (before external reload)
                // This preserves unsaved internal changes
                const currentBoardMarkdown = MarkdownKanbanParser.generateMarkdown(currentBoard);
                const backupPath = await this._createBoardStateBackup(currentBoardMarkdown, label);

                // Show notification with backup filename (like the old system did)
                const backupFileName = path.basename(backupPath);
                vscode.window.showInformationMessage(
                    `Internal kanban changes backed up as: ${backupFileName}`,
                    'Open backup file'
                ).then(async (choice) => {
                    if (choice === 'Open backup file') {
                        await this.openFileWithReuseCheck(backupPath);
                    }
                });
            } else {
                // For other backup types (page hidden, etc.), use document content and respect timing
                await this.backupManager.createBackup(document, {
                    label: label,
                    forceCreate: false  // Respect minimum interval timing for non-conflict backups
                });
            }

        } catch (error) {
            console.error(`Error creating ${label} backup:`, error);
        }
    }

    /**
     * Create board state backup file
     */
    private async _createBoardStateBackup(boardMarkdown: string, label: string): Promise<string> {
        const document = this.fileManager.getDocument()!;
        const originalPath = document.uri.fsPath;
        const dir = path.dirname(originalPath);
        const basename = path.basename(originalPath, path.extname(originalPath));
        const extension = path.extname(originalPath);

        // Use standardized timestamp format: YYYYMMDDTHHmmss
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

        // All automatically generated files should be hidden
        const prefix = '.';
        const backupFileName = `${prefix}${basename}-${label}-${timestamp}${extension}`;
        const backupPath = path.join(dir, backupFileName);

        // Write backup file with board state as markdown
        const backupUri = vscode.Uri.file(backupPath);
        await vscode.workspace.fs.writeFile(backupUri, Buffer.from(boardMarkdown, 'utf8'));

        // Set hidden attribute on Windows
        await this.setFileHidden(backupPath);

        return backupPath;
    }

    /**
     * Handle panel close with unsaved changes check
     */
    public async _handlePanelClose(
        getUnifiedFileState: () => any,
        hasUnsavedChanges: boolean,
        isClosingPrevented: boolean,
        cachedBoardFromWebview: any,
        disposeCallback: () => void
    ): Promise<{ shouldPreventClose: boolean; newIsClosingPrevented: boolean; newHasUnsavedChanges: boolean; newCachedBoard: any }> {
        // Check if there are unsaved changes before closing - use unified file state
        const fileState = getUnifiedFileState();
        const hasMainUnsavedChanges = fileState?.hasInternalChanges || false;
        const filesWithUnsaved = this.fileRegistry.getFilesWithUnsavedChanges();
        const hasIncludeUnsavedChanges = filesWithUnsaved.some(f => f.getFileType() !== 'main');

        if ((hasMainUnsavedChanges || hasIncludeUnsavedChanges) && !isClosingPrevented) {
            const newIsClosingPrevented = true;

            // Use the cached board that was already sent when changes were made
            if (cachedBoardFromWebview) {
                // Board update would happen in the calling code
            }

            const document = this.fileManager.getDocument();
            const fileName = document ? path.basename(document.fileName) : 'the kanban board';
            const changedIncludeFiles = filesWithUnsaved
                .filter(f => f.getFileType() !== 'main')
                .map(f => f.getRelativePath());

            // Use the unified conflict resolver with consistent data
            const context: ConflictContext = {
                type: 'panel_close',
                fileType: 'main', // Main context but includes both main and include files
                filePath: document?.uri.fsPath || '',
                fileName: fileName,
                hasMainUnsavedChanges: hasMainUnsavedChanges, // This was already updated above
                hasIncludeUnsavedChanges: hasIncludeUnsavedChanges,
                changedIncludeFiles: changedIncludeFiles,
                isClosing: true
            };

            try {
                const resolution = await this.showConflictDialog(context);

                if (!resolution || !resolution.shouldProceed) {
                    // User cancelled - reset and try again
                    return {
                        shouldPreventClose: true,
                        newIsClosingPrevented: false,
                        newHasUnsavedChanges: hasUnsavedChanges,
                        newCachedBoard: cachedBoardFromWebview
                    };
                }

                if (resolution.shouldSave) {
                    try {
                        // Save the changes before closing (this will save both main and include files)
                        await this.saveToMarkdown();
                        // Registry handles clearing unsaved changes automatically

                        // Allow disposal to continue
                        disposeCallback();
                        return {
                            shouldPreventClose: false,
                            newIsClosingPrevented: newIsClosingPrevented,
                            newHasUnsavedChanges: false,
                            newCachedBoard: null
                        };
                    } catch (error) {
                        // If save fails, show error and prevent closing
                        vscode.window.showErrorMessage(`Failed to save changes: ${error instanceof Error ? error.message : String(error)}`);
                        return {
                            shouldPreventClose: true,
                            newIsClosingPrevented: false,
                            newHasUnsavedChanges: hasUnsavedChanges,
                            newCachedBoard: cachedBoardFromWebview
                        };
                    }
                } else {
                    // User explicitly chose to close without saving
                    // Registry handles clearing unsaved changes automatically

                    disposeCallback();
                    return {
                        shouldPreventClose: false,
                        newIsClosingPrevented: newIsClosingPrevented,
                        newHasUnsavedChanges: false,
                        newCachedBoard: null
                    };
                }
            } catch (error) {
                console.error('[_handlePanelClose] Error in conflict resolution:', error);
                vscode.window.showErrorMessage(`Error handling panel close: ${error instanceof Error ? error.message : String(error)}`);
                return {
                    shouldPreventClose: true,
                    newIsClosingPrevented: false,
                    newHasUnsavedChanges: hasUnsavedChanges,
                    newCachedBoard: cachedBoardFromWebview
                };
            }
        } else {
            // No unsaved changes, proceed with normal disposal
            disposeCallback();
            return {
                shouldPreventClose: false,
                newIsClosingPrevented: isClosingPrevented,
                newHasUnsavedChanges: false,
                newCachedBoard: cachedBoardFromWebview
            };
        }
    }

    /**
     * Open a file with reuse check - focuses existing editor if already open
     */
    private async openFileWithReuseCheck(filePath: string): Promise<void> {
        try {
            const fileUri = vscode.Uri.file(filePath);

            // Check if the file is already open in any visible editor
            const existingEditor = vscode.window.visibleTextEditors.find(
                editor => editor.document.uri.fsPath === filePath
            );

            if (existingEditor) {
                // File is already open - just show it
                await vscode.window.showTextDocument(existingEditor.document, existingEditor.viewColumn);
            } else {
                // File is not open - open it in a new editor
                await vscode.window.showTextDocument(fileUri);
            }
        } catch (error) {
            console.error('[openFileWithReuseCheck] Error opening file:', error);
            vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Set file as hidden on Windows using attrib command
     * On Unix systems, files starting with . are already hidden
     */
    private async setFileHidden(filePath: string): Promise<void> {
        try {
            // Only need to set hidden attribute on Windows
            if (process.platform === 'win32') {
                const { exec } = await import('child_process');
                const util = await import('util');
                const execPromise = util.promisify(exec);

                try {
                    await execPromise(`attrib +H "${filePath}"`);
                } catch (error) {
                    // Silently fail if attrib command fails
                    // The . prefix will still make it hidden in most file managers
                    console.debug(`Failed to set hidden attribute for ${filePath}:`, error);
                }
            }
        } catch (error) {
            // Silently fail - file is still created with . prefix
            console.debug(`Error setting file hidden:`, error);
        }
    }
}
