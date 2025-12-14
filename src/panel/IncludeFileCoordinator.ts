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

import { KanbanBoard, KanbanTask } from '../markdownParser';
import { MarkdownFileRegistry, FileFactory, MainKanbanFile, IncludeFile } from '../files';
import { WebviewBridge } from '../core/bridge';
import { ChangeStateMachine } from '../core/ChangeStateMachine';
import { PanelContext } from './PanelContext';

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

        let createdCount = 0;

        // Sync column includes
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const existingFile = this._deps.fileRegistry.getByRelativePath(relativePath);

                    // Check if file exists with WRONG type
                    if (existingFile && existingFile.getFileType() !== 'include-column') {
                        console.warn(`[IncludeFileCoordinator] File ${relativePath} registered as ${existingFile.getFileType()} but should be include-column! Replacing...`);
                        this._deps.fileRegistry.unregister(relativePath);
                    }

                    if (!this._deps.fileRegistry.hasByRelativePath(relativePath)) {
                        const columnInclude = this._deps.fileFactory.createIncludeDirect(
                            relativePath,
                            mainFile,
                            'include-column',
                            false
                        );

                        columnInclude.setColumnId(column.id);
                        columnInclude.setColumnTitle(column.title);
                        this._deps.fileRegistry.register(columnInclude);
                        columnInclude.startWatching();
                        createdCount++;
                    }
                }
            }
        }

        // Sync task includes
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const existingFile = this._deps.fileRegistry.getByRelativePath(relativePath);

                        if (existingFile && existingFile.getFileType() !== 'include-task') {
                            console.warn(`[IncludeFileCoordinator] File ${relativePath} registered as ${existingFile.getFileType()} but should be include-task! Replacing...`);
                            this._deps.fileRegistry.unregister(relativePath);
                        }

                        if (!this._deps.fileRegistry.hasByRelativePath(relativePath)) {
                            const taskInclude = this._deps.fileFactory.createIncludeDirect(
                                relativePath,
                                mainFile,
                                'include-task',
                                false
                            );

                            taskInclude.setTaskId(task.id);
                            taskInclude.setTaskTitle(task.title);
                            taskInclude.setColumnId(column.id);
                            this._deps.fileRegistry.register(taskInclude);
                            taskInclude.startWatching();
                            createdCount++;
                        }
                    }
                }
            }
        }

        // Sync regular includes (!!!include(path)!!! in task descriptions)
        const regularIncludes = mainFile.getIncludedFiles();
        for (const relativePath of regularIncludes) {
            const existingFile = this._deps.fileRegistry.getByRelativePath(relativePath);

            if (existingFile && existingFile.getFileType() !== 'include-regular') {
                console.warn(`[IncludeFileCoordinator] File ${relativePath} registered as ${existingFile.getFileType()} but should be include-regular! Replacing...`);
                this._deps.fileRegistry.unregister(relativePath);
            }

            if (!this._deps.fileRegistry.hasByRelativePath(relativePath)) {
                const regularInclude = this._deps.fileFactory.createIncludeDirect(
                    relativePath,
                    mainFile,
                    'include-regular',
                    true // Regular includes are inline
                );

                this._deps.fileRegistry.register(regularInclude);
                regularInclude.startWatching();
                createdCount++;
            }
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
                            await file.reload();
                            const tasks = file.parseToTasks(column.tasks, column.id, mainFilePath);
                            column.tasks = tasks;
                            column.isLoadingContent = false;

                            if (this._deps.state.includeSwitchInProgress) {
                                continue;
                            }

                            if (this._deps.getPanel()) {
                                this._deps.webviewBridge.sendBatched({
                                    type: 'updateColumnContent',
                                    columnId: column.id,
                                    tasks: tasks,
                                    columnTitle: column.title,
                                    displayTitle: column.displayTitle,
                                    includeMode: true,
                                    includeFiles: column.includeFiles,
                                    isLoadingContent: false
                                } as any);
                            }
                        } catch (error) {
                            console.error(`[IncludeFileCoordinator] Failed to load column include ${relativePath}:`, error);
                            column.isLoadingContent = false;

                            if (this._deps.getPanel()) {
                                this._deps.webviewBridge.send({
                                    type: 'updateColumnContent',
                                    columnId: column.id,
                                    tasks: [],
                                    columnTitle: column.title,
                                    displayTitle: column.displayTitle,
                                    includeMode: true,
                                    includeFiles: column.includeFiles,
                                    isLoadingContent: false,
                                    loadError: true
                                } as any);
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
                                await file.reload();
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
                                    this._deps.webviewBridge.send({
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
                                    } as any);
                                }
                            } catch (error) {
                                console.error(`[IncludeFileCoordinator] Failed to load task include ${relativePath}:`, error);
                                task.isLoadingContent = false;

                                if (this._deps.getPanel()) {
                                    this._deps.webviewBridge.send({
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
                                    } as any);
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
                    await file.reload();
                    const content = file.getContent();

                    if (this._deps.getPanel()) {
                        this._deps.webviewBridge.sendBatched({
                            type: 'updateIncludeContent',
                            filePath: relativePath,
                            content: content
                        } as any);
                    }
                } catch (error) {
                    console.error(`[IncludeFileCoordinator] Failed to load regular include ${relativePath}:`, error);
                }
            }
        }

        if (regularIncludes.length > 0 && this._deps.getPanel()) {
            this._deps.webviewBridge.sendBatched({
                type: 'includesUpdated'
            } as any);
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
        const column = params.columnId
            ? board?.columns.find((c: any) => c.id === params.columnId)
            : board?.columns.find((c: any) => c.tasks.some((t: any) => t.id === params.taskId));

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

    // ============= PRIVATE HELPERS =============

    /**
     * Update content of existing include files with board changes
     */
    private _updateIncludeFilesContent(board: KanbanBoard): void {
        // Update column include files
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const file = this._deps.fileRegistry.getByRelativePath(relativePath);
                    if (file && file.getFileType() === 'include-column') {
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
                        if (file && file.getFileType() === 'include-task') {
                            const taskContent = task.description || '';
                            file.setContent(taskContent, false);
                        }
                    }
                }
            }
        }
    }
}
