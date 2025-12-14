import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { getOutputChannel } from './extension';
import { MarkdownKanbanParser, KanbanBoard, KanbanColumn, KanbanTask } from './markdownParser';
import { FileManager } from './fileManager';
import { BoardOperations } from './board';
import { LinkHandler } from './services/LinkHandler';
import { MessageHandler } from './messageHandler';
import { BackupManager } from './services/BackupManager';
import { ConflictResolver, ConflictContext, ConflictResolution } from './services/ConflictResolver';
import { configService } from './services/ConfigurationService';
import { SaveEventDispatcher } from './SaveEventDispatcher';
import { KanbanFileService, KanbanFileServiceCallbacks } from './kanbanFileService';
import { LinkOperations } from './utils/linkOperations';
import { getErrorMessage } from './utils/stringUtils';
import {
    MarkdownFileRegistry,
    FileFactory,
    FileChangeEvent,
    MarkdownFile
} from './files';
import { ChangeStateMachine } from './core/ChangeStateMachine';
import { PanelEventBus, createLoggingMiddleware } from './core/events';
import { BoardStore } from './core/stores';
import { WebviewBridge } from './core/bridge';
import { PanelStateModel, DocumentStateModel, ConcurrencyManager, IncludeFileCoordinator, WebviewManager } from './panel';
import { KeybindingService } from './services/KeybindingService';

export class KanbanWebviewPanel {
    private static panels: Map<string, KanbanWebviewPanel> = new Map();
    private static panelStates: Map<string, any> = new Map();

    public static readonly viewType = 'markdownKanbanPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _context: vscode.ExtensionContext;
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
    private _state: PanelStateModel;
    private _documentState: DocumentStateModel;  // Single source of truth for document state
    private _concurrency: ConcurrencyManager;
    private _includeCoordinator: IncludeFileCoordinator;
    private _webviewManager: WebviewManager;

    // Public getter for backwards compatibility with external code
    public get _isUpdatingFromPanel(): boolean { return this._state.updatingFromPanel; }
    public set _isUpdatingFromPanel(value: boolean) { this._state.setUpdatingFromPanel(value); }

    // Timer for periodic unsaved changes check (lifecycle concern, not state)
    private _unsavedChangesCheckInterval?: NodeJS.Timeout;

    private _conflictResolver: ConflictResolver;

    private _eventBus: PanelEventBus;

    private _boardStore: BoardStore;
    private _webviewBridge: WebviewBridge;

    // Public getter for webview to allow proper access from messageHandler
    public get webview(): vscode.Webview {
        return this._panel.webview;
    }

    // Method to force refresh webview content (useful during development)
    public async refreshWebviewContent() {
        const board = this.getBoard();
        if (this._panel && board) {
            // Reset webviewReady since HTML reload will create new webview context
            this._state.setWebviewReady(false);

            this._panel.webview.html = this._getHtmlForWebview();

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
            kanbanPanel._documentState.setTrackedDocumentUri(docUri);  // Track the URI for cleanup
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
                    const panelState = context.globalState.get(key) as any;
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
                    }, 5000);
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
        return this._documentState.panelId;
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
        this._context = context;

        // Initialize panel architecture components (Phase 1)
        const isDevelopment = !context.extensionMode || context.extensionMode === vscode.ExtensionMode.Development;
        this._state = new PanelStateModel(isDevelopment);
        this._documentState = new DocumentStateModel(undefined, isDevelopment);  // Single source of truth
        this._concurrency = new ConcurrencyManager(isDevelopment);

        this._eventBus = new PanelEventBus({
            enableTracing: true, // Enable during development for debugging
            defaultTimeout: 5000
        });

        // Add logging middleware in development mode
        if (isDevelopment) {
            this._eventBus.use(createLoggingMiddleware({
                excludeTypes: ['debug:event_slow', 'debug:handler_error'],
                logger: (msg) => getOutputChannel()?.appendLine(msg)
            }));
        }

        this._boardStore = new BoardStore(this._eventBus, {
            webview: this._panel.webview,
            maxUndoStackSize: 100
        });

        this._webviewBridge = new WebviewBridge(this._eventBus, {
            maxBatchSize: 10,
            batchFlushDelay: 50,
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
        this._stateMachine = ChangeStateMachine.getInstance();
        this._stateMachine.initialize(this._fileRegistry, this);

        // Initialize include file coordinator (Phase 2)
        this._includeCoordinator = new IncludeFileCoordinator({
            fileRegistry: this._fileRegistry,
            fileFactory: this._fileFactory,
            webviewBridge: this._webviewBridge,
            stateMachine: this._stateMachine,
            state: this._state,
            getPanel: () => this._panel,
            getBoard: () => this.getBoard(),
            getMainFile: () => this._fileRegistry.getMainFile()
        });

        // Initialize webview manager (Phase 3)
        this._webviewManager = new WebviewManager({
            extensionUri: this._extensionUri,
            getPanel: () => this._panel,
            getDocument: () => this._fileManager.getDocument(),
            getBoard: () => this.getBoard(),
            isInitialized: () => this._state.initialized,
            getHtmlForWebview: () => this._getHtmlForWebview()
        });

        // Subscribe to registry change events
        this._disposables.push(
            this._fileRegistry.onDidChange((event) => {
                this._handleFileRegistryChange(event);
            })
        );

        // Initialize KanbanFileService with grouped callbacks
        const fileServiceCallbacks: KanbanFileServiceCallbacks = {
            getBoard: () => this.getBoard(),
            setBoard: (board) => this._boardStore.setBoard(board, false),
            sendBoardUpdate: (applyDefaultFolding, isFullRefresh) => this.sendBoardUpdate(applyDefaultFolding, isFullRefresh),
            getPanel: () => this._panel,
            getContext: () => this._context,
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
            this._documentState,  // Single source of truth for document state
            KanbanWebviewPanel.panelStates,
            KanbanWebviewPanel.panels
        );

        // Initialize LinkHandler
        this._linkHandler = new LinkHandler(
            this._fileManager,
            this._panel.webview,
            this.handleLinkReplacement.bind(this)
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
                    this._state.setUndoRedoOperation(isOperation);
                },
                getWebviewPanel: () => this,
                syncBoardToBackend: (board: KanbanBoard) => this.syncBoardToBackend(board)
            }
        );

        // Connect message handler to file registry (for stopping edit mode during conflicts)
        this._fileRegistry.setMessageHandler(this._messageHandler);

        // Note: No initializeState() call needed - DocumentStateModel is shared directly

        this._initialize();
        this._setupEventListeners();

        // ENHANCED: Listen for workspace folder changes
        this._setupWorkspaceChangeListener();

        // Listen for document close events
        this._setupDocumentCloseListener();

        this._eventBus.emit('panel:initialized', undefined).catch(() => {});

        // Document will be loaded via loadMarkdownFile call from createOrShow
    }

    private async handleLinkReplacement(originalPath: string, newPath: string, isImage: boolean, taskId?: string, columnId?: string, linkIndex?: number) {
        const board = this.getBoard();
        if (!board || !board.valid) { return; }

        this._boardStore.saveStateForUndo(board);

        let modified = false;

        // URL encode the new path for proper markdown links
        const encodedNewPath = encodeURI(newPath).replace(/[()]/g, (match) => {
            return match === '(' ? '%28' : '%29';
        });

        // If we have specific context, target only that link instance
        if (taskId && columnId) {
            // Find the specific column and task
            const targetColumn = board.columns.find(col => col.id === columnId);
            if (!targetColumn) {
                console.warn(`Column ${columnId} not found for link replacement`);
                return;
            }

            const targetTask = targetColumn.tasks.find(task => task.id === taskId);
            if (!targetTask) {
                console.warn(`Task ${taskId} not found for link replacement`);
                return;
            }

            // Replace only the specific occurrence by index in the specific task
            // Check task title first
            const updatedTitle = LinkOperations.replaceSingleLink(targetTask.title, originalPath, encodedNewPath, linkIndex);
            if (updatedTitle !== targetTask.title) {
                targetTask.title = updatedTitle;
                modified = true;
            }
            // If not found in title and task has description, check description
            else if (targetTask.description) {
                const updatedDescription = LinkOperations.replaceSingleLink(targetTask.description, originalPath, encodedNewPath, linkIndex);
                if (updatedDescription !== targetTask.description) {
                    targetTask.description = updatedDescription;
                    modified = true;
                }
            }
        }
        // If no specific context but we have a columnId, target only that column
        else if (columnId && !taskId) {
            const targetColumn = board.columns.find(col => col.id === columnId);
            if (!targetColumn) {
                console.warn(`Column ${columnId} not found for link replacement`);
                return;
            }

            // Replace only the specific occurrence by index in the column title
            const updatedTitle = LinkOperations.replaceSingleLink(targetColumn.title, originalPath, encodedNewPath, linkIndex);
            if (updatedTitle !== targetColumn.title) {
                targetColumn.title = updatedTitle;
                modified = true;
            }
        }
        // Fallback: global replacement (original behavior)
        else {
            // Helper function to replace link in text with precise strikethrough placement
            const replaceLink = (text: string): string => {
                return LinkOperations.replaceSingleLink(text, originalPath, encodedNewPath);
            };

            // Search and replace in all columns and tasks
            for (const column of board.columns) {
                const newTitle = replaceLink(column.title);
                if (newTitle !== column.title) {
                    column.title = newTitle;
                    modified = true;
                }

                for (const task of column.tasks) {
                    const newTaskTitle = replaceLink(task.title);
                    if (newTaskTitle !== task.title) {
                        task.title = newTaskTitle;
                        modified = true;
                    }

                    if (task.description) {
                        const newDescription = replaceLink(task.description);
                        if (newDescription !== task.description) {
                            task.description = newDescription;
                            modified = true;
                        }
                    }
                }
            }
        }

        if (modified) {
            // Mark as having unsaved changes but don't auto-save
            // The user will need to manually save to persist the changes
            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile && board) {
                // CRITICAL: use updateFromBoard to update BOTH content AND board object
                mainFile.updateFromBoard(board);
            }

            // OPTIMIZATION: Send targeted update instead of full board redraw
            if (taskId && columnId) {
                // Find the updated task and send targeted update
                const targetColumn = board.columns.find(col => col.id === columnId);
                const targetTask = targetColumn?.tasks.find(task => task.id === taskId);
                if (targetTask) {
                    this._webviewBridge.sendBatched({
                        type: 'updateTaskContent',
                        taskId: taskId,
                        columnId: columnId,
                        task: targetTask,
                        imageMappings: {}
                    });
                    return;
                }
            } else if (columnId && !taskId) {
                // Find the updated column and send targeted update
                const targetColumn = board.columns.find(col => col.id === columnId);
                if (targetColumn) {
                    this._webviewBridge.sendBatched({
                        type: 'updateColumnContent',
                        columnId: columnId,
                        column: targetColumn,
                        imageMappings: {}
                    });
                    return;
                }
            }

            // Fallback to full board update if no specific target
            await this.sendBoardUpdate();
        }
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
            } else {
            }
        });

        this._disposables.push(documentCloseListener);
    }

    /**
     * Setup listener for workspace folder changes to update webview permissions
     */
    private _setupWorkspaceChangeListener() {
        // Listen for workspace folder changes
        const workspaceChangeListener = vscode.workspace.onDidChangeWorkspaceFolders(event => {
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
        if (!this._state.initialized) {
            this._panel.webview.html = this._getHtmlForWebview();
            this._state.setInitialized(true);
        }
    }

    /**
     * Sync state from file service to panel state
     * Called after any file service operation to keep states in sync
     */
    private _syncStateFromFileService(): void {
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // STATE-2: Cache board if available
        if (state.cachedBoardFromWebview) {
            this._boardStore.setBoard(state.cachedBoardFromWebview, false);
        }
        // Document state fields are now in shared DocumentStateModel - no sync needed
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
                    // Panel became visible - send file info
                    this._fileManager.sendFileInfo();

                    // Sync any pending DOM updates (items with unrendered changes)
                    this.syncDirtyItems();

                    // ⚠️ REFRESH ALL CONFIGURATION when view gains focus
                    // This ensures settings (shortcuts, tag colors, layout, etc.) are always up-to-date
                    await this._refreshAllViewConfiguration();

                    // Only ensure board content is sent in specific cases to avoid unnecessary re-renders
                    // This fixes empty view issues after debug restart or workspace restore
                    // but avoids re-rendering when the view just temporarily lost focus (e.g., showing messages)
                    if (this._fileManager.getDocument()) {
                        // Only refresh if:
                        // 1. Board hasn't been initialized yet, OR
                        // 2. Board is null/undefined (needs initialization)
                        // Don't refresh just because the panel regained visibility after showing a message
                        if (!this.getBoard() || !this._state.initialized) {
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
        console.log('[kanban.handleWebviewReady] Webview is ready');
        this._state.setWebviewReady(true);

        // Send any pending board update (consume and clear atomically)
        const pendingUpdate = this._documentState.consumePendingBoardUpdate();
        if (pendingUpdate) {
            console.log('[kanban.handleWebviewReady] Sending pending board update');
            this.sendBoardUpdate(pendingUpdate.applyDefaultFolding, pendingUpdate.isFullRefresh);
        }
    }

    private async _ensureBoardAndSendUpdate() {
        await this._fileService.ensureBoardAndSendUpdate();
        this._syncStateFromFileService();
    }

    public async loadMarkdownFile(document: vscode.TextDocument, isFromEditorFocus: boolean = false, forceReload: boolean = false) {
        // RACE-4: Wrap entire operation with lock to prevent concurrent file loads
        return this._concurrency.withLock('loadMarkdownFile', async () => {
            // CRITICAL: Set initial board load flag BEFORE loading main file
            // This prevents the main file's 'reloaded' event from triggering board regeneration
            this._state.setInitialBoardLoad(true);

            this._eventBus.emit('board:loading', { path: document.uri.fsPath }).catch(() => {});

            await this._fileService.loadMarkdownFile(document, isFromEditorFocus, forceReload);
            this._syncStateFromFileService();

            // Phase 1: Create or update MainKanbanFile instance
            await this._syncMainFileToRegistry(document);

            const loadedBoard = this.getBoard();
            if (loadedBoard) {
                this._eventBus.emit('board:loaded', {
                    board: loadedBoard,
                    source: forceReload ? 'external_reload' : 'file',
                    mainFilePath: document.uri.fsPath
                }).catch(() => {});
            }
        });
    }

    private async sendBoardUpdate(applyDefaultFolding: boolean = false, isFullRefresh: boolean = false) {
        console.log(`[kanban.sendBoardUpdate] Called - applyDefaultFolding=${applyDefaultFolding}, isFullRefresh=${isFullRefresh}, webviewReady=${this._state.webviewReady}`);
        if (!this._panel.webview) { return; }

        // Queue update if webview not ready yet
        if (!this._state.webviewReady) {
            console.log('[kanban.sendBoardUpdate] Webview not ready, queuing update');
            this._documentState.setPendingBoardUpdate({ applyDefaultFolding, isFullRefresh });
            return;
        }

        let board = this.getBoard() || {
            valid: false,
            title: 'Please open a Markdown Kanban file',
            columns: [],
            yamlHeader: null,
            kanbanFooter: null
        };

        if (board.valid) {
            this._eventBus.emit('board:updated', {
                board,
                changeType: isFullRefresh ? 'full_refresh' : 'incremental'
            }).catch(() => {});
        }

        // Update webview permissions to include asset directories
        // This ensures the webview can access images from include file directories
        this._webviewManager.updatePermissionsForAssets();

        // Get version from package.json
        const packageJson = require('../package.json');
        const version = packageJson.version || 'Unknown';

        // Send boardUpdate with includeContext for dynamic image path resolution
        // The board now contains includeContext in tasks from include files,
        // which the frontend will use to dynamically resolve relative image paths
        this._sendBoardUpdate(board, {
            isFullRefresh,
            applyDefaultFolding,
            version
        });

        // REFRESH ALL CONFIGURATION after sending board
        // This loads shortcuts, tag settings, layout settings, etc.
        // Must happen AFTER boardUpdate to prevent premature renders with empty mappings
        await this._refreshAllViewConfiguration();

        // Send include file contents immediately after board update
        // WebviewBridge batching handles message ordering
        const includeFiles = this._fileRegistry.getIncludeFiles();
        if (includeFiles.length > 0) {
            for (const file of includeFiles) {
                this._webviewBridge.sendBatched({
                    type: 'updateIncludeContent',
                    filePath: file.getRelativePath(),
                    content: file.getContent()
                } as any);
            }
        }

    }

    public async saveToMarkdown(updateVersionTracking: boolean = true, triggerSave: boolean = true) {
        await this._fileService.saveToMarkdown(updateVersionTracking, triggerSave);
        this._syncStateFromFileService();

        const document = this._fileManager.getDocument();
        if (document) {
            this._eventBus.emit('file:saved', {
                path: document.uri.fsPath,
                silent: !triggerSave
            }).catch(() => {});
        }
    }

    private async initializeFile() {
        await this._fileService.initializeFile();
        this._syncStateFromFileService();
    }

    private _getHtmlForWebview() {
        const filePath = vscode.Uri.file(path.join(this._context.extensionPath, 'src', 'html', 'webview.html'));
        let html = fs.readFileSync(filePath.fsPath, 'utf8');

        const cspSource = this._panel.webview.cspSource;

        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data: blob:; media-src ${cspSource} https: data: blob:; script-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; frame-src 'none'; worker-src blob:; child-src blob:;">`;

        if (!html.includes('Content-Security-Policy')) {
            html = html.replace('<head>', `<head>\n    ${cspMeta}`);
        }

        // Build comprehensive localResourceRoots including asset directories
        const localResourceRoots = this._webviewManager.buildLocalResourceRoots(true);

        // Add document-specific paths if available
        if (this._fileManager.getDocument()) {
            const document = this._fileManager.getDocument()!;
            const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath));

            const baseHref = this._panel.webview.asWebviewUri(documentDir).toString() + '/';
            html = html.replace(/<head>/, `<head><base href="${baseHref}">`);

            // Use local markdown-it from dist/src/html (bundled with extension)
            try {
                const markdownItPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'src', 'html', 'markdown-it.min.js');
                if (fs.existsSync(markdownItPath.fsPath)) {
                    const markdownItUri = this._panel.webview.asWebviewUri(markdownItPath);
                    html = html.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/markdown-it\/[^"]+\/markdown-it\.min\.js"><\/script>/, `<script src="${markdownItUri}"></script>`);
                }
            } catch (error) {
                console.warn('[KanbanWebviewPanel] Failed to load local markdown-it:', error);
            }
        }

        // Apply the enhanced localResourceRoots
        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots
        };
        
        
        const webviewDir = this._panel.webview.asWebviewUri(
            vscode.Uri.file(path.join(this._context.extensionPath, 'dist', 'src', 'html'))
        );
        
        // Add cache-busting timestamp for development
        const timestamp = Date.now();
        const isDevelopment = !this._context.extensionMode || this._context.extensionMode === vscode.ExtensionMode.Development;
        const cacheBuster = isDevelopment ? `?v=${timestamp}` : '';
        
        html = html.replace(/href="webview\.css"/, `href="${webviewDir}/webview.css${cacheBuster}"`);
        
        // Replace all JavaScript file references
        const jsFiles = [
            'utils/colorUtils.js',
            'utils/fileTypeUtils.js',
            'utils/tagUtils.js',
            'utils/configManager.js',
            'utils/styleManager.js',
            'utils/menuManager.js',
            'utils/dragStateManager.js',
            'utils/validationUtils.js',
            'utils/modalUtils.js',
            'utils/activityIndicator.js',
            'utils/exportTreeBuilder.js',
            'utils/exportTreeUI.js',
            'utils/smartLogger.js',
            'runtime-tracker.js',
            'unifiedOperations.js',
            'markdownRenderer.js',
            'taskEditor.js',
            'boardRenderer.js',
            'dragDrop.js',
            'menuOperations.js',
            'search.js',
            'debugOverlay.js',
            'webview.js',
            'markdown-it-media-browser.js',
            'markdown-it-multicolumn-browser.js',
            'markdown-it-mark-browser.js',
            'markdown-it-sub-browser.js',
            'markdown-it-sup-browser.js',
            'markdown-it-ins-browser.js',
            'markdown-it-strikethrough-alt-browser.js',
            'markdown-it-underline-browser.js',
            'markdown-it-abbr-browser.js',
            'markdown-it-container-browser.js',
            'markdown-it-include-browser.js',
            'markdown-it-image-figures-browser.js'
        ];
        
        jsFiles.forEach(jsFile => {
            html = html.replace(
                new RegExp(`src="${jsFile}"`, 'g'), 
                `src="${webviewDir}/${jsFile}${cacheBuster}"`
            );
        });

        return html;
    }

    /**
     * Load main file to registry (create or update MainKanbanFile instance)
     */
    private async _syncMainFileToRegistry(document: vscode.TextDocument): Promise<void> {
        const filePath = document.uri.fsPath;

        // Check if MainKanbanFile already exists
        let mainFile = this._fileRegistry.getMainFile();

        if (!mainFile || mainFile.getPath() !== filePath) {
            // Clear existing files if switching to a different file
            if (mainFile && mainFile.getPath() !== filePath) {
                this._fileRegistry.clear();
            }

            // Create new MainKanbanFile instance
            mainFile = this._fileFactory.createMainFile(filePath);
            this._fileRegistry.register(mainFile);
            mainFile.startWatching();
        }

        // Load content into file instance directly from document/disk
        try {
            await mainFile.reload();
        } catch (error) {
            console.error(`[KanbanWebviewPanel] Failed to load MainKanbanFile content:`, error);
        }

        // Load include files if board is available
        const board = this.getBoard();
        if (board && board.valid) {
            // Step 1: Create include file instances in registry
            this._includeCoordinator.syncIncludeFilesWithRegistry(board);

            // Step 2: Mark includes as loading (sets loading flags on columns/tasks)
            this._includeCoordinator.markIncludesAsLoading(board);

            // Step 3: Load content asynchronously (will send updates as each include loads)
            // Don't await - let it run in background while we send initial board
            // NOTE: _isInitialBoardLoad flag already set in loadMarkdownFile()

            this._includeCoordinator.loadIncludeContentAsync(board)
                .then(() => {
                    this._state.setInitialBoardLoad(false);
                })
                .catch(error => {
                    console.error('[_syncMainFileToRegistry] Error loading include content:', error);
                    this._state.setInitialBoardLoad(false);
                });
        } else {
            console.warn(`[_syncMainFileToRegistry] Skipping include file sync - board not available or invalid`);
        }

        // Log registry statistics
        this._fileRegistry.logStatistics();
    }

    /**
     * UNIFIED CONTENT CHANGE HANDLER (State Machine Integrated)
     *
     * Single entry point for ALL content changes (external, edits, switches)
     *
     * Flow: STABLE → DETECTING_CHANGES → ANALYZING → COORDINATING_INCLUDES → UPDATING_UI → STABLE
     *
     * Benefits:
     * - State tracking for debugging
     * - Race condition prevention via coordinator locking (replaces _withLock)
     * - Rollback capability on errors
     * - Change type metadata tracking
     *
     * NOTE: This does NOT save files - saving is separate, user-triggered
     */
    /**
     * Set editing in progress flag to block board regenerations
     */
    public setEditingInProgress(isEditing: boolean): void {
        this._state.setEditingInProgress(isEditing);
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
     * RACE-2: Sync dirty items to frontend (Optimization 2: Batched sync)
     *
     * Called when view becomes visible to apply any pending DOM updates.
     * Also called after editing stops to ensure skipped updates are applied.
     */
    public syncDirtyItems(): void {
        // CRITICAL FIX: Don't sync during include switches - state machine sends correct updates
        // During include switch, board might be regenerated with empty descriptions (before async load completes)
        // This would send stale/empty data and cause content flapping
        if (this._state.includeSwitchInProgress) {
            return;
        }

        const board = this.getBoard();
        if (!board || !this._panel) return;

        if (!this._boardStore.hasDirtyItems()) {
            return; // Nothing to sync
        }

        // Get dirty items from BoardStore
        const dirtyColumnIds = this._boardStore.getDirtyColumns();
        const dirtyTaskIds = this._boardStore.getDirtyTasks();

        // Collect dirty columns
        const dirtyColumns: any[] = [];
        for (const columnId of dirtyColumnIds) {
            const column = board.columns.find(c => c.id === columnId);
            if (column) {
                dirtyColumns.push({
                    columnId: column.id,
                    title: column.title,
                    displayTitle: column.displayTitle,
                    includeMode: column.includeMode,
                    includeFiles: column.includeFiles
                });
            }
        }

        // Collect dirty tasks
        const dirtyTasks: any[] = [];
        for (const taskId of dirtyTaskIds) {
            for (const column of board.columns) {
                const task = column.tasks.find(t => t.id === taskId);
                if (task) {
                    dirtyTasks.push({
                        columnId: column.id,
                        taskId: task.id,
                        displayTitle: task.displayTitle,
                        description: task.description
                    });
                    break;
                }
            }
        }

        // Send single batched message
        this._webviewBridge.send({
            type: 'syncDirtyItems',
            columns: dirtyColumns,
            tasks: dirtyTasks
        } as any);

        this._boardStore.clearAllDirty();
    }

    /**
     * PUBLIC API: Handle include file switch triggered by user edit (column/task title)
     * Routes through the unified change state machine (Phase 6)
     * Changes always apply - use undo to revert if needed
     *
     * @param params Switch parameters (columnId or taskId with old/new files)
     */
    public async handleIncludeSwitch(params: {
        columnId?: string;
        taskId?: string;
        oldFiles: string[];
        newFiles: string[];
        newTitle?: string;
        /** Pre-loaded content for include files (bypasses registry caching) */
        preloadedContent?: Map<string, string>;
    }): Promise<void> {
        // Delegate to include coordinator
        return this._includeCoordinator.handleIncludeSwitch(params);
    }

    /**
     * SWITCH-1: UNIFIED COLUMN INCLUDE SWITCH
     *
     * Single unified function for ALL column include file switching operations.
     * This is THE ONLY way to switch column include files - ensures consistency.
     *
     * Complete flow in ONE place:
     * 1. Save undo state (via board action)
     * 2. Prompt for unsaved changes in old files
     * 3. Cleanup old files (stopWatching + unregister)
     * 4. Update board state (title + includeFiles)
     * 5. Register new file instances
     * 6. Load new content (with FOUNDATION-2 cancellation)
     * 7. Send updateColumnContent to frontend
     * 8. Send full boardUpdate
     * 9. Mark unsaved changes
     *
     * @param columnId The column ID to update
     * @param oldFiles Array of old include file paths (for cleanup)
     * @param newFiles Array of new include file paths (to load)
     * @param newTitle The new column title (contains !!!include()!!! syntax)
     * @param onComplete Optional callback when all async operations complete (RACE-1 fix)
     * @throws Error if column not found or user cancels
     */
    /**
     * Handle file registry change events - ROUTES TO UNIFIED HANDLER
     */
    private async _handleFileRegistryChange(event: FileChangeEvent): Promise<void> {

        const file = event.file;
        const fileType = file.getFileType();

        // CRITICAL: Only route EXTERNAL changes to unified handler
        // 'content' events are internal cache updates from user edits - DON'T reload!
        // 'external' events are from file watchers - DO reload!
        // 'reloaded' events are explicit reload requests - DO reload!
        if (event.changeType === 'content' || event.changeType === 'saved') {
            // Internal cache update - do NOT trigger reload
            return;
        }

        // UNIFIED APPROACH: All files (main + includes) handle external changes autonomously
        // 'external' events → File's handleExternalChange() handles it → emits 'reloaded'
        // 'reloaded' events → Update frontend

        if (event.changeType === 'external') {
            // All files handle external changes independently via handleExternalChange()
            // They will show dialogs, reload, and emit 'reloaded' event
            // We just wait for the 'reloaded' event to update frontend
            return;
        }

        // Handle 'reloaded' events for all file types
        if (fileType === 'main') {
            if (event.changeType === 'reloaded') {
                // CRITICAL: Skip 'reloaded' events during initial board load
                if (this._state.initialBoardLoad) {
                    return;
                }

                // Main file reloaded from disk, regenerate board and update frontend
                this.invalidateBoardCache();
                const board = this.getBoard();
                if (board) {
                    // Use sendBoardUpdate to ensure image mappings are regenerated
                    await this.sendBoardUpdate(false, true);
                }
            }
        } else if (fileType === 'include-column' || fileType === 'include-task' || fileType === 'include-regular') {

            if (event.changeType === 'reloaded') {
                // CRITICAL: Skip 'reloaded' events during initial board load
                // These are just loading content for the first time, not actual changes
                if (this._state.initialBoardLoad) {
                    return;
                }

                // RACE-3: Only process if this event is newer than last processed
                // When multiple external changes happen rapidly, reloads can complete out of order.
                // This ensures only the newest data is applied to the frontend.
                if (!this._concurrency.isEventNewer(file.getRelativePath(), event.timestamp)) {
                    return;
                }

                // File has been reloaded (either from external change or manual reload)
                // Send updated content to frontend
                await this._sendIncludeFileUpdateToFrontend(file);
            }
        }
    }

    /**
     * Send updated include file content to frontend
     * Called after file has been reloaded (from external change or manual reload)
     */
    private async _sendIncludeFileUpdateToFrontend(file: MarkdownFile): Promise<void> {
        const board = this.getBoard();
        if (!board || !this._panel) {
            console.warn(`[_sendIncludeFileUpdateToFrontend] No board or panel available`);
            return;
        }

        const relativePath = file.getRelativePath();
        const fileType = file.getFileType();

        if (fileType === 'include-column') {
            // Find column that uses this include file
            // FOUNDATION-1: Use normalized path comparison instead of === comparison
            const column = board.columns.find(c =>
                c.includeFiles && c.includeFiles.some(p => MarkdownFile.isSameFile(p, relativePath))
            );

            if (column) {
                // Parse tasks from updated file
                const columnFile = file as any; // ColumnIncludeFile
                const mainFilePath = this._fileManager.getDocument()?.uri.fsPath;
                const tasks = columnFile.parseToTasks(column.tasks, column.id, mainFilePath);
                column.tasks = tasks;

                // Send update to frontend
                this._webviewBridge.send({
                    type: 'updateColumnContent',
                    columnId: column.id,
                    tasks: tasks,
                    columnTitle: column.title,
                    displayTitle: column.displayTitle,
                    includeMode: true,
                    includeFiles: column.includeFiles
                } as any);
            }
        } else if (fileType === 'include-task') {
            // Find task that uses this include file
            let foundTask: KanbanTask | undefined;
            let foundColumn: KanbanColumn | undefined;

            for (const column of board.columns) {
                for (const task of column.tasks) {
                    // FOUNDATION-1: Use normalized comparison
                    if (task.includeFiles && task.includeFiles.some((p: string) => MarkdownFile.isSameFile(p, relativePath))) {
                        foundTask = task;
                        foundColumn = column;
                        break;
                    }
                }
                if (foundTask) break;
            }

            if (foundTask && foundColumn) {
                // Get updated content from file (already using no-parsing approach)
                const fullContent = file.getContent();
                const displayTitle = `# include in ${relativePath}`;

                // Update task
                foundTask.displayTitle = displayTitle;
                foundTask.description = fullContent;

                // Send update to frontend
                this._webviewBridge.send({
                    type: 'updateTaskContent',
                    columnId: foundColumn.id,
                    taskId: foundTask.id,
                    description: fullContent,
                    displayTitle: displayTitle,
                    taskTitle: foundTask.title,
                    originalTitle: foundTask.originalTitle,
                    includeMode: true,
                    includeFiles: foundTask.includeFiles
                } as any);
            }
        } else if (fileType === 'include-regular') {
            // Regular include - find and update only affected tasks
            // Regular includes (!!!include()!!!) are resolved on frontend during markdown rendering

            // CRITICAL: Send updated include content to frontend cache
            const content = file.getContent();
            this._webviewBridge.sendBatched({
                type: 'updateIncludeContent',
                filePath: relativePath,
                content: content
            } as any);

            // Find all tasks that use this regular include
            const affectedTasks: Array<{task: KanbanTask, column: KanbanColumn}> = [];
            for (const column of board.columns) {
                for (const task of column.tasks) {
                    // Check if this task has the regular include in its description
                    if (task.regularIncludeFiles?.length) {

                        const hasThisInclude = task.regularIncludeFiles.some((p: string) => {
                            const matches = MarkdownFile.isSameFile(p, relativePath);
                            return matches;
                        });

                        if (hasThisInclude) {
                            affectedTasks.push({ task, column });
                        }
                    }
                }
            }

            // Send targeted updates for each affected task
            // WebviewBridge batching ensures cache update arrives BEFORE task updates
            for (const {task, column} of affectedTasks) {
                // Send task update with current description (frontend will re-render the markdown with updated cache)
                this._webviewBridge.sendBatched({
                    type: 'updateTaskContent',
                    columnId: column.id,
                    taskId: task.id,
                    description: task.description, // Same description, but frontend will re-render includes
                    displayTitle: task.displayTitle,
                    taskTitle: task.title,
                    originalTitle: task.originalTitle,
                    includeMode: false, // Regular includes are NOT includeMode
                    regularIncludeFiles: task.regularIncludeFiles // Send the list so frontend knows what changed
                } as any);

            }

            // NOTE: No need for 'includesUpdated' message - updateTaskContent already triggers
            // renderSingleColumn() for each affected column, which re-renders markdown with updated cache
        }
    }

    /**
     * Send full board update to frontend with all configuration
     * Helper to consolidate board update message logic
     */
    private async _sendShortcutsToWebview(): Promise<void> {
        if (!this._panel) return;

        try {
            const shortcuts = await KeybindingService.getInstance().getAllShortcuts();
            this._webviewBridge.send({
                type: 'updateShortcuts',
                shortcuts: shortcuts
            } as any);
        } catch (error) {
            console.error('[KanbanWebviewPanel] Failed to send shortcuts to webview:', error);
        }
    }

    /**
     * ⚠️ CENTRAL CONFIGURATION REFRESH POINT ⚠️
     *
     * This method is THE SINGLE SOURCE OF TRUTH for refreshing all view configuration.
     * It should be called ONLY in these scenarios:
     *
     * 1. When the webview panel gains focus (user switches to Kanban view)
     * 2. When the webview panel is first created/initialized
     * 3. When VSCode workspace configuration changes (via onDidChangeConfiguration)
     *
     * DO NOT call this method from anywhere else! If you think you need to refresh
     * configuration, you probably want to trigger one of the above events instead.
     *
     * What this method does:
     * - Loads keyboard shortcuts from VSCode
     * - Loads ALL workspace settings (layout, tags, rendering, etc.)
     * - Sends everything to the webview in a single "configurationUpdate" message
     *
     * Why this matters:
     * - Ensures configuration is always fresh when user focuses the view
     * - Avoids stale configuration (e.g., changing tag colors and not seeing updates)
     * - Centralizes configuration loading logic in ONE place
     * - Makes it obvious what gets loaded and when
     */
    public async refreshConfiguration(): Promise<void> {
        await this._refreshAllViewConfiguration();
    }

    private async _refreshAllViewConfiguration(): Promise<void> {
        if (!this._panel) {
            console.warn('[KanbanWebviewPanel] Cannot refresh configuration - panel is null');
            return;
        }

        try {
            // 1. Load keyboard shortcuts
            await this._sendShortcutsToWebview();

            // 2. Load all workspace settings and send to webview
            // Uses centralized getBoardViewConfig() - single source of truth
            const layoutPresets = this._webviewManager.getLayoutPresetsConfiguration();
            const config = configService.getBoardViewConfig(layoutPresets);

            // Send configuration to webview
            this._webviewBridge.send({
                type: 'configurationUpdate',
                config: config
            } as any);

        } catch (error) {
            console.error('[KanbanWebviewPanel] ❌ Failed to refresh view configuration:', error);
        }
    }

    private _sendBoardUpdate(board: KanbanBoard, options: {
        isFullRefresh?: boolean;
        applyDefaultFolding?: boolean;
        version?: string;
    } = {}): void {
        if (!this._panel) return;

        // Use centralized getBoardViewConfig() - single source of truth
        const layoutPresets = this._webviewManager.getLayoutPresetsConfiguration();
        const viewConfig = configService.getBoardViewConfig(layoutPresets);

        const message = {
            type: 'boardUpdate',
            board: board,
            ...viewConfig,
            // Optional fields for full board loads
            ...(options.isFullRefresh !== undefined && { isFullRefresh: options.isFullRefresh }),
            ...(options.applyDefaultFolding !== undefined && { applyDefaultFolding: options.applyDefaultFolding }),
            ...(options.version && { version: options.version })
        };

        this._webviewBridge.send(message as any);
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
     * Sync board state from frontend to backend
     *
     * Updates _content in MainKanbanFile which triggers hash comparison
     * for unsaved change detection. Also creates backup.
     *
     * @param board - The board state to sync to backend
     */
    public async syncBoardToBackend(board: KanbanBoard): Promise<void> {
        if (!this._fileRegistry.isReady()) {
            return;
        }

        // 1. Update board store (without emitting event - we're syncing, not changing)
        this._boardStore.setBoard(board, false);

        // 2. Update MainKanbanFile's cached board for conflict detection
        const mainFile = this._fileRegistry.getMainFile();
        if (mainFile) {
            mainFile.setCachedBoardFromWebview(board);
        }

        // 3. Track changes in include files (updates their cache)
        await this._fileRegistry.trackIncludeFileUnsavedChanges(board);

        // 4. Generate markdown and update main file content
        // This causes hasUnsavedChanges() to return true (content !== baseline)
        if (mainFile) {
            const markdown = MarkdownKanbanParser.generateMarkdown(board);
            mainFile.setContent(markdown, false); // false = don't update baseline
        }

        // 5. Create backup if minimum interval has passed
        const document = this._fileManager.getDocument();
        if (document) {
            this._backupManager.createBackup(document, { label: 'auto' })
                .catch(error => console.error('Backend sync backup failed:', error));
        }
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
        if (this._state.includeSwitchInProgress) {
            return;
        }

        this._boardStore.invalidateCache();
    }

    /**
     * Set include switch in-progress flag
     *
     * When true, blocks cache invalidation to prevent ID regeneration during include switches.
     * State machine sets this to true at start of LOADING_NEW, false at COMPLETE.
     */
    public setIncludeSwitchInProgress(inProgress: boolean): void {
        this._state.setIncludeSwitchInProgress(inProgress);
    }

    private async _handlePanelClose() {
        // CRITICAL: Remove from panels map IMMEDIATELY to prevent reuse during disposal
        // Panel is already disposed by VS Code when onDidDispose fires
        // Must remove before showing any dialogs (which await user input)
        const trackedUri = this._documentState.trackedDocumentUri;
        if (trackedUri && KanbanWebviewPanel.panels.get(trackedUri) === this) {
            KanbanWebviewPanel.panels.delete(trackedUri);
        }
        // Also check all entries as a fallback
        for (const [uri, panel] of KanbanWebviewPanel.panels.entries()) {
            if (panel === this) {
                KanbanWebviewPanel.panels.delete(uri);
            }
        }

        // Query current unsaved changes state from MarkdownFile
        const mainFile = this._fileRegistry.getMainFile();
        const hasUnsavedChanges = mainFile?.hasUnsavedChanges() || false;

        // Get include files unsaved status
        const includeStatus = this._fileRegistry.getIncludeFilesUnsavedStatus();

        // If no unsaved changes, allow close
        if (!hasUnsavedChanges && !includeStatus.hasChanges) {
            this.dispose();
            return;
        }

        // Build message for unsaved changes
        let message = '';
        if (hasUnsavedChanges && includeStatus.hasChanges) {
            message = `You have unsaved changes in the main file and in column include files:\n${includeStatus.changedFiles.join('\n')}\n\nDo you want to save before closing?`;
        } else if (hasUnsavedChanges) {
            message = `You have unsaved changes in the main file. Do you want to save before closing?`;
        } else if (includeStatus.hasChanges) {
            message = `You have unsaved changes in column include files:\n${includeStatus.changedFiles.join('\n')}\n\nDo you want to save before closing?`;
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
            // User cancelled, but panel is already disposed by VS Code
            // Still need to run our cleanup
            console.warn('[PanelClose] User cancelled, but panel already disposed - discarding unsaved changes');
            if (mainFile) {
                mainFile.discardChanges();
            }
            this.dispose();
            return;
        }

        if (choice === saveAndClose) {
            // Save all changes and then close
            try {
                await this.saveToMarkdown(true, true); // Save with version tracking and trigger save
            } catch (error) {
                console.error('[PanelClose] Save failed:', error);
                // Panel is already disposed by VS Code, but still run our cleanup
                vscode.window.showErrorMessage(`Failed to save: ${getErrorMessage(error)}`);
            }
            // CRITICAL: Always call dispose() to clean up, even if save failed
            // We're in onDidDispose handler - panel is already disposed by VS Code
            this.dispose();
        } else if (choice === closeWithoutSaving) {
            // Discard changes and close
            if (mainFile) {
                mainFile.discardChanges();
            }
            // Include files are handled by their own discard logic
            this.dispose();
        }
    }

    private tryAutoLoadActiveMarkdown() {
        // Try to find the active markdown document in the editor
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.languageId === 'markdown') {
            this.loadMarkdownFile(activeEditor.document);
            return;
        }

        // If no active markdown editor, look for any open markdown document
        const openMarkdownDocs = vscode.workspace.textDocuments.filter(doc =>
            doc.languageId === 'markdown' && !doc.isUntitled
        );

        if (openMarkdownDocs.length > 0) {
            // TEMP DISABLED: Don't auto-load random markdown files
            // This was causing wrong files to be loaded on revival
            // this.loadMarkdownFile(openMarkdownDocs[0]);
            return;
        }

        // No markdown documents available - panel will remain empty
        // User can manually select a file to load
    }

    /**
     * Check if this panel has unsaved changes
     * Used by extension deactivate() to prompt before VSCode closes
     */
    public async checkUnsavedChanges(): Promise<boolean> {
        return this._fileRegistry.hasAnyUnsavedChanges();
    }

    /**
     * Save unsaved changes to backup files with "-unsavedchanges" suffix
     * Called when VSCode closes with unsaved changes
     * This creates a safety backup before prompting the user
     */
    public async saveUnsavedChangesBackup(): Promise<void> {
        try {
            // Save main file backup
            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile && mainFile.hasUnsavedChanges()) {
                const uri = this.getCurrentDocumentUri();
                if (uri) {
                    const filePath = uri.fsPath;
                    const content = mainFile.getContent();

                    // Create backup filename: "file.md" -> "file-unsavedchanges.md"
                    const ext = path.extname(filePath);
                    const baseName = path.basename(filePath, ext);
                    const dirName = path.dirname(filePath);
                    const backupPath = path.join(dirName, `${baseName}-unsavedchanges${ext}`);

                    fs.writeFileSync(backupPath, content, 'utf8');
                }
            }

            // Save include files backups
            const includeStatus = this._fileRegistry.getIncludeFilesUnsavedStatus();
            if (includeStatus.hasChanges) {
                for (const fileWithChanges of includeStatus.changedFiles) {
                    const includeFile = this._fileRegistry.getIncludeFile(fileWithChanges);
                    if (includeFile && includeFile.hasUnsavedChanges()) {
                        const fileManager = (includeFile as any)._fileManager;
                        if (fileManager) {
                            const document = fileManager.getDocument();
                            if (document) {
                                const filePath = document.uri.fsPath;
                                const content = includeFile.getContent();

                                // Create backup filename: "include.md" -> "include-unsavedchanges.md"
                                const ext = path.extname(filePath);
                                const baseName = path.basename(filePath, ext);
                                const dirName = path.dirname(filePath);
                                const backupPath = path.join(dirName, `${baseName}-unsavedchanges${ext}`);

                                fs.writeFileSync(backupPath, content, 'utf8');
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[KanbanWebviewPanel] Failed to save unsaved changes backup:', error);
            // Don't throw - we want to continue with the close process even if backup fails
        }
    }

    public async dispose() {
        // Prevent double disposal
        if (this._state.disposed) {
            return;
        }
        this._state.setDisposed(true);

        // CRITICAL: Remove from panels map IMMEDIATELY to prevent reuse of disposing panel
        // This must happen BEFORE any async operations or cleanup
        const trackedUri = this._documentState.trackedDocumentUri;
        if (trackedUri && KanbanWebviewPanel.panels.get(trackedUri) === this) {
            KanbanWebviewPanel.panels.delete(trackedUri);
        }

        // Also check all entries as a fallback in case tracking failed
        for (const [uri, panel] of KanbanWebviewPanel.panels.entries()) {
            if (panel === this) {
                KanbanWebviewPanel.panels.delete(uri);
            }
        }

        // Clear unsaved changes flag and prevent closing flags
        const mainFileForDispose = this._fileRegistry.getMainFile();
        if (mainFileForDispose) {
            // Always discard to reset state on dispose
            // discardChanges() internally checks if content changed before emitting events
            mainFileForDispose.discardChanges();
        }
        this._state.setClosingPrevented(false);

        // Stop unsaved changes monitoring
        if (this._unsavedChangesCheckInterval) {
            clearInterval(this._unsavedChangesCheckInterval);
            this._unsavedChangesCheckInterval = undefined;
        }

        this._webviewBridge.dispose();

        // Clear panel state
        KanbanWebviewPanel.panelStates.delete(this._documentState.panelId);

        // Dispose concurrency manager (handles RACE-3 and RACE-4 cleanup)
        this._concurrency.dispose();

        // Unregister from SaveEventDispatcher
        const document = this._fileManager.getDocument();
        if (document) {
            const dispatcher = SaveEventDispatcher.getInstance();
            dispatcher.unregisterHandler(`panel-${document.uri.fsPath}`);
        }

        // Stop backup timer
        this._backupManager.dispose();

        this._fileRegistry.dispose();
        this._eventBus.emit('panel:disposing', undefined).catch(() => {});
        this._eventBus.dispose();
        this._boardStore.dispose();

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }
    }

    public get backupManager(): BackupManager {
        return this._backupManager;
    }

    public get fileRegistry(): MarkdownFileRegistry {
        return this._fileRegistry;
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
            this._webviewBridge.send({
                type: 'triggerSnippet'
            } as any);
        }
    }
}
