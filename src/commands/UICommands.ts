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

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
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

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'undo':
                    return await this.handleUndo(context);
                case 'redo':
                    return await this.handleRedo(context);
                case 'requestBoardUpdate':
                    return await this.handleRequestBoardUpdate(context);
                case 'saveBoardState':
                    return await this.handleSaveBoardState(context);
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
            const errorMessage = error instanceof Error ? error.message : String(error);
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

        const previousBoard = context.boardStore.undo();
        if (previousBoard) {
            context.setBoard(previousBoard);
            context.markUnsavedChanges(true);
            await context.onBoardUpdate();
        }

        context.setUndoRedoOperation(false);

        // Send undo/redo state to frontend
        const panel = context.getWebviewPanel();
        if (panel?.webview) {
            panel.webview.postMessage({
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

        const nextBoard = context.boardStore.redo();
        if (nextBoard) {
            context.setBoard(nextBoard);
            context.markUnsavedChanges(true);
            await context.onBoardUpdate();
        }

        context.setUndoRedoOperation(false);

        // Send undo/redo state to frontend
        const panel = context.getWebviewPanel();
        if (panel?.webview) {
            panel.webview.postMessage({
                type: 'undoRedoState',
                canUndo: context.boardStore.canUndo(),
                canRedo: context.boardStore.canRedo()
            });
        }

        return this.success();
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
     */
    private async handleSaveBoardState(context: CommandContext): Promise<CommandResult> {
        const board = context.getCurrentBoard();
        if (board) {
            context.boardStore.saveStateForUndo(board);
        }
        return this.success();
    }

    /**
     * Handle showMessage command
     */
    private async handleShowMessage(message: any, context: CommandContext): Promise<CommandResult> {
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
    private async handleShowError(message: any): Promise<CommandResult> {
        vscode.window.showErrorMessage(message.text);
        return this.success();
    }

    /**
     * Handle showInfo command
     */
    private async handleShowInfo(message: any): Promise<CommandResult> {
        vscode.window.showInformationMessage(message.text);
        return this.success();
    }

    /**
     * Handle setPreference command
     */
    private async handleSetPreference(message: any): Promise<CommandResult> {
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        await config.update(message.key, message.value, vscode.ConfigurationTarget.Global);
        return this.success();
    }

    /**
     * Handle setContext command
     */
    private async handleSetContext(message: any): Promise<CommandResult> {
        await vscode.commands.executeCommand('setContext', message.key, message.value);
        return this.success();
    }

    /**
     * Handle requestConfigurationRefresh command
     */
    private async handleRequestConfigurationRefresh(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (panel && typeof (panel as any).refreshConfiguration === 'function') {
            await (panel as any).refreshConfiguration();
        }
        return this.success();
    }
}
