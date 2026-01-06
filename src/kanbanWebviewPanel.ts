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
import { KanbanFileService } from './kanbanFileService';
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
import { PanelContext, ConcurrencyManager, IncludeFileCoordinator, WebviewManager } from './panel';
import { cleanupAutoExportSubscription } from './commands';
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

    private _fileManager: FileManager;
    private _boardOperations: BoardOperations;
    private _linkHandler: LinkHandler;
    private _messageHandler: MessageHandler;
    private _backupManager: BackupManager;
    private _fileService: KanbanFileService;
    private _fileRegistry: MarkdownFileRegistry;
    private _fileFactory: FileFactory;
    private _stateMachine: ChangeStateMachine;
    private _context: PanelContext;
    private _concurrency: ConcurrencyManager;
    private _includeCoordinator: IncludeFileCoordinator;
    private _webviewManager: WebviewManager;
    private _conflictResolver: ConflictResolver;
    private _mediaTracker: MediaTracker | null = null;
    private _boardStore: BoardStore;
    private _webviewBridge: WebviewBridge;

    // Handlers (inlined from HandlerRegistry for simplicity)
    private _boardSyncHandler: BoardSyncHandler | null = null;
    private _fileSyncHandler: FileSyncHandler | null = null;
    private _linkReplacementHandler: LinkReplacementHandler | null = null;
    private _boardInitHandler: BoardInitializationHandler | null = null;
    private _fileRegistryChangeHandler: FileRegistryChangeHandler | null = null;
    private _unsavedChangesService: UnsavedChangesService | null = null;
    private _webviewUpdateService: WebviewUpdateService | null = null;

    public get _isUpdatingFromPanel(): boolean { return this._context.updatingFromPanel; }
    public set _isUpdatingFromPanel(value: boolean) { this._context.setUpdatingFromPanel(value); }
    public get webview(): vscode.Webview { return this._panel.webview; }

    public async refreshWebviewContent() {
        if (!this._panel || !this.getBoard()) return;
        this._context.setWebviewReady(false);
        this._panel.webview.html = this._webviewManager.generateHtml();
        this.sendBoardUpdate(false, true);
    }

    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext, document?: vscode.TextDocument) {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

        if (document) {
            const existingPanel = KanbanWebviewPanel.panels.get(document.uri.toString());
            if (existingPanel?._panel) {
                existingPanel._panel.reveal(column);
                existingPanel._fileManager.sendFileInfo();
                existingPanel.loadMarkdownFile(document);
                return;
            }
        }

        const localResourceRoots = KanbanWebviewPanel._buildResourceRoots(extensionUri, document);
        const fileName = document ? path.basename(document.fileName) : 'Markdown Kanban';

        const panel = vscode.window.createWebviewPanel(
            KanbanWebviewPanel.viewType,
            `Kanban: ${fileName}`,
            column,
            { enableScripts: true, localResourceRoots, retainContextWhenHidden: true, enableCommandUris: true }
        );

        const kanbanPanel = new KanbanWebviewPanel(panel, extensionUri, context);

        if (document) {
            const docUri = document.uri.toString();
            kanbanPanel._context.setTrackedDocumentUri(docUri);
            KanbanWebviewPanel.panels.set(docUri, kanbanPanel);
            kanbanPanel.loadMarkdownFile(document);
        }
    }

    private static _buildResourceRoots(extensionUri: vscode.Uri, document?: vscode.TextDocument): vscode.Uri[] {
        const roots = [extensionUri];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (workspaceFolders) {
            workspaceFolders.forEach(folder => roots.push(folder.uri));
        }

        if (document) {
            const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
            const isInWorkspace = workspaceFolders?.some(folder =>
                documentDir.fsPath.startsWith(folder.uri.fsPath)
            );
            if (!isInWorkspace) roots.push(documentDir);
        }

        return roots;
    }

    private static _revivedUris: Set<string> = new Set();

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext, state?: any) {
        console.log('[KanbanWebviewPanel.revive] START - state:', JSON.stringify(state));
        console.log('[KanbanWebviewPanel.revive] Panel title from VS Code:', panel.title);

        const localResourceRoots = KanbanWebviewPanel._buildResourceRoots(extensionUri);
        panel.webview.options = { enableScripts: true, localResourceRoots };

        const kanbanPanel = new KanbanWebviewPanel(panel, extensionUri, context);
        const documentPath = state?.documentUri;

        console.log('[KanbanWebviewPanel.revive] documentPath from state:', documentPath);

        // Validate: must be a non-empty string that looks like a file path
        if (documentPath && typeof documentPath === 'string' && documentPath.length > 0) {
            // Convert file path to URI if needed
            const documentUri = documentPath.includes('://')
                ? vscode.Uri.parse(documentPath)
                : vscode.Uri.file(documentPath);

            KanbanWebviewPanel._revivedUris.add(documentUri.toString());
            setTimeout(() => KanbanWebviewPanel._revivedUris.clear(), REVIVAL_TRACKING_CLEAR_DELAY_MS);

            (async () => {
                try {
                    console.log('[KanbanWebviewPanel.revive] Opening document:', documentUri.toString());
                    const document = await vscode.workspace.openTextDocument(documentUri);
                    console.log('[KanbanWebviewPanel.revive] Document opened successfully:', document.fileName);
                    await kanbanPanel.loadMarkdownFile(document);
                    console.log('[KanbanWebviewPanel.revive] loadMarkdownFile completed');
                } catch (err) {
                    console.error('[KanbanWebviewPanel.revive] Failed to revive document:', err);
                }
            })();
        } else {
            console.warn('[KanbanWebviewPanel.revive] No valid documentPath in state');
        }
    }

    private static _findUnrevivedDocumentUri(context: vscode.ExtensionContext): string | undefined {
        const panelKeys = context.globalState.keys().filter(key =>
            key.startsWith('kanban_panel_') || key.startsWith('kanban_doc_')
        );

        const availableStates = panelKeys
            .map(key => context.globalState.get<PersistedPanelState>(key))
            .filter((s): s is PersistedPanelState =>
                !!s?.documentUri && !KanbanWebviewPanel._revivedUris.has(s.documentUri)
            )
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

        return availableStates[0]?.documentUri;
    }

    public static getPanelForDocument(documentUri: string): KanbanWebviewPanel | undefined {
        return KanbanWebviewPanel.panels.get(documentUri);
    }

    public static getAllPanels(): KanbanWebviewPanel[] {
        return Array.from(KanbanWebviewPanel.panels.values());
    }

    public getPanelId(): string { return this._context.panelId; }
    public getPanel(): vscode.WebviewPanel { return this._panel; }
    public hasUnsavedChanges(): boolean { return this._fileRegistry.getMainFile()?.hasUnsavedChanges() || false; }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._extensionContext = context;

        const isDevelopment = !context.extensionMode || context.extensionMode === vscode.ExtensionMode.Development;
        this._context = new PanelContext(undefined, isDevelopment);
        this._concurrency = new ConcurrencyManager(isDevelopment);

        this._boardStore = new BoardStore({ webview: this._panel.webview, maxUndoStackSize: MAX_UNDO_STACK_SIZE });
        this._webviewBridge = new WebviewBridge({ maxBatchSize: MAX_BATCH_SIZE, batchFlushDelay: BATCH_FLUSH_DELAY_MS, debug: isDevelopment });
        this._webviewBridge.setWebview(this._panel.webview);

        this._fileManager = new FileManager(this._panel.webview, extensionUri);
        this._boardOperations = new BoardOperations();
        this._backupManager = new BackupManager();
        this._conflictResolver = this._context.conflictResolver;

        this._fileRegistry = new MarkdownFileRegistry(this._context);
        this._fileFactory = new FileFactory(this._fileManager, this._conflictResolver, this._backupManager, this._fileRegistry);
        this._stateMachine = new ChangeStateMachine(this._fileRegistry, this, this._context);

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

        this._webviewManager = new WebviewManager({
            extensionUri: this._extensionUri,
            extensionContext: this._extensionContext,
            getPanel: () => this._panel,
            getDocument: () => this._fileManager.getDocument(),
            getBoard: () => this.getBoard(),
            isInitialized: () => this._context.initialized
        });

        this._fileRegistryChangeHandler = new FileRegistryChangeHandler({
            fileRegistry: this._fileRegistry,
            boardStore: this._boardStore,
            panelContext: this._context,
            concurrencyManager: this._concurrency,
            includeCoordinator: this._includeCoordinator,
            getBoard: () => this.getBoard(),
            invalidateBoardCache: () => this.invalidateBoardCache(),
            sendBoardUpdate: (applyDefaultFolding, isFullRefresh) => this.sendBoardUpdate(applyDefaultFolding, isFullRefresh)
        });

        this._fileService = new KanbanFileService(
            this._fileManager, this._fileRegistry, this._fileFactory, this._backupManager, this._boardOperations,
            {
                boardStore: this._boardStore,
                extensionContext: this._extensionContext,
                getPanel: () => this._panel,
                getPanelInstance: () => this,
                getWebviewManager: () => this._webviewManager,
                sendBoardUpdate: (applyDefaultFolding, isFullRefresh) => this.sendBoardUpdate(applyDefaultFolding, isFullRefresh)
            },
            this._context, KanbanWebviewPanel.panelStates, KanbanWebviewPanel.panels
        );

        this._linkHandler = new LinkHandler(this._fileManager, this._context);
        this.setupDocumentChangeListener();

        this._messageHandler = new MessageHandler(this._fileManager, this._boardStore, this._boardOperations, this._linkHandler, {
            onBoardUpdate: this.sendBoardUpdate.bind(this),
            onSaveToMarkdown: this.saveToMarkdown.bind(this),
            onInitializeFile: this.initializeFile.bind(this),
            getWebviewPanel: () => this,
            getWebviewBridge: () => this._webviewBridge,
            emitBoardChanged: (board: KanbanBoard, trigger?: BoardChangeTrigger) => this.emitBoardChanged(board, trigger)
        }, this._context);

        this._fileRegistry.setMessageHandler(this._messageHandler);
        this._initialize();
        this._setupEventListeners();
        this._setupWorkspaceChangeListener();
        this._setupDocumentCloseListener();
        this._registerHandlers();
    }

    private _registerHandlers(): void {
        this._boardSyncHandler = new BoardSyncHandler({
            boardStore: this._boardStore, fileRegistry: this._fileRegistry, getMediaTracker: () => this._mediaTracker,
            backupManager: this._backupManager, getDocument: () => this._fileManager.getDocument(), panelContext: this._context
        });
        this._fileSyncHandler = new FileSyncHandler({
            fileRegistry: this._fileRegistry, boardStore: this._boardStore, getMediaTracker: () => this._mediaTracker,
            getWebviewBridge: () => this._webviewBridge, getBoard: () => this.getBoard(), panelContext: this._context,
            sendBoardUpdate: (isFullRefresh, applyDefaultFolding) => this.sendBoardUpdate(isFullRefresh, applyDefaultFolding),
            emitBoardLoaded: (board) => this.emitBoardLoaded(board)
        });
        this._linkReplacementHandler = new LinkReplacementHandler({
            boardStore: this._boardStore, fileRegistry: this._fileRegistry, webviewBridge: this._webviewBridge, getBoard: () => this.getBoard(), panelContext: this._context
        });
        this._unsavedChangesService = new UnsavedChangesService(this._fileRegistry);
        this._webviewUpdateService = new WebviewUpdateService({
            boardStore: this._boardStore, webviewBridge: this._webviewBridge, fileRegistry: this._fileRegistry,
            webviewManager: this._webviewManager, panelContext: this._context, getBoard: () => this.getBoard(), hasPanel: () => !!this._panel
        });
        this._boardInitHandler = new BoardInitializationHandler({
            fileRegistry: this._fileRegistry, fileFactory: this._fileFactory, includeCoordinator: this._includeCoordinator,
            panelContext: this._context, getFileSyncHandler: () => this._fileSyncHandler,
            getBoard: () => this.getBoard(), getPanel: () => this._panel,
            onMediaChanged: (files) => this._panel?.webview.postMessage({
                type: 'mediaFilesChanged', changedFiles: files.map(f => ({ path: f.path, absolutePath: f.absolutePath, type: f.type }))
            })
        });
    }

    private _setupDocumentCloseListener() {
        this._disposables.push(vscode.workspace.onDidCloseTextDocument(document => {
            const currentDoc = this._fileManager.getDocument();
            if (currentDoc?.uri.toString() === document.uri.toString()) {
                this._fileManager.clearDocument();
                this._fileManager.sendFileInfo();
            }
        }));
    }

    private _setupWorkspaceChangeListener() {
        this._disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this._webviewManager.updatePermissions()));
    }

    public isFileLocked(): boolean { return this._fileManager.isFileLocked(); }
    public toggleFileLock(): void { this._fileManager.toggleFileLock(); }
    public getCurrentDocumentUri(): vscode.Uri | undefined { return this._fileManager.getCurrentDocumentUri(); }

    private _initialize() {
        if (!this._context.initialized) {
            this._context.setWebviewReady(false);
            this._panel.webview.html = this._webviewManager.generateHtml();
            this._context.setInitialized(true);
        }
    }

    private _restoreStateFromFileService(): void {
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
    }

    private _setupEventListeners() {
        this._panel.onDidDispose(() => this._handlePanelClose(), null, this._disposables);

        this._panel.onDidChangeViewState(async e => {
            if (e.webviewPanel.visible) {
                this._fileManager.sendFileInfo();
                this.syncDirtyItems();
                await this.refreshConfiguration();
                this._context.scopedEventBus.emit('focus:gained', {});

                if (this._fileManager.getDocument() && (!this.getBoard() || !this._context.initialized)) {
                    this._ensureBoardAndSendUpdate();
                }
            }
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'webviewReady') {
                this._handleWebviewReady();
                return;
            }
            try {
                await this._messageHandler.handleMessage(message);
            } catch (error) {
                console.error(`[PANEL] Error handling message ${message.type}:`, error);
            }
        }, null, this._disposables);
    }

    private _handleWebviewReady(): void {
        const wasAlreadyReady = this._context.webviewReady;
        this._context.setWebviewReady(true);
        console.log('[KanbanWebviewPanel._handleWebviewReady] wasAlreadyReady:', wasAlreadyReady);

        const pendingUpdate = this._context.consumePendingBoardUpdate();
        console.log('[KanbanWebviewPanel._handleWebviewReady] pendingUpdate:', pendingUpdate);
        if (pendingUpdate) {
            console.log('[KanbanWebviewPanel._handleWebviewReady] Sending pending update');
            this._fileManager.sendFileInfo();
            this.sendBoardUpdate(pendingUpdate.applyDefaultFolding, pendingUpdate.isFullRefresh);
            return;
        }

        // No pending update - check if this is a duplicate ready message
        if (wasAlreadyReady) {
            // Already handled webviewReady before - skip duplicate
            console.log('[KanbanWebviewPanel._handleWebviewReady] Duplicate webviewReady - skipping');
            return;
        }

        // First ready without pending update - nothing to do
        console.log('[KanbanWebviewPanel._handleWebviewReady] First ready, no pending update - exiting');
    }

    private async _ensureBoardAndSendUpdate() {
        await this._fileService.ensureBoardAndSendUpdate();
        this._restoreStateFromFileService();
    }

    public async loadMarkdownFile(document: vscode.TextDocument, forceReload: boolean = false) {
        console.log('[KanbanWebviewPanel.loadMarkdownFile] START - document:', document.fileName);
        return this._concurrency.withLock('loadMarkdownFile', async () => {
            this._context.setInitialBoardLoad(true);
            await this._fileService.loadMarkdownFile(document, forceReload);
            console.log('[KanbanWebviewPanel.loadMarkdownFile] fileService.loadMarkdownFile completed');
            this._restoreStateFromFileService();
            await this._initializeBoardFromDocument(document);
            console.log('[KanbanWebviewPanel.loadMarkdownFile] DONE - board valid:', this.getBoard()?.valid);
        });
    }

    private async sendBoardUpdate(applyDefaultFolding: boolean = false, isFullRefresh: boolean = false) {
        console.log('[KanbanWebviewPanel.sendBoardUpdate] webviewReady:', this._context.webviewReady, 'hasService:', !!this._webviewUpdateService);
        await this._webviewUpdateService?.sendBoardUpdate({ applyDefaultFolding, isFullRefresh });
    }

    public async saveToMarkdown(updateVersionTracking: boolean = true, triggerSave: boolean = true) {
        await this._fileService.saveToMarkdown(updateVersionTracking, triggerSave);
        this._restoreStateFromFileService();
    }

    private async initializeFile() {
        await this._fileService.initializeFile();
        this._restoreStateFromFileService();
    }

    private async _initializeBoardFromDocument(document: vscode.TextDocument): Promise<void> {
        if (!this._boardInitHandler) return;
        const result = await this._boardInitHandler.initializeFromDocument(document, this._mediaTracker);
        this._mediaTracker = result.mediaTracker;
    }

    public setEditingInProgress(isEditing: boolean): void { this._context.setEditingInProgress(isEditing); }
    public markColumnDirty(columnId: string): void { this._boardStore.markColumnDirty(columnId); }
    public markTaskDirty(taskId: string): void { this._boardStore.markTaskDirty(taskId); }
    public clearColumnDirty(columnId: string): void { this._boardStore.clearColumnDirty(columnId); }
    public clearTaskDirty(taskId: string): void { this._boardStore.clearTaskDirty(taskId); }

    public syncDirtyItems(): void { this._webviewUpdateService?.syncDirtyItems(); }

    public async handleIncludeSwitch(params: {
        columnId?: string; taskId?: string; oldFiles: string[]; newFiles: string[];
        newTitle?: string; preloadedContent?: Map<string, string>;
    }): Promise<void> {
        return this._includeCoordinator.handleIncludeSwitch(params);
    }

    public async refreshConfiguration(): Promise<void> {
        await this._webviewUpdateService?.refreshAllConfiguration();
    }

    /** Get board - returns cached or generates fresh from registry */
    public getBoard(): KanbanBoard | undefined {
        if (this._boardStore.isCacheValid()) {
            const cachedBoard = this._boardStore.getBoard();
            if (cachedBoard) return cachedBoard;
        }

        // Generate fresh board, preserving existing IDs to prevent "Column not found" errors
        const existingBoard = this._boardStore.getBoard();
        const board = this._fileRegistry.generateBoard(existingBoard || undefined);
        if (board) this._boardStore.setBoard(board);
        return board;
    }

    /** Emit board:changed event - triggers BoardSyncHandler for sync/save/backup */
    public emitBoardChanged(board: KanbanBoard, trigger: BoardChangeTrigger = 'edit'): void {
        this._context.scopedEventBus.emit('board:changed', { board, trigger });
    }

    /** Emit board:loaded event - triggers media tracking for include files */
    public emitBoardLoaded(board: KanbanBoard): void {
        this._context.scopedEventBus.emit('board:loaded', { board });
    }

    /** Invalidate board cache (blocked during include switches to prevent ID regeneration) */
    public invalidateBoardCache(): void {
        if (!this._context.includeSwitchInProgress) this._boardStore.invalidateCache();
    }

    /** Set include switch in-progress flag - blocks cache invalidation when true */
    public setIncludeSwitchInProgress(inProgress: boolean): void {
        this._context.setIncludeSwitchInProgress(inProgress);
    }

    private async _handlePanelClose() {
        // Remove from panels map immediately to prevent reuse during disposal
        this._removeFromPanelsMap();

        if (!this._unsavedChangesService) return this.dispose();

        const unsavedInfo = this._unsavedChangesService.checkForUnsavedChanges();
        if (!unsavedInfo.hasMainFileChanges && !unsavedInfo.hasIncludeFileChanges) return this.dispose();

        const choice = await this._unsavedChangesService.showUnsavedChangesDialog(unsavedInfo);
        if (choice === 'save') {
            try { await this.saveToMarkdown(true, true); }
            catch (error) { vscode.window.showErrorMessage(`Failed to save: ${getErrorMessage(error)}`); }
        } else {
            this._unsavedChangesService.discardAllChanges();
        }
        this.dispose();
    }

    private _removeFromPanelsMap(): void {
        const trackedUri = this._context.trackedDocumentUri;
        if (trackedUri && KanbanWebviewPanel.panels.get(trackedUri) === this) {
            KanbanWebviewPanel.panels.delete(trackedUri);
        }
        for (const [uri, panel] of KanbanWebviewPanel.panels.entries()) {
            if (panel === this) KanbanWebviewPanel.panels.delete(uri);
        }
    }

    private tryAutoLoadActiveMarkdown() {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor?.document.languageId === 'markdown') {
            this.loadMarkdownFile(activeEditor.document);
        }
    }

    /** Check if this panel has unsaved changes */
    public async checkUnsavedChanges(): Promise<boolean> {
        return this._fileRegistry.hasAnyUnsavedChanges();
    }

    /** Save unsaved changes to backup files */
    public async saveUnsavedChangesBackup(): Promise<void> {
        await this._unsavedChangesService?.saveBackups(this.getCurrentDocumentUri());
    }

    public async dispose() {
        if (this._context.disposed) return;
        this._context.setDisposed(true);

        this._removeFromPanelsMap();

        this._fileRegistry.getMainFile()?.discardChanges();
        this._context.setClosingPrevented(false);

        this._webviewBridge.dispose();
        KanbanWebviewPanel.panelStates.delete(this._context.panelId);
        this._concurrency.dispose();

        const document = this._fileManager.getDocument();
        if (document) {
            SaveEventDispatcher.getInstance().unregisterHandler(`panel-${document.uri.fsPath}`);
            // Cleanup auto-export subscription to prevent memory leak
            cleanupAutoExportSubscription(document.uri.fsPath);
        }

        this._backupManager.dispose();
        this._mediaTracker?.dispose();
        this._mediaTracker = null;

        // Dispose handlers in reverse registration order
        this._webviewUpdateService?.dispose();
        this._fileRegistryChangeHandler?.dispose();
        this._linkReplacementHandler?.dispose();
        this._fileSyncHandler?.dispose();
        this._boardSyncHandler?.dispose();
        // Note: unsavedChangesService and boardInitHandler don't need disposal

        this._fileRegistry.dispose();
        this._boardStore.dispose();
        this._panel.dispose();

        while (this._disposables.length) this._disposables.pop()?.dispose();
    }

    public get backupManager(): BackupManager { return this._backupManager; }
    public get fileRegistry(): MarkdownFileRegistry { return this._fileRegistry; }
    public get fileFactory(): FileFactory { return this._fileFactory; }

    private setupDocumentChangeListener(): void {
        this._fileService.setupDocumentChangeListener(this._disposables);
    }

    public ensureIncludeFileRegistered(relativePath: string, type: 'regular' | 'column' | 'task'): void {
        this._fileRegistry.ensureIncludeFileRegistered(relativePath, type, this._fileFactory);
    }

    public async showConflictDialog(context: ConflictContext): Promise<ConflictResolution> {
        return this._conflictResolver.resolveConflict(context);
    }

    public triggerSnippetInsertion(): void {
        if (this._panel) this._webviewBridge.send({ type: 'triggerSnippet' } as TriggerSnippetMessage);
    }
}
