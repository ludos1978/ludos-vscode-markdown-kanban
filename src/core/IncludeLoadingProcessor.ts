/**
 * IncludeLoadingProcessor - Handles include file loading during state machine transitions
 *
 * Extracted from ChangeStateMachine._handleLoadingNew to improve readability.
 * This class handles the complex logic of loading, creating, and updating
 * include files during include switch operations.
 *
 * @module core/IncludeLoadingProcessor
 */

import * as path from 'path';
import { INCLUDE_SYNTAX, createDisplayTitleWithPlaceholders } from '../constants/IncludeConstants';
import { ChangeContext, IncludeSwitchEvent, UserEditEvent } from './ChangeTypes';
import { KanbanBoard, KanbanColumn, KanbanTask } from '../board/KanbanTypes';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import { FileFactory } from '../files/FileFactory';
import { MarkdownFile } from '../files/MarkdownFile';
import { MainKanbanFile } from '../files/MainKanbanFile';
import { IncludeFile } from '../files/IncludeFile';

/**
 * Interface for webview panel dependencies needed by this processor
 */
export interface IWebviewPanelForProcessor {
    getBoard(): KanbanBoard | undefined;
    fileFactory: FileFactory;
    fileRegistry: MarkdownFileRegistry;
}

/**
 * Result of resolving the target column/task for an include switch
 */
export interface TargetResolution {
    targetColumn: KanbanColumn | null;
    targetTask: KanbanTask | null;
    isColumnSwitch: boolean;
    found: boolean;
}

/**
 * Dependencies required by IncludeLoadingProcessor
 */
export interface IncludeLoadingDependencies {
    fileRegistry: MarkdownFileRegistry;
    webviewPanel: IWebviewPanelForProcessor;
}

/**
 * Handles include file loading operations during include switch events.
 * Extracted from ChangeStateMachine for better separation of concerns.
 */
export class IncludeLoadingProcessor {
    private _fileRegistry: MarkdownFileRegistry;
    private _webviewPanel: IWebviewPanelForProcessor;

    constructor(deps: IncludeLoadingDependencies) {
        this._fileRegistry = deps.fileRegistry;
        this._webviewPanel = deps.webviewPanel;
    }

    /**
     * Resolve the target column/task based on the event type
     */
    resolveTarget(event: IncludeSwitchEvent | UserEditEvent, board: KanbanBoard): TargetResolution {
        let targetColumn: KanbanColumn | null = null;
        let targetTask: KanbanTask | null = null;
        let isColumnSwitch = false;

        if (event.type === 'include_switch') {
            if (event.target === 'column') {
                targetColumn = board.columns.find((c) => c.id === event.targetId) || null;
                isColumnSwitch = true;
            } else if (event.target === 'task') {
                targetColumn = board.columns.find((c) => c.id === event.columnIdForTask) || null;
                targetTask = targetColumn?.tasks.find((t) => t.id === event.targetId) || null;
            }
        } else if (event.type === 'user_edit' && event.params.includeSwitch) {
            if (event.editType === 'column_title') {
                targetColumn = board.columns.find((c) => c.id === event.params.columnId) || null;
                isColumnSwitch = true;
            } else if (event.editType === 'task_title') {
                targetColumn = board.columns.find((c) => c.tasks.some((t) => t.id === event.params.taskId)) || null;
                targetTask = targetColumn?.tasks.find((t) => t.id === event.params.taskId) || null;
            }
        }

        return {
            targetColumn,
            targetTask,
            isColumnSwitch,
            found: !!(targetColumn || targetTask)
        };
    }

    /**
     * Update target title if provided in event
     */
    updateTargetTitle(
        event: IncludeSwitchEvent | UserEditEvent,
        targetColumn: KanbanColumn | null,
        targetTask: KanbanTask | null,
        isColumnSwitch: boolean
    ): void {
        if (event.type === 'include_switch' && event.newTitle !== undefined) {
            if (isColumnSwitch && targetColumn) {
                targetColumn.title = event.newTitle;
                targetColumn.originalTitle = event.newTitle;
            } else if (targetTask) {
                targetTask.title = event.newTitle;
                targetTask.originalTitle = event.newTitle;
            }
        }
    }

    /**
     * Handle the case where all includes are being removed (newFiles is empty)
     */
    handleIncludeRemoval(
        targetColumn: KanbanColumn | null,
        targetTask: KanbanTask | null,
        isColumnSwitch: boolean
    ): void {
        if (isColumnSwitch && targetColumn) {
            targetColumn.includeFiles = [];
            targetColumn.includeMode = false;
            targetColumn.displayTitle = targetColumn.title.replace(INCLUDE_SYNTAX.REGEX, '').trim();
        } else if (targetTask) {
            targetTask.includeFiles = [];
            targetTask.includeMode = false;
            targetTask.displayTitle = targetTask.title.replace(INCLUDE_SYNTAX.REGEX, '').trim();
            targetTask.originalTitle = targetTask.title;
            targetTask.description = '';
        }
    }

    /**
     * Handle the case where includes are already loaded (no new files to load)
     * This restores properties that were cleared by CLEARING_CACHE state
     */
    handleAlreadyLoadedIncludes(
        event: IncludeSwitchEvent | UserEditEvent,
        targetColumn: KanbanColumn | null,
        targetTask: KanbanTask | null,
        isColumnSwitch: boolean,
        newFiles: string[]
    ): void {
        if (targetTask) {
            this._restoreTaskIncludeFromLoadedFile(event, targetTask, newFiles);
        } else if (isColumnSwitch && targetColumn) {
            this._restoreColumnIncludeFromLoadedFiles(event, targetColumn, newFiles);
        }
    }

    /**
     * Load new column include files and parse to tasks
     */
    async loadColumnIncludes(
        event: IncludeSwitchEvent | UserEditEvent,
        targetColumn: KanbanColumn,
        loadingFiles: string[],
        context: ChangeContext
    ): Promise<void> {
        // Update column properties
        targetColumn.includeFiles = loadingFiles;
        targetColumn.includeMode = loadingFiles.length > 0;

        // Update title and displayTitle if provided
        if (event.type === 'include_switch' && event.newTitle !== undefined) {
            targetColumn.title = event.newTitle;
            targetColumn.originalTitle = event.newTitle;
            targetColumn.displayTitle = this._generateColumnDisplayTitle(event.newTitle, loadingFiles);
        }

        // Get dependencies
        const fileFactory = this._webviewPanel.fileFactory;
        const mainFile = this._fileRegistry.getMainFile();

        if (!fileFactory || !mainFile) {
            console.error(`[IncludeLoadingProcessor] Missing dependencies (fileFactory or mainFile)`);
            return;
        }

        // Get preloaded content map if available
        const preloadedContentMap = event.type === 'include_switch' ? event.preloadedContent : undefined;

        // Load all files and collect tasks
        const tasks: KanbanTask[] = [];

        for (const relativePath of loadingFiles) {
            const preloadedContent = preloadedContentMap?.get(relativePath);

            // Ensure file is registered with correct type
            await this._ensureColumnIncludeRegistered(relativePath, targetColumn, fileFactory, mainFile);

            // Load content and parse tasks
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file) {
                await this._loadFileContent(file, preloadedContent);

                // Cast to IncludeFile - we know it's a column include from _ensureColumnIncludeRegistered
                const includeFile = file as IncludeFile;
                if (includeFile.getFileType() === 'include-column') {
                    const mainFilePath = mainFile.getPath();
                    const fileTasks = includeFile.parseToTasks(targetColumn.tasks, targetColumn.id, mainFilePath);
                    tasks.push(...fileTasks);
                } else {
                    console.error(`[IncludeLoadingProcessor] File is not a column include: ${relativePath}`);
                }
            } else {
                console.error(`[IncludeLoadingProcessor] File not found after registration: ${relativePath}`);
            }
        }

        targetColumn.tasks = tasks;
        context.result.updatedFiles.push(...loadingFiles);
    }

    /**
     * Load a new task include file and set task description
     */
    async loadTaskInclude(
        event: IncludeSwitchEvent | UserEditEvent,
        targetColumn: KanbanColumn,
        targetTask: KanbanTask,
        loadingFiles: string[],
        context: ChangeContext
    ): Promise<void> {
        const relativePath = loadingFiles[0]; // Task includes are single file

        // Get dependencies
        const fileFactory = this._webviewPanel.fileFactory;
        const mainFile = this._fileRegistry.getMainFile();

        if (!fileFactory || !mainFile) {
            console.error(`[IncludeLoadingProcessor] Missing dependencies (fileFactory or mainFile)`);
            return;
        }

        // Ensure file is registered with correct type
        await this._ensureTaskIncludeRegistered(relativePath, targetColumn, targetTask, fileFactory, mainFile);

        // Load content
        const file = this._fileRegistry.getByRelativePath(relativePath);
        if (!file) {
            console.error(`[IncludeLoadingProcessor] File not found after registration: ${relativePath}`);
            return;
        }

        // Always reload from disk for task includes
        await file.reload();

        const fullFileContent = file.getContent();
        if (!fullFileContent || fullFileContent.length === 0) {
            console.error(`[IncludeLoadingProcessor] Failed to load content for ${relativePath}`);
            return;
        }

        // Update task properties
        targetTask.includeMode = true;
        targetTask.includeFiles = loadingFiles;
        targetTask.displayTitle = `# include in ${relativePath}`;
        targetTask.description = fullFileContent;

        // Update title if provided
        if (event.type === 'include_switch' && event.newTitle !== undefined) {
            targetTask.title = event.newTitle;
            targetTask.originalTitle = event.newTitle;
        }

        // Sync file baseline with task content
        file.setContent(fullFileContent, true);

        context.result.updatedFiles.push(relativePath);
    }

    // ============= PRIVATE HELPERS =============

    private _restoreTaskIncludeFromLoadedFile(
        event: IncludeSwitchEvent | UserEditEvent,
        targetTask: KanbanTask,
        newFiles: string[]
    ): void {
        const relativePath = newFiles[0];
        const file = this._fileRegistry.getByRelativePath(relativePath);

        if (!file) {
            console.error(`[IncludeLoadingProcessor] File not found in registry: ${relativePath}`);
            return;
        }

        const fullFileContent = file.getContent();
        if (!fullFileContent || fullFileContent.length === 0) {
            console.error(`[IncludeLoadingProcessor] File has no content: ${relativePath}`);
            return;
        }

        // Restore all properties
        targetTask.includeMode = true;
        targetTask.includeFiles = newFiles;
        targetTask.displayTitle = `# include in ${relativePath}`;
        targetTask.description = fullFileContent;

        // Update title if provided
        if (event.type === 'include_switch' && event.newTitle !== undefined) {
            targetTask.title = event.newTitle;
            targetTask.originalTitle = event.newTitle;
        }
    }

    private _restoreColumnIncludeFromLoadedFiles(
        event: IncludeSwitchEvent | UserEditEvent,
        targetColumn: KanbanColumn,
        newFiles: string[]
    ): void {
        targetColumn.includeFiles = newFiles;
        targetColumn.includeMode = true;

        // Update title if provided
        if (event.type === 'include_switch' && event.newTitle !== undefined) {
            targetColumn.title = event.newTitle;
            targetColumn.originalTitle = event.newTitle;
            targetColumn.displayTitle = this._generateColumnDisplayTitle(event.newTitle, newFiles);
        }

        // Re-load tasks from already-loaded files
        const mainFile = this._fileRegistry.getMainFile();
        const mainFilePath = mainFile?.getPath();
        const tasks: KanbanTask[] = [];

        for (const relativePath of newFiles) {
            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (file && (file as any).parseToTasks) {
                const fileTasks = (file as any).parseToTasks([], targetColumn.id, mainFilePath);
                tasks.push(...fileTasks);
            }
        }

        targetColumn.tasks = tasks;
    }

    private _generateColumnDisplayTitle(title: string, files: string[]): string {
        const includeMatches = title.match(INCLUDE_SYNTAX.REGEX);

        if (includeMatches && includeMatches.length > 0) {
            let displayTitle = createDisplayTitleWithPlaceholders(title, files);

            if (!displayTitle && files.length > 0) {
                displayTitle = path.basename(files[0], path.extname(files[0]));
            }

            return displayTitle || 'Included Column';
        }

        return title;
    }

    private async _ensureColumnIncludeRegistered(
        relativePath: string,
        targetColumn: KanbanColumn,
        fileFactory: FileFactory,
        mainFile: MainKanbanFile
    ): Promise<void> {
        const existingFile = this._fileRegistry.getByRelativePath(relativePath);
        const isCorrectType = existingFile?.getFileType() === 'include-column';

        if (!existingFile || !isCorrectType) {
            if (existingFile && !isCorrectType) {
                existingFile.stopWatching();
                this._fileRegistry.unregister(existingFile.getPath());
            }

            const columnInclude = fileFactory.createIncludeDirect(relativePath, mainFile, 'include-column', false);
            columnInclude.setColumnId(targetColumn.id);
            columnInclude.setColumnTitle(targetColumn.title);
            this._fileRegistry.register(columnInclude);
            columnInclude.startWatching();
        }
    }

    private async _ensureTaskIncludeRegistered(
        relativePath: string,
        targetColumn: KanbanColumn,
        targetTask: KanbanTask,
        fileFactory: FileFactory,
        mainFile: MainKanbanFile
    ): Promise<void> {
        const existingFile = this._fileRegistry.getByRelativePath(relativePath);
        const isCorrectType = existingFile?.getFileType() === 'include-task';

        if (!existingFile || !isCorrectType) {
            if (existingFile && !isCorrectType) {
                existingFile.stopWatching();
                this._fileRegistry.unregister(existingFile.getPath());
            }

            const taskInclude = fileFactory.createInclude(relativePath, mainFile, 'include-task', false);
            taskInclude.setTaskId(targetTask.id);
            taskInclude.setTaskTitle(targetTask.title);
            taskInclude.setColumnId(targetColumn.id);
            this._fileRegistry.register(taskInclude);
            taskInclude.startWatching();
        }
    }

    private async _loadFileContent(file: MarkdownFile, preloadedContent: string | undefined): Promise<void> {
        if (preloadedContent !== undefined) {
            // Use preloaded content (marks as unsaved)
            file.setContent(preloadedContent, false);
        } else {
            // Always reload from disk during include switch
            // User was already prompted about unsaved changes in PROMPTING_USER state
            await file.reload();
        }
    }
}
