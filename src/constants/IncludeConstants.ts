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
