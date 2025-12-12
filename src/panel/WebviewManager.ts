/**
 * WebviewManager - Handles webview permissions, configuration, and asset management
 *
 * Consolidates:
 * - Resource permission management (localResourceRoots)
 * - Asset directory scanning
 * - Layout preset configuration
 * - Webview option updates
 *
 * @module panel/WebviewManager
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { KanbanBoard } from '../markdownParser';
import { configService } from '../configurationService';

/**
 * Dependencies required by WebviewManager
 */
export interface WebviewManagerDependencies {
    extensionUri: vscode.Uri;
    getPanel: () => vscode.WebviewPanel | undefined;
    getDocument: () => vscode.TextDocument | undefined;
    getBoard: () => KanbanBoard | undefined;
    isInitialized: () => boolean;
    getHtmlForWebview: () => string;
}

/**
 * Default layout presets
 */
const DEFAULT_LAYOUT_PRESETS = {
    overview: {
        label: "Overview",
        description: "Compact view for seeing many cards",
        settings: {
            columnWidth: "250px",
            cardHeight: "auto",
            sectionHeight: "auto",
            taskSectionHeight: "auto",
            fontSize: "0_5x",
            whitespace: "8px",
            tagVisibility: "allexcludinglayout",
            arrowKeyFocusScroll: "center"
        }
    },
    normal: {
        label: "Normal",
        description: "Default balanced view",
        settings: {
            columnWidth: "350px",
            cardHeight: "auto",
            sectionHeight: "auto",
            taskSectionHeight: "auto",
            fontSize: "1x",
            whitespace: "8px",
            tagVisibility: "allexcludinglayout",
            arrowKeyFocusScroll: "center"
        }
    },
    grid3x: {
        label: "3x3 Grid",
        description: "Grid layout for organized viewing",
        settings: {
            columnWidth: "33percent",
            cardHeight: "auto",
            sectionHeight: "auto",
            taskSectionHeight: "auto",
            fontSize: "1x",
            whitespace: "8px",
            rowHeight: "50vh",
            tagVisibility: "allexcludinglayout",
            arrowKeyFocusScroll: "center"
        }
    },
    focused: {
        label: "Focused",
        description: "Large cards for detailed work",
        settings: {
            columnWidth: "500px",
            cardHeight: "auto",
            sectionHeight: "auto",
            taskSectionHeight: "auto",
            fontSize: "1_25x",
            whitespace: "16px",
            tagVisibility: "allexcludinglayout",
            arrowKeyFocusScroll: "center"
        }
    }
};

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
     */
    updatePermissions(): void {
        const panel = this._deps.getPanel();
        if (!panel) return;

        const localResourceRoots = this._buildLocalResourceRoots(false);

        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots,
            enableCommandUris: true
        };

        // Refresh the webview HTML to apply new permissions
        if (this._deps.isInitialized()) {
            panel.webview.html = this._deps.getHtmlForWebview();
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
     * Get layout presets configuration (user presets merged with defaults)
     */
    getLayoutPresetsConfiguration(): Record<string, any> {
        const userPresets = configService.getConfig('layoutPresets', {});

        // Merge user presets with defaults (user presets take precedence)
        return {
            ...DEFAULT_LAYOUT_PRESETS,
            ...userPresets
        };
    }

    /**
     * Get a specific layout preset by name
     */
    getLayoutPreset(name: string): any | undefined {
        const presets = this.getLayoutPresetsConfiguration();
        return presets[name];
    }

    /**
     * Get all preset names
     */
    getPresetNames(): string[] {
        return Object.keys(this.getLayoutPresetsConfiguration());
    }
}
