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

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { getErrorMessage } from '../utils/stringUtils';

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

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            const panel = context.getWebviewPanel();
            const messageHandler = (panel as any)?._messageHandler;

            if (!messageHandler) {
                return this.failure('No message handler available');
            }

            switch (message.type) {
                // Edit mode lifecycle
                case 'editModeStart':
                    await messageHandler.handleEditModeStart(message);
                    return this.success();

                case 'editModeEnd':
                    await messageHandler.handleEditModeEnd(message);
                    return this.success();

                case 'editingStarted':
                    // User started editing - block board regenerations
                    (panel as any).setEditingInProgress?.(true);
                    // Set edit mode flag on main file for conflict detection
                    {
                        const mainFile = (panel as any).fileRegistry?.getMainFile();
                        if (mainFile) {
                            mainFile.setEditMode(true);
                        }
                        // Also set edit mode on include files if editing within an include
                        const board = (panel as any).getBoard?.();
                        if (board && (message.taskId || message.columnId)) {
                            const allFiles = (panel as any).fileRegistry?.getAll() || [];
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
                    (panel as any).setEditingInProgress?.(false);
                    // Clear edit mode flag on ALL files (main + includes)
                    {
                        const mainFile = (panel as any).fileRegistry?.getMainFile();
                        if (mainFile) {
                            mainFile.setEditMode(false);
                        }
                        // Also clear edit mode on all include files
                        const allFiles = (panel as any).fileRegistry?.getAll() || [];
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
                    if (message.itemType === 'column') {
                        (panel as any).markColumnDirty?.(message.itemId);
                    } else if (message.itemType === 'task') {
                        (panel as any).markTaskDirty?.(message.itemId);
                    }
                    return this.success();

                case 'renderCompleted':
                    // Frontend successfully rendered - clear dirty flag
                    if (message.itemType === 'column') {
                        (panel as any).clearColumnDirty?.(message.itemId);
                    } else if (message.itemType === 'task') {
                        (panel as any).clearTaskDirty?.(message.itemId);
                    }
                    return this.success();

                case 'columnsUnfolded':
                    // Frontend confirms columns have been unfolded - call private handler
                    if (message.requestId && messageHandler._handleColumnsUnfolded) {
                        messageHandler._handleColumnsUnfolded(message.requestId);
                    }
                    return this.success();

                // Board state operations
                case 'markUnsavedChanges':
                    context.markUnsavedChanges(message.hasUnsavedChanges, message.cachedBoard);
                    return this.success();

                case 'saveUndoState':
                    const boardToSave = message.currentBoard || context.getCurrentBoard();
                    if (boardToSave) {
                        context.boardStore.saveStateForUndo(boardToSave);
                    }
                    return this.success();

                case 'boardUpdate':
                    await messageHandler.handleBoardUpdate(message);
                    return this.success();

                case 'pageHiddenWithUnsavedChanges':
                    await messageHandler.handlePageHiddenWithUnsavedChanges();
                    return this.success();

                // Marp settings
                case 'updateMarpGlobalSetting':
                    await messageHandler.handleUpdateMarpGlobalSetting(message.key, message.value);
                    return this.success();

                // Editor shortcuts and snippets
                case 'triggerVSCodeSnippet':
                    await messageHandler.handleVSCodeSnippet(message);
                    return this.success();

                case 'handleEditorShortcut':
                    await messageHandler.handleEditorShortcut(message);
                    return this.success();

                // Sorting
                case 'performSort':
                    // Perform automatic sort on board
                    const board = context.getCurrentBoard();
                    if (board) {
                        context.boardStore.saveStateForUndo(board);
                        context.boardOperations.performAutomaticSort(board);
                        context.markUnsavedChanges(true);
                        await context.onBoardUpdate();
                    }
                    return this.success();

                // Runtime tracking
                case 'runtimeTrackingReport':
                    // Currently just logs, no action needed
                    return this.success();

                // Template operations
                case 'getTemplates':
                    await messageHandler.handleGetTemplates();
                    return this.success();

                case 'applyTemplate':
                    await messageHandler.handleApplyTemplate(message);
                    return this.success();

                case 'submitTemplateVariables':
                    await messageHandler.handleSubmitTemplateVariables(message);
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
