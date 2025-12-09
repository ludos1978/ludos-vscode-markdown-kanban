/**
 * Column Commands
 *
 * Handles all column-related message operations:
 * - addColumn, deleteColumn
 * - moveColumn, moveColumnWithRowUpdate, reorderColumns
 * - insertColumnBefore/After
 * - sortColumn
 * - editColumnTitle
 * - updateColumnTitleFromStrikethroughDeletion
 *
 * @module commands/ColumnCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { INCLUDE_SYNTAX } from '../constants/IncludeConstants';
import * as vscode from 'vscode';

/**
 * Column Commands Handler
 *
 * Processes all column-related messages from the webview.
 */
export class ColumnCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'column-commands',
        name: 'Column Commands',
        description: 'Handles column creation, editing, deletion, and movement',
        messageTypes: [
            'addColumn',
            'deleteColumn',
            'moveColumn',
            'moveColumnWithRowUpdate',
            'reorderColumns',
            'insertColumnBefore',
            'insertColumnAfter',
            'sortColumn',
            'editColumnTitle',
            'updateColumnTitleFromStrikethroughDeletion'
        ],
        priority: 100
    };

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'addColumn':
                    return await this.handleAddColumn(message, context);
                case 'deleteColumn':
                    return await this.handleDeleteColumn(message, context);
                case 'moveColumn':
                    return await this.handleMoveColumn(message, context);
                case 'moveColumnWithRowUpdate':
                    return await this.handleMoveColumnWithRowUpdate(message, context);
                case 'reorderColumns':
                    return await this.handleReorderColumns(message, context);
                case 'insertColumnBefore':
                    return await this.handleInsertColumnBefore(message, context);
                case 'insertColumnAfter':
                    return await this.handleInsertColumnAfter(message, context);
                case 'sortColumn':
                    return await this.handleSortColumn(message, context);
                case 'editColumnTitle':
                    return await this.handleEditColumnTitle(message, context);
                case 'updateColumnTitleFromStrikethroughDeletion':
                    return await this.handleUpdateColumnTitleFromStrikethroughDeletion(message, context);
                default:
                    return this.failure(`Unknown column command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[ColumnCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= HELPER METHODS =============

    /**
     * Perform a board action with undo support and update handling
     */
    private async performBoardAction(
        context: CommandContext,
        action: () => boolean,
        options: { saveUndo?: boolean; sendUpdate?: boolean } = {}
    ): Promise<boolean> {
        const { saveUndo = true, sendUpdate = true } = options;

        const board = context.getCurrentBoard();
        if (!board) {
            return false;
        }

        if (saveUndo) {
            context.boardStore.saveStateForUndo(board);
        }

        const success = action();

        if (success) {
            if (sendUpdate) {
                context.markUnsavedChanges(true);
                await context.onBoardUpdate();
            } else {
                context.markUnsavedChanges(true, context.getCurrentBoard());
            }
        }

        return success;
    }

    // ============= COLUMN HANDLERS =============

    /**
     * Handle addColumn message
     */
    private async handleAddColumn(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.addColumn(
                context.getCurrentBoard()!,
                message.title
            )
        );
        return this.success();
    }

    /**
     * Handle deleteColumn message
     */
    private async handleDeleteColumn(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.deleteColumn(
                context.getCurrentBoard()!,
                message.columnId
            )
        );
        return this.success();
    }

    /**
     * Handle moveColumn message
     */
    private async handleMoveColumn(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveColumn(
                context.getCurrentBoard()!,
                message.fromIndex,
                message.toIndex,
                message.fromRow,
                message.toRow
            )
        );
        return this.success();
    }

    /**
     * Handle moveColumnWithRowUpdate message
     */
    private async handleMoveColumnWithRowUpdate(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.moveColumnWithRowUpdate(
                context.getCurrentBoard()!,
                message.columnId,
                message.newPosition,
                message.newRow
            ),
            { sendUpdate: false }
        );
        return this.success();
    }

    /**
     * Handle reorderColumns message
     */
    private async handleReorderColumns(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.reorderColumns(
                context.getCurrentBoard()!,
                message.newOrder,
                message.movedColumnId,
                message.targetRow
            )
        );
        return this.success();
    }

    /**
     * Handle insertColumnBefore message
     */
    private async handleInsertColumnBefore(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.insertColumnBefore(
                context.getCurrentBoard()!,
                message.columnId,
                message.title
            )
        );
        return this.success();
    }

    /**
     * Handle insertColumnAfter message
     */
    private async handleInsertColumnAfter(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.insertColumnAfter(
                context.getCurrentBoard()!,
                message.columnId,
                message.title
            )
        );
        return this.success();
    }

    /**
     * Handle sortColumn message
     */
    private async handleSortColumn(message: any, context: CommandContext): Promise<CommandResult> {
        await this.performBoardAction(
            context,
            () => context.boardOperations.sortColumn(
                context.getCurrentBoard()!,
                message.columnId,
                message.sortType
            )
        );
        return this.success();
    }

    /**
     * Handle editColumnTitle message - complex with include handling
     * Routes to the unified handler in MessageHandler for include detection
     */
    private async handleEditColumnTitle(message: any, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.failure('No panel available');
        }

        // SWITCH-2: Route through MessageHandler's unified column include switch function
        // This is necessary because the include handling requires access to MessageHandler's
        // handleEditColumnTitleUnified method which has complex include file management
        if ((panel as any)._messageHandler?.handleEditColumnTitleUnified) {
            await (panel as any)._messageHandler.handleEditColumnTitleUnified(message.columnId, message.title);
        } else {
            // Fallback: simple title edit without include handling
            await this.performBoardAction(
                context,
                () => context.boardOperations.editColumnTitle(
                    context.getCurrentBoard()!,
                    message.columnId,
                    message.title
                ),
                { sendUpdate: false }
            );
        }

        return this.success();
    }

    /**
     * Handle updateColumnTitleFromStrikethroughDeletion message
     * Routes through the same unified handler as editColumnTitle
     */
    private async handleUpdateColumnTitleFromStrikethroughDeletion(message: any, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.failure('No panel available');
        }

        // Route through unified handler
        if ((panel as any)._messageHandler?.handleEditColumnTitleUnified) {
            await (panel as any)._messageHandler.handleEditColumnTitleUnified(message.columnId, message.newTitle);
        }

        return this.success();
    }
}
