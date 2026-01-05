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
     * Normalize a directory path for comparison
     * Strips leading ./ and normalizes separators
     * This ensures directories match regardless of ./ prefix differences
     */
    private _normalizeDirForComparison(dir: string): string {
        let normalized = dir.replace(/\\/g, '/');
        if (normalized.startsWith('./')) {
            normalized = normalized.substring(2);
        }
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        return normalized;
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
        this._webview = webview;
    }

    /**
     * Open the file search modal in the kanban webview
     * @param originalPath - The original broken path to search for
     * @param baseDir - Base directory for relative path resolution
     * @param options - Optional settings (showOpenMediaFolder: show media folder button)
     */
    async pickReplacementForBrokenLink(
        originalPath: string,
        baseDir?: string,
        options?: { showOpenMediaFolder?: boolean }
    ): Promise<FileSearchResult | undefined> {
        if (!this._webview) {
            console.error('[FileSearchWebview] pickReplacementForBrokenLink: webview not set');
            throw new Error('Webview not set. Call setWebview() first.');
        }

        const decodedPath = safeDecodeURIComponent(originalPath);
        const fileName = path.basename(decodedPath);  // Include extension in search
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
            // Frontend will trigger initial search via fileSearchQuery message
            this._webview?.postMessage({
                type: 'fileSearchShow',
                originalPath: decodedPath,
                initialSearch: fileName,
                showOpenMediaFolder: options?.showOpenMediaFolder ?? false
            });
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

        this._messageDisposable = this._webview.onDidReceiveMessage(async (message) => {
            // Only handle file search messages
            if (!message.type?.startsWith('fileSearch')) {
                return; // Let other handlers process non-fileSearch messages
            }

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
        this._searchSeq += 1;
        const seq = this._searchSeq;
        const rawTerm = term.trim();
        const normalized = this._caseSensitive ? rawTerm : rawTerm.toLowerCase();

        // Send loading state
        this._webview?.postMessage({ type: 'fileSearchSearching' });

        const seen = new Set<string>();
        let totalSent = 0;
        const BATCH_SIZE = 20;
        const STREAM_INTERVAL_MS = 50;
        let pendingBatch: SearchResult[] = [];
        let lastSendTime = 0;

        // Precompile regex for regex/wholeWord modes (avoids repeated compilation)
        let compiledRegex: RegExp | undefined;
        if (this._useRegex) {
            try {
                compiledRegex = new RegExp(rawTerm, this._caseSensitive ? '' : 'i');
            } catch {
                compiledRegex = undefined;
            }
        } else if (this._wholeWord) {
            try {
                compiledRegex = new RegExp(`\\b${escapeRegExp(rawTerm)}\\b`, this._caseSensitive ? '' : 'i');
            } catch {
                compiledRegex = undefined;
            }
        }

        // Also search for name without extension (for more flexible matching)
        const termParsed = path.parse(rawTerm);
        const termNameOnly = termParsed.name;  // e.g., "test" from "test.md"
        const normalizedNameOnly = this._caseSensitive ? termNameOnly : termNameOnly.toLowerCase();

        const nameMatches = (fsPath: string): boolean => {
            if (!rawTerm) { return true; }
            const base = path.basename(fsPath);
            const parsed = path.parse(base);
            const baseNoExt = parsed.name;

            // ONLY regex mode uses regex - nothing else
            if (this._useRegex) {
                if (!compiledRegex) { return false; }
                return compiledRegex.test(baseNoExt) || compiledRegex.test(base);
            }

            // All other modes: EXACT matching only
            const candidateNoExt = this._caseSensitive ? baseNoExt : baseNoExt.toLowerCase();
            const candidateFull = this._caseSensitive ? base : base.toLowerCase();
            const termHasExtension = termParsed.ext.length > 0;

            if (termHasExtension) {
                // Exact match on full filename: "root-include-2.md" matches only "root-include-2.md"
                return candidateFull === normalized;
            } else {
                // Exact match on name part: "root-include-2" matches "root-include-2.md", "root-include-2.txt"
                return candidateNoExt === normalizedNameOnly;
            }
        };

        const sendBatch = (force: boolean = false): void => {
            if (seq !== this._searchSeq) { return; }
            const now = Date.now();
            if (pendingBatch.length === 0) { return; }
            if (!force && pendingBatch.length < BATCH_SIZE && now - lastSendTime < STREAM_INTERVAL_MS) { return; }

            this._webview?.postMessage({
                type: 'fileSearchResultsBatch',
                results: pendingBatch,
                term: rawTerm,
                totalFound: totalSent + pendingBatch.length
            });
            totalSent += pendingBatch.length;
            pendingBatch = [];
            lastSendTime = now;
        };

        const addResult = (uri: vscode.Uri): boolean => {
            if (seq !== this._searchSeq) { return false; }
            if (!nameMatches(uri.fsPath)) { return false; }
            if (seen.has(uri.fsPath)) { return false; }
            seen.add(uri.fsPath);

            pendingBatch.push({
                label: path.basename(uri.fsPath),
                fullPath: uri.fsPath,
                relativePath: vscode.workspace.asRelativePath(uri.fsPath)
            });

            sendBatch(false);
            return true;
        };

        // Workspace search with smart glob patterns
        const excludePattern = '**/node_modules/**';

        // Escape special glob characters in search term
        const escapeGlob = (s: string): string => {
            return s.replace(/[[\]{}*?!]/g, '[$&]');
        };

        // For non-regex searches: use EXACT glob patterns
        // For regex searches: we need **/* and filter in JS
        const useExactGlob = !this._useRegex && rawTerm.length > 0;

        let patterns: string[];
        if (useExactGlob && termNameOnly.length > 0) {
            // Exact glob: match only files with exact filename
            const escapedNameOnly = escapeGlob(termNameOnly);
            const escapedTerm = escapeGlob(rawTerm);
            const termHasExtension = termParsed.ext.length > 0;

            if (termHasExtension) {
                // Search for exact filename with extension: "test.md" → find only "test.md"
                patterns = [
                    `**/${escapedTerm}`,       // Exact filename in any subdirectory
                    escapedTerm                 // Exact filename at root level
                ];
            } else {
                // Search for exact name with any extension: "test" → find "test.md", "test.txt", etc.
                patterns = [
                    `**/${escapedNameOnly}.*`, // Exact name with any extension in subdirs
                    `**/${escapedNameOnly}`,   // Exact name without extension in subdirs
                    `${escapedNameOnly}.*`,    // Exact name with any extension at root
                    `${escapedNameOnly}`       // Exact name without extension at root
                ];
            }
            console.log(`[FileSearchWebview] Exact glob patterns for "${rawTerm}":`, patterns);
        } else if (this._useRegex) {
            // Regex mode: must scan all files and filter in JS
            patterns = ['**/*'];
            console.log('[FileSearchWebview] Using full scan pattern for regex: **/*');
        } else {
            // Empty term - show recent files
            patterns = ['**/*'];
            console.log('[FileSearchWebview] Empty term, using: **/*');
        }

        try {
            const maxPerPattern = this._useRegex ? MAX_REGEX_RESULTS : MAX_RESULTS_PER_PATTERN;

            // Process patterns sequentially to stream results faster
            for (const pattern of patterns) {
                if (seq !== this._searchSeq) { return; }

                const files = await vscode.workspace.findFiles(pattern, excludePattern, maxPerPattern);

                for (const uri of files) {
                    if (seq !== this._searchSeq) { return; }
                    addResult(uri);
                }
                // Force send after each pattern completes
                sendBatch(true);
            }
            // No fuzzy fallback - for fuzzy matching, user should enable regex mode
        } catch (error) {
            console.warn('[FileSearchWebview] Workspace search failed:', error);
        }

        // Base directory scan (streams results as found)
        if (this._baseDir) {
            try {
                const visited = new Set<string>();
                let foundCount = 0;
                const maxResults = MAX_SEARCH_RESULTS;

                const scan = async (dirFsPath: string): Promise<void> => {
                    if (seq !== this._searchSeq) { return; }
                    if (foundCount >= maxResults) { return; }
                    if (visited.has(dirFsPath)) { return; }
                    visited.add(dirFsPath);

                    const baseName = path.basename(dirFsPath);
                    if (['node_modules', '.git', 'dist', 'out'].includes(baseName)) { return; }

                    let entries: [string, vscode.FileType][];
                    try {
                        entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirFsPath));
                    } catch {
                        return;
                    }

                    for (const [name, type] of entries) {
                        if (seq !== this._searchSeq) { return; }
                        if (foundCount >= maxResults) { break; }

                        const childPath = path.join(dirFsPath, name);
                        if (type === vscode.FileType.Directory) {
                            await scan(childPath);
                        } else if (type === vscode.FileType.File) {
                            if (addResult(vscode.Uri.file(childPath))) {
                                foundCount++;
                            }
                        }
                    }
                };

                await scan(this._baseDir);
                sendBatch(true); // Flush remaining results
            } catch (error) {
                console.warn('[FileSearchWebview] BaseDir scan failed:', error);
            }
        }

        if (seq !== this._searchSeq) { return; }

        // Send final batch and completion signal
        sendBatch(true);
        this._webview?.postMessage({
            type: 'fileSearchComplete',
            term: rawTerm,
            totalFound: totalSent
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
                const normalizedFoundDir = this._normalizeDirForComparison(foundDir);
                const normalizedBrokenDir = this._normalizeDirForComparison(brokenDir);
                if (normalizedFoundDir === normalizedBrokenDir) {
                    brokenCount++;
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
                const normalizedFoundDir = this._normalizeDirForComparison(foundDir);
                const normalizedBrokenDir = this._normalizeDirForComparison(brokenDir);
                if (normalizedFoundDir === normalizedBrokenDir) {
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
