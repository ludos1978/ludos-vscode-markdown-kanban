/**
 * Task Actions - Factory functions for task operations
 *
 * Each function creates a BoardAction for a specific task operation.
 * Actions know their targets for proper undo/redo handling.
 */

import { BoardAction } from './types';
import { KanbanTask } from '../markdownParser';
import { findColumn, findTaskIndex } from './helpers';
import { IdGenerator } from '../utils/idGenerator';

// ============= CONTENT UPDATES (target: task) =============

/**
 * Update task title
 */
export const updateTitle = (
    taskId: string,
    columnId: string,
    newTitle: string
): BoardAction => ({
    type: 'task:updateTitle',
    targets: [{ type: 'task', id: taskId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) return false;

        task.title = newTitle;
        return true;
    }
});

/**
 * Update task description
 */
export const updateDescription = (
    taskId: string,
    columnId: string,
    newDescription: string
): BoardAction => ({
    type: 'task:updateDescription',
    targets: [{ type: 'task', id: taskId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) return false;

        task.description = newDescription;
        return true;
    }
});

/**
 * Update task with partial data (title, description, displayTitle)
 */
export const update = (
    taskId: string,
    columnId: string,
    taskData: Partial<KanbanTask>
): BoardAction => ({
    type: 'task:update',
    targets: [{ type: 'task', id: taskId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) return false;

        if (taskData.title !== undefined) {
            task.title = taskData.title;
        }
        if (taskData.description !== undefined) {
            task.description = taskData.description;
        }
        if (taskData.displayTitle !== undefined && task.includeMode) {
            task.displayTitle = taskData.displayTitle;
        }
        return true;
    }
});


// ============= STRUCTURAL CHANGES (target: column) =============

/**
 * Add a new task to a column
 * Returns the new task ID on success
 */
export const add = (
    columnId: string,
    taskData: Partial<KanbanTask>,
    index?: number
): BoardAction<string | null> => ({
    type: 'task:add',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const newTask: KanbanTask = {
            id: taskData.id || IdGenerator.generateTaskId(),
            title: taskData.title || '',
            description: taskData.description,
            displayTitle: taskData.displayTitle,
            originalTitle: taskData.originalTitle,
            includeMode: taskData.includeMode || false,
            includeFiles: taskData.includeFiles || [],
            regularIncludeFiles: taskData.regularIncludeFiles || []
        };

        if (index !== undefined && index >= 0 && index <= column.tasks.length) {
            column.tasks.splice(index, 0, newTask);
        } else {
            column.tasks.push(newTask);
        }

        return newTask.id;
    }
});

/**
 * Delete a task from a column
 */
export const remove = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'task:delete',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const taskIndex = findTaskIndex(column, taskId);
        if (taskIndex === -1) return false;

        column.tasks.splice(taskIndex, 1);
        return true;
    }
});

/**
 * Reorder a task within the same column
 */
export const reorder = (
    taskId: string,
    columnId: string,
    newIndex: number
): BoardAction => ({
    type: 'task:reorder',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findTaskIndex(column, taskId);
        if (currentIndex === -1) return false;

        const [task] = column.tasks.splice(currentIndex, 1);
        column.tasks.splice(newIndex, 0, task);
        return true;
    }
});

/**
 * Move a task to the top of its column
 */
export const moveToTop = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'task:moveToTop',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findTaskIndex(column, taskId);
        if (currentIndex === -1 || currentIndex === 0) return false;

        const [task] = column.tasks.splice(currentIndex, 1);
        column.tasks.unshift(task);
        return true;
    }
});

/**
 * Move a task up one position
 */
export const moveUp = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'task:moveUp',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findTaskIndex(column, taskId);
        if (currentIndex === -1 || currentIndex === 0) return false;

        // Swap with task above
        const task = column.tasks[currentIndex];
        column.tasks[currentIndex] = column.tasks[currentIndex - 1];
        column.tasks[currentIndex - 1] = task;
        return true;
    }
});

/**
 * Move a task down one position
 */
export const moveDown = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'task:moveDown',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findTaskIndex(column, taskId);
        if (currentIndex === -1 || currentIndex === column.tasks.length - 1) return false;

        // Swap with task below
        const task = column.tasks[currentIndex];
        column.tasks[currentIndex] = column.tasks[currentIndex + 1];
        column.tasks[currentIndex + 1] = task;
        return true;
    }
});

/**
 * Move a task to the bottom of its column
 */
export const moveToBottom = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'task:moveToBottom',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findTaskIndex(column, taskId);
        if (currentIndex === -1 || currentIndex === column.tasks.length - 1) return false;

        const [task] = column.tasks.splice(currentIndex, 1);
        column.tasks.push(task);
        return true;
    }
});

/**
 * Move a task to a different column at a specific index
 * Targets both source and destination columns
 */
export const move = (
    taskId: string,
    fromColumnId: string,
    toColumnId: string,
    newIndex: number
): BoardAction => ({
    type: 'task:move',
    targets: [
        { type: 'column', id: fromColumnId },
        { type: 'column', id: toColumnId }
    ],
    execute: (board) => {
        const fromColumn = findColumn(board, fromColumnId);
        const toColumn = findColumn(board, toColumnId);
        if (!fromColumn || !toColumn) return false;

        const taskIndex = findTaskIndex(fromColumn, taskId);
        if (taskIndex === -1) return false;

        const [task] = fromColumn.tasks.splice(taskIndex, 1);
        toColumn.tasks.splice(newIndex, 0, task);
        return true;
    }
});

/**
 * Move a task to a different column (appends to end)
 * Targets both source and destination columns
 */
export const moveToColumn = (
    taskId: string,
    fromColumnId: string,
    toColumnId: string
): BoardAction => ({
    type: 'task:moveToColumn',
    targets: [
        { type: 'column', id: fromColumnId },
        { type: 'column', id: toColumnId }
    ],
    execute: (board) => {
        const fromColumn = findColumn(board, fromColumnId);
        const toColumn = findColumn(board, toColumnId);
        if (!fromColumn || !toColumn) return false;

        const taskIndex = findTaskIndex(fromColumn, taskId);
        if (taskIndex === -1) return false;

        const [task] = fromColumn.tasks.splice(taskIndex, 1);
        toColumn.tasks.push(task);
        return true;
    }
});

/**
 * Duplicate a task within the same column
 * Returns the new task ID on success
 */
export const duplicate = (
    taskId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'task:duplicate',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findTaskIndex(column, taskId);
        if (taskIndex === -1) return null;

        const originalTask = column.tasks[taskIndex];
        const newTask: KanbanTask = {
            ...JSON.parse(JSON.stringify(originalTask)),
            id: IdGenerator.generateTaskId()
        };

        // Insert after the original
        column.tasks.splice(taskIndex + 1, 0, newTask);
        return newTask.id;
    }
});

/**
 * Update task include files
 */
export const updateIncludeFiles = (
    taskId: string,
    columnId: string,
    includeFiles: string[],
    includeMode: boolean
): BoardAction => ({
    type: 'task:updateIncludeFiles',
    targets: [{ type: 'task', id: taskId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) return false;

        task.includeFiles = includeFiles;
        task.includeMode = includeMode;
        return true;
    }
});

/**
 * Insert a new empty task before an existing task
 * Returns the new task ID on success
 */
export const insertBefore = (
    taskId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'task:insertBefore',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findTaskIndex(column, taskId);
        if (taskIndex === -1) return null;

        const newTask: KanbanTask = {
            id: IdGenerator.generateTaskId(),
            title: '',
            description: ''
        };

        column.tasks.splice(taskIndex, 0, newTask);
        return newTask.id;
    }
});

/**
 * Insert a new empty task after an existing task
 * Returns the new task ID on success
 */
export const insertAfter = (
    taskId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'task:insertAfter',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findTaskIndex(column, taskId);
        if (taskIndex === -1) return null;

        const newTask: KanbanTask = {
            id: IdGenerator.generateTaskId(),
            title: '',
            description: ''
        };

        column.tasks.splice(taskIndex + 1, 0, newTask);
        return newTask.id;
    }
});
