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
import { KanbanBoard, KanbanColumn, KanbanTask } from '../../markdownParser';
import { PanelEventBus } from '../events';

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
    private _eventBus: PanelEventBus;
    private _webview?: vscode.Webview;
    private readonly _maxUndoStackSize: number;
    private _isDisposed = false;

    constructor(eventBus: PanelEventBus, options: BoardStoreOptions = {}) {
        this._eventBus = eventBus;
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
    setBoard(board: KanbanBoard | null, emitEvent: boolean = true): void {
        const previousBoard = this._state.board;
        this._state.board = board;
        this._state.cacheValid = board !== null;

        if (emitEvent && board) {
            this._eventBus.emit('board:updated', {
                board,
                changeType: 'set',
                previousBoard: previousBoard ?? undefined
            }).catch(() => {});
        }
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
        this._emitDirtyState();
    }

    /**
     * Mark a task as dirty (has unrendered changes)
     */
    markTaskDirty(taskId: string): void {
        this._state.dirtyTasks.add(taskId);
        this._emitDirtyState();
    }

    /**
     * Clear dirty flag for a column
     */
    clearColumnDirty(columnId: string): void {
        this._state.dirtyColumns.delete(columnId);
        this._emitDirtyState();
    }

    /**
     * Clear dirty flag for a task
     */
    clearTaskDirty(taskId: string): void {
        this._state.dirtyTasks.delete(taskId);
        this._emitDirtyState();
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
        this._eventBus.emit('board:clean', undefined).catch(() => {});
    }

    private _emitDirtyState(): void {
        if (this._state.dirtyColumns.size > 0 || this._state.dirtyTasks.size > 0) {
            this._eventBus.emit('board:dirty', {
                dirtyColumns: Array.from(this._state.dirtyColumns),
                dirtyTasks: Array.from(this._state.dirtyTasks)
            }).catch(() => {});
        } else {
            this._eventBus.emit('board:clean', undefined).catch(() => {});
        }
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

        this._eventBus.emit('undo:completed', { board: restoredBoard }).catch(() => {});

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

        this._eventBus.emit('redo:completed', { board: restoredBoard }).catch(() => {});

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

    /**
     * Set webview for undo/redo status updates
     */
    setWebview(webview: vscode.Webview): void {
        this._webview = webview;
    }

    private _sendUndoRedoStatus(): void {
        if (this._webview) {
            this._webview.postMessage({
                type: 'undoRedoStatus',
                canUndo: this.canUndo(),
                canRedo: this.canRedo()
            });
        }

        this._eventBus.emit('undoredo:state_changed', {
            canUndo: this.canUndo(),
            canRedo: this.canRedo()
        }).catch(() => {});
    }

    // ============= STATE ACCESS =============

    /**
     * Get full state (for debugging/testing)
     */
    get state(): Readonly<BoardState> {
        return {
            ...this._state,
            dirtyColumns: new Set(this._state.dirtyColumns),
            dirtyTasks: new Set(this._state.dirtyTasks),
            undoStack: [...this._state.undoStack],
            redoStack: [...this._state.redoStack]
        };
    }

    /**
     * Reset all state
     */
    reset(): void {
        this._state = {
            board: null,
            cacheValid: false,
            dirtyColumns: new Set(),
            dirtyTasks: new Set(),
            undoStack: [],
            redoStack: []
        };
        this._sendUndoRedoStatus();
    }

    // ============= LIFECYCLE =============

    /**
     * Check if disposed
     */
    get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Dispose the store
     */
    dispose(): void {
        this._isDisposed = true;
        this._state.undoStack = [];
        this._state.redoStack = [];
        this._state.dirtyColumns.clear();
        this._state.dirtyTasks.clear();
    }
}
