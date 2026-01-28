/**
 * LinkReplacementService - Unified link/path replacement logic
 *
 * Consolidates path replacement functionality that was duplicated between:
 * - PathCommands._replacePaths (mature, file-based implementation)
 * - LinkReplacementHandler (simpler, board-based implementation)
 *
 * This service handles:
 * - Single and batch path replacement
 * - Include file support with context-aware base paths
 * - Path encoding variants (URL encoded, decoded, with/without ./)
 * - Undo state capture
 * - Targeted webview updates
 *
 * @module services/LinkReplacementService
 */

import * as path from 'path';
import * as fs from 'fs';
import { MarkdownFile } from '../files/MarkdownFile';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import { BoardStore, UndoCapture } from '../core/stores';
import { WebviewBridge } from '../core/bridge/WebviewBridge';
import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';
import { LinkOperations, MARKDOWN_PATH_PATTERN, extractPathFromMatch } from '../utils/linkOperations';
import { encodeFilePath, safeDecodeURIComponent } from '../utils/stringUtils';
import { showInfo, showWarning } from './NotificationService';
import { logger } from '../utils/logger';
import { PathFormat } from './FileSearchWebview';

/**
 * Options for path replacement operations
 */
export interface ReplacementOptions {
    /** 'single' for one path, 'batch' for all paths in same directory */
    mode: 'single' | 'batch';
    /** How to format the new path */
    pathFormat: PathFormat;
    /** Task ID for targeted updates */
    taskId?: string;
    /** Column ID for targeted updates */
    columnId?: string;
    /** Whether the path is in a column title */
    isColumnTitle?: boolean;
    /** Link index for specific occurrence */
    linkIndex?: number;
    /** Custom success message */
    successMessage?: string;
}

/**
 * Result of a replacement operation
 */
export interface ReplacementResult {
    success: boolean;
    replaced: boolean;
    count: number;
    oldPath?: string;
    newPath?: string;
    error?: string;
}

/**
 * Information about a path that needs replacement
 */
interface PathReplacement {
    oldPath: string;
    decodedOldPath: string;
    newAbsolutePath: string;
    sourceFile: MarkdownFile;
}

/**
 * Dependencies required for replacement operations
 */
export interface ReplacementDependencies {
    fileRegistry: MarkdownFileRegistry;
    boardStore: BoardStore;
    webviewBridge: WebviewBridge;
    getBoard: () => KanbanBoard | undefined;
    invalidateCache: () => void;
}

/**
 * LinkReplacementService - Handles all link/path replacement operations
 */
export class LinkReplacementService {
    /**
     * Replace a broken path with a new path
     *
     * @param brokenPath - The path that needs to be replaced
     * @param newPath - The new path (absolute path to replacement file)
     * @param basePath - Base directory for resolving relative paths
     * @param deps - Required dependencies
     * @param options - Replacement options
     */
    public async replacePath(
        brokenPath: string,
        newPath: string,
        basePath: string,
        deps: ReplacementDependencies,
        options: ReplacementOptions
    ): Promise<ReplacementResult> {
        logger.debug('[LinkReplacementService.replacePath] START', {
            brokenPath: brokenPath.substring(0, 100),
            newPath: newPath.substring(0, 100),
            mode: options.mode,
            taskId: options.taskId,
            columnId: options.columnId
        });

        const mainFile = deps.fileRegistry.getMainFile();
        if (!mainFile) {
            return { success: false, replaced: false, count: 0, error: 'No main file found' };
        }

        const allFiles: MarkdownFile[] = [mainFile, ...deps.fileRegistry.getIncludeFiles()];
        const board = deps.getBoard();

        // Save undo entry
        if (board) {
            let undoEntry;
            if (options.taskId && options.columnId) {
                undoEntry = UndoCapture.forTask(board, options.taskId, options.columnId, 'path-replace');
            } else if (options.columnId) {
                undoEntry = UndoCapture.forColumn(board, options.columnId, 'path-replace');
            } else {
                undoEntry = UndoCapture.forFullBoard(board, 'path-replace');
            }
            deps.boardStore.saveUndoEntry(undoEntry);
        }

        // Resolve context base path
        const contextBasePath = options.mode === 'single'
            ? this._resolveContextBasePath(board, basePath, options.taskId, options.columnId, options.isColumnTitle)
            : basePath;

        // Find paths to replace
        let replacements: Map<string, PathReplacement>;

        if (options.mode === 'single') {
            const variants = this._generatePathVariants(brokenPath);
            replacements = this._findSinglePath(variants, allFiles, newPath, board, options);
        } else {
            const newDir = path.dirname(newPath);
            replacements = this._findBatchPaths(brokenPath, contextBasePath, allFiles, newDir);
        }

        if (replacements.size === 0) {
            if (options.mode === 'batch') {
                showWarning('No matching paths found to replace.');
                return { success: true, replaced: false, count: 0 };
            }
            return { success: false, replaced: false, count: 0, error: 'Path not found in any file' };
        }

        // Execute replacements
        let filesToModify: MarkdownFile[];
        if (options.mode === 'single') {
            const firstReplacement = replacements.values().next().value;
            filesToModify = firstReplacement ? [firstReplacement.sourceFile] : [];
        } else {
            filesToModify = allFiles;
        }

        const modifiedFiles = this._executeReplacements(replacements, filesToModify, options.pathFormat);

        // Apply board updates
        await this._applyBoardUpdates(deps, board, modifiedFiles, mainFile, replacements, options);

        // Calculate result path
        const firstReplacement = replacements.values().next().value;
        const resultNewPath = firstReplacement ? this._computeReplacementPath(
            firstReplacement.oldPath,
            firstReplacement.newAbsolutePath,
            path.dirname(mainFile.getPath()),
            options.pathFormat
        ) : '';

        // Send notifications
        if (firstReplacement) {
            deps.webviewBridge.send({
                type: 'pathReplaced',
                originalPath: brokenPath,
                actualPath: firstReplacement.oldPath,
                newPath: resultNewPath,
                taskId: options.taskId,
                columnId: options.columnId
            });
        }

        // Show success message
        const message = options.mode === 'batch'
            ? `Replaced ${replacements.size} path${replacements.size > 1 ? 's' : ''}`
            : options.successMessage || 'Path updated';
        showInfo(message);

        return {
            success: true,
            replaced: true,
            count: replacements.size,
            oldPath: brokenPath,
            newPath: resultNewPath
        };
    }

    // ============= PRIVATE HELPER METHODS =============

    /**
     * Normalize a directory path for comparison
     */
    private _normalizeDirForComparison(dir: string): string {
        let normalized = dir.replace(/\\/g, '/');
        if (normalized.startsWith('./')) {
            normalized = normalized.substring(2);
        }
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        return normalized;
    }

    /**
     * Resolve the context-aware base path for path resolution
     */
    private _resolveContextBasePath(
        board: KanbanBoard | null | undefined,
        basePath: string,
        taskId?: string,
        columnId?: string,
        isColumnTitle?: boolean
    ): string {
        if (!board) {
            return basePath;
        }

        const column = columnId ? board.columns.find((c: KanbanColumn) => c.id === columnId) : undefined;
        let includePath: string | undefined;

        if (isColumnTitle && column?.includeFiles?.length) {
            includePath = column.includeFiles[0];
        } else if (taskId && column) {
            const task = column.tasks.find((t: KanbanTask) => t.id === taskId);
            includePath = task?.includeContext?.includeFilePath
                || task?.includeFiles?.[0]
                || column?.includeFiles?.[0];
        }

        if (!includePath) {
            return basePath;
        }

        const absoluteIncludePath = path.isAbsolute(includePath)
            ? includePath
            : path.resolve(basePath, includePath);
        return path.dirname(absoluteIncludePath);
    }

    /**
     * Generate all possible variants of a path for matching
     */
    private _generatePathVariants(pathStr: string): string[] {
        if (!pathStr || typeof pathStr !== 'string' || pathStr.trim().length === 0) {
            return [];
        }

        const normalizeSlashes = (value: string) => value.replace(/\\/g, '/');
        const stripDotPrefix = (value: string) => value.startsWith('./') ? value.slice(2) : value;
        const addDotPrefix = (value: string) => {
            if (value.startsWith('./') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
                return value;
            }
            return './' + value;
        };
        const decodeHtmlEntities = (value: string) =>
            value.replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');

        const pathVariants: string[] = [pathStr];

        // Add decoded version
        const decodedPath = safeDecodeURIComponent(pathStr);
        if (decodedPath !== pathStr) {
            pathVariants.push(decodedPath);
        }

        // Add encoded version
        const encodedPath = encodeFilePath(decodedPath);
        if (encodedPath !== pathStr && encodedPath !== decodedPath) {
            pathVariants.push(encodedPath);
        }

        // Expand with normalization transformations
        const expandedVariants: string[] = [];
        for (const variant of pathVariants) {
            if (!variant) continue;
            const normalized = normalizeSlashes(variant);
            const htmlDecoded = decodeHtmlEntities(normalized);
            const stripped = stripDotPrefix(htmlDecoded);
            const withDot = addDotPrefix(stripped);
            expandedVariants.push(variant, normalized, htmlDecoded, stripped, withDot);
        }

        return [...new Set(expandedVariants.filter(p => p))];
    }

    /**
     * Compute the replacement path based on format preference
     */
    private _computeReplacementPath(
        _oldPath: string,
        newAbsolutePath: string,
        fileBasePath: string,
        pathFormat: PathFormat
    ): string {
        let result: string;
        if (pathFormat === 'absolute') {
            result = newAbsolutePath;
        } else {
            // 'relative' or 'auto' - use relative
            result = path.relative(fileBasePath, newAbsolutePath);
        }
        logger.debug('[LinkReplacementService._computeReplacementPath]', {
            pathFormat,
            newAbsolutePath: newAbsolutePath.slice(-50),
            fileBasePath: fileBasePath.slice(-50),
            result: result.slice(-50)
        });
        return result;
    }

    /**
     * Find a single path in the files
     */
    private _findSinglePath(
        variants: string[],
        files: MarkdownFile[],
        newAbsolutePath: string,
        board: KanbanBoard | null | undefined,
        options: ReplacementOptions
    ): Map<string, PathReplacement> {
        const replacements = new Map<string, PathReplacement>();

        // Strategy 1: Search in board structure first
        if (board && (options.taskId || options.columnId)) {
            const column = options.columnId
                ? board.columns.find((c: KanbanColumn) => c.id === options.columnId)
                : undefined;

            let textToSearch = '';
            if (options.isColumnTitle && column) {
                textToSearch = column.title || '';
            } else if (options.taskId && column) {
                const task = column.tasks.find((t: KanbanTask) => t.id === options.taskId);
                if (task) {
                    textToSearch = (task.title || '') + '\n' + (task.description || '');
                }
            }

            for (const variant of variants) {
                if (textToSearch.includes(variant)) {
                    for (const file of files) {
                        if (file.getContent().includes(variant)) {
                            replacements.set(variant, {
                                oldPath: variant,
                                decodedOldPath: safeDecodeURIComponent(variant),
                                newAbsolutePath,
                                sourceFile: file
                            });
                            return replacements;
                        }
                    }
                }
            }
        }

        // Strategy 2: Fall back to file content search
        for (const file of files) {
            const content = file.getContent();
            for (const variant of variants) {
                if (content.includes(variant)) {
                    replacements.set(variant, {
                        oldPath: variant,
                        decodedOldPath: safeDecodeURIComponent(variant),
                        newAbsolutePath,
                        sourceFile: file
                    });
                    return replacements;
                }
            }
        }

        return replacements;
    }

    /**
     * Find all paths with the same directory for batch replacement
     */
    private _findBatchPaths(
        brokenPath: string,
        contextBasePath: string,
        files: MarkdownFile[],
        newDir: string
    ): Map<string, PathReplacement> {
        const replacements = new Map<string, PathReplacement>();

        const decodedBrokenPath = safeDecodeURIComponent(brokenPath);
        const absoluteBrokenPath = path.isAbsolute(decodedBrokenPath)
            ? decodedBrokenPath
            : path.resolve(contextBasePath, decodedBrokenPath);
        const brokenDir = this._normalizeDirForComparison(path.dirname(absoluteBrokenPath));

        // Use shared pattern for matching all path types
        const pathPattern = new RegExp(MARKDOWN_PATH_PATTERN.source, 'g');

        for (const file of files) {
            const content = file.getContent();
            const fileDir = path.dirname(file.getPath());
            let match;
            pathPattern.lastIndex = 0;

            while ((match = pathPattern.exec(content)) !== null) {
                const matchedPath = extractPathFromMatch(match);
                if (!matchedPath || replacements.has(matchedPath)) continue;

                const decodedPath = safeDecodeURIComponent(matchedPath);
                const absolutePath = path.isAbsolute(decodedPath)
                    ? decodedPath
                    : path.resolve(fileDir, decodedPath);
                const pathDir = this._normalizeDirForComparison(path.dirname(absolutePath));

                const matchedRelativeDir = path.dirname(decodedPath);
                const brokenRelativeDir = path.dirname(decodedBrokenPath);
                const relativeDirMatch = matchedRelativeDir === brokenRelativeDir;

                if (pathDir === brokenDir || relativeDirMatch) {
                    const filename = path.basename(decodedPath);
                    const newAbsPath = path.join(newDir, filename);

                    try {
                        if (fs.existsSync(newAbsPath)) {
                            replacements.set(matchedPath, {
                                oldPath: matchedPath,
                                decodedOldPath: decodedPath,
                                newAbsolutePath: newAbsPath,
                                sourceFile: file
                            });
                        }
                    } catch {
                        // File doesn't exist, skip
                    }
                }
            }
        }

        // Fallback: add original broken path if no others found
        if (replacements.size === 0) {
            const filename = path.basename(decodedBrokenPath);
            const newAbsPath = path.join(newDir, filename);

            try {
                if (fs.existsSync(newAbsPath)) {
                    replacements.set(brokenPath, {
                        oldPath: brokenPath,
                        decodedOldPath: decodedBrokenPath,
                        newAbsolutePath: newAbsPath,
                        sourceFile: files[0]
                    });
                }
            } catch {
                // File doesn't exist
            }
        }

        return replacements;
    }

    /**
     * Execute the path replacements in files
     */
    private _executeReplacements(
        replacements: Map<string, PathReplacement>,
        files: MarkdownFile[],
        pathFormat: PathFormat
    ): MarkdownFile[] {
        const modifiedFiles: MarkdownFile[] = [];

        for (const file of files) {
            let content = file.getContent();
            let modified = false;
            const fileDir = path.dirname(file.getPath());

            for (const [oldPath, replacement] of replacements) {
                const newRelativePath = this._computeReplacementPath(
                    oldPath,
                    replacement.newAbsolutePath,
                    fileDir,
                    pathFormat
                );
                const encodedNewPath = encodeFilePath(newRelativePath);

                let newContent = LinkOperations.replaceSingleLink(content, oldPath, encodedNewPath, 0);

                if (newContent === content && replacement.decodedOldPath !== oldPath) {
                    newContent = LinkOperations.replaceSingleLink(content, replacement.decodedOldPath, encodedNewPath, 0);
                }

                if (newContent !== content) {
                    content = newContent;
                    modified = true;
                }
            }

            if (modified) {
                file.setContent(content);
                modifiedFiles.push(file);
            }
        }

        return modifiedFiles;
    }

    /**
     * Apply board updates - either targeted or full refresh
     */
    private async _applyBoardUpdates(
        deps: ReplacementDependencies,
        board: KanbanBoard | null | undefined,
        modifiedFiles: MarkdownFile[],
        mainFile: MarkdownFile,
        replacements: Map<string, PathReplacement>,
        options: ReplacementOptions
    ): Promise<void> {
        const mainFileDir = path.dirname(mainFile.getPath());
        const mainFileModified = modifiedFiles.some(f => f.getPath() === mainFile.getPath());
        const includeFilesModified = modifiedFiles.some(f => f.getPath() !== mainFile.getPath());

        if (!board || (!mainFileModified && !includeFilesModified)) {
            return;
        }

        // For batch mode, find and update all affected items
        if (options.mode === 'batch' && replacements.size >= 1) {
            const replacementPaths = Array.from(replacements.keys());

            for (const column of board.columns) {
                // Check column title
                const oldColumnTitle = column.title || '';
                if (replacementPaths.some(p => oldColumnTitle.includes(p))) {
                    const newTitle = this._applyAllReplacements(oldColumnTitle, replacements, mainFileDir, options.pathFormat);
                    if (oldColumnTitle !== newTitle) {
                        column.title = newTitle;
                        deps.webviewBridge.send({
                            type: 'updateColumnContent',
                            columnId: column.id,
                            column: column,
                            imageMappings: {}
                        });
                    }
                }

                // Check tasks
                for (const task of column.tasks) {
                    const oldTaskTitle = task.title || '';
                    const oldTaskDesc = task.description || '';
                    const taskTitleHasPath = replacementPaths.some(p => oldTaskTitle.includes(p));
                    const taskDescHasPath = replacementPaths.some(p => oldTaskDesc.includes(p));

                    if (taskTitleHasPath || taskDescHasPath) {
                        const taskBaseDir = task.includeContext?.includeDir || mainFileDir;
                        let taskChanged = false;

                        if (taskTitleHasPath) {
                            const newTaskTitle = this._applyAllReplacements(oldTaskTitle, replacements, taskBaseDir, options.pathFormat);
                            if (newTaskTitle !== oldTaskTitle) {
                                task.title = newTaskTitle;
                                taskChanged = true;
                            }
                        }

                        if (taskDescHasPath) {
                            const newTaskDesc = this._applyAllReplacements(oldTaskDesc, replacements, taskBaseDir, options.pathFormat);
                            if (newTaskDesc !== oldTaskDesc) {
                                task.description = newTaskDesc;
                                taskChanged = true;
                            }
                        }

                        if (taskChanged) {
                            deps.webviewBridge.send({
                                type: 'updateTaskContent',
                                taskId: task.id,
                                columnId: column.id,
                                task: task,
                                imageMappings: {}
                            });
                        }
                    }
                }
            }

            deps.invalidateCache();
            return;
        }

        // Single mode - targeted updates
        if (options.taskId && options.columnId) {
            const column = board.columns.find((c: KanbanColumn) => c.id === options.columnId);
            const task = column?.tasks.find((t: KanbanTask) => t.id === options.taskId);
            if (task) {
                const taskBaseDir = task.includeContext?.includeDir || mainFileDir;
                task.title = this._applyAllReplacements(task.title || '', replacements, taskBaseDir, options.pathFormat);
                if (task.description) {
                    task.description = this._applyAllReplacements(task.description, replacements, taskBaseDir, options.pathFormat);
                }

                deps.webviewBridge.send({
                    type: 'updateTaskContent',
                    taskId: options.taskId,
                    columnId: options.columnId,
                    task: task,
                    imageMappings: {}
                });
                deps.invalidateCache();
                return;
            }
        } else if (options.columnId && options.isColumnTitle) {
            const column = board.columns.find((c: KanbanColumn) => c.id === options.columnId);
            if (column) {
                column.title = this._applyAllReplacements(column.title || '', replacements, mainFileDir, options.pathFormat);
                deps.webviewBridge.send({
                    type: 'updateColumnContent',
                    columnId: options.columnId,
                    column: column,
                    imageMappings: {}
                });
                deps.invalidateCache();
                return;
            }
        }

        // Fallback: invalidate cache (caller should refresh)
        deps.invalidateCache();
    }

    /**
     * Apply all replacements to a text string
     */
    private _applyAllReplacements(
        text: string,
        replacements: Map<string, PathReplacement>,
        baseDir: string,
        pathFormat: PathFormat
    ): string {
        let result = text;
        for (const [, replacement] of replacements) {
            const encodedNewPath = encodeFilePath(
                this._computeReplacementPath(
                    replacement.oldPath,
                    replacement.newAbsolutePath,
                    baseDir,
                    pathFormat
                )
            );
            let newResult = LinkOperations.replaceSingleLink(result, replacement.oldPath, encodedNewPath, 0);
            if (newResult === result && replacement.decodedOldPath !== replacement.oldPath) {
                newResult = LinkOperations.replaceSingleLink(result, replacement.decodedOldPath, encodedNewPath, 0);
            }
            result = newResult;
        }
        return result;
    }
}

// Export singleton instance
export const linkReplacementService = new LinkReplacementService();
