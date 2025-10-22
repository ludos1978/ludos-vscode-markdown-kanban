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
     * Parse presentation format into tasks
     */
    public parseToTasks(): KanbanTask[] {
        console.log(`[ColumnIncludeFile] Parsing presentation to tasks: ${this._relativePath}`);

        const slides = PresentationParser.parsePresentation(this._content);

        // Each slide becomes a task
        return slides.map((slide, index) => {
            // Extract title from first line of slide content
            const lines = slide.content.trim().split('\n');
            const title = lines[0] || `Task ${index + 1}`;

            // Rest is description
            const description = lines.slice(1).join('\n').trim();

            return {
                id: `task-${this._columnId}-${index}`,
                title: title.replace(/^#+\s*/, ''), // Remove ALL leading # and spaces
                description: description || undefined,
                includeMode: true,
                includeFiles: [this._relativePath]
            };
        });
    }

    /**
     * Generate presentation format from tasks
     */
    public generateFromTasks(tasks: KanbanTask[]): string {
        console.log(`[ColumnIncludeFile] Generating presentation from ${tasks.length} tasks: ${this._relativePath}`);

        const slides: string[] = [];

        for (const task of tasks) {
            let slideContent = `# ${task.title}\n\n`;

            if (task.description) {
                slideContent += task.description;
            }

            slides.push(slideContent);
        }

        // Join slides with slide separator
        return slides.join('\n\n---\n\n');
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

            // Check if slides have content
            for (let i = 0; i < slides.length; i++) {
                const slide = slides[i];
                if (!slide.content || slide.content.trim().length === 0) {
                    errors.push(`Slide ${i + 1} is empty`);
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
