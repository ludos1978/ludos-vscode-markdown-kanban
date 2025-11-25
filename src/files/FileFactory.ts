import { MainKanbanFile } from './MainKanbanFile';
import { ColumnIncludeFile } from './ColumnIncludeFile';
import { TaskIncludeFile } from './TaskIncludeFile';
import { RegularIncludeFile } from './RegularIncludeFile';
import { MarkdownFile } from './MarkdownFile';
import { MarkdownFileRegistry } from './MarkdownFileRegistry';
import { FileManager } from '../fileManager';
import { ConflictResolver } from '../conflictResolver';
import { BackupManager } from '../backupManager';
import { PluginRegistry, ImportContext, IncludeContextLocation } from '../plugins';

/**
 * Factory for creating MarkdownFile instances with proper dependency injection.
 *
 * This factory encapsulates the creation logic and ensures all files
 * are created with the correct dependencies.
 *
 * Supports both:
 * 1. Plugin-based creation via PluginRegistry (preferred)
 * 2. Direct type-based creation (fallback for backwards compatibility)
 *
 * Usage:
 *   const factory = new FileFactory(fileManager, conflictResolver, backupManager);
 *   const mainFile = factory.createMainFile('/path/to/kanban.md');
 *   const columnInclude = factory.createColumnInclude('./includes/column.md', mainFile);
 *
 * Plugin-based usage:
 *   const includeFile = factory.createIncludeViaPlugin(
 *       './includes/column.md',
 *       mainFile,
 *       { location: 'column-header' }
 *   );
 */
export class FileFactory {
    private _pluginRegistry: PluginRegistry;

    constructor(
        private fileManager: FileManager,
        private conflictResolver: ConflictResolver,
        private backupManager: BackupManager,
        private fileRegistry: MarkdownFileRegistry
    ) {
        this._pluginRegistry = PluginRegistry.getInstance();
    }

    // ============= MAIN FILE =============

    /**
     * Create a MainKanbanFile instance
     */
    public createMainFile(filePath: string): MainKanbanFile {
        return new MainKanbanFile(
            filePath,
            this.fileManager,
            this.conflictResolver,
            this.backupManager,
            this.fileRegistry
        );
    }

    // ============= INCLUDE FILES =============

    /**
     * Create a ColumnIncludeFile instance
     */
    public createColumnInclude(
        relativePath: string,
        parentFile: MainKanbanFile,
        isInline: boolean = false
    ): ColumnIncludeFile {
        return new ColumnIncludeFile(
            relativePath,
            parentFile,
            this.conflictResolver,
            this.backupManager,
            isInline
        );
    }

    /**
     * Create a TaskIncludeFile instance
     */
    public createTaskInclude(
        relativePath: string,
        parentFile: MainKanbanFile,
        isInline: boolean = false
    ): TaskIncludeFile {
        return new TaskIncludeFile(
            relativePath,
            parentFile,
            this.conflictResolver,
            this.backupManager,
            isInline
        );
    }

    /**
     * Create a RegularIncludeFile instance
     */
    public createRegularInclude(
        relativePath: string,
        parentFile: MainKanbanFile,
        isInline: boolean = false
    ): RegularIncludeFile {
        return new RegularIncludeFile(
            relativePath,
            parentFile,
            this.conflictResolver,
            this.backupManager,
            isInline
        );
    }

    // ============= PLUGIN-BASED CREATION =============

    /**
     * Create include file using plugin system
     *
     * This is the preferred method for creating include files.
     * Uses the PluginRegistry to find the appropriate plugin based on context.
     *
     * @param relativePath - Relative path to the include file
     * @param parentFile - Parent MainKanbanFile
     * @param context - Import context specifying where the include was found
     * @param isInline - Whether this is an inline include
     * @returns Created file instance or null if no plugin can handle it
     */
    public createIncludeViaPlugin(
        relativePath: string,
        parentFile: MainKanbanFile,
        context: ImportContext,
        isInline: boolean = false
    ): MarkdownFile | null {
        const plugin = this._pluginRegistry.findImportPlugin(relativePath, context);

        if (!plugin) {
            console.warn(`[FileFactory] No plugin found for: ${relativePath} in context: ${context.location}`);
            return null;
        }

        return plugin.createFile(relativePath, parentFile, {
            conflictResolver: this.conflictResolver,
            backupManager: this.backupManager,
            isInline
        });
    }

    // ============= AUTO-DETECTION =============

    /**
     * Create include file with type auto-detection based on file type parameter
     *
     * This method first tries to use the plugin system, then falls back
     * to direct creation for backwards compatibility.
     *
     * @param relativePath - Relative path to the include file
     * @param parentFile - Parent MainKanbanFile
     * @param type - Include type ('include-regular', 'include-column', 'include-task')
     * @param isInline - Whether this is an inline include
     * @returns Created file instance
     */
    public createInclude(
        relativePath: string,
        parentFile: MainKanbanFile,
        type: 'include-regular' | 'include-column' | 'include-task',
        isInline: boolean = false
    ): MarkdownFile {
        // Map type to context location
        const contextLocation = this._typeToContextLocation(type);
        const context: ImportContext = {
            location: contextLocation,
            parentFile
        };

        // Try plugin-based creation first
        const pluginResult = this.createIncludeViaPlugin(relativePath, parentFile, context, isInline);
        if (pluginResult) {
            return pluginResult;
        }

        // Fallback to direct creation (backwards compatibility)
        console.log(`[FileFactory] Falling back to direct creation for type: ${type}`);
        switch (type) {
            case 'include-regular':
                return this.createRegularInclude(relativePath, parentFile, isInline);
            case 'include-column':
                return this.createColumnInclude(relativePath, parentFile, isInline);
            case 'include-task':
                return this.createTaskInclude(relativePath, parentFile, isInline);
            default:
                throw new Error(`Unknown include type: ${type}`);
        }
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Map include type to context location
     */
    private _typeToContextLocation(type: string): IncludeContextLocation {
        switch (type) {
            case 'include-column':
                return 'column-header';
            case 'include-task':
                return 'task-title';
            case 'include-regular':
                return 'description';
            default:
                return 'any';
        }
    }
}
