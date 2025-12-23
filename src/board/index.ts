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
 * Handles specialized board operations.
 * Most CRUD operations are now handled via Actions (src/actions/).
 * Original task order tracking is now in BoardStore.
 *
 * Remaining responsibilities:
 * - Row tag cleanup
 * - Sorting (delegates to BoardCrudOperations)
 * - Automatic sorting (via GatherQueryEngine)
 */
export class BoardOperations {
    private _crudOperations = new BoardCrudOperations();
    private _gatherEngine = new GatherQueryEngine();

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
     * For 'unsorted', pass originalOrder from BoardStore.getOriginalTaskOrder(columnId).
     */
    public sortColumn(
        board: KanbanBoard,
        columnId: string,
        sortType: 'unsorted' | 'title' | 'numericTag',
        originalOrder?: string[]
    ): boolean {
        return this._crudOperations.sortColumn(board, columnId, sortType, originalOrder);
    }

    // ============= GATHER & SORT OPERATIONS =============

    /**
     * Perform automatic sorting based on gather rules.
     */
    public performAutomaticSort(board: KanbanBoard): boolean {
        return this._gatherEngine.performAutomaticSort(board);
    }
}
