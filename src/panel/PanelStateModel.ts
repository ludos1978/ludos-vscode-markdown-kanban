/**
 * PanelStateModel - Centralized state management for KanbanWebviewPanel
 *
 * Consolidates all panel state flags into a single, well-defined model
 * with validation and transition control.
 *
 * @module panel/PanelStateModel
 */

/**
 * Panel state flags interface
 */
export interface PanelStateFlags {
    /** Panel has completed initial setup */
    initialized: boolean;
    /** Currently applying changes from webview (prevents re-parsing) */
    updatingFromPanel: boolean;
    /** Currently performing undo/redo operation */
    undoRedoOperation: boolean;
    /** Prevents recursive close attempts during cleanup */
    closingPrevented: boolean;
    /** Panel has been disposed, all operations should be skipped */
    disposed: boolean;
    /** User is actively editing in the webview */
    editingInProgress: boolean;
    /** Initial include file loading is in progress */
    initialBoardLoad: boolean;
    /** Include switch operation is in progress (protects cache) */
    includeSwitchInProgress: boolean;
}

/**
 * Default state values
 */
const DEFAULT_STATE: PanelStateFlags = {
    initialized: false,
    updatingFromPanel: false,
    undoRedoOperation: false,
    closingPrevented: false,
    disposed: false,
    editingInProgress: false,
    initialBoardLoad: false,
    includeSwitchInProgress: false
};

/**
 * PanelStateModel - Encapsulates panel state with controlled transitions
 *
 * Benefits:
 * - Single source of truth for panel state
 * - Validates state transitions
 * - Provides logging for state changes (debug mode)
 * - Prevents invalid state combinations
 */
export class PanelStateModel {
    private _state: PanelStateFlags;
    private _debugMode: boolean;

    constructor(debugMode: boolean = false) {
        this._state = { ...DEFAULT_STATE };
        this._debugMode = debugMode;
    }

    // ============= GETTERS =============

    get initialized(): boolean { return this._state.initialized; }
    get updatingFromPanel(): boolean { return this._state.updatingFromPanel; }
    get undoRedoOperation(): boolean { return this._state.undoRedoOperation; }
    get closingPrevented(): boolean { return this._state.closingPrevented; }
    get disposed(): boolean { return this._state.disposed; }
    get editingInProgress(): boolean { return this._state.editingInProgress; }
    get initialBoardLoad(): boolean { return this._state.initialBoardLoad; }
    get includeSwitchInProgress(): boolean { return this._state.includeSwitchInProgress; }

    // ============= SETTERS WITH VALIDATION =============

    setInitialized(value: boolean): void {
        if (this._state.disposed) {
            this._logWarning('Cannot set initialized on disposed panel');
            return;
        }
        this._setState('initialized', value);
    }

    setUpdatingFromPanel(value: boolean): void {
        if (this._state.disposed) {
            return;
        }
        this._setState('updatingFromPanel', value);
    }

    setUndoRedoOperation(value: boolean): void {
        if (this._state.disposed) {
            return;
        }
        this._setState('undoRedoOperation', value);
    }

    setClosingPrevented(value: boolean): void {
        this._setState('closingPrevented', value);
    }

    setDisposed(value: boolean): void {
        if (value && !this._state.disposed) {
            // When disposing, reset all other flags
            this._setState('disposed', true);
            this._state.initialized = false;
            this._state.updatingFromPanel = false;
            this._state.undoRedoOperation = false;
            this._state.editingInProgress = false;
            this._state.initialBoardLoad = false;
            this._state.includeSwitchInProgress = false;
        }
    }

    setEditingInProgress(value: boolean): void {
        if (this._state.disposed) {
            return;
        }
        this._setState('editingInProgress', value);
    }

    setInitialBoardLoad(value: boolean): void {
        if (this._state.disposed) {
            return;
        }
        this._setState('initialBoardLoad', value);
    }

    setIncludeSwitchInProgress(value: boolean): void {
        if (this._state.disposed) {
            return;
        }
        this._setState('includeSwitchInProgress', value);
    }

    // ============= CONVENIENCE METHODS =============

    /**
     * Check if any blocking operation is in progress
     */
    isBlocked(): boolean {
        return this._state.disposed ||
               this._state.updatingFromPanel ||
               this._state.undoRedoOperation ||
               this._state.includeSwitchInProgress;
    }

    /**
     * Check if panel is ready for user interaction
     */
    isReady(): boolean {
        return this._state.initialized &&
               !this._state.disposed &&
               !this._state.initialBoardLoad;
    }

    /**
     * Check if external changes should be processed
     */
    shouldProcessExternalChanges(): boolean {
        return !this._state.disposed &&
               !this._state.updatingFromPanel &&
               !this._state.includeSwitchInProgress;
    }

    /**
     * Check if board regeneration is allowed
     */
    canRegenerateBoard(): boolean {
        return !this._state.disposed &&
               !this._state.editingInProgress &&
               !this._state.includeSwitchInProgress;
    }

    /**
     * Check if cache invalidation is allowed
     */
    canInvalidateCache(): boolean {
        return !this._state.includeSwitchInProgress;
    }

    /**
     * Get a snapshot of current state (for debugging/logging)
     */
    getSnapshot(): Readonly<PanelStateFlags> {
        return { ...this._state };
    }

    /**
     * Reset to default state (for testing)
     */
    reset(): void {
        this._state = { ...DEFAULT_STATE };
    }

    // ============= PRIVATE HELPERS =============

    private _setState<K extends keyof PanelStateFlags>(key: K, value: PanelStateFlags[K]): void {
        const oldValue = this._state[key];
        if (oldValue !== value) {
            this._state[key] = value;
            this._logTransition(key, oldValue, value);
        }
    }

    private _logTransition<K extends keyof PanelStateFlags>(key: K, oldValue: PanelStateFlags[K], newValue: PanelStateFlags[K]): void {
        if (this._debugMode) {
            console.log(`[PanelState] ${key}: ${oldValue} → ${newValue}`);
        }
    }

    private _logWarning(message: string): void {
        if (this._debugMode) {
            console.warn(`[PanelState] ${message}`);
        }
    }
}
