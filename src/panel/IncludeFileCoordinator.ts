/**
 * IncludeFileCoordinator - Manages include file lifecycle and content synchronization
 *
 * Handles:
 * - Include file registration and tracking
 * - Async content loading with incremental updates
 * - Include switch operations
 * - Bidirectional editing (saving changes back to include files)
 *
 * @module panel/IncludeFileCoordinator
 */

import { KanbanBoard, KanbanTask, KanbanColumn } from '../markdownParser';
import { MarkdownFileRegistry, FileFactory, MainKanbanFile, IncludeFile, MarkdownFile } from '../files';
import { WebviewBridge } from '../core/bridge';
import {
    UpdateColumnContentExtendedMessage,
    UpdateTaskContentExtendedMessage,
    UpdateIncludeContentMessage
} from '../core/bridge/MessageTypes';
import { ChangeStateMachine } from '../core/ChangeStateMachine';
import { PanelContext } from './PanelContext';
import { findColumn, findColumnContainingTask } from '../actions/helpers';

/**
 * Dependencies required by IncludeFileCoordinator
 */
export interface IncludeCoordinatorDependencies {
    fileRegistry: MarkdownFileRegistry;
    fileFactory: FileFactory;
    webviewBridge: WebviewBridge;
    stateMachine: ChangeStateMachine;
    state: PanelContext;
    getPanel: () => any | undefined;
    getBoard: () => KanbanBoard | undefined;
    getMainFile: () => MainKanbanFile | undefined;
}

/**
 * IncludeFileCoordinator - Single-responsibility module for include file management
 */
export class IncludeFileCoordinator {
    private _deps: IncludeCoordinatorDependencies;

    constructor(deps: IncludeCoordinatorDependencies) {
        this._deps = deps;
    }

    // ============= INCLUDE FILE REGISTRATION =============

    /**
     * Register all include files from the board into the file registry
     *
     * Scans the board for column includes, task includes, and regular includes,
     * and creates IncludeFile instances in the registry for each one.
     */
    registerBoardIncludeFiles(board: KanbanBoard): void {
        const mainFile = this._deps.fileRegistry.getMainFile();
        if (!mainFile) {
            console.warn(`[IncludeFileCoordinator] Cannot sync include files - no main file in registry`);
            return;
        }

        // Sync column includes
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    this._deps.fileRegistry.ensureIncludeRegistered(
                        relativePath,
                        'include-column',
                        this._deps.fileFactory,
                        mainFile,
                        { columnId: column.id, columnTitle: column.title }
                    );
                }
            }
        }

        // Sync task includes
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        this._deps.fileRegistry.ensureIncludeRegistered(
                            relativePath,
                            'include-task',
                            this._deps.fileFactory,
                            mainFile,
                            { columnId: column.id, taskId: task.id, taskTitle: task.title }
                        );
                    }
                }
            }
        }

        // Sync regular includes (!!!include(path)!!! in task descriptions)
        const regularIncludes = mainFile.getIncludedFiles();
        for (const relativePath of regularIncludes) {
            this._deps.fileRegistry.ensureIncludeRegistered(
                relativePath,
                'include-regular',
                this._deps.fileFactory,
                mainFile,
                {}
            );
        }

        // NOTE: Content loading is handled by FileSyncHandler.reloadExternallyModifiedFiles()
        // which is called after registration completes.
    }

    // NOTE: The following functions have been migrated to FileSyncHandler:
    // - markIncludesAsLoading() - No longer needed with unified sync approach
    // - loadIncludeContentAsync() - Replaced by FileSyncHandler.reloadExternallyModifiedFiles({ force: true })
    // - _loadColumnIncludes() - Logic now in FileSyncHandler._reloadChangedIncludeFiles()
    // - _loadTaskIncludes() - Logic now in FileSyncHandler._reloadChangedIncludeFiles()
    // - _loadRegularIncludes() - Logic now in FileSyncHandler._reloadChangedIncludeFiles()
    //
    // INIT and FOCUS now use the SAME unified code path:
    // - INIT: FileSyncHandler.reloadExternallyModifiedFiles({ force: true })  - Load all files
    // - FOCUS: FileSyncHandler.reloadExternallyModifiedFiles({ force: false }) - Check and reload changed

    // ============= INCLUDE SWITCH =============

    /**
     * Handle include file switch triggered by user edit
     */
    async handleIncludeSwitch(params: {
        columnId?: string;
        taskId?: string;
        oldFiles: string[];
        newFiles: string[];
        newTitle?: string;
        preloadedContent?: Map<string, string>;
    }): Promise<void> {
        const board = this._deps.getBoard();
        const column = board ? (params.columnId
            ? findColumn(board, params.columnId)
            : findColumnContainingTask(board, params.taskId!)) : undefined;

        const result = await this._deps.stateMachine.processChange({
            type: 'include_switch',
            target: params.columnId ? 'column' : 'task',
            targetId: params.columnId || params.taskId!,
            columnIdForTask: params.columnId ? undefined : column?.id,
            oldFiles: params.oldFiles,
            newFiles: params.newFiles,
            newTitle: params.newTitle,
            preloadedContent: params.preloadedContent
        });

        if (!result.success) {
            console.error('[IncludeFileCoordinator] Include switch failed:', result.error);
            throw result.error || new Error('Include switch failed');
        }
    }

    // ============= FRONTEND UPDATE BROADCASTING =============

    /**
     * Send updated include file content to frontend
     * Called after file has been reloaded (from external change or manual reload)
     */
    sendIncludeFileUpdateToFrontend(file: MarkdownFile): void {
        const board = this._deps.getBoard();
        if (!board || !this._deps.getPanel()) {
            console.warn(`[IncludeFileCoordinator] No board or panel available for update`);
            return;
        }

        const relativePath = file.getRelativePath();
        const fileType = file.getFileType();

        if (fileType === 'include-column') {
            this._sendColumnIncludeUpdate(file, board, relativePath);
        } else if (fileType === 'include-task') {
            this._sendTaskIncludeUpdate(file, board, relativePath);
        } else if (fileType === 'include-regular') {
            this._sendRegularIncludeUpdate(file, board, relativePath);
        }
    }

    /**
     * Send column include file update to frontend
     */
    private _sendColumnIncludeUpdate(file: MarkdownFile, board: KanbanBoard, relativePath: string): void {
        const filePath = file.getPath();
        const isDebug = this._deps.state.debugMode;
        // Find column that uses this include file
        const column = board.columns.find(c =>
            c.includeFiles && c.includeFiles.some(p =>
                MarkdownFile.isSameFile(p, relativePath) || MarkdownFile.isSameFile(p, filePath)
            )
        );

        if (!column) {
            if (isDebug) {
                console.warn('[kanban.IncludeFileCoordinator.includeColumn.noMatch]', {
                    relativePath,
                    filePath,
                    boardColumns: board.columns.map(c => ({
                        id: c.id,
                        includeFiles: c.includeFiles || []
                    }))
                });
            }
            return;
        }

        if (column) {
            // CRITICAL FIX: Type guard to prevent treating MainKanbanFile as IncludeFile
            if (file.getFileType() === 'main') {
                console.error(`[IncludeFileCoordinator] BUG: Column include path resolved to MainKanbanFile: ${relativePath}`);
                column.tasks = [];
                column.includeError = true;
                return;
            }

            const columnFile = file as IncludeFile;
            const mainFilePath = this._deps.getMainFile()?.getPath();

            // Check if file exists before using content
            const fileExists = file.exists();
            let tasks: KanbanTask[];
            let includeError: boolean;

            if (isDebug) {
                console.log('[kanban.IncludeFileCoordinator.includeColumn.update]', {
                    columnId: column.id,
                    columnTitle: column.title,
                    relativePath,
                    filePath,
                    fileExists,
                    includeFiles: column.includeFiles || [],
                    previousTaskCount: column.tasks?.length ?? 0
                });
            }

            if (fileExists) {
                // Parse tasks from updated file
                tasks = columnFile.parseToTasks(column.tasks, column.id, mainFilePath);
                includeError = false;
            } else {
                // File doesn't exist - error details shown on hover via include badge
                // Don't create error task - just show empty column with error badge
                console.warn(`[IncludeFileCoordinator] Column include file does not exist: ${relativePath}`);
                tasks = [];
                includeError = true;
            }

            column.tasks = tasks;
            column.includeError = includeError;

            if (isDebug) {
                console.log('[kanban.IncludeFileCoordinator.includeColumn.parsed]', {
                    columnId: column.id,
                    relativePath,
                    taskCount: tasks.length,
                    taskIds: tasks.map(task => task.id),
                    includeError
                });
            }

            // Send update to frontend
            const columnMessage: UpdateColumnContentExtendedMessage = {
                type: 'updateColumnContent',
                columnId: column.id,
                tasks: tasks,
                columnTitle: column.title,
                displayTitle: column.displayTitle,
                includeMode: true,
                includeFiles: column.includeFiles,
                includeError: includeError
            };
            this._deps.webviewBridge.send(columnMessage);
        }
    }

    /**
     * Send task include file update to frontend
     */
    private _sendTaskIncludeUpdate(file: MarkdownFile, board: KanbanBoard, relativePath: string): void {
        const filePath = file.getPath();
        const isDebug = this._deps.state.debugMode;
        // Find task that uses this include file
        let foundTask: KanbanTask | undefined;
        let foundColumn: KanbanColumn | undefined;

        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.some((p: string) =>
                    MarkdownFile.isSameFile(p, relativePath) || MarkdownFile.isSameFile(p, filePath)
                )) {
                    foundTask = task;
                    foundColumn = column;
                    break;
                }
            }
            if (foundTask) break;
        }

        if (!foundTask || !foundColumn) {
            if (isDebug) {
                console.warn('[kanban.IncludeFileCoordinator.includeTask.noMatch]', {
                    relativePath,
                    filePath,
                    boardColumns: board.columns.map(column => ({
                        id: column.id,
                        taskIds: column.tasks.map(task => task.id),
                        includeTasks: column.tasks
                            .filter(task => Array.isArray(task.includeFiles) && task.includeFiles.length > 0)
                            .map(task => ({ id: task.id, includeFiles: task.includeFiles || [] }))
                    }))
                });
                console.warn(`[IncludeFileCoordinator] No task found for include file: ${relativePath}`);
            }
            return;
        }

        if (foundTask && foundColumn) {
            // CRITICAL FIX: Type guard to prevent treating MainKanbanFile as IncludeFile
            if (file.getFileType() === 'main') {
                console.error(`[IncludeFileCoordinator] BUG: Task include path resolved to MainKanbanFile: ${relativePath}`);
                foundTask.description = '';
                foundTask.includeError = true;
                return;
            }

            const displayTitle = `# include in ${relativePath}`;

            // Check if file exists before using content
            const fileExists = file.exists();
            let description: string;
            let includeError: boolean;

            if (isDebug) {
                console.log('[kanban.IncludeFileCoordinator.includeTask.update]', {
                    columnId: foundColumn.id,
                    taskId: foundTask.id,
                    taskTitle: foundTask.title,
                    relativePath,
                    filePath,
                    fileExists
                });
            }

            if (fileExists) {
                // Get updated content from file
                description = file.getContent() || '';
                includeError = false;
            } else {
                // File doesn't exist - error details shown on hover via include badge
                console.warn(`[IncludeFileCoordinator] Task include file does not exist: ${relativePath}`);
                description = '';
                includeError = true;
            }

            // Update task
            foundTask.displayTitle = displayTitle;
            foundTask.description = description;
            foundTask.includeError = includeError;

            if (isDebug) {
                console.log('[kanban.IncludeFileCoordinator.includeTask.parsed]', {
                    columnId: foundColumn.id,
                    taskId: foundTask.id,
                    relativePath,
                    contentLength: description.length,
                    includeError
                });
            }

            // Send update to frontend
            const taskMessage: UpdateTaskContentExtendedMessage = {
                type: 'updateTaskContent',
                columnId: foundColumn.id,
                taskId: foundTask.id,
                description: description,
                displayTitle: displayTitle,
                taskTitle: foundTask.title,
                originalTitle: foundTask.originalTitle,
                includeMode: true,
                includeFiles: foundTask.includeFiles,
                includeError: includeError
            };
            this._deps.webviewBridge.send(taskMessage);
        }
    }

    /**
     * Send regular include file update to frontend
     */
    private _sendRegularIncludeUpdate(file: MarkdownFile, board: KanbanBoard, relativePath: string): void {
        // Send updated include content to frontend cache
        const content = file.getContent();
        const fileExists = file.exists();
        const includeContentMessage: UpdateIncludeContentMessage = {
            type: 'updateIncludeContent',
            filePath: relativePath,
            content: content,
            error: fileExists ? undefined : `File not found: ${relativePath}`
        };
        this._deps.webviewBridge.sendBatched(includeContentMessage);

        // Find all tasks that use this regular include
        const affectedTasks: Array<{task: KanbanTask, column: KanbanColumn}> = [];
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.regularIncludeFiles?.length) {
                    const hasThisInclude = task.regularIncludeFiles.some((p: string) =>
                        MarkdownFile.isSameFile(p, relativePath)
                    );

                    if (hasThisInclude) {
                        affectedTasks.push({ task, column });
                    }
                }
            }
        }

        // Send targeted updates for each affected task
        for (const {task, column} of affectedTasks) {
            const regularTaskMessage: UpdateTaskContentExtendedMessage = {
                type: 'updateTaskContent',
                columnId: column.id,
                taskId: task.id,
                description: task.description,
                displayTitle: task.displayTitle,
                taskTitle: task.title,
                originalTitle: task.originalTitle,
                includeMode: false,
                regularIncludeFiles: task.regularIncludeFiles
            };
            this._deps.webviewBridge.sendBatched(regularTaskMessage);
        }
    }

    // NOTE: _updateIncludeFilesContent() has been deleted.
    // Content updates during INIT are handled by FileSyncHandler.reloadExternallyModifiedFiles({ force: true })
    // Content updates during EDIT are handled by BoardSyncHandler._propagateEditsToIncludeFiles()
}
