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
import { ConfigurationService } from '../configurationService';
import { safeFileUri } from '../utils/uriUtils';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const configService = ConfigurationService.getInstance();

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

    private readonly PARTIAL_HASH_SIZE = 1024 * 1024; // 1MB threshold for partial hashing

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'saveClipboardImage':
                    await this.handleSaveClipboardImage(
                        message.imageData,
                        message.imagePath,
                        message.mediaFolderPath,
                        message.dropPosition,
                        message.imageFileName,
                        message.mediaFolderName,
                        context
                    );
                    return this.success();

                case 'saveClipboardImageWithPath':
                    await this.handleSaveClipboardImageWithPath(
                        message.imageData,
                        message.imageType,
                        message.dropPosition,
                        context,
                        message.md5Hash
                    );
                    return this.success();

                case 'pasteImageIntoField':
                    await this.handlePasteImageIntoField(
                        message.imageData,
                        message.imageType,
                        message.md5Hash,
                        message.cursorPosition,
                        context
                    );
                    return this.success();

                case 'saveDroppedImageFromContents':
                    await this.handleAnyFileDrop(
                        null,
                        message.imageData,
                        message.originalFileName,
                        message.dropPosition,
                        true,
                        context
                    );
                    return this.success();

                case 'copyImageToMedia':
                    await this.handleAnyFileDrop(
                        message.sourcePath,
                        null,
                        message.originalFileName,
                        message.dropPosition,
                        true,
                        context
                    );
                    return this.success();

                case 'handleFileUriDrop':
                    await this.handleAnyFileDrop(
                        message.sourcePath,
                        null,
                        message.originalFileName,
                        message.dropPosition,
                        false,
                        context
                    );
                    return this.success();

                case 'saveDroppedFileFromContents':
                    await this.handleAnyFileDrop(
                        null,
                        message.fileData,
                        message.originalFileName,
                        message.dropPosition,
                        false,
                        context
                    );
                    return this.success();

                case 'requestFileDropDialogue':
                    await this.handleRequestFileDropDialogue(message, context);
                    return this.success();

                case 'executeFileDropCopy':
                    await this.handleExecuteFileDropCopy(message, context);
                    return this.success();

                case 'executeFileDropLink':
                    await this.handleExecuteFileDropLink(message, context);
                    return this.success();

                case 'linkExistingFile':
                    await this.handleLinkExistingFile(message, context);
                    return this.success();

                case 'openMediaFolder':
                    await this.handleOpenMediaFolder(context);
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

    // ============= CLIPBOARD IMAGE HANDLERS =============

    private async handleSaveClipboardImage(
        imageData: string,
        imagePath: string,
        mediaFolderPath: string,
        dropPosition: { x: number; y: number },
        imageFileName: string,
        mediaFolderName: string,
        context: CommandContext
    ): Promise<void> {
        try {
            if (!fs.existsSync(mediaFolderPath)) {
                fs.mkdirSync(mediaFolderPath, { recursive: true });
            }

            const buffer = Buffer.from(imageData, 'base64');
            fs.writeFileSync(imagePath, buffer);

            const panel = context.getWebviewPanel();
            if (panel && (panel as any)._panel) {
                (panel as any)._panel.webview.postMessage({
                    type: 'clipboardImageSaved',
                    success: true,
                    imagePath: imagePath,
                    relativePath: `./${mediaFolderName}/${imageFileName}`,
                    dropPosition: dropPosition
                });
            }
        } catch (error) {
            console.error('[ClipboardCommands] Error saving clipboard image:', error);
            const panel = context.getWebviewPanel();
            if (panel && (panel as any)._panel) {
                (panel as any)._panel.webview.postMessage({
                    type: 'clipboardImageSaved',
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    dropPosition: dropPosition
                });
            }
        }
    }

    private async handleSaveClipboardImageWithPath(
        imageData: string,
        imageType: string,
        dropPosition: { x: number; y: number },
        context: CommandContext,
        md5Hash?: string
    ): Promise<void> {
        try {
            const document = context.fileManager.getDocument();
            const currentFilePath = context.fileManager.getFilePath() || document?.uri.fsPath;
            if (!currentFilePath) {
                const panel = context.getWebviewPanel();
                if (panel && (panel as any)._panel) {
                    (panel as any)._panel.webview.postMessage({
                        type: 'clipboardImageSaved',
                        success: false,
                        error: 'No current file path available',
                        dropPosition: dropPosition
                    });
                }
                return;
            }

            const pathParts = currentFilePath.split(/[\/\\]/);
            const fileName = pathParts.pop() || 'kanban';
            const baseFileName = fileName.replace(/\.[^/.]+$/, '');
            const directory = pathParts.join('/');

            const extension = imageType.split('/')[1] || 'png';
            const imageFileName = md5Hash ? `${md5Hash}.${extension}` : `clipboard-image-${Date.now()}.${extension}`;

            const mediaFolderName = `${baseFileName}-MEDIA`;
            const mediaFolderPath = `${directory}/${mediaFolderName}`;
            const imagePath = `${mediaFolderPath}/${imageFileName}`;

            if (!fs.existsSync(mediaFolderPath)) {
                fs.mkdirSync(mediaFolderPath, { recursive: true });
            }

            const base64Only = imageData.includes(',') ? imageData.split(',')[1] : imageData;
            const buffer = Buffer.from(base64Only, 'base64');
            fs.writeFileSync(imagePath, buffer);

            const panel = context.getWebviewPanel();
            if (panel && (panel as any)._panel) {
                (panel as any)._panel.webview.postMessage({
                    type: 'clipboardImageSaved',
                    success: true,
                    imagePath: imagePath,
                    relativePath: `./${mediaFolderName}/${imageFileName}`,
                    dropPosition: dropPosition
                });
            }
        } catch (error) {
            console.error('[ClipboardCommands] Error saving clipboard image with path:', error);
            const panel = context.getWebviewPanel();
            if (panel && (panel as any)._panel) {
                (panel as any)._panel.webview.postMessage({
                    type: 'clipboardImageSaved',
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    dropPosition: dropPosition
                });
            }
        }
    }

    private async handlePasteImageIntoField(
        imageData: string,
        imageType: string,
        md5Hash: string,
        cursorPosition: number,
        context: CommandContext
    ): Promise<void> {
        try {
            const document = context.fileManager.getDocument();
            const currentFilePath = context.fileManager.getFilePath() || document?.uri.fsPath;
            if (!currentFilePath) {
                const panel = context.getWebviewPanel();
                if (panel && (panel as any)._panel) {
                    (panel as any)._panel.webview.postMessage({
                        type: 'imagePastedIntoField',
                        success: false,
                        error: 'No current file path available',
                        cursorPosition: cursorPosition
                    });
                }
                return;
            }

            const pathParts = currentFilePath.split(/[\/\\]/);
            const fileName = pathParts.pop() || 'kanban';
            const baseFileName = fileName.replace(/\.[^/.]+$/, '');
            const directory = pathParts.join('/');

            const extension = imageType.split('/')[1] || 'png';
            const imageFileName = `${md5Hash}.${extension}`;

            const mediaFolderName = `${baseFileName}-MEDIA`;
            const mediaFolderPath = `${directory}/${mediaFolderName}`;
            const imagePath = `${mediaFolderPath}/${imageFileName}`;

            if (!fs.existsSync(mediaFolderPath)) {
                fs.mkdirSync(mediaFolderPath, { recursive: true });
            }

            const base64Only = imageData.includes(',') ? imageData.split(',')[1] : imageData;
            const buffer = Buffer.from(base64Only, 'base64');
            fs.writeFileSync(imagePath, buffer);

            const panel = context.getWebviewPanel();
            if (panel && (panel as any)._panel) {
                (panel as any)._panel.webview.postMessage({
                    type: 'imagePastedIntoField',
                    success: true,
                    imagePath: imagePath,
                    relativePath: `./${mediaFolderName}/${imageFileName}`,
                    cursorPosition: cursorPosition
                });
            }
        } catch (error) {
            console.error('[ClipboardCommands] Error pasting image into field:', error);
            const panel = context.getWebviewPanel();
            if (panel && (panel as any)._panel) {
                (panel as any)._panel.webview.postMessage({
                    type: 'imagePastedIntoField',
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    cursorPosition: cursorPosition
                });
            }
        }
    }

    // ============= FILE DROP HANDLERS =============

    private async handleAnyFileDrop(
        sourcePath: string | null,
        fileData: string | null,
        originalFileName: string,
        dropPosition: { x: number; y: number },
        isImage: boolean,
        context: CommandContext
    ): Promise<void> {
        try {
            const { directory, baseFileName } = this._getCurrentFilePaths(context);

            if (sourcePath && this._isFileInWorkspace(sourcePath)) {
                return this._sendLinkMessage(sourcePath, originalFileName, dropPosition, directory, isImage, context);
            }

            return this._copyToMediaFolder(sourcePath, fileData, originalFileName, dropPosition, directory, baseFileName, isImage, context);
        } catch (error) {
            console.error('[ClipboardCommands] Error handling file:', error);
            this._sendFileDropError(error instanceof Error ? error.message : 'Unknown error', dropPosition, isImage, fileData !== null, context);
        }
    }

    private async handleRequestFileDropDialogue(message: any, context: CommandContext): Promise<void> {
        const { dropId, fileName, isImage, hasSourcePath, sourcePath, partialHashData, dropPosition } = message;
        let { fileSize } = message;

        try {
            const { directory, baseFileName } = this._getCurrentFilePaths(context);

            if (hasSourcePath && sourcePath) {
                if (this._isFileInWorkspace(sourcePath)) {
                    return this._sendLinkMessage(sourcePath, fileName, dropPosition, directory, isImage, context);
                }

                if (fs.existsSync(sourcePath)) {
                    const stats = fs.statSync(sourcePath);
                    fileSize = stats.size;
                }
            }

            let fileHash: string | null = null;
            if (hasSourcePath && sourcePath && fs.existsSync(sourcePath)) {
                fileHash = this._calculatePartialHash(sourcePath);
            } else if (partialHashData && fileSize !== undefined) {
                const partialBuffer = Buffer.from(partialHashData, 'base64');
                fileHash = this._calculatePartialHashFromData(partialBuffer, fileSize);
            }

            let existingFile: string | null = null;
            if (fileHash) {
                const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);
                existingFile = this._findMatchingFileByHash(mediaFolderPath, fileHash, fileName);
            }

            const panel = context.getWebviewPanel();
            if (panel && (panel as any)._panel) {
                (panel as any)._panel.webview.postMessage({
                    type: 'showFileDropDialogue',
                    dropId: dropId,
                    fileName: fileName,
                    fileSize: fileSize,
                    isImage: isImage,
                    hasSourcePath: hasSourcePath,
                    sourcePath: sourcePath,
                    existingFile: existingFile,
                    dropPosition: dropPosition
                });
            }
        } catch (error) {
            console.error('[ClipboardCommands] Error in file drop dialogue:', error);
            this._sendFileDropError(error instanceof Error ? error.message : 'Unknown error', dropPosition, isImage, !hasSourcePath, context);
        }
    }

    private async handleExecuteFileDropCopy(message: any, context: CommandContext): Promise<void> {
        const { sourcePath, fileName, isImage, dropPosition } = message;

        try {
            const { directory, baseFileName } = this._getCurrentFilePaths(context);
            await this._copyToMediaFolder(sourcePath, null, fileName, dropPosition, directory, baseFileName, isImage, context);
        } catch (error) {
            console.error('[ClipboardCommands] Error in file drop copy:', error);
            this._sendFileDropError(error instanceof Error ? error.message : 'Unknown error', dropPosition, isImage, false, context);
        }
    }

    private async handleExecuteFileDropLink(message: any, context: CommandContext): Promise<void> {
        const { sourcePath, fileName, isImage, dropPosition } = message;

        try {
            const { directory } = this._getCurrentFilePaths(context);
            this._sendLinkMessage(sourcePath, fileName, dropPosition, directory, isImage, context);
        } catch (error) {
            console.error('[ClipboardCommands] Error in file drop link:', error);
            this._sendFileDropError(error instanceof Error ? error.message : 'Unknown error', dropPosition, isImage, false, context);
        }
    }

    private async handleLinkExistingFile(message: any, context: CommandContext): Promise<void> {
        const { existingFile, fileName, isImage, dropPosition } = message;

        try {
            const { directory, baseFileName } = this._getCurrentFilePaths(context);
            const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);
            const existingFilePath = path.join(mediaFolderPath, existingFile);

            this._sendLinkMessage(existingFilePath, fileName, dropPosition, directory, isImage, context);
        } catch (error) {
            console.error('[ClipboardCommands] Error linking existing file:', error);
            this._sendFileDropError(error instanceof Error ? error.message : 'Unknown error', dropPosition, isImage, true, context);
        }
    }

    private async handleOpenMediaFolder(context: CommandContext): Promise<void> {
        try {
            const { directory, baseFileName } = this._getCurrentFilePaths(context);
            const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);

            await vscode.commands.executeCommand('revealFileInOS', safeFileUri(mediaFolderPath, 'ClipboardCommands-revealMedia'));
        } catch (error) {
            console.error('[ClipboardCommands] Error opening media folder:', error);
            vscode.window.showErrorMessage(`Failed to open media folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // ============= HELPER METHODS =============

    private _getCurrentFilePaths(context: CommandContext): { currentFilePath: string; directory: string; fileName: string; baseFileName: string } {
        const document = context.fileManager.getDocument();
        const currentFilePath = context.fileManager.getFilePath() || document?.uri.fsPath;
        if (!currentFilePath) {
            throw new Error('No current file path available');
        }

        const directory = path.dirname(currentFilePath);
        const fileName = path.basename(currentFilePath);
        const baseFileName = fileName.replace(/\.[^/.]+$/, '');

        return { currentFilePath, directory, fileName, baseFileName };
    }

    private _getMediaFolderPath(directory: string, baseFileName: string): string {
        const mediaFolderName = `${baseFileName}-MEDIA`;
        const mediaFolderPath = path.join(directory, mediaFolderName);

        if (!fs.existsSync(mediaFolderPath)) {
            fs.mkdirSync(mediaFolderPath, { recursive: true });
        }

        return mediaFolderPath;
    }

    private _isFileInWorkspace(filePath: string): boolean {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return false;
        }

        const isWindows = process.platform === 'win32';
        let fileResolved = path.resolve(filePath);
        if (isWindows) {
            fileResolved = fileResolved.toLowerCase();
        }

        for (const folder of workspaceFolders) {
            let workspaceResolved = path.resolve(folder.uri.fsPath);
            if (isWindows) {
                workspaceResolved = workspaceResolved.toLowerCase();
            }
            if (fileResolved === workspaceResolved || fileResolved.startsWith(workspaceResolved + path.sep)) {
                return true;
            }
        }

        return false;
    }

    private _generateHash(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 12);
    }

    private _calculatePartialHash(filePath: string): string {
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;

        if (fileSize <= this.PARTIAL_HASH_SIZE) {
            const buffer = fs.readFileSync(filePath);
            return this._generateHash(buffer);
        } else {
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(this.PARTIAL_HASH_SIZE);
            fs.readSync(fd, buffer, 0, this.PARTIAL_HASH_SIZE, 0);
            fs.closeSync(fd);

            const sizeBuffer = Buffer.from(fileSize.toString());
            const combined = Buffer.concat([buffer, sizeBuffer]);
            return this._generateHash(combined);
        }
    }

    private _calculatePartialHashFromData(partialData: Buffer, fileSize: number): string {
        if (fileSize <= this.PARTIAL_HASH_SIZE) {
            return this._generateHash(partialData);
        } else {
            const sizeBuffer = Buffer.from(fileSize.toString());
            const combined = Buffer.concat([partialData, sizeBuffer]);
            return this._generateHash(combined);
        }
    }

    private _loadHashCache(mediaFolderPath: string): Map<string, { hash: string; mtime: number }> {
        const cachePath = path.join(mediaFolderPath, '.hash_cache');
        const cache = new Map<string, { hash: string; mtime: number }>();

        if (fs.existsSync(cachePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
                for (const [fileName, entry] of Object.entries(data)) {
                    cache.set(fileName, entry as { hash: string; mtime: number });
                }
            } catch (error) {
                console.warn('[ClipboardCommands] Failed to load hash cache:', error);
            }
        }

        return cache;
    }

    private _saveHashCache(mediaFolderPath: string, cache: Map<string, { hash: string; mtime: number }>): void {
        const cachePath = path.join(mediaFolderPath, '.hash_cache');
        const data: Record<string, { hash: string; mtime: number }> = {};

        for (const [fileName, entry] of cache.entries()) {
            data[fileName] = entry;
        }

        try {
            fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.warn('[ClipboardCommands] Failed to save hash cache:', error);
        }
    }

    private _updateHashCache(mediaFolderPath: string): Map<string, { hash: string; mtime: number }> {
        const cache = this._loadHashCache(mediaFolderPath);
        let cacheModified = false;

        if (!fs.existsSync(mediaFolderPath)) {
            return cache;
        }

        const files = fs.readdirSync(mediaFolderPath);
        const currentFiles = new Set<string>();

        for (const fileName of files) {
            if (fileName === '.hash_cache' || fileName.startsWith('.')) {
                continue;
            }

            const filePath = path.join(mediaFolderPath, fileName);
            const stats = fs.statSync(filePath);

            if (!stats.isFile()) {
                continue;
            }

            currentFiles.add(fileName);
            const mtime = stats.mtimeMs;
            const cached = cache.get(fileName);

            if (!cached || cached.mtime !== mtime) {
                const hash = this._calculatePartialHash(filePath);
                cache.set(fileName, { hash, mtime });
                cacheModified = true;
            }
        }

        for (const fileName of cache.keys()) {
            if (!currentFiles.has(fileName)) {
                cache.delete(fileName);
                cacheModified = true;
            }
        }

        if (cacheModified) {
            this._saveHashCache(mediaFolderPath, cache);
        }

        return cache;
    }

    private _findMatchingFileByHash(mediaFolderPath: string, targetHash: string, originalFileName: string): string | null {
        if (!fs.existsSync(mediaFolderPath)) {
            return null;
        }

        const cache = this._updateHashCache(mediaFolderPath);

        const cachedEntry = cache.get(originalFileName);
        if (cachedEntry && cachedEntry.hash === targetHash) {
            return originalFileName;
        }

        for (const [fileName, entry] of cache.entries()) {
            if (entry.hash === targetHash) {
                return fileName;
            }
        }

        return null;
    }

    private _formatImagePath(absolutePath: string, kanbanDir: string): string {
        const pathMode = configService.getPathGenerationMode();
        if (pathMode === 'absolute') {
            return absolutePath;
        }
        const relativePath = path.relative(kanbanDir, absolutePath);
        return `./${relativePath.replace(/\\/g, '/')}`;
    }

    private _generateUniqueImageFilename(mediaFolderPath: string, originalFileName: string, fileBuffer: Buffer): string {
        const extension = path.extname(originalFileName) || '.png';
        const baseName = path.basename(originalFileName, extension);
        const hash = this._generateHash(fileBuffer);

        let candidateFilename = `${baseName}-${hash}${extension}`;
        let candidatePath = path.join(mediaFolderPath, candidateFilename);

        if (fs.existsSync(candidatePath)) {
            const existingBuffer = fs.readFileSync(candidatePath);
            const existingHash = this._generateHash(existingBuffer);

            if (existingHash === hash) {
                return candidateFilename;
            }

            const timestamp = Date.now();
            candidateFilename = `${baseName}-${hash}-${timestamp}${extension}`;
        }

        return candidateFilename;
    }

    private _generateUniqueFilename(targetDir: string, originalFileName: string): string {
        const ext = path.extname(originalFileName);
        const baseName = path.basename(originalFileName, ext);
        let targetFileName = originalFileName;
        let counter = 1;

        while (fs.existsSync(path.join(targetDir, targetFileName))) {
            targetFileName = `${baseName}_${counter}${ext}`;
            counter++;
        }

        return targetFileName;
    }

    private _sendLinkMessage(
        sourcePath: string,
        originalFileName: string,
        dropPosition: { x: number; y: number },
        directory: string,
        isImage: boolean,
        context: CommandContext
    ): void {
        const formattedPath = isImage
            ? this._formatImagePath(sourcePath, directory)
            : context.fileManager.generateConfiguredPath(sourcePath);

        const panel = context.getWebviewPanel();
        if (panel && (panel as any)._panel) {
            if (isImage) {
                (panel as any)._panel.webview.postMessage({
                    type: 'droppedImageSaved',
                    success: true,
                    relativePath: formattedPath,
                    originalFileName: originalFileName,
                    dropPosition: dropPosition,
                    wasLinked: true
                });
            } else {
                (panel as any)._panel.webview.postMessage({
                    type: 'fileUriDropped',
                    success: true,
                    filePath: formattedPath,
                    originalFileName: originalFileName,
                    dropPosition: dropPosition,
                    wasLinked: true
                });
            }
        }
    }

    private async _copyToMediaFolder(
        sourcePath: string | null,
        fileData: string | null,
        originalFileName: string,
        dropPosition: { x: number; y: number },
        directory: string,
        baseFileName: string,
        isImage: boolean,
        context: CommandContext
    ): Promise<void> {
        if (sourcePath && !fs.existsSync(sourcePath)) {
            throw new Error(`Source file not found: ${sourcePath}`);
        }

        if (!sourcePath && !fileData) {
            throw new Error('No source path or file data provided');
        }

        const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);

        let buffer: Buffer;
        if (fileData) {
            const base64Only = isImage && fileData.includes(',') ? fileData.split(',')[1] : fileData;
            buffer = Buffer.from(base64Only, 'base64');
        } else if (sourcePath) {
            buffer = fs.readFileSync(sourcePath);
        } else {
            throw new Error('No source path or file data provided');
        }

        let targetFileName: string;
        if (isImage) {
            targetFileName = this._generateUniqueImageFilename(mediaFolderPath, originalFileName, buffer);
        } else {
            targetFileName = this._generateUniqueFilename(mediaFolderPath, originalFileName);
        }

        const targetPath = path.join(mediaFolderPath, targetFileName);

        if (!isImage || !fs.existsSync(targetPath)) {
            fs.writeFileSync(targetPath, buffer);
        }

        const formattedPath = isImage
            ? this._formatImagePath(targetPath, directory)
            : context.fileManager.generateConfiguredPath(targetPath);

        const panel = context.getWebviewPanel();
        if (panel && (panel as any)._panel) {
            if (isImage) {
                (panel as any)._panel.webview.postMessage({
                    type: 'droppedImageSaved',
                    success: true,
                    relativePath: formattedPath,
                    originalFileName: originalFileName,
                    dropPosition: dropPosition,
                    wasCopied: sourcePath ? true : undefined
                });
            } else {
                const messageType = fileData ? 'fileContentsDropped' : 'fileUriDropped';
                (panel as any)._panel.webview.postMessage({
                    type: messageType,
                    success: true,
                    filePath: formattedPath,
                    originalFileName: originalFileName,
                    dropPosition: dropPosition,
                    wasCopied: sourcePath ? true : undefined
                });
            }
        }
    }

    private _sendFileDropError(error: string, dropPosition: { x: number; y: number }, isImage: boolean, isFileObject: boolean, context: CommandContext): void {
        const panel = context.getWebviewPanel();
        if (panel && (panel as any)._panel) {
            if (isImage) {
                (panel as any)._panel.webview.postMessage({
                    type: 'droppedImageSaved',
                    success: false,
                    error: error,
                    dropPosition: dropPosition
                });
            } else {
                const messageType = isFileObject ? 'fileContentsDropped' : 'fileUriDropped';
                (panel as any)._panel.webview.postMessage({
                    type: messageType,
                    success: false,
                    error: error,
                    dropPosition: dropPosition
                });
            }
        }
    }
}
