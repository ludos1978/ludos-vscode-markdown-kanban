/**
 * File Event Bus - Prevents Race Conditions
 *
 * Provides ordered, queued event processing to eliminate race conditions
 * in file change detection and handling.
 */

export interface FileEvent {
    id: string;
    type: 'file-created' | 'file-modified' | 'file-deleted' | 'content-changed' | 'external-change' | 'conflict-detected';
    filePath: string;
    timestamp: Date;
    data?: any;
}

export interface FileEventHandler {
    handle(event: FileEvent): Promise<void>;
}

/**
 * File Event Bus with Queuing
 *
 * Ensures events are processed in order and prevents race conditions
 * between multiple event sources (file watchers, document changes, etc.)
 */
export class FileEventBus {
    private _queue: FileEvent[] = [];
    private _processing = false;
    private _handlers = new Map<string, FileEventHandler[]>();
    private _eventCounter = 0;

    /**
     * Publish an event to the bus
     */
    async publish(event: FileEvent): Promise<void> {
        // Add sequence number for ordering
        event.id = event.id || `event_${++this._eventCounter}_${Date.now()}`;

        console.log(`[FileEventBus] Queuing event: ${event.type} for ${event.filePath} (id: ${event.id})`);
        this._queue.push(event);

        await this._processQueue();
    }

    /**
     * Register an event handler for a specific event type
     */
    registerHandler(eventType: string, handler: FileEventHandler): void {
        if (!this._handlers.has(eventType)) {
            this._handlers.set(eventType, []);
        }
        this._handlers.get(eventType)!.push(handler);
        console.log(`[FileEventBus] Registered handler for ${eventType}`);
    }

    /**
     * Unregister an event handler
     */
    unregisterHandler(eventType: string, handler: FileEventHandler): void {
        const handlers = this._handlers.get(eventType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index >= 0) {
                handlers.splice(index, 1);
                console.log(`[FileEventBus] Unregistered handler for ${eventType}`);
            }
        }
    }

    /**
     * Process the event queue sequentially
     */
    private async _processQueue(): Promise<void> {
        if (this._processing || this._queue.length === 0) {
            return;
        }

        this._processing = true;
        console.log(`[FileEventBus] Starting queue processing (${this._queue.length} events)`);

        try {
            while (this._queue.length > 0) {
                const event = this._queue.shift()!;
                console.log(`[FileEventBus] Processing event: ${event.type} for ${event.filePath}`);

                await this._processEvent(event);
            }
        } finally {
            this._processing = false;
            console.log(`[FileEventBus] Queue processing complete`);
        }
    }

    /**
     * Process a single event
     */
    private async _processEvent(event: FileEvent): Promise<void> {
        const handlers = this._handlers.get(event.type) || [];

        if (handlers.length === 0) {
            console.log(`[FileEventBus] No handlers registered for ${event.type}`);
            return;
        }

        console.log(`[FileEventBus] Dispatching to ${handlers.length} handler(s)`);

        // Process all handlers for this event type
        const handlerPromises = handlers.map(async (handler) => {
            try {
                await handler.handle(event);
            } catch (error) {
                console.error(`[FileEventBus] Handler error for ${event.type}:`, error);
                // Continue processing other handlers even if one fails
            }
        });

        await Promise.all(handlerPromises);
    }

    /**
     * Clear all queued events (useful for cleanup)
     */
    clearQueue(): void {
        console.log(`[FileEventBus] Clearing queue (${this._queue.length} events)`);
        this._queue = [];
    }

    /**
     * Get queue statistics
     */
    getStats(): {
        queueLength: number;
        isProcessing: boolean;
        registeredEventTypes: string[];
        totalHandlers: number;
    } {
        let totalHandlers = 0;
        for (const handlers of this._handlers.values()) {
            totalHandlers += handlers.length;
        }

        return {
            queueLength: this._queue.length,
            isProcessing: this._processing,
            registeredEventTypes: Array.from(this._handlers.keys()),
            totalHandlers
        };
    }

    /**
     * Wait for queue to be empty (useful for testing)
     */
    async waitForEmptyQueue(timeoutMs = 5000): Promise<void> {
        const startTime = Date.now();

        while (this._queue.length > 0 || this._processing) {
            if (Date.now() - startTime > timeoutMs) {
                throw new Error(`Timeout waiting for empty queue (${timeoutMs}ms)`);
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
}
