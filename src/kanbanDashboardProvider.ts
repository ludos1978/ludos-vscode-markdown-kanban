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
                    await this._handleNavigate(message.boardUri, message.columnId, message.taskId);
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

        for (const boardConfig of this._config.boards) {
            if (!boardConfig.enabled) continue;

            try {
                const result = await this._scanBoard(boardConfig);
                if (result) {
                    upcomingItems.push(...result.upcomingItems);
                    boardSummaries.push(result.summary);
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

        const data: DashboardData = {
            upcomingItems,
            boardSummaries,
            config: this._config
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
            return DashboardScanner.scanBoard(
                board,
                boardConfig.uri,
                boardName,
                boardConfig.timeframe
            );
        } catch (error) {
            console.error(`[Dashboard] Error scanning board ${boardConfig.uri}:`, error);
            return null;
        }
    }

    /**
     * Handle navigation to a specific task
     */
    private async _handleNavigate(boardUri: string, columnId: string, taskId: string): Promise<void> {
        try {
            const uri = vscode.Uri.parse(boardUri);
            const document = await vscode.workspace.openTextDocument(uri);

            // Open/focus the kanban panel
            KanbanWebviewPanel.createOrShow(this._extensionUri, this._extensionContext, document);

            // Wait a bit for the panel to be ready, then send scroll message
            setTimeout(() => {
                const panel = KanbanWebviewPanel.getPanelForDocument(boardUri);
                if (panel) {
                    panel.getPanel().webview.postMessage({
                        type: 'scrollToElement',
                        columnId,
                        taskId,
                        highlight: true
                    });
                }
            }, 500);
        } catch (error) {
            console.error(`[Dashboard] Error navigating to task:`, error);
        }
    }

    /**
     * Generate HTML for the sidebar webview
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Kanban Dashboard</title>
    <style>
        body {
            padding: 8px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
        }
        .dashboard-container {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .section {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }
        .section-header {
            padding: 8px 12px;
            background: var(--vscode-sideBarSectionHeader-background);
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }
        .section-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .section-content {
            padding: 8px;
        }
        .upcoming-item {
            padding: 6px 8px;
            cursor: pointer;
            border-radius: 3px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .upcoming-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .upcoming-date {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .upcoming-title {
            font-size: 13px;
        }
        .upcoming-board {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
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
            font-size: 11px;
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
            font-size: 11px;
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
        .date-group {
            margin-bottom: 12px;
        }
        .date-group-header {
            font-weight: 600;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
            padding-bottom: 4px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <!-- Upcoming Items Section -->
        <div class="section">
            <div class="section-header" onclick="toggleSection('upcoming')">
                <span>Upcoming Items</span>
                <button class="refresh-btn" onclick="event.stopPropagation(); refresh()" title="Refresh">↻</button>
            </div>
            <div class="section-content" id="upcoming-content">
                <div class="empty-message" id="upcoming-empty">No upcoming items</div>
                <div id="upcoming-list"></div>
            </div>
        </div>

        <!-- Tags Section -->
        <div class="section">
            <div class="section-header" onclick="toggleSection('tags')">
                <span>Tags by Board</span>
            </div>
            <div class="section-content" id="tags-content">
                <div class="empty-message" id="tags-empty">No boards configured</div>
                <div id="tags-list"></div>
            </div>
        </div>

        <!-- Boards Configuration Section -->
        <div class="section">
            <div class="section-header" onclick="toggleSection('boards')">
                <span>Configured Boards</span>
            </div>
            <div class="section-content" id="boards-content">
                <div id="boards-list"></div>
                <div class="add-board-hint">
                    Right-click a .md file in Explorer or Kanban Boards sidebar → "Add to Dashboard"
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let dashboardData = null;

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
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
            renderTagsByBoard();
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
                html += '<div class="date-group">';
                html += '<div class="date-group-header">' + escapeHtml(date) + '</div>';
                groupItems.forEach(item => {
                    html += '<div class="upcoming-item" onclick="navigateToTask(\\'';
                    html += escapeHtml(item.boardUri) + '\\', \\'';
                    html += escapeHtml(item.columnId) + '\\', \\'';
                    html += escapeHtml(item.taskId) + '\\')">';
                    html += '<span class="upcoming-title">' + escapeHtml(item.taskTitle) + '</span>';
                    html += '<span class="upcoming-board">' + escapeHtml(item.boardName) + ' / ' + escapeHtml(item.columnTitle) + '</span>';
                    html += '</div>';
                });
                html += '</div>';
            }

            container.innerHTML = html;
        }

        function renderTagsByBoard() {
            const container = document.getElementById('tags-list');
            const emptyMsg = document.getElementById('tags-empty');
            const summaries = dashboardData.boardSummaries || [];

            if (summaries.length === 0) {
                container.innerHTML = '';
                emptyMsg.style.display = 'block';
                return;
            }

            emptyMsg.style.display = 'none';

            let html = '';
            summaries.forEach(summary => {
                html += '<div style="margin-bottom: 12px;">';
                html += '<div style="font-weight: 600; margin-bottom: 4px;">' + escapeHtml(summary.boardName) + '</div>';
                html += '<div class="tag-cloud">';
                summary.tags.slice(0, 20).forEach(tag => {
                    const typeClass = tag.type === 'person' ? 'person' : (tag.type === 'temporal' ? 'temporal' : '');
                    html += '<span class="tag-item ' + typeClass + '">' + escapeHtml(tag.name) + ' (' + tag.count + ')</span>';
                });
                html += '</div>';
                html += '</div>';
            });

            container.innerHTML = html;
        }

        function renderBoardsConfig() {
            const container = document.getElementById('boards-list');
            const boards = dashboardData.config?.boards || [];

            if (boards.length === 0) {
                container.innerHTML = '<div class="empty-message">No boards added yet</div>';
                return;
            }

            let html = '';
            boards.forEach(board => {
                const name = board.uri.split('/').pop().replace('.md', '');
                html += '<div class="board-config">';
                html += '<span class="board-name" title="' + escapeHtml(board.uri) + '">' + escapeHtml(name) + '</span>';
                html += '<select class="timeframe-select" onchange="updateTimeframe(\\'' + escapeHtml(board.uri) + '\\', this.value)">';
                html += '<option value="3"' + (board.timeframe === 3 ? ' selected' : '') + '>3 days</option>';
                html += '<option value="7"' + (board.timeframe === 7 ? ' selected' : '') + '>7 days</option>';
                html += '<option value="30"' + (board.timeframe === 30 ? ' selected' : '') + '>30 days</option>';
                html += '</select>';
                html += '<button class="remove-btn" onclick="removeBoard(\\'' + escapeHtml(board.uri) + '\\')" title="Remove">✕</button>';
                html += '</div>';
            });

            container.innerHTML = html;
        }


        function toggleSection(sectionId) {
            const content = document.getElementById(sectionId + '-content');
            content.style.display = content.style.display === 'none' ? 'block' : 'none';
        }

        function refresh() {
            vscode.postMessage({ type: 'dashboardRefresh' });
        }

        function navigateToTask(boardUri, columnId, taskId) {
            vscode.postMessage({
                type: 'dashboardNavigate',
                boardUri,
                columnId,
                taskId
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
