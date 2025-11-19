import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { getOutputChannel } from './extension';
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
import { FormatConverter } from './services/export/FormatConverter';
import { SaveEventCoordinator } from './saveEventCoordinator';
import { SaveCoordinator } from './core/SaveCoordinator';
import { IncludeFileManager } from './includeFileManager';
import { KanbanFileService } from './kanbanFileService';
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
import { MainFileCoordinator, ChangeAnalysis, ChangeType } from './core/state-machine';
import { ChangeStateMachine } from './core/ChangeStateMachine';

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

    // File abstraction system
    private _fileRegistry: MarkdownFileRegistry;
    private _fileFactory: FileFactory;

    // State machine coordinator for unified change handling
    private _changeCoordinator: MainFileCoordinator | null = null;

    // NEW: Unified change state machine (Phase 6)
    private _stateMachine: ChangeStateMachine;

    // STATE-2: Board caching infrastructure (single source of truth)
    private _cachedBoard: KanbanBoard | null = null;  // Cached generated board
    private _boardCacheValid: boolean = false;        // Cache validity flag
    private _includeSwitchInProgress: boolean = false; // Protects cache during include switches

    // RACE-3: Track last processed timestamp per file to prevent stale updates
    private _lastProcessedTimestamps: Map<string, Date> = new Map();

    // RACE-4: Operation locking to prevent concurrent operations from interfering
    private _operationInProgress: string | null = null;  // Track which operation is running
    private _pendingOperations: Array<{name: string; operation: () => Promise<void>}> = [];  // Queue

    // State
    private _isInitialized: boolean = false;
    public _isUpdatingFromPanel: boolean = false;  // Made public for external access
    private _lastDocumentVersion: number = -1;  // Track document version
    private _isUndoRedoOperation: boolean = false;  // Track undo/redo operations
    private _unsavedChangesCheckInterval?: NodeJS.Timeout;  // Periodic unsaved changes check
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

    // PERFORMANCE: Webview message batching
    private _messageQueue: any[] = [];
    private _messageTimer: NodeJS.Timeout | null = null;
    private readonly MESSAGE_BATCH_DELAY = 50; // Batch messages for 50ms

    // Public getter for webview to allow proper access from messageHandler
    public get webview(): vscode.Webview {
        return this._panel.webview;
    }

    // Method to force refresh webview content (useful during development)
    public async refreshWebviewContent() {
        const board = this.getBoard();
        if (this._panel && board) {
            this._panel.webview.html = this._getHtmlForWebview();

            // Send the board data to the refreshed webview
            // Note: There's a race condition where the webview JavaScript might not be ready yet.
            // Ideally the webview should send a 'ready' message and we wait for that (request-response pattern).
            // For now, sending immediately and the webview should handle late-arriving messages gracefully.
            this._sendBoardUpdate(board);
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
            this._backupManager,
            this._fileRegistry
        );

        // Initialize unified change state machine (Phase 6)
        this._stateMachine = ChangeStateMachine.getInstance();
        this._stateMachine.initialize(this._fileRegistry, this);

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
            () => this.getBoard(),
            (message) => this._panel?.webview.postMessage(message),
            () => this._isUpdatingFromPanel,
            () => this.getBoard()
        );



        // Initialize KanbanFileService
        this._fileService = new KanbanFileService(
            this._fileManager,
            this._fileRegistry,
            this._includeFileManager,
            this._backupManager,
            this._boardOperations,
            () => this.getBoard(),
            (board) => {
                this._cachedBoard = board;
                this._boardCacheValid = true;
            },
            (applyDefaultFolding, isFullRefresh) => this.sendBoardUpdate(applyDefaultFolding, isFullRefresh),
            () => this._panel,
            () => this._context,
            (context) => this.showConflictDialog(context),
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
                getCurrentBoard: () => this.getBoard(),
                setBoard: (board: KanbanBoard) => {
                    this._cachedBoard = board;
                    this._boardCacheValid = true;
                },
                setUndoRedoOperation: (isOperation: boolean) => {
                    this._isUndoRedoOperation = isOperation;
                },
                getWebviewPanel: () => this,
                saveWithBackup: async (label?: string) => {
                    // TODO: Implement backup creation if needed
                },
                markUnsavedChanges: async (hasChanges: boolean, cachedBoard?: any) => {

                    if (!this._isRegistryReady()) {
                        return;
                    }

                    // CRITICAL: Update cached board BEFORE any file operations
                    // This ensures file watchers triggered by saves see the latest board state
                    if (cachedBoard) {
                        this._cachedBoard = cachedBoard;
                        this._boardCacheValid = true;

                        // CRITICAL: Also update MainKanbanFile's cached board for conflict detection
                        const mainFile = this._getMainFile();
                        if (mainFile) {
                            mainFile.setCachedBoardFromWebview(cachedBoard);
                        }
                    }

                    if (hasChanges && cachedBoard) {
                        // User edited the board - mark as having unsaved changes

                        // Track changes in include files (updates their cache)
                        await this._includeFileManager.trackIncludeFileUnsavedChanges(cachedBoard, () => this._fileManager.getDocument(), () => this._fileManager.getFilePath());

                        // Update main file content from board (for verification sync)
                        const mainFile = this._getMainFile();
                        if (mainFile) {
                            // Generate markdown from cached board to keep backend in sync with frontend
                            const markdown = MarkdownKanbanParser.generateMarkdown(cachedBoard);
                            mainFile.setContent(markdown, false); // false = mark as unsaved
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
                            // Frontend sent board changes - update main file content and mark as unsaved
                            const mainFile = this._getMainFile();
                            if (mainFile) {
                                // Generate markdown from cached board to keep backend in sync with frontend
                                const markdown = MarkdownKanbanParser.generateMarkdown(cachedBoard);
                                mainFile.setContent(markdown, false); // false = mark as unsaved
                            }
                        } else if (hasChanges) {
                            // Frontend marking as changed without board (edge case) - should not happen
                            console.warn('[markUnsavedChanges callback] hasChanges=true but no cachedBoard provided');
                        }
                    }
                }
            }
        );

        // Connect message handler to file registry (for stopping edit mode during conflicts)
        this._fileRegistry.setMessageHandler(this._messageHandler);

        // Initialize state in KanbanFileService
        this._fileService.initializeState(
            this._isUpdatingFromPanel,
            this.getBoard(),
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
        const board = this.getBoard();
        if (!board || !board.valid) { return; }

        this._undoRedoManager.saveStateForUndo(board);

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
            const mainFile = this._getMainFile();
            if (mainFile && board) {
                // CRITICAL: use updateFromBoard to update BOTH content AND board object
                mainFile.updateFromBoard(board);
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
            }
        }

        return localResourceRoots;
    }

    private _getLayoutPresetsConfiguration(): any {
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
                        if (!this.getBoard() || !this._isInitialized) {
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

    private async _ensureBoardAndSendUpdate() {
        await this._fileService.ensureBoardAndSendUpdate();
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // STATE-2: Cache board if available
        if (state.cachedBoardFromWebview) {
            this._cachedBoard = state.cachedBoardFromWebview;
            this._boardCacheValid = true;
        }
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    public async loadMarkdownFile(document: vscode.TextDocument, isFromEditorFocus: boolean = false, forceReload: boolean = false) {
        // RACE-4: Wrap entire operation with lock to prevent concurrent file loads
        return this._withLock('loadMarkdownFile', async () => {
            // CRITICAL: Set initial board load flag BEFORE loading main file
            // This prevents the main file's 'reloaded' event from triggering board regeneration
            this._isInitialBoardLoad = true;

            await this._fileService.loadMarkdownFile(document, isFromEditorFocus, forceReload);
            // Sync state back from file service
            const state = this._fileService.getState();
            this._isUpdatingFromPanel = state.isUpdatingFromPanel;
            // STATE-2: Cache board if available
            if (state.cachedBoardFromWebview) {
                this._cachedBoard = state.cachedBoardFromWebview;
                this._boardCacheValid = true;
            }
            this._lastDocumentVersion = state.lastDocumentVersion;
            this._lastDocumentUri = state.lastDocumentUri;
            this._trackedDocumentUri = state.trackedDocumentUri;

            // Phase 1: Create or update MainKanbanFile instance
            await this._syncMainFileToRegistry(document);
        });
    }

    private async sendBoardUpdate(applyDefaultFolding: boolean = false, isFullRefresh: boolean = false) {
        if (!this._panel.webview) { return; }

        let board = this.getBoard() || {
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

        // Get version from package.json
        const packageJson = require('../package.json');
        const version = packageJson.version || 'Unknown';

        // ⚠️ REFRESH ALL CONFIGURATION on initial load
        // This loads shortcuts, tag settings, layout settings, etc.
        await this._refreshAllViewConfiguration();

        // Send boardUpdate immediately - no delay needed
        this._sendBoardUpdate(board, {
            imageMappings,
            isFullRefresh,
            applyDefaultFolding,
            version
        });

        // Send include file contents immediately after board update
        // postMessage guarantees message ordering, so no delay needed
        const includeFiles = this._fileRegistry.getIncludeFiles();
        if (includeFiles.length > 0) {
            for (const file of includeFiles) {
                this.queueMessage({
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
        // STATE-2: Cache board if available
        if (state.cachedBoardFromWebview) {
            this._cachedBoard = state.cachedBoardFromWebview;
            this._boardCacheValid = true;
        }
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    private async initializeFile() {
        await this._fileService.initializeFile();
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        // STATE-2: Cache board if available
        if (state.cachedBoardFromWebview) {
            this._cachedBoard = state.cachedBoardFromWebview;
            this._boardCacheValid = true;
        }
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    private _getHtmlForWebview() {
        const filePath = vscode.Uri.file(path.join(this._context.extensionPath, 'src', 'html', 'webview.html'));
        let html = fs.readFileSync(filePath.fsPath, 'utf8');

        const nonce = this._getNonce();
        const cspSource = this._panel.webview.cspSource;

        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data: blob:; media-src ${cspSource} https: data: blob:; script-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; frame-src 'none'; worker-src blob:; child-src blob:;">`;

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

        const board = this.getBoard();
        if (!board) {
            return [];
        }

        const document = this._fileManager.getDocument();
        if (!document) {
            return [];
        }

        const documentDir = path.dirname(document.uri.fsPath);

        // Pattern to match markdown images: ![alt](path)
        // Use lazy matching to handle brackets in alt text
        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
        // Pattern to match HTML img/video/audio tags
        const htmlMediaRegex = /<(?:img|video|audio)[^>]+src=["']([^"']+)["'][^>]*>/gi;

        // Scan all columns and tasks
        for (const column of board.columns) {
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
                    }
                } catch (error) {
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

            // Initialize change coordinator for this main file
            if (!this._changeCoordinator) {
                this._changeCoordinator = new MainFileCoordinator(filePath, {
                    enableLogging: true,
                    maxHistorySize: 50,
                    enableAutoRollback: true
                });
            }
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
            this.syncIncludeFilesWithRegistry(board);

            // Step 2: Mark includes as loading (sets loading flags on columns/tasks)
            this._markIncludesAsLoading(board);

            // Step 3: Load content asynchronously (will send updates as each include loads)
            // Don't await - let it run in background while we send initial board
            // NOTE: _isInitialBoardLoad flag already set in loadMarkdownFile()

            this._loadIncludeContentAsync(board)
                .then(() => {
                    this._isInitialBoardLoad = false;
                })
                .catch(error => {
                    console.error('[_syncMainFileToRegistry] Error loading include content:', error);
                    this._isInitialBoardLoad = false;
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
                            const tasks = file.parseToTasks(column.tasks, column.id);
                            column.tasks = tasks;
                            column.isLoadingContent = false; // Clear loading flag


                            // CRITICAL FIX: Don't send updates during include switch
                            // The state machine handles all updates during switches
                            if (this._includeSwitchInProgress) {
                                continue;
                            }

                            // Send update to frontend
                            if (this._panel) {
                                this.queueMessage({
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


                                // CRITICAL FIX: Don't send updates during include switch
                                // The state machine handles all updates during switches
                                if (this._includeSwitchInProgress) {
                                    continue;
                                }

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

        // Load regular includes - send update for each one
        const mainFile = this._fileRegistry.getMainFile();
        if (mainFile) {
            const regularIncludes = mainFile.getIncludedFiles();

            for (const relativePath of regularIncludes) {
                const file = this._fileRegistry.getByRelativePath(relativePath) as RegularIncludeFile;
                if (file) {
                    try {
                        // Reload from disk
                        await file.reload();
                        const content = file.getContent();


                        // Send update to frontend
                        if (this._panel) {
                            this.queueMessage({
                                type: 'updateIncludeContent',
                                filePath: relativePath,
                                content: content
                            });
                        }
                    } catch (error) {
                        console.error(`[_loadIncludeContentAsync] Failed to load regular include ${relativePath}:`, error);
                    }
                }
            }

            // Trigger re-render after all regular includes are loaded
            if (regularIncludes.length > 0 && this._panel) {
                this.queueMessage({
                    type: 'includesUpdated'
                });
            }
        }

    }

    /**
     * Phase 1: Sync include files with registry (create instances for all includes in the board)
     */
    private syncIncludeFilesWithRegistry(board: KanbanBoard): void {
        const mainFile = this._fileRegistry.getMainFile();
        if (!mainFile) {
            console.warn(`[KanbanWebviewPanel] Cannot sync include files - no main file in registry`);
            return;
        }

        let createdCount = 0;

        // Sync column includes
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const existingFile = this._fileRegistry.getByRelativePath(relativePath);

                    // Check if file exists with WRONG type - this can happen if inline includes register before board sync
                    if (existingFile && existingFile.getFileType() !== 'include-column') {
                        console.warn(`[KanbanWebviewPanel] File ${relativePath} registered as ${existingFile.getFileType()} but should be include-column! Replacing...`);
                        this._fileRegistry.unregister(relativePath);
                    }

                    if (!this._fileRegistry.hasByRelativePath(relativePath)) {

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

                        // Register with coordinator
                        if (this._changeCoordinator) {
                            this._changeCoordinator.registerIncludeFile(
                                relativePath,
                                'column',
                                columnInclude.getPath()
                            );
                        }

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
                        const existingFile = this._fileRegistry.getByRelativePath(relativePath);

                        // Check if file exists with WRONG type - this can happen if inline includes register before board sync
                        if (existingFile && existingFile.getFileType() !== 'include-task') {
                            console.warn(`[KanbanWebviewPanel] File ${relativePath} registered as ${existingFile.getFileType()} but should be include-task! Replacing...`);
                            this._fileRegistry.unregister(relativePath);
                        }

                        if (!this._fileRegistry.hasByRelativePath(relativePath)) {

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

                            // Register with coordinator
                            if (this._changeCoordinator) {
                                this._changeCoordinator.registerIncludeFile(
                                    relativePath,
                                    'task',
                                    taskInclude.getPath()
                                );
                            }

                            createdCount++;
                        }
                    }
                }
            }
        }

        // Sync regular includes (!!!include(path)!!! in task descriptions)
        const regularIncludes = mainFile.getIncludedFiles();

        for (const relativePath of regularIncludes) {
            const existingFile = this._fileRegistry.getByRelativePath(relativePath);

            // Check if file exists with WRONG type
            if (existingFile && existingFile.getFileType() !== 'include-regular') {
                console.warn(`[KanbanWebviewPanel] File ${relativePath} registered as ${existingFile.getFileType()} but should be include-regular! Replacing...`);
                this._fileRegistry.unregister(relativePath);
            }

            if (!this._fileRegistry.hasByRelativePath(relativePath)) {

                const regularInclude = this._fileFactory.createRegularInclude(
                    relativePath,
                    mainFile,
                    true // Regular includes are inline
                );

                // Register and start watching
                this._fileRegistry.register(regularInclude);
                regularInclude.startWatching();

                // Register with coordinator
                if (this._changeCoordinator) {
                    this._changeCoordinator.registerIncludeFile(
                        relativePath,
                        'regular',
                        regularInclude.getPath()
                    );
                }

                createdCount++;
            }
        }


        // CRITICAL FIX: Also UPDATE content of existing include files with board changes
        this._updateIncludeFilesContent(board);
    }

    /**
     * CRITICAL: Update content of existing include files with board changes
     * This ensures that when you edit tasks/columns in the Kanban, the include files are updated
     */
    private _updateIncludeFilesContent(board: KanbanBoard): void {

        // Update column include files
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const file = this._fileRegistry.getByRelativePath(relativePath);
                    if (file && file.getFileType() === 'include-column') {
                        // CRITICAL: Use the ColumnIncludeFile's updateTasks() method
                        // which generates the correct PRESENTATION format (slides with --- separators)
                        // NOT task list markdown!
                        const columnIncludeFile = file as ColumnIncludeFile;
                        columnIncludeFile.updateTasks(column.tasks);

                    }
                }
            }
        }

        // Update task include files
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const file = this._fileRegistry.getByRelativePath(relativePath);
                        if (file && file.getFileType() === 'include-task') {
                            // For task includes, the description IS the file content
                            const taskContent = task.description || '';

                            // Update file content (marks as having unsaved changes)
                            file.setContent(taskContent, false);  // false = don't update baseline, mark as unsaved

                        }
                    }
                }
            }
        }
    }


    /**
     * UNIFIED CONTENT CHANGE HANDLER (State Machine Integrated)
     *
     * Single entry point for ALL content changes (external, edits, switches)
     * Now uses MainFileCoordinator for state machine management.
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
        this._isEditingInProgress = isEditing;
    }

    /**
     * Mark a column as having unrendered changes (cache updated, DOM not synced)
     */
    public markColumnDirty(columnId: string): void {
        this._dirtyColumns.add(columnId);
    }

    /**
     * Mark a task as having unrendered changes (cache updated, DOM not synced)
     */
    public markTaskDirty(taskId: string): void {
        this._dirtyTasks.add(taskId);
    }

    /**
     * Clear dirty flag for a column (render completed successfully)
     */
    public clearColumnDirty(columnId: string): void {
        this._dirtyColumns.delete(columnId);
    }

    /**
     * Clear dirty flag for a task (render completed successfully)
     */
    public clearTaskDirty(taskId: string): void {
        this._dirtyTasks.delete(taskId);
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
        if (this._includeSwitchInProgress) {
            return;
        }

        const board = this.getBoard();
        if (!board || !this._panel) return;

        if (this._dirtyColumns.size === 0 && this._dirtyTasks.size === 0) {
            return; // Nothing to sync
        }


        // Collect dirty columns
        const dirtyColumns: any[] = [];
        for (const columnId of this._dirtyColumns) {
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
        for (const taskId of this._dirtyTasks) {
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
    }): Promise<void> {

        // Route through unified change state machine
        const board = this.getBoard();
        const column = params.columnId ? board?.columns.find((c: any) => c.id === params.columnId) :
                       board?.columns.find((c: any) => c.tasks.some((t: any) => t.id === params.taskId));

        const result = await this._stateMachine.processChange({
            type: 'include_switch',
            target: params.columnId ? 'column' : 'task',
            targetId: params.columnId || params.taskId!,
            columnIdForTask: params.columnId ? undefined : column?.id,
            oldFiles: params.oldFiles,
            newFiles: params.newFiles,
            newTitle: params.newTitle
        });

        if (!result.success) {
            console.error('[handleIncludeSwitch] State machine failed:', result.error);
            throw result.error || new Error('Include switch failed');
        }

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
                if (this._isInitialBoardLoad) {
                    return;
                }

                // Main file reloaded from disk, regenerate board and update frontend
                this.invalidateBoardCache();
                const board = this.getBoard();
                if (board) {
                    this._sendBoardUpdate(board);
                }
            }
        } else if (fileType === 'include-column' || fileType === 'include-task' || fileType === 'include-regular') {

            if (event.changeType === 'reloaded') {
                // CRITICAL: Skip 'reloaded' events during initial board load
                // These are just loading content for the first time, not actual changes
                if (this._isInitialBoardLoad) {
                    return;
                }

                // RACE-3: Only process if this event is newer than last processed
                // When multiple external changes happen rapidly, reloads can complete out of order.
                // This ensures only the newest data is applied to the frontend.
                if (!this._isEventNewer(file, event.timestamp)) {
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
                const tasks = columnFile.parseToTasks(column.tasks, column.id);
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


                // DON'T invalidate cache for include files - state machine already updated it
                // Cache MUST stay in sync with loaded content. Invalidating would cause IDs to regenerate.
                // NOTE: Even if this were called, the _includeSwitchInProgress flag would block it
                // this.invalidateBoardCache(); // REMOVED - breaks include switching
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


                // DON'T invalidate cache for include files - state machine already updated it
                // Cache MUST stay in sync with loaded content. Invalidating would cause IDs to regenerate.
                // NOTE: Even if this were called, the _includeSwitchInProgress flag would block it
                // this.invalidateBoardCache(); // REMOVED - breaks include switching
            }
        } else if (fileType === 'include-regular') {
            // Regular include - find and update only affected tasks
            // Regular includes (!!!include()!!!) are resolved on frontend during markdown rendering

            // CRITICAL: Send updated include content to frontend cache
            const content = file.getContent();
            this.queueMessage({
                type: 'updateIncludeContent',
                filePath: relativePath,
                content: content
            });

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
            // IMPORTANT: Use queueMessage (not postMessage) to ensure cache update arrives BEFORE task updates
            for (const {task, column} of affectedTasks) {
                // Send task update with current description (frontend will re-render the markdown with updated cache)
                this.queueMessage({
                    type: 'updateTaskContent',
                    columnId: column.id,
                    taskId: task.id,
                    description: task.description, // Same description, but frontend will re-render includes
                    displayTitle: task.displayTitle,
                    taskTitle: task.title,
                    originalTitle: task.originalTitle,
                    includeMode: false, // Regular includes are NOT includeMode
                    regularIncludeFiles: task.regularIncludeFiles // Send the list so frontend knows what changed
                });

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
            const shortcuts = await this._messageHandler.getAllShortcuts();
            this._panel.webview.postMessage({
                type: 'updateShortcuts',
                shortcuts: shortcuts
            });
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
     *
     * @private
     */
    private async _refreshAllViewConfiguration(): Promise<void> {
        if (!this._panel) {
            console.warn('[KanbanWebviewPanel] Cannot refresh configuration - panel is null');
            return;
        }

        try {
            console.log('[KanbanWebviewPanel] Refreshing all view configuration...');

            // 1. Load keyboard shortcuts
            await this._sendShortcutsToWebview();

            // 2. Load all workspace settings and send to webview
            const config = {
                // Layout settings
                columnWidth: configService.getConfig('columnWidth', '350px'),
                columnBorder: configService.getConfig('columnBorder', '1px solid var(--vscode-panel-border)'),
                taskBorder: configService.getConfig('taskBorder', '1px solid var(--vscode-panel-border)'),
                layoutRows: configService.getConfig('layoutRows'),
                rowHeight: configService.getConfig('rowHeight'),
                layoutPreset: configService.getConfig('layoutPreset', 'normal'),
                layoutPresets: this._getLayoutPresetsConfiguration(),
                maxRowHeight: configService.getConfig('maxRowHeight', 0),

                // Task/Content settings
                taskMinHeight: configService.getConfig('taskMinHeight'),
                sectionHeight: configService.getConfig('sectionHeight'),
                taskSectionHeight: configService.getConfig('taskSectionHeight'),
                fontSize: configService.getConfig('fontSize'),
                fontFamily: configService.getConfig('fontFamily'),
                whitespace: configService.getConfig('whitespace', '8px'),

                // Rendering settings
                htmlCommentRenderMode: configService.getConfig('htmlCommentRenderMode', 'hidden'),
                htmlContentRenderMode: configService.getConfig('htmlContentRenderMode', 'html'),

                // Tag settings (CRITICAL: These change frequently!)
                tagColors: configService.getConfig('tagColors', {}),
                enabledTagCategoriesColumn: configService.getEnabledTagCategoriesColumn(),
                enabledTagCategoriesTask: configService.getEnabledTagCategoriesTask(),
                customTagCategories: configService.getCustomTagCategories(),
                tagVisibility: configService.getConfig('tagVisibility'),
                exportTagVisibility: configService.getConfig('exportTagVisibility'),

                // Other settings
                arrowKeyFocusScroll: configService.getConfig('arrowKeyFocusScroll'),
                openLinksInNewTab: configService.getConfig('openLinksInNewTab'),
                pathGeneration: configService.getConfig('pathGeneration')
            };

            // Send configuration to webview
            this._panel.webview.postMessage({
                type: 'configurationUpdate',
                config: config
            });

            console.log('[KanbanWebviewPanel] ✅ Configuration refresh complete');

        } catch (error) {
            console.error('[KanbanWebviewPanel] ❌ Failed to refresh view configuration:', error);
        }
    }

    private _sendBoardUpdate(board: KanbanBoard, options: {
        imageMappings?: Record<string, string>;
        isFullRefresh?: boolean;
        applyDefaultFolding?: boolean;
        version?: string;
    } = {}): void {
        if (!this._panel) return;

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
            columnBorder: configService.getConfig('columnBorder', '1px solid var(--vscode-panel-border)'),
            taskBorder: configService.getConfig('taskBorder', '1px solid var(--vscode-panel-border)'),
            htmlCommentRenderMode: configService.getConfig('htmlCommentRenderMode', 'hidden'),
            htmlContentRenderMode: configService.getConfig('htmlContentRenderMode', 'html'),
            tagColors: configService.getConfig('tagColors', {}),
            enabledTagCategoriesColumn: configService.getEnabledTagCategoriesColumn(),
            enabledTagCategoriesTask: configService.getEnabledTagCategoriesTask(),
            customTagCategories: configService.getCustomTagCategories(),
            // Optional fields for full board loads
            ...(options.imageMappings && { imageMappings: options.imageMappings }),
            ...(options.isFullRefresh !== undefined && { isFullRefresh: options.isFullRefresh }),
            ...(options.applyDefaultFolding !== undefined && { applyDefaultFolding: options.applyDefaultFolding }),
            ...(options.version && { version: options.version })
        });
    }

    /**
     * RACE-4: Execute operation with exclusive lock
     *
     * Prevents concurrent operations from interfering with each other.
     * If an operation is already running, queues the new operation.
     *
     * @param operationName Name for logging
     * @param operation The async operation to execute
     */
    private async _withLock<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
        // If operation already in progress, queue this one
        if (this._operationInProgress) {

            return new Promise((resolve, reject) => {
                this._pendingOperations.push({
                    name: operationName,
                    operation: async () => {
                        try {
                            const result = await operation();
                            resolve(result);
                        } catch (error) {
                            reject(error);
                        }
                    }
                });
            });
        }

        // Acquire lock
        this._operationInProgress = operationName;

        try {
            const result = await operation();
            return result;
        } finally {
            // Release lock
            this._operationInProgress = null;

            // Process next queued operation
            const next = this._pendingOperations.shift();
            if (next) {
                // Run next operation (it will acquire lock)
                next.operation().catch(error => {
                    console.error(`[RACE-4] Queued operation "${next.name}" failed:`, error);
                });
            }
        }
    }

    /**
     * RACE-3: Check if event is newer than last processed event for this file
     *
     * Prevents old events from overriding newer ones. When multiple external changes
     * happen rapidly, reloads can complete out of order. This ensures only the newest
     * data is applied to the frontend.
     *
     * @param file The file that emitted the event
     * @param eventTimestamp The timestamp from the event
     * @returns true if event should be processed, false if it's stale
     */
    private _isEventNewer(file: MarkdownFile, eventTimestamp: Date): boolean {
        const relativePath = file.getRelativePath();
        const lastProcessed = this._lastProcessedTimestamps.get(relativePath);

        if (!lastProcessed) {
            // First event for this file - accept it
            this._lastProcessedTimestamps.set(relativePath, eventTimestamp);
            return true;
        }

        if (eventTimestamp > lastProcessed) {
            // Newer event - accept and update timestamp
            this._lastProcessedTimestamps.set(relativePath, eventTimestamp);
            return true;
        }

        // Older or same timestamp - reject
        return false;
    }

    // OLD HANDLERS REMOVED - All include switches now route through ChangeStateMachine via handleIncludeSwitch()

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

    // ============= STATE-2: Board Caching Methods =============

    /**
     * STATE-2: Get board (single source of truth)
     *
     * Returns cached board if valid, otherwise generates fresh board from registry.
     * This replaces direct access to _board and _cachedBoardFromWebview.
     *
     * @returns KanbanBoard with all include content, or undefined if not ready
     */
    public getBoard(): KanbanBoard | undefined {
        // Check if cache is valid
        if (this._boardCacheValid && this._cachedBoard) {
            return this._cachedBoard;
        }

        // Generate fresh board from registry
        // CRITICAL FIX: Pass existing cached board to preserve column/task IDs
        // This prevents "Column not found" errors when cache is invalidated
        const board = this._fileRegistry.generateBoard(this._cachedBoard || undefined);

        // Cache the result
        if (board) {
            this._cachedBoard = board;
            this._boardCacheValid = true;
        }

        return board;
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
        if (this._includeSwitchInProgress) {
            const stack = new Error().stack;
            return;
        }

        const stack = new Error().stack;
        this._boardCacheValid = false;
    }

    /**
     * Set include switch in-progress flag
     *
     * When true, blocks cache invalidation to prevent ID regeneration during include switches.
     * State machine sets this to true at start of LOADING_NEW, false at COMPLETE.
     */
    public setIncludeSwitchInProgress(inProgress: boolean): void {
        this._includeSwitchInProgress = inProgress;
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
        // Query current unsaved changes state from MarkdownFile
        const mainFile = this._getMainFile();
        const hasUnsavedChanges = mainFile?.hasUnsavedChanges() || false;

        // Get include files unsaved status
        const includeStatus = this._getIncludeFilesUnsavedStatus();

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
            // User cancelled - prevent close
            this._isClosingPrevented = true;
            return;
        }

        if (choice === saveAndClose) {
            // Save all changes and then close
            try {
                await this.saveToMarkdown(true, true); // Save with version tracking and trigger save
                this.dispose();
            } catch (error) {
                console.error('[PanelClose] Save failed:', error);
                // Don't close if save failed
                this._isClosingPrevented = true;
            }
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
        const mainFile = this._getMainFile();
        const hasMainFileChanges = mainFile?.hasUnsavedChanges() || false;

        const includeStatus = this._getIncludeFilesUnsavedStatus();
        const hasIncludeChanges = includeStatus.hasChanges;

        return hasMainFileChanges || hasIncludeChanges;
    }

    /**
     * Save unsaved changes to backup files with "-unsavedchanges" suffix
     * Called when VSCode closes with unsaved changes
     * This creates a safety backup before prompting the user
     */
    public async saveUnsavedChangesBackup(): Promise<void> {
        try {
            console.log('[KanbanWebviewPanel] Creating unsaved changes backup...');

            // Save main file backup
            const mainFile = this._getMainFile();
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
                    console.log(`[KanbanWebviewPanel] ✅ Main file backup saved: ${backupPath}`);
                }
            }

            // Save include files backups
            const includeStatus = this._getIncludeFilesUnsavedStatus();
            if (includeStatus.hasChanges) {
                for (const fileWithChanges of includeStatus.changedFiles) {
                    const includeFile = this._fileRegistry.getByRelativePath(fileWithChanges);
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
                                console.log(`[KanbanWebviewPanel] ✅ Include file backup saved: ${backupPath}`);
                            }
                        }
                    }
                }
            }

            console.log('[KanbanWebviewPanel] ✅ Unsaved changes backup complete');
        } catch (error) {
            console.error('[KanbanWebviewPanel] ❌ Failed to save unsaved changes backup:', error);
            // Don't throw - we want to continue with the close process even if backup fails
        }
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

        // RACE-3: Clear timestamp tracking
        this._lastProcessedTimestamps.clear();

        // RACE-4: Clear operation queue and lock
        this._pendingOperations = [];
        this._operationInProgress = null;

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
        // STATE-2: Cache board if available
        if (state.cachedBoardFromWebview) {
            this._cachedBoard = state.cachedBoardFromWebview;
            this._boardCacheValid = true;
        }
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

        // SOLUTION 3: NUCLEAR OPTION - Always create fresh file instances, never reuse
        // Normalize all paths for consistent operations
        const normalizedNewFiles = newIncludeFiles.map(f => this._includeFileManager.normalizeIncludePath(f));
        const oldIncludeFiles = column.includeFiles || [];
        const normalizedOldFiles = oldIncludeFiles.map(f => this._includeFileManager.normalizeIncludePath(f));

        const filesToRemove = normalizedOldFiles.filter((old: string) =>
            !normalizedNewFiles.includes(old)
        );


        // STEP 1: Cleanup old files
        for (const oldFilePath of filesToRemove) {
            const oldFile = this._fileRegistry.getByRelativePath(oldFilePath);
            if (oldFile) {
                oldFile.stopWatching();
                this._fileRegistry.unregister(oldFile.getPath());
            }
        }

        // STEP 2: ALWAYS unregister existing files (even if we're switching back)
        // This ensures fresh state and prevents stale baseline issues
        for (const newFilePath of normalizedNewFiles) {
            const existingFile = this._fileRegistry.getByRelativePath(newFilePath);
            if (existingFile) {
                existingFile.stopWatching();
                this._fileRegistry.unregister(existingFile.getPath());
            }
        }

        // Store normalized paths
        column.includeFiles = normalizedNewFiles;

        // Keep existing tasks to preserve IDs during re-parse
        const existingTasks = column.tasks;

        // STEP 3: ALWAYS create new file instances (never reuse)
        const allTasks: KanbanTask[] = [];
        for (const relativePath of normalizedNewFiles) {
            const mainFile = this._fileRegistry.getMainFile();
            if (!mainFile) {
                console.error('[updateIncludeContentUnified] ❌ No main file found!');
                continue;
            }

            // ALWAYS create fresh instance (Solution 3)
            const columnInclude = this._fileFactory.createColumnInclude(
                relativePath,
                mainFile,
                false
            );
            columnInclude.setColumnId(column.id);
            columnInclude.setColumnTitle(column.title);
            this._fileRegistry.register(columnInclude);
            columnInclude.startWatching();

            // Reload the file content from disk before parsing
            await columnInclude.reload();

            // Pass existing tasks to preserve IDs during re-parse
            const tasks = columnInclude.parseToTasks(existingTasks, column.id);
            allTasks.push(...tasks);
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
        }
    }

    /**
     * Save all modified column includes when the board is saved
     */
    public async saveAllColumnIncludeChanges(): Promise<void> {
        const board = this.getBoard();
        if (!board) {
            return;
        }

        const includeColumns = board.columns.filter(col => col.includeMode);

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
        const board = this.getBoard();
        if (!board) {
            return;
        }

        // Collect all tasks with include mode from all columns
        const includeTasks: KanbanTask[] = [];
        for (const column of board.columns) {
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
        // STATE-2: Cache board if available
        if (state.cachedBoardFromWebview) {
            this._cachedBoard = state.cachedBoardFromWebview;
            this._boardCacheValid = true;
        }
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
     * Show conflict dialog to user
     */
    public async showConflictDialog(context: ConflictContext): Promise<ConflictResolution> {
        // Use ConflictResolver to handle the dialog
        return await this._conflictResolver.resolveConflict(context);
    }

    /**
     * Notify about external changes - simplified implementation
     */
    public async notifyExternalChanges(
        document: vscode.TextDocument,
        getUnifiedFileState: () => any,
        undoRedoManager: any,
        board: KanbanBoard | undefined
    ): Promise<void> {
        // This method is now handled by the unified conflict resolution system
        // External changes are detected and handled by file watchers and the registry
    }

    /**
     * PERFORMANCE: Queue message for batched sending to webview
     */
    private queueMessage(message: any): void {
        this._messageQueue.push(message);

        if (!this._messageTimer) {
            this._messageTimer = setTimeout(() => {
                this.flushMessages();
            }, this.MESSAGE_BATCH_DELAY);
        }
    }

    /**
     * PERFORMANCE: Flush queued messages to webview
     */
    private flushMessages(): void {
        if (this._messageQueue.length > 0) {
            // Send batched messages
            if (this._panel) {
                this._panel.webview.postMessage({
                    type: 'batch',
                    messages: this._messageQueue
                });
            }
            this._messageQueue = [];
        }
        this._messageTimer = null;
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
