import { FileManager } from './fileManager';
import { BoardStore } from './core/stores';
import { BoardOperations } from './board';
import { LinkHandler } from './linkHandler';
import { MarkdownFile } from './files/MarkdownFile'; // FOUNDATION-1: For path comparison
import { KanbanBoard } from './markdownParser';
import { ConfigurationService } from './configurationService';
import { PlantUMLService } from './plantUMLService';
import { PresentationGenerator } from './services/export/PresentationGenerator';
import { getOutputChannel } from './extension';
import { INCLUDE_SYNTAX } from './constants/IncludeConstants';
import { TemplateService } from './templates/TemplateService';
import { VariableProcessor } from './templates/VariableProcessor';
import { FileCopyService } from './templates/FileCopyService';
import { safeFileUri } from './utils/uriUtils';
import { escapeRegExp } from './utils/stringUtils';
// Command Pattern: Registry and commands for message handling
import { CommandRegistry, CommandContext, TaskCommands, ColumnCommands, UICommands, FileCommands, ClipboardCommands, ExportCommands, DiagramCommands, IncludeCommands, EditModeCommands } from './commands';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Helper function to log to both console and output channel
function log(...args: any[]) {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    getOutputChannel()?.appendLine(message);
}

export class MessageHandler {
    private _fileManager: FileManager;
    private _boardStore: BoardStore;
    private _boardOperations: BoardOperations;
    private _linkHandler: LinkHandler;
    private _plantUMLService: PlantUMLService;
    private _onBoardUpdate: () => Promise<void>;
    private _onSaveToMarkdown: () => Promise<void>;
    private _onInitializeFile: () => Promise<void>;
    private _getCurrentBoard: () => KanbanBoard | undefined;
    private _setBoard: (board: KanbanBoard) => void;
    private _setUndoRedoOperation: (isOperation: boolean) => void;
    private _getWebviewPanel: () => any;
    private _markUnsavedChanges: (hasChanges: boolean, cachedBoard?: any) => void;
    private _autoExportSettings: any = null;

    // Command Pattern: Registry for message handlers
    private _commandRegistry: CommandRegistry;
    private _commandContext: CommandContext | null = null;

    // Request-response pattern for stopEditing
    private _pendingStopEditingRequests = new Map<string, { resolve: (value: void) => void, reject: (reason: any) => void, timeout: NodeJS.Timeout }>();
    private _stopEditingRequestCounter = 0;

    constructor(
        fileManager: FileManager,
        boardStore: BoardStore,
        boardOperations: BoardOperations,
        linkHandler: LinkHandler,
        callbacks: {
            onBoardUpdate: () => Promise<void>;
            onSaveToMarkdown: () => Promise<void>;
            onInitializeFile: () => Promise<void>;
            getCurrentBoard: () => KanbanBoard | undefined;
            setBoard: (board: KanbanBoard) => void;
            setUndoRedoOperation: (isOperation: boolean) => void;
            getWebviewPanel: () => any;
            markUnsavedChanges: (hasChanges: boolean, cachedBoard?: any) => void;
        }
    ) {
        this._fileManager = fileManager;
        this._boardStore = boardStore;
        this._boardOperations = boardOperations;
        this._linkHandler = linkHandler;
        this._plantUMLService = new PlantUMLService();
        this._onBoardUpdate = callbacks.onBoardUpdate;
        this._onSaveToMarkdown = callbacks.onSaveToMarkdown;
        this._onInitializeFile = callbacks.onInitializeFile;
        this._getCurrentBoard = callbacks.getCurrentBoard;
        this._setBoard = callbacks.setBoard;
        this._setUndoRedoOperation = callbacks.setUndoRedoOperation;
        this._getWebviewPanel = callbacks.getWebviewPanel;
        this._markUnsavedChanges = callbacks.markUnsavedChanges;

        // Initialize Command Pattern registry (per-instance, not singleton)
        this._commandRegistry = new CommandRegistry();
        this._initializeCommandRegistry();
    }

    /**
     * Initialize the Command Registry with all command handlers
     */
    private _initializeCommandRegistry(): void {
        // Create the command context with all dependencies
        this._commandContext = {
            fileManager: this._fileManager,
            boardStore: this._boardStore,
            boardOperations: this._boardOperations,
            linkHandler: this._linkHandler,
            plantUMLService: this._plantUMLService,
            getFileRegistry: () => this._getWebviewPanel()?._fileRegistry,
            onBoardUpdate: this._onBoardUpdate,
            onSaveToMarkdown: this._onSaveToMarkdown,
            onInitializeFile: this._onInitializeFile,
            getCurrentBoard: this._getCurrentBoard,
            setBoard: this._setBoard,
            setUndoRedoOperation: this._setUndoRedoOperation,
            getWebviewPanel: this._getWebviewPanel,
            markUnsavedChanges: this._markUnsavedChanges,
            getAutoExportSettings: () => this._autoExportSettings,
            setAutoExportSettings: (settings: any) => { this._autoExportSettings = settings; }
        };

        // Register command handlers
        this._commandRegistry.register(new TaskCommands());
        this._commandRegistry.register(new ColumnCommands());
        this._commandRegistry.register(new UICommands());
        this._commandRegistry.register(new FileCommands());
        this._commandRegistry.register(new ClipboardCommands());
        this._commandRegistry.register(new ExportCommands());
        this._commandRegistry.register(new DiagramCommands());
        this._commandRegistry.register(new IncludeCommands());
        this._commandRegistry.register(new EditModeCommands());

        // Initialize the registry with context
        this._commandRegistry.initialize(this._commandContext);
    }

    /**
     * Request frontend to stop editing and wait for response with captured edit
     * Returns a Promise that resolves with the captured edit value from frontend
     * PUBLIC: Can be called from external code (e.g., conflict resolution)
     */
    public async requestStopEditing(): Promise<any> {
        const requestId = `stop-edit-${++this._stopEditingRequestCounter}`;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.warn('[requestStopEditing] No panel or webview available');
            return null;
        }

        return new Promise<any>((resolve, reject) => {
            // Set timeout in case frontend doesn't respond
            const timeout = setTimeout(() => {
                this._pendingStopEditingRequests.delete(requestId);
                console.warn('[requestStopEditing] Timeout waiting for frontend response');
                resolve(null); // Resolve with null if timeout
            }, 2000);

            // Store promise resolver
            this._pendingStopEditingRequests.set(requestId, { resolve, reject, timeout });

            // Send request to frontend to capture edit value
            panel.webview.postMessage({
                type: 'stopEditing',
                requestId,
                captureValue: true  // Tell frontend to capture the edit value
            });
        });
    }

    public async handleMessage(message: any): Promise<void> {
        // Command Pattern: All message handling is done via CommandRegistry
        if (this._commandRegistry.canHandle(message.type)) {
            const result = await this._commandRegistry.execute(message);
            if (result !== null) {
                if (!result.success) {
                    console.error(`[MessageHandler] Command failed for ${message.type}:`, result.error);
                }
                return;
            }
        }

        // Fallback for unregistered message types (should not happen in normal operation)
        console.error(`[MessageHandler] Unknown message type: ${message.type}`);
    }

    /**
     * STATE-3: Unified board action method
     *
     * Performs a board modification action with explicit control over update behavior.
     *
     * @param action The action to perform (returns true on success)
     * @param options Configuration options
     * @param options.saveUndo Whether to save undo state (default: true)
     * @param options.sendUpdate Whether to send board update to frontend (default: true)
     *                           Set to false when frontend already has the change (e.g., live editing)
     */
    private async performBoardAction(
        action: () => boolean,
        options: {
            saveUndo?: boolean;
            sendUpdate?: boolean;
        } = {}
    ) {
        const { saveUndo = true, sendUpdate = true } = options;

        const board = this._getCurrentBoard();
        if (!board) {return;}

        if (saveUndo) {
            this._boardStore.saveStateForUndo(board);
        }

        const success = action();

        if (success) {
            if (sendUpdate) {
                // Backend-initiated change: mark unsaved and send update to frontend
                this._markUnsavedChanges(true);
                await this._onBoardUpdate();
            } else {
                // Frontend-initiated change: just mark backend as unsaved
                // The frontend already has the correct state from immediate updates
                // CRITICAL: Pass the current board so that trackIncludeFileUnsavedChanges is called
                this._markUnsavedChanges(true, this._getCurrentBoard());
            }
        }
    }

    async handleBoardUpdate(message: any): Promise<void> {
        try {
            const board = message.board;
            if (!board) {
                console.error('[boardUpdate] No board data provided');
                return;
            }

            // CRITICAL: Check for unsaved changes in include files BEFORE updating the board
            const panel = this._getWebviewPanel();
            const oldBoard = this._getCurrentBoard();


            if (oldBoard && panel) {

                // Check column includes
                for (let i = 0; i < board.columns.length && i < oldBoard.columns.length; i++) {
                    const newCol = board.columns[i];
                    const oldCol = oldBoard.columns[i];

                    const oldIncludeFiles = oldCol.includeFiles || [];
                    const newIncludeFiles = newCol.includeFiles || [];

                    // FOUNDATION-1: Use normalized comparison
                    const removedFiles = oldIncludeFiles.filter((oldPath: string) =>
                        !newIncludeFiles.some((newPath: string) => MarkdownFile.isSameFile(oldPath, newPath))
                    );

                    for (const removedPath of removedFiles) {
                        const oldFile = panel.fileRegistry?.getByRelativePath(removedPath);
                        if (oldFile && oldFile.hasUnsavedChanges()) {

                            const choice = await vscode.window.showWarningMessage(
                                `The include file "${removedPath}" has unsaved changes and will be unloaded. What would you like to do?`,
                                { modal: true },
                                'Save and Continue',
                                'Discard and Continue',
                                'Cancel'
                            );

                            if (choice === 'Save and Continue') {
                                await oldFile.save();
                            } else if (choice === 'Discard and Continue') {
                                oldFile.discardChanges();
                            } else {
                                return; // Cancel the entire update
                            }
                        }
                    }

                    // Check task includes within this column
                    for (const newTask of newCol.tasks) {
                        const oldTask = oldCol.tasks.find((t: any) => t.id === newTask.id);
                        if (oldTask) {
                            const oldTaskIncludes = oldTask.includeFiles || [];
                            const newTaskIncludes = newTask.includeFiles || [];
                            // FOUNDATION-1: Use normalized comparison
                            const removedTaskFiles = oldTaskIncludes.filter((oldPath: string) =>
                                !newTaskIncludes.some((newPath: string) => MarkdownFile.isSameFile(oldPath, newPath))
                            );

                            for (const removedPath of removedTaskFiles) {
                                const oldFile = panel.fileRegistry?.getByRelativePath(removedPath);
                                if (oldFile && oldFile.hasUnsavedChanges()) {

                                    const choice = await vscode.window.showWarningMessage(
                                        `The include file "${removedPath}" has unsaved changes and will be unloaded. What would you like to do?`,
                                        { modal: true },
                                        'Save and Continue',
                                        'Discard and Continue',
                                        'Cancel'
                                    );

                                    if (choice === 'Save and Continue') {
                                        await oldFile.save();
                                    } else if (choice === 'Discard and Continue') {
                                        oldFile.discardChanges();
                                    } else {
                                        return; // Cancel the entire update
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Set the updated board (now that we've handled unsaved changes)
            this._setBoard(board);

            // Sync include files with registry to create any new include file instances
            if (panel && panel.syncIncludeFilesWithBoard) {
                panel.syncIncludeFilesWithBoard(board);
            }

            // Mark as unsaved - user must explicitly save via Cmd+S or debug overlay
            this._markUnsavedChanges(true, board);

        } catch (error) {
            console.error('[boardUpdate] Error handling board update:', error);
        }
    }

    /**
     * Handle updating task content after strikethrough deletion
     */
    async handleUpdateTaskFromStrikethroughDeletion(message: any): Promise<void> {
        const { taskId, columnId, newContent, contentType } = message;

        try {
            const board = this._getCurrentBoard();
            if (!board) {
                console.error('🗑️ Backend: No current board available for strikethrough deletion');
                return;
            }


            // Content is already in markdown format from frontend
            const markdownContent = newContent;

            // Update the appropriate field based on content type
            const updateData: any = {};
            if (contentType === 'title') {
                updateData.title = markdownContent;
            } else if (contentType === 'description') {
                updateData.description = markdownContent;
            } else {
                console.warn('🗑️ Backend: Unknown content type, defaulting to title');
                updateData.title = markdownContent;
            }

            // OPTIMIZATION: Use sendUpdate: false to skip full board redraw
            // Frontend already has the updated content, we just need to persist the change
            await this.performBoardAction(() =>
                this._boardOperations.editTask(board, taskId, columnId, updateData),
                { sendUpdate: false }
            );

        } catch (error) {
            console.error('🗑️ Backend: Error updating task from strikethrough deletion:', error);
            vscode.window.showErrorMessage('Failed to update task content');
        }
    }

    /**
     * Unified handler for column title edits (handles both normal edits and strikethrough deletions)
     * Detects include syntax and routes through state machine or regular edit
     */
    async handleEditColumnTitleUnified(columnId: string, newTitle: string): Promise<void> {
        const currentBoard = this._getCurrentBoard();
        log(`[editColumnTitle] Board has ${currentBoard?.columns?.length || 0} columns`);
        log(`[editColumnTitle] Looking for column ID: ${columnId}`);
        log(`[editColumnTitle] New title: ${newTitle}`);

        if (!currentBoard) {
            log(`[editColumnTitle] No board loaded`);
            return;
        }

        const column = currentBoard.columns.find(col => col.id === columnId);
        if (!column) {
            log(`[editColumnTitle] Column ${columnId} not found`);
            return;
        }

        // Check if the new title contains include syntax (location-based: column include)
        const hasColumnIncludeMatches = newTitle.match(INCLUDE_SYNTAX.REGEX);

        // BUGFIX: Also check if old title had includes that are being removed
        const oldIncludeMatches = (column.title || '').match(INCLUDE_SYNTAX.REGEX);
        const hasIncludeChanges = hasColumnIncludeMatches || oldIncludeMatches;

        if (hasIncludeChanges) {
            // Column include switch - route through state machine
            log(`[editColumnTitle] Detected column include syntax, routing to state machine via handleIncludeSwitch`);

            // Extract the include files from the new title
            const newIncludeFiles: string[] = [];
            if (hasColumnIncludeMatches) {
                hasColumnIncludeMatches.forEach((match: string) => {
                    const filePath = match.replace(INCLUDE_SYNTAX.REGEX_SINGLE, '$1').trim();
                    newIncludeFiles.push(filePath);
                });
            }

            // Get old include files for cleanup
            const oldIncludeFiles = column.includeFiles || [];
            log(`[editColumnTitle] Column ${columnId} current includeFiles:`, oldIncludeFiles);
            log(`[editColumnTitle] New include files from title:`, newIncludeFiles);
            log(`[editColumnTitle] Column title in board:`, column.title);

            // DATA LOSS PREVENTION: Check if column has existing tasks that would be lost
            // This happens when a regular column (no include) is being converted to an include column
            const isAddingIncludeToRegularColumn = !oldIncludeMatches && hasColumnIncludeMatches && !column.includeMode;
            const hasExistingTasks = column.tasks && column.tasks.length > 0;

            log(`[editColumnTitle] DATA LOSS CHECK: oldIncludeMatches=${!!oldIncludeMatches}, hasColumnIncludeMatches=${!!hasColumnIncludeMatches}, column.includeMode=${column.includeMode}`);
            log(`[editColumnTitle] DATA LOSS CHECK: isAddingIncludeToRegularColumn=${isAddingIncludeToRegularColumn}, hasExistingTasks=${hasExistingTasks}, tasks.length=${column.tasks?.length || 0}`);

            // Prepare preloaded content map for include switch event (used if user chooses "append tasks")
            let preloadedContent: Map<string, string> | undefined;

            if (isAddingIncludeToRegularColumn && hasExistingTasks) {
                log(`[editColumnTitle] Column has ${column.tasks.length} existing tasks that would be lost`);

                // Ask user what to do with existing tasks
                const choice = await vscode.window.showWarningMessage(
                    `This column has ${column.tasks.length} existing task(s). Adding an include will replace them with the included file's content.`,
                    { modal: true },
                    'Append tasks to include file',
                    'Discard tasks',
                    'Cancel'
                );

                if (choice === 'Cancel' || choice === undefined) {
                    log(`[editColumnTitle] User cancelled include switch to preserve tasks`);
                    // Revert the title change in the frontend
                    const panel = this._getWebviewPanel();
                    if (panel && panel._panel && panel._panel.webview) {
                        panel._panel.webview.postMessage({
                            type: 'revertColumnTitle',
                            columnId: columnId,
                            title: column.title
                        });
                    }
                    this._getWebviewPanel().setEditingInProgress(false);
                    return;
                }

                if (choice === 'Append tasks to include file') {
                    // Generate content for appending tasks to the include file
                    const includeFilePath = newIncludeFiles[0];
                    log(`[editColumnTitle] User chose 'Append tasks to include file', includeFilePath: ${includeFilePath}`);
                    if (includeFilePath) {
                        try {
                            const { absolutePath, content } = await this.generateAppendTasksContent(column, includeFilePath, currentBoard);
                            // Create a map with the preloaded content to pass through the event
                            // IMPORTANT: Use absolute path as key - loadingFiles in state machine uses absolute paths
                            preloadedContent = new Map<string, string>();
                            preloadedContent.set(absolutePath, content);
                            log(`[editColumnTitle] Generated content for ${column.tasks.length} tasks`);
                            log(`[editColumnTitle] Map key (absolutePath): "${absolutePath}"`);
                            log(`[editColumnTitle] Content length: ${content.length}`);
                        } catch (error: any) {
                            log(`[editColumnTitle] Error generating tasks content:`, error);
                            vscode.window.showErrorMessage(`Failed to generate tasks content: ${error.message}`);
                            // Revert the title change
                            const panel = this._getWebviewPanel();
                            if (panel && panel._panel && panel._panel.webview) {
                                panel._panel.webview.postMessage({
                                    type: 'revertColumnTitle',
                                    columnId: columnId,
                                    title: column.title
                                });
                            }
                            this._getWebviewPanel().setEditingInProgress(false);
                            return;
                        }
                    }
                }
                // If 'Discard tasks' was chosen, continue with the include switch (tasks will be cleared)
            }

            // Route through unified state machine via handleIncludeSwitch
            const panel = this._getWebviewPanel();

            // Clear dirty flag BEFORE stopping editing
            // This prevents RACE-2 handler from sending stale updateColumnContent
            if (panel.clearColumnDirty) {
                panel.clearColumnDirty(columnId);
                log(`[editColumnTitle] Cleared dirty flag for column ${columnId} before switch`);
            }

            // CRITICAL FIX: Stop editing BEFORE starting switch to prevent race condition
            // This ensures user can't edit while content is loading
            await this.requestStopEditing();

            try {
                // Call new state machine-based handler
                // Pass preloaded content if we generated it (from "append tasks to include file")
                log(`[editColumnTitle] Calling handleIncludeSwitch with preloadedContent: ${!!preloadedContent}, size: ${preloadedContent?.size || 0}`);
                log(`[editColumnTitle] oldFiles: ${JSON.stringify(oldIncludeFiles)}, newFiles: ${JSON.stringify(newIncludeFiles)}`);
                await panel.handleIncludeSwitch({
                    columnId: columnId,
                    oldFiles: oldIncludeFiles,
                    newFiles: newIncludeFiles,
                    newTitle: newTitle,
                    preloadedContent: preloadedContent
                });

                log(`[editColumnTitle] Column include switch completed successfully`);

                // State machine already updated all column properties (title, includeFiles, tasks)
                // No need to update board here - would cause stale data issues

                // Clear editing flag after completion
                log(`[editColumnTitle] Edit completed - allowing board regenerations`);
                this._getWebviewPanel().setEditingInProgress(false);
            } catch (error: any) {
                // RACE-1: On error, still clear editing flag
                this._getWebviewPanel().setEditingInProgress(false);

                if (error.message === 'USER_CANCELLED') {
                    log(`[editColumnTitle] User cancelled switch, no changes made`);
                } else {
                    log(`[editColumnTitle] Error during column include switch:`, error);
                    vscode.window.showErrorMessage(`Failed to switch column include: ${error.message}`);
                }
            }
        } else {
            // Regular title edit without include syntax
            // STATE-3: Frontend already updated title, don't echo back
            await this.performBoardAction(() =>
                this._boardOperations.editColumnTitle(currentBoard, columnId, newTitle),
                { sendUpdate: false }
            );

            // RACE-1: Clear editing flag after regular title edit
            this._getWebviewPanel().setEditingInProgress(false);
        }
    }

    /**
     * Handle PlantUML rendering request from webview
     * Uses backend Node.js PlantUML service for completely offline rendering
     */
    async handleRenderPlantUML(message: any): Promise<void> {
        const { requestId, code } = message;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[handleRenderPlantUML] No panel or webview available');
            return;
        }

        try {

            // Render using backend service (Java + PlantUML JAR)
            const svg = await this._plantUMLService.renderSVG(code);


            // Send success response to webview
            panel.webview.postMessage({
                type: 'plantUMLRenderSuccess',
                requestId,
                svg
            });

        } catch (error) {
            console.error('[PlantUML Backend] Render error:', error);

            // Send error response to webview
            panel.webview.postMessage({
                type: 'plantUMLRenderError',
                requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Handle draw.io diagram rendering request from webview
     * Uses backend DrawIOService with CLI for conversion
     * Implements file-based caching to avoid re-rendering unchanged diagrams
     */
    async handleRenderDrawIO(message: any): Promise<void> {
        const { requestId, filePath } = message;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[handleRenderDrawIO] No panel or webview available');
            return;
        }

        try {
            // Resolve file path (handles both document-relative and workspace-relative paths)
            const resolution = await panel._fileManager.resolveFilePath(filePath);

            if (!resolution || !resolution.exists) {
                throw new Error(`draw.io file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Determine cache location based on file context
            // For included files: {include-filename}-Media/drawio-cache/
            // For main file: {kanban-filename}-Media/drawio-cache/
            const cacheDir = this.getDrawIOCacheDir(absolutePath, panel);
            const cacheFileName = this.getDrawIOCacheFileName(absolutePath, fileMtime);
            const cachePath = path.join(cacheDir, cacheFileName);

            let pngDataUrl: string;

            // Check if cached version exists and is valid
            if (fs.existsSync(cachePath)) {
                const cachedPng = await fs.promises.readFile(cachePath);
                pngDataUrl = `data:image/png;base64,${cachedPng.toString('base64')}`;
            } else {
                // Import draw.io service
                const { DrawIOService } = await import('./services/export/DrawIOService');
                const service = new DrawIOService();

                // Check if CLI is available
                if (!await service.isAvailable()) {
                    throw new Error('draw.io CLI not installed');
                }

                // Render to PNG (better rendering than SVG in webview)
                const pngBuffer = await service.renderPNG(absolutePath);

                // Ensure cache directory exists
                await fs.promises.mkdir(cacheDir, { recursive: true });

                // Save to cache
                await fs.promises.writeFile(cachePath, pngBuffer);

                // Clean up old cache files for this diagram (different mtimes)
                await this.cleanOldDrawIOCache(cacheDir, absolutePath, cacheFileName);

                // Convert PNG to data URL
                pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            }

            // Send success response to webview with mtime for cache invalidation
            panel.webview.postMessage({
                type: 'drawioRenderSuccess',
                requestId,
                svgDataUrl: pngDataUrl,  // Keep property name for compatibility
                fileMtime
            });

        } catch (error) {
            console.error('[DrawIO Backend] Render error:', error);

            // Send error response to webview
            panel.webview.postMessage({
                type: 'drawioRenderError',
                requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get cache directory for draw.io rendered images
     * Uses {filename}-Media/drawio-cache/ structure
     */
    private getDrawIOCacheDir(diagramPath: string, panel: any): string {
        // Determine which file the diagram belongs to (main kanban or include file)
        const diagramDir = path.dirname(diagramPath);
        // Get kanban path from fileManager (not panel._documentPath which doesn't exist)
        const kanbanPath = this._fileManager.getFilePath() || this._fileManager.getDocument()?.uri.fsPath;
        if (!kanbanPath) {
            // Fallback: use diagram directory if no kanban path available
            return path.join(diagramDir, 'drawio-cache');
        }
        const kanbanDir = path.dirname(kanbanPath);
        const kanbanBaseName = path.basename(kanbanPath, path.extname(kanbanPath));

        // Check if diagram is in a different directory (likely from an include file)
        if (diagramDir !== kanbanDir) {
            // Find the include file this diagram likely belongs to
            // Use the diagram's directory to create a local cache
            const diagramBaseName = path.basename(diagramDir);
            return path.join(diagramDir, `${diagramBaseName}-Media`, 'drawio-cache');
        }

        // Default: use main kanban's media folder
        return path.join(kanbanDir, `${kanbanBaseName}-Media`, 'drawio-cache');
    }

    /**
     * Generate cache file name based on source file path and mtime
     * Format: {basename}-{hash}-{mtime}.png
     */
    private getDrawIOCacheFileName(sourcePath: string, mtime: number): string {
        const basename = path.basename(sourcePath, path.extname(sourcePath));
        // Create a simple hash from the full path to handle files with same name in different dirs
        const pathHash = Buffer.from(sourcePath).toString('base64').replace(/[/+=]/g, '').substring(0, 8);
        return `${basename}-${pathHash}-${Math.floor(mtime)}.png`;
    }

    /**
     * Clean up old cache files for a diagram (different mtimes = outdated)
     */
    private async cleanOldDrawIOCache(cacheDir: string, sourcePath: string, currentCacheFile: string): Promise<void> {
        try {
            const basename = path.basename(sourcePath, path.extname(sourcePath));
            const pathHash = Buffer.from(sourcePath).toString('base64').replace(/[/+=]/g, '').substring(0, 8);
            const prefix = `${basename}-${pathHash}-`;

            const files = await fs.promises.readdir(cacheDir);
            for (const file of files) {
                if (file.startsWith(prefix) && file !== currentCacheFile && file.endsWith('.png')) {
                    const oldPath = path.join(cacheDir, file);
                    await fs.promises.unlink(oldPath);
                }
            }
        } catch (error) {
            // Ignore cleanup errors
            console.warn('[DrawIO Backend] Cache cleanup warning:', error);
        }
    }

    /**
     * Handle excalidraw diagram rendering request from webview
     * Uses backend ExcalidrawService with library for conversion
     */
    async handleRenderExcalidraw(message: any): Promise<void> {
        const { requestId, filePath } = message;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[handleRenderExcalidraw] No panel or webview available');
            return;
        }

        try {
            // Import excalidraw service
            const { ExcalidrawService } = await import('./services/export/ExcalidrawService');
            const service = new ExcalidrawService();

            // Resolve file path (handles both document-relative and workspace-relative paths)
            const resolution = await panel._fileManager.resolveFilePath(filePath);

            if (!resolution || !resolution.exists) {
                throw new Error(`Excalidraw file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Try PNG conversion first (better rendering), fallback to SVG if it fails
            // Note: PNG conversion can fail if our custom SVG renderer produces
            // SVG that draw.io CLI can't import
            let dataUrl: string;
            try {
                const pngBuffer = await service.renderPNG(absolutePath);
                dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            } catch (pngError) {
                // Fallback to SVG if PNG conversion fails
                const svg = await service.renderSVG(absolutePath);
                dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
            }

            // Send success response to webview with mtime for cache invalidation
            panel.webview.postMessage({
                type: 'excalidrawRenderSuccess',
                requestId,
                svgDataUrl: dataUrl,  // Keep property name for compatibility
                fileMtime
            });

        } catch (error) {
            console.error('[Excalidraw Backend] Render error:', error);

            // Send error response to webview
            panel.webview.postMessage({
                type: 'excalidrawRenderError',
                requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Handle PDF page rendering request from webview
     * Renders a specific page from a PDF file to PNG
     * Uses backend PDFService with pdftoppm CLI for conversion
     *
     * Request format: { type: 'requestPDFPageRender', requestId, filePath, pageNumber }
     * Response format: { type: 'pdfPageRenderSuccess', requestId, pngDataUrl, fileMtime }
     */
    async handleRenderPDFPage(message: any): Promise<void> {
        const { requestId, filePath, pageNumber } = message;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[handleRenderPDFPage] No panel or webview available');
            return;
        }

        try {
            // Import PDFService dynamically
            const { PDFService } = await import('./services/export/PDFService');
            const service = new PDFService();

            // Resolve file path (handles both workspace-relative and document-relative paths)
            const resolution = await panel._fileManager.resolveFilePath(filePath);
            if (!resolution || !resolution.exists) {
                throw new Error(`PDF file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Render PDF page to PNG
            const pngBuffer = await service.renderPage(absolutePath, pageNumber, 150);

            // Convert PNG to data URL
            const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

            // Send success response to webview with mtime for cache invalidation
            panel.webview.postMessage({
                type: 'pdfPageRenderSuccess',
                requestId,
                pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[PDF Backend] Render error:', error);

            // Send error response to webview
            panel.webview.postMessage({
                type: 'pdfPageRenderError',
                requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Handle PDF info request (get page count)
     * Request format: { type: 'requestPDFInfo', requestId, filePath }
     * Response format: { type: 'pdfInfoSuccess', requestId, pageCount, fileMtime }
     */
    async handleGetPDFInfo(message: any): Promise<void> {
        const { requestId, filePath } = message;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[handleGetPDFInfo] No panel or webview available');
            return;
        }

        try {
            // Import PDFService dynamically
            const { PDFService } = await import('./services/export/PDFService');
            const service = new PDFService();

            // Resolve file path
            const resolution = await panel._fileManager.resolveFilePath(filePath);
            if (!resolution || !resolution.exists) {
                throw new Error(`PDF file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Get page count
            const pageCount = await service.getPageCount(absolutePath);

            // Send success response
            panel.webview.postMessage({
                type: 'pdfInfoSuccess',
                requestId,
                pageCount,
                fileMtime
            });

        } catch (error) {
            console.error('[PDF Info] Error:', error);

            // Send error response
            panel.webview.postMessage({
                type: 'pdfInfoError',
                requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Handle PlantUML to SVG conversion
     */
    async handleConvertPlantUMLToSVG(message: any): Promise<void> {
        try {
            const { filePath, plantUMLCode, svgContent } = message;

            // Get file info
            const fileDir = path.dirname(filePath);
            const fileName = path.basename(filePath, path.extname(filePath));

            // Create Media folder
            const mediaFolder = path.join(fileDir, `Media-${fileName}`);
            await fs.promises.mkdir(mediaFolder, { recursive: true });

            // Generate unique SVG filename
            const timestamp = Date.now();
            const svgFileName = `plantuml-${timestamp}.svg`;
            const svgFilePath = path.join(mediaFolder, svgFileName);

            // Save SVG file
            await fs.promises.writeFile(svgFilePath, svgContent, 'utf8');

            // Calculate relative path for markdown
            const relativePath = path.join(`Media-${fileName}`, svgFileName);

            // Read current file content
            const currentContent = await fs.promises.readFile(filePath, 'utf8');

            // Find and replace PlantUML block with commented version + image
            const updatedContent = this.replacePlantUMLWithSVG(
                currentContent,
                plantUMLCode,
                relativePath
            );

            // Write updated content
            await fs.promises.writeFile(filePath, updatedContent, 'utf8');

            // Notify success
            const panel = this._getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: 'plantUMLConvertSuccess',
                    svgPath: relativePath
                });
            }

        } catch (error) {
            console.error('[PlantUML] Conversion failed:', error);
            const panel = this._getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: 'plantUMLConvertError',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Replace PlantUML code block with commented version + SVG image
     */
    private replacePlantUMLWithSVG(
        content: string,
        plantUMLCode: string,
        svgRelativePath: string
    ): string {

        // Split the code into lines to handle per-line matching with indentation
        // NOTE: The frontend sends TRIMMED code, but the file may have indented code
        const codeLines = plantUMLCode.split('\n').filter(line => line.trim().length > 0);
        const escapedLines = codeLines.map(line => escapeRegExp(line.trim()));
        // Each line can have any indentation, then the trimmed content
        const codePattern = escapedLines.map(line => '[ \\t]*' + line).join('\\s*\\n');

        // Create regex to match ```plantuml ... ``` block with any indentation
        const regexPattern = '([ \\t]*)```plantuml\\s*\\n' + codePattern + '\\s*\\n[ \\t]*```';
        const regex = new RegExp(regexPattern, 'g');

        // Replace with custom function to preserve indentation
        let replacementCount = 0;
        let updatedContent = content.replace(regex, (_match, indent) => {
            replacementCount++;

            // Indent each line of the code
            const indentedCode = plantUMLCode.split('\n').map(line =>
                line ? `${indent}${line}` : indent.trimEnd()
            ).join('\n');

            // Create replacement with disabled PlantUML block + image, preserving indentation
            return `${indent}\`\`\`plantuml-disabled
${indentedCode}
${indent}\`\`\`

${indent}![PlantUML Diagram](${svgRelativePath})`;
        });

        // Check if replacement happened
        if (updatedContent === content) {
            console.warn('[PlantUML] No matching PlantUML block found for replacement');
            // Try fuzzy matching as fallback
            return this.replacePlantUMLWithSVGFuzzy(content, plantUMLCode, svgRelativePath);
        }

        return updatedContent;
    }

    /**
     * Fuzzy matching fallback for PlantUML replacement
     */
    private replacePlantUMLWithSVGFuzzy(
        content: string,
        plantUMLCode: string,
        svgRelativePath: string
    ): string {
        const fuzzyRegex = /```plantuml\s*\n([\s\S]*?)\n```/g;
        let match;
        let bestMatch = null;
        let bestMatchIndex = -1;
        let similarity = 0;

        while ((match = fuzzyRegex.exec(content)) !== null) {
            const blockCode = match[1].trim();
            const targetCode = plantUMLCode.trim();

            // Calculate simple similarity
            const matchRatio = this.calculateSimilarity(blockCode, targetCode);

            if (matchRatio > similarity && matchRatio > 0.8) { // 80% similarity threshold
                similarity = matchRatio;
                bestMatch = match;
                bestMatchIndex = match.index;
            }
        }

        if (bestMatch) {

            const replacement = `\`\`\`plantuml-disabled
${plantUMLCode}
\`\`\`

![PlantUML Diagram](${svgRelativePath})`;

            const beforeMatch = content.substring(0, bestMatchIndex);
            const afterMatch = content.substring(bestMatchIndex + bestMatch[0].length);
            return beforeMatch + replacement + afterMatch;
        }

        // If no fuzzy match found, return original content unchanged
        console.warn('[PlantUML] No fuzzy match found, content unchanged');
        return content;
    }

    /**
     * Calculate similarity between two strings (0 = no match, 1 = exact match)
     */
    private calculateSimilarity(str1: string, str2: string): number {
        if (str1 === str2) return 1.0;
        if (str1.length === 0 || str2.length === 0) return 0.0;

        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        const longerLength = longer.length;
        if (longerLength === 0) return 1.0;

        return (longerLength - this.editDistance(longer, shorter)) / longerLength;
    }

    /**
     * Calculate Levenshtein edit distance between two strings
     */
    private editDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * Handle Mermaid to SVG conversion
     */
    async handleConvertMermaidToSVG(message: any): Promise<void> {
        try {
            const { filePath, mermaidCode, svgContent } = message;

            // Get file info
            const fileDir = path.dirname(filePath);
            const fileName = path.basename(filePath, path.extname(filePath));

            // Create Media folder
            const mediaFolder = path.join(fileDir, `Media-${fileName}`);
            await fs.promises.mkdir(mediaFolder, { recursive: true });

            // Generate unique SVG filename
            const timestamp = Date.now();
            const svgFileName = `mermaid-${timestamp}.svg`;
            const svgFilePath = path.join(mediaFolder, svgFileName);

            // Save SVG file
            await fs.promises.writeFile(svgFilePath, svgContent, 'utf8');

            // Calculate relative path for markdown
            const relativePath = path.join(`Media-${fileName}`, svgFileName);

            // Read current file content
            const currentContent = await fs.promises.readFile(filePath, 'utf8');

            // Find and replace Mermaid block with commented version + image
            const updatedContent = this.replaceMermaidWithSVG(
                currentContent,
                mermaidCode,
                relativePath
            );

            // Write updated content
            await fs.promises.writeFile(filePath, updatedContent, 'utf8');

            // Notify success
            const panel = this._getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: 'mermaidConvertSuccess',
                    svgPath: relativePath
                });
            }

        } catch (error) {
            console.error('[Mermaid] Conversion failed:', error);
            const panel = this._getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: 'mermaidConvertError',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Replace Mermaid code block with commented version + SVG image
     */
    private replaceMermaidWithSVG(
        content: string,
        mermaidCode: string,
        svgRelativePath: string
    ): string {

        // Split the code into lines to handle per-line matching with indentation
        const codeLines = mermaidCode.split('\n').filter(line => line.trim().length > 0);
        const escapedLines = codeLines.map(line => escapeRegExp(line.trim()));
        // Each line can have any indentation, then the trimmed content
        const codePattern = escapedLines.map(line => '[ \\t]*' + line).join('\\s*\\n');

        // Create regex to match ```mermaid ... ``` block with any indentation
        const regexPattern = '([ \\t]*)```mermaid\\s*\\n' + codePattern + '\\s*\\n[ \\t]*```';
        const regex = new RegExp(regexPattern, 'g');

        // Replace with custom function to preserve indentation
        let replacementCount = 0;
        let updatedContent = content.replace(regex, (_match, indent) => {
            replacementCount++;

            // Indent each line of the code
            const indentedCode = mermaidCode.split('\n').map(line =>
                line ? `${indent}${line}` : indent.trimEnd()
            ).join('\n');

            // Create replacement with disabled Mermaid block + image, preserving indentation
            return `${indent}\`\`\`mermaid-disabled
${indentedCode}
${indent}\`\`\`

${indent}![Mermaid Diagram](${svgRelativePath})`;
        });

        // Check if replacement happened
        if (updatedContent === content) {
            console.warn('[Mermaid] No matching Mermaid block found for replacement');
            // Try fuzzy matching as fallback
            return this.replaceMermaidWithSVGFuzzy(content, mermaidCode, svgRelativePath);
        }

        return updatedContent;
    }

    /**
     * Fuzzy matching fallback for Mermaid replacement
     */
    private replaceMermaidWithSVGFuzzy(
        content: string,
        mermaidCode: string,
        svgRelativePath: string
    ): string {
        const fuzzyRegex = /```mermaid\s*\n([\s\S]*?)\n```/g;
        let match;
        let bestMatch = null;
        let bestMatchIndex = -1;
        let similarity = 0;

        while ((match = fuzzyRegex.exec(content)) !== null) {
            const blockCode = match[1].trim();
            const targetCode = mermaidCode.trim();

            // Calculate simple similarity
            const matchRatio = this.calculateSimilarity(blockCode, targetCode);

            if (matchRatio > similarity && matchRatio > 0.8) { // 80% similarity threshold
                similarity = matchRatio;
                bestMatch = match;
                bestMatchIndex = match.index;
            }
        }

        if (bestMatch) {

            const replacement = `\`\`\`mermaid-disabled
${mermaidCode}
\`\`\`

![Mermaid Diagram](${svgRelativePath})`;

            const beforeMatch = content.substring(0, bestMatchIndex);
            const afterMatch = content.substring(bestMatchIndex + bestMatch[0].length);
            return beforeMatch + replacement + afterMatch;
        }

        // If no fuzzy match found, return original content unchanged
        console.warn('[Mermaid] No fuzzy match found, content unchanged');
        return content;
    }

    /**
     * Generate content for appending tasks from a column to an include file.
     * Returns the content and relative path to be passed through the include switch event.
     * The actual file write happens when the user saves the main kanban file.
     *
     * @returns Object with absolutePath and content to be passed to handleIncludeSwitch
     *          absolutePath is used because loadingFiles in state machine uses absolute paths
     */
    private async generateAppendTasksContent(
        column: any,
        includeFilePath: string,
        _board: any
    ): Promise<{ absolutePath: string; content: string }> {
        const panel = this._getWebviewPanel();
        if (!panel) {
            throw new Error('No panel available');
        }

        // Get the main file and file registry
        const mainFile = panel._fileRegistry.getMainFile();
        if (!mainFile) {
            throw new Error('No main file found');
        }

        const mainFilePath = mainFile.getPath();
        const mainFileDir = path.dirname(mainFilePath);
        const absoluteIncludePath = path.isAbsolute(includeFilePath)
            ? includeFilePath
            : path.resolve(mainFileDir, includeFilePath);

        // Generate presentation format content from the column's tasks
        // This uses PresentationGenerator to create proper Marp slides (each task = one slide)
        const tasksContent = PresentationGenerator.fromTasks(column.tasks, {
            filterIncludes: true,  // Filter out task includes - they have their own files
            includeMarpDirectives: false  // No YAML header - we'll add it ourselves or append to existing
        });

        // Check if the file exists on disk to read existing content
        let existingContent = '';
        try {
            const fileContent = await vscode.workspace.fs.readFile(safeFileUri(absoluteIncludePath, 'messageHandler-readIncludeFile'));
            existingContent = Buffer.from(fileContent).toString('utf8');
        } catch {
            // File doesn't exist yet - that's fine, we'll create it with YAML header
        }

        let finalContent: string;
        if (existingContent) {
            // Append tasks at the end with slide separator
            // Ensure proper slide separation
            const separator = existingContent.trimEnd().endsWith('---') ? '\n' : '\n---\n';
            finalContent = existingContent.trimEnd() + separator + tasksContent;
        } else {
            // Create new content with YAML header for Marp compatibility
            finalContent = `---
marp: true
---
${tasksContent}`;
        }

        log(`[generateAppendTasksContent] Generated content for ${column.tasks.length} tasks, absolutePath: ${absoluteIncludePath}`);

        return { absolutePath: absoluteIncludePath, content: finalContent };
    }

    // ========================================================================
    // TEMPLATE HANDLERS
    // ========================================================================

    private _templateService: TemplateService = new TemplateService();

    /**
     * Handle request for available templates
     */
    async handleGetTemplates(): Promise<void> {
        const panel = this._getWebviewPanel();
        if (!panel || !panel._panel) {
            return;
        }

        try {
            // Get workspace folder from main file
            const mainFile = panel.fileRegistry.getMainFile();
            const workspaceFolder = mainFile ? path.dirname(mainFile.getPath()) : undefined;

            const templates = await this._templateService.getTemplateList(workspaceFolder);
            const showBar = this._templateService.shouldShowBar();

            panel._panel.webview.postMessage({
                type: 'updateTemplates',
                templates,
                showBar
            });
        } catch (error) {
            log('[handleGetTemplates] Error:', error);
        }
    }

    /**
     * Handle initial template application request (before variables)
     * This loads the template and sends variable definitions to frontend
     */
    async handleApplyTemplate(message: any): Promise<void> {
        const panel = this._getWebviewPanel();
        if (!panel || !panel._panel) {
            return;
        }

        try {
            // Handle empty column creation (special case)
            if (message.isEmptyColumn || message.templatePath === '__empty_column__') {
                await this.createEmptyColumn(message);
                return;
            }

            const templatePath = message.templatePath;
            if (!templatePath) {
                vscode.window.showErrorMessage('No template path provided');
                return;
            }

            // Load template definition
            const template = await this._templateService.loadTemplate(templatePath);

            // If template has variables, send them to frontend for dialog
            if (template.variables && template.variables.length > 0) {
                panel._panel.webview.postMessage({
                    type: 'templateVariables',
                    templatePath: templatePath,
                    templateName: template.name,
                    variables: template.variables,
                    targetRow: message.targetRow,
                    insertAfterColumnId: message.insertAfterColumnId,
                    insertBeforeColumnId: message.insertBeforeColumnId,
                    position: message.position
                });
            } else {
                // No variables - apply immediately
                await this.applyTemplateWithVariables(message, {});
            }
        } catch (error: any) {
            log('[handleApplyTemplate] Error:', error);
            vscode.window.showErrorMessage(`Failed to load template: ${error.message}`);
        }
    }

    /**
     * Create an empty column at the specified position
     * Stack tags MUST be set here because renderer groups columns based on #stack tag
     */
    private async createEmptyColumn(message: any): Promise<void> {
        try {
            const insertAfterColumnId = message.insertAfterColumnId;
            const insertBeforeColumnId = message.insertBeforeColumnId;

            // Get current board
            const currentBoard = this._getCurrentBoard();
            if (!currentBoard) {
                log('[createEmptyColumn] No current board');
                return;
            }

            // Save undo state
            this._boardStore.saveStateForUndo(currentBoard);

            // Helper to get row from column title
            const getColumnRow = (col: any): number => {
                const rowMatch = col.title?.match(/#row(\d+)/i);
                return rowMatch ? parseInt(rowMatch[1], 10) : 1;
            };

            // Helper to check if column has #stack tag
            const hasStackTag = (col: any): boolean => {
                return /#stack\b/i.test(col.title || '');
            };

            // Determine target row and whether we need #stack tag
            let targetRow = message.targetRow || 1;
            let insertIndex = currentBoard.columns.length;
            let needsStackTag = false;

            if (insertAfterColumnId) {
                const afterIdx = currentBoard.columns.findIndex((c: any) => c.id === insertAfterColumnId);
                if (afterIdx >= 0) {
                    insertIndex = afterIdx + 1;
                    targetRow = getColumnRow(currentBoard.columns[afterIdx]);

                    // Check if next column exists in same row - if so, we're inserting into a stack
                    const nextCol = currentBoard.columns[afterIdx + 1];
                    if (nextCol && getColumnRow(nextCol) === targetRow) {
                        // Inserting between columns in same row - new column needs #stack
                        needsStackTag = true;
                    }
                }
            } else if (insertBeforeColumnId) {
                const beforeIdx = currentBoard.columns.findIndex((c: any) => c.id === insertBeforeColumnId);
                if (beforeIdx >= 0) {
                    insertIndex = beforeIdx;
                    targetRow = getColumnRow(currentBoard.columns[beforeIdx]);

                    // If beforeCol has #stack, we're inserting into an existing stack
                    if (hasStackTag(currentBoard.columns[beforeIdx])) {
                        needsStackTag = true;
                    }
                }
            } else if (message.position === 'first') {
                const firstInRow = currentBoard.columns.findIndex((c: any) => getColumnRow(c) === targetRow);
                insertIndex = firstInRow >= 0 ? firstInRow : currentBoard.columns.length;
                // First position doesn't need #stack (it becomes the base of the stack)
            }

            // Create column title with appropriate tags
            let columnTitle = 'New Column';
            if (targetRow > 1) {
                columnTitle = `New Column #row${targetRow}`;
            }
            if (needsStackTag) {
                columnTitle = columnTitle + ' #stack';
            }

            // Create empty column structure
            const emptyColumn = {
                id: `col-${Date.now()}`,
                title: columnTitle,
                tasks: [],
                settings: {}
            };

            // Insert empty column
            currentBoard.columns.splice(insertIndex, 0, emptyColumn);

            // Mark unsaved and update frontend
            this._markUnsavedChanges(true, currentBoard);
            await this._onBoardUpdate();

            log(`[createEmptyColumn] Created empty column "${columnTitle}" at index ${insertIndex}, row ${targetRow}, stack=${needsStackTag}`);

        } catch (error: any) {
            log('[createEmptyColumn] Error:', error);
            vscode.window.showErrorMessage(`Failed to create empty column: ${error.message}`);
        }
    }

    /**
     * Handle template variable submission
     */
    async handleSubmitTemplateVariables(message: any): Promise<void> {
        await this.applyTemplateWithVariables(message, message.variables || {});
    }

    /**
     * Apply a template with the given variable values
     */
    private async applyTemplateWithVariables(
        message: any,
        variables: Record<string, string | number>
    ): Promise<void> {
        const panel = this._getWebviewPanel();
        if (!panel || !panel._panel) {
            return;
        }

        try {
            const templatePath = message.templatePath;
            if (!templatePath) {
                vscode.window.showErrorMessage('No template path provided');
                return;
            }

            // Load template definition
            const template = await this._templateService.loadTemplate(templatePath);

            // Apply default values
            const finalVariables = VariableProcessor.applyDefaults(template.variables, variables);

            // Validate required variables
            const validation = VariableProcessor.validateVariables(template.variables, finalVariables);
            if (!validation.valid) {
                vscode.window.showErrorMessage(`Missing required variables: ${validation.missing.join(', ')}`);
                return;
            }

            // Get board folder
            const mainFile = panel.fileRegistry.getMainFile();
            if (!mainFile) {
                vscode.window.showErrorMessage('No main file found');
                return;
            }
            const boardFolder = path.dirname(mainFile.getPath());

            // Copy template files to board folder
            const copiedFiles = await FileCopyService.copyTemplateFiles(
                templatePath,
                boardFolder,
                finalVariables,
                template.variables
            );
            log(`[applyTemplateWithVariables] Copied ${copiedFiles.length} files`);

            // Process template content (columns and tasks)
            const processedColumns = this.processTemplateColumns(template, finalVariables);

            // Get current board
            const currentBoard = this._getCurrentBoard();
            if (!currentBoard) {
                vscode.window.showErrorMessage('No board available');
                return;
            }

            // Find insertion point
            const targetRow = message.targetRow || 1;
            let insertIndex = currentBoard.columns.length;

            if (message.insertAfterColumnId) {
                const afterIndex = currentBoard.columns.findIndex(c => c.id === message.insertAfterColumnId);
                if (afterIndex >= 0) {
                    insertIndex = afterIndex + 1;
                }
            } else if (message.insertBeforeColumnId) {
                const beforeIndex = currentBoard.columns.findIndex(c => c.id === message.insertBeforeColumnId);
                if (beforeIndex >= 0) {
                    insertIndex = beforeIndex;
                }
            } else if (message.position === 'first') {
                // Find first column in target row
                const firstInRow = currentBoard.columns.findIndex(c => {
                    const rowMatch = c.title.match(/#row(\d+)/i);
                    const colRow = rowMatch ? parseInt(rowMatch[1], 10) : 1;
                    return colRow === targetRow;
                });
                insertIndex = firstInRow >= 0 ? firstInRow : currentBoard.columns.length;
            }

            // Add row tag to columns if needed
            const columnsWithRow = processedColumns.map(col => {
                if (targetRow > 1 && !/#row\d+/i.test(col.title)) {
                    col.title = `${col.title} #row${targetRow}`;
                }
                return col;
            });

            // Insert columns into board
            currentBoard.columns.splice(insertIndex, 0, ...columnsWithRow);

            // Save undo state and update
            await this.performBoardAction(() => true);

            // Send updated board to frontend
            panel._panel.webview.postMessage({
                type: 'templateApplied',
                board: currentBoard
            });

            log(`[applyTemplateWithVariables] Applied template with ${columnsWithRow.length} columns`);

        } catch (error: any) {
            log('[applyTemplateWithVariables] Error:', error);
            vscode.window.showErrorMessage(`Failed to apply template: ${error.message}`);
        }
    }

    /**
     * Process template columns with variable substitution
     */
    private processTemplateColumns(
        template: any,
        variables: Record<string, string | number>
    ): any[] {
        const { IdGenerator } = require('./utils/idGenerator');

        return template.columns.map((col: any) => {
            // Process title
            const processedTitle = VariableProcessor.substitute(
                col.title,
                variables,
                template.variables
            );

            // Process tasks
            const processedTasks = (col.tasks || []).map((task: any) => {
                const processedTaskTitle = VariableProcessor.substitute(
                    task.title,
                    variables,
                    template.variables
                );

                const processedTask: any = {
                    id: IdGenerator.generateTaskId(),
                    title: processedTaskTitle,
                    completed: task.completed || false
                };

                if (task.description) {
                    processedTask.description = VariableProcessor.substitute(
                        task.description,
                        variables,
                        template.variables
                    );
                }

                // Handle include files in task title
                if (task.includeFiles && task.includeFiles.length > 0) {
                    processedTask.includeFiles = task.includeFiles.map((f: string) =>
                        VariableProcessor.substituteFilename(f, variables, template.variables)
                    );
                    processedTask.includeMode = true;
                }

                return processedTask;
            });

            return {
                id: IdGenerator.generateColumnId(),
                title: processedTitle,
                tasks: processedTasks
            };
        });
    }
}
