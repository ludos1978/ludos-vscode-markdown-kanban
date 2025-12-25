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
import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { PathConversionService, ConversionResult } from '../services/PathConversionService';
import { getErrorMessage, encodeFilePath } from '../utils/stringUtils';
import { MarkdownFile } from '../files/MarkdownFile';
import { ConvertPathsMessage, ConvertAllPathsMessage, ConvertSinglePathMessage, OpenPathMessage, SearchForFileMessage, RevealPathInExplorerMessage, BrowseForImageMessage, DeleteFromMarkdownMessage } from '../core/bridge/MessageTypes';
import { safeFileUri } from '../utils/uriUtils';
import { FileSearchService } from '../fileSearchService';
import { LinkOperations } from '../utils/linkOperations';
import { UndoCapture } from '../core/stores/UndoCapture';

type PathCommandMessage = ConvertPathsMessage | ConvertAllPathsMessage | ConvertSinglePathMessage | OpenPathMessage | SearchForFileMessage | RevealPathInExplorerMessage | BrowseForImageMessage | DeleteFromMarkdownMessage;

/**
 * Path Commands Handler
 *
 * Processes path conversion messages from the webview.
 */
export class PathCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'path-commands',
        name: 'Path Commands',
        description: 'Handles path conversion between absolute and relative formats',
        messageTypes: ['convertPaths', 'convertAllPaths', 'convertSinglePath', 'openPath', 'searchForFile', 'revealPathInExplorer', 'browseForImage', 'deleteFromMarkdown'],
        priority: 100
    };

    async execute(message: PathCommandMessage, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'convertPaths':
                    return await this.handleConvertPaths(message, context);
                case 'convertAllPaths':
                    return await this.handleConvertAllPaths(message, context);
                case 'convertSinglePath':
                    return await this.handleConvertSinglePath(message, context);
                case 'openPath':
                    return await this.handleOpenPath(message, context);
                case 'searchForFile':
                    return await this.handleSearchForFile(message, context);
                case 'revealPathInExplorer':
                    return await this.handleRevealPathInExplorer(message, context);
                case 'browseForImage':
                    return await this.handleBrowseForImage(message, context);
                case 'deleteFromMarkdown':
                    return await this.handleDeleteFromMarkdown(message, context);
                default:
                    return this.failure(`Unknown path command: ${(message as { type: string }).type}`);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[PathCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

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

        // Invalidate board cache and refresh webview to show updated paths
        context.boardStore.invalidateCache();
        await context.onBoardUpdate();

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

        // Invalidate board cache and refresh webview to show updated paths
        if (totalConverted > 0) {
            context.boardStore.invalidateCache();
            await context.onBoardUpdate();
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

        // Always invalidate board cache and refresh webview to show updated paths
        // This is needed for includes to update their displayed path
        context.boardStore.invalidateCache();
        await context.onBoardUpdate();

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
            const fileSearchService = new FileSearchService();
            fileSearchService.setWebview(context.fileManager.getWebview());
            const result = await fileSearchService.pickReplacementForBrokenLink(oldPath, basePath);

            if (!result) {
                return this.success({ cancelled: true });
            }

            const selectedFile = result.uri.fsPath;

            // Handle batch replacement if enabled
            if (result.batchReplace) {
                return await this._batchReplacePaths(oldPath, selectedFile, basePath, context);
            }

            // Single file replacement
            const successMessage = `Path updated: ${path.basename(oldPath)} → ${path.basename(selectedFile)}`;
            return await this._replacePathInFiles(oldPath, selectedFile, basePath, context, successMessage, message.taskId, message.columnId, message.isColumnTitle);
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
                    vscode.window.showInformationMessage(`File not found. Opened parent folder: ${path.basename(parentDir)}`);
                    return this.success({ revealed: true, path: parentDir, fallbackToParent: true });
                } catch (error) {
                    const errorMessage = getErrorMessage(error);
                    console.error(`[PathCommands] Error revealing parent folder:`, error);
                    vscode.window.showWarningMessage(`File not found and failed to open parent folder: ${errorMessage}`);
                    return this.failure(`File not found and failed to open parent folder: ${errorMessage}`);
                }
            } else {
                vscode.window.showWarningMessage(`File not found: ${resolvedPath}`);
                return this.failure(`Path does not exist: ${resolvedPath}`);
            }
        }

        try {
            await vscode.commands.executeCommand('revealFileInOS', safeFileUri(resolvedPath, 'PathCommands-revealInExplorer'));
            return this.success({ revealed: true, path: resolvedPath });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[PathCommands] Error revealing path in explorer:`, error);
            vscode.window.showWarningMessage(`Failed to reveal in file explorer: ${errorMessage}`);
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
        return await this._replacePathInFiles(oldPath, selectedFile, basePath, context, 'Image path updated successfully', message.taskId, message.columnId, message.isColumnTitle);
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
        context.boardStore.invalidateCache();
        await context.onBoardUpdate();

        // Notify frontend
        this.postMessage({
            type: 'elementDeleted',
            path: pathToDelete,
            filePath: foundFile.getRelativePath()
        });

        vscode.window.showInformationMessage(`Element deleted`);

        return this.success({
            deleted: true,
            path: pathToDelete,
            filePath: foundFile.getRelativePath()
        });
    }

    // ============= HELPER METHODS =============

    /**
     * Replace a path in markdown files and refresh the board
     * Common logic used by handleSearchForFile and handleBrowseForImage
     * If taskId and columnId are provided, sends targeted update instead of full refresh
     * If isColumnTitle is true, updates column title instead of task
     */
    private async _replacePathInFiles(
        oldPath: string,
        selectedFilePath: string,
        basePath: string,
        context: CommandContext,
        successMessage: string,
        taskId?: string,
        columnId?: string,
        isColumnTitle?: boolean
    ): Promise<CommandResult> {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }
        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            return this.failure('No main file found');
        }

        // Save undo entry before making changes
        const currentBoard = context.boardStore.getBoard();
        if (currentBoard) {
            if (taskId && columnId) {
                const undoEntry = UndoCapture.forTask(currentBoard, taskId, columnId, 'path-replace');
                context.boardStore.saveUndoEntry(undoEntry);
            } else if (columnId) {
                const undoEntry = UndoCapture.forColumn(currentBoard, columnId, 'path-replace');
                context.boardStore.saveUndoEntry(undoEntry);
            } else {
                const undoEntry = UndoCapture.forFullBoard(currentBoard, 'path-replace');
                context.boardStore.saveUndoEntry(undoEntry);
            }
        }

        // Determine if the old path was relative or absolute
        const wasRelative = !path.isAbsolute(oldPath) && !oldPath.match(/^[a-zA-Z]:[\\\/]/);

        // Convert the new path to match the old path's format
        let newPath: string;
        if (wasRelative) {
            newPath = path.relative(basePath, selectedFilePath);
            newPath = newPath.replace(/\\/g, '/'); // Normalize to forward slashes
            if (!newPath.startsWith('.') && !newPath.startsWith('/')) {
                newPath = './' + newPath;
            }
        } else {
            newPath = selectedFilePath;
        }

        // URL-encode the path for markdown
        newPath = encodeFilePath(newPath);

        // Collect all files to search
        const allFiles: MarkdownFile[] = [mainFile, ...fileRegistry.getIncludeFiles()];

        // Find the file containing the old path
        let foundFile: MarkdownFile | null = null;
        let foundContent: string = '';

        const escapedOldPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedOldPath, 'g');

        for (const file of allFiles) {
            const content = file.getContent();
            if (regex.test(content)) {
                foundFile = file;
                foundContent = content;
                break;
            }
            regex.lastIndex = 0;
        }

        if (!foundFile) {
            return this.failure('Old path not found in any file');
        }

        // Use LinkOperations to replace with strikethrough pattern
        const newContent = LinkOperations.replaceSingleLink(foundContent, oldPath, newPath, 0);

        if (newContent === foundContent) {
            // Fallback to direct replacement
            regex.lastIndex = 0;
            foundFile.setContent(foundContent.replace(regex, newPath), false);
        } else {
            foundFile.setContent(newContent, false);
        }

        // Send targeted update based on context
        if (isColumnTitle && columnId) {
            // Image is in column title - update column only
            const board = context.boardStore.getBoard();
            if (board) {
                const column = board.columns.find(c => c.id === columnId);
                if (column) {
                    // Manually update the column title with the new path
                    column.title = LinkOperations.replaceSingleLink(column.title, oldPath, newPath, 0);

                    // Send targeted column update
                    this.postMessage({
                        type: 'updateColumnContent',
                        columnId: columnId,
                        column: column,
                        imageMappings: {}
                    });
                } else {
                    // Column not found, fall back to full update
                    context.boardStore.invalidateCache();
                    await context.onBoardUpdate();
                }
            } else {
                context.boardStore.invalidateCache();
                await context.onBoardUpdate();
            }
        } else if (taskId && columnId) {
            // Image is in task - update task only
            const board = context.boardStore.getBoard();
            if (board) {
                const column = board.columns.find(c => c.id === columnId);
                const task = column?.tasks.find(t => t.id === taskId);
                if (task && column) {
                    // Manually update the task object with the new path
                    // This avoids full board reparsing
                    task.title = LinkOperations.replaceSingleLink(task.title, oldPath, newPath, 0);
                    if (task.description) {
                        task.description = LinkOperations.replaceSingleLink(task.description, oldPath, newPath, 0);
                    }

                    // Send targeted task update with the modified task
                    this.postMessage({
                        type: 'updateTaskContent',
                        taskId: taskId,
                        columnId: columnId,
                        task: task,
                        imageMappings: {}
                    });
                } else {
                    // Task/column not found, fall back to full update
                    context.boardStore.invalidateCache();
                    await context.onBoardUpdate();
                }
            } else {
                context.boardStore.invalidateCache();
                await context.onBoardUpdate();
            }
        } else {
            // No context, do full board refresh
            context.boardStore.invalidateCache();
            await context.onBoardUpdate();
        }

        // Notify frontend about the replacement
        this.postMessage({
            type: 'imagePathReplaced',
            oldPath: oldPath,
            newPath: newPath,
            filePath: foundFile.getRelativePath()
        });

        vscode.window.showInformationMessage(successMessage);

        return this.success({
            replaced: true,
            oldPath: oldPath,
            newPath: newPath,
            filePath: foundFile.getRelativePath()
        });
    }

    /**
     * Batch replace paths with the same directory prefix.
     * Finds all paths in the board that have the same directory as the broken path,
     * checks if the corresponding file exists in the new directory,
     * and replaces all matching paths.
     */
    private async _batchReplacePaths(
        brokenPath: string,
        selectedPath: string,
        basePath: string,
        context: CommandContext
    ): Promise<CommandResult> {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }

        // Save undo entry before making changes
        const currentBoard = context.boardStore.getBoard();
        if (currentBoard) {
            const undoEntry = UndoCapture.forFullBoard(currentBoard, 'batch-path-replace');
            context.boardStore.saveUndoEntry(undoEntry);
        }

        // Extract directories from paths
        const brokenDir = path.dirname(brokenPath);
        const newDir = path.dirname(selectedPath);

        // Collect all files to search
        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            return this.failure('No main file found');
        }
        const allFiles: MarkdownFile[] = [mainFile, ...fileRegistry.getIncludeFiles()];

        // Find all image/file paths in the content that start with brokenDir
        const pathPattern = /!\[([^\]]*)\]\(([^)]+)\)|(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
        const pathsToReplace: Map<string, string> = new Map(); // oldPath -> newPath
        const skippedPaths: string[] = []; // Paths where new file doesn't exist

        for (const file of allFiles) {
            const content = file.getContent();
            let match;
            pathPattern.lastIndex = 0;

            while ((match = pathPattern.exec(content)) !== null) {
                // Get the path from either image or link syntax
                const foundPath = match[2] || match[4];
                if (!foundPath) continue;

                // Decode the path for comparison
                let decodedPath: string;
                try {
                    decodedPath = decodeURIComponent(foundPath);
                } catch {
                    decodedPath = foundPath;
                }

                // Check if this path is in the broken directory
                const foundDir = path.dirname(decodedPath);
                if (foundDir === brokenDir || decodedPath.startsWith(brokenDir + '/') || decodedPath.startsWith(brokenDir + '\\')) {
                    // Calculate the new path
                    const filename = path.basename(decodedPath);
                    const newPath = path.join(newDir, filename);

                    // Check if the new file exists
                    let newPathResolved = newPath;
                    if (!path.isAbsolute(newPath)) {
                        newPathResolved = path.resolve(basePath, newPath);
                    }

                    try {
                        await fs.promises.access(newPathResolved);
                        // File exists, add to replacement map
                        if (!pathsToReplace.has(decodedPath)) {
                            pathsToReplace.set(decodedPath, newPath);
                        }
                    } catch {
                        // File doesn't exist in new location
                        if (!skippedPaths.includes(filename)) {
                            skippedPaths.push(filename);
                        }
                    }
                }
            }
        }

        if (pathsToReplace.size === 0) {
            vscode.window.showWarningMessage('No matching paths found to replace.');
            return this.success({ replaced: false, count: 0 });
        }

        // Perform all replacements
        let replacedCount = 0;
        for (const file of allFiles) {
            let content = file.getContent();
            let modified = false;

            for (const [oldPath, newPath] of pathsToReplace) {
                // Encode paths for replacement in markdown
                const encodedOldPath = encodeFilePath(oldPath);
                const encodedNewPath = encodeFilePath(newPath);

                // Also try the original (possibly already encoded) path
                const escapedOldPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escapedEncodedOldPath = encodedOldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                const regex1 = new RegExp(escapedOldPath, 'g');
                const regex2 = new RegExp(escapedEncodedOldPath, 'g');

                const newContent1 = content.replace(regex1, encodedNewPath);
                if (newContent1 !== content) {
                    content = newContent1;
                    modified = true;
                    replacedCount++;
                }

                const newContent2 = content.replace(regex2, encodedNewPath);
                if (newContent2 !== content) {
                    content = newContent2;
                    modified = true;
                    // Don't double count if both matched
                }
            }

            if (modified) {
                file.setContent(content, false);
            }
        }

        // Refresh the board
        context.boardStore.invalidateCache();
        await context.onBoardUpdate();

        // Show result notification
        const skippedMsg = skippedPaths.length > 0
            ? ` (${skippedPaths.length} skipped - file not found)`
            : '';
        vscode.window.showInformationMessage(
            `Replaced ${pathsToReplace.size} paths${skippedMsg}`
        );

        return this.success({
            replaced: true,
            count: pathsToReplace.size,
            skipped: skippedPaths.length
        });
    }
}
