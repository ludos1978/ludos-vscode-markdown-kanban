/**
 * String utility functions
 *
 * @module utils/stringUtils
 */

/**
 * Escapes special regex characters in a string.
 * Use this when building regex patterns from user input or dynamic strings.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for use in RegExp
 */
export function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes path separators to forward slashes.
 * Use for cross-platform path consistency (e.g., in exports, URLs, relative paths).
 *
 * @param filePath - The file path to normalize
 * @returns Path with forward slashes only
 */
export function toForwardSlashes(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

/**
 * Normalizes a file path for case-insensitive lookup.
 * Converts to lowercase and normalizes path separators.
 *
 * @param filePath - The file path to normalize
 * @returns Normalized path for use as lookup key
 */
export function normalizePathForLookup(filePath: string): string {
    return toForwardSlashes(filePath.toLowerCase());
}

/**
 * Extracts a string message from an unknown error value.
 * Safely handles Error objects, strings, and other types.
 *
 * @param error - The error value (typically from a catch block)
 * @returns A string representation of the error
 */
export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Safely decodes a URI component, returning the original string if decoding fails.
 * Optimizes by skipping decoding when no encoded characters are present.
 *
 * @param str - The string to decode
 * @returns The decoded string, or original if decoding fails
 */
export function safeDecodeURIComponent(str: string): string {
    if (!str.includes('%')) {
        return str;
    }
    try {
        return decodeURIComponent(str);
    } catch {
        return str;
    }
}

/**
 * URL-encode a file path for safe use in markdown links.
 * Encodes each path component separately to handle spaces and special characters.
 * Mirrors the frontend's ValidationUtils.escapeFilePath() function.
 *
 * @param filePath - The file path to encode
 * @returns URL-encoded file path safe for markdown links
 */
export function encodeFilePath(filePath: string): string {
    if (!filePath) return '';

    // Convert Windows backslashes to forward slashes
    let normalizedPath = toForwardSlashes(filePath);

    // Split on slashes, encode each part, then rejoin
    const pathParts = normalizedPath.split('/');
    const encodedParts = pathParts.map(part => {
        // Don't encode empty parts (from leading slashes or double slashes)
        if (!part) return part;

        // Don't encode Windows drive letters (C:, D:, etc.)
        if (/^[a-zA-Z]:$/.test(part)) return part;

        // URL encode the part
        return encodeURIComponent(part);
    });

    return encodedParts.join('/');
}
