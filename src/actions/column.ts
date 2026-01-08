/**
 * Column Actions - Factory functions for column operations
 *
 * Each function creates a BoardAction for a specific column operation.
 */

import { BoardAction } from './types';
import { KanbanColumn } from '../markdownParser';
import { findColumn, findColumnIndex, setColumnRowTag, buildColumnOrderAfterMove, applyColumnOrder } from './helpers';
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

// NOTE: sortTasks action was removed because:
// 1. 'unsorted' requires _originalTaskOrder state (only in BoardCrudOperations)
// 2. All sorting now routes through boardOperations.sortColumn()
// See ColumnCommands.handleSortColumn for the implementation.

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

// ============= ROW-TAG OPERATIONS =============

/**
 * Move a column to a new position and update its row tag
 */
export const moveWithRowUpdate = (
    columnId: string,
    newPosition: number,
    newRow: number
): BoardAction => ({
    type: 'column:moveWithRowUpdate',
    targets: [], // Full board refresh needed
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        // Update the row tag in the title
        setColumnRowTag(column, newRow);

        const currentIndex = findColumnIndex(board, columnId);
        if (currentIndex === -1) return false;

        // Build new order
        const targetOrder = buildColumnOrderAfterMove(board.columns, currentIndex, newPosition);
        if (!targetOrder) return false;

        applyColumnOrder(board, targetOrder);

        return true;
    }
});

/**
 * Reorder columns with row tag update for the moved column
 */
export const reorderWithRowTags = (
    newOrder: string[],
    movedColumnId: string,
    targetRow: number
): BoardAction => ({
    type: 'column:reorderWithRowTags',
    targets: [], // Full board refresh needed
    execute: (board) => {
        const movedColumn = findColumn(board, movedColumnId);
        if (!movedColumn) return false;

        // Update row tag for the moved column
        setColumnRowTag(movedColumn, targetRow);

        applyColumnOrder(board, newOrder);
        return true;
    }
});

// NOTE: cleanupRowTags action was removed because:
// 1. It's called from kanbanFileService during file operations, not from commands
// 2. The implementation lives in BoardCrudOperations.cleanupRowTags()
// 3. It's accessed via boardOperations.cleanupRowTags() facade
// If needed as an action in the future, re-implement here.
