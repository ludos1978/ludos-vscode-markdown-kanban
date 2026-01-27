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

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import { PathResolver } from '../services/PathResolver';
import { getErrorMessage } from '../utils/stringUtils';
import { showInfo, showWarning } from '../services/NotificationService';
import * as vscode from 'vscode';
import * as path from 'path';
import {
    OpenFileLinkMessage,
    OpenWikiLinkMessage,
    OpenExternalLinkMessage,
    OpenFileMessage,
    OpenIncludeFileMessage,
    HandleFileDropMessage,
    HandleUriDropMessage,
    ResolveAndCopyPathMessage
} from '../core/bridge/MessageTypes';

/**
 * File Commands Handler
 *
 * Processes file-related messages from the webview.
 */
export class FileCommands extends SwitchBasedCommand {
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

    protected handlers: Record<string, MessageHandler> = {
        'openFileLink': (msg, ctx) => this.handleOpenFileLink(msg as OpenFileLinkMessage, ctx),
        'openWikiLink': (msg, ctx) => this.handleOpenWikiLink(msg as OpenWikiLinkMessage, ctx),
        'openExternalLink': (msg, ctx) => this.handleOpenExternalLink(msg as OpenExternalLinkMessage, ctx),
        'openFile': (msg, ctx) => this.handleOpenFile(msg as OpenFileMessage, ctx),
        'openIncludeFile': (msg, ctx) => this.handleOpenIncludeFile(msg as OpenIncludeFileMessage, ctx),
        'handleFileDrop': (msg, ctx) => this.handleFileDrop(msg as HandleFileDropMessage, ctx),
        'handleUriDrop': (msg, ctx) => this.handleUriDrop(msg as HandleUriDropMessage, ctx),
        'toggleFileLock': (_msg, ctx) => Promise.resolve(this.handleToggleFileLock(ctx)),
        'selectFile': (_msg, ctx) => this.handleSelectFile(ctx),
        'requestFileInfo': (_msg, ctx) => Promise.resolve(this.handleRequestFileInfo(ctx)),
        'initializeFile': (_msg, ctx) => this.handleInitializeFile(ctx),
        'resolveAndCopyPath': (msg, ctx) => this.handleResolveAndCopyPath(msg as ResolveAndCopyPathMessage, ctx)
    };

    // ============= FILE LINK HANDLERS =============

    /**
     * Handle openFileLink command
     *
     * Triggered when user Alt+clicks a link or image in the board (from boardRenderer.js).
     * Flow: Alt+click → openFileLink message → LinkHandler.handleFileLink → opens file or shows search dialog if not found.
     *
     * Different from PathCommands.handleSearchForFile which is triggered from path menus.
     */
    private async handleOpenFileLink(message: OpenFileLinkMessage, context: CommandContext): Promise<CommandResult> {
        // Set up tracked files for file search (main + includes) before handling link
        const fileRegistry = context.getFileRegistry();
        let mainFilePath: string | undefined;
        console.log('[FileCommands.handleOpenFileLink] START', JSON.stringify({
            href: message.href?.slice(-30),
            taskId: message.taskId,
            columnId: message.columnId,
            linkIndex: message.linkIndex,
            hasRegistry: !!fileRegistry,
            hasIncludeContext: !!message.includeContext
        }));
        if (fileRegistry) {
            const allFiles = fileRegistry.getAll();
            const trackedFiles = allFiles.map(file => ({
                path: file.getPath(),
                relativePath: file.getRelativePath(),
                content: file.getContent()
            }));
            context.linkHandler.setTrackedFiles(trackedFiles);
            // Get main file path from registry
            const mainFile = fileRegistry.getMainFile();
            mainFilePath = mainFile?.getPath();
            console.log('[FileCommands.handleOpenFileLink] Registry info', {
                fileCount: allFiles.length,
                mainFilePath,
                hasMainFile: !!mainFile
            });
        }

        await context.linkHandler.handleFileLink(
            message.href,
            message.taskId,
            message.columnId,
            message.linkIndex,
            message.includeContext,
            mainFilePath
        );
        if (fileRegistry && message.href) {
            const includeFile = fileRegistry.getByRelativePath(message.href);
            if (includeFile && includeFile.getFileType() !== 'main') {
                const includePath = includeFile.getPath();
                const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === includePath);
                if (openDoc && !openDoc.isDirty) {
                    const cachedContent = includeFile.getContent();
                    if (includeFile.hasUnsavedChanges() && openDoc.getText() !== cachedContent) {
                        const edit = new vscode.WorkspaceEdit();
                        const fullRange = new vscode.Range(0, 0, openDoc.lineCount, 0);
                        edit.replace(openDoc.uri, fullRange, cachedContent);
                        await vscode.workspace.applyEdit(edit);
                    }
                }
            }
        }

        return this.success();
    }

    /**
     * Handle openWikiLink command
     */
    private async handleOpenWikiLink(message: OpenWikiLinkMessage, context: CommandContext): Promise<CommandResult> {
        await context.linkHandler.handleWikiLink(
            message.documentName,
            message.taskId,
            message.columnId,
            message.linkIndex
        );
        return this.success();
    }

    /**
     * Handle openExternalLink command
     */
    private async handleOpenExternalLink(message: OpenExternalLinkMessage, context: CommandContext): Promise<CommandResult> {
        await context.linkHandler.handleExternalLink(message.href);
        return this.success();
    }

    /**
     * Handle openFile command - opens a file in VS Code editor
     */
    private async handleOpenFile(message: OpenFileMessage, context: CommandContext): Promise<CommandResult> {
        const filePath = message.filePath;
        if (!filePath) {
            return this.failure('No file path provided');
        }

        try {
            // Resolve the file path to absolute if it's relative
            let absolutePath = filePath;
            if (!path.isAbsolute(filePath)) {
                const document = context.fileManager.getDocument();
                if (document) {
                    const currentDir = path.dirname(document.uri.fsPath);
                    absolutePath = PathResolver.resolve(currentDir, filePath);
                } else {
                    return this.failure('Cannot resolve relative path - no current document');
                }
            }

            // Normalize the path for comparison
            const normalizedPath = path.resolve(absolutePath);

            // Check if the file is already open as a document
            const existingDocument = vscode.workspace.textDocuments.find(doc => {
                const docPath = path.resolve(doc.uri.fsPath);
                return docPath === normalizedPath;
            });

            if (existingDocument) {
                // Check if it's currently visible
                const visibleEditor = vscode.window.visibleTextEditors.find(editor =>
                    path.resolve(editor.document.uri.fsPath) === normalizedPath
                );

                if (visibleEditor) {
                    // Already focused, nothing to do
                    if (vscode.window.activeTextEditor?.document.uri.fsPath === normalizedPath) {
                        return this.success();
                    }
                }

                await vscode.window.showTextDocument(existingDocument, {
                    preserveFocus: false,
                    preview: false
                });
            } else {
                // Open the document first, then show it
                const document = await vscode.workspace.openTextDocument(absolutePath);
                await vscode.window.showTextDocument(document, {
                    preserveFocus: false,
                    preview: false
                });
            }
            return this.success();
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[FileCommands] Error opening file ${filePath}:`, error);
            return this.failure(errorMessage);
        }
    }

    /**
     * Handle openIncludeFile command
     */
    private async handleOpenIncludeFile(message: OpenIncludeFileMessage, context: CommandContext): Promise<CommandResult> {
        await context.linkHandler.handleFileLink(message.filePath);

        const fileRegistry = context.getFileRegistry();
        if (fileRegistry && message.filePath) {
            const includeFile = fileRegistry.get(message.filePath)
                || fileRegistry.getByRelativePath(message.filePath);
            if (includeFile && includeFile.getFileType() !== 'main') {
                const includePath = includeFile.getPath();
                const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === includePath);
                if (openDoc && !openDoc.isDirty) {
                    const cachedContent = includeFile.getContent();
                    if (includeFile.hasUnsavedChanges() && openDoc.getText() !== cachedContent) {
                        const edit = new vscode.WorkspaceEdit();
                        const fullRange = new vscode.Range(0, 0, openDoc.lineCount, 0);
                        edit.replace(openDoc.uri, fullRange, cachedContent);
                        await vscode.workspace.applyEdit(edit);
                    }
                }
            }
        }

        return this.success();
    }

    // ============= FILE DROP HANDLERS =============

    /**
     * Handle handleFileDrop command
     */
    private async handleFileDrop(message: HandleFileDropMessage, context: CommandContext): Promise<CommandResult> {
        await context.fileManager.handleFileDrop(message);
        return this.success();
    }

    /**
     * Handle handleUriDrop command
     */
    private async handleUriDrop(message: HandleUriDropMessage, context: CommandContext): Promise<CommandResult> {
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
     * Handle selectFile command - opens file picker dialog
     */
    private async handleSelectFile(context: CommandContext): Promise<CommandResult> {
        await context.fileManager.selectFile();
        // Note: The selected document is handled by the main panel/extension
        // The fileManager.selectFile() triggers the appropriate flow
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
    private async handleResolveAndCopyPath(message: ResolveAndCopyPathMessage, context: CommandContext): Promise<CommandResult> {
        const resolution = await context.fileManager.resolveFilePath(message.path);
        if (resolution && resolution.exists) {
            await vscode.env.clipboard.writeText(resolution.resolvedPath);
            showInfo('Full path copied: ' + resolution.resolvedPath);
        } else {
            showWarning('Could not resolve path: ' + message.path);
        }
        return this.success();
    }
}
