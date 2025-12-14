import * as vscode from 'vscode';
import { safeDecodeURIComponent } from './stringUtils';

/**
 * Safely create a file URI with detailed error logging
 * @param filePath - The file path to convert to URI
 * @param context - Optional context string to help identify where the error occurred
 * @returns vscode.Uri or throws with detailed error message
 */
export function safeFileUri(filePath: string, context?: string): vscode.Uri {
    const contextStr = context ? `[${context}]` : '';

    // Check for common issues before calling vscode.Uri.file
    if (!filePath) {
        const error = `${contextStr} Cannot create URI: filePath is empty or undefined`;
        console.error(`[URI ERROR] ${error}`);
        throw new Error(error);
    }

    if (typeof filePath !== 'string') {
        const error = `${contextStr} Cannot create URI: filePath is not a string (got ${typeof filePath})`;
        console.error(`[URI ERROR] ${error}`);
        throw new Error(error);
    }

    // Decode URL-encoded paths (e.g., %20 -> space)
    filePath = safeDecodeURIComponent(filePath);

    // Check for scheme-like patterns in the path (common error source)
    const schemeMatch = filePath.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
    if (schemeMatch) {
        // If it's already a file:// URI, parse it instead
        if (filePath.startsWith('file://')) {
            try {
                return vscode.Uri.parse(filePath);
            } catch (parseError) {
                console.error(`[URI ERROR] ${contextStr} Failed to parse file:// URI: ${parseError}`);
            }
        }
    }

    try {
        return vscode.Uri.file(filePath);
    } catch (error) {
        const errorMsg = `${contextStr} Failed to create URI from path "${filePath}": ${error}`;
        console.error(`[URI ERROR] ${errorMsg}`);
        throw new Error(errorMsg);
    }
}
