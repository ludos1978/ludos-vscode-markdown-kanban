/**
 * Export Plugin Interface
 *
 * Defines the contract for plugins that handle file export operations.
 * This includes converting kanban boards to various output formats.
 *
 * @module plugins/interfaces/ExportPlugin
 */

import { KanbanBoard } from '../../markdownParser';

/**
 * Describes a single export format supported by a plugin
 */
export interface ExportFormat {
    /** Unique format identifier (e.g., 'marp-pdf', 'marp-pptx') */
    id: string;

    /** Human-readable format name */
    name: string;

    /** File extension (e.g., '.pdf', '.pptx') */
    extension: string;

    /** MIME type for the format */
    mimeType: string;

    /** Description shown in export dialogs */
    description?: string;
}

/**
 * Metadata describing an export plugin's capabilities
 */
export interface ExportPluginMetadata {
    /** Unique identifier for this plugin */
    id: string;

    /** Human-readable name for display */
    name: string;

    /** Plugin version */
    version: string;

    /** Supported export formats */
    formats: ExportFormat[];

    /** Whether this plugin requires external tools (e.g., Marp CLI) */
    requiresExternalTool?: boolean;

    /** Name of required external tool (for error messages) */
    externalToolName?: string;
}

/**
 * Options for export operations
 */
export interface ExportOptions {
    /** Format ID to export to */
    formatId: string;

    /** Input file path (source markdown) */
    inputPath: string;

    /** Output file path */
    outputPath: string;

    /** Enable watch mode (auto-rebuild on changes) */
    watchMode?: boolean;

    /** Marp-specific: make PPTX editable */
    pptxEditable?: boolean;

    /** Theme name to use */
    theme?: string;

    /** Custom engine path */
    enginePath?: string;

    /** Additional CLI arguments */
    additionalArgs?: string[];

    /** Plugin-specific options */
    pluginOptions?: Record<string, unknown>;
}

/**
 * Result of an export operation
 */
export interface ExportResult {
    /** Whether export succeeded */
    success: boolean;

    /** Output file path (if success) */
    outputPath?: string;

    /** Error message (if failed) */
    error?: string;

    /** Additional metadata about the export */
    metadata?: {
        /** Time taken in milliseconds */
        duration?: number;

        /** Size of output file in bytes */
        size?: number;

        /** Warnings generated during export */
        warnings?: string[];
    };
}

/**
 * Options for preview generation
 */
export interface PreviewOptions {
    /** Format to preview */
    formatId: string;

    /** Maximum preview size (for images) */
    maxSize?: { width: number; height: number };

    /** Quality for lossy formats (0-100) */
    quality?: number;
}

/**
 * Export Plugin Interface
 *
 * Plugins implementing this interface can:
 * - Export kanban boards to various formats
 * - Provide format availability information
 * - Generate previews of export output
 */
export interface ExportPlugin {
    /** Plugin metadata describing capabilities */
    readonly metadata: ExportPluginMetadata;

    /**
     * Get list of supported export formats
     *
     * @returns Array of supported formats
     */
    getSupportedFormats(): ExportFormat[];

    /**
     * Check if this plugin can export to the given format
     *
     * @param board - Board to export
     * @param formatId - Format ID to check
     * @returns true if export is possible
     */
    canExport(board: KanbanBoard, formatId: string): boolean;

    /**
     * Check if the plugin's external dependencies are available
     * (e.g., Marp CLI is installed)
     *
     * @returns true if all dependencies are available
     */
    isAvailable?(): Promise<boolean>;

    /**
     * Get version information for external tools
     *
     * @returns Version string or null if not available
     */
    getToolVersion?(): Promise<string | null>;

    /**
     * Export a board to the specified format
     *
     * @param board - Board to export
     * @param options - Export options
     * @returns Export result
     */
    export(board: KanbanBoard, options: ExportOptions): Promise<ExportResult>;

    /**
     * Generate a preview of the export (optional)
     *
     * @param board - Board to preview
     * @param options - Preview options
     * @returns HTML string for preview display
     */
    preview?(board: KanbanBoard, options: PreviewOptions): Promise<string>;

    /**
     * Stop any active watch processes for a file (optional)
     *
     * @param filePath - File path to stop watching
     */
    stopWatch?(filePath: string): Promise<void>;

    /**
     * Stop all active watch processes (optional)
     */
    stopAllWatches?(): Promise<void>;

    /**
     * Check if a file is being watched (optional)
     *
     * @param filePath - File path to check
     * @returns true if file is being watched
     */
    isWatching?(filePath: string): boolean;

    /**
     * Get available themes for this export plugin (optional)
     *
     * @returns Array of theme names
     */
    getAvailableThemes?(): Promise<string[]>;
}
