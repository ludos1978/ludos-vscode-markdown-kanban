import { IncludeFile } from './IncludeFile';
import { MainKanbanFile } from './MainKanbanFile';
import { ConflictResolver } from '../conflictResolver';
import { BackupManager } from '../backupManager';
import { KanbanTask } from '../markdownParser';
import { PresentationParser } from '../presentationParser';

/**
 * Represents a column include file (columninclude syntax).
 *
 * Column includes use presentation format where each slide becomes a task.
 *
 * Responsibilities:
 * - Parse presentation format into tasks
 * - Generate presentation format from tasks
 * - Track which column this include belongs to
 * - Handle column-specific validation
 */
export class ColumnIncludeFile extends IncludeFile {
    // ============= COLUMN ASSOCIATION =============
    private _columnId?: string;                     // ID of the column this belongs to
    private _columnTitle?: string;                  // Title of the column

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

    public getFileType(): 'include-column' {
        return 'include-column';
    }

    // ============= COLUMN ASSOCIATION =============

    /**
     * Set the column ID this include belongs to
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

    /**
     * Set the column title
     */
    public setColumnTitle(title: string): void {
        this._columnTitle = title;
    }

    /**
     * Get the column title
     */
    public getColumnTitle(): string | undefined {
        return this._columnTitle;
    }

    // ============= PARSING =============

    /**
     * Find existing task by title to preserve ID during re-parse
     */
    private findExistingTask(existingTasks: KanbanTask[] | undefined, title: string): KanbanTask | undefined {
        if (!existingTasks) {
            return undefined;
        }
        return existingTasks.find(task => task.title === title);
    }

    /**
     * Parse presentation format into tasks, preserving IDs for existing tasks
     * @param existingTasks Optional array of existing tasks to preserve IDs from
     */
    public parseToTasks(existingTasks?: KanbanTask[]): KanbanTask[] {
        console.log(`[ColumnIncludeFile] Parsing presentation to tasks: ${this._relativePath}`);

        // Use PresentationParser to convert slides to tasks
        const slides = PresentationParser.parsePresentation(this._content);
        const tasks = PresentationParser.slidesToTasks(slides);

        // Update task IDs, preserving existing IDs when task titles match
        return tasks.map((task, index) => {
            // Try to find existing task with same title to preserve ID
            const existingTask = this.findExistingTask(existingTasks, task.title);

            return {
                ...task,
                id: existingTask?.id || `task-${this._columnId}-${index}`,
                includeMode: false, // Tasks from columninclude are NOT individual includes
                includeFiles: undefined // Column has the includeFiles, not individual tasks
            };
        });
    }

    /**
     * Generate presentation format from tasks
     */
    public generateFromTasks(tasks: KanbanTask[]): string {
        console.log(`[ColumnIncludeFile] Generating presentation from ${tasks.length} tasks: ${this._relativePath}`);

        // Use PresentationParser to convert tasks back to presentation format
        return PresentationParser.tasksToPresentation(tasks);
    }

    /**
     * Update tasks (regenerate content from tasks and mark as unsaved)
     */
    public updateTasks(tasks: KanbanTask[]): void {
        const newContent = this.generateFromTasks(tasks);
        this.setContent(newContent, false);
    }

    // ============= VALIDATION =============

    /**
     * Validate presentation format content
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
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
}
