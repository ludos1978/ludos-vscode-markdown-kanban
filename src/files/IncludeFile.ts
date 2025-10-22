import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
import { ConflictResolver, ConflictContext } from '../conflictResolver';
import { BackupManager } from '../backupManager';
import { MainKanbanFile } from './MainKanbanFile';

/**
 * Abstract base class for all include files (column, task, regular includes).
 *
 * Responsibilities:
 * - Manage include file paths (relative to parent)
 * - Resolve absolute paths
 * - Handle parent-child relationship
 * - Coordinate changes with parent file
 * - Handle include-specific conflicts
 */
export abstract class IncludeFile extends MarkdownFile {
    // ============= PARENT RELATIONSHIP =============
    protected _parentFile: MainKanbanFile;          // Reference to parent kanban file
    protected _absolutePath: string;                 // Cached absolute path

    // ============= INCLUDE-SPECIFIC STATE =============
    protected _isInline: boolean = false;           // True for inline includes (embedded in parent)

    constructor(
        relativePath: string,
        parentFile: MainKanbanFile,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        isInline: boolean = false
    ) {
        const absolutePath = IncludeFile._resolveAbsolutePath(relativePath, parentFile.getPath());

        super(absolutePath, relativePath, conflictResolver, backupManager);

        this._parentFile = parentFile;
        this._absolutePath = absolutePath;
        this._isInline = isInline;
    }

    // ============= PATH RESOLUTION =============

    /**
     * Get the parent file
     */
    public getParentFile(): MainKanbanFile {
        return this._parentFile;
    }

    /**
     * Get the parent file path
     */
    public getParentPath(): string {
        return this._parentFile.getPath();
    }

    /**
     * Get the absolute path (cached)
     */
    public getAbsolutePath(): string {
        return this._absolutePath;
    }

    /**
     * Check if this is an inline include (embedded in parent)
     */
    public isInline(): boolean {
        return this._isInline;
    }

    /**
     * Resolve relative path to absolute path
     */
    private static _resolveAbsolutePath(relativePath: string, parentPath: string): string {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }

        const parentDir = path.dirname(parentPath);
        return path.resolve(parentDir, relativePath);
    }

    // ============= FILE I/O =============

    /**
     * Read content from disk
     */
    public async readFromDisk(): Promise<string | null> {
        console.log(`[${this.getFileType()}] Reading from disk: ${this._relativePath}`);

        try {
            const content = await fs.promises.readFile(this._absolutePath, 'utf-8');
            console.log(`[${this.getFileType()}] Read ${content.length} characters from disk`);
            return content;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.warn(`[${this.getFileType()}] File not found: ${this._absolutePath}`);
                this._exists = false;
            } else {
                console.error(`[${this.getFileType()}] Failed to read file:`, error);
            }
            return null;
        }
    }

    /**
     * Write content to disk
     */
    public async writeToDisk(content: string): Promise<void> {
        console.log(`[${this.getFileType()}] Writing to disk: ${this._relativePath} (${content.length} characters)`);

        try {
            // Ensure directory exists
            const dir = path.dirname(this._absolutePath);
            await fs.promises.mkdir(dir, { recursive: true });

            // Write file
            await fs.promises.writeFile(this._absolutePath, content, 'utf-8');

            this._exists = true;
            this._lastModified = new Date();
            console.log(`[${this.getFileType()}] Successfully wrote to disk`);
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to write file:`, error);
            throw error;
        }
    }

    // ============= EXTERNAL CHANGE HANDLING =============

    /**
     * Handle external file change
     */
    public async handleExternalChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        console.log(`[${this.getFileType()}] Handling external change: ${changeType} - ${this._relativePath}`);

        if (changeType === 'deleted') {
            this._exists = false;
            console.warn(`[${this.getFileType()}] Include file was deleted: ${this._relativePath}`);
            await this.notifyParentOfChange();
            return;
        }

        if (changeType === 'created') {
            this._exists = true;
        }

        // Check for conflict
        if (this.hasConflict()) {
            console.log(`[${this.getFileType()}] Conflict detected - showing dialog`);
            await this.showConflictDialog();
        } else if (this.needsReload()) {
            console.log(`[${this.getFileType()}] Auto-reloading from disk`);
            await this.reload();
            await this.notifyParentOfChange();
        } else {
            console.log(`[${this.getFileType()}] External change detected but not processing (editing or has unsaved changes)`);
        }
    }

    // ============= PARENT NOTIFICATION =============

    /**
     * Notify parent file that this include has changed
     * (Subclasses can override for specific behavior)
     */
    protected async notifyParentOfChange(): Promise<void> {
        console.log(`[${this.getFileType()}] Notifying parent of change: ${this._relativePath}`);

        // Trigger parent to reload/reparse
        // The parent will re-read this include file and update the board
        if (this._parentFile) {
            // Check if parent needs to be reloaded
            const hasParentChanges = await this._parentFile.checkForExternalChanges();
            if (hasParentChanges) {
                console.log(`[${this.getFileType()}] Parent also has changes - reloading parent`);
            }
        }
    }

    // ============= CONFLICT CONTEXT =============

    protected getConflictContext(): ConflictContext {
        return {
            type: 'external_include',
            fileType: 'include',
            filePath: this._absolutePath,
            fileName: path.basename(this._relativePath),
            hasMainUnsavedChanges: this._parentFile.hasUnsavedChanges(),
            hasIncludeUnsavedChanges: this._hasUnsavedChanges,
            hasExternalChanges: this._hasFileSystemChanges,
            changedIncludeFiles: [this._relativePath],
            isClosing: false,
            isInEditMode: this._isInEditMode
        };
    }

    // ============= OVERRIDES =============

    /**
     * Override reload to also notify parent
     */
    public async reload(): Promise<void> {
        await super.reload();
        await this.notifyParentOfChange();
    }

    /**
     * Override save to also notify parent
     */
    public async save(): Promise<void> {
        await super.save();
        await this.notifyParentOfChange();
    }
}
