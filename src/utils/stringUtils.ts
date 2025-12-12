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
