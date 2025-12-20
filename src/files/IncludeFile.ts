import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
import { ConflictResolver, ConflictContext } from '../services/ConflictResolver';
import { BackupManager } from '../services/BackupManager';
import { IMainKanbanFile, IMarkdownFileRegistry, CapturedEdit } from './FileInterfaces';
import { UnifiedChangeHandler } from '../core/UnifiedChangeHandler';
import { KanbanTask } from '../board/KanbanTypes';
import { PresentationParser } from '../services/export/PresentationParser';
import { PresentationGenerator } from '../services/export/PresentationGenerator';
import { safeDecodeURIComponent } from '../utils/stringUtils';

/**
 * Include file types supported by the plugin system
 */
export type IncludeFileType = 'include-regular' | 'include-column' | 'include-task';

/**
 * Unified class for all include files (column, task, regular includes).
 *
 * This class consolidates all include file functionality into a single,
 * configurable class. The file type is specified at construction time
 * and determines behavior for parsing, generation, and validation.
 *
 * Replaces: ColumnIncludeFile, TaskIncludeFile, RegularIncludeFile
 *
 * Responsibilities:
 * - Manage include file paths (relative to parent)
 * - Resolve absolute paths
 * - Handle parent-child relationship
 * - Coordinate changes with parent file
 * - Handle include-specific conflicts
 * - Parse/generate content based on file type
 */
export class IncludeFile extends MarkdownFile {
    // ============= FILE TYPE =============
    private _fileType: IncludeFileType;

    // ============= PARENT RELATIONSHIP =============
    protected _parentFile: IMainKanbanFile;          // Reference to parent kanban file
    protected _absolutePath: string;                 // Cached absolute path


    constructor(
        relativePath: string,
        parentFile: IMainKanbanFile,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        fileType: IncludeFileType
    ) {
        // Decode URL-encoded characters (e.g., %20 -> space)
        const decodedRelativePath = safeDecodeURIComponent(relativePath);

        const absolutePath = IncludeFile._resolveAbsolutePath(decodedRelativePath, parentFile.getPath());

        super(absolutePath, decodedRelativePath, conflictResolver, backupManager);

        this._fileType = fileType;
        this._parentFile = parentFile;
        this._absolutePath = absolutePath;
    }

    // ============= FILE TYPE =============

    public getFileType(): IncludeFileType {
        return this._fileType;
    }

    public getFileRegistry(): IMarkdownFileRegistry | undefined {
        return this._parentFile.getFileRegistry();
    }

    // ============= PATH RESOLUTION =============

    /**
     * Get the parent file
     */
    public getParentFile(): IMainKanbanFile {
        return this._parentFile;
    }

    /**
     * Resolve relative path to absolute path
     * Note: URL decoding is handled in constructor before calling this method
     */
    private static _resolveAbsolutePath(relativePath: string, parentPath: string): string {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }

        const parentDir = path.dirname(parentPath);
        return path.resolve(parentDir, relativePath);
    }

    // ============= CONTENT OPERATIONS (for include-task) =============

    /**
     * Set task description content (for include-task)
     */
    public setTaskDescription(description: string): void {
        this.setContent(description, false);
    }

    // ============= FILE I/O =============

    /**
     * Read content from disk
     * CRITICAL: Normalizes CRLF to LF to ensure consistent line endings
     */
    public async readFromDisk(): Promise<string | null> {

        try {
            const content = await fs.promises.readFile(this._absolutePath, 'utf-8');
            // CRITICAL: Normalize CRLF to LF (Windows line endings to Unix)
            // This ensures consistent line endings for all parsing operations
            return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
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

        try {
            // Ensure directory exists
            const dir = path.dirname(this._absolutePath);
            await fs.promises.mkdir(dir, { recursive: true });

            // Write file
            await fs.promises.writeFile(this._absolutePath, content, 'utf-8');

            this._exists = true;
            this._lastModified = new Date();
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to write file:`, error);
            throw error;
        }
    }

    // ============= PARSING (for include-column) =============

    /**
     * Parse presentation format into tasks, preserving IDs for existing tasks
     * CRITICAL: Match by POSITION only, never by title/content
     * @param existingTasks Optional array of existing tasks to preserve IDs from
     * @param columnId Optional columnId to use for task ID generation (supports file reuse across columns)
     * @param mainFilePath Optional path to main kanban file (for dynamic image path resolution)
     */
    public parseToTasks(existingTasks?: KanbanTask[], columnId?: string, mainFilePath?: string): KanbanTask[] {
        // Note: A file can be used as different include types in different contexts.
        // Don't restrict parsing based on registered file type - just parse the content.

        // Use PresentationParser to convert slides to tasks
        const slides = PresentationParser.parsePresentation(this._content);
        const tasks = PresentationParser.slidesToTasks(slides, this._path, mainFilePath);

        // Use provided columnId for task ID generation
        const effectiveColumnId = columnId;

        // CRITICAL: Match by POSITION, not title - tasks identified by position
        return tasks.map((task, index) => {
            // Get existing task at SAME POSITION to preserve ID
            const existingTask = existingTasks?.[index];

            return {
                ...task,
                id: existingTask?.id || `task-${effectiveColumnId}-${index}`,
                includeMode: false, // Tasks from column includes are NOT individual includes
                includeFiles: undefined, // Column has the includeFiles, not individual tasks
                includeContext: task.includeContext // Preserve includeContext for dynamic image resolution
            };
        });
    }

    /**
     * Generate presentation format from tasks (for include-column)
     * Note: A file can be used in multiple contexts - don't restrict based on registered type
     */
    public generateFromTasks(tasks: KanbanTask[]): string {
        // Use unified presentation generator (no YAML for copying)
        return PresentationGenerator.fromTasks(tasks, {
            filterIncludes: true
            // Note: includeMarpDirectives defaults to false (no YAML when copying)
        });
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

        // Trigger parent to reload/reparse
        // The parent will re-read this include file and update the board
        if (this._parentFile) {
            // Check if parent needs to be reloaded (side effect: marks parent as having external changes)
            await this._parentFile.checkForExternalChanges();
        }
    }

    // ============= BACKUP =============

    /**
     * Create backup of current content for include files
     * Since include files don't have TextDocuments, we write directly to a backup file
     */
    public async createBackup(label: string = 'manual'): Promise<string | null> {

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

            return backupPath;
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to create backup:`, error);
            return null;
        }
    }

    // ============= BASELINE CAPTURE FOR INCLUDE FILES =============

    /**
     * Apply a captured edit to the baseline for include files
     * CRITICAL: Include files need to apply edits directly to content baseline
     */
    public async applyEditToBaseline(capturedEdit: CapturedEdit): Promise<void> {

        // For include files (column/task), the edit is a description edit
        // Apply the new value directly to the baseline content
        if (capturedEdit && capturedEdit.value !== undefined) {
            // Update baseline with the edited content
            this._baseline = capturedEdit.value;
        } else {
            console.warn(`[${this.getFileType()}] No edit value to apply to baseline`);
        }
    }

    // ============= SIMPLIFIED CONFLICT DETECTION =============

    // hasAnyUnsavedChanges() and hasConflict() are now implemented in base class MarkdownFile
    // The base class handles VS Code document dirty checks via isDocumentDirtyInVSCode()

    // ============= CONFLICT CONTEXT =============

    protected getConflictContext(): ConflictContext {
        // Check if VSCode document is dirty (text editor unsaved changes)
        const openDocuments = vscode.workspace.textDocuments;
        const documentIsDirty = openDocuments.some(doc =>
            doc.uri.fsPath === this._path && doc.isDirty
        );

        // Include has unsaved changes if either:
        // - Internal state flag is true (from kanban UI edits) - computed from content comparison
        // - OR VSCode document is dirty (from text editor edits)
        const hasIncludeUnsavedChanges = this.hasUnsavedChanges() || documentIsDirty;

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

    // ============= VALIDATION =============

    /**
     * Validate file content based on file type
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
        switch (this._fileType) {
            case 'include-column':
                return this._validateColumnContent(content);
            case 'include-task':
                return this._validateTaskContent(content);
            case 'include-regular':
                // Regular includes accept any markdown content
                return { valid: true };
            default:
                return { valid: true };
        }
    }

    /**
     * Validate presentation format content (for include-column)
     */
    private _validateColumnContent(content: string): { valid: boolean; errors?: string[] } {
        const errors: string[] = [];

        // Parse as presentation
        try {
            const slides = PresentationParser.parsePresentation(content);

            if (slides.length === 0) {
                errors.push('Column include must have at least one slide (task)');
            }

            // Check if slides have at least a title or content
            // A slide with just a title is valid (represents a task with no description)
            for (let i = 0; i < slides.length; i++) {
                const slide = slides[i];
                const hasTitle = slide.title && slide.title.trim().length > 0;
                const hasContent = slide.content && slide.content.trim().length > 0;

                if (!hasTitle && !hasContent) {
                    errors.push(`Slide ${i + 1} is empty (no title or content)`);
                }
            }
        } catch (error) {
            errors.push(`Failed to parse presentation: ${error}`);
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * Validate task include content (for include-task)
     * Matches original TaskIncludeFile behavior - rejects empty content
     */
    private _validateTaskContent(content: string): { valid: boolean; errors?: string[] } {
        const errors: string[] = [];

        // Task includes should have some content (original behavior)
        if (!content || content.trim().length === 0) {
            errors.push('Task include cannot be empty');
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    // ============= OVERRIDES =============

    /**
     * Note: We don't override save() or reload() to call notifyParentOfChange()
     * The event system handles updates via onDidChange listeners in _handleFileRegistryChange
     * This prevents redundant parent notifications and board re-parsing
     */
}
