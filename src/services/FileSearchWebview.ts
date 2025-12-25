/**
 * FileSearchWebview - Custom webview-based file search dialog
 *
 * Provides a customizable file search dialog with:
 * - 80% screen width
 * - Full path display without truncation
 * - Search toggles (case sensitive, whole word, regex)
 * - File preview on selection
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { escapeRegExp, safeDecodeURIComponent } from '../utils/stringUtils';
import {
    SEARCH_DEBOUNCE_DELAY_MS,
    MAX_SEARCH_RESULTS,
    MAX_RESULTS_PER_PATTERN,
    MAX_REGEX_RESULTS
} from '../constants/TimeoutConstants';

interface SearchResult {
    label: string;
    fullPath: string;
    relativePath: string;
}

export class FileSearchWebview {
    private _panel: vscode.WebviewPanel | undefined;
    private _extensionUri: vscode.Uri;
    private _resolveSelection: ((uri: vscode.Uri | undefined) => void) | undefined;
    private _searchSeq = 0;
    private _debounceTimer: NodeJS.Timeout | undefined;
    private _baseDir: string | undefined;
    private _previewEditor: vscode.TextEditor | undefined;

    // Search options
    private _caseSensitive = false;
    private _wholeWord = false;
    private _useRegex = false;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    async pickReplacementForBrokenLink(originalPath: string, baseDir?: string): Promise<vscode.Uri | undefined> {
        const decodedPath = safeDecodeURIComponent(originalPath);
        const nameRoot = path.parse(path.basename(decodedPath)).name;
        this._baseDir = baseDir;

        return new Promise((resolve) => {
            this._resolveSelection = resolve;
            this._createPanel(decodedPath, nameRoot);
        });
    }

    private _createPanel(originalPath: string, initialSearch: string): void {
        this._panel = vscode.window.createWebviewPanel(
            'fileSearch',
            'Search for File',
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: [this._extensionUri]
            }
        );

        this._panel.webview.html = this._getWebviewContent(originalPath, initialSearch);

        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'search':
                    this._handleSearch(message.term);
                    break;
                case 'select':
                    this._handleSelect(message.path);
                    break;
                case 'preview':
                    this._handlePreview(message.path);
                    break;
                case 'cancel':
                    this._handleCancel();
                    break;
                case 'toggleOption':
                    this._handleToggleOption(message.option);
                    break;
            }
        });

        this._panel.onDidDispose(() => {
            this._cleanup();
            if (this._resolveSelection) {
                this._resolveSelection(undefined);
                this._resolveSelection = undefined;
            }
        });

        // Start initial search
        setTimeout(() => this._handleSearch(initialSearch), 100);
    }

    private _handleSearch(term: string): void {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            this._performSearch(term);
        }, SEARCH_DEBOUNCE_DELAY_MS);
    }

    private async _performSearch(term: string): Promise<void> {
        this._searchSeq += 1;
        const seq = this._searchSeq;
        const rawTerm = term.trim();
        const normalized = this._caseSensitive ? rawTerm : rawTerm.toLowerCase();

        // Send loading state
        this._panel?.webview.postMessage({ type: 'searching' });

        const results: SearchResult[] = [];
        const seen = new Set<string>();

        const makeRegex = (pattern: string): RegExp | undefined => {
            try {
                return new RegExp(pattern, this._caseSensitive ? '' : 'i');
            } catch {
                return undefined;
            }
        };

        const nameMatches = (fsPath: string): boolean => {
            if (!rawTerm) return true;
            const base = path.basename(fsPath);
            const parsed = path.parse(base);
            const baseNoExt = parsed.name;
            const candidateA = this._caseSensitive ? baseNoExt : baseNoExt.toLowerCase();
            const candidateB = this._caseSensitive ? base : base.toLowerCase();

            if (this._useRegex) {
                const rx = makeRegex(rawTerm);
                if (!rx) return false;
                return rx.test(baseNoExt) || rx.test(base);
            }
            if (this._wholeWord) {
                const rx = makeRegex(`\\b${escapeRegExp(rawTerm)}\\b`);
                if (!rx) return false;
                return rx.test(baseNoExt) || rx.test(base);
            }
            return candidateA.includes(normalized) || candidateB.includes(normalized);
        };

        const addResult = (uri: vscode.Uri): void => {
            if (seq !== this._searchSeq) return;
            if (!nameMatches(uri.fsPath)) return;
            if (seen.has(uri.fsPath)) return;
            seen.add(uri.fsPath);
            results.push({
                label: path.basename(uri.fsPath),
                fullPath: uri.fsPath,
                relativePath: vscode.workspace.asRelativePath(uri.fsPath)
            });
        };

        // Workspace search
        const excludePattern = '**/node_modules/**';
        const globTerm = rawTerm && !this._useRegex ? rawTerm : term;
        const patterns = this._useRegex
            ? (rawTerm ? ['**/*', '**/*.*'] : [`**/${term}`, `**/${term}.*`])
            : (globTerm ? [`**/*${globTerm}*`, `**/*${globTerm}*.*`] : [`**/${term}`, `**/${term}.*`]);

        try {
            const maxPerPattern = this._useRegex ? MAX_REGEX_RESULTS : MAX_RESULTS_PER_PATTERN;
            const ops = patterns.map(p => vscode.workspace.findFiles(p, excludePattern, maxPerPattern));
            const batches = await Promise.all(ops);
            for (const batch of batches) {
                for (const uri of batch) {
                    if (seq !== this._searchSeq) return;
                    addResult(uri);
                }
            }
        } catch (error) {
            console.warn('[FileSearchWebview] Workspace search failed:', error);
        }

        // Base directory scan
        if (this._baseDir) {
            try {
                const visited = new Set<string>();
                let foundCount = 0;
                const maxResults = MAX_SEARCH_RESULTS;

                const scan = async (dirFsPath: string): Promise<void> => {
                    if (seq !== this._searchSeq) return;
                    if (foundCount >= maxResults) return;
                    if (visited.has(dirFsPath)) return;
                    visited.add(dirFsPath);

                    const baseName = path.basename(dirFsPath);
                    if (['node_modules', '.git', 'dist', 'out'].includes(baseName)) return;

                    let entries: [string, vscode.FileType][];
                    try {
                        entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirFsPath));
                    } catch {
                        return;
                    }

                    for (const [name, type] of entries) {
                        if (seq !== this._searchSeq) return;
                        if (foundCount >= maxResults) break;

                        const childPath = path.join(dirFsPath, name);
                        if (type === vscode.FileType.Directory) {
                            await scan(childPath);
                        } else if (type === vscode.FileType.File) {
                            addResult(vscode.Uri.file(childPath));
                            foundCount++;
                        }
                    }
                };

                await scan(this._baseDir);
            } catch (error) {
                console.warn('[FileSearchWebview] BaseDir scan failed:', error);
            }
        }

        if (seq !== this._searchSeq) return;

        // Send results to webview
        this._panel?.webview.postMessage({
            type: 'results',
            results: results,
            term: rawTerm
        });
    }

    private _handleSelect(filePath: string): void {
        if (this._resolveSelection) {
            this._resolveSelection(vscode.Uri.file(filePath));
            this._resolveSelection = undefined;
        }
        this._cleanup();
        this._panel?.dispose();
    }

    private async _handlePreview(filePath: string): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(filePath);
            this._previewEditor = await vscode.window.showTextDocument(doc, {
                preview: true,
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Beside
            });
        } catch (error) {
            console.warn('[FileSearchWebview] Cannot preview file:', error);
        }
    }

    private _handleCancel(): void {
        if (this._resolveSelection) {
            this._resolveSelection(undefined);
            this._resolveSelection = undefined;
        }
        this._cleanup();
        this._panel?.dispose();
    }

    private _handleToggleOption(option: string): void {
        switch (option) {
            case 'caseSensitive':
                this._caseSensitive = !this._caseSensitive;
                break;
            case 'wholeWord':
                this._wholeWord = !this._wholeWord;
                break;
            case 'regex':
                this._useRegex = !this._useRegex;
                break;
        }
        // Send updated state
        this._panel?.webview.postMessage({
            type: 'optionsUpdated',
            caseSensitive: this._caseSensitive,
            wholeWord: this._wholeWord,
            regex: this._useRegex
        });
    }

    private async _cleanup(): Promise<void> {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        // Close preview editor
        if (this._previewEditor) {
            try {
                const targetUri = this._previewEditor.document.uri.toString();
                const tabsToClose: vscode.Tab[] = [];
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        const tabInput = tab.input as vscode.TabInputText | undefined;
                        const tabUri = tabInput?.uri?.toString();
                        if (tabUri === targetUri && tab.isPreview) {
                            tabsToClose.push(tab);
                        }
                    }
                }
                if (tabsToClose.length > 0) {
                    await vscode.window.tabGroups.close(tabsToClose);
                }
            } catch { /* ignore */ }
        }
    }

    private _getWebviewContent(originalPath: string, initialSearch: string): string {
        const escapedPath = this._escapeHtml(originalPath);
        const escapedSearch = this._escapeHtml(initialSearch);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Search for File</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground, #cccccc);
            background: var(--vscode-editor-background, #1e1e1e);
            padding: 0;
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            padding: 16px 20px;
            background: var(--vscode-titleBar-activeBackground, #3c3c3c);
            border-bottom: 1px solid var(--vscode-widget-border, #454545);
        }

        .title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-titleBar-activeForeground, #ffffff);
        }

        .subtitle {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #969696);
            word-break: break-all;
        }

        .search-container {
            padding: 12px 20px;
            background: var(--vscode-input-background, #3c3c3c);
            border-bottom: 1px solid var(--vscode-widget-border, #454545);
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .search-input {
            flex: 1;
            padding: 8px 12px;
            font-size: 14px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            border-radius: 4px;
            outline: none;
        }

        .search-input:focus {
            border-color: var(--vscode-focusBorder, #007acc);
        }

        .toggle-btn {
            padding: 6px 10px;
            font-size: 12px;
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-secondaryBackground, #3c3c3c);
            color: var(--vscode-button-secondaryForeground, #cccccc);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s;
        }

        .toggle-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground, #4c4c4c);
        }

        .toggle-btn.active {
            background: var(--vscode-button-background, #007acc);
            color: var(--vscode-button-foreground, #ffffff);
        }

        .results-container {
            flex: 1;
            overflow-y: auto;
            padding: 8px 0;
        }

        .result-item {
            padding: 10px 20px;
            cursor: pointer;
            border-left: 3px solid transparent;
            transition: all 0.1s;
        }

        .result-item:hover {
            background: var(--vscode-list-hoverBackground, #2a2d2e);
        }

        .result-item.selected {
            background: var(--vscode-list-activeSelectionBackground, #094771);
            border-left-color: var(--vscode-focusBorder, #007acc);
        }

        .result-label {
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 4px;
            color: var(--vscode-list-activeSelectionForeground, #ffffff);
        }

        .result-path {
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #969696);
            word-break: break-all;
            font-family: var(--vscode-editor-font-family, monospace);
        }

        .result-relative {
            font-size: 11px;
            color: var(--vscode-textLink-foreground, #3794ff);
            margin-top: 2px;
        }

        .status {
            padding: 20px;
            text-align: center;
            color: var(--vscode-descriptionForeground, #969696);
        }

        .status.searching::after {
            content: '';
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid var(--vscode-progressBar-background, #007acc);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-left: 8px;
            vertical-align: middle;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .footer {
            padding: 12px 20px;
            background: var(--vscode-titleBar-activeBackground, #3c3c3c);
            border-top: 1px solid var(--vscode-widget-border, #454545);
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        .btn {
            padding: 8px 16px;
            font-size: 13px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s;
        }

        .btn-primary {
            background: var(--vscode-button-background, #007acc);
            color: var(--vscode-button-foreground, #ffffff);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground, #0062a3);
        }

        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground, #3c3c3c);
            color: var(--vscode-button-secondaryForeground, #cccccc);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground, #4c4c4c);
        }

        .keyboard-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #969696);
            margin-right: auto;
            display: flex;
            align-items: center;
            gap: 16px;
        }

        kbd {
            background: var(--vscode-keybindingLabel-background, #333);
            border: 1px solid var(--vscode-keybindingLabel-border, #444);
            border-radius: 3px;
            padding: 2px 6px;
            font-family: inherit;
            font-size: 11px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">File not found</div>
        <div class="subtitle">${escapedPath}</div>
    </div>

    <div class="search-container">
        <input type="text"
               class="search-input"
               id="searchInput"
               placeholder="Search for file..."
               value="${escapedSearch}"
               autofocus>
        <button class="toggle-btn" id="caseBtn" title="Match Case (Alt+C)">Aa</button>
        <button class="toggle-btn" id="wordBtn" title="Whole Word (Alt+W)">Ab</button>
        <button class="toggle-btn" id="regexBtn" title="Regular Expression (Alt+R)">.*</button>
    </div>

    <div class="results-container" id="resultsContainer">
        <div class="status searching" id="status">Searching...</div>
    </div>

    <div class="footer">
        <div class="keyboard-hint">
            <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
            <span><kbd>Enter</kbd> Select</span>
            <span><kbd>Esc</kbd> Cancel</span>
        </div>
        <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        <button class="btn btn-primary" id="selectBtn" disabled>Select</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        let results = [];
        let selectedIndex = -1;

        const searchInput = document.getElementById('searchInput');
        const resultsContainer = document.getElementById('resultsContainer');
        const statusEl = document.getElementById('status');
        const selectBtn = document.getElementById('selectBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const caseBtn = document.getElementById('caseBtn');
        const wordBtn = document.getElementById('wordBtn');
        const regexBtn = document.getElementById('regexBtn');

        // Search input handler
        searchInput.addEventListener('input', () => {
            vscode.postMessage({ type: 'search', term: searchInput.value });
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                vscode.postMessage({ type: 'cancel' });
            } else if (e.key === 'Enter') {
                if (selectedIndex >= 0 && results[selectedIndex]) {
                    vscode.postMessage({ type: 'select', path: results[selectedIndex].fullPath });
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectItem(selectedIndex + 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectItem(selectedIndex - 1);
            } else if (e.altKey && e.key === 'c') {
                e.preventDefault();
                vscode.postMessage({ type: 'toggleOption', option: 'caseSensitive' });
            } else if (e.altKey && e.key === 'w') {
                e.preventDefault();
                vscode.postMessage({ type: 'toggleOption', option: 'wholeWord' });
            } else if (e.altKey && e.key === 'r') {
                e.preventDefault();
                vscode.postMessage({ type: 'toggleOption', option: 'regex' });
            }
        });

        // Button handlers
        cancelBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'cancel' });
        });

        selectBtn.addEventListener('click', () => {
            if (selectedIndex >= 0 && results[selectedIndex]) {
                vscode.postMessage({ type: 'select', path: results[selectedIndex].fullPath });
            }
        });

        caseBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleOption', option: 'caseSensitive' });
        });

        wordBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleOption', option: 'wholeWord' });
        });

        regexBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleOption', option: 'regex' });
        });

        // Select item by index
        function selectItem(index) {
            if (results.length === 0) return;

            // Clamp index
            if (index < 0) index = 0;
            if (index >= results.length) index = results.length - 1;

            selectedIndex = index;
            renderResults();

            // Preview file
            if (results[index]) {
                vscode.postMessage({ type: 'preview', path: results[index].fullPath });
            }

            // Scroll into view
            const items = resultsContainer.querySelectorAll('.result-item');
            if (items[index]) {
                items[index].scrollIntoView({ block: 'nearest' });
            }

            selectBtn.disabled = selectedIndex < 0;
        }

        // Render results
        function renderResults() {
            if (results.length === 0) {
                resultsContainer.innerHTML = '<div class="status">No results found</div>';
                selectBtn.disabled = true;
                return;
            }

            resultsContainer.innerHTML = results.map((r, i) => \`
                <div class="result-item \${i === selectedIndex ? 'selected' : ''}"
                     data-index="\${i}"
                     onclick="handleClick(\${i})"
                     ondblclick="handleDblClick(\${i})">
                    <div class="result-label">\${escapeHtml(r.label)}</div>
                    <div class="result-path">\${escapeHtml(r.fullPath)}</div>
                    <div class="result-relative">Workspace: \${escapeHtml(r.relativePath)}</div>
                </div>
            \`).join('');
        }

        // Click handlers
        window.handleClick = function(index) {
            selectItem(index);
        };

        window.handleDblClick = function(index) {
            if (results[index]) {
                vscode.postMessage({ type: 'select', path: results[index].fullPath });
            }
        };

        // Escape HTML
        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;

            switch (message.type) {
                case 'searching':
                    resultsContainer.innerHTML = '<div class="status searching">Searching...</div>';
                    selectBtn.disabled = true;
                    break;

                case 'results':
                    results = message.results;
                    selectedIndex = results.length > 0 ? 0 : -1;
                    renderResults();
                    if (selectedIndex >= 0) {
                        vscode.postMessage({ type: 'preview', path: results[0].fullPath });
                    }
                    selectBtn.disabled = selectedIndex < 0;
                    break;

                case 'optionsUpdated':
                    caseBtn.classList.toggle('active', message.caseSensitive);
                    wordBtn.classList.toggle('active', message.wholeWord);
                    regexBtn.classList.toggle('active', message.regex);
                    // Re-trigger search
                    vscode.postMessage({ type: 'search', term: searchInput.value });
                    break;
            }
        });

        // Focus search input on load
        searchInput.focus();
        searchInput.select();
    </script>
</body>
</html>`;
    }

    private _escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
