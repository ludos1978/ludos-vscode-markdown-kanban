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

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            const panel = context.getWebviewPanel();
            const messageHandler = (panel as any)?._messageHandler;

            if (!messageHandler) {
                return this.failure('No message handler available');
            }

            switch (message.type) {
                case 'export':
                    const exportId = `export_${Date.now()}`;
                    await messageHandler.startOperation(exportId, 'export', 'Exporting...');
                    try {
                        await messageHandler.handleExport(message.options, exportId);
                        await messageHandler.endOperation(exportId);
                    } catch (error) {
                        await messageHandler.endOperation(exportId);
                        throw error;
                    }
                    return this.success();

                case 'stopAutoExport':
                    await messageHandler.handleStopAutoExport();
                    return this.success();

                case 'getExportDefaultFolder':
                    await messageHandler.handleGetExportDefaultFolder();
                    return this.success();

                case 'selectExportFolder':
                    await messageHandler.handleSelectExportFolder(message.defaultPath);
                    return this.success();

                case 'getMarpThemes':
                    await messageHandler.handleGetMarpThemes();
                    return this.success();

                case 'pollMarpThemes':
                    await messageHandler.handlePollMarpThemes();
                    return this.success();

                case 'openInMarpPreview':
                    await messageHandler.handleOpenInMarpPreview(message.filePath);
                    return this.success();

                case 'checkMarpStatus':
                    await messageHandler.handleCheckMarpStatus();
                    return this.success();

                case 'getMarpAvailableClasses':
                    await messageHandler.handleGetMarpAvailableClasses();
                    return this.success();

                case 'askOpenExportFolder':
                    await messageHandler.handleAskOpenExportFolder(message.path);
                    return this.success();

                default:
                    return this.failure(`Unknown export command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[ExportCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }
}
