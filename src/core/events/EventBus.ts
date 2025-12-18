/**
 * EventBus - Central event dispatcher for the Kanban extension
 *
 * Simple pub/sub pattern. Components emit events and subscribe to events they care about.
 * Replaces the messy sync functions with a clean event-driven architecture.
 *
 * Usage:
 *   // Subscribe to events
 *   const unsubscribe = eventBus.on('board:changed', (event) => {
 *       console.log('Board changed:', event.data.board);
 *   });
 *
 *   // Emit events
 *   eventBus.emit({
 *       type: 'board:changed',
 *       source: 'UICommands',
 *       timestamp: Date.now(),
 *       data: { board, trigger: 'edit' }
 *   });
 *
 *   // Cleanup
 *   unsubscribe();
 */

import { AppEvent, EventType } from './EventTypes';

type EventHandler<T extends AppEvent = AppEvent> = (event: T) => void | Promise<void>;

export class EventBus {
    private static _instance: EventBus | undefined;

    private _listeners = new Map<EventType, Set<EventHandler>>();
    private _eventLog: AppEvent[] = [];
    private _maxLogSize = 100;
    private _debugMode = false;

    private constructor() {
        // Private constructor for singleton
    }

    /**
     * Get the singleton EventBus instance
     */
    public static getInstance(): EventBus {
        if (!EventBus._instance) {
            EventBus._instance = new EventBus();
        }
        return EventBus._instance;
    }

    /**
     * Reset the singleton (for testing)
     */
    public static reset(): void {
        if (EventBus._instance) {
            EventBus._instance._listeners.clear();
            EventBus._instance._eventLog = [];
        }
        EventBus._instance = undefined;
    }

    /**
     * Subscribe to an event type
     *
     * @param type - The event type to subscribe to
     * @param handler - The handler function to call when the event is emitted
     * @returns Unsubscribe function
     */
    public on<T extends AppEvent>(
        type: T['type'],
        handler: EventHandler<T>
    ): () => void {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }

        const handlers = this._listeners.get(type)!;
        handlers.add(handler as EventHandler);

        // Return unsubscribe function
        return () => {
            handlers.delete(handler as EventHandler);
            if (handlers.size === 0) {
                this._listeners.delete(type);
            }
        };
    }

    /**
     * Emit an event to all subscribers
     *
     * @param event - The event to emit
     */
    public async emit<T extends AppEvent>(event: T): Promise<void> {
        // Log event for debugging
        this._eventLog.push(event);
        if (this._eventLog.length > this._maxLogSize) {
            this._eventLog.shift();
        }

        if (this._debugMode) {
            console.log(`[EventBus] ${event.type} from ${event.source}`, event);
        }

        // Get handlers for this event type
        const handlers = this._listeners.get(event.type);
        if (!handlers || handlers.size === 0) {
            return;
        }

        // Call all handlers
        for (const handler of handlers) {
            try {
                await handler(event);
            } catch (error) {
                console.error(`[EventBus] Handler error for ${event.type}:`, error);
                // Continue to other handlers even if one fails
            }
        }
    }

    /**
     * Emit an event synchronously (fire-and-forget)
     * Use this when you don't need to wait for handlers to complete
     */
    public emitSync<T extends AppEvent>(event: T): void {
        this.emit(event).catch(error => {
            console.error(`[EventBus] Async emit error for ${event.type}:`, error);
        });
    }

    /**
     * Check if there are any subscribers for an event type
     */
    public hasSubscribers(type: EventType): boolean {
        const handlers = this._listeners.get(type);
        return handlers !== undefined && handlers.size > 0;
    }

    /**
     * Get the number of subscribers for an event type
     */
    public subscriberCount(type: EventType): number {
        return this._listeners.get(type)?.size || 0;
    }

    /**
     * Enable debug mode (logs all events)
     */
    public setDebugMode(enabled: boolean): void {
        this._debugMode = enabled;
    }

    /**
     * Get the event log (for debugging)
     */
    public getEventLog(): AppEvent[] {
        return [...this._eventLog];
    }

    /**
     * Clear the event log
     */
    public clearEventLog(): void {
        this._eventLog = [];
    }

    /**
     * Get all registered event types (for debugging)
     */
    public getRegisteredEventTypes(): EventType[] {
        return Array.from(this._listeners.keys());
    }

    /**
     * Dispose all listeners
     */
    public dispose(): void {
        this._listeners.clear();
        this._eventLog = [];
    }
}

// Export singleton instance
export const eventBus = EventBus.getInstance();
