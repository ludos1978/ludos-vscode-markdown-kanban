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
            const panel = context.getWebviewPanel();
            const messageHandler = (panel as any)?._messageHandler;

            if (!messageHandler) {
                return this.failure('No message handler available');
            }

            switch (message.type) {
                case 'confirmDisableIncludeMode':
                    await messageHandler.handleConfirmDisableIncludeMode(message);
                    return this.success();

                case 'requestIncludeFile':
                    await messageHandler.handleRequestIncludeFile(message.filePath);
                    return this.success();

                case 'registerInlineInclude':
                    await messageHandler.handleRegisterInlineInclude(message.filePath, message.content);
                    return this.success();

                case 'requestIncludeFileName':
                    await messageHandler.handleRequestIncludeFileName(message);
                    return this.success();

                case 'requestEditIncludeFileName':
                    await messageHandler.handleRequestEditIncludeFileName(message);
                    return this.success();

                case 'requestEditTaskIncludeFileName':
                    await messageHandler.handleRequestEditTaskIncludeFileName(message);
                    return this.success();

                case 'requestTaskIncludeFileName':
                    await messageHandler.handleRequestTaskIncludeFileName(message);
                    return this.success();

                case 'reloadAllIncludedFiles':
                    await messageHandler.handleReloadAllIncludedFiles();
                    return this.success();

                case 'saveIndividualFile':
                    await messageHandler.handleSaveIndividualFile(
                        message.filePath,
                        message.isMainFile,
                        message.forceSave
                    );
                    return this.success();

                case 'reloadIndividualFile':
                    await messageHandler.handleReloadIndividualFile(
                        message.filePath,
                        message.isMainFile
                    );
                    return this.success();

                case 'forceWriteAllContent':
                    await messageHandler.handleForceWriteAllContent();
                    return this.success();

                case 'verifyContentSync':
                    await messageHandler.handleVerifyContentSync(message.frontendBoard);
                    return this.success();

                case 'getTrackedFilesDebugInfo':
                    await messageHandler.handleGetTrackedFilesDebugInfo();
                    return this.success();

                case 'clearTrackedFilesCache':
                    await messageHandler.handleClearTrackedFilesCache();
                    return this.success();

                default:
                    return this.failure(`Unknown include command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[IncludeCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }
}
