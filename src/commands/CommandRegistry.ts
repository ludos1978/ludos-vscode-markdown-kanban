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
import { IncomingMessage } from '../core/bridge/MessageTypes';
import { ValidationResult } from '../shared/interfaces';
import { getErrorMessage } from '../utils/stringUtils';

// Re-export for external access
export { ValidationResult };

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
    private _messageTypeToCommands: Map<string, MessageCommand[]> = new Map();
    private _context?: CommandContext;
    private _initialized: boolean = false;

    constructor() {
        // Per-instance - each MessageHandler gets its own registry
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
            const existingHandlers = this._messageTypeToCommands.get(messageType) || [];
            if (existingHandlers.length > 0) {
                const existingIds = existingHandlers.map(existing => existing.metadata.id).join(', ');
                console.warn(`[CommandRegistry] Message type '${messageType}' already handled by '${existingIds}', adding '${command.metadata.id}'`);
            }

            const inserted = this._insertByPriority(existingHandlers, command);
            this._messageTypeToCommands.set(messageType, inserted);
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
            const handlers = this._messageTypeToCommands.get(messageType);
            if (!handlers) {
                continue;
            }
            const filtered = handlers.filter(handler => handler.metadata.id !== commandId);
            if (filtered.length === 0) {
                this._messageTypeToCommands.delete(messageType);
            } else {
                this._messageTypeToCommands.set(messageType, filtered);
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

    // ============= MESSAGE HANDLING =============

    /**
     * Check if a message type can be handled
     * @param messageType - Message type to check
     */
    canHandle(messageType: string): boolean {
        const handlers = this._messageTypeToCommands.get(messageType);
        return !!handlers && handlers.length > 0;
    }

    /**
     * Find the command that handles a message type
     * @param messageType - Message type to find handler for
     */
    findCommand(messageType: string): MessageCommand | undefined {
        const handlers = this._messageTypeToCommands.get(messageType);
        return handlers?.[0];
    }

    /**
     * Execute a command for a message
     * @param message - Message from webview
     * @returns Command result or null if no handler found
     */
    async execute(message: IncomingMessage): Promise<CommandResult | null> {
        if (!this._initialized || !this._context) {
            console.error('[CommandRegistry] Not initialized, cannot execute command');
            return { success: false, error: 'CommandRegistry not initialized' };
        }

        const messageType = message.type;
        if (!messageType) {
            console.error('[CommandRegistry] Message has no type property');
            return { success: false, error: 'Message has no type property' };
        }

        const commands = this._messageTypeToCommands.get(messageType);
        if (!commands || commands.length === 0) {
            return null;
        }

        for (const command of commands) {
            if (!command.canHandle(messageType)) {
                continue;
            }
            try {
                return await command.execute(message, this._context);
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                console.error(`[CommandRegistry] Command ${command.metadata.id} failed for message ${messageType}:`, error);
                return { success: false, error: errorMessage };
            }
        }

        return { success: false, error: `No handler accepted message type ${messageType}` };
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
                const existing = this._messageTypeToCommands.get(messageType);
                if (existing && existing.some(handler => handler.metadata.id !== command.metadata.id)) {
                    const existingIds = existing.map(handler => handler.metadata.id).join(', ');
                    warnings.push(`Message type '${messageType}' already handled by '${existingIds}'`);
                }
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    private _insertByPriority(commands: MessageCommand[], command: MessageCommand): MessageCommand[] {
        const inserted = [...commands];
        const newPriority = command.metadata.priority;
        const index = inserted.findIndex(existing => existing.metadata.priority < newPriority);
        if (index === -1) {
            inserted.push(command);
            return inserted;
        }
        inserted.splice(index, 0, command);
        return inserted;
    }
}
