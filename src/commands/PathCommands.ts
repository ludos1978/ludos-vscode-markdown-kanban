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
import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { PathConversionService, ConversionResult } from '../services/PathConversionService';
import { getErrorMessage } from '../utils/stringUtils';
import { MarkdownFile } from '../files/MarkdownFile';
import { ConvertPathsMessage, ConvertAllPathsMessage, ConvertSinglePathMessage, OpenPathMessage, RevealPathInExplorerMessage, IncomingMessage } from '../core/bridge/MessageTypes';
import { safeFileUri } from '../utils/uriUtils';

type PathCommandMessage = ConvertPathsMessage | ConvertAllPathsMessage | ConvertSinglePathMessage | OpenPathMessage | RevealPathInExplorerMessage;

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
        messageTypes: ['convertPaths', 'convertAllPaths', 'convertSinglePath', 'openPath', 'revealPathInExplorer'],
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
                case 'revealPathInExplorer':
                    return await this.handleRevealPathInExplorer(message, context);
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

        console.log(`[PathCommands] convertSinglePath called with path: "${imagePath}", direction: ${message.direction}`);

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

        // Escape the path for regex
        const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedPath, 'g');

        for (const file of allFiles) {
            const content = file.getContent();
            console.log(`[PathCommands] Checking file: ${file.getRelativePath()}, content length: ${content.length}`);
            if (regex.test(content)) {
                foundFile = file;
                foundContent = content;
                console.log(`[PathCommands] Found path in file: ${file.getRelativePath()}`);
                break;
            }
            // Reset regex lastIndex for next test
            regex.lastIndex = 0;
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

        if (message.direction === 'relative') {
            newPath = conversionService.toRelativePath(imagePath, basePath);
        } else {
            newPath = conversionService.toAbsolutePath(imagePath, basePath);
        }

        // If no change needed
        if (newPath === imagePath) {
            this.postMessage({
                type: 'singlePathConverted',
                originalPath: imagePath,
                newPath: newPath,
                direction: message.direction,
                converted: false,
                message: `Path already in ${message.direction} format`
            });
            return this.success({ converted: false });
        }

        // Replace the path in content
        regex.lastIndex = 0;
        const newContent = foundContent.replace(regex, newPath);

        console.log(`[PathCommands] Replacing "${imagePath}" with "${newPath}"`);
        console.log(`[PathCommands] Old content length: ${foundContent.length}, New content length: ${newContent.length}`);
        console.log(`[PathCommands] Content changed: ${foundContent !== newContent}`);

        // Update file content in cache (marks as unsaved, does NOT save to disk)
        foundFile.setContent(newContent, false);
        console.log(`[PathCommands] File content updated in cache for: ${foundFile.getRelativePath()}`);

        // Invalidate board cache and refresh webview to show updated paths
        context.boardStore.invalidateCache();
        console.log(`[PathCommands] Board cache invalidated, calling onBoardUpdate...`);
        await context.onBoardUpdate();
        console.log(`[PathCommands] onBoardUpdate completed`);

        // Notify frontend
        this.postMessage({
            type: 'singlePathConverted',
            originalPath: imagePath,
            newPath: newPath,
            filePath: foundFile.getRelativePath(),
            direction: message.direction,
            converted: true,
            message: `Converted path to ${message.direction} format in ${foundFile.getRelativePath()}`
        });

        return this.success({
            converted: true,
            originalPath: imagePath,
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

        try {
            await vscode.commands.executeCommand('revealFileInOS', safeFileUri(resolvedPath, 'PathCommands-revealInExplorer'));
            return this.success({ revealed: true, path: resolvedPath });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[PathCommands] Error revealing path in explorer:`, error);
            return this.failure(`Failed to reveal in file explorer: ${errorMessage}`);
        }
    }
}
