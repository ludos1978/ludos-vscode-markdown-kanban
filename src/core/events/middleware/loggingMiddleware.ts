/**
 * Logging Middleware for PanelEventBus
 *
 * Provides structured logging for all events passing through the bus.
 * Useful for development and debugging.
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
