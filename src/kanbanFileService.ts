import * as vscode from 'vscode';
import * as path from 'path';
import { MarkdownKanbanParser, KanbanBoard } from './markdownParser';
import { FileManager } from './fileManager';
import { MarkdownFileRegistry, FileFactory } from './files';
import { BackupManager } from './services/BackupManager';
import { SaveEventDispatcher, SaveEventHandler } from './SaveEventDispatcher';
import { ConflictContext, ConflictResolution } from './services/ConflictResolver';
import { BoardOperations } from './board';
import { FileSaveService } from './core/FileSaveService';
import { getErrorMessage } from './utils/stringUtils';
import { PanelContext } from './panel';

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
 * Panel callbacks interface - groups all callbacks from panel to reduce constructor parameters
 */
export interface KanbanFileServiceCallbacks {
    getBoard: () => KanbanBoard | undefined;
    setBoard: (board: KanbanBoard) => void;
    sendBoardUpdate: (applyDefaultFolding?: boolean, isFullRefresh?: boolean) => Promise<void>;
    getPanel: () => vscode.WebviewPanel | undefined;
    getContext: () => vscode.ExtensionContext;
    showConflictDialog: (context: ConflictContext) => Promise<ConflictResolution | null>;
    updateWebviewPermissions: () => void;
    clearUndoRedo: () => void;
    getPanelInstance: () => any;
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
    // Service-specific state (not shared)
    private _lastKnownFileContent: string = '';

    // State machine for tracking save operations
    private _saveState: SaveState = SaveState.IDLE;

    private _cachedBoardFromWebview: KanbanBoard | null = null;

    // NEW ARCHITECTURE COMPONENTS
    private _fileSaveService: FileSaveService;

    // Shared panel context (single source of truth with panel)
    private _context: PanelContext;

    constructor(
        private fileManager: FileManager,
        private fileRegistry: MarkdownFileRegistry,
        _fileFactory: FileFactory,  // Reserved for future use
        private backupManager: BackupManager,
        private boardOperations: BoardOperations,
        private callbacks: KanbanFileServiceCallbacks,
        context: PanelContext,  // Shared panel context
        private panelStates: Map<string, any>,
        private panels: Map<string, any>
    ) {
        this._context = context;

        // Initialize new architecture components
        this._fileSaveService = FileSaveService.getInstance();
    }

    // Convenience accessors for callbacks (maintains backwards compatibility internally)
    private get board() { return this.callbacks.getBoard; }
    private get setBoard() { return this.callbacks.setBoard; }
    private get sendBoardUpdate() { return this.callbacks.sendBoardUpdate; }
    private get panel() { return this.callbacks.getPanel; }
    private get context() { return this.callbacks.getContext; }
    // showConflictDialog available via this.callbacks.showConflictDialog if needed
    private get updateWebviewPermissions() { return this.callbacks.updateWebviewPermissions; }
    private get undoRedoManagerClear() { return this.callbacks.clearUndoRedo; }
    private get getPanelInstance() { return this.callbacks.getPanelInstance; }

    /**
     * Get current state values for syncing back to panel
     * NOTE: Document state (version, uri) is now shared via PanelContext
     */
    public getState(): {
        isUpdatingFromPanel: boolean;
        hasUnsavedChanges: boolean;
        cachedBoardFromWebview: KanbanBoard | null;
        lastKnownFileContent: string;
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
            lastKnownFileContent: this._lastKnownFileContent
        };
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
                    // Registry now handles include content automatically via generateBoard()
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

        // Store document URI for serialization (in shared PanelContext)
        this._context.setLastDocumentUri(document.uri.toString());

        // Store panel state for serialization in VSCode context
        const panelId = this._context.panelId;
        this.panelStates.set(panelId, {
            documentUri: document.uri.toString(),
            panelId: panelId
        });

        // Also store in VSCode's global state for persistence across restarts
        // Use documentUri hash as stable key so panels can find their state after restart
        const stableKey = `kanban_doc_${Buffer.from(document.uri.toString()).toString('base64').replace(/[^a-zA-Z0-9]/g, '_')}`;
        this.context().globalState.update(stableKey, {
            documentUri: document.uri.toString(),
            lastAccessed: Date.now(),
            panelId: panelId  // Store for cleanup but don't use for lookup
        });

        const currentDocumentUri = this.fileManager.getDocument()?.uri.toString();
        const isDifferentDocument = currentDocumentUri !== document.uri.toString();

        // STRICT POLICY: Only reload board in these specific cases:
        // 1. Initial panel creation (no existing board)
        // 2. Switching to a different document
        // 3. User explicitly forces reload via dialog
        const isInitialLoad = !this.board();

        if (!isInitialLoad && !isDifferentDocument && !forceReload) {
            // 🚫 NEVER auto-reload: Preserve existing board state

            // But notify user if external changes detected (but NOT on editor focus)
            const lastVersion = this._context.lastDocumentVersion;
            const hasExternalChanges = lastVersion !== -1 &&
                                     lastVersion < document.version &&
                                     this._saveState === SaveState.IDLE &&
                                     !isFromEditorFocus; // Don't show dialog on editor focus

            // External changes are now handled by the unified file watcher system
            // The UnifiedChangeHandler and individual file watchers detect and resolve conflicts
            if (!hasExternalChanges) {
                // Only update version if no external changes were detected (to avoid blocking future detections)
                this._context.setLastDocumentVersion(document.version);
            }
            return;
        }

        const previousDocument = this.fileManager.getDocument();
        const documentChanged = previousDocument?.uri.toString() !== document.uri.toString();
        const isFirstDocumentLoad = !previousDocument;

        // If document changed or this is the first document, update panel tracking
        if (documentChanged || isFirstDocumentLoad) {
            // Remove this panel from old document tracking
            const oldDocUri = this._context.trackedDocumentUri || previousDocument?.uri.toString();
            const panelInstance = this.getPanelInstance();
            if (oldDocUri && this.panels.get(oldDocUri) === panelInstance) {
                this.panels.delete(oldDocUri);
            }

            // Add to new document tracking
            const newDocUri = document.uri.toString();
            this._context.setTrackedDocumentUri(newDocUri);  // Remember this URI for cleanup
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

            // Update version tracking (in shared PanelContext)
            this._context.setLastDocumentVersion(document.version);

            // Handle undo/redo history
            const isUndoRedoOperation = false; // This would need to be passed as parameter if needed
            if (isDifferentDocument && !isUndoRedoOperation && this._saveState === SaveState.IDLE && !forceReload) {
                // Only clear history when switching to completely different documents
                // Don't clear on force reload of same document (e.g., external changes)
                this.undoRedoManagerClear();
            }

            // Update the board
            this.setBoard(parseResult.board);
            // Registry now handles include content automatically via generateBoard()

            // Update our baseline of known file content
            this.updateKnownFileContent(document.getText());

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
            vscode.window.showErrorMessage(`Kanban parsing error: ${getErrorMessage(error)}`);
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
     * Save board to markdown file using unified FileSaveService
     */
    public async saveToMarkdown(_updateVersionTracking: boolean = true, _triggerSave: boolean = true): Promise<void> {

        // Check for main file and valid board (document is NOT required - panel can stay open without it)
        const mainFile = this.fileRegistry.getMainFile();
        if (!mainFile || !this.board() || !this.board()!.valid) {
            console.warn(`[KanbanFileService.saveToMarkdown] Cannot save - mainFile: ${!!mainFile}, board: ${!!this.board()}, valid: ${this.board()?.valid}`);
            return;
        }

        // Generate markdown content
        const markdown = MarkdownKanbanParser.generateMarkdown(this.board()!);

        // Use FileSaveService for unified save handling
        await this._fileSaveService.saveFile(mainFile, markdown);

        // Save include files that have unsaved changes
        const unsavedIncludes = this.fileRegistry.getFilesWithUnsavedChanges().filter(f => f.getFileType() !== 'main');
        if (unsavedIncludes.length > 0) {
            // Save each include file individually, handling validation errors gracefully
            const saveResults = await Promise.allSettled(
                unsavedIncludes.map(f => this._fileSaveService.saveFile(f))
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
            await document.save();

            // STATE MACHINE: Transition to IDLE before reload
            this._saveState = SaveState.IDLE;

            // Reload the file after successful initialization (forceReload=true to bypass early-return check)
            await this.loadMarkdownFile(document, false, true);

            vscode.window.showInformationMessage('Kanban board initialized successfully');
        } catch (error) {
            // STATE MACHINE: Error recovery
            this._saveState = SaveState.IDLE;
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
                // NOTE: We do NOT track unsaved external changes - only SAVED external changes
                // are tracked via file watcher. This prevents noise from user typing in text editor.

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

        // NOTE: SaveEventDispatcher registration moved to loadMarkdownFile()
        // because document is not available yet when this method is called in constructor
    }

    /**
     * Register handler with SaveEventDispatcher for version tracking
     */
    public registerSaveHandler(): void {
        const dispatcher = SaveEventDispatcher.getInstance();
        const document = this.fileManager.getDocument();
        if (!document) return;

        const handlerId = `panel-${document.uri.fsPath}`;

        const handler: SaveEventHandler = {
            id: handlerId,
            handleSave: async (savedDocument: vscode.TextDocument) => {
                const currentDocument = this.fileManager.getDocument();

                if (currentDocument && savedDocument === currentDocument) {
                    // Document was saved, update version tracking (in shared PanelContext)
                    this._context.setLastDocumentVersion(savedDocument.version);
                    // NOTE: Watcher handles conflict detection and auto-reload via SaveOptions
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

                        // External changes are handled by ExternalFileWatcher (registered with SaveEventDispatcher)
                        break;
                    }
                }
            }
        };

        dispatcher.registerHandler(handler);
    }

    /**
     * Update the known file content baseline
     */
    public updateKnownFileContent(content: string): void {
        this._lastKnownFileContent = content;
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

}
