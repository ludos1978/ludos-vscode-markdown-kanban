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
import { IEventBus } from './core/interfaces/IEventBus';

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
        private updateWebviewPermissions: () => void,
        private undoRedoManagerClear: () => void,
        private panelStates: Map<string, any>,
        private panels: Map<string, any>,
        private getPanelInstance: () => any,  // Returns KanbanWebviewPanel instance
        private eventBus?: IEventBus
    ) {
        this._panelId = Math.random().toString(36).substr(2, 9);

        // Initialize new architecture components
        this._saveCoordinator = SaveCoordinator.getInstance();
    }

    private createMockEventBus(): IEventBus {
        return {
            publish: async (event: any) => {
            },
            subscribe: (eventType: string, handler: any) => {
                return {
                    unsubscribe: () => {},
                    isActive: () => true
                };
            },
            unsubscribe: (eventType: string, handler: any) => {
            },
            getSubscriberCount: (eventType: string) => 0,
            clear: () => {
            }
        };
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

        // Sync cached board with MainKanbanFile for conflict detection
        const mainFile = this.fileRegistry.getMainFile();
        if (mainFile) {
            mainFile.setCachedBoardFromWebview(cachedBoardFromWebview);
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
                    const parseResult = MarkdownKanbanParser.parseMarkdown(document.getText(), basePath, undefined, document.uri.fsPath);
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

            // External changes are now handled by the unified file watcher system
            // The UnifiedChangeHandler and individual file watchers detect and resolve conflicts
            if (!hasExternalChanges) {
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

        // Register save handler now that document is available
        this.registerSaveHandler();

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
            const parseResult = MarkdownKanbanParser.parseMarkdown(document.getText(), basePath, undefined, document.uri.fsPath);

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
        }

        return result;
    }

    /**
     * Save board to markdown file using unified SaveCoordinator
     */
    public async saveToMarkdown(updateVersionTracking: boolean = true, triggerSave: boolean = true): Promise<void> {

        // Check for main file and valid board (document is NOT required - panel can stay open without it)
        const mainFile = this.fileRegistry.getMainFile();
        if (!mainFile || !this.board() || !this.board()!.valid) {
            console.warn(`[KanbanFileService.saveToMarkdown] Cannot save - mainFile: ${!!mainFile}, board: ${!!this.board()}, valid: ${this.board()?.valid}`);
            return;
        }

        // Generate markdown content
        const markdown = MarkdownKanbanParser.generateMarkdown(this.board()!);

        // Use SaveCoordinator for unified save handling
        await this._saveCoordinator.saveFile(mainFile, markdown);

        // Save include files that have unsaved changes
        const unsavedIncludes = this.fileRegistry.getFilesWithUnsavedChanges().filter(f => f.getFileType() !== 'main');
        if (unsavedIncludes.length > 0) {
            // Save each include file individually, handling validation errors gracefully
            const saveResults = await Promise.allSettled(
                unsavedIncludes.map(f => this._saveCoordinator.saveFile(f))
            );

            // Log any files that failed to save due to validation
            const failures = saveResults
                .map((result, index) => ({ result, file: unsavedIncludes[index] }))
                .filter(({ result }) => result.status === 'rejected');

            if (failures.length > 0) {
                failures.forEach(({ result, file }) => {
                    const error = (result as PromiseRejectedResult).reason;
                    console.warn(`[KanbanFileService] Skipping save for ${file.getPath()}: ${error.message || error}`);
                });
            }
        }

        // Update state after successful save (reuse mainFile from line 482)
        const currentBoard = this.board();
        if (currentBoard) {
            // CRITICAL: Pass updateBaseline=true since we just saved to disk
            mainFile.updateFromBoard(currentBoard, true, true);
            // NOTE: No need for second setContent call - updateFromBoard already updated baseline
        }

        // Update known file content
        this.updateKnownFileContent(markdown);

        // Notify frontend that save is complete (may fail if webview is disposed during close)
        const panelInstance = this.panel();
        if (panelInstance) {
            try {
                panelInstance.webview.postMessage({
                    type: 'saveCompleted',
                    success: true
                });
            } catch (e) {
                // Webview may be disposed during panel close - save already succeeded
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

            // STATE MACHINE: Transition to IDLE before reload
            // (loadMarkdownFile returns early if state is not IDLE)
            this._saveState = SaveState.IDLE;
            this._saveStartVersion = null;
            this._saveEndVersion = null;

            // Reload the file after successful initialization
            await this.loadMarkdownFile(document);

            vscode.window.showInformationMessage('Kanban board initialized successfully');
        } catch (error) {
            // STATE MACHINE: Error recovery
            this._saveState = SaveState.IDLE;
            this._saveStartVersion = null;
            this._saveEndVersion = null;
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

                // NOTE: We do NOT track unsaved external changes
                // Only SAVED external changes are tracked via file watcher
                // This prevents noise from user typing in text editor
                if (!isOurChange) {
                    // Don't set _hasExternalUnsavedChanges - only track SAVED changes
                } else {
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

        // NOTE: SaveEventCoordinator registration moved to loadMarkdownFile()
        // because document is not available yet when this method is called in constructor
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
            handleSave: async (savedDocument: vscode.TextDocument) => {
                const currentDocument = this.fileManager.getDocument();

                if (currentDocument && savedDocument === currentDocument) {
                    // Registry tracks saves automatically

                    // Document was saved, update our version tracking to match (legacy compatibility)
                    this._lastDocumentVersion = savedDocument.version;
                    this._hasExternalUnsavedChanges = false;

                    // CRITICAL: Check if we have unsaved Kanban changes before clearing external changes
                    // Add a small delay to allow any pending markUnsavedChanges callbacks to complete
                    await new Promise(resolve => setTimeout(resolve, 50));

                    const mainFile = this.fileRegistry.getMainFile();
                    if (mainFile) {
                        const hasUnsavedKanbanChanges = mainFile.hasUnsavedChanges();
                        const hasIncludeFileChanges = this.fileRegistry.getIncludeFiles().some(f => f.hasUnsavedChanges());
                        const cachedBoard = mainFile.getCachedBoardFromWebview();

                        // If there's a cached board from webview, it means user has edited in UI
                        const hasCachedBoardChanges = !!cachedBoard;


                        // Debug: Check each include file individually
                        const includeFiles = this.fileRegistry.getIncludeFiles();
                        includeFiles.forEach((f, i) => {
                        });

                        // Check if there are unsaved Kanban changes (main file, include files, or UI edited board)
                        if (hasUnsavedKanbanChanges || hasIncludeFileChanges || hasCachedBoardChanges) {
                            // User saved externally (Ctrl+S) while having unsaved Kanban changes
                            // File watcher will trigger conflict detection automatically
                        } else {
                            // No unsaved Kanban changes - safe save, watcher will auto-reload
                        }
                        // NOTE: No need to call markSaveAsLegitimate - watcher handles everything via SaveOptions
                    }
                }

                // Check if this is an included file
                for (const file of this.fileRegistry.getIncludeFiles()) {
                    if (savedDocument.uri.fsPath === file.getPath()) {
                        // Registry tracks save state automatically

                        // NOTE: Watcher handles everything via SaveOptions - no manual marking needed

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
                }
            }
        } catch (error) {
            // Silently fail - file is still created with . prefix
        }
    }

    /**
     * Compare two board objects to determine if they are different
     * Used for detecting unsaved Kanban changes during external saves
     */
    private _boardsAreDifferent(board1: KanbanBoard, board2: KanbanBoard): boolean {
        // Normalize both boards for comparison (remove volatile fields)
        const normalized1 = this._normalizeBoardForComparison(board1);
        const normalized2 = this._normalizeBoardForComparison(board2);

        // Compare the normalized boards
        return JSON.stringify(normalized1) !== JSON.stringify(normalized2);
    }

    /**
     * Normalize a board for comparison by removing volatile fields
     */
    private _normalizeBoardForComparison(board: KanbanBoard): any {
        // Deep clone to avoid modifying original
        const normalized = JSON.parse(JSON.stringify(board));

        // Remove volatile fields that don't affect content
        if (normalized.columns) {
            for (const column of normalized.columns) {
                // Remove any volatile column properties
                delete column.isLoadingContent;

                if (column.tasks) {
                    for (const task of column.tasks) {
                        // Remove volatile task properties
                        delete task.isLoadingContent;
                        // Keep essential content: title, description, includeFiles, etc.
                    }
                }
            }
        }

        return normalized;
    }


}
