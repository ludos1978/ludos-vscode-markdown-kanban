/**
 * Command Types and Interfaces
 *
 * Defines the command pattern types and interfaces.
 */

/**
 * Base Command Interface
 */
export interface Command {
    /** Unique command identifier */
    commandId: string;

    /** Command timestamp */
    timestamp: Date;

    /** Get the command type for routing */
    getCommandType(): string;

    /** Execute the command */
    execute(): Promise<void>;

    /** Undo the command (if supported) */
    undo(): Promise<void>;
}

/**
 * Command Handler Interface
 */
export interface CommandHandler<T extends Command> {
    /** Handle the command execution */
    handle(command: T): Promise<any>;
}

/**
 * Command Middleware Interface
 */
export interface CommandMiddleware {
    /** Executed before command */
    before?(command: Command): Promise<void>;

    /** Executed after successful command */
    after?(command: Command, result: any): Promise<void>;

    /** Executed on command error */
    onError?(command: Command, error: any): Promise<void>;
}

/**
 * Command Result Types
 */
export type CommandResult<T = any> =
    | { success: true; data: T; duration: number }
    | { success: false; error: Error; duration: number };

/**
 * Command Context
 */
export interface CommandContext {
    /** User ID or session identifier */
    userId?: string;

    /** Command correlation ID for tracking */
    correlationId: string;

    /** Command metadata */
    metadata?: Record<string, any>;

    /** Timeout for command execution */
    timeout?: number;
}

/**
 * Command Validation Result
 */
export interface CommandValidation {
    isValid: boolean;
    errors: string[];
}

/**
 * Predefined Command Types
 */
export const COMMAND_TYPES = {
    SAVE_BOARD: 'save-board',
    UPDATE_BOARD: 'update-board',
    CREATE_COLUMN: 'create-column',
    UPDATE_COLUMN: 'update-column',
    DELETE_COLUMN: 'delete-column',
    CREATE_TASK: 'create-task',
    UPDATE_TASK: 'update-task',
    DELETE_TASK: 'delete-task',
    MOVE_TASK: 'move-task',
    MOVE_COLUMN: 'move-column',
    LOAD_BOARD: 'load-board',
    EXPORT_BOARD: 'export-board',
    IMPORT_BOARD: 'import-board'
} as const;

/**
 * Command Priority Levels
 */
export enum CommandPriority {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2,
    CRITICAL = 3
}

/**
 * Command Status
 */
export enum CommandStatus {
    PENDING = 'pending',
    EXECUTING = 'executing',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled'
}