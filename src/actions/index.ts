/**
 * Actions Module - Centralized board action system
 *
 * Usage:
 *   import { ActionExecutor, TaskActions, ColumnActions, BoardActions } from './actions';
 *
 *   // In a command handler:
 *   const action = TaskActions.updateTitle(taskId, columnId, newTitle);
 *   const result = await executor.execute(action);
 */

// Core types
export { BoardAction, ActionTarget, ActionResult } from './types';

// Executor
export { ActionExecutor, ExecutorDependencies, ExecuteOptions } from './executor';

// Helpers
export {
    findColumn,
    findTaskIndex,
    findColumnIndex,
    getColumnRow,
    extractNumericTag,
    findTaskById,
    findColumnContainingTask,
    findTaskInColumn
} from './helpers';

// Action factories (namespaced)
import * as TaskActions from './task';
import * as ColumnActions from './column';
import * as BoardActions from './board';

export { TaskActions, ColumnActions, BoardActions };
