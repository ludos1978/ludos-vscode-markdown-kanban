import * as vscode from 'vscode';
import { MarkdownFile } from '../files/MarkdownFile';
import { IncludeLoadingProcessor } from './IncludeLoadingProcessor';
import { FileSaveService } from './FileSaveService';
import { PanelContext } from '../panel/PanelContext';

// Re-export types from ChangeTypes
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
    private _eventQueue: Array<{
        event: ChangeEvent;
        resolve: (result: ChangeResult) => void;
        reject: (error: Error) => void;
    }> = [];

    // Dependencies (injected via constructor)
    private _fileRegistry: IFileRegistryForStateMachine;
    private _webviewPanel: IWebviewPanelForStateMachine;
    private _fileSaveService: FileSaveService;
    private _includeProcessor: IncludeLoadingProcessor;

    /**
     * Create a new ChangeStateMachine for a specific panel.
     * Each panel must have its own instance to prevent cross-panel contamination.
     */
    constructor(fileRegistry: IFileRegistryForStateMachine, webviewPanel: IWebviewPanelForStateMachine, panelContext: PanelContext) {
        this._fileRegistry = fileRegistry;
        this._webviewPanel = webviewPanel;
        this._fileSaveService = panelContext.fileSaveService;
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
            return new Promise<ChangeResult>((resolve, reject) => {
                this._eventQueue.push({ event, resolve, reject });
            });
        }

        this._isProcessing = true;

        try {
            // Create context for this change
            const context = this._createInitialContext(event);
            this._currentContext = context;

            // Start state machine from VALIDATE
            await this._transitionTo(ChangeState.VALIDATE, context);

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
                context: this._currentContext || this._createInitialContext(event),
                duration: Date.now() - (this._currentContext?.startTime || Date.now())
            };

        } finally {
            this._isProcessing = false;
            this._currentState = ChangeState.IDLE;
            this._currentContext = undefined;

            // Process next queued event if any
            if (this._eventQueue.length > 0) {
                const next = this._eventQueue.shift()!;
                setImmediate(() => {
                    this.processChange(next.event)
                        .then(next.resolve)
                        .catch(next.reject);
                });
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
            case ChangeState.VALIDATE:
                return await this._handleValidate(context);

            case ChangeState.LOAD:
                return await this._handleLoad(context);

            case ChangeState.UPDATE:
                return await this._handleUpdate(context);

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

    // ============= SIMPLIFIED STATE HANDLERS (4 states) =============

    /**
     * VALIDATE: Consolidated validation state
     * - Analyze impact
     * - Capture active edit
     * - Check unsaved changes in files being unloaded
     * - Prompt user if needed
     * - Save if requested
     */
    private async _handleValidate(context: ChangeContext): Promise<ChangeState> {
        // 1. Analyze impact
        await this._analyzeImpact(context);

        // 2. Check if user is currently editing
        let isEditing = false;
        let editedFile: MarkdownFile | undefined;

        for (const file of context.impact.affectedFiles) {
            if (file.isInEditMode()) {
                isEditing = true;
                editedFile = file;
                break;
            }
        }

        if (this._webviewPanel?.isEditingInProgress?.()) {
            isEditing = true;
        }

        context.editCapture = { wasEditing: isEditing, editedFile };

        // 3. Capture edit if editing
        if (isEditing && this._fileRegistry?.requestStopEditing) {
            try {
                const capturedEdit = await this._fileRegistry.requestStopEditing();
                if (capturedEdit?.value !== undefined) {
                    context.editCapture.capturedValue = capturedEdit;
                    if (editedFile) {
                        await editedFile.applyEditToBaseline(capturedEdit);
                    }
                }
            } catch (error) {
                console.error(`[State:VALIDATE] Error capturing edit:`, error);
            }
        }

        // 4. If not an include switch, skip unsaved check
        if (!context.impact.includesSwitched) {
            return ChangeState.LOAD;
        }

        // 5. Check for unsaved changes in files being unloaded
        // NOTE: exists() checks cached flag - if file was ever loaded successfully, we should save
        // even if the file was deleted externally. Only skip for broken includes (never loaded).
        const unsavedFiles: MarkdownFile[] = [];
        for (const relativePath of context.switches.unloadingFiles) {
            const file = this._fileRegistry?.getByRelativePath(relativePath);
            if (file?.hasUnsavedChanges() && file.exists()) {
                unsavedFiles.push(file);
            }
        }

        if (unsavedFiles.length === 0) {
            return ChangeState.LOAD;
        }

        context.unsaved.files = unsavedFiles;

        // 6. Prompt user for unsaved files
        const fileList = unsavedFiles.map(f => f.getRelativePath()).join('\n');
        const choice = await vscode.window.showWarningMessage(
            `The following include files have unsaved changes:\n${fileList}\n\nDo you want to save them before unloading?`,
            { modal: true },
            'Save',
            'Discard',
            'Cancel'
        );

        if (choice === 'Cancel' || choice === undefined) {
            context.unsaved.userChoice = 'cancel';
            return ChangeState.CANCELLED;
        }

        // 7. Save if requested
        if (choice === 'Save') {
            context.unsaved.userChoice = 'save';
            for (const file of unsavedFiles) {
                try {
                    await this._fileSaveService.saveFile(file);
                    context.result.updatedFiles.push(file.getRelativePath());
                } catch (error) {
                    console.error(`[State:VALIDATE] Error saving ${file.getRelativePath()}:`, error);
                }
            }
        } else {
            context.unsaved.userChoice = 'discard';
        }

        return ChangeState.LOAD;
    }

    /**
     * LOAD: Consolidated loading state
     * - Clear old include content
     * - Load new include content (using unifiedLoad - ALWAYS reloads)
     */
    private async _handleLoad(context: ChangeContext): Promise<ChangeState> {
        // Set cache protection flag
        if (context.impact.includesSwitched && this._webviewPanel) {
            this._webviewPanel.setIncludeSwitchInProgress(true);
        }

        // If not an include switch, skip to update
        if (!context.impact.includesSwitched) {
            return ChangeState.UPDATE;
        }

        // Get board and store in context
        const board = this._webviewPanel?.getBoard();
        context.modifiedBoard = board;

        if (!board) {
            return ChangeState.UPDATE;
        }

        // Clear backend cache for unloading files
        for (const relativePath of context.switches.unloadingFiles) {
            const file = this._fileRegistry?.getByRelativePath(relativePath);
            if (file) {
                file.discardChanges();
            }
        }

        // Resolve target ONCE (used for both clearing and loading)
        const panel = this._webviewPanel?.getPanel();
        const event = context.event;
        const switchEvent = event as IncludeSwitchEvent | UserEditEvent;
        const resolvedTarget = this._includeProcessor.resolveTarget(switchEvent, board);

        if (!resolvedTarget.found) {
            console.error(`[State:LOAD] Could not find target column/task`);
            return ChangeState.UPDATE;
        }

        const { targetColumn, targetTask, isColumnSwitch } = resolvedTarget;

        // Build unified target format
        const loadTarget = isColumnSwitch && targetColumn
            ? { type: 'column' as const, column: targetColumn }
            : targetTask && targetColumn
                ? { type: 'task' as const, column: targetColumn, task: targetTask }
                : null;

        // Send loading state to frontend (clear old content for UX)
        if (loadTarget && panel) {
            if (loadTarget.type === 'column') {
                loadTarget.column.tasks = [];
                loadTarget.column.includeFiles = [];
                loadTarget.column.includeMode = false;
                this._sendColumnUpdate(panel, loadTarget.column, null, true);
            } else {
                loadTarget.task.includeFiles = [];
                loadTarget.task.displayTitle = '';
                loadTarget.task.description = '';
                loadTarget.task.includeMode = false;
                this._sendTaskUpdate(panel, loadTarget.column, loadTarget.task, null, true);
            }
        }

        // Load new includes using unified loading (ALWAYS reloads)
        const newFiles = context.switches.newFiles;
        const preloadedContent = event.type === 'include_switch' ? event.preloadedContent : undefined;
        const newTitle = event.type === 'include_switch' ? event.newTitle : undefined;

        if (loadTarget) {
            await this._includeProcessor.unifiedLoad({
                target: loadTarget,
                includeFiles: newFiles,
                preloadedContent,
                newTitle,
                context
            });
        }

        return ChangeState.UPDATE;
    }

    /**
     * UPDATE: Consolidated update state
     * - Sync file registry
     * - Update main file content
     * - Emit events
     * - Send frontend updates
     */
    private async _handleUpdate(context: ChangeContext): Promise<ChangeState> {
        // 1. Sync file registry
        if (this._webviewPanel?.syncIncludeFilesWithBoard) {
            try {
                const board = this._webviewPanel.getBoard();
                if (board) {
                    this._webviewPanel.syncIncludeFilesWithBoard(board);
                }
            } catch (error) {
                console.error(`[State:UPDATE] Error syncing file registry:`, error);
            }
        }

        // 2. Update MainKanbanFile content
        if (context.impact.includesSwitched || context.impact.mainFileChanged) {
            const mainFile = this._fileRegistry?.getMainFile();
            const board = context.modifiedBoard || this._webviewPanel?.getBoard();

            if (mainFile && board && 'updateFromBoard' in mainFile) {
                (mainFile as import('../files/MainKanbanFile').MainKanbanFile).updateFromBoard(board);
            }
        }

        // 3. Emit board:changed event for include switches
        if (context.impact.includesSwitched && this._webviewPanel) {
            const board = this._webviewPanel.getBoard?.();
            if (board && this._webviewPanel.emitBoardChanged) {
                this._webviewPanel.emitBoardChanged(board, 'include-switch');
            }
        }

        // 4. Invalidate board cache if needed (NOT for include switches)
        if (context.event.type !== 'include_switch' && this._webviewPanel?.invalidateBoardCache) {
            this._webviewPanel.invalidateBoardCache();
        }

        // 5. Send frontend updates
        const panel = this._webviewPanel?.getPanel();
        const event = context.event;
        const board = context.modifiedBoard || this._webviewPanel?.getBoard();

        if (board && panel) {
            if (context.impact.includesSwitched) {
                this._sendIncludeSwitchUpdate(panel, board, event, context);
            } else if (context.impact.mainFileChanged && event.type === 'file_system_change') {
                if (this._webviewPanel?.refreshWebviewContent) {
                    await this._webviewPanel.refreshWebviewContent();
                    context.result.frontendMessages.push({ type: 'fullBoardRefresh' });
                }
            } else if (context.impact.includeFilesChanged && event.type === 'file_system_change') {
                context.result.frontendMessages.push({ type: 'autonomousFileUpdate' });
            } else if (event.type === 'user_edit' || event.type === 'save') {
                context.result.frontendMessages.push({ type: 'noUpdateNeeded' });
            }
        }

        return ChangeState.COMPLETE;
    }

    // ============= IMPACT ANALYSIS HELPER =============

    /**
     * Analyze impact of the change event
     */
    private async _analyzeImpact(context: ChangeContext): Promise<void> {
        const event = context.event;

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

            const oldFiles = this._fileRegistry
                ? event.oldFiles.map(path =>
                    this._fileRegistry!.getByRelativePath(path)
                  ).filter((f): f is MarkdownFile => f !== undefined)
                : [];

            context.impact.affectedFiles = oldFiles;

            // Use normalized path comparison
            context.switches.oldFiles = event.oldFiles;
            context.switches.newFiles = event.newFiles;
            context.switches.unloadingFiles = this._includeProcessor.calculateUnloadingFiles(
                event.oldFiles, event.newFiles
            );
            context.switches.loadingFiles = this._includeProcessor.calculateLoadingFiles(
                event.oldFiles, event.newFiles
            );

        } else if (event.type === 'user_edit') {
            context.impact.mainFileChanged = true;
            context.impact.includeFilesChanged = false;
            context.impact.includesSwitched = !!event.params.includeSwitch;

            const mainFile = this._fileRegistry?.getMainFile();
            context.impact.affectedFiles = mainFile ? [mainFile] : [];

            if (event.params.includeSwitch) {
                context.switches.oldFiles = event.params.includeSwitch.oldFiles;
                context.switches.newFiles = event.params.includeSwitch.newFiles;
                context.switches.unloadingFiles = this._includeProcessor.calculateUnloadingFiles(
                    context.switches.oldFiles, context.switches.newFiles
                );
                context.switches.loadingFiles = this._includeProcessor.calculateLoadingFiles(
                    context.switches.oldFiles, context.switches.newFiles
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
    }

    // ============= FRONTEND UPDATE HELPERS =============

    /**
     * Send appropriate update for include switch events
     */
    private _sendIncludeSwitchUpdate(
        panel: vscode.WebviewPanel,
        board: KanbanBoard,
        event: ChangeEvent,
        context: ChangeContext
    ): void {
        // Use resolveTarget (single source of truth for target resolution)
        const switchEvent = event as IncludeSwitchEvent | UserEditEvent;
        const resolved = this._includeProcessor.resolveTarget(switchEvent, board);
        if (!resolved.found) return;

        const { targetColumn, targetTask, isColumnSwitch } = resolved;

        if (isColumnSwitch && targetColumn) {
            this._sendColumnUpdate(panel, targetColumn, context);
        } else if (targetTask && targetColumn) {
            this._sendTaskUpdate(panel, targetColumn, targetTask, context);
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

        // Show error dialog to user
        const errorMessage = context.result.error?.message || 'Unknown error';

        await vscode.window.showWarningMessage(
            errorMessage,
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
        // Only clear include error flag when content loads successfully AND there's no error
        // If column.includeError is true (set by IncludeLoadingProcessor), preserve it
        if (!isLoadingContent && !column.includeError) {
            column.includeError = false;
        }

        console.log(`[ChangeStateMachine] _sendColumnUpdate: columnId=${column.id}, isLoadingContent=${isLoadingContent}, includeError=${column.includeError}, includeMode=${column.includeMode}, includeFiles=${JSON.stringify(column.includeFiles)}`);

        panel.webview.postMessage({
            type: 'updateColumnContent',
            columnId: column.id,
            columnTitle: column.title,
            displayTitle: column.displayTitle,
            tasks: isLoadingContent ? [] : column.tasks,
            includeMode: isLoadingContent ? false : column.includeMode,
            includeFiles: isLoadingContent ? [] : column.includeFiles,
            isLoadingContent,
            includeError: isLoadingContent ? undefined : column.includeError  // Send actual error state
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
        // Only clear include error flag when content loads successfully AND there's no error
        // If task.includeError is true (set by IncludeLoadingProcessor), preserve it
        if (!isLoadingContent && !task.includeError) {
            task.includeError = false;
        }

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
            isLoadingContent,
            includeError: isLoadingContent ? undefined : task.includeError  // Send actual error state
        });
        if (context) {
            context.result.frontendMessages.push({ type: 'updateTaskContent', taskId: task.id });
        }

        // Clear dirty flag (only when content is ready)
        if (!isLoadingContent && this._webviewPanel?.clearTaskDirty) {
            this._webviewPanel.clearTaskDirty(task.id);
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
}
