import { ConflictContext, Conflict, ConflictResolution } from '../types/ConflictTypes';

/**
 * Conflict Manager Interface
 *
 * Defines the contract for conflict detection and resolution.
 * Handles all scenarios where local and external changes conflict.
 */
export interface IConflictManager {
    /**
     * Detect conflicts based on current context
     * @param context Current conflict context
     * @returns Array of detected conflicts
     */
    detectConflicts(context: ConflictContext): Promise<Conflict[]>;

    /**
     * Resolve a specific conflict
     * @param conflict The conflict to resolve
     * @returns The resolution chosen by user or system
     */
    resolveConflict(conflict: Conflict): Promise<ConflictResolution>;

    /**
     * Get all currently active conflicts
     * @returns Array of active conflicts
     */
    getActiveConflicts(): Conflict[];

    /**
     * Clear all active conflicts
     */
    clearActiveConflicts(): void;

    /**
     * Get conflict manager statistics
     */
    getStats(): {
        activeConflictCount: number;
        ruleCount: number;
    };
}