import { MainKanbanFile } from './MainKanbanFile';
import { ColumnIncludeFile } from './ColumnIncludeFile';
import { TaskIncludeFile } from './TaskIncludeFile';
import { RegularIncludeFile } from './RegularIncludeFile';
import { MarkdownFile } from './MarkdownFile';
import { FileManager } from '../fileManager';
import { ConflictResolver } from '../conflictResolver';
import { BackupManager } from '../backupManager';

/**
 * Factory for creating MarkdownFile instances with proper dependency injection.
 *
 * This factory encapsulates the creation logic and ensures all files
 * are created with the correct dependencies.
 *
 * Usage:
 *   const factory = new FileFactory(fileManager, conflictResolver, backupManager);
 *   const mainFile = factory.createMainFile('/path/to/kanban.md');
 *   const columnInclude = factory.createColumnInclude('./includes/column.md', mainFile);
 */
export class FileFactory {
    constructor(
        private fileManager: FileManager,
        private conflictResolver: ConflictResolver,
        private backupManager: BackupManager
    ) {}

    // ============= MAIN FILE =============

    /**
     * Create a MainKanbanFile instance
     */
    public createMainFile(filePath: string): MainKanbanFile {
        return new MainKanbanFile(
            filePath,
            this.fileManager,
            this.conflictResolver,
            this.backupManager
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

    // ============= AUTO-DETECTION =============

    /**
     * Create include file with type auto-detection based on file type parameter
     */
    public createInclude(
        relativePath: string,
        parentFile: MainKanbanFile,
        type: 'include-regular' | 'include-column' | 'include-task',
        isInline: boolean = false
    ): MarkdownFile {
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
}
