/**
 * Centralized File Extension Definitions
 *
 * SINGLE SOURCE OF TRUTH for all file extension constants.
 * Import from here instead of defining local arrays.
 *
 * Note: For image/video/audio/document extensions, this re-exports from
 * shared/fileTypeDefinitions.ts which is also used by browser code.
 *
 * @module constants/FileExtensions
 */

// Re-export from shared module (used by both Node and browser)
export { FILE_EXTENSIONS, DOTTED_EXTENSIONS, MIME_TYPE_MAP } from '../shared/fileTypeDefinitions';

// =============================================================================
// MARKDOWN EXTENSIONS
// =============================================================================

/** Standard markdown file extensions */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;

/** Marp presentation extensions */
export const MARP_EXTENSIONS = ['.marp.md'] as const;

/** All markdown-related extensions */
export const ALL_MARKDOWN_EXTENSIONS = [...MARKDOWN_EXTENSIONS, ...MARP_EXTENSIONS] as const;

// =============================================================================
// DIAGRAM EXTENSIONS
// =============================================================================

/** Draw.io diagram extensions */
export const DRAWIO_EXTENSIONS = ['.drawio', '.dio'] as const;

/** Excalidraw diagram extensions (including compound extensions) */
export const EXCALIDRAW_EXTENSIONS = ['.excalidraw', '.excalidraw.json', '.excalidraw.svg'] as const;

/** PlantUML extensions */
export const PLANTUML_EXTENSIONS = ['.puml', '.plantuml'] as const;

/** Mermaid extensions */
export const MERMAID_EXTENSIONS = ['.mmd'] as const;

/** All diagram extensions */
export const ALL_DIAGRAM_EXTENSIONS = [
    ...DRAWIO_EXTENSIONS,
    ...EXCALIDRAW_EXTENSIONS,
    ...PLANTUML_EXTENSIONS,
    ...MERMAID_EXTENSIONS
] as const;

// =============================================================================
// TEXT FILE EXTENSIONS (for link handling)
// =============================================================================

/** Text/code file extensions that should be opened as text */
export const TEXT_FILE_EXTENSIONS = [
    // Markdown
    '.md', '.markdown', '.txt', '.rtf', '.log', '.csv', '.tsv',
    // Code
    '.js', '.jsx', '.ts', '.tsx', '.json', '.xml', '.svg',
    '.html', '.htm', '.css', '.scss', '.less',
    '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
    '.go', '.rs', '.rb', '.php', '.sh', '.bat',
    // Config
    '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.config',
    '.prettierrc', '.eslintrc', '.babelrc', '.webpack',
] as const;

// =============================================================================
// BINARY/MEDIA EXTENSIONS (for file search exclusion)
// =============================================================================

/** Binary file extensions to exclude from text searches */
export const BINARY_FILE_EXTENSIONS = [
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg',
    // Documents
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    // Media
    '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.avi', '.mov',
] as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a path has any of the given extensions (case-insensitive)
 */
export function hasExtension(filePath: string, extensions: readonly string[]): boolean {
    const lowerPath = filePath.toLowerCase();
    return extensions.some(ext => lowerPath.endsWith(ext.toLowerCase()));
}

/**
 * Check if path is a markdown file
 */
export function isMarkdownFile(filePath: string): boolean {
    return hasExtension(filePath, MARKDOWN_EXTENSIONS);
}

/**
 * Check if path is a Draw.io file
 */
export function isDrawioFile(filePath: string): boolean {
    return hasExtension(filePath, DRAWIO_EXTENSIONS);
}

/**
 * Check if path is an Excalidraw file
 */
export function isExcalidrawFile(filePath: string): boolean {
    return hasExtension(filePath, EXCALIDRAW_EXTENSIONS);
}

/**
 * Check if path is any diagram file
 */
export function isDiagramFile(filePath: string): boolean {
    return hasExtension(filePath, ALL_DIAGRAM_EXTENSIONS);
}

/**
 * Check if path is a binary/media file (should be excluded from text searches)
 */
export function isBinaryFile(filePath: string): boolean {
    return hasExtension(filePath, BINARY_FILE_EXTENSIONS);
}
