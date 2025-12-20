/**
 * Path Commands
 *
 * Handles path conversion operations:
 * - convertPaths: Convert paths in a single file
 * - convertAllPaths: Convert paths in main file and all includes
 *
 * @module commands/PathCommands
 */

import * as path from 'path';
import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { PathConversionService, ConversionResult } from '../services/PathConversionService';
import { getErrorMessage } from '../utils/stringUtils';
import { MarkdownFile } from '../files/MarkdownFile';
import { ConvertPathsMessage, ConvertAllPathsMessage, ConvertSinglePathMessage, IncomingMessage } from '../core/bridge/MessageTypes';

type PathCommandMessage = ConvertPathsMessage | ConvertAllPathsMessage | ConvertSinglePathMessage;

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
        messageTypes: ['convertPaths', 'convertAllPaths', 'convertSinglePath'],
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

        // Update file content (marks as unsaved)
        file.setContent(result.content, false);

        // Auto-save the file after conversion
        await context.fileSaveService.saveFile(file);

        // Emit board changed event if main file was modified
        if (message.isMainFile || !message.filePath) {
            const board = context.getCurrentBoard();
            if (board) {
                context.emitBoardChanged(board, 'edit');
            }
        }

        // Notify frontend
        this.postMessage({
            type: 'pathsConverted',
            filePath: file.getRelativePath(),
            direction: message.direction,
            converted: result.converted,
            skipped: result.skipped,
            warnings: result.warnings,
            message: `Converted ${result.converted} paths to ${message.direction} format`,
            saved: true
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
                await context.fileSaveService.saveFile(mainFile);
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
                await context.fileSaveService.saveFile(file);
                convertedFiles.push(file.getRelativePath());
            }

            totalConverted += result.converted;
            totalSkipped += result.skipped;
            allWarnings.push(...result.warnings.map(w => `[${file.getRelativePath()}] ${w}`));
        }

        // Emit board changed event if any file was modified
        if (totalConverted > 0) {
            const board = context.getCurrentBoard();
            if (board) {
                context.emitBoardChanged(board, 'edit');
            }
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
     * Convert a single path in the main file
     */
    private async handleConvertSinglePath(
        message: ConvertSinglePathMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }

        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            return this.failure('Main file not found');
        }

        const basePath = path.dirname(mainFile.getPath());
        const content = mainFile.getContent();
        const conversionService = PathConversionService.getInstance();

        // Find and replace the specific path
        const imagePath = message.imagePath;
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

        // Replace the path in content (escape special regex chars)
        const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedPath, 'g');
        const newContent = content.replace(regex, newPath);

        if (newContent === content) {
            return this.failure('Path not found in file content');
        }

        // Update file content
        mainFile.setContent(newContent, false);

        // Auto-save the file
        await context.fileSaveService.saveFile(mainFile);

        // Emit board changed event
        const board = context.getCurrentBoard();
        if (board) {
            context.emitBoardChanged(board, 'edit');
        }

        // Notify frontend
        this.postMessage({
            type: 'singlePathConverted',
            originalPath: imagePath,
            newPath: newPath,
            direction: message.direction,
            converted: true,
            message: `Converted path to ${message.direction} format`
        });

        return this.success({
            converted: true,
            originalPath: imagePath,
            newPath: newPath
        });
    }
}
