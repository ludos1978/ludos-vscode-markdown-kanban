/**
 * Path Commands
 *
 * Handles path conversion and file operations:
 * - convertPaths: Convert paths in a single file
 * - convertAllPaths: Convert paths in main file and all includes
 * - revealPathInExplorer: Open file in system file explorer
 *
 * @module commands/PathCommands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import { PathConversionService, ConversionResult } from '../services/PathConversionService';
import { getErrorMessage, encodeFilePath, safeDecodeURIComponent } from '../utils/stringUtils';
import { MarkdownFile } from '../files/MarkdownFile';
import { ConvertPathsMessage, ConvertAllPathsMessage, ConvertSinglePathMessage, OpenPathMessage, SearchForFileMessage, RevealPathInExplorerMessage, BrowseForImageMessage, DeleteFromMarkdownMessage } from '../core/bridge/MessageTypes';
import { safeFileUri } from '../utils/uriUtils';
import { FileSearchService, TrackedFileData } from '../fileSearchService';
import { PathFormat } from '../services/FileSearchWebview';
import { LinkOperations } from '../utils/linkOperations';
import { UndoCapture } from '../core/stores/UndoCapture';
import { showInfo, showWarning } from '../services/NotificationService';
import { extractIncludeFiles } from '../constants/IncludeConstants';
import { findColumn, findColumnContainingTask } from '../actions/helpers';
import { logger } from '../utils/logger';
import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';

/**
 * Options for path replacement operations
 */
interface PathReplacementOptions {
    mode: 'single' | 'batch';
    pathFormat: PathFormat;
    taskId?: string;
    columnId?: string;
    isColumnTitle?: boolean;
    successMessage?: string;
}

/**
 * Information about a path that needs replacement
 */
interface PathReplacement {
    oldPath: string;           // Path as found in file (may be encoded)
    decodedOldPath: string;    // Decoded version for comparison
    newAbsolutePath: string;   // Absolute path to replacement file
    sourceFile: MarkdownFile;  // File where path was found
}

/**
 * Path Commands Handler
 *
 * Processes path conversion messages from the webview.
 */
export class PathCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'path-commands',
        name: 'Path Commands',
        description: 'Handles path conversion between absolute and relative formats',
        messageTypes: ['convertPaths', 'convertAllPaths', 'convertSinglePath', 'openPath', 'searchForFile', 'revealPathInExplorer', 'browseForImage', 'deleteFromMarkdown'],
        priority: 100
    };

    protected handlers: Record<string, MessageHandler> = {
        'convertPaths': (msg, ctx) => this.handleConvertPaths(msg as ConvertPathsMessage, ctx),
        'convertAllPaths': (msg, ctx) => this.handleConvertAllPaths(msg as ConvertAllPathsMessage, ctx),
        'convertSinglePath': (msg, ctx) => this.handleConvertSinglePath(msg as ConvertSinglePathMessage, ctx),
        'openPath': (msg, ctx) => this.handleOpenPath(msg as OpenPathMessage, ctx),
        'searchForFile': (msg, ctx) => this.handleSearchForFile(msg as SearchForFileMessage, ctx),
        'revealPathInExplorer': (msg, ctx) => this.handleRevealPathInExplorer(msg as RevealPathInExplorerMessage, ctx),
        'browseForImage': (msg, ctx) => this.handleBrowseForImage(msg as BrowseForImageMessage, ctx),
        'deleteFromMarkdown': (msg, ctx) => this.handleDeleteFromMarkdown(msg as DeleteFromMarkdownMessage, ctx)
    };

    /**
     * Convert paths in a single file
     */
    private async handleConvertPaths(
        message: ConvertPathsMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }

        // Determine which file to convert
        let file: MarkdownFile | undefined;
        let basePath: string;

        if (message.isMainFile || !message.filePath) {
            // Convert main file
            file = fileRegistry.getMainFile();
            if (!file) {
                return this.failure('Main file not found');
            }
        } else {
            // Convert include file
            file = fileRegistry.getByRelativePath(message.filePath);
            if (!file) {
                return this.failure(`Include file not found: ${message.filePath}`);
            }
        }

        basePath = path.dirname(file.getPath());
        const content = file.getContent();
        const conversionService = PathConversionService.getInstance();

        // Perform conversion
        let result: ConversionResult;
        if (message.direction === 'relative') {
            result = conversionService.convertToRelative(content, basePath);
        } else {
            result = conversionService.convertToAbsolute(content, basePath);
        }

        if (result.converted === 0) {
            // Nothing to convert
            this.postMessage({
                type: 'pathsConverted',
                filePath: file.getRelativePath(),
                direction: message.direction,
                converted: 0,
                skipped: result.skipped,
                warnings: [],
                message: `No paths to convert (${result.skipped} already in ${message.direction} format or skipped)`
            });
            return this.success({ converted: 0, skipped: result.skipped });
        }

        // Update file content in cache (marks as unsaved, does NOT save to disk)
        file.setContent(result.content, false);

        // Refresh webview to show updated paths
        await this.refreshBoard(context);

        // Notify frontend
        this.postMessage({
            type: 'pathsConverted',
            filePath: file.getRelativePath(),
            direction: message.direction,
            converted: result.converted,
            skipped: result.skipped,
            warnings: result.warnings,
            message: `Converted ${result.converted} paths to ${message.direction} format`
        });

        return this.success({
            converted: result.converted,
            skipped: result.skipped,
            warnings: result.warnings
        });
    }

    /**
     * Convert paths in main file and all include files
     */
    private async handleConvertAllPaths(
        message: ConvertAllPathsMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }

        const conversionService = PathConversionService.getInstance();
        let totalConverted = 0;
        let totalSkipped = 0;
        const allWarnings: string[] = [];
        const convertedFiles: string[] = [];

        // Convert main file
        const mainFile = fileRegistry.getMainFile();
        if (mainFile) {
            const basePath = path.dirname(mainFile.getPath());
            const content = mainFile.getContent();

            let result: ConversionResult;
            if (message.direction === 'relative') {
                result = conversionService.convertToRelative(content, basePath);
            } else {
                result = conversionService.convertToAbsolute(content, basePath);
            }

            if (result.converted > 0) {
                mainFile.setContent(result.content, false);
                convertedFiles.push(mainFile.getRelativePath());
            }

            totalConverted += result.converted;
            totalSkipped += result.skipped;
            allWarnings.push(...result.warnings.map(w => `[${mainFile.getRelativePath()}] ${w}`));
        }

        // Convert all include files
        const includeFiles = fileRegistry.getIncludeFiles();
        for (const file of includeFiles) {
            const basePath = path.dirname(file.getPath());
            const content = file.getContent();

            let result: ConversionResult;
            if (message.direction === 'relative') {
                result = conversionService.convertToRelative(content, basePath);
            } else {
                result = conversionService.convertToAbsolute(content, basePath);
            }

            if (result.converted > 0) {
                file.setContent(result.content, false);
                convertedFiles.push(file.getRelativePath());
            }

            totalConverted += result.converted;
            totalSkipped += result.skipped;
            allWarnings.push(...result.warnings.map(w => `[${file.getRelativePath()}] ${w}`));
        }

        // Refresh webview to show updated paths
        if (totalConverted > 0) {
            await this.refreshBoard(context);
        }

        // Notify frontend
        this.postMessage({
            type: 'allPathsConverted',
            direction: message.direction,
            converted: totalConverted,
            skipped: totalSkipped,
            filesModified: convertedFiles.length,
            warnings: allWarnings,
            message: totalConverted > 0
                ? `Converted ${totalConverted} paths in ${convertedFiles.length} file(s) to ${message.direction} format`
                : `No paths to convert (${totalSkipped} already in ${message.direction} format or skipped)`
        });

        return this.success({
            converted: totalConverted,
            skipped: totalSkipped,
            filesModified: convertedFiles.length,
            warnings: allWarnings
        });
    }

    /**
     * Convert a single path in any file (main or includes)
     */
    private async handleConvertSinglePath(
        message: ConvertSinglePathMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }

        const conversionService = PathConversionService.getInstance();
        const imagePath = message.imagePath;

        // Collect all files to search
        const allFiles: MarkdownFile[] = [];
        const mainFile = fileRegistry.getMainFile();
        if (mainFile) {
            allFiles.push(mainFile);
        }
        allFiles.push(...fileRegistry.getIncludeFiles());

        // Search for the path in all files
        let foundFile: MarkdownFile | null = null;
        let foundContent: string = '';
        let actualPathInContent: string = imagePath;

        // Try multiple path variations (with/without ./ prefix)
        const pathVariations = [
            imagePath,
            imagePath.startsWith('./') ? imagePath.substring(2) : './' + imagePath
        ];

        for (const file of allFiles) {
            const content = file.getContent();

            for (const pathVariation of pathVariations) {
                if (content.includes(pathVariation)) {
                    foundFile = file;
                    foundContent = content;
                    actualPathInContent = pathVariation;
                    break;
                }
            }
            if (foundFile) break;
        }

        if (!foundFile) {
            return this.failure('Path not found in any file');
        }

        const basePath = path.dirname(foundFile.getPath());
        let newPath: string;

        // Use the actual path found in content for conversion
        if (message.direction === 'relative') {
            newPath = conversionService.toRelativePath(actualPathInContent, basePath);
        } else {
            newPath = conversionService.toAbsolutePath(actualPathInContent, basePath);
        }

        // If no change needed
        if (newPath === actualPathInContent) {
            this.postMessage({
                type: 'singlePathConverted',
                originalPath: actualPathInContent,
                newPath: newPath,
                direction: message.direction,
                converted: false,
                message: `Path already in ${message.direction} format`
            });
            return this.success({ converted: false });
        }

        // Replace the actual path in content (use string replace, not regex)
        const newContent = foundContent.split(actualPathInContent).join(newPath);

        // Update file content in cache (marks as unsaved, does NOT save to disk)
        foundFile.setContent(newContent, false);

        // Refresh webview to show updated paths (needed for includes to update their displayed path)
        await this.refreshBoard(context);

        // Notify frontend
        this.postMessage({
            type: 'singlePathConverted',
            originalPath: actualPathInContent,
            newPath: newPath,
            filePath: foundFile.getRelativePath(),
            direction: message.direction,
            converted: true,
            message: `Converted path to ${message.direction} format in ${foundFile.getRelativePath()}`
        });

        return this.success({
            converted: true,
            originalPath: actualPathInContent,
            newPath: newPath,
            filePath: foundFile.getRelativePath()
        });
    }

    /**
     * Open a file path directly (in VS Code or default app)
     */
    private async handleOpenPath(
        message: OpenPathMessage,
        _context: CommandContext
    ): Promise<CommandResult> {
        const filePath = message.filePath;

        // If the path is relative, resolve it against the main file's directory
        let resolvedPath = filePath;
        if (!path.isAbsolute(filePath)) {
            const fileRegistry = this.getFileRegistry();
            const mainFile = fileRegistry?.getMainFile();
            if (mainFile) {
                const basePath = path.dirname(mainFile.getPath());
                resolvedPath = path.resolve(basePath, filePath);
            } else {
                return this.failure('Cannot resolve relative path: main file not found');
            }
        }

        try {
            const fileUri = safeFileUri(resolvedPath, 'PathCommands-openPath');
            // Use openExternal to open with the system's default application
            await vscode.env.openExternal(fileUri);
            return this.success({ opened: true, path: resolvedPath });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[PathCommands] Error opening path:`, error);
            return this.failure(`Failed to open file: ${errorMessage}`);
        }
    }

    /**
     * Search for a file by name using VS Code's Quick Open
     */
    private async handleSearchForFile(
        message: SearchForFileMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const oldPath = message.filePath;
        logger.debug('[PathCommands.handleSearchForFile] START', {
            oldPath,
            taskId: message.taskId,
            columnId: message.columnId
        });

        // Get the main file's directory for the search
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }
        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            return this.failure('No main file found');
        }
        const basePath = path.dirname(mainFile.getPath());

        try {
            // Use FileSearchService to show custom webview search dialog
            logger.debug('[PathCommands.handleSearchForFile] Opening file search dialog');
            const fileSearchService = new FileSearchService();
            const webview = context.fileManager.getWebview();
            fileSearchService.setWebview(webview);

            // Get tracked files from registry (main + includes) for scanning
            const allFiles = fileRegistry.getAll();
            const trackedFiles: TrackedFileData[] = allFiles.map(file => ({
                path: file.getPath(),
                relativePath: file.getRelativePath(),
                content: file.getContent()
            }));
            fileSearchService.setTrackedFiles(trackedFiles);

            const result = await fileSearchService.pickReplacementForBrokenLink(oldPath, basePath);
            logger.debug('[PathCommands.handleSearchForFile] File search dialog returned', {
                hasResult: !!result,
                batchReplace: result?.batchReplace,
                selectedPath: result?.uri?.fsPath
            });

            if (!result) {
                return this.success({ cancelled: true });
            }

            const selectedFile = result.uri.fsPath;
            const pathFormat = result.pathFormat;

            // Unified path replacement - handles both single and batch modes
            return await this._replacePaths(oldPath, selectedFile, basePath, context, {
                mode: result.batchReplace ? 'batch' : 'single',
                pathFormat: pathFormat,
                taskId: message.taskId,
                columnId: message.columnId,
                isColumnTitle: message.isColumnTitle,
                successMessage: `Path updated: ${path.basename(oldPath)} → ${path.basename(selectedFile)}`
            });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[PathCommands] Error searching for file:`, error);
            return this.failure(`Failed to search for file: ${errorMessage}`);
        }
    }

    /**
     * Reveal a file path in the system file explorer (Finder on macOS, Explorer on Windows)
     */
    private async handleRevealPathInExplorer(
        message: RevealPathInExplorerMessage,
        _context: CommandContext
    ): Promise<CommandResult> {
        const filePath = message.filePath;

        // If the path is relative, resolve it against the main file's directory
        let resolvedPath = filePath;
        if (!path.isAbsolute(filePath)) {
            const fileRegistry = this.getFileRegistry();
            const mainFile = fileRegistry?.getMainFile();
            if (mainFile) {
                const basePath = path.dirname(mainFile.getPath());
                resolvedPath = path.resolve(basePath, filePath);
            } else {
                return this.failure('Cannot resolve relative path: main file not found');
            }
        }

        // Check if the path exists
        if (!fs.existsSync(resolvedPath)) {
            // File doesn't exist - try to open the parent folder instead
            const parentDir = path.dirname(resolvedPath);
            if (fs.existsSync(parentDir)) {
                try {
                    await vscode.commands.executeCommand('revealFileInOS', safeFileUri(parentDir, 'PathCommands-revealParentFolder'));
                    showInfo(`File not found. Opened parent folder: ${path.basename(parentDir)}`);
                    return this.success({ revealed: true, path: parentDir, fallbackToParent: true });
                } catch (error) {
                    const errorMessage = getErrorMessage(error);
                    console.error(`[PathCommands] Error revealing parent folder:`, error);
                    showWarning(`File not found and failed to open parent folder: ${errorMessage}`);
                    return this.failure(`File not found and failed to open parent folder: ${errorMessage}`);
                }
            } else {
                showWarning(`File not found: ${resolvedPath}`);
                return this.failure(`Path does not exist: ${resolvedPath}`);
            }
        }

        try {
            await vscode.commands.executeCommand('revealFileInOS', safeFileUri(resolvedPath, 'PathCommands-revealInExplorer'));
            return this.success({ revealed: true, path: resolvedPath });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[PathCommands] Error revealing path in explorer:`, error);
            showWarning(`Failed to reveal in file explorer: ${errorMessage}`);
            return this.failure(`Failed to reveal in file explorer: ${errorMessage}`);
        }
    }

    /**
     * Browse for an image file to replace a broken image path
     */
    private async handleBrowseForImage(
        message: BrowseForImageMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const oldPath = message.oldPath;

        // Get the main file's directory as the starting point for the file dialog
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }
        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            return this.failure('No main file found');
        }
        const basePath = path.dirname(mainFile.getPath());

        // Open file dialog to select a new image
        const result = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFolders: false,
            canSelectFiles: true,
            defaultUri: vscode.Uri.file(basePath),
            title: 'Select Image to Replace Broken Path',
            filters: {
                'Images': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'],
                'All files': ['*']
            }
        });

        if (!result || result.length === 0) {
            return this.success({ cancelled: true });
        }

        const selectedFile = result[0].fsPath;
        return await this._replacePaths(oldPath, selectedFile, basePath, context, {
            mode: 'single',
            pathFormat: 'auto',
            taskId: message.taskId,
            columnId: message.columnId,
            isColumnTitle: message.isColumnTitle,
            successMessage: 'Image path updated successfully'
        });
    }

    /**
     * Delete an element (image, link, include) from the markdown source
     * Completely removes the element from the document
     * Uses WorkspaceEdit for proper undo support
     */
    private async handleDeleteFromMarkdown(
        message: DeleteFromMarkdownMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const pathToDelete = message.path;

        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }

        // Collect all files to search
        const allFiles: MarkdownFile[] = [];
        const mainFile = fileRegistry.getMainFile();
        if (mainFile) {
            allFiles.push(mainFile);
        }
        allFiles.push(...fileRegistry.getIncludeFiles());

        // Find the file containing the path
        let foundFile: MarkdownFile | null = null;
        let foundContent: string = '';

        // Escape the path for regex
        const escapedPath = pathToDelete.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        for (const file of allFiles) {
            const content = file.getContent();
            if (content.includes(pathToDelete)) {
                foundFile = file;
                foundContent = content;
                break;
            }
        }

        if (!foundFile) {
            return this.failure('Path not found in any file');
        }

        // Pattern to match the entire element containing this path:
        // - Markdown images: ![alt](path) or ![alt](path "title")
        // - Markdown links: [text](path) or [text](path "title")
        // - HTML images: <img src="path" ...>
        // - Includes: !!!include(path)!!!
        // Also match if the element is already struck through: ~~![alt](path)~~

        // Build patterns for each type
        const imagePattern = `(~~)?!\\[[^\\]]*\\]\\(${escapedPath}(?:\\s+"[^"]*")?\\)(~~)?`;
        const linkPattern = `(~~)?(?<!!)\\[[^\\]]*\\]\\(${escapedPath}(?:\\s+"[^"]*")?\\)(~~)?`;
        const htmlImgPattern = `(~~)?<img[^>]*src=["']${escapedPath}["'][^>]*>(~~)?`;
        const includePattern = `(~~)?!!!include\\(${escapedPath}\\)!!!(~~)?`;

        // Combine patterns
        const combinedPattern = `(${imagePattern})|(${linkPattern})|(${htmlImgPattern})|(${includePattern})`;
        const regex = new RegExp(combinedPattern, 'g');

        const matches = foundContent.match(regex);
        if (!matches || matches.length === 0) {
            return this.failure('Could not find element containing this path');
        }

        // Remove each matching element completely
        let newContent = foundContent;
        for (const match of matches) {
            newContent = newContent.replace(match, '');
        }

        // Clean up any double newlines created by removal
        newContent = newContent.replace(/\n\n\n+/g, '\n\n');

        // Use WorkspaceEdit for proper undo support
        try {
            const filePath = foundFile.getPath();
            const document = await vscode.workspace.openTextDocument(filePath);

            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            edit.replace(document.uri, fullRange, newContent);

            const success = await vscode.workspace.applyEdit(edit);
            if (!success) {
                return this.failure('Failed to apply edit');
            }

            // Also update the in-memory cache so the board refresh shows correct content
            foundFile.setContent(newContent, false);
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[PathCommands] Error applying edit:`, error);
            return this.failure(`Failed to delete element: ${errorMessage}`);
        }

        // Refresh the board
        await this.refreshBoard(context);

        // Notify frontend
        this.postMessage({
            type: 'elementDeleted',
            path: pathToDelete,
            filePath: foundFile.getRelativePath()
        });

        showInfo(`Element deleted`);

        return this.success({
            deleted: true,
            path: pathToDelete,
            filePath: foundFile.getRelativePath()
        });
    }

    // ============= HELPER METHODS =============

    /**
     * Normalize a directory path for comparison
     * Strips leading ./ and normalizes separators
     * This ensures directories match regardless of ./ prefix
     */
    private normalizeDirForComparison(dir: string): string {
        let normalized = dir.replace(/\\/g, '/');
        if (normalized.startsWith('./')) {
            normalized = normalized.substring(2);
        }
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        return normalized;
    }


    private async _syncEditingState(context: CommandContext): Promise<void> {
        const capturedEdit = await context.requestStopEditing();
        if (!capturedEdit || capturedEdit.value === undefined) {
            return;
        }

        const board = context.getCurrentBoard();
        if (!board || !board.valid) {
            return;
        }

        let updated = false;

        if ((capturedEdit.type === 'task-title' || capturedEdit.type === 'task-description') && capturedEdit.taskId) {
            const column = capturedEdit.columnId
                ? findColumn(board, capturedEdit.columnId)
                : findColumnContainingTask(board, capturedEdit.taskId);
            const task = column?.tasks.find(t => t.id === capturedEdit.taskId);
            if (task) {
                if (capturedEdit.type === 'task-title') {
                    task.title = capturedEdit.value;
                } else {
                    task.description = capturedEdit.value;
                }
                updated = true;
            }
        } else if (capturedEdit.type === 'column-title' && capturedEdit.columnId) {
            const column = findColumn(board, capturedEdit.columnId);
            if (column) {
                column.title = capturedEdit.value;
                updated = true;
            }
        }

        if (updated) {
            // Only emit board changed, don't trigger onBoardUpdate()
            // The caller (_replacePathInFiles) will handle the webview update
            // after completing the path replacement, avoiding a double update
            context.emitBoardChanged(board, 'edit');
        }
    }

    // ============================================================================
    // PATH REPLACEMENT HELPERS - Shared by single and batch replacement modes
    // ============================================================================

    /**
     * Resolve the context-aware base path for path resolution.
     * If the path is from an include file, returns the include file's directory.
     * Otherwise returns the main file's directory (basePath).
     */
    private _resolveContextBasePath(
        board: KanbanBoard | null,
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
     * Generate all possible variants of a path for matching.
     * Handles URL encoding, HTML entities, slashes, and dot prefixes.
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

        // Add encoded version (from decoded to get canonical form)
        const encodedPath = encodeFilePath(decodedPath);
        if (encodedPath !== pathStr && encodedPath !== decodedPath) {
            pathVariants.push(encodedPath);
        }

        // Expand all variants with normalization transformations
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
     * Compute the replacement path based on format preference.
     */
    private _computeReplacementPath(
        _oldPath: string,
        newAbsolutePath: string,
        fileBasePath: string,
        pathFormat: PathFormat
    ): string {
        if (pathFormat === 'absolute') {
            return newAbsolutePath;
        } else if (pathFormat === 'relative') {
            return path.relative(fileBasePath, newAbsolutePath);
        } else {
            // 'auto' - use relative
            return path.relative(fileBasePath, newAbsolutePath);
        }
    }

    /**
     * Find a single path in the files (for single replacement mode).
     * Returns a Map with 0 or 1 entries.
     */
    private _findSinglePath(
        variants: string[],
        files: MarkdownFile[],
        newAbsolutePath: string,
        board: KanbanBoard | null,
        options: PathReplacementOptions
    ): Map<string, PathReplacement> {
        const replacements = new Map<string, PathReplacement>();

        // Strategy 1: Search in board structure first (more precise)
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
                    // Find which file this content belongs to
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
     * Find all paths with the same directory for batch replacement.
     * Returns a Map with 0 to N entries.
     */
    private _findBatchPaths(
        brokenPath: string,
        contextBasePath: string,
        files: MarkdownFile[],
        newDir: string
    ): Map<string, PathReplacement> {
        const replacements = new Map<string, PathReplacement>();

        // Get the directory of the broken path
        const decodedBrokenPath = safeDecodeURIComponent(brokenPath);
        const absoluteBrokenPath = path.isAbsolute(decodedBrokenPath)
            ? decodedBrokenPath
            : path.resolve(contextBasePath, decodedBrokenPath);
        const brokenDir = this.normalizeDirForComparison(path.dirname(absoluteBrokenPath));

        // Pattern to match images, links, and includes
        const pathPattern = /!\[[^\]]*\]\(([^)]+)\)|(?<!!)\[[^\]]*\]\(([^)]+)\)|!!!include\(([^)]+)\)!!!/g;

        for (const file of files) {
            const content = file.getContent();
            const fileDir = path.dirname(file.getPath());
            let match;

            while ((match = pathPattern.exec(content)) !== null) {
                const matchedPath = match[1] || match[2] || match[3];
                if (!matchedPath) continue;

                const decodedPath = safeDecodeURIComponent(matchedPath);
                const absolutePath = path.isAbsolute(decodedPath)
                    ? decodedPath
                    : path.resolve(fileDir, decodedPath);
                const pathDir = this.normalizeDirForComparison(path.dirname(absolutePath));

                // Check if this path is in the same directory as the broken path
                if (pathDir === brokenDir) {
                    const filename = path.basename(decodedPath);
                    const newAbsPath = path.join(newDir, filename);

                    // Check if the file exists in the new location
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

        return replacements;
    }

    /**
     * Execute the path replacements in the files.
     */
    private _executeReplacements(
        replacements: Map<string, PathReplacement>,
        pathFormat: PathFormat
    ): MarkdownFile[] {
        const modifiedFiles: MarkdownFile[] = [];

        for (const [oldPath, replacement] of replacements) {
            const file = replacement.sourceFile;
            const fileDir = path.dirname(file.getPath());
            const newRelativePath = this._computeReplacementPath(
                oldPath,
                replacement.newAbsolutePath,
                fileDir,
                pathFormat
            );
            const encodedNewPath = encodeFilePath(newRelativePath);

            let content = file.getContent();
            let newContent = LinkOperations.replaceSingleLink(content, oldPath, encodedNewPath, 0);

            // If encoded old path didn't match, try decoded version
            if (newContent === content && replacement.decodedOldPath !== oldPath) {
                newContent = LinkOperations.replaceSingleLink(content, replacement.decodedOldPath, encodedNewPath, 0);
            }

            if (newContent !== content) {
                file.setContent(newContent);
                if (!modifiedFiles.includes(file)) {
                    modifiedFiles.push(file);
                }
            }
        }

        return modifiedFiles;
    }

    /**
     * Check if a path was an include path and handle the include switch if needed.
     * Returns true if an include switch was handled, false otherwise.
     */
    private async _handleIncludeSwitchIfNeeded(
        context: CommandContext,
        board: KanbanBoard | null,
        options: PathReplacementOptions,
        oldTitle: string,
        newTitle: string
    ): Promise<boolean> {
        if (!board) return false;

        const oldIncludePaths = extractIncludeFiles(oldTitle);
        const newIncludePaths = extractIncludeFiles(newTitle);

        // No include files involved
        if (oldIncludePaths.length === 0 && newIncludePaths.length === 0) {
            return false;
        }

        // Check if include paths actually changed (using normalized comparison)
        const normalizeForCompare = (p: string) => safeDecodeURIComponent(p).toLowerCase();
        const oldNormalized = new Set(oldIncludePaths.map(normalizeForCompare));
        const newNormalized = new Set(newIncludePaths.map(normalizeForCompare));

        const includesChanged = oldNormalized.size !== newNormalized.size ||
            [...oldNormalized].some(p => !newNormalized.has(p));

        if (!includesChanged) {
            return false;
        }

        // Include paths changed - trigger include switch
        if (options.isColumnTitle && options.columnId) {
            await context.handleIncludeSwitch({
                columnId: options.columnId,
                oldFiles: oldIncludePaths,
                newFiles: newIncludePaths,
                newTitle: newTitle
            });
            return true;
        } else if (options.taskId) {
            await context.handleIncludeSwitch({
                taskId: options.taskId,
                oldFiles: oldIncludePaths,
                newFiles: newIncludePaths,
                newTitle: newTitle
            });
            return true;
        }

        // Can't determine context, fall back to full refresh
        await this.refreshBoard(context);
        return true;
    }

    /**
     * Apply ALL replacements to a text string.
     */
    private _applyAllReplacements(
        text: string,
        replacements: Map<string, PathReplacement>,
        mainFileDir: string,
        pathFormat: PathFormat
    ): string {
        let result = text;
        for (const [, replacement] of replacements) {
            const encodedNewPath = encodeFilePath(
                this._computeReplacementPath(
                    replacement.oldPath,
                    replacement.newAbsolutePath,
                    mainFileDir,
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

    /**
     * Apply board updates - either targeted or full refresh.
     */
    private async _applyBoardUpdates(
        context: CommandContext,
        board: KanbanBoard | null,
        modifiedFiles: MarkdownFile[],
        mainFile: MarkdownFile,
        replacements: Map<string, PathReplacement>,
        options: PathReplacementOptions
    ): Promise<void> {
        const mainFileDir = path.dirname(mainFile.getPath());
        const mainFileModified = modifiedFiles.some(f => f.getPath() === mainFile.getPath());
        const includeFilesModified = modifiedFiles.some(f => f.getPath() !== mainFile.getPath());

        // Use targeted updates when possible
        if (!includeFilesModified && mainFileModified && board && (options.taskId || options.columnId)) {
            if (options.isColumnTitle && options.columnId) {
                const column = board.columns.find((c: KanbanColumn) => c.id === options.columnId);
                if (column) {
                    const oldTitle = column.title || '';
                    const newTitle = this._applyAllReplacements(oldTitle, replacements, mainFileDir, options.pathFormat);

                    // Check for include switch
                    const hadIncludeSwitch = await this._handleIncludeSwitchIfNeeded(
                        context, board, options, oldTitle, newTitle
                    );
                    if (hadIncludeSwitch) {
                        return;
                    }

                    // Update column with new title
                    column.title = newTitle;
                    this.postMessage({
                        type: 'updateColumnTitle',
                        columnId: options.columnId,
                        title: column.title,
                        imageMappings: {}
                    });
                    context.boardStore.invalidateCache();
                    return;
                }
            } else if (options.taskId && options.columnId) {
                const column = board.columns.find((c: KanbanColumn) => c.id === options.columnId);
                const task = column?.tasks.find((t: KanbanTask) => t.id === options.taskId);
                if (task) {
                    const oldTitle = task.title || '';
                    const newTitle = this._applyAllReplacements(oldTitle, replacements, mainFileDir, options.pathFormat);

                    // Check for include switch (title may contain include directive)
                    const hadIncludeSwitch = await this._handleIncludeSwitchIfNeeded(
                        context, board, options, oldTitle, newTitle
                    );
                    if (hadIncludeSwitch) {
                        return;
                    }

                    // Update task with new paths
                    task.title = newTitle;
                    if (task.description) {
                        task.description = this._applyAllReplacements(
                            task.description, replacements, mainFileDir, options.pathFormat
                        );
                    }

                    this.postMessage({
                        type: 'updateTaskContent',
                        taskId: options.taskId,
                        columnId: options.columnId,
                        task: task,
                        imageMappings: {}
                    });
                    context.boardStore.invalidateCache();
                    return;
                }
            }
        }

        // Fall back to full refresh
        await this.refreshBoard(context);
    }

    /**
     * Send notifications about the path replacement.
     */
    private _sendReplacementNotifications(
        originalPath: string,
        actualPath: string,
        newPath: string,
        filePath: string,
        options: PathReplacementOptions
    ): void {
        this.postMessage({
            type: 'imagePathReplaced',
            originalPath,
            newPath,
            file: filePath
        });

        // Also send a generic path replaced message for non-image paths
        if (!originalPath.match(/\.(png|jpg|jpeg|gif|bmp|webp|svg|ico)$/i)) {
            this.postMessage({
                type: 'pathReplaced',
                oldPath: actualPath,
                newPath,
                taskId: options.taskId,
                columnId: options.columnId
            });
        }
    }

    /**
     * Unified path replacement function - handles both single and batch modes.
     */
    private async _replacePaths(
        brokenPath: string,
        selectedPath: string,
        basePath: string,
        context: CommandContext,
        options: PathReplacementOptions
    ): Promise<CommandResult> {
        logger.debug('[PathCommands._replacePaths] START', {
            brokenPath: brokenPath.substring(0, 100),
            selectedPath: selectedPath.substring(0, 100),
            mode: options.mode,
            taskId: options.taskId,
            columnId: options.columnId
        });

        // 1. Sync editing state (capture any unsaved edits)
        await this._syncEditingState(context);

        // 2. Get file registry
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }

        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            return this.failure('No main file found');
        }

        const allFiles: MarkdownFile[] = [mainFile, ...fileRegistry.getIncludeFiles()];
        const board = context.boardStore.getBoard();

        // 3. Save undo entry
        if (board) {
            let undoEntry;
            if (options.taskId && options.columnId) {
                undoEntry = UndoCapture.forTask(board, options.taskId, options.columnId, 'path-replace');
            } else if (options.columnId) {
                undoEntry = UndoCapture.forColumn(board, options.columnId, 'path-replace');
            } else {
                undoEntry = UndoCapture.forFullBoard(board, 'path-replace');
            }
            context.boardStore.saveUndoEntry(undoEntry);
        }

        // 4. Resolve context base path
        const contextBasePath = this._resolveContextBasePath(
            board, basePath, options.taskId, options.columnId, options.isColumnTitle
        );

        // 5. Collect paths to replace (MODE-SPECIFIC)
        let replacements: Map<string, PathReplacement>;

        if (options.mode === 'single') {
            const variants = this._generatePathVariants(brokenPath);
            replacements = this._findSinglePath(variants, allFiles, selectedPath, board, options);
        } else {
            // Batch mode - selectedPath is the new directory
            const newDir = path.dirname(selectedPath);
            replacements = this._findBatchPaths(brokenPath, contextBasePath, allFiles, newDir);
        }

        if (replacements.size === 0) {
            if (options.mode === 'batch') {
                showWarning('No matching paths found to replace.');
                return this.success({ replaced: false, count: 0 });
            }
            return this.failure('Path not found in any file');
        }

        // 6. Execute replacements
        const modifiedFiles = this._executeReplacements(replacements, options.pathFormat);

        // 7. Apply board updates
        await this._applyBoardUpdates(context, board, modifiedFiles, mainFile, replacements, options);

        // 8. Send notifications
        const firstReplacement = replacements.values().next().value;
        const newPath = firstReplacement ? this._computeReplacementPath(
            firstReplacement.oldPath,
            firstReplacement.newAbsolutePath,
            path.dirname(mainFile.getPath()),
            options.pathFormat
        ) : '';

        if (firstReplacement) {
            this._sendReplacementNotifications(
                brokenPath, firstReplacement.oldPath, newPath,
                firstReplacement.sourceFile.getRelativePath(), options
            );
        }

        // 9. Show success message
        const message = options.mode === 'batch'
            ? `Replaced ${replacements.size} path${replacements.size > 1 ? 's' : ''}`
            : options.successMessage || 'Path updated';
        showInfo(message);

        return this.success({
            replaced: true,
            count: replacements.size,
            oldPath: brokenPath,
            newPath: firstReplacement ? this._computeReplacementPath(
                firstReplacement.oldPath,
                firstReplacement.newAbsolutePath,
                path.dirname(mainFile.getPath()),
                options.pathFormat
            ) : undefined
        });
    }
}
