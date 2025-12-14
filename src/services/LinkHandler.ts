import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileManager } from '../fileManager';
import { FileSearchService } from '../fileSearchService';
import { configService } from '../configurationService';
import { safeFileUri } from '../utils/uriUtils';

export class LinkHandler {
    private _fileManager: FileManager;
    private _fileSearchService: FileSearchService;
    private _onRequestLinkReplacement: (originalPath: string, newPath: string, isImage: boolean, taskId?: string, columnId?: string, linkIndex?: number) => Promise<void>;

    constructor(
        fileManager: FileManager,
        _webview: vscode.Webview,
        onRequestLinkReplacement: (originalPath: string, newPath: string, isImage: boolean, taskId?: string, columnId?: string, linkIndex?: number) => Promise<void>
    ) {
        this._fileManager = fileManager;
        // Provide extension root so FileSearchService can load icon assets
        this._fileSearchService = new FileSearchService(this._fileManager.getExtensionUri());
        this._onRequestLinkReplacement = onRequestLinkReplacement;
    }
    /**
     * Enhanced file link handler with workspace-relative path support
     */
    public async handleFileLink(href: string, taskId?: string, columnId?: string, linkIndex?: number, includeContext?: any) {
        try {
            if (href.startsWith('file://')) {
                href = vscode.Uri.parse(href).fsPath;
            }

            if (href.startsWith('vscode-webview://')) {
                return;
            }

            const resolution = await this._fileManager.resolveFilePath(href, includeContext);

            if (!resolution) {
                vscode.window.showErrorMessage(`Could not resolve file path: ${href}`);
                return;
            }

            const { resolvedPath, exists, isAbsolute, attemptedPaths } = resolution;

            if (!exists) {
                // Unified behavior: Open an incremental QuickPick and stream results.
                const baseDir = this._fileManager.getDocument()
                    ? path.dirname(this._fileManager.getDocument()!.uri.fsPath)
                    : undefined;
                const replacement = await this._fileSearchService.pickReplacementForBrokenLink(href, baseDir);
                if (replacement) {
                    await this.applyLinkReplacement(href, replacement, taskId, columnId, linkIndex);
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
                    vscode.window.showWarningMessage(
                        `File not found: ${resolvedPath}\n\nAttempted path:\n${pathsList}${contextInfo}`,
                        { modal: false }
                    );
                } else {
                    vscode.window.showWarningMessage(
                        `File not found: ${href}\n\nSearched in the following locations:\n${pathsList}${contextInfo}`,
                        { modal: false }
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
                vscode.window.showErrorMessage(`Error accessing file: ${resolvedPath}`);
                return;
            }

            const ext = path.extname(resolvedPath).toLowerCase();
            const basename = path.basename(resolvedPath).toLowerCase();

            // Special handling for diagram files (draw.io, excalidraw)
            // Try to open in VS Code (will use appropriate extension if installed)
            const diagramExtensions = ['.drawio', '.dio'];
            const excalidrawExtensions = ['.excalidraw', '.excalidraw.json', '.excalidraw.svg'];

            const isDiagramFile = diagramExtensions.includes(ext) ||
                                  excalidrawExtensions.some(e => resolvedPath.toLowerCase().endsWith(e));

            if (isDiagramFile) {
                try {
                    // Try to open with VS Code's default handler
                    // If draw.io or excalidraw extension is installed, it will use that
                    // Otherwise, VS Code will ask which editor to use
                    const fileUri = safeFileUri(resolvedPath, 'linkHandler');
                    await vscode.commands.executeCommand('vscode.open', fileUri);

                    const diagramType = diagramExtensions.includes(ext) ? 'draw.io' : 'Excalidraw';
                    vscode.window.showInformationMessage(
                        `Opened ${diagramType} diagram: ${path.basename(resolvedPath)}`
                    );
                    return;
                } catch (error) {
                    console.warn(`Could not open diagram in VS Code, trying external: ${resolvedPath}`, error);
                    // If VS Code can't open it, try opening externally
                    try {
                        await vscode.env.openExternal(safeFileUri(resolvedPath, 'linkHandler'));
                        vscode.window.showInformationMessage(
                            `Opened externally: ${path.basename(resolvedPath)}`
                        );
                        return;
                    } catch (externalError) {
                        vscode.window.showErrorMessage(`Failed to open diagram file: ${resolvedPath}`);
                        return;
                    }
                }
            }

            const textExtensions = [
                '.md', '.markdown', '.txt', '.rtf', '.log', '.csv', '.tsv',
                '.html', '.htm', '.css', '.scss', '.sass', '.less',
                '.js', '.jsx', '.ts', '.tsx', '.json', '.xml', '.svg',
                '.py', '.java', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.cs',
                '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.r',
                '.m', '.mm', '.pl', '.pm', '.lua', '.dart', '.elm', '.clj',
                '.ex', '.exs', '.erl', '.hrl', '.fs', '.fsx', '.ml', '.mli',
                '.pas', '.pp', '.asm', '.s', '.bas', '.cob', '.for', '.f90',
                '.jl', '.nim', '.cr', '.zig', '.v', '.vh', '.vhd', '.vhdl',
                '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.psd1', '.bat', '.cmd',
                '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.config',
                '.env', '.properties', '.gitignore', '.dockerignore', '.editorconfig',
                '.prettierrc', '.eslintrc', '.babelrc', '.webpack',
                '.rst', '.tex', '.latex', '.bib',
                '.sql', '.graphql', '.proto',
                'makefile', 'Makefile', 'GNUmakefile', '.mk',
                'dockerfile', 'Dockerfile', '.dockerfile',
                '.diff', '.patch', '.vue', '.svelte'
            ];

            const isTextFile = textExtensions.includes(ext) ||
                            basename === 'makefile' ||
                            basename === 'dockerfile' ||
                            basename.startsWith('.') && !ext;

            if (isTextFile) {
                const openInNewTab = configService.getConfig('openLinksInNewTab');

                try {
                    // Normalize the path for comparison (resolve symlinks, normalize separators)
                    const normalizedPath = path.resolve(resolvedPath);


                    // Check if file is already open as a document (even if not visible)
                    const existingDocument = vscode.workspace.textDocuments.find(doc => {
                        const docPath = path.resolve(doc.uri.fsPath);
                        const matches = docPath === normalizedPath;
                        return matches;
                    });

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
                        vscode.window.showInformationMessage(
                            `Opened in VS Code: ${path.basename(resolvedPath)} (${resolutionMethod} path: ${href})`
                        );
                    }
                } catch (error) {
                    console.warn(`VS Code couldn't open file, trying OS default: ${resolvedPath}`, error);
                    try {
                        await vscode.env.openExternal(safeFileUri(resolvedPath, 'linkHandler'));
                        vscode.window.showInformationMessage(
                            `Opened externally: ${path.basename(resolvedPath)}`
                        );
                    } catch (externalError) {
                        vscode.window.showErrorMessage(`Failed to open file: ${resolvedPath}`);
                    }
                }
            } else {
                try {
                    await vscode.env.openExternal(safeFileUri(resolvedPath, 'linkHandler'));
                    vscode.window.showInformationMessage(
                        `Opened externally: ${path.basename(resolvedPath)}`
                    );
                } catch (error) {
                    try {
                        await vscode.commands.executeCommand('revealFileInOS', safeFileUri(resolvedPath, 'linkHandler'));
                        vscode.window.showInformationMessage(
                            `Revealed in file explorer: ${path.basename(resolvedPath)}`
                        );
                    } catch (revealError) {
                        vscode.window.showErrorMessage(`Failed to open file: ${resolvedPath}`);
                    }
                }
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to handle file link: ${href}`);
        }
    }

    private async applyLinkReplacement(originalPath: string, replacementUri: vscode.Uri, taskId?: string, columnId?: string, linkIndex?: number) {
        const document = this._fileManager.getDocument();
        if (!document) {
            console.error(`[LinkHandler] No document loaded. FileManager state:`, {
                hasDocument: !!this._fileManager.getDocument(),
                originalPath,
                replacementUri: replacementUri.fsPath,
                taskId,
                columnId,
                linkIndex
            });
            vscode.window.showErrorMessage(`No document loaded to update links. originalPath: ${originalPath}, taskId: ${taskId}, columnId: ${columnId}`);
            return;
        }

        // Generate path based on user configuration (relative or absolute)
        const configuredPath = this._fileManager.generateConfiguredPath(replacementUri.fsPath);

        const isImage = originalPath.includes('.png') || originalPath.includes('.jpg') ||
                       originalPath.includes('.jpeg') || originalPath.includes('.gif') ||
                       originalPath.includes('.svg') || originalPath.includes('.bmp') ||
                       originalPath.includes('.webp');

        // Call the callback to handle replacement in the backend
        await this._onRequestLinkReplacement(originalPath, configuredPath, isImage, taskId, columnId, linkIndex);

        vscode.window.showInformationMessage(`Link updated: ${originalPath} → ${configuredPath}`);
    }

    /**
     * Enhanced wiki link handler with smart extension handling and workspace folder context
     */
    public async handleWikiLink(documentName: string) {
        const allAttemptedPaths: string[] = [];
        let triedFilenames: string[] = [];

        // Check if the document name already has a file extension
        const hasExtension = /\.[a-zA-Z0-9]+$/.test(documentName);

        let filesToTry: string[] = [];

        if (hasExtension) {
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
                        const textExtensions = ['.md', '.markdown', '.txt', '.rtf', '.json', '.xml', '.html', '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.php', '.rb', '.go', '.rs', '.sh', '.bat', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf'];
                        const ext = path.extname(filename).toLowerCase();

                        if (!ext || textExtensions.includes(ext)) {
                            // Normalize the path for comparison (resolve symlinks, normalize separators)
                            const normalizedPath = path.resolve(resolution.resolvedPath);


                            // Check if file is already open as a document (even if not visible)
                            const existingDocument = vscode.workspace.textDocuments.find(doc => {
                                const docPath = path.resolve(doc.uri.fsPath);
                                const matches = docPath === normalizedPath;
                                return matches;
                            });

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

                            vscode.window.showInformationMessage(
                                `Opened wiki link: ${documentName} → ${path.basename(resolution.resolvedPath)}`
                            );
                        } else {
                            // For binary files (images, videos, etc.), reveal in file explorer or open with default application
                            try {
                                await vscode.commands.executeCommand('revealFileInOS', safeFileUri(resolution.resolvedPath, 'linkHandler-resolution'));
                                vscode.window.showInformationMessage(
                                    `Opened wiki link: ${documentName} → ${path.basename(resolution.resolvedPath)} (in default application)`
                                );
                            } catch (osError) {
                                // Fallback: try to open with VS Code anyway
                                await vscode.env.openExternal(safeFileUri(resolution.resolvedPath, 'linkHandler-resolution'));
                                vscode.window.showInformationMessage(
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
            const baseDir = this._fileManager.getDocument()
                ? path.dirname(this._fileManager.getDocument()!.uri.fsPath)
                : undefined;
            const replacement = await this._fileSearchService.pickReplacementForBrokenLink(documentName, baseDir);
            if (replacement) {
                await this.applyLinkReplacement(documentName, replacement);
                return;
            }
        } catch (e) {
            console.warn('[LinkHandler] Wiki replacement picker failed:', e);
        }

        // Enhanced error message with workspace context
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let contextInfo = '';

        if (workspaceFolders && workspaceFolders.length > 0) {
            const folderNames = workspaceFolders.map(f => path.basename(f.uri.fsPath));
            if (hasExtension) {
                contextInfo = `\n\nTip: For files in specific workspace folders, try: [[${folderNames[0]}/${documentName}]]`;
            } else {
                contextInfo = `\n\nTip: For files in specific workspace folders, try: [[${folderNames[0]}/${documentName}]] or [[${folderNames[0]}/${documentName}.ext]]`;
            }
        }

        const pathsList = allAttemptedPaths.map((p, i) => `  ${i + 1}. ${p}`).join('\n');
        const extensionsList = triedFilenames.join(', ');

        const hasExtensionNote = hasExtension
            ? `\n\nNote: "${documentName}" already has an extension, so it was tried as-is first.`
            : `\n\nNote: "${documentName}" has no extension, so markdown extensions (.md, .markdown, .txt) were tried first.`;

        vscode.window.showWarningMessage(
            `Wiki link not found: [[${documentName}]]\n\nTried filenames: ${extensionsList}\n\nSearched in the following locations:\n${pathsList}${hasExtensionNote}${contextInfo}`,
            { modal: false }
        );

        console.warn(`[LinkHandler] Wiki link not found: [[${documentName}]] (tried ${allAttemptedPaths.length} paths)`);
    }

    public async handleExternalLink(href: string) {
        vscode.env.openExternal(vscode.Uri.parse(href));
    }
}
