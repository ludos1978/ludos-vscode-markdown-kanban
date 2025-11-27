import { FileManager } from './fileManager';
import { BoardStore } from './core/stores';
import { BoardOperations } from './boardOperations';
import { LinkHandler } from './linkHandler';
import { MarkdownFile } from './files/MarkdownFile'; // FOUNDATION-1: For path comparison
import { KanbanBoard } from './markdownParser';
import { configService, ConfigurationService } from './configurationService';
import { ExportService, NewExportOptions } from './exportService';
import { PathResolver } from './services/PathResolver';
import { MarpExtensionService } from './services/export/MarpExtensionService';
import { MarpExportService } from './services/export/MarpExportService';
import { SaveEventCoordinator, SaveEventHandler } from './saveEventCoordinator';
import { PlantUMLService } from './plantUMLService';
import { getMermaidExportService } from './services/export/MermaidExportService';
import { getOutputChannel } from './extension';
import { INCLUDE_SYNTAX } from './constants/IncludeConstants';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

// Helper function to log to both console and output channel
function log(...args: any[]) {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    getOutputChannel()?.appendLine(message);
}

interface FocusTarget {
    type: 'task' | 'column';
    id: string;
    operation: 'created' | 'modified' | 'deleted' | 'moved';
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
    private _saveWithBackup: () => Promise<void>;
    private _markUnsavedChanges: (hasChanges: boolean, cachedBoard?: any) => void;
    private _previousBoardForFocus?: KanbanBoard;
    private _activeOperations = new Map<string, { type: string, startTime: number }>();
    private _autoExportSettings: any = null;

    // Request-response pattern for stopEditing
    private _pendingStopEditingRequests = new Map<string, { resolve: (value: void) => void, reject: (reason: any) => void, timeout: NodeJS.Timeout }>();
    private _stopEditingRequestCounter = 0;

    // Request-response pattern for unfoldColumns
    private _pendingUnfoldRequests = new Map<string, { resolve: (value: void) => void, reject: (reason: any) => void, timeout: NodeJS.Timeout }>();
    private _unfoldRequestCounter = 0;

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
            saveWithBackup: () => Promise<void>;
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
        this._saveWithBackup = callbacks.saveWithBackup;
        this._markUnsavedChanges = callbacks.markUnsavedChanges;
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

    /**
     * Handle response from frontend that editing has stopped (with captured value)
     */
    private _handleEditingStopped(requestId: string, capturedEdit: any): void {
        const pending = this._pendingStopEditingRequests.get(requestId);

        if (pending) {
            clearTimeout(pending.timeout);
            this._pendingStopEditingRequests.delete(requestId);
            pending.resolve(capturedEdit);  // Resolve with captured edit value

            // RACE-2: Sync dirty items after editing stops
            // When user was editing, frontend skipped rendering updateColumnContent.
            // Backend marked those items as dirty. Now apply all skipped updates.
            const panel = this._getWebviewPanel();
            panel.syncDirtyItems();
        } else {
            console.warn(`[_handleEditingStopped] No pending request found for: ${requestId}`);
        }
    }

    /**
     * Request frontend to unfold columns and wait for response
     * Returns a Promise that resolves when frontend confirms columns are unfolded
     */
    private async _requestUnfoldColumns(columnIds: string[]): Promise<void> {
        const requestId = `unfold-${++this._unfoldRequestCounter}`;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.warn('[_requestUnfoldColumns] No panel or webview available');
            return;
        }

        return new Promise<void>((resolve, reject) => {
            // Set timeout in case frontend doesn't respond
            const timeout = setTimeout(() => {
                this._pendingUnfoldRequests.delete(requestId);
                console.warn('[_requestUnfoldColumns] Timeout waiting for frontend response');
                resolve(); // Don't reject, just continue
            }, 2000);

            // Store promise resolver
            this._pendingUnfoldRequests.set(requestId, { resolve, reject, timeout });

            // Send request to frontend
            panel.webview.postMessage({
                type: 'unfoldColumnsBeforeUpdate',
                requestId,
                columnIds
            });
        });
    }

    /**
     * Handle response from frontend that columns have been unfolded
     */
    private _handleColumnsUnfolded(requestId: string): void {
        const pending = this._pendingUnfoldRequests.get(requestId);

        if (pending) {
            clearTimeout(pending.timeout);
            this._pendingUnfoldRequests.delete(requestId);
            pending.resolve();
        } else {
            console.warn(`[_handleColumnsUnfolded] No pending request found for: ${requestId}`);
        }
    }

    private async startOperation(operationId: string, type: string, description: string) {
        this._activeOperations.set(operationId, { type, startTime: Date.now() });

        // Send to frontend
        const panel = this._getWebviewPanel();
        if (panel && panel.webview) {
            panel.webview.postMessage({
                type: 'operationStarted',
                operationId,
                operationType: type,
                description
            });
        }
    }

    private async updateOperationProgress(operationId: string, progress: number, message?: string) {
        const panel = this._getWebviewPanel();
        if (panel && panel.webview) {
            panel.webview.postMessage({
                type: 'operationProgress',
                operationId,
                progress,
                message
            });
        }
    }

    private async endOperation(operationId: string) {
        const operation = this._activeOperations.get(operationId);
        if (operation) {
            this._activeOperations.delete(operationId);

            // Send to frontend
            const panel = this._getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: 'operationCompleted',
                    operationId
                });
            }
        }
    }

    public async handleMessage(message: any): Promise<void> {
        // CRITICAL: Log IMMEDIATELY with zero overhead

        if (message.type?.includes?.('task') || message.type?.includes?.('Task') || message.type === 'editTask') {
            const detailMsg = `🟢 [handleMessage] TASK MESSAGE: ${JSON.stringify({
                type: message.type,
                taskId: message.taskId,
                columnId: message.columnId,
                title: message.title,
                taskDataKeys: Object.keys(message.taskData || {})
            })}`;
        }

        const switchMsg = `🟢 [handleMessage] ENTERING SWITCH for type: "${message.type}"`;

        switch (message.type) {
            // Undo/Redo operations
            case 'undo':
                await this.handleUndo();
                break;
            case 'redo':
                await this.handleRedo();
                break;



            // Runtime function tracking report
            case 'runtimeTrackingReport':
                await this.handleRuntimeTrackingReport(message.report);
                break;

            // Special request for board update
            case 'requestBoardUpdate':
                await this._onBoardUpdate();
                this._fileManager.sendFileInfo();
                break;

            // Update board with new data (used for immediate column include changes)
            case 'boardUpdate':
                await this.handleBoardUpdate(message);
                break;

            // Confirm disable include mode (uses VS Code dialog)
            case 'confirmDisableIncludeMode':
                await this.handleConfirmDisableIncludeMode(message);
                break;

            // Include file content request for frontend processing
            case 'requestIncludeFile':
                await this.handleRequestIncludeFile(message.filePath);
                break;

            // Register inline include for conflict resolution
            case 'registerInlineInclude':
                await this.handleRegisterInlineInclude(message.filePath, message.content);
                break;

            // Request include file name for enabling include mode
            case 'requestIncludeFileName':
                await this.handleRequestIncludeFileName(message);
                break;

            // Request edit include file name for changing include files
            case 'requestEditIncludeFileName':
                await this.handleRequestEditIncludeFileName(message);
                break;

            // Request edit task include file name for changing task include files
            case 'requestEditTaskIncludeFileName':
                await this.handleRequestEditTaskIncludeFileName(message);
                break;

            // REMOVED: Legacy switchTaskIncludeFile - now routes through editTaskTitle -> state machine
            // See menuOperations.js updateTaskIncludeFile() which now sends editTaskTitle instead

            // Enhanced file and link handling
            case 'openFileLink':
                await this._linkHandler.handleFileLink(message.href, message.taskId, message.columnId, message.linkIndex, message.includeContext);
                break;
            case 'openWikiLink':
                await this._linkHandler.handleWikiLink(message.documentName);
                break;
            case 'openExternalLink':
                await this._linkHandler.handleExternalLink(message.href);
                break;

            case 'openFile':
                await this.handleOpenFile(message.filePath);
                break;

            case 'openIncludeFile':
                await this._linkHandler.handleFileLink(message.filePath);
                break;

            // Drag and drop operations
            case 'handleFileDrop':
                await this._fileManager.handleFileDrop(message);
                break;
            case 'handleUriDrop':
                await this._fileManager.handleUriDrop(message);
                break;
                            
            // File management
            case 'toggleFileLock':
                this._fileManager.toggleFileLock();
                break;
            case 'selectFile':
                await this.handleSelectFile();
                break;
            case 'editModeStart':
                // User started editing (cursor entered task/column editor)
                await this.handleEditModeStart(message);
                break;
            case 'editModeEnd':
                // User stopped editing (cursor left task/column editor)
                await this.handleEditModeEnd(message);
                break;
            case 'markUnsavedChanges':
                // Track unsaved changes at panel level and update cached board if provided
                if (message.cachedBoard) {
                    // Check if any tasks have includeMode
                    let includeTaskCount = 0;
                    message.cachedBoard.columns?.forEach((col: any) => {
                        col.tasks?.forEach((task: any) => {
                            if (task.includeMode) {
                                includeTaskCount++;
                            }
                        });
                    });
                }
                this._markUnsavedChanges(message.hasUnsavedChanges, message.cachedBoard);
                break;
            case 'saveUndoState':
                // Save current board state for undo without executing any operation
                // Use the board state from the webview cache if provided, otherwise fallback to backend board
                const boardToSave = message.currentBoard || this._getCurrentBoard();
                if (boardToSave) {
                    this._boardStore.saveStateForUndo(boardToSave);
                } else {
                    console.warn('❌ No current board available for undo state saving');
                }
                break;
            case 'updateMarpGlobalSetting':
                // Update Marp global setting in YAML frontmatter
                await this.handleUpdateMarpGlobalSetting(message.key, message.value);
                break;
            case 'pageHiddenWithUnsavedChanges':
                // Handle page becoming hidden with unsaved changes
                await this.handlePageHiddenWithUnsavedChanges();
                break;
            case 'requestFileInfo':
                this._fileManager.sendFileInfo();
                break;
            case 'initializeFile':
                await this._onInitializeFile();
                break;
            case 'showMessage':
							  vscode.window.showInformationMessage(message.text);
                break;
            case 'setPreference':
                await this.handleSetPreference(message.key, message.value);
                break;
            case 'setContext':
                await this.handleSetContext(message.contextVariable, message.value);
                break;
            case 'triggerVSCodeSnippet':
                await this.handleVSCodeSnippet(message);
                break;
            case 'handleEditorShortcut':
                await this.handleEditorShortcut(message);
                break;
            case 'resolveAndCopyPath':
                const resolution = await this._fileManager.resolveFilePath(message.path);
                if (resolution && resolution.exists) {
                    await vscode.env.clipboard.writeText(resolution.resolvedPath);
                    vscode.window.showInformationMessage('Full path copied: ' + resolution.resolvedPath);
                } else {
                    vscode.window.showWarningMessage('Could not resolve path: ' + message.path);
                }
                break;
        
            // Task operations
            case 'editTask':

                // Check if this is a title change with include syntax (add/remove/change)
                if (message.taskData?.title !== undefined) {
                    const newTitle = message.taskData.title;
                    const hasNewInclude = INCLUDE_SYNTAX.REGEX_SINGLE.test(newTitle);


                    const board = this._getCurrentBoard();
                    const column = board?.columns.find((c: any) => c.id === message.columnId);
                    const task = column?.tasks.find((t: any) => t.id === message.taskId);

                    if (task) {
                        // CRITICAL FIX: Skip include detection for column-generated tasks
                        // Column-generated tasks are slides from column includes (presentation files)
                        // Their titles contain slide content, NOT include directives
                        // IMPORTANT: Task IDs are regular (task-xxx), NOT task-col-xxx!
                        // The ONLY way to identify them: check if parent column has includeMode=true
                        const columnHasInclude = column?.includeMode === true;

                        if (columnHasInclude) {
                            // Fall through to regular edit handling
                        } else {
                            try {
                                const oldIncludeFiles = task.includeFiles || [];
                                const hadOldInclude = oldIncludeFiles.length > 0;


                            // SOLUTION 3: Also handle include REMOVAL (not just addition)
                            if (hasNewInclude || hadOldInclude) {

                            const panel = this._getWebviewPanel();

                            // Extract new include files from title
                            const newIncludeFiles: string[] = [];
                            const matches = newTitle.match(INCLUDE_SYNTAX.REGEX);
                            if (matches) {
                                matches.forEach((match: string) => {
                                    const filePath = match.replace(INCLUDE_SYNTAX.REGEX_SINGLE, '$1').trim();
                                    newIncludeFiles.push(filePath);
                                });
                            }


                            // Clear dirty flag before stopping edit
                            if (panel.clearTaskDirty) {
                                panel.clearTaskDirty(message.taskId);
                            }

                            // Stop editing before switch
                            await this.requestStopEditing();

                            await panel.handleIncludeSwitch({
                                taskId: message.taskId,
                                oldFiles: oldIncludeFiles,
                                newFiles: newIncludeFiles,
                                newTitle: newTitle
                            });

                            panel.setEditingInProgress(false);
                            break;
                        }
                            } catch (error) {
                                console.error(`[editTask] Exception in include handling:`, error);
                            }
                        }
                    } else {
                    }
                }

                // CRITICAL FIX: Unified execution path for task include content updates
                // Both "edit include file" and "text modification" must call the same functions

                // First, update the board state (in-memory task object)
                // STATE-3: Frontend already updated (live editing), don't echo back
                await this.performBoardAction(() =>
                    this._boardOperations.editTask(this._getCurrentBoard()!, message.taskId, message.columnId, message.taskData),
                    { sendUpdate: false }
                );

                // NEW: If this is a task include and description was updated, update the file instance immediately
                // This unifies Path 1 (edit include file) and Path 2 (text modification) to call the same functions
                if (message.taskData.description !== undefined) {
                    const board = this._getCurrentBoard();
                    const column = board?.columns.find((c: any) => c.id === message.columnId);
                    const task = column?.tasks.find((t: any) => t.id === message.taskId);

                    // CRITICAL FIX: Skip for column-generated tasks (slides from column includes)
                    // Column-generated tasks have regular IDs (task-xxx), NOT task-col-xxx
                    // The ONLY way to identify them: parent column has includeMode=true
                    const columnHasInclude = column?.includeMode === true;

                    if (task && task.includeMode && task.includeFiles && !columnHasInclude) {
                        const panel = this._getWebviewPanel();

                        for (const relativePath of task.includeFiles) {
                            // FIX: Must normalize path before registry lookup (registry does NOT normalize internally)
                            const normalizedPath = (panel as any)._includeFileManager?.normalizeIncludePath(relativePath);
                            const file = panel.fileRegistry?.getByRelativePath(normalizedPath);

                            if (file) {
                                // Task include: description contains the FULL file content
                                // No need to reconstruct - just save the description as-is
                                const fullFileContent = message.taskData.description || '';

                                // Update file content immediately (marks as unsaved)
                                // This ensures "text modification" path calls the SAME function as "edit include file" path
                                file.setContent(fullFileContent, false);
                            } else {
                                console.warn(`[editTask] File not found in registry: ${relativePath}`);
                                // File will be created when markUnsavedChanges → trackIncludeFileUnsavedChanges is called
                            }
                        }
                    }
                }

                // Note: Task include changes are saved when the main kanban file is saved
                // The file instance has been updated above, so saving will write the correct content
                break;
            case 'updateTaskFromStrikethroughDeletion':
                await this.handleUpdateTaskFromStrikethroughDeletion(message);
                break;
            case 'updateColumnTitleFromStrikethroughDeletion':
                // UNIFIED: Route through same handler as editColumnTitle
                await this.handleEditColumnTitleUnified(message.columnId, message.newTitle);
                break;
            case 'moveTask':
                await this.performBoardAction(() => 
                    this._boardOperations.moveTask(this._getCurrentBoard()!, message.taskId, message.fromColumnId, message.toColumnId, message.newIndex)
                );
                break;
            case 'addTask':
                await this.performBoardAction(() => 
                    this._boardOperations.addTask(this._getCurrentBoard()!, message.columnId, message.taskData)
                );
                break;
            case 'addTaskAtPosition':
                await this.performBoardAction(() => 
                    this._boardOperations.addTaskAtPosition(this._getCurrentBoard()!, message.columnId, message.taskData, message.insertionIndex)
                );
                break;
            case 'deleteTask':
                // Frontend already updated (cache-first), don't send update back
                await this.performBoardAction(() =>
                    this._boardOperations.deleteTask(this._getCurrentBoard()!, message.taskId, message.columnId),
                    { sendUpdate: false }
                );
                break;
            case 'duplicateTask':
                await this.performBoardAction(() => 
                    this._boardOperations.duplicateTask(this._getCurrentBoard()!, message.taskId, message.columnId)
                );
                break;
            case 'insertTaskBefore':
                await this.performBoardAction(() => 
                    this._boardOperations.insertTaskBefore(this._getCurrentBoard()!, message.taskId, message.columnId)
                );
                break;
            case 'insertTaskAfter':
                await this.performBoardAction(() => 
                    this._boardOperations.insertTaskAfter(this._getCurrentBoard()!, message.taskId, message.columnId)
                );
                break;
            case 'moveTaskToTop':
                await this.performBoardAction(() => 
                    this._boardOperations.moveTaskToTop(this._getCurrentBoard()!, message.taskId, message.columnId)
                );
                break;
            case 'moveTaskUp':
                await this.performBoardAction(() => 
                    this._boardOperations.moveTaskUp(this._getCurrentBoard()!, message.taskId, message.columnId)
                );
                break;
            case 'moveTaskDown':
                await this.performBoardAction(() => 
                    this._boardOperations.moveTaskDown(this._getCurrentBoard()!, message.taskId, message.columnId)
                );
                break;
            case 'moveTaskToBottom':
                await this.performBoardAction(() => 
                    this._boardOperations.moveTaskToBottom(this._getCurrentBoard()!, message.taskId, message.columnId)
                );
                break;
            case 'moveTaskToColumn':
                await this.performBoardAction(() => 
                    this._boardOperations.moveTaskToColumn(this._getCurrentBoard()!, message.taskId, message.fromColumnId, message.toColumnId)
                );
                break;
                
            // Column operations
            case 'addColumn':
                await this.performBoardAction(() => 
                    this._boardOperations.addColumn(this._getCurrentBoard()!, message.title)
                );
                break;
            case 'moveColumn':
                await this.performBoardAction(() => 
                    this._boardOperations.moveColumn(this._getCurrentBoard()!, message.fromIndex, message.toIndex, message.fromRow, message.toRow)
                );
                break;
            case 'deleteColumn':
                // REVERT: Using performBoardAction to investigate why changes are being reverted
                await this.performBoardAction(() => {
                    const result = this._boardOperations.deleteColumn(this._getCurrentBoard()!, message.columnId);
                    return result;
                });
                break;
            case 'insertColumnBefore':
                await this.performBoardAction(() => 
                    this._boardOperations.insertColumnBefore(this._getCurrentBoard()!, message.columnId, message.title)
                );
                break;
            case 'insertColumnAfter':
                await this.performBoardAction(() => 
                    this._boardOperations.insertColumnAfter(this._getCurrentBoard()!, message.columnId, message.title)
                );
                break;
            case 'sortColumn':
                await this.performBoardAction(() => 
                    this._boardOperations.sortColumn(this._getCurrentBoard()!, message.columnId, message.sortType)
                );
                break;
            case 'editingStarted':
                // User started editing - block board regenerations
                this._getWebviewPanel().setEditingInProgress(true);
                // CRITICAL: Set edit mode flag on ALL relevant files for conflict detection
                {
                    const panel = this._getWebviewPanel();
                    const mainFile = panel.fileRegistry.getMainFile();
                    if (mainFile) {
                        mainFile.setEditMode(true);
                    }

                    // CRITICAL FIX: Also set edit mode on include files if editing within an include
                    // This prevents external changes to include files from being missed during editing
                    const board = panel.getBoard();
                    if (board && (message.taskId || message.columnId)) {
                        // Find the column being edited
                        const column = board.columns.find((col: any) =>
                            col.id === message.columnId ||
                            col.tasks.some((t: any) => t.id === message.taskId)
                        );

                        if (column) {
                            // Check if editing within a column include
                            if (column.includeFiles && column.includeFiles.length > 0) {
                                for (const relativePath of column.includeFiles) {
                                    const includeFile = panel.fileRegistry.getByRelativePath(relativePath);
                                    if (includeFile) {
                                        includeFile.setEditMode(true);
                                    }
                                }
                            }

                            // Check if editing a task include
                            // CRITICAL FIX: Skip for column-generated tasks
                            if (message.taskId) {
                                const task = column.tasks.find((t: any) => t.id === message.taskId);
                                const columnHasInclude = column.includeMode === true;

                                if (task && task.includeFiles && task.includeFiles.length > 0 && !columnHasInclude) {
                                    for (const relativePath of task.includeFiles) {
                                        const includeFile = panel.fileRegistry.getByRelativePath(relativePath);
                                        if (includeFile) {
                                            includeFile.setEditMode(true);
                                        }
                                    }
                                } else if (columnHasInclude) {
                                }
                            }
                        }
                    }
                }
                break;

            case 'editingStopped':
                // Frontend confirms editing has stopped (response to stopEditing request)
                if (message.requestId) {
                    this._handleEditingStopped(message.requestId, message.capturedEdit);
                }
                break;

            case 'editingStoppedNormal':
                // User finished editing normally (not via backend request)
                this._getWebviewPanel().setEditingInProgress(false);
                // Clear edit mode flag on ALL files (main + includes)
                {
                    const panel = this._getWebviewPanel();
                    const mainFile = panel.fileRegistry.getMainFile();
                    if (mainFile) {
                        mainFile.setEditMode(false);
                    }

                    // CRITICAL FIX: Also clear edit mode on all include files
                    const allFiles = panel.fileRegistry.getAll();
                    for (const file of allFiles) {
                        if (file.getFileType() !== 'main') {
                            file.setEditMode(false);
                        }
                    }
                }
                break;

            case 'renderSkipped':
                // OPTIMIZATION 1: Frontend reports it skipped a render - mark as dirty
                {
                    const panel = this._getWebviewPanel();
                    if (message.itemType === 'column') {
                        panel.markColumnDirty(message.itemId);
                    } else if (message.itemType === 'task') {
                        panel.markTaskDirty(message.itemId);
                    }
                }
                break;

            case 'renderCompleted':
                // OPTIMIZATION 3: Frontend successfully rendered - clear dirty flag
                {
                    const panel = this._getWebviewPanel();
                    if (message.itemType === 'column') {
                        panel.clearColumnDirty(message.itemId);
                    } else if (message.itemType === 'task') {
                        panel.clearTaskDirty(message.itemId);
                    }
                }
                break;

            case 'columnsUnfolded':
                // Frontend confirms columns have been unfolded (response to unfoldColumnsBeforeUpdate request)
                if (message.requestId) {
                    this._handleColumnsUnfolded(message.requestId);
                }
                break;

            case 'editColumnTitle':
                // SWITCH-2: Route through unified column include switch function
                await this.handleEditColumnTitleUnified(message.columnId, message.title);
                break;
            case 'editTaskTitle':

                // Check if this might be a task include file change
                const currentBoardForTask = this._getCurrentBoard();
                const targetColumn = currentBoardForTask?.columns.find(col => col.id === message.columnId);
                const task = targetColumn?.tasks.find(t => t.id === message.taskId);

                if (task) {
                }

                // CRITICAL FIX: Skip include detection for column-generated tasks
                // Column-generated tasks are slides from column includes (presentation files)
                // Their titles may contain text that LOOKS like include syntax
                // The ONLY way to identify them: check if parent column has includeMode=true
                const columnHasTaskInclude = targetColumn?.includeMode === true;

                if (columnHasTaskInclude) {
                    // Fall through to regular title edit below
                } else {
                    // Check if the new title contains include syntax (location-based: task include)
                    const hasTaskIncludeMatches = message.title.match(INCLUDE_SYNTAX.REGEX);

                    // BUGFIX: Also check if old title had includes that are being removed
                    const oldTaskIncludeMatches = task ? (task.title || '').match(INCLUDE_SYNTAX.REGEX) : null;

                    const hasTaskIncludeChanges = hasTaskIncludeMatches || oldTaskIncludeMatches;

                if (hasTaskIncludeChanges) {
                    // Extract the include files from the new title
                    const newIncludeFiles: string[] = [];
                    if (hasTaskIncludeMatches) {
                        hasTaskIncludeMatches.forEach((match: string) => {
                            const filePath = match.replace(/!!!include\(([^)]+)\)!!!/, '$1').trim();
                            newIncludeFiles.push(filePath);
                        });
                    }

                    // BUGFIX: Route through state machine for ANY include changes (add, remove, or switch)
                    // This matches the column logic and ensures removal is handled
                    if (task) {
                        const panel = this._getWebviewPanel();
                        const oldTaskIncludeFiles = task.includeFiles || [];

                        // Clear dirty flag BEFORE stopping editing
                        // Otherwise RACE-2 handler will send stale updateTaskContent from dirty items
                        if (panel.clearTaskDirty) {
                            panel.clearTaskDirty(message.taskId);
                        }

                        // CRITICAL FIX: Stop editing BEFORE starting switch to prevent race condition
                        // This ensures user can't edit description while content is loading
                        await this.requestStopEditing();

                        try {
                            // Route through unified state machine via handleIncludeSwitch
                            // The state machine will:
                            // 1. Load new file content from disk
                            // 2. Update task.description and task.displayTitle
                            // 3. Invalidate board cache
                            // 4. Send updateTaskContent to frontend
                            // 5. Mark changes as unsaved
                            // CRITICAL: Only pass taskId for task includes (NOT columnId)
                            // If columnId is present, handleIncludeSwitch treats it as a column switch!
                            await panel.handleIncludeSwitch({
                                taskId: message.taskId,
                                // DO NOT pass columnId - state machine finds column from taskId
                                oldFiles: oldTaskIncludeFiles,
                                newFiles: newIncludeFiles,
                                newTitle: message.title
                            });

                            // State machine already updated all task properties (title, includeFiles, description)
                            // No need to update board here - would cause stale data issues

                            // RACE-1: Clear editing flag after task include switch completes
                            panel.setEditingInProgress(false);
                        } catch (error: any) {
                            // RACE-1: On error, still clear editing flag
                            panel.setEditingInProgress(false);

                            if (error.message === 'USER_CANCELLED') {
                            } else {
                                throw error; // Re-throw other errors
                            }
                        }
                    }
                    break; // Exit after include handling
                }
                } // End of columnHasTaskInclude check

                // Regular title edit without include syntax (or column-generated task edit)
                // STATE-3: Frontend already updated title, don't echo back
                await this.performBoardAction(() =>
                    this._boardOperations.editTask(currentBoardForTask!, message.taskId, message.columnId, { title: message.title }),
                    { sendUpdate: false }
                );

                // RACE-1: Clear editing flag after regular title edit
                this._getWebviewPanel().setEditingInProgress(false);
                break;
            case 'moveColumnWithRowUpdate':
                await this.performBoardAction(() => 
                    this._boardOperations.moveColumnWithRowUpdate(
                        this._getCurrentBoard()!, 
                        message.columnId, 
                        message.newPosition, 
                        message.newRow
                    )
                );
                break;
            case 'reorderColumns':
                await this.performBoardAction(() => 
                    this._boardOperations.reorderColumns(
                        this._getCurrentBoard()!, 
                        message.newOrder,
                        message.movedColumnId,
                        message.targetRow
                    )
                );
                break;
            case 'performSort':
                await this.performBoardAction(() => 
                    this._boardOperations.performAutomaticSort(this._getCurrentBoard()!)
                );
                break;
            case 'saveBoardState':
                await this.handleSaveBoardState(message.board);
                break;
            case 'requestTaskIncludeFileName':
                await this.handleRequestTaskIncludeFileName(message.taskId, message.columnId);
                break;

            case 'saveClipboardImage':
                await this.handleSaveClipboardImage(
                    message.imageData,
                    message.imagePath,
                    message.mediaFolderPath,
                    message.dropPosition,
                    message.imageFileName,
                    message.mediaFolderName
                );
                break;

            case 'saveClipboardImageWithPath':
                await this.handleSaveClipboardImageWithPath(
                    message.imageData,
                    message.imageType,
                    message.dropPosition,
                    message.md5Hash
                );
                break;

            case 'pasteImageIntoField':
                await this.handlePasteImageIntoField(
                    message.imageData,
                    message.imageType,
                    message.md5Hash,
                    message.cursorPosition
                );
                break;

            case 'saveDroppedImageFromContents':
                await this.handleAnyFileDrop(
                    null, // No source path (File object)
                    message.imageData,
                    message.originalFileName,
                    message.dropPosition,
                    true // isImage
                );
                break;

            case 'copyImageToMedia':
                await this.handleAnyFileDrop(
                    message.sourcePath,
                    null, // No base64 data (URI drop)
                    message.originalFileName,
                    message.dropPosition,
                    true // isImage
                );
                break;

            case 'handleFileUriDrop':
                await this.handleAnyFileDrop(
                    message.sourcePath,
                    null, // No base64 data (URI drop)
                    message.originalFileName,
                    message.dropPosition,
                    false // not an image
                );
                break;

            case 'saveDroppedFileFromContents':
                await this.handleAnyFileDrop(
                    null, // No source path (File object)
                    message.fileData,
                    message.originalFileName,
                    message.dropPosition,
                    false // not an image
                );
                break;

            case 'getExportDefaultFolder':
                await this.handleGetExportDefaultFolder();
                break;

            case 'selectExportFolder':
                await this.handleSelectExportFolder(message.defaultPath);
                break;

            // Marp export operations
            case 'getMarpThemes':
                await this.handleGetMarpThemes();
                break;

            case 'pollMarpThemes':
                await this.handlePollMarpThemes();
                break;

            case 'openInMarpPreview':
                await this.handleOpenInMarpPreview(message.filePath);
                break;

            case 'checkMarpStatus':
                await this.handleCheckMarpStatus();
                break;

            case 'getMarpAvailableClasses':
                await this.handleGetMarpAvailableClasses();
                break;

            case 'showError':
                vscode.window.showErrorMessage(message.message);
                break;

            case 'showInfo':
                vscode.window.showInformationMessage(message.message);
                break;

            case 'askOpenExportFolder':
                await this.handleAskOpenExportFolder(message.path);
                break;

            case 'getTrackedFilesDebugInfo':
                await this.handleGetTrackedFilesDebugInfo();
                break;

            case 'clearTrackedFilesCache':
                await this.handleClearTrackedFilesCache();
                break;

            case 'reloadAllIncludedFiles':
                await this.handleReloadAllIncludedFiles();
                break;

            case 'saveIndividualFile':
                await this.handleSaveIndividualFile(message.filePath, message.isMainFile, message.forceSave);
                break;

            case 'reloadIndividualFile':
                await this.handleReloadIndividualFile(message.filePath, message.isMainFile);
                break;

            case 'forceWriteAllContent':
                await this.handleForceWriteAllContent();
                break;

            case 'verifyContentSync':
                await this.handleVerifyContentSync(message.frontendBoard);
                break;

            case 'stopAutoExport':
                await this.handleStopAutoExport();
                break;

            // NEW UNIFIED EXPORT HANDLER
            case 'export':
                const newExportId = `export_${Date.now()}`;
                await this.startOperation(newExportId, 'export', 'Exporting...');
                try {
                    await this.handleExport(message.options, newExportId);
                    await this.endOperation(newExportId);
                } catch (error) {
                    await this.endOperation(newExportId);
                    throw error;
                }
                break;

            // PlantUML rendering (backend)
            case 'renderPlantUML':
                await this.handleRenderPlantUML(message);
                break;

            // Draw.io rendering (backend)
            case 'requestDrawIORender':
                await this.handleRenderDrawIO(message);
                break;

            // Excalidraw rendering (backend)
            case 'requestExcalidrawRender':
                await this.handleRenderExcalidraw(message);
                break;

            // PDF page rendering (backend)
            case 'requestPDFPageRender':
                await this.handleRenderPDFPage(message);
                break;

            // PDF info request (get page count)
            case 'requestPDFInfo':
                await this.handleGetPDFInfo(message);
                break;

            // PlantUML to SVG conversion
            case 'convertPlantUMLToSVG':
                await this.handleConvertPlantUMLToSVG(message);
                break;

            // Mermaid to SVG conversion
            case 'convertMermaidToSVG':
                await this.handleConvertMermaidToSVG(message);
                break;

            // Mermaid export rendering (via webview for export)
            case 'mermaidExportSuccess':
                getMermaidExportService().handleRenderSuccess(message.requestId, message.svg);
                break;

            case 'mermaidExportError':
                getMermaidExportService().handleRenderError(message.requestId, message.error);
                break;

            default:
                console.error('handleMessage : Unknown message type:', message.type);
                break;
        }
    }

    private async handleUndo() {
        const currentBoard = this._getCurrentBoard();
        const restoredBoard = this._boardStore.undo();
        
        if (restoredBoard) {
            // Detect changes for focusing
            const focusTargets = this.detectBoardChanges(currentBoard, restoredBoard);
            this._previousBoardForFocus = JSON.parse(JSON.stringify(currentBoard));
            
            // Unfold columns BEFORE board update if cards are being added to collapsed columns
            if (focusTargets.length > 0) {
                await this.unfoldColumnsForFocusTargets(focusTargets, restoredBoard);
            }
            
            this._setUndoRedoOperation(true);
            this._setBoard(restoredBoard);
            this._boardOperations.setOriginalTaskOrder(restoredBoard);
            
            // Use cache-first architecture: mark as unsaved instead of direct save
            this._markUnsavedChanges(true);
            await this._onBoardUpdate();
            
            // Send focus information to webview after board update
            if (focusTargets.length > 0) {
                this.sendFocusTargets(focusTargets);
            } else {
            }

            // Reset flag immediately after operations complete (no delay needed)
            this._setUndoRedoOperation(false);
        }
    }

    private detectBoardChanges(oldBoard: KanbanBoard | undefined, newBoard: KanbanBoard): FocusTarget[] {
        if (!oldBoard) {
            return [];
        }
        
        const focusTargets: FocusTarget[] = [];
        
        // Create maps for efficient lookup
        const oldColumns = new Map(oldBoard.columns.map(col => [col.id, col]));
        const newColumns = new Map(newBoard.columns.map(col => [col.id, col]));
        
        const oldTasks = new Map();
        const newTasks = new Map();
        
        // Build task maps
        oldBoard.columns.forEach(col => {
            col.tasks.forEach(task => {
                oldTasks.set(task.id, { task, columnId: col.id });
            });
        });
        
        newBoard.columns.forEach(col => {
            col.tasks.forEach(task => {
                newTasks.set(task.id, { task, columnId: col.id });
            });
        });
        
        // Check for column changes
        for (const [columnId, newColumn] of newColumns) {
            const oldColumn = oldColumns.get(columnId);
            if (!oldColumn) {
                focusTargets.push({ type: 'column', id: columnId, operation: 'created' });
            } else if (JSON.stringify(oldColumn) !== JSON.stringify(newColumn)) {
                focusTargets.push({ type: 'column', id: columnId, operation: 'modified' });
            }
        }
        
        // Check for deleted columns
        for (const columnId of oldColumns.keys()) {
            if (!newColumns.has(columnId)) {
                focusTargets.push({ type: 'column', id: columnId, operation: 'deleted' });
            }
        }
        
        // Check for task changes
        for (const [taskId, newTaskData] of newTasks) {
            const oldTaskData = oldTasks.get(taskId);
            if (!oldTaskData) {
                focusTargets.push({ type: 'task', id: taskId, operation: 'created' });
            } else if (oldTaskData.columnId !== newTaskData.columnId) {
                focusTargets.push({ type: 'task', id: taskId, operation: 'moved' });
            } else if (JSON.stringify(oldTaskData.task) !== JSON.stringify(newTaskData.task)) {
                focusTargets.push({ type: 'task', id: taskId, operation: 'modified' });
            }
        }
        
        // Check for deleted tasks
        for (const taskId of oldTasks.keys()) {
            if (!newTasks.has(taskId)) {
                focusTargets.push({ type: 'task', id: taskId, operation: 'deleted' });
            }
        }
        
        return focusTargets;
    }

    private async unfoldColumnsForFocusTargets(focusTargets: FocusTarget[], restoredBoard: KanbanBoard) {
        const columnsToUnfold = new Set<string>();
        
        focusTargets.forEach(target => {
            if (target.type === 'task' && (target.operation === 'created' || target.operation === 'moved')) {
                // For task operations, check the restored board to find which column the task will be in
                for (const column of restoredBoard.columns) {
                    if (column.tasks.some(task => task.id === target.id)) {
                        columnsToUnfold.add(column.id);
                        break;
                    }
                }
            } else if (target.type === 'column' && target.operation === 'created') {
                columnsToUnfold.add(target.id);
            }
        });
        
        if (columnsToUnfold.size > 0) {
            // Use request-response pattern to ensure columns are unfolded before proceeding
            await this._requestUnfoldColumns(Array.from(columnsToUnfold));
        }
    }

    private sendFocusTargets(focusTargets: FocusTarget[]) {
        const webviewPanel = this._getWebviewPanel();
        if (webviewPanel && webviewPanel._panel && webviewPanel._panel.webview) {
            // Send focus message immediately - webview will wait for rendering to complete
            webviewPanel._panel.webview.postMessage({
                type: 'focusAfterUndoRedo',
                focusTargets: focusTargets
            });
        } else {
        }
    }

    private async handleRedo() {
        const currentBoard = this._getCurrentBoard();
        const restoredBoard = this._boardStore.redo();
        
        if (restoredBoard) {
            // Detect changes for focusing
            const focusTargets = this.detectBoardChanges(currentBoard, restoredBoard);
            this._previousBoardForFocus = JSON.parse(JSON.stringify(currentBoard));
            
            // Unfold columns BEFORE board update if cards are being added to collapsed columns
            if (focusTargets.length > 0) {
                await this.unfoldColumnsForFocusTargets(focusTargets, restoredBoard);
            }
            
            this._setUndoRedoOperation(true);
            this._setBoard(restoredBoard);
            this._boardOperations.setOriginalTaskOrder(restoredBoard);
            
            // Use cache-first architecture: mark as unsaved instead of direct save
            this._markUnsavedChanges(true);
            await this._onBoardUpdate();
            
            // Send focus information to webview after board update
            if (focusTargets.length > 0) {
                this.sendFocusTargets(focusTargets);
            } else {
            }

            // Reset flag immediately after operations complete (no delay needed)
            this._setUndoRedoOperation(false);
        }
    }

    private async handleSelectFile() {
        const document = await this._fileManager.selectFile();
        if (document) {
            // This would need to be handled by the main panel
        }
    }

    /**
     * Handle edit mode start message from frontend
     */
    private async handleEditModeStart(message: any) {
        const filePath = message.filePath;
        const fileType = message.fileType;


        // Resolve to absolute path
        const currentDocument = this._fileManager.getDocument();
        if (!currentDocument) {
            console.warn('[MessageHandler.handleEditModeStart] No current document');
            return;
        }

        let absolutePath: string;
        if (fileType === 'main') {
            absolutePath = currentDocument.uri.fsPath;
        } else {
            // For includes, filePath is relative - resolve it
            const basePath = path.dirname(currentDocument.uri.fsPath);
            absolutePath = path.resolve(basePath, filePath);
        }

        // Mark edit mode start in file registry
        const panel = this._getWebviewPanel();
        if (panel && panel.fileRegistry) {
            const file = panel.fileRegistry.getByPath(absolutePath);
            if (file) {
                file.setEditMode(true);
            }
        }
    }

    /**
     * Handle edit mode end message from frontend
     */
    private async handleEditModeEnd(message: any) {
        const filePath = message.filePath;
        const fileType = message.fileType;


        // Resolve to absolute path
        const currentDocument = this._fileManager.getDocument();
        if (!currentDocument) {
            console.warn('[MessageHandler.handleEditModeEnd] No current document');
            return;
        }

        let absolutePath: string;
        if (fileType === 'main') {
            absolutePath = currentDocument.uri.fsPath;
        } else {
            // For includes, filePath is relative - resolve it
            const basePath = path.dirname(currentDocument.uri.fsPath);
            absolutePath = path.resolve(basePath, filePath);
        }

        // Mark edit mode end in file registry
        const panel2 = this._getWebviewPanel();
        if (panel2 && panel2.fileRegistry) {
            const file = panel2.fileRegistry.getByPath(absolutePath);
            if (file) {
                file.setEditMode(false);
            }
        }
    }

    /**
     * Handle updating a Marp global setting in the YAML frontmatter
     * This updates the board's yamlHeader in memory and marks as unsaved
     * The actual file write happens when user saves (Ctrl+S)
     */
    private async handleUpdateMarpGlobalSetting(key: string, value: string): Promise<void> {
        try {
            const board = this._getCurrentBoard();
            if (!board) {
                console.error('[MessageHandler] No board to update Marp setting');
                return;
            }

            // Get current YAML header or create new one
            let yamlHeader = board.yamlHeader || '';
            const lines = yamlHeader.split('\n');

            // Find YAML frontmatter boundaries (without the --- delimiters)
            let keyFound = false;

            // If empty, initialize with kanban-plugin marker
            if (!yamlHeader || yamlHeader.trim() === '') {
                yamlHeader = 'kanban-plugin: board';
                lines.length = 0;
                lines.push('kanban-plugin: board');
            }

            // Update or add the key
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const keyMatch = line.match(/^(\s*)([a-zA-Z0-9_-]+):\s*.*/);
                if (keyMatch && keyMatch[2] === key) {
                    // Update existing key or remove if empty
                    if (value === '' || value === null || value === undefined) {
                        lines.splice(i, 1);
                    } else {
                        lines[i] = `${keyMatch[1]}${key}: ${value}`;
                    }
                    keyFound = true;
                    break;
                }
            }

            // If key not found and value is not empty, add it
            if (!keyFound && value !== '' && value !== null && value !== undefined) {
                lines.push(`${key}: ${value}`);
            }

            // Update board's yamlHeader
            board.yamlHeader = lines.filter(line => line.trim() !== '').join('\n');

            // CRITICAL: Also update the frontmatter object that frontend reads from
            if (!board.frontmatter) {
                board.frontmatter = {};
            }
            if (value === '' || value === null || value === undefined) {
                delete board.frontmatter[key];
            } else {
                board.frontmatter[key] = value;
            }

            // Mark as unsaved changes (will be written when user saves)
            // Frontend already updated optimistically, so don't send board update back
            this._markUnsavedChanges(true, board);

            console.log(`[MessageHandler] Updated Marp global setting in memory: ${key} = ${value}`);

        } catch (error) {
            console.error('[MessageHandler] Error updating Marp global setting:', error);
            vscode.window.showErrorMessage(`Failed to update Marp setting: ${error}`);
        }
    }

    /**
     * Handle opening a file in VS Code
     */
    private async handleOpenFile(filePath: string): Promise<void> {
        try {

            // Resolve the file path to absolute if it's relative
            let absolutePath = filePath;
            if (!path.isAbsolute(filePath)) {
                // Get the current document's directory as base
                const document = this._fileManager.getDocument();
                if (document) {
                    const currentDir = path.dirname(document.uri.fsPath);
                    absolutePath = PathResolver.resolve(currentDir, filePath);
                } else {
                    console.error('[MessageHandler] Cannot resolve relative path - no current document');
                    return;
                }
            }

            // Create a VS Code URI
            const fileUri = vscode.Uri.file(absolutePath);

            // Normalize the path for comparison (resolve symlinks, normalize separators)
            const normalizedPath = path.resolve(absolutePath);


            // Check if the file is already open as a document (even if not visible)
            const existingDocument = vscode.workspace.textDocuments.find(doc => {
                const docPath = path.resolve(doc.uri.fsPath);
                return docPath === normalizedPath;
            });

            if (existingDocument) {

                // Check if it's currently visible
                const visibleEditor = vscode.window.visibleTextEditors.find(editor =>
                    path.resolve(editor.document.uri.fsPath) === normalizedPath
                );

                if (visibleEditor) {

                    // Document is already visible - check if we need to focus it
                    if (vscode.window.activeTextEditor?.document.uri.fsPath === normalizedPath) {
                        return; // Already focused, nothing to do
                    }
                }

                await vscode.window.showTextDocument(existingDocument, {
                    preserveFocus: false,
                    preview: false
                });
            } else {
                // Open the document first, then show it
                const document = await vscode.workspace.openTextDocument(absolutePath);
                await vscode.window.showTextDocument(document, {
                    preserveFocus: false,
                    preview: false
                });
            }


        } catch (error) {
            console.error(`[MessageHandler] Error opening file ${filePath}:`, error);
        }
    }

    private async handleSaveBoardState(board: any) {
        if (!board) {
            console.warn('❌ No board data received for saving');
            return;
        }


        // Log each column's includeMode status
        if (board.columns) {
            for (const col of board.columns) {
            }
        }

        // NOTE: Do not save undo state here - individual operations already saved their undo states
        // before making changes. Saving here would create duplicate/grouped undo states.

        // Replace the current board with the new one
        this._setBoard(board);

        // Save to markdown file only - do NOT trigger board update
        // The webview already has the correct state (it sent us this board)
        // Triggering _onBoardUpdate() would cause folding state to be lost
        await this._onSaveToMarkdown();

        // Trigger marpWatch export if active
        if (this._autoExportSettings?.marpWatch) {
            // Get document from fileManager, or reopen from file path if needed
            let document = this._fileManager.getDocument();
            const filePath = this._fileManager.getFilePath();

            // If document is closed but we have a file path, reopen it
            if (!document && filePath) {
                const vscode = require('vscode');
                try {
                    document = await vscode.workspace.openTextDocument(filePath);
                } catch (error) {
                    console.error(`[MessageHandler.saveBoardState] Failed to reopen document:`, error);
                }
            }

            if (document) {
                const ExportService = require('./exportService').ExportService;
                try {
                    await ExportService.export(document, this._autoExportSettings, board);
                } catch (error) {
                    console.error('[MessageHandler.saveBoardState] MarpWatch export failed:', error);
                }
            }
        }

        // No board update needed - webview state is already correct
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

    private async handlePageHiddenWithUnsavedChanges(): Promise<void> {

        try {
            const document = this._fileManager.getDocument();
            const fileName = document ? path.basename(document.fileName) : 'kanban board';

            // Only create backup if 5+ minutes have passed since unsaved changes
            // This uses the BackupManager to check timing and creates a regular backup
            const webviewPanel = this._getWebviewPanel();
            if (document && webviewPanel?.backupManager && webviewPanel.backupManager.shouldCreatePageHiddenBackup()) {
                await webviewPanel.backupManager.createBackup(document, { label: 'backup' });
            } else {
            }

            // Reset the close prompt flag in webview (with null check)
            const panel = this._getWebviewPanel();
            if (panel && panel._panel && panel._panel.webview) {
                panel._panel.webview.postMessage({
                    type: 'resetClosePromptFlag'
                });
            }

        } catch (error) {
            console.error('Error handling page hidden backup:', error);
            // Reset flag even if there was an error (with null check)
            const panel = this._getWebviewPanel();
            if (panel && panel._panel && panel._panel.webview) {
                panel._panel.webview.postMessage({
                    type: 'resetClosePromptFlag'
                });
            }
        }
    }

    private async handleSetPreference(key: string, value: string): Promise<void> {
        try {
            await configService.updateConfig(key as any, value, vscode.ConfigurationTarget.Workspace);
        } catch (error) {
            console.error(`Failed to update preference ${key}:`, error);
            vscode.window.showErrorMessage(`Failed to update ${key} preference: ${error}`);
        }
    }

    private async handleSetContext(contextVariable: string, value: boolean): Promise<void> {
        try {
            await vscode.commands.executeCommand('setContext', contextVariable, value);
        } catch (error) {
            console.error(`Failed to set context variable ${contextVariable}:`, error);
        }
    }

    private async handleVSCodeSnippet(message: any): Promise<void> {
        try {
            console.log(`[MessageHandler] Getting snippet name for shortcut: ${message.shortcut}`);

            // Use VS Code's snippet resolution to get the actual snippet content
            // This leverages VS Code's built-in snippet system
            const snippetName = await this.getSnippetNameForShortcut(message.shortcut);

            if (!snippetName) {
                console.warn(`[MessageHandler] No snippet name found for ${message.shortcut}`);
                vscode.window.showInformationMessage(
                    `No snippet configured for ${message.shortcut}. Add a keybinding with "editor.action.insertSnippet" command.`
                );
                return;
            }

            console.log(`[MessageHandler] Snippet name: ${snippetName}, resolving content...`);

            // Resolve the snippet content from VS Code's markdown snippet configuration
            const resolvedContent = await this.resolveSnippetContent(snippetName);

            if (resolvedContent) {
                console.log(`[MessageHandler] Snippet resolved, length: ${resolvedContent.length}, sending to webview`);
                const panel = this._getWebviewPanel();
                if (panel) {
                    panel._panel.webview.postMessage({
                        type: 'insertSnippetContent',
                        content: resolvedContent,
                        fieldType: message.fieldType,
                        taskId: message.taskId
                    });
                    console.log(`[MessageHandler] Snippet content sent to webview`);
                } else {
                    console.warn(`[MessageHandler] No webview panel found`);
                }
            } else {
                console.warn(`[MessageHandler] Snippet content is empty for: ${snippetName}`);
            }

        } catch (error) {
            console.error('[MessageHandler] Failed to handle VS Code snippet:', error);
            vscode.window.showInformationMessage(
                `Use Ctrl+Space in the kanban editor for snippet picker.`
            );
        }
    }

    private async handleEditorShortcut(message: any): Promise<void> {
        try {

            // Use the command sent from frontend (already loaded on view focus)
            // This avoids reloading shortcuts on every keypress
            const userCommand = message.command;

            console.log(`[MessageHandler] handleEditorShortcut - shortcut: ${message.shortcut}, command: ${userCommand}, type: ${typeof userCommand}`);

            // If it's a snippet command, handle it specially
            if (userCommand === 'editor.action.insertSnippet') {
                console.log(`[MessageHandler] Handling snippet shortcut: ${message.shortcut}`);
                await this.handleVSCodeSnippet(message);
                return;
            }

            if (userCommand) {

                try {
                    // Simply execute the command - let VSCode handle it with default behavior
                    // This avoids issues with temp documents closing the wrong view
                    console.log(`[MessageHandler] Executing command: ${userCommand}`);
                    await vscode.commands.executeCommand(userCommand);

                    return;
                } catch (err) {
                    console.error(`[MessageHandler] Failed to execute command:`, err);
                }
            }


        } catch (error) {
            console.error(`Failed to handle editor shortcut ${message.shortcut}:`, error);
        }
    }

    /**
     * Get all available shortcuts as a map (shortcut -> command)
     * This is called when the webview gains focus to refresh shortcuts
     */
    async getAllShortcuts(): Promise<Record<string, string>> {
        const shortcutMap: Record<string, string> = {};

        try {
            // 1. Load user keybindings first (lowest priority)
            const keybindings = await this.loadVSCodeKeybindings();

            // Build shortcut map from user keybindings
            // Include ALL commands (including snippets - they're handled by handleVSCodeSnippet)
            for (const binding of keybindings) {
                if (binding.key && binding.command && !binding.command.startsWith('-')) {
                    // Normalize the key format
                    const normalizedKey = binding.key
                        .toLowerCase()
                        .replace(/cmd/g, 'meta')
                        .replace(/\s+/g, '');
                    shortcutMap[normalizedKey] = binding.command;
                }
            }

            console.log(`[MessageHandler] Loaded ${Object.keys(shortcutMap).length} user keybindings`);

            // 2. Add VSCode default shortcuts (highest priority - overrides user keybindings)
            const extensionShortcuts = await this.getExtensionShortcuts();
            Object.assign(shortcutMap, extensionShortcuts);

            console.log(`[MessageHandler] Total shortcuts loaded: ${Object.keys(shortcutMap).length}`);

        } catch (error) {
            console.error('[MessageHandler] Failed to load shortcuts:', error);
        }

        return shortcutMap;
    }

    private async getExtensionShortcuts(): Promise<Record<string, string>> {
        const isMac = process.platform === 'darwin';
        const mod = isMac ? 'meta' : 'ctrl';

        // VSCode commands that need backend processing
        // Since VSCode doesn't expose a keybindings API, we maintain this list
        //
        // IMPORTANT: Only include commands that actually need VSCode backend processing.
        // Clipboard, selection, and basic editing should be handled by the browser.
        const extensionShortcuts: Record<string, string> = {
            // Text transformation commands (these need VSCode backend)
            [`${mod}+/`]: 'editor.action.commentLine',
            [`${mod}+[`]: 'editor.action.outdentLines',
            [`${mod}+]`]: 'editor.action.indentLines',

            // Text formatting (markdown extensions)
            [`${mod}+b`]: 'editor.action.fontBold',
            [`${mod}+i`]: 'editor.action.fontItalic',

            // Line manipulation (these modify text in complex ways)
            'alt+up': 'editor.action.moveLinesUpAction',
            'alt+down': 'editor.action.moveLinesDownAction',
            [`${mod}+shift+d`]: 'editor.action.copyLinesDownAction',
            [`${mod}+shift+k`]: 'editor.action.deleteLines',

            // Translation extensions (need backend to call extension)
            'alt+t': 'deepl.translate',
            'shift+alt+t': 'deepl.translateTo',

            // NOTE: The following are NOT included because they should work natively:
            // - Clipboard (Cmd+V, Cmd+C, Cmd+X) - browser handles these
            // - Select All (Cmd+A) - browser selection works fine
            // - Undo/Redo (Cmd+Z, Cmd+Y) - Kanban has its own undo system
            // - Cursor/word navigation - browser handles these
            // - Multi-cursor - doesn't work well in single-line inputs
        };

        // Verify commands actually exist
        const allCommands = await vscode.commands.getCommands();
        const validShortcuts: Record<string, string> = {};
        const rejectedShortcuts: string[] = [];

        for (const [shortcut, command] of Object.entries(extensionShortcuts)) {
            if (allCommands.includes(command)) {
                validShortcuts[shortcut] = command;
            } else {
                rejectedShortcuts.push(`${shortcut} → ${command}`);
            }
        }

        console.log(`[MessageHandler] Loaded ${Object.keys(validShortcuts).length} VSCode shortcuts (${Object.keys(extensionShortcuts).length} checked)`);
        if (rejectedShortcuts.length > 0) {
            console.log(`[MessageHandler] Rejected shortcuts (command not found):`, rejectedShortcuts);
        }

        return validShortcuts;
    }

    private async getExtensionCommandForShortcut(shortcut: string): Promise<string | null> {

        const extensionShortcuts = await this.getExtensionShortcuts();
        const command = extensionShortcuts[shortcut];

        if (command) {
            return command;
        }

        return null;
    }

    private async getCommandForShortcut(shortcut: string): Promise<string | null> {
        try {
            // Read VS Code's keybindings configuration
            const keybindings = await this.loadVSCodeKeybindings();


            // Debug: Show all keybindings that contain 'alt' or match the letter
            const shortcutLetter = shortcut.split('+').pop();
            const relevantBindings = keybindings.filter(b =>
                b.key && (b.key.includes('alt') || b.key.includes(shortcutLetter || ''))
            );

            // Find keybinding that matches our shortcut
            for (const binding of keybindings) {
                if (this.matchesShortcut(binding.key, shortcut) && binding.command) {
                    // Skip negative bindings (commands starting with -)
                    if (binding.command.startsWith('-')) {
                        continue;
                    }

                    return binding.command;
                }
            }

            return null;

        } catch (error) {
            console.error('Failed to find command for shortcut:', error);
            return null;
        }
    }

    private async getSnippetNameForShortcut(shortcut: string): Promise<string | null> {
        try {
            // Read VS Code's actual keybindings configuration
            const keybindings = await this.loadVSCodeKeybindings();

            // Find keybinding that matches our shortcut and uses editor.action.insertSnippet
            for (const binding of keybindings) {
                if (this.matchesShortcut(binding.key, shortcut) &&
                    binding.command === 'editor.action.insertSnippet' &&
                    binding.args?.name) {

                    return binding.args.name;
                }
            }

            return null;

        } catch (error) {
            console.error('Failed to read VS Code keybindings:', error);
            return null;
        }
    }

    private async loadVSCodeKeybindings(): Promise<any[]> {
        try {
            // Load user keybindings
            const userKeybindingsPath = this.getUserKeybindingsPath();
            let keybindings: any[] = [];

            if (userKeybindingsPath && fs.existsSync(userKeybindingsPath)) {
                const content = fs.readFileSync(userKeybindingsPath, 'utf8');
                // Handle JSON with comments
                const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                const userKeybindings = JSON.parse(jsonContent);
                if (Array.isArray(userKeybindings)) {
                    keybindings = keybindings.concat(userKeybindings);
                }
            }

            // Also load workspace keybindings if they exist
            const workspaceKeybindingsPath = this.getWorkspaceKeybindingsPath();
            if (workspaceKeybindingsPath && fs.existsSync(workspaceKeybindingsPath)) {
                const content = fs.readFileSync(workspaceKeybindingsPath, 'utf8');
                const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                const workspaceKeybindings = JSON.parse(jsonContent);
                if (Array.isArray(workspaceKeybindings)) {
                    keybindings = keybindings.concat(workspaceKeybindings);
                }
            }

            return keybindings;

        } catch (error) {
            console.error('Failed to load VS Code keybindings:', error);
            return [];
        }
    }

    private getUserKeybindingsPath(): string | null {
        try {
            const userDataDir = this.getVSCodeUserDataDir();
            if (userDataDir) {
                return path.join(userDataDir, 'User', 'keybindings.json');
            }
            return null;
        } catch (error) {
            console.error('Failed to get user keybindings path:', error);
            return null;
        }
    }

    private getWorkspaceKeybindingsPath(): string | null {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                return path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'keybindings.json');
            }
            return null;
        } catch (error) {
            console.error('Failed to get workspace keybindings path:', error);
            return null;
        }
    }

    private matchesShortcut(keybindingKey: string, shortcut: string): boolean {
        // Normalize the keybinding format
        // VS Code uses "cmd+6" on Mac, we use "meta+6"
        const normalizedKeybinding = keybindingKey
            .toLowerCase()
            .replace(/cmd/g, 'meta')
            .replace(/ctrl/g, 'ctrl')
            .replace(/\s+/g, '');

        const normalizedShortcut = shortcut
            .toLowerCase()
            .replace(/\s+/g, '');

        return normalizedKeybinding === normalizedShortcut;
    }

    private async resolveSnippetContent(snippetName: string): Promise<string> {
        try {
            // Load all markdown snippets from VS Code's configuration
            const allSnippets = await this.loadMarkdownSnippets();

            // Find the specific snippet
            const snippet = allSnippets[snippetName];
            if (!snippet) {
                return '';
            }

            // Process the snippet body
            let body = '';
            if (Array.isArray(snippet.body)) {
                body = snippet.body.join('\n');
            } else if (typeof snippet.body === 'string') {
                body = snippet.body;
            } else {
                return '';
            }

            // Process VS Code snippet variables and syntax
            return this.processSnippetBody(body);

        } catch (error) {
            console.error(`Failed to resolve snippet "${snippetName}":`, error);
            return '';
        }
    }

    private async loadMarkdownSnippets(): Promise<any> {
        const allSnippets: any = {};

        try {
            // 1. Load user snippets from VS Code user directory
            const userSnippetsPath = this.getUserSnippetsPath();
            if (userSnippetsPath && fs.existsSync(userSnippetsPath)) {
                const userSnippets = await this.loadSnippetsFromFile(userSnippetsPath);
                Object.assign(allSnippets, userSnippets);
            }

            // 2. Load workspace snippets if in a workspace
            const workspaceSnippetsPath = this.getWorkspaceSnippetsPath();
            if (workspaceSnippetsPath && fs.existsSync(workspaceSnippetsPath)) {
                const workspaceSnippets = await this.loadSnippetsFromFile(workspaceSnippetsPath);
                Object.assign(allSnippets, workspaceSnippets);
            }

            // 3. Load extension snippets (built-in markdown snippets)
            const extensionSnippets = await this.loadExtensionSnippets();
            Object.assign(allSnippets, extensionSnippets);

            return allSnippets;

        } catch (error) {
            console.error('Failed to load markdown snippets:', error);
            return {};
        }
    }

    private getUserSnippetsPath(): string | null {
        try {
            // VS Code user snippets are stored in different locations per platform
            const userDataDir = this.getVSCodeUserDataDir();
            if (userDataDir) {
                return path.join(userDataDir, 'User', 'snippets', 'markdown.json');
            }
            return null;
        } catch (error) {
            console.error('Failed to get user snippets path:', error);
            return null;
        }
    }

    private getWorkspaceSnippetsPath(): string | null {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                return path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'snippets', 'markdown.json');
            }
            return null;
        } catch (error) {
            console.error('Failed to get workspace snippets path:', error);
            return null;
        }
    }

    private getVSCodeUserDataDir(): string | null {
        const platform = os.platform();
        const homeDir = os.homedir();

        switch (platform) {
            case 'win32':
                return path.join(process.env.APPDATA || '', 'Code');
            case 'darwin':
                return path.join(homeDir, 'Library', 'Application Support', 'Code');
            case 'linux':
                return path.join(homeDir, '.config', 'Code');
            default:
                return null;
        }
    }

    private async loadSnippetsFromFile(filePath: string): Promise<any> {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            // Handle JSON with comments (VS Code snippets support comments)
            const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
            return JSON.parse(jsonContent);
        } catch (error) {
            console.error(`Failed to load snippets from ${filePath}:`, error);
            return {};
        }
    }

    private async loadExtensionSnippets(): Promise<any> {
        // VS Code built-in markdown snippets are not easily accessible from extensions
        // For now, return empty object. Users should define their own snippets.
        return {};
    }

    private processSnippetBody(body: string): string {
        // Process VS Code snippet variables
        const now = new Date();

        return body
            // Date/time variables
            .replace(/\$CURRENT_YEAR/g, now.getFullYear().toString())
            .replace(/\$CURRENT_MONTH/g, (now.getMonth() + 1).toString().padStart(2, '0'))
            .replace(/\$CURRENT_DATE/g, now.getDate().toString().padStart(2, '0'))
            .replace(/\$CURRENT_HOUR/g, now.getHours().toString().padStart(2, '0'))
            .replace(/\$CURRENT_MINUTE/g, now.getMinutes().toString().padStart(2, '0'))
            .replace(/\$CURRENT_SECOND/g, now.getSeconds().toString().padStart(2, '0'))

            // Workspace variables
            .replace(/\$WORKSPACE_NAME/g, vscode.workspace.name || 'workspace')
            .replace(/\$WORKSPACE_FOLDER/g, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '')

            // File variables (using placeholder since we're in webview)
            .replace(/\$TM_FILENAME/g, 'untitled.md')
            .replace(/\$TM_FILENAME_BASE/g, 'untitled')
            .replace(/\$TM_DIRECTORY/g, '')
            .replace(/\$TM_FILEPATH/g, 'untitled.md')

            // Process placeholders: ${1:default} -> default, ${1} -> empty
            .replace(/\$\{(\d+):([^}]*)\}/g, '$2') // ${1:default} -> default
            .replace(/\$\{\d+\}/g, '') // ${1} -> empty
            .replace(/\$\d+/g, '') // $1 -> empty
            .replace(/\$0/g, ''); // Final cursor position -> empty
    }



    private async handleRuntimeTrackingReport(report: any): Promise<void> {

        try {
            // Save runtime report to file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `runtime-tracking-${report.metadata.sessionId}-${timestamp}.json`;
            const reportPath = path.join(__dirname, '..', '..', 'tools', 'reports', filename);

            // Ensure reports directory exists
            const reportsDir = path.dirname(reportPath);
            if (!fs.existsSync(reportsDir)) {
                fs.mkdirSync(reportsDir, { recursive: true });
            }

            // Write report
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));


            // Log summary
            if (report.summary) {
            }

        } catch (error) {
            console.error('[MESSAGE HANDLER] Error saving runtime tracking report:', error);
        }
    }

    private async handleSaveClipboardImage(
        imageData: string,
        imagePath: string,
        mediaFolderPath: string,
        dropPosition: { x: number; y: number },
        imageFileName: string,
        mediaFolderName: string
    ): Promise<void> {
        try {

            // Ensure the media folder exists
            if (!fs.existsSync(mediaFolderPath)) {
                fs.mkdirSync(mediaFolderPath, { recursive: true });
            }

            // Convert base64 to buffer
            const buffer = Buffer.from(imageData, 'base64');

            // Write the image file
            fs.writeFileSync(imagePath, buffer);

            // Notify the webview that the image was saved successfully
            const panel = this._getWebviewPanel();
            if (panel && panel._panel) {
                const message = {
                    type: 'clipboardImageSaved',
                    success: true,
                    imagePath: imagePath,
                    relativePath: `./${mediaFolderName}/${imageFileName}`,
                    dropPosition: dropPosition
                };
                panel._panel.webview.postMessage(message);
            }

        } catch (error) {
            console.error('[MESSAGE HANDLER] Error saving clipboard image:', error);

            // Notify the webview that there was an error
            const panel = this._getWebviewPanel();
            if (panel && panel._panel) {
                panel._panel.webview.postMessage({
                    type: 'clipboardImageSaved',
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    dropPosition: dropPosition
                });
            }
        }
    }

    private async handleSaveClipboardImageWithPath(
        imageData: string,
        imageType: string,
        dropPosition: { x: number; y: number },
        md5Hash?: string
    ): Promise<void> {
        try {
            // Get current file path from the file manager (use preserved path if document is closed)
            const document = this._fileManager.getDocument();
            const currentFilePath = this._fileManager.getFilePath() || document?.uri.fsPath;
            if (!currentFilePath) {
                console.error('[MESSAGE HANDLER] No current file path available');

                // Notify the webview that there was an error
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'clipboardImageSaved',
                        success: false,
                        error: 'No current file path available',
                        dropPosition: dropPosition
                    });
                }
                return;
            }


            // Extract base filename without extension
            const pathParts = currentFilePath.split(/[\/\\]/);
            const fileName = pathParts.pop() || 'kanban';
            const baseFileName = fileName.replace(/\.[^/.]+$/, '');
            const directory = pathParts.join('/'); // Always use forward slash for consistency

            // Generate filename from MD5 hash if available, otherwise use timestamp
            const extension = imageType.split('/')[1] || 'png';
            const imageFileName = md5Hash ? `${md5Hash}.${extension}` : `clipboard-image-${Date.now()}.${extension}`;

            // Create the media folder path
            const mediaFolderName = `${baseFileName}-MEDIA`;
            const mediaFolderPath = `${directory}/${mediaFolderName}`;
            const imagePath = `${mediaFolderPath}/${imageFileName}`;

            // Ensure the media folder exists
            if (!fs.existsSync(mediaFolderPath)) {
                fs.mkdirSync(mediaFolderPath, { recursive: true });
            }

            // Convert base64 to buffer (remove data URL prefix if present)
            const base64Only = imageData.includes(',') ? imageData.split(',')[1] : imageData;
            const buffer = Buffer.from(base64Only, 'base64');

            // Write the image file
            fs.writeFileSync(imagePath, buffer);

            // Notify the webview that the image was saved successfully
            const panel = this._getWebviewPanel();
            if (panel && panel._panel) {
                const message = {
                    type: 'clipboardImageSaved',
                    success: true,
                    imagePath: imagePath,
                    relativePath: `./${mediaFolderName}/${imageFileName}`,
                    dropPosition: dropPosition
                };
                panel._panel.webview.postMessage(message);
            } else {
                console.error('[DEBUG] Cannot send clipboardImageSaved message - no webview panel available');
            }

        } catch (error) {
            console.error('[MESSAGE HANDLER] Error saving clipboard image with path:', error);

            // Notify the webview that there was an error
            const panel = this._getWebviewPanel();
            if (panel && panel._panel) {
                panel._panel.webview.postMessage({
                    type: 'clipboardImageSaved',
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    dropPosition: dropPosition
                });
            }
        }
    }

    /**
     * Helper: Generate SHA256 hash from buffer
     */
    private _generateHash(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 12);
    }

    /**
     * Helper: Format image path according to pathGeneration config
     */
    private _formatImagePath(absolutePath: string, kanbanDir: string): string {
        const pathMode = configService.getPathGenerationMode();
        if (pathMode === 'absolute') {
            return absolutePath;
        }
        const relativePath = path.relative(kanbanDir, absolutePath);
        return `./${relativePath.replace(/\\/g, '/')}`;
    }

    /**
     * Helper: Generate unique filename with hash, handling collisions
     */
    private _generateUniqueImageFilename(
        mediaFolderPath: string,
        originalFileName: string,
        fileBuffer: Buffer
    ): string {
        const extension = path.extname(originalFileName) || '.png';
        const baseName = path.basename(originalFileName, extension);
        const hash = this._generateHash(fileBuffer);

        // Try hash-based filename first
        let candidateFilename = `${baseName}-${hash}${extension}`;
        let candidatePath = path.join(mediaFolderPath, candidateFilename);

        // Check if file exists with same name
        if (fs.existsSync(candidatePath)) {
            const existingBuffer = fs.readFileSync(candidatePath);
            const existingHash = this._generateHash(existingBuffer);

            // Same hash = same file, reuse it
            if (existingHash === hash) {
                console.log('[IMAGE-DROP] File with same hash already exists, reusing:', candidateFilename);
                return candidateFilename;
            }

            // Different hash = collision, add timestamp
            console.log('[IMAGE-DROP] Hash collision detected, adding timestamp');
            const timestamp = Date.now();
            candidateFilename = `${baseName}-${hash}-${timestamp}${extension}`;
        }

        return candidateFilename;
    }

    /**
     * Unified handler for ALL file drops (images and non-images, URI or File object)
     * @param sourcePath File path for URI drops, null for File object drops
     * @param fileData Base64 data for File object drops, null for URI drops
     * @param originalFileName Original filename
     * @param dropPosition Drop position in webview
     * @param isImage Whether this is an image file (affects filename generation and message type)
     */
    private async handleAnyFileDrop(
        sourcePath: string | null,
        fileData: string | null,
        originalFileName: string,
        dropPosition: { x: number; y: number },
        isImage: boolean
    ): Promise<void> {
        try {
            const { directory, baseFileName } = this._getCurrentFilePaths();

            // URI drop with path - check if in workspace
            if (sourcePath && this._isFileInWorkspace(sourcePath)) {
                return this._sendLinkMessage(sourcePath, originalFileName, dropPosition, directory, isImage);
            }

            // File outside workspace or File object - copy to MEDIA
            return this._copyToMediaFolder(sourcePath, fileData, originalFileName, dropPosition, directory, baseFileName, isImage);

        } catch (error) {
            console.error('[FILE-DROP] Error handling file:', error);
            this._sendFileDropError(error instanceof Error ? error.message : 'Unknown error', dropPosition, isImage, fileData !== null);
        }
    }

    /**
     * Send link message for file already in workspace
     */
    private _sendLinkMessage(
        sourcePath: string,
        originalFileName: string,
        dropPosition: { x: number; y: number },
        directory: string,
        isImage: boolean
    ): void {
        const formattedPath = isImage
            ? this._formatImagePath(sourcePath, directory)
            : this._fileManager.generateConfiguredPath(sourcePath);

        console.log(`[FILE-DROP] File in workspace, linking: ${formattedPath}`);

        const panel = this._getWebviewPanel();
        if (panel && panel._panel) {
            if (isImage) {
                panel._panel.webview.postMessage({
                    type: 'droppedImageSaved',
                    success: true,
                    relativePath: formattedPath,
                    originalFileName: originalFileName,
                    dropPosition: dropPosition,
                    wasLinked: true
                });
            } else {
                panel._panel.webview.postMessage({
                    type: 'fileUriDropped',
                    success: true,
                    filePath: formattedPath,
                    originalFileName: originalFileName,
                    dropPosition: dropPosition,
                    wasLinked: true
                });
            }
        }
    }

    /**
     * Copy file to MEDIA folder (from source path or base64 data)
     */
    private async _copyToMediaFolder(
        sourcePath: string | null,
        fileData: string | null,
        originalFileName: string,
        dropPosition: { x: number; y: number },
        directory: string,
        baseFileName: string,
        isImage: boolean
    ): Promise<void> {
        // Verify source exists (for URI drops)
        if (sourcePath && !fs.existsSync(sourcePath)) {
            throw new Error(`Source file not found: ${sourcePath}`);
        }

        if (!sourcePath && !fileData) {
            throw new Error('No source path or file data provided');
        }

        const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);

        // Get buffer (from file or base64)
        let buffer: Buffer;
        if (fileData) {
            const base64Only = isImage && fileData.includes(',') ? fileData.split(',')[1] : fileData;
            buffer = Buffer.from(base64Only, 'base64');
        } else if (sourcePath) {
            buffer = fs.readFileSync(sourcePath);
        } else {
            throw new Error('No source path or file data provided');
        }

        // Generate filename (different strategies for images vs files)
        let targetFileName: string;
        if (isImage) {
            targetFileName = this._generateUniqueImageFilename(mediaFolderPath, originalFileName, buffer);
        } else {
            targetFileName = this._generateUniqueFilename(mediaFolderPath, originalFileName);
        }

        const targetPath = path.join(mediaFolderPath, targetFileName);

        // Write file (images check hash, files overwrite)
        if (isImage && fs.existsSync(targetPath)) {
            console.log('[FILE-DROP] Reusing existing image:', targetFileName);
        } else {
            fs.writeFileSync(targetPath, buffer);
            console.log('[FILE-DROP] Saved file:', targetFileName);
        }

        // Format path
        const formattedPath = isImage
            ? this._formatImagePath(targetPath, directory)
            : this._fileManager.generateConfiguredPath(targetPath);

        // Send success message
        const panel = this._getWebviewPanel();
        if (panel && panel._panel) {
            if (isImage) {
                panel._panel.webview.postMessage({
                    type: 'droppedImageSaved',
                    success: true,
                    relativePath: formattedPath,
                    originalFileName: originalFileName,
                    dropPosition: dropPosition,
                    wasCopied: sourcePath ? true : undefined
                });
            } else {
                const messageType = fileData ? 'fileContentsDropped' : 'fileUriDropped';
                panel._panel.webview.postMessage({
                    type: messageType,
                    success: true,
                    filePath: formattedPath,
                    originalFileName: originalFileName,
                    dropPosition: dropPosition,
                    wasCopied: sourcePath ? true : undefined
                });
            }
        }
    }

    /**
     * Send error message for file drop failures
     */
    private _sendFileDropError(error: string, dropPosition: { x: number; y: number }, isImage: boolean, isFileObject: boolean): void {
        const panel = this._getWebviewPanel();
        if (panel && panel._panel) {
            if (isImage) {
                panel._panel.webview.postMessage({
                    type: 'droppedImageSaved',
                    success: false,
                    error: error,
                    dropPosition: dropPosition
                });
            } else {
                const messageType = isFileObject ? 'fileContentsDropped' : 'fileUriDropped';
                panel._panel.webview.postMessage({
                    type: messageType,
                    success: false,
                    error: error,
                    dropPosition: dropPosition
                });
            }
        }
    }

    // ============================================================================
    // DRY Helper Methods for File Operations
    // ============================================================================

    /**
     * Gets current file path information
     * @returns Object with currentFilePath, directory, fileName, baseFileName
     * @throws Error if no current file path is available
     */
    private _getCurrentFilePaths(): { currentFilePath: string; directory: string; fileName: string; baseFileName: string } {
        const document = this._fileManager.getDocument();
        const currentFilePath = this._fileManager.getFilePath() || document?.uri.fsPath;
        if (!currentFilePath) {
            throw new Error('No current file path available');
        }

        const directory = path.dirname(currentFilePath);
        const fileName = path.basename(currentFilePath);
        const baseFileName = fileName.replace(/\.[^/.]+$/, '');

        return { currentFilePath, directory, fileName, baseFileName };
    }

    /**
     * Gets the MEDIA folder path for the current kanban, creating it if needed
     * @param directory The directory containing the kanban file
     * @param baseFileName The base name of the kanban file (without extension)
     * @returns The absolute path to the MEDIA folder
     */
    private _getMediaFolderPath(directory: string, baseFileName: string): string {
        const mediaFolderName = `${baseFileName}-MEDIA`;
        const mediaFolderPath = path.join(directory, mediaFolderName);

        if (!fs.existsSync(mediaFolderPath)) {
            fs.mkdirSync(mediaFolderPath, { recursive: true });
        }

        return mediaFolderPath;
    }

    /**
     * Checks if a file path is within any workspace folder
     * @param filePath The file path to check
     * @returns true if file is in workspace, false otherwise
     */
    private _isFileInWorkspace(filePath: string): boolean {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return false;
        }

        const fileResolved = path.resolve(filePath);
        for (const folder of workspaceFolders) {
            const workspaceResolved = path.resolve(folder.uri.fsPath);
            if (fileResolved.startsWith(workspaceResolved)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Generates a unique filename in the target directory, handling collisions
     * @param targetDir Directory where file will be saved
     * @param originalFileName Original filename
     * @returns Unique filename (may have counter suffix if collision)
     */
    private _generateUniqueFilename(targetDir: string, originalFileName: string): string {
        const ext = path.extname(originalFileName);
        const baseName = path.basename(originalFileName, ext);
        let targetFileName = originalFileName;
        let counter = 1;

        while (fs.existsSync(path.join(targetDir, targetFileName))) {
            targetFileName = `${baseName}_${counter}${ext}`;
            counter++;
        }

        return targetFileName;
    }

    private async handlePasteImageIntoField(
        imageData: string,
        imageType: string,
        md5Hash: string,
        cursorPosition: number
    ): Promise<void> {
        try {
            // Get current file path
            const document = this._fileManager.getDocument();
            const currentFilePath = this._fileManager.getFilePath() || document?.uri.fsPath;
            if (!currentFilePath) {
                console.error('[MESSAGE HANDLER] No current file path available for paste image');
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'imagePastedIntoField',
                        success: false,
                        error: 'No current file path available',
                        cursorPosition: cursorPosition
                    });
                }
                return;
            }

            // Extract base filename without extension
            const pathParts = currentFilePath.split(/[\/\\]/);
            const fileName = pathParts.pop() || 'kanban';
            const baseFileName = fileName.replace(/\.[^/.]+$/, '');
            const directory = pathParts.join('/');

            // Generate filename from MD5 hash
            const extension = imageType.split('/')[1] || 'png';
            const imageFileName = `${md5Hash}.${extension}`;

            // Create the media folder path
            const mediaFolderName = `${baseFileName}-MEDIA`;
            const mediaFolderPath = `${directory}/${mediaFolderName}`;
            const imagePath = `${mediaFolderPath}/${imageFileName}`;

            // Ensure the media folder exists
            if (!fs.existsSync(mediaFolderPath)) {
                fs.mkdirSync(mediaFolderPath, { recursive: true });
            }

            // Convert base64 to buffer (remove data URL prefix if present)
            const base64Only = imageData.includes(',') ? imageData.split(',')[1] : imageData;
            const buffer = Buffer.from(base64Only, 'base64');

            // Write the image file
            fs.writeFileSync(imagePath, buffer);

            // Notify the webview that the image was saved successfully
            const panel = this._getWebviewPanel();
            if (panel && panel._panel) {
                panel._panel.webview.postMessage({
                    type: 'imagePastedIntoField',
                    success: true,
                    imagePath: imagePath,
                    relativePath: `./${mediaFolderName}/${imageFileName}`,
                    cursorPosition: cursorPosition
                });
            }

        } catch (error) {
            console.error('[MESSAGE HANDLER] Error pasting image into field:', error);

            // Notify the webview that there was an error
            const panel = this._getWebviewPanel();
            if (panel && panel._panel) {
                panel._panel.webview.postMessage({
                    type: 'imagePastedIntoField',
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    cursorPosition: cursorPosition
                });
            }
        }
    }

    private async handleBoardUpdate(message: any): Promise<void> {
        try {
            const board = message.board;
            if (!board) {
                console.error('[boardUpdate] No board data provided');
                return;
            }

            // Log the board received from frontend with ALL task details
            if (board.columns) {
                board.columns.forEach((col: any, colIdx: number) => {
                    if (col.tasks) {
                        col.tasks.forEach((task: any, taskIdx: number) => {
                        });
                    }
                });
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
                        if (oldFile) {
                        }

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

    private async handleConfirmDisableIncludeMode(message: any): Promise<void> {
        try {
            const confirmation = await vscode.window.showWarningMessage(
                message.message,
                { modal: true },
                'Disable Include Mode',
                'Cancel'
            );

            if (confirmation === 'Disable Include Mode') {
                // User confirmed - send message back to webview to proceed
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'proceedDisableIncludeMode',
                        columnId: message.columnId
                    });
                }
            }
            // If cancelled, do nothing

        } catch (error) {
            console.error('[confirmDisableIncludeMode] Error handling confirmation:', error);
        }
    }

    private async handleRequestIncludeFile(filePath: string): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel || !panel._panel) {
                console.error('[MESSAGE HANDLER] No webview panel available');
                return;
            }

            // Resolve the file path relative to the current document
            const document = this._fileManager.getDocument();
            if (!document) {
                console.error('[MESSAGE HANDLER] No current document available');
                return;
            }

            const basePath = path.dirname(document.uri.fsPath);
            const absolutePath = PathResolver.resolve(basePath, filePath);


            // Read the file content
            let content: string;
            try {
                if (!fs.existsSync(absolutePath)) {
                    console.warn('[MESSAGE HANDLER] Include file not found:', absolutePath);
                    // Send null content to indicate file not found
                    await panel._panel.webview.postMessage({
                        type: 'includeFileContent',
                        filePath: filePath,
                        content: null,
                        error: `File not found: ${filePath}`
                    });
                    return;
                }

                content = fs.readFileSync(absolutePath, 'utf8');

                // Send the content back to the frontend
                await panel._panel.webview.postMessage({
                    type: 'includeFileContent',
                    filePath: filePath,
                    content: content
                });

            } catch (fileError) {
                console.error('[MESSAGE HANDLER] Error reading include file:', fileError);
                await panel._panel.webview.postMessage({
                    type: 'includeFileContent',
                    filePath: filePath,
                    content: null,
                    error: `Error reading file: ${filePath}`
                });
            }
        } catch (error) {
            console.error('[MESSAGE HANDLER] Error handling include file request:', error);
        }
    }

    private async handleRegisterInlineInclude(filePath: string, content: string): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel || !panel.ensureIncludeFileRegistered) {
                return;
            }

            // Normalize path format
            let relativePath = filePath;
            if (!path.isAbsolute(relativePath) && !relativePath.startsWith('.')) {
                relativePath = './' + relativePath;
            }

            // Register the inline include in the unified system
            panel.ensureIncludeFileRegistered(relativePath, 'regular');

            // Update the content and baseline
            const includeFile = panel._includeFiles?.get(relativePath);
            if (includeFile && content) {
                includeFile.content = content;
                includeFile.baseline = content;
                includeFile.hasUnsavedChanges = false;
                includeFile.lastModified = Date.now();

                // Set absolute path for file watching
                const currentDocument = this._fileManager.getDocument();
                if (currentDocument) {
                    const basePath = path.dirname(currentDocument.uri.fsPath);
                    includeFile.absolutePath = PathResolver.resolve(basePath, filePath);
                }
            }

        } catch (error) {
            console.error('[MESSAGE HANDLER] Error registering inline include:', error);
        }
    }

    private async handleRequestIncludeFileName(message: any): Promise<void> {
        try {
            // Use file picker dialog for better UX
            // Use getFilePath() which persists even when document is closed
            const currentFilePath = this._fileManager.getFilePath();
            if (!currentFilePath) {
                vscode.window.showErrorMessage('No active kanban file');
                return;
            }

            const currentDir = path.dirname(currentFilePath);

            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: vscode.Uri.file(currentDir),
                filters: {
                    'Markdown files': ['md']
                },
                title: 'Select include file for column'
            });

            if (fileUris && fileUris.length > 0) {
                // Convert absolute path to relative path
                const absolutePath = fileUris[0].fsPath;
                const relativePath = path.relative(currentDir, absolutePath);

                // User selected a file - send message back to webview to proceed
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'proceedEnableIncludeMode',
                        columnId: message.columnId,
                        fileName: relativePath
                    });
                }
            }
            // If cancelled, do nothing

        } catch (error) {
            console.error('[requestIncludeFileName] Error handling file picker:', error);
        }
    }

    private async handleRequestEditIncludeFileName(message: any): Promise<void> {
        try {
            const currentFile = message.currentFile || '';

            // CRITICAL: Check if current include file has unsaved changes before switching
            const panel = this._getWebviewPanel();
            const file = panel?.fileRegistry?.getByRelativePath(currentFile);

            if (file && file.hasUnsavedChanges()) {
                // Current include file has unsaved changes - ask user what to do
                const choice = await vscode.window.showWarningMessage(
                    `The current include file "${currentFile}" has unsaved changes. What would you like to do?`,
                    { modal: true },
                    'Save and Switch',
                    'Discard and Switch',
                    'Cancel'
                );

                if (choice === 'Save and Switch') {
                    // Save the current include file
                    await file.save();
                } else if (choice === 'Discard and Switch') {
                    // Discard changes
                    file.discardChanges();
                } else {
                    // User cancelled - don't proceed with switching
                    return;
                }
            }

            // Now show the file picker dialog

            const currentFilePath = this._fileManager.getFilePath();
            if (!currentFilePath) {
                vscode.window.showErrorMessage('No active kanban file');
                return;
            }

            const currentDir = path.dirname(currentFilePath);

            // Set default URI to current file if it exists
            let defaultUri = vscode.Uri.file(currentDir);
            if (currentFile) {
                const currentAbsolutePath = path.resolve(currentDir, currentFile);
                if (fs.existsSync(currentAbsolutePath)) {
                    defaultUri = vscode.Uri.file(currentAbsolutePath);
                }
            }

            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: defaultUri,
                filters: {
                    'Markdown files': ['md']
                },
                title: 'Select new include file for column'
            });

            if (fileUris && fileUris.length > 0) {
                // Convert absolute path to relative path
                const absolutePath = fileUris[0].fsPath;
                const relativePath = path.relative(currentDir, absolutePath);

                // User selected a file - send message back to webview to proceed
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'proceedUpdateIncludeFile',
                        columnId: message.columnId,
                        newFileName: relativePath,
                        currentFile: currentFile
                    });
                } else {
                    console.error('[requestEditIncludeFileName] No panel or panel._panel available!');
                }
            } else {
            }
            // If cancelled, do nothing

        } catch (error) {
            console.error('[requestEditIncludeFileName] Error handling input request:', error);
        }
    }

    /**
     * Handle request to edit/change task include filename
     */
    private async handleRequestEditTaskIncludeFileName(message: any): Promise<void> {
        try {
            const currentFile = message.currentFile || '';
            const taskId = message.taskId;
            const columnId = message.columnId;

            // CRITICAL: Check if current include file has unsaved changes before switching
            const panel = this._getWebviewPanel();
            const file = panel?.fileRegistry?.getByRelativePath(currentFile);

            if (file && file.hasUnsavedChanges()) {
                // Current include file has unsaved changes - ask user what to do
                const choice = await vscode.window.showWarningMessage(
                    `The current task include file "${currentFile}" has unsaved changes. What would you like to do?`,
                    { modal: true },
                    'Save and Switch',
                    'Discard and Switch',
                    'Cancel'
                );

                if (choice === 'Save and Switch') {
                    // Save the current include file
                    await file.save();
                } else if (choice === 'Discard and Switch') {
                    // Discard changes
                    file.discardChanges();
                } else {
                    // User cancelled - don't proceed with switching
                    return;
                }
            }

            // Now show the file picker dialog
            const currentFilePath = this._fileManager.getFilePath();
            if (!currentFilePath) {
                vscode.window.showErrorMessage('No active kanban file');
                return;
            }

            const currentDir = path.dirname(currentFilePath);

            // Set default URI to current file if it exists
            let defaultUri = vscode.Uri.file(currentDir);
            if (currentFile) {
                const currentAbsolutePath = path.resolve(currentDir, currentFile);
                if (fs.existsSync(currentAbsolutePath)) {
                    defaultUri = vscode.Uri.file(currentAbsolutePath);
                }
            }

            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: defaultUri,
                filters: {
                    'Markdown files': ['md']
                },
                title: 'Select new include file for task'
            });

            if (fileUris && fileUris.length > 0) {
                // Convert absolute path to relative path
                const absolutePath = fileUris[0].fsPath;
                const relativePath = path.relative(currentDir, absolutePath);

                // User selected a file - send message back to webview to proceed
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'proceedUpdateTaskIncludeFile',
                        taskId: taskId,
                        columnId: columnId,
                        newFileName: relativePath,
                        currentFile: currentFile
                    });
                }
            }
            // If cancelled, do nothing

        } catch (error) {
            console.error('[requestEditTaskIncludeFileName] Error handling input request:', error);
        }
    }

    // REMOVED: Legacy handleSwitchTaskIncludeFile method - replaced by state machine
    // All include switches now route through ChangeStateMachine via editTaskTitle message

    /**
     * Handle request for task include filename (enabling include mode)
     */
    private async handleRequestTaskIncludeFileName(taskId: string, columnId: string): Promise<void> {
        try {
            // Use file picker dialog for better UX
            const currentFilePath = this._fileManager.getFilePath();
            if (!currentFilePath) {
                vscode.window.showErrorMessage('No active kanban file');
                return;
            }

            const currentDir = path.dirname(currentFilePath);

            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: vscode.Uri.file(currentDir),
                filters: {
                    'Markdown files': ['md']
                },
                title: 'Select include file for task'
            });

            if (fileUris && fileUris.length > 0) {
                // Convert absolute path to relative path
                const absolutePath = fileUris[0].fsPath;
                const relativePath = path.relative(currentDir, absolutePath);

                // User selected a file - enable task include mode
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'enableTaskIncludeMode',
                        taskId: taskId,
                        columnId: columnId,
                        fileName: relativePath
                    });
                }
            }
            // If cancelled, do nothing

        } catch (error) {
            console.error('[requestTaskIncludeFileName] Error handling file picker:', error);
        }
    }

    private async handleGetExportDefaultFolder(): Promise<void> {
        try {
            let document = this._fileManager.getDocument();

            // If document not available from FileManager, try to get the file path and open it
            if (!document) {
                const filePath = this._fileManager.getFilePath();

                if (filePath) {
                    // Open the document using the file path
                    try {
                        document = await vscode.workspace.openTextDocument(filePath);
                    } catch (error) {
                        console.error('[kanban.messageHandler.getExportDefaultFolder] Failed to open document from file path:', error);
                    }
                }

                // If still no document, try active editor as last resort
                if (!document) {
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor && activeEditor.document.fileName.endsWith('.md')) {
                        document = activeEditor.document;
                    }
                }
            }

            if (!document) {
                console.error('[kanban.messageHandler.getExportDefaultFolder] No document available for export');
                return;
            }

            const defaultFolder = ExportService.generateDefaultExportFolder(document.uri.fsPath);
            const panel = this._getWebviewPanel();
            if (panel && panel._panel) {
                panel._panel.webview.postMessage({
                    type: 'exportDefaultFolder',
                    folderPath: defaultFolder
                });
            }
        } catch (error) {
            console.error('[kanban.messageHandler.getExportDefaultFolder] Error:', error);
        }
    }

    private async handleSelectExportFolder(defaultPath?: string): Promise<void> {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Export Folder',
                defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined
            });

            if (result && result[0]) {
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'exportFolderSelected',
                        folderPath: result[0].fsPath
                    });
                }
            }
        } catch (error) {
            console.error('Error selecting export folder:', error);
        }
    }

    private async handleAskOpenExportFolder(exportPath: string): Promise<void> {
        try {
            const folderPath = path.dirname(exportPath);
            const result = await vscode.window.showInformationMessage(
                'Export completed successfully!',
                'Open Export Folder',
                'Dismiss'
            );

            if (result === 'Open Export Folder') {
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), true);
            }
        } catch (error) {
            console.error('Error handling export folder open request:', error);
        }
    }

    /**
     * Handle request for tracked files debug information
     */
    private async handleGetTrackedFilesDebugInfo(): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }

            // Collect debug information from various sources
            const debugData = await this.collectTrackedFilesDebugInfo();

            // Send debug data to frontend
            panel._panel.webview.postMessage({
                type: 'trackedFilesDebugInfo',
                data: debugData
            });

        } catch (error) {
            console.error('[MessageHandler] Error getting tracked files debug info:', error);
        }
    }

    /**
     * Handle request to clear tracked files cache
     */
    private async handleClearTrackedFilesCache(): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }

            // Clear various caches
            await this.clearAllTrackedFileCaches();

            // Confirm cache clear
            panel._panel.webview.postMessage({
                type: 'debugCacheCleared'
            });


        } catch (error) {
            console.error('[MessageHandler] Error clearing tracked files cache:', error);
        }
    }

    /**
     * Handle request to reload all included files (images, videos, includes)
     */
    private async handleReloadAllIncludedFiles(): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }

            let reloadCount = 0;

            // Reload all include files by refreshing their content from disk
            const includeFileMap = (panel as any)._includeFiles;
            if (includeFileMap) {
                for (const [relativePath, fileData] of includeFileMap) {
                    try {
                        // Read fresh content from disk
                        const freshContent = await (panel as any)._readFileContent(relativePath);
                        if (freshContent !== null) {
                            // Update content and reset baseline to fresh content
                            (panel as any).updateIncludeFileContent(relativePath, freshContent, true);
                            reloadCount++;
                        }
                    } catch (error) {
                        console.warn(`[MessageHandler] Failed to reload include file ${relativePath}:`, error);
                    }
                }
            }

            // Trigger a full webview refresh to reload all media and includes
            const document = this._fileManager.getDocument();
            if (document) {
                await panel.loadMarkdownFile(document);
            }

            // Send confirmation message
            panel._panel.webview.postMessage({
                type: 'allIncludedFilesReloaded',
                reloadCount: reloadCount
            });


        } catch (error) {
            console.error('[MessageHandler] Error reloading all included files:', error);
        }
    }

    /**
     * Handle request to save an individual file
     */
    private async handleSaveIndividualFile(filePath: string, isMainFile: boolean, forceSave: boolean = false): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }


            if (isMainFile) {
                // Save ONLY the main kanban file (not includes)
                // Get the file service and board
                const fileService = (panel as any)._fileService;
                const board = fileService?.board();

                if (!board || !board.valid) {
                    throw new Error('Invalid board state');
                }

                // Generate markdown from current board
                const MarkdownKanbanParser = require('./markdownParser').MarkdownKanbanParser;
                const markdown = MarkdownKanbanParser.generateMarkdown(board);

                // Get main file from registry and save it directly
                const fileRegistry = (panel as any)._fileRegistry;
                const mainFile = fileRegistry?.getMainFile();
                if (!mainFile) {
                    throw new Error('Main file not found in registry');
                }

                // Use save coordinator to save only the main file
                const saveCoordinator = (fileService as any)._saveCoordinator;
                await saveCoordinator.saveFile(mainFile, markdown);

                // Update main file state after save
                // CRITICAL: Pass updateBaseline=true since we just saved to disk
                mainFile.updateFromBoard(board, true, true);
                // NOTE: No need for second setContent call - updateFromBoard already updated baseline


                // Trigger marpWatch export if active
                if (this._autoExportSettings?.marpWatch) {
                    // Get document from fileManager, or reopen from file path if needed
                    let document = this._fileManager.getDocument();
                    const filePathForReopen = this._fileManager.getFilePath();

                    // If document is closed but we have a file path, reopen it
                    if (!document && filePathForReopen) {
                        const vscode = require('vscode');
                        try {
                            document = await vscode.workspace.openTextDocument(filePathForReopen);
                        } catch (error) {
                            console.error(`[MessageHandler.saveIndividualFile] Failed to reopen document:`, error);
                        }
                    }

                    if (document) {
                        const ExportService = require('./exportService').ExportService;
                        try {
                            await ExportService.export(document, this._autoExportSettings, board);
                        } catch (error) {
                            console.error('[MessageHandler.saveIndividualFile] MarpWatch export failed:', error);
                        }
                    }
                }

                panel._panel.webview.postMessage({
                    type: 'individualFileSaved',
                    filePath: filePath,
                    isMainFile: true,
                    success: true,
                    forceSave: forceSave
                });
            } else {
                // For include files, get the file from the registry
                const fileRegistry = (panel as any)._fileRegistry;
                if (!fileRegistry) {
                    throw new Error('File registry not available');
                }

                const file = fileRegistry.get(filePath);
                if (!file) {
                    throw new Error(`File not found in registry: ${filePath}`);
                }

                // Save the file (force save always writes to disk)
                await file.save({
                    skipReloadDetection: true,
                    source: 'ui-edit',
                    skipValidation: false
                });


                // Trigger marpWatch export if active (include file change requires re-export)
                if (this._autoExportSettings?.marpWatch) {
                    // Get document from fileManager, or reopen from file path if needed
                    let document = this._fileManager.getDocument();
                    const filePathForReopen = this._fileManager.getFilePath();

                    // If document is closed but we have a file path, reopen it
                    if (!document && filePathForReopen) {
                        const vscode = require('vscode');
                        try {
                            document = await vscode.workspace.openTextDocument(filePathForReopen);
                        } catch (error) {
                            console.error(`[MessageHandler.saveIndividualFile] Failed to reopen document:`, error);
                        }
                    }

                    if (document) {
                        const ExportService = require('./exportService').ExportService;
                        // Get current board state for export
                        const fileService = (panel as any)._fileService;
                        const board = fileService?.board();

                        try {
                            await ExportService.export(document, this._autoExportSettings, board);
                        } catch (error) {
                            console.error('[MessageHandler.saveIndividualFile] MarpWatch export failed:', error);
                        }
                    }
                }

                // Send success message to frontend
                panel._panel.webview.postMessage({
                    type: 'individualFileSaved',
                    filePath: filePath,
                    isMainFile: false,
                    success: true,
                    forceSave: forceSave
                });

                // Send updated debug info immediately after save
                await this.handleGetTrackedFilesDebugInfo();
            }

        } catch (error) {
            console.error(`[MessageHandler] Error saving individual file ${filePath}:`, error);

            const panel = this._getWebviewPanel();
            if (panel) {
                panel._panel.webview.postMessage({
                    type: 'individualFileSaved',
                    filePath: filePath,
                    isMainFile: isMainFile,
                    success: false,
                    forceSave: forceSave,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Handle request to reload an individual file from saved state
     */
    private async handleReloadIndividualFile(filePath: string, isMainFile: boolean): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }


            if (isMainFile) {
                // Reload ONLY the main kanban file (not includes)
                // Get the file registry and main file
                const fileRegistry = (panel as any)._fileRegistry;
                const mainFile = fileRegistry?.getMainFile();
                if (!mainFile) {
                    throw new Error('Main file not found in registry');
                }

                // Force reload the file from disk (bypass mtime check AND open document)
                const fs = require('fs').promises;
                const freshContent = await fs.readFile(filePath, 'utf-8');
                mainFile.setContent(freshContent, true); // true = update baseline

                // Re-parse the board from the fresh content
                (mainFile as any).parseToBoard();

                // Get the fresh board and send it to frontend
                const fileService = (panel as any)._fileService;
                const freshBoard = mainFile.getBoard();
                if (freshBoard && freshBoard.valid) {
                    // Force update the file service board
                    fileService.setBoard(freshBoard);

                    // Send the fresh board to frontend
                    await fileService.sendBoardUpdate(false, false); // don't preserve selection, don't force reload
                } else {
                    console.warn(`[MessageHandler] Board invalid after parsing reloaded content`);
                }


                panel._panel.webview.postMessage({
                    type: 'individualFileReloaded',
                    filePath: filePath,
                    isMainFile: true,
                    success: true
                });

                // Debug info will be updated automatically by verification trigger
            } else {
                // For include files, get the file from the registry
                const fileRegistry = (panel as any)._fileRegistry;
                if (!fileRegistry) {
                    throw new Error('File registry not available');
                }

                // Convert relative path to absolute if needed
                const absolutePath = filePath.startsWith('/')
                    ? filePath
                    : require('path').join(this._fileManager.getDocument()!.uri.fsPath.replace(/[^\/]+$/, ''), filePath);

                const file = fileRegistry.get(absolutePath);
                if (!file) {
                    throw new Error(`File not found in registry: ${absolutePath}`);
                }

                // Force reload the file from disk (bypass mtime check)
                const fs = require('fs').promises;
                const freshContent = await fs.readFile(absolutePath, 'utf-8');
                file.setContent(freshContent, true); // true = update baseline

                // Trigger board regeneration from main file (which includes this include file)
                const fileService = (panel as any)._fileService;
                const mainFile = fileRegistry.getMainFile();
                if (mainFile) {
                    // Re-parse main file which will pick up the fresh include content
                    (mainFile as any).parseToBoard();
                    const freshBoard = mainFile.getBoard();
                    if (freshBoard && freshBoard.valid) {
                        fileService.setBoard(freshBoard);
                        await fileService.sendBoardUpdate(false, false);
                    }
                }


                // Send success message to frontend
                panel._panel.webview.postMessage({
                    type: 'individualFileReloaded',
                    filePath: filePath,
                    isMainFile: false,
                    success: true
                });

                // Debug info will be updated automatically by verification trigger
            }

        } catch (error) {
            console.error(`[MessageHandler] Error reloading individual file ${filePath}:`, error);

            const panel = this._getWebviewPanel();
            if (panel) {
                panel._panel.webview.postMessage({
                    type: 'individualFileReloaded',
                    filePath: filePath,
                    isMainFile: isMainFile,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Handle force write all content - EMERGENCY RECOVERY FUNCTION
     * Writes ALL files unconditionally, bypassing change detection
     * Use ONLY when sync is broken and normal save doesn't work
     */
    private async handleForceWriteAllContent(): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }

            console.warn('[MessageHandler] FORCE WRITE ALL: Starting emergency file write operation');

            // Create backup BEFORE force write
            const backupPath = await this._createBackupBeforeForceWrite();

            // Get the file registry
            const fileRegistry = (panel as any)._fileRegistry;

            if (!fileRegistry || !fileRegistry.forceWriteAll) {
                throw new Error('File registry not available or forceWriteAll method not found');
            }

            // Force write ALL files
            const result = await fileRegistry.forceWriteAll();


            // Send success response to frontend
            panel._panel.webview.postMessage({
                type: 'forceWriteAllResult',
                success: result.errors.length === 0,
                filesWritten: result.filesWritten,
                errors: result.errors,
                backupCreated: !!backupPath,
                backupPath: backupPath,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[MessageHandler] Error during force write all:', error);

            const panel = this._getWebviewPanel();
            if (panel) {
                panel._panel.webview.postMessage({
                    type: 'forceWriteAllResult',
                    success: false,
                    filesWritten: 0,
                    errors: [error instanceof Error ? error.message : String(error)],
                    backupCreated: false,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    /**
     * Create backup before force write operation
     */
    private async _createBackupBeforeForceWrite(): Promise<string | undefined> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return undefined;
            }

            const document = this._fileManager.getDocument();
            if (!document) {
                return undefined;
            }

            // Use existing backup mechanism with "force-write" label
            const backupPath = await (panel as any)._conflictService.createUnifiedBackup(
                document.uri.fsPath,
                'force-write',
                true  // forceCreate
            );

            return backupPath;

        } catch (error) {
            console.error('[MessageHandler] Failed to create backup before force write:', error);
            return undefined;
        }
    }

    /**
     * Handle content sync verification
     * Compares actual frontend board data to backend file content
     */
    private async handleVerifyContentSync(frontendBoard?: any): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }


            if (!frontendBoard) {
                throw new Error('Frontend board data not provided');
            }

            // Get backend state
            const fileRegistry = (panel as any)._fileRegistry;
            if (!fileRegistry) {
                throw new Error('File registry not available');
            }

            // Import the parser to regenerate markdown from frontend board
            const { MarkdownKanbanParser } = require('./markdownParser');

            const allFiles = fileRegistry.getAll();
            const fileResults: any[] = [];
            let matchingFiles = 0;
            let mismatchedFiles = 0;

            // Get backend board for comparison (ensures we compare generated-to-generated)
            const backendBoard = panel.getBoard ? panel.getBoard() : undefined;

            // Compare each file
            for (const file of allFiles) {
                let backendContent: string;
                let frontendContent: string;
                let savedFileContent: string | null = null;

                // Read the actual saved file from disk
                try {
                    const fs = require('fs');
                    savedFileContent = fs.readFileSync(file.getPath(), 'utf8');
                } catch (error) {
                    console.error(`[MessageHandler] Could not read saved file ${file.getPath()}:`, error);
                }

                // DEBUG: Log file details
                if (savedFileContent !== null) {
                }

                // For main file, regenerate markdown from BOTH boards to ensure like-for-like comparison
                // This avoids false mismatches from raw file vs generated markdown formatting differences
                if (file.getFileType() === 'main') {
                    frontendContent = MarkdownKanbanParser.generateMarkdown(frontendBoard);
                    // Generate backend content from backend board (not raw file content)
                    // This ensures we compare board state, not formatting artifacts
                    backendContent = backendBoard
                        ? MarkdownKanbanParser.generateMarkdown(backendBoard)
                        : file.getContent(); // Fallback to raw if no board available

                    // DEBUG: Log regenerated content details

                    // If there's a difference, show where they diverge
                    if (frontendContent !== backendContent) {
                        const minLen = Math.min(frontendContent.length, backendContent.length);
                        let firstDiff = -1;
                        for (let i = 0; i < minLen; i++) {
                            if (frontendContent[i] !== backendContent[i]) {
                                firstDiff = i;
                                break;
                            }
                        }
                        if (firstDiff >= 0) {
                            const start = Math.max(0, firstDiff - 20);
                            const end = Math.min(minLen, firstDiff + 80);
                            console.log(`[VerifySync] MISMATCH at char ${firstDiff}:`);
                            console.log(`  Frontend[${start}:${end}]: "${frontendContent.substring(start, end).replace(/\n/g, '\\n')}"`);
                            console.log(`  Backend [${start}:${end}]: "${backendContent.substring(start, end).replace(/\n/g, '\\n')}"`);
                        } else if (frontendContent.length !== backendContent.length) {
                            console.log(`[VerifySync] LENGTH MISMATCH: frontend=${frontendContent.length}, backend=${backendContent.length}`);
                            // Show the extra content at the end
                            const longer = frontendContent.length > backendContent.length ? frontendContent : backendContent;
                            const shorter = frontendContent.length > backendContent.length ? backendContent : frontendContent;
                            const which = frontendContent.length > backendContent.length ? 'Frontend' : 'Backend';
                            console.log(`  ${which} has extra: "${longer.substring(shorter.length).replace(/\n/g, '\\n')}"`);
                        }
                    }
                } else {
                    // For include files, use raw file content for both
                    // (Frontend doesn't track include file content separately)
                    backendContent = file.getContent();
                    frontendContent = backendContent;
                }

                const backendHash = this._computeHash(backendContent);
                const frontendHash = this._computeHash(frontendContent);
                const savedHash = savedFileContent !== null ? this._computeHash(savedFileContent) : null;

                // DEBUG: Log hash calculation
                if (savedHash) {
                }
                if (savedHash) {
                }

                const frontendBackendMatch = backendHash === frontendHash;
                const backendSavedMatch = savedHash ? backendHash === savedHash : true;
                const frontendSavedMatch = savedHash ? frontendHash === savedHash : true;
                const allMatch = frontendBackendMatch && backendSavedMatch;

                if (allMatch) {
                    matchingFiles++;
                } else {
                    mismatchedFiles++;
                }

                fileResults.push({
                    path: file.getPath(),
                    relativePath: file.getRelativePath(),
                    isMainFile: file.getFileType() === 'main',
                    matches: allMatch,
                    frontendBackendMatch,
                    backendSavedMatch,
                    frontendSavedMatch,
                    frontendContentLength: frontendContent.length,
                    backendContentLength: backendContent.length,
                    savedContentLength: savedFileContent?.length ?? null,
                    frontendBackendDiff: Math.abs(frontendContent.length - backendContent.length),
                    backendSavedDiff: savedFileContent ? Math.abs(backendContent.length - savedFileContent.length) : null,
                    frontendSavedDiff: savedFileContent ? Math.abs(frontendContent.length - savedFileContent.length) : null,
                    frontendHash: frontendHash.substring(0, 8),
                    backendHash: backendHash.substring(0, 8),
                    savedHash: savedHash?.substring(0, 8) ?? null
                });
            }

            // Send results to frontend
            panel._panel.webview.postMessage({
                type: 'verifyContentSyncResult',
                success: true,
                timestamp: new Date().toISOString(),
                totalFiles: allFiles.length,
                matchingFiles: matchingFiles,
                mismatchedFiles: mismatchedFiles,
                missingFiles: 0,
                fileResults: fileResults,
                summary: `${matchingFiles} files match, ${mismatchedFiles} differ`
            });


        } catch (error) {
            console.error('[MessageHandler] Error during content verification:', error);

            const panel = this._getWebviewPanel();
            if (panel) {
                panel._panel.webview.postMessage({
                    type: 'verifyContentSyncResult',
                    success: false,
                    timestamp: new Date().toISOString(),
                    totalFiles: 0,
                    matchingFiles: 0,
                    mismatchedFiles: 0,
                    missingFiles: 0,
                    fileResults: [],
                    summary: `Verification failed: ${error instanceof Error ? error.message : String(error)}`
                });
            }
        }
    }

    /**
     * Compute simple hash for content comparison
     */
    private _computeHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(16);
    }

    /**
     * Collect comprehensive debug information about tracked files
     */
    /**
     * Get unified file state data that all systems should use for consistency
     * THIS METHOD MUST BE USED BY ALL SYSTEMS - FILE STATE WINDOW, POPUPS, CONFLICT RESOLUTION
     */
    public getUnifiedFileState(): {
        hasInternalChanges: boolean;
        hasExternalChanges: boolean;
        isUnsavedInEditor: boolean;
        documentVersion: number;
        lastDocumentVersion: number;
    } {
        const document = this._fileManager.getDocument();
        if (!document) {
            return {
                hasInternalChanges: false,
                hasExternalChanges: false,
                isUnsavedInEditor: false,
                documentVersion: 0,
                lastDocumentVersion: -1
            };
        }

        const panel = this._getWebviewPanel();
        const mainFile = panel?.fileRegistry?.getMainFile();

        if (!mainFile) {
            // Fallback if file not yet initialized
            const documentVersion = document.version;
            const lastDocumentVersion = panel ? (panel as any)._lastDocumentVersion || -1 : -1;

            return {
                hasInternalChanges: panel ? (panel as any)._hasUnsavedChanges || false : false,
                hasExternalChanges: panel ? (panel as any)._hasExternalUnsavedChanges || false : false,
                isUnsavedInEditor: document.isDirty,
                documentVersion,
                lastDocumentVersion
            };
        }

        return {
            hasInternalChanges: mainFile.hasUnsavedChanges(),
            hasExternalChanges: mainFile.hasExternalChanges(),
            isUnsavedInEditor: document.isDirty,
            documentVersion: document.version,
            lastDocumentVersion: document.version - 1 // Approximation
        };
    }

    private async collectTrackedFilesDebugInfo(): Promise<any> {
        const document = this._fileManager.getDocument();
        const panel = this._getWebviewPanel();
        const mainFile = panel?.fileRegistry?.getMainFile();

        // Get unified file state that all systems should use
        const fileState = this.getUnifiedFileState();


        // Use preserved file path from FileManager, which persists even when document is closed
        const mainFilePath = this._fileManager.getFilePath() || document?.uri.fsPath || 'Unknown';

        const mainFileInfo = {
            path: mainFilePath,
            lastModified: mainFile?.getLastModified()?.toISOString() || 'Unknown',
            exists: mainFile?.exists() ?? (document ? true : false),
            watcherActive: true, // Assume active for now
            hasInternalChanges: fileState.hasInternalChanges,
            hasExternalChanges: fileState.hasExternalChanges,
            documentVersion: fileState.documentVersion,
            lastDocumentVersion: fileState.lastDocumentVersion,
            isUnsavedInEditor: fileState.isUnsavedInEditor,
            baseline: mainFile?.getBaseline() || ''
        };


        // External file watchers
        // Include files from file registry
        const includeFiles: any[] = [];
        const allIncludeFiles = panel?.fileRegistry?.getIncludeFiles() || [];

        for (const file of allIncludeFiles) {
            includeFiles.push({
                path: file.getRelativePath(),
                type: file.getFileType(),
                exists: file.exists(),
                lastModified: file.getLastModified()?.toISOString() || 'Unknown',
                size: 'Unknown', // Size not tracked yet
                hasInternalChanges: file.hasUnsavedChanges(),
                hasExternalChanges: file.hasExternalChanges(),
                isUnsavedInEditor: file.isDirtyInEditor(),
                baseline: file.getBaseline(),
                content: file.getContent(),
                externalContent: '', // Not tracked separately
                contentLength: file.getContent().length,
                baselineLength: file.getBaseline().length,
                externalContentLength: 0
            });
        }

        // Conflict management status
        const conflictManager = {
            healthy: true,
            trackedFiles: 1 + includeFiles.length,
            activeWatchers: 1 + includeFiles.length, // Each file has its own watcher
            pendingConflicts: 0,
            watcherFailures: 0,
            listenerEnabled: true,
            documentSaveListenerActive: true
        };

        // System health
        const systemHealth = {
            overall: includeFiles.length > 0 ? 'good' : 'warn',
            extensionState: 'active',
            memoryUsage: 'normal',
            lastError: null
        };

        return {
            mainFile: mainFileInfo.path,
            mainFileLastModified: mainFileInfo.lastModified,
            fileWatcherActive: mainFileInfo.watcherActive,
            includeFiles: includeFiles,
            conflictManager: conflictManager,
            systemHealth: systemHealth,
            hasUnsavedChanges: this._getWebviewPanel() ? (this._getWebviewPanel() as any)._hasUnsavedChanges || false : false,
            timestamp: new Date().toISOString(),
            watcherDetails: mainFileInfo
        };
    }

    /**
     * Clear all tracked file caches
     */
    private async clearAllTrackedFileCaches(): Promise<void> {
        const panel = this._getWebviewPanel();

        if (panel) {
            // Clear include file caches
            try {
                const includeFileMap = (panel as any)._includeFiles;
                if (includeFileMap) {
                    includeFileMap.clear();
                }

                // Clear cached board state if needed
                (panel as any)._cachedBoardFromWebview = null;

                // Trigger a fresh load
                const document = this._fileManager.getDocument();
                if (document) {
                    await panel.loadMarkdownFile(document, false);
                }
            } catch (error) {
                console.warn('[Debug] Error clearing panel caches:', error);
            }
        }
    }

    /**
     * Handle updating task content after strikethrough deletion
     */
    private async handleUpdateTaskFromStrikethroughDeletion(message: any): Promise<void> {
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

            await this.performBoardAction(() =>
                this._boardOperations.editTask(board, taskId, columnId, updateData)
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
    private async handleEditColumnTitleUnified(columnId: string, newTitle: string): Promise<void> {
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
                    const filePath = match.replace(/!!!include\(([^)]+)\)!!!/, '$1').trim();
                    newIncludeFiles.push(filePath);
                });
            }

            // Get old include files for cleanup
            const oldIncludeFiles = column.includeFiles || [];
            log(`[editColumnTitle] Column ${columnId} current includeFiles:`, oldIncludeFiles);
            log(`[editColumnTitle] New include files from title:`, newIncludeFiles);
            log(`[editColumnTitle] Column title in board:`, column.title);

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
                await panel.handleIncludeSwitch({
                    columnId: columnId,
                    oldFiles: oldIncludeFiles,
                    newFiles: newIncludeFiles,
                    newTitle: newTitle
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
     * Handle Marp export
     */
    /**
     * Handle get Marp themes request
     */
    private async handleGetMarpThemes(): Promise<void> {
        try {
            const themes = await MarpExportService.getAvailableThemes();
            
            const panel = this._getWebviewPanel();
            
            if (panel && panel._panel && panel._panel.webview) {
                const message = {
                    type: 'marpThemesAvailable',
                    themes: themes
                };
                
                panel._panel.webview.postMessage(message);
            } else {
                console.error('[kanban.messageHandler.handleGetMarpThemes] No webview panel available');
                console.error('[kanban.messageHandler.handleGetMarpThemes] Panel exists:', !!panel);
                console.error('[kanban.messageHandler.handleGetMarpThemes] Panel._panel exists:', !!(panel?._panel));
                console.error('[kanban.messageHandler.handleGetMarpThemes] Webview exists:', !!(panel?._panel?.webview));
            }
        } catch (error) {
            console.error('[kanban.messageHandler.handleGetMarpThemes] Error:', error);
            
            const panel = this._getWebviewPanel();
            if (panel && panel._panel && panel._panel.webview) {
                const message = {
                    type: 'marpThemesAvailable',
                    themes: ['default'], // Fallback
                    error: error instanceof Error ? error.message : String(error)
                };
                panel._panel.webview.postMessage(message);
            }
        }
    }

    /**
     * Handle poll for Marp themes (fallback mechanism)
     */
    private async handlePollMarpThemes(): Promise<void> {
        try {
            // Check if we have cached themes from the previous attempt
            const cachedThemes = (globalThis as any).pendingMarpThemes;
            if (cachedThemes) {
                
                const panel = this._getWebviewPanel();
                if (panel && panel._panel && panel._panel.webview) {
                    panel._panel.webview.postMessage({
                        type: 'marpThemesAvailable',
                        themes: cachedThemes
                    });
                    // Clear the cache
                    delete (globalThis as any).pendingMarpThemes;
                    return;
                }
            }
            
            // If no cached themes, try to get them again
            const themes = await MarpExportService.getAvailableThemes();
            
            const panel = this._getWebviewPanel();
            if (panel && panel._panel && panel._panel.webview) {
                panel._panel.webview.postMessage({
                    type: 'marpThemesAvailable',
                    themes: themes
                });
            } else {
                console.error('[kanban.messageHandler.handlePollMarpThemes] Still no webview panel available');
            }
        } catch (error) {
            console.error('[kanban.messageHandler.handlePollMarpThemes] Error:', error);
        }
    }

    /**
     * Open a markdown file in Marp preview
     */
    private async handleOpenInMarpPreview(filePath: string): Promise<void> {

        try {
            await MarpExtensionService.openInMarpPreview(filePath);
        } catch (error) {
            console.error('[kanban.messageHandler.handleOpenInMarpPreview] ❌ Error:', error);
            console.error('[kanban.messageHandler.handleOpenInMarpPreview] Error type:', typeof error);
            console.error('[kanban.messageHandler.handleOpenInMarpPreview] Error stack:', error instanceof Error ? error.stack : 'N/A');
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to open Marp preview: ${errorMessage}`);
        }
    }

    /**
     * Check Marp status and send to frontend
     */
    private async handleCheckMarpStatus(): Promise<void> {
        try {
            const marpExtensionStatus = MarpExtensionService.getMarpStatus();
            const marpCliAvailable = await MarpExportService.isMarpCliAvailable();
            const engineFileExists = MarpExportService.engineFileExists();
            const enginePath = MarpExportService.getEnginePath();

            const panel = this._getWebviewPanel();
            if (panel && panel._panel && panel._panel.webview) {
                panel._panel.webview.postMessage({
                    type: 'marpStatus',
                    extensionInstalled: marpExtensionStatus.installed,
                    extensionVersion: marpExtensionStatus.version,
                    cliAvailable: marpCliAvailable,
                    engineFileExists: engineFileExists,
                    enginePath: enginePath
                });
            } else {
                console.error('[kanban.messageHandler.handleCheckMarpStatus] No webview panel available');
            }
        } catch (error) {
            console.error('[kanban.messageHandler.handleCheckMarpStatus] Error:', error);
        }
    }

    /**
     * Get available Marp CSS classes
     */
    private async handleGetMarpAvailableClasses(): Promise<void> {
        try {
            const config = ConfigurationService.getInstance();
            const marpConfig = config.getConfig('marp');
            const availableClasses = marpConfig.availableClasses || [];

            const panel = this._getWebviewPanel();
            if (panel && panel._panel && panel._panel.webview) {
                panel._panel.webview.postMessage({
                    type: 'marpAvailableClasses',
                    classes: availableClasses
                });
            }
        } catch (error) {
            console.error('[kanban.messageHandler.handleGetMarpAvailableClasses] Error:', error);
        }
    }

    /**
     * Save Marp CSS classes as HTML comment directives in markdown
     * Format: <!-- _class: font24 center -->
     */
    private async handleSaveMarpClasses(scope: string, columnId: string | null, taskId: string | null, classes: string[]): Promise<void> {
        try {
            console.log('[kanban.messageHandler.handleSaveMarpClasses] Called with:', { scope, columnId, taskId, classes });

            // Create HTML comment directive
            const classString = classes.join(' ');
            const directive = classes.length > 0 ? `<!-- _class: ${classString} -->\n` : '';
            console.log('[kanban.messageHandler.handleSaveMarpClasses] Directive:', directive);

            // Get panel to access board
            const panel = this._getWebviewPanel();
            if (!panel) {
                console.error('[kanban.messageHandler.handleSaveMarpClasses] No panel found');
                return;
            }

            // Get current board
            const board = panel.getBoard();
            if (!board) {
                console.error('[kanban.messageHandler.handleSaveMarpClasses] No board found');
                return;
            }

            // Get current markdown content from main file
            const mainFile = panel._fileRegistry.getMainFile();
            if (!mainFile) {
                console.error('[kanban.messageHandler.handleSaveMarpClasses] No main file found');
                return;
            }

            let markdown = mainFile.getContent();
            if (!markdown) {
                console.error('[kanban.messageHandler.handleSaveMarpClasses] No markdown content found');
                return;
            }
            console.log('[kanban.messageHandler.handleSaveMarpClasses] Got markdown, length:', markdown.length);

            if (scope === 'global') {
                // For global scope, add directive at the very beginning (or after YAML)
                const yamlMatch = markdown.match(/^---\n[\s\S]*?\n---\n/);
                const afterYaml = yamlMatch ? yamlMatch[0].length : 0;
                const beforeFirstColumn = markdown.indexOf('\n## ', afterYaml);
                const globalEnd = beforeFirstColumn > 0 ? beforeFirstColumn : markdown.length;

                // Remove existing global marp directive (only in global section)
                const beforeGlobal = markdown.slice(0, afterYaml);
                let globalSection = markdown.slice(afterYaml, globalEnd);
                const afterGlobal = markdown.slice(globalEnd);

                // Remove directive from global section only
                globalSection = globalSection.replace(/<!-- _class: [^>]+ -->\n?/g, '');

                // Insert new directive at start of global section
                markdown = beforeGlobal + directive + globalSection + afterGlobal;
            } else if (scope === 'column' && columnId) {
                // Find column in board
                const column = board.columns.find((c: any) => c.id === columnId);
                if (!column) {
                    console.error('[kanban.messageHandler.handleSaveMarpClasses] Column not found:', columnId);
                    return;
                }
                console.log('[kanban.messageHandler.handleSaveMarpClasses] Found column:', column.title);

                // Find column header and add directive BEFORE it
                const titleClean = column.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const columnRegex = new RegExp(`(<!-- _class: [^>]+ -->\\n)?(## ${titleClean})`, 'm');
                console.log('[kanban.messageHandler.handleSaveMarpClasses] Column regex:', columnRegex);

                const originalMarkdown = markdown;
                markdown = markdown.replace(columnRegex, (match: string, existingDirective: string, header: string) => {
                    console.log('[kanban.messageHandler.handleSaveMarpClasses] Column regex matched:', { match, existingDirective, header });
                    // Replace or add directive before column header
                    return directive + header;
                });
                if (markdown === originalMarkdown) {
                    console.error('[kanban.messageHandler.handleSaveMarpClasses] Column regex did not match anything!');
                }
            } else if (scope === 'task' && columnId && taskId) {
                // Find task in board
                const column = board.columns.find((c: any) => c.id === columnId);
                if (!column) {
                    console.error('[kanban.messageHandler.handleSaveMarpClasses] Column not found for task:', columnId);
                    return;
                }
                const task = column.tasks.find((t: any) => t.id === taskId);
                if (!task) {
                    console.error('[kanban.messageHandler.handleSaveMarpClasses] Task not found:', taskId);
                    return;
                }
                console.log('[kanban.messageHandler.handleSaveMarpClasses] Found task:', task.title);

                // Find task line and add directive BEFORE it
                const titleClean = task.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const taskRegex = new RegExp(`(<!-- _class: [^>]+ -->\\n)?(- \\[[ x]\\] ${titleClean})`, 'm');
                console.log('[kanban.messageHandler.handleSaveMarpClasses] Task regex:', taskRegex);

                const originalMarkdown = markdown;
                markdown = markdown.replace(taskRegex, (match: string, existingDirective: string, taskLine: string) => {
                    console.log('[kanban.messageHandler.handleSaveMarpClasses] Task regex matched:', { match, existingDirective, taskLine });
                    // Replace or add directive before task
                    return directive + taskLine;
                });
                if (markdown === originalMarkdown) {
                    console.error('[kanban.messageHandler.handleSaveMarpClasses] Task regex did not match anything!');
                }
            }

            // Update file content (marks as unsaved)
            console.log('[kanban.messageHandler.handleSaveMarpClasses] Setting content, changed:', markdown.length);
            mainFile.setContent(markdown, false);
            console.log('[kanban.messageHandler.handleSaveMarpClasses] Content set successfully');

            // After saving, send updated directives to frontend
            await this.sendMarpDirectivesToFrontend();

        } catch (error) {
            console.error('[kanban.messageHandler.handleSaveMarpClasses] Error:', error);
        }
    }

    /**
     * Parse HTML comment directives from markdown and send to frontend
     */
    private async sendMarpDirectivesToFrontend(): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }

            const board = panel.getBoard();
            if (!board) {
                return;
            }

            const mainFile = panel._fileRegistry.getMainFile();
            if (!mainFile) {
                return;
            }

            const markdown = mainFile.getContent();
            if (!markdown) {
                return;
            }

            // Parse directives from markdown
            const directives: any = {
                global: [],
                columns: {},
                tasks: {}
            };

            // Extract global directive (after YAML frontmatter, before first column)
            const yamlMatch = markdown.match(/^---\n[\s\S]*?\n---\n/);
            const afterYaml = yamlMatch ? yamlMatch[0].length : 0;
            const beforeFirstColumn = markdown.indexOf('\n## ', afterYaml);
            const globalSection = beforeFirstColumn > 0
                ? markdown.slice(afterYaml, beforeFirstColumn)
                : markdown.slice(afterYaml, Math.min(afterYaml + 500, markdown.length));

            const globalDirectiveMatch = globalSection.match(/<!-- _class: ([^>]+) -->/);
            if (globalDirectiveMatch) {
                directives.global = globalDirectiveMatch[1].split(/\s+/).filter((c: string) => c.length > 0);
            }

            // Extract column and task directives
            if (board.columns) {
                for (const column of board.columns) {
                    // Find directive before column header
                    const titleClean = column.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const columnRegex = new RegExp(`<!-- _class: ([^>]+) -->\\s*## ${titleClean}`, 'm');
                    const columnMatch = markdown.match(columnRegex);

                    if (columnMatch) {
                        const classes = columnMatch[1].split(/\s+/).filter((c: string) => c.length > 0);
                        directives.columns[column.id] = classes;
                    }

                    // Extract from tasks
                    if (column.tasks) {
                        for (const task of column.tasks) {
                            const taskTitleClean = task.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const taskRegex = new RegExp(`<!-- _class: ([^>]+) -->\\s*- \\[[ x]\\] ${taskTitleClean}`, 'm');
                            const taskMatch = markdown.match(taskRegex);

                            if (taskMatch) {
                                const classes = taskMatch[1].split(/\s+/).filter((c: string) => c.length > 0);
                                directives.tasks[task.id] = classes;
                            }
                        }
                    }
                }
            }

            // Send to frontend
            if (panel._panel && panel._panel.webview) {
                panel._panel.webview.postMessage({
                    type: 'marpClassDirectives',
                    directives: directives
                });
            }

        } catch (error) {
            console.error('[kanban.messageHandler.sendMarpDirectivesToFrontend] Error:', error);
        }
    }

    /**
     * Present kanban content with Marp
     */
    /**
     * Start auto-export on file save
     */
    /**
     * Stop auto-export
     */
    private async handleStopAutoExport(): Promise<void> {
        try {

            // Unregister from SaveEventCoordinator
            const doc = this._fileManager.getDocument();
            if (doc) {
                const coordinator = SaveEventCoordinator.getInstance();
                coordinator.unregisterHandler(`auto-export-${doc.uri.fsPath}`);
            }

            // Stop all Marp watch processes
            MarpExportService.stopAllMarpWatches();

            this._autoExportSettings = null;


            // Notify frontend to hide the auto-export button
            const panel = this._getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: 'autoExportStopped'
                });
            } else {
                console.warn('[kanban.messageHandler.handleStopAutoExport] No webview panel available to send message');
            }
        } catch (error) {
            console.error('[kanban.messageHandler.handleStopAutoExport] Error:', error);
            throw error;
        }
    }

    /**
     * Stop auto-export for other kanban files (not generated files from current export)
     */
    private async handleStopAutoExportForOtherKanbanFiles(currentKanbanFilePath: string, protectExportedPath?: string): Promise<void> {
        try {
            if (protectExportedPath) {
            }

            // Unregister from SaveEventCoordinator
            const doc = this._fileManager.getDocument();
            if (doc) {
                const coordinator = SaveEventCoordinator.getInstance();
                coordinator.unregisterHandler(`auto-export-${doc.uri.fsPath}`);
            }

            // Stop Marp watch processes for OTHER files (not the current export)
            if (protectExportedPath) {
                ExportService.stopAllMarpWatchesExcept(protectExportedPath);
            } else {
                MarpExportService.stopAllMarpWatches();
            }

        } catch (error) {
            console.error('[kanban.messageHandler.handleStopAutoExportForOtherKanbanFiles] Error:', error);
            throw error;
        }
    }

    /**
     * Stop auto-export for a specific file (used during restart)
     */
    private async handleStopAutoExportForFile(excludeFilePath?: string): Promise<void> {
        try {

            // Unregister from SaveEventCoordinator
            const doc = this._fileManager.getDocument();
            if (doc) {
                const coordinator = SaveEventCoordinator.getInstance();
                coordinator.unregisterHandler(`auto-export-${doc.uri.fsPath}`);
            }

            // Stop all Marp watch processes
            MarpExportService.stopAllMarpWatches();

            this._autoExportSettings = null;

        } catch (error) {
            console.error('[kanban.messageHandler.handleStopAutoExportForFile] Error:', error);
            throw error;
        }
    }

    // ============================================================================
    // NEW UNIFIED EXPORT HANDLER
    // Replaces: handleExportWithAssets, handleExportColumn, handleGenerateCopyContent,
    //           handleUnifiedExport, handleExportWithMarp, handlePresentWithMarp, handleStartAutoExport
    // ============================================================================

    /**
     * Unified export handler - handles ALL export operations
     * This single handler replaces 7 old handlers with a clean, consistent interface
     */
    private async handleExport(options: any, operationId?: string): Promise<void> {
        try {

            // Get document (with fallback to file path if document is closed)
            let document = this._fileManager.getDocument();
            if (!document) {
                const filePath = this._fileManager.getFilePath();
                if (filePath) {
                    try {
                        document = await vscode.workspace.openTextDocument(filePath);
                    } catch (error) {
                        console.error('[kanban.messageHandler.handleExport] Failed to open document from file path:', error);
                    }
                }
            }
            if (!document) {
                throw new Error('No document available for export');
            }

            // Handle AUTO mode specially (register save handler)
            if (options.mode === 'auto') {
                return await this.handleAutoExportMode(document, options);
            }

            // Get board for ANY conversion exports (use in-memory board data)
            // Only use file data when keeping original format (kanban) or packing assets
            const board = (options.format !== 'kanban' && !options.packAssets) ? this._getCurrentBoard() : undefined;

            // Handle COPY mode (no progress bar)
            if (options.mode === 'copy') {
                const result = await ExportService.export(document, options, board);

                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'copyContentResult',
                        result: result
                    });
                }

                if (!result.success) {
                    vscode.window.showErrorMessage(result.message);
                }
                return;
            }

            // Handle SAVE / PREVIEW modes (with progress bar)
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Exporting...`,
                cancellable: false
            }, async (progress) => {

                if (operationId) {
                    await this.updateOperationProgress(operationId, 20, 'Processing content...');
                }
                progress.report({ increment: 20, message: 'Processing content...' });

                const result = await ExportService.export(document!, options, board);

                if (operationId) {
                    await this.updateOperationProgress(operationId, 90, 'Finalizing...');
                }
                progress.report({ increment: 80, message: 'Finalizing...' });

                // Send result to webview
                const panel = this._getWebviewPanel();
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'exportResult',
                        result: result
                    });
                }

                // Note: When marpWatch is enabled (Live Preview mode), Marp CLI handles
                // opening the browser automatically with --watch --preview flags.
                // We don't need to call MarpExtensionService.openInMarpPreview() here.

                if (operationId) {
                    await this.updateOperationProgress(operationId, 100);
                }

                // Show result message
                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                } else {
                    vscode.window.showErrorMessage(result.message);
                }
            });

        } catch (error) {
            console.error('[kanban.messageHandler.handleExport] Error:', error);
            vscode.window.showErrorMessage(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle auto-export mode (register save handler)
     * Part of unified export handler
     */
    private async handleAutoExportMode(document: vscode.TextDocument, options: any): Promise<void> {

        // Store settings
        this._autoExportSettings = options;

        // Get board for conversion exports
        const board = (options.format !== 'kanban' && !options.packAssets) ? this._getCurrentBoard() : undefined;

        // Do initial export FIRST (to start Marp if needed)
        const initialResult = await ExportService.export(document, options, board);

        // NOW stop existing handlers/processes for other files
        // If Marp was started, protect the exported markdown file
        await this.handleStopAutoExportForOtherKanbanFiles(document.uri.fsPath, initialResult.exportedPath);

        const docUri = document.uri;
        const coordinator = SaveEventCoordinator.getInstance();

        // Register handler
        const handler: SaveEventHandler = {
            id: `auto-export-${docUri.fsPath}`,
            handleSave: async (savedDoc: vscode.TextDocument) => {
                if (savedDoc.uri.toString() === docUri.toString()) {

                    // For Marp watch mode, update markdown only - Marp's watch will handle the rest
                    if (options.marpWatch) {

                        try {
                            // Get fresh board for conversion
                            const boardForUpdate = (options.format !== 'kanban' && !options.packAssets) ? this._getCurrentBoard() : undefined;
                            // Export with marpWatch flag set - skips Marp conversion
                            await ExportService.export(savedDoc, options, boardForUpdate);
                        } catch (error) {
                            console.error('[kanban.messageHandler.autoExport] Markdown update failed:', error);
                        }
                        return;
                    }


                    try {
                        // Get fresh board for conversion
                        const boardForExport = (options.format !== 'kanban' && !options.packAssets) ? this._getCurrentBoard() : undefined;
                        // Use new unified export
                        const result = await ExportService.export(savedDoc, options, boardForExport);

                        if (result.success && options.openAfterExport && result.exportedPath) {
                            const uri = vscode.Uri.file(result.exportedPath);
                            await vscode.env.openExternal(uri);
                        }

                    } catch (error) {
                        console.error('[kanban.messageHandler.autoExport] Auto-export failed:', error);
                        vscode.window.showErrorMessage(`Auto-export failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
        };

        coordinator.registerHandler(handler);
    }

    /**
     * Handle PlantUML rendering request from webview
     * Uses backend Node.js PlantUML service for completely offline rendering
     */
    private async handleRenderPlantUML(message: any): Promise<void> {
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
     */
    private async handleRenderDrawIO(message: any): Promise<void> {
        const { requestId, filePath } = message;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[handleRenderDrawIO] No panel or webview available');
            return;
        }

        try {
            // Import draw.io service
            const { DrawIOService } = await import('./services/export/DrawIOService');
            const service = new DrawIOService();

            // Check if CLI is available
            if (!await service.isAvailable()) {
                throw new Error('draw.io CLI not installed');
            }

            // Resolve file path (handles both document-relative and workspace-relative paths)
            const resolution = await panel._fileManager.resolveFilePath(filePath);

            if (!resolution || !resolution.exists) {
                throw new Error(`draw.io file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Render to PNG (better rendering than SVG in webview)
            const pngBuffer = await service.renderPNG(absolutePath);

            // Convert PNG to data URL
            const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

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
     * Handle excalidraw diagram rendering request from webview
     * Uses backend ExcalidrawService with library for conversion
     */
    private async handleRenderExcalidraw(message: any): Promise<void> {
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
                console.log('[Excalidraw Backend] ✅ Rendered as PNG');
            } catch (pngError) {
                console.warn('[Excalidraw Backend] PNG conversion failed, falling back to SVG:', pngError);
                // Fallback to SVG
                const svg = await service.renderSVG(absolutePath);
                dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
                console.log('[Excalidraw Backend] ✅ Rendered as SVG (fallback)');
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
    private async handleRenderPDFPage(message: any): Promise<void> {
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
    private async handleGetPDFInfo(message: any): Promise<void> {
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
    private async handleConvertPlantUMLToSVG(message: any): Promise<void> {
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

        // Escape special regex characters in code, accounting for indentation
        const escapedCode = plantUMLCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Split the code into lines to handle per-line matching with indentation
        // NOTE: The frontend sends TRIMMED code, but the file may have indented code
        const codeLines = plantUMLCode.split('\n').filter(line => line.trim().length > 0);
        const escapedLines = codeLines.map(line =>
            line.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
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
    private async handleConvertMermaidToSVG(message: any): Promise<void> {
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

        // Escape special regex characters in code
        const escapedCode = mermaidCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Split the code into lines to handle per-line matching with indentation
        const codeLines = mermaidCode.split('\n').filter(line => line.trim().length > 0);
        const escapedLines = codeLines.map(line =>
            line.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
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
}
