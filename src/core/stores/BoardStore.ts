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

/**
 * Get a fingerprint of the board for debug logging
 * Uses task content to create a unique identifier
 */
function getBoardFingerprint(board: KanbanBoard): string {
    const colCount = board.columns?.length ?? 0;
    const taskCount = board.columns?.reduce((sum, c) => sum + (c.tasks?.length ?? 0), 0) ?? 0;
    // Get total length of all task titles and descriptions as a content fingerprint
    let contentLen = 0;
    for (const col of board.columns ?? []) {
        contentLen += col.title?.length ?? 0;
        for (const task of col.tasks ?? []) {
            contentLen += (task.title?.length ?? 0) + (task.description?.length ?? 0);
        }
    }
    return `cols=${colCount},tasks=${taskCount},contentLen=${contentLen}`;
}

function createLegacyUndoEntry(board: KanbanBoard): UndoEntry {
    return UndoCapture.inferred(board, 'legacy');
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
     * Save an UndoEntry to the undo stack
     * This is the new primary method for saving undo state
     */
    saveUndoEntry(entry: UndoEntry): void {
        if (!entry.board || !entry.board.valid) { return; }

        // Debug logging to track undo entry sources and content
        const savedBoardFP = getBoardFingerprint(entry.board);
        const currentBoardFP = this._state.board ? getBoardFingerprint(this._state.board) : 'null';
        const stackTrace = new Error().stack?.split('\n').slice(2, 5).join(' <- ') || 'unknown';
        console.log(`[BoardStore] saveUndoEntry: op=${entry.source?.operation || 'unknown'}, saving=${savedBoardFP}, current=${currentBoardFP}, newStackSize=${this._state.undoStack.length + 1}`);
        console.log(`[BoardStore] saveUndoEntry from: ${stackTrace}`);

        this._state.undoStack.push(entry);
        if (this._state.undoStack.length > this._maxUndoStackSize) {
            this._state.undoStack.shift();
        }
        this._state.redoStack = [];
        this._sendUndoRedoStatus();
    }

    /**
     * Save current board state for undo (legacy method for compatibility)
     * Creates an inferred UndoEntry without target metadata
     * @deprecated Use saveUndoEntry with proper UndoCapture instead
     */
    saveStateForUndo(board?: KanbanBoard): void {
        const boardToSave = board ?? this._state.board;
        if (!boardToSave || !boardToSave.valid) { return; }

        const entry = createLegacyUndoEntry(boardToSave);
        this.saveUndoEntry(entry);
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
        const currentFP = currentBoard ? getBoardFingerprint(currentBoard) : 'null';

        // Log the stack contents before undo
        const stackContents = this._state.undoStack.map((e, i) => `[${i}]=${getBoardFingerprint(e.board)}`).join(', ');
        console.log(`[BoardStore] undo: current=${currentFP}, stackSize=${this._state.undoStack.length}, stack=[${stackContents}]`);

        if (currentBoard && currentBoard.valid) {
            // Create a redo entry from current state
            // We don't have target info for redo, so use inferred
            this._state.redoStack.push(createLegacyUndoEntry(currentBoard));
        }

        const restoredEntry = this._state.undoStack.pop()!;
        const restoredFP = getBoardFingerprint(restoredEntry.board);
        console.log(`[BoardStore] undo: popped=${restoredFP}, op=${restoredEntry.source?.operation}, newStackSize=${this._state.undoStack.length}`);

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
        if (currentBoard && currentBoard.valid) {
            // Create an undo entry from current state
            this._state.undoStack.push(createLegacyUndoEntry(currentBoard));
        }

        const restoredEntry = this._state.redoStack.pop()!;
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
     * Clear undo/redo history
     */
    clearHistory(): void {
        const stackTrace = new Error().stack?.split('\n').slice(2, 5).join(' <- ') || 'unknown';
        console.log(`[BoardStore] clearHistory: clearing ${this._state.undoStack.length} undo entries, ${this._state.redoStack.length} redo entries`);
        console.log(`[BoardStore] clearHistory from: ${stackTrace}`);
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
        console.log(`[BoardStore] resendUndoRedoStatus: canUndo=${this.canUndo()}, canRedo=${this.canRedo()}, stackSize=${this._state.undoStack.length}`);
        this._sendUndoRedoStatus();
    }

    // ============= LIFECYCLE =============

    /**
     * Dispose the store
     */
    dispose(): void {
        console.log(`[BoardStore] dispose: clearing ${this._state.undoStack.length} undo entries, ${this._state.redoStack.length} redo entries`);
        this._state.undoStack = [];
        this._state.redoStack = [];
        this._state.dirtyColumns.clear();
        this._state.dirtyTasks.clear();
    }
}
