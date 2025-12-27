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

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage, MessageHandler } from './interfaces';
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
import { INCLUDE_SYNTAX, extractIncludeFiles } from '../constants/IncludeConstants';
import { getErrorMessage } from '../utils/stringUtils';
import { findColumn, findColumnContainingTask } from '../actions/helpers';
import { TaskActions } from '../actions';
import { UndoCapture } from '../core/stores/UndoCapture';

/**
 * Task Commands Handler
 *
 * Processes all task-related messages from the webview.
 */
export class TaskCommands extends SwitchBasedCommand {
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

    protected handlers: Record<string, MessageHandler> = {
        'editTask': (msg, ctx) => this.handleEditTask(msg as EditTaskMessage, ctx),
        'addTask': (msg, ctx) => this.handleAddTask(msg as AddTaskMessage, ctx),
        'addTaskAtPosition': (msg, ctx) => this.handleAddTaskAtPosition(msg as AddTaskAtPositionMessage, ctx),
        'deleteTask': (msg, ctx) => this.handleDeleteTask(msg as DeleteTaskMessage, ctx),
        'duplicateTask': (msg, ctx) => this.handleDuplicateTask(msg as DuplicateTaskMessage, ctx),
        'insertTaskBefore': (msg, ctx) => this.handleInsertTaskBefore(msg as InsertTaskBeforeMessage, ctx),
        'insertTaskAfter': (msg, ctx) => this.handleInsertTaskAfter(msg as InsertTaskAfterMessage, ctx),
        'moveTask': (msg, ctx) => this.handleMoveTask(msg as MoveTaskMessage, ctx),
        'moveTaskToColumn': (msg, ctx) => this.handleMoveTaskToColumn(msg as MoveTaskToColumnMessage, ctx),
        'moveTaskToTop': (msg, ctx) => this.handleMoveTaskToTop(msg as MoveTaskToTopMessage, ctx),
        'moveTaskUp': (msg, ctx) => this.handleMoveTaskUp(msg as MoveTaskUpMessage, ctx),
        'moveTaskDown': (msg, ctx) => this.handleMoveTaskDown(msg as MoveTaskDownMessage, ctx),
        'moveTaskToBottom': (msg, ctx) => this.handleMoveTaskToBottom(msg as MoveTaskToBottomMessage, ctx),
        'editTaskTitle': (msg, ctx) => this.handleEditTaskTitle(msg as EditTaskTitleMessage, ctx),
        'updateTaskFromStrikethroughDeletion': (msg, ctx) => this.handleUpdateTaskFromStrikethroughDeletion(msg as UpdateTaskFromStrikethroughDeletionMessage, ctx)
    };

    // ============= HELPER METHODS =============

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

        const newIncludeFiles = extractIncludeFiles(newTitle);

        // Clear dirty flag before stopping edit
        context.clearTaskDirty(taskId);

        // Stop editing before switch
        await context.requestStopEditing();

        // Capture undo state BEFORE include switch (include switches bypass action system)
        const board = context.getCurrentBoard();
        const column = board ? findColumnContainingTask(board, taskId) : null;
        if (board && column) {
            context.boardStore.saveUndoEntry(
                UndoCapture.forTask(board, taskId, column.id, 'includeSwitch')
            );
        }

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

    // ============= TASK HANDLERS =============
    // NOTE: Column include file content is synced automatically by BoardSyncHandler._propagateEditsToIncludeFiles()
    // which runs when emitBoardChanged is called (via performBoardAction). No manual sync needed here.

    /**
     * Handle editTask message - complex with include handling
     */
    private async handleEditTask(message: EditTaskMessage, context: CommandContext): Promise<CommandResult> {
        // Check if this is a title change with include syntax (add/remove/change)
        if (message.taskData?.title !== undefined) {
            const newTitle = message.taskData.title;
            const board = context.getCurrentBoard();
            const column = board ? findColumn(board, message.columnId) : undefined;
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
        await this.executeAction(
            context,
            TaskActions.update(message.taskId, message.columnId, message.taskData),
            { sendUpdates: false }
        );

        // If this is a task include and description was updated, update the file instance
        if (message.taskData.description !== undefined) {
            const board = context.getCurrentBoard();
            const column = board ? findColumn(board, message.columnId) : undefined;
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

        }

        return this.success();
    }

    /**
     * Handle addTask message
     */
    private async handleAddTask(message: AddTaskMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.add(message.columnId, message.taskData)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add task');
    }

    /**
     * Handle addTaskAtPosition message
     */
    private async handleAddTaskAtPosition(message: AddTaskAtPositionMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.add(message.columnId, message.taskData, message.insertionIndex)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add task');
    }

    /**
     * Handle deleteTask message
     */
    private async handleDeleteTask(message: DeleteTaskMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.remove(message.taskId, message.columnId),
            { sendUpdates: false }
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to delete task');
    }

    /**
     * Handle duplicateTask message
     */
    private async handleDuplicateTask(message: DuplicateTaskMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.duplicate(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to duplicate task');
    }

    /**
     * Handle insertTaskBefore message
     */
    private async handleInsertTaskBefore(message: InsertTaskBeforeMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.insertBefore(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert task');
    }

    /**
     * Handle insertTaskAfter message
     */
    private async handleInsertTaskAfter(message: InsertTaskAfterMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.insertAfter(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert task');
    }

    /**
     * Handle moveTask message
     */
    private async handleMoveTask(message: MoveTaskMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.move(message.taskId, message.fromColumnId, message.toColumnId, message.newIndex)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToColumn message
     */
    private async handleMoveTaskToColumn(message: MoveTaskToColumnMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveToColumn(message.taskId, message.fromColumnId, message.toColumnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToTop message
     */
    private async handleMoveTaskToTop(message: MoveTaskToTopMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveToTop(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskUp message
     */
    private async handleMoveTaskUp(message: MoveTaskUpMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveUp(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskDown message
     */
    private async handleMoveTaskDown(message: MoveTaskDownMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveDown(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToBottom message
     */
    private async handleMoveTaskToBottom(message: MoveTaskToBottomMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveToBottom(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle editTaskTitle message - complex with include handling
     */
    private async handleEditTaskTitle(message: EditTaskTitleMessage, context: CommandContext): Promise<CommandResult> {
        const currentBoard = context.getCurrentBoard();
        const targetColumn = currentBoard ? findColumn(currentBoard, message.columnId) : undefined;
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
        await this.executeAction(
            context,
            TaskActions.updateTitle(message.taskId, message.columnId, message.title),
            { sendUpdates: false }
        );

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

        await this.executeAction(
            context,
            TaskActions.update(taskId, columnId, updateData),
            { sendUpdates: false }
        );

        return this.success();
    }
}
