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

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage } from './interfaces';
import {
    EditTaskMessage,
    AddTaskMessage,
    AddTaskAtPositionMessage,
    DeleteTaskMessage,
    DuplicateTaskMessage,
    InsertTaskBeforeMessage,
    InsertTaskAfterMessage,
    MoveTaskMessage,
    MoveTaskToColumnMessage,
    MoveTaskToTopMessage,
    MoveTaskUpMessage,
    MoveTaskDownMessage,
    MoveTaskToBottomMessage,
    EditTaskTitleMessage,
    UpdateTaskFromStrikethroughDeletionMessage
} from '../core/bridge/MessageTypes';
import { INCLUDE_SYNTAX } from '../constants/IncludeConstants';
import { getErrorMessage } from '../utils/stringUtils';
import { BoardCrudOperations } from '../board/BoardCrudOperations';
import { PresentationGenerator } from '../services/export/PresentationGenerator';

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

    async execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
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
     * Extract include file paths from a title string
     * Returns array of file paths found in !!!include(path)!!! syntax
     */
    private extractIncludeFiles(title: string): string[] {
        const includeFiles: string[] = [];
        const matches = title.match(INCLUDE_SYNTAX.REGEX);
        if (matches) {
            matches.forEach((match: string) => {
                const filePath = match.replace(INCLUDE_SYNTAX.REGEX_SINGLE, '$1').trim();
                includeFiles.push(filePath);
            });
        }
        return includeFiles;
    }

    /**
     * Handle include switch for a task title change
     * Performs the include switch if the title contains or contained include syntax
     * @returns true if include switch was performed, false otherwise
     */
    private async handleTaskIncludeSwitch(
        taskId: string,
        newTitle: string,
        oldIncludeFiles: string[],
        context: CommandContext
    ): Promise<boolean> {
        const hasNewInclude = INCLUDE_SYNTAX.REGEX_SINGLE.test(newTitle);
        const hadOldInclude = oldIncludeFiles.length > 0;

        if (!hasNewInclude && !hadOldInclude) {
            return false;
        }

        const newIncludeFiles = this.extractIncludeFiles(newTitle);

        // Clear dirty flag before stopping edit
        context.clearTaskDirty(taskId);

        // Stop editing before switch
        await context.requestStopEditing();

        try {
            await context.handleIncludeSwitch({
                taskId,
                oldFiles: oldIncludeFiles,
                newFiles: newIncludeFiles,
                newTitle
            });
        } finally {
            context.setEditingInProgress(false);
        }

        return true;
    }

    /**
     * Sync column include file content when tasks within it are modified
     * Regenerates the include file content from the column's current tasks
     */
    private syncColumnIncludeContent(columnId: string, context: CommandContext): void {
        const board = context.getCurrentBoard();
        const column = board ? BoardCrudOperations.findColumnById(board, columnId) : undefined;

        if (!column?.includeMode || !column.includeFiles) {
            return;
        }

        const fileRegistry = context.getFileRegistry();
        for (const relativePath of column.includeFiles) {
            const file = fileRegistry?.getByRelativePath(relativePath);
            if (file) {
                const newContent = PresentationGenerator.fromTasks(column.tasks, {
                    filterIncludes: true,
                    includeMarpDirectives: false
                });
                file.setContent(newContent, false);
            }
        }
    }

    // ============= TASK HANDLERS =============

    /**
     * Handle editTask message - complex with include handling
     */
    private async handleEditTask(message: EditTaskMessage, context: CommandContext): Promise<CommandResult> {
        // Check if this is a title change with include syntax (add/remove/change)
        if (message.taskData?.title !== undefined) {
            const newTitle = message.taskData.title;
            const board = context.getCurrentBoard();
            const column = board ? BoardCrudOperations.findColumnById(board, message.columnId) : undefined;
            const task = column?.tasks.find(t => t.id === message.taskId);

            if (task) {
                // CRITICAL: Skip include detection for column-generated tasks
                const columnHasInclude = column?.includeMode === true;

                if (!columnHasInclude) {
                    try {
                        const oldIncludeFiles = task.includeFiles || [];
                        const handled = await this.handleTaskIncludeSwitch(
                            message.taskId,
                            newTitle,
                            oldIncludeFiles,
                            context
                        );
                        if (handled) {
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
            const column = board ? BoardCrudOperations.findColumnById(board, message.columnId) : undefined;
            const task = column?.tasks.find(t => t.id === message.taskId);

            const columnHasInclude = column?.includeMode === true;

            if (task && task.includeMode && task.includeFiles && !columnHasInclude) {
                const fileRegistry = context.getFileRegistry();

                for (const relativePath of task.includeFiles) {
                    const file = fileRegistry?.getByRelativePath(relativePath);

                    if (file) {
                        const fullFileContent = message.taskData.description || '';
                        file.setContent(fullFileContent, false);
                    }
                }
            }

            // COLUMN INCLUDE: Update column include file content when tasks within it are edited
            if (columnHasInclude) {
                this.syncColumnIncludeContent(message.columnId, context);
            }
        }

        return this.success();
    }

    /**
     * Handle addTask message
     */
    private async handleAddTask(message: AddTaskMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.addTask(
                context.getCurrentBoard()!,
                message.columnId,
                message.taskData
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle addTaskAtPosition message
     */
    private async handleAddTaskAtPosition(message: AddTaskAtPositionMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.addTaskAtPosition(
                context.getCurrentBoard()!,
                message.columnId,
                message.taskData,
                message.insertionIndex
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle deleteTask message
     */
    private async handleDeleteTask(message: DeleteTaskMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.deleteTask(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            ),
            { sendUpdate: false }
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle duplicateTask message
     */
    private async handleDuplicateTask(message: DuplicateTaskMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.duplicateTask(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle insertTaskBefore message
     */
    private async handleInsertTaskBefore(message: InsertTaskBeforeMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.insertTaskBefore(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle insertTaskAfter message
     */
    private async handleInsertTaskAfter(message: InsertTaskAfterMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.insertTaskAfter(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle moveTask message
     */
    private async handleMoveTask(message: MoveTaskMessage, context: CommandContext): Promise<CommandResult> {
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
        // Sync both source and destination columns (in case either is a column include)
        this.syncColumnIncludeContent(message.fromColumnId, context);
        if (message.toColumnId !== message.fromColumnId) {
            this.syncColumnIncludeContent(message.toColumnId, context);
        }
        return this.success();
    }

    /**
     * Handle moveTaskToColumn message
     */
    private async handleMoveTaskToColumn(message: MoveTaskToColumnMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskToColumn(
                context.getCurrentBoard()!,
                message.taskId,
                message.fromColumnId,
                message.toColumnId
            )
        );
        // Sync both source and destination columns (in case either is a column include)
        this.syncColumnIncludeContent(message.fromColumnId, context);
        if (message.toColumnId !== message.fromColumnId) {
            this.syncColumnIncludeContent(message.toColumnId, context);
        }
        return this.success();
    }

    /**
     * Handle moveTaskToTop message
     */
    private async handleMoveTaskToTop(message: MoveTaskToTopMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskToTop(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle moveTaskUp message
     */
    private async handleMoveTaskUp(message: MoveTaskUpMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskUp(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle moveTaskDown message
     */
    private async handleMoveTaskDown(message: MoveTaskDownMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskDown(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle moveTaskToBottom message
     */
    private async handleMoveTaskToBottom(message: MoveTaskToBottomMessage, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveTaskToBottom(
                context.getCurrentBoard()!,
                message.taskId,
                message.columnId
            )
        );
        this.syncColumnIncludeContent(message.columnId, context);
        return this.success();
    }

    /**
     * Handle editTaskTitle message - complex with include handling
     */
    private async handleEditTaskTitle(message: EditTaskTitleMessage, context: CommandContext): Promise<CommandResult> {
        const currentBoard = context.getCurrentBoard();
        const targetColumn = currentBoard ? BoardCrudOperations.findColumnById(currentBoard, message.columnId) : undefined;
        const task = targetColumn?.tasks.find(t => t.id === message.taskId);

        // Skip include detection for column-generated tasks
        const columnHasTaskInclude = targetColumn?.includeMode === true;

        if (!columnHasTaskInclude && task) {
            const oldIncludeFiles = task.includeFiles || [];
            try {
                const handled = await this.handleTaskIncludeSwitch(
                    message.taskId,
                    message.title,
                    oldIncludeFiles,
                    context
                );
                if (handled) {
                    return this.success();
                }
            } catch (error) {
                if (getErrorMessage(error) !== 'USER_CANCELLED') {
                    throw error;
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

        // Sync column include content if this task is in a column include
        if (columnHasTaskInclude) {
            this.syncColumnIncludeContent(message.columnId, context);
        }

        context.setEditingInProgress(false);

        return this.success();
    }

    /**
     * Handle updateTaskFromStrikethroughDeletion message
     */
    private async handleUpdateTaskFromStrikethroughDeletion(message: UpdateTaskFromStrikethroughDeletionMessage, context: CommandContext): Promise<CommandResult> {
        const { taskId, columnId, newContent, contentType } = message;

        const board = context.getCurrentBoard();
        if (!board) {
            console.error('[TaskCommands] No current board available for strikethrough deletion');
            return this.failure('No current board available');
        }

        // Content is already in markdown format from frontend
        const updateData: { title?: string; description?: string } = {};
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

        // Sync column include content if applicable
        this.syncColumnIncludeContent(columnId, context);

        return this.success();
    }
}
