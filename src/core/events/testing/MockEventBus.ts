/**
 * Mock EventBus for Testing
 *
 * Provides a test double for PanelEventBus with event recording,
 * assertions, and wait capabilities.
 */

import { PanelEventBus, PanelEvent } from '../PanelEventBus';
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
        this._waitingFor.forEach((waiting) => {
            clearTimeout(waiting.timeout);
        });
        this._waitingFor.clear();
    }
}

/**
 * Create a fresh mock for testing
 */
export function createMockEventBus(): MockEventBus {
    return new MockEventBus();
}
