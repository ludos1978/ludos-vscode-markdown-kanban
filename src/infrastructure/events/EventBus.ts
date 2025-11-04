import { IEventBus, EventHandler, Subscription } from '../../core/interfaces/IEventBus';
import { DomainEvent } from '../../core/events/DomainEvents';

/**
 * Event Bus Implementation
 *
 * Provides publish-subscribe pattern for domain events.
 * Enables loose coupling between components.
 */
export class EventBus implements IEventBus {
    private subscribers: Map<string, EventSubscription[]> = new Map();
    private eventHistory: DomainEvent<any>[] = [];
    private maxHistorySize: number = 1000;

    publish<T extends DomainEvent<any>>(event: T): Promise<void> {
        console.log(`[EventBus] Publishing event: ${event.eventType} (${event.eventId})`);

        // Store in history
        this.eventHistory.push(event);
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift(); // Remove oldest
        }

        // Get subscribers for this event type
        const subscribers = this.subscribers.get(event.eventType) || [];

        if (subscribers.length === 0) {
            console.log(`[EventBus] No subscribers for event: ${event.eventType}`);
            return Promise.resolve();
        }

        console.log(`[EventBus] Notifying ${subscribers.length} subscribers for: ${event.eventType}`);

        // Notify all subscribers asynchronously
        const notifications = subscribers.map(subscription =>
            this.notifySubscriber(subscription, event)
        );

        return Promise.allSettled(notifications).then(() => undefined);
    }

    subscribe<T extends DomainEvent<any>>(
        eventType: string,
        handler: EventHandler<T>
    ): Subscription {
        console.log(`[EventBus] Adding subscription for: ${eventType}`);

        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, []);
        }

        const subscription = new EventSubscription(handler);
        this.subscribers.get(eventType)!.push(subscription);

        return subscription;
    }

    unsubscribe<T extends DomainEvent<any>>(
        eventType: string,
        handler: EventHandler<T>
    ): void {
        console.log(`[EventBus] Removing subscription for: ${eventType}`);

        const subscribers = this.subscribers.get(eventType);
        if (!subscribers) {
            return;
        }

        const index = subscribers.findIndex(sub => sub.handler === handler);
        if (index >= 0) {
            subscribers.splice(index, 1);
            console.log(`[EventBus] Subscription removed for: ${eventType}`);
        }
    }

    getSubscriberCount(eventType: string): number {
        return this.subscribers.get(eventType)?.length || 0;
    }

    clear(): void {
        console.log('[EventBus] Clearing all subscriptions');
        this.subscribers.clear();
        this.eventHistory = [];
    }

    /**
     * Get event history for debugging
     */
    getEventHistory(limit?: number): DomainEvent<any>[] {
        if (limit) {
            return this.eventHistory.slice(-limit);
        }
        return [...this.eventHistory];
    }

    /**
     * Get subscriber statistics
     */
    getStats(): {
        totalSubscribers: number;
        eventTypes: string[];
        historySize: number;
        subscribersByType: Record<string, number>;
    } {
        const subscribersByType: Record<string, number> = {};
        let totalSubscribers = 0;

        for (const [eventType, subscribers] of this.subscribers) {
            subscribersByType[eventType] = subscribers.length;
            totalSubscribers += subscribers.length;
        }

        return {
            totalSubscribers,
            eventTypes: Array.from(this.subscribers.keys()),
            historySize: this.eventHistory.length,
            subscribersByType
        };
    }

    /**
     * Replay events for testing or recovery
     */
    async replayEvents(events: DomainEvent<any>[]): Promise<void> {
        console.log(`[EventBus] Replaying ${events.length} events`);

        for (const event of events) {
            await this.publish(event);
        }
    }

    private async notifySubscriber<T extends DomainEvent<any>>(
        subscription: EventSubscription,
        event: T
    ): Promise<void> {
        if (!subscription.isActive()) {
            return;
        }

        try {
            await subscription.handler(event);
        } catch (error) {
            console.error(`[EventBus] Error in event handler for ${event.eventType}:`, error);
            // Continue with other subscribers even if one fails
        }
    }
}

/**
 * Event Subscription Implementation
 */
class EventSubscription implements Subscription {
    private active: boolean = true;

    constructor(public handler: EventHandler<any>) {}

    unsubscribe(): void {
        this.active = false;
    }

    isActive(): boolean {
        return this.active;
    }
}