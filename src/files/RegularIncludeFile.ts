import { IncludeFile } from './IncludeFile';
import { MainKanbanFile } from './MainKanbanFile';
import { ConflictResolver } from '../conflictResolver';
import { BackupManager } from '../backupManager';

/**
 * Represents a regular include file (!!!include() syntax).
 *
 * Regular includes are rendered inline within task descriptions as bordered content.
 * The included markdown is displayed as-is without structural parsing.
 *
 * Responsibilities:
 * - Manage file content (read/write/track changes)
 * - Handle conflict resolution
 * - Coordinate with frontend rendering (markdown-it-include plugin)
 *
 * Similar to TaskIncludeFile, this is pure content management without structural parsing.
 */
export class RegularIncludeFile extends IncludeFile {
    constructor(
        relativePath: string,
        parentFile: MainKanbanFile,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        isInline: boolean = true  // Regular includes are always inline
    ) {
        super(relativePath, parentFile, conflictResolver, backupManager, isInline);
    }

    // ============= FILE TYPE =============

    public getFileType(): 'include-regular' {
        return 'include-regular';
    }

    // ============= VALIDATION =============

    /**
     * Validate content - regular includes accept any markdown content
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
        // Regular includes are plain markdown - no structural validation needed
        return { valid: true };
    }
}
