import * as vscode from 'vscode';
import * as path from 'path';
import { FileTypeUtils, toForwardSlashes, selectMarkdownFile, safeDecodeURIComponent } from './utils';
import * as fs from 'fs';
import { configService } from './services/ConfigurationService';
import { HandleFileDropMessage, HandleUriDropMessage, EditorDropPosition } from './core/bridge/MessageTypes';
import { showError, showInfo } from './services/NotificationService';

export interface FileInfo {
    fileName: string;
    filePath: string;
    documentPath: string;
    isLocked: boolean;
}

/**
 * Active editor context for file drops
 */
export interface ActiveEditorContext {
    taskId?: string;
    columnId?: string;
    position?: string;
}

export interface FileDropInfo {
    fileName: string;
    relativePath: string;
    isImage: boolean;
    activeEditor?: ActiveEditorContext;
    dropPosition?: EditorDropPosition;
}

export interface FileResolutionResult {
    resolvedPath: string;
    exists: boolean;
    isAbsolute: boolean;
    attemptedPaths: string[]; // Track all attempted paths for debugging
}

/**
 * Include context for file path resolution
 */
export interface IncludeContextForResolution {
    includeDir?: string;
    columnId?: string;
    taskId?: string;
    filePath?: string;
    includeFilePath?: string;  // Used by task.includeContext from IncludeLoadingProcessor
}

export class FileManager {
    private _document?: vscode.TextDocument;
    private _filePath?: string; // Track file path independently of document
    private _isFileLocked: boolean = false;
    private _webview: vscode.Webview;
    private _extensionUri: vscode.Uri;
    private _getMainFilePath?: () => string | undefined;

    constructor(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
        getMainFilePath?: () => string | undefined
    ) {
        this._webview = webview;
        this._extensionUri = extensionUri;
        this._getMainFilePath = getMainFilePath;
    }

    public getExtensionUri(): vscode.Uri {
        return this._extensionUri;
    }

    public getWebview(): vscode.Webview {
        return this._webview;
    }

    public setDocument(document: vscode.TextDocument | undefined) {
        this._document = document;
        // Remember the file path even when document is cleared
        if (document) {
            this._filePath = document.fileName;
        }
        // Note: Don't clear _filePath when document is undefined - keep it for reference
    }

    public clearDocument() {
        // Clear document reference but keep file path for display
        this._document = undefined;
    }

    public getDocument(): vscode.TextDocument | undefined {
        return this._document;
    }

    public getFilePath(): string | undefined {
        const registryPath = this._getMainFilePath?.();
        if (registryPath) {
            return registryPath;
        }
        if (this._getMainFilePath) {
            return undefined;
        }
        // Return the preserved file path, which persists even when document is closed
        return this._filePath;
    }

    public isFileLocked(): boolean {
        return this._isFileLocked;
    }

    public toggleFileLock(): void {
        this._isFileLocked = !this._isFileLocked;
        this.sendFileInfo();
        const status = this._isFileLocked ? 'locked' : 'unlocked';
        showInfo(`Kanban file ${status}`);
    }

    public getCurrentDocumentUri(): vscode.Uri | undefined {
        return this._document?.uri;
    }

    public sendFileInfo() {
        const mainFilePath = this.getFilePath();
        const fallbackPath = this._getMainFilePath ? undefined : (this._document?.fileName || this._filePath);
        const resolvedPath = mainFilePath || fallbackPath || '';
        const fileInfo: FileInfo = {
            fileName: resolvedPath ? path.basename(resolvedPath) : 'No file loaded',
            filePath: resolvedPath,
            documentPath: resolvedPath,
            isLocked: this._isFileLocked
        };

        // Send immediately - no delay needed for message posting
        this._webview.postMessage({
            type: 'updateFileInfo',
            fileInfo: fileInfo
        });
    }

    public async selectFile(): Promise<vscode.TextDocument | null> {
        const fileUris = await selectMarkdownFile();
        if (fileUris && fileUris.length > 0) {
            const targetUri = fileUris[0];
            try {
                const document = await vscode.workspace.openTextDocument(targetUri);
                return document;
            } catch (error) {
                showError(`Failed to open file: ${error}`);
                return null;
            }
        }
        return null;
    }

    /**
     * Enhanced relative path generation that uses workspace folder names when appropriate
     * @param filePath - The absolute path to convert to relative
     * @param customBaseDir - Optional custom base directory (e.g., include file's directory)
     */
    private getRelativePath(filePath: string, customBaseDir?: string): string {
        // Use custom base directory if provided (e.g., for include files)
        let documentDir: string | undefined = customBaseDir;

        // Otherwise, get document directory from document or registry
        if (!documentDir) {
            if (this._document) {
                documentDir = path.dirname(this._document.uri.fsPath);
            } else {
                // Fall back to registry path when document is closed
                const registryPath = this._getMainFilePath?.();
                if (registryPath) {
                    documentDir = path.dirname(registryPath);
                }
            }
        }

        if (!documentDir) {
            // No document or registry path available - return absolute
            return filePath;
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        // First, try to find if file is in a workspace folder
        if (workspaceFolders && workspaceFolders.length > 0) {
            for (const folder of workspaceFolders) {
                const folderPath = folder.uri.fsPath;
                const folderName = path.basename(folderPath);
                
                // Check if file is within this workspace folder
                if (filePath.startsWith(folderPath + path.sep) || filePath.startsWith(folderPath + '/')) {
                    // Check if document is also in the same workspace folder
                    const documentInSameWorkspace = documentDir.startsWith(folderPath + path.sep) || 
                                                  documentDir.startsWith(folderPath + '/');
                    
                    if (documentInSameWorkspace) {
                        // Both in same workspace - use traditional relative path
                        const relativePath = path.relative(documentDir, filePath);
                        return toForwardSlashes(relativePath);
                    } else {
                        // File in workspace, document elsewhere - use workspace-relative path
                        const relativeToWorkspace = path.relative(folderPath, filePath);
                        return toForwardSlashes(folderName + '/' + relativeToWorkspace);
                    }
                }
            }
            
            // Check if document is in a workspace folder and file is in a different workspace
            for (const docFolder of workspaceFolders) {
                const docFolderPath = docFolder.uri.fsPath;
                if (documentDir.startsWith(docFolderPath + path.sep) || 
                    documentDir.startsWith(docFolderPath + '/')) {
                    
                    // Document is in a workspace, check if file is in a different workspace
                    for (const fileFolder of workspaceFolders) {
                        const fileFolderPath = fileFolder.uri.fsPath;
                        const fileFolderName = path.basename(fileFolderPath);
                        
                        if (fileFolder !== docFolder && 
                            (filePath.startsWith(fileFolderPath + path.sep) || 
                             filePath.startsWith(fileFolderPath + '/'))) {
                            // File in different workspace - use workspace-relative path
                            const relativeToWorkspace = path.relative(fileFolderPath, filePath);
                            return toForwardSlashes(fileFolderName + '/' + relativeToWorkspace);
                        }
                    }
                    break;
                }
            }
        }
        
        // Fall back to traditional relative path
        const relativePath = path.relative(documentDir, filePath);
        return toForwardSlashes(relativePath);
    }

    /**
     * Generate a file path based on user configuration (relative or absolute)
     * @param filePath - The absolute path to convert
     * @param customBaseDir - Optional custom base directory (e.g., include file's directory)
     */
    public generateConfiguredPath(filePath: string, customBaseDir?: string): string {
        const pathMode = configService.getPathGenerationMode();

        if (pathMode === 'absolute') {
            return filePath;
        } else {
            // Use custom base directory if provided, otherwise use document/registry path
            return this.getRelativePath(filePath, customBaseDir);
        }
    }

    private isImageFile(fileName: string): boolean {
        return FileTypeUtils.isImageFile(fileName);
    }

    public async handleFileDrop(message: HandleFileDropMessage) {
        try {
            const { fileName, dropPosition, activeEditor } = message;
            const isImage = this.isImageFile(fileName);
            // Note: Simple file drop only provides fileName, not full path
            // so we can only generate relative paths in this case
            const relativePath = `./${fileName}`;
            
            const fileInfo: FileDropInfo = {
                fileName,
                relativePath,
                isImage,
                activeEditor,
                dropPosition
            };
            
            this._webview.postMessage({
                type: 'insertFileLink',
                fileInfo: fileInfo
            });
            
        } catch (error) {
            showError(`Failed to handle file drop: ${error}`);
        }
    }

    /**
     * Enhanced drag & drop handling with workspace-relative paths
     */
    public async handleUriDrop(message: HandleUriDropMessage) {
        try {
            const { uris, dropPosition, activeEditor } = message;
            
            for (const uriString of uris) {
                let uri: vscode.Uri;
                try {
                    if (uriString.startsWith('file://')) {
                        uri = vscode.Uri.parse(uriString);
                    } else {
                        uri = vscode.Uri.file(uriString);
                    }
                } catch (parseError) {
                    continue;
                }
                
                const fileName = path.basename(uri.fsPath);
                const isImage = this.isImageFile(fileName);
                
                // Use configured path generation (relative or absolute based on user setting)
                const relativePath = this.generateConfiguredPath(uri.fsPath);
                
                const fileInfo: FileDropInfo = {
                    fileName,
                    relativePath,
                    isImage,
                    activeEditor,
                    dropPosition
                };
                
                this._webview.postMessage({
                    type: 'insertFileLink',
                    fileInfo: fileInfo
                });
                
                break;
            }
            
        } catch (error) {
            showError(`Failed to handle URI drop: ${error}`);
        }
    }

    /**
     * Enhanced file path resolution that handles workspace-relative paths
     */
    public async resolveFilePath(href: string, includeContext?: IncludeContextForResolution): Promise<FileResolutionResult | null> {
        const attemptedPaths: string[] = [];

        // Decode URL-encoded paths (e.g., %20 -> space)
        const decodedHref = safeDecodeURIComponent(href);

        const isAbsolute = path.isAbsolute(decodedHref) ||
                        decodedHref.match(/^[a-zA-Z]:/) ||
                        decodedHref.startsWith('/') ||
                        decodedHref.startsWith('\\');

        if (isAbsolute) {
            attemptedPaths.push(decodedHref);
            try {
                const exists = fs.existsSync(decodedHref);
                return {
                    resolvedPath: decodedHref,
                    exists,
                    isAbsolute: true,
                    attemptedPaths
                };
            } catch (error) {
                return {
                    resolvedPath: decodedHref,
                    exists: false,
                    isAbsolute: true,
                    attemptedPaths
                };
            }
        }

        const candidates: string[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        // If we have includeContext, try resolving relative to the include file's directory first
        if (includeContext && includeContext.includeDir) {
            const candidate = path.resolve(includeContext.includeDir, decodedHref);
            candidates.push(candidate);
            attemptedPaths.push(candidate);
        }

        // Check if path starts with a workspace folder name
        let isWorkspaceRelative = false;
        if (workspaceFolders && workspaceFolders.length > 0) {
            for (const folder of workspaceFolders) {
                const folderName = path.basename(folder.uri.fsPath);
                if (decodedHref.startsWith(folderName + '/') || decodedHref.startsWith(folderName + '\\')) {
                    // This is a workspace-relative path
                    isWorkspaceRelative = true;
                    const relativePath = decodedHref.substring(folderName.length + 1);
                    const candidate = path.resolve(folder.uri.fsPath, relativePath);
                    candidates.push(candidate);
                    attemptedPaths.push(candidate);
                    break;
                }
            }
        }

        // If not workspace-relative, use standard resolution strategy
        if (!isWorkspaceRelative) {
            // First: Check relative to current document directory
            // Use _filePath as fallback if document is not available (e.g., during webview message handling)
            const documentPath = this.getFilePath();

            if (documentPath) {
                const currentDir = path.dirname(documentPath);
                const candidate = path.resolve(currentDir, decodedHref);
                candidates.push(candidate);
                attemptedPaths.push(candidate);
            }

            // Second: Check in all workspace folders
            if (workspaceFolders) {
                for (const folder of workspaceFolders) {
                    const candidate = path.resolve(folder.uri.fsPath, decodedHref);
                    candidates.push(candidate);
                    attemptedPaths.push(candidate);
                }
            }
        }

        // Test each candidate
        for (const candidatePath of candidates) {
            try {
                if (fs.existsSync(candidatePath)) {
                    return { 
                        resolvedPath: candidatePath, 
                        exists: true, 
                        isAbsolute: false,
                        attemptedPaths 
                    };
                }
            } catch (error) {
                continue;
            }
        }

        // No file found
        return candidates.length > 0 
            ? { 
                resolvedPath: candidates[0], 
                exists: false, 
                isAbsolute: false,
                attemptedPaths 
            }
            : null;
    }

    /**
     * Resolve an image path to a webview URI for display
     * This does NOT modify content, just returns the display URI
     */
    public async resolveImageForDisplay(imagePath: string): Promise<string> {
        if (imagePath.startsWith('vscode-webview://') ||
            imagePath.startsWith('data:') ||
            imagePath.startsWith('http://') ||
            imagePath.startsWith('https://')) {
            return imagePath;
        }

        const resolution = await this.resolveFilePath(imagePath);

        if (resolution && resolution.exists) {
            try {
                const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.bmp', '.webp'];
                const ext = path.extname(resolution.resolvedPath).toLowerCase();

                if (imageExtensions.includes(ext)) {
                    const imageUri = vscode.Uri.file(resolution.resolvedPath);
                    const webviewUri = this._webview.asWebviewUri(imageUri);
                    let uriString = webviewUri.toString();

                    // Fix URL encoding: ensure + is encoded as %2B, not treated as space
                    // VSCode's asWebviewUri may not properly encode + in filenames
                    uriString = uriString.replace(/\+/g, '%2B');

                    return uriString;
                }
            } catch (error) {
                // Silently handle image resolution failure
            }
        } else if (resolution && !resolution.exists) {
            // Log failed image resolution attempts
            console.warn(`Image not found: ${imagePath}`);
            console.warn('Attempted paths:', resolution.attemptedPaths);
        }

        return imagePath;
    }
}
