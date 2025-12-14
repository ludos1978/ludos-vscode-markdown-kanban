/**
 * Task Commands
 *
 * Handles all task-related message operations:
 * - editTask, addTask, deleteTask, duplicateTask
 * - moveTask, moveTaskToColumn, moveTaskToTop/Up/Down/Bottom
 * - insertTaskBefore/After
 * - updateTaskFromStrikethroughDeletion
 * - editTaskTitle
 *
 * @module commands/TaskCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { INCLUDE_SYNTAX } from '../constants/IncludeConstants';
import { getErrorMessage } from '../utils/stringUtils';

/**
 * Task Commands Handler
 *
 * Processes all task-related messages from the webview.
 */
export class TaskCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'task-commands',
        name: 'Task Commands',
        description: 'Handles task creation, editing, deletion, and movement',
        messageTypes: [
            'editTask',
            'addTask',
            'addTaskAtPosition',
            'deleteTask',
            'duplicateTask',
            'insertTaskBefore',
            'insertTaskAfter',
            'moveTask',
            'moveTaskToColumn',
            'moveTaskToTop',
            'moveTaskUp',
            'moveTaskDown',
            'moveTaskToBottom',
            'editTaskTitle',
            'updateTaskFromStrikethroughDeletion'
        ],
        priority: 100
    };

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'editTask':
                    return await this.handleEditTask(message, context);
                case 'addTask':
                    return await this.handleAddTask(message, context);
                case 'addTaskAtPosition':
                    return await this.handleAddTaskAtPosition(message, context);
                case 'deleteTask':
                    return await this.handleDeleteTask(message, context);
                case 'duplicateTask':
                    return await this.handleDuplicateTask(message, context);
                case 'insertTaskBefore':
                    return await this.handleInsertTaskBefore(message, context);
                case 'insertTaskAfter':
                    return await this.handleInsertTaskAfter(message, context);
                case 'moveTask':
                    return await this.handleMoveTask(message, context);
                case 'moveTaskToColumn':
                    return await this.handleMoveTaskToColumn(message, context);
                case 'moveTaskToTop':
                    return await this.handleMoveTaskToTop(message, context);
                case 'moveTaskUp':
                    return await this.handleMoveTaskUp(message, context);
                case 'moveTaskDown':
                    return await this.handleMoveTaskDown(message, context);
                case 'moveTaskToBottom':
                    return await this.handleMoveTaskToBottom(message, context);
                case 'editTaskTitle':
                    return await this.handleEditTaskTitle(message, context);
                case 'updateTaskFromStrikethroughDeletion':
                    return await this.handleUpdateTaskFromStrikethroughDeletion(message, context);
                default:
                    return this.failure(`Unknown task command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[TaskCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= HELPER METHODS =============

    /**
     * Perform a board action with undo support and update handling
     */
    private async performBoardAction(
        context: CommandContext,
        action: () => boolean,
        options: { saveUndo?: boolean; sendUpdate?: boolean } = {}
    ): Promise<boolean> {
        const { saveUndo = true, sendUpdate = true } = options;

        const board = context.getCurrentBoard();
        if (!board) {
            return false;
        }

        if (saveUndo) {
            context.boardStore.saveStateForUndo(board);
        }

        const success = action();

        if (success) {
            if (sendUpdate) {
                // Backend-initiated change: mark unsaved and send update to frontend
                context.markUnsavedChanges(true);
                await context.onBoardUpdate();
            } else {
                // Frontend-initiated change: just mark backend as unsaved
                context.markUnsavedChanges(true, context.getCurrentBoard());
            }
        }

        return success;
    }

    // ============= TASK HANDLERS =============

    /**
     * Handle editTask message - complex with include handling
     */
    private async handleEditTask(message: any, context: CommandContext): Promise<CommandResult> {
        // Check if this is a title change with include syntax (add/remove/change)
        if (message.taskData?.title !== undefined) {
            const newTitle = message.taskData.title;
            const hasNewInclude = INCLUDE_SYNTAX.REGEX_SINGLE.test(newTitle);

            const board = context.getCurrentBoard();
            const column = board?.columns.find((c: any) => c.id === message.columnId);
            const task = column?.tasks.find((t: any) => t.id === message.taskId);

            if (task) {
                // CRITICAL FIX: Skip include detection for column-generated tasks
                const columnHasInclude = column?.includeMode === true;

                if (!columnHasInclude) {
                    try {
                        const oldIncludeFiles = task.includeFiles || [];
                        const hadOldInclude = oldIncludeFiles.length > 0;

                        if (hasNewInclude || hadOldInclude) {
                            const panel = context.getWebviewPanel();
                            if (!panel) {
                                return this.failure('No panel available');
                            }

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
                            if ((panel as any).clearTaskDirty) {
                                (panel as any).clearTaskDirty(message.taskId);
                            }

                            // Stop editing before switch
                            // Note: requestStopEditing is on MessageHandler, need different approach
                            // For now, we'll handle this by calling through the panel
                            if ((panel as any)._messageHandler?.requestStopEditing) {
                                await (panel as any)._messageHandler.requestStopEditing();
                            }

                            await (panel as any).handleIncludeSwitch({
                                taskId: message.taskId,
                                oldFiles: oldIncludeFiles,
                                newFiles: newIncludeFiles,
                                newTitle: newTitle
                            });

                            (panel as any).setEditingInProgress(false);
                            return this.success();
                        }
                    } catch (error) {
                        console.error(`[TaskCommands.editTask] Exception in include handling:`, error);
                    }
                }
            }
        }

        // Regular task edit (no include changes)
        await this.performBoardAction(
            context,
            () => context.boardOperations.editTask(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId,
                message.taskData
            ),
            { sendUpdate: false }
        );

        // If this is a task include and description was updated, update the file instance
        if (message.taskData.description !== undefined) {
            const board = context.getCurrentBoard();
            const column = board?.columns.find((c: any) => c.id === message.columnId);
            const task = column?.tasks.find((t: any) => t.id === message.taskId);

            const columnHasInclude = column?.includeMode === true;

            if (task && task.includeMode && task.includeFiles && !columnHasInclude) {
                const panel = context.getWebviewPanel();
                const fileRegistry = (panel as any)?._fileRegistry;

                for (const relativePath of task.includeFiles) {
                    const file = fileRegistry?.getByRelativePath(relativePath);

                    if (file) {
                        const fullFileContent = message.taskData.description || '';
                        file.setContent(fullFileContent, false);
                    }
                }
            }
        }

        return this.success();
    }

    /**
     * Handle addTask message
     */
    private async handleAddTask(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.addTask(
                context.getCurrentBoard()!,
                message.columnId,
                message.taskData
            )
        );
        return this.success();
    }

    /**
     * Handle addTaskAtPosition message
     */
    private async handleAddTaskAtPosition(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.addTaskAtPosition(
                context.getCurrentBoard()!,
                message.columnId,
                message.taskData,
                message.insertionIndex
            )
        );
        return this.success();
    }

    /**
     * Handle deleteTask message
     */
    private async handleDeleteTask(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.deleteTask(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            ),
            { sendUpdate: false }
        );
        return this.success();
    }

    /**
     * Handle duplicateTask message
     */
    private async handleDuplicateTask(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.duplicateTask(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        return this.success();
    }

    /**
     * Handle insertTaskBefore message
     */
    private async handleInsertTaskBefore(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.insertTaskBefore(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        return this.success();
    }

    /**
     * Handle insertTaskAfter message
     */
    private async handleInsertTaskAfter(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.insertTaskAfter(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        return this.success();
    }

    /**
     * Handle moveTask message
     */
    private async handleMoveTask(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTask(
                context.getCurrentBoard()!,
                message.taskId,
                message.fromColumnId,
                message.toColumnId,
                message.newIndex
            )
        );
        return this.success();
    }

    /**
     * Handle moveTaskToColumn message
     */
    private async handleMoveTaskToColumn(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskToColumn(
                context.getCurrentBoard()!,
                message.taskId,
                message.fromColumnId,
                message.toColumnId
            )
        );
        return this.success();
    }

    /**
     * Handle moveTaskToTop message
     */
    private async handleMoveTaskToTop(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskToTop(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        return this.success();
    }

    /**
     * Handle moveTaskUp message
     */
    private async handleMoveTaskUp(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskUp(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        return this.success();
    }

    /**
     * Handle moveTaskDown message
     */
    private async handleMoveTaskDown(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskDown(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        return this.success();
    }

    /**
     * Handle moveTaskToBottom message
     */
    private async handleMoveTaskToBottom(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskToBottom(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        return this.success();
    }

    /**
     * Handle editTaskTitle message - complex with include handling
     */
    private async handleEditTaskTitle(message: any, context: CommandContext): Promise<CommandResult> {
        const currentBoard = context.getCurrentBoard();
        const targetColumn = currentBoard?.columns.find(col => col.id === message.columnId);
        const task = targetColumn?.tasks.find(t => t.id === message.taskId);

        // Skip include detection for column-generated tasks
        const columnHasTaskInclude = targetColumn?.includeMode === true;

        if (!columnHasTaskInclude && task) {
            // Check if the new title contains include syntax
            const hasTaskIncludeMatches = message.title.match(INCLUDE_SYNTAX.REGEX);
            const oldTaskIncludeMatches = (task.title || '').match(INCLUDE_SYNTAX.REGEX);
            const hasTaskIncludeChanges = hasTaskIncludeMatches || oldTaskIncludeMatches;

            if (hasTaskIncludeChanges) {
                // Extract the include files from the new title
                const newIncludeFiles: string[] = [];
                if (hasTaskIncludeMatches) {
                    hasTaskIncludeMatches.forEach((match: string) => {
                        const filePath = match.replace(INCLUDE_SYNTAX.REGEX_SINGLE, '$1').trim();
                        newIncludeFiles.push(filePath);
                    });
                }

                const panel = context.getWebviewPanel();
                if (panel) {
                    const oldTaskIncludeFiles = task.includeFiles || [];

                    // Clear dirty flag BEFORE stopping editing
                    if ((panel as any).clearTaskDirty) {
                        (panel as any).clearTaskDirty(message.taskId);
                    }

                    // Stop editing before switch
                    if ((panel as any)._messageHandler?.requestStopEditing) {
                        await (panel as any)._messageHandler.requestStopEditing();
                    }

                    try {
                        await (panel as any).handleIncludeSwitch({
                            taskId: message.taskId,
                            oldFiles: oldTaskIncludeFiles,
                            newFiles: newIncludeFiles,
                            newTitle: message.title
                        });

                        (panel as any).setEditingInProgress(false);
                    } catch (error: any) {
                        (panel as any).setEditingInProgress(false);

                        if (error.message !== 'USER_CANCELLED') {
                            throw error;
                        }
                    }
                }
                return this.success();
            }
        }

        // Regular title edit without include syntax
        await this.performBoardAction(
            context,
            () => context.boardOperations.editTask(
                currentBoard!,
                message.taskId,
                message.columnId,
                { title: message.title }
            ),
            { sendUpdate: false }
        );

        const panel = context.getWebviewPanel();
        if (panel) {
            (panel as any).setEditingInProgress(false);
        }

        return this.success();
    }

    /**
     * Handle updateTaskFromStrikethroughDeletion message
     */
    private async handleUpdateTaskFromStrikethroughDeletion(message: any, context: CommandContext): Promise<CommandResult> {
        const { taskId, columnId, newContent, contentType } = message;

        const board = context.getCurrentBoard();
        if (!board) {
            console.error('[TaskCommands] No current board available for strikethrough deletion');
            return this.failure('No current board available');
        }

        // Content is already in markdown format from frontend
        const updateData: any = {};
        if (contentType === 'title') {
            updateData.title = newContent;
        } else if (contentType === 'description') {
            updateData.description = newContent;
        } else {
            console.warn('[TaskCommands] Unknown content type, defaulting to title');
            updateData.title = newContent;
        }

        await this.performBoardAction(
            context,
            () => context.boardOperations.editTask(board, taskId, columnId, updateData),
            { sendUpdate: false }
        );

        return this.success();
    }
}
