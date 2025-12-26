/**
 * Centralized File Naming Conventions
 *
 * SINGLE SOURCE OF TRUTH for all file naming patterns and suffixes.
 * Import from here instead of defining local strings.
 *
 * @module constants/FileNaming
 */

// =============================================================================
// BACKUP & RECOVERY FILE SUFFIXES
// =============================================================================

/** Suffix for unsaved changes backup files: .{name}-unsavedchanges.md */
export const UNSAVED_CHANGES_SUFFIX = '-unsavedchanges';

/** Suffix for autosave files: .{name}-autosave.md */
export const AUTOSAVE_SUFFIX = '-autosave';

/** Suffix for backup files: .{name}-backup-{timestamp}.md */
export const BACKUP_SUFFIX = '-backup-';

/** Suffix for conflict files: {name}-conflict-{timestamp}.md */
export const CONFLICT_SUFFIX = '-conflict-';

/** Prefix for external conflict backups */
export const EXTERNAL_CONFLICT_PREFIX = 'external-conflict';

/** Suffix for preprocessed export files */
export const PREPROCESSED_SUFFIX = '-preprocessed';

// =============================================================================
// BACKUP FOLDERS
// =============================================================================

/** Folder name for kanban backups */
export const KANBAN_BACKUPS_FOLDER = '.kanban-backups';

// =============================================================================
// CACHE FILES
// =============================================================================

/** Suffix for media cache files: .{name}.mediacache.json */
export const MEDIACACHE_SUFFIX = '.mediacache.json';

// =============================================================================
// EXPORT FOLDERS
// =============================================================================

/** Default export folder name */
export const DEFAULT_EXPORT_FOLDER = '_Export';

// =============================================================================
// TEMPLATE FILES
// =============================================================================

/** Default template file name */
export const DEFAULT_TEMPLATE_FILENAME = 'template.md';

/** Template folder name */
export const TEMPLATES_FOLDER = 'templates';

// =============================================================================
// EXPORT FILE EXTENSIONS
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
// TIMESTAMP PATTERNS (for regex matching)
// =============================================================================

/** Timestamp format used in backup/conflict files: YYYYMMDDTHHmmss */
export const TIMESTAMP_PATTERN = '\\d{8}T\\d{6}';

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
 * Check if a path is an autosave file
 */
export function isAutosaveFile(filePath: string): boolean {
    // Pattern: .{name}-autosave.md (hidden file with dot prefix)
    const fileName = filePath.split(/[/\\]/).pop() || '';
    return new RegExp(`^\\..*${AUTOSAVE_SUFFIX}\\.md$`).test(fileName);
}

/**
 * Check if a path is a backup file
 */
export function isBackupFile(filePath: string): boolean {
    // Pattern: .{name}-backup-{timestamp}.md
    const fileName = filePath.split(/[/\\]/).pop() || '';
    return new RegExp(`^\\..*${BACKUP_SUFFIX}${TIMESTAMP_PATTERN}\\.md$`).test(fileName);
}

/**
 * Check if a path is a conflict file
 */
export function isConflictFile(filePath: string): boolean {
    // Pattern: {name}-conflict-{timestamp}.md
    const fileName = filePath.split(/[/\\]/).pop() || '';
    return new RegExp(`${CONFLICT_SUFFIX}${TIMESTAMP_PATTERN}\\.md$`).test(fileName);
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

/**
 * Generate a media cache file path
 * e.g., /path/to/myboard.md -> /path/to/.myboard.md.mediacache.json
 */
export function getMediaCachePath(kanbanPath: string): string {
    const dir = kanbanPath.substring(0, kanbanPath.lastIndexOf('/') + 1) ||
                kanbanPath.substring(0, kanbanPath.lastIndexOf('\\') + 1);
    const basename = kanbanPath.split(/[/\\]/).pop() || '';
    return `${dir}.${basename}${MEDIACACHE_SUFFIX}`;
}

/**
 * Generate a timestamp string for backup/conflict files
 * Format: YYYYMMDDTHHmmss
 */
export function generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}
