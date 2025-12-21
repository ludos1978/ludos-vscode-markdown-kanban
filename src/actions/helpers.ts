/**
 * Action Helpers - Utility functions for actions
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';

/**
 * Find a task by ID across all columns
 */
export function findTask(board: KanbanBoard, taskId: string): KanbanTask | undefined {
    for (const column of board.columns) {
        const task = column.tasks.find(t => t.id === taskId);
        if (task) return task;
    }
    return undefined;
}

/**
 * Find a task and its containing column
 */
export function findTaskWithColumn(
    board: KanbanBoard,
    taskId: string
): { task: KanbanTask; column: KanbanColumn } | undefined {
    for (const column of board.columns) {
        const task = column.tasks.find(t => t.id === taskId);
        if (task) return { task, column };
    }
    return undefined;
}

/**
 * Find a column by ID
 */
export function findColumn(board: KanbanBoard, columnId: string): KanbanColumn | undefined {
    return board.columns.find(c => c.id === columnId);
}

/**
 * Find task index within a column
 */
export function findTaskIndex(column: KanbanColumn, taskId: string): number {
    return column.tasks.findIndex(t => t.id === taskId);
}

/**
 * Find column index within the board
 */
export function findColumnIndex(board: KanbanBoard, columnId: string): number {
    return board.columns.findIndex(c => c.id === columnId);
}
