import { KanbanBoard, KanbanColumn, KanbanTask } from '../../board/KanbanTypes';
import { TagUtils, TagVisibility } from '../../utils/tagUtils';
import { INCLUDE_SYNTAX } from '../../constants/IncludeConstants';

/**
 * Options for presentation generation
 */
export interface PresentationOptions {
    /** Whether to include Marp directives in YAML frontmatter (default: false) */
    includeMarpDirectives?: boolean;
    /** Remove !!!include()!!! syntax from titles */
    stripIncludes?: boolean;
    /** Filter out tasks with includeMode or includeFiles */
    filterIncludes?: boolean;
    /** Tag visibility settings */
    tagVisibility?: TagVisibility;
    /** Marp-specific options (theme, directives) */
    marp?: MarpOptions;
    /** Custom YAML to merge (will be merged with Marp directives if both present) */
    customYaml?: Record<string, any>;
}

/**
 * Marp-specific options
 */
export interface MarpOptions {
    /** Marp theme (default: 'default') */
    theme?: string;
    /** Additional Marp directives */
    directives?: Record<string, string | boolean | number>;
    /** Global CSS classes to apply to all slides (e.g., ['font24', 'center']) */
    globalClasses?: string[];
    /** Local CSS classes to apply to specific slides (e.g., ['invert', 'highlight']) */
    localClasses?: string[];
    /** Per-slide class overrides: map of slide index to class array */
    perSlideClasses?: Map<number, string[]>;
}

/**
 * Presentation Generator
 *
 * Converts Kanban data structures to presentation (Marp) format.
 * Works directly with KanbanTask, KanbanColumn, and KanbanBoard.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CRITICAL: Presentation Format
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Format: slide\n\n---\n\nslide\n\n---\n\nslide\n
 *
 * Each slide is: title\n\ndescription
 * (title and description can be empty, but \n\n separator is always present)
 *
 * WRITING: Join slides with \n\n---\n\n, add trailing \n
 * READING: Strip trailing \n, split on \n\n---\n\n
 *
 * DO NOT CHANGE THIS WITHOUT UPDATING PresentationParser!
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class PresentationGenerator {
    /**
     * Generate presentation from tasks
     *
     * @param tasks - Array of kanban tasks
     * @param options - Generation options
     * @returns Presentation markdown string
     */
    static fromTasks(tasks: KanbanTask[], options: PresentationOptions = {}): string {
        // Filter include tasks if requested
        let filteredTasks = tasks;
        if (options.filterIncludes) {
            filteredTasks = tasks.filter(task => !task.includeMode && !task.includeFiles);
        }

        // Convert tasks to slide content strings
        const slideContents = filteredTasks.map(task => this.taskToSlideContent(task, options));

        return this.formatOutput(slideContents, options);
    }

    /**
     * Generate presentation from a single column
     *
     * @param column - Kanban column
     * @param options - Generation options
     * @returns Presentation markdown string (column title slide + task slides)
     */
    static fromColumn(column: KanbanColumn, options: PresentationOptions = {}): string {
        const slideContents: string[] = [];

        // Column title slide (title only, no description)
        let columnTitle = column.displayTitle ?? column.title;
        if (options.stripIncludes) {
            columnTitle = columnTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
        }
        slideContents.push(columnTitle + '\n\n');

        // Task slides
        let tasks = column.tasks;
        if (options.filterIncludes) {
            tasks = tasks.filter(task => !task.includeMode && !task.includeFiles);
        }
        for (const task of tasks) {
            slideContents.push(this.taskToSlideContent(task, options));
        }

        return this.formatOutput(slideContents, options);
    }

    /**
     * Generate presentation from multiple columns
     *
     * @param columns - Array of kanban columns
     * @param options - Generation options
     * @returns Presentation markdown string
     */
    static fromColumns(columns: KanbanColumn[], options: PresentationOptions = {}): string {
        const slideContents: string[] = [];

        for (const column of columns) {
            // Column title slide
            let columnTitle = column.displayTitle ?? column.title;
            if (options.stripIncludes) {
                columnTitle = columnTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
            }
            slideContents.push(columnTitle + '\n\n');

            // Task slides
            let tasks = column.tasks;
            if (options.filterIncludes) {
                tasks = tasks.filter(task => !task.includeMode && !task.includeFiles);
            }
            for (const task of tasks) {
                slideContents.push(this.taskToSlideContent(task, options));
            }
        }

        return this.formatOutput(slideContents, options);
    }

    /**
     * Generate presentation from entire board
     *
     * @param board - Kanban board
     * @param options - Generation options
     * @returns Presentation markdown string
     */
    static fromBoard(board: KanbanBoard, options: PresentationOptions = {}): string {
        return this.fromColumns(board.columns, options);
    }

    /**
     * Convert a single task to slide content string
     */
    private static taskToSlideContent(task: KanbanTask, options: PresentationOptions): string {
        // Use displayTitle if available, fall back to title
        let title = task.displayTitle ?? task.title ?? '';
        const description = task.description ?? '';

        if (options.stripIncludes) {
            title = title.replace(INCLUDE_SYNTAX.REGEX, '').trim();
        }

        // Slide format: title\n\ndescription
        // ALWAYS include \n\n even if description is empty (preserves format)
        return title + '\n\n' + description;
    }

    /**
     * Format slide contents into final output string
     */
    private static formatOutput(slideContents: string[], options: PresentationOptions): string {
        // Apply tag filtering if specified
        let filteredContents = slideContents;
        if (options.tagVisibility && options.tagVisibility !== 'all') {
            filteredContents = slideContents.map(content =>
                TagUtils.processMarkdownContent(content, options.tagVisibility!)
            );
        }

        // Apply Marp class directives if specified
        const finalContents = filteredContents.map((content, index) => {
            let result = content;

            // Add local class directive for this specific slide if configured
            if (options.marp?.localClasses && options.marp.localClasses.length > 0) {
                const classDirective = `<!-- _class: ${options.marp.localClasses.join(' ')} -->\n\n`;
                result = classDirective + result;
            }

            // Add per-slide class overrides if specified
            if (options.marp?.perSlideClasses) {
                const slideClasses = options.marp.perSlideClasses.get(index);
                if (slideClasses && slideClasses.length > 0) {
                    const classDirective = `<!-- _class: ${slideClasses.join(' ')} -->\n\n`;
                    result = classDirective + result;
                }
            }

            return result;
        });

        // Join with \n\n---\n\n - content is NOT modified
        const content = finalContents.join('\n\n---\n\n');

        // Build YAML frontmatter if requested
        let yaml = '';
        if (options.includeMarpDirectives) {
            yaml = this.buildYamlFrontmatter(options);
        }

        // NO newline manipulation - content is output exactly as-is
        if (yaml) {
            return yaml + content;
        }

        return content;
    }

    /**
     * Build YAML frontmatter for Marp
     */
    private static buildYamlFrontmatter(options: PresentationOptions): string {
        const allYaml: Record<string, any> = {};

        // Add Marp directives
        allYaml.marp = true;
        allYaml.theme = options.marp?.theme || 'default';

        // Add global class directive if specified
        if (options.marp?.globalClasses && options.marp.globalClasses.length > 0) {
            allYaml.class = options.marp.globalClasses.join(' ');
        }

        // Merge additional Marp directives if provided
        if (options.marp?.directives) {
            Object.assign(allYaml, options.marp.directives);
        }

        // Merge custom YAML if provided
        if (options.customYaml) {
            Object.assign(allYaml, options.customYaml);
        }

        // Format YAML
        let result = '---\n';
        for (const [key, value] of Object.entries(allYaml)) {
            if (typeof value === 'string') {
                result += `${key}: "${value}"\n`;
            } else if (typeof value === 'boolean' || typeof value === 'number') {
                result += `${key}: ${value}\n`;
            } else {
                result += `${key}: ${JSON.stringify(value)}\n`;
            }
        }
        result += '---\n\n';

        return result;
    }
}
