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
import { ConvertPathsMessage, ConvertAllPathsMessage, ConvertSinglePathMessage, OpenPathMessage, SearchForFileMessage, RevealPathInExplorerMessage, BrowseForImageMessage, DeleteFromMarkdownMessage, IncomingMessage } from '../core/bridge/MessageTypes';
import { safeFileUri } from '../utils/uriUtils';
import { FileSearchService } from '../fileSearchService';
import { LinkOperations } from '../utils/linkOperations';

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

        console.log(`[PathCommands] convertSinglePath called with path: "${imagePath}", direction: ${message.direction}, skipRefresh: ${message.skipRefresh}`);

        // Collect all files to search
        const allFiles: MarkdownFile[] = [];
        const mainFile = fileRegistry.getMainFile();
        if (mainFile) {
            allFiles.push(mainFile);
        }
        allFiles.push(...fileRegistry.getIncludeFiles());

        console.log(`[PathCommands] Searching in ${allFiles.length} files`);

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
            console.log(`[PathCommands] Checking file: ${file.getRelativePath()}, content length: ${content.length}`);

            for (const pathVariation of pathVariations) {
                if (content.includes(pathVariation)) {
                    foundFile = file;
                    foundContent = content;
                    actualPathInContent = pathVariation;
                    console.log(`[PathCommands] Found path "${pathVariation}" in file: ${file.getRelativePath()}`);
                    break;
                }
            }
            if (foundFile) break;
        }

        if (!foundFile) {
            console.log(`[PathCommands] Path not found in any file: ${imagePath}`);
            // Log first 200 chars of each file for debugging
            for (const file of allFiles) {
                const content = file.getContent();
                console.log(`[PathCommands] File ${file.getRelativePath()} content preview: ${content.substring(0, 200)}`);
            }
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

        console.log(`[PathCommands] Replacing "${actualPathInContent}" with "${newPath}"`);
        console.log(`[PathCommands] Old content length: ${foundContent.length}, New content length: ${newContent.length}`);
        console.log(`[PathCommands] Content changed: ${foundContent !== newContent}`);

        // Update file content in cache (marks as unsaved, does NOT save to disk)
        foundFile.setContent(newContent, false);
        console.log(`[PathCommands] File content updated in cache for: ${foundFile.getRelativePath()}`);

        // Always invalidate board cache and refresh webview to show updated paths
        // This is needed for includes to update their displayed path
        context.boardStore.invalidateCache();
        console.log(`[PathCommands] Board cache invalidated, calling onBoardUpdate...`);
        await context.onBoardUpdate();
        console.log(`[PathCommands] onBoardUpdate completed`);

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
        context: CommandContext
    ): Promise<CommandResult> {
        const filePath = message.filePath;
        console.log(`[PathCommands] openPath called with path: "${filePath}"`);

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

        console.log(`[PathCommands] Opening path with system default app: "${resolvedPath}"`);

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
        console.log(`[PathCommands] searchForFile called with path: "${oldPath}"`);

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
            // Use FileSearchService to show QuickPick with smart search
            const fileSearchService = new FileSearchService();
            const replacement = await fileSearchService.pickReplacementForBrokenLink(oldPath, basePath);

            if (!replacement) {
                console.log(`[PathCommands] User cancelled file selection`);
                return this.success({ cancelled: true });
            }

            const selectedFile = replacement.fsPath;
            console.log(`[PathCommands] User selected file: "${selectedFile}"`);

            // Determine if the old path was relative or absolute
            const wasRelative = !path.isAbsolute(oldPath) && !oldPath.match(/^[a-zA-Z]:[\\\/]/);

            // Convert the new path to the same format as the old path
            let newPath: string;
            if (wasRelative) {
                // Convert to relative path from the main file's directory
                newPath = path.relative(basePath, selectedFile);
                // Normalize to forward slashes
                newPath = newPath.replace(/\\/g, '/');
                // Add ./ prefix if it doesn't start with . or /
                if (!newPath.startsWith('.') && !newPath.startsWith('/')) {
                    newPath = './' + newPath;
                }
            } else {
                newPath = selectedFile;
            }

            // URL-encode the path for markdown (same encoding as when dropping images)
            newPath = encodeFilePath(newPath);

            console.log(`[PathCommands] Replacing "${oldPath}" with "${newPath}"`);

            // Collect all files to search
            const allFiles: MarkdownFile[] = [];
            allFiles.push(mainFile);
            allFiles.push(...fileRegistry.getIncludeFiles());

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
                console.log(`[PathCommands] Old path not found in any file: ${oldPath}`);
                return this.failure('Old path not found in any file');
            }

            // Use LinkOperations to replace with strikethrough pattern
            // This produces: ~~![alt](old-path)~~ ![alt](new-path)
            const newContent = LinkOperations.replaceSingleLink(foundContent, oldPath, newPath, 0);

            if (newContent === foundContent) {
                console.log(`[PathCommands] LinkOperations did not find a match, trying direct replacement`);
                // Fallback to direct replacement if LinkOperations doesn't find a match
                regex.lastIndex = 0;
                const directContent = foundContent.replace(regex, newPath);
                foundFile.setContent(directContent, false);
            } else {
                // Update file content with strikethrough version
                foundFile.setContent(newContent, false);
            }
            console.log(`[PathCommands] File content updated: ${foundFile.getRelativePath()}`);

            // Refresh the board to show the new image
            context.boardStore.invalidateCache();
            await context.onBoardUpdate();

            // Notify frontend
            this.postMessage({
                type: 'imagePathReplaced',
                oldPath: oldPath,
                newPath: newPath,
                filePath: foundFile.getRelativePath()
            });

            vscode.window.showInformationMessage(`Path updated: ${path.basename(oldPath)} → ${path.basename(newPath)}`);

            return this.success({
                replaced: true,
                oldPath: oldPath,
                newPath: newPath,
                filePath: foundFile.getRelativePath()
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
        context: CommandContext
    ): Promise<CommandResult> {
        const filePath = message.filePath;
        console.log(`[PathCommands] revealPathInExplorer called with path: "${filePath}"`);

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

        console.log(`[PathCommands] Revealing path in explorer: "${resolvedPath}"`);

        // Check if the path exists
        if (!fs.existsSync(resolvedPath)) {
            console.log(`[PathCommands] Path does not exist: "${resolvedPath}"`);
            vscode.window.showWarningMessage(`File not found: ${resolvedPath}`);
            return this.failure(`Path does not exist: ${resolvedPath}`);
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
        console.log(`[PathCommands] browseForImage called with oldPath: "${oldPath}"`);

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
            console.log(`[PathCommands] User cancelled file selection`);
            return this.success({ cancelled: true });
        }

        const selectedFile = result[0].fsPath;
        console.log(`[PathCommands] User selected file: "${selectedFile}"`);

        // Determine if the old path was relative or absolute
        const wasRelative = !path.isAbsolute(oldPath) && !oldPath.match(/^[a-zA-Z]:[\\\/]/);

        // Convert the new path to the same format as the old path
        let newPath: string;
        if (wasRelative) {
            // Convert to relative path from the main file's directory
            newPath = path.relative(basePath, selectedFile);
            // Normalize to forward slashes
            newPath = newPath.replace(/\\/g, '/');
            // Add ./ prefix if it doesn't start with . or /
            if (!newPath.startsWith('.') && !newPath.startsWith('/')) {
                newPath = './' + newPath;
            }
        } else {
            newPath = selectedFile;
        }

        // URL-encode the path for markdown (same encoding as when dropping images)
        newPath = encodeFilePath(newPath);

        console.log(`[PathCommands] Replacing "${oldPath}" with "${newPath}"`);

        // Collect all files to search
        const allFiles: MarkdownFile[] = [];
        allFiles.push(mainFile);
        allFiles.push(...fileRegistry.getIncludeFiles());

        // Find the file containing the old path
        let foundFile: MarkdownFile | null = null;
        let foundContent: string = '';

        // Create regex to find the old path in markdown image syntax
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
            console.log(`[PathCommands] Old path not found in any file: ${oldPath}`);
            return this.failure('Old path not found in any file');
        }

        // Use LinkOperations to replace with strikethrough pattern
        // This produces: ~~![alt](old-path)~~ ![alt](new-path)
        const newContent = LinkOperations.replaceSingleLink(foundContent, oldPath, newPath, 0);

        if (newContent === foundContent) {
            console.log(`[PathCommands] LinkOperations did not find a match, trying direct replacement`);
            // Fallback to direct replacement if LinkOperations doesn't find a match
            regex.lastIndex = 0;
            const directContent = foundContent.replace(regex, newPath);
            foundFile.setContent(directContent, false);
        } else {
            // Update file content with strikethrough version
            foundFile.setContent(newContent, false);
        }
        console.log(`[PathCommands] File content updated: ${foundFile.getRelativePath()}`);

        // Refresh the board to show the new image
        context.boardStore.invalidateCache();
        await context.onBoardUpdate();

        // Notify frontend
        this.postMessage({
            type: 'imagePathReplaced',
            oldPath: oldPath,
            newPath: newPath,
            filePath: foundFile.getRelativePath()
        });

        vscode.window.showInformationMessage(`Image path updated successfully`);

        return this.success({
            replaced: true,
            oldPath: oldPath,
            newPath: newPath,
            filePath: foundFile.getRelativePath()
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
        console.log(`[PathCommands] deleteFromMarkdown called with path: "${pathToDelete}"`);

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
                console.log(`[PathCommands] Found path in file: ${file.getRelativePath()}`);
                break;
            }
        }

        if (!foundFile) {
            console.log(`[PathCommands] Path not found in any file: ${pathToDelete}`);
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
            console.log(`[PathCommands] Could not find matching element for path: ${pathToDelete}`);
            return this.failure('Could not find element containing this path');
        }

        console.log(`[PathCommands] Found ${matches.length} matching element(s): ${matches.join(', ')}`);

        // Remove each matching element completely
        let newContent = foundContent;
        for (const match of matches) {
            newContent = newContent.replace(match, '');
            console.log(`[PathCommands] Removed element: ${match}`);
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

            console.log(`[PathCommands] File content updated via WorkspaceEdit: ${foundFile.getRelativePath()}`);
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
}
