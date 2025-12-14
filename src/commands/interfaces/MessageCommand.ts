/**
 * Message Command Interface
 *
 * Interface for command handlers that process webview messages.
 * Each command handles one or more message types.
 *
 * @module commands/interfaces/MessageCommand
 */

import { FileManager } from '../../fileManager';
import { BoardStore } from '../../core/stores';
import { BoardOperations } from '../../board';
import { LinkHandler } from '../../services/LinkHandler';
import { KanbanBoard } from '../../markdownParser';
import { PlantUMLService } from '../../services/export/PlantUMLService';
import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';
import * as vscode from 'vscode';

/**
 * Context provided to command handlers
 * Contains all dependencies needed to process messages
 */
export interface CommandContext {
    // Core dependencies
    fileManager: FileManager;
    boardStore: BoardStore;
    boardOperations: BoardOperations;
    linkHandler: LinkHandler;
    plantUMLService: PlantUMLService;
    getFileRegistry: () => MarkdownFileRegistry | undefined;

    // Callbacks for panel operations
    onBoardUpdate: () => Promise<void>;
    onSaveToMarkdown: () => Promise<void>;
    onInitializeFile: () => Promise<void>;
    getCurrentBoard: () => KanbanBoard | undefined;
    setBoard: (board: KanbanBoard) => void;
    setUndoRedoOperation: (isOperation: boolean) => void;
    getWebviewPanel: () => vscode.WebviewPanel | undefined;
    /** Sync board state from frontend to backend (updates _content, triggers hash comparison for unsaved detection) */
    syncBoardToBackend: (board: KanbanBoard) => void;

    // Export settings
    getAutoExportSettings: () => any;
    setAutoExportSettings: (settings: any) => void;
}

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
    data?: any;
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
    execute(message: any, context: CommandContext): Promise<CommandResult>;

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

    abstract execute(message: any, context: CommandContext): Promise<CommandResult>;

    async initialize(context: CommandContext): Promise<void> {
        this._context = context;
    }

    async dispose(): Promise<void> {
        this._context = undefined;
    }

    /**
     * Helper to create a success result
     */
    protected success(data?: any): CommandResult {
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
     * Send message to webview
     */
    protected postMessage(message: any): boolean {
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
}
