/**
 * UI Commands
 *
 * Handles UI-related message operations:
 * - undo, redo
 * - requestBoardUpdate, saveBoardState
 * - showMessage, showError, showInfo
 * - setPreference, setContext
 * - requestConfigurationRefresh
 *
 * @module commands/UICommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage } from './interfaces';
import {
    SaveBoardStateMessage,
    ShowMessageRequestMessage,
    ShowErrorMessage,
    ShowInfoMessage,
    SetPreferenceMessage,
    SetContextMessage,
    UpdateTaskContentExtendedMessage,
    UpdateColumnContentExtendedMessage
} from '../core/bridge/MessageTypes';
import { getErrorMessage } from '../utils/stringUtils';
import { ResolvedTarget } from '../core/stores/BoardStore';
import { KanbanBoard } from '../markdownParser';
import * as vscode from 'vscode';

/**
 * UI Commands Handler
 *
 * Processes UI-related messages from the webview.
 */
export class UICommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'ui-commands',
        name: 'UI Commands',
        description: 'Handles undo/redo, board updates, messages, preferences',
        messageTypes: [
            'undo',
            'redo',
            'requestBoardUpdate',
            'saveBoardState',
            'showMessage',
            'showError',
            'showInfo',
            'setPreference',
            'setContext',
            'requestConfigurationRefresh'
        ],
        priority: 100
    };

    async execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'undo':
                    return await this.handleUndo(context);
                case 'redo':
                    return await this.handleRedo(context);
                case 'requestBoardUpdate':
                    return await this.handleRequestBoardUpdate(context);
                case 'saveBoardState':
                    return await this.handleSaveBoardState(message, context);
                case 'showMessage':
                    return await this.handleShowMessage(message, context);
                case 'showError':
                    return await this.handleShowError(message);
                case 'showInfo':
                    return await this.handleShowInfo(message);
                case 'setPreference':
                    return await this.handleSetPreference(message);
                case 'setContext':
                    return await this.handleSetContext(message);
                case 'requestConfigurationRefresh':
                    return await this.handleRequestConfigurationRefresh(context);
                default:
                    return this.failure(`Unknown UI command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[UICommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= UI HANDLERS =============

    /**
     * Handle undo command
     */
    private async handleUndo(context: CommandContext): Promise<CommandResult> {
        context.setUndoRedoOperation(true);

        const result = context.boardStore.undo();
        if (result) {
            context.setBoard(result.board);
            context.emitBoardChanged(result.board, 'undo');

            // Use targeted update if single element changed, otherwise full update
            const didTargetedUpdate = await this.tryTargetedUpdate(result.board, result.targets, context);
            if (!didTargetedUpdate) {
                await context.onBoardUpdate();
            }
        }

        context.setUndoRedoOperation(false);

        // Send undo/redo state to frontend
        const panel = context.getWebviewPanel();
        if (panel?.webview) {
            this.postMessage({
                type: 'undoRedoState',
                canUndo: context.boardStore.canUndo(),
                canRedo: context.boardStore.canRedo()
            });
        }

        return this.success();
    }

    /**
     * Handle redo command
     */
    private async handleRedo(context: CommandContext): Promise<CommandResult> {
        context.setUndoRedoOperation(true);

        const result = context.boardStore.redo();
        if (result) {
            context.setBoard(result.board);
            context.emitBoardChanged(result.board, 'redo');

            // Use targeted update if single element changed, otherwise full update
            const didTargetedUpdate = await this.tryTargetedUpdate(result.board, result.targets, context);
            if (!didTargetedUpdate) {
                await context.onBoardUpdate();
            }
        }

        context.setUndoRedoOperation(false);

        // Send undo/redo state to frontend
        const panel = context.getWebviewPanel();
        if (panel?.webview) {
            this.postMessage({
                type: 'undoRedoState',
                canUndo: context.boardStore.canUndo(),
                canRedo: context.boardStore.canRedo()
            });
        }

        return this.success();
    }

    /**
     * Try to send targeted update for single element changes
     * @returns true if targeted update was sent, false otherwise (needs full update)
     */
    private async tryTargetedUpdate(
        board: KanbanBoard,
        targets: ResolvedTarget[],
        _context: CommandContext
    ): Promise<boolean> {
        // Guard against undefined/null board or targets
        if (!board || !targets) {
            return false;
        }

        // Only support single-element targeted updates for now
        if (targets.length !== 1) {
            return false;
        }

        const target = targets[0];

        if (target.type === 'task' && target.columnId) {
            // Find the task in the restored board
            const column = board.columns.find(c => c.id === target.columnId);
            const task = column?.tasks.find(t => t.id === target.id);

            if (task && column) {
                const message: UpdateTaskContentExtendedMessage = {
                    type: 'updateTaskContent',
                    columnId: column.id,
                    taskId: task.id,
                    description: task.description,
                    displayTitle: task.displayTitle,
                    taskTitle: task.title,
                    originalTitle: task.originalTitle,
                    includeMode: task.includeMode || false,
                    includeFiles: task.includeFiles,
                    regularIncludeFiles: task.regularIncludeFiles
                };
                this.postMessage(message);
                return true;
            }
        } else if (target.type === 'column') {
            // Find the column in the restored board
            const column = board.columns.find(c => c.id === target.id);

            if (column) {
                const message: UpdateColumnContentExtendedMessage = {
                    type: 'updateColumnContent',
                    columnId: column.id,
                    tasks: column.tasks,
                    columnTitle: column.title,
                    displayTitle: column.displayTitle,
                    includeMode: column.includeMode || false,
                    includeFiles: column.includeFiles
                };
                this.postMessage(message);
                return true;
            }
        }

        // Couldn't find element in board, fall back to full update
        return false;
    }

    /**
     * Handle requestBoardUpdate command
     */
    private async handleRequestBoardUpdate(context: CommandContext): Promise<CommandResult> {
        await context.onBoardUpdate();
        context.fileManager.sendFileInfo();
        return this.success();
    }

    /**
     * Handle saveBoardState command
     * This is called when user presses Cmd+S to save all changes
     */
    private async handleSaveBoardState(message: SaveBoardStateMessage, context: CommandContext): Promise<CommandResult> {
        const board = message.board;
        if (!board) {
            console.warn('[UICommands.saveBoardState] No board data received');
            return this.success();
        }

        // NOTE: Do not save undo state here - individual operations already saved their undo states
        // before making changes. Saving here would create duplicate/grouped undo states.

        // Replace the current board with the new one from the frontend
        context.setBoard(board);

        // Save to markdown file
        // After save, _baseline is updated to match _content, so hasUnsavedChanges() returns false automatically
        await context.onSaveToMarkdown();

        return this.success();
    }

    /**
     * Handle showMessage command
     */
    private async handleShowMessage(message: ShowMessageRequestMessage, _context: CommandContext): Promise<CommandResult> {
        if (message.messageType === 'error') {
            vscode.window.showErrorMessage(message.text);
        } else if (message.messageType === 'warning') {
            vscode.window.showWarningMessage(message.text);
        } else {
            vscode.window.showInformationMessage(message.text);
        }
        return this.success();
    }

    /**
     * Handle showError command
     */
    private async handleShowError(message: ShowErrorMessage): Promise<CommandResult> {
        vscode.window.showErrorMessage(message.text);
        return this.success();
    }

    /**
     * Handle showInfo command
     */
    private async handleShowInfo(message: ShowInfoMessage): Promise<CommandResult> {
        vscode.window.showInformationMessage(message.text);
        return this.success();
    }

    /**
     * Handle setPreference command
     */
    private async handleSetPreference(message: SetPreferenceMessage): Promise<CommandResult> {
        if (!message.key) {
            console.error('[UICommands] setPreference called with undefined key');
            return this.failure('setPreference requires a key');
        }
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        await config.update(message.key, message.value, vscode.ConfigurationTarget.Global);
        return this.success();
    }

    /**
     * Handle setContext command
     */
    private async handleSetContext(message: SetContextMessage): Promise<CommandResult> {
        if (!message.key) {
            console.error('[UICommands] setContext called with undefined key');
            return this.failure('setContext requires a key');
        }
        try {
            await vscode.commands.executeCommand('setContext', message.key, message.value);
        } catch (error) {
            console.error(`[UICommands] Error handling setContext:`, error);
            return this.failure(`setContext failed: ${error}`);
        }
        return this.success();
    }

    /**
     * Handle requestConfigurationRefresh command
     */
    private async handleRequestConfigurationRefresh(context: CommandContext): Promise<CommandResult> {
        await context.refreshConfiguration();
        return this.success();
    }
}
