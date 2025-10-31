import * as vscode from 'vscode';
import * as path from 'path';
import { MarkdownKanbanParser, KanbanBoard } from './markdownParser';
import { FileManager } from './fileManager';
import { MarkdownFileRegistry } from './files';
import { IncludeFileManager } from './includeFileManager';
import { BackupManager } from './backupManager';
import { SaveEventCoordinator, SaveEventHandler } from './saveEventCoordinator';
import { ConflictContext, ConflictResolution } from './conflictResolver';
import { BoardOperations } from './boardOperations';
import { SaveCoordinator } from './core/SaveCoordinator';
import { ConflictEngine } from './core/ConflictEngine';
import { StateManager } from './core/StateManager';

/**
 * Save operation state for hybrid state machine + version tracking
 *
 * Replaces timing-dependent boolean flag with explicit states for reliability
 */
enum SaveState {
    IDLE,        // No save operation in progress
    SAVING,      // Save operation active (applying edits, saving files)
    RECOVERING   // Error recovery in progress
}

/**
 * KanbanFileService
 *
 * Handles all file operations for the Kanban board including:
 * - Loading and reloading markdown files
 * - Saving board state to markdown
 * - File state tracking and conflict detection
 * - File utilities (lock, open, etc.)
 *
 * RELIABILITY UPGRADE: Uses hybrid state machine + version tracking for
 * defense-in-depth change detection (replaces _isUpdatingFromPanel flag)
 */
export class KanbanFileService {
    private _lastDocumentVersion: number = -1;
    private _lastKnownFileContent: string = '';
    private _hasExternalUnsavedChanges: boolean = false;

    // HYBRID STATE MACHINE: State + Version tracking for defense-in-depth
    private _saveState: SaveState = SaveState.IDLE;
    private _saveStartVersion: number | null = null;
    private _saveEndVersion: number | null = null;
    private _saveOperationTimestamp: Date | null = null;

    private _cachedBoardFromWebview: any = null;
    private _lastDocumentUri?: string;
    private _panelId: string;
    private _trackedDocumentUri: string | undefined;

    // NEW ARCHITECTURE COMPONENTS
    private _stateManager: StateManager;
    private _conflictEngine: ConflictEngine;
    private _saveCoordinator: SaveCoordinator;

    constructor(
        private fileManager: FileManager,
        private fileRegistry: MarkdownFileRegistry,
        private includeFileManager: IncludeFileManager,
        private backupManager: BackupManager,
        private boardOperations: BoardOperations,
        private board: () => KanbanBoard | undefined,
        private setBoard: (board: KanbanBoard) => void,
        private sendBoardUpdate: (applyDefaultFolding?: boolean, isFullRefresh?: boolean) => Promise<void>,
        private panel: () => vscode.WebviewPanel | undefined,
        private context: () => vscode.ExtensionContext,
        private showConflictDialog: (context: ConflictContext) => Promise<ConflictResolution | null>,
        private notifyExternalChanges: (document: vscode.TextDocument) => Promise<void>,
        private updateWebviewPermissions: () => void,
        private undoRedoManagerClear: () => void,
        private panelStates: Map<string, any>,
        private panels: Map<string, any>,
        private getPanelInstance: () => any  // Returns KanbanWebviewPanel instance
    ) {
        this._panelId = Math.random().toString(36).substr(2, 9);

        // Initialize new architecture components
        this._stateManager = new StateManager();
        this._conflictEngine = new ConflictEngine(this._stateManager);
        this._saveCoordinator = new SaveCoordinator(this._stateManager);
    }

    /**
     * Initialize state tracking values
     * NOTE: Backwards compatibility - converts old boolean flag to new state machine
     */
    public initializeState(
        isUpdatingFromPanel: boolean,
        cachedBoardFromWebview: any,
        lastDocumentVersion: number,
        lastDocumentUri?: string,
        trackedDocumentUri?: string,
        panelId?: string
    ): void {
        // STATE MACHINE: Convert old boolean to new state (backwards compatibility)
        this._saveState = isUpdatingFromPanel ? SaveState.SAVING : SaveState.IDLE;

        this._cachedBoardFromWebview = cachedBoardFromWebview;
        this._lastDocumentVersion = lastDocumentVersion;
        this._lastDocumentUri = lastDocumentUri;
        this._trackedDocumentUri = trackedDocumentUri;
        if (panelId) {
            this._panelId = panelId;
        }
    }

    /**
     * Get current state values for syncing back to panel
     * NOTE: Backwards compatibility - converts state machine to boolean
     */
    public getState(): {
        isUpdatingFromPanel: boolean;
        hasUnsavedChanges: boolean;
        cachedBoardFromWebview: any;
        lastDocumentVersion: number;
        lastDocumentUri?: string;
        trackedDocumentUri?: string;
        panelId: string;
        lastKnownFileContent: string;
        hasExternalUnsavedChanges: boolean;
    } {
        // Query main file for unsaved changes (single source of truth)
        const mainFile = this.fileRegistry.getMainFile();
        const hasUnsavedChanges = mainFile?.hasUnsavedChanges() || false;

        // STATE MACHINE: Convert to boolean for backwards compatibility
        const isUpdatingFromPanel = this._saveState !== SaveState.IDLE;

        return {
            isUpdatingFromPanel,
            hasUnsavedChanges: hasUnsavedChanges,
            cachedBoardFromWebview: this._cachedBoardFromWebview,
            lastDocumentVersion: this._lastDocumentVersion,
            lastDocumentUri: this._lastDocumentUri,
            trackedDocumentUri: this._trackedDocumentUri,
            panelId: this._panelId,
            lastKnownFileContent: this._lastKnownFileContent,
            hasExternalUnsavedChanges: this._hasExternalUnsavedChanges
        };
    }

    /**
     * Check if file is locked
     */
    public isFileLocked(): boolean {
        return this.fileManager.isFileLocked();
    }

    /**
     * Toggle file lock state
     */
    public toggleFileLock(): void {
        this.fileManager.toggleFileLock();
    }

    /**
     * Get current document URI
     */
    public getCurrentDocumentUri(): vscode.Uri | undefined {
        return this.fileManager.getCurrentDocumentUri();
    }

    /**
     * Ensure board is loaded and send update to webview
     */
    public async ensureBoardAndSendUpdate(): Promise<void> {
        if (this.fileManager.getDocument()) {
            try {
                const document = this.fileManager.getDocument()!;

                // If we have unsaved changes with a cached board, use that instead of re-parsing
                // This preserves user's work when switching views
                const mainFile = this.fileRegistry.getMainFile();
                if (mainFile?.hasUnsavedChanges() && this._cachedBoardFromWebview) {
                    this.setBoard(this._cachedBoardFromWebview);
                    // Keep using the cached board and existing include file states
                } else {
                    // Only re-parse from document if no unsaved changes
                    const basePath = path.dirname(document.uri.fsPath);
                    const parseResult = MarkdownKanbanParser.parseMarkdown(document.getText(), basePath);
                    this.setBoard(parseResult.board);
                    // Update the unified include system
                    this.includeFileManager._updateUnifiedIncludeSystem(parseResult.board, () => this.fileManager.getDocument());
                }

                // Register included files with the external file watcher
                // Preserve existing change state
                const preservedChangeState = this.fileRegistry.getFilesWithUnsavedChanges().some(f => f.getFileType() !== "main");


                // Initialize content for new files only (preserve existing baselines)
                await this.includeFileManager._initializeUnifiedIncludeContents(() => this.fileManager.getDocument());

                // ALWAYS re-check for changes after reload
                // This will detect any changes between the preserved baseline and current state
                await this.includeFileManager._recheckIncludeFileChanges();

                // Only restore the change state if recheck didn't find changes
                // (If recheck found changes, it already set the state)
                if (!this.fileRegistry.getFilesWithUnsavedChanges().some(f => f.getFileType() !== "main") && preservedChangeState) {


                }

                // Send notification again in case it was lost
                if (this.fileRegistry.getFilesWithUnsavedChanges().some(f => f.getFileType() !== "main")) {
                        }

                const currentBoard = this.board();
                if (currentBoard) {
                    this.boardOperations.setOriginalTaskOrder(currentBoard);
                }
            } catch (error) {
                this.setBoard({
                    valid: false,
                    title: 'Error Loading Board',
                    columns: [],
                    yamlHeader: null,
                    kanbanFooter: null
                });
            }
        }

        await this.sendBoardUpdate();
    }

    /**
     * Load markdown file and parse into board structure
     */
    public async loadMarkdownFile(document: vscode.TextDocument, isFromEditorFocus: boolean = false, forceReload: boolean = false): Promise<void> {

        // STATE MACHINE: Don't reload during save operations
        if (this._saveState !== SaveState.IDLE) {
            console.log(`[SaveStateMachine] Skipping loadMarkdownFile during save (state=${SaveState[this._saveState]})`);
            return;
        }

        // Store document URI for serialization
        this._lastDocumentUri = document.uri.toString();

        // Store panel state for serialization in VSCode context
        this.panelStates.set(this._panelId, {
            documentUri: document.uri.toString(),
            panelId: this._panelId
        });

        // Also store in VSCode's global state for persistence across restarts
        // Use documentUri hash as stable key so panels can find their state after restart
        const stableKey = `kanban_doc_${Buffer.from(document.uri.toString()).toString('base64').replace(/[^a-zA-Z0-9]/g, '_')}`;
        this.context().globalState.update(stableKey, {
            documentUri: document.uri.toString(),
            lastAccessed: Date.now(),
            panelId: this._panelId  // Store for cleanup but don't use for lookup
        });

        // Ensure file watcher is always set up for the current document
        const currentDocumentUri = this.fileManager.getDocument()?.uri.toString();
        const isDifferentDocument = currentDocumentUri !== document.uri.toString();
        const isFirstFileLoad = !this.fileManager.getDocument();

        // Set up file watcher if needed (first load or different document)
        if (isFirstFileLoad || isDifferentDocument) {

            // Clean up old watcher if switching documents
            if (isDifferentDocument && currentDocumentUri) {
                // Note: We'll clean this up in the document changed section below
            }
        }

        // STRICT POLICY: Only reload board in these specific cases:
        // 1. Initial panel creation (no existing board)
        // 2. Switching to a different document
        // 3. User explicitly forces reload via dialog
        const isInitialLoad = !this.board();

        if (!isInitialLoad && !isDifferentDocument && !forceReload) {
            // 🚫 NEVER auto-reload: Preserve existing board state

            // But notify user if external changes detected (but NOT on editor focus)
            const hasExternalChanges = this._lastDocumentVersion !== -1 &&
                                     this._lastDocumentVersion < document.version &&
                                     this._saveState === SaveState.IDLE &&
                                     !isFromEditorFocus; // Don't show dialog on editor focus

            if (hasExternalChanges) {
                await this.notifyExternalChanges(document);
            } else {
                // Only update version if no external changes were detected (to avoid blocking future detections)
                this._lastDocumentVersion = document.version;
            }
            return;
        }

        const previousDocument = this.fileManager.getDocument();
        const documentChanged = previousDocument?.uri.toString() !== document.uri.toString();
        const isFirstDocumentLoad = !previousDocument;

        // If document changed or this is the first document, update panel tracking
        if (documentChanged || isFirstDocumentLoad) {
            // Remove this panel from old document tracking
            const oldDocUri = this._trackedDocumentUri || previousDocument?.uri.toString();
            const panelInstance = this.getPanelInstance();
            if (oldDocUri && this.panels.get(oldDocUri) === panelInstance) {
                this.panels.delete(oldDocUri);
            }

            // Add to new document tracking
            const newDocUri = document.uri.toString();
            this._trackedDocumentUri = newDocUri;  // Remember this URI for cleanup
            this.panels.set(newDocUri, panelInstance);

            // Update panel title
            const fileName = path.basename(document.fileName);
            const currentPanel = this.panel();
            if (currentPanel) {
                currentPanel.title = `Kanban: ${fileName}`;
            }
        }

        this.fileManager.setDocument(document);

        if (documentChanged) {
            this.updateWebviewPermissions();

            // Create initial backup
            await this.backupManager.createBackup(document);

            // Start periodic backup timer
            this.backupManager.startPeriodicBackup(document);
        }

        try {
            // ALLOWED: Loading board (initial load, different document, or force reload)
            const basePath = path.dirname(document.uri.fsPath);
            const parseResult = MarkdownKanbanParser.parseMarkdown(document.getText(), basePath);

            // Update version tracking
            this._lastDocumentVersion = document.version;

            // Handle undo/redo history
            const isUndoRedoOperation = false; // This would need to be passed as parameter if needed
            if (isDifferentDocument && !isUndoRedoOperation && this._saveState === SaveState.IDLE && !forceReload) {
                // Only clear history when switching to completely different documents
                // Don't clear on force reload of same document (e.g., external changes)
                this.undoRedoManagerClear();
            }

            // Update the board
            this.setBoard(parseResult.board);
            // Update the unified include system
            this.includeFileManager._updateUnifiedIncludeSystem(parseResult.board, () => this.fileManager.getDocument());

            // Handle any unsaved changes in files that need to be removed
            await this.includeFileManager._handleUnsavedIncludeFileChanges();

            // Update our baseline of known file content
            this.updateKnownFileContent(document.getText());

            // Update included files with the external file watcher
            // Preserve existing change state
            const preservedChangeState = this.fileRegistry.getFilesWithUnsavedChanges().some(f => f.getFileType() !== "main");


            // Initialize content for new files only (preserve existing baselines)
            await this.includeFileManager._initializeUnifiedIncludeContents(() => this.fileManager.getDocument());

            // Always send notification to update tracked files list

            // ALWAYS re-check for changes after reload
            // This will detect any changes between the preserved baseline and current state
            await this.includeFileManager._recheckIncludeFileChanges();

            // Only restore the change state if recheck didn't find changes
            // (If recheck found changes, it already set the state)
            if (!this.fileRegistry.getFilesWithUnsavedChanges().some(f => f.getFileType() !== "main") && preservedChangeState) {


            }

            // Send notification after recheck to ensure UI is updated with current state

            // Clean up any duplicate row tags
            const currentBoard = this.board();
            if (currentBoard) {
                this.boardOperations.cleanupRowTags(currentBoard);
                this.boardOperations.setOriginalTaskOrder(currentBoard);
            }

            // Clear unsaved changes flag after successful reload
            if (forceReload) {
                const mainFile = this.fileRegistry.getMainFile();
                if (mainFile) {
                    // Always discard to reset state
                    // discardChanges() internally checks if content changed before emitting events
                    mainFile.discardChanges();
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Kanban parsing error: ${error instanceof Error ? error.message : String(error)}`);
            this.setBoard({
                valid: false,
                title: 'Error Loading Board',
                columns: [],
                yamlHeader: null,
                kanbanFooter: null
            });
        }

        await this.sendBoardUpdate(false, forceReload);
        this.fileManager.sendFileInfo();
    }

    /**
     * Force reload the board from file (user-initiated)
     */
    public async forceReloadFromFile(): Promise<void> {
        const document = this.fileManager.getDocument();
        if (document) {
            await this.loadMarkdownFile(document, false, true); // forceReload = true
        }
    }

    /**
     * Helper: Check if a document change is from our save operation
     * Uses hybrid state + version tracking for defense-in-depth
     */
    private isOurChange(documentVersion: number): boolean {
        // Primary check: State machine
        const isSaving = this._saveState === SaveState.SAVING;

        // Backup check: Version range tracking
        const isInVersionRange =
            this._saveEndVersion !== null &&
            documentVersion <= this._saveEndVersion;

        // Defense in depth: Either check passes = our change
        const result = isSaving || isInVersionRange;

        if (result) {
            console.log(`[SaveStateMachine] Detected our own change (state=${SaveState[this._saveState]}, v=${documentVersion}, saveEnd=${this._saveEndVersion})`);
        }

        return result;
    }

    /**
     * Save board to markdown file
     */
    /**
     * Update document content with board state, optionally save to disk
     * @param updateVersionTracking - Track document version changes
     * @param triggerSave - Whether to call document.save() (false when called from onWillSave)
     */
    private _saveQueue: Array<{resolve: () => void, reject: (error: any) => void, operation: () => Promise<void>}> = [];
    private _isProcessingSave: boolean = false;

    public async saveToMarkdown(updateVersionTracking: boolean = true, triggerSave: boolean = true): Promise<void> {
        console.log(`[KanbanFileService.saveToMarkdown] ENTRY - updateVersionTracking: ${updateVersionTracking}, triggerSave: ${triggerSave}`);

        return new Promise((resolve, reject) => {
            // Queue the save operation to prevent race conditions
            this._saveQueue.push({
                resolve,
                reject,
                operation: async () => {
                    await this._executeSaveToMarkdown(updateVersionTracking, triggerSave);
                }
            });

            // Process the queue
            this._processSaveQueue();
        });
    }

    private async _processSaveQueue(): Promise<void> {
        if (this._isProcessingSave || this._saveQueue.length === 0) {
            return;
        }

        this._isProcessingSave = true;

        while (this._saveQueue.length > 0) {
            const item = this._saveQueue.shift()!;
            try {
                await item.operation();
                item.resolve();
            } catch (error) {
                item.reject(error);
            }
        }

        this._isProcessingSave = false;
    }

    private async _executeSaveToMarkdown(updateVersionTracking: boolean = true, triggerSave: boolean = true): Promise<void> {
        console.log(`[KanbanFileService.saveToMarkdown] Executing save operation`);

        let document = this.fileManager.getDocument();
        if (!document || !this.board() || !this.board()!.valid) {
            console.warn(`[KanbanFileService.saveToMarkdown] Cannot save - document: ${!!document}, board: ${!!this.board()}, valid: ${this.board()?.valid}`);
            return;
        }

        // STATE MACHINE: Check if already saving (additional safety check)
        if (this._saveState !== SaveState.IDLE) {
            console.warn(`[SaveStateMachine] Save already in progress (state=${SaveState[this._saveState]}), this should not happen with queue`);
            return;
        }

        console.log(`[KanbanFileService.saveToMarkdown] Proceeding with save`);

        // STATE MACHINE: Transition to SAVING state and record version
        this._saveState = SaveState.SAVING;
        this._saveStartVersion = document.version;
        this._saveOperationTimestamp = new Date();
        console.log(`[SaveStateMachine] IDLE → SAVING (startVersion=${this._saveStartVersion})`);

        try{
            // Check if document is still valid/open
            const isDocumentOpen = vscode.workspace.textDocuments.some(doc =>
                doc.uri.toString() === document!.uri.toString()
            );

            if (!isDocumentOpen) {
                // Reopen the document in the background
                try {
                    const reopenedDoc = await vscode.workspace.openTextDocument(document.uri);
                    // Update the file manager with the reopened document
                    this.fileManager.setDocument(reopenedDoc);
                    document = reopenedDoc;
                } catch (reopenError) {
                    console.error('Failed to reopen document:', reopenError);
                    vscode.window.showErrorMessage(
                        `Cannot save changes: Failed to reopen "${path.basename(document.fileName)}". The file may have been deleted or moved.`
                    );
                    return;
                }
            }

            // NOTE: Include file caches are updated by trackIncludeFileUnsavedChanges()
            // They will be saved to disk after the main file save completes

            console.log('[KanbanFileService.saveToMarkdown] About to generate markdown for main file');
            console.log(`[KanbanFileService.saveToMarkdown] Board has ${this.board()!.columns.length} columns`);
            for (const col of this.board()!.columns) {
                console.log(`[KanbanFileService.saveToMarkdown] Column "${col.title}": includeMode=${col.includeMode}, includeFiles=${col.includeFiles?.join(',') || 'none'}, tasks=${col.tasks?.length || 0}`);
            }

            const markdown = MarkdownKanbanParser.generateMarkdown(this.board()!);
            console.log(`[KanbanFileService.saveToMarkdown] Generated markdown (${markdown.length} chars)`);
            console.log(`[KanbanFileService.saveToMarkdown] Generated markdown:\n${markdown}`);

            // Check for external unsaved changes before proceeding
            const canProceed = await this.checkForExternalUnsavedChanges();
            if (!canProceed) {
                console.warn('[KanbanFileService.saveToMarkdown] EARLY RETURN: checkForExternalUnsavedChanges returned false');
                return;
            }

            // Check if content has actually changed before applying edit
            const currentContent = document.getText();
            console.log(`[KanbanFileService.saveToMarkdown] Current content (${currentContent.length} chars), Generated (${markdown.length} chars)`);

            // Check if include files have unsaved changes
            const unsavedIncludeFiles = this.fileRegistry.getFilesWithUnsavedChanges().filter(f => f.getFileType() !== 'main');
            console.log(`[KanbanFileService.saveToMarkdown] Unsaved include files: ${unsavedIncludeFiles.length}`);

            if (currentContent === markdown && unsavedIncludeFiles.length === 0) {
                // No changes needed, skip the edit to avoid unnecessary re-renders
                console.log('[KanbanFileService.saveToMarkdown] EARLY RETURN: Content unchanged and no unsaved includes, skipping save');
                const mainFile = this.fileRegistry.getMainFile();
                if (mainFile) {
                    // Always discard to reset unsaved state
                    // discardChanges() internally checks if content changed before emitting events
                    mainFile.discardChanges();
                }
                return;
            }

            if (currentContent === markdown) {
                console.log('[KanbanFileService.saveToMarkdown] Main file unchanged but include files have changes - proceeding to save includes only');
            } else {
                console.log('[KanbanFileService.saveToMarkdown] Main file content has changed, proceeding with full save');
            }

            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                document.uri,
                new vscode.Range(0, 0, document.lineCount, 0),
                markdown
            );

            console.log(`[KanbanFileService.saveToMarkdown] Applying edit to document...`);
            const success = await vscode.workspace.applyEdit(edit);
            console.log(`[KanbanFileService.saveToMarkdown] applyEdit result: ${success}`);

            if (!success) {
                // VS Code's applyEdit can return false even when successful
                // Check if the document actually contains our changes before failing
                console.warn('⚠️ workspace.applyEdit returned false, checking if changes were applied...');

                // Check if the document content matches what we tried to write
                // Note: VS Code's document.getText() should be synchronous and return current state
                const currentContent = document.getText();
                const expectedContent = markdown;

                if (currentContent === expectedContent) {
                } else {
                    console.error('❌ Changes were not applied - this is a real failure');

                    // Find the first difference
                    for (let i = 0; i < Math.max(expectedContent.length, currentContent.length); i++) {
                        if (expectedContent[i] !== currentContent[i]) {
                            break;
                        }
                    }

                    throw new Error('Failed to apply workspace edit: Content mismatch detected');
                }
            }

            // STATE MACHINE: Record end version after edit applied
            this._saveEndVersion = document.version;
            console.log(`[SaveStateMachine] Edit applied (saveEndVersion=${this._saveEndVersion})`);

            // Update document version after successful edit (only if tracking is enabled)
            if (updateVersionTracking) {
                this._lastDocumentVersion = document.version + 1;
            }

            // Save the document to disk (if requested)
            if (triggerSave) {
                console.log(`[KanbanFileService.saveToMarkdown] Calling document.save()...`);

                // Pause file watcher before saving to prevent our own save from triggering "external" change
                const mainFile = this.fileRegistry.getMainFile();
                if (mainFile) {
                    mainFile.stopWatching();
                }

                try {
                    await document.save();
                    console.log(`[KanbanFileService.saveToMarkdown] document.save() completed successfully`);
                } catch (saveError) {
                    // If save fails, it might be because the document was closed
                    console.warn('[KanbanFileService.saveToMarkdown] Failed to save document:', saveError);

                    // Check if the document is still open
                    const stillOpen = vscode.workspace.textDocuments.some(doc =>
                        doc.uri.toString() === document!.uri.toString()
                    );

                    if (!stillOpen) {
                        vscode.window.showWarningMessage(
                            `Changes applied but could not save: "${path.basename(document.fileName)}" was closed during the save operation.`
                        );
                    } else {
                        throw saveError; // Re-throw if it's a different error
                    }
                } finally {
                    // Resume file watcher after save completes
                    // Note: Include files pause/resume their own watchers in MarkdownFile.save()
                    if (mainFile) {
                        mainFile.startWatching();
                    }
                }
            } else {
                console.log(`[KanbanFileService.saveToMarkdown] triggerSave=false, skipping document.save() (will be saved by VS Code)`);
            }

            // After successful save, create a backup (respects minimum interval)
            await this.backupManager.createBackup(document);

            // CRITICAL: Save all include files that have unsaved changes
            console.log('[KanbanFileService.saveToMarkdown] Checking for unsaved include files...');
            const unsavedIncludes = this.fileRegistry.getFilesWithUnsavedChanges().filter(f => f.getFileType() !== 'main');
            if (unsavedIncludes.length > 0) {
                console.log(`[KanbanFileService.saveToMarkdown] Saving ${unsavedIncludes.length} include files...`);
                await Promise.all(unsavedIncludes.map(f => f.save()));
                console.log('[KanbanFileService.saveToMarkdown] All include files saved');
            } else {
                console.log('[KanbanFileService.saveToMarkdown] No unsaved include files');
            }

            // Clear unsaved changes flag after successful save
            const mainFile = this.fileRegistry.getMainFile();
            if (mainFile) {
                // CRITICAL: Update board AND content to ensure they stay in sync
                // If we only update content, next save() will regenerate from stale board
                const currentBoard = this.board();
                if (currentBoard) {
                    mainFile.updateFromBoard(currentBoard);
                    // updateFromBoard sets updateBaseline=false, so we need to mark as saved manually
                    mainFile.setContent(markdown, true); // true = already saved, update baseline
                }
            }
            console.log('[KanbanFileService.saveToMarkdown] Save completed successfully, clearing unsaved changes');

            // Notify frontend that save is complete so it can update UI
            const panelInstance = this.panel();
            if (panelInstance) {
                panelInstance.webview.postMessage({
                    type: 'saveCompleted',
                    success: true
                });
                console.log('[KanbanFileService.saveToMarkdown] Sent saveCompleted message to frontend');
            }

            // Update our baseline after successful save
            this.updateKnownFileContent(markdown);
        } catch (error) {
            console.error('Error saving to markdown:', error);

            // Provide more specific error messages based on the error type
            let errorMessage = 'Failed to save kanban changes';
            if (error instanceof Error) {
                if (error.message.includes('Content mismatch detected')) {
                    errorMessage = 'Failed to save kanban changes: The document content could not be updated properly';
                } else if (error.message.includes('Failed to apply workspace edit')) {
                    errorMessage = 'Failed to save kanban changes: Unable to apply changes to the document';
                } else if (error.message.includes('Failed to reopen document')) {
                    errorMessage = 'Failed to save kanban changes: The document could not be accessed for writing';
                } else {
                    errorMessage = `Failed to save kanban changes: ${error.message}`;
                }
            } else {
                errorMessage = `Failed to save kanban changes: ${String(error)}`;
            }

            vscode.window.showErrorMessage(errorMessage);

            // Also send error to webview for frontend error handling
            const currentPanel = this.panel();
            if (currentPanel) {
                currentPanel.webview.postMessage({
                    type: 'saveError',
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            // STATE MACHINE: Transition to RECOVERING state for error handling
            console.log(`[SaveStateMachine] SAVING → RECOVERING (error occurred)`);
            this._saveState = SaveState.RECOVERING;

            // Error recovery: Reset state after brief delay to allow any pending events to settle
            setTimeout(() => {
                if (this._saveState === SaveState.RECOVERING) {
                    this._saveState = SaveState.IDLE;
                    this._saveStartVersion = null;
                    this._saveEndVersion = null;
                    console.log(`[SaveStateMachine] RECOVERING → IDLE (error recovery complete)`);
                }
            }, 500);
        } finally {
            // STATE MACHINE: Transition back to IDLE if save completed successfully
            if (this._saveState === SaveState.SAVING) {
                this._saveState = SaveState.IDLE;
                // Keep version tracking for a short time as backup
                setTimeout(() => {
                    this._saveStartVersion = null;
                    this._saveEndVersion = null;
                }, 1000);
                console.log(`[SaveStateMachine] SAVING → IDLE (save complete)`);
            }
        }
    }

    /**
     * Save main kanban changes
     */
    public async saveMainKanbanChanges(): Promise<void> {
        try {
            await this.saveToMarkdown();
        } catch (error) {
            console.error('[InlineInclude] Error saving main kanban changes:', error);
            vscode.window.showErrorMessage(`Error saving kanban changes: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Initialize a new kanban file with header
     */
    public async initializeFile(): Promise<void> {
        const document = this.fileManager.getDocument();
        if (!document) {
            vscode.window.showErrorMessage('No document loaded');
            return;
        }

        // Check if document is still open
        const isDocumentOpen = vscode.workspace.textDocuments.some(doc =>
            doc.uri.toString() === document.uri.toString()
        );

        if (!isDocumentOpen) {
            vscode.window.showWarningMessage(
                `Cannot initialize: "${path.basename(document.fileName)}" has been closed. Please reopen the file.`,
                'Open File'
            ).then(async selection => {
                if (selection === 'Open File') {
                    await this.openFileWithReuseCheck(document.uri.fsPath);
                }
            });
            return;
        }

        // STATE MACHINE: Transition to SAVING
        this._saveState = SaveState.SAVING;
        this._saveStartVersion = document.version;
        console.log(`[SaveStateMachine] initializeFile: IDLE → SAVING`);

        const kanbanHeader = "---\n\nkanban-plugin: board\n\n---\n\n";
        const currentContent = document.getText();
        const newContent = kanbanHeader + currentContent;

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            newContent
        );

        try {
            await vscode.workspace.applyEdit(edit);
            this._saveEndVersion = document.version;
            await document.save();

            // Reload the file after successful initialization
            // Keep SAVING state during reload to prevent undo stack clearing
            await this.loadMarkdownFile(document);

            // STATE MACHINE: Transition to IDLE
            this._saveState = SaveState.IDLE;
            this._saveStartVersion = null;
            this._saveEndVersion = null;
            console.log(`[SaveStateMachine] initializeFile: SAVING → IDLE`);

            vscode.window.showInformationMessage('Kanban board initialized successfully');
        } catch (error) {
            // STATE MACHINE: Error recovery
            this._saveState = SaveState.IDLE;
            this._saveStartVersion = null;
            this._saveEndVersion = null;
            console.log(`[SaveStateMachine] initializeFile: SAVING → IDLE (error recovery)`);
            vscode.window.showErrorMessage(`Failed to initialize file: ${error}`);
        }
    }

    /**
     * Setup document change listener for tracking modifications
     */
    public setupDocumentChangeListener(disposables: vscode.Disposable[]): void {
        // Listen for document changes
        const changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
            const currentDocument = this.fileManager.getDocument();
            if (currentDocument && event.document === currentDocument) {
                // Registry tracks editor changes automatically via file watchers

                // HYBRID STATE MACHINE: Check if this change is from our save operation
                // Uses defense-in-depth: both state check AND version tracking
                const isOurChange = this.isOurChange(event.document.version);

                // Document was modified externally (not by our kanban save operation)
                if (!isOurChange) {
                    this._hasExternalUnsavedChanges = true;
                    console.log(`[SaveStateMachine] External change detected (v=${event.document.version})`);
                } else {
                    console.log(`[SaveStateMachine] Our change detected, ignoring (v=${event.document.version})`);
                }

                // Notify debug overlay of document state change so it can update editor state
                const currentPanel = this.panel();
                if (currentPanel) {
                    currentPanel.webview.postMessage({
                        type: 'documentStateChanged',
                        isDirty: event.document.isDirty,
                        version: event.document.version
                    });
                }
            }

            // NOTE: Document change tracking behavior
            // =========================================
            // We DO track unsaved changes in kanban-managed files for conflict detection:
            // - Main kanban file: Tracked via document.isDirty check in MainKanbanFile.hasConflict()
            // - Include files: Tracked via internal _hasUnsavedChanges flag
            //
            // We DO NOT track unsaved changes in external non-kanban files:
            // - External files being edited in VSCode are not tracked
            // - Only SAVED external changes trigger conflict detection via file watcher
            //
            // This ensures:
            // - User's kanban/include edits are protected from external overwrites
            // - External file edits don't interfere until actually saved to disk
        });
        disposables.push(changeDisposable);

        // Register with SaveEventCoordinator for document save tracking
        this.registerSaveHandler();
    }

    /**
     * Register handler with SaveEventCoordinator for version tracking
     */
    public registerSaveHandler(): void {
        const coordinator = SaveEventCoordinator.getInstance();
        const document = this.fileManager.getDocument();
        if (!document) return;

        const handlerId = `panel-${document.uri.fsPath}`;

        const handler: SaveEventHandler = {
            id: handlerId,
            handleSave: (savedDocument: vscode.TextDocument) => {
                const currentDocument = this.fileManager.getDocument();

                if (currentDocument && savedDocument === currentDocument) {
                    // Registry tracks saves automatically

                    // Document was saved, update our version tracking to match (legacy compatibility)
                    this._lastDocumentVersion = savedDocument.version;
                    this._hasExternalUnsavedChanges = false;
                }

                // Check if this is an included file
                for (const file of this.fileRegistry.getIncludeFiles()) {
                    if (savedDocument.uri.fsPath === file.getPath()) {
                        // Registry tracks save state automatically
                        console.log(`[SaveHandler] Include file saved externally: ${file.getRelativePath()}`);



                        // Notify debug overlay to update
                        const currentPanel = this.panel();
                        if (currentPanel) {
                            currentPanel.webview.postMessage({
                                type: 'includeFileStateChanged',
                                filePath: file.getRelativePath(),
                                isUnsavedInEditor: false
                            });
                        }

                        // NOTE: External change handling is now handled EXCLUSIVELY by ExternalFileWatcher
                        // which is also registered with SaveEventCoordinator.
                        // REMOVED duplicate handling here to prevent race conditions and double-reload bugs.
                        // ExternalFileWatcher will fire the event and handleExternalFileChange will be called.

                        console.log(`[SaveHandler] Include file saved: ${file.getRelativePath()} - ExternalFileWatcher will handle conflict detection`);
                        break;
                    }
                }
            }
        };

        coordinator.registerHandler(handler);
    }

    /**
     * Update the known file content baseline
     */
    public updateKnownFileContent(content: string): void {
        this._lastKnownFileContent = content;
        this._hasExternalUnsavedChanges = false;
    }

    /**
     * Open a file with reuse check - focuses existing editor if already open
     */
    public async openFileWithReuseCheck(filePath: string): Promise<void> {
        try {
            // Normalize the path for comparison (resolve symlinks, normalize separators)
            const normalizedPath = path.resolve(filePath);

            // Check if the file is already open as a document (even if not visible)
            const existingDocument = vscode.workspace.textDocuments.find(doc => {
                const docPath = path.resolve(doc.uri.fsPath);
                return docPath === normalizedPath;
            });

            if (existingDocument) {
                // File is already open, focus it
                await vscode.window.showTextDocument(existingDocument, {
                    preserveFocus: false,
                    preview: false
                    // Let VS Code find the existing tab location
                });
            } else {
                // File is not open, open it normally
                const fileUri = vscode.Uri.file(filePath);
                const document = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(document, {
                    preserveFocus: false,
                    preview: false
                });
            }
        } catch (error) {
            console.error(`[KanbanFileService] Error opening file ${filePath}:`, error);
        }
    }

    /**
     * Set file as hidden on Windows using attrib command
     * On Unix systems, files starting with . are already hidden
     */
    public async setFileHidden(filePath: string): Promise<void> {
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

    /**
     * Check for external unsaved changes when about to save
     * NOW USES NEW CONFLICT ENGINE FOR CONSISTENT DETECTION
     */
    private async checkForExternalUnsavedChanges(): Promise<boolean> {
        const document = this.fileManager.getDocument();
        if (!document) {
            return true; // No document, nothing to check
        }

        const mainFile = this.fileRegistry.getMainFile();
        const includeFiles = this.fileRegistry.getAll().filter(f => f.getFileType() !== 'main');
        const changedIncludeFiles = includeFiles
            .filter(f => f.hasUnsavedChanges())
            .map(f => f.getRelativePath());

        // Create conflict context for main file
        const mainContext: ConflictContext = {
            type: 'presave_check',
            fileType: 'main',
            filePath: document.uri.fsPath,
            fileName: path.basename(document.fileName),
            hasMainUnsavedChanges: mainFile?.hasUnsavedChanges() || false,
            hasIncludeUnsavedChanges: changedIncludeFiles.length > 0,
            hasExternalChanges: mainFile?.hasExternalChanges() || false,
            changedIncludeFiles: changedIncludeFiles,
            isInEditMode: false // We're in save operation, not editing
        };

        // Use ConflictEngine to detect conflicts
        const conflicts = this._conflictEngine.detectConflicts(mainContext);

        if (conflicts.length > 0) {
            console.log(`[checkForExternalUnsavedChanges] Detected ${conflicts.length} conflict(s) using ConflictEngine`);

            // For each conflict, get resolution (may auto-resolve or show dialog)
            for (const conflict of conflicts) {
                const resolution = this._conflictEngine.resolveConflict(conflict);

                if (!resolution.shouldProceed) {
                    console.log(`[checkForExternalUnsavedChanges] Conflict resolution cancelled save: ${conflict.description}`);
                    return false;
                }

                console.log(`[checkForExternalUnsavedChanges] Conflict resolved: ${resolution.action} - ${resolution.description}`);
            }
        }

        // Check include files for conflicts
        const filesThatNeedReload = this.fileRegistry.getFilesThatNeedReload();
        if (filesThatNeedReload.length > 0) {
            console.log(`[checkForExternalUnsavedChanges] ${filesThatNeedReload.length} include file(s) have external changes`);

            // Check each include file for conflicts
            for (const includeFile of filesThatNeedReload) {
                const includeContext: ConflictContext = {
                    type: 'presave_check',
                    fileType: 'include',
                    filePath: includeFile.getPath(),
                    fileName: includeFile.getRelativePath(),
                    hasMainUnsavedChanges: mainFile?.hasUnsavedChanges() || false,
                    hasIncludeUnsavedChanges: includeFile.hasUnsavedChanges(),
                    hasExternalChanges: true, // File needs reload = has external changes
                    changedIncludeFiles: [includeFile.getRelativePath()],
                    isInEditMode: false
                };

                const includeConflicts = this._conflictEngine.detectConflicts(includeContext);

                if (includeConflicts.length > 0) {
                    console.log(`[checkForExternalUnsavedChanges] Include file conflict detected: ${includeFile.getRelativePath()}`);

                    for (const conflict of includeConflicts) {
                        const resolution = this._conflictEngine.resolveConflict(conflict);

                        if (!resolution.shouldProceed) {
                            console.log(`[checkForExternalUnsavedChanges] Include file conflict cancelled save: ${conflict.description}`);
                            return false;
                        }

                        console.log(`[checkForExternalUnsavedChanges] Include file conflict resolved: ${resolution.action} - ${resolution.description}`);
                    }
                }
            }
        }

        return true; // All checks passed - save can proceed
    }
}
