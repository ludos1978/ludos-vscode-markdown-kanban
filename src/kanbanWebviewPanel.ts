import * as vscode from 'vscode';
import * as path from 'path';

import { KanbanBoard } from './markdownParser';
import { FileManager } from './fileManager';
import { BoardOperations } from './board';
import { LinkHandler } from './services/LinkHandler';
import { MessageHandler } from './messageHandler';
import { BackupManager } from './services/BackupManager';
import { ConflictResolver, ConflictContext, ConflictResolution } from './services/ConflictResolver';
import { SaveEventDispatcher } from './SaveEventDispatcher';
import { KanbanFileService, KanbanFileServiceCallbacks } from './kanbanFileService';
import { MediaTracker } from './services/MediaTracker';
import { getErrorMessage } from './utils/stringUtils';
import {
    MarkdownFileRegistry,
    FileFactory
} from './files';
import { ChangeStateMachine } from './core/ChangeStateMachine';
import { BoardStore } from './core/stores';
import { WebviewBridge } from './core/bridge';
import { BoardSyncHandler, FileSyncHandler, LinkReplacementHandler, BoardInitializationHandler, FileRegistryChangeHandler, eventBus, createEvent, BoardChangeTrigger } from './core/events';
import { UnsavedChangesService } from './services/UnsavedChangesService';
import { WebviewUpdateService } from './services/WebviewUpdateService';
import { TriggerSnippetMessage } from './core/bridge/MessageTypes';
import { PanelContext, ConcurrencyManager, IncludeFileCoordinator, WebviewManager, HandlerRegistry } from './panel';
import {
    REVIVAL_TRACKING_CLEAR_DELAY_MS,
    MAX_UNDO_STACK_SIZE,
    MAX_BATCH_SIZE,
    BATCH_FLUSH_DELAY_MS
} from './constants/TimeoutConstants';

/**
 * Persisted panel state for revival
 */
interface PersistedPanelState {
    documentUri: string;
    lastAccessed: number;
}

export class KanbanWebviewPanel {
    private static panels: Map<string, KanbanWebviewPanel> = new Map();
    private static panelStates: Map<string, PersistedPanelState> = new Map();

    public static readonly viewType = 'markdownKanbanPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _extensionContext: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    // Main components
    private _fileManager: FileManager;
    private _boardOperations: BoardOperations;
    private _linkHandler: LinkHandler;
    private _messageHandler: MessageHandler;

    private _backupManager: BackupManager;
    private _fileService: KanbanFileService;

    // File abstraction system
    private _fileRegistry: MarkdownFileRegistry;
    private _fileFactory: FileFactory;

    private _stateMachine: ChangeStateMachine;

    // Panel architecture components (Phase 1, 2 & 3)
    private _context: PanelContext;  // Unified state: panel flags + document tracking
    private _concurrency: ConcurrencyManager;
    private _includeCoordinator: IncludeFileCoordinator;
    private _webviewManager: WebviewManager;

    // Public getter for backwards compatibility with external code
    public get _isUpdatingFromPanel(): boolean { return this._context.updatingFromPanel; }
    public set _isUpdatingFromPanel(value: boolean) { this._context.setUpdatingFromPanel(value); }

    private _conflictResolver: ConflictResolver;

    // Media file change tracking (diagrams, images, audio, video)
    private _mediaTracker: MediaTracker | null = null;

    private _boardStore: BoardStore;
    private _webviewBridge: WebviewBridge;

    // Handler registry manages all event handlers and services
    private _handlerRegistry: HandlerRegistry;

    // Public getter for webview to allow proper access from messageHandler
    public get webview(): vscode.Webview {
        return this._panel.webview;
    }

    // Method to force refresh webview content (useful during development)
    public async refreshWebviewContent() {
        const board = this.getBoard();
        if (this._panel && board) {
            // Reset webviewReady since HTML reload will create new webview context
            this._context.setWebviewReady(false);

            this._panel.webview.html = this._webviewManager.generateHtml();

            // Queue board update - will be sent when webview sends 'webviewReady'
            this.sendBoardUpdate(false, true);
        }
    }

    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext, document?: vscode.TextDocument) {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

        // Check if a panel already exists for this document
        if (document) {
            const existingPanel = KanbanWebviewPanel.panels.get(document.uri.toString());
            if (existingPanel && existingPanel._panel) {
                // Panel exists, just reveal it
                existingPanel._panel.reveal(column);
                
                // Update the file info to ensure context is maintained
                existingPanel._fileManager.sendFileInfo();
                
                // Ensure the board is up to date
                existingPanel.loadMarkdownFile(document);
                return;
            }
        }

        // Create a new panel
        const localResourceRoots = [extensionUri];
        
        // Add all workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            workspaceFolders.forEach(folder => {
                localResourceRoots.push(folder.uri);
            });
        }
        
        // Add document directory if it's outside workspace folders
        if (document) {
            const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
            const isInWorkspace = workspaceFolders?.some(folder => 
                documentDir.fsPath.startsWith(folder.uri.fsPath)
            );
            
            if (!isInWorkspace) {
                localResourceRoots.push(documentDir);
            }
        }
        
        // Create panel with file-specific title
        const fileName = document ? path.basename(document.fileName) : 'Markdown Kanban';
        const panel = vscode.window.createWebviewPanel(
            KanbanWebviewPanel.viewType,
            `Kanban: ${fileName}`,
            column,
            {
                enableScripts: true,
                localResourceRoots: localResourceRoots,
                retainContextWhenHidden: true,
                enableCommandUris: true
            }
        );

        const kanbanPanel = new KanbanWebviewPanel(panel, extensionUri, context);

        // Store the panel in the map and load document
        if (document) {
            const docUri = document.uri.toString();
            kanbanPanel._context.setTrackedDocumentUri(docUri);  // Track the URI for cleanup
            KanbanWebviewPanel.panels.set(docUri, kanbanPanel);
            // Load immediately - webview will request data when ready
            kanbanPanel.loadMarkdownFile(document);
        }
    }

    // Static set to track document URIs being revived to prevent duplicates
    private static _revivedUris: Set<string> = new Set();

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext, state?: any) {
        // ENHANCED: Set comprehensive permissions on revive
        const localResourceRoots = [extensionUri];

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            workspaceFolders.forEach(folder => {
                localResourceRoots.push(folder.uri);
            });
        }
        
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots,
        };

        const kanbanPanel = new KanbanWebviewPanel(panel, extensionUri, context);

        // Try to restore the previously loaded document from state
        // First check the serializer state parameter, then check workspace state for recent panels
        let documentUri = state?.documentUri;

        if (!documentUri) {
            // Fallback: Look for panel states in workspace that haven't been revived yet
            const allKeys = context.globalState.keys();
            // Look for both old kanban_panel_* keys and new kanban_doc_* keys
            const panelKeys = allKeys.filter(key => key.startsWith('kanban_panel_') || key.startsWith('kanban_doc_'));

            if (panelKeys.length > 0) {
                // Find available panel states, prioritizing recent ones
                const availableStates: Array<{ uri: string; time: number }> = [];

                for (const key of panelKeys) {
                    const panelState = context.globalState.get<PersistedPanelState>(key);
                    if (panelState?.documentUri && !KanbanWebviewPanel._revivedUris.has(panelState.documentUri)) {
                        availableStates.push({
                            uri: panelState.documentUri,
                            time: panelState.lastAccessed || 0
                        });
                    }
                }

                // Sort by most recent and use the first available
                if (availableStates.length > 0) {
                    availableStates.sort((a, b) => b.time - a.time);
                    documentUri = availableStates[0].uri;
                    // Mark this URI as revived to prevent other panels from using it
                    KanbanWebviewPanel._revivedUris.add(documentUri);

                    // Clear the revival tracking after a short delay (panels should be revived quickly)
                    setTimeout(() => {
                        KanbanWebviewPanel._revivedUris.clear();
                    }, REVIVAL_TRACKING_CLEAR_DELAY_MS);
                }
            }
        } else {
            // State was provided by webview serialization - this is the preferred path
            // Mark as revived to prevent fallback logic from using it
            KanbanWebviewPanel._revivedUris.add(documentUri);
        }

        if (documentUri) {
            // CRITICAL: Use async IIFE to properly handle promise rejections
            // The revive() method is not async, so we need to handle errors ourselves
            (async () => {
                try {
                    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
                    await kanbanPanel.loadMarkdownFile(document);
                } catch (error) {
                    // This catches both openTextDocument failures (file not found) and loadMarkdownFile failures
                    console.warn('[Panel Revive] Failed to load document:', documentUri, error);
                    // Fallback: try to find an active markdown document
                    kanbanPanel.tryAutoLoadActiveMarkdown();
                }
            })();
        } else {
            // No state available, try to auto-load active markdown document
            kanbanPanel.tryAutoLoadActiveMarkdown();
        }
        // Don't store in map yet - will be stored when document is loaded
    }

    // Add this method to get a panel by document URI:
    public static getPanelForDocument(documentUri: string): KanbanWebviewPanel | undefined {
        return KanbanWebviewPanel.panels.get(documentUri);
    }

    // Add this method to get all panels:
    public static getAllPanels(): KanbanWebviewPanel[] {
        return Array.from(KanbanWebviewPanel.panels.values());
    }

    public getPanelId(): string {
        return this._context.panelId;
    }

    public getPanel(): vscode.WebviewPanel {
        return this._panel;
    }

    public hasUnsavedChanges(): boolean {
        // Query main file for unsaved changes (single source of truth)
        const mainFile = this._fileRegistry.getMainFile();
        return mainFile?.hasUnsavedChanges() || false;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._extensionContext = context;

        // Initialize panel architecture components (Phase 1)
        const isDevelopment = !context.extensionMode || context.extensionMode === vscode.ExtensionMode.Development;
        this._context = new PanelContext(undefined, isDevelopment);  // Unified state model
        this._concurrency = new ConcurrencyManager(isDevelopment);

        this._boardStore = new BoardStore({
            webview: this._panel.webview,
            maxUndoStackSize: MAX_UNDO_STACK_SIZE
        });

        this._webviewBridge = new WebviewBridge({
            maxBatchSize: MAX_BATCH_SIZE,
            batchFlushDelay: BATCH_FLUSH_DELAY_MS,
            debug: isDevelopment
        });
        this._webviewBridge.setWebview(this._panel.webview);

        this._fileManager = new FileManager(this._panel.webview, extensionUri);
        this._boardOperations = new BoardOperations();
        this._backupManager = new BackupManager();

        // Get the conflict resolver instance
        this._conflictResolver = ConflictResolver.getInstance();

        // Initialize file abstraction system
        this._fileRegistry = new MarkdownFileRegistry();
        this._fileFactory = new FileFactory(
            this._fileManager,
            this._conflictResolver,
            this._backupManager,
            this._fileRegistry
        );

        // Initialize unified change state machine (Phase 6)
        // Create panel-specific state machine instance (NOT singleton)
        // Each panel needs its own instance to prevent cross-panel data contamination
        this._stateMachine = new ChangeStateMachine(this._fileRegistry, this);

        // Initialize include file coordinator (Phase 2)
        this._includeCoordinator = new IncludeFileCoordinator({
            fileRegistry: this._fileRegistry,
            fileFactory: this._fileFactory,
            webviewBridge: this._webviewBridge,
            stateMachine: this._stateMachine,
            state: this._context,
            getPanel: () => this._panel,
            getBoard: () => this.getBoard(),
            getMainFile: () => this._fileRegistry.getMainFile()
        });

        // Initialize webview manager (Phase 3)
        this._webviewManager = new WebviewManager({
            extensionUri: this._extensionUri,
            extensionContext: this._extensionContext,
            getPanel: () => this._panel,
            getDocument: () => this._fileManager.getDocument(),
            getBoard: () => this.getBoard(),
            isInitialized: () => this._context.initialized
        });

        // Initialize handler registry
        this._handlerRegistry = new HandlerRegistry();

        // Initialize FileRegistryChangeHandler (extracted file registry change logic)
        this._handlerRegistry.registerFileRegistryChange(new FileRegistryChangeHandler({
            fileRegistry: this._fileRegistry,
            boardStore: this._boardStore,
            panelContext: this._context,
            concurrencyManager: this._concurrency,
            includeCoordinator: this._includeCoordinator,
            getBoard: () => this.getBoard(),
            invalidateBoardCache: () => this.invalidateBoardCache(),
            sendBoardUpdate: (applyDefaultFolding, isFullRefresh) => this.sendBoardUpdate(applyDefaultFolding, isFullRefresh)
        }));

        // Initialize KanbanFileService with grouped callbacks
        const fileServiceCallbacks: KanbanFileServiceCallbacks = {
            getBoard: () => this.getBoard(),
            setBoard: (board) => this._boardStore.setBoard(board, false),
            sendBoardUpdate: (applyDefaultFolding, isFullRefresh) => this.sendBoardUpdate(applyDefaultFolding, isFullRefresh),
            getPanel: () => this._panel,
            getContext: () => this._extensionContext,
            showConflictDialog: (context) => this.showConflictDialog(context),
            updateWebviewPermissions: () => this._webviewManager.updatePermissions(),
            clearUndoRedo: () => this._boardStore.clearHistory(),
            getPanelInstance: () => this
        };

        this._fileService = new KanbanFileService(
            this._fileManager,
            this._fileRegistry,
            this._fileFactory,
            this._backupManager,
            this._boardOperations,
            fileServiceCallbacks,
            this._context,  // Shared panel context
            KanbanWebviewPanel.panelStates,
            KanbanWebviewPanel.panels
        );

        // Initialize LinkHandler (now uses event-driven approach, no callback needed)
        this._linkHandler = new LinkHandler(
            this._fileManager,
            this._panel.webview
        );

        // Set up document change listener to track external unsaved modifications
        this.setupDocumentChangeListener();

        // Initialize message handler with callbacks
        this._messageHandler = new MessageHandler(
            this._fileManager,
            this._boardStore,
            this._boardOperations,
            this._linkHandler,
            {
                onBoardUpdate: this.sendBoardUpdate.bind(this),
                onSaveToMarkdown: this.saveToMarkdown.bind(this),
                onInitializeFile: this.initializeFile.bind(this),
                getCurrentBoard: () => this.getBoard(),
                setBoard: (board: KanbanBoard) => {
                    this._boardStore.setBoard(board, true);
                },
                setUndoRedoOperation: (isOperation: boolean) => {
                    this._context.setUndoRedoOperation(isOperation);
                },
                getWebviewPanel: () => this,
                getWebviewBridge: () => this._webviewBridge,
                emitBoardChanged: (board: KanbanBoard, trigger?: BoardChangeTrigger) => this.emitBoardChanged(board, trigger)
            }
        );

        // Connect message handler to file registry (for stopping edit mode during conflicts)
        this._fileRegistry.setMessageHandler(this._messageHandler);

        // Note: No initializeState() call needed - PanelContext is shared directly

        this._initialize();
        this._setupEventListeners();

        // ENHANCED: Listen for workspace folder changes
        this._setupWorkspaceChangeListener();

        // Listen for document close events
        this._setupDocumentCloseListener();

        // Initialize event-driven board sync handler
        this._handlerRegistry.registerBoardSync(new BoardSyncHandler({
            boardStore: this._boardStore,
            fileRegistry: this._fileRegistry,
            getMediaTracker: () => this._mediaTracker,
            backupManager: this._backupManager,
            getDocument: () => this._fileManager.getDocument()
        }));

        // Initialize file sync handler (handles focus:gained and unified sync)
        this._handlerRegistry.registerFileSync(new FileSyncHandler({
            fileRegistry: this._fileRegistry,
            boardStore: this._boardStore,
            getMediaTracker: () => this._mediaTracker,
            getWebviewBridge: () => this._webviewBridge,
            getBoard: () => this.getBoard(),
            panelContext: this._context,
            sendBoardUpdate: (isFullRefresh, applyDefaultFolding) =>
                this.sendBoardUpdate(isFullRefresh, applyDefaultFolding),
            emitBoardLoaded: (board) => this.emitBoardLoaded(board)
        }));

        // Initialize LinkReplacementHandler (event-driven link replacement)
        this._handlerRegistry.registerLinkReplacement(new LinkReplacementHandler({
            boardStore: this._boardStore,
            fileRegistry: this._fileRegistry,
            webviewBridge: this._webviewBridge,
            getBoard: () => this.getBoard()
        }));

        // Initialize UnsavedChangesService (extracted unsaved changes logic)
        this._handlerRegistry.registerUnsavedChanges(new UnsavedChangesService(this._fileRegistry));

        // Initialize WebviewUpdateService (extracted webview update logic)
        this._handlerRegistry.registerWebviewUpdate(new WebviewUpdateService({
            boardStore: this._boardStore,
            webviewBridge: this._webviewBridge,
            fileRegistry: this._fileRegistry,
            webviewManager: this._webviewManager,
            panelContext: this._context,
            getBoard: () => this.getBoard(),
            hasPanel: () => !!this._panel
        }));

        // Initialize BoardInitializationHandler (extracted board init logic)
        this._handlerRegistry.registerBoardInit(new BoardInitializationHandler({
            fileRegistry: this._fileRegistry,
            fileFactory: this._fileFactory,
            includeCoordinator: this._includeCoordinator,
            panelContext: this._context,
            getFileSyncHandler: () => this._handlerRegistry.getFileSync(),
            getBoard: () => this.getBoard(),
            getPanel: () => this._panel,
            onMediaChanged: (changedFiles) => {
                // Send changed file paths to frontend for selective re-rendering
                if (this._panel) {
                    this._panel.webview.postMessage({
                        type: 'mediaFilesChanged',
                        changedFiles: changedFiles.map(f => ({
                            path: f.path,
                            absolutePath: f.absolutePath,
                            type: f.type
                        }))
                    });
                }
            }
        }));

        // Document will be loaded via loadMarkdownFile call from createOrShow
    }

    /**
     * Setup listener for document close events to handle graceful degradation
     */
    private _setupDocumentCloseListener() {
        // Listen for document close events
        const documentCloseListener = vscode.workspace.onDidCloseTextDocument(async (document) => {
            const currentDocument = this._fileManager.getDocument();

            if (currentDocument && currentDocument.uri.toString() === document.uri.toString()) {
                // DO NOT close the panel when the document is closed!
                // The kanban should stay open and functional
                // Clear document reference but keep file path for display
                this._fileManager.clearDocument();
                this._fileManager.sendFileInfo();
            }
        });

        this._disposables.push(documentCloseListener);
    }

    /**
     * Setup listener for workspace folder changes to update webview permissions
     */
    private _setupWorkspaceChangeListener() {
        // Listen for workspace folder changes
        const workspaceChangeListener = vscode.workspace.onDidChangeWorkspaceFolders(_event => {
                this._webviewManager.updatePermissions();
        });
        
        this._disposables.push(workspaceChangeListener);
    }

    // Public methods for external access
    public isFileLocked(): boolean {
        return this._fileManager.isFileLocked();
    }

    public toggleFileLock(): void {
        this._fileManager.toggleFileLock();
    }

    public getCurrentDocumentUri(): vscode.Uri | undefined {
        return this._fileManager.getCurrentDocumentUri();
    }

    private _initialize() {
        if (!this._context.initialized) {
            // CRITICAL: Reset webviewReady before setting new HTML
            // During panel revival, VS Code's cached webview may have already sent webviewReady
            // before we replace the HTML. This ensures we wait for the NEW webview's ready message.
            this._context.setWebviewReady(false);
            this._panel.webview.html = this._webviewManager.generateHtml();
            this._context.setInitialized(true);
        }
    }

    /**
     * Restore panel state from file service
     * Called after any file service operation to keep states in sync
     */
    private _restoreStateFromFileService(): void {
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // STATE-2: Cache board if available
        if (state.cachedBoardFromWebview) {
            this._boardStore.setBoard(state.cachedBoardFromWebview, false);
        }
        // Document state fields are now in shared PanelContext - no sync needed
    }

    private _setupEventListeners() {
        // Handle panel disposal - check for unsaved changes first
        this._panel.onDidDispose(async () => {
            await this._handlePanelClose();
        }, null, this._disposables);

        // View state change handler
        this._panel.onDidChangeViewState(
            async e => {
                if (e.webviewPanel.visible) {
                    console.log('[Focus] Panel became visible');

                    // Panel became visible - send file info
                    this._fileManager.sendFileInfo();

                    // Sync any pending DOM updates (items with unrendered changes)
                    this.syncDirtyItems();

                    // ⚠️ REFRESH ALL CONFIGURATION when view gains focus
                    // This ensures settings (shortcuts, tag colors, layout, etc.) are always up-to-date
                    await this.refreshConfiguration();

                    // Emit focus:gained event - FileSyncHandler handles both include and media file checks
                    // This is the unified code path for external change detection
                    eventBus.emitSync(createEvent('focus:gained', 'KanbanWebviewPanel'));

                    // Only ensure board content is sent in specific cases to avoid unnecessary re-renders
                    if (this._fileManager.getDocument()) {
                        const hasBoard = !!this.getBoard();
                        const isInitialized = this._context.initialized;
                        console.log(`[Focus] Board check: hasBoard=${hasBoard}, initialized=${isInitialized}`);

                        if (!hasBoard || !isInitialized) {
                            console.log('[Focus] ⚠️ TRIGGERING _ensureBoardAndSendUpdate');
                            this._ensureBoardAndSendUpdate();
                        }
                    }
                }
                // Note: Unsaved changes are now handled via page visibility events in webview.js
            },
            null,
            this._disposables
        );

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                // Handle webviewReady at panel level - controls when board updates are sent
                if (message.type === 'webviewReady') {
                    this._handleWebviewReady();
                    return;
                }

                try {
                    await this._messageHandler.handleMessage(message);
                } catch (error) {
                    console.error(`[PANEL] Error handling message ${message.type}:`, error);
                    if (error instanceof Error) {
                        console.error('[PANEL] Stack trace:', error.stack);
                    }
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Handle webviewReady message - webview is ready to receive board updates
     */
    private _handleWebviewReady(): void {
        // CRITICAL FIX: Detect if webview was silently recreated by VS Code
        // If webviewReady is already true, VS Code recreated the webview (memory pressure, etc.)
        // Any messages sent while we thought the webview was ready were lost!
        const wasAlreadyReady = this._context.webviewReady;

        this._context.setWebviewReady(true);

        // Send any pending board update (consume and clear atomically)
        const pendingUpdate = this._context.consumePendingBoardUpdate();
        if (pendingUpdate) {
            this.sendBoardUpdate(pendingUpdate.applyDefaultFolding, pendingUpdate.isFullRefresh);
        } else if (wasAlreadyReady) {
            // Webview was recreated by VS Code - ALL messages sent since last webviewReady were lost!
            // Re-send EVERYTHING the webview needs:

            // CRITICAL: Only re-send if we actually have a board to send
            // During panel revival, the board hasn't been loaded yet - initialization will handle it
            // Also skip during initialBoardLoad - that code path will send the board update
            const board = this.getBoard();
            if (!board || !board.valid || this._context.initialBoardLoad) {
                // No board yet or initialization in progress - skip, initialization will send it
                return;
            }

            // 1. File info (filename, path, locked status)
            this._fileManager.sendFileInfo();

            // 2. Full board update (includes _refreshAllViewConfiguration internally)
            this.sendBoardUpdate(false, true);

            // 3. Undo/redo status - CRITICAL: webview's canUndo/canRedo variables reset to false on recreation
            this._boardStore.resendUndoRedoStatus();
        }
    }

    private async _ensureBoardAndSendUpdate() {
        await this._fileService.ensureBoardAndSendUpdate();
        this._restoreStateFromFileService();
    }

    public async loadMarkdownFile(document: vscode.TextDocument, forceReload: boolean = false) {
        // RACE-4: Wrap entire operation with lock to prevent concurrent file loads
        return this._concurrency.withLock('loadMarkdownFile', async () => {
            // CRITICAL: Set initial board load flag BEFORE loading main file
            // This prevents the main file's 'reloaded' event from triggering board regeneration
            this._context.setInitialBoardLoad(true);

            await this._fileService.loadMarkdownFile(document, forceReload);
            this._restoreStateFromFileService();

            // Phase 1: Create or update MainKanbanFile instance
            await this._initializeBoardFromDocument(document);
        });
    }

    // Delegate to WebviewUpdateService
    private async sendBoardUpdate(applyDefaultFolding: boolean = false, isFullRefresh: boolean = false) {
        const webviewUpdate = this._handlerRegistry.getWebviewUpdate();
        if (webviewUpdate) {
            await webviewUpdate.sendBoardUpdate({ applyDefaultFolding, isFullRefresh });
        }
    }

    public async saveToMarkdown(updateVersionTracking: boolean = true, triggerSave: boolean = true) {
        await this._fileService.saveToMarkdown(updateVersionTracking, triggerSave);
        this._restoreStateFromFileService();
    }

    private async initializeFile() {
        await this._fileService.initializeFile();
        this._restoreStateFromFileService();
    }

    /**
     * Initialize board from document - delegates to BoardInitializationHandler
     */
    private async _initializeBoardFromDocument(document: vscode.TextDocument): Promise<void> {
        const boardInit = this._handlerRegistry.getBoardInit();
        if (!boardInit) {
            console.error('[KanbanWebviewPanel] BoardInitializationHandler not initialized');
            return;
        }

        const result = await boardInit.initializeFromDocument(
            document,
            this._mediaTracker
        );

        // Store the returned MediaTracker
        this._mediaTracker = result.mediaTracker;
    }

    /**
     * Set editing in progress flag to block board regenerations
     */
    public setEditingInProgress(isEditing: boolean): void {
        this._context.setEditingInProgress(isEditing);
    }

    /**
     * Mark a column as having unrendered changes (cache updated, DOM not synced)
     */
    public markColumnDirty(columnId: string): void {
        this._boardStore.markColumnDirty(columnId);
    }

    /**
     * Mark a task as having unrendered changes (cache updated, DOM not synced)
     */
    public markTaskDirty(taskId: string): void {
        this._boardStore.markTaskDirty(taskId);
    }

    /**
     * Clear dirty flag for a column (render completed successfully)
     */
    public clearColumnDirty(columnId: string): void {
        this._boardStore.clearColumnDirty(columnId);
    }

    /**
     * Clear dirty flag for a task (render completed successfully)
     */
    public clearTaskDirty(taskId: string): void {
        this._boardStore.clearTaskDirty(taskId);
    }

    /**
     * Sync dirty items to frontend - delegates to WebviewUpdateService
     */
    public syncDirtyItems(): void {
        const webviewUpdate = this._handlerRegistry.getWebviewUpdate();
        if (webviewUpdate) {
            webviewUpdate.syncDirtyItems();
        }
    }

    /**
     * Handle include file switch triggered by user edit (column/task title)
     * Delegates to IncludeFileCoordinator
     */
    public async handleIncludeSwitch(params: {
        columnId?: string;
        taskId?: string;
        oldFiles: string[];
        newFiles: string[];
        newTitle?: string;
        preloadedContent?: Map<string, string>;
    }): Promise<void> {
        return this._includeCoordinator.handleIncludeSwitch(params);
    }

    /**
     * Refresh configuration - delegates to WebviewUpdateService
     */
    public async refreshConfiguration(): Promise<void> {
        const webviewUpdate = this._handlerRegistry.getWebviewUpdate();
        if (webviewUpdate) {
            await webviewUpdate.refreshAllConfiguration();
        }
    }

    /**
     * Get board (single source of truth)
     *
     * Returns cached board if valid, otherwise generates fresh board from registry.
     *
     * @returns KanbanBoard with all include content, or undefined if not ready
     */
    public getBoard(): KanbanBoard | undefined {
        if (this._boardStore.isCacheValid()) {
            const cachedBoard = this._boardStore.getBoard();
            if (cachedBoard) {
                return cachedBoard;
            }
        }

        // Generate fresh board from registry
        // CRITICAL FIX: Pass existing cached board to preserve column/task IDs
        // This prevents "Column not found" errors when cache is invalidated
        const existingBoard = this._boardStore.getBoard();
        const board = this._fileRegistry.generateBoard(existingBoard || undefined);

        // Cache the result
        if (board) {
            this._boardStore.setBoard(board, false); // Don't emit event here - we're just caching
        }

        return board;
    }

    /**
     * Emit board:changed event to sync board state
     *
     * Emits an event that BoardSyncHandler handles.
     * This handles: board store update, include file sync, markdown generation,
     * media tracking, and backup creation.
     *
     * @param board - The board state that changed
     * @param trigger - What caused the change (edit, undo, redo, template, etc.)
     */
    public emitBoardChanged(board: KanbanBoard, trigger: BoardChangeTrigger = 'edit'): void {
        eventBus.emitSync(createEvent('board:changed', 'KanbanWebviewPanel', {
            board,
            trigger
        }));
    }

    /**
     * Emit board:loaded event after initial board load completes
     * This triggers media tracking updates for include files
     */
    public emitBoardLoaded(board: KanbanBoard): void {
        eventBus.emitSync(createEvent('board:loaded', 'KanbanWebviewPanel', {
            board
        }));
    }

    /**
     * STATE-2: Invalidate board cache
     *
     * Call this whenever registry files change to force fresh board generation on next access.
     * Examples: file reload, content change, include switch, etc.
     *
     * CRITICAL: Blocked during include switches to prevent ID regeneration
     */
    public invalidateBoardCache(): void {
        // CRITICAL FIX: Block invalidation during include switches
        // This prevents column/task IDs from regenerating mid-switch
        if (this._context.includeSwitchInProgress) {
            return;
        }

        this._boardStore.invalidateCache();
    }

    /**
     * Set include switch in-progress flag
     *
     * When true, blocks cache invalidation to prevent ID regeneration during include switches.
     * State machine sets this to true at start of LOAD state, false at COMPLETE.
     */
    public setIncludeSwitchInProgress(inProgress: boolean): void {
        this._context.setIncludeSwitchInProgress(inProgress);
    }

    private async _handlePanelClose() {
        // CRITICAL: Remove from panels map IMMEDIATELY to prevent reuse during disposal
        const trackedUri = this._context.trackedDocumentUri;
        if (trackedUri && KanbanWebviewPanel.panels.get(trackedUri) === this) {
            KanbanWebviewPanel.panels.delete(trackedUri);
        }
        for (const [uri, panel] of KanbanWebviewPanel.panels.entries()) {
            if (panel === this) {
                KanbanWebviewPanel.panels.delete(uri);
            }
        }

        const unsavedChanges = this._handlerRegistry.getUnsavedChanges();
        if (!unsavedChanges) {
            this.dispose();
            return;
        }

        const unsavedInfo = unsavedChanges.checkForUnsavedChanges();
        if (!unsavedInfo.hasMainFileChanges && !unsavedInfo.hasIncludeFileChanges) {
            this.dispose();
            return;
        }

        const choice = await unsavedChanges.showUnsavedChangesDialog(unsavedInfo);

        switch (choice) {
            case 'save':
                try {
                    await this.saveToMarkdown(true, true);
                } catch (error) {
                    console.error('[PanelClose] Save failed:', error);
                    vscode.window.showErrorMessage(`Failed to save: ${getErrorMessage(error)}`);
                }
                this.dispose();
                break;

            case 'discard':
                unsavedChanges.discardAllChanges();
                this.dispose();
                break;

            case 'cancel':
            default:
                console.warn('[PanelClose] User cancelled, but panel already disposed');
                unsavedChanges.discardAllChanges();
                this.dispose();
                break;
        }
    }

    private tryAutoLoadActiveMarkdown() {
        // Only auto-load the currently active markdown document in the editor
        // Don't auto-load random open markdown files (caused wrong files to load on revival)
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.languageId === 'markdown') {
            this.loadMarkdownFile(activeEditor.document);
        }
        // If no active markdown editor, panel remains empty - user can manually select a file
    }

    /**
     * Check if this panel has unsaved changes
     * Used by extension deactivate() to prompt before VSCode closes
     */
    public async checkUnsavedChanges(): Promise<boolean> {
        return this._fileRegistry.hasAnyUnsavedChanges();
    }

    /**
     * Save unsaved changes to backup files
     */
    public async saveUnsavedChangesBackup(): Promise<void> {
        const unsavedChanges = this._handlerRegistry.getUnsavedChanges();
        if (unsavedChanges) {
            await unsavedChanges.saveBackups(this.getCurrentDocumentUri());
        }
    }

    public async dispose() {
        // Prevent double disposal
        if (this._context.disposed) {
            return;
        }
        this._context.setDisposed(true);

        // Remove from panels map
        const trackedUri = this._context.trackedDocumentUri;
        if (trackedUri && KanbanWebviewPanel.panels.get(trackedUri) === this) {
            KanbanWebviewPanel.panels.delete(trackedUri);
        }
        for (const [uri, panel] of KanbanWebviewPanel.panels.entries()) {
            if (panel === this) {
                KanbanWebviewPanel.panels.delete(uri);
            }
        }

        // Clear unsaved changes flag
        const mainFile = this._fileRegistry.getMainFile();
        if (mainFile) {
            mainFile.discardChanges();
        }
        this._context.setClosingPrevented(false);

        // Dispose core components
        this._webviewBridge.dispose();
        KanbanWebviewPanel.panelStates.delete(this._context.panelId);
        this._concurrency.dispose();

        // Unregister from SaveEventDispatcher
        const document = this._fileManager.getDocument();
        if (document) {
            SaveEventDispatcher.getInstance().unregisterHandler(`panel-${document.uri.fsPath}`);
        }

        // Dispose managers
        this._backupManager.dispose();
        if (this._mediaTracker) {
            this._mediaTracker.dispose();
            this._mediaTracker = null;
        }

        // Dispose all handlers via registry
        this._handlerRegistry.dispose();

        // Dispose remaining resources
        this._fileRegistry.dispose();
        this._boardStore.dispose();
        this._panel.dispose();

        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    public get backupManager(): BackupManager {
        return this._backupManager;
    }

    public get fileRegistry(): MarkdownFileRegistry {
        return this._fileRegistry;
    }

    public get fileFactory(): FileFactory {
        return this._fileFactory;
    }

    /**
     * Setup document change listener to track external modifications
     */
    private setupDocumentChangeListener(): void {
        this._fileService.setupDocumentChangeListener(this._disposables);
    }

    /**
     * Ensure an include file is registered in the unified system for conflict resolution
     */
    public ensureIncludeFileRegistered(relativePath: string, type: 'regular' | 'column' | 'task'): void {
        this._fileRegistry.ensureIncludeFileRegistered(relativePath, type, this._fileFactory);
    }

    /**
     * Show conflict dialog to user
     */
    public async showConflictDialog(context: ConflictContext): Promise<ConflictResolution> {
        // Use ConflictResolver to handle the dialog
        return await this._conflictResolver.resolveConflict(context);
    }

    /**
     * Trigger snippet insertion in the webview
     */
    public triggerSnippetInsertion(): void {
        if (this._panel) {
            const snippetMessage: TriggerSnippetMessage = {
                type: 'triggerSnippet'
            };
            this._webviewBridge.send(snippetMessage);
        }
    }
}
