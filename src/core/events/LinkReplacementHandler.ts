/**
 * LinkReplacementHandler - Handles link:replace-requested events
 *
 * Moves the link replacement logic from KanbanWebviewPanel to a dedicated event handler.
 * This handler:
 * 1. Receives link replacement requests via EventBus
 * 2. Modifies board content to replace links
 * 3. Saves undo state
 * 4. Sends targeted or full updates to webview
 *
 * Previously: KanbanWebviewPanel.handleLinkReplacement() (145 lines)
 */

import { eventBus, LinkReplaceRequestedEvent, createEvent } from './index';
import { KanbanBoard } from '../../markdownParser';
import { BoardStore, UndoCapture } from '../stores';
import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';
import { WebviewBridge } from '../bridge';
import { BoardCrudOperations } from '../../board';
import { LinkOperations } from '../../utils/linkOperations';

/**
 * Dependencies required by LinkReplacementHandler
 */
export interface LinkReplacementDependencies {
    boardStore: BoardStore;
    fileRegistry: MarkdownFileRegistry;
    webviewBridge: WebviewBridge;
    getBoard: () => KanbanBoard | undefined;
}

export class LinkReplacementHandler {
    private _deps: LinkReplacementDependencies;
    private _unsubscribe: (() => void) | null = null;

    constructor(deps: LinkReplacementDependencies) {
        this._deps = deps;
        this._subscribe();
    }

    /**
     * Subscribe to link replacement events
     */
    private _subscribe(): void {
        this._unsubscribe = eventBus.on('link:replace-requested', async (event: LinkReplaceRequestedEvent) => {
            await this._handleLinkReplacement(event);
        });
    }

    /**
     * Handle link replacement request
     * Logic moved from KanbanWebviewPanel.handleLinkReplacement()
     */
    private async _handleLinkReplacement(event: LinkReplaceRequestedEvent): Promise<void> {
        const { originalPath, newPath, taskId, columnId, linkIndex } = event.data;

        const board = this._deps.getBoard();
        if (!board || !board.valid) {
            return;
        }

        // Capture undo state BEFORE modification (but don't save yet - only save if modification succeeds)
        let undoEntry: import('../stores/UndoCapture').UndoEntry;
        if (taskId && columnId) {
            undoEntry = UndoCapture.forTask(board, taskId, columnId, 'replaceLink');
        } else if (columnId) {
            undoEntry = UndoCapture.forColumn(board, columnId, 'replaceLink');
        } else {
            undoEntry = UndoCapture.forFullBoard(board, 'replaceLink');
        }

        let modified = false;

        // URL encode the new path for proper markdown links
        const encodedNewPath = encodeURI(newPath).replace(/[()]/g, (match) => {
            return match === '(' ? '%28' : '%29';
        });

        // If we have specific context, target only that link instance
        if (taskId && columnId) {
            modified = this._replaceInTask(board, columnId, taskId, originalPath, encodedNewPath, linkIndex);
        }
        // If no specific context but we have a columnId, target only that column
        else if (columnId && !taskId) {
            modified = this._replaceInColumn(board, columnId, originalPath, encodedNewPath, linkIndex);
        }
        // Fallback: global replacement (original behavior)
        else {
            modified = this._replaceGlobally(board, originalPath, encodedNewPath);
        }

        if (modified) {
            // Only save undo entry AFTER modification succeeds
            this._deps.boardStore.saveUndoEntry(undoEntry);

            // Mark as having unsaved changes but don't auto-save
            const mainFile = this._deps.fileRegistry.getMainFile();
            if (mainFile && board) {
                // CRITICAL: use updateFromBoard to update BOTH content AND board object
                mainFile.updateFromBoard(board);
            }

            // Send targeted update or emit full update request
            this._sendUpdate(board, taskId, columnId);
        }
    }

    /**
     * Replace link in a specific task
     */
    private _replaceInTask(
        board: KanbanBoard,
        columnId: string,
        taskId: string,
        originalPath: string,
        encodedNewPath: string,
        linkIndex?: number
    ): boolean {
        const targetColumn = BoardCrudOperations.findColumnById(board, columnId);
        if (!targetColumn) {
            console.warn(`[LinkReplacementHandler] Column ${columnId} not found for link replacement`);
            return false;
        }

        const targetTask = targetColumn.tasks.find(task => task.id === taskId);
        if (!targetTask) {
            console.warn(`[LinkReplacementHandler] Task ${taskId} not found for link replacement`);
            return false;
        }

        // Replace only the specific occurrence by index in the specific task
        // Check task title first
        const updatedTitle = LinkOperations.replaceSingleLink(targetTask.title, originalPath, encodedNewPath, linkIndex);
        if (updatedTitle !== targetTask.title) {
            targetTask.title = updatedTitle;
            return true;
        }

        // If not found in title and task has description, check description
        if (targetTask.description) {
            const updatedDescription = LinkOperations.replaceSingleLink(targetTask.description, originalPath, encodedNewPath, linkIndex);
            if (updatedDescription !== targetTask.description) {
                targetTask.description = updatedDescription;
                return true;
            }
        }

        return false;
    }

    /**
     * Replace link in a specific column title
     */
    private _replaceInColumn(
        board: KanbanBoard,
        columnId: string,
        originalPath: string,
        encodedNewPath: string,
        linkIndex?: number
    ): boolean {
        const targetColumn = BoardCrudOperations.findColumnById(board, columnId);
        if (!targetColumn) {
            console.warn(`[LinkReplacementHandler] Column ${columnId} not found for link replacement`);
            return false;
        }

        // Replace only the specific occurrence by index in the column title
        const updatedTitle = LinkOperations.replaceSingleLink(targetColumn.title, originalPath, encodedNewPath, linkIndex);
        if (updatedTitle !== targetColumn.title) {
            targetColumn.title = updatedTitle;
            return true;
        }

        return false;
    }

    /**
     * Replace link globally in all columns and tasks
     */
    private _replaceGlobally(
        board: KanbanBoard,
        originalPath: string,
        encodedNewPath: string
    ): boolean {
        let modified = false;

        const replaceLink = (text: string): string => {
            return LinkOperations.replaceSingleLink(text, originalPath, encodedNewPath);
        };

        // Search and replace in all columns and tasks
        for (const column of board.columns) {
            const newTitle = replaceLink(column.title);
            if (newTitle !== column.title) {
                column.title = newTitle;
                modified = true;
            }

            for (const task of column.tasks) {
                const newTaskTitle = replaceLink(task.title);
                if (newTaskTitle !== task.title) {
                    task.title = newTaskTitle;
                    modified = true;
                }

                if (task.description) {
                    const newDescription = replaceLink(task.description);
                    if (newDescription !== task.description) {
                        task.description = newDescription;
                        modified = true;
                    }
                }
            }
        }

        return modified;
    }

    /**
     * Send targeted update or request full board update
     */
    private _sendUpdate(board: KanbanBoard, taskId?: string, columnId?: string): void {
        // OPTIMIZATION: Send targeted update instead of full board redraw
        if (taskId && columnId) {
            const targetColumn = BoardCrudOperations.findColumnById(board, columnId);
            const targetTask = targetColumn?.tasks.find(task => task.id === taskId);
            if (targetTask) {
                this._deps.webviewBridge.sendBatched({
                    type: 'updateTaskContent',
                    taskId: taskId,
                    columnId: columnId,
                    task: targetTask,
                    imageMappings: {}
                });
                return;
            }
        } else if (columnId && !taskId) {
            const targetColumn = BoardCrudOperations.findColumnById(board, columnId);
            if (targetColumn) {
                this._deps.webviewBridge.sendBatched({
                    type: 'updateColumnContent',
                    columnId: columnId,
                    column: targetColumn,
                    imageMappings: {}
                });
                return;
            }
        }

        // Fallback: emit event for full board update
        eventBus.emitSync(createEvent('webview:update-requested', 'LinkReplacementHandler', {
            applyDefaultFolding: false,
            isFullRefresh: false
        }));
    }

    /**
     * Dispose handler and unsubscribe from events
     */
    public dispose(): void {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
    }
}
