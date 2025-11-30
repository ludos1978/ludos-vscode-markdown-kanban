import { MarkdownFile } from '../files/MarkdownFile';
import * as vscode from 'vscode';
import { INCLUDE_SYNTAX, createDisplayTitleWithPlaceholders } from '../constants/IncludeConstants';

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
    /** Pre-loaded content for include files (bypasses registry caching) */
    preloadedContent?: Map<string, string>;
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

    // Modified board reference (to avoid re-fetching stale data)
    modifiedBoard?: any;

    // Rollback data for error recovery
    rollback?: {
        columnId?: string;
        taskId?: string;
        taskColumnId?: string;
        oldState: {
            title?: string;
            tasks?: any[];
            includeFiles?: string[];
            includeMode?: boolean;
            description?: string;
            displayTitle?: string;
        };
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

    private constructor() {}

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

        } catch (error: any) {
            console.error('[ChangeStateMachine] Fatal error:', error);

            // CRITICAL: Clear flag on fatal error to prevent cache lock
            if (this._webviewPanel) {
                (this._webviewPanel as any).setIncludeSwitchInProgress?.(false);
            }

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

        // Execute state handler
        try {
            const nextState = await this._executeStateHandler(newState, context);

            // Automatically transition to next state if returned
            if (nextState && nextState !== ChangeState.IDLE) {
                await this._transitionTo(nextState, context);
            }

        } catch (error: any) {
            console.error(`[ChangeStateMachine] Error in state ${newState}:`, error);
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

        // TEMPORARY: Disable duplicate validation to diagnose include switch issues
        /*
        // Validate duplicate includes early, before any state changes
        if (context.impact.includesSwitched && context.switches.loadingFiles.length > 0) {
            const board = this._webviewPanel?.getBoard();
            if (board) {
                // Determine target column/task for exclusion from search
                let targetColumnId: string | undefined;
                let targetTaskId: string | undefined;
                let targetColumn: any = null;
                let targetTask: any = null;

                if (event.type === 'include_switch') {
                    if (event.target === 'column') {
                        targetColumnId = event.targetId;
                        targetColumn = board.columns.find((c: any) => c.id === targetColumnId);
                    } else if (event.target === 'task') {
                        targetTaskId = event.targetId;
                        const column = board.columns.find((c: any) => c.id === event.columnIdForTask);
                        targetTask = column?.tasks.find((t: any) => t.id === targetTaskId);
                    }
                } else if (event.type === 'user_edit' && event.params.includeSwitch) {
                    if (event.editType === 'column_title') {
                        targetColumnId = event.params.columnId;
                        targetColumn = board.columns.find((c: any) => c.id === targetColumnId);
                    } else if (event.editType === 'task_title') {
                        targetTaskId = event.params.taskId;
                        const column = board.columns.find((c: any) => c.tasks.some((t: any) => t.id === targetTaskId));
                        targetTask = column?.tasks.find((t: any) => t.id === targetTaskId);
                    }
                }

                // Capture current state for rollback (before any modifications)
                if (targetColumn) {
                    // For column include switches, reconstruct the old title from old files
                    let oldTitle = targetColumn.title;
                    if (context.switches.oldFiles && context.switches.oldFiles.length > 0) {
                        // Old title was an include syntax
                        oldTitle = `!!!include(${context.switches.oldFiles[0]})!!!`;
                    }

                    context.rollback = {
                        columnId: targetColumn.id,
                        oldState: {
                            title: oldTitle,
                            displayTitle: targetColumn.displayTitle,
                            tasks: [...(targetColumn.tasks || [])],
                            includeFiles: [...(targetColumn.includeFiles || [])],
                            includeMode: targetColumn.includeMode
                        }
                    };
                } else if (targetTask) {
                    // For task include switches, reconstruct the old title from old files
                    let oldTitle = targetTask.title;
                    if (context.switches.oldFiles && context.switches.oldFiles.length > 0) {
                        // Old title was an include syntax
                        oldTitle = `!!!include(${context.switches.oldFiles[0]})!!!`;
                    }

                    const column = board.columns.find((c: any) => c.tasks.some((t: any) => t.id === targetTaskId));
                    context.rollback = {
                        taskId: targetTask.id,
                        taskColumnId: column?.id,
                        oldState: {
                            title: oldTitle,
                            description: targetTask.description,
                            displayTitle: targetTask.displayTitle,
                            includeFiles: [...(targetTask.includeFiles || [])],
                            includeMode: targetTask.includeMode
                        }
                    };
                }

                // Check each loading file for duplicates
                for (const relativePath of context.switches.loadingFiles) {
                    const existingLocation = this._findFileIncludeLocation(board, relativePath, targetColumnId, targetTaskId);
                    if (existingLocation) {
                        const errorMsg = existingLocation.type === 'column'
                            ? `File "${relativePath}" is already included in column "${existingLocation.columnTitle}"`
                            : `File "${relativePath}" is already included in task "${existingLocation.taskTitle}" in column "${existingLocation.columnTitle}"`;

                        console.error(`[State:ANALYZING_IMPACT] Duplicate include detected: ${errorMsg}`);
                        context.result.error = new Error(errorMsg);
                        return ChangeState.ERROR;
                    }
                }
            }
        }
        */

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
        const vscode = require('vscode');
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
                await file.save();
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

        if (event.type === 'include_switch') {
            if (event.target === 'column') {
                // Column include switch - clear column tasks
                const column = board.columns.find((c: any) => c.id === event.targetId);
                if (column) {
                    column.tasks = [];
                    column.includeFiles = [];
                    column.includeMode = false;
                }
            } else if (event.target === 'task') {
                // Task include switch - clear task description
                const column = board.columns.find((c: any) => c.id === event.columnIdForTask);
                const task = column?.tasks.find((t: any) => t.id === event.targetId);
                if (task) {
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
                    column.tasks = [];
                    column.includeFiles = [];
                    column.includeMode = false;
                }
            } else if (event.editType === 'task_title') {
                const column = board.columns.find((c: any) => c.tasks.some((t: any) => t.id === event.params.taskId));
                const task = column?.tasks.find((t: any) => t.id === event.params.taskId);
                if (task) {
                    task.includeFiles = [];
                    task.displayTitle = '';
                    task.description = '';
                    task.includeMode = false;
                }
            }
        }

        return ChangeState.LOADING_NEW;
    }

    private async _handleLoadingNew(context: ChangeContext): Promise<ChangeState> {
        // CRITICAL FIX: Set flag to block cache invalidation during include switch
        // This prevents column/task IDs from regenerating while we're updating the board
        if (context.impact.includesSwitched && this._webviewPanel) {
            (this._webviewPanel as any).setIncludeSwitchInProgress?.(true);
        }

        // Only load new files if includes are being switched
        if (!context.impact.includesSwitched) {
            return ChangeState.UPDATING_BACKEND;
        }

        const loadingFiles = context.switches.loadingFiles;
        const event = context.event;

        // Get board and store in context so we use the SAME instance throughout
        // This prevents SYNCING_FRONTEND from fetching a stale board after cache invalidation
        const board = this._webviewPanel?.getBoard();
        context.modifiedBoard = board;

        if (!board) {
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

        // BUGFIX: Update title even when removing all includes (loadingFiles.length === 0)
        // This ensures the column/task title is updated to reflect the removal
        // CRITICAL: Check !== undefined, not just truthy, because empty string "" is valid!
        if (event.type === 'include_switch' && event.newTitle !== undefined) {
            if (isColumnSwitch && targetColumn) {
                targetColumn.title = event.newTitle;
                targetColumn.originalTitle = event.newTitle;
            } else if (targetTask) {
                targetTask.title = event.newTitle;
                targetTask.originalTitle = event.newTitle;
            }
        }

        // CRITICAL FIX: Distinguish between "includes removed" vs "includes already loaded"
        // loadingFiles = newFiles that aren't in oldFiles
        // If loadingFiles is empty, check if newFiles is also empty (truly removed) or not (already loaded)
        if (loadingFiles.length === 0) {
            const newFiles = context.switches.newFiles;

            if (newFiles.length === 0) {
                // TRUE REMOVAL: newFiles is empty - user removed all includes
                // Clear include properties when removing all includes
                if (isColumnSwitch && targetColumn) {
                    targetColumn.includeFiles = [];
                    targetColumn.includeMode = false;
                    // Clean displayTitle by removing any !!!include()!!! syntax
                    targetColumn.displayTitle = targetColumn.title.replace(/!!!include\([^)]+\)!!!/g, '').trim();
                } else if (targetTask) {
                    targetTask.includeFiles = [];
                    targetTask.includeMode = false;
                    // Clean displayTitle by removing any !!!include()!!! syntax
                    targetTask.displayTitle = targetTask.title.replace(/!!!include\([^)]+\)!!!/g, '').trim();
                    targetTask.originalTitle = targetTask.title;
                    targetTask.description = '';
                }
            } else {
                // FILES ALREADY LOADED: newFiles has content but all are already in oldFiles
                // CRITICAL FIX: CLEARING_CACHE cleared all properties, we must RESTORE them from loaded files!
                // Otherwise the task/column will have includeMode=false and empty content

                if (targetTask) {
                    // Restore task include properties from already-loaded file
                    const relativePath = newFiles[0];
                    const file = this._fileRegistry.getByRelativePath(relativePath);

                    if (file) {
                        const fullFileContent = file.getContent();

                        if (fullFileContent && fullFileContent.length > 0) {
                            // Restore all properties
                            targetTask.includeMode = true;
                            targetTask.includeFiles = newFiles;
                            targetTask.displayTitle = `# include in ${relativePath}`;
                            targetTask.description = fullFileContent;

                            // Update title if provided in event
                            if (event.type === 'include_switch' && event.newTitle !== undefined) {
                                targetTask.title = event.newTitle;
                                targetTask.originalTitle = event.newTitle;
                            }
                        } else {
                            console.error(`[State:LOADING_NEW] File has no content: ${relativePath}`);
                        }
                    } else {
                        console.error(`[State:LOADING_NEW] File not found in registry: ${relativePath}`);
                    }
                } else if (isColumnSwitch && targetColumn) {
                    // Restore column include properties from already-loaded files
                    targetColumn.includeFiles = newFiles;
                    targetColumn.includeMode = true;

                    // Update title if provided
                    if (event.type === 'include_switch' && event.newTitle !== undefined) {
                        targetColumn.title = event.newTitle;
                        targetColumn.originalTitle = event.newTitle;

                        // Generate displayTitle by replacing !!!include()!!! with %INCLUDE_BADGE:filepath% placeholders
                        // SINGLE SOURCE OF TRUTH: Use shared utility function
                        const includeMatches = event.newTitle.match(INCLUDE_SYNTAX.REGEX);
                        if (includeMatches && includeMatches.length > 0) {
                            let displayTitle = createDisplayTitleWithPlaceholders(event.newTitle, newFiles);

                            if (!displayTitle && newFiles.length > 0) {
                                const path = require('path');
                                displayTitle = path.basename(newFiles[0], path.extname(newFiles[0]));
                            }

                            targetColumn.displayTitle = displayTitle || 'Included Column';
                        } else {
                            targetColumn.displayTitle = event.newTitle;
                        }
                    }

                    // Re-load tasks from already-loaded files
                    const mainFile = this._fileRegistry.getMainFile();
                    const mainFilePath = mainFile?.getPath();
                    const tasks: any[] = [];
                    for (const relativePath of newFiles) {
                        const file = this._fileRegistry.getByRelativePath(relativePath);
                        if (file) {
                            const fileTasks = file.parseToTasks([], targetColumn.id, mainFilePath);
                            tasks.push(...fileTasks);
                        }
                    }
                    targetColumn.tasks = tasks;
                }
            }

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
            // Update column properties
            targetColumn.includeFiles = loadingFiles;
            targetColumn.includeMode = loadingFiles.length > 0;

            // Update title if provided in event
            // CRITICAL: Check !== undefined, not just truthy, because empty string "" is valid!
            if (event.type === 'include_switch' && event.newTitle !== undefined) {
                targetColumn.title = event.newTitle;
                targetColumn.originalTitle = event.newTitle;

                // Generate displayTitle by replacing !!!include()!!! with %INCLUDE_BADGE:filepath% placeholders
                // SINGLE SOURCE OF TRUTH: Use shared utility function
                const includeMatches = event.newTitle.match(INCLUDE_SYNTAX.REGEX);
                if (includeMatches && includeMatches.length > 0) {
                    let displayTitle = createDisplayTitleWithPlaceholders(event.newTitle, loadingFiles);

                    // If no display title after stripping, use filename as title
                    if (!displayTitle && loadingFiles.length > 0) {
                        const path = require('path');
                        displayTitle = path.basename(loadingFiles[0], path.extname(loadingFiles[0]));
                    }

                    targetColumn.displayTitle = displayTitle || 'Included Column';
                } else {
                    // No include syntax - just copy the title
                    targetColumn.displayTitle = event.newTitle;
                }
            }

            // Create/register file instances and load content
            const tasks: any[] = [];

            // Get preloaded content map if this is an include_switch event
            const preloadedContentMap = event.type === 'include_switch' ? event.preloadedContent : undefined;

            for (const relativePath of loadingFiles) {
                // Check if we have preloaded content for this file (from "append tasks to include file" flow)
                const preloadedContent = preloadedContentMap?.get(relativePath);

                // Check if file exists and verify it's the correct type
                const existingFile = this._fileRegistry.getByRelativePath(relativePath);
                const isCorrectType = existingFile?.getFileType() === 'include-column';

                // Create/recreate file instance if not exists or wrong type
                if (!existingFile || !isCorrectType) {
                    if (existingFile && !isCorrectType) {
                        // Unregister old file
                        existingFile.stopWatching();
                        this._fileRegistry.unregister(existingFile);
                    }

                    const columnInclude = fileFactory.createIncludeDirect(relativePath, mainFile, 'include-column', false);
                    columnInclude.setColumnId(targetColumn.id);
                    columnInclude.setColumnTitle(targetColumn.title);
                    this._fileRegistry.register(columnInclude);
                    columnInclude.startWatching();
                }

                // Load content
                const file = this._fileRegistry.getByRelativePath(relativePath);

                if (file) {
                    // PRIORITY: Use preloaded content if available (bypasses registry caching issues)
                    // This is used when "append tasks to include file" was selected
                    if (preloadedContent !== undefined) {
                        // Set the preloaded content on the file (marks as unsaved)
                        file.setContent(preloadedContent, false);
                    } else {
                        // No preloaded content - check if file has cached unsaved changes
                        const hasUnsaved = file.hasUnsavedChanges();
                        if (!hasUnsaved) {
                            // Only reload from disk if there are no unsaved changes
                            await file.reload();
                        }
                    }

                    // Parse tasks from file content
                    if (file.parseToTasks) {
                        const mainFilePath = mainFile.getPath();
                        const fileTasks = file.parseToTasks(targetColumn.tasks, targetColumn.id, mainFilePath);
                        tasks.push(...fileTasks);
                    } else {
                        console.error(`[State:LOADING_NEW] File has no parseToTasks method: ${relativePath}`);
                    }
                } else {
                    console.error(`[State:LOADING_NEW] File not found in registry after creation: ${relativePath}`);
                }
            }

            // Update column with loaded tasks
            targetColumn.tasks = tasks;
            context.result.updatedFiles.push(...loadingFiles);

        } else if (targetTask) {
            // Task include switch - load raw content
            const relativePath = loadingFiles[0]; // Task includes are single file

            // Check if file exists and verify it's the correct type
            const existingFile = this._fileRegistry.getByRelativePath(relativePath);
            const isCorrectType = existingFile?.getFileType() === 'include-task';

            // Create/recreate file instance if not exists or wrong type
            if (!existingFile || !isCorrectType) {
                if (existingFile && !isCorrectType) {
                    // Unregister old file
                    existingFile.stopWatching();
                    this._fileRegistry.unregister(existingFile);
                }

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
                // ALWAYS reload from disk when switching includes to ensure fresh content
                await file.reload();

                const fullFileContent = file.getContent();

                if (fullFileContent && fullFileContent.length > 0) {
                    // displayTitle is metadata (file path indicator), description contains full file content
                    const displayTitle = `# include in ${relativePath}`;

                    // Update task properties
                    targetTask.includeMode = true;
                    targetTask.includeFiles = loadingFiles;
                    targetTask.displayTitle = displayTitle; // UI metadata (not file content)
                    targetTask.description = fullFileContent; // COMPLETE file content

                    // Update title if provided in event
                    // CRITICAL: Check !== undefined, not just truthy, because empty string "" is valid!
                    if (event.type === 'include_switch' && event.newTitle !== undefined) {
                        targetTask.title = event.newTitle;
                        targetTask.originalTitle = event.newTitle;
                    }

                    // Sync file baseline with task content
                    file.setContent(fullFileContent, true);

                    context.result.updatedFiles.push(relativePath);
                } else {
                    console.error(`[State:LOADING_NEW] Failed to load content for ${relativePath}`);
                }
            }
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

        // CRITICAL FIX: Mark main file as modified for include switches
        // When an include file is switched, the task/column title in the main file
        // changes (e.g., !!!include(old.md)!!! -> !!!include(new.md)!!!), so the
        // main file needs to be marked as having unsaved changes
        if (context.impact.includesSwitched) {
            const mainFile = this._fileRegistry.getMainFile();
            if (mainFile && this._webviewPanel) {
                // Mark as unsaved so user is prompted to save before closing
                if (this._webviewPanel.markUnsavedChanges) {
                    this._webviewPanel.markUnsavedChanges();
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

        // TODO: Additional backend updates
        // MIGRATION NOTE: May need to extract additional logic from:
        // - kanbanWebviewPanel.regenerateBoard() for main file changes
        // - kanbanWebviewPanel.markUnsavedChanges() for change tracking
        //
        // Current implementation handles the basics, full migration pending

        return ChangeState.SYNCING_FRONTEND;
    }

    private async _handleSyncingFrontend(context: ChangeContext): Promise<ChangeState> {
        // Only send updates if we have a webview panel
        if (!this._webviewPanel || !(this._webviewPanel as any)._panel) {
            return ChangeState.COMPLETE;
        }

        const panel = (this._webviewPanel as any)._panel;
        const event = context.event;

        // CRITICAL FIX: Use the modified board from context instead of calling getBoard()
        // After cache invalidation, getBoard() would regenerate from disk with stale data
        // The modifiedBoard contains our in-memory changes with fresh include content
        const board = context.modifiedBoard || this._webviewPanel.getBoard();

        if (!board) {
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

                        // Clear dirty flag - we just sent the fresh data, don't let syncDirtyItems re-send stale data
                        if (this._webviewPanel.clearColumnDirty) {
                            this._webviewPanel.clearColumnDirty(column.id);
                        }
                    }
                } else if (event.target === 'task') {
                    // Task include switch
                    const column = board.columns.find((c: any) => c.id === event.columnIdForTask);
                    const task = column?.tasks.find((t: any) => t.id === event.targetId);
                    if (task && column) {
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

                        // Clear dirty flag - we just sent the fresh data, don't let syncDirtyItems re-send stale data
                        if (this._webviewPanel.clearTaskDirty) {
                            this._webviewPanel.clearTaskDirty(task.id);
                        }
                    }
                }
            } else if (event.type === 'user_edit' && event.params.includeSwitch) {
                // User edit with include switch
                if (event.editType === 'column_title') {
                    const column = board.columns.find((c: any) => c.id === event.params.columnId);
                    if (column) {
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

                        // Clear dirty flag - we just sent the fresh data, don't let syncDirtyItems re-send stale data
                        if (this._webviewPanel.clearColumnDirty) {
                            this._webviewPanel.clearColumnDirty(column.id);
                        }
                    }
                } else if (event.editType === 'task_title') {
                    const column = board.columns.find((c: any) => c.tasks.some((t: any) => t.id === event.params.taskId));
                    const task = column?.tasks.find((t: any) => t.id === event.params.taskId);
                    if (task && column) {
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

                        // Clear dirty flag - we just sent the fresh data, don't let syncDirtyItems re-send stale data
                        if (this._webviewPanel.clearTaskDirty) {
                            this._webviewPanel.clearTaskDirty(task.id);
                        }
                    }
                }
            }

        } else if (context.impact.mainFileChanged && event.type === 'file_system_change') {
            // Main file changed externally - send full board refresh
            // Use the webview panel's method to send board update
            if (this._webviewPanel.refreshWebviewContent) {
                await this._webviewPanel.refreshWebviewContent();
                context.result.frontendMessages.push({ type: 'fullBoardRefresh' });
            }

        } else if (context.impact.includeFilesChanged && event.type === 'file_system_change') {
            // Include file changed externally
            // The file instance will handle this autonomously via its change handler
            context.result.frontendMessages.push({ type: 'autonomousFileUpdate' });

        } else if (event.type === 'user_edit' && !context.impact.includesSwitched) {
            // Regular user edit without include switch
            // Frontend already has the change, no update needed
            context.result.frontendMessages.push({ type: 'noUpdateNeeded' });

        } else if (event.type === 'save') {
            // Save event - no frontend update needed
            context.result.frontendMessages.push({ type: 'noUpdateNeeded' });
        }

        return ChangeState.COMPLETE;
    }

    private async _handleComplete(context: ChangeContext): Promise<ChangeState> {
        // CRITICAL FIX: Clear cache protection flag after include switch completes
        // This allows cache invalidation to work normally again
        if (context.impact.includesSwitched && this._webviewPanel) {
            (this._webviewPanel as any).setIncludeSwitchInProgress?.(false);
        }

        context.result.success = true;
        return ChangeState.IDLE;
    }

    private async _handleCancelled(context: ChangeContext): Promise<ChangeState> {
        // Clear cache protection flag in case it was set
        if (this._webviewPanel) {
            (this._webviewPanel as any).setIncludeSwitchInProgress?.(false);
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
        if (context.rollback && this._webviewPanel && (this._webviewPanel as any)._panel) {
            const panel = (this._webviewPanel as any)._panel;
            const board = this._webviewPanel.getBoard();

            if (board) {
                if (context.rollback.columnId) {
                    // Rollback column state
                    const column = board.columns.find((c: any) => c.id === context.rollback!.columnId);
                    if (column) {
                        // Restore backend board state
                        column.title = context.rollback.oldState.title || column.title;
                        column.displayTitle = context.rollback.oldState.displayTitle || column.displayTitle;
                        column.tasks = context.rollback.oldState.tasks || [];
                        column.includeFiles = context.rollback.oldState.includeFiles || [];
                        column.includeMode = context.rollback.oldState.includeMode || false;

                        // Send update to frontend to revert display
                        panel.webview.postMessage({
                            type: 'updateColumnContent',
                            columnId: column.id,
                            columnTitle: column.title,
                            displayTitle: column.displayTitle,
                            tasks: column.tasks,
                            includeFiles: column.includeFiles,
                            includeMode: column.includeMode,
                            isLoadingContent: false
                        });
                    }
                } else if (context.rollback.taskId && context.rollback.taskColumnId) {
                    // Rollback task state
                    const column = board.columns.find((c: any) => c.id === context.rollback!.taskColumnId);
                    const task = column?.tasks.find((t: any) => t.id === context.rollback!.taskId);

                    if (task && column) {
                        // Restore backend board state
                        task.title = context.rollback.oldState.title || task.title;
                        task.description = context.rollback.oldState.description || '';
                        task.displayTitle = context.rollback.oldState.displayTitle || '';
                        task.includeFiles = context.rollback.oldState.includeFiles || [];
                        task.includeMode = context.rollback.oldState.includeMode || false;

                        // Send update to frontend to revert display
                        panel.webview.postMessage({
                            type: 'updateTaskContent',
                            columnId: column.id,
                            taskId: task.id,
                            taskTitle: task.title,
                            originalTitle: task.originalTitle,
                            description: task.description,
                            displayTitle: task.displayTitle,
                            includeFiles: task.includeFiles,
                            includeMode: task.includeMode
                        });
                    }
                }
            }
        }

        // Show error dialog to user with warning about rollback
        const vscode = require('vscode');
        const errorMessage = context.result.error?.message || 'Unknown error';
        const rollbackMsg = context.rollback ? ' The operation has been undone.' : '';

        await vscode.window.showWarningMessage(
            `${errorMessage}${rollbackMsg}`,
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

        // Clear cache protection flag in case it was set
        if (this._webviewPanel) {
            (this._webviewPanel as any).setIncludeSwitchInProgress?.(false);
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
