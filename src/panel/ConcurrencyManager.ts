/**
 * ConcurrencyManager - Operation locking and race condition prevention
 *
 * Handles:
 * - Operation locking to prevent concurrent operations
 * - Operation queuing when lock is held
 * - Timestamp tracking for event ordering (RACE-3)
 * - Stale event detection
 *
 * @module panel/ConcurrencyManager
 */

/**
 * Pending operation in the queue
 */
interface PendingOperation<T> {
    name: string;
    operation: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: any) => void;
}

/**
 * ConcurrencyManager - Prevents race conditions and ensures operation ordering
 *
 * Features:
 * - Single operation lock with queuing
 * - Timestamp-based event deduplication
 * - Stale event rejection
 */
export class ConcurrencyManager {
    /** Currently running operation name (null if none) */
    private _operationInProgress: string | null = null;

    /** Queue of pending operations waiting for lock */
    private _pendingOperations: PendingOperation<any>[] = [];

    /** Last processed timestamp per file path (for RACE-3) */
    private _lastProcessedTimestamps: Map<string, Date> = new Map();

    /** Debug mode for logging */
    private _debugMode: boolean;

    constructor(debugMode: boolean = false) {
        this._debugMode = debugMode;
    }

    // ============= OPERATION LOCKING (RACE-4) =============

    /**
     * Execute operation with exclusive lock
     *
     * Prevents concurrent operations from interfering with each other.
     * If an operation is already running, queues the new operation.
     *
     * @param operationName Name for logging/debugging
     * @param operation The async operation to execute
     * @returns Promise that resolves with operation result
     */
    async withLock<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
        // If operation already in progress, queue this one
        if (this._operationInProgress) {
            this._log(`Queuing operation "${operationName}" (waiting for "${this._operationInProgress}")`);

            return new Promise<T>((resolve, reject) => {
                this._pendingOperations.push({
                    name: operationName,
                    operation,
                    resolve,
                    reject
                });
            });
        }

        // Acquire lock
        this._operationInProgress = operationName;
        this._log(`Starting operation "${operationName}"`);

        try {
            const result = await operation();
            this._log(`Completed operation "${operationName}"`);
            return result;
        } catch (error) {
            this._log(`Failed operation "${operationName}": ${error}`);
            throw error;
        } finally {
            // Release lock
            this._operationInProgress = null;

            // Process next queued operation
            this._processNextOperation();
        }
    }

    /**
     * Check if any operation is currently in progress
     */
    isOperationInProgress(): boolean {
        return this._operationInProgress !== null;
    }

    /**
     * Get the name of the current operation (for debugging)
     */
    getCurrentOperation(): string | null {
        return this._operationInProgress;
    }

    /**
     * Get count of pending operations
     */
    getPendingCount(): number {
        return this._pendingOperations.length;
    }

    // ============= EVENT TIMESTAMP TRACKING (RACE-3) =============

    /**
     * Check if event is newer than last processed event for a file
     *
     * Prevents old events from overriding newer ones. When multiple external
     * changes happen rapidly, reloads can complete out of order.
     *
     * @param filePath The file path (used as key)
     * @param eventTimestamp The timestamp from the event
     * @returns true if event should be processed, false if stale
     */
    isEventNewer(filePath: string, eventTimestamp: Date): boolean {
        const lastProcessed = this._lastProcessedTimestamps.get(filePath);

        if (!lastProcessed) {
            // First event for this file - accept it
            this._lastProcessedTimestamps.set(filePath, eventTimestamp);
            this._log(`First event for "${filePath}" - accepting`);
            return true;
        }

        if (eventTimestamp > lastProcessed) {
            // Newer event - accept and update timestamp
            this._lastProcessedTimestamps.set(filePath, eventTimestamp);
            this._log(`Newer event for "${filePath}" - accepting`);
            return true;
        }

        // Older or same timestamp - reject
        this._log(`Stale event for "${filePath}" - rejecting (${eventTimestamp} <= ${lastProcessed})`);
        return false;
    }

    /**
     * Clear timestamp tracking for a file
     */
    clearTimestamp(filePath: string): void {
        this._lastProcessedTimestamps.delete(filePath);
    }

    /**
     * Clear all timestamp tracking
     */
    clearAllTimestamps(): void {
        this._lastProcessedTimestamps.clear();
    }

    // ============= CLEANUP =============

    /**
     * Clear all state (for disposal)
     */
    dispose(): void {
        // Reject all pending operations
        for (const pending of this._pendingOperations) {
            pending.reject(new Error('ConcurrencyManager disposed'));
        }

        this._pendingOperations = [];
        this._operationInProgress = null;
        this._lastProcessedTimestamps.clear();
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Process next queued operation
     */
    private _processNextOperation(): void {
        const next = this._pendingOperations.shift();
        if (next) {
            this._log(`Processing queued operation "${next.name}"`);

            // Run next operation (will acquire lock via withLock)
            this.withLock(next.name, next.operation)
                .then(next.resolve)
                .catch(next.reject);
        }
    }

    private _log(message: string): void {
        if (this._debugMode) {
            console.log(`[ConcurrencyManager] ${message}`);
        }
    }
}
