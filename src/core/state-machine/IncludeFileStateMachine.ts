/**
 * Include File State Machine
 *
 * Extends base FileStateMachine with include-specific states:
 * - SWITCHING_OUT: Include file being switched (prompt user)
 * - UNLOADING: Clearing cache for this file
 * - RELOADING: Loading new file after switch
 * - DISPOSED: File has been unregistered
 */

import { FileStateMachine } from './FileStateMachine';
import {
    FileState,
    IncludeFileState,
    CacheState,
    ChangeType,
    StateMachineConfig
} from './FileStateTypes';

type CombinedState = FileState | IncludeFileState;

export class IncludeFileStateMachine extends FileStateMachine {
    /**
     * Check if include file is being switched
     */
    public isSwitching(): boolean {
        return this.context.state === IncludeFileState.SWITCHING_OUT;
    }

    /**
     * Check if include file is unloading
     */
    public isUnloading(): boolean {
        return this.context.state === IncludeFileState.UNLOADING;
    }

    /**
     * Check if include file is disposed
     */
    public isDisposed(): boolean {
        return this.context.state === IncludeFileState.DISPOSED;
    }

    /**
     * Check if include file is reloading
     */
    public isReloading(): boolean {
        return this.context.state === IncludeFileState.RELOADING;
    }

    /**
     * Validate state transition (extended for include states)
     */
    protected isValidTransition(from: CombinedState, to: CombinedState): boolean {
        // Define valid transitions including include-specific states
        const validTransitions: Record<CombinedState, CombinedState[]> = {
            // Base transitions
            [FileState.IDLE]: [FileState.LOADING, IncludeFileState.RELOADING],
            [FileState.LOADING]: [FileState.LOADED, FileState.IDLE],
            [FileState.LOADED]: [
                FileState.DIRTY,
                FileState.SAVING,
                FileState.CONFLICTED,
                FileState.LOADING,
                IncludeFileState.SWITCHING_OUT
            ],
            [FileState.DIRTY]: [
                FileState.SAVING,
                FileState.LOADED,
                FileState.CONFLICTED,
                IncludeFileState.SWITCHING_OUT
            ],
            [FileState.SAVING]: [FileState.LOADED, FileState.DIRTY],
            [FileState.CONFLICTED]: [FileState.LOADED, FileState.DIRTY],

            // Include-specific transitions
            [IncludeFileState.SWITCHING_OUT]: [
                IncludeFileState.UNLOADING,  // User confirmed switch
                FileState.LOADED              // User cancelled switch
            ],
            [IncludeFileState.UNLOADING]: [
                IncludeFileState.DISPOSED     // Unload complete
            ],
            [IncludeFileState.RELOADING]: [
                FileState.LOADED              // Reload complete
            ],
            [IncludeFileState.DISPOSED]: []  // Terminal state
        };

        return validTransitions[from]?.includes(to) ?? false;
    }

    /**
     * Begin switch operation (prompt user if unsaved changes)
     */
    public beginSwitch(hasUnsavedChanges: boolean): void {
        const currentState = this.context.state as CombinedState;

        if (this.isDisposed()) {
            throw new Error('Cannot switch disposed include file');
        }

        this.transition(
            IncludeFileState.SWITCHING_OUT as any,
            hasUnsavedChanges ? 'Switch requested (has unsaved changes)' : 'Switch requested',
            ChangeType.INCLUDES
        );
    }

    /**
     * Cancel switch operation (user chose to keep current file)
     */
    public cancelSwitch(): void {
        if (!this.isSwitching()) {
            throw new Error('No active switch operation to cancel');
        }

        // Restore previous state
        const previousState = this.context.previousState || FileState.LOADED;
        this.transition(
            previousState as any,
            'Switch cancelled by user'
        );
    }

    /**
     * Confirm switch and begin unloading
     */
    public confirmSwitch(): void {
        if (!this.isSwitching()) {
            throw new Error('No active switch operation to confirm');
        }

        this.transition(
            IncludeFileState.UNLOADING as any,
            'Switch confirmed, beginning unload'
        );
    }

    /**
     * Complete unload operation
     */
    public completeUnload(): void {
        if (!this.isUnloading()) {
            throw new Error('Not in UNLOADING state');
        }

        // Clear cache when unloading
        this.invalidateCache();

        this.transition(
            IncludeFileState.DISPOSED as any,
            'Unload completed, file disposed'
        );
    }

    /**
     * Begin reload operation (for new file after switch)
     */
    public beginReload(): void {
        const currentState = this.context.state;

        // Can reload from IDLE or force reload from any state
        if (currentState !== FileState.IDLE && !this.config.enableAutoRollback) {
            throw new Error(`Cannot begin reload from state: ${currentState}`);
        }

        this.transition(
            IncludeFileState.RELOADING as any,
            'Beginning reload after switch',
            ChangeType.INCLUDES
        );

        this.invalidateCache();
    }

    /**
     * Complete reload operation
     */
    public completeReload(): void {
        if (!this.isReloading()) {
            throw new Error('Not in RELOADING state');
        }

        this.transition(
            FileState.LOADED as any,
            'Reload completed'
        );

        this.validateCache();
    }

    /**
     * Handle failed reload (rollback or error state)
     */
    public failReload(error: Error): void {
        if (!this.isReloading()) {
            console.warn(`[IncludeFileStateMachine:${this.filePath}] Reload failed but not in RELOADING state`);
        }

        this.context.lastError = error;

        if (this.config.enableAutoRollback && this.context.previousContent) {
            console.log(`[IncludeFileStateMachine:${this.filePath}] Auto-rolling back after reload failure`);
            this.rollback();
        } else {
            // Enter IDLE state on failure
            this.context.state = FileState.IDLE;
            this.invalidateCache();
        }
    }

    /**
     * Check if file can be safely switched
     */
    public canSwitch(): boolean {
        const state = this.context.state;
        return (
            state === FileState.LOADED ||
            state === FileState.DIRTY
        ) && !this.isDisposed();
    }

    /**
     * Get combined state (for debugging)
     */
    public getCombinedState(): CombinedState {
        return this.context.state as CombinedState;
    }

    /**
     * Reset to initial state (for reuse after disposal)
     */
    public resetForReuse(): void {
        this.reset();
        this.context.state = FileState.IDLE;
        this.context.cacheState = CacheState.INVALID;

        if (this.config.enableLogging) {
            console.log(`[IncludeFileStateMachine:${this.filePath}] Reset for reuse`);
        }
    }

    /**
     * Extended transition for combined states
     */
    protected transition(
        newState: CombinedState,
        reason?: string,
        changeType?: ChangeType
    ): void {
        const oldState = this.context.state as CombinedState;

        // Validate transition
        if (!this.isValidTransition(oldState, newState)) {
            const error = new Error(
                `Invalid state transition: ${oldState} → ${newState} (${reason || 'no reason'})`
            );
            console.error(`[IncludeFileStateMachine:${this.filePath}]`, error.message);
            throw error;
        }

        // Call parent transition logic for recording
        super.transition(newState as any, reason, changeType);
    }
}
