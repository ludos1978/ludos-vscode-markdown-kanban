import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileManager, IncludeContextForResolution } from '../fileManager';
import { FileSearchService } from '../fileSearchService';
import { configService } from './ConfigurationService';
import { safeFileUri } from '../utils/uriUtils';
import { PanelContext } from '../panel/PanelContext';
import {
    DRAWIO_EXTENSIONS,
    EXCALIDRAW_EXTENSIONS,
    TEXT_FILE_EXTENSIONS,
    isDrawioFile,
    isExcalidrawFile,
    hasExtension,
    DOTTED_EXTENSIONS
} from '../constants/FileExtensions';
import { showError, showWarning, showInfo } from './NotificationService';
import { linkReplacementService, ReplacementDependencies } from './LinkReplacementService';

export class LinkHandler {
    private _fileManager: FileManager;
    private _fileSearchService: FileSearchService;
    private _panelContext: PanelContext;
    private _replacementDeps?: ReplacementDependencies;

    /**
     * Constructor
     *
     * Uses LinkReplacementService for path replacement operations.
     */
    constructor(fileManager: FileManager, panelContext: PanelContext) {
        this._fileManager = fileManager;
        this._panelContext = panelContext;
        // Create FileSearchService and set the webview for modal display
        this._fileSearchService = new FileSearchService();
        this._fileSearchService.setWebview(this._fileManager.getWebview());
    }

    /**
     * Set dependencies for link replacement operations.
     * Must be called after panel initialization.
     */
    public setReplacementDependencies(deps: ReplacementDependencies): void {
        this._replacementDeps = deps;
    }

    /**
     * Set tracked files for the file search service (main + includes)
     * Must be called before handleFileLink for proper source file display
     */
    public setTrackedFiles(files: { path: string; relativePath: string; content: string }[]): void {
        this._fileSearchService.setTrackedFiles(files);
    }

    /**
     * Resolve base directory for path operations.
     * Priority: include context directory > main file directory
     */
    private resolveBaseDir(includeContext?: IncludeContextForResolution): string | undefined {
        if (includeContext?.includeDir) {
            return includeContext.includeDir;
        }
        if (includeContext?.filePath) {
            return path.dirname(includeContext.filePath);
        }
        const mainFile = this._replacementDeps?.fileRegistry.getMainFile();
        if (mainFile) {
            return path.dirname(mainFile.getPath());
        }
        return undefined;
    }

    /**
     * Resolve source file path for display purposes.
     * Priority: include file path > main file path
     */
    private resolveSourceFile(includeContext?: IncludeContextForResolution): string | undefined {
        return includeContext?.includeFilePath
            || includeContext?.filePath
            || this._replacementDeps?.fileRegistry.getMainFile()?.getPath();
    }

    /**
     * Try to open a file externally, with error handling.
     * @returns true if opened successfully, false otherwise
     */
    private async tryOpenExternal(resolvedPath: string, fileType: string): Promise<boolean> {
        try {
            await vscode.env.openExternal(safeFileUri(resolvedPath, 'linkHandler'));
            showInfo(`Opened externally: ${path.basename(resolvedPath)}`);
            return true;
        } catch (error) {
            showError(`Failed to open ${fileType}: ${resolvedPath}`);
            return false;
        }
    }

    /**
     * Find an existing document by path (already open in VS Code).
     */
    private findExistingDocument(resolvedPath: string): vscode.TextDocument | undefined {
        const normalizedPath = path.resolve(resolvedPath);
        return vscode.workspace.textDocuments.find(doc => {
            const docPath = path.resolve(doc.uri.fsPath);
            return docPath === normalizedPath;
        });
    }

    /**
     * Enhanced file link handler with workspace-relative path support
     */
    public async handleFileLink(href: string, taskId?: string, columnId?: string, linkIndex?: number, includeContext?: IncludeContextForResolution) {
        console.log('[LinkHandler.handleFileLink] Received context:', JSON.stringify({ taskId, columnId, linkIndex, hasIncludeContext: !!includeContext }));
        try {
            if (href.startsWith('file://')) {
                href = vscode.Uri.parse(href).fsPath;
            }

            if (href.startsWith('vscode-webview://')) {
                return;
            }

            const resolution = await this._fileManager.resolveFilePath(href, includeContext);

            if (!resolution) {
                showError(`Could not resolve file path: ${href}`);
                return;
            }

            const { resolvedPath, exists, isAbsolute, attemptedPaths } = resolution;

            if (!exists) {
                // Unified behavior: Open an incremental QuickPick and stream results
                const baseDir = this.resolveBaseDir(includeContext);
                const sourceFile = this.resolveSourceFile(includeContext);
                console.log('[LinkHandler.handleFileLink] File not found - showing search', {
                    href,
                    hasIncludeContext: !!includeContext,
                    sourceFile,
                    baseDir
                });
                const result = await this._fileSearchService.pickReplacementForBrokenLink(href, baseDir, {
                    sourceFile
                });
                if (result) {
                    await this.applyLinkReplacement(href, result.uri, taskId, columnId, linkIndex, includeContext, result.pathFormat);
                    return;
                }

                // Original error handling (unchanged)
                const workspaceFolders = vscode.workspace.workspaceFolders;
                let contextInfo = '';

                if (workspaceFolders && workspaceFolders.length > 0) {
                    const folderNames = workspaceFolders.map(f => path.basename(f.uri.fsPath));

                    const startsWithWorkspaceFolder = folderNames.some(name =>
                        href.startsWith(name + '/') || href.startsWith(name + '\\')
                    );

                    if (startsWithWorkspaceFolder) {
                        contextInfo = `\n\nNote: This appears to be a workspace-relative path. Available workspace folders: ${folderNames.join(', ')}`;
                    } else {
                        contextInfo = `\n\nTip: For files in workspace folders, use paths like: ${folderNames[0]}/path/to/file.ext`;
                    }
                }

                const pathsList = attemptedPaths.map((p, i) => `  ${i + 1}. ${p}`).join('\n');

                if (isAbsolute) {
                    showWarning(
                        `File not found: ${resolvedPath}\n\nAttempted path:\n${pathsList}${contextInfo}`
                    );
                } else {
                    showWarning(
                        `File not found: ${href}\n\nSearched in the following locations:\n${pathsList}${contextInfo}`
                    );
                }

                console.warn(`[LinkHandler] File not found: ${href} (tried ${attemptedPaths.length} paths)`);
                return;
            }

            // Rest of the method remains unchanged...
            try {
                const stats = fs.statSync(resolvedPath);

                if (stats.isDirectory()) {
                    vscode.commands.executeCommand('revealFileInOS', safeFileUri(resolvedPath, 'linkHandler'));
                    return;
                }
            } catch (error) {
                showError(`Error accessing file: ${resolvedPath}`);
                return;
            }

            const ext = path.extname(resolvedPath).toLowerCase();
            const basename = path.basename(resolvedPath).toLowerCase();

            // Special handling for diagram files (draw.io, excalidraw)
            // Try to open in VS Code (will use appropriate extension if installed)
            const isDiagramFile = isDrawioFile(resolvedPath) || isExcalidrawFile(resolvedPath);

            if (isDiagramFile) {
                try {
                    // Try to open with VS Code's default handler
                    // If draw.io or excalidraw extension is installed, it will use that
                    // Otherwise, VS Code will ask which editor to use
                    const fileUri = safeFileUri(resolvedPath, 'linkHandler');
                    await vscode.commands.executeCommand('vscode.open', fileUri);

                    const diagramType = isDrawioFile(resolvedPath) ? 'draw.io' : 'Excalidraw';
                    showInfo(
                        `Opened ${diagramType} diagram: ${path.basename(resolvedPath)}`
                    );
                    return;
                } catch (error) {
                    console.warn(`Could not open diagram in VS Code, trying external: ${resolvedPath}`, error);
                    await this.tryOpenExternal(resolvedPath, 'diagram file');
                    return;
                }
            }

            // Open images in VS Code first (image preview), then fall back to system default
            const isImageFile = hasExtension(resolvedPath, DOTTED_EXTENSIONS.image);
            if (isImageFile) {
                try {
                    const fileUri = safeFileUri(resolvedPath, 'linkHandler');
                    await vscode.commands.executeCommand('vscode.open', fileUri);
                    showInfo(
                        `Opened image: ${path.basename(resolvedPath)}`
                    );
                    return;
                } catch (error) {
                    console.warn(`Could not open image in VS Code, trying external: ${resolvedPath}`, error);
                    await this.tryOpenExternal(resolvedPath, 'image file');
                    return;
                }
            }

            // Use centralized text file extensions
            const isTextFile = hasExtension(resolvedPath, TEXT_FILE_EXTENSIONS) ||
                            basename === 'makefile' ||
                            basename === 'dockerfile' ||
                            (basename.startsWith('.') && !ext);

            if (isTextFile) {
                const openInNewTab = configService.getConfig('openLinksInNewTab');

                try {
                    const existingDocument = this.findExistingDocument(resolvedPath);

                    if (existingDocument) {
                        // ALWAYS focus existing documents, ignore openInNewTab setting
                        await vscode.window.showTextDocument(existingDocument, {
                            preserveFocus: false,
                            preview: false
                        });
                    } else {
                        // File is not open, open it according to user preference
                        const document = await vscode.workspace.openTextDocument(resolvedPath);

                        if (openInNewTab) {
                            // Open in new tab group (split view)
                            await vscode.window.showTextDocument(document, {
                                preview: false,
                                viewColumn: vscode.ViewColumn.Beside
                            });
                        } else {
                            // Open in current tab group
                            await vscode.window.showTextDocument(document, {
                                preview: false,
                                preserveFocus: false
                            });
                        }
                    }

                    if (!isAbsolute) {
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        const isWorkspaceRelative = workspaceFolders?.some(f =>
                            href.startsWith(path.basename(f.uri.fsPath) + '/')
                        );

                        const resolutionMethod = isWorkspaceRelative ? 'workspace-relative' : 'document-relative';
                        showInfo(
                            `Opened in VS Code: ${path.basename(resolvedPath)} (${resolutionMethod} path: ${href})`
                        );
                    }
                } catch (error) {
                    console.warn(`VS Code couldn't open file, trying OS default: ${resolvedPath}`, error);
                    try {
                        await vscode.env.openExternal(safeFileUri(resolvedPath, 'linkHandler'));
                        showInfo(
                            `Opened externally: ${path.basename(resolvedPath)}`
                        );
                    } catch (externalError) {
                        showError(`Failed to open file: ${resolvedPath}`);
                    }
                }
            } else {
                try {
                    await vscode.env.openExternal(safeFileUri(resolvedPath, 'linkHandler'));
                    showInfo(
                        `Opened externally: ${path.basename(resolvedPath)}`
                    );
                } catch (error) {
                    try {
                        await vscode.commands.executeCommand('revealFileInOS', safeFileUri(resolvedPath, 'linkHandler'));
                        showInfo(
                            `Revealed in file explorer: ${path.basename(resolvedPath)}`
                        );
                    } catch (revealError) {
                        showError(`Failed to open file: ${resolvedPath}`);
                    }
                }
            }

        } catch (error) {
            showError(`Failed to handle file link: ${href}`);
        }
    }

    /**
     * Apply link replacement using LinkReplacementService
     *
     * Directly calls the replacement service instead of emitting events.
     * This provides better include file support and path variant handling.
     *
     * @param userPathFormat - Path format selected by user in search dialog (overrides config if provided and not 'auto')
     * @param fallbackBaseDir - Fallback base directory when document is not available (e.g., wiki links)
     */
    private async applyLinkReplacement(originalPath: string, replacementUri: vscode.Uri, taskId?: string, columnId?: string, linkIndex?: number, includeContext?: IncludeContextForResolution, userPathFormat?: 'auto' | 'relative' | 'absolute', fallbackBaseDir?: string) {
        console.log('[LinkHandler.applyLinkReplacement] Context:', JSON.stringify({ taskId, columnId, linkIndex, hasIncludeContext: !!includeContext, userPathFormat, hasFallbackBaseDir: !!fallbackBaseDir }));

        if (!this._replacementDeps) {
            console.warn('[LinkHandler.applyLinkReplacement] No replacement dependencies set, cannot replace');
            showWarning('Cannot replace link: replacement service not initialized');
            return;
        }

        // Get base directory for path resolution
        // Priority: includeContext > document > fallbackBaseDir > main file from registry
        const document = this._fileManager.getDocument();
        const mainFile = this._replacementDeps.fileRegistry.getMainFile();
        const baseDir = includeContext?.includeDir
            || (document ? path.dirname(document.uri.fsPath) : undefined)
            || fallbackBaseDir
            || (mainFile ? path.dirname(mainFile.getPath()) : undefined);

        if (!baseDir) {
            console.warn('[LinkHandler.applyLinkReplacement] No base directory available (no document, no fallback, no main file)');
            showWarning('Cannot replace link: no document context');
            return;
        }

        // Determine path format: user selection overrides config (unless 'auto')
        const configPathFormat = configService.getPathGenerationMode();
        const pathFormat = (userPathFormat && userPathFormat !== 'auto') ? userPathFormat : configPathFormat;
        console.log('[LinkHandler.applyLinkReplacement] pathFormat:', pathFormat, '(user:', userPathFormat, ', config:', configPathFormat, '), baseDir:', baseDir);

        // Use the unified replacement service
        await linkReplacementService.replacePath(
            originalPath,
            replacementUri.fsPath,
            baseDir,
            this._replacementDeps,
            {
                mode: 'single',
                pathFormat,
                taskId,
                columnId,
                linkIndex,
                isColumnTitle: false
            }
        );
    }

    /**
     * Enhanced wiki link handler with smart extension handling and workspace folder context
     * @param documentName - The wiki link document name
     * @param taskId - Optional task ID for targeted updates
     * @param columnId - Optional column ID for targeted updates
     * @param linkIndex - Optional link index for specific link replacement
     * @param includeContext - Optional include file context for proper path resolution
     */
    public async handleWikiLink(documentName: string, taskId?: string, columnId?: string, linkIndex?: number, includeContext?: IncludeContextForResolution) {
        const allAttemptedPaths: string[] = [];
        let triedFilenames: string[] = [];

        // Check if the document name already has a file extension
        const documentHasExtension = /\.[a-zA-Z0-9]+$/.test(documentName);

        let filesToTry: string[] = [];

        if (documentHasExtension) {
            // If it already has an extension, try it as-is first
            filesToTry = [documentName];
            // Then try with markdown extensions as fallback (in case it's something like "document.v1" that should be "document.v1.md")
            filesToTry.push(documentName + '.md', documentName + '.markdown', documentName + '.txt');
        } else {
            // If no extension, try markdown extensions and then no extension
            filesToTry = [documentName + '.md', documentName + '.markdown', documentName + '.txt', documentName];
        }

        for (const filename of filesToTry) {
            triedFilenames.push(filename);
            const resolution = await this._fileManager.resolveFilePath(filename);

            if (resolution) {
                allAttemptedPaths.push(...resolution.attemptedPaths);

                if (resolution.exists) {
                    try {
                        // For text files, try to open in VS Code
                        const ext = path.extname(filename).toLowerCase();

                        if (!ext || hasExtension(filename, TEXT_FILE_EXTENSIONS)) {
                            const existingDocument = this.findExistingDocument(resolution.resolvedPath);

                            if (existingDocument) {
                                // File is already open, always focus it
                                try {
                                    await vscode.window.showTextDocument(existingDocument, {
                                        preserveFocus: false,
                                        preview: false
                                    });
                                } catch (error) {
                                    console.error(`[WIKILINK_REUSE] Failed to focus existing document:`, error);
                                    // Fallback to opening normally
                                    const document = await vscode.workspace.openTextDocument(resolution.resolvedPath);
                                    await vscode.window.showTextDocument(document, {
                                        preview: false,
                                        preserveFocus: false
                                    });
                                }
                            } else {
                                // File is not open, open it normally
                                const document = await vscode.workspace.openTextDocument(resolution.resolvedPath);
                                await vscode.window.showTextDocument(document, {
                                    preview: false,
                                    preserveFocus: false
                                });
                            }

                            showInfo(
                                `Opened wiki link: ${documentName} → ${path.basename(resolution.resolvedPath)}`
                            );
                        } else {
                            // For binary files (images, videos, etc.), reveal in file explorer or open with default application
                            try {
                                await vscode.commands.executeCommand('revealFileInOS', safeFileUri(resolution.resolvedPath, 'linkHandler-resolution'));
                                showInfo(
                                    `Opened wiki link: ${documentName} → ${path.basename(resolution.resolvedPath)} (in default application)`
                                );
                            } catch (osError) {
                                // Fallback: try to open with VS Code anyway
                                await vscode.env.openExternal(safeFileUri(resolution.resolvedPath, 'linkHandler-resolution'));
                                showInfo(
                                    `Opened wiki link: ${documentName} → ${path.basename(resolution.resolvedPath)}`
                                );
                            }
                        }
                        return;
                    } catch (error) {
                        console.warn(`Failed to open ${filename}:`, error);
                        continue;
                    }
                }
            }
        }

        // Offer replacement picker before warning
        try {
            const baseDir = this.resolveBaseDir(includeContext);

            if (!baseDir) {
                console.warn('[LinkHandler.handleWikiLink] No base directory available, cannot offer replacement');
                // Continue to show warning message below
            } else {
                const result = await this._fileSearchService.pickReplacementForBrokenLink(documentName, baseDir);
                if (result) {
                    // Pass taskId, columnId, linkIndex for targeted updates
                    await this.applyLinkReplacement(documentName, result.uri, taskId, columnId, linkIndex, includeContext, result.pathFormat);
                    return;
                }
            }
        } catch (e) {
            console.warn('[LinkHandler] Wiki replacement picker failed:', e);
        }

        // Enhanced error message with workspace context
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let contextInfo = '';

        if (workspaceFolders && workspaceFolders.length > 0) {
            const folderNames = workspaceFolders.map(f => path.basename(f.uri.fsPath));
            if (documentHasExtension) {
                contextInfo = `\n\nTip: For files in specific workspace folders, try: [[${folderNames[0]}/${documentName}]]`;
            } else {
                contextInfo = `\n\nTip: For files in specific workspace folders, try: [[${folderNames[0]}/${documentName}]] or [[${folderNames[0]}/${documentName}.ext]]`;
            }
        }

        const pathsList = allAttemptedPaths.map((p, i) => `  ${i + 1}. ${p}`).join('\n');
        const extensionsList = triedFilenames.join(', ');

        const hasExtensionNote = documentHasExtension
            ? `\n\nNote: "${documentName}" already has an extension, so it was tried as-is first.`
            : `\n\nNote: "${documentName}" has no extension, so markdown extensions (.md, .markdown, .txt) were tried first.`;

        showWarning(
            `Wiki link not found: [[${documentName}]]\n\nTried filenames: ${extensionsList}\n\nSearched in the following locations:\n${pathsList}${hasExtensionNote}${contextInfo}`
        );

        console.warn(`[LinkHandler] Wiki link not found: [[${documentName}]] (tried ${allAttemptedPaths.length} paths)`);
    }

    public async handleExternalLink(href: string) {
        vscode.env.openExternal(vscode.Uri.parse(href));
    }
}
