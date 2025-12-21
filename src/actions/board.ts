/**
 * Board Actions - Factory functions for board-level operations
 *
 * These actions affect the entire board and require full refresh.
 */

import { BoardAction } from './types';
import { KanbanBoard } from '../markdownParser';

/**
 * Sort all tasks in all columns
 */
export const sortAllTasks = (
    sortFn: (a: any, b: any) => number
): BoardAction => ({
    type: 'board:sortAllTasks',
    targets: [], // Full board refresh
    execute: (board) => {
        for (const column of board.columns) {
            column.tasks.sort(sortFn);
        }
        return true;
    }
});

/**
 * Sort tasks within a specific column
 */
export const sortColumnTasks = (
    columnId: string,
    sortFn: (a: any, b: any) => number
): BoardAction => ({
    type: 'board:sortColumnTasks',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = board.columns.find(c => c.id === columnId);
        if (!column) return false;

        column.tasks.sort(sortFn);
        return true;
    }
});

/**
 * Apply a complete board state (for imports, templates, etc.)
 */
export const applyState = (
    newState: Partial<KanbanBoard>
): BoardAction => ({
    type: 'board:applyState',
    targets: [], // Full board refresh
    execute: (board) => {
        if (newState.columns !== undefined) {
            board.columns = newState.columns;
        }
        if (newState.valid !== undefined) {
            board.valid = newState.valid;
        }
        return true;
    }
});

