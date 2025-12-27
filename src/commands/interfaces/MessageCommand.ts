/**
 * Message Command Interface
 *
 * Interface for command handlers that process webview messages.
 * Each command handles one or more message types.
 *
 * @module commands/interfaces/MessageCommand
 */

import { FileManager } from '../../fileManager';
import { BoardStore, UndoCapture } from '../../core/stores';
import { BoardOperations } from '../../board';
import { LinkHandler } from '../../services/LinkHandler';
import { KanbanBoard } from '../../markdownParser';
import { PlantUMLService } from '../../services/export/PlantUMLService';
import { MermaidExportService } from '../../services/export/MermaidExportService';
import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';
import { FileSaveService } from '../../core/FileSaveService';
import { IncomingMessage } from '../../core/bridge/MessageTypes';
import { WebviewBridge } from '../../core/bridge/WebviewBridge';
import { NewExportOptions } from '../../services/export/ExportService';
import { CapturedEdit } from '../../files/FileInterfaces';
import { BoardChangeTrigger } from '../../core/events';
import { ActionExecutor, BoardAction, ExecuteOptions, ActionResult } from '../../actions';
import { getErrorMessage } from '../../utils/stringUtils';
import * as vscode from 'vscode';

/**
 * Parameters for include switch operations
 */
export interface IncludeSwitchParams {
    taskId?: string;
    columnId?: string;
    oldFiles: string[];
    newFiles: string[];
    newTitle: string;
    preloadedContent?: Map<string, string>;
}

// =============================================================================
// SUB-INTERFACES FOR FOCUSED CONTEXTS
// Commands can use these narrower types in helper methods for better type safety
// =============================================================================

/**
 * Board-related context for commands that manipulate board state
 */
export interface BoardContext {
    boardStore: BoardStore;
    boardOperations: BoardOperations;
    getCurrentBoard: () => KanbanBoard | undefined;
    setBoard: (board: KanbanBoard) => void;
    setUndoRedoOperation: (isOperation: boolean) => void;
    /** Emit board:changed event to sync board state */
    emitBoardChanged: (board: KanbanBoard, trigger?: BoardChangeTrigger) => void;
    onBoardUpdate: () => Promise<void>;
}

/**
 * File-related context for commands that handle file operations
 */
export interface FileContext {
    fileManager: FileManager;
    fileSaveService: FileSaveService;
    getFileRegistry: () => MarkdownFileRegistry | undefined;
    onSaveToMarkdown: () => Promise<void>;
    onInitializeFile: () => Promise<void>;
}

/**
 * UI/Webview context for commands that interact with the frontend
 */
export interface UIContext {
    getWebviewPanel: () => vscode.WebviewPanel | undefined;
    getWebviewBridge: () => WebviewBridge | undefined;
    refreshConfiguration: () => Promise<void>;
}

/**
 * Edit state context for commands that track editing state
 */
export interface EditContext {
    setEditingInProgress: (value: boolean) => void;
    markTaskDirty: (taskId: string) => void;
    clearTaskDirty: (taskId: string) => void;
    markColumnDirty: (columnId: string) => void;
    clearColumnDirty: (columnId: string) => void;
    requestStopEditing: () => Promise<CapturedEdit | undefined>;
}

/**
 * Include file context for commands that handle include operations
 */
export interface IncludeContext {
    handleIncludeSwitch: (params: IncludeSwitchParams) => Promise<void>;
}

/**
 * Export context for commands that handle export operations
 */
export interface ExportContext {
    getAutoExportSettings: () => NewExportOptions | null;
    setAutoExportSettings: (settings: NewExportOptions | null) => void;
}

/**
 * Service context for specialized services used by commands
 */
export interface ServiceContext {
    linkHandler: LinkHandler;
    plantUMLService: PlantUMLService;
    /** Get the panel's MermaidExportService for panel-isolated Mermaid rendering */
    getMermaidExportService: () => MermaidExportService;
}

// =============================================================================
// MAIN COMMAND CONTEXT (composes all sub-interfaces)
// =============================================================================

/**
 * Context provided to command handlers
 * Contains all dependencies needed to process messages.
 * Composed of focused sub-interfaces for better organization.
 */
export interface CommandContext extends
    BoardContext,
    FileContext,
    UIContext,
    EditContext,
    IncludeContext,
    ExportContext,
    ServiceContext {}

/**
 * Metadata for a message command
 */
export interface CommandMetadata {
    /** Unique identifier for the command group */
    id: string;

    /** Human-readable name */
    name: string;

    /** Description of what this command group handles */
    description: string;

    /** Message types this command handles */
    messageTypes: string[];

    /** Priority for command resolution (higher = checked first) */
    priority: number;
}

/**
 * Result of command execution
 */
export interface CommandResult {
    /** Whether the command executed successfully */
    success: boolean;

    /** Error message if failed */
    error?: string;

    /** Optional data to return */
    data?: unknown;
}

/**
 * Message Command Interface
 *
 * Commands are registered with the CommandRegistry and called
 * when their message types are received from the webview.
 */
export interface MessageCommand {
    /** Command metadata */
    readonly metadata: CommandMetadata;

    /**
     * Check if this command can handle a message type
     * @param messageType - The message type to check
     * @returns true if this command handles the message type
     */
    canHandle(messageType: string): boolean;

    /**
     * Execute the command for a message
     * @param message - The message from the webview
     * @param context - Command execution context
     * @returns Result of command execution
     */
    execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult>;

    /**
     * Optional initialization when command is registered
     * @param context - Command execution context
     */
    initialize?(context: CommandContext): Promise<void>;

    /**
     * Optional cleanup when command is unregistered
     */
    dispose?(): Promise<void>;
}

/**
 * Base class for command implementations
 * Provides common functionality for all commands
 */
export abstract class BaseMessageCommand implements MessageCommand {
    abstract readonly metadata: CommandMetadata;

    protected _context?: CommandContext;

    canHandle(messageType: string): boolean {
        return this.metadata.messageTypes.includes(messageType);
    }

    abstract execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult>;

    async initialize(context: CommandContext): Promise<void> {
        this._context = context;
    }

    async dispose(): Promise<void> {
        this._context = undefined;
    }

    /**
     * Helper to create a success result
     */
    protected success(data?: unknown): CommandResult {
        return { success: true, data };
    }

    /**
     * Helper to create a failure result
     */
    protected failure(error: string): CommandResult {
        return { success: false, error };
    }

    /**
     * Get webview panel for sending messages
     */
    protected getPanel(): vscode.WebviewPanel | undefined {
        return this._context?.getWebviewPanel();
    }

    /**
     * Send message to webview via WebviewBridge
     * Uses bridge for consistent error handling and type safety
     */
    protected postMessage(message: any): boolean {
        const bridge = this._context?.getWebviewBridge();
        if (bridge) {
            return bridge.send(message);
        }
        // Fallback to direct postMessage if bridge not available (should not happen)
        const panel = this.getPanel();
        if (panel?.webview) {
            panel.webview.postMessage(message);
            return true;
        }
        return false;
    }

    /**
     * Get file registry from context
     * Convenience method to avoid null checks
     */
    protected getFileRegistry(): MarkdownFileRegistry | undefined {
        return this._context?.getFileRegistry();
    }

    /**
     * Get current board from context
     * Convenience method for common operation
     */
    protected getCurrentBoard(): KanbanBoard | undefined {
        return this._context?.getCurrentBoard();
    }

    /**
     * Perform a board action with undo support and update handling.
     * Common pattern for board modifications with proper state management.
     *
     * @param context - Command execution context (passed from execute)
     * @param action - The action to perform (returns true on success)
     * @param options.saveUndo - Whether to save undo state (default: true)
     * @param options.sendUpdate - Whether to send board update to frontend (default: true)
     *                            Set to false when frontend already has the change (e.g., live editing)
     * @returns true if action succeeded
     */
    protected async performBoardAction(
        context: CommandContext,
        action: () => boolean,
        options: { saveUndo?: boolean; sendUpdate?: boolean } = {}
    ): Promise<boolean> {
        const { saveUndo = true, sendUpdate = true } = options;

        const board = context.getCurrentBoard();
        if (!board) {
            return false;
        }

        // Clone board state BEFORE modification for potential undo
        // We need to clone now because action() mutates the board in place
        const undoEntry = saveUndo ? UndoCapture.inferred(board, 'edit') : null;

        const success = action();

        if (success) {
            // Only save undo entry AFTER action succeeds
            if (undoEntry) {
                context.boardStore.saveUndoEntry(undoEntry);
            }
            const currentBoard = context.getCurrentBoard();
            if (currentBoard) {
                context.emitBoardChanged(currentBoard, 'edit');
            }
            if (sendUpdate) {
                await context.onBoardUpdate();
            }
        }

        return success;
    }

    /**
     * Execute a board action using the action system.
     * Actions declare their targets for proper undo/redo handling and targeted updates.
     *
     * @param context - Command execution context
     * @param action - The action to execute
     * @param options - Optional execution options
     * @returns Action result with success status
     */
    protected async executeAction<T>(
        context: CommandContext,
        action: BoardAction<T>,
        options?: ExecuteOptions
    ): Promise<ActionResult<T>> {
        const webviewBridge = context.getWebviewBridge();
        if (!webviewBridge) {
            return { success: false, error: 'No webview bridge available' };
        }

        const executor = new ActionExecutor({
            getBoard: () => context.getCurrentBoard(),
            setBoard: (board) => context.setBoard(board),
            boardStore: context.boardStore,
            webviewBridge,
            emitBoardChanged: (board, trigger) => context.emitBoardChanged(board, trigger)
        });

        return executor.execute(action, options);
    }
}

/**
 * Handler function type for switch-based commands
 */
export type MessageHandler = (message: IncomingMessage, context: CommandContext) => Promise<CommandResult>;

/**
 * Abstract base class for commands that use a switch statement to dispatch message types.
 *
 * Reduces boilerplate by:
 * - Providing a standard execute() implementation with try-catch
 * - Using a handlers record to map message types to handler methods
 * - Automatic error handling with consistent logging
 *
 * Child classes define handlers as a protected record, allowing type-safe handler lookup.
 *
 * @example
 * export class TaskCommands extends SwitchBasedCommand {
 *     readonly metadata = {
 *         id: 'task-commands',
 *         messageTypes: ['addTask', 'deleteTask'],
 *         // ...
 *     };
 *
 *     protected handlers = {
 *         addTask: this.handleAddTask.bind(this),
 *         deleteTask: this.handleDeleteTask.bind(this),
 *     };
 *
 *     private async handleAddTask(msg: IncomingMessage, ctx: CommandContext) { ... }
 *     private async handleDeleteTask(msg: IncomingMessage, ctx: CommandContext) { ... }
 * }
 */
export abstract class SwitchBasedCommand extends BaseMessageCommand {
    /**
     * Record mapping message types to their handler methods.
     * Child classes must define this with all handlers bound to `this`.
     */
    protected abstract handlers: Record<string, MessageHandler>;

    /**
     * Execute the command by looking up the handler for the message type.
     * Provides consistent error handling and logging.
     */
    async execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        try {
            const handler = this.handlers[message.type];
            if (handler) {
                return await handler(message, context);
            }
            return this.failure(`Unknown ${this.metadata.id} command: ${message.type}`);
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[${this.metadata.id}] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }
}
