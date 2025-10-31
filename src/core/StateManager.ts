import { IStateManager, ApplicationState, StateUpdate, StateSubscriber, FileState } from './types/ApplicationState';

/**
 * State Manager - Single Source of Truth
 *
 * Provides centralized, thread-safe state management with change tracking,
 * validation, and consistent state updates across all components.
 */

export class StateManager implements IStateManager {
    private _state: ApplicationState;
    private _subscribers: StateSubscriber[] = [];
    private _changeHistory: StateUpdate[] = [];
    private _maxHistorySize = 100;

    constructor(initialState?: Partial<ApplicationState>) {
        this._state = this._createInitialState(initialState);
        console.log('[StateManager] Initialized with state');
    }

    /**
     * Get current application state
     */
    getState(): ApplicationState {
        // Create a deep copy of the state
        return {
            ...this._state,
            files: new Map(this._state.files)
        };
    }

    /**
     * Update application state
     */
    update(update: StateUpdate): void {
        console.log('[StateManager] Processing update:', update.type);

        // Validate update
        if (!this._validateUpdate(update)) {
            console.error('[StateManager] Invalid update rejected:', update);
            return;
        }

        // Apply update
        const previousState = this.getState();
        this._applyUpdate(update);

        // Add to history
        this._changeHistory.push(update);
        if (this._changeHistory.length > this._maxHistorySize) {
            this._changeHistory.shift();
        }

        // Notify subscribers
        this._notifySubscribers(update, previousState);

        console.log('[StateManager] Update applied successfully');
    }

    /**
     * Subscribe to state changes
     */
    subscribe(subscriber: StateSubscriber): () => void {
        this._subscribers.push(subscriber);
        console.log(`[StateManager] Added subscriber (total: ${this._subscribers.length})`);

        // Return unsubscribe function
        return () => {
            const index = this._subscribers.indexOf(subscriber);
            if (index >= 0) {
                this._subscribers.splice(index, 1);
                console.log(`[StateManager] Removed subscriber (total: ${this._subscribers.length})`);
            }
        };
    }

    /**
     * Get file state by path
     */
    getFileState(filePath: string): FileState | undefined {
        return this._state.files.get(filePath);
    }

    /**
     * Update file state
     */
    updateFileState(filePath: string, state: Partial<FileState>): void {
        this.update({
            type: 'file-update',
            filePath,
            state
        });
    }

    /**
     * Reset state to initial values
     */
    reset(): void {
        this._state = this._createInitialState();
        this._changeHistory = [];
        console.log('[StateManager] State reset to initial values');
    }

    /**
     * Get state history
     */
    getHistory(): StateUpdate[] {
        return [...this._changeHistory];
    }

    /**
     * Clear state history
     */
    clearHistory(): void {
        this._changeHistory = [];
        console.log('[StateManager] History cleared');
    }

    /**
     * Get state statistics
     */
    getStats(): {
        historySize: number;
        subscriberCount: number;
        fileCount: number;
        activeConflicts: number;
        isProcessingSave: boolean;
    } {
        return {
            historySize: this._changeHistory.length,
            subscriberCount: this._subscribers.length,
            fileCount: this._state.files.size,
            activeConflicts: this._state.conflicts.activeConflicts.length,
            isProcessingSave: this._state.save.isProcessing
        };
    }

    /**
     * Create initial application state
     */
    private _createInitialState(partialState?: Partial<ApplicationState>): ApplicationState {
        const defaultState: ApplicationState = {
            files: new Map(),
            board: {
                board: null,
                version: 0,
                lastSync: null,
                isCacheValid: false
            },
            conflicts: {
                activeConflicts: [],
                lastConflictCheck: null,
                isDialogActive: false
            },
            save: {
                isProcessing: false,
                currentOperation: null,
                queueLength: 0,
                lastSaveTime: null
            },
            version: 1,
            lastUpdate: new Date()
        };

        // Merge with partial state if provided
        if (partialState) {
            return this._mergeStates(defaultState, partialState);
        }

        return defaultState;
    }

    /**
     * Validate state update
     */
    private _validateUpdate(update: StateUpdate): boolean {
        // Basic validation - ensure update has required fields
        if (!update.type) {
            return false;
        }

        // Type-specific validation
        switch (update.type) {
            case 'file-update':
                return !!(update as any).filePath && !!(update as any).state;
            case 'board-update':
            case 'conflict-update':
            case 'save-update':
                return !!(update as any).state;
            case 'reset':
                return true;
            default:
                return false;
        }
    }

    /**
     * Apply state update
     */
    private _applyUpdate(update: StateUpdate): void {
        switch (update.type) {
            case 'file-update':
                const fileUpdate = update as { type: 'file-update'; filePath: string; state: Partial<FileState> };
                const existingFileState = this._state.files.get(fileUpdate.filePath);
                const newFileState = existingFileState
                    ? { ...existingFileState, ...fileUpdate.state }
                    : { ...fileUpdate.state } as FileState;
                this._state.files.set(fileUpdate.filePath, newFileState);
                break;

            case 'board-update':
                const boardUpdate = update as { type: 'board-update'; state: Partial<ApplicationState['board']> };
                this._state.board = { ...this._state.board, ...boardUpdate.state };
                break;

            case 'conflict-update':
                const conflictUpdate = update as { type: 'conflict-update'; state: Partial<ApplicationState['conflicts']> };
                this._state.conflicts = { ...this._state.conflicts, ...conflictUpdate.state };
                break;

            case 'save-update':
                const saveUpdate = update as { type: 'save-update'; state: Partial<ApplicationState['save']> };
                this._state.save = { ...this._state.save, ...saveUpdate.state };
                break;

            case 'reset':
                this._state = this._createInitialState();
                break;
        }

        // Update timestamp and version
        this._state.lastUpdate = new Date();
        this._state.version++;
    }

    /**
     * Notify subscribers of state change
     */
    private _notifySubscribers(update: StateUpdate, previousState: ApplicationState): void {
        if (this._subscribers.length === 0) {
            return;
        }

        console.log(`[StateManager] Notifying ${this._subscribers.length} subscribers`);

        // Create current state snapshot
        const currentState = this.getState();

        // Notify all subscribers
        this._subscribers.forEach(subscriber => {
            try {
                subscriber.onStateUpdate(update, currentState);
            } catch (error) {
                console.error('[StateManager] Error in subscriber:', error);
            }
        });
    }

    /**
     * Merge two application states
     */
    private _mergeStates(target: ApplicationState, source: Partial<ApplicationState>): ApplicationState {
        const result = { ...target };

        // Merge files map
        if (source.files) {
            result.files = new Map(target.files);
            for (const [key, value] of source.files) {
                result.files.set(key, value);
            }
        }

        // Merge other properties
        if (source.board) {
            result.board = { ...target.board, ...source.board };
        }
        if (source.conflicts) {
            result.conflicts = { ...target.conflicts, ...source.conflicts };
        }
        if (source.save) {
            result.save = { ...target.save, ...source.save };
        }
        if (source.version !== undefined) {
            result.version = source.version;
        }
        if (source.lastUpdate) {
            result.lastUpdate = source.lastUpdate;
        }

        return result;
    }
}
