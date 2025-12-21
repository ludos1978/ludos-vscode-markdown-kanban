/**
 * Action Types - Core interfaces for the action command pattern
 *
 * Actions are self-describing operations that know:
 * - What they do (type)
 * - What they affect (targets)
 * - How to execute (execute method)
 */

import { KanbanBoard } from '../markdownParser';

/**
 * Target that was affected by an action
 * Used for targeted undo/redo updates
 */
export interface ActionTarget {
    type: 'task' | 'column';
    id: string;
    /** Column ID when target is a task */
    columnId?: string;
}

/**
 * Board action interface
 * Each action is a factory function that returns this structure
 *
 * @template T - Return type of execute (default: boolean for success/failure)
 */
export interface BoardAction<T = boolean> {
    /** Action type identifier (e.g., 'task:updateTitle', 'column:add') */
    readonly type: string;

    /** Elements affected by this action (for targeted updates) */
    readonly targets: ActionTarget[];

    /**
     * Execute the action on the board
     * @param board - The board to modify (mutated in place)
     * @returns Result of the action (typically boolean success)
     */
    execute(board: KanbanBoard): T;
}

/**
 * Result of action execution
 */
export interface ActionResult<T = boolean> {
    /** Whether the action executed successfully */
    success: boolean;
    /** The result returned by the action's execute method */
    result?: T;
    /** Error message if failed */
    error?: string;
}
