/**
 * Column Actions - Factory functions for column operations
 *
 * Each function creates a BoardAction for a specific column operation.
 */

import { BoardAction } from './types';
import { KanbanColumn } from '../markdownParser';
import { findColumn, findColumnIndex } from './helpers';
import { IdGenerator } from '../utils/idGenerator';

// ============= CONTENT UPDATES (target: column) =============

/**
 * Update column title
 */
export const updateTitle = (
    columnId: string,
    newTitle: string
): BoardAction => ({
    type: 'column:updateTitle',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        column.title = newTitle;
        return true;
    }
});

/**
 * Update column include files
 */
export const updateIncludeFiles = (
    columnId: string,
    includeFiles: string[],
    includeMode: boolean
): BoardAction => ({
    type: 'column:updateIncludeFiles',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        column.includeFiles = includeFiles;
        column.includeMode = includeMode;
        return true;
    }
});

// ============= STRUCTURAL CHANGES (target: board - full refresh) =============

/**
 * Add a new column to the board
 * Returns the new column ID on success
 */
export const add = (
    columnData: Partial<KanbanColumn>,
    index?: number
): BoardAction<string | null> => ({
    type: 'column:add',
    targets: [], // Full board refresh needed for new columns
    execute: (board) => {
        const newColumn: KanbanColumn = {
            id: columnData.id || IdGenerator.generateColumnId(),
            title: columnData.title || 'New Column',
            tasks: columnData.tasks || [],
            displayTitle: columnData.displayTitle,
            includeMode: columnData.includeMode || false,
            includeFiles: columnData.includeFiles || []
        };

        if (index !== undefined && index >= 0 && index <= board.columns.length) {
            board.columns.splice(index, 0, newColumn);
        } else {
            board.columns.push(newColumn);
        }

        return newColumn.id;
    }
});

/**
 * Delete a column from the board
 */
export const remove = (
    columnId: string
): BoardAction => ({
    type: 'column:delete',
    targets: [], // Full board refresh needed
    execute: (board) => {
        const columnIndex = findColumnIndex(board, columnId);
        if (columnIndex === -1) return false;

        board.columns.splice(columnIndex, 1);
        return true;
    }
});

/**
 * Reorder a column within the board by index
 */
export const reorder = (
    columnId: string,
    newIndex: number
): BoardAction => ({
    type: 'column:reorder',
    targets: [], // Full board refresh needed for column reordering
    execute: (board) => {
        const currentIndex = findColumnIndex(board, columnId);
        if (currentIndex === -1) return false;

        const [column] = board.columns.splice(currentIndex, 1);
        board.columns.splice(newIndex, 0, column);
        return true;
    }
});

/**
 * Move column by source and target indices
 */
export const move = (
    fromIndex: number,
    toIndex: number
): BoardAction => ({
    type: 'column:move',
    targets: [], // Full board refresh needed
    execute: (board) => {
        if (fromIndex === toIndex) return false;

        const columns = board.columns;
        const column = columns.splice(fromIndex, 1)[0];
        columns.splice(toIndex, 0, column);
        return true;
    }
});

/**
 * Insert a column before an existing column
 * Returns the new column ID on success
 */
export const insertBefore = (
    columnId: string,
    title: string
): BoardAction<string | null> => ({
    type: 'column:insertBefore',
    targets: [], // Full board refresh needed
    execute: (board) => {
        const index = findColumnIndex(board, columnId);
        if (index === -1) return null;

        const newColumn: KanbanColumn = {
            id: IdGenerator.generateColumnId(),
            title: title,
            tasks: []
        };

        board.columns.splice(index, 0, newColumn);
        return newColumn.id;
    }
});

/**
 * Insert a column after an existing column
 * Returns the new column ID on success
 */
export const insertAfter = (
    columnId: string,
    title: string
): BoardAction<string | null> => ({
    type: 'column:insertAfter',
    targets: [], // Full board refresh needed
    execute: (board) => {
        const index = findColumnIndex(board, columnId);
        if (index === -1) return null;

        const newColumn: KanbanColumn = {
            id: IdGenerator.generateColumnId(),
            title: title,
            tasks: []
        };

        board.columns.splice(index + 1, 0, newColumn);
        return newColumn.id;
    }
});

/**
 * Sort tasks in a column by type
 */
export const sortTasks = (
    columnId: string,
    sortType: 'unsorted' | 'title' | 'numericTag'
): BoardAction => ({
    type: 'column:sortTasks',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        if (sortType === 'title') {
            column.tasks.sort((a, b) => {
                const titleA = a.title || '';
                const titleB = b.title || '';
                return titleA.localeCompare(titleB);
            });
        } else if (sortType === 'numericTag') {
            column.tasks.sort((a, b) => {
                const numA = ColumnActions.extractNumericTag(a.title || '');
                const numB = ColumnActions.extractNumericTag(b.title || '');
                if (numA === null && numB === null) return 0;
                if (numA === null) return 1;
                if (numB === null) return -1;
                return numA - numB;
            });
        }
        // 'unsorted' - do nothing
        return true;
    }
});

// Helper for extracting numeric tags
const ColumnActions = {
    extractNumericTag(title: string): number | null {
        const match = title.match(/#(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }
};

/**
 * Duplicate a column
 * Returns the new column ID on success
 */
export const duplicate = (
    columnId: string
): BoardAction<string | null> => ({
    type: 'column:duplicate',
    targets: [], // Full board refresh needed
    execute: (board) => {
        const columnIndex = findColumnIndex(board, columnId);
        if (columnIndex === -1) return null;

        const originalColumn = board.columns[columnIndex];
        const newColumn: KanbanColumn = {
            ...JSON.parse(JSON.stringify(originalColumn)),
            id: IdGenerator.generateColumnId(),
            tasks: originalColumn.tasks.map(task => ({
                ...JSON.parse(JSON.stringify(task)),
                id: IdGenerator.generateTaskId()
            }))
        };

        // Insert after the original
        board.columns.splice(columnIndex + 1, 0, newColumn);
        return newColumn.id;
    }
});

/**
 * Clear all tasks from a column
 */
export const clearTasks = (
    columnId: string
): BoardAction => ({
    type: 'column:clearTasks',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        column.tasks = [];
        return true;
    }
});
