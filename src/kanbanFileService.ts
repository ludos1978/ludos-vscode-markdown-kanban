import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MarkdownKanbanParser, KanbanBoard } from './markdownParser';
import { FileManager } from './fileManager';
import { MarkdownFileRegistry, FileFactory } from './files';
import { BackupManager } from './services/BackupManager';
import { SaveEventDispatcher, SaveEventHandler } from './SaveEventDispatcher';
import { BoardOperations } from './board';
import { FileSaveService } from './core/FileSaveService';
import { getErrorMessage } from './utils/stringUtils';
import { PanelContext, WebviewManager } from './panel';
import { BoardStore } from './core/stores';
import { DOCUMENT_CHANGE_DEBOUNCE_MS } from './constants/TimeoutConstants';
import { showError, showWarning, showInfo } from './services/NotificationService';

/**
 * Save operation state for hybrid state machine + version tracking
 *
 * Replaces timing-dependent boolean flag with explicit states for reliability
 */
enum SaveState {
    IDLE,        // No save operation in progress
    SAVING       // Save operation active (applying edits, saving files)
}

/**
 * Simplified dependencies for KanbanFileService
 * Direct references instead of callback indirection
 */
export interface KanbanFileServiceDeps {
    boardStore: BoardStore;
    extensionContext: vscode.ExtensionContext;
    getPanel: () => vscode.WebviewPanel;
    getPanelInstance: () => any;
    getWebviewManager: () => WebviewManager | null;
    sendBoardUpdate: (applyDefaultFolding?: boolean, isFullRefresh?: boolean) => Promise<void>;
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
    // State machine for tracking save operations
    private _saveState: SaveState = SaveState.IDLE;

    // NEW ARCHITECTURE COMPONENTS
    private _fileSaveService: FileSaveService;

    // Shared panel context (single source of truth with panel)
    private _context: PanelContext;

    // Dependencies (simplified from callbacks)
    private _deps: KanbanFileServiceDeps;

    // Debounce timer for document change reparse (prevents rapid reparses during undo/redo)
    private _documentChangeDebounceTimer: NodeJS.Timeout | null = null;
    // Note: Uses centralized DOCUMENT_CHANGE_DEBOUNCE_MS from TimeoutConstants

    constructor(
        private fileManager: FileManager,
        private fileRegistry: MarkdownFileRegistry,
        _fileFactory: FileFactory,  // Reserved for future use
        private backupManager: BackupManager,
        private boardOperations: BoardOperations,
        deps: KanbanFileServiceDeps,
        context: PanelContext,  // Shared panel context
        private panelStates: Map<string, any>,
        private panels: Map<string, any>
    ) {
        this._context = context;
        this._deps = deps;

        // Initialize new architecture components - use panel's file save service
        this._fileSaveService = context.fileSaveService;
    }

    // Convenience accessors for dependencies
    private get board() { return () => this._deps.boardStore.getBoard(); }
    private get setBoard() { return (board: KanbanBoard) => this._deps.boardStore.setBoard(board); }
    private get sendBoardUpdate() { return this._deps.sendBoardUpdate; }
    private get panel() { return this._deps.getPanel; }
    private get extensionContext() { return this._deps.extensionContext; }
    private get updateWebviewPermissions() { return () => this._deps.getWebviewManager()?.updatePermissions(); }
    private get undoRedoManagerClear() { return () => this._deps.boardStore.clearHistory(); }
    private get getPanelInstance() { return this._deps.getPanelInstance; }
    private get setOriginalTaskOrder() { return (board: KanbanBoard) => this._deps.boardStore.setOriginalTaskOrder(board); }

    /**
     * Get current state values for syncing back to panel
     * NOTE: Document state (version, uri) is now shared via PanelContext
     */
    public getState(): {
        isUpdatingFromPanel: boolean;
        hasUnsavedChanges: boolean;
    } {
        // Query main file for unsaved changes (single source of truth)
        const mainFile = this.fileRegistry.getMainFile();
        const hasUnsavedChanges = mainFile?.hasUnsavedChanges() || false;

        // STATE MACHINE: Convert to boolean
        const isUpdatingFromPanel = this._saveState !== SaveState.IDLE;

        return {
            isUpdatingFromPanel,
            hasUnsavedChanges: hasUnsavedChanges
        };
    }

    /**
     * Ensure board is loaded and send update to webview
     */
    public async ensureBoardAndSendUpdate(): Promise<void> {
        if (this.fileManager.getDocument()) {
            try {
                const document = this.fileManager.getDocument()!;

                // Parse board from document
                // Note: MainKanbanFile._cachedBoardFromWebview handles unsaved UI state for conflict detection
                const basePath = path.dirname(document.uri.fsPath);
                const parseResult = MarkdownKanbanParser.parseMarkdown(document.getText(), basePath, undefined, document.uri.fsPath);
                this.setBoard(parseResult.board);

                const currentBoard = this.board();
                if (currentBoard) {
                    this.setOriginalTaskOrder(currentBoard);
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
    public async loadMarkdownFile(document: vscode.TextDocument, forceReload: boolean = false): Promise<void> {

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
        this.extensionContext.globalState.update(stableKey, {
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
            // External changes are handled by the unified file watcher system
            // (UnifiedChangeHandler and individual file watchers detect and resolve conflicts)
            this._context.setLastDocumentVersion(document.version);
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

            // CRITICAL: Check include file existence and set includeError flags BEFORE sending to frontend
            // This runs during initial load when MainKanbanFile may not be initialized yet
            this._checkIncludeFileExistence(parseResult.board, basePath);

            // Clean up any duplicate row tags
            const currentBoard = this.board();
            if (currentBoard) {
                this.boardOperations.cleanupRowTags(currentBoard);
                this.setOriginalTaskOrder(currentBoard);
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
            showError(`Kanban parsing error: ${getErrorMessage(error)}`);
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
            showError('No document loaded');
            return;
        }

        // Check if document is still open
        const isDocumentOpen = vscode.workspace.textDocuments.some(doc =>
            doc.uri.toString() === document.uri.toString()
        );

        if (!isDocumentOpen) {
            showWarning(
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
            await this.loadMarkdownFile(document, true);

            showInfo('Kanban board initialized successfully');
        } catch (error) {
            // STATE MACHINE: Error recovery
            this._saveState = SaveState.IDLE;
            showError(`Failed to initialize file: ${error}`);
        }
    }

    /**
     * Setup document change listener for tracking modifications
     */
    public setupDocumentChangeListener(disposables: vscode.Disposable[]): void {
        // Listen for document changes
        const changeDisposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
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

                // UNDO SUPPORT: Check if document content differs from our cache
                // This happens when user undoes a WorkspaceEdit operation
                // Debounced to prevent rapid reparses during multiple undo/redo operations
                const mainFile = this.fileRegistry.getMainFile();
                if (mainFile) {
                    const documentContent = event.document.getText();
                    const cachedContent = mainFile.getContent();
                    if (documentContent !== cachedContent) {
                        // Clear any pending debounce timer
                        if (this._documentChangeDebounceTimer) {
                            clearTimeout(this._documentChangeDebounceTimer);
                        }
                        // Debounce the reparse
                        this._documentChangeDebounceTimer = setTimeout(async () => {
                            this._documentChangeDebounceTimer = null;
                            // Re-check content diff (may have changed during debounce)
                            const currentDocContent = event.document.getText();
                            const currentCacheContent = mainFile.getContent();
                            if (currentDocContent !== currentCacheContent) {
                                console.log('[KanbanFileService] Document content changed (possibly undo), syncing cache and reparsing');
                                // Sync cache from document
                                mainFile.setContent(currentDocContent, false);
                                // Trigger full board refresh
                                await this.sendBoardUpdate(false, true);
                            }
                        }, DOCUMENT_CHANGE_DEBOUNCE_MS);
                    }
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
     * Check include file existence and set includeError flags on the board
     *
     * This is called during initial load when MainKanbanFile may not be initialized yet.
     * It directly checks the filesystem and sets error flags so the frontend shows warnings.
     */
    private _checkIncludeFileExistence(board: KanbanBoard, basePath: string): void {
        if (!board.columns) return;

        for (const column of board.columns) {
            // Check column includes
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    // Resolve the absolute path
                    const absolutePath = path.isAbsolute(relativePath)
                        ? relativePath
                        : path.resolve(basePath, relativePath);

                    const fileExists = fs.existsSync(absolutePath);
                    console.log(`[KanbanFileService] Initial load include check: column=${column.id}, relativePath=${relativePath}, absolutePath=${absolutePath}, exists=${fileExists}`);

                    if (!fileExists) {
                        (column as any).includeMode = true;  // REQUIRED for frontend to show error styling
                        (column as any).includeError = true;
                        // Create error task so user knows what's wrong
                        column.tasks = [{
                            id: `error-${column.id}-${Date.now()}`,
                            title: 'Include Error',
                            description: `**Error:** Column include file not found: \`${relativePath}\``,
                            includeError: true
                        }];
                    }
                }
            }

            // Check task includes
            for (const task of column.tasks || []) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const absolutePath = path.isAbsolute(relativePath)
                            ? relativePath
                            : path.resolve(basePath, relativePath);

                        const fileExists = fs.existsSync(absolutePath);
                        console.log(`[KanbanFileService] Initial load include check: task=${task.id}, relativePath=${relativePath}, absolutePath=${absolutePath}, exists=${fileExists}`);

                        if (!fileExists) {
                            (task as any).includeMode = true;  // REQUIRED for frontend to show error styling
                            (task as any).includeError = true;
                            task.description = `**Error:** Include file not found: \`${relativePath}\``;
                        }
                    }
                }
            }
        }
    }

}
