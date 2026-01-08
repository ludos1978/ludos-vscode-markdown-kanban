/**
 * BoardStore - Centralized Board State Management
 *
 * Single source of truth for board state including:
 * - Board data (KanbanBoard)
 * - Cache validity
 * - Dirty tracking (columns and tasks with unrendered changes)
 * - Undo/redo history
 *
 * This replaces scattered state in KanbanWebviewPanel:
 * - _cachedBoard
 * - _boardCacheValid
 * - _dirtyColumns
 * - _dirtyTasks
 * - _undoRedoManager integration
 */

import * as vscode from 'vscode';
import { KanbanBoard } from '../../markdownParser';
import { UndoEntry, UndoCapture, ResolvedTarget } from './UndoCapture';
import { logger } from '../../utils/logger';

// Re-export for consumers
export { UndoEntry, UndoCapture, ResolvedTarget };

// ============= TYPES =============

export interface BoardState {
    /** The current board data */
    board: KanbanBoard | null;
    /** Whether the cached board is valid */
    cacheValid: boolean;
    /** Column IDs with unrendered changes */
    dirtyColumns: Set<string>;
    /** Task IDs with unrendered changes */
    dirtyTasks: Set<string>;
    /** Undo history stack with target metadata */
    undoStack: UndoEntry[];
    /** Redo history stack with target metadata */
    redoStack: UndoEntry[];
    /** Original task order per column (for 'unsorted' sort restoration) */
    originalTaskOrder: Map<string, string[]>;
}

export interface BoardStoreOptions {
    /** Maximum undo stack size (default: 100) */
    maxUndoStackSize?: number;
    /** Webview for sending undo/redo status (optional) */
    webview?: vscode.Webview;
}

// ============= HELPER FUNCTIONS =============

function createInferredUndoEntry(board: KanbanBoard): UndoEntry {
    return UndoCapture.inferred(board, 'inferred');
}

function cloneBoard(board: KanbanBoard): KanbanBoard {
    return JSON.parse(JSON.stringify(board));
}

// ============= MAIN CLASS =============

export class BoardStore implements vscode.Disposable {
    private _state: BoardState;
    private _webview?: vscode.Webview;
    private readonly _maxUndoStackSize: number;

    constructor(options: BoardStoreOptions = {}) {
        this._webview = options.webview;
        this._maxUndoStackSize = options.maxUndoStackSize ?? 100;

        this._state = {
            board: null,
            cacheValid: false,
            dirtyColumns: new Set(),
            dirtyTasks: new Set(),
            undoStack: [],
            redoStack: [],
            originalTaskOrder: new Map()
        };
    }

    // ============= BOARD ACCESS =============

    /**
     * Get the current board
     */
    getBoard(): KanbanBoard | null {
        return this._state.board;
    }

    /**
     * Check if cache is valid
     */
    isCacheValid(): boolean {
        return this._state.cacheValid;
    }

    /**
     * Set the board (marks cache as valid)
     */
    setBoard(board: KanbanBoard | null): void {
        this._state.board = board;
        this._state.cacheValid = board !== null;
    }

    /**
     * Invalidate the cache (board needs regeneration)
     */
    invalidateCache(): void {
        this._state.cacheValid = false;
    }

    // ============= DIRTY TRACKING =============
    // Tracks items with unrendered changes (cache updated but DOM not synced)

    /**
     * Mark a column as dirty (has unrendered changes)
     */
    markColumnDirty(columnId: string): void {
        this._state.dirtyColumns.add(columnId);
    }

    /**
     * Mark a task as dirty (has unrendered changes)
     */
    markTaskDirty(taskId: string): void {
        this._state.dirtyTasks.add(taskId);
    }

    /**
     * Clear dirty flag for a column
     */
    clearColumnDirty(columnId: string): void {
        this._state.dirtyColumns.delete(columnId);
    }

    /**
     * Clear dirty flag for a task
     */
    clearTaskDirty(taskId: string): void {
        this._state.dirtyTasks.delete(taskId);
    }

    /**
     * Check if any items are dirty
     */
    hasDirtyItems(): boolean {
        return this._state.dirtyColumns.size > 0 || this._state.dirtyTasks.size > 0;
    }

    /**
     * Get dirty columns
     */
    getDirtyColumns(): Set<string> {
        return new Set(this._state.dirtyColumns);
    }

    /**
     * Get dirty tasks
     */
    getDirtyTasks(): Set<string> {
        return new Set(this._state.dirtyTasks);
    }

    /**
     * Clear all dirty flags
     */
    clearAllDirty(): void {
        this._state.dirtyColumns.clear();
        this._state.dirtyTasks.clear();
    }

    // ============= ORIGINAL TASK ORDER (for 'unsorted' sort) =============

    /**
     * Save the original task order for each column.
     * Used by 'unsorted' sort to restore original order.
     */
    setOriginalTaskOrder(board: KanbanBoard): void {
        this._state.originalTaskOrder.clear();
        board.columns.forEach(column => {
            this._state.originalTaskOrder.set(column.id, column.tasks.map(t => t.id));
        });
    }

    /**
     * Get original task order for a column
     */
    getOriginalTaskOrder(columnId: string): string[] | undefined {
        return this._state.originalTaskOrder.get(columnId);
    }

    /**
     * Initialize task order for a new column (empty order)
     */
    initColumnTaskOrder(columnId: string): void {
        this._state.originalTaskOrder.set(columnId, []);
    }

    /**
     * Remove task order tracking for a deleted column
     */
    deleteColumnTaskOrder(columnId: string): void {
        this._state.originalTaskOrder.delete(columnId);
    }

    // ============= UNDO/REDO =============

    /**
     * Save an UndoEntry to the undo stack
     * This is the new primary method for saving undo state
     */
    saveUndoEntry(entry: UndoEntry): void {
        if (!entry.board || !entry.board.valid) { return; }

        this._state.undoStack.push(entry);
        if (this._state.undoStack.length > this._maxUndoStackSize) {
            this._state.undoStack.shift();
        }
        this._state.redoStack = [];
        this._sendUndoRedoStatus();
    }

    /**
     * Undo to previous state
     * @returns Object containing restored board and targets for targeted update
     */
    undo(): { board: KanbanBoard; targets: ResolvedTarget[] } | null {
        if (this._state.undoStack.length === 0) {
            vscode.window.showInformationMessage('Nothing to undo');
            return null;
        }

        const currentBoard = this._state.board;
        const restoredEntry = this._state.undoStack.pop()!;

        if (restoredEntry.payload?.type === 'task-move' && currentBoard && currentBoard.valid) {
            logger.debug('[kanban.BoardStore.undo.task-move]', {
                taskId: restoredEntry.payload.taskId,
                fromColumnId: restoredEntry.payload.fromColumnId,
                toColumnId: restoredEntry.payload.toColumnId,
                targets: restoredEntry.targets?.map(t => t.id)
            });
            this._state.redoStack.push({
                board: cloneBoard(currentBoard),
                targets: restoredEntry.targets,
                source: restoredEntry.source,
                timestamp: Date.now(),
                payload: restoredEntry.payload
            });

            this._state.board = restoredEntry.board;
            this._state.cacheValid = true;

            this._sendUndoRedoStatus();

            return {
                board: restoredEntry.board,
                targets: restoredEntry.targets
            };
        }

        if (currentBoard && currentBoard.valid) {
            // Create a redo entry from current state
            // We don't have target info for redo, so use inferred
            this._state.redoStack.push(createInferredUndoEntry(currentBoard));
        }

        this._state.board = restoredEntry.board;
        this._state.cacheValid = true;

        this._sendUndoRedoStatus();

        return {
            board: restoredEntry.board,
            targets: restoredEntry.targets
        };
    }

    /**
     * Redo to next state
     * @returns Object containing restored board and targets for targeted update
     */
    redo(): { board: KanbanBoard; targets: ResolvedTarget[] } | null {
        if (this._state.redoStack.length === 0) {
            vscode.window.showInformationMessage('Nothing to redo');
            return null;
        }

        const currentBoard = this._state.board;
        const restoredEntry = this._state.redoStack.pop()!;

        if (restoredEntry.payload?.type === 'task-move' && currentBoard && currentBoard.valid) {
            this._state.undoStack.push({
                board: cloneBoard(currentBoard),
                targets: restoredEntry.targets,
                source: restoredEntry.source,
                timestamp: Date.now(),
                payload: restoredEntry.payload
            });

            this._state.board = restoredEntry.board;
            this._state.cacheValid = true;

            this._sendUndoRedoStatus();

            return {
                board: restoredEntry.board,
                targets: restoredEntry.targets
            };
        }

        if (currentBoard && currentBoard.valid) {
            // Create an undo entry from current state
            this._state.undoStack.push(createInferredUndoEntry(currentBoard));
        }

        this._state.board = restoredEntry.board;
        this._state.cacheValid = true;

        this._sendUndoRedoStatus();

        return {
            board: restoredEntry.board,
            targets: restoredEntry.targets
        };
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this._state.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this._state.redoStack.length > 0;
    }

    /**
     * Get undo stack size (for debugging)
     */
    getUndoStackSize(): number {
        return this._state.undoStack.length;
    }

    /**
     * Get redo stack size (for debugging)
     */
    getRedoStackSize(): number {
        return this._state.redoStack.length;
    }

    /**
     * Clear undo/redo history
     */
    clearHistory(): void {
        this._state.undoStack = [];
        this._state.redoStack = [];
        this._sendUndoRedoStatus();
    }

    private _sendUndoRedoStatus(): void {
        if (this._webview) {
            this._webview.postMessage({
                type: 'undoRedoStatus',
                canUndo: this.canUndo(),
                canRedo: this.canRedo()
            });
        }
    }

    /**
     * Resend undo/redo status to the webview
     * Called when webview is recreated to re-sync the canUndo/canRedo state
     */
    resendUndoRedoStatus(): void {
        this._sendUndoRedoStatus();
    }

    // ============= LIFECYCLE =============

    /**
     * Dispose the store
     */
    dispose(): void {
        this._state.undoStack = [];
        this._state.redoStack = [];
        this._state.dirtyColumns.clear();
        this._state.dirtyTasks.clear();
    }
}
