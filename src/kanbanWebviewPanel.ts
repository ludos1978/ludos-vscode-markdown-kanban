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
import { ExternalFileWatcher } from './externalFileWatcher';
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
    private _panelId: string;  // Unique identifier for this panel
    private _trackedDocumentUri: string | undefined;  // Track the document URI for panel map management

    // Unified include file tracking system - single source of truth
    private _recentlyReloadedFiles: Set<string> = new Set(); // Track files that were just reloaded from external
    private _fileWatcher: ExternalFileWatcher;
    private _conflictResolver: ConflictResolver;

    // Method to force refresh webview content (useful during development)
    public async refreshWebviewContent() {
        if (this._panel && this._board) {
            this._panel.webview.html = this._getHtmlForWebview();
            
            // Send the board data to the refreshed webview
            setTimeout(async () => {
                this._panel.webview.postMessage({
                    type: 'updateBoard',
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
            }, 100);
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
        return this._hasUnsavedChanges;
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
            this._conflictResolver,
            this._backupManager,
            () => this._fileManager.getFilePath(),
            () => this._board,
            (message) => this._panel?.webview.postMessage(message),
            () => this._isUpdatingFromPanel,
            () => this._cachedBoardFromWebview
        );

        // Get the file watcher instance (needed before KanbanFileService)
        this._fileWatcher = ExternalFileWatcher.getInstance();

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
            this._fileWatcher,
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

        // Subscribe to file change events
        this._disposables.push(
            this._fileWatcher.onFileChanged((event) =>
                this._includeFileManager.handleExternalFileChange(
                    event,
                    (filePath, changeType) => this._conflictService.handleInlineIncludeFileChange(
                        filePath,
                        changeType,
                        () => this.sendBoardUpdate(false, true)
                    )
                )
            )
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

                    if (hasChanges && cachedBoard) {
                        // Track changes in include files
                        console.log('[markUnsavedChanges callback] Tracking unsaved changes with board having', cachedBoard.columns?.length, 'columns');
                        const onlyIncludeChanges = await this._includeFileManager.trackIncludeFileUnsavedChanges(cachedBoard, () => this._fileManager.getDocument(), () => this._fileManager.getFilePath());
                        console.log('[markUnsavedChanges callback] trackIncludeFileUnsavedChanges returned:', onlyIncludeChanges);

                        // Update main file unsaved changes flag
                        const mainFile = this._getMainFile();
                        if (mainFile && !onlyIncludeChanges) {
                            this._hasUnsavedChanges = true;
                        } else {
                            this._hasUnsavedChanges = false;
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
                        // Update the flag based on whether it's just include files or also main file changes
                        const hasIncludeFileChanges = this._getFilesWithUnsavedChanges().length > 0;

                        if (cachedBoard) {
                            // Frontend sent board changes
                            this._hasUnsavedChanges = true;
                        } else if (hasChanges) {
                            // Frontend marking as changed without board (edge case)
                            this._hasUnsavedChanges = true;
                        }
                        console.log(`[markUnsavedChanges callback] _hasUnsavedChanges set to: ${this._hasUnsavedChanges}`);
                    }

                    if (cachedBoard) {
                        // CRITICAL: Store the cached board data immediately for saving
                        // This ensures we always have the latest data even if webview is disposed
                        this._board = cachedBoard;
                        this._cachedBoardFromWebview = cachedBoard; // Keep a separate reference
                    }
                }
            }
        );

        // Initialize state in KanbanFileService
        this._fileService.initializeState(
            this._isUpdatingFromPanel,
            this._hasUnsavedChanges,
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
            this._hasUnsavedChanges = true;

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
        this._hasUnsavedChanges = state.hasUnsavedChanges;
        this._cachedBoardFromWebview = state.cachedBoardFromWebview;
        this._lastDocumentVersion = state.lastDocumentVersion;
        this._lastDocumentUri = state.lastDocumentUri;
        this._trackedDocumentUri = state.trackedDocumentUri;
    }

    public async loadMarkdownFile(document: vscode.TextDocument, isFromEditorFocus: boolean = false, forceReload: boolean = false) {
        await this._fileService.loadMarkdownFile(document, isFromEditorFocus, forceReload);
        // Sync state back from file service
        const state = this._fileService.getState();
        this._isUpdatingFromPanel = state.isUpdatingFromPanel;
        this._hasUnsavedChanges = state.hasUnsavedChanges;
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

        setTimeout(() => {
            this._panel.webview.postMessage({
                type: 'updateBoard',
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
        }, 10);

        // Send include file contents after board update
        const includeFiles = this._fileRegistry.getIncludeFiles();
        if (includeFiles.length > 0) {
            setTimeout(() => {
                for (const file of includeFiles) {
                    this._panel.webview.postMessage({
                        type: 'updateIncludeContent',
                        filePath: file.getRelativePath(),
                        content: file.getContent()
                    });
                }
            }, 20);
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
        this._hasUnsavedChanges = state.hasUnsavedChanges;
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
        this._hasUnsavedChanges = state.hasUnsavedChanges;
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
        if (this._board && this._board.valid) {
            this._syncIncludeFilesWithRegistry(this._board);
        }

        // Log registry statistics
        this._fileRegistry.logStatistics();
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
     * Handle file registry change events
     */
    private _handleFileRegistryChange(event: FileChangeEvent): void {
        console.log(`[KanbanWebviewPanel] File registry change: ${event.file.getRelativePath()} (${event.changeType})`);

        // TODO: Use registry changes to trigger UI updates, handle conflicts, etc.
    }

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

        const result = await this._conflictService._handlePanelClose(
            () => this._messageHandler?.getUnifiedFileState(),
            this._hasUnsavedChanges,
            this._isClosingPrevented,
            this._cachedBoardFromWebview,
            () => this.dispose()
        );

        // Update state from result
        this._hasUnsavedChanges = result.newHasUnsavedChanges;
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
        this._hasUnsavedChanges = false;
        this._isClosingPrevented = false;

        // Stop unsaved changes monitoring
        if (this._unsavedChangesCheckInterval) {
            clearInterval(this._unsavedChangesCheckInterval);
            this._unsavedChangesCheckInterval = undefined;
        }

        // Unregister from external file watcher
        this._fileWatcher.unregisterPanel(this);

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
        this._hasUnsavedChanges = state.hasUnsavedChanges;
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
        // Update the column's include files
        column.includeFiles = newIncludeFiles;

        // Load content from the include files
        const allTasks: KanbanTask[] = [];
        for (const relativePath of newIncludeFiles) {
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file && file.getFileType() === 'include-column') {
                const columnFile = file as any; // ColumnIncludeFile
                const tasks = columnFile.parseToTasks();
                allTasks.push(...tasks);
            }
        }

        // Update the column with the loaded tasks
        column.tasks = allTasks;

        // Update the file watcher
        this._fileWatcher.updateIncludeFiles(this, this._includeFileManager.getAllIncludeFilePaths());
    }

    public async loadNewTaskIncludeContent(task: KanbanTask, newIncludeFiles: string[]): Promise<void> {

        try {
            const currentDocument = this._fileManager.getDocument();
            if (!currentDocument) {
                return;
            }

            const basePath = path.dirname(currentDocument.uri.fsPath);

            // For now, handle single file includes
            const fileState = newIncludeFiles[0];
            const absolutePath = PathResolver.resolve(basePath, fileState);

            // Normalize the path to match keys in _includeFiles map
            const normalizedIncludeFile = this._includeFileManager._normalizeIncludePath(fileState);

            // Reload the file content and then read it
            await this._includeFileManager.readAndUpdateIncludeContent(normalizedIncludeFile, () => this._fileManager.getDocument());
            const fileContent = await this._includeFileManager.readFileContent(normalizedIncludeFile, () => this._fileManager.getDocument());

            if (fileContent !== null) {
                const lines = fileContent.split('\n');

                // Parse first non-empty line as title, rest as description
                let titleFound = false;
                let newTitle = '';
                let descriptionLines: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!titleFound && line) {
                        newTitle = lines[i]; // Use original line with indentation
                        titleFound = true;
                    } else if (titleFound) {
                        descriptionLines.push(lines[i]);
                    }
                }

                // Update the task with parsed content
                // Keep the original title (with include syntax) and set display properties
                task.includeMode = true;
                task.includeFiles = newIncludeFiles;
                task.originalTitle = task.title; // Preserve the include syntax
                task.displayTitle = newTitle || 'Untitled'; // Title from file
                task.description = descriptionLines.join('\n').trim(); // Description from file

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
        this._hasUnsavedChanges = state.hasUnsavedChanges;
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
