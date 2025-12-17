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
    UpdateIncludeContentMessage,
    IncludesUpdatedMessage
} from '../core/bridge/MessageTypes';
import { ChangeStateMachine } from '../core/ChangeStateMachine';
import { PanelContext } from './PanelContext';
import { BoardCrudOperations } from '../board/BoardCrudOperations';

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
     * Sync include files with registry - creates instances for all includes in the board
     */
    syncIncludeFilesWithRegistry(board: KanbanBoard): void {
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

        // Update content of existing include files with board changes
        this._updateIncludeFilesContent(board);
    }

    // ============= CONTENT LOADING =============

    /**
     * Mark all columns/tasks with includes as loading
     */
    markIncludesAsLoading(board: KanbanBoard): void {
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                column.isLoadingContent = true;
            }
        }

        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    task.isLoadingContent = true;
                }
            }
        }
    }

    /**
     * Load and parse content from all include files, sending incremental updates
     */
    async loadIncludeContentAsync(board: KanbanBoard): Promise<void> {
        const mainFilePath = this._deps.getMainFile()?.getPath();

        // Load column includes
        await this._loadColumnIncludes(board, mainFilePath);

        // Load task includes
        await this._loadTaskIncludes(board);

        // Load regular includes
        await this._loadRegularIncludes();
    }

    private async _loadColumnIncludes(board: KanbanBoard, mainFilePath: string | undefined): Promise<void> {
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const file = this._deps.fileRegistry.getByRelativePath(relativePath) as IncludeFile;
                    if (file) {
                        try {
                            // Use forceSyncBaseline() instead of reload() to ensure
                            // baseline is properly set during initial loading.
                            // reload() uses _readFromDiskWithVerification() which may
                            // return old baseline in edge cases.
                            await file.forceSyncBaseline();
                            const tasks = file.parseToTasks(column.tasks, column.id, mainFilePath);
                            column.tasks = tasks;
                            column.isLoadingContent = false;

                            if (this._deps.state.includeSwitchInProgress) {
                                continue;
                            }

                            if (this._deps.getPanel()) {
                                const columnMsg: UpdateColumnContentExtendedMessage = {
                                    type: 'updateColumnContent',
                                    columnId: column.id,
                                    tasks: tasks,
                                    columnTitle: column.title,
                                    displayTitle: column.displayTitle,
                                    includeMode: true,
                                    includeFiles: column.includeFiles,
                                    isLoadingContent: false
                                };
                                this._deps.webviewBridge.sendBatched(columnMsg);
                            }
                        } catch (error) {
                            console.error(`[IncludeFileCoordinator] Failed to load column include ${relativePath}:`, error);
                            column.isLoadingContent = false;

                            if (this._deps.getPanel()) {
                                const errorMsg: UpdateColumnContentExtendedMessage = {
                                    type: 'updateColumnContent',
                                    columnId: column.id,
                                    tasks: [],
                                    columnTitle: column.title,
                                    displayTitle: column.displayTitle,
                                    includeMode: true,
                                    includeFiles: column.includeFiles,
                                    isLoadingContent: false,
                                    loadError: true
                                };
                                this._deps.webviewBridge.send(errorMsg);
                            }
                        }
                    }
                }
            }
        }
    }

    private async _loadTaskIncludes(board: KanbanBoard): Promise<void> {
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const file = this._deps.fileRegistry.getByRelativePath(relativePath) as IncludeFile;
                        if (file) {
                            try {
                                // Use forceSyncBaseline() instead of reload() to ensure
                                // baseline is properly set during initial loading
                                await file.forceSyncBaseline();
                                const fullFileContent = file.getContent();
                                const displayTitle = `# include in ${relativePath}`;

                                task.displayTitle = displayTitle;
                                task.description = fullFileContent;
                                task.isLoadingContent = false;
                                file.setContent(fullFileContent, true);

                                if (this._deps.state.includeSwitchInProgress) {
                                    continue;
                                }

                                if (this._deps.getPanel()) {
                                    const taskMsg: UpdateTaskContentExtendedMessage = {
                                        type: 'updateTaskContent',
                                        columnId: column.id,
                                        taskId: task.id,
                                        description: fullFileContent,
                                        displayTitle: displayTitle,
                                        taskTitle: task.title,
                                        originalTitle: task.originalTitle,
                                        includeMode: true,
                                        includeFiles: task.includeFiles,
                                        isLoadingContent: false
                                    };
                                    this._deps.webviewBridge.send(taskMsg);
                                }
                            } catch (error) {
                                console.error(`[IncludeFileCoordinator] Failed to load task include ${relativePath}:`, error);
                                task.isLoadingContent = false;

                                if (this._deps.getPanel()) {
                                    const errorMsg: UpdateTaskContentExtendedMessage = {
                                        type: 'updateTaskContent',
                                        columnId: column.id,
                                        taskId: task.id,
                                        description: '',
                                        displayTitle: task.displayTitle || '',
                                        taskTitle: task.title,
                                        originalTitle: task.originalTitle,
                                        includeMode: true,
                                        includeFiles: task.includeFiles,
                                        isLoadingContent: false,
                                        loadError: true
                                    };
                                    this._deps.webviewBridge.send(errorMsg);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private async _loadRegularIncludes(): Promise<void> {
        const mainFile = this._deps.fileRegistry.getMainFile();
        if (!mainFile) return;

        const regularIncludes = mainFile.getIncludedFiles();

        for (const relativePath of regularIncludes) {
            const file = this._deps.fileRegistry.getByRelativePath(relativePath) as IncludeFile;
            if (file) {
                try {
                    // Use forceSyncBaseline() instead of reload() to ensure
                    // baseline is properly set during initial loading
                    await file.forceSyncBaseline();
                    const content = file.getContent();

                    if (this._deps.getPanel()) {
                        const includeMsg: UpdateIncludeContentMessage = {
                            type: 'updateIncludeContent',
                            filePath: relativePath,
                            content: content
                        };
                        this._deps.webviewBridge.sendBatched(includeMsg);
                    }
                } catch (error) {
                    console.error(`[IncludeFileCoordinator] Failed to load regular include ${relativePath}:`, error);
                }
            }
        }

        if (regularIncludes.length > 0 && this._deps.getPanel()) {
            const updatedMsg: IncludesUpdatedMessage = {
                type: 'includesUpdated'
            };
            this._deps.webviewBridge.sendBatched(updatedMsg);
        }
    }

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
            ? BoardCrudOperations.findColumnById(board, params.columnId)
            : BoardCrudOperations.findColumnContainingTask(board, params.taskId!)) : undefined;

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
        // Find column that uses this include file
        const column = board.columns.find(c =>
            c.includeFiles && c.includeFiles.some(p => MarkdownFile.isSameFile(p, relativePath))
        );

        if (column) {
            // Parse tasks from updated file
            const columnFile = file as IncludeFile;
            const mainFilePath = this._deps.getMainFile()?.getPath();
            const tasks = columnFile.parseToTasks(column.tasks, column.id, mainFilePath);
            column.tasks = tasks;

            // Send update to frontend
            const columnMessage: UpdateColumnContentExtendedMessage = {
                type: 'updateColumnContent',
                columnId: column.id,
                tasks: tasks,
                columnTitle: column.title,
                displayTitle: column.displayTitle,
                includeMode: true,
                includeFiles: column.includeFiles
            };
            this._deps.webviewBridge.send(columnMessage);
        }
    }

    /**
     * Send task include file update to frontend
     */
    private _sendTaskIncludeUpdate(file: MarkdownFile, board: KanbanBoard, relativePath: string): void {
        // Find task that uses this include file
        let foundTask: KanbanTask | undefined;
        let foundColumn: KanbanColumn | undefined;

        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.some((p: string) => MarkdownFile.isSameFile(p, relativePath))) {
                    foundTask = task;
                    foundColumn = column;
                    break;
                }
            }
            if (foundTask) break;
        }

        if (foundTask && foundColumn) {
            // Get updated content from file
            const fullContent = file.getContent();
            const displayTitle = `# include in ${relativePath}`;

            // Update task
            foundTask.displayTitle = displayTitle;
            foundTask.description = fullContent;

            // Send update to frontend
            const taskMessage: UpdateTaskContentExtendedMessage = {
                type: 'updateTaskContent',
                columnId: foundColumn.id,
                taskId: foundTask.id,
                description: fullContent,
                displayTitle: displayTitle,
                taskTitle: foundTask.title,
                originalTitle: foundTask.originalTitle,
                includeMode: true,
                includeFiles: foundTask.includeFiles
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
        const includeContentMessage: UpdateIncludeContentMessage = {
            type: 'updateIncludeContent',
            filePath: relativePath,
            content: content
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

    // ============= PRIVATE HELPERS =============

    /**
     * Update content of existing include files with board changes
     * Note: A file can be used in multiple contexts - use board context, not file type
     */
    private _updateIncludeFilesContent(board: KanbanBoard): void {
        // Update column include files
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const file = this._deps.fileRegistry.getByRelativePath(relativePath);
                    if (file) {
                        const columnIncludeFile = file as IncludeFile;
                        columnIncludeFile.updateTasks(column.tasks);
                    }
                }
            }
        }

        // Update task include files
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const file = this._deps.fileRegistry.getByRelativePath(relativePath);
                        if (file) {
                            const taskContent = task.description || '';
                            file.setContent(taskContent, false);
                        }
                    }
                }
            }
        }
    }
}
