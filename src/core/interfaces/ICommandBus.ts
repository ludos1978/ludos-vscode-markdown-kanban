import { Command, CommandHandler, CommandMiddleware, CommandResult } from '../types/CommandTypes';

/**
 * Command Bus Interface
 *
 * Defines the contract for command bus implementations.
 * Provides command routing, execution, and middleware support.
 */
export interface ICommandBus {
    /**
     * Register a command handler for a specific command type
     */
    register(commandType: string, handler: CommandHandler<Command>): void;

    /**
     * Execute a command and return the result
     */
    execute<T extends Command>(command: T): Promise<CommandResult>;

    /**
     * Add middleware to the command execution pipeline
     */
    addMiddleware(middleware: CommandMiddleware): void;

    /**
     * Remove middleware from the command execution pipeline
     */
    removeMiddleware(middleware: CommandMiddleware): void;

    /**
     * Get the number of handlers registered for a command type
     */
    getHandlerCount(commandType: string): number;

    /**
     * Get the number of middleware registered
     */
    getMiddlewareCount(): number;

    /**
     * Get command execution history
     */
    getCommandHistory(limit?: number): Command[];

    /**
     * Clear command history
     */
    clearHistory(): void;

    /**
     * Get command bus statistics
     */
    getStats(): {
        registeredCommandTypes: string[];
        totalHandlers: number;
        middlewareCount: number;
        historySize: number;
        handlersByType: Record<string, number>;
    };

    /**
     * Clear all handlers and middleware (useful for testing)
     */
    clear(): void;
}
