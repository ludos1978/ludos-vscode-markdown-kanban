import { DomainEvent } from '../events/DomainEvents';

/**
 * Event Bus Interface
 *
 * Defines the contract for publishing and subscribing to domain events.
 * Enables loose coupling between components through event-driven communication.
 */
export interface IEventBus {
    /**
     * Publish a domain event to all subscribers
     * @param event The domain event to publish
     * @returns Promise that resolves when all subscribers have been notified
     */
    publish<T extends DomainEvent<any>>(event: T): Promise<void>;

    /**
     * Subscribe to events of a specific type
     * @param eventType The type of event to subscribe to
     * @param handler The handler function for the event
     * @returns Subscription object with unsubscribe method
     */
    subscribe<T extends DomainEvent<any>>(
        eventType: string,
        handler: EventHandler<T>
    ): Subscription;

    /**
     * Unsubscribe from events
     * @param eventType The type of event to unsubscribe from
     * @param handler The handler function to remove
     */
    unsubscribe<T extends DomainEvent<any>>(
        eventType: string,
        handler: EventHandler<T>
    ): void;

    /**
     * Get the number of subscribers for a specific event type
     * @param eventType The event type to check
     * @returns Number of subscribers
     */
    getSubscriberCount(eventType: string): number;

    /**
     * Clear all subscribers (useful for testing)
     */
    clear(): void;
}

/**
 * Event handler function type
 */
export type EventHandler<T extends DomainEvent<any>> = (event: T) => void | Promise<void>;

/**
 * Subscription interface
 */
export interface Subscription {
    /**
     * Unsubscribe from the event
     */
    unsubscribe(): void;

    /**
     * Check if the subscription is still active
     */
    isActive(): boolean;
}