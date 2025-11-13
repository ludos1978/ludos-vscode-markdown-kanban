/**
 * Base File State Machine
 *
 * Manages file lifecycle states with cache tracking and rollback support.
 * Provides foundation for MainKanbanFile and IncludeFile state management.
 */

import {
    FileState,
    CacheState,
    ChangeType,
    StateTransition,
    StateMachineContext,
    StateMachineConfig
} from './FileStateTypes';

export class FileStateMachine {
    protected context: StateMachineContext;
    protected config: StateMachineConfig;
    protected filePath: string;

    constructor(filePath: string, config?: Partial<StateMachineConfig>) {
        this.filePath = filePath;
        this.config = {
            enableLogging: true,
            maxHistorySize: 50,
            enableAutoRollback: true,
            ...config
        };

        this.context = {
            state: FileState.IDLE,
            cacheState: CacheState.INVALID,
            transitionHistory: []
        };
    }

    /**
     * Get current state
     */
    public getState(): FileState {
        return this.context.state as FileState;
    }

    /**
     * Get cache state
     */
    public getCacheState(): CacheState {
        return this.context.cacheState;
    }

    /**
     * Get last change type
     */
    public getLastChangeType(): ChangeType | undefined {
        return this.context.lastChangeType;
    }

    /**
     * Check if state machine is in a stable state
     */
    public isStable(): boolean {
        return this.context.state === FileState.LOADED &&
               this.context.cacheState === CacheState.VALID;
    }

    /**
     * Check if file can be safely modified
     */
    public canModify(): boolean {
        return this.context.state === FileState.LOADED ||
               this.context.state === FileState.DIRTY;
    }

    /**
     * Check if file has unsaved changes
     */
    public isDirty(): boolean {
        return this.context.state === FileState.DIRTY;
    }

    /**
     * Check if file has conflict
     */
    public hasConflict(): boolean {
        return this.context.state === FileState.CONFLICTED;
    }

    /**
     * Transition to a new state
     */
    protected transition(
        newState: FileState,
        reason?: string,
        changeType?: ChangeType
    ): void {
        const oldState = this.context.state;

        // Validate transition
        if (!this.isValidTransition(oldState as FileState, newState)) {
            const error = new Error(
                `Invalid state transition: ${oldState} → ${newState} (${reason || 'no reason'})`
            );
            console.error(`[FileStateMachine:${this.filePath}]`, error.message);
            throw error;
        }

        // Record transition
        const transition: StateTransition = {
            from: oldState,
            to: newState,
            timestamp: Date.now(),
            reason,
            changeType
        };

        this.context.transitionHistory.push(transition);

        // Trim history if needed
        if (this.context.transitionHistory.length > this.config.maxHistorySize) {
            this.context.transitionHistory.shift();
        }

        // Save previous state for potential rollback
        this.context.previousState = oldState as FileState;

        // Update state
        this.context.state = newState;

        // Update change type if provided
        if (changeType) {
            this.context.lastChangeType = changeType;
        }

        // Log transition
        if (this.config.enableLogging) {
        }
    }

    /**
     * Validate state transition
     */
    protected isValidTransition(from: FileState, to: FileState): boolean {
        // Define valid transitions
        const validTransitions: Record<FileState, FileState[]> = {
            [FileState.IDLE]: [FileState.LOADING],
            [FileState.LOADING]: [FileState.LOADED, FileState.IDLE],
            [FileState.LOADED]: [FileState.DIRTY, FileState.SAVING, FileState.CONFLICTED, FileState.LOADING],
            [FileState.DIRTY]: [FileState.SAVING, FileState.LOADED, FileState.CONFLICTED],
            [FileState.SAVING]: [FileState.LOADED, FileState.DIRTY],
            [FileState.CONFLICTED]: [FileState.LOADED, FileState.DIRTY]
        };

        return validTransitions[from]?.includes(to) ?? false;
    }

    /**
     * Invalidate cache
     */
    public invalidateCache(): void {
        if (this.context.cacheState !== CacheState.INVALID) {
            this.context.cacheState = CacheState.INVALID;
            if (this.config.enableLogging) {
            }
        }
    }

    /**
     * Validate cache
     */
    public validateCache(): void {
        if (this.context.cacheState !== CacheState.VALID) {
            this.context.cacheState = CacheState.VALID;
            if (this.config.enableLogging) {
            }
        }
    }

    /**
     * Set cache state to partial
     */
    public setPartialCache(): void {
        this.context.cacheState = CacheState.PARTIAL;
        if (this.config.enableLogging) {
        }
    }

    /**
     * Begin loading operation
     */
    public beginLoad(changeType?: ChangeType): void {
        this.transition(FileState.LOADING, 'Begin load operation', changeType);
        this.invalidateCache();
    }

    /**
     * Complete loading operation
     */
    public completeLoad(): void {
        this.transition(FileState.LOADED, 'Load completed');
        this.validateCache();
    }

    /**
     * Begin save operation
     */
    public beginSave(): void {
        this.transition(FileState.SAVING, 'Begin save operation');
    }

    /**
     * Complete save operation
     */
    public completeSave(): void {
        this.transition(FileState.LOADED, 'Save completed');
        this.validateCache();
    }

    /**
     * Mark file as dirty (unsaved changes)
     */
    public markDirty(changeType: ChangeType): void {
        if (this.context.state === FileState.LOADED) {
            this.transition(FileState.DIRTY, 'Content modified', changeType);
        }
    }

    /**
     * Mark file as clean (discard unsaved changes)
     */
    public markClean(): void {
        if (this.context.state === FileState.DIRTY) {
            this.transition(FileState.LOADED, 'Changes discarded');
        }
    }

    /**
     * Detect conflict (external + unsaved changes)
     */
    public enterConflict(reason?: string): void {
        this.transition(FileState.CONFLICTED, reason || 'Conflict detected');
        this.invalidateCache();
    }

    /**
     * Resolve conflict
     */
    public resolveConflict(resolution: 'keep-local' | 'use-remote' | 'merged'): void {
        const targetState = resolution === 'keep-local' ? FileState.DIRTY : FileState.LOADED;
        this.transition(targetState, `Conflict resolved: ${resolution}`);

        if (resolution !== 'keep-local') {
            this.validateCache();
        }
    }

    /**
     * Save state for potential rollback
     */
    public saveRollbackPoint(content: string): void {
        this.context.previousContent = content;
        if (this.config.enableLogging) {
        }
    }

    /**
     * Rollback to previous state
     */
    public rollback(): boolean {
        if (!this.context.previousState) {
            console.warn(`[FileStateMachine:${this.filePath}] No previous state to rollback to`);
            return false;
        }

        const previousState = this.context.previousState;
        this.context.state = previousState;

        if (this.config.enableLogging) {
        }

        return true;
    }

    /**
     * Get transition history
     */
    public getHistory(): StateTransition[] {
        return [...this.context.transitionHistory];
    }

    /**
     * Get full context for debugging
     */
    public getContext(): StateMachineContext {
        return { ...this.context };
    }

    /**
     * Reset state machine
     */
    public reset(): void {
        this.context = {
            state: FileState.IDLE,
            cacheState: CacheState.INVALID,
            transitionHistory: []
        };

        if (this.config.enableLogging) {
        }
    }
}
