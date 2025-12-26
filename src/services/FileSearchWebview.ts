/**
 * FileSearchWebview - File search dialog using kanban webview overlay
 *
 * Provides a customizable file search dialog rendered as a modal overlay
 * inside the kanban webview, allowing the board to remain visible behind.
 *
 * Features:
 * - 80% screen width/height with transparent background
 * - Full path display without truncation
 * - Search toggles (case sensitive, whole word, regex)
 * - Batch path replacement
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
import { BINARY_FILE_EXTENSIONS, hasExtension } from '../constants/FileExtensions';

interface SearchResult {
    label: string;
    fullPath: string;
    relativePath: string;
}

export type PathFormat = 'auto' | 'relative' | 'absolute';

export interface FileSearchResult {
    uri: vscode.Uri;
    batchReplace: boolean;
    originalPath: string;
    pathFormat: PathFormat;
}

/**
 * Tracked file data for scanning (from MarkdownFileRegistry)
 */
export interface TrackedFileData {
    path: string;           // Absolute path
    relativePath: string;   // Relative path from main file
    content: string;        // Cached content
}

export class FileSearchWebview {
    private _webview: vscode.Webview | undefined;
    private _resolveSelection: ((result: FileSearchResult | undefined) => void) | undefined;
    private _searchSeq = 0;
    private _debounceTimer: NodeJS.Timeout | undefined;
    private _baseDir: string | undefined;
    private _previewEditor: vscode.TextEditor | undefined;
    private _previewUri: vscode.Uri | undefined;
    private _originalPath: string = '';
    private _messageDisposable: vscode.Disposable | undefined;

    // Tracked files from registry (main + includes)
    private _trackedFiles: TrackedFileData[] = [];

    // Search options
    private _caseSensitive = false;
    private _wholeWord = false;
    private _useRegex = false;

    constructor() {
        // No extensionUri needed - we use the existing kanban webview
    }

    /**
     * Set the tracked files to search within (from MarkdownFileRegistry)
     */
    setTrackedFiles(files: TrackedFileData[]): void {
        this._trackedFiles = files;
    }

    /**
     * Set the webview to use for displaying the file search modal
     */
    setWebview(webview: vscode.Webview): void {
        console.log('[FileSearchWebview] setWebview called, webview:', webview ? 'defined' : 'undefined');
        this._webview = webview;
    }

    /**
     * Open the file search modal in the kanban webview
     */
    async pickReplacementForBrokenLink(originalPath: string, baseDir?: string): Promise<FileSearchResult | undefined> {
        if (!this._webview) {
            console.error('[FileSearchWebview] pickReplacementForBrokenLink: webview not set');
            throw new Error('Webview not set. Call setWebview() first.');
        }

        console.log('[FileSearchWebview] pickReplacementForBrokenLink called for:', originalPath);

        const decodedPath = safeDecodeURIComponent(originalPath);
        const nameRoot = path.parse(path.basename(decodedPath)).name;
        this._baseDir = baseDir;
        this._originalPath = decodedPath;

        // Reset search options
        this._caseSensitive = false;
        this._wholeWord = false;
        this._useRegex = false;

        return new Promise((resolve) => {
            this._resolveSelection = resolve;

            // Set up message listener
            this._setupMessageListener();

            // Send message to show the modal
            this._webview?.postMessage({
                type: 'fileSearchShow',
                originalPath: decodedPath,
                initialSearch: nameRoot
            });

            // Start initial search after a short delay
            setTimeout(() => this._handleSearch(nameRoot), 100);
        });
    }

    /**
     * Set up listener for messages from the webview
     */
    private _setupMessageListener(): void {
        // Dispose previous listener if any
        if (this._messageDisposable) {
            this._messageDisposable.dispose();
        }

        if (!this._webview) {
            console.error('[FileSearchWebview] Cannot setup listener: webview is undefined');
            return;
        }

        console.log('[FileSearchWebview] Setting up message listener');

        this._messageDisposable = this._webview.onDidReceiveMessage(async (message) => {
            // Only handle file search messages
            if (!message.type?.startsWith('fileSearch')) {
                return; // Let other handlers process non-fileSearch messages
            }

            console.log('[FileSearchWebview] Received message:', message.type);

            try {
                switch (message.type) {
                    case 'fileSearchQuery':
                        this._handleSearch(message.term);
                        break;
                    case 'fileSearchSelected':
                        this._handleSelect(message.path, message.batchReplace || false, message.pathFormat || 'auto');
                        break;
                    case 'fileSearchPreview':
                        this._handlePreview(message.path);
                        break;
                    case 'fileSearchCancelled':
                        this._handleCancel();
                        break;
                    case 'fileSearchToggleOption':
                        this._handleToggleOption(message.option);
                        break;
                    case 'fileSearchAnalyzeBatch':
                        await this._handleAnalyzeBatch(message.selectedPath);
                        break;
                    case 'fileSearchScanBrokenPath':
                        await this._handleScanBrokenPath();
                        break;
                    case 'fileSearchClosePreview':
                        await this._closePreview();
                        break;
                }
            } catch (error) {
                console.error('[FileSearchWebview] Error handling message:', message.type, error);
            }
        });
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
        console.log('[FileSearchWebview] _performSearch called with term:', term);
        this._searchSeq += 1;
        const seq = this._searchSeq;
        const rawTerm = term.trim();
        const normalized = this._caseSensitive ? rawTerm : rawTerm.toLowerCase();

        // Send loading state
        console.log('[FileSearchWebview] Sending fileSearchSearching message');
        this._webview?.postMessage({ type: 'fileSearchSearching' });

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
        console.log('[FileSearchWebview] Sending fileSearchResults with', results.length, 'results');
        this._webview?.postMessage({
            type: 'fileSearchResults',
            results: results,
            term: rawTerm
        });
    }

    private _handleSelect(filePath: string, batchReplace: boolean = false, pathFormat: PathFormat = 'auto'): void {
        if (this._resolveSelection) {
            this._resolveSelection({
                uri: vscode.Uri.file(filePath),
                batchReplace: batchReplace,
                originalPath: this._originalPath,
                pathFormat: pathFormat
            });
            this._resolveSelection = undefined;
        }
        this._cleanup();
    }

    private async _handlePreview(filePath: string): Promise<void> {
        try {
            // Close previous preview first
            await this._closePreview();

            const uri = vscode.Uri.file(filePath);
            const ext = path.extname(filePath).toLowerCase();
            this._previewUri = uri;

            // Binary/image files that need vscode.open command
            // Additional extensions not in BINARY_FILE_EXTENSIONS
            const additionalBinaryExtensions = ['.ttf', '.otf', '.woff', '.woff2', '.exe', '.dll', '.so', '.dylib'];
            const isBinaryFile = hasExtension(filePath, BINARY_FILE_EXTENSIONS) ||
                                 additionalBinaryExtensions.includes(ext);

            if (isBinaryFile) {
                // Use vscode.open for binary files - this lets VS Code/extensions handle them
                await vscode.commands.executeCommand('vscode.open', uri, {
                    preview: true,
                    viewColumn: vscode.ViewColumn.Beside,
                    preserveFocus: true
                });
                this._previewEditor = undefined;
            } else {
                // Use openTextDocument for text files
                const doc = await vscode.workspace.openTextDocument(filePath);
                this._previewEditor = await vscode.window.showTextDocument(doc, {
                    preview: true,
                    preserveFocus: true,
                    viewColumn: vscode.ViewColumn.Beside
                });
            }
        } catch (error) {
            console.warn('[FileSearchWebview] Cannot preview file:', error);
        }
    }

    private async _closePreview(): Promise<void> {
        if (!this._previewUri) return;

        try {
            const targetUri = this._previewUri.toString();
            const tabsToClose: vscode.Tab[] = [];

            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    // Check both text and custom tab inputs
                    const tabInput = tab.input as { uri?: vscode.Uri } | undefined;
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

        this._previewUri = undefined;
        this._previewEditor = undefined;
    }

    private _handleCancel(): void {
        if (this._resolveSelection) {
            this._resolveSelection(undefined);
            this._resolveSelection = undefined;
        }
        this._cleanup();
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
        this._webview?.postMessage({
            type: 'fileSearchOptionsUpdated',
            caseSensitive: this._caseSensitive,
            wholeWord: this._wholeWord,
            regex: this._useRegex
        });
    }

    private async _handleScanBrokenPath(): Promise<void> {
        // Scan tracked files (main + includes) for paths matching the broken directory
        const brokenDir = path.dirname(this._originalPath);

        // Pattern to find markdown image/link paths
        const pathPattern = /!\[([^\]]*)\]\(([^)]+)\)|(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
        let brokenCount = 0;
        const foundFiles: string[] = [];
        let lastUpdateTime = 0;

        const sendUpdate = (scanning: boolean = true) => {
            this._webview?.postMessage({
                type: 'fileSearchBrokenPathCount',
                count: brokenCount,
                uniqueFiles: foundFiles.length,
                files: [...foundFiles],
                brokenDir: brokenDir,
                scanning: scanning
            });
        };

        console.log('[FileSearchWebview] Scanning', this._trackedFiles.length, 'tracked files for brokenDir:', brokenDir);

        // Search within tracked files (already loaded in memory)
        for (const trackedFile of this._trackedFiles) {
            const content = trackedFile.content;
            if (!content) continue;

            let match;
            pathPattern.lastIndex = 0;

            while ((match = pathPattern.exec(content)) !== null) {
                const foundPath = match[2] || match[4];
                if (!foundPath) continue;

                let decodedPath: string;
                try {
                    decodedPath = decodeURIComponent(foundPath);
                } catch {
                    decodedPath = foundPath;
                }

                const foundDir = path.dirname(decodedPath);
                if (foundDir === brokenDir) {
                    brokenCount++;
                    console.log('[FileSearchWebview] MATCH in', trackedFile.relativePath, ':', decodedPath);
                    const filename = path.basename(decodedPath);
                    if (!foundFiles.includes(filename)) {
                        foundFiles.push(filename);
                        // Send incremental update (throttled to every 100ms)
                        const now = Date.now();
                        if (now - lastUpdateTime > 100) {
                            lastUpdateTime = now;
                            sendUpdate(true);
                        }
                    }
                }
            }
        }

        // Send final update
        console.log('[FileSearchWebview] Scan complete: found', brokenCount, 'paths in', foundFiles.length, 'unique files');
        sendUpdate(false);
    }

    private async _handleAnalyzeBatch(selectedPath: string): Promise<void> {
        const brokenDir = path.dirname(this._originalPath);
        const newDir = path.dirname(selectedPath);

        // Find all paths with broken directory and check if they exist in new directory
        const pathPattern = /!\[([^\]]*)\]\(([^)]+)\)|(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
        const filesToReplace: string[] = [];
        const filesMissing: string[] = [];
        let lastUpdateTime = 0;

        const sendUpdate = (scanning: boolean = true) => {
            this._webview?.postMessage({
                type: 'fileSearchBatchAnalysis',
                canReplace: filesToReplace.length,
                missing: filesMissing.length,
                filesCanReplace: [...filesToReplace],
                filesMissing: [...filesMissing],
                brokenDir: brokenDir,
                newDir: newDir,
                scanning: scanning
            });
        };

        // Search within tracked files (already loaded in memory)
        for (const trackedFile of this._trackedFiles) {
            const content = trackedFile.content;
            if (!content) continue;

            let match;
            pathPattern.lastIndex = 0;

            while ((match = pathPattern.exec(content)) !== null) {
                const foundPath = match[2] || match[4];
                if (!foundPath) continue;

                let decodedPath: string;
                try {
                    decodedPath = decodeURIComponent(foundPath);
                } catch {
                    decodedPath = foundPath;
                }

                const foundDir = path.dirname(decodedPath);
                if (foundDir === brokenDir) {
                    const filename = path.basename(decodedPath);
                    if (!filesToReplace.includes(filename) && !filesMissing.includes(filename)) {
                        // Check if file exists in new directory
                        const newPath = path.join(newDir, filename);
                        try {
                            await vscode.workspace.fs.stat(vscode.Uri.file(newPath));
                            filesToReplace.push(filename);
                        } catch {
                            filesMissing.push(filename);
                        }
                        // Send incremental update (throttled)
                        const now = Date.now();
                        if (now - lastUpdateTime > 100) {
                            lastUpdateTime = now;
                            sendUpdate(true);
                        }
                    }
                }
            }
        }

        // Send final update
        sendUpdate(false);
    }

    private async _cleanup(): Promise<void> {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }

        // Dispose message listener
        if (this._messageDisposable) {
            this._messageDisposable.dispose();
            this._messageDisposable = undefined;
        }

        // Close preview editor
        await this._closePreview();
    }
}
