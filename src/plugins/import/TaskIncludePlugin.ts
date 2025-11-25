/**
 * Task Include Plugin
 *
 * Handles task include files that contain markdown content for task descriptions.
 * The full file content becomes the task's description.
 *
 * Features:
 * - Detects !!!include()!!! in task titles (- [ ] Title)
 * - Creates IncludeFile instances with fileType='include-task'
 * - Stores raw markdown content as task description
 * - No structural parsing (content is used as-is)
 *
 * @module plugins/import/TaskIncludePlugin
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
 * Task Include Plugin
 *
 * Creates IncludeFile instances with fileType='include-task'.
 * Task includes store raw markdown that becomes the task description.
 */
export class TaskIncludePlugin implements ImportPlugin {
    readonly metadata: ImportPluginMetadata = {
        id: 'task-include',
        name: 'Task Include (Markdown Content)',
        version: '1.0.0',
        priority: 90,  // Second highest - checked after column includes
        fileType: 'include-task',
        extensions: ['.md'],
        includePattern: INCLUDE_SYNTAX.REGEX,
        contextLocation: 'task-title'
    };

    /**
     * Check if this plugin can handle the file
     *
     * Task includes are ONLY valid in task titles.
     */
    canHandle(path: string, context: ImportContext): boolean {
        // Must be in a task title context
        if (context.location !== 'task-title') {
            return false;
        }

        // Check file extension
        const ext = this._getExtension(path);
        return this.metadata.extensions.includes(ext);
    }

    /**
     * Detect includes in content
     *
     * Only detects in task-title context.
     */
    detectIncludes(content: string, context: ImportContext): IncludeMatch[] {
        // Only detect in task titles
        if (context.location !== 'task-title') {
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
                context: 'task-title'
            });
        }

        return matches;
    }

    /**
     * Create an IncludeFile instance with fileType='include-task'
     */
    createFile(
        relativePath: string,
        parentFile: MainKanbanFile,
        dependencies: PluginDependencies
    ): IncludeFile {
        return new IncludeFile(
            relativePath,
            parentFile,
            dependencies.conflictResolver,
            dependencies.backupManager,
            'include-task',
            dependencies.isInline ?? false
        );
    }

    /**
     * Parse content (task includes use raw content)
     *
     * For task includes, the content is used as-is for the task description.
     * No structural parsing is performed.
     */
    parseContent(content: string, options: ParseOptions): ParseResult {
        // Task includes don't parse content - it's used directly as description
        return {
            success: true,
            data: content  // Raw content becomes task description
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
