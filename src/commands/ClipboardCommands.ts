/**
 * Clipboard Commands
 *
 * Handles clipboard and image-related message operations:
 * - saveClipboardImage, saveClipboardImageWithPath, pasteImageIntoField
 * - saveDroppedImageFromContents, copyImageToMedia
 * - handleFileUriDrop, saveDroppedFileFromContents
 * - requestFileDropDialogue, executeFileDropCopy, executeFileDropLink
 * - linkExistingFile, openMediaFolder
 *
 * @module commands/ClipboardCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';

/**
 * Clipboard Commands Handler
 *
 * Processes clipboard and image-related messages from the webview.
 */
export class ClipboardCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'clipboard-commands',
        name: 'Clipboard Commands',
        description: 'Handles clipboard images, file drops, and media folder operations',
        messageTypes: [
            'saveClipboardImage',
            'saveClipboardImageWithPath',
            'pasteImageIntoField',
            'saveDroppedImageFromContents',
            'copyImageToMedia',
            'handleFileUriDrop',
            'saveDroppedFileFromContents',
            'requestFileDropDialogue',
            'executeFileDropCopy',
            'executeFileDropLink',
            'linkExistingFile',
            'openMediaFolder'
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
                case 'saveClipboardImage':
                    await messageHandler.handleSaveClipboardImage(
                        message.imageData,
                        message.imagePath,
                        message.mediaFolderPath,
                        message.dropPosition,
                        message.imageFileName,
                        message.mediaFolderName
                    );
                    return this.success();

                case 'saveClipboardImageWithPath':
                    await messageHandler.handleSaveClipboardImageWithPath(
                        message.imageData,
                        message.imageType,
                        message.dropPosition,
                        message.md5Hash
                    );
                    return this.success();

                case 'pasteImageIntoField':
                    await messageHandler.handlePasteImageIntoField(
                        message.imageData,
                        message.imageType,
                        message.md5Hash,
                        message.cursorPosition
                    );
                    return this.success();

                case 'saveDroppedImageFromContents':
                    await messageHandler.handleAnyFileDrop(
                        null, // No source path (File object)
                        message.imageData,
                        message.originalFileName,
                        message.dropPosition,
                        true // isImage
                    );
                    return this.success();

                case 'copyImageToMedia':
                    await messageHandler.handleAnyFileDrop(
                        message.sourcePath,
                        null, // No base64 data (URI drop)
                        message.originalFileName,
                        message.dropPosition,
                        true // isImage
                    );
                    return this.success();

                case 'handleFileUriDrop':
                    await messageHandler.handleAnyFileDrop(
                        message.sourcePath,
                        null, // No base64 data (URI drop)
                        message.originalFileName,
                        message.dropPosition,
                        false // not an image
                    );
                    return this.success();

                case 'saveDroppedFileFromContents':
                    await messageHandler.handleAnyFileDrop(
                        null, // No source path (File object)
                        message.fileData,
                        message.originalFileName,
                        message.dropPosition,
                        false // not an image
                    );
                    return this.success();

                case 'requestFileDropDialogue':
                    await messageHandler.handleRequestFileDropDialogue(message);
                    return this.success();

                case 'executeFileDropCopy':
                    await messageHandler.handleExecuteFileDropCopy(message);
                    return this.success();

                case 'executeFileDropLink':
                    await messageHandler.handleExecuteFileDropLink(message);
                    return this.success();

                case 'linkExistingFile':
                    await messageHandler.handleLinkExistingFile(message);
                    return this.success();

                case 'openMediaFolder':
                    await messageHandler.handleOpenMediaFolder();
                    return this.success();

                default:
                    return this.failure(`Unknown clipboard command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[ClipboardCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }
}
