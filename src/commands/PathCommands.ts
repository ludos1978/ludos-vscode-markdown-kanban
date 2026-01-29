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
import { getErrorMessage, encodeFilePath } from '../utils/stringUtils';
import { MarkdownFile } from '../files/MarkdownFile';
import { ConvertPathsMessage, ConvertAllPathsMessage, ConvertSinglePathMessage, OpenPathMessage, SearchForFileMessage, RevealPathInExplorerMessage, BrowseForImageMessage, WebSearchForImageMessage, DeleteFromMarkdownMessage } from '../core/bridge/MessageTypes';
import { safeFileUri } from '../utils/uriUtils';
import { FileSearchService, TrackedFileData } from '../fileSearchService';
import { PathFormat } from '../services/FileSearchWebview';
import { showInfo, showWarning } from '../services/NotificationService';
import { findColumn, findColumnContainingTask } from '../actions/helpers';
import { logger } from '../utils/logger';
import { linkReplacementService, ReplacementDependencies } from '../services/LinkReplacementService';
import { WebImageSearchService } from '../services/WebImageSearchService';

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
 * Path Commands Handler
 *
 * Processes path conversion messages from the webview.
 */
export class PathCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'path-commands',
        name: 'Path Commands',
        description: 'Handles path conversion between absolute and relative formats',
        messageTypes: ['convertPaths', 'convertAllPaths', 'convertSinglePath', 'openPath', 'searchForFile', 'revealPathInExplorer', 'browseForImage', 'webSearchForImage', 'deleteFromMarkdown'],
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
        'webSearchForImage': (msg, ctx) => this.handleWebSearchForImage(msg as WebSearchForImageMessage, ctx),
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
     * Helper to convert paths in a single file
     */
    private _convertFilePaths(
        file: MarkdownFile,
        direction: 'relative' | 'absolute',
        conversionService: PathConversionService
    ): ConversionResult {
        const basePath = path.dirname(file.getPath());
        const content = file.getContent();

        const result = direction === 'relative'
            ? conversionService.convertToRelative(content, basePath)
            : conversionService.convertToAbsolute(content, basePath);

        if (result.converted > 0) {
            file.setContent(result.content, false);
        }

        return result;
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

        // Convert all files (main + includes)
        const allFiles = fileRegistry.getAll();
        for (const file of allFiles) {
            const result = this._convertFilePaths(file, message.direction, conversionService);

            if (result.converted > 0) {
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
        const allFiles = fileRegistry.getAll();

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
     * Resolve a path to absolute, using main file's directory as base for relative paths.
     * Returns null if resolution fails.
     */
    private _resolveToAbsolutePath(filePath: string): string | null {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }

        const fileRegistry = this.getFileRegistry();
        const mainFile = fileRegistry?.getMainFile();
        if (!mainFile) {
            return null;
        }

        const basePath = path.dirname(mainFile.getPath());
        return path.resolve(basePath, filePath);
    }

    /**
     * Open a file path directly (in VS Code or default app)
     */
    private async handleOpenPath(
        message: OpenPathMessage,
        _context: CommandContext
    ): Promise<CommandResult> {
        const resolvedPath = this._resolveToAbsolutePath(message.filePath);
        if (!resolvedPath) {
            return this.failure('Cannot resolve relative path: main file not found');
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
     * Search for a file by name and show file search dialog
     *
     * Triggered from imagePathManager.js when user:
     * - Clicks "Search for File" in a path menu (image, video, link path menus)
     * - Clicks an image-not-found placeholder
     * - Clicks search button on include file errors
     *
     * Flow: User action → searchForFile message → shows file search dialog directly.
     *
     * Different from FileCommands.handleOpenFileLink which tries to open the file first
     * and only shows search dialog if the file doesn't exist.
     */
    private async handleSearchForFile(
        message: SearchForFileMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const oldPath = message.filePath;
        logger.debug('[PathCommands.handleSearchForFile] START', {
            oldPath,
            taskId: message.taskId,
            columnId: message.columnId,
            includeContext: message.includeContext
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

        // Use includeContext to determine the correct base path for search
        // If in an include file, use the include file's directory
        let basePath: string;
        let sourceFile: string;
        if (message.includeContext?.includeDir) {
            basePath = message.includeContext.includeDir;
            sourceFile = message.includeContext.includeFilePath || basePath;
            logger.debug('[PathCommands.handleSearchForFile] Using includeContext for base path', {
                basePath,
                sourceFile
            });
        } else {
            basePath = path.dirname(mainFile.getPath());
            sourceFile = mainFile.getPath();
            logger.debug('[PathCommands.handleSearchForFile] Using main file for base path', {
                basePath,
                sourceFile
            });
        }

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

            const result = await fileSearchService.pickReplacementForBrokenLink(oldPath, basePath, {
                sourceFile
            });
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
        const resolvedPath = this._resolveToAbsolutePath(message.filePath);
        if (!resolvedPath) {
            return this.failure('Cannot resolve relative path: main file not found');
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

        // Use includeContext to determine the correct base path
        // If in an include file, use the include file's directory
        let basePath: string;
        if (message.includeContext?.includeDir) {
            basePath = message.includeContext.includeDir;
            logger.debug('[PathCommands.handleBrowseForImage] Using includeContext for base path', {
                basePath,
                includeFilePath: message.includeContext.includeFilePath
            });
        } else {
            basePath = path.dirname(mainFile.getPath());
            logger.debug('[PathCommands.handleBrowseForImage] Using main file for base path', {
                basePath
            });
        }

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
     * Web search for an image - opens headed browser for interactive image selection
     * Downloads the selected image and replaces the old path, adding the source URL as title
     */
    private async handleWebSearchForImage(
        message: WebSearchForImageMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const oldPath = message.oldPath;
        // Use alt text as search query, fall back to filename from the old path
        const altText = message.altText || path.basename(oldPath, path.extname(oldPath)) || 'image';

        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }
        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            return this.failure('No main file found');
        }

        // Determine the owning file's directory and base name for the media folder
        // (same convention as ClipboardCommands._getDropTargetPaths)
        let directory: string;
        let baseFileName: string;
        if (message.includeContext?.includeFilePath) {
            const includePath = message.includeContext.includeFilePath;
            directory = path.dirname(includePath);
            baseFileName = path.basename(includePath).replace(/\.[^/.]+$/, '');
        } else {
            const mainPath = mainFile.getPath();
            directory = path.dirname(mainPath);
            baseFileName = path.basename(mainPath).replace(/\.[^/.]+$/, '');
        }

        // Create the media folder (e.g., board-MEDIA/)
        const mediaFolderName = `${baseFileName}-MEDIA`;
        const mediaFolderPath = path.join(directory, mediaFolderName);
        if (!fs.existsSync(mediaFolderPath)) {
            fs.mkdirSync(mediaFolderPath, { recursive: true });
        }

        try {
            // Download the image into the media folder
            const result = await WebImageSearchService.searchAndSelect(altText, mediaFolderPath);

            if (!result) {
                return this.success({ cancelled: true });
            }

            // Compute the new relative path from the owning file's directory
            const newRelativePath = path.relative(directory, result.filePath);
            const encodedNewPath = encodeFilePath(newRelativePath);
            const escapedSourceUrl = result.sourceUrl.replace(/"/g, '%22');

            if (!oldPath) {
                // Empty old path (e.g., `![]()`) — _replacePaths can't match empty strings,
                // so do a direct text replacement in the markdown files
                const replaced = this._replaceEmptyImagePath(encodedNewPath, escapedSourceUrl, directory, message);
                if (replaced) {
                    await this.refreshBoard(context);
                    showInfo('Image downloaded and path updated');
                    return this.success({ replaced: true });
                }
                return this.failure('Could not find empty image path in any file');
            }

            // Non-empty old path — use the standard replacement pipeline
            const replaceResult = await this._replacePaths(oldPath, result.filePath, directory, context, {
                mode: 'single',
                pathFormat: 'auto',
                taskId: message.taskId,
                columnId: message.columnId,
                isColumnTitle: message.isColumnTitle,
                successMessage: 'Image downloaded and path updated'
            });

            // After path replacement, add the source URL as the image title
            if (replaceResult.success && (replaceResult.data as any)?.replaced) {
                this._addSourceUrlTitle(result.filePath, result.sourceUrl, directory);
            }

            return replaceResult;
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            logger.error('[PathCommands.handleWebSearchForImage] Error:', error);
            return this.failure(`Web image search failed: ${errorMessage}`);
        }
    }

    /**
     * Add source URL as title to a markdown image after path replacement.
     * Transforms ![alt](path) into ![alt](path "sourceUrl")
     */
    private _addSourceUrlTitle(imagePath: string, sourceUrl: string, basePath: string): void {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) return;

        const allFiles = fileRegistry.getAll();
        const relativePath = path.relative(basePath, imagePath);
        const encodedRelativePath = encodeFilePath(relativePath);

        // Search for the image path in all files
        for (const file of allFiles) {
            let content = file.getContent();

            // Match ![any alt](our-path) or ![any alt](our-path "existing-title")
            // We need to find the exact path variant used in the file
            const pathVariants = [relativePath, encodedRelativePath, imagePath];
            // Also try with ./ prefix
            if (!relativePath.startsWith('./') && !relativePath.startsWith('/')) {
                pathVariants.push('./' + relativePath);
            }
            // Also try encoded variants with ./ prefix
            if (!encodedRelativePath.startsWith('./') && !encodedRelativePath.startsWith('/')) {
                pathVariants.push('./' + encodedRelativePath);
            }
            // Try just the basename as last resort
            pathVariants.push(path.basename(imagePath));

            let modified = false;
            for (const pathVariant of pathVariants) {
                const escapedPath = pathVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Match image syntax with this path, with or without existing title
                const regex = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedPath}(\\s+"[^"]*")?\\)`, 'g');

                const escapedSourceUrl = sourceUrl.replace(/"/g, '%22');
                const newContent = content.replace(regex, (match, prefix, existingTitle) => {
                    // Replace or add the title with the source URL
                    return `${prefix}${pathVariant} "${escapedSourceUrl}")`;
                });

                if (newContent !== content) {
                    content = newContent;
                    modified = true;
                    break;
                }
            }

            if (modified) {
                file.setContent(content, false);
                break;
            }
        }
    }

    /**
     * Replace an empty image/media path with a new path and source URL.
     * Handles the case where oldPath is empty (e.g., `![alt]()`) which
     * _replacePaths/LinkReplacementService cannot match.
     * Matches: ![any]()\s* or ![any]( )  or ![any]("title")
     */
    private _replaceEmptyImagePath(
        newPath: string,
        sourceUrl: string,
        basePath: string,
        message: { taskId?: string; columnId?: string; isColumnTitle?: boolean }
    ): boolean {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) return false;

        const allFiles = fileRegistry.getAll();

        for (const file of allFiles) {
            let content = file.getContent();

            // Match ![any alt]() or ![any alt]( ) or ![any alt]("existing title")
            // This is intentionally broad since empty-path images are uncommon
            const regex = /(!\[[^\]]*\]\()(\s*(?:"[^"]*")?\s*)\)/g;

            const newContent = content.replace(regex, (match, prefix, _inside) => {
                return `${prefix}${newPath} "${sourceUrl}")`;
            });

            if (newContent !== content) {
                file.setContent(newContent, false);
                return true;
            }
        }

        return false;
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
        const allFiles = fileRegistry.getAll();

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
     * Sync editing state - capture any unsaved edits before path replacement.
     * This is PathCommands-specific because it needs CommandContext.
     */
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
            // The caller will handle the webview update after completing the path replacement
            context.emitBoardChanged(board, 'edit');
        }
    }

    /**
     * Unified path replacement function - delegates to LinkReplacementService.
     * Handles pre/post operations specific to PathCommands.
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

        // 1. Sync editing state (capture any unsaved edits) - PathCommands-specific
        await this._syncEditingState(context);

        // 2. Get file registry and webview bridge
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }

        const webviewBridge = context.getWebviewBridge();
        if (!webviewBridge) {
            return this.failure('Webview bridge not available');
        }

        // 3. Create dependencies for LinkReplacementService
        const deps: ReplacementDependencies = {
            fileRegistry,
            boardStore: context.boardStore,
            webviewBridge,
            getBoard: () => context.boardStore.getBoard() ?? undefined,
            invalidateCache: () => context.boardStore.invalidateCache(),
            handleIncludeSwitch: (params) => context.handleIncludeSwitch(params),
            refreshBoard: () => this.refreshBoard(context)
        };

        // 4. Delegate to LinkReplacementService
        const result = await linkReplacementService.replacePath(
            brokenPath,
            selectedPath,
            basePath,
            deps,
            {
                mode: options.mode,
                pathFormat: options.pathFormat,
                taskId: options.taskId,
                columnId: options.columnId,
                isColumnTitle: options.isColumnTitle,
                linkIndex: undefined,
                successMessage: options.successMessage
            }
        );

        // 5. Return result in CommandResult format
        if (!result.success) {
            return this.failure(result.error || 'Path replacement failed');
        }

        return this.success({
            replaced: result.replaced,
            count: result.count,
            oldPath: result.oldPath,
            newPath: result.newPath
        });
    }
}
