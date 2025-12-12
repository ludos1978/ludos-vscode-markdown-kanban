/**
 * Command Registry
 *
 * Central registry for managing message command handlers.
 * Handles registration, discovery, and message routing.
 *
 * Based on PluginRegistry pattern.
 *
 * @module commands/CommandRegistry
 */

import { MessageCommand, CommandContext, CommandResult } from './interfaces/MessageCommand';

/**
 * Validation result for command registration
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Command execution statistics
 */
export interface CommandStats {
    messageType: string;
    commandId: string;
    executionCount: number;
    totalDurationMs: number;
    avgDurationMs: number;
    lastExecuted: Date | null;
    errorCount: number;
}

/**
 * Command Registry
 *
 * Per-instance registry for message commands.
 * Each MessageHandler gets its own CommandRegistry instance
 * to properly isolate context between panels.
 *
 * NOT a singleton - each panel needs its own registry with its own context.
 */
export class CommandRegistry {
    private _commands: Map<string, MessageCommand> = new Map();
    private _messageTypeToCommand: Map<string, MessageCommand> = new Map();
    private _context?: CommandContext;
    private _initialized: boolean = false;
    private _stats: Map<string, CommandStats> = new Map();

    constructor() {
        // Per-instance - each MessageHandler gets its own registry
    }

    /**
     * Reset the instance (for testing)
     */
    reset(): void {
        this._commands.clear();
        this._messageTypeToCommand.clear();
        this._stats.clear();
        this._initialized = false;
        this._context = undefined;
    }

    // ============= INITIALIZATION =============

    /**
     * Initialize the registry with context
     * @param context - Command execution context
     */
    async initialize(context: CommandContext): Promise<void> {
        this._context = context;
        this._initialized = true;

        // Initialize all registered commands
        for (const command of this._commands.values()) {
            if (command.initialize) {
                try {
                    await command.initialize(context);
                } catch (error) {
                    console.error(`[CommandRegistry] Failed to initialize command ${command.metadata.id}:`, error);
                }
            }
        }
    }

    /**
     * Check if registry is initialized
     */
    isInitialized(): boolean {
        return this._initialized;
    }

    /**
     * Get the context
     */
    getContext(): CommandContext | undefined {
        return this._context;
    }

    // ============= COMMAND REGISTRATION =============

    /**
     * Register a command
     * @param command - Command to register
     * @throws Error if command is invalid
     */
    register(command: MessageCommand): void {
        const validation = this._validateCommand(command);

        if (!validation.valid) {
            throw new Error(`Invalid command '${command.metadata.id}': ${validation.errors.join(', ')}`);
        }

        if (validation.warnings.length > 0) {
            console.warn(`[CommandRegistry] Command '${command.metadata.id}' warnings:`, validation.warnings);
        }

        // Check for existing command with same ID
        if (this._commands.has(command.metadata.id)) {
            console.warn(`[CommandRegistry] Replacing existing command: ${command.metadata.id}`);
            this.unregister(command.metadata.id);
        }

        // Register command
        this._commands.set(command.metadata.id, command);

        // Map message types to command
        for (const messageType of command.metadata.messageTypes) {
            if (this._messageTypeToCommand.has(messageType)) {
                const existing = this._messageTypeToCommand.get(messageType)!;
                console.warn(`[CommandRegistry] Message type '${messageType}' already handled by '${existing.metadata.id}', replacing with '${command.metadata.id}'`);
            }
            this._messageTypeToCommand.set(messageType, command);

            // Initialize stats for this message type
            if (!this._stats.has(messageType)) {
                this._stats.set(messageType, {
                    messageType,
                    commandId: command.metadata.id,
                    executionCount: 0,
                    totalDurationMs: 0,
                    avgDurationMs: 0,
                    lastExecuted: null,
                    errorCount: 0
                });
            }
        }

        // Initialize if registry is already initialized
        if (this._initialized && this._context && command.initialize) {
            command.initialize(this._context).catch(error => {
                console.error(`[CommandRegistry] Failed to initialize command ${command.metadata.id}:`, error);
            });
        }
    }

    /**
     * Unregister a command
     * @param commandId - ID of command to unregister
     * @returns true if command was unregistered
     */
    unregister(commandId: string): boolean {
        const command = this._commands.get(commandId);
        if (!command) {
            return false;
        }

        // Dispose command
        if (command.dispose) {
            command.dispose().catch(err =>
                console.error(`[CommandRegistry] Error disposing command ${commandId}:`, err)
            );
        }

        // Remove message type mappings
        for (const messageType of command.metadata.messageTypes) {
            const mapped = this._messageTypeToCommand.get(messageType);
            if (mapped?.metadata.id === commandId) {
                this._messageTypeToCommand.delete(messageType);
            }
        }

        this._commands.delete(commandId);
        return true;
    }

    /**
     * Get a command by ID
     */
    getCommand(commandId: string): MessageCommand | undefined {
        return this._commands.get(commandId);
    }

    /**
     * Get all registered commands
     */
    getAllCommands(): MessageCommand[] {
        return Array.from(this._commands.values());
    }

    /**
     * Get commands sorted by priority (highest first)
     */
    getCommandsByPriority(): MessageCommand[] {
        return this.getAllCommands().sort((a, b) => b.metadata.priority - a.metadata.priority);
    }

    // ============= MESSAGE HANDLING =============

    /**
     * Check if a message type can be handled
     * @param messageType - Message type to check
     */
    canHandle(messageType: string): boolean {
        return this._messageTypeToCommand.has(messageType);
    }

    /**
     * Find the command that handles a message type
     * @param messageType - Message type to find handler for
     */
    findCommand(messageType: string): MessageCommand | undefined {
        return this._messageTypeToCommand.get(messageType);
    }

    /**
     * Execute a command for a message
     * @param message - Message from webview
     * @returns Command result or null if no handler found
     */
    async execute(message: any): Promise<CommandResult | null> {
        if (!this._initialized || !this._context) {
            console.error('[CommandRegistry] Not initialized, cannot execute command');
            return { success: false, error: 'CommandRegistry not initialized' };
        }

        const messageType = message.type;
        if (!messageType) {
            console.error('[CommandRegistry] Message has no type property');
            return { success: false, error: 'Message has no type property' };
        }

        const command = this.findCommand(messageType);
        if (!command) {
            // No command registered for this message type
            return null;
        }

        // Track execution
        const startTime = Date.now();
        let result: CommandResult;

        try {
            result = await command.execute(message, this._context);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[CommandRegistry] Command ${command.metadata.id} failed for message ${messageType}:`, error);
            result = { success: false, error: errorMessage };
        }

        // Update stats
        const duration = Date.now() - startTime;
        this._updateStats(messageType, command.metadata.id, duration, !result.success);

        return result;
    }

    // ============= STATISTICS =============

    /**
     * Get execution statistics
     */
    getStats(): CommandStats[] {
        return Array.from(this._stats.values());
    }

    /**
     * Get stats for a specific message type
     */
    getStatsForMessageType(messageType: string): CommandStats | undefined {
        return this._stats.get(messageType);
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        for (const stats of this._stats.values()) {
            stats.executionCount = 0;
            stats.totalDurationMs = 0;
            stats.avgDurationMs = 0;
            stats.lastExecuted = null;
            stats.errorCount = 0;
        }
    }

    private _updateStats(messageType: string, commandId: string, durationMs: number, isError: boolean): void {
        let stats = this._stats.get(messageType);
        if (!stats) {
            stats = {
                messageType,
                commandId,
                executionCount: 0,
                totalDurationMs: 0,
                avgDurationMs: 0,
                lastExecuted: null,
                errorCount: 0
            };
            this._stats.set(messageType, stats);
        }

        stats.executionCount++;
        stats.totalDurationMs += durationMs;
        stats.avgDurationMs = stats.totalDurationMs / stats.executionCount;
        stats.lastExecuted = new Date();
        if (isError) {
            stats.errorCount++;
        }
    }

    // ============= VALIDATION =============

    /**
     * Validate a command before registration
     */
    private _validateCommand(command: MessageCommand): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Required metadata
        if (!command.metadata) {
            errors.push('Missing metadata');
            return { valid: false, errors, warnings };
        }

        if (!command.metadata.id || command.metadata.id.trim() === '') {
            errors.push('Missing or empty command ID');
        }

        if (!command.metadata.messageTypes || command.metadata.messageTypes.length === 0) {
            errors.push('Missing or empty messageTypes array');
        }

        if (typeof command.metadata.priority !== 'number') {
            errors.push('Missing or invalid priority (must be a number)');
        }

        // Required methods
        if (typeof command.canHandle !== 'function') {
            errors.push('Missing canHandle method');
        }

        if (typeof command.execute !== 'function') {
            errors.push('Missing execute method');
        }

        // Check for message type conflicts
        if (command.metadata.messageTypes) {
            for (const messageType of command.metadata.messageTypes) {
                const existing = this._messageTypeToCommand.get(messageType);
                if (existing && existing.metadata.id !== command.metadata.id) {
                    warnings.push(`Message type '${messageType}' already handled by '${existing.metadata.id}'`);
                }
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    // ============= DEBUG =============

    /**
     * Get debug info about registered commands
     */
    getDebugInfo(): { commands: any[]; messageTypes: any[] } {
        return {
            commands: this.getAllCommands().map(c => ({
                id: c.metadata.id,
                name: c.metadata.name,
                priority: c.metadata.priority,
                messageTypes: c.metadata.messageTypes
            })),
            messageTypes: Array.from(this._messageTypeToCommand.entries()).map(([type, cmd]) => ({
                messageType: type,
                commandId: cmd.metadata.id
            }))
        };
    }

    /**
     * Get list of all registered message types
     */
    getRegisteredMessageTypes(): string[] {
        return Array.from(this._messageTypeToCommand.keys());
    }

    /**
     * Get list of unhandled message types (for migration tracking)
     * @param allMessageTypes - Complete list of message types from original messageHandler
     */
    getUnhandledMessageTypes(allMessageTypes: string[]): string[] {
        return allMessageTypes.filter(type => !this._messageTypeToCommand.has(type));
    }
}
