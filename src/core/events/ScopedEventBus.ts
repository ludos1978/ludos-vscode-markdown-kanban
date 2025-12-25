/**
 * ScopedEventBus - Panel-isolated event bus
 *
 * Each panel gets its own ScopedEventBus instance, ensuring events
 * from one panel don't trigger handlers in other panels.
 *
 * This replaces the global EventBus singleton for panel-specific events.
 */

type EventHandler<T> = (data: T) => void | Promise<void>;

export class ScopedEventBus {
    private readonly _panelId: string;
    private readonly _handlers: Map<string, Set<EventHandler<any>>> = new Map();
    private _disposed = false;

    constructor(panelId: string) {
        this._panelId = panelId;
    }

    /**
     * Get the panel ID this bus belongs to
     */
    get panelId(): string {
        return this._panelId;
    }

    /**
     * Check if this bus has been disposed
     */
    get isDisposed(): boolean {
        return this._disposed;
    }

    /**
     * Emit an event to all registered handlers
     * Automatically adds panelId to the event data
     */
    emit<T extends object>(event: string, data: T): void {
        if (this._disposed) {
            console.warn(`[ScopedEventBus:${this._panelId}] Attempted to emit on disposed bus: ${event}`);
            return;
        }

        const handlers = this._handlers.get(event);
        if (!handlers || handlers.size === 0) {
            return;
        }

        // Add panelId to event data
        const eventData = { ...data, panelId: this._panelId };

        // Call all handlers
        for (const handler of handlers) {
            try {
                const result = handler(eventData);
                // Handle async handlers - don't await, just catch errors
                if (result instanceof Promise) {
                    result.catch(err => {
                        console.error(`[ScopedEventBus:${this._panelId}] Async handler error for ${event}:`, err);
                    });
                }
            } catch (err) {
                console.error(`[ScopedEventBus:${this._panelId}] Handler error for ${event}:`, err);
            }
        }
    }

    /**
     * Subscribe to an event
     * Returns an unsubscribe function
     */
    on<T>(event: string, handler: EventHandler<T>): () => void {
        if (this._disposed) {
            console.warn(`[ScopedEventBus:${this._panelId}] Attempted to subscribe on disposed bus: ${event}`);
            return () => {};
        }

        if (!this._handlers.has(event)) {
            this._handlers.set(event, new Set());
        }

        this._handlers.get(event)!.add(handler);

        // Return unsubscribe function
        return () => {
            const eventHandlers = this._handlers.get(event);
            if (eventHandlers) {
                eventHandlers.delete(handler);
                if (eventHandlers.size === 0) {
                    this._handlers.delete(event);
                }
            }
        };
    }

    /**
     * Subscribe to an event for one-time handling
     * Automatically unsubscribes after first event
     */
    once<T>(event: string, handler: EventHandler<T>): () => void {
        const unsubscribe = this.on<T>(event, (data) => {
            unsubscribe();
            handler(data);
        });
        return unsubscribe;
    }

    /**
     * Remove all handlers for a specific event
     */
    off(event: string): void {
        this._handlers.delete(event);
    }

    /**
     * Get count of handlers for an event (useful for debugging)
     */
    handlerCount(event: string): number {
        return this._handlers.get(event)?.size ?? 0;
    }

    /**
     * Get all event names that have handlers
     */
    get eventNames(): string[] {
        return Array.from(this._handlers.keys());
    }

    /**
     * Dispose of this event bus, removing all handlers
     */
    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._handlers.clear();
        console.log(`[ScopedEventBus:${this._panelId}] Disposed`);
    }
}
