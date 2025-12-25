import * as vscode from 'vscode';
import { FileSearchWebview } from './services/FileSearchWebview';

export class FileSearchService {
    private _extensionUri?: vscode.Uri;
    private _webview: FileSearchWebview | undefined;

    constructor(extensionUri?: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    /**
     * Open a custom webview dialog to search for a replacement file.
     * Provides full control over UI: 80% width, full path display, custom styling.
     */
    async pickReplacementForBrokenLink(originalPath: string, baseDir?: string): Promise<vscode.Uri | undefined> {
        if (!this._extensionUri) {
            throw new Error('Extension URI is required for FileSearchWebview');
        }

        this._webview = new FileSearchWebview(this._extensionUri);
        return this._webview.pickReplacementForBrokenLink(originalPath, baseDir);
    }
}
