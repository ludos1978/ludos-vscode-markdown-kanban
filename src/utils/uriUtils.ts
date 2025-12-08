import * as vscode from 'vscode';

/**
 * Safely create a file URI with detailed error logging
 * @param filePath - The file path to convert to URI
 * @param context - Optional context string to help identify where the error occurred
 * @returns vscode.Uri or throws with detailed error message
 */
export function safeFileUri(filePath: string, context?: string): vscode.Uri {
    const contextStr = context ? `[${context}]` : '';

    // Log the attempt
    console.log(`[URI] ${contextStr} Creating URI for path: "${filePath}"`);

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

    // Check for URL-encoded paths that might cause issues
    if (filePath.includes('%')) {
        console.warn(`[URI WARNING] ${contextStr} Path contains URL-encoded characters: "${filePath}"`);
        // Try to decode it
        try {
            const decoded = decodeURIComponent(filePath);
            console.log(`[URI] ${contextStr} Decoded path: "${decoded}"`);
            filePath = decoded;
        } catch (decodeError) {
            console.warn(`[URI WARNING] ${contextStr} Could not decode path, using as-is`);
        }
    }

    // Check for scheme-like patterns in the path (common error source)
    const schemeMatch = filePath.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
    if (schemeMatch) {
        console.warn(`[URI WARNING] ${contextStr} Path looks like a URI with scheme "${schemeMatch[1]}": "${filePath}"`);
        // If it's already a file:// URI, parse it instead
        if (filePath.startsWith('file://')) {
            try {
                const parsed = vscode.Uri.parse(filePath);
                console.log(`[URI] ${contextStr} Parsed existing file:// URI successfully`);
                return parsed;
            } catch (parseError) {
                console.error(`[URI ERROR] ${contextStr} Failed to parse file:// URI: ${parseError}`);
            }
        }
    }

    try {
        const uri = vscode.Uri.file(filePath);
        return uri;
    } catch (error) {
        const errorMsg = `${contextStr} Failed to create URI from path "${filePath}": ${error}`;
        console.error(`[URI ERROR] ${errorMsg}`);
        console.error(`[URI ERROR] ${contextStr} Path details: length=${filePath.length}, first 100 chars: "${filePath.substring(0, 100)}"`);
        throw new Error(errorMsg);
    }
}

/**
 * Safely parse a URI string with detailed error logging
 * @param uriString - The URI string to parse
 * @param context - Optional context string to help identify where the error occurred
 * @returns vscode.Uri or throws with detailed error message
 */
export function safeParseUri(uriString: string, context?: string): vscode.Uri {
    const contextStr = context ? `[${context}]` : '';

    console.log(`[URI] ${contextStr} Parsing URI: "${uriString}"`);

    if (!uriString) {
        const error = `${contextStr} Cannot parse URI: uriString is empty or undefined`;
        console.error(`[URI ERROR] ${error}`);
        throw new Error(error);
    }

    try {
        const uri = vscode.Uri.parse(uriString);
        return uri;
    } catch (error) {
        const errorMsg = `${contextStr} Failed to parse URI "${uriString}": ${error}`;
        console.error(`[URI ERROR] ${errorMsg}`);
        console.error(`[URI ERROR] ${contextStr} URI details: length=${uriString.length}, first 100 chars: "${uriString.substring(0, 100)}"`);
        throw new Error(errorMsg);
    }
}
