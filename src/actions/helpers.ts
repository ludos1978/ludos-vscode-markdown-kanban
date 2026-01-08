/**
 * Action Helpers - Utility functions for actions
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';
import { setRowTag } from '../constants/TagPatterns';

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
        const rowNum = parseInt(rowMatch[1], 10);
        return Math.max(rowNum, 1);
    }
    return 1;
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
 * Update the #row tag in a column title (removes existing row tags)
 */
export function setColumnRowTag(column: KanbanColumn, rowNumber: number): void {
    column.title = setRowTag(column.title, rowNumber);
}

/**
 * Build a new column order after moving a column to a new position
 */
export function buildColumnOrderAfterMove(
    columns: KanbanColumn[],
    currentIndex: number,
    newPosition: number
): string[] | null {
    if (currentIndex < 0 || currentIndex >= columns.length) {
        return null;
    }

    const order = columns
        .filter((_, index) => index !== currentIndex)
        .map(column => column.id);

    order.splice(newPosition, 0, columns[currentIndex].id);
    return order;
}

/**
 * Reorder board columns to match the provided ID order
 */
export function applyColumnOrder(board: KanbanBoard, order: string[]): void {
    const columnMap = new Map<string, KanbanColumn>();
    board.columns.forEach(column => columnMap.set(column.id, column));

    const reordered: KanbanColumn[] = [];
    order.forEach(id => {
        const column = columnMap.get(id);
        if (column) {
            reordered.push(column);
        }
    });

    board.columns = reordered;
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
