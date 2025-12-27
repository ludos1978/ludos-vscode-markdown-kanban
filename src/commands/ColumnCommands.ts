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

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import {
    AddColumnMessage,
    DeleteColumnMessage,
    MoveColumnMessage,
    MoveColumnWithRowUpdateMessage,
    ReorderColumnsMessage,
    InsertColumnBeforeMessage,
    InsertColumnAfterMessage,
    SortColumnMessage,
    EditColumnTitleMessage,
    UpdateColumnTitleFromStrikethroughDeletionMessage
} from '../core/bridge/MessageTypes';
import { getErrorMessage } from '../utils/stringUtils';
import { INCLUDE_SYNTAX, extractIncludeFiles } from '../constants/IncludeConstants';
import { findColumn } from '../actions/helpers';
import { KanbanColumn } from '../board/KanbanTypes';
import { PresentationGenerator } from '../services/export/PresentationGenerator';
import { safeFileUri } from '../utils/uriUtils';
import { showError, showWarning, showInfo } from '../services/NotificationService';
import * as vscode from 'vscode';
import * as path from 'path';
import { MarkdownFile } from '../files/MarkdownFile';
import { ColumnActions } from '../actions';
import { UndoCapture } from '../core/stores/UndoCapture';

/**
 * Column Commands Handler
 *
 * Processes all column-related messages from the webview.
 */
export class ColumnCommands extends SwitchBasedCommand {
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

    protected handlers: Record<string, MessageHandler> = {
        'addColumn': (msg, ctx) => this.handleAddColumn(msg as AddColumnMessage, ctx),
        'deleteColumn': (msg, ctx) => this.handleDeleteColumn(msg as DeleteColumnMessage, ctx),
        'moveColumn': (msg, ctx) => this.handleMoveColumn(msg as MoveColumnMessage, ctx),
        'moveColumnWithRowUpdate': (msg, ctx) => this.handleMoveColumnWithRowUpdate(msg as MoveColumnWithRowUpdateMessage, ctx),
        'reorderColumns': (msg, ctx) => this.handleReorderColumns(msg as ReorderColumnsMessage, ctx),
        'insertColumnBefore': (msg, ctx) => this.handleInsertColumnBefore(msg as InsertColumnBeforeMessage, ctx),
        'insertColumnAfter': (msg, ctx) => this.handleInsertColumnAfter(msg as InsertColumnAfterMessage, ctx),
        'sortColumn': (msg, ctx) => this.handleSortColumn(msg as SortColumnMessage, ctx),
        'editColumnTitle': (msg, ctx) => this.handleEditColumnTitle(msg as EditColumnTitleMessage, ctx),
        'updateColumnTitleFromStrikethroughDeletion': (msg, ctx) => this.handleUpdateColumnTitleFromStrikethroughDeletion(msg as UpdateColumnTitleFromStrikethroughDeletionMessage, ctx)
    };

    // ============= HELPER METHODS =============

    /**
     * Generate content for appending tasks from a column to an include file.
     * Returns the content and absolute path to be passed through the include switch event.
     */
    private async generateAppendTasksContent(
        column: KanbanColumn,
        includeFilePath: string,
        context: CommandContext
    ): Promise<{ absolutePath: string; content: string }> {
        const fileRegistry = context.getFileRegistry();
        if (!fileRegistry) {
            throw new Error('No file registry available');
        }

        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            throw new Error('No main file found');
        }

        const mainFilePath = mainFile.getPath();
        const mainFileDir = path.dirname(mainFilePath);
        const absoluteIncludePath = path.isAbsolute(includeFilePath)
            ? includeFilePath
            : path.resolve(mainFileDir, includeFilePath);

        // Generate presentation format content from the column's tasks
        const tasksContent = PresentationGenerator.fromTasks(column.tasks, {
            filterIncludes: true,
            includeMarpDirectives: false
        });

        // Check if the file exists on disk to read existing content
        let existingContent = '';
        try {
            const fileContent = await vscode.workspace.fs.readFile(safeFileUri(absoluteIncludePath, 'ColumnCommands-readIncludeFile'));
            existingContent = Buffer.from(fileContent).toString('utf8');
        } catch {
            // File doesn't exist yet - that's fine
        }

        let finalContent: string;
        if (existingContent) {
            const separator = existingContent.trimEnd().endsWith('---') ? '\n' : '\n---\n';
            finalContent = existingContent.trimEnd() + separator + tasksContent;
        } else {
            finalContent = `---
marp: true
---
${tasksContent}`;
        }

        return { absolutePath: absoluteIncludePath, content: finalContent };
    }

    /**
     * Unified handler for column title edits with include detection
     * Handles both normal edits and strikethrough deletions
     */
    private async handleEditColumnTitleUnified(
        columnId: string,
        newTitle: string,
        context: CommandContext
    ): Promise<void> {
        const currentBoard = context.getCurrentBoard();
        if (!currentBoard) {
            return;
        }

        const column = findColumn(currentBoard, columnId);
        if (!column) {
            return;
        }

        // Check for include syntax changes
        const hasColumnIncludeMatches = newTitle.match(INCLUDE_SYNTAX.REGEX);
        const oldIncludeMatches = (column.title || '').match(INCLUDE_SYNTAX.REGEX);
        const hasIncludeChanges = hasColumnIncludeMatches || oldIncludeMatches;

        if (hasIncludeChanges) {
            // Column include switch - route through state machine
            const newIncludeFiles = extractIncludeFiles(newTitle);
            const oldIncludeFiles = column.includeFiles || [];

            // DATA LOSS PREVENTION: Check if column has existing tasks that would be lost
            const isAddingIncludeToRegularColumn = !oldIncludeMatches && hasColumnIncludeMatches && !column.includeMode;
            const hasExistingTasks = column.tasks && column.tasks.length > 0;

            let preloadedContent: Map<string, string> | undefined;

            if (isAddingIncludeToRegularColumn && hasExistingTasks) {
                const choice = await vscode.window.showWarningMessage(
                    `This column has ${column.tasks.length} existing task(s). Adding an include will replace them with the included file's content.`,
                    { modal: true },
                    'Append tasks to include file',
                    'Discard tasks',
                    'Cancel'
                );

                if (choice === 'Cancel' || choice === undefined) {
                    // Revert the title change in the frontend
                    this.postMessage({
                        type: 'revertColumnTitle',
                        columnId: columnId,
                        title: column.title
                    });
                    context.setEditingInProgress(false);
                    return;
                }

                if (choice === 'Append tasks to include file') {
                    const includeFilePath = newIncludeFiles[0];
                    if (includeFilePath) {
                        try {
                            // Note: Must normalize the path key for consistent lookup
                            // IncludeLoadingProcessor uses MarkdownFile.normalizeRelativePath for lookups
                            const { content } = await this.generateAppendTasksContent(column, includeFilePath, context);
                            preloadedContent = new Map<string, string>();
                            const normalizedKey = MarkdownFile.normalizeRelativePath(includeFilePath);
                            preloadedContent.set(normalizedKey, content);
                        } catch (error) {
                            showError(`Failed to generate tasks content: ${getErrorMessage(error)}`);
                            this.postMessage({
                                type: 'revertColumnTitle',
                                columnId: columnId,
                                title: column.title
                            });
                            context.setEditingInProgress(false);
                            return;
                        }
                    }
                }
            }

            // Clear dirty flag BEFORE stopping editing
            context.clearColumnDirty(columnId);

            // Stop editing before switch
            await context.requestStopEditing();

            // Capture undo state BEFORE include switch (include switches bypass action system)
            // Note: reusing currentBoard from outer scope (already checked for null at function start)
            if (currentBoard) {
                context.boardStore.saveUndoEntry(
                    UndoCapture.forColumn(currentBoard, columnId, 'includeSwitch')
                );
            }

            try {
                await context.handleIncludeSwitch({
                    columnId: columnId,
                    oldFiles: oldIncludeFiles,
                    newFiles: newIncludeFiles,
                    newTitle: newTitle,
                    preloadedContent: preloadedContent
                });

                context.setEditingInProgress(false);
            } catch (error) {
                context.setEditingInProgress(false);

                const errorMsg = getErrorMessage(error);
                if (errorMsg !== 'USER_CANCELLED') {
                    showError(`Failed to switch column include: ${errorMsg}`);
                }
            }
        } else {
            // Regular title edit without include syntax
            await this.executeAction(
                context,
                ColumnActions.updateTitle(columnId, newTitle),
                { sendUpdates: false }
            );

            context.setEditingInProgress(false);
        }
    }

    // ============= COLUMN HANDLERS =============

    /**
     * Handle addColumn message
     */
    private async handleAddColumn(message: AddColumnMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            ColumnActions.add({ title: message.title })
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add column');
    }

    /**
     * Handle deleteColumn message
     */
    private async handleDeleteColumn(message: DeleteColumnMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            ColumnActions.remove(message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to delete column');
    }

    /**
     * Handle moveColumn message
     */
    private async handleMoveColumn(message: MoveColumnMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            ColumnActions.move(message.fromIndex, message.toIndex)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move column');
    }

    /**
     * Handle moveColumnWithRowUpdate message
     */
    private async handleMoveColumnWithRowUpdate(message: MoveColumnWithRowUpdateMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            ColumnActions.moveWithRowUpdate(
                message.columnId,
                message.newPosition,
                message.newRow
            ),
            { sendUpdates: false }
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move column');
    }

    /**
     * Handle reorderColumns message
     */
    private async handleReorderColumns(message: ReorderColumnsMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            ColumnActions.reorderWithRowTags(
                message.newOrder,
                message.movedColumnId,
                message.targetRow
            )
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to reorder columns');
    }

    /**
     * Handle insertColumnBefore message
     */
    private async handleInsertColumnBefore(message: InsertColumnBeforeMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            ColumnActions.insertBefore(message.columnId, message.title)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert column');
    }

    /**
     * Handle insertColumnAfter message
     */
    private async handleInsertColumnAfter(message: InsertColumnAfterMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            ColumnActions.insertAfter(message.columnId, message.title)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert column');
    }

    /**
     * Handle sortColumn message
     * For 'unsorted' mode, gets original order from BoardStore.
     */
    private async handleSortColumn(message: SortColumnMessage, context: CommandContext): Promise<CommandResult> {
        const success = await this.performBoardAction(
            context,
            () => {
                const board = context.getCurrentBoard();
                if (!board) return false;
                // Get original order from BoardStore for 'unsorted' mode
                const originalOrder = context.boardStore.getOriginalTaskOrder(message.columnId);
                return context.boardOperations.sortColumn(board, message.columnId, message.sortType, originalOrder);
            }
        );
        return success ? this.success() : this.failure('Failed to sort column');
    }

    /**
     * Handle editColumnTitle message - complex with include handling
     */
    private async handleEditColumnTitle(message: EditColumnTitleMessage, context: CommandContext): Promise<CommandResult> {
        await this.handleEditColumnTitleUnified(message.columnId, message.title, context);
        return this.success();
    }

    /**
     * Handle updateColumnTitleFromStrikethroughDeletion message
     */
    private async handleUpdateColumnTitleFromStrikethroughDeletion(message: UpdateColumnTitleFromStrikethroughDeletionMessage, context: CommandContext): Promise<CommandResult> {
        await this.handleEditColumnTitleUnified(message.columnId, message.newTitle, context);
        return this.success();
    }
}
