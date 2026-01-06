/**
 * Edit Mode Commands
 *
 * Handles edit mode and rendering message operations:
 * - editModeStart, editModeEnd
 * - editingStarted, editingStopped, editingStoppedNormal
 * - renderSkipped, renderCompleted
 * - columnsUnfolded
 * - markUnsavedChanges, saveUndoState
 * - boardUpdate, pageHiddenWithUnsavedChanges
 * - updateMarpGlobalSetting
 * - triggerVSCodeSnippet, handleEditorShortcut
 * - performSort
 * - runtimeTrackingReport
 * - getTemplates, applyTemplate, submitTemplateVariables
 *
 * @module commands/EditModeCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler, IncomingMessage } from './interfaces';
import { getErrorMessage } from '../utils/stringUtils';
import { hasMessageHandler } from '../types/PanelCommandAccess';
import { UndoCapture } from '../core/stores/UndoCapture';

/**
 * Edit Mode Commands Handler
 *
 * Processes edit mode, rendering, and miscellaneous messages from the webview.
 */
export class EditModeCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'edit-mode-commands',
        name: 'Edit Mode Commands',
        description: 'Handles edit mode, rendering lifecycle, templates, and miscellaneous operations',
        messageTypes: [
            'editModeStart',
            'editModeEnd',
            'editingStarted',
            'editingStopped',
            'editingStoppedNormal',
            'renderSkipped',
            'renderCompleted',
            'columnsUnfolded',
            'markUnsavedChanges',
            'saveUndoState',
            'boardUpdate',
            'pageHiddenWithUnsavedChanges',
            'updateMarpGlobalSetting',
            'triggerVSCodeSnippet',
            'handleEditorShortcut',
            'performSort',
            'runtimeTrackingReport',
            'getTemplates',
            'applyTemplate',
            'submitTemplateVariables'
        ],
        priority: 100
    };

    protected handlers: Record<string, MessageHandler> = {
        'editModeStart': (msg, ctx) => this._handleEditModeStart(msg, ctx),
        'editModeEnd': (msg, ctx) => this._handleEditModeEnd(msg, ctx),
        'editingStarted': (msg, ctx) => this._handleEditingStarted(msg, ctx),
        'editingStopped': (msg, ctx) => this._handleEditingStopped(msg, ctx),
        'editingStoppedNormal': (_msg, ctx) => this._handleEditingStoppedNormal(ctx),
        'renderSkipped': (msg, ctx) => this._handleRenderSkipped(msg, ctx),
        'renderCompleted': (msg, ctx) => this._handleRenderCompleted(msg, ctx),
        'columnsUnfolded': (msg, ctx) => this._handleColumnsUnfolded(msg, ctx),
        'markUnsavedChanges': (msg, ctx) => this._handleMarkUnsavedChanges(msg, ctx),
        'saveUndoState': (msg, ctx) => this._handleSaveUndoState(msg, ctx),
        'boardUpdate': (msg, ctx) => this._handleBoardUpdate(msg, ctx),
        'pageHiddenWithUnsavedChanges': (_msg, ctx) => this._handlePageHiddenWithUnsavedChanges(ctx),
        'updateMarpGlobalSetting': (msg, ctx) => this._handleUpdateMarpGlobalSetting(msg, ctx),
        'triggerVSCodeSnippet': (msg, ctx) => this._handleTriggerVSCodeSnippet(msg, ctx),
        'handleEditorShortcut': (msg, ctx) => this._handleEditorShortcut(msg, ctx),
        'performSort': (_msg, ctx) => this._handlePerformSort(ctx),
        'runtimeTrackingReport': () => Promise.resolve(this.success()),
        'getTemplates': (_msg, ctx) => this._handleGetTemplates(ctx),
        'applyTemplate': (msg, ctx) => this._handleApplyTemplate(msg, ctx),
        'submitTemplateVariables': (msg, ctx) => this._handleSubmitTemplateVariables(msg, ctx)
    };

    // ============= HELPER: Get message handler =============

    private _getMessageHandler(context: CommandContext): any {
        const panel = context.getWebviewPanel();
        if (!panel || !hasMessageHandler(panel)) {
            return null;
        }
        return panel.getMessageHandler ? panel.getMessageHandler() : panel._messageHandler;
    }

    // ============= EDIT MODE LIFECYCLE =============

    private async _handleEditModeStart(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handleEditModeStart) {
            await messageHandler.handleEditModeStart(message);
        }
        return this.success();
    }

    private async _handleEditModeEnd(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handleEditModeEnd) {
            await messageHandler.handleEditModeEnd(message);
        }
        return this.success();
    }

    private async _handleEditingStarted(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        // User started editing - block board regenerations
        context.setEditingInProgress(true);
        // Set edit mode flag on main file for conflict detection
        const fileRegistry = context.getFileRegistry();
        const mainFile = fileRegistry?.getMainFile();
        if (mainFile) {
            mainFile.setEditMode(true);
        }
        // Also set edit mode on include files if editing within an include
        const board = context.getCurrentBoard();
        const msg = message as any;
        if (board && (msg.taskId || msg.columnId)) {
            const allFiles = fileRegistry?.getAll() || [];
            for (const file of allFiles) {
                if (file.getFileType?.() !== 'main') {
                    file.setEditMode(true);
                }
            }
        }
        return this.success();
    }

    private async _handleEditingStopped(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler) {
            await messageHandler.handleEditingStopped(message);
        }
        return this.success();
    }

    private async _handleEditingStoppedNormal(context: CommandContext): Promise<CommandResult> {
        // User finished editing normally (not via backend request)
        context.setEditingInProgress(false);
        // Clear edit mode flag on ALL files (main + includes)
        const fileRegistry = context.getFileRegistry();
        const mainFile = fileRegistry?.getMainFile();
        if (mainFile) {
            mainFile.setEditMode(false);
        }
        // Also clear edit mode on all include files
        const allFiles = fileRegistry?.getAll() || [];
        for (const file of allFiles) {
            if (file.getFileType?.() !== 'main') {
                file.setEditMode(false);
            }
        }
        return this.success();
    }

    // ============= RENDER LIFECYCLE =============

    private async _handleRenderSkipped(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const msg = message as any;
        if (msg.itemType === 'column' && msg.itemId) {
            context.markColumnDirty(msg.itemId);
        } else if (msg.itemType === 'task' && msg.itemId) {
            context.markTaskDirty(msg.itemId);
        }
        return this.success();
    }

    private async _handleRenderCompleted(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const msg = message as any;
        if (msg.itemType === 'column' && msg.itemId) {
            context.clearColumnDirty(msg.itemId);
        } else if (msg.itemType === 'task' && msg.itemId) {
            context.clearTaskDirty(msg.itemId);
        }
        return this.success();
    }

    private async _handleColumnsUnfolded(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const msg = message as any;
        const messageHandler = this._getMessageHandler(context);
        if (msg.requestId && messageHandler?._handleColumnsUnfolded) {
            messageHandler._handleColumnsUnfolded(msg.requestId);
        }
        return this.success();
    }

    // ============= BOARD STATE OPERATIONS =============

    private async _handleMarkUnsavedChanges(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const msg = message as any;
        if (msg.cachedBoard) {
            context.emitBoardChanged(msg.cachedBoard, 'edit');
        }
        return this.success();
    }

    private async _handleSaveUndoState(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const msg = message as any;
        const boardToSave = msg.currentBoard || context.getCurrentBoard();
        if (boardToSave) {
            const operation = msg.operation || 'saveUndoState';

            if (operation === 'moveColumnViaDrag' || operation === 'insertColumnAtPosition') {
                context.boardStore.saveUndoEntry(
                    UndoCapture.forFullBoard(boardToSave, operation)
                );
                return this.success();
            }

            if (operation === 'moveTaskViaDrag' || operation === 'reorderTaskViaDrag') {
                const hasMovePayload = msg.taskId &&
                    msg.fromColumnId && msg.toColumnId &&
                    typeof msg.fromIndex === 'number' &&
                    typeof msg.toIndex === 'number';

                if (hasMovePayload) {
                    context.boardStore.saveUndoEntry(
                        UndoCapture.forTaskMove(boardToSave, {
                            type: 'task-move',
                            taskId: msg.taskId,
                            fromColumnId: msg.fromColumnId,
                            fromIndex: msg.fromIndex,
                            toColumnId: msg.toColumnId,
                            toIndex: msg.toIndex
                        }, operation)
                    );
                } else {
                    const columnId = msg.toColumnId || msg.fromColumnId || msg.columnId;
                    if (columnId) {
                        context.boardStore.saveUndoEntry(
                            UndoCapture.forColumn(boardToSave, columnId, operation)
                        );
                    } else {
                        context.boardStore.saveUndoEntry(
                            UndoCapture.forFullBoard(boardToSave, operation)
                        );
                    }
                }
                return this.success();
            }

            if (msg.taskId && msg.columnId) {
                context.boardStore.saveUndoEntry(
                    UndoCapture.forTask(boardToSave, msg.taskId, msg.columnId, operation)
                );
                return this.success();
            }

            if (msg.columnId) {
                context.boardStore.saveUndoEntry(
                    UndoCapture.forColumn(boardToSave, msg.columnId, operation)
                );
                return this.success();
            }

            context.boardStore.saveUndoEntry(
                UndoCapture.forFullBoard(boardToSave, operation)
            );
        }
        return this.success();
    }

    private async _handleBoardUpdate(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler) {
            await messageHandler.handleBoardUpdate(message);
        }
        return this.success();
    }

    private async _handlePageHiddenWithUnsavedChanges(context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handlePageHiddenWithUnsavedChanges) {
            await messageHandler.handlePageHiddenWithUnsavedChanges();
        }
        return this.success();
    }

    // ============= MARP & EDITOR =============

    private async _handleUpdateMarpGlobalSetting(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const msg = message as any;
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handleUpdateMarpGlobalSetting) {
            await messageHandler.handleUpdateMarpGlobalSetting(msg.key, msg.value);
        }
        return this.success();
    }

    private async _handleTriggerVSCodeSnippet(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handleVSCodeSnippet) {
            await messageHandler.handleVSCodeSnippet(message);
        }
        return this.success();
    }

    private async _handleEditorShortcut(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handleEditorShortcut) {
            await messageHandler.handleEditorShortcut(message);
        }
        return this.success();
    }

    // ============= SORTING =============

    private async _handlePerformSort(context: CommandContext): Promise<CommandResult> {
        const board = context.getCurrentBoard();
        if (board) {
            const undoEntry = UndoCapture.forFullBoard(board, 'performSort');
            const sortMadeChanges = context.boardOperations.performAutomaticSort(board);
            if (sortMadeChanges) {
                context.boardStore.saveUndoEntry(undoEntry);
                context.emitBoardChanged(board, 'sort');
                await context.onBoardUpdate();
            }
        }
        return this.success();
    }

    // ============= TEMPLATES =============

    private async _handleGetTemplates(context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handleGetTemplates) {
            await messageHandler.handleGetTemplates();
        }
        return this.success();
    }

    private async _handleApplyTemplate(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handleApplyTemplate) {
            await messageHandler.handleApplyTemplate(message);
        }
        return this.success();
    }

    private async _handleSubmitTemplateVariables(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const messageHandler = this._getMessageHandler(context);
        if (messageHandler?.handleSubmitTemplateVariables) {
            await messageHandler.handleSubmitTemplateVariables(message);
        }
        return this.success();
    }
}
