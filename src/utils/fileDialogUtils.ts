/**
 * File dialog utilities
 * Centralized helpers for common file selection dialogs
 */

import * as vscode from 'vscode';

/**
 * Options for markdown file selection dialog
 */
export interface SelectMarkdownFileOptions {
    /** Allow selecting multiple files (default: false) */
    canSelectMany?: boolean;
    /** Default directory or file to open in dialog */
    defaultUri?: vscode.Uri;
    /** Dialog title */
    title?: string;
}

/**
 * Show a file selection dialog filtered to markdown files
 * @param options - Optional configuration for the dialog
 * @returns Array of selected file URIs, or undefined if cancelled
 */
export async function selectMarkdownFile(options?: SelectMarkdownFileOptions): Promise<vscode.Uri[] | undefined> {
    return vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: options?.canSelectMany ?? false,
        defaultUri: options?.defaultUri,
        filters: { 'Markdown files': ['md'] },
        title: options?.title
    });
}
