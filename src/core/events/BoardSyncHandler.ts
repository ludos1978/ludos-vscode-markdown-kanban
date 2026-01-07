/**
 * BoardSyncHandler - Handles board:changed events
 *
 * Contains the logic previously in syncBoardToBackend().
 * Subscribes to 'board:changed' events and syncs board state to files.
 *
 * Responsibilities:
 * 1. Normalize board (sort columns by row)
 * 2. Update BoardStore
 * 3. Update MainKanbanFile's cached board
 * 4. Update include file content from board
 * 5. Generate markdown and update main file content
 * 6. Update media tracking
 * 7. Create auto-backup
 */

import * as vscode from 'vscode';
import { eventBus, BoardChangedEvent, BoardLoadedEvent, createEvent } from './index';
import { KanbanBoard, MarkdownKanbanParser } from '../../markdownParser';
import { BoardStore } from '../stores';
import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';
import { IncludeFile } from '../../files/IncludeFile';
import { MediaTracker } from '../../services/MediaTracker';
import { BackupManager } from '../../services/BackupManager';
import { sortColumnsByRow } from '../../utils/columnUtils';
import { safeDecodeURIComponent } from '../../utils/stringUtils';
import { PanelContext } from '../../panel/PanelContext';

/**
 * Dependencies required by BoardSyncHandler
 */
export interface BoardSyncDependencies {
    boardStore: BoardStore;
    fileRegistry: MarkdownFileRegistry;
    getMediaTracker: () => MediaTracker | null;  // Getter because MediaTracker is created lazily
    backupManager: BackupManager;
    getDocument: () => vscode.TextDocument | undefined;
    panelContext: PanelContext;  // Panel context for scoped event bus
}

export class BoardSyncHandler {
    private _deps: BoardSyncDependencies;
    private _unsubscribeChanged: (() => void) | null = null;
    private _unsubscribeLoaded: (() => void) | null = null;

    constructor(deps: BoardSyncDependencies) {
        this._deps = deps;
        this._subscribe();
    }

    /**
     * Subscribe to board events on the panel's scoped event bus.
     * This ensures events from other panels don't trigger this handler.
     */
    private _subscribe(): void {
        const scopedBus = this._deps.panelContext.scopedEventBus;

        // Subscribe to board:changed for sync operations
        this._unsubscribeChanged = scopedBus.on<{ board: KanbanBoard }>('board:changed', async (data) => {
            await this._handleBoardChanged({ data } as BoardChangedEvent);
        });

        // Subscribe to board:loaded for post-initialization media tracking
        this._unsubscribeLoaded = scopedBus.on<{ board: KanbanBoard }>('board:loaded', (data) => {
            this._handleBoardLoaded({ data } as BoardLoadedEvent);
        });
    }

    /**
     * Handle board:loaded event - update media tracking after initial load
     */
    private _handleBoardLoaded(_event: BoardLoadedEvent): void {
        // After board loads and include files are ready, update media tracking
        this._updateMediaTrackingFromIncludes();
    }

    /**
     * Handle board:changed event - sync board state to files
     *
     * This is the logic previously in syncBoardToBackend()
     */
    private async _handleBoardChanged(event: BoardChangedEvent): Promise<void> {
        const { board } = event.data;

        if (!this._deps.fileRegistry.isReady()) {
            return;
        }

        // 1. Normalize board: Sort columns by row before storing
        // This ensures consistency between board store and generated markdown.
        // generateMarkdown() uses sortColumnsByRow(), so we must store in same order.
        const normalizedBoard: KanbanBoard = {
            ...board,
            columns: sortColumnsByRow(board.columns)
        };

        // 2. Update BoardStore
        this._deps.boardStore.setBoard(normalizedBoard);

        // 3. Update MainKanbanFile's cached board for conflict detection
        const mainFile = this._deps.fileRegistry.getMainFile();
        if (mainFile) {
            mainFile.setCachedBoardFromWebview(normalizedBoard);
        }

        if (event.data.trigger === 'undo' || event.data.trigger === 'redo') {
            console.log('[kanban.BoardSyncHandler.undoRedo.start]', {
                trigger: event.data.trigger,
                columnCount: normalizedBoard.columns.length,
                includeColumns: normalizedBoard.columns.filter(col => col.includeFiles && col.includeFiles.length > 0).map(col => col.id)
            });
        }

        // 4. Propagate board edits to include files (updates their in-memory content)
        await this._propagateEditsToIncludeFiles(normalizedBoard, event.data.trigger);

        // 5. Generate markdown and update main file content
        if (mainFile) {
            const markdown = MarkdownKanbanParser.generateMarkdown(normalizedBoard);
            mainFile.setContent(markdown, false); // false = don't update baseline

            // 5b. Update media tracking
            const mediaTracker = this._deps.getMediaTracker();
            if (mediaTracker) {
                mediaTracker.updateTrackedFiles(markdown);
                this._updateMediaTrackingFromIncludes();
            }

            // 6. Emit file:content-changed event for other handlers
            const includeFiles = this._deps.fileRegistry.getIncludeFiles();
            eventBus.emitSync(createEvent('file:content-changed', 'BoardSyncHandler', {
                mainFileContent: markdown,
                includeFiles: includeFiles.map(f => ({
                    path: f.getPath(),
                    content: f.getContent() || ''
                }))
            }));
        }

        // 7. Create auto-backup if minimum interval has passed
        const document = this._deps.getDocument();
        if (document) {
            this._deps.backupManager.createBackup(document, { label: 'auto' })
                .catch(error => console.error('[BoardSyncHandler] Backup failed:', error));
        }
    }

    /**
     * Propagate board edits to include files
     *
     * When user edits tasks in the webview, this writes those changes to the
     * corresponding include files (column includes and task includes).
     * This is the reverse of loading include content into the board.
     */
    private async _propagateEditsToIncludeFiles(board: KanbanBoard, trigger?: string): Promise<void> {
        // Update column include files with current task content
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const decodedPath = safeDecodeURIComponent(relativePath);
                    const file = this._deps.fileRegistry.getByRelativePath(decodedPath)
                        || this._deps.fileRegistry.get(decodedPath);
                    if (!file) {
                        if (trigger === 'undo' || trigger === 'redo') {
                            console.warn('[kanban.BoardSyncHandler.undoRedo.includeColumnMissing]', {
                                trigger,
                                columnId: column.id,
                                includePath: relativePath,
                                decodedPath: decodedPath
                            });
                        }
                        continue;
                    }

                    // CRITICAL FIX: Type guard to prevent writing to MainKanbanFile
                    // This prevents cache corruption if include path matches main file
                    if (file.getFileType() === 'main') {
                        console.error(`[BoardSyncHandler] BUG: Refusing to write include content to MainKanbanFile: ${relativePath}`);
                        continue;
                    }

                    const includeFile = file as IncludeFile;
                    const content = includeFile.generateFromTasks(column.tasks);
                    const currentContent = includeFile.getContent();

                    // CRITICAL PROTECTION: Never replace existing content with empty
                    if (!content.trim() && currentContent.trim()) {
                        console.warn(`[BoardSyncHandler] PROTECTED: Refusing to wipe column content to empty`);
                        continue;
                    }

                    // Only update if content differs from current cached content
                    if (content !== currentContent) {
                        if (trigger === 'undo' || trigger === 'redo') {
                            console.log('[kanban.BoardSyncHandler.undoRedo.includeColumnUpdate]', {
                                trigger,
                                columnId: column.id,
                                includePath: includeFile.getPath(),
                                taskCount: column.tasks.length,
                                contentLength: content.length
                            });
                        }
                        includeFile.setContent(content, false);

                        const includePath = includeFile.getPath();
                        const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === includePath);
                        if (openDoc) {
                            const openContent = openDoc.getText();
                            if (openContent !== content) {
                                console.log('[kanban.BoardSyncHandler.include.openDocUpdate]', {
                                    includePath,
                                    isDirty: openDoc.isDirty,
                                    contentLength: content.length
                                });
                                const edit = new vscode.WorkspaceEdit();
                                const fullRange = new vscode.Range(0, 0, openDoc.lineCount, 0);
                                edit.replace(openDoc.uri, fullRange, content);
                                await vscode.workspace.applyEdit(edit);
                            }
                        }
                    }
                }
            }
        }

        // Update task include files with current task content
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const decodedPath = safeDecodeURIComponent(relativePath);
                        const file = this._deps.fileRegistry.getByRelativePath(decodedPath)
                            || this._deps.fileRegistry.get(decodedPath);
                        if (!file) {
                            if (trigger === 'undo' || trigger === 'redo') {
                                console.warn('[kanban.BoardSyncHandler.undoRedo.includeTaskMissing]', {
                                    trigger,
                                    taskId: task.id,
                                    includePath: relativePath,
                                    decodedPath: decodedPath
                                });
                            }
                            continue;
                        }

                        // CRITICAL FIX: Type guard to prevent writing to MainKanbanFile
                        // This prevents cache corruption if include path matches main file
                        if (file.getFileType() === 'main') {
                            console.error(`[BoardSyncHandler] BUG: Refusing to write task include content to MainKanbanFile: ${relativePath}`);
                            continue;
                        }

                        const includeFile = file as IncludeFile;
                        const fullContent = task.description || '';
                        const currentContent = includeFile.getContent();

                        // CRITICAL PROTECTION: Never replace existing content with empty
                        if (!fullContent.trim() && currentContent.trim()) {
                            console.warn(`[BoardSyncHandler] PROTECTED: Refusing to wipe task content to empty`);
                            continue;
                        }

                        // Only update if content differs from current cached content
                        if (fullContent !== currentContent) {
                            if (trigger === 'undo' || trigger === 'redo') {
                                console.log('[kanban.BoardSyncHandler.undoRedo.includeTaskUpdate]', {
                                    trigger,
                                    taskId: task.id,
                                    includePath: includeFile.getPath(),
                                    contentLength: fullContent.length
                                });
                            }
                            includeFile.setTaskDescription(fullContent);

                            const includePath = includeFile.getPath();
                            const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === includePath);
                            if (openDoc) {
                                const openContent = openDoc.getText();
                                if (openContent !== fullContent) {
                                    console.log('[kanban.BoardSyncHandler.include.openDocUpdate]', {
                                        includePath,
                                        isDirty: openDoc.isDirty,
                                        contentLength: fullContent.length
                                    });
                                    const edit = new vscode.WorkspaceEdit();
                                    const fullRange = new vscode.Range(0, 0, openDoc.lineCount, 0);
                                    edit.replace(openDoc.uri, fullRange, fullContent);
                                    await vscode.workspace.applyEdit(edit);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Update media tracking from include files
     *
     * This is the logic previously in _updateMediaTrackingFromIncludes()
     */
    private _updateMediaTrackingFromIncludes(): void {
        const mediaTracker = this._deps.getMediaTracker();
        if (!mediaTracker) {
            return;
        }

        const includeFiles = this._deps.fileRegistry.getIncludeFiles();

        for (const includeFile of includeFiles) {
            const content = includeFile.getContent();
            if (content) {
                mediaTracker.addTrackedFiles(content);
            }
        }
    }

    /**
     * Dispose handler and unsubscribe from events
     */
    public dispose(): void {
        if (this._unsubscribeChanged) {
            this._unsubscribeChanged();
            this._unsubscribeChanged = null;
        }
        if (this._unsubscribeLoaded) {
            this._unsubscribeLoaded();
            this._unsubscribeLoaded = null;
        }
    }
}
