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
import { FormatConverter } from './services/export/FormatConverter';
import { SaveEventCoordinator } from './saveEventCoordinator';
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

    // STATE-2: Board caching infrastructure (single source of truth)
    private _cachedBoard: KanbanBoard | null = null;  // Cached generated board
    private _boardCacheValid: boolean = false;        // Cache validity flag

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
            (document) => this.notifyExternalChanges(
                document,
                () => this._messageHandler?.getUnifiedFileState(),
                this._undoRedoManager,
                this.getBoard()
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
                getCurrentBoard: () => this.getBoard(),
                setBoard: (board: KanbanBoard) => {
                    this._cachedBoard = board;
                    this._boardCacheValid = true;
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
                        this._cachedBoard = cachedBoard;
                        this._boardCacheValid = true;
                    }

                    if (hasChanges && cachedBoard) {
                        // User edited the board - mark as having unsaved changes
                        // NOTE: Do NOT generate markdown here - only during actual save operation
                        console.log('[markUnsavedChanges callback] User edited board - marking as unsaved changes');

                        // Track changes in include files (updates their cache)
                        await this._includeFileManager.trackIncludeFileUnsavedChanges(cachedBoard, () => this._fileManager.getDocument(), () => this._fileManager.getFilePath());

                        // Mark main file as having unsaved changes (without updating content)
                        const mainFile = this._getMainFile();
                        if (mainFile) {
                            // CRITICAL FIX: Only mark as unsaved, do NOT update content here
                            // Content generation happens ONLY during save operation
                            mainFile.setContent(mainFile.getContent(), false); // Force hasUnsavedChanges = true
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
                            // CRITICAL FIX: Only mark as unsaved, do NOT update content here
                            const mainFile = this._getMainFile();
                            if (mainFile) {
                                mainFile.setContent(mainFile.getContent(), false); // Force hasUnsavedChanges = true
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
                    this.syncDirtyItems();

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
            console.log('[loadMarkdownFile] Starting initial board load - blocking reloaded events');

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
        const board = this.getBoard();
        console.log(`[_syncMainFileToRegistry] Board exists: ${!!board}, Board valid: ${board?.valid}`);
        if (board && board.valid) {
            // Step 1: Create include file instances in registry
            this._syncIncludeFilesWithRegistry(board);

            // Step 2: Mark includes as loading (sets loading flags on columns/tasks)
            this._markIncludesAsLoading(board);

            // Step 3: Load content asynchronously (will send updates as each include loads)
            // Don't await - let it run in background while we send initial board
            // NOTE: _isInitialBoardLoad flag already set in loadMarkdownFile()

            this._loadIncludeContentAsync(board)
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
        // RACE-4: Wrap entire operation with lock to prevent concurrent content changes
        return this._withLock('handleContentChange', async () => {
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
            const board = this.getBoard();

            // Helper: Clear backend cache for files being unloaded
            const clearFileCache = (files: string[], label: string) => {
                for (const file of files) {
                    const instance = this._fileRegistry.getByRelativePath(file);
                    if (instance) {
                        console.log(`[UNIFIED] ${label}: Clearing cache for ${file}`);
                        instance.discardChanges(); // Revert to baseline (disk content)
                    }
                }
            };

            for (const switchInfo of params.switchedIncludes!) {
                if (switchInfo.columnId) {
                    // Column include switch
                    const column = board?.columns.find(c => c.id === switchInfo.columnId);
                    if (column) {
                        console.log(`[UNIFIED] Column switch: unsetting old includes, clearing cache`);
                        clearFileCache(switchInfo.oldFiles, 'Column switch');

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
                    const column = board?.columns.find(c => c.id === switchInfo.columnIdForTask);
                    const task = column?.tasks.find(t => t.id === switchInfo.taskId);

                    if (task) {
                        console.log(`[UNIFIED] Task switch: unsetting old includes, clearing cache`);
                        console.log(`[UNIFIED]   Old: includeFiles=${task.includeFiles}, displayTitle="${task.displayTitle}", description length=${task.description?.length || 0}`);
                        clearFileCache(switchInfo.oldFiles, 'Task switch');

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

        // Step 4: External include changes are handled autonomously by file instances
        // (prevents duplicate dialogs, maintains single responsibility)
        if (hasIncludeChanges) {
            console.log('[UNIFIED] External include changes detected - files will handle autonomously');
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
                    this._cachedBoard = board;
                    this._boardCacheValid = true;

                    // Send full board to frontend
                    this._sendBoardUpdate(board);
                }
            }
        }

            // RACE-4: Invalidate cache after content changes
            // Board state has been modified (switches, reloads, external changes)
            this.invalidateBoardCache();

            console.log('[UNIFIED] Content change complete');
        });
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
     * RACE-2: Sync dirty items to frontend (Optimization 2: Batched sync)
     *
     * Called when view becomes visible to apply any pending DOM updates.
     * Also called after editing stops to ensure skipped updates are applied.
     */
    public syncDirtyItems(): void {
        const board = this.getBoard();
        if (!board || !this._panel) return;

        if (this._dirtyColumns.size === 0 && this._dirtyTasks.size === 0) {
            return; // Nothing to sync
        }

        console.log(`[syncDirtyItems] Syncing ${this._dirtyColumns.size} columns, ${this._dirtyTasks.size} tasks`);

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
            // DEFERRED: Integrate task include switches into unified handler (see tmp/CLEANUP-2-DEFERRED-ISSUES.md #1)
            // Will be addressed in Phase 6 (Major Refactors) to create updateTaskIncludeFile() similar to updateColumnIncludeFile()
            const board = this.getBoard();
            const column = board?.columns.find(col =>
                col.tasks.some(t => t.id === params.taskId)
            );
            const task = column?.tasks.find(t => t.id === params.taskId);

            if (task && params.newFiles.length > 0) {
                await this.loadNewTaskIncludeContent(task, params.newFiles);
            }
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
    public async updateColumnIncludeFile(
        columnId: string,
        oldFiles: string[],
        newFiles: string[],
        newTitle: string,
        onComplete?: () => void
    ): Promise<void> {
        // RACE-4: Wrap entire operation with lock to prevent concurrent include switches
        return this._withLock('updateColumnIncludeFile', async () => {
            console.log(`[SWITCH-1] updateColumnIncludeFile START`);
        console.log(`[SWITCH-1]   columnId: ${columnId}`);
        console.log(`[SWITCH-1]   oldFiles: [${oldFiles.join(', ')}]`);
        console.log(`[SWITCH-1]   newFiles: [${newFiles.join(', ')}]`);
        console.log(`[SWITCH-1]   newTitle: "${newTitle}"`);

        // STEP 0: Verify column exists
        const board = this.getBoard();
        if (!board) {
            throw new Error('[SWITCH-1] No board loaded');
        }

        const column = board.columns.find(c => c.id === columnId);
        if (!column) {
            throw new Error(`[SWITCH-1] Column ${columnId} not found in board`);
        }

        console.log(`[SWITCH-1] Column found: "${column.title}"`);

        // STEP 1: Save undo state FIRST (before ANY changes)
        // This captures the current state so undo can restore it
        console.log(`[SWITCH-1] STEP 1: Saving undo state`);
        this._undoRedoManager.saveStateForUndo(board);

        // STEP 2: Prompt for unsaved changes in old files
        console.log(`[SWITCH-1] STEP 2: Checking for unsaved changes in old files`);
        const filesToUnload = oldFiles.filter(old => !newFiles.includes(old));

        if (filesToUnload.length > 0) {
            const unsavedFiles = filesToUnload.filter(relativePath => {
                const file = this._fileRegistry.getByRelativePath(relativePath);
                return file && file.hasUnsavedChanges();
            });

            if (unsavedFiles.length > 0) {
                console.log(`[SWITCH-1] Found ${unsavedFiles.length} unsaved files: [${unsavedFiles.join(', ')}]`);

                const choice = await vscode.window.showWarningMessage(
                    `The following include files have unsaved changes:\n${unsavedFiles.join('\n')}\n\nDo you want to save them before switching?`,
                    { modal: true },
                    'Save',
                    'Discard',
                    'Cancel'
                );

                if (choice === 'Save') {
                    console.log(`[SWITCH-1] User chose to save unsaved files`);
                    for (const relativePath of unsavedFiles) {
                        const file = this._fileRegistry.getByRelativePath(relativePath);
                        if (file) {
                            await file.save();
                        }
                    }
                } else if (choice === 'Cancel') {
                    console.log(`[SWITCH-1] User cancelled switch`);
                    throw new Error('USER_CANCELLED');
                }
                // If 'Discard', continue
                console.log(`[SWITCH-1] User chose to discard changes, continuing`);
            }
        }

        // STEP 3: Cleanup old files (stopWatching + unregister)
        console.log(`[SWITCH-1] STEP 3: Cleaning up old files`);
        for (const relativePath of filesToUnload) {
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file) {
                console.log(`[SWITCH-1]   Cleaning up: ${relativePath}`);
                file.stopWatching();
                this._fileRegistry.unregister(file.getPath());
                // Note: unregister() calls dispose() internally
            }
        }

        // STEP 4: Update board state (title + includeFiles + includeMode)
        console.log(`[SWITCH-1] STEP 4: Updating board state`);
        column.title = newTitle;
        column.originalTitle = newTitle;
        column.includeFiles = [...newFiles]; // Store ORIGINAL paths (no normalization)
        column.includeMode = newFiles.length > 0;

        // Clear tasks until new content loads
        column.tasks = [];

        // Parse display title (remove !!!include()!!! syntax for UI)
        column.displayTitle = newTitle.replace(/!!!include\([^)]+\)!!!/g, '').trim();
        if (!column.displayTitle) {
            column.displayTitle = 'Untitled Column';
        }

        console.log(`[SWITCH-1]   Updated column.title: "${column.title}"`);
        console.log(`[SWITCH-1]   Updated column.displayTitle: "${column.displayTitle}"`);
        console.log(`[SWITCH-1]   Updated column.includeFiles: [${column.includeFiles.join(', ')}]`);
        console.log(`[SWITCH-1]   Updated column.includeMode: ${column.includeMode}`);

        // STEP 5: Register new file instances (if not already registered)
        console.log(`[SWITCH-1] STEP 5: Registering new file instances`);
        const mainFile = this._fileRegistry.getMainFile();
        if (!mainFile) {
            throw new Error('[SWITCH-1] Main file not found in registry');
        }

        for (const relativePath of newFiles) {
            if (!this._fileRegistry.hasByRelativePath(relativePath)) {
                console.log(`[SWITCH-1]   Creating new ColumnIncludeFile: ${relativePath}`);
                const columnIncludeFile = this._fileFactory.createColumnInclude(
                    relativePath,
                    mainFile,
                    false // autoLoad=false, we'll load manually next
                );
                this._fileRegistry.register(columnIncludeFile);
                columnIncludeFile.startWatching();
            } else {
                console.log(`[SWITCH-1]   File already registered: ${relativePath}`);
            }
        }

        // STEP 6: Load new content (with FOUNDATION-2 cancellation protection)
        console.log(`[SWITCH-1] STEP 6: Loading new content`);
        const tasks: KanbanTask[] = [];

        for (const relativePath of newFiles) {
            const file = this._fileRegistry.getByRelativePath(relativePath) as ColumnIncludeFile;
            if (!file) {
                console.warn(`[SWITCH-1] File not found after registration: ${relativePath}`);
                continue;
            }

            // Ensure file has content loaded (reload() has cancellation protection from FOUNDATION-2)
            if (!file.getContent() || file.getContent().length === 0) {
                console.log(`[SWITCH-1]   Loading content from disk: ${relativePath}`);
                await file.reload();
            }

            // Parse tasks from file content
            if (file.parseToTasks) {
                const fileTasks = file.parseToTasks(column.tasks); // Preserve existing task IDs if any
                console.log(`[SWITCH-1]   Parsed ${fileTasks.length} tasks from ${relativePath}`);
                tasks.push(...fileTasks);
            }
        }

        // Update column with loaded tasks
        column.tasks = tasks;
        console.log(`[SWITCH-1]   Total tasks loaded: ${tasks.length}`);

        // STEP 7: Send updateColumnContent to frontend
        console.log(`[SWITCH-1] STEP 7: Sending updateColumnContent to frontend`);
        this._panel?.webview.postMessage({
            type: 'updateColumnContent',
            columnId: column.id,
            tasks: column.tasks,
            columnTitle: column.title,
            displayTitle: column.displayTitle,
            includeMode: column.includeMode,
            includeFiles: column.includeFiles
        });

        // STEP 8: REMOVED - sendBoardUpdate() causes full board redraw
        // updateColumnContent (Step 7) is sufficient - only updates the switched column
            // Avoids unnecessary visual flickering and performance issues

            console.log(`[SWITCH-1] updateColumnIncludeFile COMPLETE ✓`);

            // RACE-4: Invalidate cache after include switch
            // Board structure has changed (includeFiles, tasks), next getBoard() should regenerate
            this.invalidateBoardCache();

            // RACE-1: Call completion callback (if provided)
            // This allows caller to unblock board regenerations safely
            if (onComplete) {
                console.log(`[SWITCH-1] Calling completion callback`);
                onComplete();
            }
        });
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

                // RACE-3: Only process if this event is newer than last processed
                // When multiple external changes happen rapidly, reloads can complete out of order.
                // This ensures only the newest data is applied to the frontend.
                if (!this._isEventNewer(file, event.timestamp)) {
                    console.log(`[RACE-3] Skipping stale reloaded event for ${file.getRelativePath()}`);
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
        const board = this.getBoard();
        if (!board || !this._panel) {
            console.warn(`[_sendIncludeFileUpdateToFrontend] No board or panel available`);
            return;
        }

        const relativePath = file.getRelativePath();
        const fileType = file.getFileType();

        console.log(`[_sendIncludeFileUpdateToFrontend] Sending update for ${fileType}: ${relativePath}`);

        if (fileType === 'include-column') {
            // Find column that uses this include file
            // FOUNDATION-1: Use normalized path comparison instead of === comparison
            const column = board.columns.find(c =>
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

                // RACE-4: Invalidate cache after modifying board
                // The cached board now contains updated data, but next operation should regenerate from files
                this.invalidateBoardCache();
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

                console.log(`[_sendIncludeFileUpdateToFrontend] Sent task update with ${fullContent.length} chars`);

                // RACE-4: Invalidate cache after modifying board
                this.invalidateBoardCache();
            }
        } else if (fileType === 'include-regular') {
            // Regular include - regenerate board from registry
            // Note: Main file structure hasn't changed, but include content has
            // Regular includes (!!!include()!!!) are resolved on frontend during markdown rendering
            console.log(`[_sendIncludeFileUpdateToFrontend] Regular include changed - regenerating board`);

            // Invalidate cache and regenerate from registry
            // This ensures column/task includes are properly loaded
            this.invalidateBoardCache();
            const board = this.getBoard();

            if (board && board.valid) {
                console.log(`[_sendIncludeFileUpdateToFrontend] Board regenerated, sending update to frontend`);
                // Send full board update - frontend will re-render markdown with updated includes
                await this.sendBoardUpdate(false, true);
            } else {
                console.warn(`[_sendIncludeFileUpdateToFrontend] Board regeneration failed or invalid`);
            }
        }
    }

    /**
     * Send full board update to frontend with all configuration
     * Helper to consolidate board update message logic
     */
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
            console.log(`[RACE-4] Operation "${operationName}" waiting for "${this._operationInProgress}" to complete`);

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
        console.log(`[RACE-4] Operation "${operationName}" started (lock acquired)`);

        try {
            const result = await operation();
            return result;
        } finally {
            // Release lock
            this._operationInProgress = null;
            console.log(`[RACE-4] Operation "${operationName}" completed (lock released)`);

            // Process next queued operation
            const next = this._pendingOperations.shift();
            if (next) {
                console.log(`[RACE-4] Processing queued operation "${next.name}"`);
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
            console.log(`[RACE-3] First event for ${relativePath}, accepting`);
            return true;
        }

        if (eventTimestamp > lastProcessed) {
            // Newer event - accept and update timestamp
            console.log(`[RACE-3] Newer event for ${relativePath} (${eventTimestamp.toISOString()} > ${lastProcessed.toISOString()})`);
            this._lastProcessedTimestamps.set(relativePath, eventTimestamp);
            return true;
        }

        // Older or same timestamp - reject
        console.log(`[RACE-3] Ignoring stale event for ${relativePath} (${eventTimestamp.toISOString()} <= ${lastProcessed.toISOString()})`);
        return false;
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
            console.log('[STATE-2] getBoard() - Returning cached board');
            return this._cachedBoard;
        }

        // Generate fresh board from registry
        console.log('[STATE-2] getBoard() - Cache invalid, generating fresh board');
        const board = this._fileRegistry.generateBoard();

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
     */
    public invalidateBoardCache(): void {
        console.log('[STATE-2] invalidateBoardCache() - Cache invalidated');
        this._boardCacheValid = false;
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
            console.log('[PanelClose] No unsaved changes - allowing close');
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
            console.log('[PanelClose] User cancelled close');
            return;
        }

        if (choice === saveAndClose) {
            // Save all changes and then close
            console.log('[PanelClose] Saving all changes before close');
            try {
                await this.saveToMarkdown(true, true); // Save with version tracking and trigger save
                console.log('[PanelClose] Save completed, now closing');
                this.dispose();
            } catch (error) {
                console.error('[PanelClose] Save failed:', error);
                // Don't close if save failed
                this._isClosingPrevented = true;
            }
        } else if (choice === closeWithoutSaving) {
            // Discard changes and close
            console.log('[PanelClose] Discarding changes and closing');
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
        console.log(`[updateIncludeContentUnified] Called with ${newIncludeFiles.length} files:`, newIncludeFiles);
        console.log(`[updateIncludeContentUnified] Column ID: ${column.id}, Column title: ${column.title}`);

        // Note: Unsaved changes check happens in handleBoardUpdate BEFORE this is called

        // SOLUTION 3: NUCLEAR OPTION - Always create fresh file instances, never reuse
        // Normalize all paths for consistent operations
        const normalizedNewFiles = newIncludeFiles.map(f => this._includeFileManager.normalizeIncludePath(f));
        const oldIncludeFiles = column.includeFiles || [];
        const normalizedOldFiles = oldIncludeFiles.map(f => this._includeFileManager.normalizeIncludePath(f));

        const filesToRemove = normalizedOldFiles.filter((old: string) =>
            !normalizedNewFiles.includes(old)
        );

        console.log(`[updateIncludeContentUnified] Files to remove: ${filesToRemove.length}`, filesToRemove);

        // STEP 1: Cleanup old files
        for (const oldFilePath of filesToRemove) {
            const oldFile = this._fileRegistry.getByRelativePath(oldFilePath);
            if (oldFile) {
                console.log(`[updateIncludeContentUnified] Cleaning up old include file: ${oldFilePath}`);
                oldFile.stopWatching();
                this._fileRegistry.unregister(oldFile.getPath());
                console.log(`[updateIncludeContentUnified] ✓ Old file unregistered and disposed`);
            }
        }

        // STEP 2: ALWAYS unregister existing files (even if we're switching back)
        // This ensures fresh state and prevents stale baseline issues
        for (const newFilePath of normalizedNewFiles) {
            const existingFile = this._fileRegistry.getByRelativePath(newFilePath);
            if (existingFile) {
                console.log(`[updateIncludeContentUnified] Unregistering existing file for fresh start: ${newFilePath}`);
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
            console.log('[updateIncludeContentUnified] Creating fresh ColumnIncludeFile instance:', relativePath);
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
            console.log('[updateIncludeContentUnified] Reloading file content:', relativePath);
            await columnInclude.reload();

            // Pass existing tasks to preserve IDs during re-parse
            const tasks = columnInclude.parseToTasks(existingTasks);
            console.log(`[updateIncludeContentUnified] Parsed ${tasks.length} tasks from ${relativePath}`);
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

            // FIX: Must normalize path - registry does NOT normalize internally!
            const normalizedIncludeFile = this._includeFileManager.normalizeIncludePath(fileState);

            // SOLUTION 3: NUCLEAR OPTION - Always create fresh file instances, never reuse
            const oldIncludeFiles = task.includeFiles || [];
            const normalizedNewFiles = [normalizedIncludeFile];
            const normalizedOldFiles = oldIncludeFiles.map(f => this._includeFileManager.normalizeIncludePath(f));

            const filesToRemove = normalizedOldFiles.filter(old => !normalizedNewFiles.includes(old));

            // STEP 1: Cleanup old files
            for (const oldFilePath of filesToRemove) {
                const oldFile = this.fileRegistry?.getByRelativePath(oldFilePath);
                if (oldFile) {
                    console.log(`[loadNewTaskIncludeContent] Cleaning up old include file: ${oldFilePath}`);
                    oldFile.stopWatching();
                    this.fileRegistry.unregister(oldFile.getPath());
                    console.log(`[loadNewTaskIncludeContent] ✓ Old file unregistered and disposed`);
                }
            }

            // STEP 2: ALWAYS unregister existing file (even if switching back)
            // This ensures fresh state and prevents stale baseline issues
            const existingFile = this.fileRegistry?.getByRelativePath(normalizedIncludeFile);
            if (existingFile) {
                console.log(`[loadNewTaskIncludeContent] Unregistering existing file for fresh start: ${normalizedIncludeFile}`);
                existingFile.stopWatching();
                this.fileRegistry.unregister(existingFile.getPath());
            }

            // STEP 3: ALWAYS create fresh instance (Solution 3)
            const mainFile = this.fileRegistry.getMainFile();
            if (!mainFile) {
                console.error('[loadNewTaskIncludeContent] ❌ No main file found!');
                return;
            }

            console.log('[loadNewTaskIncludeContent] Creating fresh TaskIncludeFile instance:', normalizedIncludeFile);
            const taskInclude = this._fileFactory.createTaskInclude(
                normalizedIncludeFile,
                mainFile,
                false
            );
            taskInclude.setTaskId(task.id);
            this.fileRegistry.register(taskInclude);
            taskInclude.startWatching();
            console.log('[loadNewTaskIncludeContent] ✓ Created and registered TaskIncludeFile:', normalizedIncludeFile);

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

                // FIX: MUST normalize paths before storing - this is CRITICAL for consistent registry lookups!
                // Store normalized paths so all future lookups will work (registry does NOT normalize internally)
                task.includeFiles = newIncludeFiles.map(f => this._includeFileManager.normalizeIncludePath(f));

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
        console.log('[notifyExternalChanges] External changes are now handled by the unified system');
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
