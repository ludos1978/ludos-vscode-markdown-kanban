import { MainKanbanFile } from './MainKanbanFile';
import { IncludeFile, IncludeFileType } from './IncludeFile';
import { MarkdownFileRegistry } from './MarkdownFileRegistry';
import { FileManager } from '../fileManager';
import { ConflictResolver } from '../services/ConflictResolver';
import { BackupManager } from '../services/BackupManager';
import { PluginRegistry, ImportContext, IncludeContextLocation } from '../plugins';

/**
 * Factory for creating MarkdownFile instances with proper dependency injection.
 *
 * This factory encapsulates the creation logic and ensures all files
 * are created with the correct dependencies.
 *
 * Uses the plugin system exclusively for include file creation.
 * No fallback code - plugins MUST be loaded for include files to work.
 *
 * Usage:
 *   const factory = new FileFactory(fileManager, conflictResolver, backupManager);
 *   const mainFile = factory.createMainFile('/path/to/kanban.md');
 *   const includeFile = factory.createInclude('./includes/column.md', mainFile, 'include-column');
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

    // ============= INCLUDE FILES (PLUGIN-BASED ONLY) =============

    /**
     * Create include file using plugin system
     *
     * Uses the PluginRegistry to find the appropriate plugin based on context.
     *
     * @param relativePath - Relative path to the include file
     * @param parentFile - Parent MainKanbanFile
     * @param context - Import context specifying where the include was found
     * @returns Created file instance
     * @throws Error if no plugin can handle the file
     */
    public createIncludeViaPlugin(
        relativePath: string,
        parentFile: MainKanbanFile,
        context: ImportContext
    ): IncludeFile {
        const plugin = this._pluginRegistry.findImportPlugin(relativePath, context);

        if (!plugin) {
            throw new Error(
                `[FileFactory] No plugin found for include: ${relativePath} in context: ${context.location}. ` +
                `Ensure plugins are loaded via PluginLoader.loadBuiltinPlugins() at extension activation.`
            );
        }

        return plugin.createFile(relativePath, parentFile, {
            conflictResolver: this.conflictResolver,
            backupManager: this.backupManager
        }) as IncludeFile;
    }

    /**
     * Create include file with type specification
     *
     * This method uses the plugin system based on the file type.
     *
     * @param relativePath - Relative path to the include file
     * @param parentFile - Parent MainKanbanFile
     * @param type - Include type ('include-regular', 'include-column', 'include-task')
     * @returns Created file instance
     * @throws Error if no plugin can handle the file
     */
    public createInclude(
        relativePath: string,
        parentFile: MainKanbanFile,
        type: IncludeFileType
    ): IncludeFile {
        // Map type to context location
        const contextLocation = this._typeToContextLocation(type);
        const context: ImportContext = {
            location: contextLocation,
            parentFile
        };

        // Use plugin-based creation (no fallback)
        return this.createIncludeViaPlugin(relativePath, parentFile, context);
    }

    /**
     * Create include file directly without plugin lookup
     *
     * Use this when you already know the file type and don't need plugin detection.
     * This creates an IncludeFile instance directly.
     *
     * @param relativePath - Relative path to the include file
     * @param parentFile - Parent MainKanbanFile
     * @param fileType - Include file type
     * @returns Created IncludeFile instance
     */
    public createIncludeDirect(
        relativePath: string,
        parentFile: MainKanbanFile,
        fileType: IncludeFileType
    ): IncludeFile {
        return new IncludeFile(
            relativePath,
            parentFile,
            this.conflictResolver,
            this.backupManager,
            fileType
        );
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Map include type to context location
     */
    private _typeToContextLocation(type: IncludeFileType): IncludeContextLocation {
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
