import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { MarkdownKanbanParser, KanbanBoard } from './markdownParser';
import { FileManager } from './fileManager';
import { BoardOperations, BoardCrudOperations } from './board';
import { LinkHandler } from './services/LinkHandler';
import { MessageHandler } from './messageHandler';
import { BackupManager } from './services/BackupManager';
import { ConflictResolver, ConflictContext, ConflictResolution } from './services/ConflictResolver';
import { configService } from './services/ConfigurationService';
import { SaveEventDispatcher } from './SaveEventDispatcher';
import { KanbanFileService, KanbanFileServiceCallbacks } from './kanbanFileService';
import { MediaTracker, ChangedMediaFile } from './services/MediaTracker';
import { LinkOperations } from './utils/linkOperations';
import { getErrorMessage } from './utils/stringUtils';
import {
    MarkdownFileRegistry,
    FileFactory,
    FileChangeEvent
} from './files';
import { ChangeStateMachine } from './core/ChangeStateMachine';
import { BoardStore } from './core/stores';
import { WebviewBridge } from './core/bridge';
import { BoardSyncHandler, FileSyncHandler, eventBus, createEvent, BoardChangeTrigger } from './core/events';
import {
    BoardUpdateMessage,
    UpdateIncludeContentMessage,
    SyncDirtyItemsMessage,
    SyncDirtyColumnInfo,
    SyncDirtyTaskInfo,
    UpdateShortcutsMessage,
    ConfigurationUpdateMessage,
    TriggerSnippetMessage
} from './core/bridge/MessageTypes';
import { PanelContext, ConcurrencyManager, IncludeFileCoordinator, WebviewManager } from './panel';
import { KeybindingService } from './services/KeybindingService';
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
    private _boardSyncHandler: BoardSyncHandler | null = null;
    private _fileSyncHandler: FileSyncHandler | null = null;

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
            getPanel: () => this._panel,
            getDocument: () => this._fileManager.getDocument(),
            getBoard: () => this.getBoard(),
            isInitialized: () => this._context.initialized,
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
        this._boardSyncHandler = new BoardSyncHandler({
            boardStore: this._boardStore,
            fileRegistry: this._fileRegistry,
            getMediaTracker: () => this._mediaTracker,
            backupManager: this._backupManager,
            getDocument: () => this._fileManager.getDocument()
        });

        // Initialize file sync handler (handles focus:gained and unified sync)
        this._fileSyncHandler = new FileSyncHandler({
            fileRegistry: this._fileRegistry,
            boardStore: this._boardStore,
            getMediaTracker: () => this._mediaTracker,
            getWebviewBridge: () => this._webviewBridge,
            getBoard: () => this.getBoard(),
            panelContext: this._context,
            sendBoardUpdate: (isFullRefresh, applyDefaultFolding) =>
                this.sendBoardUpdate(isFullRefresh, applyDefaultFolding),
            emitBoardLoaded: (board) => this.emitBoardLoaded(board)
        });

        // Document will be loaded via loadMarkdownFile call from createOrShow
    }

    private async handleLinkReplacement(originalPath: string, newPath: string, _isImage: boolean, taskId?: string, columnId?: string, linkIndex?: number) {
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
            const targetColumn = BoardCrudOperations.findColumnById(board, columnId);
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
            const targetColumn = BoardCrudOperations.findColumnById(board, columnId);
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
                const targetColumn = BoardCrudOperations.findColumnById(board, columnId);
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
                const targetColumn = BoardCrudOperations.findColumnById(board, columnId);
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
            this._panel.webview.html = this._getHtmlForWebview();
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
                    await this._refreshAllViewConfiguration();

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

            console.log('[WebviewReady] Webview was recreated by VS Code - re-sending all state');

            // 1. File info (filename, path, locked status)
            this._fileManager.sendFileInfo();

            // 2. Full board update (includes _refreshAllViewConfiguration internally)
            this.sendBoardUpdate(false, true);
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

    private async sendBoardUpdate(applyDefaultFolding: boolean = false, isFullRefresh: boolean = false) {
        if (!this._panel.webview) { return; }

        // Queue update if webview not ready yet
        if (!this._context.webviewReady) {
            this._context.setPendingBoardUpdate({ applyDefaultFolding, isFullRefresh });
            return;
        }

        let board = this.getBoard() || {
            valid: false,
            title: 'Please open a Markdown Kanban file',
            columns: [],
            yamlHeader: null,
            kanbanFooter: null
        };

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
                const message: UpdateIncludeContentMessage = {
                    type: 'updateIncludeContent',
                    filePath: file.getRelativePath(),
                    content: file.getContent()
                };
                this._webviewBridge.sendBatched(message);
            }
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

    private _getHtmlForWebview() {
        const filePath = vscode.Uri.file(path.join(this._extensionContext.extensionPath, 'src', 'html', 'webview.html'));
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
            vscode.Uri.file(path.join(this._extensionContext.extensionPath, 'dist', 'src', 'html'))
        );

        // Add cache-busting timestamp for development
        const timestamp = Date.now();
        const isDevelopment = !this._extensionContext.extensionMode || this._extensionContext.extensionMode === vscode.ExtensionMode.Development;
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
            'utils/menuUtils.js',
            'utils/presentationParser.js',
            'markdownRenderer.js',
            'taskEditor.js',
            'boardRenderer.js',
            'dragDrop.js',
            'menuOperations.js',
            'search.js',
            'debugOverlay.js',
            'clipboardHandler.js',
            'navigationHandler.js',
            'foldingStateManager.js',
            'templateDialog.js',
            'exportMarpUI.js',
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
     * Initialize board from document - creates MainKanbanFile and registers include files
     */
    private async _initializeBoardFromDocument(document: vscode.TextDocument): Promise<void> {
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

        // Initialize MediaTracker for this kanban file
        // Tracks modification times of embedded media (images, diagrams, audio, video)
        // IMPORTANT: Dispose old tracker before creating new one to cleanup file watchers
        if (this._mediaTracker) {
            console.log('[MediaTracker] Disposing old MediaTracker before creating new one');
            this._mediaTracker.dispose();
            this._mediaTracker = null;
        }
        console.log(`[MediaTracker] Creating new MediaTracker for: ${filePath}`);
        this._mediaTracker = new MediaTracker(filePath);

        // Set up callback for real-time media file change detection
        this._mediaTracker.setOnMediaChanged((changedFiles) => {
            console.log(`[MediaTracker] Real-time change detected for ${changedFiles.length} file(s):`,
                changedFiles.map(f => f.path));

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
        });

        // Update tracked media files from current content
        const content = mainFile.getContent();
        console.log(`[MediaTracker] Main file content length: ${content?.length || 0}`);
        if (content) {
            const trackedFiles = this._mediaTracker.updateTrackedFiles(content);
            console.log(`[MediaTracker] Tracking ${trackedFiles.length} media files from main file`);
        } else {
            console.warn(`[MediaTracker] No content from main file - skipping media tracking`);
        }

        // Setup file watchers for diagram files (real-time change detection)
        this._mediaTracker.setupFileWatchers();

        // NOTE: Media tracking updates are handled by BoardSyncHandler
        // which handles board:changed events. This is more reliable than
        // event listeners and ensures new diagrams get watchers immediately.

        // Load include files if board is available
        const board = this.getBoard();
        if (board && board.valid) {
            // Step 1: Create include file instances in registry
            this._includeCoordinator.registerBoardIncludeFiles(board);

            // Step 2: Load include content using the UNIFIED FileSyncHandler
            // This is the SAME code path used by FOCUS (focus:gained event)
            // The only difference is force=true (load all) vs force=false (check and reload changed)
            // NOTE: _isInitialBoardLoad flag already set in loadMarkdownFile()
            // CRITICAL: Must await to hold lock and prevent duplicate initialization from editor focus events
            // CRITICAL: skipBoardUpdate=true because loadMarkdownFile() already sent the board update
            if (this._fileSyncHandler) {
                try {
                    await this._fileSyncHandler.reloadExternallyModifiedFiles({ force: true, skipBoardUpdate: true });
                    console.log('[_initializeBoardFromDocument] Include files loaded via FileSyncHandler (unified path)');
                } catch (error) {
                    console.error('[_initializeBoardFromDocument] Error loading include content:', error);
                } finally {
                    this._context.setInitialBoardLoad(false);
                }
            } else {
                console.warn('[_initializeBoardFromDocument] FileSyncHandler not available');
                this._context.setInitialBoardLoad(false);
            }
        } else {
            console.warn(`[_initializeBoardFromDocument] Skipping include file sync - board not available or invalid`);
            this._context.setInitialBoardLoad(false);
        }
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
     * RACE-2: Sync dirty items to frontend (Optimization 2: Batched sync)
     *
     * Called when view becomes visible to apply any pending DOM updates.
     * Also called after editing stops to ensure skipped updates are applied.
     */
    public syncDirtyItems(): void {
        // CRITICAL FIX: Don't sync during include switches - state machine sends correct updates
        // During include switch, board might be regenerated with empty descriptions (before async load completes)
        // This would send stale/empty data and cause content flapping
        if (this._context.includeSwitchInProgress) {
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
        const dirtyColumns: SyncDirtyColumnInfo[] = [];
        for (const columnId of dirtyColumnIds) {
            const column = BoardCrudOperations.findColumnById(board, columnId);
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
        const dirtyTasks: SyncDirtyTaskInfo[] = [];
        for (const taskId of dirtyTaskIds) {
            const result = BoardCrudOperations.findTaskById(board, taskId);
            if (result) {
                dirtyTasks.push({
                    columnId: result.column.id,
                    taskId: result.task.id,
                    displayTitle: result.task.displayTitle,
                    description: result.task.description
                });
            }
        }

        // Send single batched message
        const syncMessage: SyncDirtyItemsMessage = {
            type: 'syncDirtyItems',
            columns: dirtyColumns,
            tasks: dirtyTasks
        };
        this._webviewBridge.send(syncMessage);

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
                if (this._context.initialBoardLoad) {
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
                if (this._context.initialBoardLoad) {
                    return;
                }

                // RACE-3: Only process if this event is newer than last processed
                // When multiple external changes happen rapidly, reloads can complete out of order.
                // This ensures only the newest data is applied to the frontend.
                if (!this._concurrency.isEventNewer(file.getRelativePath(), event.timestamp)) {
                    return;
                }

                // File has been reloaded (either from external change or manual reload)
                // Send updated content to frontend via coordinator
                this._includeCoordinator.sendIncludeFileUpdateToFrontend(file);
            }
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
            const shortcutsMessage: UpdateShortcutsMessage = {
                type: 'updateShortcuts',
                shortcuts: shortcuts
            };
            this._webviewBridge.send(shortcutsMessage);
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
            const configMessage: ConfigurationUpdateMessage = {
                type: 'configurationUpdate',
                config: config
            };
            this._webviewBridge.send(configMessage);

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

        // BoardUpdateMessage type matches getBoardViewConfig() output
        const message = {
            type: 'boardUpdate' as const,
            board: board,
            ...(viewConfig as Partial<BoardUpdateMessage>),
            // Optional fields for full board loads
            ...(options.isFullRefresh !== undefined && { isFullRefresh: options.isFullRefresh }),
            ...(options.applyDefaultFolding !== undefined && { applyDefaultFolding: options.applyDefaultFolding }),
            ...(options.version && { version: options.version })
        } as BoardUpdateMessage;

        this._webviewBridge.send(message);
    }

    // NOTE: The following functions have been migrated to event handlers:
    // - _updateMediaTrackingFromIncludes() → BoardSyncHandler (handles 'board:loaded')
    // - _checkMediaFilesForChanges() → FileSyncHandler (handles 'focus:gained')
    // - _checkIncludeFilesForExternalChanges() → FileSyncHandler (handles 'focus:gained')
    //
    // INIT and FOCUS pathways now use the same unified code path in FileSyncHandler.

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
        // Panel is already disposed by VS Code when onDidDispose fires
        // Must remove before showing any dialogs (which await user input)
        const trackedUri = this._context.trackedDocumentUri;
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
     * Save unsaved changes to backup files with ".{name}-unsavedchanges" naming (hidden)
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

                    // Create backup filename: "file.md" -> ".file-unsavedchanges.md" (hidden)
                    const ext = path.extname(filePath);
                    const baseName = path.basename(filePath, ext);
                    const dirName = path.dirname(filePath);
                    const backupPath = path.join(dirName, `.${baseName}-unsavedchanges${ext}`);

                    fs.writeFileSync(backupPath, content, 'utf8');
                }
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

                            // Create backup filename: "include.md" -> ".include-unsavedchanges.md" (hidden)
                            const ext = path.extname(filePath);
                            const baseName = path.basename(filePath, ext);
                            const dirName = path.dirname(filePath);
                            const backupPath = path.join(dirName, `.${baseName}-unsavedchanges${ext}`);

                            fs.writeFileSync(backupPath, content, 'utf8');
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
        if (this._context.disposed) {
            return;
        }
        this._context.setDisposed(true);

        // CRITICAL: Remove from panels map IMMEDIATELY to prevent reuse of disposing panel
        // This must happen BEFORE any async operations or cleanup
        const trackedUri = this._context.trackedDocumentUri;
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
        this._context.setClosingPrevented(false);

        this._webviewBridge.dispose();

        // Clear panel state
        KanbanWebviewPanel.panelStates.delete(this._context.panelId);

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

        // Dispose media tracker (saves final cache state)
        if (this._mediaTracker) {
            this._mediaTracker.dispose();
            this._mediaTracker = null;
        }

        // Dispose event-driven board sync handler
        if (this._boardSyncHandler) {
            this._boardSyncHandler.dispose();
            this._boardSyncHandler = null;
        }

        // Dispose file sync handler
        if (this._fileSyncHandler) {
            this._fileSyncHandler.dispose();
            this._fileSyncHandler = null;
        }

        this._fileRegistry.dispose();
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
