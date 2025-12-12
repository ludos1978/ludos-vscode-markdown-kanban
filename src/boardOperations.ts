/**
 * Board Operations - Facade for backward compatibility
 *
 * This file delegates to the new modular structure:
 * - BoardCrudOperations: Task/Column CRUD operations
 * - GatherQueryEngine: Gather rules and automatic sorting
 * - DateTimeUtils: Date extraction and comparison
 *
 * New code should import directly from './board' instead.
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from './markdownParser';
import { BoardCrudOperations } from './board/BoardCrudOperations';
import { GatherQueryEngine } from './board/GatherQueryEngine';

/**
 * @deprecated Import from './board' instead for new code
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

    public moveColumn(board: KanbanBoard, fromIndex: number, toIndex: number, fromRow: number, toRow: number): boolean {
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

    public getColumnRow(column: KanbanColumn): number {
        return this._crudOperations.getColumnRow(column);
    }

    public cleanupRowTags(board: KanbanBoard): boolean {
        return this._crudOperations.cleanupRowTags(board);
    }

    // ============= GATHER & SORT OPERATIONS =============

    public performAutomaticSort(board: KanbanBoard): boolean {
        return this._gatherEngine.performAutomaticSort(board);
    }
}
