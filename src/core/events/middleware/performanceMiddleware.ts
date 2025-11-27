/**
 * Performance Monitoring Middleware for PanelEventBus
 *
 * Tracks event execution times and alerts on slow events.
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
