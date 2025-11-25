/**
 * Regular Include Plugin
 *
 * Handles regular include files that appear in task descriptions.
 * These are rendered inline within task descriptions as bordered content.
 *
 * Features:
 * - Detects !!!include()!!! in task descriptions
 * - Creates IncludeFile instances with fileType='include-regular'
 * - Content is rendered by frontend (markdown-it-include plugin)
 * - Always treated as inline includes
 *
 * @module plugins/import/RegularIncludePlugin
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
import { IncludeFile } from '../../files/IncludeFile';
import { MainKanbanFile } from '../../files/MainKanbanFile';
import { INCLUDE_SYNTAX } from '../../constants/IncludeConstants';

/**
 * Regular Include Plugin
 *
 * Creates IncludeFile instances with fileType='include-regular'.
 * Regular includes are rendered inline in task descriptions.
 */
export class RegularIncludePlugin implements ImportPlugin {
    readonly metadata: ImportPluginMetadata = {
        id: 'regular-include',
        name: 'Regular Include (Inline Markdown)',
        version: '1.0.0',
        priority: 80,  // Lowest - checked after column and task includes
        fileType: 'include-regular',
        extensions: ['.md'],
        includePattern: INCLUDE_SYNTAX.REGEX,
        contextLocation: 'description'
    };

    /**
     * Check if this plugin can handle the file
     *
     * Regular includes are ONLY valid in task descriptions.
     */
    canHandle(path: string, context: ImportContext): boolean {
        // Must be in a description context
        if (context.location !== 'description') {
            return false;
        }

        // Check file extension
        const ext = this._getExtension(path);
        return this.metadata.extensions.includes(ext);
    }

    /**
     * Detect includes in content
     *
     * Only detects in description context.
     */
    detectIncludes(content: string, context: ImportContext): IncludeMatch[] {
        // Only detect in descriptions
        if (context.location !== 'description') {
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
                context: 'description'
            });
        }

        return matches;
    }

    /**
     * Create an IncludeFile instance with fileType='include-regular'
     *
     * Regular includes are always inline (isInline = true).
     */
    createFile(
        relativePath: string,
        parentFile: MainKanbanFile,
        dependencies: PluginDependencies
    ): IncludeFile {
        // Regular includes are always inline
        return new IncludeFile(
            relativePath,
            parentFile,
            dependencies.conflictResolver,
            dependencies.backupManager,
            'include-regular',
            true  // Always inline
        );
    }

    /**
     * Parse content (regular includes use raw content)
     *
     * Regular includes don't parse content on the backend.
     * The frontend markdown-it-include plugin handles rendering.
     */
    parseContent(content: string, options: ParseOptions): ParseResult {
        // Regular includes don't parse content - frontend handles rendering
        return {
            success: true,
            data: content  // Raw content for frontend rendering
        };
    }

    /**
     * Plugin activation
     */
    async activate(context: PluginContext): Promise<void> {
        context.logger?.info(`[${this.metadata.id}] Plugin activated`);
    }

    /**
     * Plugin deactivation
     */
    async deactivate(): Promise<void> {
        // No cleanup needed
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Get file extension (lowercase)
     */
    private _getExtension(path: string): string {
        const lastDot = path.lastIndexOf('.');
        if (lastDot === -1) {
            return '';
        }
        return path.substring(lastDot).toLowerCase();
    }
}
