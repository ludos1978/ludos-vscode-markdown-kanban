/**
 * Board module - Kanban board operations
 *
 * This module exports BoardOperations which combines state management and gather operations.
 * Most CRUD operations are now handled via Actions (see src/actions/).
 *
 * Import { BoardOperations } from './board' for the unified class.
 */

import { KanbanBoard } from './KanbanTypes';
import { BoardCrudOperations, NewTaskInput } from './BoardCrudOperations';
import { GatherQueryEngine } from './GatherQueryEngine';

// Export core types
export { KanbanBoard, KanbanColumn, KanbanTask } from './KanbanTypes';

export { BoardCrudOperations, NewTaskInput } from './BoardCrudOperations';
export { GatherQueryEngine } from './GatherQueryEngine';
export {
    extractDate,
    hasSticky,
    extractPersonNames,
    getDatePropertyValue
} from './DateTimeUtils';

/**
 * BoardOperations - Unified board operations class
 *
 * Handles state management and specialized operations.
 * Most CRUD operations are now handled via Actions (src/actions/).
 *
 * Remaining responsibilities:
 * - Original task order tracking (for 'unsorted' sort)
 * - Row tag cleanup
 * - Automatic sorting (via GatherQueryEngine)
 */
export class BoardOperations {
    private _crudOperations = new BoardCrudOperations();
    private _gatherEngine = new GatherQueryEngine();

    // ============= STATE MANAGEMENT =============

    /**
     * Save the original task order for each column.
     * Used by 'unsorted' sort to restore original order.
     */
    public setOriginalTaskOrder(board: KanbanBoard): void {
        this._crudOperations.setOriginalTaskOrder(board);
    }

    // ============= ROW TAG OPERATIONS =============

    /**
     * Cleanup duplicate row tags in column titles.
     * Keeps only the last row tag if multiple exist.
     */
    public cleanupRowTags(board: KanbanBoard): boolean {
        return this._crudOperations.cleanupRowTags(board);
    }

    // ============= SORTING OPERATIONS =============

    /**
     * Sort tasks in a column.
     * 'unsorted' requires access to _originalTaskOrder state, so this must go through BoardCrudOperations.
     */
    public sortColumn(board: KanbanBoard, columnId: string, sortType: 'unsorted' | 'title' | 'numericTag'): boolean {
        return this._crudOperations.sortColumn(board, columnId, sortType);
    }

    // ============= GATHER & SORT OPERATIONS =============

    /**
     * Perform automatic sorting based on gather rules.
     */
    public performAutomaticSort(board: KanbanBoard): boolean {
        return this._gatherEngine.performAutomaticSort(board);
    }
}
