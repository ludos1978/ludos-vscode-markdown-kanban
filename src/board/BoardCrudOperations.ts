/**
 * Board CRUD Operations for Kanban board
 * Handles task and column create, read, update, delete operations
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';
import { IdGenerator } from '../utils/idGenerator';
import {
    findColumn as findColumnHelper,
    findTaskById as findTaskByIdHelper,
    findColumnContainingTask as findColumnContainingTaskHelper,
    getColumnRow as getColumnRowHelper
} from '../actions/helpers';

/**
 * Input data for creating a new task
 */
export interface NewTaskInput {
    title?: string;
    description?: string;
}

/**
 * Core CRUD operations for Kanban board tasks and columns
 */
export class BoardCrudOperations {
    /**
     * @deprecated Original task order is now stored in BoardStore.
     * Kept for test compatibility only.
     */
    private _originalTaskOrder: Map<string, string[]> = new Map();

    private generateId(type: 'column' | 'task'): string {
        if (type === 'column') {
            return IdGenerator.generateColumnId();
        } else {
            return IdGenerator.generateTaskId();
        }
    }

    /**
     * @deprecated Use BoardStore.setOriginalTaskOrder() instead.
     * Kept for test compatibility only.
     */
    public setOriginalTaskOrder(board: KanbanBoard): void {
        this._originalTaskOrder.clear();
        board.columns.forEach(column => {
            this._originalTaskOrder.set(column.id, column.tasks.map(t => t.id));
        });
    }

    private findColumn(board: KanbanBoard, columnId: string): KanbanColumn | undefined {
        return board.columns.find(col => col.id === columnId);
    }

    private findTask(board: KanbanBoard, columnId: string, taskId: string): { column: KanbanColumn; task: KanbanTask; index: number } | undefined {
        const column = this.findColumn(board, columnId);
        if (!column) { return undefined; }

        const taskIndex = column.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) { return undefined; }

        return {
            column,
            task: column.tasks[taskIndex],
            index: taskIndex
        };
    }

    // ============= TASK OPERATIONS =============
    // @deprecated These methods are superseded by TaskActions (src/actions/task.ts).
    // Kept for test compatibility. Production code should use Actions instead.

    /** @deprecated Use TaskActions.move() instead */
    public moveTask(board: KanbanBoard, taskId: string, fromColumnId: string, toColumnId: string, newIndex: number): boolean {
        const fromColumn = this.findColumn(board, fromColumnId);
        const toColumn = this.findColumn(board, toColumnId);

        if (!fromColumn || !toColumn) {
            return false;
        }

        const taskIndex = fromColumn.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) {
            return false;
        }

        const task = fromColumn.tasks.splice(taskIndex, 1)[0];
        toColumn.tasks.splice(newIndex, 0, task);
        return true;
    }

    public addTask(board: KanbanBoard, columnId: string, taskData: NewTaskInput): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        const newTask: KanbanTask = {
            id: this.generateId('task'),
            title: taskData.title || '',
            description: taskData.description || ''
        };

        column.tasks.push(newTask);
        return true;
    }

    public addTaskAtPosition(board: KanbanBoard, columnId: string, taskData: NewTaskInput, insertionIndex: number): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        const newTask: KanbanTask = {
            id: this.generateId('task'),
            title: taskData.title || '',
            description: taskData.description || ''
        };

        if (insertionIndex >= 0 && insertionIndex <= column.tasks.length) {
            column.tasks.splice(insertionIndex, 0, newTask);
        } else {
            column.tasks.push(newTask);
        }
        return true;
    }

    public deleteTask(board: KanbanBoard, taskId: string, columnId: string): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        const taskIndex = column.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) { return false; }

        column.tasks.splice(taskIndex, 1);
        return true;
    }

    public editTask(board: KanbanBoard, taskId: string, columnId: string, taskData: Partial<KanbanTask>): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        const task = column.tasks.find(t => t.id === taskId);
        if (!task) { return false; }

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

    public duplicateTask(board: KanbanBoard, taskId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, taskId);
        if (!result) { return false; }

        const newTask: KanbanTask = {
            id: this.generateId('task'),
            title: result.task.title,
            description: result.task.description,
            includeMode: result.task.includeMode,
            includeFiles: result.task.includeFiles
                ? result.task.includeFiles.map(f => f.trim())
                : undefined,
            originalTitle: result.task.originalTitle,
            displayTitle: result.task.displayTitle
        };

        result.column.tasks.splice(result.index + 1, 0, newTask);
        return true;
    }

    public insertTaskBefore(board: KanbanBoard, taskId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, taskId);
        if (!result) { return false; }

        const newTask: KanbanTask = {
            id: this.generateId('task'),
            title: '',
            description: ''
        };

        result.column.tasks.splice(result.index, 0, newTask);
        return true;
    }

    public insertTaskAfter(board: KanbanBoard, taskId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, taskId);
        if (!result) { return false; }

        const newTask: KanbanTask = {
            id: this.generateId('task'),
            title: '',
            description: ''
        };

        result.column.tasks.splice(result.index + 1, 0, newTask);
        return true;
    }

    public moveTaskToTop(board: KanbanBoard, taskId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, taskId);
        if (!result || result.index === 0) { return false; }

        const task = result.column.tasks.splice(result.index, 1)[0];
        result.column.tasks.unshift(task);
        return true;
    }

    public moveTaskUp(board: KanbanBoard, taskId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, taskId);
        if (!result || result.index === 0) { return false; }

        const task = result.column.tasks[result.index];
        result.column.tasks[result.index] = result.column.tasks[result.index - 1];
        result.column.tasks[result.index - 1] = task;
        return true;
    }

    public moveTaskDown(board: KanbanBoard, taskId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, taskId);
        if (!result || result.index === result.column.tasks.length - 1) { return false; }

        const task = result.column.tasks[result.index];
        result.column.tasks[result.index] = result.column.tasks[result.index + 1];
        result.column.tasks[result.index + 1] = task;
        return true;
    }

    public moveTaskToBottom(board: KanbanBoard, taskId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, taskId);
        if (!result || result.index === result.column.tasks.length - 1) { return false; }

        const task = result.column.tasks.splice(result.index, 1)[0];
        result.column.tasks.push(task);
        return true;
    }

    public moveTaskToColumn(board: KanbanBoard, taskId: string, fromColumnId: string, toColumnId: string): boolean {
        const fromColumn = this.findColumn(board, fromColumnId);
        const toColumn = this.findColumn(board, toColumnId);

        if (!fromColumn || !toColumn) { return false; }

        const taskIndex = fromColumn.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) { return false; }

        const task = fromColumn.tasks.splice(taskIndex, 1)[0];
        toColumn.tasks.push(task);
        return true;
    }

    // ============= COLUMN OPERATIONS =============
    // @deprecated These methods are superseded by ColumnActions (src/actions/column.ts).
    // Kept for test compatibility. Production code should use Actions instead.
    // Exception: sortColumn() is still used for 'unsorted' feature (requires _originalTaskOrder state).

    /** @deprecated Use ColumnActions.add() instead */
    public addColumn(board: KanbanBoard, title: string): boolean {
        const newColumn: KanbanColumn = {
            id: this.generateId('column'),
            title: title,
            tasks: []
        };

        const targetRow = this.getColumnRow({ title } as KanbanColumn);
        let insertIndex = board.columns.length;

        for (let i = 0; i < board.columns.length; i++) {
            const columnRow = this.getColumnRow(board.columns[i]);

            if (columnRow > targetRow) {
                insertIndex = i;
                break;
            }
        }

        board.columns.splice(insertIndex, 0, newColumn);
        this._originalTaskOrder.set(newColumn.id, []);
        return true;
    }

    public moveColumn(board: KanbanBoard, fromIndex: number, toIndex: number): boolean {
        if (fromIndex === toIndex) { return false; }

        const columns = board.columns;
        const column = columns.splice(fromIndex, 1)[0];
        columns.splice(toIndex, 0, column);
        return true;
    }

    public deleteColumn(board: KanbanBoard, columnId: string): boolean {
        const index = board.columns.findIndex(col => col.id === columnId);
        if (index === -1) { return false; }

        board.columns.splice(index, 1);
        this._originalTaskOrder.delete(columnId);
        return true;
    }

    public insertColumnBefore(board: KanbanBoard, columnId: string, title: string): boolean {
        const index = board.columns.findIndex(col => col.id === columnId);
        if (index === -1) { return false; }

        const newColumn: KanbanColumn = {
            id: this.generateId('column'),
            title: title,
            tasks: []
        };

        board.columns.splice(index, 0, newColumn);
        this._originalTaskOrder.set(newColumn.id, []);
        return true;
    }

    public insertColumnAfter(board: KanbanBoard, columnId: string, title: string): boolean {
        const index = board.columns.findIndex(col => col.id === columnId);
        if (index === -1) { return false; }

        const newColumn: KanbanColumn = {
            id: this.generateId('column'),
            title: title,
            tasks: []
        };

        board.columns.splice(index + 1, 0, newColumn);
        this._originalTaskOrder.set(newColumn.id, []);
        return true;
    }

    public editColumnTitle(board: KanbanBoard, columnId: string, title: string): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        column.title = title;
        return true;
    }

    public reorderColumns(board: KanbanBoard, newOrder: string[], movedColumnId: string, targetRow: number): boolean {
        const movedColumn = this.findColumn(board, movedColumnId);
        if (!movedColumn) { return false; }

        // Update row tag for the moved column
        let cleanTitle = movedColumn.title
            .replace(/#row\d+\b/gi, '')
            .replace(/\s+#row\d+/gi, '')
            .replace(/#row\d+\s+/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        if (targetRow > 1) {
            movedColumn.title = cleanTitle + ` #row${targetRow}`;
        } else {
            movedColumn.title = cleanTitle;
        }

        // Rebuild columns array in the new order
        const columnMap = new Map<string, KanbanColumn>();
        board.columns.forEach(col => columnMap.set(col.id, col));

        const reorderedColumns: KanbanColumn[] = [];
        newOrder.forEach(id => {
            const col = columnMap.get(id);
            if (col) {
                reorderedColumns.push(col);
            }
        });

        board.columns = reorderedColumns;
        return true;
    }

    public moveColumnWithRowUpdate(board: KanbanBoard, columnId: string, newPosition: number, newRow: number): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        // Update the row tag in the title
        let cleanTitle = column.title
            .replace(/#row\d+\b/gi, '')
            .replace(/\s+#row\d+/gi, '')
            .replace(/#row\d+\s+/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        if (newRow > 1) {
            column.title = cleanTitle + ` #row${newRow}`;
        } else {
            column.title = cleanTitle;
        }

        const currentIndex = board.columns.findIndex(col => col.id === columnId);
        if (currentIndex === -1) { return false; }

        const targetOrder: string[] = [];
        board.columns.forEach((col, idx) => {
            if (idx !== currentIndex) {
                targetOrder.push(col.id);
            }
        });

        targetOrder.splice(newPosition, 0, columnId);

        const reorderedColumns: KanbanColumn[] = [];
        targetOrder.forEach(id => {
            const col = board.columns.find(c => c.id === id);
            if (col) {
                reorderedColumns.push(col);
            }
        });

        board.columns.length = 0;
        board.columns.push(...reorderedColumns);

        return true;
    }

    // ============= SORTING OPERATIONS =============

    /**
     * Sort tasks in a column.
     * @param board The board containing the column
     * @param columnId The column to sort
     * @param sortType The sort type: 'title', 'numericTag', or 'unsorted'
     * @param originalOrder Optional original task order for 'unsorted' (from BoardStore.getOriginalTaskOrder).
     *                      If not provided, falls back to internal _originalTaskOrder (for test compatibility).
     */
    public sortColumn(
        board: KanbanBoard,
        columnId: string,
        sortType: 'unsorted' | 'title' | 'numericTag',
        originalOrder?: string[]
    ): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        if (sortType === 'title') {
            column.tasks.sort((a, b) => {
                const titleA = a.title || '';
                const titleB = b.title || '';
                return titleA.localeCompare(titleB);
            });
        } else if (sortType === 'numericTag') {
            column.tasks.sort((a, b) => {
                const numA = this._extractNumericTag(a.title);
                const numB = this._extractNumericTag(b.title);

                if (numA === null && numB === null) return 0;
                if (numA === null) return 1;
                if (numB === null) return -1;

                return numA - numB;
            });
        } else if (sortType === 'unsorted') {
            // Use provided original order, fall back to internal (for test compatibility)
            const order = originalOrder ?? this._originalTaskOrder.get(columnId);
            if (order) {
                const taskMap = new Map(column.tasks.map(t => [t.id, t]));
                column.tasks = [];

                order.forEach(taskId => {
                    const task = taskMap.get(taskId);
                    if (task) {
                        column.tasks.push(task);
                        taskMap.delete(taskId);
                    }
                });

                taskMap.forEach(task => {
                    column.tasks.push(task);
                });
            }
        }
        return true;
    }

    private _extractNumericTag(title: string): number | null {
        if (!title) return null;
        const match = title.match(/#(\d+(?:\.\d+)?)\b/);
        if (match && match[1]) {
            return parseFloat(match[1]);
        }
        return null;
    }

    // ============= STATIC LOOKUP HELPERS =============
    // Delegate to actions/helpers.ts for single source of truth

    /**
     * Find a column by ID in a board
     * @deprecated Use findColumn from '../actions/helpers' directly
     */
    public static findColumnById(board: KanbanBoard, columnId: string): KanbanColumn | undefined {
        return findColumnHelper(board, columnId);
    }

    /**
     * Find a task by ID, searching all columns
     * @deprecated Use findTaskById from '../actions/helpers' directly
     */
    public static findTaskById(board: KanbanBoard, taskId: string): { task: KanbanTask; column: KanbanColumn; index: number } | undefined {
        return findTaskByIdHelper(board, taskId);
    }

    /**
     * Find a task by ID within a specific column
     * @deprecated Use findTaskById or findColumn from '../actions/helpers' directly
     */
    public static findTaskInColumn(board: KanbanBoard, columnId: string, taskId: string): { task: KanbanTask; column: KanbanColumn; index: number } | undefined {
        const column = findColumnHelper(board, columnId);
        if (!column) return undefined;

        const index = column.tasks.findIndex(t => t.id === taskId);
        if (index === -1) return undefined;

        return { task: column.tasks[index], column, index };
    }

    /**
     * Find the column that contains a task with the given ID
     * @deprecated Use findColumnContainingTask from '../actions/helpers' directly
     */
    public static findColumnContainingTask(board: KanbanBoard, taskId: string): KanbanColumn | undefined {
        return findColumnContainingTaskHelper(board, taskId);
    }

    // ============= HELPER METHODS =============

    /**
     * @deprecated Use getColumnRow from '../actions/helpers' directly
     */
    public getColumnRow(column: KanbanColumn): number {
        return getColumnRowHelper(column);
    }

    public cleanupRowTags(board: KanbanBoard): boolean {
        let modified = false;

        board.columns.forEach(column => {
            const originalTitle = column.title;
            const rowTags = column.title.match(/#row\d+\b/gi) || [];

            if (rowTags.length > 1) {
                let cleanTitle = column.title;
                rowTags.forEach(tag => {
                    cleanTitle = cleanTitle.replace(new RegExp(tag, 'gi'), '');
                });
                cleanTitle = cleanTitle.replace(/\s{2,}/g, ' ').trim();

                const lastTag = rowTags[rowTags.length - 1];
                column.title = cleanTitle + ' ' + lastTag;

                if (column.title !== originalTitle) {
                    modified = true;
                }
            }
        });

        return modified;
    }
}
