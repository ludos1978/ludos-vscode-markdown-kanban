/**
 * Constants for include file syntax and patterns
 * Centralized to avoid duplication across the codebase
 */

export const INCLUDE_SYNTAX = {
    /** Include directive prefix */
    PREFIX: '!!!include(',

    /** Include directive suffix */
    SUFFIX: ')!!!',

    /** Global regex pattern for matching any include directive */
    REGEX: /!!!include\(([^)]+)\)!!!/g,

    /** Regex pattern for matching include directives (non-global, for single match) */
    REGEX_SINGLE: /!!!include\(([^)]+)\)!!!/,
} as const;

export const FILE_TYPES = {
    MAIN: 'main',
    INCLUDE_COLUMN: 'include-column',
    INCLUDE_TASK: 'include-task',
    INCLUDE_REGULAR: 'include-regular',
} as const;

export type FileType = typeof FILE_TYPES[keyof typeof FILE_TYPES];

/**
 * Creates a display title by replacing !!!include()!!! directives with badge placeholders
 *
 * SINGLE SOURCE OF TRUTH for include badge placeholder format.
 * Used by: markdownParser, ChangeStateMachine, and any other code that processes includes.
 *
 * @param title - The raw title containing !!!include(filepath)!!! directives
 * @param resolvedFiles - Array of resolved file paths in same order as include directives
 * @returns Display title with !!!include()!!! replaced by %INCLUDE_BADGE:filepath% placeholders
 *
 * @example
 * Input: "My Column !!!include(file.md)!!!"
 * Files: ["path/to/file.md"]
 * Output: "My Column %INCLUDE_BADGE:path/to/file.md%"
 */
export function createDisplayTitleWithPlaceholders(
    title: string,
    resolvedFiles: string[]
): string {
    const includeMatches = title.match(INCLUDE_SYNTAX.REGEX);

    if (!includeMatches || includeMatches.length === 0) {
        return title;
    }

    let displayTitle = title;
    includeMatches.forEach((match, index) => {
        if (resolvedFiles[index]) {
            const filePath = resolvedFiles[index];
            // CRITICAL: This is the ONLY place that defines the placeholder format
            const placeholder = `%INCLUDE_BADGE:${filePath}%`;
            displayTitle = displayTitle.replace(match, placeholder);
        } else {
            // No resolved file for this include - strip it
            displayTitle = displayTitle.replace(match, '').trim();
        }
    });

    return displayTitle;
}
