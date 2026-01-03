/**
 * Centralized File Naming Conventions
 *
 * SINGLE SOURCE OF TRUTH for all file naming patterns, suffixes, and construction logic.
 * Import from here instead of defining local strings or construction logic.
 *
 * @module constants/FileNaming
 */

// =============================================================================
// CONFIGURATION INTERFACE
// =============================================================================

/**
 * Configuration for file naming patterns.
 * Can be customized if needed in the future.
 */
export interface FileNamingConfig {
    // Prefixes
    hiddenFilePrefix: string;

    // Suffixes for backup/recovery files
    unsavedChangesSuffix: string;
    autosaveSuffix: string;
    backupSuffix: string;
    conflictSuffix: string;
    externalConflictLabel: string;
    preprocessedSuffix: string;

    // Cache file suffix
    mediaCacheSuffix: string;

    // Folder names
    backupsFolder: string;
    exportFolder: string;
    templatesFolder: string;

    // Template files
    defaultTemplateFilename: string;

    // Export extensions
    htmlExportExt: string;
    pdfExportExt: string;
    pngExportExt: string;
    pptxExportExt: string;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

/**
 * Default file naming configuration.
 * These values define the standard naming conventions.
 */
export const DEFAULT_FILE_NAMING_CONFIG: FileNamingConfig = {
    // Prefixes
    hiddenFilePrefix: '.',

    // Suffixes for backup/recovery files
    unsavedChangesSuffix: '-unsavedchanges',
    autosaveSuffix: '-autosave',
    backupSuffix: '-backup-',
    conflictSuffix: '-conflict-',
    externalConflictLabel: 'external-conflict',
    preprocessedSuffix: '-preprocessed',

    // Cache file suffix
    mediaCacheSuffix: '.mediacache.json',

    // Folder names
    backupsFolder: '.kanban-backups',
    exportFolder: '_Export',
    templatesFolder: 'templates',

    // Template files
    defaultTemplateFilename: 'template.md',

    // Export extensions
    htmlExportExt: '.html',
    pdfExportExt: '.pdf',
    pngExportExt: '.png',
    pptxExportExt: '.pptx',
};

// Active configuration (can be overridden)
let _config: FileNamingConfig = { ...DEFAULT_FILE_NAMING_CONFIG };

/**
 * Get current file naming configuration
 */
export function getFileNamingConfig(): FileNamingConfig {
    return _config;
}

/**
 * Override file naming configuration (for testing or customization)
 */
export function setFileNamingConfig(config: Partial<FileNamingConfig>): void {
    _config = { ...DEFAULT_FILE_NAMING_CONFIG, ...config };
}

/**
 * Reset to default configuration
 */
export function resetFileNamingConfig(): void {
    _config = { ...DEFAULT_FILE_NAMING_CONFIG };
}

/** Timestamp format regex pattern: YYYYMMDDTHHmmss */
export const TIMESTAMP_PATTERN = '\\d{8}T\\d{6}';

// =============================================================================
// TIMESTAMP GENERATION
// =============================================================================

/**
 * Extract date/time components from a Date object (local time)
 */
function getDateComponents(date: Date = new Date()) {
    return {
        year: date.getFullYear(),
        month: String(date.getMonth() + 1).padStart(2, '0'),
        day: String(date.getDate()).padStart(2, '0'),
        hours: String(date.getHours()).padStart(2, '0'),
        minutes: String(date.getMinutes()).padStart(2, '0'),
        seconds: String(date.getSeconds()).padStart(2, '0')
    };
}

/**
 * Generate a compact timestamp for backup/conflict files
 * Format: YYYYMMDDTHHmmss (e.g., 20231215T143022)
 * Used for: backup files, conflict files
 */
export function generateTimestamp(date: Date = new Date()): string {
    const { year, month, day, hours, minutes, seconds } = getDateComponents(date);
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Generate a timestamp for export folders (without seconds)
 * Format: YYYYMMDD-HHmm (e.g., 20231215-1430)
 * Used for: export folder names
 */
// export function generateTimestampExport(date: Date = new Date()): string {
//     const { year, month, day, hours, minutes } = getDateComponents(date);
//     return `${year}${month}${day}T${hours}${minutes}`;
// }

/**
 * Generate a filename-safe ISO-like timestamp
 * Format: YYYY-MM-DDTHH-mm-ss (e.g., 2023-12-15T14-30-22)
 * Used for: image files, clipboard pastes
 */
// export function generateTimestampFilenameSafe(date: Date = new Date()): string {
//     const { year, month, day, hours, minutes, seconds } = getDateComponents(date);
//     return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`;
// }

/**
 * Generate date-only string
 * Format: YYYY-MM-DD (e.g., 2023-12-15)
 * Used for: share content presets, date-only naming
 */
export function generateDateOnly(date: Date = new Date()): string {
    const { year, month, day } = getDateComponents(date);
    return `${year}${month}${day}`;
}

// =============================================================================
// PATH UTILITIES
// =============================================================================

/**
 * Extract directory from path (cross-platform)
 */
function getDirectory(filePath: string): string {
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
}

/**
 * Extract filename from path (cross-platform)
 */
function getFilename(filePath: string): string {
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
}

/**
 * Extract basename (filename without extension)
 */
function getBasename(filePath: string, ext?: string): string {
    const filename = getFilename(filePath);
    const extension = ext || getExtension(filePath);
    return extension ? filename.slice(0, -extension.length) : filename;
}

/**
 * Extract extension (including dot)
 */
function getExtension(filePath: string): string {
    const filename = getFilename(filePath);
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.substring(lastDot) : '';
}

/**
 * Join path segments (cross-platform)
 */
function joinPath(...segments: string[]): string {
    // Use forward slash as default, will work on both platforms
    return segments.filter(Boolean).join('/');
}

// =============================================================================
// FILENAME GENERATION - UNSAVED CHANGES
// =============================================================================

/**
 * Generate unsaved changes backup filename
 * Pattern: .{basename}-unsavedchanges{ext}
 *
 * @example
 * generateUnsavedChangesFilename('myboard', '.md') => '.myboard-unsavedchanges.md'
 */
export function generateUnsavedChangesFilename(basename: string, ext: string = '.md'): string {
    const cfg = _config;
    return `${cfg.hiddenFilePrefix}${basename}${cfg.unsavedChangesSuffix}${ext}`;
}

/**
 * Generate full unsaved changes backup path from source file path
 *
 * @example
 * getUnsavedChangesPath('/path/to/myboard.md') => '/path/to/.myboard-unsavedchanges.md'
 */
export function getUnsavedChangesPath(sourcePath: string): string {
    const dir = getDirectory(sourcePath);
    const ext = getExtension(sourcePath);
    const basename = getBasename(sourcePath, ext);
    const filename = generateUnsavedChangesFilename(basename, ext);
    return dir ? joinPath(dir, filename) : filename;
}

/**
 * Get original path from unsaved changes backup path
 */
export function getOriginalFromUnsavedPath(backupPath: string): string {
    const cfg = _config;
    const dir = getDirectory(backupPath);
    let filename = getFilename(backupPath);

    // Remove hidden prefix
    if (filename.startsWith(cfg.hiddenFilePrefix)) {
        filename = filename.substring(cfg.hiddenFilePrefix.length);
    }

    // Remove suffix
    filename = filename.replace(cfg.unsavedChangesSuffix, '');

    return dir ? joinPath(dir, filename) : filename;
}

// =============================================================================
// FILENAME GENERATION - AUTOSAVE
// =============================================================================

/**
 * Generate autosave filename
 * Pattern: .{basename}-autosave{ext}
 *
 * @example
 * generateAutosaveFilename('myboard', '.md') => '.myboard-autosave.md'
 */
export function generateAutosaveFilename(basename: string, ext: string = '.md'): string {
    const cfg = _config;
    return `${cfg.hiddenFilePrefix}${basename}${cfg.autosaveSuffix}${ext}`;
}

/**
 * Generate full autosave path from source file path
 */
export function getAutosavePath(sourcePath: string, backupDir?: string): string {
    const ext = getExtension(sourcePath);
    const basename = getBasename(sourcePath, ext);
    const filename = generateAutosaveFilename(basename, ext);
    const dir = backupDir || getDirectory(sourcePath);
    return dir ? joinPath(dir, filename) : filename;
}

// =============================================================================
// FILENAME GENERATION - BACKUP
// =============================================================================

/**
 * Generate backup filename with timestamp
 * Pattern: .{basename}-backup-{timestamp}{ext}
 *
 * @example
 * generateBackupFilename('myboard', '.md') => '.myboard-backup-20231215T143022.md'
 */
export function generateBackupFilename(basename: string, ext: string = '.md', timestamp?: string): string {
    const cfg = _config;
    const ts = timestamp || generateTimestamp();
    return `${cfg.hiddenFilePrefix}${basename}${cfg.backupSuffix}${ts}${ext}`;
}

/**
 * Generate full backup path from source file path
 */
export function getBackupPath(sourcePath: string, backupDir?: string, timestamp?: string): string {
    const ext = getExtension(sourcePath);
    const basename = getBasename(sourcePath, ext);
    const filename = generateBackupFilename(basename, ext, timestamp);
    const dir = backupDir || getDirectory(sourcePath);
    return dir ? joinPath(dir, filename) : filename;
}

// =============================================================================
// FILENAME GENERATION - CONFLICT
// =============================================================================

/**
 * Generate conflict filename with timestamp
 * Pattern: .{basename}-conflict-{timestamp}{ext}
 *
 * @example
 * generateConflictFilename('myboard', '.md') => '.myboard-conflict-20231215T143022.md'
 */
export function generateConflictFilename(basename: string, ext: string = '.md', timestamp?: string): string {
    const cfg = _config;
    const ts = timestamp || generateTimestamp();
    return `${cfg.hiddenFilePrefix}${basename}${cfg.conflictSuffix}${ts}${ext}`;
}

/**
 * Generate full conflict backup path from source file path
 */
export function getConflictPath(sourcePath: string, backupDir?: string, timestamp?: string): string {
    const ext = getExtension(sourcePath);
    const basename = getBasename(sourcePath, ext);
    const filename = generateConflictFilename(basename, ext, timestamp);
    const dir = backupDir || getDirectory(sourcePath);
    return dir ? joinPath(dir, filename) : filename;
}

// =============================================================================
// FILENAME GENERATION - LABELED BACKUP (backup, conflict, external-conflict, etc.)
// =============================================================================

/**
 * Generate labeled backup filename
 * Pattern: .{basename}-{label}-{timestamp}{ext}
 *
 * @example
 * generateLabeledBackupFilename('myboard', 'external-conflict', '.md')
 *   => '.myboard-external-conflict-20231215T143022.md'
 */
export function generateLabeledBackupFilename(
    basename: string,
    label: string,
    ext: string = '.md',
    timestamp?: string
): string {
    const cfg = _config;
    const ts = timestamp || generateTimestamp();
    return `${cfg.hiddenFilePrefix}${basename}-${label}-${ts}${ext}`;
}

/**
 * Generate full labeled backup path
 */
export function getLabeledBackupPath(
    sourcePath: string,
    label: string,
    backupDir?: string,
    timestamp?: string
): string {
    const ext = getExtension(sourcePath);
    const basename = getBasename(sourcePath, ext);
    const filename = generateLabeledBackupFilename(basename, label, ext, timestamp);
    const dir = backupDir || getDirectory(sourcePath);
    return dir ? joinPath(dir, filename) : filename;
}

// =============================================================================
// FILENAME GENERATION - MEDIA CACHE
// =============================================================================

/**
 * Generate media cache filename
 * Pattern: .{kanban-filename}.mediacache.json
 *
 * @example
 * generateMediaCacheFilename('myboard.md') => '.myboard.md.mediacache.json'
 */
export function generateMediaCacheFilename(kanbanFilename: string): string {
    const cfg = _config;
    return `${cfg.hiddenFilePrefix}${kanbanFilename}${cfg.mediaCacheSuffix}`;
}

/**
 * Generate full media cache path from kanban file path
 */
export function getMediaCachePath(kanbanPath: string): string {
    const dir = getDirectory(kanbanPath);
    const filename = getFilename(kanbanPath);
    const cacheFilename = generateMediaCacheFilename(filename);
    return dir ? joinPath(dir, cacheFilename) : cacheFilename;
}

// =============================================================================
// FILENAME GENERATION - PREPROCESSED
// =============================================================================

/**
 * Generate preprocessed filename
 * Pattern: {basename}-preprocessed{ext}
 *
 * @example
 * generatePreprocessedFilename('myboard', '.md') => 'myboard-preprocessed.md'
 */
export function generatePreprocessedFilename(basename: string, ext: string): string {
    const cfg = _config;
    return `${basename}${cfg.preprocessedSuffix}${ext}`;
}

/**
 * Generate full preprocessed path
 */
export function getPreprocessedPath(sourcePath: string, targetExt?: string): string {
    const dir = getDirectory(sourcePath);
    const sourceExt = getExtension(sourcePath);
    const basename = getBasename(sourcePath, sourceExt);
    const ext = targetExt || sourceExt;
    const filename = generatePreprocessedFilename(basename, ext);
    return dir ? joinPath(dir, filename) : filename;
}

// =============================================================================
// BACKUP FOLDER PATH GENERATION
// =============================================================================

/**
 * Get backup folder path for a file
 */
export function getBackupFolderPath(sourceDir: string): string {
    const cfg = _config;
    return joinPath(sourceDir, cfg.backupsFolder);
}

/**
 * Get backup folder path in workspace root
 */
export function getWorkspaceBackupFolderPath(workspacePath: string): string {
    const cfg = _config;
    return joinPath(workspacePath, cfg.backupsFolder);
}

// =============================================================================
// DETECTION FUNCTIONS
// =============================================================================

/**
 * Check if a path/filename is an unsaved changes file
 */
export function isUnsavedChangesFile(filePath: string): boolean {
    const cfg = _config;
    const filename = getFilename(filePath);
    return filename.startsWith(cfg.hiddenFilePrefix) &&
           filename.includes(cfg.unsavedChangesSuffix);
}

/**
 * Check if a path/filename is an autosave file
 */
export function isAutosaveFile(filePath: string): boolean {
    const cfg = _config;
    const filename = getFilename(filePath);
    const pattern = new RegExp(
        `^\\${cfg.hiddenFilePrefix}.*${escapeRegex(cfg.autosaveSuffix)}\\.[^.]+$`
    );
    return pattern.test(filename);
}

/**
 * Check if a path/filename is a backup file
 */
export function isBackupFile(filePath: string): boolean {
    const cfg = _config;
    const filename = getFilename(filePath);
    const pattern = new RegExp(
        `^\\${cfg.hiddenFilePrefix}.*${escapeRegex(cfg.backupSuffix)}${TIMESTAMP_PATTERN}\\.[^.]+$`
    );
    return pattern.test(filename);
}

/**
 * Check if a path/filename is a conflict file
 */
export function isConflictFile(filePath: string): boolean {
    const cfg = _config;
    const filename = getFilename(filePath);
    const pattern = new RegExp(
        `${escapeRegex(cfg.conflictSuffix)}${TIMESTAMP_PATTERN}\\.[^.]+$`
    );
    return pattern.test(filename);
}

/**
 * Check if a path/filename is a preprocessed file
 */
export function isPreprocessedFile(filePath: string): boolean {
    const cfg = _config;
    return filePath.includes(cfg.preprocessedSuffix);
}

/**
 * Check if a path/filename is a media cache file
 */
export function isMediaCacheFile(filePath: string): boolean {
    const cfg = _config;
    const filename = getFilename(filePath);
    return filename.startsWith(cfg.hiddenFilePrefix) &&
           filename.endsWith(cfg.mediaCacheSuffix);
}

/**
 * Create regex pattern for matching backup files
 */
export function createBackupPattern(basename: string): RegExp {
    const cfg = _config;
    return new RegExp(
        `^\\${cfg.hiddenFilePrefix}${escapeRegex(basename)}${escapeRegex(cfg.backupSuffix)}${TIMESTAMP_PATTERN}\\.[^.]+$`
    );
}

// =============================================================================
// UTILITY
// =============================================================================

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
