import { IncludeFile } from './IncludeFile';
import { MainKanbanFile } from './MainKanbanFile';
import { ConflictResolver } from '../conflictResolver';
import { BackupManager } from '../backupManager';

/**
 * Represents a task include file (taskinclude syntax).
 *
 * Task includes contain markdown content that becomes the task description.
 *
 * Responsibilities:
 * - Store markdown content for a single task
 * - Track which task this include belongs to
 * - Handle task-specific validation
 */
export class TaskIncludeFile extends IncludeFile {
    // ============= TASK ASSOCIATION =============
    private _taskId?: string;                       // ID of the task this belongs to
    private _taskTitle?: string;                    // Title of the task
    private _columnId?: string;                     // ID of the column containing the task

    constructor(
        relativePath: string,
        parentFile: MainKanbanFile,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        isInline: boolean = false
    ) {
        super(relativePath, parentFile, conflictResolver, backupManager, isInline);
    }

    // ============= FILE TYPE =============

    public getFileType(): 'include-task' {
        return 'include-task';
    }

    // ============= TASK ASSOCIATION =============

    /**
     * Set the task ID this include belongs to
     */
    public setTaskId(taskId: string): void {
        this._taskId = taskId;
    }

    /**
     * Get the task ID
     */
    public getTaskId(): string | undefined {
        return this._taskId;
    }

    /**
     * Set the task title
     */
    public setTaskTitle(title: string): void {
        this._taskTitle = title;
    }

    /**
     * Get the task title
     */
    public getTaskTitle(): string | undefined {
        return this._taskTitle;
    }

    /**
     * Set the column ID containing this task
     */
    public setColumnId(columnId: string): void {
        this._columnId = columnId;
    }

    /**
     * Get the column ID
     */
    public getColumnId(): string | undefined {
        return this._columnId;
    }

    // ============= CONTENT OPERATIONS =============

    /**
     * Get task description content
     */
    public getTaskDescription(): string {
        return this._content;
    }

    /**
     * Set task description content
     */
    public setTaskDescription(description: string): void {
        this.setContent(description, false);
    }

    // ============= VALIDATION =============

    /**
     * Validate task include content
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
        const errors: string[] = [];

        // Task includes should have some content
        if (!content || content.trim().length === 0) {
            errors.push('Task include cannot be empty');
        }

        // Optional: Check for valid markdown
        // (Could add more sophisticated markdown validation here)

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined
        };
    }
}
