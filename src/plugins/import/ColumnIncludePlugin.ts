/**
 * Column Include Plugin
 *
 * Handles column include files that use presentation (Marp) format.
 * Each slide in the presentation becomes a task in the kanban column.
 *
 * Features:
 * - Detects !!!include()!!! in column headers (## Title)
 * - Creates IncludeFile instances with fileType='include-column'
 * - Parses presentation format to KanbanTask[]
 * - Generates presentation format from KanbanTask[]
 * - Preserves task IDs by position matching
 *
 * @module plugins/import/ColumnIncludePlugin
 */

import {
    ImportPlugin,
    ImportPluginMetadata,
    ImportContext,
    IncludeMatch,
    PluginDependencies,
    ParseOptions,
    ParseResult,
    GenerateOptions,
    PluginContext
} from '../interfaces';
import { IncludeFile } from '../../files/IncludeFile';
import { MainKanbanFile } from '../../files/MainKanbanFile';
import { PresentationParser } from '../../presentationParser';
import { KanbanTask } from '../../markdownParser';
import { INCLUDE_SYNTAX } from '../../constants/IncludeConstants';
import { FileTypeUtils } from '../../utils/fileTypeUtils';

/**
 * Column Include Plugin
 *
 * Creates IncludeFile instances with fileType='include-column'.
 * All column-specific functionality is in the unified IncludeFile class.
 */
export class ColumnIncludePlugin implements ImportPlugin {
    readonly metadata: ImportPluginMetadata = {
        id: 'column-include',
        name: 'Column Include (Marp Presentation)',
        version: '1.0.0',
        priority: 100,  // Highest - checked first for column headers
        fileType: 'include-column',
        extensions: ['.md', '.marp.md'],
        includePattern: INCLUDE_SYNTAX.REGEX,
        contextLocation: 'column-header'
    };

    /**
     * Check if this plugin can handle the file
     *
     * Column includes are ONLY valid in column headers.
     */
    canHandle(path: string, context: ImportContext): boolean {
        // Must be in a column header context
        if (context.location !== 'column-header') {
            return false;
        }

        // Check file extension
        const ext = FileTypeUtils.getExtensionWithDot(path);
        return this.metadata.extensions.includes(ext);
    }

    /**
     * Detect includes in content
     *
     * Only detects in column-header context.
     */
    detectIncludes(content: string, context: ImportContext): IncludeMatch[] {
        // Only detect in column headers
        if (context.location !== 'column-header') {
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
                context: 'column-header'
            });
        }

        return matches;
    }

    /**
     * Create an IncludeFile instance with fileType='include-column'
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
            'include-column',
            dependencies.isInline ?? false
        );
    }

    /**
     * Parse presentation content to KanbanTask[]
     *
     * Delegates to PresentationParser for actual parsing.
     * Preserves task IDs by position matching with existingTasks.
     */
    parseContent(content: string, options: ParseOptions): ParseResult {
        try {
            // Use PresentationParser for slide parsing
            const slides = PresentationParser.parsePresentation(content);
            const tasks = PresentationParser.slidesToTasks(
                slides,
                options.filePath,
                options.mainFilePath
            );

            // Preserve existing task IDs by position
            if (options.existingTasks && options.existingTasks.length > 0) {
                const columnId = options.columnId;

                tasks.forEach((task, index) => {
                    const existingTask = options.existingTasks?.[index];
                    if (existingTask?.id) {
                        task.id = existingTask.id;
                    } else if (columnId) {
                        task.id = `task-${columnId}-${index}`;
                    }

                    // Tasks from column includes are NOT individual includes
                    task.includeMode = false;
                    task.includeFiles = undefined;
                });
            }

            return {
                success: true,
                data: tasks
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to parse presentation: ${error}`
            };
        }
    }

    /**
     * Generate presentation content from KanbanTask[]
     *
     * Delegates to PresentationGenerator.
     */
    generateContent(data: KanbanTask[], options: GenerateOptions): string {
        // Dynamic import to avoid circular dependency
        const { PresentationGenerator } = require('../../services/export/PresentationGenerator');

        return PresentationGenerator.fromTasks(data, {
            filterIncludes: options.filterIncludes ?? true,
            includeMarpDirectives: options.includeMarpDirectives ?? false
        });
    }

    /**
     * Plugin activation (optional initialization)
     */
    async activate(context: PluginContext): Promise<void> {
        context.logger?.info(`[${this.metadata.id}] Plugin activated`);
    }

    /**
     * Plugin deactivation (cleanup)
     */
    async deactivate(): Promise<void> {
        // No cleanup needed
    }

}
