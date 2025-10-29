import { FileManager } from './fileManager';
import { UndoRedoManager } from './undoRedoManager';
import { BoardOperations } from './boardOperations';
import { LinkHandler } from './linkHandler';
import { MarkdownFile } from './files/MarkdownFile'; // FOUNDATION-1: For path comparison
import { KanbanBoard } from './markdownParser';
import { configService } from './configurationService';
import { ExportService, NewExportOptions } from './exportService';
import { PathResolver } from './services/PathResolver';
import { MarpExtensionService } from './services/export/MarpExtensionService';
import { MarpExportService } from './services/export/MarpExportService';
import { SaveEventCoordinator, SaveEventHandler } from './saveEventCoordinator';
import { PlantUMLService } from './plantUMLService';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface FocusTarget {
    type: 'task' | 'column';
    id: string;
    operation: 'created' | 'modified' | 'deleted' | 'moved';
}

export class MessageHandler {
    private _fileManager: FileManager;
    private _undoRedoManager: UndoRedoManager;
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
        undoRedoManager: UndoRedoManager,
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
        this._undoRedoManager = undoRedoManager;
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
     * Request frontend to stop editing and wait for response
     * Returns a Promise that resolves when frontend confirms editing has stopped
     */
    private async _requestStopEditing(): Promise<void> {
        const requestId = `stop-edit-${++this._stopEditingRequestCounter}`;
        const panel = this._getWebviewPanel();

        if (!panel || !panel.webview) {
            console.warn('[_requestStopEditing] No panel or webview available');
            return;
        }

        return new Promise<void>((resolve, reject) => {
            // Set timeout in case frontend doesn't respond
            const timeout = setTimeout(() => {
                this._pendingStopEditingRequests.delete(requestId);
                console.warn('[_requestStopEditing] Timeout waiting for frontend response');
                resolve(); // Don't reject, just continue
            }, 2000);

            // Store promise resolver
            this._pendingStopEditingRequests.set(requestId, { resolve, reject, timeout });

            // Send request to frontend
            console.log(`[_requestStopEditing] Sending stopEditing request: ${requestId}`);
            panel.webview.postMessage({
                type: 'stopEditing',
                requestId
            });
        });
    }

    /**
     * Handle response from frontend that editing has stopped
     */
    private _handleEditingStopped(requestId: string): void {
        console.log(`[_handleEditingStopped] Received response for: ${requestId}`);
        const pending = this._pendingStopEditingRequests.get(requestId);

        if (pending) {
            clearTimeout(pending.timeout);
            this._pendingStopEditingRequests.delete(requestId);
            pending.resolve();

            // RACE-2: Sync dirty items after editing stops
            // When user was editing, frontend skipped rendering updateColumnContent.
            // Backend marked those items as dirty. Now apply all skipped updates.
            console.log(`[RACE-2] Editing stopped - syncing dirty items`);
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
            console.log(`[_requestUnfoldColumns] Sending unfold request: ${requestId}, columns: ${columnIds.join(', ')}`);
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
        console.log(`[_handleColumnsUnfolded] Received response for: ${requestId}`);
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

            // Switch task include file (load new file without saving main file)
            case 'switchTaskIncludeFile':
                await this.handleSwitchTaskIncludeFile(message);
                break;

            // Enhanced file and link handling
            case 'openFileLink':
                await this._linkHandler.handleFileLink(message.href, message.taskId, message.columnId, message.linkIndex);
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
                console.log('[MessageHandler.markUnsavedChanges] ENTRY - hasChanges:', message.hasUnsavedChanges, 'hasCachedBoard:', !!message.cachedBoard);
                if (message.cachedBoard) {
                    console.log('[MessageHandler.markUnsavedChanges] cachedBoard columns:', message.cachedBoard.columns?.length);
                    // Check if any tasks have includeMode
                    let includeTaskCount = 0;
                    message.cachedBoard.columns?.forEach((col: any) => {
                        col.tasks?.forEach((task: any) => {
                            if (task.includeMode) {
                                includeTaskCount++;
                                console.log('[MessageHandler.markUnsavedChanges] Include task found:', {
                                    title: task.title,
                                    displayTitle: task.displayTitle,
                                    descriptionLength: task.description?.length || 0,
                                    includeFiles: task.includeFiles
                                });
                            }
                        });
                    });
                    console.log('[MessageHandler.markUnsavedChanges] Total include tasks:', includeTaskCount);
                }
                this._markUnsavedChanges(message.hasUnsavedChanges, message.cachedBoard);
                break;
            case 'saveUndoState':
                // Save current board state for undo without executing any operation
                // Use the board state from the webview cache if provided, otherwise fallback to backend board
                const boardToSave = message.currentBoard || this._getCurrentBoard();
                if (boardToSave) {
                    this._undoRedoManager.saveStateForUndo(boardToSave);
                } else {
                    console.warn('❌ No current board available for undo state saving');
                }
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

                    if (task && task.includeMode && task.includeFiles) {
                        console.log(`[editTask] Task include detected - updating file instance for: ${task.includeFiles.join(', ')}`);
                        const panel = this._getWebviewPanel();

                        for (const relativePath of task.includeFiles) {
                            // FIX: Must normalize path before registry lookup (registry does NOT normalize internally)
                            const normalizedPath = (panel as any)._includeFileManager?.normalizeIncludePath(relativePath);
                            const file = panel.fileRegistry?.getByRelativePath(normalizedPath);

                            if (file) {
                                // Update file content immediately (marks as unsaved)
                                // This ensures "text modification" path calls the SAME function as "edit include file" path
                                console.log(`[editTask] Updating file content for: ${relativePath}`);
                                console.log(`[editTask]   Old content length: ${file.getContent().length}`);
                                console.log(`[editTask]   New content length: ${message.taskData.description.length}`);

                                // Update the file content (marks as unsaved, does NOT sync baseline)
                                // Baseline will be synced when file is saved
                                file.setContent(message.taskData.description, false);

                                console.log(`[editTask]   File marked as unsaved: ${file.hasUnsavedChanges()}`);
                            } else {
                                console.warn(`[editTask] File not found in registry: ${relativePath}`);
                                console.warn(`[editTask]   This might indicate the file was never loaded`);
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
                await this.handleUpdateColumnTitleFromStrikethroughDeletion(message);
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
                await this.performBoardAction(() => 
                    this._boardOperations.deleteTask(this._getCurrentBoard()!, message.taskId, message.columnId)
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
                console.log('[kanban.messageHandler.deleteColumn] Before delete, board has', this._getCurrentBoard()?.columns.length, 'columns');
                await this.performBoardAction(() => {
                    const result = this._boardOperations.deleteColumn(this._getCurrentBoard()!, message.columnId);
                    console.log('[kanban.messageHandler.deleteColumn] After delete, board has', this._getCurrentBoard()?.columns.length, 'columns');
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
                console.log(`[MessageHandler] Editing started - blocking board regenerations`);
                this._getWebviewPanel().setEditingInProgress(true);
                break;

            case 'editingStopped':
                // Frontend confirms editing has stopped (response to stopEditing request)
                if (message.requestId) {
                    this._handleEditingStopped(message.requestId);
                }
                break;

            case 'renderSkipped':
                // OPTIMIZATION 1: Frontend reports it skipped a render - mark as dirty
                console.log(`[MessageHandler] Frontend skipped render for ${message.itemType} ${message.itemId} (reason: ${message.reason})`);
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
                console.log(`[MessageHandler] Frontend confirmed render for ${message.itemType} ${message.itemId}`);
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
                const currentBoard = this._getCurrentBoard();
                console.log(`[SWITCH-2] editColumnTitle - Board has ${currentBoard?.columns?.length || 0} columns`);
                console.log(`[SWITCH-2] Looking for column ID: ${message.columnId}`);

                if (!currentBoard) {
                    console.error(`[SWITCH-2] No board loaded`);
                    break;
                }

                const column = currentBoard.columns.find(col => col.id === message.columnId);
                if (!column) {
                    console.error(`[SWITCH-2] Column ${message.columnId} not found`);
                    break;
                }

                // Check if the new title contains include syntax (location-based: column include)
                const hasColumnIncludeMatches = message.title.match(/!!!include\(([^)]+)\)!!!/g);

                if (hasColumnIncludeMatches) {
                    // Column include switch - use UNIFIED function
                    console.log(`[SWITCH-2] Detected column include syntax, routing to updateColumnIncludeFile`);

                    // Extract the include files from the new title
                    const newIncludeFiles: string[] = [];
                    hasColumnIncludeMatches.forEach((match: string) => {
                        const filePath = match.replace(/!!!include\(([^)]+)\)!!!/, '$1').trim();
                        newIncludeFiles.push(filePath);
                    });

                    // Get old include files for cleanup
                    const oldIncludeFiles = column.includeFiles || [];

                    // Call unified switch function
                    // It handles: undo state, unsaved prompts, cleanup, loading, updates
                    const panel = this._getWebviewPanel();
                    try {
                        // RACE-1: Pass completion callback to clear editing flag when truly done
                        await panel.updateColumnIncludeFile(
                            message.columnId,
                            oldIncludeFiles,
                            newIncludeFiles,
                            message.title,
                            () => {
                                // Clear editing flag only after all async operations complete
                                console.log(`[SWITCH-2] Edit completed - allowing board regenerations`);
                                this._getWebviewPanel().setEditingInProgress(false);
                            }
                        );
                        console.log(`[SWITCH-2] Column include switch completed successfully`);
                    } catch (error: any) {
                        // RACE-1: On error, still clear editing flag
                        this._getWebviewPanel().setEditingInProgress(false);

                        if (error.message === 'USER_CANCELLED') {
                            console.log(`[SWITCH-2] User cancelled switch, no changes made`);
                        } else {
                            console.error(`[SWITCH-2] Error during column include switch:`, error);
                            vscode.window.showErrorMessage(`Failed to switch column include: ${error.message}`);
                        }
                    }
                } else {
                    // Regular title edit without include syntax
                    console.log(`[SWITCH-2] Regular column title edit (no include syntax)`);
                    // STATE-3: Frontend already updated title, don't echo back
                    await this.performBoardAction(() =>
                        this._boardOperations.editColumnTitle(currentBoard, message.columnId, message.title),
                        { sendUpdate: false }
                    );

                    // RACE-1: Clear editing flag after regular title edit
                    console.log(`[SWITCH-2] Regular edit completed - allowing board regenerations`);
                    this._getWebviewPanel().setEditingInProgress(false);
                }
                break;
            case 'editTaskTitle':
                // Check if this might be a task include file change
                const currentBoardForTask = this._getCurrentBoard();
                const targetColumn = currentBoardForTask?.columns.find(col => col.id === message.columnId);
                const task = targetColumn?.tasks.find(t => t.id === message.taskId);

                // Check if the new title contains include syntax (location-based: task include)
                const hasTaskIncludeMatches = message.title.match(/!!!include\(([^)]+)\)!!!/g);

                if (hasTaskIncludeMatches) {
                    // Extract the include files from the new title
                    const newIncludeFiles: string[] = [];
                    hasTaskIncludeMatches.forEach((match: string) => {
                        const filePath = match.replace(/!!!include\(([^)]+)\)!!!/, '$1').trim();
                        newIncludeFiles.push(filePath);
                    });

                    // STRATEGY A: Route through unified handler - it will check unsaved changes ONCE
                    // All duplicate checks have been removed (lines 612-660 deleted)
                    if (newIncludeFiles.length > 0 && task) {
                        console.log('[editTaskTitle] Routing task include switch through unified handler...');
                        const panel = this._getWebviewPanel();
                        const oldTaskIncludeFiles = task.includeFiles || [];

                        // CRITICAL FIX: Stop editing BEFORE starting switch to prevent race condition
                        // This ensures user can't edit description while content is loading
                        await this._requestStopEditing();

                        try {
                            // Route through unified handler - it checks unsaved changes once
                            await (panel as any)._handleContentChange({
                                source: 'user_edit',
                                switchedIncludes: [{
                                    taskId: message.taskId,
                                    columnIdForTask: message.columnId,
                                    oldFiles: oldTaskIncludeFiles,
                                    newFiles: newIncludeFiles,
                                    newTitle: message.title
                                }]
                            });
                            console.log(`[editTaskTitle] Switch complete - displayTitle: "${task.displayTitle}"`);

                            // Update the task title (this will trigger markUnsavedChanges with CORRECT content)
                            // STATE-3: Frontend already has include content, don't echo back
                            await this.performBoardAction(() =>
                                this._boardOperations.editTask(currentBoardForTask!, message.taskId, message.columnId, { title: message.title }),
                                { sendUpdate: false }
                            );

                            // RACE-1: Clear editing flag after task include switch completes
                            console.log('[editTaskTitle] Task include switch completed - allowing board regenerations');
                            panel.setEditingInProgress(false);
                        } catch (error: any) {
                            // RACE-1: On error, still clear editing flag
                            panel.setEditingInProgress(false);

                            if (error.message === 'USER_CANCELLED') {
                                console.log('[editTaskTitle] Switch cancelled by user - keeping original title and content');
                            } else {
                                throw error; // Re-throw other errors
                            }
                        }
                    }
                } else {
                    // Regular title edit without include syntax
                    // STATE-3: Frontend already updated title, don't echo back
                    await this.performBoardAction(() =>
                        this._boardOperations.editTask(currentBoardForTask!, message.taskId, message.columnId, { title: message.title }),
                        { sendUpdate: false }
                    );

                    // RACE-1: Clear editing flag after regular title edit
                    console.log('[editTaskTitle] Regular edit completed - allowing board regenerations');
                    this._getWebviewPanel().setEditingInProgress(false);
                }
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
                await this.handleSaveIndividualFile(message.filePath, message.isMainFile);
                break;

            case 'reloadIndividualFile':
                await this.handleReloadIndividualFile(message.filePath, message.isMainFile);
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

            // PlantUML to SVG conversion
            case 'convertPlantUMLToSVG':
                await this.handleConvertPlantUMLToSVG(message);
                break;

            // Mermaid to SVG conversion
            case 'convertMermaidToSVG':
                await this.handleConvertMermaidToSVG(message);
                break;

            default:
                console.error('handleMessage : Unknown message type:', message.type);
                break;
        }
    }

    private async handleUndo() {
        const currentBoard = this._getCurrentBoard();
        const restoredBoard = this._undoRedoManager.undo(currentBoard);
        
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
        const restoredBoard = this._undoRedoManager.redo(currentBoard);
        
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

        console.log(`[MessageHandler.handleEditModeStart] filePath: ${filePath}, fileType: ${fileType}`);

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

        console.log(`[MessageHandler.handleEditModeEnd] filePath: ${filePath}, fileType: ${fileType}`);

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

        console.log('[handleSaveBoardState] ========================================');
        console.log('[handleSaveBoardState] Received board from frontend for saving');
        console.log(`[handleSaveBoardState] Board has ${board.columns?.length || 0} columns`);

        // Log each column's includeMode status
        if (board.columns) {
            for (const col of board.columns) {
                console.log(`[handleSaveBoardState] Column "${col.title}": includeMode=${col.includeMode}, includeFiles=${col.includeFiles?.join(',') || 'none'}, tasks=${col.tasks?.length || 0}`);
            }
        }
        console.log('[handleSaveBoardState] ========================================');

        // NOTE: Do not save undo state here - individual operations already saved their undo states
        // before making changes. Saving here would create duplicate/grouped undo states.

        // Replace the current board with the new one
        this._setBoard(board);

        // Save to markdown file only - do NOT trigger board update
        // The webview already has the correct state (it sent us this board)
        // Triggering _onBoardUpdate() would cause folding state to be lost
        await this._onSaveToMarkdown();

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
            this._undoRedoManager.saveStateForUndo(board);
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
            // Use VS Code's snippet resolution to get the actual snippet content
            // This leverages VS Code's built-in snippet system
            const snippetName = await this.getSnippetNameForShortcut(message.shortcut);

            if (!snippetName) {
                vscode.window.showInformationMessage(
                    `No snippet configured for ${message.shortcut}. Add a keybinding with "editor.action.insertSnippet" command.`
                );
                return;
            }

            // Resolve the snippet content from VS Code's markdown snippet configuration
            const resolvedContent = await this.resolveSnippetContent(snippetName);

            if (resolvedContent) {
                const panel = this._getWebviewPanel();
                if (panel) {
                    panel._panel.webview.postMessage({
                        type: 'insertSnippetContent',
                        content: resolvedContent,
                        fieldType: message.fieldType,
                        taskId: message.taskId
                    });
                }
            }

        } catch (error) {
            console.error('Failed to handle VS Code snippet:', error);
            vscode.window.showInformationMessage(
                `Use Ctrl+Space in the kanban editor for snippet picker.`
            );
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
            } else {
                console.error('[DEBUG] Cannot send clipboardImageSaved message - no webview panel available');
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
            console.log('====== BACKEND RECEIVED BOARD FROM FRONTEND ======');
            console.log(`Board has ${board.columns?.length || 0} columns`);
            if (board.columns) {
                board.columns.forEach((col: any, colIdx: number) => {
                    console.log(`\nColumn ${colIdx}: "${col.title}" (ID: ${col.id})`);
                    console.log(`  includeMode: ${col.includeMode}`);
                    console.log(`  includeFiles: ${col.includeFiles?.join(', ') || '(none)'}`);
                    console.log(`  Tasks: ${col.tasks?.length || 0}`);
                    if (col.tasks) {
                        col.tasks.forEach((task: any, taskIdx: number) => {
                            console.log(`    Task ${taskIdx}:`);
                            console.log(`      ID: ${task.id}`);
                            console.log(`      Title: ${task.title}`);
                            console.log(`      Description (first 100): ${task.description?.substring(0, 100) || '(empty)'}`);
                            console.log(`      includeMode: ${task.includeMode}`);
                            console.log(`      includeFiles: ${task.includeFiles?.join(', ') || '(none)'}`);
                        });
                    }
                });
            }
            console.log('==================================================');

            // CRITICAL: Check for unsaved changes in include files BEFORE updating the board
            const panel = this._getWebviewPanel();
            const oldBoard = this._getCurrentBoard();

            console.log('[handleBoardUpdate] ========== UNSAVED CHANGES CHECK ==========');
            console.log('[handleBoardUpdate] oldBoard exists:', !!oldBoard);
            console.log('[handleBoardUpdate] panel exists:', !!panel);

            if (oldBoard && panel) {
                console.log('[handleBoardUpdate] Checking columns for include file changes...');

                // Check column includes
                for (let i = 0; i < board.columns.length && i < oldBoard.columns.length; i++) {
                    const newCol = board.columns[i];
                    const oldCol = oldBoard.columns[i];

                    const oldIncludeFiles = oldCol.includeFiles || [];
                    const newIncludeFiles = newCol.includeFiles || [];
                    console.log(`[handleBoardUpdate] Column ${i} "${newCol.title}":`);
                    console.log(`[handleBoardUpdate]   Old includeFiles:`, oldIncludeFiles);
                    console.log(`[handleBoardUpdate]   New includeFiles:`, newIncludeFiles);

                    // FOUNDATION-1: Use normalized comparison
                    const removedFiles = oldIncludeFiles.filter((oldPath: string) =>
                        !newIncludeFiles.some((newPath: string) => MarkdownFile.isSameFile(oldPath, newPath))
                    );
                    console.log(`[handleBoardUpdate]   Removed files:`, removedFiles);

                    for (const removedPath of removedFiles) {
                        const oldFile = panel.fileRegistry?.getByRelativePath(removedPath);
                        console.log(`[handleBoardUpdate]   Checking file "${removedPath}"`);
                        console.log(`[handleBoardUpdate]     File exists in registry:`, !!oldFile);
                        if (oldFile) {
                            console.log(`[handleBoardUpdate]     File type:`, oldFile.getFileType());
                            console.log(`[handleBoardUpdate]     Has unsaved changes:`, oldFile.hasUnsavedChanges());
                        }

                        if (oldFile && oldFile.hasUnsavedChanges()) {
                            console.log(`[handleBoardUpdate] ⚠️  Column include file being removed has unsaved changes: ${removedPath}`);

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
                                console.log('[handleBoardUpdate] User cancelled - aborting board update');
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
                                    console.log(`[handleBoardUpdate] Task include file being removed has unsaved changes: ${removedPath}`);

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
                                        console.log('[handleBoardUpdate] User cancelled - aborting board update');
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

            // If this is an immediate update (like column include changes), trigger a save and reload
            if (message.immediate) {

                // Save the changes to markdown
                await this._onSaveToMarkdown();

                // Trigger a board update to reload with new include files
                await this._onBoardUpdate();
            } else {
                // Regular update - just mark as unsaved
                this._markUnsavedChanges(true, board);
            }

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
            const currentDocument = this._fileManager.getDocument();
            if (!currentDocument) {
                vscode.window.showErrorMessage('No active document');
                return;
            }

            const currentDir = path.dirname(currentDocument.uri.fsPath);

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
            console.log('[requestEditIncludeFileName] currentFile:', currentFile, 'columnId:', message.columnId);

            // CRITICAL: Check if current include file has unsaved changes before switching
            const panel = this._getWebviewPanel();
            const file = panel?.fileRegistry?.getByRelativePath(currentFile);
            console.log('[requestEditIncludeFileName] file found:', !!file, 'hasUnsaved:', file?.hasUnsavedChanges());

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
            console.log('[requestEditIncludeFileName] Showing file picker with current file:', currentFile);

            const currentDocument = this._fileManager.getDocument();
            if (!currentDocument) {
                vscode.window.showErrorMessage('No active document');
                return;
            }

            const currentDir = path.dirname(currentDocument.uri.fsPath);

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

            console.log('[requestEditIncludeFileName] User selected file:', fileUris?.[0]?.fsPath);
            if (fileUris && fileUris.length > 0) {
                // Convert absolute path to relative path
                const absolutePath = fileUris[0].fsPath;
                const relativePath = path.relative(currentDir, absolutePath);

                // User selected a file - send message back to webview to proceed
                const panel = this._getWebviewPanel();
                console.log('[requestEditIncludeFileName] Sending proceedUpdateIncludeFile message');
                if (panel && panel._panel) {
                    panel._panel.webview.postMessage({
                        type: 'proceedUpdateIncludeFile',
                        columnId: message.columnId,
                        newFileName: relativePath,
                        currentFile: currentFile
                    });
                    console.log('[requestEditIncludeFileName] Message sent successfully');
                } else {
                    console.error('[requestEditIncludeFileName] No panel or panel._panel available!');
                }
            } else {
                console.log('[requestEditIncludeFileName] User cancelled file selection');
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
            const currentDocument = this._fileManager.getDocument();
            if (!currentDocument) {
                vscode.window.showErrorMessage('No active document');
                return;
            }

            const currentDir = path.dirname(currentDocument.uri.fsPath);

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

    // SWITCH-3: Deleted handleSwitchColumnIncludeFile() - replaced by updateColumnIncludeFile() in KanbanWebviewPanel

    /**
     * Switch task include file without saving the main file
     * - Saves old include file if it has unsaved changes
     * - Creates and loads new include file
     * - Updates task with new content
     * - Does NOT save the main kanban file
     */
    private async handleSwitchTaskIncludeFile(message: any): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                console.error('[switchTaskIncludeFile] No panel found');
                return;
            }

            const { taskId, columnId, newFilePath, oldFilePath, newTitle } = message;
            console.log(`[switchTaskIncludeFile] Switching from ${oldFilePath} to ${newFilePath} for task ${taskId}`);

            // 1. Check if old include file has unsaved changes and prompt user
            const oldFile = panel.fileRegistry?.getByRelativePath(oldFilePath);
            if (oldFile && oldFile.hasUnsavedChanges()) {
                console.log('[switchTaskIncludeFile] Old file has unsaved changes, prompting user');

                const choice = await vscode.window.showWarningMessage(
                    `The include file "${oldFilePath}" has unsaved changes. What would you like to do?`,
                    { modal: true },
                    'Save and Switch',
                    'Discard and Switch',
                    'Cancel'
                );

                if (choice === 'Save and Switch') {
                    console.log('[switchTaskIncludeFile] User chose to save and switch');
                    await oldFile.save();
                } else if (choice === 'Discard and Switch') {
                    console.log('[switchTaskIncludeFile] User chose to discard changes and switch');
                    oldFile.discardChanges();
                } else {
                    // Cancel or closed dialog
                    console.log('[switchTaskIncludeFile] User cancelled switch');
                    return;
                }
            }

            // 2. Update board with new include path
            const board = this._getCurrentBoard();
            if (board) {
                const column = board.columns.find((c: any) => c.id === columnId);
                if (column) {
                    const task = column.tasks.find((t: any) => t.id === taskId);
                    if (task) {
                        task.title = newTitle;
                        // FIX: Normalize path before storing
                        // FOUNDATION-1: Store ORIGINAL path (no normalization)
                        task.includeFiles = [newFilePath];
                    }
                }
            }

            // FIX #2b: Cleanup old include file that is being replaced
            if (oldFilePath && oldFilePath !== newFilePath) {
                // FOUNDATION-1: Registry handles normalization internally
                const oldFileToCleanup = panel.fileRegistry?.getByRelativePath(oldFilePath);
                if (oldFileToCleanup) {
                    console.log(`[switchTaskIncludeFile] Cleaning up old include file: ${oldFilePath}`);
                    oldFileToCleanup.stopWatching();
                    // FIX: Don't call dispose() - unregister() does it internally
                    panel.fileRegistry.unregister(oldFileToCleanup.getPath());
                    console.log(`[switchTaskIncludeFile] ✓ Old file unregistered and disposed`);
                }
            }

            // 3. Create new include file in registry if it doesn't exist
            if (!panel.fileRegistry?.hasByRelativePath(newFilePath)) {
                const mainFile = panel.fileRegistry.getMainFile();
                if (mainFile) {
                    console.log('[switchTaskIncludeFile] Creating new TaskIncludeFile');
                    const taskInclude = panel._fileFactory.createTaskInclude(
                        newFilePath,
                        mainFile,
                        false
                    );
                    panel.fileRegistry.register(taskInclude);
                    taskInclude.startWatching();
                }
            }

            // 4. Load content from file
            const newFile = panel.fileRegistry?.getByRelativePath(newFilePath) as any;
            if (newFile && newFile.getTaskDescription) {
                // Ensure file has content loaded (may be empty if file was just created or content was cleared)
                if (!newFile.getContent() || newFile.getContent().length === 0) {
                    const content = await newFile.readFromDisk();
                    if (content !== null) {
                        newFile.setContent(content, true); // true = update baseline too
                    } else {
                        console.warn(`[switchTaskIncludeFile] Could not load content from file: ${newFilePath}`);
                    }
                }

                const fullFileContent = newFile.getTaskDescription();
                console.log(`[switchTaskIncludeFile] Loaded content from new file (${fullFileContent.length} chars)`);

                // FIX BUG #5: No-parsing approach
                // Load COMPLETE file content without parsing into title/description
                // displayTitle is just a UI indicator showing which file is included
                const displayTitle = `# include in ${newFilePath}`;
                const taskDescription = fullFileContent;  // Complete content, no parsing!

                // 6. Get updated task metadata from board
                const task = board?.columns.find((c: any) => c.id === columnId)?.tasks.find((t: any) => t.id === taskId);

                // 7. Send updated content to frontend with all required fields
                panel._panel?.webview.postMessage({
                    type: 'updateTaskContent',
                    taskId: taskId,
                    columnId: columnId,
                    displayTitle: displayTitle,
                    description: taskDescription,
                    taskTitle: task?.title || newTitle,
                    includeMode: true,
                    includeFiles: [newFilePath],
                    originalTitle: task?.originalTitle
                });

                // Success - no notification needed, user can see the change in the board
                console.log(`[switchTaskIncludeFile] Successfully switched to: ${newFilePath}`);
            }

        } catch (error) {
            console.error('[switchTaskIncludeFile] Error:', error);
            vscode.window.showErrorMessage(`Failed to switch task include file: ${error}`);
        }
    }

    /**
     * Handle request for task include filename (enabling include mode)
     */
    private async handleRequestTaskIncludeFileName(taskId: string, columnId: string): Promise<void> {
        try {
            // Use file picker dialog for better UX
            const currentDocument = this._fileManager.getDocument();
            if (!currentDocument) {
                vscode.window.showErrorMessage('No active document');
                return;
            }

            const currentDir = path.dirname(currentDocument.uri.fsPath);

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
            console.log('[kanban.messageHandler.getExportDefaultFolder] FileManager document:', document ? document.uri.fsPath : 'null');

            // If document not available from FileManager, try to get the file path and open it
            if (!document) {
                const filePath = this._fileManager.getFilePath();
                console.log('[kanban.messageHandler.getExportDefaultFolder] FileManager filePath:', filePath || 'null');

                if (filePath) {
                    // Open the document using the file path
                    try {
                        document = await vscode.workspace.openTextDocument(filePath);
                        console.log('[kanban.messageHandler.getExportDefaultFolder] Opened document from file path');
                    } catch (error) {
                        console.error('[kanban.messageHandler.getExportDefaultFolder] Failed to open document from file path:', error);
                    }
                }

                // If still no document, try active editor as last resort
                if (!document) {
                    const activeEditor = vscode.window.activeTextEditor;
                    console.log('[kanban.messageHandler.getExportDefaultFolder] Active editor:', activeEditor ? activeEditor.document.fileName : 'null');
                    if (activeEditor && activeEditor.document.fileName.endsWith('.md')) {
                        document = activeEditor.document;
                        console.log('[kanban.messageHandler.getExportDefaultFolder] Using active editor document as fallback');
                    }
                }
            }

            if (!document) {
                console.error('[kanban.messageHandler.getExportDefaultFolder] No document available for export');
                return;
            }

            const defaultFolder = ExportService.generateDefaultExportFolder(document.uri.fsPath);
            console.log('[kanban.messageHandler.getExportDefaultFolder] Generated default folder:', defaultFolder);
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
    private async handleSaveIndividualFile(filePath: string, isMainFile: boolean): Promise<void> {
        try {
            const panel = this._getWebviewPanel();
            if (!panel) {
                return;
            }

            if (isMainFile) {
                // Save the main kanban file by triggering the existing save mechanism
                await panel.saveToMarkdown();

                panel._panel.webview.postMessage({
                    type: 'individualFileSaved',
                    filePath: filePath,
                    isMainFile: true,
                    success: true
                });
            } else {
                // For include files, save the current content to disk
                const includeFileMap = (panel as any)._includeFiles;
                const includeFile = includeFileMap?.get(filePath);

                if (includeFile && includeFile.content) {
                    // Write the current content to disk
                    await (panel as any)._writeFileContent(filePath, includeFile.content);

                    // Update baseline to match saved content
                    includeFile.baseline = includeFile.content;
                    includeFile.hasUnsavedChanges = false;
                    includeFile.lastModified = Date.now();


                    panel._panel.webview.postMessage({
                        type: 'individualFileSaved',
                        filePath: filePath,
                        isMainFile: false,
                        success: true
                    });
                } else {
                    console.warn(`[MessageHandler] Include file not found or has no content: ${filePath}`);

                    panel._panel.webview.postMessage({
                        type: 'individualFileSaved',
                        filePath: filePath,
                        isMainFile: false,
                        success: false,
                        error: 'File not found or has no content'
                    });
                }
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
                // Reload the main file by refreshing from the document
                const document = this._fileManager.getDocument();
                if (document) {
                    await panel.loadMarkdownFile(document);
                }

                panel._panel.webview.postMessage({
                    type: 'individualFileReloaded',
                    filePath: filePath,
                    isMainFile: true,
                    success: true
                });
            } else {
                // For include files, reload content from disk
                const includeFileMap = (panel as any)._includeFiles;
                const includeFile = includeFileMap?.get(filePath);


                if (includeFile) {
                    try {
                        // Read fresh content from disk
                        const freshContent = await (panel as any)._readFileContent(filePath);

                        if (freshContent !== null) {
                            // Update content and reset baseline
                            includeFile.content = freshContent;
                            includeFile.baseline = freshContent;
                            includeFile.hasUnsavedChanges = false;
                            includeFile.hasExternalChanges = false; // Clear external changes flag
                            includeFile.isUnsavedInEditor = false; // Clear editor unsaved flag
                            includeFile.externalContent = undefined; // Clear external content
                            includeFile.lastModified = Date.now();


                            // Trigger webview refresh to show updated content
                            const document = this._fileManager.getDocument();
                            if (document) {
                                await panel.loadMarkdownFile(document);
                            }

                            panel._panel.webview.postMessage({
                                type: 'individualFileReloaded',
                                filePath: filePath,
                                isMainFile: false,
                                success: true
                            });
                        } else {
                            console.warn(`[MessageHandler] Could not read include file: ${filePath}`);

                            panel._panel.webview.postMessage({
                                type: 'individualFileReloaded',
                                filePath: filePath,
                                isMainFile: false,
                                success: false,
                                error: 'Could not read file from disk'
                            });
                        }
                    } catch (readError) {
                        console.error(`[MessageHandler] Error reading include file ${filePath}:`, readError);

                        panel._panel.webview.postMessage({
                            type: 'individualFileReloaded',
                            filePath: filePath,
                            isMainFile: false,
                            success: false,
                            error: readError instanceof Error ? readError.message : String(readError)
                        });
                    }
                } else {
                    console.warn(`[MessageHandler] Include file not tracked: ${filePath}`);

                    panel._panel.webview.postMessage({
                        type: 'individualFileReloaded',
                        filePath: filePath,
                        isMainFile: false,
                        success: false,
                        error: 'File not tracked'
                    });
                }
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
     * Handle updating column title after strikethrough deletion
     */
    private async handleUpdateColumnTitleFromStrikethroughDeletion(message: any): Promise<void> {
        const { columnId, newTitle } = message;

        try {
            const board = this._getCurrentBoard();
            if (!board) {
                console.error('🗑️ Backend: No current board available for strikethrough deletion');
                return;
            }


            // Content is already in markdown format from frontend
            const markdownTitle = newTitle;

            // Update the column title
            await this.performBoardAction(() =>
                this._boardOperations.editColumnTitle(board, columnId, markdownTitle)
            );


        } catch (error) {
            console.error('🗑️ Backend: Error updating column title from strikethrough deletion:', error);
            vscode.window.showErrorMessage('Failed to update column title');
        }
    }

    

    

    /**
     * Handle Marp export
     */
    /**
     * Handle get Marp themes request
     */
    private async handleGetMarpThemes(): Promise<void> {
        console.log('[kanban.messageHandler.handleGetMarpThemes] Starting to get Marp themes...');
        try {
            const themes = await MarpExportService.getAvailableThemes();
            console.log('[kanban.messageHandler.handleGetMarpThemes] Got themes:', themes);
            
            const panel = this._getWebviewPanel();
            console.log('[kanban.messageHandler.handleGetMarpThemes] Panel result:', panel);
            
            if (panel && panel._panel && panel._panel.webview) {
                const message = {
                    type: 'marpThemesAvailable',
                    themes: themes
                };
                console.log('[kanban.messageHandler.handleGetMarpThemes] Sending message:', message);
                
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
                console.log('[kanban.messageHandler.handleGetMarpThemes] Sending error message:', message);
                panel._panel.webview.postMessage(message);
            }
        }
    }

    /**
     * Handle poll for Marp themes (fallback mechanism)
     */
    private async handlePollMarpThemes(): Promise<void> {
        console.log('[kanban.messageHandler.handlePollMarpThemes] Polling for Marp themes...');
        try {
            // Check if we have cached themes from the previous attempt
            const cachedThemes = (globalThis as any).pendingMarpThemes;
            if (cachedThemes) {
                console.log('[kanban.messageHandler.handlePollMarpThemes] Found cached themes:', cachedThemes);
                
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
            console.log('[kanban.messageHandler.handlePollMarpThemes] Got fresh themes:', themes);
            
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
            console.error('[kanban.messageHandler.handleOpenInMarpPreview] Error:', error);
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

            const panel = this._getWebviewPanel();
            if (panel && panel._panel && panel._panel.webview) {
                panel._panel.webview.postMessage({
                    type: 'marpStatus',
                    extensionInstalled: marpExtensionStatus.installed,
                    extensionVersion: marpExtensionStatus.version,
                    cliAvailable: marpCliAvailable,
                    engineFileExists: engineFileExists
                });
            } else {
                console.error('[kanban.messageHandler.handleCheckMarpStatus] No webview panel available');
            }
        } catch (error) {
            console.error('[kanban.messageHandler.handleCheckMarpStatus] Error:', error);
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
            console.log('[kanban.messageHandler.handleStopAutoExport] Stopping auto-export');

            // Unregister from SaveEventCoordinator
            const doc = this._fileManager.getDocument();
            if (doc) {
                const coordinator = SaveEventCoordinator.getInstance();
                coordinator.unregisterHandler(`auto-export-${doc.uri.fsPath}`);
            }

            // Stop all Marp watch processes
            console.log('[kanban.messageHandler.handleStopAutoExport] Terminating Marp processes');
            MarpExportService.stopAllMarpWatches();

            this._autoExportSettings = null;

            console.log('[kanban.messageHandler.handleStopAutoExport] Auto-export stopped');

            // Notify frontend to hide the auto-export button
            const panel = this._getWebviewPanel();
            if (panel && panel.webview) {
                console.log('[kanban.messageHandler.handleStopAutoExport] Sending autoExportStopped message to frontend');
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
            console.log('[kanban.messageHandler.handleStopAutoExportForOtherKanbanFiles] Stopping auto-export for other kanban files, protecting current:', currentKanbanFilePath);
            if (protectExportedPath) {
                console.log('[kanban.messageHandler.handleStopAutoExportForOtherKanbanFiles] Also protecting exported file:', protectExportedPath);
            }

            // Unregister from SaveEventCoordinator
            const doc = this._fileManager.getDocument();
            if (doc) {
                const coordinator = SaveEventCoordinator.getInstance();
                coordinator.unregisterHandler(`auto-export-${doc.uri.fsPath}`);
            }

            // Stop Marp watch processes for OTHER files (not the current export)
            console.log('[kanban.messageHandler.handleStopAutoExportForOtherKanbanFiles] Terminating Marp processes (except current export)');
            if (protectExportedPath) {
                ExportService.stopAllMarpWatchesExcept(protectExportedPath);
            } else {
                MarpExportService.stopAllMarpWatches();
            }

            console.log('[kanban.messageHandler.handleStopAutoExportForOtherKanbanFiles] Auto-export stopped for other kanban files');
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
            console.log('[kanban.messageHandler.handleStopAutoExportForFile] Stopping auto-export, excluding:', excludeFilePath);

            // Unregister from SaveEventCoordinator
            const doc = this._fileManager.getDocument();
            if (doc) {
                const coordinator = SaveEventCoordinator.getInstance();
                coordinator.unregisterHandler(`auto-export-${doc.uri.fsPath}`);
            }

            // Stop all Marp watch processes
            console.log('[kanban.messageHandler.handleStopAutoExportForFile] Terminating Marp processes');
            MarpExportService.stopAllMarpWatches();

            this._autoExportSettings = null;

            console.log('[kanban.messageHandler.handleStopAutoExportForFile] Auto-export stopped for other files');
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
            console.log('[kanban.messageHandler.handleExport] Starting export with options:', JSON.stringify(options, null, 2));

            // Get document (with fallback to file path if document is closed)
            let document = this._fileManager.getDocument();
            if (!document) {
                const filePath = this._fileManager.getFilePath();
                if (filePath) {
                    try {
                        document = await vscode.workspace.openTextDocument(filePath);
                        console.log('[kanban.messageHandler.handleExport] Opened document from file path:', filePath);
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
                console.log('[kanban.messageHandler.handleExport] Copy mode - no progress bar');
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
                title: `Exporting ${options.scope}...`,
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

                // Open in browser if requested
                if (result.success && options.openAfterExport && result.exportedPath) {
                    console.log('[kanban.messageHandler.handleExport] Opening exported file:', result.exportedPath);
                    const uri = vscode.Uri.file(result.exportedPath);

                    if (result.exportedPath.endsWith('.html')) {
                        await vscode.env.openExternal(vscode.Uri.parse(uri.toString()));
                    } else {
                        await vscode.env.openExternal(uri);
                    }
                }

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
        console.log('[kanban.messageHandler.handleAutoExportMode] Starting auto-export');

        // Store settings
        this._autoExportSettings = options;

        // Get board for conversion exports
        const board = (options.format !== 'kanban' && !options.packAssets) ? this._getCurrentBoard() : undefined;

        // Do initial export FIRST (to start Marp if needed)
        console.log('[kanban.messageHandler.handleAutoExportMode] Running initial export...');
        const initialResult = await ExportService.export(document, options, board);
        console.log('[kanban.messageHandler.handleAutoExportMode] Initial export completed, path:', initialResult.exportedPath);

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
                    console.log('[kanban.messageHandler.autoExport] File saved');

                    // For Marp watch mode, update markdown only - Marp's watch will handle the rest
                    if (options.marpWatch) {
                        console.log('[kanban.messageHandler.autoExport] Marp watch active - updating markdown only, NOT restarting Marp');

                        try {
                            // Get fresh board for conversion
                            const boardForUpdate = (options.format !== 'kanban' && !options.packAssets) ? this._getCurrentBoard() : undefined;
                            // Export with marpWatch flag set - skips Marp conversion
                            await ExportService.export(savedDoc, options, boardForUpdate);
                            console.log('[kanban.messageHandler.autoExport] Markdown updated, Marp watch will auto-detect changes');
                        } catch (error) {
                            console.error('[kanban.messageHandler.autoExport] Markdown update failed:', error);
                        }
                        return;
                    }

                    console.log('[kanban.messageHandler.autoExport] Triggering full export...');

                    try {
                        // Get fresh board for conversion
                        const boardForExport = (options.format !== 'kanban' && !options.packAssets) ? this._getCurrentBoard() : undefined;
                        // Use new unified export
                        const result = await ExportService.export(savedDoc, options, boardForExport);

                        if (result.success && options.openAfterExport && result.exportedPath) {
                            const uri = vscode.Uri.file(result.exportedPath);
                            await vscode.env.openExternal(uri);
                        }

                        console.log('[kanban.messageHandler.autoExport] Auto-export completed');
                    } catch (error) {
                        console.error('[kanban.messageHandler.autoExport] Auto-export failed:', error);
                        vscode.window.showErrorMessage(`Auto-export failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
        };

        coordinator.registerHandler(handler);
        console.log('[kanban.messageHandler.handleAutoExportMode] Handler registered');
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
            console.log('[PlantUML Backend] Rendering diagram...');

            // Render using backend service (Java + PlantUML JAR)
            const svg = await this._plantUMLService.renderSVG(code);

            console.log('[PlantUML Backend] ✅ Diagram rendered successfully');

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

            console.log(`[PlantUML] Converted to SVG: ${svgFilePath}`);
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
        console.log('[PlantUML] replacePlantUMLWithSVG called');
        console.log('[PlantUML] PlantUML code length:', plantUMLCode.length);
        console.log('[PlantUML] PlantUML code:', plantUMLCode);
        console.log('[PlantUML] SVG path:', svgRelativePath);

        // Escape special regex characters in code, accounting for indentation
        const escapedCode = plantUMLCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Split the code into lines to handle per-line matching with indentation
        // NOTE: The frontend sends TRIMMED code, but the file may have indented code
        const codeLines = plantUMLCode.split('\n').filter(line => line.trim().length > 0);
        console.log('[PlantUML] Code has', codeLines.length, 'non-empty lines');
        const escapedLines = codeLines.map(line =>
            line.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
        // Each line can have any indentation, then the trimmed content
        const codePattern = escapedLines.map(line => '[ \\t]*' + line).join('\\s*\\n');

        // Create regex to match ```plantuml ... ``` block with any indentation
        const regexPattern = '([ \\t]*)```plantuml\\s*\\n' + codePattern + '\\s*\\n[ \\t]*```';
        console.log('[PlantUML] Testing regex match...');
        const regex = new RegExp(regexPattern, 'g');

        // Replace with custom function to preserve indentation
        let replacementCount = 0;
        let updatedContent = content.replace(regex, (_match, indent) => {
            replacementCount++;
            console.log('[PlantUML] Replacement #' + replacementCount + ', indent:', JSON.stringify(indent));

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
            console.log('[PlantUML] Trying fuzzy matching...');
            // Try fuzzy matching as fallback
            return this.replacePlantUMLWithSVGFuzzy(content, plantUMLCode, svgRelativePath);
        }

        console.log('[PlantUML] Replacement successful, count:', replacementCount);
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
            console.log(`[PlantUML] Found fuzzy match with ${(similarity * 100).toFixed(1)}% similarity`);

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

            console.log(`[Mermaid] Converted to SVG: ${svgFilePath}`);
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
        console.log('[Mermaid] replaceMermaidWithSVG called');
        console.log('[Mermaid] Mermaid code length:', mermaidCode.length);
        console.log('[Mermaid] Mermaid code:', mermaidCode);
        console.log('[Mermaid] SVG path:', svgRelativePath);

        // Escape special regex characters in code
        const escapedCode = mermaidCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Split the code into lines to handle per-line matching with indentation
        const codeLines = mermaidCode.split('\n').filter(line => line.trim().length > 0);
        console.log('[Mermaid] Code has', codeLines.length, 'non-empty lines');
        const escapedLines = codeLines.map(line =>
            line.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
        // Each line can have any indentation, then the trimmed content
        const codePattern = escapedLines.map(line => '[ \\t]*' + line).join('\\s*\\n');

        // Create regex to match ```mermaid ... ``` block with any indentation
        const regexPattern = '([ \\t]*)```mermaid\\s*\\n' + codePattern + '\\s*\\n[ \\t]*```';
        console.log('[Mermaid] Testing regex match...');
        const regex = new RegExp(regexPattern, 'g');

        // Replace with custom function to preserve indentation
        let replacementCount = 0;
        let updatedContent = content.replace(regex, (_match, indent) => {
            replacementCount++;
            console.log('[Mermaid] Replacement #' + replacementCount + ', indent:', JSON.stringify(indent));

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
            console.log('[Mermaid] Trying fuzzy matching...');
            // Try fuzzy matching as fallback
            return this.replaceMermaidWithSVGFuzzy(content, mermaidCode, svgRelativePath);
        }

        console.log('[Mermaid] Replacement successful, count:', replacementCount);
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
            console.log(`[Mermaid] Found fuzzy match with ${(similarity * 100).toFixed(1)}% similarity`);

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