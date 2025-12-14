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
    ImportPluginMetadata,
    PluginDependencies,
    ParseOptions,
    ParseResult,
    GenerateOptions
} from '../interfaces';
import { AbstractImportPlugin } from './AbstractImportPlugin';
import { IncludeFile } from '../../files/IncludeFile';
import { MainKanbanFile } from '../../files/MainKanbanFile';
import { PresentationParser } from '../../services/export/PresentationParser';
import { KanbanTask } from '../../board/KanbanTypes';
import { INCLUDE_SYNTAX } from '../../constants/IncludeConstants';

/**
 * Column Include Plugin
 *
 * Creates IncludeFile instances with fileType='include-column'.
 * All column-specific functionality is in the unified IncludeFile class.
 *
 * Inherits from AbstractImportPlugin:
 * - canHandle() - checks 'column-header' context
 * - detectIncludes() - regex matching
 * - activate/deactivate - standard lifecycle
 *
 * Overrides:
 * - parseContent() - parses presentation format to tasks
 * - generateContent() - generates presentation from tasks
 */
export class ColumnIncludePlugin extends AbstractImportPlugin {
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
    override parseContent(content: string, options: ParseOptions): ParseResult {
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
}
