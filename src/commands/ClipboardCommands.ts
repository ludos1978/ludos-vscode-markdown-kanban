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

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage, MessageHandler } from './interfaces';
import {
    RequestFileDropDialogueMessage,
    ExecuteFileDropCopyMessage,
    ExecuteFileDropLinkMessage,
    LinkExistingFileMessage
} from '../core/bridge/MessageTypes';
import { ConfigurationService } from '../services/ConfigurationService';
import { safeFileUri } from '../utils/uriUtils';
import { getErrorMessage, toForwardSlashes } from '../utils/stringUtils';
import { showError, showWarning, showInfo } from '../services/NotificationService';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const configService = ConfigurationService.getInstance();

/**
 * Clipboard Commands Handler
 *
 * Processes clipboard and image-related messages from the webview.
 * Uses SwitchBasedCommand for automatic dispatch and error handling.
 */
export class ClipboardCommands extends SwitchBasedCommand {
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
            'openMediaFolder',
            'createDiagramFile'
        ],
        priority: 100
    };

    private readonly PARTIAL_HASH_SIZE = 1024 * 1024; // 1MB threshold for partial hashing

    /**
     * Handler mapping for message dispatch
     * Uses type assertions for message-specific properties
     */
    protected handlers: Record<string, MessageHandler> = {
        'saveClipboardImage': async (msg, ctx) => {
            const m = msg as any;
            await this.handleSaveClipboardImage(m.imageData, m.imagePath, m.mediaFolderPath, m.dropPosition, m.imageFileName ?? '', m.mediaFolderName ?? '', ctx);
            return this.success();
        },
        'saveClipboardImageWithPath': async (msg, ctx) => {
            const m = msg as any;
            await this.handleSaveClipboardImageWithPath(m.imageData, m.imageType, m.dropPosition, ctx, m.md5Hash);
            return this.success();
        },
        'pasteImageIntoField': async (msg, ctx) => {
            const m = msg as any;
            await this.handlePasteImageIntoField(m.imageData, m.imageType, m.md5Hash ?? '', m.cursorPosition ?? 0, ctx);
            return this.success();
        },
        'saveDroppedImageFromContents': async (msg, ctx) => {
            const m = msg as any;
            await this.handleAnyFileDrop(null, m.imageData, m.originalFileName, m.dropPosition, true, ctx);
            return this.success();
        },
        'copyImageToMedia': async (msg, ctx) => {
            const m = msg as any;
            await this.handleAnyFileDrop(m.sourcePath, null, m.originalFileName, m.dropPosition, true, ctx);
            return this.success();
        },
        'handleFileUriDrop': async (msg, ctx) => {
            const m = msg as any;
            await this.handleAnyFileDrop(m.sourcePath, null, m.originalFileName, m.dropPosition, false, ctx);
            return this.success();
        },
        'saveDroppedFileFromContents': async (msg, ctx) => {
            const m = msg as any;
            await this.handleAnyFileDrop(null, m.fileData, m.originalFileName, m.dropPosition, false, ctx);
            return this.success();
        },
        'requestFileDropDialogue': async (msg, ctx) => {
            await this.handleRequestFileDropDialogue(msg as RequestFileDropDialogueMessage, ctx);
            return this.success();
        },
        'executeFileDropCopy': async (msg, ctx) => {
            await this.handleExecuteFileDropCopy(msg as ExecuteFileDropCopyMessage, ctx);
            return this.success();
        },
        'executeFileDropLink': async (msg, ctx) => {
            await this.handleExecuteFileDropLink(msg as ExecuteFileDropLinkMessage, ctx);
            return this.success();
        },
        'linkExistingFile': async (msg, ctx) => {
            await this.handleLinkExistingFile(msg as LinkExistingFileMessage, ctx);
            return this.success();
        },
        'openMediaFolder': async (_msg, ctx) => {
            await this.handleOpenMediaFolder(ctx);
            return this.success();
        },
        'createDiagramFile': async (msg, ctx) => {
            const m = msg as any;
            await this.handleCreateDiagramFile(m.diagramType, m.columnId, m.insertionIndex, m.dropPosition, m.sourceFilePath, ctx);
            return this.success();
        }
    };

    // ============= CLIPBOARD IMAGE HANDLERS =============

    private async handleSaveClipboardImage(
        imageData: string,
        imagePath: string,
        mediaFolderPath: string,
        dropPosition: { x: number; y: number },
        imageFileName: string,
        mediaFolderName: string,
        _context: CommandContext
    ): Promise<void> {
        try {
            if (!fs.existsSync(mediaFolderPath)) {
                fs.mkdirSync(mediaFolderPath, { recursive: true });
            }

            const buffer = Buffer.from(imageData, 'base64');
            fs.writeFileSync(imagePath, buffer);

            this.postMessage({ type: 'clipboardImageSaved',
                success: true,
                imagePath: imagePath,
                relativePath: `./${mediaFolderName}/${imageFileName}`,
                dropPosition: dropPosition
            });
        } catch (error) {
            console.error('[ClipboardCommands] Error saving clipboard image:', error);
            this.postMessage({ type: 'clipboardImageSaved',
                success: false,
                error: getErrorMessage(error),
                dropPosition: dropPosition
            });
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
            const { directory, baseFileName } = this._getCurrentFilePaths(context);

            const extension = imageType.split('/')[1] || 'png';
            const imageFileName = md5Hash ? `${md5Hash}.${extension}` : `clipboard-image-${Date.now()}.${extension}`;

            const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);
            const imagePath = path.join(mediaFolderPath, imageFileName);
            const mediaFolderName = `${baseFileName}-MEDIA`;

            const base64Only = this._extractBase64Data(imageData);
            const buffer = Buffer.from(base64Only, 'base64');
            fs.writeFileSync(imagePath, buffer);

            this.postMessage({ type: 'clipboardImageSaved',
                success: true,
                imagePath: imagePath,
                relativePath: `./${mediaFolderName}/${imageFileName}`,
                dropPosition: dropPosition
            });
        } catch (error) {
            console.error('[ClipboardCommands] Error saving clipboard image with path:', error);
            this.postMessage({ type: 'clipboardImageSaved',
                success: false,
                error: getErrorMessage(error),
                dropPosition: dropPosition
            });
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
            const { directory, baseFileName } = this._getCurrentFilePaths(context);

            const extension = imageType.split('/')[1] || 'png';
            const imageFileName = `${md5Hash}.${extension}`;

            const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);
            const imagePath = path.join(mediaFolderPath, imageFileName);
            const mediaFolderName = `${baseFileName}-MEDIA`;

            const base64Only = this._extractBase64Data(imageData);
            const buffer = Buffer.from(base64Only, 'base64');
            fs.writeFileSync(imagePath, buffer);

            this.postMessage({ type: 'imagePastedIntoField',
                success: true,
                imagePath: imagePath,
                relativePath: `./${mediaFolderName}/${imageFileName}`,
                cursorPosition: cursorPosition
            });
        } catch (error) {
            console.error('[ClipboardCommands] Error pasting image into field:', error);
            this.postMessage({ type: 'imagePastedIntoField',
                success: false,
                error: getErrorMessage(error),
                cursorPosition: cursorPosition
            });
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
            this._sendFileDropError(getErrorMessage(error), dropPosition, isImage, fileData !== null, context);
        }
    }

    private async handleRequestFileDropDialogue(message: RequestFileDropDialogueMessage, context: CommandContext): Promise<void> {
        const { dropId, fileName, isImage, hasSourcePath, sourcePath, partialHashData, dropPosition } = message;
        let fileSize = message.fileSize;

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

            this.postMessage({ type: 'showFileDropDialogue',
                dropId: dropId,
                fileName: fileName,
                fileSize: fileSize,
                isImage: isImage,
                hasSourcePath: hasSourcePath,
                sourcePath: sourcePath,
                existingFile: existingFile,
                dropPosition: dropPosition
            });
        } catch (error) {
            console.error('[ClipboardCommands] Error in file drop dialogue:', error);
            this._sendFileDropError(getErrorMessage(error), dropPosition, isImage, !hasSourcePath, context);
        }
    }

    private async handleExecuteFileDropCopy(message: ExecuteFileDropCopyMessage, context: CommandContext): Promise<void> {
        const { sourcePath, fileName, isImage, dropPosition } = message;

        try {
            const { directory, baseFileName } = this._getCurrentFilePaths(context);
            await this._copyToMediaFolder(sourcePath, null, fileName, dropPosition, directory, baseFileName, isImage, context);
        } catch (error) {
            console.error('[ClipboardCommands] Error in file drop copy:', error);
            this._sendFileDropError(getErrorMessage(error), dropPosition, isImage, false, context);
        }
    }

    private async handleExecuteFileDropLink(message: ExecuteFileDropLinkMessage, context: CommandContext): Promise<void> {
        const { sourcePath, fileName, isImage, dropPosition } = message;

        try {
            const { directory } = this._getCurrentFilePaths(context);
            this._sendLinkMessage(sourcePath, fileName, dropPosition, directory, isImage, context);
        } catch (error) {
            console.error('[ClipboardCommands] Error in file drop link:', error);
            this._sendFileDropError(getErrorMessage(error), dropPosition, isImage, false, context);
        }
    }

    private async handleLinkExistingFile(message: LinkExistingFileMessage, context: CommandContext): Promise<void> {
        const { existingFile, fileName, isImage, dropPosition } = message;

        try {
            const { directory, baseFileName } = this._getCurrentFilePaths(context);
            const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);
            const existingFilePath = path.join(mediaFolderPath, existingFile);

            this._sendLinkMessage(existingFilePath, fileName, dropPosition, directory, isImage, context);
        } catch (error) {
            console.error('[ClipboardCommands] Error linking existing file:', error);
            this._sendFileDropError(getErrorMessage(error), dropPosition, isImage, true, context);
        }
    }

    private async handleOpenMediaFolder(context: CommandContext): Promise<void> {
        try {
            const { directory, baseFileName } = this._getCurrentFilePaths(context);
            const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);

            await vscode.commands.executeCommand('revealFileInOS', safeFileUri(mediaFolderPath, 'ClipboardCommands-revealMedia'));
        } catch (error) {
            console.error('[ClipboardCommands] Error opening media folder:', error);
            showError(`Failed to open media folder: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Handle creating a new diagram file (Excalidraw or Draw.io)
     * Shows input dialog for filename, creates the file in the appropriate media folder
     */
    private async handleCreateDiagramFile(
        diagramType: 'excalidraw' | 'drawio',
        columnId: string,
        insertionIndex: number,
        dropPosition: { x: number; y: number },
        sourceFilePath: string | null,
        context: CommandContext
    ): Promise<void> {
        try {
            // Determine the source file for media folder calculation
            let directory: string;
            let baseFileName: string;

            if (sourceFilePath) {
                // Use the include file's directory for media folder
                // sourceFilePath is relative to main file, need to resolve it
                const mainFilePath = context.fileManager.getFilePath();
                if (!mainFilePath) {
                    throw new Error('No main file path available');
                }
                const mainDir = path.dirname(mainFilePath);
                const resolvedSourcePath = path.resolve(mainDir, sourceFilePath);
                directory = path.dirname(resolvedSourcePath);
                baseFileName = path.basename(resolvedSourcePath).replace(/\.[^/.]+$/, '');
            } else {
                // Use main file's directory
                const paths = this._getCurrentFilePaths(context);
                directory = paths.directory;
                baseFileName = paths.baseFileName;
            }

            // Show input dialog for the diagram filename
            const diagramTypeLabel = diagramType === 'excalidraw' ? 'Excalidraw' : 'Draw.io';
            const defaultName = `diagram-${Date.now()}`;

            const fileName = await vscode.window.showInputBox({
                prompt: `Enter a name for the new ${diagramTypeLabel} diagram`,
                value: defaultName,
                placeHolder: 'diagram-name',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Please enter a filename';
                    }
                    // Check for invalid characters
                    if (/[<>:"/\\|?*]/.test(value)) {
                        return 'Filename contains invalid characters';
                    }
                    return null;
                }
            });

            if (!fileName) {
                // User cancelled
                return;
            }

            // Create the media folder path
            const mediaFolderPath = this._getMediaFolderPath(directory, baseFileName);
            const mediaFolderName = `${baseFileName}-MEDIA`;

            // Determine file extension and create appropriate template
            let fileExtension: string;
            let fileContent: string;

            if (diagramType === 'excalidraw') {
                fileExtension = '.excalidraw';
                // Empty Excalidraw JSON template
                fileContent = JSON.stringify({
                    type: 'excalidraw',
                    version: 2,
                    source: 'kanban-board',
                    elements: [],
                    appState: {
                        gridSize: null,
                        viewBackgroundColor: '#ffffff'
                    },
                    files: {}
                }, null, 2);
            } else {
                fileExtension = '.drawio';
                // Empty Draw.io XML template
                fileContent = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="kanban-board" modified="${new Date().toISOString()}" agent="kanban-board" version="1.0">
  <diagram id="diagram-1" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
            }

            // Create the full file path
            const sanitizedFileName = fileName.trim().replace(/[<>:"/\\|?*]/g, '-');
            const fullFileName = sanitizedFileName + fileExtension;
            const filePath = path.join(mediaFolderPath, fullFileName);

            // Check if file already exists
            if (fs.existsSync(filePath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File "${fullFileName}" already exists. Do you want to overwrite it?`,
                    'Overwrite',
                    'Cancel'
                );
                if (overwrite !== 'Overwrite') {
                    return;
                }
            }

            // Write the file
            fs.writeFileSync(filePath, fileContent, 'utf8');

            // Calculate relative path for the markdown link
            const relativePath = `./${mediaFolderName}/${fullFileName}`;

            // Send success message to frontend to create the task
            this.postMessage({
                type: 'diagramFileCreated',
                success: true,
                diagramType: diagramType,
                filePath: filePath,
                relativePath: relativePath,
                fileName: fullFileName,
                columnId: columnId,
                insertionIndex: insertionIndex,
                dropPosition: dropPosition
            });

            // Show success message
            showInfo(`Created ${diagramTypeLabel} diagram: ${fullFileName}`);

        } catch (error) {
            console.error('[ClipboardCommands] Error creating diagram file:', error);
            this.postMessage({
                type: 'diagramFileCreated',
                success: false,
                error: getErrorMessage(error),
                diagramType: diagramType,
                dropPosition: dropPosition
            });
            showError(`Failed to create diagram: ${getErrorMessage(error)}`);
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

    /**
     * Extract raw base64 data from a data URL or plain base64 string
     * Handles both "data:image/png;base64,xxxxx" and plain "xxxxx" formats
     */
    private _extractBase64Data(data: string): string {
        return data.includes(',') ? data.split(',')[1] : data;
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
        return `./${toForwardSlashes(relativePath)}`;
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

        if (isImage) {
            this.postMessage({ type: 'droppedImageSaved',
                success: true,
                relativePath: formattedPath,
                originalFileName: originalFileName,
                dropPosition: dropPosition,
                wasLinked: true
            });
        } else {
            this.postMessage({ type: 'fileUriDropped',
                success: true,
                filePath: formattedPath,
                originalFileName: originalFileName,
                dropPosition: dropPosition,
                wasLinked: true
            });
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
            // For images, extract base64 from data URL format; for other files, use raw data
            const base64Only = isImage ? this._extractBase64Data(fileData) : fileData;
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

        if (isImage) {
            this.postMessage({ type: 'droppedImageSaved',
                success: true,
                relativePath: formattedPath,
                originalFileName: originalFileName,
                dropPosition: dropPosition,
                wasCopied: sourcePath ? true : undefined
            });
        } else {
            const messageType = fileData ? 'fileContentsDropped' : 'fileUriDropped';
            this.postMessage({ type: messageType,
                success: true,
                filePath: formattedPath,
                originalFileName: originalFileName,
                dropPosition: dropPosition,
                wasCopied: sourcePath ? true : undefined
            });
        }
    }

    private _sendFileDropError(error: string, dropPosition: { x: number; y: number }, isImage: boolean, isFileObject: boolean, _context: CommandContext): void {
        if (isImage) {
            this.postMessage({ type: 'droppedImageSaved',
                success: false,
                error: error,
                dropPosition: dropPosition
            });
        } else {
            const messageType = isFileObject ? 'fileContentsDropped' : 'fileUriDropped';
            this.postMessage({ type: messageType,
                success: false,
                error: error,
                dropPosition: dropPosition
            });
        }
    }
}
