/**
 * WebviewManager - Handles webview permissions, configuration, asset management, and HTML generation
 *
 * Consolidates:
 * - Resource permission management (localResourceRoots)
 * - Asset directory scanning
 * - Layout preset configuration
 * - Webview option updates
 * - HTML generation for webview (moved from KanbanWebviewPanel)
 *
 * @module panel/WebviewManager
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { KanbanBoard } from '../markdownParser';
import { configService } from '../services/ConfigurationService';

/**
 * Dependencies required by WebviewManager
 */
export interface WebviewManagerDependencies {
    extensionUri: vscode.Uri;
    extensionContext: vscode.ExtensionContext;
    getPanel: () => vscode.WebviewPanel | undefined;
    getDocument: () => vscode.TextDocument | undefined;
    getBoard: () => KanbanBoard | undefined;
    isInitialized: () => boolean;
}

/**
 * WebviewManager - Single-responsibility module for webview management
 */
export class WebviewManager {
    private _deps: WebviewManagerDependencies;

    constructor(deps: WebviewManagerDependencies) {
        this._deps = deps;
    }

    // ============= PERMISSION MANAGEMENT =============

    /**
     * Update webview permissions to include all current workspace folders
     * Only reloads HTML if localResourceRoots actually changed
     */
    updatePermissions(): void {
        const panel = this._deps.getPanel();
        if (!panel) return;

        const localResourceRoots = this._buildLocalResourceRoots(false);

        // Check if localResourceRoots actually changed
        const currentRoots = panel.webview.options.localResourceRoots || [];
        const currentPaths = new Set(currentRoots.map(r => r.toString()));
        const newPaths = new Set(localResourceRoots.map(r => r.toString()));

        const hasChanges = currentPaths.size !== newPaths.size ||
            [...newPaths].some(p => !currentPaths.has(p));

        if (!hasChanges) {
            return;
        }

        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots,
            enableCommandUris: true
        };

        // Only reload HTML if initialized (to apply new permissions)
        if (this._deps.isInitialized()) {
            panel.webview.html = this.generateHtml();
        }
    }

    /**
     * Update webview permissions to include asset directories from the board
     * Called before sending board updates to ensure all assets can be loaded
     */
    updatePermissionsForAssets(): void {
        const panel = this._deps.getPanel();
        if (!panel) return;

        const localResourceRoots = this._buildLocalResourceRoots(true);

        // Set options with all required roots (workspace + document + assets)
        // Do NOT reload HTML - just update options before sending board update
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots,
            enableCommandUris: true
        };
    }

    /**
     * Build the list of local resource roots for the webview
     */
    buildLocalResourceRoots(includeAssets: boolean): vscode.Uri[] {
        return this._buildLocalResourceRoots(includeAssets);
    }

    private _buildLocalResourceRoots(includeAssets: boolean): vscode.Uri[] {
        const localResourceRoots = [this._deps.extensionUri];

        // Add all current workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            workspaceFolders.forEach(folder => {
                localResourceRoots.push(folder.uri);
            });
        }

        // Add document directory if it's outside workspace folders
        const document = this._deps.getDocument();
        if (document) {
            const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
            const isInWorkspace = workspaceFolders?.some(folder =>
                documentDir.fsPath.startsWith(folder.uri.fsPath)
            );

            if (!isInWorkspace) {
                localResourceRoots.push(documentDir);
            }

            // Scan board for asset directories if requested
            if (includeAssets) {
                const assetDirs = this._collectAssetDirectories();
                for (const dir of assetDirs) {
                    const dirUri = vscode.Uri.file(dir);
                    const alreadyIncluded = localResourceRoots.some(root =>
                        root.fsPath === dir
                    );
                    if (!alreadyIncluded) {
                        localResourceRoots.push(dirUri);
                    }
                }
            }
        }

        return localResourceRoots;
    }

    // ============= ASSET DIRECTORY SCANNING =============

    /**
     * Collect all unique asset directories from the board content
     */
    private _collectAssetDirectories(): string[] {
        const board = this._deps.getBoard();
        const document = this._deps.getDocument();
        if (!board || !document) return [];

        const assetDirs = new Set<string>();
        const documentDir = path.dirname(document.uri.fsPath);

        // Regex patterns for finding asset paths
        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
        const htmlMediaRegex = /<(?:img|video|audio|source|iframe)[^>]+(?:src|poster)=["']([^"']+)["']/gi;

        // Scan each column
        for (const column of board.columns) {
            // Use include file directory if column has includeFiles
            let columnBaseDir = documentDir;
            if (column.includeFiles && column.includeFiles.length > 0) {
                const includeFile = column.includeFiles[0];
                columnBaseDir = path.dirname(path.resolve(documentDir, includeFile));
            }

            // Scan column title
            this._extractAssetDirs(column.title, columnBaseDir, assetDirs, imageRegex, htmlMediaRegex);

            // Scan each task in the column
            for (const task of column.tasks) {
                // Use task's include context if available, otherwise column base
                let taskBaseDir = columnBaseDir;
                if (task.includeContext?.includeDir) {
                    taskBaseDir = task.includeContext.includeDir;
                }

                // Scan task title and description
                this._extractAssetDirs(task.title, taskBaseDir, assetDirs, imageRegex, htmlMediaRegex);
                if (task.description) {
                    this._extractAssetDirs(task.description, taskBaseDir, assetDirs, imageRegex, htmlMediaRegex);
                }
            }
        }

        return Array.from(assetDirs);
    }

    /**
     * Extract asset directories from content using regex patterns
     */
    private _extractAssetDirs(
        content: string,
        basePath: string,
        assetDirs: Set<string>,
        ...regexes: RegExp[]
    ): void {
        for (const regex of regexes) {
            // Reset regex state for each use
            regex.lastIndex = 0;

            let match;
            while ((match = regex.exec(content)) !== null) {
                const assetPath = match[1];

                // Skip URLs and data URIs
                if (assetPath.startsWith('http://') ||
                    assetPath.startsWith('https://') ||
                    assetPath.startsWith('data:') ||
                    assetPath.startsWith('vscode-resource:')) {
                    continue;
                }

                // Resolve relative path
                const absolutePath = path.isAbsolute(assetPath)
                    ? assetPath
                    : path.resolve(basePath, assetPath);

                // Get the directory containing the asset
                const assetDir = path.dirname(absolutePath);

                // Check if directory exists
                try {
                    if (fs.existsSync(assetDir) && fs.statSync(assetDir).isDirectory()) {
                        assetDirs.add(assetDir);
                    }
                } catch {
                    // Ignore invalid paths
                }
            }
        }
    }

    // ============= LAYOUT PRESETS =============

    /**
     * Get layout presets configuration from VS Code settings
     * Default presets are defined in package.json contributes.configuration
     */
    getLayoutPresetsConfiguration(): Record<string, any> {
        return configService.getConfig('layoutPresets', {});
    }

    // ============= HTML GENERATION =============

    /**
     * Generate HTML for the webview
     * Moved from KanbanWebviewPanel._getHtmlForWebview() (~105 lines)
     *
     * Handles:
     * - Loading base HTML template
     * - Adding Content Security Policy
     * - Setting base href for relative paths
     * - Replacing script/CSS references with webview URIs
     * - Cache busting in development mode
     */
    generateHtml(): string {
        const panel = this._deps.getPanel();
        if (!panel) {
            return '<html><body>Panel not available</body></html>';
        }

        const extensionPath = this._deps.extensionContext.extensionPath;
        const filePath = vscode.Uri.file(path.join(extensionPath, 'src', 'html', 'webview.html'));
        let html = fs.readFileSync(filePath.fsPath, 'utf8');

        const cspSource = panel.webview.cspSource;

        // Content Security Policy
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data: blob:; media-src ${cspSource} https: data: blob:; script-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; frame-src 'none'; worker-src blob:; child-src blob:;">`;

        if (!html.includes('Content-Security-Policy')) {
            html = html.replace('<head>', `<head>\n    ${cspMeta}`);
        }

        // Build comprehensive localResourceRoots including asset directories
        const localResourceRoots = this._buildLocalResourceRoots(true);

        // Add document-specific paths if available
        const document = this._deps.getDocument();
        if (document) {
            const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
            const baseHref = panel.webview.asWebviewUri(documentDir).toString() + '/';
            html = html.replace(/<head>/, `<head><base href="${baseHref}">`);

            // Use local markdown-it from dist/src/html (bundled with extension)
            try {
                const markdownItPath = vscode.Uri.joinPath(this._deps.extensionUri, 'dist', 'src', 'html', 'markdown-it.min.js');
                if (fs.existsSync(markdownItPath.fsPath)) {
                    const markdownItUri = panel.webview.asWebviewUri(markdownItPath);
                    html = html.replace(
                        /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/markdown-it\/[^"]+\/markdown-it\.min\.js"><\/script>/,
                        `<script src="${markdownItUri}"></script>`
                    );
                }
            } catch (error) {
                console.warn('[WebviewManager] Failed to load local markdown-it:', error);
            }
        }

        // Apply the enhanced localResourceRoots
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots,
            enableCommandUris: true
        };

        // Add cache-busting timestamp for development
        const timestamp = Date.now();
        const extensionMode = this._deps.extensionContext.extensionMode;
        const isDevelopment = !extensionMode || extensionMode === vscode.ExtensionMode.Development;
        const cacheBuster = isDevelopment ? `?v=${timestamp}` : '';

        const devHtmlDir = path.join(extensionPath, 'src', 'html');
        const distHtmlDir = path.join(extensionPath, 'dist', 'src', 'html');
        const devWebviewDir = panel.webview.asWebviewUri(vscode.Uri.file(devHtmlDir));
        const distWebviewDir = panel.webview.asWebviewUri(vscode.Uri.file(distHtmlDir));
        const preferDevAssets = isDevelopment && fs.existsSync(devHtmlDir);

        const resolveAssetUri = (relativePath: string): string => {
            if (preferDevAssets) {
                const devPath = path.join(devHtmlDir, relativePath);
                if (fs.existsSync(devPath)) {
                    return `${devWebviewDir}/${relativePath}${cacheBuster}`;
                }
            }
            return `${distWebviewDir}/${relativePath}${cacheBuster}`;
        };

        html = html.replace(/href="webview\.css"/, `href="${resolveAssetUri('webview.css')}"`);

        // Replace all JavaScript file references
        const jsFiles = [
            'utils/dateUtils.js',
            'utils/colorUtils.js',
            'utils/fileTypeUtils.js',
            'utils/tagUtils.js',
            'utils/configManager.js',
            'utils/styleManager.js',
            'utils/menuManager.js',
            'utils/dragStateManager.js',
            'utils/validationUtils.js',
            'utils/modalUtils.js',
            'utils/activityIndicator.js',
            'utils/exportTreeBuilder.js',
            'utils/exportTreeUI.js',
            'utils/smartLogger.js',
            'utils/menuUtils.js',
            'utils/menuConfig.js',
            'utils/presentationParser.js',
            'utils/tagStyleManager.js',
            'utils/stackLayoutManager.js',
            'utils/columnFoldingManager.js',
            'utils/imagePathManager.js',
            'utils/includeModeManager.js',
            'utils/dropIndicatorManager.js',
            'utils/rowLayoutManager.js',
            'markdownRenderer.js',
            'taskEditor.js',
            'boardRenderer.js',
            'dragDrop.js',
            'menuOperations.js',
            'search.js',
            'debugOverlay.js',
            'clipboardHandler.js',
            'navigationHandler.js',
            'foldingStateManager.js',
            'templateDialog.js',
            'exportMarpUI.js',
            'webview.js',
            'markdown-it-media-browser.js',
            'markdown-it-multicolumn-browser.js',
            'markdown-it-mark-browser.js',
            'markdown-it-sub-browser.js',
            'markdown-it-sup-browser.js',
            'markdown-it-ins-browser.js',
            'markdown-it-strikethrough-alt-browser.js',
            'markdown-it-underline-browser.js',
            'markdown-it-abbr-browser.js',
            'markdown-it-container-browser.js',
            'markdown-it-include-browser.js',
            'markdown-it-image-figures-browser.js'
        ];

        jsFiles.forEach(jsFile => {
            html = html.replace(
                new RegExp(`src="${jsFile}"`, 'g'),
                `src="${resolveAssetUri(jsFile)}"`
            );
        });

        return html;
    }
}
