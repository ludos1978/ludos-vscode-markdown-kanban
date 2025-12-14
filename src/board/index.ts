/**
 * Board module - Kanban board operations
 *
 * This module exports BoardOperations which combines CRUD and Gather operations.
 * Import { BoardOperations } from './board' for the unified class.
 */

import { KanbanBoard, KanbanTask } from '../markdownParser';
import { BoardCrudOperations } from './BoardCrudOperations';
import { GatherQueryEngine } from './GatherQueryEngine';

export { BoardCrudOperations } from './BoardCrudOperations';
export { GatherQueryEngine } from './GatherQueryEngine';
export {
    extractDate,
    hasSticky,
    extractPersonNames,
    getTodayString,
    isWithinDays,
    isOverdue,
    getDatePropertyValue
} from './DateTimeUtils';

/**
 * BoardOperations - Unified board operations class
 *
 * Combines BoardCrudOperations and GatherQueryEngine into a single interface.
 * This is the primary class to use for all board operations.
 */
export class BoardOperations {
    private _crudOperations = new BoardCrudOperations();
    private _gatherEngine = new GatherQueryEngine();

    // ============= ORIGINAL TASK ORDER =============

    public setOriginalTaskOrder(board: KanbanBoard): void {
        this._crudOperations.setOriginalTaskOrder(board);
    }

    // ============= TASK OPERATIONS =============

    public moveTask(board: KanbanBoard, taskId: string, fromColumnId: string, toColumnId: string, newIndex: number): boolean {
        return this._crudOperations.moveTask(board, taskId, fromColumnId, toColumnId, newIndex);
    }

    public addTask(board: KanbanBoard, columnId: string, taskData: any): boolean {
        return this._crudOperations.addTask(board, columnId, taskData);
    }

    public addTaskAtPosition(board: KanbanBoard, columnId: string, taskData: any, insertionIndex: number): boolean {
        return this._crudOperations.addTaskAtPosition(board, columnId, taskData, insertionIndex);
    }

    public deleteTask(board: KanbanBoard, taskId: string, columnId: string): boolean {
        return this._crudOperations.deleteTask(board, taskId, columnId);
    }

    public editTask(board: KanbanBoard, taskId: string, columnId: string, taskData: Partial<KanbanTask>): boolean {
        return this._crudOperations.editTask(board, taskId, columnId, taskData);
    }

    public duplicateTask(board: KanbanBoard, taskId: string, columnId: string): boolean {
        return this._crudOperations.duplicateTask(board, taskId, columnId);
    }

    public insertTaskBefore(board: KanbanBoard, taskId: string, columnId: string): boolean {
        return this._crudOperations.insertTaskBefore(board, taskId, columnId);
    }

    public insertTaskAfter(board: KanbanBoard, taskId: string, columnId: string): boolean {
        return this._crudOperations.insertTaskAfter(board, taskId, columnId);
    }

    public moveTaskToTop(board: KanbanBoard, taskId: string, columnId: string): boolean {
        return this._crudOperations.moveTaskToTop(board, taskId, columnId);
    }

    public moveTaskUp(board: KanbanBoard, taskId: string, columnId: string): boolean {
        return this._crudOperations.moveTaskUp(board, taskId, columnId);
    }

    public moveTaskDown(board: KanbanBoard, taskId: string, columnId: string): boolean {
        return this._crudOperations.moveTaskDown(board, taskId, columnId);
    }

    public moveTaskToBottom(board: KanbanBoard, taskId: string, columnId: string): boolean {
        return this._crudOperations.moveTaskToBottom(board, taskId, columnId);
    }

    public moveTaskToColumn(board: KanbanBoard, taskId: string, fromColumnId: string, toColumnId: string): boolean {
        return this._crudOperations.moveTaskToColumn(board, taskId, fromColumnId, toColumnId);
    }

    // ============= COLUMN OPERATIONS =============

    public addColumn(board: KanbanBoard, title: string): boolean {
        return this._crudOperations.addColumn(board, title);
    }

    public moveColumn(board: KanbanBoard, fromIndex: number, toIndex: number, fromRow?: number, toRow?: number): boolean {
        return this._crudOperations.moveColumn(board, fromIndex, toIndex);
    }

    public deleteColumn(board: KanbanBoard, columnId: string): boolean {
        return this._crudOperations.deleteColumn(board, columnId);
    }

    public insertColumnBefore(board: KanbanBoard, columnId: string, title: string): boolean {
        return this._crudOperations.insertColumnBefore(board, columnId, title);
    }

    public insertColumnAfter(board: KanbanBoard, columnId: string, title: string): boolean {
        return this._crudOperations.insertColumnAfter(board, columnId, title);
    }

    public editColumnTitle(board: KanbanBoard, columnId: string, title: string): boolean {
        return this._crudOperations.editColumnTitle(board, columnId, title);
    }

    public sortColumn(board: KanbanBoard, columnId: string, sortType: 'unsorted' | 'title' | 'numericTag'): boolean {
        return this._crudOperations.sortColumn(board, columnId, sortType);
    }

    public reorderColumns(board: KanbanBoard, newOrder: string[], movedColumnId: string, targetRow: number): boolean {
        return this._crudOperations.reorderColumns(board, newOrder, movedColumnId, targetRow);
    }

    public moveColumnWithRowUpdate(board: KanbanBoard, columnId: string, newPosition: number, newRow: number): boolean {
        return this._crudOperations.moveColumnWithRowUpdate(board, columnId, newPosition, newRow);
    }

    public cleanupRowTags(board: KanbanBoard): boolean {
        return this._crudOperations.cleanupRowTags(board);
    }

    // ============= GATHER & SORT OPERATIONS =============

    public performAutomaticSort(board: KanbanBoard): boolean {
        return this._gatherEngine.performAutomaticSort(board);
    }
}
