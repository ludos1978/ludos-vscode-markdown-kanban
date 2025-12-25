import * as vscode from 'vscode';
import { FileSearchWebview, FileSearchResult, TrackedFileData } from './services/FileSearchWebview';

export { FileSearchResult, TrackedFileData } from './services/FileSearchWebview';

export class FileSearchService {
    private _fileSearchWebview: FileSearchWebview;
    private _webview: vscode.Webview | undefined;

    constructor() {
        this._fileSearchWebview = new FileSearchWebview();
    }

    /**
     * Set the webview to use for the file search modal
     */
    setWebview(webview: vscode.Webview): void {
        console.log('[FileSearchService] setWebview called, webview:', webview ? 'defined' : 'undefined');
        this._webview = webview;
        this._fileSearchWebview.setWebview(webview);
    }

    /**
     * Set the tracked files to search within (from MarkdownFileRegistry)
     */
    setTrackedFiles(files: TrackedFileData[]): void {
        this._fileSearchWebview.setTrackedFiles(files);
    }

    /**
     * Open a custom webview dialog to search for a replacement file.
     * Provides full control over UI: 80% width, full path display, custom styling.
     * Returns selection with optional batch replace flag.
     */
    async pickReplacementForBrokenLink(originalPath: string, baseDir?: string): Promise<FileSearchResult | undefined> {
        if (!this._webview) {
            throw new Error('Webview not set. Call setWebview() first.');
        }

        return this._fileSearchWebview.pickReplacementForBrokenLink(originalPath, baseDir);
    }
}
