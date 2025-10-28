import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { MarkdownKanbanParser, KanbanBoard, KanbanColumn, KanbanTask } from './markdownParser';
import { PresentationParser } from './presentationParser';
import { FileManager, ImagePathMapping } from './fileManager';
import { UndoRedoManager } from './undoRedoManager';
import { BoardOperations } from './boardOperations';
import { LinkHandler } from './linkHandler';
import { MessageHandler } from './messageHandler';
import { BackupManager } from './backupManager';
import { ConflictResolver, ConflictContext, ConflictResolution } from './conflictResolver';
import { configService, ConfigurationService } from './configurationService';
import { PathResolver } from './services/PathResolver';
import { FileWriter } from './services/FileWriter';
import { FormatConverter } from './services/FormatConverter';
import { SaveEventCoordinator } from './saveEventCoordinator';
import { IncludeFileManager } from './includeFileManager';
import { KanbanFileService } from './kanbanFileService';
import { ConflictService } from './conflictService';
import { LinkOperations } from './utils/linkOperations';
import {
    MarkdownFileRegistry,
    FileFactory,
    FileChangeEvent,
    MarkdownFile,
    MainKanbanFile,
    IncludeFile,
    ColumnIncludeFile,
    TaskIncludeFile,
    RegularIncludeFile
} from './files';

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
    private _undoRedoManager: UndoRedoManager;
    private _boardOperations: BoardOperations;
    private _linkHandler: LinkHandler;
    private _messageHandler: MessageHandler;

    private _backupManager: BackupManager;
    private _includeFileManager: IncludeFileManager;
    private _fileService: KanbanFileService;
    private _conflictService: ConflictService;

    // File abstraction system
    private _fileRegistry: MarkdownFileRegistry;
    private _fileFactory: FileFactory;

    // State
    private _board?: KanbanBoard;
    private _isInitialized: boolean = false;
    public _isUpdatingFromPanel: boolean = false;  // Made public for external access
    private _lastDocumentVersion: number = -1;  // Track document version
    private _isUndoRedoOperation: boolean = false;  // Track undo/redo operations
    private _unsavedChangesCheckInterval?: NodeJS.Timeout;  // Periodic unsaved changes check
    // REMOVED: _hasUnsavedChanges - now queried from MarkdownFile (single source of truth)
    private _cachedBoardFromWebview: any = null;  // Store the latest cached board from webview
    private _isClosingPrevented: boolean = false;  // Flag to prevent recursive closing attempts
    private _lastDocumentUri?: string;  // Track current document for serialization
    private _filesToRemoveAfterSave: string[] = [];  // Files to remove after unsaved changes are handled
    private _unsavedFilesToPrompt: string[] = [];  // Files with unsaved changes that need user prompt

    // Dirty tracking: Items with unrendered changes (cache updated but DOM not synced)
    private _dirtyColumns = new Set<string>();  // Column IDs with unrendered changes
    private _dirtyTasks = new Set<string>();    // Task IDs with unrendered changes

    private _panelId: string;  // Unique identifier for this panel
    private _trackedDocumentUri: string | undefined;  // Track the document URI for panel map management

    // Unified include file tracking system - single source of truth
    private _recentlyReloadedFiles: Set<string> = new Set(); // Track files that were just reloaded from external
    private _conflictResolver: ConflictResolver;

    // CRITICAL: Prevent board regeneration during editing
    private _isEditingInProgress: boolean = false;  // Track if user is actively editing

    // CRITICAL: Prevent board regeneration during initial include file loading
    private _isInitialBoardLoad: boolean = false;  // Track if we're loading include files for first time

    // Public getter for webview to allow proper access from messageHandler
    public get webview(): vscode.Webview {
        return this._panel.webview;
    }

    // Method to force refresh webview content (useful during development)
    public async refreshWebviewContent() {
        if (this._panel && this._board) {
            this._panel.webview.html = this._getHtmlForWebview();

            // Send the board data to the refreshed webview
            // Note: There's a race condition where the webview JavaScript might not be ready yet.
            // Ideally the webview should send a 'ready' message and we wait for that (request-response pattern).
            // For now, sending immediately and the webview should handle late-arriving messages gracefully.
            this._panel.webview.postMessage({
                type: 'boardUpdate',
                board: this._board,
                columnWidth: configService.getConfig('columnWidth', '350px'),
                taskMinHeight: configService.getConfig('taskMinHeight'),
                sectionHeight: configService.getConfig('sectionHeight'),
                taskSectionHeight: configService.getConfig('taskSectionHeight'),
                fontSize: configService.getConfig('fontSize'),
                fontFamily: configService.getConfig('fontFamily'),
                whitespace: configService.getConfig('whitespace', '8px'),
                layoutRows: configService.getConfig('layoutRows'),
                rowHeight: configService.getConfig('rowHeight'),
                layoutPreset: configService.getConfig('layoutPreset', 'normal'),
                layoutPresets: this._getLayoutPresetsConfiguration(),
                maxRowHeight: configService.getConfig('maxRowHeight', 0),
                tagColors: configService.getConfig('tagColors', {}),
                enabledTagCategoriesColumn: configService.getEnabledTagCategoriesColumn(),
                enabledTagCategoriesTask: configService.getEnabledTagCategoriesTask(),
                customTagCategories: configService.getCustomTagCategories()
            });
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
            kanbanPanel._trackedDocumentUri = docUri;  // Track the URI for cleanup
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
            try {
                vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri))
                    .then(async document => {
                        try {
                            await kanbanPanel.loadMarkdownFile(document);
                        } catch (error) {
                            console.warn('Failed to load document on panel revival:', error);
                            // Fallback: try to find an active markdown document
                            kanbanPanel.tryAutoLoadActiveMarkdown();
                        }
                    });
            } catch (error) {
                console.warn('Failed to open document URI on panel revival:', error);
                // Fallback: try to find an active markdown document
                kanbanPanel.tryAutoLoadActiveMarkdown();
            }
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
        return this._panelId;
    }

    public hasUnsavedChanges(): boolean {
        // Query main file for unsaved changes (single source of truth)
        const mainFile = this._fileRegistry.getMainFile();
        return mainFile?.hasUnsavedChanges() || false;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panelId = `panel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // Generate unique ID
        this._context = context;

        // Initialize components
        this._fileManager = new FileManager(this._panel.webview, extensionUri);
        this._undoRedoManager = new UndoRedoManager(this._panel.webview);
        this._boardOperations = new BoardOperations();
        this._backupManager = new BackupManager();

        // Get the conflict resolver instance (needed before IncludeFileManager)
        this._conflictResolver = ConflictResolver.getInstance();

        // Initialize file abstraction system
        this._fileRegistry = new MarkdownFileRegistry();
        this._fileFactory = new FileFactory(
            this._fileManager,
            this._conflictResolver,
            this._backupManager
        );

        // Subscribe to registry change events
        this._disposables.push(
            this._fileRegistry.onDidChange((event) => {
                this._handleFileRegistryChange(event);
            })
        );

        // Initialize IncludeFileManager
        this._includeFileManager = new IncludeFileManager(
            this._fileRegistry,
            this._fileFactory,
            this._conflictResolver,
            this._backupManager,
            () => this._fileManager.getFilePath(),
            () => this._board,
            (message) => this._panel?.webview.postMessage(message),
            () => this._isUpdatingFromPanel,
            () => this._cachedBoardFromWebview
        );

        // Initialize ConflictService
        this._conflictService = new ConflictService(
            this._fileRegistry,
            this._conflictResolver,
            this._backupManager,
            () => this._board,
            this._fileManager,
            () => this.saveToMarkdown(false),  // don't update version on conflict saves
            () => this.forceReloadFromFile(),
            this._includeFileManager,
            this._context
        );

        // Initialize KanbanFileService
        this._fileService = new KanbanFileService(
            this._fileManager,
            this._fileRegistry,
            this._includeFileManager,
            this._backupManager,
            this._boardOperations,
            () => this._board,
            (board) => { this._board = board; },
            (applyDefaultFolding, isFullRefresh) => this.sendBoardUpdate(applyDefaultFolding, isFullRefresh),
            () => this._panel,
            () => this._context,
            (context) => this._conflictService.showConflictDialog(context),
            (document) => this._conflictService.notifyExternalChanges(
                document,
                () => this._messageHandler?.getUnifiedFileState(),
                this._undoRedoManager,
                this._cachedBoardFromWebview
            ),
            () => this._updateWebviewPermissions(),
            () => this._undoRedoManager.clear(),
            KanbanWebviewPanel.panelStates,
            KanbanWebviewPanel.panels,
            () => this
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
            this._undoRedoManager,
            this._boardOperations,
            this._linkHandler,
            {
                onBoardUpdate: this.sendBoardUpdate.bind(this),
                onSaveToMarkdown: this.saveToMarkdown.bind(this),
                onInitializeFile: this.initializeFile.bind(this),
                getCurrentBoard: () => this._board,
                setBoard: (board: KanbanBoard) => {
                    this._board = board;
                },
                setUndoRedoOperation: (isOperation: boolean) => {
                    this._isUndoRedoOperation = isOperation;
                },
                getWebviewPanel: () => this,
                saveWithBackup: (label?: string) => this._conflictService.createUnifiedBackup(label || 'conflict'),
                markUnsavedChanges: async (hasChanges: boolean, cachedBoard?: any) => {
                    console.log('[markUnsavedChanges callback] ===== CALLBACK INVOKED =====');
                    console.log('[markUnsavedChanges callback] hasChanges:', hasChanges);
                    console.log('[markUnsavedChanges callback] cachedBoard exists:', !!cachedBoard);

                    if (!this._isRegistryReady()) {
                        console.log('[markUnsavedChanges callback] Registry not ready');
                        return;
                    }

                    // CRITICAL: Update cached board BEFORE any file operations
                    // This ensures file watchers triggered by saves see the latest board state
                    if (cachedBoard) {
                        this._board = cachedBoard;
                        this._cachedBoardFromWebview = cachedBoard;
                    }

                    if (hasChanges && cachedBoard) {
                        // User edited the board - update backend cache via unified handler
                        // NOTE: This updates cache (setContent), NOT disk. Saving is separate.
                        console.log('[markUnsavedChanges callback] User edited board - updating backend cache');

                        // Track changes in include files (updates their cache)
                        await this._includeFileManager.trackIncludeFileUnsavedChanges(cachedBoard, () => this._fileManager.getDocument(), () => this._fileManager.getFilePath());

                        // Update main file cache - CRITICAL: use updateFromBoard to update BOTH content AND board object
                        const mainFile = this._getMainFile();
                        if (mainFile) {
                            // updateFromBoard() updates both this._board and this._content
                            // This ensures that when save() is called, it has the correct board to regenerate from
                            mainFile.updateFromBoard(cachedBoard);
                        }

                        // Track when unsaved changes occur for backup timing
                        this._backupManager.markUnsavedChanges();

                        // Attempt to create backup if minimum interval has passed
                        const document = this._fileManager.getDocument();
                        if (document) {
                            this._backupManager.createBackup(document, { label: 'auto' })
                                .catch(error => console.error('Cache update backup failed:', error));
                        }
                    } else {
                        // ARCHITECTURE: Frontend can only mark changes (true), never clear them (false)
                        // Only backend can clear unsaved changes after save completes
                        if (!hasChanges && !cachedBoard) {
                            console.warn('[markUnsavedChanges callback] IGNORING invalid markUnsavedChanges(false) from frontend - only backend can clear unsaved state');
                            return;
                        }

                        // If we get here, it's a valid state change from frontend (marking something as changed)
                        if (cachedBoard) {
                            // Frontend sent board changes - mark main file as having unsaved changes
                            // CRITICAL: use updateFromBoard to update BOTH content AND board object
                            const mainFile = this._getMainFile();
                            if (mainFile) {
                                mainFile.updateFromBoard(cachedBoard);
                            }
                        } else if (hasChanges) {
                            // Frontend marking as changed without board (edge case) - should not happen
                            console.warn('[markUnsavedChanges callback] hasChanges=true but no cachedBoard provided');
                        }
                    }
                }
            }
        );

        // Initialize state in KanbanFileService
        this._fileService.initializeState(
            this._isUpdatingFromPanel,
            // REMOVED: _hasUnsavedChanges parameter - now managed by MarkdownFile
            this._cachedBoardFromWebview,
            this._lastDocumentVersion,
            this._lastDocumentUri,
            this._trackedDocumentUri,
            this._panelId
        );

        this._initialize();
        this._setupEventListeners();

        // ENHANCED: Listen for workspace folder changes
        this._setupWorkspaceChangeListener();

        // Listen for document close events
        this._setupDocumentCloseListener();

        // Document will be loaded via loadMarkdownFile call from createOrShow
    }

    // ============= END UNIFIED INCLUDE FILE SYSTEM METHODS =============

    private async handleLinkReplacement(originalPath: string, newPath: string, isImage: boolean, taskId?: string, columnId?: string, linkIndex?: number) {
        if (!this._board || !this._board.valid) { return; }

        this._undoRedoManager.saveStateForUndo(this._board);

        let modified = false;

        // URL encode the new path for proper markdown links
        const encodedNewPath = encodeURI(newPath).replace(/[()]/g, (match) => {
            return match === '(' ? '%28' : '%29';
        });

        // If we have specific context, target only that link instance
        if (taskId && columnId) {
            // Find the specific column and task
            const targetColumn = this._board.columns.find(col => col.id === columnId);
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
            const targetColumn = this._board.columns.find(col => col.id === columnId);
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
            for (const column of this._board.columns) {
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
            const mainFile = this._getMainFile();
            if (mainFile && this._board) {
                // CRITICAL: use updateFromBoard to update BOTH content AND board object
                mainFile.updateFromBoard(this._board);
            }

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
                this._updateWebviewPermissions();
        });
        
        this._disposables.push(workspaceChangeListener);
    }

    /**
     * Update webview permissions to include all current workspace folders
     */
    private _updateWebviewPermissions() {
        const localResourceRoots = this._buildLocalResourceRoots(false);

        // Update webview options
        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots,
            enableCommandUris: true
        };

        // Refresh the webview HTML to apply new permissions
        if (this._isInitialized) {
            this._panel.webview.html = this._getHtmlForWebview();
        }
    }

    /**
     * Update webview permissions to include asset directories from the board
     * This is called before sending board updates to ensure all assets can be loaded
     */
    private _updateWebviewPermissionsForAssets() {
        const localResourceRoots = this._buildLocalResourceRoots(true);

        // Update webview options
        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots,
            enableCommandUris: true
        };
    }

    /**
     * Build the list of local resource roots for the webview
     * @param includeAssets - Whether to scan board for asset directories
     */
    private _buildLocalResourceRoots(includeAssets: boolean): vscode.Uri[] {
        const localResourceRoots = [this._extensionUri];

        // Add all current workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            workspaceFolders.forEach(folder => {
                localResourceRoots.push(folder.uri);
            });
        }

        // Add document directory if it's outside workspace folders
        if (this._fileManager.getDocument()) {
            const document = this._fileManager.getDocument()!;
            const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
            const isInWorkspace = workspaceFolders?.some(folder =>
                documentDir.fsPath.startsWith(folder.uri.fsPath)
            );

            if (!isInWorkspace) {
                localResourceRoots.push(documentDir);
            }

            // Scan board for asset directories if requested
            if (includeAssets) {
                const assetDirs = this._collectAssetDirectories();
                let addedCount = 0;
                for (const dir of assetDirs) {
                    const dirUri = vscode.Uri.file(dir);
                    // Check if not already included
                    const alreadyIncluded = localResourceRoots.some(root =>
                        dir.startsWith(root.fsPath)
                    );
                    if (!alreadyIncluded) {
                        localResourceRoots.push(dirUri);
                        addedCount++;
                    }
                }
                console.log(`[LocalResourceRoots] Added ${addedCount} asset directories to localResourceRoots (total: ${localResourceRoots.length})`);
            }
        }

        return localResourceRoots;
    }

    private async _getLayoutPresetsConfiguration(): Promise<any> {
        const userPresets = configService.getConfig('layoutPresets', {});

        // Default presets as fallback
        const defaultPresets = {
            overview: {
                label: "Overview",
                description: "Compact view for seeing many cards",
                settings: {
                    columnWidth: "250px",
                    cardHeight: "auto",
										sectionHeight: "auto",
										taskSectionHeight: "auto",
                    fontSize: "0_5x",
                    whitespace: "8px",
                    tagVisibility: "allexcludinglayout",
                    arrowKeyFocusScroll: "center"
                }
            },
            normal: {
                label: "Normal",
                description: "Default balanced view",
                settings: {
                    columnWidth: "350px",
                    cardHeight: "auto",
										sectionHeight: "auto",
										taskSectionHeight: "auto",
                    fontSize: "1x",
                    whitespace: "8px",
                    tagVisibility: "allexcludinglayout",
                    arrowKeyFocusScroll: "center"
                }
            },
            grid3x: {
                label: "3x3 Grid",
                description: "Grid layout for organized viewing",
                settings: {
                    columnWidth: "33percent",
                    cardHeight: "auto",
										sectionHeight: "auto",
										taskSectionHeight: "auto",
                    fontSize: "1x",
                    whitespace: "12px",
                    arrowKeyFocusScroll: "nearest"
                }
            },
						twoThirds: {
							label: "2/3 Grid",
							description: "Grid layout for organized viewing",
							settings: {
									columnWidth: "66percent",
									cardHeight: "auto",
									fontSize: "1_5x",
									whitespace: "12px",
									sectionHeight: "66percent",
									taskSectionHeight: "auto",
                  arrowKeyFocusScroll: "nearest"
							}
						},
            presentation: {
                label: "Presentation",
                description: "Full screen view for presentations",
                settings: {
                    columnWidth: "100percent",
                    cardHeight: "100percent",
                    sectionHeight: "100percent",
                    taskSectionHeight: "auto",
                    fontSize: "3x",
                    tagVisibility: "none",
                    whitespace: "16px",
                    arrowKeyFocusScroll: "center"
                }
            }
        };

        // Merge user presets with defaults (user presets override defaults)
        return { ...defaultPresets, ...userPresets };
    }

    // Public methods for external access
    public isFileLocked(): boolean {
        return this._fileService.isFileLocked();
    }

    public toggleFileLock(): void {
        this._fileService.toggleFileLock();
    }

    public getCurrentDocumentUri(): vscode.Uri | undefined {
        return this._fileService.getCurrentDocumentUri();
    }

    private _initialize() {
        if (!this._isInitialized) {
            this._panel.webview.html = this._getHtmlForWebview();
            this._isInitialized = true;
        }
    }

    private _setupEventListeners() {
        // Handle panel disposal - check for unsaved changes first
        this._panel.onDidDispose(async () => {
            await this._handlePanelClose();
        }, null, this._disposables);

        // View state change handler
        this._panel.onDidChangeViewState(
            e => {
                if (e.webviewPanel.visible) {
                    // Panel became visible - send file info
                    this._fileManager.sendFileInfo();

                    // Sync any pending DOM updates (items with unrendered changes)
                    this._syncDirtyItems();

                    // Only ensure board content is sent in specific cases to avoid unnecessary re-renders
                    // This fixes empty view issues after debug restart or workspace restore
                    // but avoids re-rendering when the view just temporarily lost focus (e.g., showing messages)
                    if (this._fileManager.getDocument()) {
                        // Only refresh if:
                        // 1. Board hasn't been initialized yet, OR
                        // 2. Board is null/undefined (needs initialization)
                        // Don't refresh just because the panel regained visibility after showing a message
                        if (!this._board || !this._isInitialized) {
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

                if (message.type === 'undo' || message.type === 'redo') {
                }

                try {
                    await this._messageHandler.handleMessage(message);
                } catch (error) {
                    console.error('[WEBVIEW PANEL ERROR] Error handling message:', error);
                    if (error instanceof Error) {
                        console.error('[WEBVIEW PANEL ERROR] Stack trace:', error.stack);
                    }
                }
            },
            null,
            this._disposables
        );
    }

    private async _ensureBoardAndSendUpdate() {
        await this._fileService.ensureBoardAndSendUpdate();
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // REMOVED: _hasUnsavedChanges sync - now queried from MarkdownFile
        this._cachedBoardFromWebview = state.cachedBoardFromWebview;
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    public async loadMarkdownFile(document: vscode.TextDocument, isFromEditorFocus: boolean = false, forceReload: boolean = false) {
        // CRITICAL: Set initial board load flag BEFORE loading main file
        // This prevents the main file's 'reloaded' event from triggering board regeneration
        this._isInitialBoardLoad = true;
        console.log('[loadMarkdownFile] Starting initial board load - blocking reloaded events');

        await this._fileService.loadMarkdownFile(document, isFromEditorFocus, forceReload);
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // REMOVED: _hasUnsavedChanges sync - now queried from MarkdownFile
        this._cachedBoardFromWebview = state.cachedBoardFromWebview;
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;

        // Phase 1: Create or update MainKanbanFile instance
        await this._syncMainFileToRegistry(document);
    }

    private async sendBoardUpdate(applyDefaultFolding: boolean = false, isFullRefresh: boolean = false) {
        if (!this._panel.webview) { return; }

        let board = this._board || {
            valid: false,
            title: 'Please open a Markdown Kanban file',
            columns: [],
            yamlHeader: null,
            kanbanFooter: null
        };

        // Update webview permissions to include asset directories
        // This must happen before generating image mappings to ensure access
        this._updateWebviewPermissionsForAssets();

        // Generate image path mappings without modifying the board content
        const imageMappings = await this._generateImageMappings(board);
        
        // Get all configuration values
        const tagColors = configService.getConfig('tagColors', {});
        const enabledTagCategoriesColumn = configService.getEnabledTagCategoriesColumn();
        const enabledTagCategoriesTask = configService.getEnabledTagCategoriesTask();
        const customTagCategories = configService.getCustomTagCategories();
        const whitespace = configService.getConfig('whitespace', '8px');
        const taskMinHeight = configService.getConfig('taskMinHeight');
        const sectionHeight = configService.getConfig('sectionHeight');
        const taskSectionHeight = configService.getConfig('taskSectionHeight');
        const fontSize = configService.getConfig('fontSize');
        const fontFamily = configService.getConfig('fontFamily');
        const columnWidth = configService.getConfig('columnWidth', '350px');
        const layoutRows = configService.getConfig('layoutRows');
        const rowHeight = configService.getConfig('rowHeight');
        const layoutPreset = configService.getConfig('layoutPreset', 'normal');
        const layoutPresets = await this._getLayoutPresetsConfiguration();
        const maxRowHeight = configService.getConfig('maxRowHeight', 0);
        const columnBorder = configService.getConfig('columnBorder', '1px solid var(--vscode-panel-border)');
        const taskBorder = configService.getConfig('taskBorder', '1px solid var(--vscode-panel-border)');
        const htmlCommentRenderMode = configService.getConfig('htmlCommentRenderMode', 'hidden');
        const htmlContentRenderMode = configService.getConfig('htmlContentRenderMode', 'html');

        console.log('[Border-Debug] About to send via postMessage - columnBorder:', columnBorder, 'taskBorder:', taskBorder);

        // Get version from package.json
        const packageJson = require('../package.json');
        const version = packageJson.version || 'Unknown';

        // Send boardUpdate immediately - no delay needed
        this._panel.webview.postMessage({
            type: 'boardUpdate',
            board: board,
            imageMappings: imageMappings,
            tagColors: tagColors,
            enabledTagCategoriesColumn: enabledTagCategoriesColumn,
            enabledTagCategoriesTask: enabledTagCategoriesTask,
            customTagCategories: customTagCategories,
            whitespace: whitespace,
            taskMinHeight: taskMinHeight,
            sectionHeight: sectionHeight,
            taskSectionHeight: taskSectionHeight,
            fontSize: fontSize,
            fontFamily: fontFamily,
            columnWidth: columnWidth,
            layoutRows: layoutRows,
            rowHeight: rowHeight,
            layoutPreset: layoutPreset,
            layoutPresets: layoutPresets,
            maxRowHeight: maxRowHeight,
            columnBorder: columnBorder,
            taskBorder: taskBorder,
            htmlCommentRenderMode: htmlCommentRenderMode,
            htmlContentRenderMode: htmlContentRenderMode,
            applyDefaultFolding: applyDefaultFolding,
            isFullRefresh: isFullRefresh,
            version: version
        });

        // Send include file contents immediately after board update
        // postMessage guarantees message ordering, so no delay needed
        const includeFiles = this._fileRegistry.getIncludeFiles();
        if (includeFiles.length > 0) {
            for (const file of includeFiles) {
                this._panel.webview.postMessage({
                    type: 'updateIncludeContent',
                    filePath: file.getRelativePath(),
                    content: file.getContent()
                });
            }
        }

        // Create cache file for crash recovery (only for valid boards with actual content)
        if (board.valid && board.columns && board.columns.length > 0) {
            const document = this._fileManager.getDocument();
        }
    }

    private async _generateImageMappings(board: KanbanBoard): Promise<ImagePathMapping> {
        const mappings: ImagePathMapping = {};
        
        if (!board.valid || !this._fileManager.getDocument()) {
            return mappings;
        }

        // Collect all content that might contain images
        for (const column of board.columns) {
            if (column.title) {
                const titleMappings = await this._fileManager.generateImagePathMappings(column.title);
                Object.assign(mappings, titleMappings);
            }
            
            for (const task of column.tasks) {
                if (task.title) {
                    const titleMappings = await this._fileManager.generateImagePathMappings(task.title);
                    Object.assign(mappings, titleMappings);
                }
                if (task.description) {
                    const descMappings = await this._fileManager.generateImagePathMappings(task.description);
                    Object.assign(mappings, descMappings);
                }
            }
        }

        return mappings;
    }

    public async saveToMarkdown(updateVersionTracking: boolean = true, triggerSave: boolean = true) {
        await this._fileService.saveToMarkdown(updateVersionTracking, triggerSave);
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // REMOVED: _hasUnsavedChanges sync - now queried from MarkdownFile
        this._cachedBoardFromWebview = state.cachedBoardFromWebview;
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    private async initializeFile() {
        await this._fileService.initializeFile();
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // REMOVED: _hasUnsavedChanges sync - now queried from MarkdownFile
        this._cachedBoardFromWebview = state.cachedBoardFromWebview;
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    private _getHtmlForWebview() {
        const filePath = vscode.Uri.file(path.join(this._context.extensionPath, 'src', 'html', 'webview.html'));
        let html = fs.readFileSync(filePath.fsPath, 'utf8');

        const nonce = this._getNonce();
        const cspSource = this._panel.webview.cspSource;

        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data: blob:; media-src ${cspSource} https: data: blob:; script-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; frame-src 'none';">`;

        if (!html.includes('Content-Security-Policy')) {
            html = html.replace('<head>', `<head>\n    ${cspMeta}`);
        }

        // Build comprehensive localResourceRoots including asset directories
        const localResourceRoots = this._buildLocalResourceRoots(true);

        // Add document-specific paths if available
        if (this._fileManager.getDocument()) {
            const document = this._fileManager.getDocument()!;
            const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath));

            const baseHref = this._panel.webview.asWebviewUri(documentDir).toString() + '/';
            html = html.replace(/<head>/, `<head><base href="${baseHref}">`);

            // Try to use local markdown-it, but keep CDN as fallback
            try {
                const markdownItPath = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js');
                if (fs.existsSync(markdownItPath.fsPath)) {
                    const markdownItUri = this._panel.webview.asWebviewUri(markdownItPath);
                    html = html.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/markdown-it\/13\.0\.2\/markdown-it\.min\.js"><\/script>/, `<script src="${markdownItUri}"></script>`);
                }
                // If local file doesn't exist, keep the CDN version in HTML
            } catch (error) {
                // If there's any error, keep the CDN version in HTML
                console.warn('Failed to load local markdown-it, using CDN version:', error);
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
     * Collect all asset directories from the current board to add to localResourceRoots
     * This allows images/media from outside the workspace to be displayed
     */
    private _collectAssetDirectories(): string[] {
        const assetDirs = new Set<string>();

        if (!this._board) {
            console.log('[AssetDirs] No board available');
            return [];
        }

        const document = this._fileManager.getDocument();
        if (!document) {
            console.log('[AssetDirs] No document available');
            return [];
        }

        const documentDir = path.dirname(document.uri.fsPath);

        // Pattern to match markdown images: ![alt](path)
        // Use lazy matching to handle brackets in alt text
        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
        // Pattern to match HTML img/video/audio tags
        const htmlMediaRegex = /<(?:img|video|audio)[^>]+src=["']([^"']+)["'][^>]*>/gi;

        // Scan all columns and tasks
        for (const column of this._board.columns) {
            // Check column title
            this._extractAssetDirs(column.title, documentDir, assetDirs, imageRegex, htmlMediaRegex);

            // Check all tasks in column
            for (const task of column.tasks) {
                this._extractAssetDirs(task.title, documentDir, assetDirs, imageRegex, htmlMediaRegex);
                if (task.description) {
                    this._extractAssetDirs(task.description, documentDir, assetDirs, imageRegex, htmlMediaRegex);
                }
            }
        }

        const assetDirsArray = Array.from(assetDirs);
        console.log(`[AssetDirs] Found ${assetDirsArray.length} unique asset directories:`, assetDirsArray);
        return assetDirsArray;
    }

    /**
     * Extract asset directories from content
     */
    private _extractAssetDirs(content: string, basePath: string, assetDirs: Set<string>, ...regexes: RegExp[]): void {
        if (!content) {
            return;
        }

        for (const regex of regexes) {
            let match;
            regex.lastIndex = 0; // Reset regex state
            while ((match = regex.exec(content)) !== null) {
                const assetPath = match[1].trim();

                // Skip URLs (http://, https://, data:, etc.)
                if (/^(https?|data|blob):/.test(assetPath)) {
                    continue;
                }

                // Skip anchor links
                if (assetPath.startsWith('#')) {
                    continue;
                }

                // Remove query params and anchors
                const cleanPath = assetPath.split(/[?#]/)[0];

                try {
                    // Decode URL-encoded paths
                    let decodedPath = cleanPath;
                    if (cleanPath.includes('%')) {
                        try {
                            decodedPath = decodeURIComponent(cleanPath);
                        } catch (e) {
                            // Use original if decode fails
                        }
                    }

                    // Unescape backslash-escaped characters (e.g., \' -> ')
                    decodedPath = decodedPath.replace(/\\(.)/g, '$1');

                    // Resolve to absolute path
                    let absolutePath: string;
                    if (path.isAbsolute(decodedPath)) {
                        absolutePath = decodedPath;
                    } else {
                        absolutePath = path.resolve(basePath, decodedPath);
                    }

                    // Check if file exists
                    if (fs.existsSync(absolutePath)) {
                        const dir = path.dirname(absolutePath);
                        assetDirs.add(dir);
                    } else {
                        console.log(`[AssetDirs] Asset not found: ${absolutePath}`);
                    }
                } catch (error) {
                    console.log(`[AssetDirs] Error processing path: ${assetPath}`, error);
                }
            }
        }
    }

    private _getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Load main file to registry (create or update MainKanbanFile instance)
     */
    private async _syncMainFileToRegistry(document: vscode.TextDocument): Promise<void> {
        const filePath = document.uri.fsPath;

        console.log(`[KanbanWebviewPanel] Loading main file to registry: ${filePath}`);

        // Check if MainKanbanFile already exists
        let mainFile = this._fileRegistry.getMainFile();

        if (!mainFile || mainFile.getPath() !== filePath) {
            // Clear existing files if switching to a different file
            if (mainFile && mainFile.getPath() !== filePath) {
                console.log(`[KanbanWebviewPanel] Switching files - clearing registry`);
                this._fileRegistry.clear();
            }

            // Create new MainKanbanFile instance
            console.log(`[KanbanWebviewPanel] Creating new MainKanbanFile instance`);
            mainFile = this._fileFactory.createMainFile(filePath);
            this._fileRegistry.register(mainFile);
            mainFile.startWatching();
        }

        // Load content into file instance directly from document/disk
        try {
            await mainFile.reload();
            console.log(`[KanbanWebviewPanel] MainKanbanFile content loaded`);
        } catch (error) {
            console.error(`[KanbanWebviewPanel] Failed to load MainKanbanFile content:`, error);
        }

        // Load include files if board is available
        console.log(`[_syncMainFileToRegistry] Board exists: ${!!this._board}, Board valid: ${this._board?.valid}`);
        if (this._board && this._board.valid) {
            // Step 1: Create include file instances in registry
            this._syncIncludeFilesWithRegistry(this._board);

            // Step 2: Mark includes as loading (sets loading flags on columns/tasks)
            this._markIncludesAsLoading(this._board);

            // Step 3: Load content asynchronously (will send updates as each include loads)
            // Don't await - let it run in background while we send initial board
            // NOTE: _isInitialBoardLoad flag already set in loadMarkdownFile()

            this._loadIncludeContentAsync(this._board)
                .then(() => {
                    this._isInitialBoardLoad = false;
                    console.log('[_syncMainFileToRegistry] Initial board load complete - allowing reloaded events');
                })
                .catch(error => {
                    console.error('[_syncMainFileToRegistry] Error loading include content:', error);
                    this._isInitialBoardLoad = false;
                    console.log('[_syncMainFileToRegistry] Initial board load failed - allowing reloaded events');
                });
        } else {
            console.warn(`[_syncMainFileToRegistry] Skipping include file sync - board not available or invalid`);
        }

        // Log registry statistics
        this._fileRegistry.logStatistics();
    }

    /**
     * Mark all columns/tasks with includes as loading
     */
    private _markIncludesAsLoading(board: KanbanBoard): void {
        console.log('[_markIncludesAsLoading] Marking includes with loading flags');

        // Mark column includes as loading
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                column.isLoadingContent = true;
            }
        }

        // Mark task includes as loading
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    task.isLoadingContent = true;
                }
            }
        }
    }

    /**
     * Load and parse content from all include files, sending incremental updates
     * Runs asynchronously in background, sending updates as each include loads
     */
    private async _loadIncludeContentAsync(board: KanbanBoard): Promise<void> {
        console.log('[_loadIncludeContentAsync] Loading content from all include files');

        // Load column includes - send update for each one
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    // FOUNDATION-1: Registry handles normalization internally
                    const file = this._fileRegistry.getByRelativePath(relativePath) as ColumnIncludeFile;
                    if (file) {
                        try {
                            // Reload from disk and parse to tasks
                            await file.reload();
                            const tasks = file.parseToTasks(column.tasks);
                            column.tasks = tasks;
                            column.isLoadingContent = false; // Clear loading flag

                            console.log(`[_loadIncludeContentAsync] Loaded ${tasks.length} tasks from ${relativePath}`);

                            // Send update to frontend
                            if (this._panel) {
                                this._panel.webview.postMessage({
                                    type: 'updateColumnContent',
                                    columnId: column.id,
                                    tasks: tasks,
                                    columnTitle: column.title,
                                    displayTitle: column.displayTitle,
                                    includeMode: true,
                                    includeFiles: column.includeFiles,
                                    isLoadingContent: false
                                });
                            }
                        } catch (error) {
                            console.error(`[_loadIncludeContentAsync] Failed to load ${relativePath}:`, error);
                            column.isLoadingContent = false; // Clear loading flag even on error

                            // Send error state to frontend
                            if (this._panel) {
                                this._panel.webview.postMessage({
                                    type: 'updateColumnContent',
                                    columnId: column.id,
                                    tasks: [],
                                    columnTitle: column.title,
                                    displayTitle: column.displayTitle,
                                    includeMode: true,
                                    includeFiles: column.includeFiles,
                                    isLoadingContent: false,
                                    loadError: true
                                });
                            }
                        }
                    }
                }
            }
        }

        // Load task includes - send update for each one
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        // FOUNDATION-1: Registry handles normalization internally
                        const file = this._fileRegistry.getByRelativePath(relativePath) as TaskIncludeFile;
                        if (file) {
                            try {
                                // Reload from disk and get content
                                await file.reload();
                                const fullFileContent = file.getContent();

                                // FIX BUG #4: No-parsing approach
                                // Load COMPLETE file content into task.description (no parsing!)
                                // displayTitle is just a UI indicator showing which file is included
                                const displayTitle = `# include in ${relativePath}`;

                                task.displayTitle = displayTitle;  // UI indicator only
                                task.description = fullFileContent;  // COMPLETE file content!
                                task.isLoadingContent = false; // Clear loading flag

                                // Sync baseline to prevent false "unsaved" detection
                                file.setContent(fullFileContent, true);

                                console.log(`[_loadIncludeContentAsync] Loaded task include ${relativePath}`);

                                // Send update to frontend
                                if (this._panel) {
                                    this._panel.webview.postMessage({
                                        type: 'updateTaskContent',
                                        columnId: column.id,
                                        taskId: task.id,
                                        description: fullFileContent,
                                        displayTitle: displayTitle,
                                        taskTitle: task.title,
                                        originalTitle: task.originalTitle,
                                        includeMode: true,
                                        includeFiles: task.includeFiles,
                                        isLoadingContent: false
                                    });
                                }
                            } catch (error) {
                                console.error(`[_loadIncludeContentAsync] Failed to load ${relativePath}:`, error);
                                task.isLoadingContent = false; // Clear loading flag even on error

                                // Send error state to frontend
                                if (this._panel) {
                                    this._panel.webview.postMessage({
                                        type: 'updateTaskContent',
                                        columnId: column.id,
                                        taskId: task.id,
                                        description: '',
                                        displayTitle: task.displayTitle || '',
                                        taskTitle: task.title,
                                        originalTitle: task.originalTitle,
                                        includeMode: true,
                                        includeFiles: task.includeFiles,
                                        isLoadingContent: false,
                                        loadError: true
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log('[_loadIncludeContentAsync] All include content loaded');
    }

    /**
     * Public method to sync include files with registry (called from message handler after board updates)
     */
    public syncIncludeFilesWithBoard(board: KanbanBoard): void {
        this._syncIncludeFilesWithRegistry(board);
    }

    /**
     * Phase 1: Sync include files with registry (create instances for all includes in the board)
     */
    private _syncIncludeFilesWithRegistry(board: KanbanBoard): void {
        const mainFile = this._fileRegistry.getMainFile();
        if (!mainFile) {
            console.warn(`[KanbanWebviewPanel] Cannot sync include files - no main file in registry`);
            return;
        }

        console.log(`[KanbanWebviewPanel] Syncing include files with registry`);
        let createdCount = 0;

        // Sync column includes
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    if (!this._fileRegistry.hasByRelativePath(relativePath)) {
                        console.log(`[KanbanWebviewPanel] Creating ColumnIncludeFile: ${relativePath}`);

                        const columnInclude = this._fileFactory.createColumnInclude(
                            relativePath,
                            mainFile,
                            false
                        );

                        // Set column association
                        columnInclude.setColumnId(column.id);
                        columnInclude.setColumnTitle(column.title);

                        // Register and start watching
                        this._fileRegistry.register(columnInclude);
                        columnInclude.startWatching();

                        createdCount++;
                    }
                }
            }
        }

        // Sync task includes
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        if (!this._fileRegistry.hasByRelativePath(relativePath)) {
                            console.log(`[KanbanWebviewPanel] Creating TaskIncludeFile: ${relativePath}`);

                            const taskInclude = this._fileFactory.createTaskInclude(
                                relativePath,
                                mainFile,
                                false
                            );

                            // Set task association
                            taskInclude.setTaskId(task.id);
                            taskInclude.setTaskTitle(task.title);
                            taskInclude.setColumnId(column.id);

                            // Register and start watching
                            this._fileRegistry.register(taskInclude);
                            taskInclude.startWatching();

                            createdCount++;
                        }
                    }
                }
            }
        }

        console.log(`[KanbanWebviewPanel] Created ${createdCount} include file instances`);
    }

    /**
     * UNIFIED CONTENT CHANGE HANDLER
     *
     * Single entry point for ALL content changes (external, edits, switches)
     * Implements the execution path from TODOs.md:
     * 1. Detect what changed (main content / include content / include switch)
     * 2. Check unsaved includes being unloaded → ask user
     * 3. Load new includes → update cache
     * 4. Update frontend & backend cache for includes
     * 5. Update frontend & backend cache for main
     *
     * NOTE: This does NOT save files - saving is separate, user-triggered
     */
    private async _handleContentChange(params: {
        source: 'external_reload' | 'file_watcher' | 'board_update' | 'user_edit';
        mainFileChanged?: boolean;
        changedIncludes?: string[];
        switchedIncludes?: { columnId?: string; taskId?: string; columnIdForTask?: string; oldFiles: string[]; newFiles: string[]; newTitle?: string }[];
    }): Promise<void> {
        console.log(`[UNIFIED] handleContentChange from ${params.source}`);

        // Step 1: Detect what changed
        const hasMainChange = params.mainFileChanged || false;
        const hasIncludeChanges = (params.changedIncludes?.length || 0) > 0;
        const hasSwitches = (params.switchedIncludes?.length || 0) > 0;

        console.log(`[UNIFIED] Changes: main=${hasMainChange}, includes=${hasIncludeChanges}, switches=${hasSwitches}`);

        // Step 2: Check for unsaved includes being unloaded/switched
        if (hasSwitches) {
            for (const switchInfo of params.switchedIncludes!) {
                const unloadingFiles = switchInfo.oldFiles.filter(old => !switchInfo.newFiles.includes(old));

                if (unloadingFiles.length > 0) {
                    const unsavedFiles = unloadingFiles.filter(path => {
                        const file = this._fileRegistry.getByRelativePath(path);
                        return file && file.hasUnsavedChanges();
                    });

                    if (unsavedFiles.length > 0) {
                        const choice = await vscode.window.showWarningMessage(
                            `The following include files have unsaved changes:\n${unsavedFiles.join('\n')}\n\nDo you want to save them before unloading?`,
                            { modal: true },
                            'Save',
                            'Discard',
                            'Cancel'
                        );

                        if (choice === 'Save') {
                            for (const filePath of unsavedFiles) {
                                const file = this._fileRegistry.getByRelativePath(filePath);
                                if (file) {
                                    await file.save();
                                }
                            }
                        } else if (choice === 'Cancel') {
                            console.log('[UNIFIED] User cancelled - aborting content change');
                            throw new Error('USER_CANCELLED'); // Throw instead of return so caller knows operation was cancelled
                        }
                        // If 'Discard', continue
                    }
                }
            }
        }

        // Step 3: Unset old includes, clear cache, set new includes, load new content
        if (hasSwitches) {
            for (const switchInfo of params.switchedIncludes!) {
                if (switchInfo.columnId) {
                    // Column include switch
                    const column = this._board?.columns.find(c => c.id === switchInfo.columnId);
                    if (column) {
                        console.log(`[UNIFIED] Column switch: unsetting old includes, clearing cache`);

                        // CRITICAL: Clear backend cache (file instance) for old includes
                        for (const oldFile of switchInfo.oldFiles) {
                            const fileInstance = this._fileRegistry.getByRelativePath(oldFile);
                            if (fileInstance) {
                                console.log(`[UNIFIED]   Clearing backend cache for: ${oldFile}`);
                                fileInstance.discardChanges(); // Revert to baseline (disk content)
                            }
                        }

                        // Unset old includeFiles and clear frontend cache
                        column.includeFiles = [];
                        column.tasks = [];
                        column.includeMode = false;

                        // Set new includeFiles and load content
                        column.includeFiles = switchInfo.newFiles;
                        column.includeMode = switchInfo.newFiles.length > 0;

                        console.log(`[UNIFIED] Column switch: loading new includes`);
                        await this.updateIncludeContentUnified(column, switchInfo.newFiles, params.source as any);
                    }
                } else if (switchInfo.taskId && switchInfo.columnIdForTask) {
                    // Task include switch
                    const column = this._board?.columns.find(c => c.id === switchInfo.columnIdForTask);
                    const task = column?.tasks.find(t => t.id === switchInfo.taskId);

                    if (task) {
                        console.log(`[UNIFIED] Task switch: unsetting old includes, clearing cache`);
                        console.log(`[UNIFIED]   Old: includeFiles=${task.includeFiles}, displayTitle="${task.displayTitle}", description length=${task.description?.length || 0}`);

                        // CRITICAL: Clear backend cache (file instance) for old includes
                        for (const oldFile of switchInfo.oldFiles) {
                            const fileInstance = this._fileRegistry.getByRelativePath(oldFile);
                            if (fileInstance) {
                                console.log(`[UNIFIED]   Clearing backend cache for: ${oldFile}`);
                                fileInstance.discardChanges(); // Revert to baseline (disk content)
                            }
                        }

                        // Unset old includeFiles and clear frontend cache
                        task.includeFiles = [];
                        task.displayTitle = '';
                        task.description = '';
                        task.includeMode = false;

                        // Set new includeFiles
                        task.includeFiles = switchInfo.newFiles;
                        task.includeMode = switchInfo.newFiles.length > 0;

                        // CRITICAL: Update title if provided (task include switch)
                        if (switchInfo.newTitle) {
                            task.title = switchInfo.newTitle;
                            console.log(`[UNIFIED] Updated task title to: ${switchInfo.newTitle}`);
                        }

                        // Load new content from file
                        if (switchInfo.newFiles.length > 0) {
                            console.log(`[UNIFIED] Task switch: loading new content from ${switchInfo.newFiles[0]}`);
                            await this.loadNewTaskIncludeContent(task, switchInfo.newFiles);
                            console.log(`[UNIFIED]   New: displayTitle="${task.displayTitle}", description length=${task.description?.length || 0}`);
                        }

                        // Update frontend
                        if (this._panel && column) {
                            this._panel.webview.postMessage({
                                type: 'updateTaskContent',
                                columnId: column.id,
                                taskId: task.id,
                                description: task.description,
                                displayTitle: task.displayTitle,
                                taskTitle: switchInfo.newTitle || task.title,  // CRITICAL: Use new title if provided
                                originalTitle: task.originalTitle,
                                includeMode: task.includeMode,
                                includeFiles: task.includeFiles
                            });
                        }
                    }
                }
            }
        }

        // Step 4: External include changes handled by file instances
        // STRATEGY 1: Files handle their own external changes autonomously via file.handleExternalChange()
        // The unified handler only responds to user actions (edits, switches)
        // This prevents duplicate dialogs and ensures single responsibility
        if (hasIncludeChanges) {
            console.log('[UNIFIED] External include changes detected - files will handle autonomously');
            // Files already handle their own external changes via file.handleExternalChange()
            // No action needed here - this prevents duplicate dialogs
        }

        // Step 5: Update frontend & backend cache for main file
        if (hasMainChange) {
            // CRITICAL: Block board regeneration if user is editing
            if (this._isEditingInProgress) {
                console.log(`[handleContentChange] BLOCKING board regeneration - editing in progress! Source: ${params.source}`);
                return; // Don't regenerate board while user is editing
            }

            console.log(`[CRITICAL] Main file changed - this will regenerate ALL column/task IDs!`);
            console.log(`[CRITICAL] Source: ${params.source}`);
            console.log(`[CRITICAL] Stack trace:`, new Error().stack);

            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile) {
                // Re-parse board from updated content
                const board = mainFile.getBoard();

                if (board && board.valid) {
                    console.log(`[CRITICAL] About to regenerate board with ${board.columns.length} columns - IDs will change!`);
                    console.log(`[CRITICAL] New column IDs will be:`, board.columns.map(c => c.id));

                    // Sync include files with registry
                    this._syncIncludeFilesWithRegistry(board);

                    // Load content for all column includes
                    for (const column of board.columns) {
                        if (column.includeFiles && column.includeFiles.length > 0) {
                            for (const relativePath of column.includeFiles) {
                                const file = this._fileRegistry.getByRelativePath(relativePath) as ColumnIncludeFile;
                                if (file) {
                                    const tasks = file.parseToTasks(column.tasks);
                                    column.tasks = tasks;
                                }
                            }
                        }
                    }

                    // Update cached board
                    this._board = board;
                    this._cachedBoardFromWebview = board;

                    // Send full board to frontend
                    if (this._panel) {
                        this._panel.webview.postMessage({
                            type: 'boardUpdate',
                            board: board,
                            columnWidth: configService.getConfig('columnWidth', '350px'),
                            taskMinHeight: configService.getConfig('taskMinHeight'),
                            sectionHeight: configService.getConfig('sectionHeight'),
                            taskSectionHeight: configService.getConfig('taskSectionHeight'),
                            fontSize: configService.getConfig('fontSize'),
                            fontFamily: configService.getConfig('fontFamily'),
                            whitespace: configService.getConfig('whitespace', '8px'),
                            layoutRows: configService.getConfig('layoutRows'),
                            rowHeight: configService.getConfig('rowHeight'),
                            layoutPreset: configService.getConfig('layoutPreset', 'normal'),
                            layoutPresets: this._getLayoutPresetsConfiguration(),
                            maxRowHeight: configService.getConfig('maxRowHeight', 0),
                            tagColors: configService.getConfig('tagColors', {}),
                            enabledTagCategoriesColumn: configService.getEnabledTagCategoriesColumn(),
                            enabledTagCategoriesTask: configService.getEnabledTagCategoriesTask(),
                            customTagCategories: configService.getCustomTagCategories()
                        });
                    }
                }
            }
        }

        console.log('[UNIFIED] Content change complete');
    }

    /**
     * Set editing in progress flag to block board regenerations
     */
    public setEditingInProgress(isEditing: boolean): void {
        this._isEditingInProgress = isEditing;
        console.log(`[KanbanWebviewPanel] Editing in progress: ${isEditing}`);
    }

    /**
     * Mark a column as having unrendered changes (cache updated, DOM not synced)
     */
    public markColumnDirty(columnId: string): void {
        this._dirtyColumns.add(columnId);
        console.log(`[KanbanWebviewPanel] Marked column ${columnId} as dirty`);
    }

    /**
     * Mark a task as having unrendered changes (cache updated, DOM not synced)
     */
    public markTaskDirty(taskId: string): void {
        this._dirtyTasks.add(taskId);
        console.log(`[KanbanWebviewPanel] Marked task ${taskId} as dirty`);
    }

    /**
     * Clear dirty flag for a column (render completed successfully)
     */
    public clearColumnDirty(columnId: string): void {
        this._dirtyColumns.delete(columnId);
        console.log(`[KanbanWebviewPanel] Cleared dirty flag for column ${columnId}`);
    }

    /**
     * Clear dirty flag for a task (render completed successfully)
     */
    public clearTaskDirty(taskId: string): void {
        this._dirtyTasks.delete(taskId);
        console.log(`[KanbanWebviewPanel] Cleared dirty flag for task ${taskId}`);
    }

    /**
     * Sync dirty items to frontend (Optimization 2: Batched sync)
     * Called when view becomes visible to apply any pending DOM updates
     */
    private _syncDirtyItems(): void {
        if (!this._board || !this._panel) return;

        if (this._dirtyColumns.size === 0 && this._dirtyTasks.size === 0) {
            return; // Nothing to sync
        }

        console.log(`[syncDirtyItems] Syncing ${this._dirtyColumns.size} columns, ${this._dirtyTasks.size} tasks`);

        // Collect dirty columns
        const dirtyColumns: any[] = [];
        for (const columnId of this._dirtyColumns) {
            const column = this._board.columns.find(c => c.id === columnId);
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
        for (const taskId of this._dirtyTasks) {
            for (const column of this._board.columns) {
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
        this._panel.webview.postMessage({
            type: 'syncDirtyItems',
            columns: dirtyColumns,
            tasks: dirtyTasks
        });

        // Clear dirty flags after sending
        this._dirtyColumns.clear();
        this._dirtyTasks.clear();
    }

    /**
     * PUBLIC API: Handle include file switch triggered by user edit (column/task title)
     * Routes through the unified content change handler to ensure proper flow
     * Changes always apply - use undo to revert if needed
     *
     * @param params Switch parameters (columnId or taskId with old/new files)
     */
    public async handleIncludeSwitch(params: {
        columnId?: string;
        taskId?: string;
        oldFiles: string[];
        newFiles: string[];
    }): Promise<void> {
        console.log(`[handleIncludeSwitch] Routing ${params.columnId ? 'column' : 'task'} include switch through unified handler`);

        if (params.columnId) {
            // Column include switch
            await this._handleContentChange({
                source: 'user_edit',
                switchedIncludes: [{
                    columnId: params.columnId,
                    oldFiles: params.oldFiles,
                    newFiles: params.newFiles
                }]
            });
        } else if (params.taskId) {
            // Task include switch - for now, just load the new content
            // TODO: Integrate task include switches into unified handler fully
            const column = this._board?.columns.find(col =>
                col.tasks.some(t => t.id === params.taskId)
            );
            const task = column?.tasks.find(t => t.id === params.taskId);

            if (task && params.newFiles.length > 0) {
                await this.loadNewTaskIncludeContent(task, params.newFiles);
            }
        }
    }

    /**
     * Handle file registry change events - ROUTES TO UNIFIED HANDLER
     */
    private async _handleFileRegistryChange(event: FileChangeEvent): Promise<void> {
        console.log(`[KanbanWebviewPanel] File registry change: ${event.file.getRelativePath()} (${event.changeType})`);

        const file = event.file;
        const fileType = file.getFileType();

        // CRITICAL: Only route EXTERNAL changes to unified handler
        // 'content' events are internal cache updates from user edits - DON'T reload!
        // 'external' events are from file watchers - DO reload!
        // 'reloaded' events are explicit reload requests - DO reload!
        if (event.changeType === 'content' || event.changeType === 'saved') {
            // Internal cache update - do NOT trigger reload
            console.log(`[KanbanWebviewPanel] Ignoring ${event.changeType} event - internal cache update`);
            return;
        }

        // Route external/reload events to unified content change handler
        if (fileType === 'main') {
            if (event.changeType === 'external' || event.changeType === 'reloaded') {
                // CRITICAL: Skip 'reloaded' events during initial board load
                // This is just loading the main file for the first time, not an actual change
                if (event.changeType === 'reloaded' && this._isInitialBoardLoad) {
                    console.log(`[KanbanWebviewPanel] Skipping main file reloaded event during initial board load`);
                    return;
                }

                // Main file changed externally
                await this._handleContentChange({
                    source: 'file_watcher',
                    mainFileChanged: true
                });
            }
        } else if (fileType === 'include-column' || fileType === 'include-task' || fileType === 'include-regular') {
            // OPTION A: Files handle external changes autonomously
            // 'external' events → File's handleExternalChange() handles it → emits 'reloaded'
            // 'reloaded' events → Send frontend update

            if (event.changeType === 'external') {
                // Files handle external changes independently via handleExternalChange()
                // They will show dialogs, reload, and emit 'reloaded' event
                // We just wait for the 'reloaded' event to update frontend
                console.log(`[KanbanWebviewPanel] External change detected - file will handle autonomously: ${file.getRelativePath()}`);
                return;
            }

            if (event.changeType === 'reloaded') {
                // CRITICAL: Skip 'reloaded' events during initial board load
                // These are just loading content for the first time, not actual changes
                if (this._isInitialBoardLoad) {
                    console.log(`[KanbanWebviewPanel] Skipping reloaded event during initial board load: ${file.getRelativePath()}`);
                    return;
                }

                // File has been reloaded (either from external change or manual reload)
                // Send updated content to frontend
                console.log(`[KanbanWebviewPanel] File reloaded - sending frontend update: ${file.getRelativePath()}`);
                await this._sendIncludeFileUpdateToFrontend(file);
            }
        }
    }

    /**
     * Send updated include file content to frontend
     * Called after file has been reloaded (from external change or manual reload)
     */
    private async _sendIncludeFileUpdateToFrontend(file: MarkdownFile): Promise<void> {
        if (!this._board || !this._panel) {
            console.warn(`[_sendIncludeFileUpdateToFrontend] No board or panel available`);
            return;
        }

        const relativePath = file.getRelativePath();
        const fileType = file.getFileType();

        console.log(`[_sendIncludeFileUpdateToFrontend] Sending update for ${fileType}: ${relativePath}`);

        if (fileType === 'include-column') {
            // Find column that uses this include file
            // FOUNDATION-1: Use normalized path comparison instead of === comparison
            const column = this._board.columns.find(c =>
                c.includeFiles && c.includeFiles.some(p => MarkdownFile.isSameFile(p, relativePath))
            );

            if (column) {
                // Parse tasks from updated file
                const columnFile = file as any; // ColumnIncludeFile
                const tasks = columnFile.parseToTasks(column.tasks);
                column.tasks = tasks;

                // Send update to frontend
                this._panel.webview.postMessage({
                    type: 'updateColumnContent',
                    columnId: column.id,
                    tasks: tasks,
                    columnTitle: column.title,
                    displayTitle: column.displayTitle,
                    includeMode: true,
                    includeFiles: column.includeFiles
                });

                console.log(`[_sendIncludeFileUpdateToFrontend] Sent column update with ${tasks.length} tasks`);
            }
        } else if (fileType === 'include-task') {
            // Find task that uses this include file
            let foundTask: KanbanTask | undefined;
            let foundColumn: KanbanColumn | undefined;

            for (const column of this._board.columns) {
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
                this._panel.webview.postMessage({
                    type: 'updateTaskContent',
                    columnId: foundColumn.id,
                    taskId: foundTask.id,
                    description: fullContent,
                    displayTitle: displayTitle,
                    taskTitle: foundTask.title,
                    originalTitle: foundTask.originalTitle,
                    includeMode: true,
                    includeFiles: foundTask.includeFiles
                });

                console.log(`[_sendIncludeFileUpdateToFrontend] Sent task update with ${fullContent.length} chars`);
            }
        } else if (fileType === 'include-regular') {
            // Regular include - need full board re-parse
            console.log(`[_sendIncludeFileUpdateToFrontend] Regular include changed - triggering full board refresh`);
            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile) {
                await mainFile.reload();
                const board = mainFile.getBoard();
                if (board && board.valid) {
                    this._board = board;
                    this._cachedBoardFromWebview = board;
                    await this.sendBoardUpdate(false, true);
                }
            }
        }
    }

    // OLD HANDLERS REMOVED - Now using unified _handleContentChange() handler

    // ============= FILE REGISTRY HELPER METHODS =============

    /**
     * Get the main kanban file instance from registry
     */
    private _getMainFile(): MainKanbanFile | undefined {
        return this._fileRegistry.getMainFile();
    }

    /**
     * Get an include file instance by relative path
     */
    private _getIncludeFileByPath(relativePath: string): IncludeFile | undefined {
        const file = this._fileRegistry.getByRelativePath(relativePath);
        if (file && file.getFileType() !== 'main') {
            return file as IncludeFile;
        }
        return undefined;
    }

    /**
     * Get all column include files
     */
    private _getColumnIncludeFiles(): ColumnIncludeFile[] {
        return this._fileRegistry.getColumnIncludeFiles();
    }

    /**
     * Get all task include files
     */
    private _getTaskIncludeFiles(): TaskIncludeFile[] {
        return this._fileRegistry.getTaskIncludeFiles();
    }

    /**
     * Check if registry is initialized with a main file
     */
    private _isRegistryReady(): boolean {
        return this._fileRegistry.getMainFile() !== undefined;
    }

    /**
     * Get all files with conflicts from registry
     */
    private _getFilesWithConflicts(): MarkdownFile[] {
        return this._fileRegistry.getFilesWithConflicts();
    }

    /**
     * Get all files with unsaved changes from registry
     */
    private _getFilesWithUnsavedChanges(): MarkdownFile[] {
        return this._fileRegistry.getFilesWithUnsavedChanges();
    }

    /**
     * Get all files that need reload from registry
     */
    private _getFilesThatNeedReload(): MarkdownFile[] {
        return this._fileRegistry.getFilesThatNeedReload();
    }

    /**
     * Get include files unsaved status (for main file conflict context)
     */
    private _getIncludeFilesUnsavedStatus(): { hasChanges: boolean; changedFiles: string[] } {
        const includeFiles = this._fileRegistry.getAll().filter(f => f.getFileType() !== 'main');
        const changedFiles = includeFiles
            .filter(f => f.hasUnsavedChanges())
            .map(f => f.getRelativePath());

        return {
            hasChanges: changedFiles.length > 0,
            changedFiles: changedFiles
        };
    }

    /**
     * Get file content from registry
     */
    private _getFileContent(relativePath: string): string | undefined {
        const file = relativePath === '.'
            ? this._getMainFile()
            : this._getIncludeFileByPath(relativePath);

        return file?.getContent();
    }

    /**
     * Check if file has unsaved changes
     */
    private _fileHasUnsavedChanges(relativePath: string): boolean {
        const file = relativePath === '.'
            ? this._getMainFile()
            : this._getIncludeFileByPath(relativePath);

        return file?.hasUnsavedChanges() || false;
    }

    /**
     * Check if file has conflicts
     */
    private _fileHasConflict(relativePath: string): boolean {
        const file = relativePath === '.'
            ? this._getMainFile()
            : this._getIncludeFileByPath(relativePath);

        return file?.hasConflict() || false;
    }

    /**
     * Check if file needs reload
     */
    private _fileNeedsReload(relativePath: string): boolean {
        const file = relativePath === '.'
            ? this._getMainFile()
            : this._getIncludeFileByPath(relativePath);

        return file?.needsReload() || false;
    }

    /**
     * Check if file needs save
     */
    private _fileNeedsSave(relativePath: string): boolean {
        const file = relativePath === '.'
            ? this._getMainFile()
            : this._getIncludeFileByPath(relativePath);

        return file?.needsSave() || false;
    }

    /**
     * Get unified unsaved changes state from registry
     */
    private _getUnifiedUnsavedChangesState(): { hasUnsavedChanges: boolean; details: string } {
        const filesWithChanges = this._getFilesWithUnsavedChanges();

        if (filesWithChanges.length === 0) {
            return { hasUnsavedChanges: false, details: 'No unsaved changes' };
        }

        const details = filesWithChanges.map(f => f.getRelativePath()).join(', ');
        return {
            hasUnsavedChanges: true,
            details: `Unsaved changes in: ${details}`
        };
    }

    /**
     * Get files that need attention (conflicts, unsaved changes, external changes)
     */
    private _getFilesThatNeedAttention(): {
        conflicts: MarkdownFile[];
        unsaved: MarkdownFile[];
        needReload: MarkdownFile[];
    } {
        return {
            conflicts: this._getFilesWithConflicts(),
            unsaved: this._getFilesWithUnsavedChanges(),
            needReload: this._getFilesThatNeedReload()
        };
    }


    // ============= END FILE REGISTRY HELPER METHODS =============

    private async _handlePanelClose() {
        // Use the cached board that was already sent when changes were made
        if (this._cachedBoardFromWebview) {
            this._board = this._cachedBoardFromWebview;
        }

        // Query current unsaved changes state from MarkdownFile
        const mainFile = this._getMainFile();
        const hasUnsavedChanges = mainFile?.hasUnsavedChanges() || false;

        const result = await this._conflictService._handlePanelClose(
            () => this._messageHandler?.getUnifiedFileState(),
            hasUnsavedChanges,
            this._isClosingPrevented,
            this._cachedBoardFromWebview,
            () => this.dispose()
        );

        // Update state from result
        // NOTE: newHasUnsavedChanges should be applied to MarkdownFile, not stored locally
        if (result.newHasUnsavedChanges !== hasUnsavedChanges && mainFile && this._board) {
            if (result.newHasUnsavedChanges) {
                // CRITICAL: use updateFromBoard to update BOTH content AND board object
                mainFile.updateFromBoard(this._board);
            } else {
                // Always discard to reset state when transitioning to saved
                // discardChanges() internally checks if content changed before emitting events
                mainFile.discardChanges();
            }
        }
        this._isClosingPrevented = result.newIsClosingPrevented;
        this._cachedBoardFromWebview = result.newCachedBoard;

        // Handle recursive call if user cancelled
        if (result.shouldPreventClose && !result.newIsClosingPrevented) {
            this._handlePanelClose();
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

    public async dispose() {
        // Clear unsaved changes flag and prevent closing flags
        const mainFile = this._getMainFile();
        if (mainFile) {
            // Always discard to reset state on dispose
            // discardChanges() internally checks if content changed before emitting events
            mainFile.discardChanges();
        }
        this._isClosingPrevented = false;

        // Stop unsaved changes monitoring
        if (this._unsavedChangesCheckInterval) {
            clearInterval(this._unsavedChangesCheckInterval);
            this._unsavedChangesCheckInterval = undefined;
        }

        // Remove from panels map using the tracked URI (which persists even after document is closed)
        if (this._trackedDocumentUri && KanbanWebviewPanel.panels.get(this._trackedDocumentUri) === this) {
            KanbanWebviewPanel.panels.delete(this._trackedDocumentUri);
        }

        // Also check all entries as a fallback in case tracking failed
        for (const [uri, panel] of KanbanWebviewPanel.panels.entries()) {
            if (panel === this) {
                KanbanWebviewPanel.panels.delete(uri);
            }
        }

        // Clear panel state
        KanbanWebviewPanel.panelStates.delete(this._panelId);

        // Unregister from SaveEventCoordinator
        const document = this._fileManager.getDocument();
        if (document) {
            const coordinator = SaveEventCoordinator.getInstance();
            coordinator.unregisterHandler(`panel-${document.uri.fsPath}`);
        }

        // Stop backup timer
        this._backupManager.dispose();

        // Dispose file registry (Phase 1: cleanup)
        this._fileRegistry.dispose();

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
     * Debug method to check webview permissions and image resolution
     * ---
     * You can call this method from the VS Code command palette or after loading a document
     * Add to your extension.ts if you want a debug command:
     *  const debugCommand = vscode.commands.registerCommand('markdown-kanban.debugPermissions', () => {
     *      if (KanbanWebviewPanel.currentPanel) {
     *          KanbanWebviewPanel.currentPanel.debugWebviewPermissions();
     *      } else {
     *          vscode.window.showWarningMessage('No kanban panel is open');
     *      }
     *  });
     *  context.subscriptions.push(debugCommand);
     */
    public debugWebviewPermissions() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const currentDocument = this._fileManager.getDocument();

    }

    /**
     * Setup document change listener to track external modifications
     */
    private setupDocumentChangeListener(): void {
        this._fileService.setupDocumentChangeListener(this._disposables);
    }


    /**
     * Update the known file content baseline
     */
    private updateKnownFileContent(content: string): void {
        this._fileService.updateKnownFileContent(content);
    }

    /**
     * Force reload the board from file (user-initiated)
     */
    public async forceReloadFromFile(): Promise<void> {
        await this._fileService.forceReloadFromFile();
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // REMOVED: _hasUnsavedChanges sync - now queried from MarkdownFile
        this._cachedBoardFromWebview = state.cachedBoardFromWebview;
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    /**
     * Save modifications from include columns back to their original presentation files
     * This enables bidirectional editing
     */
    public async saveColumnIncludeChanges(column: KanbanColumn): Promise<boolean> {
        return this._includeFileManager.saveColumnIncludeChanges(column, () => this._fileManager.getDocument());
    }

    /**
     * Save modifications from task includes back to their original files
     * This enables bidirectional editing for task includes
     * NOTE: This method is not currently used - task includes are processed automatically by the registry
     */
    public async reprocessTaskIncludes(): Promise<void> {
        // No-op: Registry handles task include processing automatically
        return Promise.resolve();
    }

    public async checkTaskIncludeUnsavedChanges(task: KanbanTask): Promise<boolean> {
        return this._includeFileManager.checkTaskIncludeUnsavedChanges(task);
    }

    /**
     * Check if a column's include files have unsaved changes
     */
    public async checkColumnIncludeUnsavedChanges(column: KanbanColumn): Promise<boolean> {
        return this._includeFileManager.checkColumnIncludeUnsavedChanges(column);
    }

    /**
     * Check if a specific include file has unsaved changes
     */
    public hasUnsavedIncludeFileChanges(relativePath: string): boolean {
        const file = this._fileRegistry.getByRelativePath(relativePath);
        return file?.hasUnsavedChanges() || false;
    }

    public async saveTaskIncludeChanges(task: KanbanTask): Promise<boolean> {
        return this._includeFileManager.saveTaskIncludeChanges(task, () => this._fileManager.getDocument());
    }

    /**
     * UNIFIED ENTRY POINT for all include content updates
     * This method MUST be used for all include content changes to ensure proper conflict detection
     */
    public async updateIncludeContentUnified(
        column: KanbanColumn,
        newIncludeFiles: string[],
        source: 'external_file_change' | 'column_title_edit' | 'manual_refresh' | 'conflict_resolution'
    ): Promise<void> {
        // Note: Unsaved changes check happens in handleBoardUpdate BEFORE this is called

        // FIX #2d: Cleanup old include files that are being replaced
        const oldIncludeFiles = column.includeFiles || [];
        // FIX: Normalize all paths for consistent comparison
        // FOUNDATION-1: Use original paths directly (registry normalizes internally)
        const normalizedNewFiles = newIncludeFiles;
        const normalizedOldFiles = oldIncludeFiles;
        const filesToRemove = normalizedOldFiles.filter(old => !normalizedNewFiles.includes(old));

        for (const oldFilePath of filesToRemove) {
            const oldFile = this._fileRegistry.getByRelativePath(oldFilePath);
            if (oldFile) {
                console.log(`[updateIncludeContentUnified] Cleaning up old include file: ${oldFilePath}`);
                oldFile.stopWatching();
                // FIX: Don't call dispose() - unregister() does it internally
                this._fileRegistry.unregister(oldFile.getPath());
                console.log(`[updateIncludeContentUnified] ✓ Old file unregistered and disposed`);
            }
        }

        // FIX: Normalize paths before storing
        column.includeFiles = normalizedNewFiles;

        // Keep existing tasks to preserve IDs during re-parse
        const existingTasks = column.tasks;

        // Load content from the include files (use normalized paths)
        const allTasks: KanbanTask[] = [];
        for (const relativePath of normalizedNewFiles) {
            // Create new include file in registry if it doesn't exist
            if (!this._fileRegistry.hasByRelativePath(relativePath)) {
                const mainFile = this._fileRegistry.getMainFile();
                if (mainFile) {
                    console.log('[updateIncludeContentUnified] Creating new ColumnIncludeFile in registry:', relativePath);
                    const columnInclude = this._fileFactory.createColumnInclude(
                        relativePath,
                        mainFile,
                        false
                    );
                    columnInclude.setColumnId(column.id);
                    columnInclude.setColumnTitle(column.title);
                    this._fileRegistry.register(columnInclude);
                    columnInclude.startWatching();
                }
            }

            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file && file.getFileType() === 'include-column') {
                const columnFile = file as any; // ColumnIncludeFile

                // Reload the file content from disk before parsing
                console.log('[updateIncludeContentUnified] Reloading file content:', relativePath);
                await columnFile.reload();

                // Pass existing tasks to preserve IDs during re-parse
                const tasks = columnFile.parseToTasks(existingTasks);
                console.log(`[updateIncludeContentUnified] Parsed ${tasks.length} tasks from ${relativePath}`);
                allTasks.push(...tasks);
            }
        }

        // Update the column with the loaded tasks
        column.tasks = allTasks;

        // Send update to frontend (use normalized paths)
        if (this._panel) {
            this._panel.webview.postMessage({
                type: 'updateColumnContent',
                columnId: column.id,
                tasks: allTasks,
                columnTitle: column.title,
                displayTitle: column.displayTitle,
                includeMode: true,
                includeFiles: normalizedNewFiles
            });
            console.log(`[updateIncludeContentUnified] Sent updateColumnContent with ${allTasks.length} tasks to frontend`);
        }
    }

    public async loadNewTaskIncludeContent(task: KanbanTask, newIncludeFiles: string[]): Promise<void> {

        try {
            const currentDocument = this._fileManager.getDocument();
            if (!currentDocument) {
                return;
            }

            // Note: Unsaved changes check happens in handleBoardUpdate BEFORE this is called
            const basePath = path.dirname(currentDocument.uri.fsPath);

            // For now, handle single file includes
            const fileState = newIncludeFiles[0];
            const absolutePath = PathResolver.resolve(basePath, fileState);

            // FOUNDATION-1: Use original path (registry handles normalization)
            const normalizedIncludeFile = fileState;

            // FIX #2a: Cleanup old include files that are being replaced
            const oldIncludeFiles = task.includeFiles || [];
            const normalizedNewFiles = [normalizedIncludeFile];
            // FOUNDATION-1: Use MarkdownFile.isSameFile for comparison
            const { MarkdownFile } = require('./files/MarkdownFile');
            const filesToRemove = oldIncludeFiles
                .filter(old => !normalizedNewFiles.some(newFile => MarkdownFile.isSameFile(old, newFile)));

            for (const oldFilePath of filesToRemove) {
                const oldFile = this.fileRegistry?.getByRelativePath(oldFilePath);
                if (oldFile) {
                    console.log(`[loadNewTaskIncludeContent] Cleaning up old include file: ${oldFilePath}`);
                    oldFile.stopWatching();
                    // FIX: Don't call dispose() here - unregister() does it internally
                    this.fileRegistry.unregister(oldFile.getPath());
                    console.log(`[loadNewTaskIncludeContent] ✓ Old file unregistered and disposed`);
                }
            }

            // Create new include file in registry if it doesn't exist
            if (!this.fileRegistry?.hasByRelativePath(normalizedIncludeFile)) {
                const mainFile = this.fileRegistry.getMainFile();
                if (mainFile) {
                    console.log('[loadNewTaskIncludeContent] Creating new TaskIncludeFile in registry:', normalizedIncludeFile);
                    const taskInclude = this._fileFactory.createTaskInclude(
                        normalizedIncludeFile,
                        mainFile,
                        false
                    );
                    this.fileRegistry.register(taskInclude);

                    // FIX #1: Start watching for external changes immediately
                    taskInclude.startWatching();
                    console.log('[loadNewTaskIncludeContent] Started watching new TaskIncludeFile:', normalizedIncludeFile);
                }
            }

            // STRATEGY 1: Load full content without parsing
            // Reload the file content from disk first
            await this._includeFileManager.readAndUpdateIncludeContent(normalizedIncludeFile, () => this._fileManager.getDocument());

            // Get file instance from registry
            const includeFile = this.fileRegistry.getByRelativePath(normalizedIncludeFile);
            if (!includeFile) {
                console.error('[loadNewTaskIncludeContent] File not found in registry:', normalizedIncludeFile);
                return;
            }

            // Get COMPLETE content from file (NO PARSING!)
            let fullFileContent = includeFile.getContent();
            console.log(`[loadNewTaskIncludeContent] Loaded ${fullFileContent.length} chars from registry`);

            // FIX: Handle case where reload() failed silently and content is empty
            if (!fullFileContent || fullFileContent.length === 0) {
                console.warn(`[loadNewTaskIncludeContent] ⚠ Content is empty! Attempting manual reload...`);
                await includeFile.reload();
                fullFileContent = includeFile.getContent();

                if (!fullFileContent || fullFileContent.length === 0) {
                    console.error(`[loadNewTaskIncludeContent] ❌ Reload failed - file has no content: ${normalizedIncludeFile}`);
                    return; // Abort - don't update task with empty content
                }

                console.log(`[loadNewTaskIncludeContent] ✓ Manual reload succeeded: ${fullFileContent.length} chars`);
            }

            if (fullFileContent !== null && fullFileContent !== undefined) {
                // Generate displayTitle for UI (visual indicator only, not part of file content)
                const displayTitle = `# include in ${normalizedIncludeFile}`;

                // Update task with COMPLETE file content (NO PARSING, NO TRUNCATION)
                task.includeMode = true;

                // FIX: Normalize paths before storing to ensure consistent registry lookups
                // FOUNDATION-1: Store original paths (no normalization)
                task.includeFiles = newIncludeFiles;

                task.originalTitle = task.title; // Preserve the include syntax
                task.displayTitle = displayTitle; // UI header only
                task.description = fullFileContent; // COMPLETE file content, no parsing!

                // CRITICAL: Update file baseline to match task content
                // This prevents false "unsaved" detection in trackIncludeFileUnsavedChanges
                // setContent with updateBaseline=true syncs both content and baseline
                includeFile.setContent(fullFileContent, true);
                console.log(`[loadNewTaskIncludeContent] ✓ File baseline synced with task content`);

                console.log(`[loadNewTaskIncludeContent] ======== TASK UPDATED AFTER RELOAD ========`);
                console.log(`[loadNewTaskIncludeContent] File: ${normalizedIncludeFile}`);
                console.log(`[loadNewTaskIncludeContent] displayTitle: "${task.displayTitle}"`);
                console.log(`[loadNewTaskIncludeContent] description (first 100): "${task.description.substring(0, 100)}"`);
                console.log(`[loadNewTaskIncludeContent] description length: ${task.description.length}`);

                // Send targeted update message to frontend instead of full refresh
                if (this._panel) {
                    this._panel.webview.postMessage({
                        type: 'updateTaskContent',
                        taskId: task.id,
                        description: task.description,
                        fileState: normalizedIncludeFile,
                        taskTitle: task.title,
                        displayTitle: task.displayTitle,
                        originalTitle: task.originalTitle,
                        includeMode: task.includeMode,
                        includeFiles: task.includeFiles
                    });
                } else {
                    console.warn('[loadNewTaskIncludeContent] Cannot send message - panel is null');
                }

                // File instance tracks its own state, no manual marking needed

            } else {
                console.warn(`[LoadNewTaskInclude] Include file not found: ${absolutePath}`);
                // Clear description if file doesn't exist
                task.description = '';

                // Send targeted update with empty description
                if (this._panel) {
                    this._panel.webview.postMessage({
                        type: 'updateTaskContent',
                        taskId: task.id,
                        description: '',
                        fileState: fileState,
                        taskTitle: task.title,
                        displayTitle: task.displayTitle,
                        originalTitle: task.originalTitle,
                        includeMode: task.includeMode,
                        includeFiles: task.includeFiles
                    });
                } else {
                    console.warn('[loadNewTaskIncludeContent] Cannot send empty task message - panel is null');
                }
            }
        } catch (error) {
            console.error(`[LoadNewTaskInclude] Error loading new task include content:`, error);
        }
    }

    /**
     * Save all modified column includes when the board is saved
     */
    public async saveAllColumnIncludeChanges(): Promise<void> {
        if (!this._board) {
            return;
        }

        const includeColumns = this._board.columns.filter(col => col.includeMode);

        // Filter out columns whose include files were recently reloaded from external
        const columnsToSave = includeColumns.filter(col => {
            if (!col.includeFiles || col.includeFiles.length === 0) {
                return true; // No include files to check
            }

            // Check if any of the column's include files were recently reloaded
            return !col.includeFiles.some(file => {
                // Use helper method for consistent path comparison
                return Array.from(this._recentlyReloadedFiles).some(reloadedPath =>
                    this._includeFileManager._isSameIncludePath(file, reloadedPath)
                );
            });
        });

        const savePromises = columnsToSave.map(col => this._includeFileManager.saveColumnIncludeChanges(col, () => this._fileManager.getDocument()));

        try {
            await Promise.all(savePromises);
        } catch (error) {
            console.error('[Column Include] Error saving column include changes:', error);
        }
    }

    /**
     * Save all modified task includes when the board is saved
     */
    public async saveAllTaskIncludeChanges(): Promise<void> {
        if (!this._board) {
            return;
        }

        // Collect all tasks with include mode from all columns
        const includeTasks: KanbanTask[] = [];
        for (const column of this._board.columns) {
            for (const task of column.tasks) {
                if (task.includeMode) {
                    // Check if any of the task's include files were recently reloaded
                    const shouldSkip = task.includeFiles?.some(file => {
                        // Use helper method for consistent path comparison
                        return Array.from(this._recentlyReloadedFiles).some(reloadedPath =>
                            this._includeFileManager._isSameIncludePath(file, reloadedPath)
                        );
                    });

                    if (!shouldSkip) {
                        includeTasks.push(task);
                    }
                }
            }
        }

        if (includeTasks.length === 0) {
            return;
        }

        const savePromises = includeTasks.map(task => this._includeFileManager.saveTaskIncludeChanges(task, () => this._fileManager.getDocument()));

        try {
            await Promise.all(savePromises);
        } catch (error) {
            console.error('[Task Include] Error saving task include changes:', error);
        }
    }

    /**
     * Ensure an include file is registered in the unified system for conflict resolution
     */
    public ensureIncludeFileRegistered(relativePath: string, type: 'regular' | 'column' | 'task'): void {
        this._includeFileManager.ensureIncludeFileRegistered(relativePath, type, () => this._fileManager.getDocument());
    }

    /**
     * Save main kanban changes (used when user chooses to overwrite external include changes)
     */
    private async saveMainKanbanChanges(): Promise<void> {
        await this._fileService.saveMainKanbanChanges();
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // REMOVED: _hasUnsavedChanges sync - now queried from MarkdownFile
        this._cachedBoardFromWebview = state.cachedBoardFromWebview;
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    /**
     * Open a file with reuse check - focuses existing editor if already open
     */
    private async openFileWithReuseCheck(filePath: string): Promise<void> {
        await this._fileService.openFileWithReuseCheck(filePath);
    }

    /**
     * Set file as hidden on Windows using attrib command
     * On Unix systems, files starting with . are already hidden
     */
    private async setFileHidden(filePath: string): Promise<void> {
        await this._fileService.setFileHidden(filePath);
    }

    /**
     * Trigger snippet insertion in the webview
     */
    public triggerSnippetInsertion(): void {
        if (this._panel) {
            this._panel.webview.postMessage({
                type: 'triggerSnippet'
            });
        }
    }
}
