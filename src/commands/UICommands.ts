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

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage, MessageHandler } from './interfaces';
import {
    SaveBoardStateMessage,
    ShowMessageRequestMessage,
    ShowErrorMessage,
    ShowInfoMessage,
    SetPreferenceMessage,
    SetContextMessage,
    UpdateTaskContentExtendedMessage,
    UpdateColumnContentExtendedMessage,
    OpenSearchPanelMessage,
    SetFilePreferenceMessage
} from '../core/bridge/MessageTypes';
import { ResolvedTarget } from '../core/stores/BoardStore';
import { KanbanBoard } from '../markdownParser';
import { showError as notifyError, showWarning, showInfo as notifyInfo } from '../services/NotificationService';
import * as vscode from 'vscode';
import { setDocumentPreference } from '../utils/documentPreference';
import { logger } from '../utils/logger';

/**
 * UI Commands Handler
 *
 * Processes UI-related messages from the webview.
 * Uses SwitchBasedCommand for automatic dispatch and error handling.
 */
export class UICommands extends SwitchBasedCommand {
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
            'setFilePreference',
            'setContext',
            'requestConfigurationRefresh',
            'openSearchPanel'
        ],
        priority: 100
    };

    /**
     * Handler mapping for message dispatch
     * Type assertions used for specific message types
     */
    protected handlers: Record<string, MessageHandler> = {
        'undo': (_msg, ctx) => this.handleUndo(ctx),
        'redo': (_msg, ctx) => this.handleRedo(ctx),
        'requestBoardUpdate': (_msg, ctx) => this.handleRequestBoardUpdate(ctx),
        'saveBoardState': (msg, ctx) => this.handleSaveBoardState(msg as SaveBoardStateMessage, ctx),
        'showMessage': (msg, ctx) => this.handleShowMessage(msg as ShowMessageRequestMessage, ctx),
        'showError': (msg, _ctx) => this.handleShowError(msg as ShowErrorMessage),
        'showInfo': (msg, _ctx) => this.handleShowInfo(msg as ShowInfoMessage),
        'setPreference': (msg, _ctx) => this.handleSetPreference(msg as SetPreferenceMessage),
        'setFilePreference': (msg, ctx) => this.handleSetFilePreference(msg as SetFilePreferenceMessage, ctx),
        'setContext': (msg, _ctx) => this.handleSetContext(msg as SetContextMessage),
        'requestConfigurationRefresh': (_msg, ctx) => this.handleRequestConfigurationRefresh(ctx),
        'openSearchPanel': (msg, ctx) => this.handleOpenSearchPanel(msg as OpenSearchPanelMessage, ctx)
    };

    // ============= UI HANDLERS =============

    /**
     * Execute undo/redo operation with common logic.
     */
    private async executeUndoRedo(
        context: CommandContext,
        operation: 'undo' | 'redo'
    ): Promise<CommandResult> {
        const isUndo = operation === 'undo';
        const canExecute = isUndo ? context.boardStore.canUndo() : context.boardStore.canRedo();
        const stackSize = isUndo ? context.boardStore.getUndoStackSize() : context.boardStore.getRedoStackSize();

        logger.debug(`[UICommands] handle${isUndo ? 'Undo' : 'Redo'}: can${isUndo ? 'Undo' : 'Redo'}=${canExecute}, stackSize=${stackSize}`);
        context.setUndoRedoOperation(true);

        const result = isUndo ? context.boardStore.undo() : context.boardStore.redo();
        if (result) {
            context.setBoard(result.board);
            context.emitBoardChanged(result.board, operation);
            logger.debug(`[UICommands.handle${isUndo ? 'Undo' : 'Redo'}.emitBoardChanged]`, {
                trigger: operation,
                targetCount: result.targets?.length ?? 0
            });

            const didTargetedUpdate = await this.tryTargetedUpdate(result.board, result.targets, context);
            if (!didTargetedUpdate) {
                await context.onBoardUpdate();
            }
        }

        context.setUndoRedoOperation(false);

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
     * Handle undo command
     */
    private async handleUndo(context: CommandContext): Promise<CommandResult> {
        return this.executeUndoRedo(context, 'undo');
    }

    /**
     * Handle redo command
     */
    private async handleRedo(context: CommandContext): Promise<CommandResult> {
        return this.executeUndoRedo(context, 'redo');
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

        if (targets.length === 0) {
            return false;
        }

        const allColumns = targets.every(target => target.type === 'column');
        if (allColumns) {
            const uniqueColumnIds = Array.from(new Set(targets.map(target => target.id)));
            logger.debug('[kanban.UICommands.tryTargetedUpdate.columns]', {
                columnIds: uniqueColumnIds,
                targetCount: targets.length
            });
            for (const columnId of uniqueColumnIds) {
                const column = board.columns.find(c => c.id === columnId);
                logger.debug('[kanban.UICommands.tryTargetedUpdate.column]', {
                    columnId: columnId,
                    columnFound: !!column,
                    taskCount: column?.tasks?.length ?? 0
                });
                if (!column) {
                    return false;
                }
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
            }
            return true;
        }

        const allTasks = targets.every(target => target.type === 'task' && target.columnId);
        if (allTasks) {
            for (const target of targets) {
                const column = board.columns.find(c => c.id === target.columnId);
                const task = column?.tasks.find(t => t.id === target.id);
                if (!task || !column) {
                    return false;
                }
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
            }
            return true;
        }

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
            notifyError(message.text);
        } else if (message.messageType === 'warning') {
            showWarning(message.text);
        } else {
            notifyInfo(message.text);
        }
        return this.success();
    }

    /**
     * Handle showError command
     */
    private async handleShowError(message: ShowErrorMessage): Promise<CommandResult> {
        notifyError(message.text);
        return this.success();
    }

    /**
     * Handle showInfo command
     */
    private async handleShowInfo(message: ShowInfoMessage): Promise<CommandResult> {
        notifyInfo(message.text);
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
     * Handle setFilePreference command
     */
    private async handleSetFilePreference(message: SetFilePreferenceMessage, context: CommandContext): Promise<CommandResult> {
        if (!message.key) {
            console.error('[UICommands] setFilePreference called with undefined key');
            return this.failure('setFilePreference requires a key');
        }

        const documentUriFromManager = context.fileManager?.getDocument()?.uri.toString();
        const targetUri = message.documentUri || documentUriFromManager;

        if (!targetUri) {
            console.error('[UICommands] setFilePreference missing documentUri');
            return this.failure('setFilePreference requires a documentUri');
        }

        await setDocumentPreference(context.extensionContext, targetUri, message.key, message.value);
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

    private async handleOpenSearchPanel(_message: OpenSearchPanelMessage, _context: CommandContext): Promise<CommandResult> {
        try {
            await vscode.commands.executeCommand('workbench.view.extension.kanbanBoards');
            await vscode.commands.executeCommand('kanbanSearch.focus');
        } catch (error) {
            console.error('[UICommands] Failed to open kanban search panel:', error);
        }
        return this.success();
    }
}
