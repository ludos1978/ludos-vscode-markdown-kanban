import { MarkdownFile } from '../files/MarkdownFile';
import * as vscode from 'vscode';

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

// ============= STATE DEFINITIONS =============

export enum ChangeState {
    IDLE = 'IDLE',
    RECEIVING_CHANGE = 'RECEIVING_CHANGE',
    ANALYZING_IMPACT = 'ANALYZING_IMPACT',
    CHECKING_EDIT_STATE = 'CHECKING_EDIT_STATE',
    CAPTURING_EDIT = 'CAPTURING_EDIT',
    CHECKING_UNSAVED = 'CHECKING_UNSAVED',
    PROMPTING_USER = 'PROMPTING_USER',
    SAVING_UNSAVED = 'SAVING_UNSAVED',
    CLEARING_CACHE = 'CLEARING_CACHE',
    LOADING_NEW = 'LOADING_NEW',
    UPDATING_BACKEND = 'UPDATING_BACKEND',
    SYNCING_FRONTEND = 'SYNCING_FRONTEND',
    COMPLETE = 'COMPLETE',
    CANCELLED = 'CANCELLED',
    ERROR = 'ERROR'
}

// ============= EVENT TYPES =============

export interface FileSystemChangeEvent {
    type: 'file_system_change';
    file: MarkdownFile;
    changeType: 'modified' | 'deleted' | 'created';
    timestamp: number;
}

export interface UserEditEvent {
    type: 'user_edit';
    editType: 'task_title' | 'task_description' | 'column_title';
    params: {
        taskId?: string;
        columnId?: string;
        value: string;
        includeSwitch?: {
            oldFiles: string[];
            newFiles: string[];
        };
    };
}

export interface SaveEvent {
    type: 'save';
    file: MarkdownFile;
    source: 'user_command' | 'auto_save' | 'pre_unload';
}

export interface IncludeSwitchEvent {
    type: 'include_switch';
    target: 'column' | 'task';
    targetId: string;
    columnIdForTask?: string;
    oldFiles: string[];
    newFiles: string[];
    newTitle?: string;
}

export type ChangeEvent =
    | FileSystemChangeEvent
    | UserEditEvent
    | SaveEvent
    | IncludeSwitchEvent;

// ============= CHANGE CONTEXT =============

/**
 * Context object passed through all state transitions
 * Contains all information needed to process the change
 */
export interface ChangeContext {
    // Original event that triggered this change
    event: ChangeEvent;

    // Impact analysis results
    impact: {
        mainFileChanged: boolean;
        includeFilesChanged: boolean;
        includesSwitched: boolean;
        affectedFiles: MarkdownFile[];
    };

    // Edit state capture
    editCapture?: {
        wasEditing: boolean;
        editedFile?: MarkdownFile;
        capturedValue?: any;
    };

    // Unsaved files management
    unsaved: {
        files: MarkdownFile[];
        userChoice?: 'save' | 'discard' | 'cancel';
    };

    // Switch operations
    switches: {
        oldFiles: string[];
        newFiles: string[];
        unloadingFiles: string[];
        loadingFiles: string[];
    };

    // Result tracking
    result: {
        success: boolean;
        error?: Error;
        updatedFiles: string[];
        frontendMessages: any[];
    };

    // Metadata
    startTime: number;
    currentState: ChangeState;
    stateHistory: ChangeState[];
}

// ============= CHANGE RESULT =============

export interface ChangeResult {
    success: boolean;
    error?: Error;
    context: ChangeContext;
    duration: number;
}

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

    private constructor() {
        console.log('[ChangeStateMachine] Initialized');
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
        console.log('[ChangeStateMachine] Dependencies injected');
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
        console.log(`[ChangeStateMachine] 🔵 ENTRY POINT: ${event.type}`);

        // If already processing, queue the event
        if (this._isProcessing) {
            console.log(`[ChangeStateMachine] ⏸️  Queueing event (already processing)`);
            this._eventQueue.push(event);
            return {
                success: false,
                error: new Error('Event queued - state machine busy'),
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

        } catch (error: any) {
            console.error('[ChangeStateMachine] ❌ Fatal error:', error);
            return {
                success: false,
                error: error,
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
                console.log(`[ChangeStateMachine] ⏯️  Processing queued event: ${nextEvent.type}`);
                setImmediate(() => this.processChange(nextEvent));
            }
        }
    }

    /**
     * Get current state (for debugging/testing)
     */
    public getCurrentState(): ChangeState {
        return this._currentState;
    }

    /**
     * Get current context (for debugging/testing)
     */
    public getCurrentContext(): ChangeContext | undefined {
        return this._currentContext;
    }

    // ============= STATE TRANSITION ENGINE =============

    /**
     * Transition to a new state and execute its handler
     */
    private async _transitionTo(newState: ChangeState, context: ChangeContext): Promise<void> {
        const oldState = this._currentState;
        this._currentState = newState;
        context.currentState = newState;
        context.stateHistory.push(newState);

        console.log(`[ChangeStateMachine] 🔄 STATE TRANSITION: ${oldState} → ${newState}`);

        // Execute state handler
        try {
            const nextState = await this._executeStateHandler(newState, context);

            // Automatically transition to next state if returned
            if (nextState && nextState !== ChangeState.IDLE) {
                await this._transitionTo(nextState, context);
            }

        } catch (error: any) {
            console.error(`[ChangeStateMachine] ❌ Error in state ${newState}:`, error);
            context.result.success = false;
            context.result.error = error;
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
        console.log(`[State:RECEIVING_CHANGE] Processing ${context.event.type} event`);
        // Event already captured in context during creation
        return ChangeState.ANALYZING_IMPACT;
    }

    private async _handleAnalyzingImpact(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:ANALYZING_IMPACT] Analyzing change impact`);

        const event = context.event;

        // Analyze impact based on event type
        if (event.type === 'file_system_change') {
            const file = event.file;
            const fileType = file.getFileType();

            context.impact.mainFileChanged = fileType === 'main';
            context.impact.includeFilesChanged = fileType !== 'main';
            context.impact.includesSwitched = false;
            context.impact.affectedFiles = [file];

            console.log(`[State:ANALYZING_IMPACT] File system change: ${fileType} file modified`);

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

            console.log(`[State:ANALYZING_IMPACT] Include switch: ${context.switches.unloadingFiles.length} unloading, ${context.switches.loadingFiles.length} loading`);

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

            console.log(`[State:ANALYZING_IMPACT] User edit: ${event.editType}${context.impact.includesSwitched ? ' with include switch' : ''}`);

        } else if (event.type === 'save') {
            const file = event.file;
            const fileType = file.getFileType();

            context.impact.mainFileChanged = fileType === 'main';
            context.impact.includeFilesChanged = fileType !== 'main';
            context.impact.includesSwitched = false;
            context.impact.affectedFiles = [file];

            console.log(`[State:ANALYZING_IMPACT] Save event: ${fileType} file`);
        }

        console.log(`[State:ANALYZING_IMPACT] Impact: main=${context.impact.mainFileChanged}, includes=${context.impact.includeFilesChanged}, switches=${context.impact.includesSwitched}`);

        return ChangeState.CHECKING_EDIT_STATE;
    }

    private async _handleCheckingEditState(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:CHECKING_EDIT_STATE] Checking if user is editing`);

        // Check if user is currently editing any affected files
        let isEditing = false;
        let editedFile: MarkdownFile | undefined;

        for (const file of context.impact.affectedFiles) {
            if ((file as any)._isInEditMode) {
                isEditing = true;
                editedFile = file;
                console.log(`[State:CHECKING_EDIT_STATE] User is editing: ${file.getPath()}`);
                break;
            }
        }

        // Also check if webview panel indicates editing in progress
        if (this._webviewPanel && this._webviewPanel.isEditingInProgress && this._webviewPanel.isEditingInProgress()) {
            isEditing = true;
            console.log(`[State:CHECKING_EDIT_STATE] Webview panel indicates editing in progress`);
        }

        context.editCapture = {
            wasEditing: isEditing,
            editedFile: editedFile
        };

        if (isEditing) {
            console.log(`[State:CHECKING_EDIT_STATE] → Capturing edit`);
            return ChangeState.CAPTURING_EDIT;
        } else {
            console.log(`[State:CHECKING_EDIT_STATE] → No editing detected`);
            return ChangeState.CHECKING_UNSAVED;
        }
    }

    private async _handleCapturingEdit(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:CAPTURING_EDIT] Capturing user's current edit`);

        // Request the file registry to stop editing and capture the value
        if (this._fileRegistry && this._fileRegistry.requestStopEditing) {
            try {
                const capturedEdit = await this._fileRegistry.requestStopEditing();

                if (capturedEdit && capturedEdit.value !== undefined) {
                    console.log(`[State:CAPTURING_EDIT] Captured edit value (${capturedEdit.value.length} chars)`);
                    context.editCapture!.capturedValue = capturedEdit;

                    // Apply to baseline of the edited file
                    if (context.editCapture!.editedFile) {
                        const file = context.editCapture!.editedFile;
                        if ((file as any).applyEditToBaseline) {
                            await (file as any).applyEditToBaseline(capturedEdit);
                            console.log(`[State:CAPTURING_EDIT] ✓ Edit applied to baseline (memory only)`);
                        }
                    }
                } else {
                    console.log(`[State:CAPTURING_EDIT] No edit value captured`);
                }
            } catch (error) {
                console.error(`[State:CAPTURING_EDIT] Error capturing edit:`, error);
                // Continue anyway - don't block the flow
            }
        }

        return ChangeState.CHECKING_UNSAVED;
    }

    private async _handleCheckingUnsaved(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:CHECKING_UNSAVED] Checking for unsaved files being unloaded`);

        // Only check if includes are being switched
        if (!context.impact.includesSwitched) {
            console.log(`[State:CHECKING_UNSAVED] No switches, skipping unsaved check`);
            return ChangeState.CLEARING_CACHE;
        }

        // Get files being unloaded
        const unloadingFiles = context.switches.unloadingFiles;

        if (unloadingFiles.length === 0) {
            console.log(`[State:CHECKING_UNSAVED] No files being unloaded`);
            return ChangeState.CLEARING_CACHE;
        }

        // Check each unloading file for unsaved changes
        const unsavedFiles: MarkdownFile[] = [];

        for (const relativePath of unloadingFiles) {
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file && file.hasUnsavedChanges()) {
                unsavedFiles.push(file);
                console.log(`[State:CHECKING_UNSAVED] Unsaved file: ${relativePath}`);
            }
        }

        if (unsavedFiles.length === 0) {
            console.log(`[State:CHECKING_UNSAVED] No unsaved changes found`);
            return ChangeState.CLEARING_CACHE;
        }

        console.log(`[State:CHECKING_UNSAVED] Found ${unsavedFiles.length} files with unsaved changes`);
        context.unsaved.files = unsavedFiles;

        return ChangeState.PROMPTING_USER;
    }

    private async _handlePromptingUser(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:PROMPTING_USER] Prompting user about unsaved changes`);

        const unsavedFiles = context.unsaved.files;
        const fileList = unsavedFiles.map(f => f.getRelativePath()).join('\n');

        // Show VSCode dialog with Save/Discard/Cancel options
        const vscode = require('vscode');
        const choice = await vscode.window.showWarningMessage(
            `The following include files have unsaved changes:\n${fileList}\n\nDo you want to save them before unloading?`,
            { modal: true },
            'Save',
            'Discard',
            'Cancel'
        );

        console.log(`[State:PROMPTING_USER] User chose: ${choice || 'undefined (cancelled)'}`);

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
        console.log(`[State:SAVING_UNSAVED] Saving unsaved files`);

        const unsavedFiles = context.unsaved.files;

        for (const file of unsavedFiles) {
            try {
                console.log(`[State:SAVING_UNSAVED] Saving: ${file.getRelativePath()}`);
                await file.save();
                console.log(`[State:SAVING_UNSAVED] ✓ Saved: ${file.getRelativePath()}`);
                context.result.updatedFiles.push(file.getRelativePath());
            } catch (error) {
                console.error(`[State:SAVING_UNSAVED] ❌ Error saving ${file.getRelativePath()}:`, error);
                // Continue with other files even if one fails
            }
        }

        console.log(`[State:SAVING_UNSAVED] Saved ${context.result.updatedFiles.length} files`);

        return ChangeState.CLEARING_CACHE;
    }

    private async _handleClearingCache(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:CLEARING_CACHE] Clearing old include file cache`);

        // Only clear cache if includes are being switched
        if (!context.impact.includesSwitched) {
            console.log(`[State:CLEARING_CACHE] No switches, skipping cache clear`);
            return ChangeState.LOADING_NEW;
        }

        const unloadingFiles = context.switches.unloadingFiles;
        const board = this._webviewPanel?.getBoard();

        if (!board) {
            console.log(`[State:CLEARING_CACHE] No board available, skipping cache clear`);
            return ChangeState.LOADING_NEW;
        }

        // Clear backend cache for unloading files
        for (const relativePath of unloadingFiles) {
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file) {
                console.log(`[State:CLEARING_CACHE] Clearing backend cache: ${relativePath}`);
                // Discard any uncommitted changes (revert to baseline/disk)
                file.discardChanges();
            }
        }

        // Clear frontend cache based on event type
        const event = context.event;

        if (event.type === 'include_switch') {
            if (event.target === 'column') {
                // Column include switch - clear column tasks
                const column = board.columns.find((c: any) => c.id === event.targetId);
                if (column) {
                    console.log(`[State:CLEARING_CACHE] Clearing column frontend cache: ${event.targetId}`);
                    column.tasks = [];
                    column.includeFiles = [];
                    column.includeMode = false;
                }
            } else if (event.target === 'task') {
                // Task include switch - clear task description
                const column = board.columns.find((c: any) => c.id === event.columnIdForTask);
                const task = column?.tasks.find((t: any) => t.id === event.targetId);
                if (task) {
                    console.log(`[State:CLEARING_CACHE] Clearing task frontend cache: ${event.targetId}`);
                    task.includeFiles = [];
                    task.displayTitle = '';
                    task.description = '';
                    task.includeMode = false;
                }
            }
        } else if (event.type === 'user_edit' && event.params.includeSwitch) {
            // User edit with include switch - determine target from edit type
            if (event.editType === 'column_title') {
                const column = board.columns.find((c: any) => c.id === event.params.columnId);
                if (column) {
                    console.log(`[State:CLEARING_CACHE] Clearing column frontend cache: ${event.params.columnId}`);
                    column.tasks = [];
                    column.includeFiles = [];
                    column.includeMode = false;
                }
            } else if (event.editType === 'task_title') {
                const column = board.columns.find((c: any) => c.tasks.some((t: any) => t.id === event.params.taskId));
                const task = column?.tasks.find((t: any) => t.id === event.params.taskId);
                if (task) {
                    console.log(`[State:CLEARING_CACHE] Clearing task frontend cache: ${event.params.taskId}`);
                    task.includeFiles = [];
                    task.displayTitle = '';
                    task.description = '';
                    task.includeMode = false;
                }
            }
        }

        console.log(`[State:CLEARING_CACHE] ✓ Cache cleared for ${unloadingFiles.length} files`);

        return ChangeState.LOADING_NEW;
    }

    private async _handleLoadingNew(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:LOADING_NEW] Loading new include file content`);

        // Only load new files if includes are being switched
        if (!context.impact.includesSwitched) {
            console.log(`[State:LOADING_NEW] No switches, skipping load`);
            return ChangeState.UPDATING_BACKEND;
        }

        const loadingFiles = context.switches.loadingFiles;

        if (loadingFiles.length === 0) {
            console.log(`[State:LOADING_NEW] No new files to load`);
            return ChangeState.UPDATING_BACKEND;
        }

        const event = context.event;
        const board = this._webviewPanel?.getBoard();

        if (!board) {
            console.log(`[State:LOADING_NEW] No board available, skipping load`);
            return ChangeState.UPDATING_BACKEND;
        }

        // Determine target column/task based on event type
        let targetColumn: any = null;
        let targetTask: any = null;
        let isColumnSwitch = false;

        if (event.type === 'include_switch') {
            if (event.target === 'column') {
                targetColumn = board.columns.find((c: any) => c.id === event.targetId);
                isColumnSwitch = true;
            } else if (event.target === 'task') {
                targetColumn = board.columns.find((c: any) => c.id === event.columnIdForTask);
                targetTask = targetColumn?.tasks.find((t: any) => t.id === event.targetId);
            }
        } else if (event.type === 'user_edit' && event.params.includeSwitch) {
            if (event.editType === 'column_title') {
                targetColumn = board.columns.find((c: any) => c.id === event.params.columnId);
                isColumnSwitch = true;
            } else if (event.editType === 'task_title') {
                targetColumn = board.columns.find((c: any) => c.tasks.some((t: any) => t.id === event.params.taskId));
                targetTask = targetColumn?.tasks.find((t: any) => t.id === event.params.taskId);
            }
        }

        if (!targetColumn && !targetTask) {
            console.error(`[State:LOADING_NEW] Could not find target column/task`);
            return ChangeState.UPDATING_BACKEND;
        }

        // Get file factory and main file
        const fileFactory = (this._webviewPanel as any)._fileFactory;
        const mainFile = this._fileRegistry.getMainFile();

        if (!fileFactory || !mainFile) {
            console.error(`[State:LOADING_NEW] Missing dependencies (fileFactory or mainFile)`);
            return ChangeState.UPDATING_BACKEND;
        }

        if (isColumnSwitch && targetColumn) {
            // Column include switch - load and parse presentation files
            console.log(`[State:LOADING_NEW] Loading column includes for column: ${targetColumn.id}`);

            // Update column properties
            targetColumn.includeFiles = loadingFiles;
            targetColumn.includeMode = loadingFiles.length > 0;

            // Create/register file instances and load content
            const tasks: any[] = [];

            for (const relativePath of loadingFiles) {
                // Create file instance if not exists
                if (!this._fileRegistry.hasByRelativePath(relativePath)) {
                    console.log(`[State:LOADING_NEW] Creating ColumnIncludeFile: ${relativePath}`);
                    const columnInclude = fileFactory.createColumnInclude(relativePath, mainFile, false);
                    columnInclude.setColumnId(targetColumn.id);
                    columnInclude.setColumnTitle(targetColumn.title);
                    this._fileRegistry.register(columnInclude);
                    columnInclude.startWatching();
                }

                // Load content
                const file = this._fileRegistry.getByRelativePath(relativePath);
                if (file) {
                    // Ensure content is loaded
                    if (!file.getContent() || file.getContent().length === 0) {
                        console.log(`[State:LOADING_NEW] Loading content from disk: ${relativePath}`);
                        await file.reload();
                    }

                    // Parse tasks from file content
                    if (file.parseToTasks) {
                        const fileTasks = file.parseToTasks(targetColumn.tasks);
                        console.log(`[State:LOADING_NEW] Parsed ${fileTasks.length} tasks from ${relativePath}`);
                        tasks.push(...fileTasks);
                    }
                }
            }

            // Update column with loaded tasks
            targetColumn.tasks = tasks;
            console.log(`[State:LOADING_NEW] ✓ Loaded ${tasks.length} tasks for column ${targetColumn.id}`);
            context.result.updatedFiles.push(...loadingFiles);

        } else if (targetTask) {
            // Task include switch - load raw content
            console.log(`[State:LOADING_NEW] Loading task include for task: ${targetTask.id}`);

            const relativePath = loadingFiles[0]; // Task includes are single file

            // Create file instance if not exists
            if (!this._fileRegistry.hasByRelativePath(relativePath)) {
                console.log(`[State:LOADING_NEW] Creating TaskIncludeFile: ${relativePath}`);
                const taskInclude = fileFactory.createTaskInclude(relativePath, mainFile, false);
                taskInclude.setTaskId(targetTask.id);
                taskInclude.setTaskTitle(targetTask.title);
                taskInclude.setColumnId(targetColumn.id);
                this._fileRegistry.register(taskInclude);
                taskInclude.startWatching();
            }

            // Load content
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file) {
                // Ensure content is loaded
                if (!file.getContent() || file.getContent().length === 0) {
                    console.log(`[State:LOADING_NEW] Loading content from disk: ${relativePath}`);
                    await file.reload();
                }

                const fullFileContent = file.getContent();

                if (fullFileContent && fullFileContent.length > 0) {
                    // Update task properties
                    targetTask.includeMode = true;
                    targetTask.includeFiles = loadingFiles;
                    targetTask.displayTitle = `# include in ${relativePath}`;
                    targetTask.description = fullFileContent;

                    // Update title if provided in event
                    if (event.type === 'include_switch' && event.newTitle) {
                        targetTask.title = event.newTitle;
                        targetTask.originalTitle = event.newTitle;
                    }

                    // Sync file baseline with task content
                    file.setContent(fullFileContent, true);

                    console.log(`[State:LOADING_NEW] ✓ Loaded ${fullFileContent.length} chars for task ${targetTask.id}`);
                    context.result.updatedFiles.push(relativePath);
                } else {
                    console.error(`[State:LOADING_NEW] Failed to load content for ${relativePath}`);
                }
            }
        }

        console.log(`[State:LOADING_NEW] ✓ Loading complete`);

        return ChangeState.UPDATING_BACKEND;
    }

    private async _handleUpdatingBackend(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:UPDATING_BACKEND] Updating backend state`);

        // Sync file registry (create instances for new files)
        if (this._webviewPanel && this._webviewPanel.syncIncludeFilesWithBoard) {
            try {
                const board = this._webviewPanel.getBoard();
                if (board) {
                    console.log(`[State:UPDATING_BACKEND] Syncing file registry with board`);
                    this._webviewPanel.syncIncludeFilesWithBoard(board);
                }
            } catch (error) {
                console.error(`[State:UPDATING_BACKEND] Error syncing file registry:`, error);
            }
        }

        // Mark main file as having unsaved changes if user made edits
        if (context.impact.mainFileChanged && context.event.type === 'user_edit') {
            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile) {
                console.log(`[State:UPDATING_BACKEND] Main file modified by user edit`);
                // The file's internal state already reflects the change
                // No need to explicitly mark it - setContent() already did that
            }
        }

        // Invalidate board cache if needed
        if (this._webviewPanel && this._webviewPanel.invalidateBoardCache) {
            console.log(`[State:UPDATING_BACKEND] Invalidating board cache`);
            this._webviewPanel.invalidateBoardCache();
        }

        // TODO: Additional backend updates
        // MIGRATION NOTE: May need to extract additional logic from:
        // - kanbanWebviewPanel.regenerateBoard() for main file changes
        // - kanbanWebviewPanel.markUnsavedChanges() for change tracking
        //
        // Current implementation handles the basics, full migration pending

        console.log(`[State:UPDATING_BACKEND] Backend state updated`);

        return ChangeState.SYNCING_FRONTEND;
    }

    private async _handleSyncingFrontend(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:SYNCING_FRONTEND] Syncing changes to frontend`);

        // Only send updates if we have a webview panel
        if (!this._webviewPanel || !(this._webviewPanel as any)._panel) {
            console.log(`[State:SYNCING_FRONTEND] No active webview panel, skipping frontend sync`);
            return ChangeState.COMPLETE;
        }

        const panel = (this._webviewPanel as any)._panel;
        const event = context.event;
        const board = this._webviewPanel.getBoard();

        if (!board) {
            console.log(`[State:SYNCING_FRONTEND] No board available, skipping frontend sync`);
            return ChangeState.COMPLETE;
        }

        // Determine what type of update to send based on event type and impact
        if (context.impact.includesSwitched) {
            // Include switch - send targeted update

            if (event.type === 'include_switch') {
                if (event.target === 'column') {
                    // Column include switch
                    const column = board.columns.find((c: any) => c.id === event.targetId);
                    if (column) {
                        console.log(`[State:SYNCING_FRONTEND] Sending updateColumnContent for column: ${column.id}`);
                        panel.webview.postMessage({
                            type: 'updateColumnContent',
                            columnId: column.id,
                            tasks: column.tasks,
                            includeMode: column.includeMode,
                            includeFiles: column.includeFiles
                        });
                        context.result.frontendMessages.push({ type: 'updateColumnContent', columnId: column.id });
                    }
                } else if (event.target === 'task') {
                    // Task include switch
                    const column = board.columns.find((c: any) => c.id === event.columnIdForTask);
                    const task = column?.tasks.find((t: any) => t.id === event.targetId);
                    if (task && column) {
                        console.log(`[State:SYNCING_FRONTEND] Sending updateTaskContent for task: ${task.id}`);
                        panel.webview.postMessage({
                            type: 'updateTaskContent',
                            columnId: column.id,
                            taskId: task.id,
                            description: task.description,
                            displayTitle: task.displayTitle,
                            taskTitle: task.title,
                            originalTitle: task.originalTitle,
                            includeMode: task.includeMode,
                            includeFiles: task.includeFiles
                        });
                        context.result.frontendMessages.push({ type: 'updateTaskContent', taskId: task.id });
                    }
                }
            } else if (event.type === 'user_edit' && event.params.includeSwitch) {
                // User edit with include switch
                if (event.editType === 'column_title') {
                    const column = board.columns.find((c: any) => c.id === event.params.columnId);
                    if (column) {
                        console.log(`[State:SYNCING_FRONTEND] Sending updateColumnContent for column: ${column.id}`);
                        panel.webview.postMessage({
                            type: 'updateColumnContent',
                            columnId: column.id,
                            tasks: column.tasks,
                            includeMode: column.includeMode,
                            includeFiles: column.includeFiles
                        });
                        context.result.frontendMessages.push({ type: 'updateColumnContent', columnId: column.id });
                    }
                } else if (event.editType === 'task_title') {
                    const column = board.columns.find((c: any) => c.tasks.some((t: any) => t.id === event.params.taskId));
                    const task = column?.tasks.find((t: any) => t.id === event.params.taskId);
                    if (task && column) {
                        console.log(`[State:SYNCING_FRONTEND] Sending updateTaskContent for task: ${task.id}`);
                        panel.webview.postMessage({
                            type: 'updateTaskContent',
                            columnId: column.id,
                            taskId: task.id,
                            description: task.description,
                            displayTitle: task.displayTitle,
                            taskTitle: task.title,
                            originalTitle: task.originalTitle,
                            includeMode: task.includeMode,
                            includeFiles: task.includeFiles
                        });
                        context.result.frontendMessages.push({ type: 'updateTaskContent', taskId: task.id });
                    }
                }
            }

        } else if (context.impact.mainFileChanged && event.type === 'file_system_change') {
            // Main file changed externally - send full board refresh
            console.log(`[State:SYNCING_FRONTEND] Sending full board refresh for main file change`);

            // Use the webview panel's method to send board update
            if (this._webviewPanel.refreshWebviewContent) {
                await this._webviewPanel.refreshWebviewContent();
                context.result.frontendMessages.push({ type: 'fullBoardRefresh' });
            }

        } else if (context.impact.includeFilesChanged && event.type === 'file_system_change') {
            // Include file changed externally
            // The file instance will handle this autonomously via its change handler
            console.log(`[State:SYNCING_FRONTEND] Include file change - file will handle autonomously`);
            context.result.frontendMessages.push({ type: 'autonomousFileUpdate' });

        } else if (event.type === 'user_edit' && !context.impact.includesSwitched) {
            // Regular user edit without include switch
            // Frontend already has the change, no update needed
            console.log(`[State:SYNCING_FRONTEND] User edit - frontend already updated`);
            context.result.frontendMessages.push({ type: 'noUpdateNeeded' });

        } else if (event.type === 'save') {
            // Save event - no frontend update needed
            console.log(`[State:SYNCING_FRONTEND] Save event - no frontend update needed`);
            context.result.frontendMessages.push({ type: 'noUpdateNeeded' });
        }

        console.log(`[State:SYNCING_FRONTEND] ✓ Frontend sync complete`);

        return ChangeState.COMPLETE;
    }

    private async _handleComplete(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:COMPLETE] ✅ Change handled successfully`);
        console.log(`[State:COMPLETE] State history: ${context.stateHistory.join(' → ')}`);
        console.log(`[State:COMPLETE] Duration: ${Date.now() - context.startTime}ms`);

        context.result.success = true;
        return ChangeState.IDLE;
    }

    private async _handleCancelled(context: ChangeContext): Promise<ChangeState> {
        console.log(`[State:CANCELLED] ⚠️ User cancelled operation`);

        context.result.success = false;
        context.result.error = new Error('USER_CANCELLED');
        return ChangeState.IDLE;
    }

    private async _handleError(context: ChangeContext): Promise<ChangeState> {
        console.error(`[State:ERROR] ❌ Error during change processing:`, context.result.error);
        console.error(`[State:ERROR] State history: ${context.stateHistory.join(' → ')}`);
        console.error(`[State:ERROR] Event type: ${context.event.type}`);

        // Show error dialog to user
        const vscode = require('vscode');
        const errorMessage = context.result.error?.message || 'Unknown error';
        const stateHistory = context.stateHistory.join(' → ');

        await vscode.window.showErrorMessage(
            `State Machine Error: ${errorMessage}\n\nState flow: ${stateHistory}`,
            { modal: false },
            'OK'
        );

        // TODO: Attempt recovery
        // Options:
        // 1. Reload affected files from disk
        // 2. Reset board state
        // 3. Clear caches and retry
        //
        // MIGRATION NOTE: Recovery logic exists in:
        // - ConflictResolver.showExternalIncludeFileDialog() - reload options
        // - MainKanbanFile.handleExternalChange() - conflict resolution
        // - MarkdownFile.reload() - file reload logic
        //
        // For now, just log and let the system continue

        console.error(`[State:ERROR] Error recovery not yet implemented`);
        console.error(`[State:ERROR] System may be in inconsistent state`);

        // Mark result as failed
        context.result.success = false;

        return ChangeState.IDLE;
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

// ============= SINGLETON EXPORT =============

export const changeStateMachine = ChangeStateMachine.getInstance();
