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
    ChangeResult,
    IncludeSwitchEvent,
    UserEditEvent,
    IFileRegistryForStateMachine,
    IWebviewPanelForStateMachine
} from './ChangeTypes';
import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';

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
 * Per-panel instance that orchestrates all file change operations through
 * a unified state machine flow.
 *
 * NOTE: NOT a singleton - each panel must create its own instance to avoid
 * cross-panel data contamination when multiple boards are open.
 */
export class ChangeStateMachine {
    private _currentState: ChangeState = ChangeState.IDLE;
    private _currentContext?: ChangeContext;
    private _isProcessing: boolean = false;
    private _eventQueue: ChangeEvent[] = [];

    // Dependencies (injected via constructor)
    private _fileRegistry: IFileRegistryForStateMachine;
    private _webviewPanel: IWebviewPanelForStateMachine;
    private _fileSaveService: FileSaveService;
    private _includeProcessor: IncludeLoadingProcessor;

    /**
     * Create a new ChangeStateMachine for a specific panel.
     * Each panel must have its own instance to prevent cross-panel contamination.
     */
    constructor(fileRegistry: IFileRegistryForStateMachine, webviewPanel: IWebviewPanelForStateMachine) {
        this._fileRegistry = fileRegistry;
        this._webviewPanel = webviewPanel;
        this._fileSaveService = FileSaveService.getInstance();
        // Cast to concrete types for IncludeLoadingProcessor which needs full implementations
        this._includeProcessor = new IncludeLoadingProcessor({
            fileRegistry: fileRegistry as unknown as import('../files/MarkdownFileRegistry').MarkdownFileRegistry,
            webviewPanel: webviewPanel as unknown as import('./IncludeLoadingProcessor').IWebviewPanelForProcessor
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

    private async _handleReceivingChange(_context: ChangeContext): Promise<ChangeState> {
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
            const oldFiles = this._fileRegistry
                ? event.oldFiles.map(path =>
                    this._fileRegistry!.getByRelativePath(path)
                  ).filter((f): f is MarkdownFile => f !== undefined)
                : [];

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

            const mainFile = this._fileRegistry?.getMainFile();
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
            if (file.isInEditMode()) {
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
                        await file.applyEditToBaseline(capturedEdit);
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
            const file = this._fileRegistry?.getByRelativePath(relativePath);
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
            const file = this._fileRegistry?.getByRelativePath(relativePath);
            if (file) {
                // Discard any uncommitted changes (revert to baseline/disk)
                file.discardChanges();
            }
        }

        // Clear frontend cache based on event type
        const event = context.event;
        const panel = this._webviewPanel?.getPanel();
        if (!panel) {
            return ChangeState.LOADING_NEW;
        }

        // Find and clear the target (column or task)
        const target = this._findClearingTarget(board, event);
        if (!target) {
            return ChangeState.LOADING_NEW;
        }

        // Clear backend state and send loading update to frontend
        if (target.type === 'column') {
            target.column.tasks = [];
            target.column.includeFiles = [];
            target.column.includeMode = false;
            this._sendColumnUpdate(panel, target.column, null, true);
        } else {
            target.task.includeFiles = [];
            target.task.displayTitle = '';
            target.task.description = '';
            target.task.includeMode = false;
            this._sendTaskUpdate(panel, target.column, target.task, null, true);
        }

        return ChangeState.LOADING_NEW;
    }

    /**
     * Find the target (column or task) for cache clearing based on event type
     */
    private _findClearingTarget(board: KanbanBoard, event: ChangeEvent):
        { type: 'column'; column: KanbanColumn } |
        { type: 'task'; column: KanbanColumn; task: KanbanTask } |
        null {

        if (event.type === 'include_switch') {
            if (event.target === 'column') {
                const column = BoardCrudOperations.findColumnById(board, event.targetId);
                return column ? { type: 'column', column } : null;
            } else if (event.target === 'task') {
                const column = event.columnIdForTask ? BoardCrudOperations.findColumnById(board, event.columnIdForTask) : undefined;
                const task = column?.tasks.find(t => t.id === event.targetId);
                return task && column ? { type: 'task', column, task } : null;
            }
        } else if (event.type === 'user_edit' && event.params.includeSwitch) {
            if (event.editType === 'column_title') {
                const column = event.params.columnId ? BoardCrudOperations.findColumnById(board, event.params.columnId) : undefined;
                return column ? { type: 'column', column } : null;
            } else if (event.editType === 'task_title') {
                const column = event.params.taskId ? BoardCrudOperations.findColumnContainingTask(board, event.params.taskId) : undefined;
                const task = event.params.taskId ? column?.tasks.find(t => t.id === event.params.taskId) : undefined;
                return task && column ? { type: 'task', column, task } : null;
            }
        }
        return null;
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

        // This handler is only called for include_switch and user_edit events
        // Assert the narrower type for the include processor methods
        const event = context.event as IncludeSwitchEvent | UserEditEvent;
        const loadingFiles = context.switches.loadingFiles;

        // Resolve target column/task
        const target = this._includeProcessor.resolveTarget(event, board);
        if (!target.found) {
            console.error(`[State:LOADING_NEW] Could not find target column/task`);
            return ChangeState.UPDATING_BACKEND;
        }

        const { targetColumn, targetTask, isColumnSwitch } = target;

        // Update title if provided in event
        this._includeProcessor.updateTargetTitle(event, targetColumn, targetTask, isColumnSwitch);

        // Handle empty loadingFiles (removal or already-loaded)
        if (loadingFiles.length === 0) {
            const newFiles = context.switches.newFiles;

            if (newFiles.length === 0) {
                // TRUE REMOVAL: user removed all includes
                this._includeProcessor.handleIncludeRemoval(targetColumn, targetTask, isColumnSwitch);
            } else {
                // ALREADY LOADED: restore from loaded files
                this._includeProcessor.handleAlreadyLoadedIncludes(
                    event, targetColumn, targetTask, isColumnSwitch, newFiles
                );
            }

            return ChangeState.UPDATING_BACKEND;
        }

        // Load new include files
        if (isColumnSwitch && targetColumn) {
            await this._includeProcessor.loadColumnIncludes(event, targetColumn, loadingFiles, context);
        } else if (targetTask && targetColumn) {
            // Task includes require both targetTask and targetColumn (task belongs to column)
            await this._includeProcessor.loadTaskInclude(event, targetColumn, targetTask, loadingFiles, context);
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
            const mainFile = this._fileRegistry?.getMainFile();
            const board = context.modifiedBoard || this._webviewPanel?.getBoard();

            if (mainFile && board && 'updateFromBoard' in mainFile) {
                (mainFile as import('../files/MainKanbanFile').MainKanbanFile).updateFromBoard(board);
            }
        }

        // Mark main file as having unsaved changes if user made edits
        if (context.impact.mainFileChanged && context.event.type === 'user_edit') {
            const mainFile = this._fileRegistry?.getMainFile();
            if (mainFile) {
                // The file's internal state already reflects the change
                // No need to explicitly mark it - setContent() already did that
            }
        }

        // CRITICAL FIX: Emit board:changed event for include switches
        // When an include file is switched, the task/column title in the main file
        // changes (e.g., !!!include(old.md)!!! -> !!!include(new.md)!!!), so the
        // main file content needs to be updated for unsaved detection
        if (context.impact.includesSwitched) {
            const mainFile = this._fileRegistry?.getMainFile();
            if (mainFile && this._webviewPanel) {
                // Get current board and emit change event (triggers BoardSyncHandler)
                const board = this._webviewPanel.getBoard?.();
                if (board && this._webviewPanel.emitBoardChanged) {
                    this._webviewPanel.emitBoardChanged(board, 'include-switch');
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
        if (context.impact.includesSwitched && panel) {
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
        panel: vscode.WebviewPanel,
        board: KanbanBoard,
        event: ChangeEvent,
        context: ChangeContext
    ): void {
        const target = this._findClearingTarget(board, event);
        if (!target) return;

        if (target.type === 'column') {
            this._sendColumnUpdate(panel, target.column, context);
        } else {
            this._sendTaskUpdate(panel, target.column, target.task, context);
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

            if (panel && board) {
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

    // Note: File include location search reserved for future conflict detection

    /**
     * Send column update message to frontend
     * @param isLoadingContent - true when clearing cache (loading state), false when content is ready
     */
    private _sendColumnUpdate(
        panel: vscode.WebviewPanel,
        column: KanbanColumn,
        context: ChangeContext | null,
        isLoadingContent: boolean = false
    ): void {
        panel.webview.postMessage({
            type: 'updateColumnContent',
            columnId: column.id,
            columnTitle: column.title,
            displayTitle: column.displayTitle,
            tasks: isLoadingContent ? [] : column.tasks,
            includeMode: isLoadingContent ? false : column.includeMode,
            includeFiles: isLoadingContent ? [] : column.includeFiles,
            isLoadingContent
        });
        if (context) {
            context.result.frontendMessages.push({ type: 'updateColumnContent', columnId: column.id });
        }

        // Clear dirty flag (only when content is ready)
        if (!isLoadingContent && this._webviewPanel?.clearColumnDirty) {
            this._webviewPanel.clearColumnDirty(column.id);
        }
    }

    /**
     * Send task update message to frontend
     * @param isLoadingContent - true when clearing cache (loading state), false when content is ready
     */
    private _sendTaskUpdate(
        panel: vscode.WebviewPanel,
        column: KanbanColumn,
        task: KanbanTask,
        context: ChangeContext | null,
        isLoadingContent: boolean = false
    ): void {
        panel.webview.postMessage({
            type: 'updateTaskContent',
            columnId: column.id,
            taskId: task.id,
            description: isLoadingContent ? '' : task.description,
            displayTitle: isLoadingContent ? '' : task.displayTitle,
            taskTitle: task.title,
            originalTitle: task.originalTitle,
            includeMode: isLoadingContent ? false : task.includeMode,
            includeFiles: isLoadingContent ? [] : task.includeFiles,
            isLoadingContent
        });
        if (context) {
            context.result.frontendMessages.push({ type: 'updateTaskContent', taskId: task.id });
        }

        // Clear dirty flag (only when content is ready)
        if (!isLoadingContent && this._webviewPanel?.clearTaskDirty) {
            this._webviewPanel.clearTaskDirty(task.id);
        }
    }

    /**
     * Perform rollback on error - restore state and notify frontend
     */
    private _performRollback(panel: vscode.WebviewPanel, board: KanbanBoard, context: ChangeContext): void {
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
