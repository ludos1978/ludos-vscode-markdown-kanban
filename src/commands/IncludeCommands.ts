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
 * - forceWriteAllContent, verifyContentSync
 * - getTrackedFilesDebugInfo, clearTrackedFilesCache
 *
 * @module commands/IncludeCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { PathResolver } from '../services/PathResolver';
import { safeFileUri } from '../utils/uriUtils';
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
            'reloadIndividualFile',
            'forceWriteAllContent',
            'verifyContentSync',
            'getTrackedFilesDebugInfo',
            'clearTrackedFilesCache'
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

                case 'forceWriteAllContent':
                    return await this.handleForceWriteAllContent(context);

                case 'verifyContentSync':
                    return await this.handleVerifyContentSync(message.frontendBoard, context);

                case 'getTrackedFilesDebugInfo':
                    return await this.handleGetTrackedFilesDebugInfo(context);

                case 'clearTrackedFilesCache':
                    return await this.handleClearTrackedFilesCache(context);

                default:
                    return this.failure(`Unknown include command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[IncludeCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= INCLUDE MODE HANDLERS =============

    private async handleConfirmDisableIncludeMode(message: any, context: CommandContext): Promise<CommandResult> {
        const confirmation = await vscode.window.showWarningMessage(
            message.message,
            { modal: true },
            'Disable Include Mode',
            'Cancel'
        );

        if (confirmation === 'Disable Include Mode') {
            const panel = context.getWebviewPanel() as any;
            if (panel?._panel) {
                panel._panel.webview.postMessage({
                    type: 'proceedDisableIncludeMode',
                    columnId: message.columnId
                });
            }
        }
        return this.success();
    }

    private async handleRequestIncludeFile(filePath: string, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel?._panel) {
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
                panel._panel.webview.postMessage({
                    type: 'includeFileContent',
                    filePath: filePath,
                    content: null,
                    error: `File not found: ${filePath}`
                });
                return this.success();
            }

            const content = fs.readFileSync(absolutePath, 'utf8');
            panel._panel.webview.postMessage({
                type: 'includeFileContent',
                filePath: filePath,
                content: content
            });
        } catch (fileError) {
            panel._panel.webview.postMessage({
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

            const panel = context.getWebviewPanel() as any;
            if (panel?._panel) {
                panel._panel.webview.postMessage({
                    type: 'proceedEnableIncludeMode',
                    columnId: message.columnId,
                    fileName: relativePath
                });
            }
        }
        return this.success();
    }

    private async handleRequestEditIncludeFileName(message: any, context: CommandContext): Promise<CommandResult> {
        const currentFile = message.currentFile || '';
        const panel = context.getWebviewPanel() as any;
        const fileRegistry = context.getFileRegistry();
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

            if (panel?._panel) {
                panel._panel.webview.postMessage({
                    type: 'proceedUpdateIncludeFile',
                    columnId: message.columnId,
                    newFileName: relativePath,
                    currentFile: currentFile
                });
            }
        }
        return this.success();
    }

    private async handleRequestEditTaskIncludeFileName(message: any, context: CommandContext): Promise<CommandResult> {
        const currentFile = message.currentFile || '';
        const taskId = message.taskId;
        const columnId = message.columnId;

        const panel = context.getWebviewPanel() as any;
        const fileRegistry = context.getFileRegistry();
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

            if (panel?._panel) {
                panel._panel.webview.postMessage({
                    type: 'proceedUpdateTaskIncludeFile',
                    taskId: taskId,
                    columnId: columnId,
                    newFileName: relativePath,
                    currentFile: currentFile
                });
            }
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

            const panel = context.getWebviewPanel() as any;
            if (panel?._panel) {
                panel._panel.webview.postMessage({
                    type: 'enableTaskIncludeMode',
                    taskId: taskId,
                    columnId: columnId,
                    fileName: relativePath
                });
            }
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

        panel._panel?.webview.postMessage({
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

                const fileRegistry = panel._fileRegistry;
                const mainFile = fileRegistry?.getMainFile();
                if (!mainFile) {
                    throw new Error('Main file not found in registry');
                }

                const saveCoordinator = fileService._saveCoordinator;
                await saveCoordinator.saveFile(mainFile, markdown);
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

                panel._panel.webview.postMessage({
                    type: 'individualFileSaved',
                    filePath: filePath,
                    isMainFile: true,
                    success: true,
                    forceSave: forceSave
                });
            } else {
                const fileRegistry = panel._fileRegistry;
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

                panel._panel.webview.postMessage({
                    type: 'individualFileSaved',
                    filePath: filePath,
                    isMainFile: false,
                    success: true,
                    forceSave: forceSave
                });

                await this.handleGetTrackedFilesDebugInfo(context);
            }
        } catch (error) {
            panel._panel?.webview.postMessage({
                type: 'individualFileSaved',
                filePath: filePath,
                isMainFile: isMainFile,
                success: false,
                forceSave: forceSave,
                error: error instanceof Error ? error.message : String(error)
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
                const fileRegistry = panel._fileRegistry;
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

                panel._panel.webview.postMessage({
                    type: 'individualFileReloaded',
                    filePath: filePath,
                    isMainFile: true,
                    success: true
                });
            } else {
                const fileRegistry = panel._fileRegistry;
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

                panel._panel.webview.postMessage({
                    type: 'individualFileReloaded',
                    filePath: filePath,
                    isMainFile: false,
                    success: true
                });
            }
        } catch (error) {
            panel._panel?.webview.postMessage({
                type: 'individualFileReloaded',
                filePath: filePath,
                isMainFile: isMainFile,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
        return this.success();
    }

    // ============= FORCE WRITE / VERIFICATION HANDLERS =============

    private async handleForceWriteAllContent(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel) {
            return this.success();
        }

        console.warn('[IncludeCommands] FORCE WRITE ALL: Starting emergency file write operation');

        let backupPath: string | undefined;
        try {
            const document = context.fileManager.getDocument();
            if (document && panel._conflictService) {
                backupPath = await panel._conflictService.createUnifiedBackup(
                    document.uri.fsPath,
                    'force-write',
                    true
                );
            }
        } catch (error) {
            console.error('[IncludeCommands] Failed to create backup before force write:', error);
        }

        try {
            const fileRegistry = panel._fileRegistry;
            if (!fileRegistry?.forceWriteAll) {
                throw new Error('File registry not available or forceWriteAll method not found');
            }

            const result = await fileRegistry.forceWriteAll();

            panel._panel.webview.postMessage({
                type: 'forceWriteAllResult',
                success: result.errors.length === 0,
                filesWritten: result.filesWritten,
                errors: result.errors,
                backupCreated: !!backupPath,
                backupPath: backupPath,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            panel._panel?.webview.postMessage({
                type: 'forceWriteAllResult',
                success: false,
                filesWritten: 0,
                errors: [error instanceof Error ? error.message : String(error)],
                backupCreated: false,
                timestamp: new Date().toISOString()
            });
        }
        return this.success();
    }

    private async handleVerifyContentSync(frontendBoard: any, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel) {
            return this.success();
        }

        try {
            if (!frontendBoard) {
                throw new Error('Frontend board data not provided');
            }

            const fileRegistry = panel._fileRegistry;
            if (!fileRegistry) {
                throw new Error('File registry not available');
            }

            const { MarkdownKanbanParser } = require('../markdownParser');

            const allFiles = fileRegistry.getAll();
            const fileResults: any[] = [];
            let matchingFiles = 0;
            let mismatchedFiles = 0;

            const backendBoard = panel.getBoard ? panel.getBoard() : undefined;

            for (const file of allFiles) {
                let backendContent: string;
                let frontendContent: string;
                let savedFileContent: string | null = null;

                try {
                    savedFileContent = fs.readFileSync(file.getPath(), 'utf8');
                } catch (error) {
                    console.error(`[IncludeCommands] Could not read saved file ${file.getPath()}:`, error);
                }

                if (file.getFileType() === 'main') {
                    frontendContent = MarkdownKanbanParser.generateMarkdown(frontendBoard);
                    backendContent = backendBoard
                        ? MarkdownKanbanParser.generateMarkdown(backendBoard)
                        : file.getContent();
                } else {
                    backendContent = file.getContent();
                    frontendContent = backendContent;
                }

                const backendHash = this.computeHash(backendContent);
                const frontendHash = this.computeHash(frontendContent);
                const savedHash = savedFileContent !== null ? this.computeHash(savedFileContent) : null;

                const frontendBackendMatch = backendHash === frontendHash;
                const backendSavedMatch = savedHash ? backendHash === savedHash : true;
                const allMatch = frontendBackendMatch && backendSavedMatch;

                if (allMatch) {
                    matchingFiles++;
                } else {
                    mismatchedFiles++;
                }

                fileResults.push({
                    path: file.getPath(),
                    relativePath: file.getRelativePath(),
                    isMainFile: file.getFileType() === 'main',
                    matches: allMatch,
                    frontendBackendMatch,
                    backendSavedMatch,
                    frontendSavedMatch: savedHash ? frontendHash === savedHash : true,
                    frontendContentLength: frontendContent.length,
                    backendContentLength: backendContent.length,
                    savedContentLength: savedFileContent?.length ?? null,
                    frontendBackendDiff: Math.abs(frontendContent.length - backendContent.length),
                    backendSavedDiff: savedFileContent ? Math.abs(backendContent.length - savedFileContent.length) : null,
                    frontendSavedDiff: savedFileContent ? Math.abs(frontendContent.length - savedFileContent.length) : null,
                    frontendHash: frontendHash.substring(0, 8),
                    backendHash: backendHash.substring(0, 8),
                    savedHash: savedHash?.substring(0, 8) ?? null
                });
            }

            panel._panel.webview.postMessage({
                type: 'verifyContentSyncResult',
                success: true,
                timestamp: new Date().toISOString(),
                totalFiles: allFiles.length,
                matchingFiles: matchingFiles,
                mismatchedFiles: mismatchedFiles,
                missingFiles: 0,
                fileResults: fileResults,
                summary: `${matchingFiles} files match, ${mismatchedFiles} differ`
            });
        } catch (error) {
            panel._panel?.webview.postMessage({
                type: 'verifyContentSyncResult',
                success: false,
                timestamp: new Date().toISOString(),
                totalFiles: 0,
                matchingFiles: 0,
                mismatchedFiles: 0,
                missingFiles: 0,
                fileResults: [],
                summary: `Verification failed: ${error instanceof Error ? error.message : String(error)}`
            });
        }
        return this.success();
    }

    // ============= DEBUG HANDLERS =============

    private async handleGetTrackedFilesDebugInfo(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel) {
            return this.success();
        }

        const debugData = await this.collectTrackedFilesDebugInfo(context);
        panel._panel?.webview.postMessage({
            type: 'trackedFilesDebugInfo',
            data: debugData
        });
        return this.success();
    }

    private async handleClearTrackedFilesCache(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as any;
        if (!panel) {
            return this.success();
        }

        try {
            const includeFileMap = panel._includeFiles;
            if (includeFileMap) {
                includeFileMap.clear();
            }

            panel._cachedBoardFromWebview = null;

            const document = context.fileManager.getDocument();
            if (document) {
                await panel.loadMarkdownFile(document, false);
            }
        } catch (error) {
            console.warn('[IncludeCommands] Error clearing panel caches:', error);
        }

        panel._panel?.webview.postMessage({
            type: 'debugCacheCleared'
        });
        return this.success();
    }

    // ============= HELPER METHODS =============

    private computeHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }

    private async collectTrackedFilesDebugInfo(context: CommandContext): Promise<any> {
        const document = context.fileManager.getDocument();
        const panel = context.getWebviewPanel() as any;
        const mainFile = panel?.fileRegistry?.getMainFile();

        const mainFilePath = context.fileManager.getFilePath() || document?.uri.fsPath || 'Unknown';

        const mainFileInfo = {
            path: mainFilePath,
            lastModified: mainFile?.getLastModified()?.toISOString() || 'Unknown',
            exists: mainFile?.exists() ?? (document ? true : false),
            watcherActive: true,
            hasInternalChanges: mainFile?.hasUnsavedChanges() ?? false,
            hasExternalChanges: mainFile?.hasExternalChanges() ?? false,
            documentVersion: document?.version ?? 0,
            lastDocumentVersion: document ? document.version - 1 : -1,
            isUnsavedInEditor: document?.isDirty ?? false,
            baseline: mainFile?.getBaseline() || ''
        };

        const includeFiles: any[] = [];
        const allIncludeFiles = panel?.fileRegistry?.getIncludeFiles() || [];

        for (const file of allIncludeFiles) {
            includeFiles.push({
                path: file.getRelativePath(),
                type: file.getFileType(),
                exists: file.exists(),
                lastModified: file.getLastModified()?.toISOString() || 'Unknown',
                size: 'Unknown',
                hasInternalChanges: file.hasUnsavedChanges(),
                hasExternalChanges: file.hasExternalChanges(),
                isUnsavedInEditor: file.isDirtyInEditor(),
                baseline: file.getBaseline(),
                content: file.getContent(),
                externalContent: '',
                contentLength: file.getContent().length,
                baselineLength: file.getBaseline().length,
                externalContentLength: 0
            });
        }

        const conflictManager = {
            healthy: true,
            trackedFiles: 1 + includeFiles.length,
            activeWatchers: 1 + includeFiles.length,
            pendingConflicts: 0,
            watcherFailures: 0,
            listenerEnabled: true,
            documentSaveListenerActive: true
        };

        const systemHealth = {
            overall: includeFiles.length > 0 ? 'good' : 'warn',
            extensionState: 'active',
            memoryUsage: 'normal',
            lastError: null
        };

        return {
            mainFile: mainFileInfo.path,
            mainFileLastModified: mainFileInfo.lastModified,
            fileWatcherActive: mainFileInfo.watcherActive,
            includeFiles: includeFiles,
            conflictManager: conflictManager,
            systemHealth: systemHealth,
            hasUnsavedChanges: panel ? panel._hasUnsavedChanges || false : false,
            timestamp: new Date().toISOString(),
            watcherDetails: mainFileInfo
        };
    }
}
