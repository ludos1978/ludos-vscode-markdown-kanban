import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
import { ConflictResolver, ConflictContext } from '../conflictResolver';
import { BackupManager } from '../backupManager';
import { MainKanbanFile } from './MainKanbanFile';
import { UnifiedChangeHandler } from '../core/UnifiedChangeHandler';

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
     * Handle external file change using unified change handler
     * This replaces the complex conflict detection logic with a single, consistent system
     */
    public async handleExternalChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        const changeHandler = UnifiedChangeHandler.getInstance();
        await changeHandler.handleExternalChange(this, changeType);
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

    // ============= BACKUP =============

    /**
     * Create backup of current content for include files
     * Since include files don't have TextDocuments, we write directly to a backup file
     */
    public async createBackup(label: string = 'manual'): Promise<void> {
        console.log(`[${this.getFileType()}] Creating backup with label '${label}': ${this._relativePath}`);

        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(path.dirname(this._absolutePath), '.backups');
            const filename = path.basename(this._absolutePath);
            const backupPath = path.join(backupDir, `${timestamp}_${label}_${filename}`);

            // Ensure backup directory exists
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            // Write current content to backup file
            await fs.promises.writeFile(backupPath, this._content, 'utf8');
            console.log(`[${this.getFileType()}] ✓ Backup created: ${backupPath}`);
        } catch (error) {
            console.error(`[${this.getFileType()}] ✗ Failed to create backup:`, error);
            throw error;
        }
    }

    // ============= BASELINE CAPTURE FOR INCLUDE FILES =============

    /**
     * Apply a captured edit to the baseline for include files
     * CRITICAL: Include files need to apply edits directly to content baseline
     */
    protected async applyEditToBaseline(capturedEdit: any): Promise<void> {
        console.log(`[${this.getFileType()}] Applying captured edit to include file baseline:`, capturedEdit);

        // For include files (column/task), the edit is a description edit
        // Apply the new value directly to the baseline content
        if (capturedEdit && capturedEdit.value !== undefined) {
            // Update baseline with the edited content
            this._baseline = capturedEdit.value;
            console.log(`[${this.getFileType()}] ✓ Baseline updated with captured edit (${capturedEdit.value.length} chars)`);
        } else {
            console.warn(`[${this.getFileType()}] No edit value to apply to baseline`);
        }
    }

    // ============= SIMPLIFIED CONFLICT DETECTION =============

    /**
     * Check if there are ANY unsaved changes (simplified 3-variant approach)
     * Returns true if ANY of these conditions are met:
     * - Internal state flag is true (kanban UI edits)
     * - User is in edit mode
     * - VSCode document is dirty (text editor edits)
     * - Document is open but we can't access it (safe default)
     */
    public hasAnyUnsavedChanges(): boolean {
        // Check 1: Internal state flag (from kanban UI)
        if (this._hasUnsavedChanges) return true;

        // Check 2: Edit mode (user is actively editing)
        if (this._isInEditMode) return true;

        // Check 3: VSCode document dirty status (text editor edits)
        // Need to search through all open documents since IncludeFile doesn't have FileManager
        const openDocuments = vscode.workspace.textDocuments;
        const documentIsDirty = openDocuments.some(doc =>
            doc.uri.fsPath === this._path && doc.isDirty
        );
        if (documentIsDirty) {
            return true;
        }

        // Check 4: If document is open but not dirty, we already checked above
        // No need for additional safety check here

        return false;
    }

    /**
     * Get detailed reasons for unsaved changes (for logging)
     */
    private _getUnsavedChangesReasons(): { [key: string]: boolean } {
        const openDocuments = vscode.workspace.textDocuments;
        const documentIsDirty = openDocuments.some(doc =>
            doc.uri.fsPath === this._path && doc.isDirty
        );

        return {
            hasUnsavedChanges_flag: this._hasUnsavedChanges,
            isInEditMode_flag: this._isInEditMode,
            documentIsDirty: documentIsDirty
        };
    }

    // ============= CONFLICT DETECTION =============

    /**
     * Override hasConflict to also check VSCode document dirty status
     * This ensures conflicts are detected when include file is edited in text editor
     */
    public hasConflict(): boolean {
        // Check base class flags (kanban UI changes)
        const baseHasConflict = super.hasConflict();

        // Also check if VSCode document is dirty (text editor changes)
        // Need to search through all open documents since IncludeFile doesn't have FileManager
        const openDocuments = vscode.workspace.textDocuments;
        const documentIsDirty = openDocuments.some(doc =>
            doc.uri.fsPath === this._path && doc.isDirty
        );

        // Conflict if:
        // - Base class detects conflict (kanban UI changes + external changes)
        // - OR document is dirty (text editor changes) AND has external changes
        const hasConflict = baseHasConflict || (documentIsDirty && this._hasFileSystemChanges);

        if (hasConflict) {
            console.log(`[${this.getFileType()}.hasConflict] CONFLICT DETECTED:`, {
                file: this._relativePath,
                baseConflict: baseHasConflict,
                documentIsDirty: documentIsDirty,
                hasFileSystemChanges: this._hasFileSystemChanges,
                hasUnsavedChanges: this._hasUnsavedChanges,
                isInEditMode: this._isInEditMode
            });
        }

        return hasConflict;
    }

    // ============= CONFLICT CONTEXT =============

    protected getConflictContext(): ConflictContext {
        // Check if VSCode document is dirty (text editor unsaved changes)
        const openDocuments = vscode.workspace.textDocuments;
        const documentIsDirty = openDocuments.some(doc =>
            doc.uri.fsPath === this._path && doc.isDirty
        );

        // Include has unsaved changes if either:
        // - Internal state flag is true (from kanban UI edits)
        // - OR VSCode document is dirty (from text editor edits)
        const hasIncludeUnsavedChanges = this._hasUnsavedChanges || documentIsDirty;

        return {
            type: 'external_include',
            fileType: 'include',
            filePath: this._absolutePath,
            fileName: path.basename(this._relativePath),
            hasMainUnsavedChanges: this._parentFile.hasUnsavedChanges(),
            hasIncludeUnsavedChanges: hasIncludeUnsavedChanges,
            hasExternalChanges: this._hasFileSystemChanges,
            changedIncludeFiles: [this._relativePath],
            isClosing: false,
            isInEditMode: this._isInEditMode
        };
    }

    // ============= OVERRIDES =============

    /**
     * Note: We don't override save() or reload() to call notifyParentOfChange()
     * The event system handles updates via onDidChange listeners in _handleFileRegistryChange
     * This prevents redundant parent notifications and board re-parsing
     */
}
