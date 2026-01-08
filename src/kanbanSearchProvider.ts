/**
 * KanbanSearchProvider - WebviewViewProvider for the Kanban Search sidebar panel
 *
 * Provides two search modes:
 * 1. Find Broken Elements - Detect missing images, includes, links, media, diagrams
 * 2. Text Search - Search for text across column titles, task titles, and descriptions
 *
 * @module kanbanSearchProvider
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { KanbanWebviewPanel } from './kanbanWebviewPanel';
import { BoardContentScanner, BrokenElement, TextMatch } from './services/BoardContentScanner';
import {
    SearchResultItem,
    SearchBrokenElementsMessage,
    SearchTextMessage,
    NavigateToElementMessage,
    SearchResultsMessage,
    ScrollToElementMessage
} from './core/bridge/MessageTypes';

/**
 * KanbanSearchProvider - Sidebar panel for searching kanban boards
 */
export class KanbanSearchProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kanbanSearch';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _lastResultsPanel: KanbanWebviewPanel | null = null;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    /**
     * Called when the view is first created
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the sidebar webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'searchBrokenElements':
                    await this._handleBrokenElementsSearch();
                    break;
                case 'searchText':
                    await this._handleTextSearch((message as SearchTextMessage).query);
                    break;
                case 'navigateToElement':
                    this._handleNavigateToElement(message as NavigateToElementMessage);
                    break;
                case 'ready':
                    // Webview is ready, check if there's an active panel
                    this._updatePanelStatus();
                    break;
            }
        });

        // Update panel status when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._updatePanelStatus();
            }
        });
    }

    /**
     * Update the sidebar with current panel status
     */
    private _updatePanelStatus(): void {
        const panels = KanbanWebviewPanel.getAllPanels();
        const hasActivePanel = panels.length > 0;

        this._view?.webview.postMessage({
            type: 'panelStatus',
            hasActivePanel,
            panelCount: panels.length
        });
    }

    /**
     * Handle broken elements search request
     */
    private async _handleBrokenElementsSearch(): Promise<void> {
        const panel = this._getActivePanel();
        if (!panel) {
            this._sendNoActivePanel();
            return;
        }
        this._lastResultsPanel = panel;

        const board = panel.getBoard();
        if (!board) {
            this._sendError('No board data available');
            return;
        }

        const basePath = this._getBasePath(panel);
        if (!basePath) {
            this._sendError('Could not determine document path');
            return;
        }

        try {
            const scanner = new BoardContentScanner(basePath);
            const brokenElements = scanner.findBrokenElements(board);

            const results: SearchResultItem[] = brokenElements.map(elem => ({
                type: elem.type,
                path: elem.path,
                location: elem.location,
                exists: false
            }));

            this._sendSearchResults(results, 'broken');
        } catch (error) {
            console.error('[KanbanSearchProvider] Error scanning for broken elements:', error);
            this._sendError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle text search request
     */
    private async _handleTextSearch(query: string): Promise<void> {
        if (!query || query.trim().length === 0) {
            this._sendSearchResults([], 'text');
            return;
        }

        const panel = this._getActivePanel();
        if (!panel) {
            this._sendNoActivePanel();
            return;
        }
        this._lastResultsPanel = panel;

        const board = panel.getBoard();
        if (!board) {
            this._sendError('No board data available');
            return;
        }

        const basePath = this._getBasePath(panel);
        if (!basePath) {
            this._sendError('Could not determine document path');
            return;
        }

        try {
            const includeContentByPath = new Map<string, string>();
            const fileRegistry = panel.getFileRegistry?.();
            if (fileRegistry) {
                for (const includeFile of fileRegistry.getIncludeFiles()) {
                    if (includeFile.getFileType?.() === 'include-regular') {
                        const content = includeFile.getContent() || '';
                        includeContentByPath.set(includeFile.getPath(), content);
                    }
                }
            }

            const scanner = new BoardContentScanner(basePath);
            const matches = scanner.searchText(
                board,
                query.trim(),
                includeContentByPath.size > 0 ? includeContentByPath : undefined
            );

            const results: SearchResultItem[] = matches.map(match => ({
                type: 'text',
                matchText: match.matchText,
                context: match.context,
                location: match.location,
                exists: true
            }));

            this._sendSearchResults(results, 'text');
        } catch (error) {
            console.error('[KanbanSearchProvider] Error during text search:', error);
            this._sendError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle navigation to element request
     */
    private _handleNavigateToElement(message: NavigateToElementMessage): void {
        const preferredPanel = this._lastResultsPanel && !this._lastResultsPanel.isDisposed()
            ? this._lastResultsPanel
            : undefined;
        const panel = preferredPanel || this._getActivePanel();
        if (!panel) {
            this._sendNoActivePanel();
            return;
        }

        // Send scroll message to the main kanban webview
        const scrollMessage: ScrollToElementMessage = {
            type: 'scrollToElement',
            columnId: message.columnId,
            taskId: message.taskId,
            highlight: true,
            elementPath: message.elementPath,
            elementType: message.elementType,
            field: message.field
        };

        const webviewPanel = panel.getPanel();
        webviewPanel.reveal(undefined, false);
        webviewPanel.webview.postMessage(scrollMessage);
    }

    /**
     * Get the currently active kanban panel
     */
    private _getActivePanel(): KanbanWebviewPanel | undefined {
        return KanbanWebviewPanel.getActivePanel();
    }

    /**
     * Get the base path (document directory) for a panel
     */
    private _getBasePath(panel: KanbanWebviewPanel): string | undefined {
        // Get the document URI from the panel
        const documentUri = panel.getCurrentDocumentUri();
        if (documentUri) {
            return path.dirname(documentUri.fsPath);
        }

        // Fallback: Get from workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].uri.fsPath;
        }

        return undefined;
    }

    /**
     * Send search results to the sidebar webview
     */
    private _sendSearchResults(results: SearchResultItem[], searchType: 'broken' | 'text'): void {
        const message: SearchResultsMessage = {
            type: 'searchResults',
            results,
            searchType
        };
        this._view?.webview.postMessage(message);
    }

    /**
     * Send error message to sidebar
     */
    private _sendError(message: string): void {
        this._view?.webview.postMessage({
            type: 'error',
            message
        });
    }

    /**
     * Send no active panel message
     */
    private _sendNoActivePanel(): void {
        this._view?.webview.postMessage({
            type: 'noActivePanel'
        });
    }

    /**
     * Generate HTML for the sidebar webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const srcRoot = vscode.Uri.joinPath(this._extensionUri, 'src', 'html');
        const distRoot = vscode.Uri.joinPath(this._extensionUri, 'dist', 'src', 'html');
        const useSrc = fs.existsSync(vscode.Uri.joinPath(srcRoot, 'searchPanel.js').fsPath);
        const assetRoot = useSrc ? srcRoot : distRoot;

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'searchPanel.css')
        );
        const stringUtilsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'utils', 'stringUtils.js')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(assetRoot, 'searchPanel.js')
        );

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>Kanban Search</title>
</head>
<body>
        <div class="search-container">
        <!-- Mode Toggle -->
        <div class="mode-toggle">
            <button class="mode-btn active" data-mode="text" title="Search Text">
                <span class="codicon codicon-search"></span>
                Search
            </button>
            <button class="mode-btn" data-mode="broken" title="Find Broken Elements">
                <span class="codicon codicon-warning"></span>
                Broken
            </button>
        </div>

        <!-- Search Input (for text mode) -->
        <div class="search-input-container">
            <input type="text" class="search-input" placeholder="Search board content..." />
            <button class="search-btn" title="Search">
                <span class="codicon codicon-search"></span>
            </button>
        </div>

        <!-- Find Broken Button (for broken mode) -->
        <div class="find-broken-container" style="display: none;">
            <button class="find-broken-btn">
                <span class="codicon codicon-refresh"></span>
                Find Broken Elements
            </button>
        </div>

        <!-- Status Message -->
        <div class="status-message"></div>

        <!-- Results Container -->
        <div class="results-container">
            <div class="results-empty">
                <span class="codicon codicon-search"></span>
                <p>No results yet</p>
                <p class="hint">Click "Find Broken Elements" to scan the board</p>
            </div>
            <div class="results-list" style="display: none;"></div>
        </div>
    </div>

    <script nonce="${nonce}" src="${stringUtilsUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Generate a nonce for CSP
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Refresh the search results (called externally when board changes)
     */
    public refresh(): void {
        this._updatePanelStatus();
    }
}
