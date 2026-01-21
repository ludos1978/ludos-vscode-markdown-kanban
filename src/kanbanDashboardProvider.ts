/**
 * KanbanDashboardProvider - WebviewViewProvider for the Dashboard sidebar panel
 *
 * Aggregates data from multiple kanban boards showing:
 * - Upcoming items (tasks with temporal tags within configurable timeframe)
 * - All tags used per board
 * - Per-board configurable settings
 *
 * @module kanbanDashboardProvider
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { KanbanWebviewPanel } from './kanbanWebviewPanel';
import { MarkdownKanbanParser } from './markdownParser';
import {
    DashboardConfig,
    DashboardBoardConfig,
    DashboardData,
    UpcomingItem,
    BoardTagSummary,
    TagInfo,
    TagSearchResult,
    DashboardIncomingMessage
} from './dashboard/DashboardTypes';
import { DashboardScanner } from './dashboard/DashboardScanner';

/**
 * KanbanDashboardProvider - Sidebar panel for kanban dashboard
 */
export class KanbanDashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kanbanDashboard';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _extensionContext: vscode.ExtensionContext;
    private _config: DashboardConfig;
    private _fileWatchers: Map<string, vscode.Disposable> = new Map();

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._extensionUri = extensionUri;
        this._extensionContext = context;
        this._config = this._loadConfig();

        // Watch for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('markdown-kanban.dashboard')) {
                this._config = this._loadConfig();
                this._refreshData();
            }
        });
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
        webviewView.webview.onDidReceiveMessage(async (message: DashboardIncomingMessage) => {
            switch (message.type) {
                case 'dashboardReady':
                    this._refreshData();
                    break;
                case 'dashboardRefresh':
                    this._refreshData();
                    break;
                case 'dashboardAddBoard':
                    await this.addBoard(message.boardUri);
                    break;
                case 'dashboardRemoveBoard':
                    await this.removeBoard(message.boardUri);
                    break;
                case 'dashboardUpdateConfig':
                    await this._updateBoardConfig(
                        message.boardUri,
                        message.timeframe,
                        message.tagFilters,
                        message.enabled
                    );
                    break;
                case 'dashboardNavigate':
                    await this._handleNavigate(message.boardUri, message.columnIndex, message.taskIndex);
                    break;
                case 'dashboardTagSearch':
                    await this._handleTagSearch(message.tag);
                    break;
                case 'dashboardAddTagFilter':
                    await this._addTagFilter(message.boardUri, message.tag);
                    break;
                case 'dashboardRemoveTagFilter':
                    await this._removeTagFilter(message.boardUri, message.tag);
                    break;
            }
        });

        // Update when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._refreshData();
            }
        });

        // Setup file watchers for existing boards
        this._setupAllFileWatchers();
    }

    /**
     * Add a board to the dashboard
     */
    public async addBoard(uri: string): Promise<void> {
        // Check if already exists
        if (this._config.boards.some(b => b.uri === uri)) {
            return;
        }

        const newBoard: DashboardBoardConfig = {
            uri,
            timeframe: this._config.defaultTimeframe,
            tagFilters: [],
            enabled: true
        };

        this._config.boards.push(newBoard);
        await this._saveConfig();
        this._setupFileWatcher(uri);
        this._refreshData();
    }

    /**
     * Remove a board from the dashboard
     */
    public async removeBoard(uri: string): Promise<void> {
        const index = this._config.boards.findIndex(b => b.uri === uri);
        if (index === -1) return;

        this._config.boards.splice(index, 1);
        await this._saveConfig();

        // Remove file watcher
        this._fileWatchers.get(uri)?.dispose();
        this._fileWatchers.delete(uri);

        this._refreshData();
    }

    /**
     * Update a board's configuration
     */
    private async _updateBoardConfig(
        uri: string,
        timeframe?: 3 | 7 | 30,
        tagFilters?: string[],
        enabled?: boolean
    ): Promise<void> {
        const board = this._config.boards.find(b => b.uri === uri);
        if (!board) return;

        if (timeframe !== undefined) board.timeframe = timeframe;
        if (tagFilters !== undefined) board.tagFilters = tagFilters;
        if (enabled !== undefined) board.enabled = enabled;

        await this._saveConfig();
        this._refreshData();
    }

    /**
     * Load configuration from workspace settings
     */
    private _loadConfig(): DashboardConfig {
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        return {
            boards: config.get<DashboardBoardConfig[]>('dashboard.boards', []),
            defaultTimeframe: config.get<3 | 7 | 30>('dashboard.defaultTimeframe', 7)
        };
    }

    /**
     * Save configuration to workspace settings
     */
    private async _saveConfig(): Promise<void> {
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        await config.update('dashboard.boards', this._config.boards, vscode.ConfigurationTarget.Workspace);
    }

    /**
     * Setup file watchers for all configured boards
     */
    private _setupAllFileWatchers(): void {
        for (const board of this._config.boards) {
            this._setupFileWatcher(board.uri);
        }
    }

    /**
     * Setup file watcher for a single board
     */
    private _setupFileWatcher(boardUri: string): void {
        // Clean up existing watcher
        this._fileWatchers.get(boardUri)?.dispose();

        try {
            const uri = vscode.Uri.parse(boardUri);
            const pattern = new vscode.RelativePattern(
                vscode.Uri.file(path.dirname(uri.fsPath)),
                path.basename(uri.fsPath)
            );

            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            const disposable = vscode.Disposable.from(
                watcher,
                watcher.onDidChange(() => this._refreshData()),
                watcher.onDidDelete(() => {
                    // Optionally remove deleted boards
                    console.log(`[Dashboard] Board file deleted: ${boardUri}`);
                })
            );

            this._fileWatchers.set(boardUri, disposable);
        } catch (error) {
            console.error(`[Dashboard] Failed to setup watcher for ${boardUri}:`, error);
        }
    }

    /**
     * Refresh dashboard data
     */
    private async _refreshData(): Promise<void> {
        if (!this._view) return;

        const upcomingItems: UpcomingItem[] = [];
        const boardSummaries: BoardTagSummary[] = [];
        const taggedItems: TagSearchResult[] = [];

        for (const boardConfig of this._config.boards) {
            if (!boardConfig.enabled) continue;

            try {
                const result = await this._scanBoard(boardConfig);
                if (result) {
                    upcomingItems.push(...result.upcomingItems);
                    boardSummaries.push(result.summary);

                    // Collect items matching configured tag filters
                    console.log('[Dashboard] Board config:', boardConfig.uri, 'tagFilters:', boardConfig.tagFilters);
                    console.log('[Dashboard] result.board exists:', result.board ? 'yes' : 'no');
                    console.log('[Dashboard] result.board.columns:', result.board?.columns?.length || 0);
                    if (boardConfig.tagFilters && boardConfig.tagFilters.length > 0 && result.board) {
                        const boardName = path.basename(vscode.Uri.parse(boardConfig.uri).fsPath, '.md');
                        for (const tagFilter of boardConfig.tagFilters) {
                            console.log('[Dashboard] Searching for tag:', tagFilter, 'in board:', boardName);
                            const matches = DashboardScanner.searchByTag(
                                result.board,
                                boardConfig.uri,
                                boardName,
                                tagFilter
                            );
                            console.log('[Dashboard] Found', matches.length, 'matches for', tagFilter);
                            taggedItems.push(...matches);
                        }
                    }
                }
            } catch (error) {
                console.error(`[Dashboard] Error scanning board ${boardConfig.uri}:`, error);
            }
        }

        // Sort upcoming items by date
        upcomingItems.sort((a, b) => {
            if (a.date && b.date) {
                return a.date.getTime() - b.date.getTime();
            }
            if (a.date) return -1;
            if (b.date) return 1;
            return 0;
        });

        // Remove duplicate tagged items (same task might match multiple tags)
        const uniqueTaggedItems = taggedItems.filter((item, index, self) =>
            index === self.findIndex(t =>
                t.boardUri === item.boardUri &&
                t.columnIndex === item.columnIndex &&
                t.taskIndex === item.taskIndex
            )
        );

        const data: DashboardData = {
            upcomingItems,
            boardSummaries,
            config: this._config,
            taggedItems: uniqueTaggedItems
        };

        this._view.webview.postMessage({
            type: 'dashboardData',
            data
        });
    }

    /**
     * Scan a single board for upcoming items and tags
     */
    private async _scanBoard(boardConfig: DashboardBoardConfig): Promise<{
        upcomingItems: UpcomingItem[];
        summary: BoardTagSummary;
        board: import('./markdownParser').KanbanBoard;
    } | null> {
        try {
            const uri = vscode.Uri.parse(boardConfig.uri);

            // Check if file exists
            if (!fs.existsSync(uri.fsPath)) {
                return null;
            }

            // Read and parse the file
            const content = fs.readFileSync(uri.fsPath, 'utf-8');
            const basePath = path.dirname(uri.fsPath);
            const parseResult = MarkdownKanbanParser.parseMarkdown(content, basePath, undefined, uri.fsPath);

            if (!parseResult || !parseResult.board) {
                return null;
            }

            const board = parseResult.board;

            const boardName = path.basename(uri.fsPath, '.md');

            // Use DashboardScanner to extract data
            const scanResult = DashboardScanner.scanBoard(
                board,
                boardConfig.uri,
                boardName,
                boardConfig.timeframe
            );

            return {
                ...scanResult,
                board
            };
        } catch (error) {
            console.error(`[Dashboard] Error scanning board ${boardConfig.uri}:`, error);
            return null;
        }
    }

    /**
     * Handle navigation to a specific task
     */
    private async _handleNavigate(boardUri: string, columnIndex: number, taskIndex: number): Promise<void> {
        try {
            const uri = vscode.Uri.parse(boardUri);
            const document = await vscode.workspace.openTextDocument(uri);

            // Open/focus the kanban panel
            KanbanWebviewPanel.createOrShow(this._extensionUri, this._extensionContext, document);

            // Use document.uri.toString() to match how panels are stored in the map
            const panelKey = document.uri.toString();
            const panel = KanbanWebviewPanel.getPanelForDocument(panelKey);

            if (panel) {
                // Use position-based scroll which looks up elements by index
                panel.scrollToElementByIndex(columnIndex, taskIndex, true);
            } else {
                console.error(`[Dashboard] Panel not found for document: ${panelKey}`);
            }
        } catch (error) {
            console.error(`[Dashboard] Error navigating to task:`, error);
        }
    }

    /**
     * Handle tag search request
     */
    private async _handleTagSearch(tag: string): Promise<void> {
        if (!this._view || !tag.trim()) return;

        const results: TagSearchResult[] = [];

        for (const boardConfig of this._config.boards) {
            if (!boardConfig.enabled) continue;

            try {
                const uri = vscode.Uri.parse(boardConfig.uri);
                if (!fs.existsSync(uri.fsPath)) continue;

                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                const basePath = path.dirname(uri.fsPath);
                const parseResult = MarkdownKanbanParser.parseMarkdown(content, basePath, undefined, uri.fsPath);

                if (!parseResult?.board) continue;

                const boardName = path.basename(uri.fsPath, '.md');
                const boardResults = DashboardScanner.searchByTag(
                    parseResult.board,
                    boardConfig.uri,
                    boardName,
                    tag
                );
                results.push(...boardResults);
            } catch (error) {
                console.error(`[Dashboard] Error searching board ${boardConfig.uri}:`, error);
            }
        }

        this._view.webview.postMessage({
            type: 'dashboardTagSearchResults',
            tag,
            results
        });
    }

    /**
     * Add a tag filter to a board
     */
    private async _addTagFilter(boardUri: string, tag: string): Promise<void> {
        console.log('[Dashboard] _addTagFilter called:', boardUri, 'tag:', tag);
        const boardIndex = this._config.boards.findIndex(b => b.uri === boardUri);
        if (boardIndex === -1) {
            console.log('[Dashboard] Board not found in config');
            return;
        }

        const board = this._config.boards[boardIndex];
        if (!board.tagFilters) {
            board.tagFilters = [];
        }

        // Don't add duplicates
        if (!board.tagFilters.includes(tag)) {
            board.tagFilters.push(tag);
            console.log('[Dashboard] Tag added, new filters:', board.tagFilters);
            await this._saveConfig();
            this._refreshData();
        } else {
            console.log('[Dashboard] Tag already exists');
        }
    }

    /**
     * Remove a tag filter from a board
     */
    private async _removeTagFilter(boardUri: string, tag: string): Promise<void> {
        const boardIndex = this._config.boards.findIndex(b => b.uri === boardUri);
        if (boardIndex === -1) return;

        const board = this._config.boards[boardIndex];
        if (!board.tagFilters) return;

        const tagIndex = board.tagFilters.indexOf(tag);
        if (tagIndex !== -1) {
            board.tagFilters.splice(tagIndex, 1);
            await this._saveConfig();
            this._refreshData();
        }
    }

    /**
     * Generate HTML for the sidebar webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = this._getNonce();

        // Get URI for codicons CSS
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link href="${codiconsUri}" rel="stylesheet" />
    <title>Kanban Dashboard</title>
    <style>
        body {
            padding: 0;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            color: var(--vscode-foreground);
        }
        .dashboard-container {
            display: flex;
            flex-direction: column;
        }
        /* Tree row base styles - matches VS Code monaco-tl-row */
        .tree-row {
            display: flex;
            align-items: center;
            min-height: 22px;
            line-height: 22px;
            cursor: pointer;
            box-sizing: border-box;
            overflow: hidden;
            width: 100%;
            position: relative;
        }
        .tree-row:hover {
            background: var(--vscode-list-hoverBackground);
        }
        /* Indent guides - matches VS Code monaco-tl-indent */
        .tree-indent {
            display: flex;
            flex-shrink: 0;
            align-self: stretch;
        }
        .indent-guide {
            width: 8px;
            box-sizing: border-box;
            border-right: 1px solid transparent;
        }
        /* Show indent guides on hover like VS Code */
        .section-content:hover .indent-guide {
            border-right-color: var(--vscode-tree-indentGuidesStroke, rgba(128, 128, 128, 0.4));
        }
        /* Twistie - matches VS Code monaco-tl-twistie */
        .tree-twistie {
            width: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .tree-twistie.collapsible::before {
            font-family: codicon;
            content: '\\eab6';
            font-size: 16px;
            color: var(--vscode-foreground);
            opacity: 0.8;
            transition: transform 0.1s ease-out;
        }
        .tree-twistie.collapsible.expanded::before {
            transform: rotate(90deg);
        }
        /* Contents - matches VS Code monaco-tl-contents */
        .tree-contents {
            flex: 1;
            overflow: hidden;
            min-height: 22px;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        /* Label - matches VS Code monaco-icon-label */
        .tree-label {
            display: flex;
            align-items: baseline;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
        }
        .tree-label-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex-shrink: 1;
        }
        .tree-label-description {
            opacity: 0.6;
            margin-left: 0.5em;
            font-size: 0.9em;
            white-space: nowrap;
            flex-shrink: 0;
        }
        /* Two-line entry layout */
        .tree-row:has(.tree-label-2line) {
            min-height: 36px;
        }
        .tree-row:has(.tree-label-2line) .tree-contents {
            padding: 2px 0;
        }
        .tree-label-2line {
            display: flex;
            flex-direction: column;
            overflow: hidden;
            width: 100%;
            line-height: 1.3;
        }
        .tree-label-2line .entry-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .tree-label-2line .entry-location {
            opacity: 0.6;
            font-size: 0.9em;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        /* Section headers - matches VS Code pane-header */
        .section {
            overflow: hidden;
        }
        .section-header {
            padding-left: 4px;
        }
        .section-header h3 {
            margin: 0;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-sideBarSectionHeader-foreground);
        }
        .section-content {
            display: block;
            padding-left: 8px;
        }
        .section-content.collapsed {
            display: none;
        }
        /* Column match indicator */
        .column-match .tree-label-name {
            font-style: italic;
        }
        .tag-cloud {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .tag-item {
            padding: 2px 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px;
        }
        .tag-item.person {
            background: var(--vscode-terminal-ansiCyan);
        }
        .tag-item.temporal {
            background: var(--vscode-terminal-ansiYellow);
            color: var(--vscode-editor-foreground);
        }
        .board-config {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .board-config:last-child {
            border-bottom: none;
        }
        .board-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .timeframe-select {
            padding: 2px 4px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
        }
        .remove-btn {
            background: none;
            border: none;
            color: var(--vscode-errorForeground);
            cursor: pointer;
            padding: 2px 4px;
        }
        .remove-btn:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .empty-message {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        .add-board-hint {
            padding: 12px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 4px;
        }
        .refresh-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px;
        }
        .refresh-btn:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .tag-search-container {
            margin-bottom: 8px;
        }
        .tag-search-input {
            width: 100%;
            padding: 6px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            box-sizing: border-box;
        }
        .tag-search-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        /* Column match indicator - italic for column-level matches */
        .column-match .tree-label-name {
            font-style: italic;
        }
        .tag-search-header {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        /* Board config submenu */
        .board-config-body {
            display: none;
            margin-left: 24px;
            padding: 4px 0 8px 16px;
            border-left: 1px solid var(--vscode-tree-indentGuidesStroke, rgba(128, 128, 128, 0.4));
        }
        .board-config-body.expanded {
            display: block;
        }
        .board-config-row {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 22px;
            margin-bottom: 4px;
        }
        .board-config-row:last-child {
            margin-bottom: 0;
        }
        .board-config-label {
            color: var(--vscode-descriptionForeground);
            min-width: 70px;
        }
        .board-tag-filters {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 4px;
        }
        .board-tag-filter {
            padding: 2px 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 3px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .board-tag-filter-remove {
            cursor: pointer;
            opacity: 0.7;
        }
        .board-tag-filter-remove:hover {
            opacity: 1;
        }
        .board-tag-input {
            flex: 1;
            padding: 4px 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
        }
        /* Tree group for foldable sections */
        .tree-group-items {
            /* Prepare for 2-line entries if needed */
        }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <!-- Upcoming Items Section -->
        <div class="section">
            <div class="tree-row section-header" data-section="upcoming">
                <div class="tree-twistie collapsible expanded"></div>
                <div class="tree-contents">
                    <h3>Upcoming</h3>
                </div>
                <button class="refresh-btn" id="refresh-btn" title="Refresh">↻</button>
            </div>
            <div class="section-content" id="upcoming-content">
                <div class="empty-message" id="upcoming-empty">No upcoming items</div>
                <div id="upcoming-list"></div>
            </div>
        </div>

        <!-- Tagged Items Section -->
        <div class="section">
            <div class="tree-row section-header" data-section="tagged">
                <div class="tree-twistie collapsible expanded"></div>
                <div class="tree-contents">
                    <h3>Tagged Items</h3>
                </div>
            </div>
            <div class="section-content" id="tagged-content">
                <div class="empty-message" id="tagged-empty">No tag filters configured</div>
                <div id="tagged-list"></div>
            </div>
        </div>

        <!-- Hidden datalist for tag suggestions -->
        <datalist id="tag-suggestions"></datalist>

        <!-- Boards Configuration Section -->
        <div class="section">
            <div class="tree-row section-header" data-section="boards">
                <div class="tree-twistie collapsible expanded"></div>
                <div class="tree-contents">
                    <h3>Boards</h3>
                </div>
            </div>
            <div class="section-content" id="boards-content">
                <div id="boards-list"></div>
                <div class="add-board-hint">
                    Right-click .md → "Add to Dashboard"
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let dashboardData = null;

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            // Setup section toggle handlers
            document.querySelectorAll('.section-header[data-section]').forEach(header => {
                header.addEventListener('click', (e) => {
                    // Don't toggle if clicking on a button inside
                    if (e.target.closest('button')) return;
                    const sectionId = header.getAttribute('data-section');
                    toggleSection(sectionId);
                });
            });

            // Setup refresh button
            document.getElementById('refresh-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                refresh();
            });

            vscode.postMessage({ type: 'dashboardReady' });
        });

        // Handle messages from backend
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'dashboardData') {
                dashboardData = message.data;
                renderDashboard();
            }
        });

        function renderDashboard() {
            if (!dashboardData) return;
            renderUpcomingItems();
            renderTaggedItems();
            populateTagSuggestions();
            renderBoardsConfig();
        }

        function renderUpcomingItems() {
            const container = document.getElementById('upcoming-list');
            const emptyMsg = document.getElementById('upcoming-empty');
            const items = dashboardData.upcomingItems || [];

            if (items.length === 0) {
                container.innerHTML = '';
                emptyMsg.style.display = 'block';
                return;
            }

            emptyMsg.style.display = 'none';

            // Group by date
            const groups = {};
            items.forEach(item => {
                const dateKey = item.date ? formatDate(new Date(item.date)) : 'No Date';
                if (!groups[dateKey]) groups[dateKey] = [];
                groups[dateKey].push(item);
            });

            let html = '';
            for (const [date, groupItems] of Object.entries(groups)) {
                // Date group container
                html += '<div class="tree-group">';
                // Date group header - level 1 (foldable)
                html += '<div class="tree-row date-group-header tree-group-toggle">';
                html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible expanded"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(date) + '</span></div>';
                html += '</div>';
                // Items container - level 2
                html += '<div class="tree-group-items">';
                groupItems.forEach(item => {
                    html += '<div class="tree-row upcoming-item" data-board-uri="' + escapeHtml(item.boardUri) + '" ';
                    html += 'data-column-index="' + item.columnIndex + '" data-task-index="' + item.taskIndex + '">';
                    html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                    html += '<div class="tree-twistie"></div>';
                    html += '<div class="tree-contents"><div class="tree-label-2line">';
                    html += '<span class="entry-title">' + escapeHtml(item.taskTitle) + '</span>';
                    html += '<span class="entry-location">' + escapeHtml(item.boardName) + ' / ' + escapeHtml(item.columnTitle) + '</span>';
                    html += '</div></div>';
                    html += '</div>';
                });
                html += '</div></div>';
            }

            container.innerHTML = html;

            // Add click listeners to upcoming items
            container.querySelectorAll('.upcoming-item').forEach(item => {
                item.addEventListener('click', () => {
                    const boardUri = item.getAttribute('data-board-uri');
                    const columnIndex = parseInt(item.getAttribute('data-column-index'), 10);
                    const taskIndex = parseInt(item.getAttribute('data-task-index'), 10);
                    navigateToTask(boardUri, columnIndex, taskIndex);
                });
            });

            // Add click listeners to toggle date groups
            container.querySelectorAll('.tree-group-toggle').forEach(toggle => {
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const group = toggle.closest('.tree-group');
                    const twistie = toggle.querySelector('.tree-twistie');
                    const items = group.querySelector('.tree-group-items');
                    if (twistie.classList.contains('expanded')) {
                        twistie.classList.remove('expanded');
                        items.style.display = 'none';
                    } else {
                        twistie.classList.add('expanded');
                        items.style.display = 'block';
                    }
                });
            });
        }

        function populateTagSuggestions() {
            const datalist = document.getElementById('tag-suggestions');
            const summaries = dashboardData.boardSummaries || [];

            // Collect all unique tags from all boards
            const allTags = new Map();
            summaries.forEach(summary => {
                (summary.tags || []).forEach(tag => {
                    if (!allTags.has(tag.name)) {
                        allTags.set(tag.name, tag);
                    } else {
                        // Merge counts
                        allTags.get(tag.name).count += tag.count;
                    }
                });
            });

            // Sort by count descending and create options
            const sortedTags = Array.from(allTags.values()).sort((a, b) => b.count - a.count);
            datalist.innerHTML = sortedTags.map(tag =>
                '<option value="' + escapeHtml(tag.name) + '">' + escapeHtml(tag.name) + ' (' + tag.count + ')</option>'
            ).join('');
        }

        function renderTaggedItems() {
            const section = document.querySelector('[data-section="tagged"]')?.closest('.section');
            const container = document.getElementById('tagged-list');
            const emptyMsg = document.getElementById('tagged-empty');
            const items = dashboardData.taggedItems || [];

            // Check if any boards have tag filters configured
            const hasTagFilters = (dashboardData.config?.boards || []).some(b => b.tagFilters && b.tagFilters.length > 0);

            // Hide entire section if no tag filters configured
            if (!hasTagFilters) {
                if (section) section.style.display = 'none';
                return;
            }

            if (section) section.style.display = 'block';

            if (items.length === 0) {
                container.innerHTML = '';
                emptyMsg.textContent = 'No tasks match configured tag filters';
                emptyMsg.style.display = 'block';
                return;
            }

            emptyMsg.style.display = 'none';

            // Group by matched tag
            const groups = {};
            items.forEach(item => {
                const tagKey = item.matchedTag || 'Other';
                if (!groups[tagKey]) groups[tagKey] = [];
                groups[tagKey].push(item);
            });

            let html = '';
            for (const [tag, groupItems] of Object.entries(groups)) {
                // Tag group container
                html += '<div class="tree-group">';
                // Tag group header - level 1 (foldable)
                html += '<div class="tree-row tree-group-toggle">';
                html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible expanded"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name">' + escapeHtml(tag) + ' (' + groupItems.length + ')</span></div>';
                html += '</div>';
                // Items container - level 2
                html += '<div class="tree-group-items">';
                groupItems.forEach(item => {
                    const isColumnMatch = item.taskIndex === -1;
                    html += '<div class="tree-row tag-search-result' + (isColumnMatch ? ' column-match' : '') + '" data-board-uri="' + escapeHtml(item.boardUri) + '" ';
                    html += 'data-column-index="' + item.columnIndex + '" data-task-index="' + item.taskIndex + '">';
                    html += '<div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>';
                    html += '<div class="tree-twistie"></div>';
                    html += '<div class="tree-contents"><div class="tree-label-2line">';
                    if (isColumnMatch) {
                        html += '<span class="entry-title">[Col] ' + escapeHtml(item.columnTitle) + '</span>';
                    } else {
                        html += '<span class="entry-title">' + escapeHtml(item.taskTitle) + '</span>';
                    }
                    html += '<span class="entry-location">' + escapeHtml(item.boardName) + ' / ' + escapeHtml(item.columnTitle) + '</span>';
                    html += '</div></div>';
                    html += '</div>';
                });
                html += '</div></div>';
            }

            container.innerHTML = html;

            // Add click listeners for items
            container.querySelectorAll('.tag-search-result').forEach(item => {
                item.addEventListener('click', () => {
                    const boardUri = item.getAttribute('data-board-uri');
                    const columnIndex = parseInt(item.getAttribute('data-column-index'), 10);
                    const taskIndex = parseInt(item.getAttribute('data-task-index'), 10);
                    navigateToTask(boardUri, columnIndex, taskIndex);
                });
            });

            // Add click listeners to toggle tag groups
            container.querySelectorAll('.tree-group-toggle').forEach(toggle => {
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const group = toggle.closest('.tree-group');
                    const twistie = toggle.querySelector('.tree-twistie');
                    const items = group.querySelector('.tree-group-items');
                    if (twistie.classList.contains('expanded')) {
                        twistie.classList.remove('expanded');
                        items.style.display = 'none';
                    } else {
                        twistie.classList.add('expanded');
                        items.style.display = 'block';
                    }
                });
            });
        }

        function renderBoardsConfig() {
            const container = document.getElementById('boards-list');
            const hint = document.querySelector('.add-board-hint');
            const boards = dashboardData.config?.boards || [];

            // Show hint only when no boards configured
            if (hint) {
                hint.style.display = boards.length === 0 ? 'block' : 'none';
            }

            if (boards.length === 0) {
                container.innerHTML = '<div class="empty-message">No boards added yet</div>';
                return;
            }

            // Save expanded state before re-rendering
            const expandedBoards = new Set();
            container.querySelectorAll('.board-config-item').forEach(item => {
                const body = item.querySelector('.board-config-body');
                if (body && body.classList.contains('expanded')) {
                    expandedBoards.add(item.getAttribute('data-board-uri'));
                }
            });

            let html = '';
            boards.forEach((board, index) => {
                const name = board.uri.split('/').pop().replace('.md', '');
                const tagFilters = board.tagFilters || [];

                html += '<div class="board-config-item" data-board-uri="' + escapeHtml(board.uri) + '">';

                // Header (clickable to expand/collapse) - tree row style
                html += '<div class="tree-row board-config-header">';
                html += '<div class="tree-indent"><div class="indent-guide"></div></div>';
                html += '<div class="tree-twistie collapsible board-config-toggle"></div>';
                html += '<div class="tree-contents"><span class="tree-label-name" title="' + escapeHtml(board.uri) + '">' + escapeHtml(name) + '</span></div>';
                html += '<button class="remove-btn" data-board-uri="' + escapeHtml(board.uri) + '" title="Remove">✕</button>';
                html += '</div>';

                // Body (expandable)
                html += '<div class="board-config-body">';

                // Timeframe row
                html += '<div class="board-config-row">';
                html += '<span class="board-config-label">Timeframe:</span>';
                html += '<select class="timeframe-select" data-board-uri="' + escapeHtml(board.uri) + '">';
                html += '<option value="3"' + (board.timeframe === 3 ? ' selected' : '') + '>3 days</option>';
                html += '<option value="7"' + (board.timeframe === 7 ? ' selected' : '') + '>7 days</option>';
                html += '<option value="30"' + (board.timeframe === 30 ? ' selected' : '') + '>30 days</option>';
                html += '</select>';
                html += '</div>';

                // Tag filters row
                html += '<div class="board-config-row" style="flex-direction: column; align-items: stretch;">';
                html += '<div style="display: flex; align-items: center; gap: 8px;">';
                html += '<span class="board-config-label">Tags:</span>';
                html += '<input type="text" class="board-tag-input" data-board-uri="' + escapeHtml(board.uri) + '" ';
                html += 'list="tag-suggestions" placeholder="Add tag...">';
                html += '</div>';

                // Current tag filters
                if (tagFilters.length > 0) {
                    html += '<div class="board-tag-filters">';
                    tagFilters.forEach(tag => {
                        html += '<span class="board-tag-filter" data-board-uri="' + escapeHtml(board.uri) + '" data-tag="' + escapeHtml(tag) + '">';
                        html += escapeHtml(tag);
                        html += '<span class="board-tag-filter-remove">✕</span>';
                        html += '</span>';
                    });
                    html += '</div>';
                }

                html += '</div>';
                html += '</div>';
                html += '</div>';
            });

            container.innerHTML = html;

            // Restore expanded state
            container.querySelectorAll('.board-config-item').forEach(item => {
                const uri = item.getAttribute('data-board-uri');
                if (expandedBoards.has(uri)) {
                    const toggle = item.querySelector('.board-config-toggle');
                    const body = item.querySelector('.board-config-body');
                    if (toggle) toggle.classList.add('expanded');
                    if (body) body.classList.add('expanded');
                }
            });

            // Add event listeners for board header toggle
            container.querySelectorAll('.board-config-header').forEach(header => {
                header.addEventListener('click', (e) => {
                    if (e.target.closest('.remove-btn')) return;
                    const item = header.closest('.board-config-item');
                    const toggle = header.querySelector('.board-config-toggle');
                    const body = item.querySelector('.board-config-body');
                    toggle.classList.toggle('expanded');
                    body.classList.toggle('expanded');
                });
            });

            // Add event listeners for timeframe selects
            container.querySelectorAll('.timeframe-select').forEach(select => {
                select.addEventListener('change', () => {
                    const boardUri = select.getAttribute('data-board-uri');
                    updateTimeframe(boardUri, select.value);
                });
            });

            // Add event listeners for remove buttons
            container.querySelectorAll('.remove-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const boardUri = btn.getAttribute('data-board-uri');
                    removeBoard(boardUri);
                });
            });

            // Add event listeners for tag input
            container.querySelectorAll('.board-tag-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const boardUri = input.getAttribute('data-board-uri');
                    const tag = e.target.value.trim();
                    if (tag) {
                        addTagFilter(boardUri, tag);
                        e.target.value = '';
                    }
                });
                // Also handle Enter key for custom tags
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const boardUri = input.getAttribute('data-board-uri');
                        const tag = e.target.value.trim();
                        if (tag) {
                            addTagFilter(boardUri, tag);
                            e.target.value = '';
                        }
                    }
                });
            });

            // Add event listeners for tag filter removal
            container.querySelectorAll('.board-tag-filter-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    const filter = btn.closest('.board-tag-filter');
                    const boardUri = filter.getAttribute('data-board-uri');
                    const tag = filter.getAttribute('data-tag');
                    removeTagFilter(boardUri, tag);
                });
            });
        }


        function toggleSection(sectionId) {
            const header = document.querySelector('.section-header[data-section="' + sectionId + '"]');
            const twistie = header.querySelector('.tree-twistie');
            const content = document.getElementById(sectionId + '-content');
            twistie.classList.toggle('expanded');
            content.classList.toggle('collapsed');
        }

        function refresh() {
            vscode.postMessage({ type: 'dashboardRefresh' });
        }

        function navigateToTask(boardUri, columnIndex, taskIndex) {
            vscode.postMessage({
                type: 'dashboardNavigate',
                boardUri,
                columnIndex,
                taskIndex
            });
        }

        function updateTimeframe(boardUri, timeframe) {
            vscode.postMessage({
                type: 'dashboardUpdateConfig',
                boardUri,
                timeframe: parseInt(timeframe)
            });
        }

        function removeBoard(boardUri) {
            vscode.postMessage({
                type: 'dashboardRemoveBoard',
                boardUri
            });
        }

        function addTagFilter(boardUri, tag) {
            vscode.postMessage({
                type: 'dashboardAddTagFilter',
                boardUri,
                tag
            });
        }

        function removeTagFilter(boardUri, tag) {
            vscode.postMessage({
                type: 'dashboardRemoveTagFilter',
                boardUri,
                tag
            });
        }

        function formatDate(date) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);

            const diff = Math.floor((d - today) / (1000 * 60 * 60 * 24));

            if (diff === 0) return 'Today';
            if (diff === 1) return 'Tomorrow';
            if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    </script>
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
     * Dispose of resources
     */
    public dispose(): void {
        for (const watcher of this._fileWatchers.values()) {
            watcher.dispose();
        }
        this._fileWatchers.clear();
    }
}
