/**
 * Watcher Coordinator
 *
 * Centralized coordination for file watcher operations.
 * Prevents conflicts between concurrent file operations.
 *
 * @module files/WatcherCoordinator
 */

/**
 * Active operation data
 */
interface ActiveOperation {
    operation: string;
    startTime: Date;
    timeout: NodeJS.Timeout;
}

/**
 * Queued operation data
 */
interface QueuedOperation {
    operation: string;
    callback: () => Promise<void>;
}

/**
 * Normalizes a file path for consistent lookup
 */
function normalizePathForLookup(filePath: string): string {
    return filePath.toLowerCase().replace(/\\/g, '/');
}

/**
 * Coordinates file watcher operations to prevent conflicts.
 * Queues operations when a file is already being operated on.
 */
export class WatcherCoordinator {
    private static _instance: WatcherCoordinator;
    private readonly DEFAULT_TIMEOUT_MS = 5000;

    // Track active operations per file
    private activeOperations = new Map<string, ActiveOperation>();

    // Queue operations when conflicts occur
    private operationQueue = new Map<string, QueuedOperation[]>();

    private constructor() {}

    static getInstance(): WatcherCoordinator {
        if (!WatcherCoordinator._instance) {
            WatcherCoordinator._instance = new WatcherCoordinator();
        }
        return WatcherCoordinator._instance;
    }

    /**
     * Start an operation with conflict detection.
     * If another operation is active, queues this one.
     */
    async startOperation(filePath: string, operation: string, timeoutMs?: number): Promise<void> {
        const timeout = timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
        const normalizedPath = normalizePathForLookup(filePath);
        const existing = this.activeOperations.get(normalizedPath);

        if (existing) {
            // Queue the operation
            return new Promise((resolve, reject) => {
                if (!this.operationQueue.has(normalizedPath)) {
                    this.operationQueue.set(normalizedPath, []);
                }
                this.operationQueue.get(normalizedPath)!.push({
                    operation,
                    callback: async () => {
                        try {
                            await this.startOperation(filePath, operation, timeout);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    }
                });
            });
        }

        // Start the operation
        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                console.error(`[WatcherCoordinator] Operation "${operation}" timed out on ${normalizedPath}`);
                this.endOperation(filePath, operation);
                reject(new Error(`Operation timeout: ${operation}`));
            }, timeout);

            this.activeOperations.set(normalizedPath, {
                operation,
                startTime: new Date(),
                timeout: timeoutHandle
            });

            resolve();
        });
    }

    /**
     * End an operation and process queued operations
     */
    endOperation(filePath: string, operation: string): void {
        const normalizedPath = normalizePathForLookup(filePath);
        const existing = this.activeOperations.get(normalizedPath);

        if (existing && existing.operation === operation) {
            clearTimeout(existing.timeout);
            this.activeOperations.delete(normalizedPath);

            // Process next queued operation
            const queue = this.operationQueue.get(normalizedPath);
            if (queue && queue.length > 0) {
                const next = queue.shift()!;
                next.callback().catch(error => {
                    console.error(`[WatcherCoordinator] Queued operation failed:`, error);
                });
            }
        }
    }

    /**
     * Check if file has active operations
     */
    hasActiveOperations(filePath: string): boolean {
        const normalizedPath = normalizePathForLookup(filePath);
        return this.activeOperations.has(normalizedPath);
    }

    /**
     * Get active operation info for debugging
     */
    getActiveOperation(filePath: string): { operation: string; startTime: Date } | undefined {
        const normalizedPath = normalizePathForLookup(filePath);
        const active = this.activeOperations.get(normalizedPath);
        return active ? { operation: active.operation, startTime: active.startTime } : undefined;
    }

    /**
     * Get queue length for a file
     */
    getQueueLength(filePath: string): number {
        const normalizedPath = normalizePathForLookup(filePath);
        return this.operationQueue.get(normalizedPath)?.length ?? 0;
    }
}
