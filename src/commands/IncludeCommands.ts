/**
 * Include Commands
 *
 * Handles include file-related message operations:
 * - confirmDisableIncludeMode
 * - requestIncludeFile, registerInlineInclude
 * - requestIncludeFileName, requestEditIncludeFileName
 * - requestEditTaskIncludeFileName, requestTaskIncludeFileName
 * - reloadAllIncludedFiles
 * - saveIndividualFile, reloadIndividualFile
 *
 * Debug commands (forceWriteAllContent, verifyContentSync, etc.) have been
 * moved to DebugCommands.ts for cleaner separation of concerns.
 *
 * @module commands/IncludeCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { PathResolver } from '../services/PathResolver';
import { safeFileUri } from '../utils/uriUtils';
import { getErrorMessage } from '../utils/stringUtils';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Include Commands Handler
 *
 * Processes include file-related messages from the webview.
 */
export class IncludeCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'include-commands',
        name: 'Include Commands',
        description: 'Handles include file operations, tracking, and synchronization',
        messageTypes: [
            'confirmDisableIncludeMode',
            'requestIncludeFile',
            'registerInlineInclude',
            'requestIncludeFileName',
            'requestEditIncludeFileName',
            'requestEditTaskIncludeFileName',
            'requestTaskIncludeFileName',
            'reloadAllIncludedFiles',
            'saveIndividualFile',
            'reloadIndividualFile'
        ],
        priority: 100
    };

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'confirmDisableIncludeMode':
                    return await this.handleConfirmDisableIncludeMode(message, context);

                case 'requestIncludeFile':
                    return await this.handleRequestIncludeFile(message.filePath, context);

                case 'registerInlineInclude':
                    return await this.handleRegisterInlineInclude(message.filePath, message.content, context);

                case 'requestIncludeFileName':
                    return await this.handleRequestIncludeFileName(message, context);

                case 'requestEditIncludeFileName':
                    return await this.handleRequestEditIncludeFileName(message, context);

                case 'requestEditTaskIncludeFileName':
                    return await this.handleRequestEditTaskIncludeFileName(message, context);

                case 'requestTaskIncludeFileName':
                    return await this.handleRequestTaskIncludeFileName(message.taskId, message.columnId, context);

                case 'reloadAllIncludedFiles':
                    return await this.handleReloadAllIncludedFiles(context);

                case 'saveIndividualFile':
                    return await this.handleSaveIndividualFile(
                        message.filePath,
                        message.isMainFile,
                        message.forceSave,
                        context
                    );

                case 'reloadIndividualFile':
                    return await this.handleReloadIndividualFile(
                        message.filePath,
                        message.isMainFile,
                        context
                    );

                default:
                    return this.failure(`Unknown include command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[IncludeCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= INCLUDE MODE HANDLERS =============

    private async handleConfirmDisableIncludeMode(message: any, _context: CommandContext): Promise<CommandResult> {
        const confirmation = await vscode.window.showWarningMessage(
            message.message,
            { modal: true },
            'Disable Include Mode',
            'Cancel'
        );

        if (confirmation === 'Disable Include Mode') {
            this.postMessage({
                type: 'proceedDisableIncludeMode',
                columnId: message.columnId
            });
        }
        return this.success();
    }

    private async handleRequestIncludeFile(filePath: string, context: CommandContext): Promise<CommandResult> {
        if (!this.getPanel()) {
            return this.failure('No webview panel available');
        }

        const document = context.fileManager.getDocument();
        if (!document) {
            return this.failure('No current document available');
        }

        const basePath = path.dirname(document.uri.fsPath);
        const absolutePath = PathResolver.resolve(basePath, filePath);

        try {
            if (!fs.existsSync(absolutePath)) {
                this.postMessage({
                    type: 'includeFileContent',
                    filePath: filePath,
                    content: null,
                    error: `File not found: ${filePath}`
                });
                return this.success();
            }

            const content = fs.readFileSync(absolutePath, 'utf8');
            this.postMessage({
                type: 'includeFileContent',
                filePath: filePath,
                content: content
            });
        } catch (fileError) {
            this.postMessage({
                type: 'includeFileContent',
                filePath: filePath,
                content: null,
                error: `Error reading file: ${filePath}`
            });
        }
        return this.success();
    }

    private async handleRegisterInlineInclude(filePath: string, content: string, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel?.ensureIncludeFileRegistered) {
            return this.success();
        }

        let relativePath = filePath;
        if (!path.isAbsolute(relativePath) && !relativePath.startsWith('.')) {
            relativePath = './' + relativePath;
        }

        panel.ensureIncludeFileRegistered(relativePath, 'regular');

        const includeFile = panel._includeFiles?.get(relativePath);
        if (includeFile && content) {
            includeFile.content = content;
            includeFile.baseline = content;
            includeFile.hasUnsavedChanges = false;
            includeFile.lastModified = Date.now();

            const currentDocument = context.fileManager.getDocument();
            if (currentDocument) {
                const basePath = path.dirname(currentDocument.uri.fsPath);
                includeFile.absolutePath = PathResolver.resolve(basePath, filePath);
            }
        }
        return this.success();
    }

    // ============= FILE PICKER HANDLERS =============

    private async handleRequestIncludeFileName(message: any, context: CommandContext): Promise<CommandResult> {
        const currentFilePath = context.fileManager.getFilePath();
        if (!currentFilePath) {
            vscode.window.showErrorMessage('No active kanban file');
            return this.success();
        }

        const currentDir = path.dirname(currentFilePath);
        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: safeFileUri(currentDir, 'includeCommands-selectColumnInclude'),
            filters: { 'Markdown files': ['md'] },
            title: 'Select include file for column'
        });

        if (fileUris && fileUris.length > 0) {
            const absolutePath = fileUris[0].fsPath;
            const relativePath = path.relative(currentDir, absolutePath);

            this.postMessage({
                type: 'proceedEnableIncludeMode',
                columnId: message.columnId,
                fileName: relativePath
            });
        }
        return this.success();
    }

    private async handleRequestEditIncludeFileName(message: any, context: CommandContext): Promise<CommandResult> {
        const currentFile = message.currentFile || '';
        const fileRegistry = this.getFileRegistry();
        const file = fileRegistry?.getByRelativePath(currentFile);

        if (file && file.hasUnsavedChanges()) {
            const choice = await vscode.window.showWarningMessage(
                `The current include file "${currentFile}" has unsaved changes. What would you like to do?`,
                { modal: true },
                'Save and Switch',
                'Discard and Switch',
                'Cancel'
            );

            if (choice === 'Save and Switch') {
                await file.save();
            } else if (choice === 'Discard and Switch') {
                file.discardChanges();
            } else {
                return this.success();
            }
        }

        const currentFilePath = context.fileManager.getFilePath();
        if (!currentFilePath) {
            vscode.window.showErrorMessage('No active kanban file');
            return this.success();
        }

        const currentDir = path.dirname(currentFilePath);
        let defaultUri = safeFileUri(currentDir, 'includeCommands-changeColumnInclude-dir');
        if (currentFile) {
            const currentAbsolutePath = path.resolve(currentDir, currentFile);
            if (fs.existsSync(currentAbsolutePath)) {
                defaultUri = safeFileUri(currentAbsolutePath, 'includeCommands-changeColumnInclude-file');
            }
        }

        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: defaultUri,
            filters: { 'Markdown files': ['md'] },
            title: 'Select new include file for column'
        });

        if (fileUris && fileUris.length > 0) {
            const absolutePath = fileUris[0].fsPath;
            const relativePath = path.relative(currentDir, absolutePath);

            this.postMessage({
                type: 'proceedUpdateIncludeFile',
                columnId: message.columnId,
                newFileName: relativePath,
                currentFile: currentFile
            });
        }
        return this.success();
    }

    private async handleRequestEditTaskIncludeFileName(message: any, context: CommandContext): Promise<CommandResult> {
        const currentFile = message.currentFile || '';
        const taskId = message.taskId;
        const columnId = message.columnId;

        const fileRegistry = this.getFileRegistry();
        const file = fileRegistry?.getByRelativePath(currentFile);

        if (file && file.hasUnsavedChanges()) {
            const choice = await vscode.window.showWarningMessage(
                `The current task include file "${currentFile}" has unsaved changes. What would you like to do?`,
                { modal: true },
                'Save and Switch',
                'Discard and Switch',
                'Cancel'
            );

            if (choice === 'Save and Switch') {
                await file.save();
            } else if (choice === 'Discard and Switch') {
                file.discardChanges();
            } else {
                return this.success();
            }
        }

        const currentFilePath = context.fileManager.getFilePath();
        if (!currentFilePath) {
            vscode.window.showErrorMessage('No active kanban file');
            return this.success();
        }

        const currentDir = path.dirname(currentFilePath);
        let defaultUri = safeFileUri(currentDir, 'includeCommands-changeTaskInclude-dir');
        if (currentFile) {
            const currentAbsolutePath = path.resolve(currentDir, currentFile);
            if (fs.existsSync(currentAbsolutePath)) {
                defaultUri = safeFileUri(currentAbsolutePath, 'includeCommands-changeTaskInclude-file');
            }
        }

        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: defaultUri,
            filters: { 'Markdown files': ['md'] },
            title: 'Select new include file for task'
        });

        if (fileUris && fileUris.length > 0) {
            const absolutePath = fileUris[0].fsPath;
            const relativePath = path.relative(currentDir, absolutePath);

            this.postMessage({
                type: 'proceedUpdateTaskIncludeFile',
                taskId: taskId,
                columnId: columnId,
                newFileName: relativePath,
                currentFile: currentFile
            });
        }
        return this.success();
    }

    private async handleRequestTaskIncludeFileName(taskId: string, columnId: string, context: CommandContext): Promise<CommandResult> {
        const currentFilePath = context.fileManager.getFilePath();
        if (!currentFilePath) {
            vscode.window.showErrorMessage('No active kanban file');
            return this.success();
        }

        const currentDir = path.dirname(currentFilePath);
        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: safeFileUri(currentDir, 'includeCommands-selectTaskInclude'),
            filters: { 'Markdown files': ['md'] },
            title: 'Select include file for task'
        });

        if (fileUris && fileUris.length > 0) {
            const absolutePath = fileUris[0].fsPath;
            const relativePath = path.relative(currentDir, absolutePath);

            this.postMessage({
                type: 'enableTaskIncludeMode',
                taskId: taskId,
                columnId: columnId,
                fileName: relativePath
            });
        }
        return this.success();
    }

    // ============= FILE RELOAD/SAVE HANDLERS =============

    private async handleReloadAllIncludedFiles(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel) {
            return this.success();
        }

        let reloadCount = 0;
        const includeFileMap = panel._includeFiles;
        if (includeFileMap) {
            for (const [relativePath] of includeFileMap) {
                try {
                    const freshContent = await panel._readFileContent(relativePath);
                    if (freshContent !== null) {
                        panel.updateIncludeFileContent(relativePath, freshContent, true);
                        reloadCount++;
                    }
                } catch (error) {
                    console.warn(`[IncludeCommands] Failed to reload include file ${relativePath}:`, error);
                }
            }
        }

        const document = context.fileManager.getDocument();
        if (document) {
            await panel.loadMarkdownFile(document);
        }

        this.postMessage({
            type: 'allIncludedFilesReloaded',
            reloadCount: reloadCount
        });

        return this.success();
    }

    private async handleSaveIndividualFile(
        filePath: string,
        isMainFile: boolean,
        forceSave: boolean = false,
        context: CommandContext
    ): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel) {
            return this.failure('No panel available');
        }

        try {
            if (isMainFile) {
                const fileService = panel._fileService;
                const board = fileService?.board();

                if (!board || !board.valid) {
                    throw new Error('Invalid board state');
                }

                const { MarkdownKanbanParser } = require('../markdownParser');
                const markdown = MarkdownKanbanParser.generateMarkdown(board);

                const fileRegistry = this.getFileRegistry();
                const mainFile = fileRegistry?.getMainFile();
                if (!mainFile) {
                    throw new Error('Main file not found in registry');
                }

                const fileSaveService = fileService._fileSaveService;
                await fileSaveService.saveFile(mainFile, markdown);
                mainFile.updateFromBoard(board, true, true);

                // Trigger marpWatch export if active
                const autoExportSettings = context.getAutoExportSettings();
                if (autoExportSettings?.marpWatch) {
                    let document = context.fileManager.getDocument();
                    const filePathForReopen = context.fileManager.getFilePath();

                    if (!document && filePathForReopen) {
                        try {
                            document = await vscode.workspace.openTextDocument(filePathForReopen);
                        } catch (error) {
                            console.error(`[IncludeCommands] Failed to reopen document:`, error);
                        }
                    }

                    if (document) {
                        const { ExportService } = require('../exportService');
                        try {
                            await ExportService.export(document, autoExportSettings, board);
                        } catch (error) {
                            console.error('[IncludeCommands] MarpWatch export failed:', error);
                        }
                    }
                }

                this.postMessage({
                    type: 'individualFileSaved',
                    filePath: filePath,
                    isMainFile: true,
                    success: true,
                    forceSave: forceSave
                });
            } else {
                const fileRegistry = this.getFileRegistry();
                if (!fileRegistry) {
                    throw new Error('File registry not available');
                }

                const file = fileRegistry.get(filePath);
                if (!file) {
                    throw new Error(`File not found in registry: ${filePath}`);
                }

                await file.save({
                    skipReloadDetection: true,
                    source: 'ui-edit',
                    skipValidation: false
                });

                // Trigger marpWatch export if active
                const autoExportSettings = context.getAutoExportSettings();
                if (autoExportSettings?.marpWatch) {
                    let document = context.fileManager.getDocument();
                    const filePathForReopen = context.fileManager.getFilePath();

                    if (!document && filePathForReopen) {
                        try {
                            document = await vscode.workspace.openTextDocument(filePathForReopen);
                        } catch (error) {
                            console.error(`[IncludeCommands] Failed to reopen document:`, error);
                        }
                    }

                    if (document) {
                        const { ExportService } = require('../exportService');
                        const fileService = panel._fileService;
                        const board = fileService?.board();

                        try {
                            await ExportService.export(document, autoExportSettings, board);
                        } catch (error) {
                            console.error('[IncludeCommands] MarpWatch export failed:', error);
                        }
                    }
                }

                this.postMessage({
                    type: 'individualFileSaved',
                    filePath: filePath,
                    isMainFile: false,
                    success: true,
                    forceSave: forceSave
                });

                // Trigger debug info refresh (handled by DebugCommands)
                this.postMessage({ type: 'refreshDebugInfo' });
            }
        } catch (error) {
            this.postMessage({
                type: 'individualFileSaved',
                filePath: filePath,
                isMainFile: isMainFile,
                success: false,
                forceSave: forceSave,
                error: getErrorMessage(error)
            });
        }
        return this.success();
    }

    private async handleReloadIndividualFile(
        filePath: string,
        isMainFile: boolean,
        context: CommandContext
    ): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel) {
            return this.success();
        }

        try {
            if (isMainFile) {
                const fileRegistry = this.getFileRegistry();
                const mainFile = fileRegistry?.getMainFile();
                if (!mainFile) {
                    throw new Error('Main file not found in registry');
                }

                const fsPromises = require('fs').promises;
                const freshContent = await fsPromises.readFile(filePath, 'utf-8');
                mainFile.setContent(freshContent, true);
                mainFile.parseToBoard();

                const fileService = panel._fileService;
                const freshBoard = mainFile.getBoard();
                if (freshBoard && freshBoard.valid) {
                    fileService.setBoard(freshBoard);
                    await fileService.sendBoardUpdate(false, false);
                }

                this.postMessage({
                    type: 'individualFileReloaded',
                    filePath: filePath,
                    isMainFile: true,
                    success: true
                });
            } else {
                const fileRegistry = this.getFileRegistry();
                if (!fileRegistry) {
                    throw new Error('File registry not available');
                }

                const document = context.fileManager.getDocument();
                const absolutePath = filePath.startsWith('/')
                    ? filePath
                    : path.join(path.dirname(document!.uri.fsPath), filePath);

                const file = fileRegistry.get(absolutePath);
                if (!file) {
                    throw new Error(`File not found in registry: ${absolutePath}`);
                }

                const fsPromises = require('fs').promises;
                const freshContent = await fsPromises.readFile(absolutePath, 'utf-8');
                file.setContent(freshContent, true);

                const fileService = panel._fileService;
                const mainFileObj = fileRegistry.getMainFile();
                if (mainFileObj) {
                    mainFileObj.parseToBoard();
                    const freshBoard = mainFileObj.getBoard();
                    if (freshBoard && freshBoard.valid) {
                        fileService.setBoard(freshBoard);
                        await fileService.sendBoardUpdate(false, false);
                    }
                }

                this.postMessage({
                    type: 'individualFileReloaded',
                    filePath: filePath,
                    isMainFile: false,
                    success: true
                });
            }
        } catch (error) {
            this.postMessage({
                type: 'individualFileReloaded',
                filePath: filePath,
                isMainFile: isMainFile,
                success: false,
                error: getErrorMessage(error)
            });
        }
        return this.success();
    }
}
