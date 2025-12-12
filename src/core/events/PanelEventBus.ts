/**
 * PanelEventBus - Typed Event System for Kanban Panel
 *
 * Central event bus for all panel-related events.
 * Features:
 * - Strongly typed events
 * - Priority-based handler execution
 * - WeakRef handler support (auto-cleanup)
 * - Correlation IDs for tracing
 * - Middleware support
 * - Event history for debugging
 * - Timeout protection
 *
 * NOTE: This is NEW infrastructure. No existing code is being replaced.
 * Events will be emitted IN PARALLEL with existing behavior during migration.
 */

import * as vscode from 'vscode';
import { EventType, EventPayload } from './EventDefinitions';

// ============= TYPES =============

/**
 * Event object passed to handlers
 */
export interface PanelEvent<K extends EventType = EventType> {
    readonly type: K;
    readonly payload: EventPayload<K>;
    readonly timestamp: number;
    readonly id: string;
    readonly correlationId?: string;
    readonly source?: string;
}

/**
 * Handler priority levels
 */
export enum HandlerPriority {
    /** Must run first (validation, guards) */
    CRITICAL = 0,
    /** Important handlers (state updates) */
    HIGH = 100,
    /** Default priority */
    NORMAL = 500,
    /** Lower priority (side effects) */
    LOW = 900,
    /** Run last (monitoring, logging) */
    MONITOR = 1000
}

/**
 * Options for handler registration
 */
export interface HandlerOptions {
    /** Handler execution priority (default: NORMAL) */
    priority?: HandlerPriority;
    /** Auto-remove after first invocation */
    once?: boolean;
    /** Maximum execution time in ms (default: 5000) */
    timeout?: number;
    /** How to handle errors (default: 'log') */
    errorStrategy?: 'throw' | 'log' | 'ignore';
    // TODO: Add WeakRef support when upgrading to ES2021+
    // /** Use WeakRef for automatic cleanup */
    // weak?: boolean;
}

/**
 * Options for EventBus construction
 */
export interface EventBusOptions {
    /** Max events to keep in history (default: 100) */
    historyLimit?: number;
    /** Enable event history recording (default: false) */
    enableTracing?: boolean;
    /** Default handler timeout (default: 5000) */
    defaultTimeout?: number;
    /** Custom error handler */
    onError?: (error: Error, event: PanelEvent, handlerName: string) => void;
}

/**
 * Handler function type
 */
type Handler<K extends EventType> = (event: PanelEvent<K>) => void | Promise<void>;

/**
 * Internal handler registration
 */
interface RegisteredHandler<K extends EventType> {
    handler: Handler<K>;
    // TODO: Add WeakRef support when upgrading to ES2021+
    // handler: Handler<K> | WeakRef<Handler<K>>;
    options: Required<HandlerOptions>;
    name: string;
}

/**
 * Middleware context
 */
export interface MiddlewareContext {
    event: PanelEvent;
    handlerCount: number;
    startTime: number;
}

/**
 * Middleware function type
 */
export type Middleware = (
    context: MiddlewareContext,
    next: () => Promise<void>
) => Promise<void>;

/**
 * Metrics collected by the event bus
 */
export interface EventBusMetrics {
    eventsEmitted: number;
    handlersInvoked: number;
    errors: number;
    slowEvents: number;
    avgHandlerTimeMs: number;
}

// ============= MAIN CLASS =============

export class PanelEventBus implements vscode.Disposable {
    private handlers = new Map<EventType, Set<RegisteredHandler<any>>>();
    private middlewares: Middleware[] = [];
    private eventHistory: PanelEvent[] = [];
    private activeCorrelationId: string | null = null;
    private disposables: vscode.Disposable[] = [];
    private _isDisposed = false;
    private eventCounter = 0;

    private readonly options: Required<EventBusOptions>;

    private _metrics: EventBusMetrics = {
        eventsEmitted: 0,
        handlersInvoked: 0,
        errors: 0,
        slowEvents: 0,
        avgHandlerTimeMs: 0
    };

    constructor(options: EventBusOptions = {}) {
        this.options = {
            historyLimit: options.historyLimit ?? 100,
            enableTracing: options.enableTracing ?? false,
            defaultTimeout: options.defaultTimeout ?? 5000,
            onError: options.onError ?? this.defaultErrorHandler.bind(this)
        };
    }

    // ============= SUBSCRIPTION =============

    /**
     * Subscribe to an event type
     * @returns Disposable to unsubscribe
     */
    on<K extends EventType>(
        type: K,
        handler: Handler<K>,
        options: HandlerOptions = {}
    ): vscode.Disposable {
        if (this._isDisposed) {
            throw new Error('PanelEventBus is disposed');
        }

        const fullOptions: Required<HandlerOptions> = {
            priority: options.priority ?? HandlerPriority.NORMAL,
            once: options.once ?? false,
            timeout: options.timeout ?? this.options.defaultTimeout,
            errorStrategy: options.errorStrategy ?? 'log'
            // TODO: Add WeakRef support when upgrading to ES2021+
            // weak: options.weak ?? false
        };

        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }

        const registered: RegisteredHandler<K> = {
            // TODO: Add WeakRef support when upgrading to ES2021+
            // handler: fullOptions.weak ? new WeakRef(handler) : handler,
            handler: handler,
            options: fullOptions,
            name: handler.name || 'anonymous'
        };

        this.handlers.get(type)!.add(registered);

        const disposable: vscode.Disposable = {
            dispose: () => {
                this.handlers.get(type)?.delete(registered);
            }
        };

        this.disposables.push(disposable);
        return disposable;
    }

    /**
     * Subscribe to an event type, auto-remove after first invocation
     */
    once<K extends EventType>(
        type: K,
        handler: Handler<K>,
        options: Omit<HandlerOptions, 'once'> = {}
    ): vscode.Disposable {
        return this.on(type, handler, { ...options, once: true });
    }

    // TODO: Add WeakRef support when upgrading to ES2021+
    // /**
    //  * Subscribe with WeakRef (auto-cleanup when handler is garbage collected)
    //  */
    // onWeak<K extends EventType>(
    //     type: K,
    //     handler: Handler<K>,
    //     options: Omit<HandlerOptions, 'weak'> = {}
    // ): vscode.Disposable {
    //     return this.on(type, handler, { ...options, weak: true });
    // }

    // ============= EMISSION =============

    /**
     * Emit an event
     */
    async emit<K extends EventType>(
        type: K,
        payload: EventPayload<K>,
        options?: { source?: string; correlationId?: string }
    ): Promise<void> {
        if (this._isDisposed) return;

        const event: PanelEvent<K> = {
            type,
            payload,
            timestamp: Date.now(),
            id: this.generateEventId(type),
            correlationId: options?.correlationId ?? this.activeCorrelationId ?? undefined,
            source: options?.source
        };

        // Record in history
        this.addToHistory(event);
        this._metrics.eventsEmitted++;

        // Get handlers sorted by priority
        const registeredHandlers = this.getHandlersSorted(type);

        if (registeredHandlers.length === 0) return;

        // Build middleware context
        const context: MiddlewareContext = {
            event,
            handlerCount: registeredHandlers.length,
            startTime: Date.now()
        };

        // Execute through middleware chain
        const executeHandlers = async () => {
            await this.executeHandlers(event, registeredHandlers);
        };

        let chain = executeHandlers;
        for (let i = this.middlewares.length - 1; i >= 0; i--) {
            const middleware = this.middlewares[i];
            const next = chain;
            chain = () => middleware(context, next);
        }

        await chain();
    }

    /**
     * Execute callback with correlation ID applied to all emitted events
     */
    async withCorrelation<T>(
        correlationId: string,
        callback: () => Promise<T>
    ): Promise<T> {
        const previous = this.activeCorrelationId;
        this.activeCorrelationId = correlationId;
        try {
            return await callback();
        } finally {
            this.activeCorrelationId = previous;
        }
    }

    /**
     * Emit multiple events with shared correlation ID
     */
    async emitBatch(
        events: Array<{ type: EventType; payload: any }>
    ): Promise<void> {
        const correlationId = this.generateEventId('batch');

        await this.withCorrelation(correlationId, async () => {
            for (const e of events) {
                await this.emit(e.type, e.payload, { correlationId });
            }
        });
    }

    private async executeHandlers<K extends EventType>(
        event: PanelEvent<K>,
        registeredHandlers: RegisteredHandler<K>[]
    ): Promise<void> {
        const toRemove: RegisteredHandler<K>[] = [];

        for (const registered of registeredHandlers) {
            // Get handler (WeakRef support disabled for ES2020 compatibility)
            const handler: Handler<K> = registered.handler;

            // TODO: Add WeakRef support when upgrading to ES2021+
            // if (registered.handler instanceof WeakRef) {
            //     handler = registered.handler.deref();
            //     if (!handler) {
            //         // Handler was garbage collected
            //         toRemove.push(registered);
            //         continue;
            //     }
            // } else {
            //     handler = registered.handler;
            // }

            // Execute with timeout
            const startTime = Date.now();

            try {
                await this.executeWithTimeout(
                    handler,
                    event,
                    registered.options.timeout
                );

                this._metrics.handlersInvoked++;
                this.updateAvgHandlerTime(Date.now() - startTime);

            } catch (error) {
                this._metrics.errors++;
                await this.handleError(
                    error as Error,
                    event,
                    registered
                );
            }

            // Remove if once
            if (registered.options.once) {
                toRemove.push(registered);
            }
        }

        // Cleanup
        const handlerSet = this.handlers.get(event.type);
        if (handlerSet) {
            for (const r of toRemove) {
                handlerSet.delete(r);
            }
        }
    }

    private async executeWithTimeout<K extends EventType>(
        handler: Handler<K>,
        event: PanelEvent<K>,
        timeout: number
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._metrics.slowEvents++;
                reject(new Error(`Handler timeout after ${timeout}ms`));
            }, timeout);

            Promise.resolve(handler(event))
                .then(resolve)
                .catch(reject)
                .finally(() => clearTimeout(timer));
        });
    }

    private async handleError<K extends EventType>(
        error: Error,
        event: PanelEvent<K>,
        registered: RegisteredHandler<K>
    ): Promise<void> {
        switch (registered.options.errorStrategy) {
            case 'throw':
                throw error;

            case 'log':
                console.error(
                    `[PanelEventBus] Handler "${registered.name}" error for ${event.type}:`,
                    error
                );
                this.options.onError(error, event, registered.name);
                break;

            case 'ignore':
                // Silent
                break;
        }
    }

    private defaultErrorHandler(error: Error, event: PanelEvent, handlerName: string): void {
        // Emit debug event (async, won't cause recursion for different type)
        this.emit('debug:handler_error', {
            eventType: event.type,
            eventId: event.id,
            error,
            handlerName
        }).catch(() => {
            // Ignore errors in error handler
        });
    }

    // ============= MIDDLEWARE =============

    /**
     * Add middleware to the event processing chain
     */
    use(middleware: Middleware): vscode.Disposable {
        this.middlewares.push(middleware);
        return {
            dispose: () => {
                const index = this.middlewares.indexOf(middleware);
                if (index >= 0) {
                    this.middlewares.splice(index, 1);
                }
            }
        };
    }

    // ============= UTILITIES =============

    private getHandlersSorted<K extends EventType>(type: K): RegisteredHandler<K>[] {
        const handlers = this.handlers.get(type);
        if (!handlers) return [];

        return [...handlers].sort((a, b) => a.options.priority - b.options.priority);
    }

    private generateEventId(type: string): string {
        return `${type}-${++this.eventCounter}-${Date.now().toString(36)}`;
    }

    private addToHistory(event: PanelEvent): void {
        if (!this.options.enableTracing) return;

        this.eventHistory.push(event);
        while (this.eventHistory.length > this.options.historyLimit) {
            this.eventHistory.shift();
        }
    }

    private updateAvgHandlerTime(duration: number): void {
        const count = this._metrics.handlersInvoked;
        if (count === 0) {
            this._metrics.avgHandlerTimeMs = duration;
        } else {
            const total = this._metrics.avgHandlerTimeMs * (count - 1);
            this._metrics.avgHandlerTimeMs = (total + duration) / count;
        }
    }

    // ============= INSPECTION =============

    /**
     * Get event history (if tracing enabled)
     */
    getHistory(): readonly PanelEvent[] {
        return [...this.eventHistory];
    }

    /**
     * Get events by correlation ID
     */
    getHistoryByCorrelation(correlationId: string): PanelEvent[] {
        return this.eventHistory.filter(e => e.correlationId === correlationId);
    }

    /**
     * Get current metrics
     */
    get metrics(): Readonly<EventBusMetrics> {
        return { ...this._metrics };
    }

    /**
     * Check if event type has listeners
     */
    hasListeners(type: EventType): boolean {
        return (this.handlers.get(type)?.size ?? 0) > 0;
    }

    /**
     * Get listener count for event type
     */
    listenerCount(type: EventType): number {
        return this.handlers.get(type)?.size ?? 0;
    }

    /**
     * Clear event history
     */
    clearHistory(): void {
        this.eventHistory = [];
    }

    /**
     * Check if disposed
     */
    get isDisposed(): boolean {
        return this._isDisposed;
    }

    // ============= LIFECYCLE =============

    /**
     * Dispose the event bus and all subscriptions
     */
    dispose(): void {
        this._isDisposed = true;

        // Dispose all tracked disposables
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];

        // Clear all handlers
        this.handlers.clear();

        // Clear middleware
        this.middlewares = [];

        // Clear history
        this.eventHistory = [];
    }
}
