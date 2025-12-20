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

import { ImportPluginMetadata, PluginDependencies } from '../interfaces';
import { AbstractImportPlugin } from './AbstractImportPlugin';
import { IncludeFile } from '../../files/IncludeFile';
import { IMainKanbanFile } from '../../files/FileInterfaces';
import { INCLUDE_SYNTAX } from '../../constants/IncludeConstants';

/**
 * Task Include Plugin
 *
 * Creates IncludeFile instances with fileType='include-task'.
 * Task includes store raw markdown that becomes the task description.
 *
 * Inherits from AbstractImportPlugin:
 * - canHandle() - checks 'task-title' context
 * - detectIncludes() - regex matching
 * - parseContent() - returns raw content (default)
 * - activate/deactivate - standard lifecycle
 */
export class TaskIncludePlugin extends AbstractImportPlugin {
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
     * Create an IncludeFile instance with fileType='include-task'
     */
    createFile(
        relativePath: string,
        parentFile: IMainKanbanFile,
        dependencies: PluginDependencies
    ): IncludeFile {
        return new IncludeFile(
            relativePath,
            parentFile,
            dependencies.conflictResolver,
            dependencies.backupManager,
            'include-task'
        );
    }
}
