import { ICommandBus } from '../../core/interfaces/ICommandBus';
import { IEventBus } from '../../core/interfaces/IEventBus';
import { Command, CommandHandler, CommandMiddleware, CommandResult } from '../../core/types/CommandTypes';

/**
 * Command Bus Implementation
 *
 * Implements the command pattern with middleware support.
 * Routes commands to appropriate handlers and manages execution lifecycle.
 */
export class CommandBus implements ICommandBus {
    private handlers: Map<string, CommandHandler<Command>[]> = new Map();
    private middleware: CommandMiddleware[] = [];
    private commandHistory: Command[] = [];
    private maxHistorySize: number = 100;

    constructor(private eventBus: IEventBus) {}

    register(commandType: string, handler: CommandHandler<Command>): void {
        console.log(`[CommandBus] Registering handler for: ${commandType}`);

        if (!this.handlers.has(commandType)) {
            this.handlers.set(commandType, []);
        }

        this.handlers.get(commandType)!.push(handler);
    }

    async execute<T extends Command>(command: T): Promise<any> {
        const startTime = Date.now();
        console.log(`[CommandBus] Executing command: ${command.getCommandType()} (${command.commandId})`);

        // Add to history
        this.commandHistory.push(command);
        if (this.commandHistory.length > this.maxHistorySize) {
            this.commandHistory.shift();
        }

        try {
            // Execute middleware before
            for (const middleware of this.middleware) {
                if (middleware.before) {
                    await middleware.before(command);
                }
            }

            // Get handlers for this command type
            const handlers = this.handlers.get(command.getCommandType()) || [];

            if (handlers.length === 0) {
                throw new Error(`No handlers registered for command type: ${command.getCommandType()}`);
            }

            // Execute all handlers (typically just one, but allows for multiple)
            const results = [];
            for (const handler of handlers) {
                const result = await handler.handle(command);
                results.push(result);
            }

            const duration = Date.now() - startTime;
            const commandResult: CommandResult = {
                success: true,
                data: results.length === 1 ? results[0] : results,
                duration
            };

            // Execute middleware after
            for (const middleware of this.middleware) {
                if (middleware.after) {
                    await middleware.after(command, commandResult);
                }
            }

            console.log(`[CommandBus] Command completed successfully in ${duration}ms: ${command.getCommandType()}`);
            return commandResult;

        } catch (error) {
            const duration = Date.now() - startTime;
            const commandResult: CommandResult = {
                success: false,
                error: error as Error,
                duration
            };

            console.error(`[CommandBus] Command failed after ${duration}ms: ${command.getCommandType()}`, error);

            // Execute error middleware
            for (const middleware of this.middleware) {
                if (middleware.onError) {
                    await middleware.onError(command, error);
                }
            }

            throw error;
        }
    }

    addMiddleware(middleware: CommandMiddleware): void {
        console.log('[CommandBus] Adding middleware');
        this.middleware.push(middleware);
    }

    removeMiddleware(middleware: CommandMiddleware): void {
        const index = this.middleware.indexOf(middleware);
        if (index >= 0) {
            this.middleware.splice(index, 1);
            console.log('[CommandBus] Removed middleware');
        }
    }

    getHandlerCount(commandType: string): number {
        return this.handlers.get(commandType)?.length || 0;
    }

    getMiddlewareCount(): number {
        return this.middleware.length;
    }

    /**
     * Get command execution history
     */
    getCommandHistory(limit?: number): Command[] {
        if (limit) {
            return this.commandHistory.slice(-limit);
        }
        return [...this.commandHistory];
    }

    /**
     * Clear command history
     */
    clearHistory(): void {
        this.commandHistory = [];
    }

    /**
     * Get command bus statistics
     */
    getStats(): {
        registeredCommandTypes: string[];
        totalHandlers: number;
        middlewareCount: number;
        historySize: number;
        handlersByType: Record<string, number>;
    } {
        const handlersByType: Record<string, number> = {};
        let totalHandlers = 0;

        for (const [commandType, handlers] of this.handlers) {
            handlersByType[commandType] = handlers.length;
            totalHandlers += handlers.length;
        }

        return {
            registeredCommandTypes: Array.from(this.handlers.keys()),
            totalHandlers,
            middlewareCount: this.middleware.length,
            historySize: this.commandHistory.length,
            handlersByType
        };
    }

    /**
     * Clear all handlers and middleware (useful for testing)
     */
    clear(): void {
        this.handlers.clear();
        this.middleware = [];
        this.commandHistory = [];
    }
}