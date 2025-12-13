/**
 * Abstract Import Plugin Base Class
 *
 * Provides common implementation for ImportPlugin interface methods.
 * Subclasses only need to define metadata and override specific methods.
 *
 * Shared implementations:
 * - canHandle() - checks context.location matches metadata.contextLocation
 * - detectIncludes() - regex matching using metadata.includePattern
 * - activate() / deactivate() - standard lifecycle logging
 *
 * @module plugins/import/AbstractImportPlugin
 */

import {
    ImportPlugin,
    ImportPluginMetadata,
    ImportContext,
    IncludeMatch,
    PluginDependencies,
    ParseOptions,
    ParseResult,
    PluginContext
} from '../interfaces';
import { MarkdownFile } from '../../files/MarkdownFile';
import { MainKanbanFile } from '../../files/MainKanbanFile';
import { FileTypeUtils } from '../../utils/fileTypeUtils';

/**
 * Abstract base class for import plugins.
 *
 * Provides default implementations for common ImportPlugin methods.
 * Subclasses must define metadata and createFile(), may override parseContent().
 */
export abstract class AbstractImportPlugin implements ImportPlugin {
    /**
     * Plugin metadata - must be defined by subclasses
     */
    abstract readonly metadata: ImportPluginMetadata;

    /**
     * Check if this plugin can handle the file at the given path and context.
     *
     * Default implementation checks:
     * 1. context.location matches metadata.contextLocation
     * 2. File extension is in metadata.extensions
     *
     * @param path - File path (relative or absolute)
     * @param context - Context about where the include was found
     * @returns true if this plugin should handle the file
     */
    canHandle(path: string, context: ImportContext): boolean {
        // Check context location matches
        if (context.location !== this.metadata.contextLocation) {
            return false;
        }

        // Check file extension
        const ext = FileTypeUtils.getExtensionWithDot(path);
        return this.metadata.extensions.includes(ext);
    }

    /**
     * Detect all includes in content that this plugin handles.
     *
     * Default implementation uses metadata.includePattern regex to find matches.
     * Only detects in content matching metadata.contextLocation.
     *
     * @param content - Content to search for includes
     * @param context - Context about where the content comes from
     * @returns Array of detected include matches
     */
    detectIncludes(content: string, context: ImportContext): IncludeMatch[] {
        // Only detect in matching context
        if (context.location !== this.metadata.contextLocation) {
            return [];
        }

        const matches: IncludeMatch[] = [];
        // Create a fresh regex to avoid lastIndex issues
        const regex = new RegExp(this.metadata.includePattern.source, 'g');
        let match;

        while ((match = regex.exec(content)) !== null) {
            matches.push({
                pluginId: this.metadata.id,
                filePath: match[1].trim(),
                fullMatch: match[0],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                context: this.metadata.contextLocation
            });
        }

        return matches;
    }

    /**
     * Create a MarkdownFile instance for the given path.
     * Must be implemented by subclasses with specific file type.
     *
     * @param relativePath - Relative path to the include file
     * @param parentFile - Parent MainKanbanFile
     * @param dependencies - Injected dependencies
     * @returns Created file instance
     */
    abstract createFile(
        relativePath: string,
        parentFile: MainKanbanFile,
        dependencies: PluginDependencies
    ): MarkdownFile;

    /**
     * Parse file content into structured data.
     *
     * Default implementation returns raw content (suitable for task/regular includes).
     * Override in subclasses that need complex parsing (e.g., ColumnIncludePlugin).
     *
     * @param content - File content to parse
     * @param _options - Parsing options (unused in default impl)
     * @returns Parse result with raw content
     */
    parseContent(content: string, _options: ParseOptions): ParseResult {
        return {
            success: true,
            data: content
        };
    }

    /**
     * Plugin activation - called when plugin is enabled.
     *
     * Default implementation logs activation.
     * Override if plugin needs async initialization.
     *
     * @param context - Plugin context with logger
     */
    async activate(context: PluginContext): Promise<void> {
        context.logger?.info(`[${this.metadata.id}] Plugin activated`);
    }

    /**
     * Plugin deactivation - called when plugin is disabled.
     *
     * Default implementation does nothing.
     * Override if plugin needs cleanup.
     */
    async deactivate(): Promise<void> {
        // No cleanup needed by default
    }
}
