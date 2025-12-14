/**
 * Import Plugin Interface
 *
 * Defines the contract for plugins that handle file import/loading.
 * This includes include file detection, creation, and parsing.
 *
 * @module plugins/interfaces/ImportPlugin
 */

import { MarkdownFile } from '../../files/MarkdownFile';
import { MainKanbanFile } from '../../files/MainKanbanFile';
import { ConflictResolver } from '../../services/ConflictResolver';
import { BackupManager } from '../../services/BackupManager';
import { KanbanTask } from '../../markdownParser';

/**
 * Metadata describing an import plugin's capabilities
 */
export interface ImportPluginMetadata {
    /** Unique identifier for this plugin (e.g., 'column-include', 'task-include') */
    id: string;

    /** Human-readable name for display */
    name: string;

    /** Plugin version */
    version: string;

    /** Priority for detection (higher = checked first). Recommended: 100=column, 90=task, 80=regular */
    priority: number;

    /** File type this plugin produces */
    fileType: 'include-column' | 'include-task' | 'include-regular' | 'main';

    /** File extensions this plugin handles (e.g., ['.md', '.marp.md']) */
    extensions: string[];

    /** Regex pattern for detecting includes in content */
    includePattern: RegExp;

    /** Context where this pattern is valid */
    contextLocation: IncludeContextLocation;
}

/**
 * Where in the document an include pattern can appear
 */
export type IncludeContextLocation =
    | 'column-header'    // In ## Column Title lines
    | 'task-title'       // In - [ ] Task Title lines
    | 'description'      // In task descriptions
    | 'any';             // Anywhere (for generic patterns)

/**
 * Context provided when checking if a plugin can handle a request
 */
export interface ImportContext {
    /** Where in the document the include was found */
    location: IncludeContextLocation;

    /** Line number in the source file (0-based) */
    lineNumber?: number;

    /** Parent file reference (if available) */
    parentFile?: MainKanbanFile;

    /** Full line content (for additional context) */
    lineContent?: string;
}

/**
 * Result of detecting includes in content
 */
export interface IncludeMatch {
    /** The plugin that detected this match */
    pluginId: string;

    /** Extracted file path from the include directive */
    filePath: string;

    /** Full matched text (e.g., '!!!include(file.md)!!!') */
    fullMatch: string;

    /** Start index in the source string */
    startIndex: number;

    /** End index in the source string */
    endIndex: number;

    /** Context where this match was found */
    context: IncludeContextLocation;
}

/**
 * Dependencies injected when creating files
 */
export interface PluginDependencies {
    conflictResolver: ConflictResolver;
    backupManager: BackupManager;
    isInline?: boolean;
}

/**
 * Options for parsing content
 */
export interface ParseOptions {
    /** File path for context */
    filePath?: string;

    /** Main kanban file path for relative resolution */
    mainFilePath?: string;

    /** Existing tasks to preserve IDs from (by position) */
    existingTasks?: KanbanTask[];

    /** Column ID for ID generation */
    columnId?: string;
}

/**
 * Result of parsing content
 */
export interface ParseResult {
    /** Whether parsing succeeded */
    success: boolean;

    /** Parsed data (type depends on plugin) */
    data?: KanbanTask[] | string | any;

    /** Error message if failed */
    error?: string;
}

/**
 * Options for generating content
 */
export interface GenerateOptions {
    /** Whether to filter include markers from output */
    filterIncludes?: boolean;

    /** Whether to include Marp directives */
    includeMarpDirectives?: boolean;
}

/**
 * Context provided during plugin lifecycle
 */
export interface PluginContext {
    /** Extension context (for storage, etc.) */
    extensionContext?: any;

    /** Logger for plugin output */
    logger?: {
        info(message: string): void;
        warn(message: string): void;
        error(message: string): void;
        debug(message: string): void;
    };
}

/**
 * Import Plugin Interface
 *
 * Plugins implementing this interface can:
 * - Detect includes in content based on their pattern
 * - Create appropriate MarkdownFile instances
 * - Parse file content into structured data
 * - Generate content from structured data
 */
export interface ImportPlugin {
    /** Plugin metadata describing capabilities */
    readonly metadata: ImportPluginMetadata;

    /**
     * Check if this plugin can handle a file at the given path and context
     *
     * @param path - File path (relative or absolute)
     * @param context - Context information about where the include was found
     * @returns true if this plugin should handle the file
     */
    canHandle(path: string, context: ImportContext): boolean;

    /**
     * Detect all includes in content that this plugin handles
     *
     * @param content - Content to search for includes
     * @param context - Context about where the content comes from
     * @returns Array of detected include matches
     */
    detectIncludes(content: string, context: ImportContext): IncludeMatch[];

    /**
     * Create a MarkdownFile instance for the given path
     *
     * @param relativePath - Relative path to the include file
     * @param parentFile - Parent MainKanbanFile
     * @param dependencies - Injected dependencies
     * @returns Created file instance
     */
    createFile(
        relativePath: string,
        parentFile: MainKanbanFile,
        dependencies: PluginDependencies
    ): MarkdownFile;

    /**
     * Parse file content into structured data (optional)
     * Only needed for plugins that transform content (e.g., presentation → tasks)
     *
     * @param content - File content to parse
     * @param options - Parsing options
     * @returns Parse result with data or error
     */
    parseContent?(content: string, options: ParseOptions): ParseResult;

    /**
     * Generate file content from structured data (optional)
     * Only needed for plugins that transform content
     *
     * @param data - Data to convert (e.g., KanbanTask[])
     * @param options - Generation options
     * @returns Generated content string
     */
    generateContent?(data: any, options: GenerateOptions): string;

    /**
     * Called when the plugin is activated (optional)
     * Use for initialization that requires async operations
     *
     * @param context - Plugin context with services
     */
    activate?(context: PluginContext): Promise<void>;

    /**
     * Called when the plugin is deactivated (optional)
     * Use for cleanup operations
     */
    deactivate?(): Promise<void>;
}
