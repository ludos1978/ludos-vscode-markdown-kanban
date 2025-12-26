/**
 * Centralized File Naming Conventions
 *
 * SINGLE SOURCE OF TRUTH for all file naming patterns and suffixes.
 * Import from here instead of defining local strings.
 *
 * @module constants/FileNaming
 */

// =============================================================================
// BACKUP FILE SUFFIXES
// =============================================================================

/** Suffix for unsaved changes backup files */
export const UNSAVED_CHANGES_SUFFIX = '-unsavedchanges';

/** Suffix for preprocessed export files */
export const PREPROCESSED_SUFFIX = '.preprocessed';

// =============================================================================
// TEMPLATE FILES
// =============================================================================

/** Default template file name */
export const DEFAULT_TEMPLATE_FILENAME = 'template.md';

/** Template folder name */
export const TEMPLATES_FOLDER = 'templates';

// =============================================================================
// EXPORT FILE PATTERNS
// =============================================================================

/** Suffix for HTML exports */
export const HTML_EXPORT_SUFFIX = '.html';

/** Suffix for PDF exports */
export const PDF_EXPORT_SUFFIX = '.pdf';

/** Suffix for PNG exports */
export const PNG_EXPORT_SUFFIX = '.png';

/** Suffix for PPTX exports */
export const PPTX_EXPORT_SUFFIX = '.pptx';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a path is an unsaved changes backup file
 */
export function isUnsavedChangesFile(filePath: string): boolean {
    return filePath.includes(UNSAVED_CHANGES_SUFFIX);
}

/**
 * Generate the unsaved changes backup path for a source file
 */
export function getUnsavedChangesPath(sourcePath: string): string {
    const ext = sourcePath.substring(sourcePath.lastIndexOf('.'));
    const base = sourcePath.substring(0, sourcePath.lastIndexOf('.'));
    return `${base}${UNSAVED_CHANGES_SUFFIX}${ext}`;
}

/**
 * Get the original path from an unsaved changes backup path
 */
export function getOriginalFromUnsavedPath(backupPath: string): string {
    return backupPath.replace(UNSAVED_CHANGES_SUFFIX, '');
}

/**
 * Check if a path is a preprocessed file
 */
export function isPreprocessedFile(filePath: string): boolean {
    return filePath.includes(PREPROCESSED_SUFFIX);
}

/**
 * Generate a preprocessed file path
 */
export function getPreprocessedPath(sourcePath: string, extension: string): string {
    const baseName = sourcePath.substring(0, sourcePath.lastIndexOf('.'));
    return `${baseName}${PREPROCESSED_SUFFIX}${extension}`;
}
