import { FileManager } from './fileManager';
import { BoardStore } from './core/stores';
import { BoardOperations } from './board';
import { LinkHandler } from './services/LinkHandler';
import { MarkdownFile } from './files/MarkdownFile'; // FOUNDATION-1: For path comparison
import { KanbanBoard, KanbanTask } from './markdownParser';
import { PlantUMLService } from './services/export/PlantUMLService';
import { FileSaveService } from './core/FileSaveService';
import { NewExportOptions } from './services/export/ExportService';
import { BoardChangeTrigger } from './core/events';
import { PanelContext } from './panel/PanelContext';
// Command Pattern: Registry and commands for message handling
import { CommandRegistry, CommandContext, TaskCommands, ColumnCommands, UICommands, FileCommands, ClipboardCommands, ExportCommands, DiagramCommands, IncludeCommands, EditModeCommands, TemplateCommands, DebugCommands, PathCommands, ProcessCommands } from './commands';
import * as vscode from 'vscode';
import { EditingStoppedMessage, BoardUpdateFromFrontendMessage, IncomingMessage } from './core/bridge/MessageTypes';
import { CapturedEdit } from './files/FileInterfaces';
import { STOP_EDITING_TIMEOUT_MS } from './constants/TimeoutConstants';

/**
 * Simplified dependencies for MessageHandler
 */
export interface MessageHandlerDeps {
    onBoardUpdate: () => Promise<void>;
    onSaveToMarkdown: () => Promise<void>;
    onInitializeFile: () => Promise<void>;
    getWebviewPanel: () => any;
    getWebviewBridge?: () => any;
    emitBoardChanged: (board: KanbanBoard, trigger?: BoardChangeTrigger) => void;
}

export class MessageHandler {
    private _fileManager: FileManager;
    private _boardStore: BoardStore;
    private _boardOperations: BoardOperations;
    private _linkHandler: LinkHandler;
    private _plantUMLService: PlantUMLService;
    private _fileSaveService: FileSaveService;
    private _panelContext: PanelContext;
    private _deps: MessageHandlerDeps;
    private _autoExportSettings: NewExportOptions | null = null;

    // Command Pattern: Registry for message handlers
    private _commandRegistry: CommandRegistry;
    private _commandContext: CommandContext | null = null;

    // Request-response pattern for stopEditing
    private _pendingStopEditingRequests = new Map<string, { resolve: (value: CapturedEdit | undefined) => void, reject: (reason: Error) => void, timeout: NodeJS.Timeout }>();
    private _stopEditingRequestCounter = 0;

    constructor(
        fileManager: FileManager,
        boardStore: BoardStore,
        boardOperations: BoardOperations,
        linkHandler: LinkHandler,
        deps: MessageHandlerDeps,
        panelContext: PanelContext
    ) {
        this._fileManager = fileManager;
        this._boardStore = boardStore;
        this._boardOperations = boardOperations;
        this._linkHandler = linkHandler;
        this._plantUMLService = new PlantUMLService();
        this._fileSaveService = panelContext.fileSaveService;
        this._panelContext = panelContext;
        this._deps = deps;

        // Initialize Command Pattern registry (per-instance, not singleton)
        this._commandRegistry = new CommandRegistry();
        this._initializeCommandRegistry();
    }

    /**
     * Initialize the Command Registry with all command handlers
     */
    private _initializeCommandRegistry(): void {
        // Create the command context with all dependencies
        // Note: Uses simplified deps + direct references to reduce callback indirection
        this._commandContext = {
            fileManager: this._fileManager,
            boardStore: this._boardStore,
            boardOperations: this._boardOperations,
            linkHandler: this._linkHandler,
            plantUMLService: this._plantUMLService,
            getMermaidExportService: () => this._panelContext.mermaidExportService,
            fileSaveService: this._fileSaveService,
            getFileRegistry: () => this._deps.getWebviewPanel()?._fileRegistry,
            onBoardUpdate: this._deps.onBoardUpdate,
            onSaveToMarkdown: this._deps.onSaveToMarkdown,
            onInitializeFile: this._deps.onInitializeFile,
            getCurrentBoard: () => this._boardStore.getBoard() ?? undefined,
            setBoard: (board: KanbanBoard) => this._boardStore.setBoard(board),
            setUndoRedoOperation: (isOperation: boolean) => this._deps.getWebviewPanel()?._context?.setUndoRedoOperation(isOperation),
            getWebviewPanel: this._deps.getWebviewPanel,
            getWebviewBridge: () => this._deps.getWebviewBridge?.() ?? this._deps.getWebviewPanel()?._webviewBridge,
            emitBoardChanged: this._deps.emitBoardChanged,
            getAutoExportSettings: () => this._autoExportSettings,
            setAutoExportSettings: (settings: NewExportOptions | null) => { this._autoExportSettings = settings; },

            // Editing state management
            setEditingInProgress: (value: boolean) => this._deps.getWebviewPanel()?.setEditingInProgress(value),

            // Dirty tracking
            markTaskDirty: (taskId: string) => this._deps.getWebviewPanel()?.markTaskDirty?.(taskId),
            clearTaskDirty: (taskId: string) => this._deps.getWebviewPanel()?.clearTaskDirty?.(taskId),
            markColumnDirty: (columnId: string) => this._deps.getWebviewPanel()?.markColumnDirty?.(columnId),
            clearColumnDirty: (columnId: string) => this._deps.getWebviewPanel()?.clearColumnDirty?.(columnId),

            // Include file operations
            handleIncludeSwitch: (params) => this._deps.getWebviewPanel()?.handleIncludeSwitch(params),
            requestStopEditing: () => this.requestStopEditing(),

            // Configuration
            refreshConfiguration: () => this._deps.getWebviewPanel()?.refreshConfiguration?.() || Promise.resolve()
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
        this._commandRegistry.register(new TemplateCommands());
        this._commandRegistry.register(new DebugCommands());
        this._commandRegistry.register(new PathCommands());
        this._commandRegistry.register(new ProcessCommands());

        // Initialize the registry with context
        if (this._commandContext) {
            this._commandRegistry.initialize(this._commandContext);
        }
    }

    /**
     * Request frontend to stop editing and wait for response with captured edit
     * Returns a Promise that resolves with the captured edit value from frontend
     * PUBLIC: Can be called from external code (e.g., conflict resolution)
     */
    public async requestStopEditing(): Promise<any> {
        const requestId = `stop-edit-${++this._stopEditingRequestCounter}`;
        const panel = this._deps.getWebviewPanel();

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
            }, STOP_EDITING_TIMEOUT_MS);

            // Store promise resolver
            this._pendingStopEditingRequests.set(requestId, { resolve, reject, timeout });

            // Send request to frontend to capture edit value via bridge
            const bridge = this._deps.getWebviewBridge?.();
            if (bridge) {
                bridge.send({
                    type: 'stopEditing',
                    requestId,
                    captureValue: true  // Tell frontend to capture the edit value
                });
            } else {
                console.warn('[MessageHandler] WebviewBridge not available for stopEditing request');
            }
        });
    }

    /**
     * Handle response from frontend when editing is stopped (backend-initiated)
     * Resolves the pending promise from requestStopEditing()
     */
    public async handleEditingStopped(message: EditingStoppedMessage): Promise<void> {
        const { requestId, capturedEdit } = message;

        if (!requestId) {
            console.warn('[handleEditingStopped] No requestId in message');
            return;
        }

        const pending = this._pendingStopEditingRequests.get(requestId);
        if (!pending) {
            console.warn(`[handleEditingStopped] No pending request for id: ${requestId}`);
            return;
        }

        // Clear the timeout
        clearTimeout(pending.timeout);

        // Resolve the promise with the captured edit value
        pending.resolve(capturedEdit);

        // Clean up
        this._pendingStopEditingRequests.delete(requestId);
    }

    public async handleMessage(message: IncomingMessage): Promise<void> {
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

        // File search messages are handled by FileSearchWebview's own listener
        if (message.type?.startsWith('fileSearch')) {
            return; // Silently ignore - these are handled elsewhere
        }

        // Fallback for unregistered message types (should not happen in normal operation)
        console.error(`[MessageHandler] Unknown message type: ${message.type}`);
    }

    /**
     * STATE-3: Unified board action method
     *
     * Performs a board modification action with explicit control over update behavior.
     */

    async handleBoardUpdate(message: BoardUpdateFromFrontendMessage): Promise<void> {
        try {
            const board = message.board;
            if (!board) {
                console.error('[boardUpdate] No board data provided');
                return;
            }

            // CRITICAL: Check for unsaved changes in include files BEFORE updating the board
            const panel = this._deps.getWebviewPanel();
            const oldBoard = this._boardStore.getBoard();

            if (oldBoard && panel) {
                const shouldProceed = await this._checkUnsavedIncludeFiles(board, oldBoard, panel);
                if (!shouldProceed) {
                    return; // User cancelled
                }
            }

            // Set the updated board (now that we've handled unsaved changes)
            this._boardStore.setBoard(board);

            // Emit board:changed event (updates _content for unsaved detection)
            this._deps.emitBoardChanged(board, 'edit');

        } catch (error) {
            console.error('[boardUpdate] Error handling board update:', error);
        }
    }

    /**
     * Check for unsaved changes in include files that are being removed
     * Prompts user to save/discard/cancel for each file with unsaved changes
     * @returns true if we should proceed with the update, false if user cancelled
     */
    private async _checkUnsavedIncludeFiles(
        newBoard: KanbanBoard,
        oldBoard: KanbanBoard,
        panel: any
    ): Promise<boolean> {
        // Check column includes
        for (let i = 0; i < newBoard.columns.length && i < oldBoard.columns.length; i++) {
            const newCol = newBoard.columns[i];
            const oldCol = oldBoard.columns[i];

            // Check column-level include files
            const shouldProceed = await this._checkRemovedIncludes(
                oldCol.includeFiles || [],
                newCol.includeFiles || [],
                panel
            );
            if (!shouldProceed) { return false; }

            // Check task includes within this column
            for (const newTask of newCol.tasks) {
                const oldTask = oldCol.tasks.find((t: KanbanTask) => t.id === newTask.id);
                if (oldTask) {
                    const taskShouldProceed = await this._checkRemovedIncludes(
                        oldTask.includeFiles || [],
                        newTask.includeFiles || [],
                        panel
                    );
                    if (!taskShouldProceed) { return false; }
                }
            }
        }

        return true;
    }

    /**
     * Check for removed include files with unsaved changes
     * @returns true if we should proceed, false if user cancelled
     */
    private async _checkRemovedIncludes(
        oldIncludes: string[],
        newIncludes: string[],
        panel: any
    ): Promise<boolean> {
        // FOUNDATION-1: Use normalized comparison
        const removedFiles = oldIncludes.filter((oldPath: string) =>
            !newIncludes.some((newPath: string) => MarkdownFile.isSameFile(oldPath, newPath))
        );

        for (const removedPath of removedFiles) {
            const result = await this._handleUnsavedIncludeFile(removedPath, panel);
            if (!result) { return false; }
        }

        return true;
    }

    /**
     * Handle a single include file that's being removed
     * @returns true if we should proceed, false if user cancelled
     */
    private async _handleUnsavedIncludeFile(
        removedPath: string,
        panel: any
    ): Promise<boolean> {
        const oldFile = panel.fileRegistry?.getByRelativePath(removedPath);
        // Skip save prompt for broken includes (never loaded). exists() is cached, so files
        // that were loaded successfully will still prompt even if deleted externally.
        if (!oldFile || !oldFile.hasUnsavedChanges() || !oldFile.exists()) {
            return true; // No unsaved changes or file was never loaded, proceed
        }

        const choice = await vscode.window.showWarningMessage(
            `The include file "${removedPath}" has unsaved changes and will be unloaded. What would you like to do?`,
            { modal: true },
            'Save and Continue',
            'Discard and Continue',
            'Cancel'
        );

        if (choice === 'Save and Continue') {
            await this._fileSaveService.saveFile(oldFile);
            return true;
        } else if (choice === 'Discard and Continue') {
            oldFile.discardChanges();
            return true;
        }

        return false; // Cancel
    }
}
