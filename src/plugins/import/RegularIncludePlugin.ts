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

import { ImportPluginMetadata, PluginDependencies } from '../interfaces';
import { AbstractImportPlugin } from './AbstractImportPlugin';
import { IncludeFile } from '../../files/IncludeFile';
import { IMainKanbanFile } from '../../files/FileInterfaces';
import { INCLUDE_SYNTAX } from '../../constants/IncludeConstants';

/**
 * Regular Include Plugin
 *
 * Creates IncludeFile instances with fileType='include-regular'.
 * Regular includes are rendered inline in task descriptions.
 *
 * Inherits from AbstractImportPlugin:
 * - canHandle() - checks 'description' context
 * - detectIncludes() - regex matching
 * - parseContent() - returns raw content (default)
 * - activate/deactivate - standard lifecycle
 */
export class RegularIncludePlugin extends AbstractImportPlugin {
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
     * Create an IncludeFile instance with fileType='include-regular'
     *
     * Regular includes are always inline (isInline = true).
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
            'include-regular'
        );
    }
}
