/**
 * Export Commands
 *
 * Handles export-related message operations:
 * - export, stopAutoExport
 * - getExportDefaultFolder, selectExportFolder
 * - getMarpThemes, pollMarpThemes, openInMarpPreview
 * - checkMarpStatus, getMarpAvailableClasses
 * - askOpenExportFolder
 *
 * @module commands/ExportCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { ExportService } from '../services/export/ExportService';
import { MarpExportService } from '../services/export/MarpExportService';
import { MarpExtensionService } from '../services/export/MarpExtensionService';
import { ConfigurationService } from '../services/ConfigurationService';
import { SaveEventDispatcher } from '../SaveEventDispatcher';
import { safeFileUri } from '../utils/uriUtils';
import { getErrorMessage } from '../utils/stringUtils';
import { FileChangeEvent } from '../files/MarkdownFile';
import * as vscode from 'vscode';
import * as path from 'path';

// Debug flag - set to true to enable verbose logging
const DEBUG = false;
const log = DEBUG ? console.log.bind(console, '[ExportCommands]') : () => {};

// Track auto-export subscriptions (file path -> disposable)
const autoExportSubscriptions = new Map<string, vscode.Disposable>();

/**
 * Export Commands Handler
 *
 * Processes export-related messages from the webview.
 */
export class ExportCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'export-commands',
        name: 'Export Commands',
        description: 'Handles export operations, Marp themes, and export folder selection',
        messageTypes: [
            'export',
            'stopAutoExport',
            'getExportDefaultFolder',
            'selectExportFolder',
            'getMarpThemes',
            'pollMarpThemes',
            'openInMarpPreview',
            'checkMarpStatus',
            'getMarpAvailableClasses',
            'askOpenExportFolder'
        ],
        priority: 100
    };

    // Track active operations for progress reporting
    private _activeOperations = new Map<string, { type: string, startTime: number }>();

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'export':
                    const exportId = `export_${Date.now()}`;
                    await this.startOperation(exportId, 'export', 'Exporting...', context);
                    try {
                        await this.handleExport(message.options, context, exportId);
                        await this.endOperation(exportId, context);
                    } catch (error) {
                        await this.endOperation(exportId, context);
                        throw error;
                    }
                    return this.success();

                case 'stopAutoExport':
                    await this.handleStopAutoExport(context);
                    return this.success();

                case 'getExportDefaultFolder':
                    await this.handleGetExportDefaultFolder(context);
                    return this.success();

                case 'selectExportFolder':
                    await this.handleSelectExportFolder(context, message.defaultPath);
                    return this.success();

                case 'getMarpThemes':
                    await this.handleGetMarpThemes(context);
                    return this.success();

                case 'pollMarpThemes':
                    await this.handlePollMarpThemes(context);
                    return this.success();

                case 'openInMarpPreview':
                    await this.handleOpenInMarpPreview(message.filePath);
                    return this.success();

                case 'checkMarpStatus':
                    await this.handleCheckMarpStatus(context);
                    return this.success();

                case 'getMarpAvailableClasses':
                    await this.handleGetMarpAvailableClasses(context);
                    return this.success();

                case 'askOpenExportFolder':
                    await this.handleAskOpenExportFolder(message.path);
                    return this.success();

                default:
                    return this.failure(`Unknown export command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[ExportCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= OPERATION TRACKING =============

    private async startOperation(operationId: string, type: string, description: string, context: CommandContext) {
        this._activeOperations.set(operationId, { type, startTime: Date.now() });

        const panel = context.getWebviewPanel();
        if (panel && panel.webview) {
            panel.webview.postMessage({
                type: 'operationStarted',
                operationId,
                operationType: type,
                description
            });
        }
    }

    private async updateOperationProgress(operationId: string, progress: number, context: CommandContext, message?: string) {
        const panel = context.getWebviewPanel();
        if (panel && panel.webview) {
            panel.webview.postMessage({
                type: 'operationProgress',
                operationId,
                progress,
                message
            });
        }
    }

    private async endOperation(operationId: string, context: CommandContext) {
        const operation = this._activeOperations.get(operationId);
        if (operation) {
            this._activeOperations.delete(operationId);

            const panel = context.getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: 'operationCompleted',
                    operationId
                });
            }
        }
    }

    // ============= EXPORT HANDLERS =============

    /**
     * Unified export handler - handles ALL export operations
     */
    private async handleExport(options: any, context: CommandContext, operationId?: string): Promise<void> {
        try {
            // Get document (with fallback to file path if document is closed)
            let document = context.fileManager.getDocument();
            if (!document) {
                const filePath = context.fileManager.getFilePath();
                if (filePath) {
                    try {
                        document = await vscode.workspace.openTextDocument(filePath);
                    } catch (error) {
                        console.error('[ExportCommands.handleExport] Failed to open document from file path:', error);
                    }
                }
            }
            if (!document) {
                throw new Error('No document available for export');
            }

            // Handle AUTO mode specially (register save handler)
            if (options.mode === 'auto') {
                return await this.handleAutoExportMode(document, options, context);
            }

            // Get board for ANY conversion exports (use in-memory board data)
            const board = (options.format !== 'kanban' && !options.packAssets) ? context.getCurrentBoard() : undefined;

            // Handle COPY mode (no progress bar)
            if (options.mode === 'copy') {
                const result = await ExportService.export(document, options, board);

                this.postMessage({
                    type: 'copyContentResult',
                    result: result
                });

                if (!result.success) {
                    vscode.window.showErrorMessage(result.message);
                }
                return;
            }

            // Handle SAVE / PREVIEW modes (with progress bar)
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Exporting...`,
                cancellable: false
            }, async (progress) => {
                if (operationId) {
                    await this.updateOperationProgress(operationId, 20, context, 'Processing content...');
                }
                progress.report({ increment: 20, message: 'Processing content...' });

                const result = await ExportService.export(document!, options, board);

                if (operationId) {
                    await this.updateOperationProgress(operationId, 90, context, 'Finalizing...');
                }
                progress.report({ increment: 80, message: 'Finalizing...' });

                // Send result to webview
                this.postMessage({
                    type: 'exportResult',
                    result: result
                });

                if (operationId) {
                    await this.updateOperationProgress(operationId, 100, context);
                }

                // Show result message
                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                } else {
                    vscode.window.showErrorMessage(result.message);
                }
            });

        } catch (error) {
            console.error('[ExportCommands.handleExport] Error:', error);
            vscode.window.showErrorMessage(`Export failed: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Handle auto-export mode (register save handler)
     */
    private async handleAutoExportMode(document: vscode.TextDocument, options: any, context: CommandContext): Promise<void> {
        // Store settings
        context.setAutoExportSettings(options);

        // Get board for conversion exports
        const board = (options.format !== 'kanban' && !options.packAssets) ? context.getCurrentBoard() : undefined;

        // Do initial export FIRST (to start Marp if needed)
        const initialResult = await ExportService.export(document, options, board);

        // NOW stop existing handlers/processes for other files
        // Use marpWatchPath (the file Marp is watching) for protection, fallback to exportedPath
        await this.handleStopAutoExportForOtherKanbanFiles(document.uri.fsPath, context, initialResult.marpWatchPath || initialResult.exportedPath);

        const docPath = document.uri.fsPath;

        // Clean up any existing subscription for this file
        const existingSubscription = autoExportSubscriptions.get(docPath);
        if (existingSubscription) {
            existingSubscription.dispose();
            autoExportSubscriptions.delete(docPath);
        }

        // Get the main kanban file from the file registry
        const fileRegistry = context.getFileRegistry();
        if (!fileRegistry) {
            console.error('[ExportCommands] No file registry available for auto-export');
            return;
        }

        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            console.error('[ExportCommands] No main kanban file found for auto-export');
            return;
        }

        log('Setting up auto-export listener for:', mainFile.getPath());

        // Subscribe to the kanban file's onDidChange event
        const subscription = mainFile.onDidChange(async (event: FileChangeEvent) => {
            // Only trigger export on 'saved' events
            if (event.changeType !== 'saved') {
                return;
            }

            try {
                // Re-read the document to get fresh content
                const freshDoc = await vscode.workspace.openTextDocument(document.uri);
                const result = await ExportService.export(freshDoc, options, undefined);

                if (result.success && options.openAfterExport && result.exportedPath && !options.marpWatch) {
                    const uri = safeFileUri(result.exportedPath, 'ExportCommands-openExportedFile');
                    await vscode.env.openExternal(uri);
                }
            } catch (error) {
                console.error('[ExportCommands.autoExport] Auto-export failed:', error);
                vscode.window.showErrorMessage(`Auto-export failed: ${getErrorMessage(error)}`);
            }
        });

        // Store the subscription for cleanup
        autoExportSubscriptions.set(docPath, subscription);
        log('Auto-export listener registered');
    }

    /**
     * Stop auto-export
     */
    private async handleStopAutoExport(context: CommandContext): Promise<void> {
        try {
            // Unregister from SaveEventDispatcher (legacy)
            const doc = context.fileManager.getDocument();
            if (doc) {
                const coordinator = SaveEventDispatcher.getInstance();
                coordinator.unregisterHandler(`auto-export-${doc.uri.fsPath}`);

                // Also dispose the onDidChange subscription
                const docPath = doc.uri.fsPath;
                const subscription = autoExportSubscriptions.get(docPath);
                if (subscription) {
                    subscription.dispose();
                    autoExportSubscriptions.delete(docPath);
                    log('Disposed auto-export subscription for:', docPath);
                }
            }

            // Stop all Marp watch processes
            MarpExportService.stopAllMarpWatches();

            context.setAutoExportSettings(null);

            // Notify frontend to hide the auto-export button
            const panel = context.getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: 'autoExportStopped'
                });
            } else {
                console.warn('[ExportCommands.handleStopAutoExport] No webview panel available to send message');
            }
        } catch (error) {
            console.error('[ExportCommands.handleStopAutoExport] Error:', error);
            throw error;
        }
    }

    /**
     * Stop auto-export for other kanban files (not generated files from current export)
     */
    private async handleStopAutoExportForOtherKanbanFiles(currentKanbanFilePath: string, context: CommandContext, protectExportedPath?: string): Promise<void> {
        try {
            // Unregister from SaveEventDispatcher
            const doc = context.fileManager.getDocument();
            if (doc) {
                const coordinator = SaveEventDispatcher.getInstance();
                coordinator.unregisterHandler(`auto-export-${doc.uri.fsPath}`);
            }

            // Stop Marp watch processes for OTHER files (not the current export)
            if (protectExportedPath) {
                MarpExportService.stopAllMarpWatchesExcept(protectExportedPath);
            } else {
                MarpExportService.stopAllMarpWatches();
            }
        } catch (error) {
            console.error('[ExportCommands.handleStopAutoExportForOtherKanbanFiles] Error:', error);
            throw error;
        }
    }

    // ============= EXPORT FOLDER HANDLERS =============

    /**
     * Get default export folder
     */
    private async handleGetExportDefaultFolder(context: CommandContext): Promise<void> {
        try {
            let document = context.fileManager.getDocument();

            // If document not available from FileManager, try to get the file path and open it
            if (!document) {
                const filePath = context.fileManager.getFilePath();

                if (filePath) {
                    try {
                        document = await vscode.workspace.openTextDocument(filePath);
                    } catch (error) {
                        console.error('[ExportCommands.getExportDefaultFolder] Failed to open document from file path:', error);
                    }
                }

                // If still no document, try active editor as last resort
                if (!document) {
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor && activeEditor.document.fileName.endsWith('.md')) {
                        document = activeEditor.document;
                    }
                }
            }

            if (!document) {
                console.error('[ExportCommands.getExportDefaultFolder] No document available for export');
                return;
            }

            const defaultFolder = ExportService.generateDefaultExportFolder(document.uri.fsPath);
            this.postMessage({
                type: 'exportDefaultFolder',
                folderPath: defaultFolder
            });
        } catch (error) {
            console.error('[ExportCommands.getExportDefaultFolder] Error:', error);
        }
    }

    /**
     * Select export folder via dialog
     */
    private async handleSelectExportFolder(context: CommandContext, defaultPath?: string): Promise<void> {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Export Folder',
                defaultUri: defaultPath ? safeFileUri(defaultPath, 'ExportCommands-selectExportFolder') : undefined
            });

            if (result && result[0]) {
                this.postMessage({
                    type: 'exportFolderSelected',
                    folderPath: result[0].fsPath
                });
            }
        } catch (error) {
            console.error('Error selecting export folder:', error);
        }
    }

    /**
     * Ask to open export folder after export
     */
    private async handleAskOpenExportFolder(exportPath: string): Promise<void> {
        try {
            const folderPath = path.dirname(exportPath);
            const result = await vscode.window.showInformationMessage(
                'Export completed successfully!',
                'Open Export Folder',
                'Dismiss'
            );

            if (result === 'Open Export Folder') {
                await vscode.commands.executeCommand('vscode.openFolder', safeFileUri(folderPath, 'ExportCommands-openExportFolder'), true);
            }
        } catch (error) {
            console.error('Error handling export folder open request:', error);
        }
    }

    // ============= MARP HANDLERS =============

    /**
     * Get available Marp themes
     */
    private async handleGetMarpThemes(_context: CommandContext): Promise<void> {
        try {
            const themes = await MarpExportService.getAvailableThemes();

            if (!this.postMessage({ type: 'marpThemesAvailable', themes: themes })) {
                console.error('[ExportCommands.handleGetMarpThemes] No webview panel available');
            }
        } catch (error) {
            console.error('[ExportCommands.handleGetMarpThemes] Error:', error);

            this.postMessage({
                type: 'marpThemesAvailable',
                themes: ['default'], // Fallback
                error: getErrorMessage(error)
            });
        }
    }

    /**
     * Poll for Marp themes (fallback mechanism)
     */
    private async handlePollMarpThemes(_context: CommandContext): Promise<void> {
        try {
            const themes = await MarpExportService.getAvailableThemes();

            if (!this.postMessage({ type: 'marpThemesAvailable', themes: themes })) {
                console.error('[ExportCommands.handlePollMarpThemes] Still no webview panel available');
            }
        } catch (error) {
            console.error('[ExportCommands.handlePollMarpThemes] Error:', error);
        }
    }

    /**
     * Open a markdown file in Marp preview
     */
    private async handleOpenInMarpPreview(filePath: string): Promise<void> {
        try {
            await MarpExtensionService.openInMarpPreview(filePath);
        } catch (error) {
            console.error('[ExportCommands.handleOpenInMarpPreview] Error:', error);
            const errorMessage = getErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to open Marp preview: ${errorMessage}`);
        }
    }

    /**
     * Check Marp status and send to frontend
     */
    private async handleCheckMarpStatus(_context: CommandContext): Promise<void> {
        try {
            const marpExtensionStatus = MarpExtensionService.getMarpStatus();
            const marpCliAvailable = await MarpExportService.isMarpCliAvailable();
            const engineFileExists = MarpExportService.engineFileExists();
            const enginePath = MarpExportService.getEnginePath();

            if (!this.postMessage({
                type: 'marpStatus',
                extensionInstalled: marpExtensionStatus.installed,
                extensionVersion: marpExtensionStatus.version,
                cliAvailable: marpCliAvailable,
                engineFileExists: engineFileExists,
                enginePath: enginePath
            })) {
                console.error('[ExportCommands.handleCheckMarpStatus] No webview panel available');
            }
        } catch (error) {
            console.error('[ExportCommands.handleCheckMarpStatus] Error:', error);
        }
    }

    /**
     * Get available Marp CSS classes
     */
    private async handleGetMarpAvailableClasses(_context: CommandContext): Promise<void> {
        try {
            const config = ConfigurationService.getInstance();
            const marpConfig = config.getConfig('marp');
            const availableClasses = marpConfig.availableClasses || [];

            this.postMessage({
                type: 'marpAvailableClasses',
                classes: availableClasses
            });
        } catch (error) {
            console.error('[ExportCommands.handleGetMarpAvailableClasses] Error:', error);
        }
    }
}
