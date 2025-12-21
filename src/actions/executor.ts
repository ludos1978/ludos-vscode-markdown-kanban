/**
 * ActionExecutor - Executes board actions with undo support and targeted updates
 *
 * This is the central coordinator for all board modifications.
 * It handles:
 * - Saving undo state before execution
 * - Executing the action
 * - Emitting board changed events
 * - Sending targeted updates to frontend
 */

import { KanbanBoard } from '../markdownParser';
import { BoardAction, ActionTarget, ActionResult } from './types';
import { UndoCapture } from '../core/stores/UndoCapture';
import { BoardStore } from '../core/stores/BoardStore';
import { WebviewBridge } from '../core/bridge/WebviewBridge';
import { BoardChangeTrigger } from '../core/events';
import {
    UpdateTaskContentExtendedMessage,
    UpdateColumnContentExtendedMessage
} from '../core/bridge/MessageTypes';
import { findTask, findColumn } from './helpers';

/**
 * Dependencies required by the executor
 */
export interface ExecutorDependencies {
    /** Get the current board */
    getBoard: () => KanbanBoard | undefined;
    /** Set the board after modification */
    setBoard: (board: KanbanBoard) => void;
    /** Board store for undo/redo */
    boardStore: BoardStore;
    /** Webview bridge for sending messages */
    webviewBridge: WebviewBridge;
    /** Emit board changed event */
    emitBoardChanged: (board: KanbanBoard, trigger: BoardChangeTrigger) => void;
}

/**
 * Options for action execution
 */
export interface ExecuteOptions {
    /** Whether to save undo state (default: true) */
    saveUndo?: boolean;
    /** Whether to send targeted updates (default: true) */
    sendUpdates?: boolean;
    /** Whether to emit board changed event (default: true) */
    emitChange?: boolean;
    /** Custom trigger for board changed event */
    trigger?: BoardChangeTrigger;
}

/**
 * ActionExecutor - Central coordinator for board actions
 */
export class ActionExecutor {
    constructor(private deps: ExecutorDependencies) {}

    /**
     * Execute a board action
     *
     * @param action - The action to execute
     * @param options - Execution options
     * @returns Result of the action
     */
    async execute<T>(
        action: BoardAction<T>,
        options: ExecuteOptions = {}
    ): Promise<ActionResult<T>> {
        const {
            saveUndo = true,
            sendUpdates = true,
            emitChange = true,
            trigger = 'edit'
        } = options;

        // Get current board
        const board = this.deps.getBoard();
        if (!board) {
            return { success: false, error: 'No board available' };
        }

        // Save undo state before modification
        if (saveUndo) {
            const entry = this.createUndoEntry(board, action);
            this.deps.boardStore.saveUndoEntry(entry);
        }

        // Execute the action
        let result: T;
        try {
            result = action.execute(board);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Action execution failed'
            };
        }

        // Check if action succeeded
        const success = this.isSuccess(result);
        if (!success) {
            return { success: false, result };
        }

        // Emit board changed event
        if (emitChange) {
            this.deps.emitBoardChanged(board, trigger);
        }

        // Send targeted updates to frontend
        if (sendUpdates) {
            this.sendTargetedUpdates(board, action.targets);
        }

        return { success: true, result };
    }

    /**
     * Create an undo entry for an action
     */
    private createUndoEntry(board: KanbanBoard, action: BoardAction<unknown>) {
        // Convert ActionTarget[] to ResolvedTarget[]
        const targets = action.targets.map(t => ({
            type: t.type,
            id: t.id,
            columnId: t.columnId
        }));

        return UndoCapture.forMultiple(board, targets, action.type);
    }

    /**
     * Check if action result indicates success
     */
    private isSuccess(result: unknown): boolean {
        if (typeof result === 'boolean') return result;
        if (result === null || result === undefined) return false;
        return true; // Non-null values (like IDs) indicate success
    }

    /**
     * Send targeted updates to frontend based on action targets
     */
    private sendTargetedUpdates(board: KanbanBoard, targets: ActionTarget[]): void {
        for (const target of targets) {
            if (target.type === 'task' && target.columnId) {
                this.sendTaskUpdate(board, target.id, target.columnId);
            } else if (target.type === 'column') {
                this.sendColumnUpdate(board, target.id);
            }
        }
    }

    /**
     * Send task content update to frontend
     */
    private sendTaskUpdate(board: KanbanBoard, taskId: string, columnId: string): void {
        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);

        if (!task || !column) return;

        const message: UpdateTaskContentExtendedMessage = {
            type: 'updateTaskContent',
            columnId: column.id,
            taskId: task.id,
            description: task.description,
            displayTitle: task.displayTitle,
            taskTitle: task.title,
            originalTitle: task.originalTitle,
            includeMode: task.includeMode || false,
            includeFiles: task.includeFiles,
            regularIncludeFiles: task.regularIncludeFiles
        };

        this.deps.webviewBridge.send(message);
    }

    /**
     * Send column content update to frontend
     * This handles structural changes (add/delete/reorder tasks)
     */
    private sendColumnUpdate(board: KanbanBoard, columnId: string): void {
        const column = findColumn(board, columnId);
        if (!column) return;

        const message: UpdateColumnContentExtendedMessage = {
            type: 'updateColumnContent',
            columnId: column.id,
            tasks: column.tasks,
            columnTitle: column.title,
            displayTitle: column.displayTitle,
            includeMode: column.includeMode || false,
            includeFiles: column.includeFiles
        };

        this.deps.webviewBridge.send(message);
    }
}
