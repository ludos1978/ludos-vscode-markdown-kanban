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

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler, IncomingMessage } from './interfaces';
import { ExportService, NewExportOptions } from '../services/export/ExportService';
import { MarpExtensionService } from '../services/export/MarpExtensionService';
import { pluginConfigService } from '../services/PluginConfigService';
import { PluginRegistry } from '../plugins/registry/PluginRegistry';
import { MarpExportPlugin } from '../plugins/export/MarpExportPlugin';
import { PandocExportPlugin } from '../plugins/export/PandocExportPlugin';
import { safeFileUri } from '../utils/uriUtils';
import { getErrorMessage } from '../utils/stringUtils';
import { FileChangeEvent } from '../files/MarkdownFile';
import { showError, showInfo } from '../services/NotificationService';
import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../utils/logger';

// Debug flag - set to true to enable verbose logging
const DEBUG = false;
const log = DEBUG ? logger.debug.bind(logger, '[ExportCommands]') : () => {};

// Track auto-export subscriptions (file path -> disposable)
const autoExportSubscriptions = new Map<string, vscode.Disposable>();

/**
 * Cleanup auto-export subscription for a document path.
 * Should be called when a panel is disposed to prevent memory leaks.
 */
export function cleanupAutoExportSubscription(docPath: string): void {
    const subscription = autoExportSubscriptions.get(docPath);
    if (subscription) {
        subscription.dispose();
        autoExportSubscriptions.delete(docPath);
    }
}

/**
 * Export Commands Handler
 *
 * Processes export-related messages from the webview.
 */
export class ExportCommands extends SwitchBasedCommand {
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
            'askOpenExportFolder',
            'checkPandocStatus'
        ],
        priority: 100
    };

    // Track active operations for progress reporting
    private _activeOperations = new Map<string, { type: string, startTime: number }>();

    protected handlers: Record<string, MessageHandler> = {
        'export': (msg, ctx) => this.handleExportWithTracking(msg, ctx),
        'stopAutoExport': async (_msg, ctx) => { await this.handleStopAutoExport(ctx); return this.success(); },
        'getExportDefaultFolder': async (_msg, ctx) => { await this.handleGetExportDefaultFolder(ctx); return this.success(); },
        'selectExportFolder': async (msg, ctx) => { await this.handleSelectExportFolder(ctx, (msg as any).defaultPath); return this.success(); },
        'getMarpThemes': async (_msg, ctx) => { await this.handleGetMarpThemes(ctx); return this.success(); },
        'pollMarpThemes': async (_msg, ctx) => { await this.handlePollMarpThemes(ctx); return this.success(); },
        'openInMarpPreview': async (msg, ctx) => { await this.handleOpenInMarpPreview((msg as any).filePath); return this.success(); },
        'checkMarpStatus': async (_msg, ctx) => { await this.handleCheckMarpStatus(ctx); return this.success(); },
        'getMarpAvailableClasses': async (_msg, ctx) => { await this.handleGetMarpAvailableClasses(ctx); return this.success(); },
        'askOpenExportFolder': async (msg, _ctx) => { await this.handleAskOpenExportFolder((msg as any).path); return this.success(); },
        'checkPandocStatus': async (_msg, ctx) => { await this.handleCheckPandocStatus(ctx); return this.success(); }
    };

    /**
     * Handle export with operation tracking
     */
    private async handleExportWithTracking(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        const exportId = `export_${Date.now()}`;
        await this.startOperation(exportId, 'export', 'Exporting...', context);
        try {
            await this.handleExport((message as any).options as NewExportOptions, context, exportId);
            await this.endOperation(exportId, context);
        } catch (error) {
            await this.endOperation(exportId, context);
            throw error;
        }
        return this.success();
    }

    // ============= OPERATION TRACKING =============

    private async startOperation(operationId: string, type: string, description: string, context: CommandContext) {
        this._activeOperations.set(operationId, { type, startTime: Date.now() });

        const panel = context.getWebviewPanel();
        if (panel && panel.webview) {
            this.postMessage({
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
            this.postMessage({
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
                this.postMessage({
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
    private async handleExport(options: NewExportOptions, context: CommandContext, operationId?: string): Promise<void> {
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

            // Get webview panel for diagram rendering
            const webviewPanel = context.getWebviewPanel();

            // Handle COPY mode (no progress bar)
            if (options.mode === 'copy') {
                const result = await ExportService.export(document, options, board, webviewPanel);

                this.postMessage({
                    type: 'copyContentResult',
                    result: result
                });

                if (!result.success) {
                    showError(result.message);
                }
                return;
            }

            // Handle SAVE / PREVIEW modes (with progress bar)
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Exporting...`,
                cancellable: true
            }, async (progress, token) => {
                // Check for cancellation before starting
                if (token.isCancellationRequested) {
                    showInfo('Export cancelled.');
                    return;
                }

                if (operationId) {
                    await this.updateOperationProgress(operationId, 20, context, 'Processing content...');
                }
                progress.report({ increment: 20, message: 'Processing content...' });

                // Check for cancellation before export
                if (token.isCancellationRequested) {
                    showInfo('Export cancelled.');
                    return;
                }

                const result = await ExportService.export(document!, options, board, webviewPanel, token);

                // Check for cancellation after export
                if (token.isCancellationRequested) {
                    showInfo('Export cancelled.');
                    return;
                }

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
                    showInfo(result.message);
                } else {
                    showError(result.message);
                }
            });

        } catch (error) {
            console.error('[ExportCommands.handleExport] Error:', error);
            showError(`Export failed: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Handle auto-export mode (register save handler)
     */
    private async handleAutoExportMode(document: vscode.TextDocument, options: NewExportOptions, context: CommandContext): Promise<void> {
        // Store settings
        context.setAutoExportSettings(options);

        // Get board for conversion exports
        const board = (options.format !== 'kanban' && !options.packAssets) ? context.getCurrentBoard() : undefined;

        // Get webview panel for diagram rendering
        const webviewPanel = context.getWebviewPanel();

        // Do initial export FIRST (to start Marp if needed)
        const initialResult = await ExportService.export(document, options, board, webviewPanel);

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
                // Get current webview panel (may have changed since initial setup)
                const currentWebviewPanel = context.getWebviewPanel();
                const result = await ExportService.export(freshDoc, options, undefined, currentWebviewPanel);

                if (result.success && options.openAfterExport && result.exportedPath && !options.marpWatch) {
                    const uri = safeFileUri(result.exportedPath, 'ExportCommands-openExportedFile');
                    await vscode.env.openExternal(uri);
                }
            } catch (error) {
                console.error('[ExportCommands.autoExport] Auto-export failed:', error);
                showError(`Auto-export failed: ${getErrorMessage(error)}`);
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
            // Dispose the onDidChange subscription
            const doc = context.fileManager.getDocument();
            if (doc) {
                const docPath = doc.uri.fsPath;
                const subscription = autoExportSubscriptions.get(docPath);
                if (subscription) {
                    subscription.dispose();
                    autoExportSubscriptions.delete(docPath);
                    log('Disposed auto-export subscription for:', docPath);
                }
            }

            // Stop all Marp watch processes via plugin
            const marpPlugin = this._getMarpPlugin();
            if (marpPlugin) {
                marpPlugin.stopAllWatches();
            }

            context.setAutoExportSettings(null);

            // Notify frontend to hide the auto-export button
            const panel = context.getWebviewPanel();
            if (panel && panel.webview) {
                this.postMessage({
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
    private async handleStopAutoExportForOtherKanbanFiles(_currentKanbanFilePath: string, _context: CommandContext, protectExportedPath?: string): Promise<void> {
        try {
            // Stop Marp watch processes for OTHER files (not the current export) via plugin
            const marpPlugin = this._getMarpPlugin();
            if (marpPlugin) {
                if (protectExportedPath) {
                    marpPlugin.stopAllWatchesExcept(protectExportedPath);
                } else {
                    marpPlugin.stopAllWatches();
                }
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
    private async handleSelectExportFolder(_context: CommandContext, defaultPath?: string): Promise<void> {
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
            const result = await vscode.window.showInformationMessage(
                'Export completed successfully!',
                'Reveal in Finder/Explorer',
                'Dismiss'
            );

            if (result === 'Reveal in Finder/Explorer') {
                // Use revealFileInOS to open in native file manager (Finder/Explorer)
                // This reveals the exported file directly, not opening as a VS Code workspace
                await vscode.commands.executeCommand('revealFileInOS', safeFileUri(exportPath, 'ExportCommands-revealExport'));
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
            const marpPlugin = this._getMarpPlugin();
            const themes = marpPlugin ? await marpPlugin.getAvailableThemes() : ['default'];

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
            const marpPlugin = this._getMarpPlugin();
            const themes = marpPlugin ? await marpPlugin.getAvailableThemes() : ['default'];

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
            showError(`Failed to open Marp preview: ${errorMessage}`);
        }
    }

    /**
     * Check Marp status and send to frontend
     */
    private async handleCheckMarpStatus(_context: CommandContext): Promise<void> {
        try {
            const marpExtensionStatus = MarpExtensionService.getMarpStatus();
            const marpPlugin = this._getMarpPlugin();
            const marpCliAvailable = marpPlugin ? await marpPlugin.isAvailable() : false;
            const engineFileExists = marpPlugin ? marpPlugin.engineFileExists() : false;
            const enginePath = marpPlugin ? marpPlugin.getEnginePath() : '';

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
     * Check Pandoc status and send to frontend
     */
    private async handleCheckPandocStatus(_context: CommandContext): Promise<void> {
        try {
            const pandocPlugin = this._getPandocPlugin();
            const isAvailable = pandocPlugin ? await pandocPlugin.isAvailable() : false;
            const version = (isAvailable && pandocPlugin) ? await pandocPlugin.getVersion() : null;

            if (!this.postMessage({
                type: 'pandocStatus',
                available: isAvailable,
                version: version
            })) {
                console.error('[ExportCommands.handleCheckPandocStatus] No webview panel available');
            }
        } catch (error) {
            console.error('[ExportCommands.handleCheckPandocStatus] Error:', error);
        }
    }

    /**
     * Get available Marp CSS classes
     */
    private async handleGetMarpAvailableClasses(_context: CommandContext): Promise<void> {
        try {
            const marpConfig = pluginConfigService.getPluginConfigAll('marp');
            const availableClasses = (marpConfig.availableClasses as string[]) || [];

            this.postMessage({
                type: 'marpAvailableClasses',
                classes: availableClasses
            });
        } catch (error) {
            console.error('[ExportCommands.handleGetMarpAvailableClasses] Error:', error);
        }
    }

    // ============= PLUGIN HELPERS =============

    /**
     * Get the registered MarpExportPlugin from PluginRegistry
     */
    private _getMarpPlugin(): MarpExportPlugin | null {
        const registry = PluginRegistry.getInstance();
        const plugin = registry.getAllExportPlugins().find(p => p.metadata.id === 'marp');
        return (plugin as MarpExportPlugin) ?? null;
    }

    /**
     * Get the registered PandocExportPlugin from PluginRegistry
     */
    private _getPandocPlugin(): PandocExportPlugin | null {
        const registry = PluginRegistry.getInstance();
        const plugin = registry.getAllExportPlugins().find(p => p.metadata.id === 'pandoc');
        return (plugin as PandocExportPlugin) ?? null;
    }
}
