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
    /** Undo history stack */
    undoStack: KanbanBoard[];
    /** Redo history stack */
    redoStack: KanbanBoard[];
}

export interface BoardStoreOptions {
    /** Maximum undo stack size (default: 100) */
    maxUndoStackSize?: number;
    /** Webview for sending undo/redo status (optional) */
    webview?: vscode.Webview;
}

// ============= HELPER FUNCTIONS =============

function deepCloneBoard(board: KanbanBoard): KanbanBoard {
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
            redoStack: []
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
    setBoard(board: KanbanBoard | null, _emitEvent: boolean = true): void {
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

    // ============= UNDO/REDO =============

    /**
     * Save current board state for undo
     */
    saveStateForUndo(board?: KanbanBoard): void {
        const boardToSave = board ?? this._state.board;
        if (!boardToSave || !boardToSave.valid) { return; }

        this._state.undoStack.push(deepCloneBoard(boardToSave));
        if (this._state.undoStack.length > this._maxUndoStackSize) {
            this._state.undoStack.shift();
        }
        this._state.redoStack = [];
        this._sendUndoRedoStatus();
    }

    /**
     * Undo to previous state
     * @returns The restored board, or null if nothing to undo
     */
    undo(): KanbanBoard | null {
        if (this._state.undoStack.length === 0) {
            vscode.window.showInformationMessage('Nothing to undo');
            return null;
        }

        const currentBoard = this._state.board;
        if (currentBoard && currentBoard.valid) {
            this._state.redoStack.push(deepCloneBoard(currentBoard));
        }

        const restoredBoard = this._state.undoStack.pop()!;
        this._state.board = restoredBoard;
        this._state.cacheValid = true;

        this._sendUndoRedoStatus();

        return restoredBoard;
    }

    /**
     * Redo to next state
     * @returns The restored board, or null if nothing to redo
     */
    redo(): KanbanBoard | null {
        if (this._state.redoStack.length === 0) {
            vscode.window.showInformationMessage('Nothing to redo');
            return null;
        }

        const currentBoard = this._state.board;
        if (currentBoard && currentBoard.valid) {
            this._state.undoStack.push(deepCloneBoard(currentBoard));
        }

        const restoredBoard = this._state.redoStack.pop()!;
        this._state.board = restoredBoard;
        this._state.cacheValid = true;

        this._sendUndoRedoStatus();

        return restoredBoard;
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
