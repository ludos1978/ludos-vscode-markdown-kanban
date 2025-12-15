import * as vscode from 'vscode';
import { MarkdownFile } from '../files/MarkdownFile';
import { IncludeLoadingProcessor } from './IncludeLoadingProcessor';
import { FileSaveService } from './FileSaveService';
import { BoardCrudOperations } from '../board/BoardCrudOperations';

// Re-export types from ChangeTypes for backwards compatibility
export {
    ChangeState,
    FileSystemChangeEvent,
    UserEditEvent,
    SaveEvent,
    IncludeSwitchEvent,
    ChangeEvent,
    ChangeContext,
    ChangeResult
} from './ChangeTypes';

// Import types for internal use
import {
    ChangeState,
    ChangeEvent,
    ChangeContext,
    ChangeResult
} from './ChangeTypes';

/**
 * Unified Change State Machine
 *
 * SINGLE ENTRY POINT for all file changes in the system.
 * Replaces multiple scattered entry points with one unified flow.
 *
 * Design Doc: See STATE_MACHINE_DESIGN.md
 *
 * All change sources route through: stateMachine.processChange(event)
 * - File system watchers
 * - User edit operations
 * - Save events
 * - Include switch operations
 */

// ============= STATE MACHINE =============

/**
 * Main State Machine Class
 *
 * Singleton that orchestrates all file change operations through
 * a unified state machine flow.
 */
export class ChangeStateMachine {
    private static instance: ChangeStateMachine;
    private _currentState: ChangeState = ChangeState.IDLE;
    private _currentContext?: ChangeContext;
    private _isProcessing: boolean = false;
    private _eventQueue: ChangeEvent[] = [];

    // Dependencies (injected)
    private _fileRegistry: any; // MarkdownFileRegistry
    private _webviewPanel: any; // KanbanWebviewPanel
    private _fileSaveService: FileSaveService;
    private _includeProcessor: IncludeLoadingProcessor | null = null;

    private constructor() {
        this._fileSaveService = FileSaveService.getInstance();
    }

    public static getInstance(): ChangeStateMachine {
        if (!ChangeStateMachine.instance) {
            ChangeStateMachine.instance = new ChangeStateMachine();
        }
        return ChangeStateMachine.instance;
    }

    /**
     * Initialize with dependencies
     */
    public initialize(fileRegistry: any, webviewPanel: any): void {
        this._fileRegistry = fileRegistry;
        this._webviewPanel = webviewPanel;
        this._includeProcessor = new IncludeLoadingProcessor({
            fileRegistry,
            webviewPanel
        });
    }

    /**
     * SINGLE ENTRY POINT for all changes
     *
     * All change sources MUST call this method:
     * - File system watcher → processChange({ type: 'file_system_change', ... })
     * - User edit handler → processChange({ type: 'user_edit', ... })
     * - Save coordinator → processChange({ type: 'save', ... })
     * - Include switcher → processChange({ type: 'include_switch', ... })
     */
    public async processChange(event: ChangeEvent): Promise<ChangeResult> {
        // If already processing, queue the event
        if (this._isProcessing) {
            this._eventQueue.push(event);
            const currentState = this._currentState;
            const currentEventType = this._currentContext?.event?.type || 'unknown';
            return {
                success: false,
                error: new Error(`Event queued - state machine busy (currentState: ${currentState}, processing: ${currentEventType}, queued: ${event.type})`),
                context: this._createEmptyContext(event),
                duration: 0
            };
        }

        this._isProcessing = true;

        try {
            // Create context for this change
            const context = this._createInitialContext(event);
            this._currentContext = context;

            // Start state machine from RECEIVING_CHANGE
            await this._transitionTo(ChangeState.RECEIVING_CHANGE, context);

            // State machine will automatically transition through all states
            // until reaching COMPLETE, CANCELLED, or ERROR

            // Return result
            const duration = Date.now() - context.startTime;
            return {
                success: context.result.success,
                error: context.result.error,
                context: context,
                duration: duration
            };

        } catch (error) {
            console.error('[ChangeStateMachine] Fatal error:', error);

            // CRITICAL: Clear flag on fatal error to prevent cache lock
            if (this._webviewPanel) {
                this._webviewPanel.setIncludeSwitchInProgress(false);
            }

            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
                context: this._currentContext || this._createEmptyContext(event),
                duration: Date.now() - (this._currentContext?.startTime || Date.now())
            };

        } finally {
            this._isProcessing = false;
            this._currentState = ChangeState.IDLE;
            this._currentContext = undefined;

            // Process next queued event if any
            if (this._eventQueue.length > 0) {
                const nextEvent = this._eventQueue.shift()!;
                setImmediate(() => this.processChange(nextEvent));
            }
        }
    }

    // ============= STATE TRANSITION ENGINE =============

    /**
     * Transition to a new state and execute its handler
     */
    private async _transitionTo(newState: ChangeState, context: ChangeContext): Promise<void> {
        this._currentState = newState;
        context.currentState = newState;
        context.stateHistory.push(newState);

        // Execute state handler
        try {
            const nextState = await this._executeStateHandler(newState, context);

            // Automatically transition to next state if returned
            if (nextState && nextState !== ChangeState.IDLE) {
                await this._transitionTo(nextState, context);
            }

        } catch (error) {
            console.error(`[ChangeStateMachine] Error in state ${newState}:`, error);
            context.result.success = false;
            context.result.error = error instanceof Error ? error : new Error(String(error));
            await this._transitionTo(ChangeState.ERROR, context);
        }
    }

    /**
     * Execute the handler for a specific state
     * Returns the next state to transition to, or null to stay in current state
     */
    private async _executeStateHandler(state: ChangeState, context: ChangeContext): Promise<ChangeState | null> {
        switch (state) {
            case ChangeState.RECEIVING_CHANGE:
                return await this._handleReceivingChange(context);

            case ChangeState.ANALYZING_IMPACT:
                return await this._handleAnalyzingImpact(context);

            case ChangeState.CHECKING_EDIT_STATE:
                return await this._handleCheckingEditState(context);

            case ChangeState.CAPTURING_EDIT:
                return await this._handleCapturingEdit(context);

            case ChangeState.CHECKING_UNSAVED:
                return await this._handleCheckingUnsaved(context);

            case ChangeState.PROMPTING_USER:
                return await this._handlePromptingUser(context);

            case ChangeState.SAVING_UNSAVED:
                return await this._handleSavingUnsaved(context);

            case ChangeState.CLEARING_CACHE:
                return await this._handleClearingCache(context);

            case ChangeState.LOADING_NEW:
                return await this._handleLoadingNew(context);

            case ChangeState.UPDATING_BACKEND:
                return await this._handleUpdatingBackend(context);

            case ChangeState.SYNCING_FRONTEND:
                return await this._handleSyncingFrontend(context);

            case ChangeState.COMPLETE:
                return await this._handleComplete(context);

            case ChangeState.CANCELLED:
                return await this._handleCancelled(context);

            case ChangeState.ERROR:
                return await this._handleError(context);

            default:
                throw new Error(`Unknown state: ${state}`);
        }
    }

    // ============= STATE HANDLERS =============

    private async _handleReceivingChange(context: ChangeContext): Promise<ChangeState> {
        // Event already captured in context during creation
        return ChangeState.ANALYZING_IMPACT;
    }

    private async _handleAnalyzingImpact(context: ChangeContext): Promise<ChangeState> {

        const event = context.event;

        // Analyze impact based on event type
        if (event.type === 'file_system_change') {
            const file = event.file;
            const fileType = file.getFileType();

            context.impact.mainFileChanged = fileType === 'main';
            context.impact.includeFilesChanged = fileType !== 'main';
            context.impact.includesSwitched = false;
            context.impact.affectedFiles = [file];

        } else if (event.type === 'include_switch') {
            context.impact.mainFileChanged = false;
            context.impact.includeFilesChanged = false;
            context.impact.includesSwitched = true;

            // Calculate files being unloaded
            const oldFiles = event.oldFiles.map(path =>
                this._fileRegistry.getByRelativePath(path)
            ).filter(f => f !== undefined);

            context.impact.affectedFiles = oldFiles;

            // Store switch info in context
            context.switches.oldFiles = event.oldFiles;
            context.switches.newFiles = event.newFiles;
            context.switches.unloadingFiles = event.oldFiles.filter(
                old => !event.newFiles.includes(old)
            );
            context.switches.loadingFiles = event.newFiles.filter(
                nf => !event.oldFiles.includes(nf)
            );

        } else if (event.type === 'user_edit') {
            context.impact.mainFileChanged = true;
            context.impact.includeFilesChanged = false;
            context.impact.includesSwitched = !!event.params.includeSwitch;

            const mainFile = this._fileRegistry.getMainFile();
            context.impact.affectedFiles = mainFile ? [mainFile] : [];

            if (event.params.includeSwitch) {
                // Also an include switch
                context.switches.oldFiles = event.params.includeSwitch.oldFiles;
                context.switches.newFiles = event.params.includeSwitch.newFiles;
                context.switches.unloadingFiles = context.switches.oldFiles.filter(
                    old => !context.switches.newFiles.includes(old)
                );
                context.switches.loadingFiles = context.switches.newFiles.filter(
                    nf => !context.switches.oldFiles.includes(nf)
                );
            }

        } else if (event.type === 'save') {
            const file = event.file;
            const fileType = file.getFileType();

            context.impact.mainFileChanged = fileType === 'main';
            context.impact.includeFilesChanged = fileType !== 'main';
            context.impact.includesSwitched = false;
            context.impact.affectedFiles = [file];
        }

        return ChangeState.CHECKING_EDIT_STATE;
    }

    private async _handleCheckingEditState(context: ChangeContext): Promise<ChangeState> {
        // Check if user is currently editing any affected files
        let isEditing = false;
        let editedFile: MarkdownFile | undefined;

        for (const file of context.impact.affectedFiles) {
            if ((file as any)._isInEditMode) {
                isEditing = true;
                editedFile = file;
                break;
            }
        }

        // Also check if webview panel indicates editing in progress
        if (this._webviewPanel && this._webviewPanel.isEditingInProgress && this._webviewPanel.isEditingInProgress()) {
            isEditing = true;
        }

        context.editCapture = {
            wasEditing: isEditing,
            editedFile: editedFile
        };

        if (isEditing) {
            return ChangeState.CAPTURING_EDIT;
        } else {
            return ChangeState.CHECKING_UNSAVED;
        }
    }

    private async _handleCapturingEdit(context: ChangeContext): Promise<ChangeState> {
        // Request the file registry to stop editing and capture the value
        if (this._fileRegistry && this._fileRegistry.requestStopEditing) {
            try {
                const capturedEdit = await this._fileRegistry.requestStopEditing();

                if (capturedEdit && capturedEdit.value !== undefined) {
                    context.editCapture!.capturedValue = capturedEdit;

                    // Apply to baseline of the edited file
                    if (context.editCapture!.editedFile) {
                        const file = context.editCapture!.editedFile;
                        if ((file as any).applyEditToBaseline) {
                            await (file as any).applyEditToBaseline(capturedEdit);
                        }
                    }
                }
            } catch (error) {
                console.error(`[State:CAPTURING_EDIT] Error capturing edit:`, error);
                // Continue anyway - don't block the flow
            }
        }

        return ChangeState.CHECKING_UNSAVED;
    }

    private async _handleCheckingUnsaved(context: ChangeContext): Promise<ChangeState> {
        // Only check if includes are being switched
        if (!context.impact.includesSwitched) {
            return ChangeState.CLEARING_CACHE;
        }

        // Get files being unloaded
        const unloadingFiles = context.switches.unloadingFiles;

        if (unloadingFiles.length === 0) {
            return ChangeState.CLEARING_CACHE;
        }

        // Check each unloading file for unsaved changes
        const unsavedFiles: MarkdownFile[] = [];

        for (const relativePath of unloadingFiles) {
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file && file.hasUnsavedChanges()) {
                unsavedFiles.push(file);
            }
        }

        if (unsavedFiles.length === 0) {
            return ChangeState.CLEARING_CACHE;
        }

        context.unsaved.files = unsavedFiles;

        return ChangeState.PROMPTING_USER;
    }

    private async _handlePromptingUser(context: ChangeContext): Promise<ChangeState> {
        const unsavedFiles = context.unsaved.files;
        const fileList = unsavedFiles.map(f => f.getRelativePath()).join('\n');

        // Show VSCode dialog with Save/Discard/Cancel options
        const choice = await vscode.window.showWarningMessage(
            `The following include files have unsaved changes:\n${fileList}\n\nDo you want to save them before unloading?`,
            { modal: true },
            'Save',
            'Discard',
            'Cancel'
        );

        // Store choice in context
        if (choice === 'Save') {
            context.unsaved.userChoice = 'save';
            return ChangeState.SAVING_UNSAVED;
        } else if (choice === 'Discard') {
            context.unsaved.userChoice = 'discard';
            return ChangeState.CLEARING_CACHE;
        } else {
            // User clicked Cancel or closed dialog
            context.unsaved.userChoice = 'cancel';
            return ChangeState.CANCELLED;
        }
    }

    private async _handleSavingUnsaved(context: ChangeContext): Promise<ChangeState> {
        const unsavedFiles = context.unsaved.files;

        for (const file of unsavedFiles) {
            try {
                await this._fileSaveService.saveFile(file);
                context.result.updatedFiles.push(file.getRelativePath());
            } catch (error) {
                console.error(`[State:SAVING_UNSAVED] Error saving ${file.getRelativePath()}:`, error);
                // Continue with other files even if one fails
            }
        }

        return ChangeState.CLEARING_CACHE;
    }

    private async _handleClearingCache(context: ChangeContext): Promise<ChangeState> {
        // Only clear cache if includes are being switched
        if (!context.impact.includesSwitched) {
            return ChangeState.LOADING_NEW;
        }

        const unloadingFiles = context.switches.unloadingFiles;
        const board = this._webviewPanel?.getBoard();

        if (!board) {
            return ChangeState.LOADING_NEW;
        }

        // Clear backend cache for unloading files
        for (const relativePath of unloadingFiles) {
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file) {
                // Discard any uncommitted changes (revert to baseline/disk)
                file.discardChanges();
            }
        }

        // Clear frontend cache based on event type
        const event = context.event;

        // Get panel for immediate frontend updates
        const panel = this._webviewPanel?.getPanel();

        if (event.type === 'include_switch') {
            if (event.target === 'column') {
                // Column include switch - clear column tasks
                const column = BoardCrudOperations.findColumnById(board, event.targetId);
                if (column) {
                    column.tasks = [];
                    column.includeFiles = [];
                    column.includeMode = false;

                    // Immediately update frontend to show empty column
                    if (panel) {
                        panel.webview.postMessage({
                            type: 'updateColumnContent',
                            columnId: column.id,
                            columnTitle: column.title,
                            displayTitle: column.displayTitle,
                            tasks: [],
                            includeMode: false,
                            includeFiles: [],
                            isLoadingContent: true
                        });
                    }
                }
            } else if (event.target === 'task') {
                // Task include switch - clear task description
                const column = event.columnIdForTask ? BoardCrudOperations.findColumnById(board, event.columnIdForTask) : undefined;
                const task = column?.tasks.find(t => t.id === event.targetId);
                if (task && column) {
                    task.includeFiles = [];
                    task.displayTitle = '';
                    task.description = '';
                    task.includeMode = false;

                    // Immediately update frontend to show empty task
                    if (panel) {
                        panel.webview.postMessage({
                            type: 'updateTaskContent',
                            columnId: column.id,
                            taskId: task.id,
                            description: '',
                            displayTitle: '',
                            taskTitle: task.title,
                            originalTitle: task.originalTitle,
                            includeMode: false,
                            includeFiles: [],
                            isLoadingContent: true
                        });
                    }
                }
            }
        } else if (event.type === 'user_edit' && event.params.includeSwitch) {
            // User edit with include switch - determine target from edit type
            if (event.editType === 'column_title') {
                const column = event.params.columnId ? BoardCrudOperations.findColumnById(board, event.params.columnId) : undefined;
                if (column) {
                    column.tasks = [];
                    column.includeFiles = [];
                    column.includeMode = false;

                    // Immediately update frontend to show empty column
                    if (panel) {
                        panel.webview.postMessage({
                            type: 'updateColumnContent',
                            columnId: column.id,
                            columnTitle: column.title,
                            displayTitle: column.displayTitle,
                            tasks: [],
                            includeMode: false,
                            includeFiles: [],
                            isLoadingContent: true
                        });
                    }
                }
            } else if (event.editType === 'task_title') {
                const column = event.params.taskId ? BoardCrudOperations.findColumnContainingTask(board, event.params.taskId) : undefined;
                const task = event.params.taskId ? column?.tasks.find(t => t.id === event.params.taskId) : undefined;
                if (task && column) {
                    task.includeFiles = [];
                    task.displayTitle = '';
                    task.description = '';
                    task.includeMode = false;

                    // Immediately update frontend to show empty task
                    if (panel) {
                        panel.webview.postMessage({
                            type: 'updateTaskContent',
                            columnId: column.id,
                            taskId: task.id,
                            description: '',
                            displayTitle: '',
                            taskTitle: task.title,
                            originalTitle: task.originalTitle,
                            includeMode: false,
                            includeFiles: [],
                            isLoadingContent: true
                        });
                    }
                }
            }
        }

        return ChangeState.LOADING_NEW;
    }

    private async _handleLoadingNew(context: ChangeContext): Promise<ChangeState> {
        // CRITICAL FIX: Set flag to block cache invalidation during include switch
        if (context.impact.includesSwitched && this._webviewPanel) {
            this._webviewPanel.setIncludeSwitchInProgress(true);
        }

        // Only load new files if includes are being switched
        if (!context.impact.includesSwitched) {
            return ChangeState.UPDATING_BACKEND;
        }

        // Get board and store in context (prevents stale board after cache invalidation)
        const board = this._webviewPanel?.getBoard();
        context.modifiedBoard = board;

        if (!board || !this._includeProcessor) {
            return ChangeState.UPDATING_BACKEND;
        }

        const event = context.event;
        const loadingFiles = context.switches.loadingFiles;

        // Resolve target column/task
        const target = this._includeProcessor.resolveTarget(event as any, board);
        if (!target.found) {
            console.error(`[State:LOADING_NEW] Could not find target column/task`);
            return ChangeState.UPDATING_BACKEND;
        }

        const { targetColumn, targetTask, isColumnSwitch } = target;

        // Update title if provided in event
        this._includeProcessor.updateTargetTitle(event as any, targetColumn, targetTask, isColumnSwitch);

        // Handle empty loadingFiles (removal or already-loaded)
        if (loadingFiles.length === 0) {
            const newFiles = context.switches.newFiles;

            if (newFiles.length === 0) {
                // TRUE REMOVAL: user removed all includes
                this._includeProcessor.handleIncludeRemoval(targetColumn, targetTask, isColumnSwitch);
            } else {
                // ALREADY LOADED: restore from loaded files
                this._includeProcessor.handleAlreadyLoadedIncludes(
                    event as any, targetColumn, targetTask, isColumnSwitch, newFiles
                );
            }

            return ChangeState.UPDATING_BACKEND;
        }

        // Load new include files
        if (isColumnSwitch && targetColumn) {
            await this._includeProcessor.loadColumnIncludes(event as any, targetColumn, loadingFiles, context);
        } else if (targetTask && targetColumn) {
            // Task includes require both targetTask and targetColumn (task belongs to column)
            await this._includeProcessor.loadTaskInclude(event as any, targetColumn, targetTask, loadingFiles, context);
        }

        return ChangeState.UPDATING_BACKEND;
    }

    private async _handleUpdatingBackend(context: ChangeContext): Promise<ChangeState> {
        // Sync file registry (create instances for new files)
        if (this._webviewPanel && this._webviewPanel.syncIncludeFilesWithBoard) {
            try {
                const board = this._webviewPanel.getBoard();
                if (board) {
                    this._webviewPanel.syncIncludeFilesWithBoard(board);
                }
            } catch (error) {
                console.error(`[State:UPDATING_BACKEND] Error syncing file registry:`, error);
            }
        }

        // CRITICAL FIX: Update MainKanbanFile content when includes are modified
        // This ensures that removing a column include updates the file's markdown content
        if (context.impact.includesSwitched || context.impact.mainFileChanged) {
            const mainFile = this._fileRegistry.getMainFile();
            const board = context.modifiedBoard || this._webviewPanel?.getBoard();

            if (mainFile && board) {
                mainFile.updateFromBoard(board);
            }
        }

        // Mark main file as having unsaved changes if user made edits
        if (context.impact.mainFileChanged && context.event.type === 'user_edit') {
            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile) {
                // The file's internal state already reflects the change
                // No need to explicitly mark it - setContent() already did that
            }
        }

        // CRITICAL FIX: Sync board to backend for include switches
        // When an include file is switched, the task/column title in the main file
        // changes (e.g., !!!include(old.md)!!! -> !!!include(new.md)!!!), so the
        // main file content needs to be updated for unsaved detection
        if (context.impact.includesSwitched) {
            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile && this._webviewPanel) {
                // Get current board and sync to backend (updates _content for unsaved detection)
                const board = this._webviewPanel.getBoard?.();
                if (board && this._webviewPanel.syncBoardToBackend) {
                    this._webviewPanel.syncBoardToBackend(board);
                }
            }
        }

        // Invalidate board cache if needed
        // CRITICAL: Don't invalidate for include switches - board is already updated in-memory
        // Cache MUST stay in sync with UI. Disk will be out of sync until user saves (that's OK).
        // DEFENSE IN DEPTH: Event type check prevents the call, _includeSwitchInProgress flag blocks if called
        if (context.event.type !== 'include_switch' && this._webviewPanel && this._webviewPanel.invalidateBoardCache) {
            this._webviewPanel.invalidateBoardCache();
        }

        return ChangeState.SYNCING_FRONTEND;
    }

    private async _handleSyncingFrontend(context: ChangeContext): Promise<ChangeState> {
        // Only send updates if we have a webview panel
        if (!this._webviewPanel) {
            return ChangeState.COMPLETE;
        }

        const panel = this._webviewPanel.getPanel();
        const event = context.event;

        // CRITICAL FIX: Use the modified board from context instead of calling getBoard()
        // After cache invalidation, getBoard() would regenerate from disk with stale data
        const board = context.modifiedBoard || this._webviewPanel.getBoard();

        if (!board) {
            return ChangeState.COMPLETE;
        }

        // Determine what type of update to send based on event type and impact
        if (context.impact.includesSwitched) {
            this._sendIncludeSwitchUpdate(panel, board, event, context);
        } else if (context.impact.mainFileChanged && event.type === 'file_system_change') {
            // Main file changed externally - send full board refresh
            if (this._webviewPanel.refreshWebviewContent) {
                await this._webviewPanel.refreshWebviewContent();
                context.result.frontendMessages.push({ type: 'fullBoardRefresh' });
            }
        } else if (context.impact.includeFilesChanged && event.type === 'file_system_change') {
            // Include file changed - handled autonomously by file instance
            context.result.frontendMessages.push({ type: 'autonomousFileUpdate' });
        } else if (event.type === 'user_edit' || event.type === 'save') {
            // No frontend update needed
            context.result.frontendMessages.push({ type: 'noUpdateNeeded' });
        }

        return ChangeState.COMPLETE;
    }

    /**
     * Send appropriate update for include switch events
     */
    private _sendIncludeSwitchUpdate(
        panel: any,
        board: any,
        event: ChangeEvent,
        context: ChangeContext
    ): void {
        if (event.type === 'include_switch') {
            if (event.target === 'column') {
                const column = BoardCrudOperations.findColumnById(board, event.targetId);
                if (column) {
                    this._sendColumnUpdate(panel, column, context);
                }
            } else if (event.target === 'task') {
                const column = event.columnIdForTask ? BoardCrudOperations.findColumnById(board, event.columnIdForTask) : undefined;
                const task = column?.tasks.find(t => t.id === event.targetId);
                if (task && column) {
                    this._sendTaskUpdate(panel, column, task, context);
                }
            }
        } else if (event.type === 'user_edit' && event.params.includeSwitch) {
            if (event.editType === 'column_title') {
                const column = event.params.columnId ? BoardCrudOperations.findColumnById(board, event.params.columnId) : undefined;
                if (column) {
                    this._sendColumnUpdate(panel, column, context);
                }
            } else if (event.editType === 'task_title') {
                const column = event.params.taskId ? BoardCrudOperations.findColumnContainingTask(board, event.params.taskId) : undefined;
                const task = event.params.taskId ? column?.tasks.find(t => t.id === event.params.taskId) : undefined;
                if (task && column) {
                    this._sendTaskUpdate(panel, column, task, context);
                }
            }
        }
    }

    private async _handleComplete(context: ChangeContext): Promise<ChangeState> {
        // CRITICAL FIX: Clear cache protection flag after include switch completes
        // This allows cache invalidation to work normally again
        if (context.impact.includesSwitched && this._webviewPanel) {
            this._webviewPanel.setIncludeSwitchInProgress(false);
        }

        context.result.success = true;
        return ChangeState.IDLE;
    }

    private async _handleCancelled(context: ChangeContext): Promise<ChangeState> {
        // Clear cache protection flag in case it was set
        if (this._webviewPanel) {
            this._webviewPanel.setIncludeSwitchInProgress(false);
        }

        context.result.success = false;
        context.result.error = new Error('USER_CANCELLED');
        return ChangeState.IDLE;
    }

    private async _handleError(context: ChangeContext): Promise<ChangeState> {
        console.error(`[State:ERROR] ❌ Error during change processing:`, context.result.error);
        console.error(`[State:ERROR] State history: ${context.stateHistory.join(' → ')}`);
        console.error(`[State:ERROR] Event type: ${context.event.type}`);

        // Perform rollback if we have saved state
        if (context.rollback && this._webviewPanel) {
            const panel = this._webviewPanel.getPanel();
            const board = this._webviewPanel.getBoard();

            if (board) {
                this._performRollback(panel, board, context);
            }
        }

        // Show error dialog to user with warning about rollback
        const errorMessage = context.result.error?.message || 'Unknown error';
        const rollbackMsg = context.rollback ? ' The operation has been undone.' : '';

        await vscode.window.showWarningMessage(
            `${errorMessage}${rollbackMsg}`,
            { modal: false },
            'OK'
        );

        console.error(`[ChangeStateMachine] Error: ${context.result.error}`);

        // Clear cache protection flag in case it was set
        if (this._webviewPanel) {
            this._webviewPanel.setIncludeSwitchInProgress(false);
        }

        // Mark result as failed
        context.result.success = false;

        return ChangeState.IDLE;
    }

    // ============= HELPER METHODS =============

    /**
     * Find where a file is currently included in the board
     * @param board The kanban board
     * @param relativePath Path of the file to search for
     * @param excludeColumnId Exclude this column from search (current target)
     * @param excludeTaskId Exclude this task from search (current target)
     * @returns Location info if found, undefined otherwise
     */
    private _findFileIncludeLocation(
        board: any,
        relativePath: string,
        excludeColumnId?: string,
        excludeTaskId?: string
    ): { type: 'column' | 'task'; columnTitle: string; taskTitle?: string } | undefined {
        // Check all columns for this include file
        for (const column of board.columns) {
            // Skip the target column if specified
            if (excludeColumnId && column.id === excludeColumnId) {
                continue;
            }

            // Check if column includes this file
            if (column.includeFiles && column.includeFiles.includes(relativePath)) {
                return {
                    type: 'column',
                    columnTitle: column.title
                };
            }

            // Check all tasks in this column
            for (const task of column.tasks) {
                // Skip the target task if specified
                if (excludeTaskId && task.id === excludeTaskId) {
                    continue;
                }

                // Check if task includes this file
                if (task.includeFiles && task.includeFiles.includes(relativePath)) {
                    return {
                        type: 'task',
                        columnTitle: column.title,
                        taskTitle: task.title
                    };
                }
            }
        }

        return undefined;
    }

    /**
     * Send column update message to frontend
     */
    private _sendColumnUpdate(
        panel: any,
        column: any,
        context: ChangeContext
    ): void {
        panel.webview.postMessage({
            type: 'updateColumnContent',
            columnId: column.id,
            columnTitle: column.title,
            displayTitle: column.displayTitle,
            tasks: column.tasks,
            includeMode: column.includeMode,
            includeFiles: column.includeFiles,
            isLoadingContent: false
        });
        context.result.frontendMessages.push({ type: 'updateColumnContent', columnId: column.id });

        // Clear dirty flag
        if (this._webviewPanel?.clearColumnDirty) {
            this._webviewPanel.clearColumnDirty(column.id);
        }
    }

    /**
     * Send task update message to frontend
     */
    private _sendTaskUpdate(
        panel: any,
        column: any,
        task: any,
        context: ChangeContext
    ): void {
        panel.webview.postMessage({
            type: 'updateTaskContent',
            columnId: column.id,
            taskId: task.id,
            description: task.description,
            displayTitle: task.displayTitle,
            taskTitle: task.title,
            originalTitle: task.originalTitle,
            includeMode: task.includeMode,
            includeFiles: task.includeFiles,
            isLoadingContent: false
        });
        context.result.frontendMessages.push({ type: 'updateTaskContent', taskId: task.id });

        // Clear dirty flag
        if (this._webviewPanel?.clearTaskDirty) {
            this._webviewPanel.clearTaskDirty(task.id);
        }
    }

    /**
     * Perform rollback on error - restore state and notify frontend
     */
    private _performRollback(panel: any, board: any, context: ChangeContext): void {
        const rollback = context.rollback!;

        if (rollback.columnId) {
            const column = BoardCrudOperations.findColumnById(board, rollback.columnId);
            if (column) {
                // Restore backend board state
                column.title = rollback.oldState.title || column.title;
                column.displayTitle = rollback.oldState.displayTitle || column.displayTitle;
                column.tasks = rollback.oldState.tasks || [];
                column.includeFiles = rollback.oldState.includeFiles || [];
                column.includeMode = rollback.oldState.includeMode || false;

                // Send update to frontend
                this._sendColumnUpdate(panel, column, context);
            }
        } else if (rollback.taskId && rollback.taskColumnId) {
            const column = BoardCrudOperations.findColumnById(board, rollback.taskColumnId);
            const task = column?.tasks.find(t => t.id === rollback.taskId);

            if (task && column) {
                // Restore backend board state
                task.title = rollback.oldState.title || task.title;
                task.description = rollback.oldState.description || '';
                task.displayTitle = rollback.oldState.displayTitle || '';
                task.includeFiles = rollback.oldState.includeFiles || [];
                task.includeMode = rollback.oldState.includeMode || false;

                // Send update to frontend
                this._sendTaskUpdate(panel, column, task, context);
            }
        }
    }

    // ============= CONTEXT MANAGEMENT =============

    private _createInitialContext(event: ChangeEvent): ChangeContext {
        return {
            event: event,
            impact: {
                mainFileChanged: false,
                includeFilesChanged: false,
                includesSwitched: false,
                affectedFiles: []
            },
            unsaved: {
                files: []
            },
            switches: {
                oldFiles: [],
                newFiles: [],
                unloadingFiles: [],
                loadingFiles: []
            },
            result: {
                success: false,
                updatedFiles: [],
                frontendMessages: []
            },
            startTime: Date.now(),
            currentState: ChangeState.IDLE,
            stateHistory: []
        };
    }

    private _createEmptyContext(event: ChangeEvent): ChangeContext {
        return this._createInitialContext(event);
    }
}
