# Phase 1: PanelEventBus Implementation Guide

**Status:** READY TO IMPLEMENT
**Estimated Time:** 4-5 hours total (2 sessions)
**Prerequisites:** None (foundation phase)

---

## Session 1.1: Core Implementation

### Step 1: Create Directory Structure

```bash
mkdir -p src/core/events/middleware
mkdir -p src/core/events/testing
```

### Step 2: Create EventDefinitions.ts

**File:** `src/core/events/EventDefinitions.ts`

```typescript
/**
 * Event Definitions for PanelEventBus
 *
 * All events in the system are defined here with their payload types.
 * This provides compile-time type safety for event emission and handling.
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from '../../markdownParser';
import * as vscode from 'vscode';

// ============= EVENT PAYLOAD TYPES =============

export interface BoardLoadingPayload {
    path: string;
}

export interface BoardLoadedPayload {
    board: KanbanBoard;
    source: 'file' | 'cache' | 'external_reload';
    mainFilePath?: string;
}

export interface BoardUpdatedPayload {
    board: KanbanBoard;
    changeType: string;
    previousBoard?: KanbanBoard;
}

export interface BoardDirtyPayload {
    dirtyColumns: string[];
    dirtyTasks: string[];
}

export interface BoardErrorPayload {
    error: Error;
    operation: string;
    path?: string;
}

export interface FileLoadRequestedPayload {
    uri: vscode.Uri;
    forceReload?: boolean;
    preserveUnsaved?: boolean;
}

export interface FileSaveRequestedPayload {
    silent?: boolean;
    includeAll?: boolean;
    createBackup?: boolean;
}

export interface FileChangedPayload {
    path: string;
    changeType: 'external' | 'save' | 'delete';
}

export interface FileConflictPayload {
    path: string;
    localContent: string;
    externalContent: string;
}

export interface FileSavedPayload {
    path: string;
    silent?: boolean;
}

export interface FileSaveErrorPayload {
    error: Error;
    path?: string;
}

export interface FileReloadRequestedPayload {
    path: string;
}

export interface FileReloadedPayload {
    path: string;
}

export interface FileUnsavedOnClosePayload {
    mainFile?: string;
    unsavedIncludes: string[];
}

export interface IncludeLoadedPayload {
    path: string;
    type: 'column' | 'task' | 'regular';
    targetId: string;
    columnId?: string;
    content: string;
}

export interface IncludeSavedPayload {
    path: string;
}

export interface IncludeErrorPayload {
    path: string;
    error: Error;
}

export interface IncludeSwitchRequestedPayload {
    type: 'column' | 'task';
    targetId: string;
    columnId?: string;
    oldPath: string;
    newPath: string;
}

export interface IncludeSwitchedPayload {
    type: 'column' | 'task';
    targetId: string;
    oldPath: string;
    newPath: string;
}

export interface EditStartedPayload {
    targetType: 'task' | 'column';
    targetId: string;
    columnId?: string;
}

export interface EditCompletedPayload {
    targetType: 'task' | 'column';
    targetId: string;
    columnId?: string;
    value: string;
}

export interface EditCancelledPayload {
    targetType: 'task' | 'column';
    targetId: string;
}

export interface UndoRedoStateChangedPayload {
    canUndo: boolean;
    canRedo: boolean;
}

export interface UndoCompletedPayload {
    board: KanbanBoard;
}

export interface RedoCompletedPayload {
    board: KanbanBoard;
}

export interface WebviewMessagePayload {
    message: any;
}

export interface DebugEventSlowPayload {
    eventType: string;
    eventId: string;
    duration: number;
}

export interface DebugHandlerErrorPayload {
    eventType: string;
    eventId: string;
    error: Error;
    handlerName: string;
}

// ============= EVENT DEFINITIONS MAP =============

/**
 * Central registry of all event types and their payloads.
 * Add new events here to get type safety everywhere.
 */
export interface EventDefinitions {
    // Board lifecycle
    'board:loading': BoardLoadingPayload;
    'board:loaded': BoardLoadedPayload;
    'board:updated': BoardUpdatedPayload;
    'board:dirty': BoardDirtyPayload;
    'board:clean': undefined;
    'board:error': BoardErrorPayload;
    'board:load_cancelled': { reason: string };

    // File operations
    'file:load_requested': FileLoadRequestedPayload;
    'file:save_requested': FileSaveRequestedPayload;
    'file:reload_requested': FileReloadRequestedPayload;
    'file:saved': FileSavedPayload;
    'file:save_error': FileSaveErrorPayload;
    'file:changed': FileChangedPayload;
    'file:conflict': FileConflictPayload;
    'file:reloaded': FileReloadedPayload;
    'file:unsaved_on_close': FileUnsavedOnClosePayload;

    // Include files
    'include:loaded': IncludeLoadedPayload;
    'include:saved': IncludeSavedPayload;
    'include:error': IncludeErrorPayload;
    'include:switch_requested': IncludeSwitchRequestedPayload;
    'include:switched': IncludeSwitchedPayload;

    // Edit session
    'edit:started': EditStartedPayload;
    'edit:completed': EditCompletedPayload;
    'edit:cancelled': EditCancelledPayload;

    // Undo/Redo
    'undo:requested': undefined;
    'redo:requested': undefined;
    'undo:completed': UndoCompletedPayload;
    'redo:completed': RedoCompletedPayload;
    'undoredo:state_changed': UndoRedoStateChangedPayload;

    // Webview
    'webview:ready': undefined;
    'webview:message': WebviewMessagePayload;

    // Panel lifecycle
    'panel:initialized': undefined;
    'panel:visible': undefined;
    'panel:disposing': undefined;

    // Debug/Monitoring (internal use)
    'debug:event_slow': DebugEventSlowPayload;
    'debug:handler_error': DebugHandlerErrorPayload;
}

// ============= TYPE HELPERS =============

/**
 * Get the payload type for a specific event
 */
export type EventPayload<K extends keyof EventDefinitions> = EventDefinitions[K];

/**
 * All valid event type names
 */
export type EventType = keyof EventDefinitions;
```

### Step 3: Create PanelEventBus.ts

**File:** `src/core/events/PanelEventBus.ts`

```typescript
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
 */

import * as vscode from 'vscode';
import { EventDefinitions, EventType, EventPayload } from './EventDefinitions';

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
    /** Use WeakRef for automatic cleanup */
    weak?: boolean;
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
    handler: Handler<K> | WeakRef<Handler<K>>;
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
            errorStrategy: options.errorStrategy ?? 'log',
            weak: options.weak ?? false
        };

        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }

        const registered: RegisteredHandler<K> = {
            handler: fullOptions.weak ? new WeakRef(handler) : handler,
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

    /**
     * Subscribe with WeakRef (auto-cleanup when handler is garbage collected)
     */
    onWeak<K extends EventType>(
        type: K,
        handler: Handler<K>,
        options: Omit<HandlerOptions, 'weak'> = {}
    ): vscode.Disposable {
        return this.on(type, handler, { ...options, weak: true });
    }

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
            // Resolve handler (may be WeakRef)
            let handler: Handler<K> | undefined;

            if (registered.handler instanceof WeakRef) {
                handler = registered.handler.deref();
                if (!handler) {
                    // Handler was garbage collected
                    toRemove.push(registered);
                    continue;
                }
            } else {
                handler = registered.handler;
            }

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
        const total = this._metrics.avgHandlerTimeMs * (count - 1);
        this._metrics.avgHandlerTimeMs = (total + duration) / count;
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
```

### Step 4: Create Middleware

**File:** `src/core/events/middleware/loggingMiddleware.ts`

```typescript
/**
 * Logging Middleware for PanelEventBus
 */

import { Middleware, MiddlewareContext } from '../PanelEventBus';

export interface LoggingOptions {
    /** Custom logger function (default: console.log) */
    logger?: (message: string) => void;
    /** Include payload in logs (default: false) */
    includePayload?: boolean;
    /** Event types to exclude from logging */
    excludeTypes?: string[];
}

/**
 * Create logging middleware
 */
export function createLoggingMiddleware(options: LoggingOptions = {}): Middleware {
    const logger = options.logger ?? console.log;
    const includePayload = options.includePayload ?? false;
    const excludeTypes = new Set(options.excludeTypes ?? []);

    return async (context: MiddlewareContext, next: () => Promise<void>) => {
        const { event, handlerCount } = context;

        // Skip excluded types
        if (excludeTypes.has(event.type)) {
            await next();
            return;
        }

        const prefix = event.correlationId
            ? `[${event.correlationId.slice(0, 8)}]`
            : '';

        const payloadStr = includePayload
            ? ` ${JSON.stringify(event.payload)}`
            : '';

        logger(`[EventBus]${prefix} → ${event.type} (${handlerCount} handlers)${payloadStr}`);

        const start = Date.now();

        try {
            await next();
            const duration = Date.now() - start;
            logger(`[EventBus]${prefix} ← ${event.type} (${duration}ms)`);
        } catch (error) {
            const duration = Date.now() - start;
            logger(`[EventBus]${prefix} ✗ ${event.type} FAILED (${duration}ms): ${error}`);
            throw error;
        }
    };
}
```

**File:** `src/core/events/middleware/performanceMiddleware.ts`

```typescript
/**
 * Performance Monitoring Middleware for PanelEventBus
 */

import { Middleware, MiddlewareContext, PanelEvent } from '../PanelEventBus';

export interface PerformanceOptions {
    /** Threshold in ms to consider an event "slow" (default: 100) */
    slowThreshold?: number;
    /** Callback when slow event detected */
    onSlowEvent?: (event: PanelEvent, duration: number) => void;
    /** Callback for all events with timing */
    onEvent?: (event: PanelEvent, duration: number) => void;
}

/**
 * Create performance monitoring middleware
 */
export function createPerformanceMiddleware(options: PerformanceOptions = {}): Middleware {
    const slowThreshold = options.slowThreshold ?? 100;

    return async (context: MiddlewareContext, next: () => Promise<void>) => {
        const start = Date.now();

        await next();

        const duration = Date.now() - start;

        options.onEvent?.(context.event, duration);

        if (duration > slowThreshold) {
            options.onSlowEvent?.(context.event, duration);
        }
    };
}
```

**File:** `src/core/events/middleware/index.ts`

```typescript
export { createLoggingMiddleware, LoggingOptions } from './loggingMiddleware';
export { createPerformanceMiddleware, PerformanceOptions } from './performanceMiddleware';
```

### Step 5: Create MockEventBus for Testing

**File:** `src/core/events/testing/MockEventBus.ts`

```typescript
/**
 * Mock EventBus for Testing
 */

import { PanelEventBus, PanelEvent, HandlerOptions } from '../PanelEventBus';
import { EventDefinitions, EventType, EventPayload } from '../EventDefinitions';

export interface EmittedEvent {
    type: EventType;
    payload: any;
    timestamp: number;
    correlationId?: string;
}

/**
 * Mock EventBus that records all emitted events for assertions
 */
export class MockEventBus extends PanelEventBus {
    private _emittedEvents: EmittedEvent[] = [];
    private _waitingFor = new Map<string, {
        resolve: (event: PanelEvent) => void;
        timeout: NodeJS.Timeout;
    }>();

    constructor() {
        super({ enableTracing: true });
    }

    /**
     * Override emit to record events
     */
    async emit<K extends EventType>(
        type: K,
        payload: EventPayload<K>,
        options?: { source?: string; correlationId?: string }
    ): Promise<void> {
        this._emittedEvents.push({
            type,
            payload,
            timestamp: Date.now(),
            correlationId: options?.correlationId
        });

        // Check if someone is waiting for this event
        const waiting = this._waitingFor.get(type);
        if (waiting) {
            clearTimeout(waiting.timeout);
            this._waitingFor.delete(type);
            waiting.resolve({
                type,
                payload,
                timestamp: Date.now(),
                id: `mock-${Date.now()}`
            } as PanelEvent<K>);
        }

        // Still execute handlers
        await super.emit(type, payload, options);
    }

    // ============= ASSERTIONS =============

    /**
     * Assert that an event was emitted
     */
    expectEmitted<K extends EventType>(
        type: K,
        payloadMatcher?: (payload: EventPayload<K>) => boolean
    ): EmittedEvent {
        const found = this._emittedEvents.find(e =>
            e.type === type &&
            (!payloadMatcher || payloadMatcher(e.payload))
        );

        if (!found) {
            const emittedTypes = this._emittedEvents.map(e => e.type).join(', ');
            throw new Error(
                `Expected event "${type}" was not emitted. ` +
                `Emitted events: [${emittedTypes}]`
            );
        }

        return found;
    }

    /**
     * Assert that an event was NOT emitted
     */
    expectNotEmitted<K extends EventType>(type: K): void {
        const found = this._emittedEvents.find(e => e.type === type);

        if (found) {
            throw new Error(`Expected event "${type}" to NOT be emitted, but it was`);
        }
    }

    /**
     * Assert event count
     */
    expectEmitCount(type: EventType, count: number): void {
        const actual = this._emittedEvents.filter(e => e.type === type).length;

        if (actual !== count) {
            throw new Error(
                `Expected ${count} "${type}" events, but got ${actual}`
            );
        }
    }

    /**
     * Get all emitted events of a type
     */
    getEmitted<K extends EventType>(type: K): EmittedEvent[] {
        return this._emittedEvents.filter(e => e.type === type);
    }

    /**
     * Get all emitted events
     */
    getAllEmitted(): EmittedEvent[] {
        return [...this._emittedEvents];
    }

    /**
     * Get last emitted event
     */
    getLastEmitted(): EmittedEvent | undefined {
        return this._emittedEvents[this._emittedEvents.length - 1];
    }

    // ============= WAITING =============

    /**
     * Wait for an event to be emitted
     */
    waitFor<K extends EventType>(
        type: K,
        timeoutMs = 1000
    ): Promise<PanelEvent<K>> {
        return new Promise((resolve, reject) => {
            // Check if already emitted
            const existing = this._emittedEvents.find(e => e.type === type);
            if (existing) {
                resolve({
                    type: existing.type as K,
                    payload: existing.payload,
                    timestamp: existing.timestamp,
                    id: `mock-${existing.timestamp}`
                } as PanelEvent<K>);
                return;
            }

            const timeout = setTimeout(() => {
                this._waitingFor.delete(type);
                reject(new Error(`Timeout waiting for event "${type}"`));
            }, timeoutMs);

            this._waitingFor.set(type, {
                resolve: resolve as any,
                timeout
            });
        });
    }

    // ============= RESET =============

    /**
     * Clear all recorded events
     */
    reset(): void {
        this._emittedEvents = [];

        // Cancel any pending waits
        for (const [, waiting] of this._waitingFor) {
            clearTimeout(waiting.timeout);
        }
        this._waitingFor.clear();
    }
}

/**
 * Create a fresh mock for testing
 */
export function createMockEventBus(): MockEventBus {
    return new MockEventBus();
}
```

**File:** `src/core/events/testing/index.ts`

```typescript
export { MockEventBus, createMockEventBus, EmittedEvent } from './MockEventBus';
```

### Step 6: Create Barrel Export

**File:** `src/core/events/index.ts`

```typescript
// Main exports
export { PanelEventBus, PanelEvent, HandlerPriority, HandlerOptions, EventBusOptions, Middleware, MiddlewareContext, EventBusMetrics } from './PanelEventBus';
export { EventDefinitions, EventType, EventPayload } from './EventDefinitions';

// Middleware
export * from './middleware';

// Testing utilities
export * from './testing';
```

### Step 7: Add to package.json dependencies

```bash
npm install immer
```

---

## Session 1.2: Integration with KanbanWebviewPanel

### Step 1: Import EventBus

In `src/kanbanWebviewPanel.ts`:

```typescript
import { PanelEventBus, createLoggingMiddleware, HandlerPriority } from './core/events';
```

### Step 2: Add EventBus Property

```typescript
export class KanbanWebviewPanel {
    // ... existing properties ...

    // NEW: Event bus for component communication
    private _eventBus: PanelEventBus;
```

### Step 3: Initialize in Constructor

```typescript
constructor(...) {
    // ... existing initialization ...

    // Initialize event bus
    this._eventBus = new PanelEventBus({
        enableTracing: true, // Enable during development
        defaultTimeout: 5000
    });

    // Add logging middleware in development
    const isDevelopment = !this._context.extensionMode ||
        this._context.extensionMode === vscode.ExtensionMode.Development;

    if (isDevelopment) {
        this._eventBus.use(createLoggingMiddleware({
            excludeTypes: ['debug:event_slow', 'debug:handler_error']
        }));
    }

    // ... rest of constructor ...
}
```

### Step 4: Add Event Emissions (Parallel to Existing Code)

Add event emissions at key points WITHOUT changing existing behavior:

```typescript
// In loadMarkdownFile()
async loadMarkdownFile(document: vscode.TextDocument, isFromEditorFocus: boolean = false) {
    // NEW: Emit loading event
    this._eventBus.emit('board:loading', { path: document.uri.fsPath });

    // ... existing code ...

    // NEW: Emit loaded event (add near the end, after board is ready)
    if (board && board.valid) {
        this._eventBus.emit('board:loaded', {
            board,
            source: 'file',
            mainFilePath: document.uri.fsPath
        });
    }
}

// In saveToMarkdown()
async saveToMarkdown(silent: boolean = false, isFromUnload: boolean = false) {
    // ... existing code ...

    // NEW: Emit saved event (after successful save)
    this._eventBus.emit('file:saved', {
        path: this._lastDocumentUri!,
        silent
    });
}
```

### Step 5: Dispose EventBus

```typescript
public dispose() {
    // NEW: Emit disposing event
    this._eventBus.emit('panel:disposing', undefined);

    // ... existing dispose code ...

    // NEW: Dispose event bus (add near end)
    this._eventBus.dispose();
}
```

### Step 6: Expose EventBus for Future Components

```typescript
/**
 * Get event bus for component communication
 * @internal Used by child components
 */
public get eventBus(): PanelEventBus {
    return this._eventBus;
}
```

---

## Verification Checklist

After completing both sessions:

- [ ] `src/core/events/` directory structure created
- [ ] All TypeScript files compile without errors
- [ ] EventBus instantiates in KanbanWebviewPanel
- [ ] Events emit at key lifecycle points
- [ ] Logging middleware shows event flow in development
- [ ] No regression in existing functionality
- [ ] Basic unit test passes:

```typescript
// Quick verification test
import { createMockEventBus } from './core/events';

const bus = createMockEventBus();

bus.on('board:loaded', (e) => {
    console.log('Board loaded:', e.payload.source);
});

await bus.emit('board:loaded', {
    board: { valid: true, title: 'Test', columns: [], yamlHeader: null, kanbanFooter: null },
    source: 'file'
});

bus.expectEmitted('board:loaded');
console.log('Test passed!');
```

---

## Next Steps

After Phase 1 is complete:
1. Create git commit: `feat: add PanelEventBus foundation for event-driven architecture`
2. Update progress in `ARCHITECTURE-REFACTORING-PLAN.md`
3. Proceed to Phase 2: BoardStore
