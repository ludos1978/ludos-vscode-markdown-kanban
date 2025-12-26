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

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage } from './interfaces';
import { getErrorMessage } from '../utils/stringUtils';
import { hasMessageHandler } from '../types/PanelCommandAccess';
import { UndoCapture } from '../core/stores/UndoCapture';

/**
 * Edit Mode Commands Handler
 *
 * Processes edit mode, rendering, and miscellaneous messages from the webview.
 */
export class EditModeCommands extends BaseMessageCommand {
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

    async execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        try {
            const panel = context.getWebviewPanel();
            if (!panel || !hasMessageHandler(panel)) {
                return this.failure('No message handler available');
            }
            const messageHandler = panel._messageHandler;

            switch (message.type) {
                // Edit mode lifecycle
                case 'editModeStart':
                    if (messageHandler.handleEditModeStart) {
                        await messageHandler.handleEditModeStart(message);
                    }
                    return this.success();

                case 'editModeEnd':
                    if (messageHandler.handleEditModeEnd) {
                        await messageHandler.handleEditModeEnd(message);
                    }
                    return this.success();

                case 'editingStarted':
                    // User started editing - block board regenerations
                    context.setEditingInProgress(true);
                    // Set edit mode flag on main file for conflict detection
                    {
                        const fileRegistry = context.getFileRegistry();
                        const mainFile = fileRegistry?.getMainFile();
                        if (mainFile) {
                            mainFile.setEditMode(true);
                        }
                        // Also set edit mode on include files if editing within an include
                        const board = context.getCurrentBoard();
                        if (board && (message.taskId || message.columnId)) {
                            const allFiles = fileRegistry?.getAll() || [];
                            for (const file of allFiles) {
                                if (file.getFileType?.() !== 'main') {
                                    file.setEditMode(true);
                                }
                            }
                        }
                    }
                    return this.success();

                case 'editingStopped':
                    await messageHandler.handleEditingStopped(message);
                    return this.success();

                case 'editingStoppedNormal':
                    // User finished editing normally (not via backend request)
                    context.setEditingInProgress(false);
                    // Clear edit mode flag on ALL files (main + includes)
                    {
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
                    }
                    return this.success();

                // Render lifecycle
                case 'renderSkipped':
                    // Frontend reports it skipped a render - mark as dirty
                    if (message.itemType === 'column' && message.itemId) {
                        context.markColumnDirty(message.itemId);
                    } else if (message.itemType === 'task' && message.itemId) {
                        context.markTaskDirty(message.itemId);
                    }
                    return this.success();

                case 'renderCompleted':
                    // Frontend successfully rendered - clear dirty flag
                    if (message.itemType === 'column' && message.itemId) {
                        context.clearColumnDirty(message.itemId);
                    } else if (message.itemType === 'task' && message.itemId) {
                        context.clearTaskDirty(message.itemId);
                    }
                    return this.success();

                case 'columnsUnfolded':
                    // Frontend confirms columns have been unfolded - call private handler
                    if (message.requestId && messageHandler._handleColumnsUnfolded) {
                        messageHandler._handleColumnsUnfolded(message.requestId);
                    }
                    return this.success();

                // Board state operations - sync board from frontend to backend
                case 'markUnsavedChanges':
                    // Sync board from frontend if provided
                    if (message.cachedBoard) {
                        context.emitBoardChanged(message.cachedBoard, 'edit');
                    }
                    return this.success();

                case 'saveUndoState':
                    // NOTE: This message type should rarely be used - most operations save their own undo state.
                    // Only use when explicitly needed for operations that don't have built-in undo handling.
                    const boardToSave = message.currentBoard || context.getCurrentBoard();
                    if (boardToSave) {
                        context.boardStore.saveUndoEntry(
                            UndoCapture.forFullBoard(boardToSave, 'saveUndoState')
                        );
                    }
                    return this.success();

                case 'boardUpdate':
                    await messageHandler.handleBoardUpdate(message);
                    return this.success();

                case 'pageHiddenWithUnsavedChanges':
                    if (messageHandler.handlePageHiddenWithUnsavedChanges) {
                        await messageHandler.handlePageHiddenWithUnsavedChanges();
                    }
                    return this.success();

                // Marp settings
                case 'updateMarpGlobalSetting':
                    if (messageHandler.handleUpdateMarpGlobalSetting) {
                        await messageHandler.handleUpdateMarpGlobalSetting(message.key, message.value);
                    }
                    return this.success();

                // Editor shortcuts and snippets
                case 'triggerVSCodeSnippet':
                    if (messageHandler.handleVSCodeSnippet) {
                        await messageHandler.handleVSCodeSnippet(message);
                    }
                    return this.success();

                case 'handleEditorShortcut':
                    if (messageHandler.handleEditorShortcut) {
                        await messageHandler.handleEditorShortcut(message);
                    }
                    return this.success();

                // Sorting
                case 'performSort':
                    // Perform automatic sort on board
                    const board = context.getCurrentBoard();
                    if (board) {
                        // Capture undo state BEFORE modification (but don't save yet)
                        const undoEntry = UndoCapture.forFullBoard(board, 'performSort');
                        const sortMadeChanges = context.boardOperations.performAutomaticSort(board);

                        // Only save undo entry and emit changes if sort actually changed something
                        if (sortMadeChanges) {
                            context.boardStore.saveUndoEntry(undoEntry);
                            context.emitBoardChanged(board, 'sort');
                            await context.onBoardUpdate();
                        }
                    }
                    return this.success();

                // Runtime tracking
                case 'runtimeTrackingReport':
                    // Currently just logs, no action needed
                    return this.success();

                // Template operations
                case 'getTemplates':
                    if (messageHandler.handleGetTemplates) {
                        await messageHandler.handleGetTemplates();
                    }
                    return this.success();

                case 'applyTemplate':
                    if (messageHandler.handleApplyTemplate) {
                        await messageHandler.handleApplyTemplate(message);
                    }
                    return this.success();

                case 'submitTemplateVariables':
                    if (messageHandler.handleSubmitTemplateVariables) {
                        await messageHandler.handleSubmitTemplateVariables(message);
                    }
                    return this.success();

                default:
                    return this.failure(`Unknown edit mode command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[EditModeCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }
}
