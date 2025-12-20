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
import { BoardCrudOperations } from '../board/BoardCrudOperations';
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
                targetColumn = BoardCrudOperations.findColumnById(board, event.targetId) || null;
                isColumnSwitch = true;
            } else if (event.target === 'task') {
                targetColumn = (event.columnIdForTask ? BoardCrudOperations.findColumnById(board, event.columnIdForTask) : null) ?? null;
                targetTask = targetColumn?.tasks.find(t => t.id === event.targetId) || null;
            }
        } else if (event.type === 'user_edit' && event.params.includeSwitch) {
            if (event.editType === 'column_title') {
                targetColumn = (event.params.columnId ? BoardCrudOperations.findColumnById(board, event.params.columnId) : null) ?? null;
                isColumnSwitch = true;
            } else if (event.editType === 'task_title') {
                targetColumn = (event.params.taskId ? BoardCrudOperations.findColumnContainingTask(board, event.params.taskId) : null) ?? null;
                targetTask = event.params.taskId ? (targetColumn?.tasks.find(t => t.id === event.params.taskId) || null) : null;
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

    // ============= UNIFIED LOADING (SINGLE CODE PATH) =============

    /**
     * Unified loading function - SINGLE code path for ALL include loading scenarios.
     *
     * This function:
     * 1. Handles removal (empty includeFiles)
     * 2. ALWAYS reloads content from disk (or uses preloaded content)
     * 3. Parses content to tasks (column) or description (task)
     *
     * There is NO distinction between "new" vs "already loaded" files.
     * This eliminates the bug where cached empty files weren't reloaded.
     */
    async unifiedLoad(params: {
        target: { type: 'column'; column: KanbanColumn } | { type: 'task'; column: KanbanColumn; task: KanbanTask };
        includeFiles: string[];
        preloadedContent?: Map<string, string>;
        newTitle?: string;
        context: ChangeContext;
    }): Promise<void> {
        const { target, includeFiles, preloadedContent, newTitle, context } = params;

        // Handle removal case (empty includeFiles)
        if (includeFiles.length === 0) {
            this._clearTarget(target, newTitle);
            return;
        }

        // Get dependencies
        const fileFactory = this._webviewPanel.fileFactory;
        const mainFile = this._fileRegistry.getMainFile();

        if (!fileFactory || !mainFile) {
            console.error(`[IncludeLoadingProcessor.unifiedLoad] Missing dependencies`);
            return;
        }

        if (target.type === 'column') {
            await this._loadColumnContent(target.column, includeFiles, preloadedContent, newTitle, mainFile, fileFactory, context);
        } else {
            await this._loadTaskContent(target.column, target.task, includeFiles[0], newTitle, mainFile, fileFactory, context);
        }
    }

    /**
     * Clear target when includes are being removed
     */
    private _clearTarget(
        target: { type: 'column'; column: KanbanColumn } | { type: 'task'; column: KanbanColumn; task: KanbanTask },
        newTitle?: string
    ): void {
        if (target.type === 'column') {
            const column = target.column;
            column.includeFiles = [];
            column.includeMode = false;
            column.tasks = [];
            if (newTitle !== undefined) {
                column.title = newTitle;
                column.originalTitle = newTitle;
                column.displayTitle = newTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
            }
        } else {
            const task = target.task;
            task.includeFiles = [];
            task.includeMode = false;
            task.description = '';
            if (newTitle !== undefined) {
                task.title = newTitle;
                task.originalTitle = newTitle;
                task.displayTitle = newTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
            }
        }
    }

    /**
     * Load column include content - ALWAYS reloads from disk
     */
    private async _loadColumnContent(
        column: KanbanColumn,
        includeFiles: string[],
        preloadedContent: Map<string, string> | undefined,
        newTitle: string | undefined,
        mainFile: MainKanbanFile,
        fileFactory: FileFactory,
        context: ChangeContext
    ): Promise<void> {
        // Update column properties
        column.includeFiles = includeFiles;
        column.includeMode = true;

        if (newTitle !== undefined) {
            column.title = newTitle;
            column.originalTitle = newTitle;
            column.displayTitle = this._generateColumnDisplayTitle(newTitle, includeFiles);
        }

        // Load all files and collect tasks
        const tasks: KanbanTask[] = [];

        for (const relativePath of includeFiles) {
            // Ensure file is registered
            this._fileRegistry.ensureIncludeRegistered(
                relativePath,
                'include-column',
                fileFactory,
                mainFile,
                { columnId: column.id, columnTitle: column.title }
            );

            const file = this._fileRegistry.getByRelativePath(relativePath);
            if (!file) {
                console.error(`[IncludeLoadingProcessor] File not found after registration: ${relativePath}`);
                continue;
            }

            // ALWAYS load content - NO distinction between "new" vs "already loaded"
            const normalizedPath = MarkdownFile.normalizeRelativePath(relativePath);
            const preloaded = preloadedContent?.get(normalizedPath);

            if (preloaded !== undefined) {
                file.setContent(preloaded, false); // Mark as unsaved
            } else {
                await file.reload(); // ALWAYS reload from disk
            }

            // Parse to tasks
            const includeFile = file as IncludeFile;
            const mainFilePath = mainFile.getPath();
            const fileTasks = includeFile.parseToTasks(column.tasks, column.id, mainFilePath);

            // Debug logging
            const contentLength = includeFile.getContent()?.length || 0;
            if (contentLength > 0 && fileTasks.length === 0) {
                console.warn(`[IncludeLoadingProcessor] File has content (${contentLength} chars) but parsed to 0 tasks: ${relativePath}`);
            } else if (contentLength === 0) {
                console.warn(`[IncludeLoadingProcessor] File has no content after reload: ${relativePath}`);
            }

            tasks.push(...fileTasks);
            context.result.updatedFiles.push(relativePath);
        }

        column.tasks = tasks;
    }

    /**
     * Load task include content - ALWAYS reloads from disk
     */
    private async _loadTaskContent(
        column: KanbanColumn,
        task: KanbanTask,
        relativePath: string,
        newTitle: string | undefined,
        mainFile: MainKanbanFile,
        fileFactory: FileFactory,
        context: ChangeContext
    ): Promise<void> {
        // Ensure file is registered
        this._fileRegistry.ensureIncludeRegistered(
            relativePath,
            'include-task',
            fileFactory,
            mainFile,
            { columnId: column.id, taskId: task.id, taskTitle: task.title }
        );

        const file = this._fileRegistry.getByRelativePath(relativePath);
        if (!file) {
            console.error(`[IncludeLoadingProcessor] File not found after registration: ${relativePath}`);
            return;
        }

        // ALWAYS reload from disk
        await file.reload();

        const fullFileContent = file.getContent();
        if (!fullFileContent || fullFileContent.length === 0) {
            console.error(`[IncludeLoadingProcessor] Failed to load content for ${relativePath}`);
            return;
        }

        // Update task properties
        task.includeMode = true;
        task.includeFiles = [relativePath];
        task.displayTitle = `# include in ${relativePath}`;
        task.description = fullFileContent;

        if (newTitle !== undefined) {
            task.title = newTitle;
            task.originalTitle = newTitle;
        }

        // Sync file baseline
        file.setContent(fullFileContent, true);
        context.result.updatedFiles.push(relativePath);
    }

    // ============= PATH NORMALIZATION HELPERS =============

    /**
     * Calculate files being unloaded with proper path normalization
     */
    calculateUnloadingFiles(oldFiles: string[], newFiles: string[]): string[] {
        const normalizedNew = new Set(newFiles.map(MarkdownFile.normalizeRelativePath));
        return oldFiles.filter(f => !normalizedNew.has(MarkdownFile.normalizeRelativePath(f)));
    }

    /**
     * Calculate files being loaded with proper path normalization
     */
    calculateLoadingFiles(oldFiles: string[], newFiles: string[]): string[] {
        const normalizedOld = new Set(oldFiles.map(MarkdownFile.normalizeRelativePath));
        return newFiles.filter(f => !normalizedOld.has(MarkdownFile.normalizeRelativePath(f)));
    }

    // ============= PRIVATE HELPERS =============

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
}
