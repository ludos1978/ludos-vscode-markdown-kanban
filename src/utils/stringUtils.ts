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
 * Normalizes a file path for case-insensitive lookup.
 * Converts to lowercase and normalizes path separators.
 *
 * @param filePath - The file path to normalize
 * @returns Normalized path for use as lookup key
 */
export function normalizePathForLookup(filePath: string): string {
    return filePath.toLowerCase().replace(/\\/g, '/');
}
