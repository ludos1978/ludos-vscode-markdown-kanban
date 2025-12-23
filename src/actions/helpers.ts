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

/**
 * Extract row number from column title (e.g., "Column #row2" -> 2)
 * Returns 1 if no row tag found
 */
export function getColumnRow(column: KanbanColumn): number {
    if (!column.title) return 1;

    const rowMatch = column.title.match(/#row(\d+)\b/i);
    if (rowMatch) {
        const rowNum = parseInt(rowMatch[1]);
        return Math.max(rowNum, 1);
    }
    return 1;
}

/**
 * Remove row tag from title and return clean title
 */
export function cleanRowTag(title: string): string {
    return title
        .replace(/#row\d+\b/gi, '')
        .replace(/\s+#row\d+/gi, '')
        .replace(/#row\d+\s+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Extract numeric tag from task title (e.g., "Task #42" -> 42)
 */
export function extractNumericTag(title: string): number | null {
    if (!title) return null;
    const match = title.match(/#(\d+(?:\.\d+)?)\b/);
    if (match && match[1]) {
        return parseFloat(match[1]);
    }
    return null;
}

/**
 * Find a task by ID, searching all columns
 * Returns object with task, column, and index
 */
export function findTaskById(
    board: KanbanBoard,
    taskId: string
): { task: KanbanTask; column: KanbanColumn; index: number } | undefined {
    for (const column of board.columns) {
        const index = column.tasks.findIndex(t => t.id === taskId);
        if (index !== -1) {
            return { task: column.tasks[index], column, index };
        }
    }
    return undefined;
}

/**
 * Find the column that contains a task with the given ID
 */
export function findColumnContainingTask(board: KanbanBoard, taskId: string): KanbanColumn | undefined {
    return board.columns.find(c => c.tasks.some(t => t.id === taskId));
}

/**
 * Find a task by ID within a specific column
 * Returns object with task, column, and index, or undefined if not found
 */
export function findTaskInColumn(
    board: KanbanBoard,
    columnId: string,
    taskId: string
): { task: KanbanTask; column: KanbanColumn; index: number } | undefined {
    const column = findColumn(board, columnId);
    if (!column) return undefined;

    const index = column.tasks.findIndex(t => t.id === taskId);
    if (index === -1) return undefined;

    return { task: column.tasks[index], column, index };
}
