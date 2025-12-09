/**
 * File Commands
 *
 * Handles file-related message operations:
 * - openFileLink, openWikiLink, openExternalLink, openFile, openIncludeFile
 * - handleFileDrop, handleUriDrop
 * - toggleFileLock, selectFile
 * - requestFileInfo, initializeFile
 *
 * @module commands/FileCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import * as vscode from 'vscode';

/**
 * File Commands Handler
 *
 * Processes file-related messages from the webview.
 */
export class FileCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'file-commands',
        name: 'File Commands',
        description: 'Handles file opening, links, and file management',
        messageTypes: [
            'openFileLink',
            'openWikiLink',
            'openExternalLink',
            'openFile',
            'openIncludeFile',
            'handleFileDrop',
            'handleUriDrop',
            'toggleFileLock',
            'selectFile',
            'requestFileInfo',
            'initializeFile',
            'resolveAndCopyPath'
        ],
        priority: 100
    };

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'openFileLink':
                    return await this.handleOpenFileLink(message, context);
                case 'openWikiLink':
                    return await this.handleOpenWikiLink(message, context);
                case 'openExternalLink':
                    return await this.handleOpenExternalLink(message, context);
                case 'openFile':
                    return await this.handleOpenFile(message, context);
                case 'openIncludeFile':
                    return await this.handleOpenIncludeFile(message, context);
                case 'handleFileDrop':
                    return await this.handleFileDrop(message, context);
                case 'handleUriDrop':
                    return await this.handleUriDrop(message, context);
                case 'toggleFileLock':
                    return this.handleToggleFileLock(context);
                case 'selectFile':
                    return await this.handleSelectFile(context);
                case 'requestFileInfo':
                    return this.handleRequestFileInfo(context);
                case 'initializeFile':
                    return await this.handleInitializeFile(context);
                case 'resolveAndCopyPath':
                    return await this.handleResolveAndCopyPath(message, context);
                default:
                    return this.failure(`Unknown file command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[FileCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= FILE LINK HANDLERS =============

    /**
     * Handle openFileLink command
     */
    private async handleOpenFileLink(message: any, context: CommandContext): Promise<CommandResult> {
        await context.linkHandler.handleFileLink(
            message.href,
            message.taskId,
            message.columnId,
            message.linkIndex,
            message.includeContext
        );
        return this.success();
    }

    /**
     * Handle openWikiLink command
     */
    private async handleOpenWikiLink(message: any, context: CommandContext): Promise<CommandResult> {
        await context.linkHandler.handleWikiLink(message.documentName);
        return this.success();
    }

    /**
     * Handle openExternalLink command
     */
    private async handleOpenExternalLink(message: any, context: CommandContext): Promise<CommandResult> {
        await context.linkHandler.handleExternalLink(message.href);
        return this.success();
    }

    /**
     * Handle openFile command
     */
    private async handleOpenFile(message: any, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (panel && (panel as any)._messageHandler?.handleOpenFile) {
            await (panel as any)._messageHandler.handleOpenFile(message.filePath);
        }
        return this.success();
    }

    /**
     * Handle openIncludeFile command
     */
    private async handleOpenIncludeFile(message: any, context: CommandContext): Promise<CommandResult> {
        await context.linkHandler.handleFileLink(message.filePath);
        return this.success();
    }

    // ============= FILE DROP HANDLERS =============

    /**
     * Handle handleFileDrop command
     */
    private async handleFileDrop(message: any, context: CommandContext): Promise<CommandResult> {
        await context.fileManager.handleFileDrop(message);
        return this.success();
    }

    /**
     * Handle handleUriDrop command
     */
    private async handleUriDrop(message: any, context: CommandContext): Promise<CommandResult> {
        await context.fileManager.handleUriDrop(message);
        return this.success();
    }

    // ============= FILE MANAGEMENT HANDLERS =============

    /**
     * Handle toggleFileLock command
     */
    private handleToggleFileLock(context: CommandContext): CommandResult {
        context.fileManager.toggleFileLock();
        return this.success();
    }

    /**
     * Handle selectFile command
     */
    private async handleSelectFile(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (panel && (panel as any)._messageHandler?.handleSelectFile) {
            await (panel as any)._messageHandler.handleSelectFile();
        }
        return this.success();
    }

    /**
     * Handle requestFileInfo command
     */
    private handleRequestFileInfo(context: CommandContext): CommandResult {
        context.fileManager.sendFileInfo();
        return this.success();
    }

    /**
     * Handle initializeFile command
     */
    private async handleInitializeFile(context: CommandContext): Promise<CommandResult> {
        await context.onInitializeFile();
        return this.success();
    }

    /**
     * Handle resolveAndCopyPath command
     */
    private async handleResolveAndCopyPath(message: any, context: CommandContext): Promise<CommandResult> {
        const resolution = await context.fileManager.resolveFilePath(message.path);
        if (resolution && resolution.exists) {
            await vscode.env.clipboard.writeText(resolution.resolvedPath);
            vscode.window.showInformationMessage('Full path copied: ' + resolution.resolvedPath);
        } else {
            vscode.window.showWarningMessage('Could not resolve path: ' + message.path);
        }
        return this.success();
    }
}
