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
