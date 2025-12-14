import { KanbanBoard, KanbanTask } from '../../markdownParser';
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
 * Internal slide representation
 */
interface Slide {
    content: string;
    level: 'column' | 'task';
    yaml?: string;  // YAML frontmatter (only attached to first slide)
    hasTitle: boolean;  // Whether this slide has a title (affects blank line count)
}

/**
 * Unified presentation generator
 *
 * Replaces duplicate functions across the codebase:
 * - ExportService.boardToPresentation()
 * - ExportService.convertToPresentationFormat()
 * - PresentationParser.tasksToPresentation()
 * - MarpConverter.kanbanToMarp()
 * - MarpConverter.convertMarkdownToMarp()
 * - MarpConverter.columnToSlides()
 */
export class PresentationGenerator {
    /**
     * Generate presentation from board object
     *
     * @param board - Kanban board
     * @param options - Generation options
     * @returns Marp presentation format string
     *
     * @example
     * // Without Marp directives (for copying)
     * const output = PresentationGenerator.fromBoard(board);
     *
     * @example
     * // With Marp directives (for export)
     * const output = PresentationGenerator.fromBoard(board, {
     *     includeMarpDirectives: true,
     *     marp: { theme: 'gaia' }
     * });
     */
    static fromBoard(board: KanbanBoard, options: PresentationOptions = {}): string {
        const slides = this.extractSlidesFromBoard(board, options);
        return this.formatSlides(slides, options);
    }

    /**
     * Generate presentation from kanban markdown
     *
     * @param markdown - Kanban markdown string
     * @param options - Generation options
     * @returns Marp presentation format string
     *
     * @example
     * // Without Marp directives (for copying)
     * const output = PresentationGenerator.fromMarkdown(markdown);
     *
     * @example
     * // With Marp directives merged with existing YAML (for export)
     * const output = PresentationGenerator.fromMarkdown(markdown, {
     *     includeMarpDirectives: true,
     *     tagVisibility: 'hide'
     * });
     */
    static fromMarkdown(markdown: string, options: PresentationOptions = {}): string {
        const slides = this.extractSlidesFromMarkdown(markdown, options);
        return this.formatSlides(slides, options);
    }

    /**
     * Generate presentation from task array
     *
     * @param tasks - Array of kanban tasks
     * @param options - Generation options
     * @returns Marp presentation format string (without YAML - for copying)
     *
     * @example
     * // Without Marp directives (for copying tasks)
     * const output = PresentationGenerator.fromTasks(tasks, {
     *     filterIncludes: true
     * });
     */
    static fromTasks(tasks: KanbanTask[], options: PresentationOptions = {}): string {
        const slides = this.extractSlidesFromTasks(tasks, options);
        return this.formatSlides(slides, options);
    }

    /**
     * Extract slides from board object
     */
    private static extractSlidesFromBoard(
        board: KanbanBoard,
        options: PresentationOptions
    ): Slide[] {
        const slides: Slide[] = [];

        for (const column of board.columns) {
            // Column title slide
            let columnTitle = column.displayTitle || column.title;

            if (options.stripIncludes) {
                columnTitle = columnTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
            }

            if (columnTitle) {
                slides.push({
                    content: columnTitle,
                    level: 'column',
                    hasTitle: true // Column title IS the slide title
                });
            }

            // Task slides
            for (const task of column.tasks) {
                let taskTitle = task.displayTitle || task.title;

                // Track if we have a title (before any replacements)
                const hasTitle = !!(taskTitle && taskTitle.trim());

                // replace an empty title with
                if (!hasTitle) {
                    taskTitle = '\n';
                }

                if (options.stripIncludes) {
                    taskTitle = taskTitle.replace(INCLUDE_SYNTAX.REGEX, '').trim();
                }

                let slideContent = taskTitle;
                if (task.description && task.description.trim()) {
                    slideContent += '\n\n' + task.description;
                }

                if (slideContent) {
                    slides.push({
                        content: slideContent,
                        level: 'task',
                        hasTitle
                    });
                }
            }
        }

        return slides;
    }

    /**
     * Extract slides from kanban markdown
     */
    private static extractSlidesFromMarkdown(
        markdown: string,
        options: PresentationOptions
    ): Slide[] {
        // Extract YAML if present
        const yamlMatch = markdown.match(/^---\n([\s\S]*?)\n---\n\n?/);
        let yaml = '';
        let workingContent = markdown;

        if (yamlMatch) {
            yaml = yamlMatch[0];
            workingContent = markdown.substring(yamlMatch[0].length);
        }

        const slides: Slide[] = [];
        const lines = workingContent.split('\n');
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            // Column header: ## Title (non-indented only)
            if (line.startsWith('## ') && !line.startsWith(' ')) {
                const columnTitle = line.substring(3);
                if (columnTitle) {
                    slides.push({
                        content: columnTitle,
                        level: 'column',
                        yaml: yaml, // Attach YAML to first slide
                        hasTitle: true // Column title IS the slide title
                    });
                    yaml = ''; // Only attach once
                }
                i++;
                continue;
            }

            // Task: - [ ] or - [x] (non-indented only)
            // Note: trailing space is optional (empty tasks may not have it)
            if (line.match(/^- \[[x ]\]( |$)/) && !line.startsWith(' ')) {
                const taskTitle = line.replace(/^- \[[x ]\] ?/, '');

                // Collect description (indented lines)
                const descriptionLines: string[] = [];
                i++;

                while (i < lines.length) {
                    const nextLine = lines[i];

                    // Stop at next non-indented column or task
                    // Note: trailing space is optional (empty tasks may not have it)
                    if (!nextLine.startsWith(' ') &&
                        (nextLine.startsWith('## ') || nextLine.match(/^- \[[x ]\]( |$)/))) {
                        break;
                    }

                    // Collect ALL content (indented or not) until next column/task
                    let descLine = nextLine;
                    if (nextLine.startsWith('  ')) {
                        descLine = nextLine.substring(2);
                    }
                    descriptionLines.push(descLine);
                    i++;
                }

                // Build slide content
                let slideContent = taskTitle;
                if (descriptionLines.length > 0) {
                    const description = descriptionLines.join('\n');
                    if (description) {
                        slideContent += '\n\n' + description;
                    }
                }

                slides.push({
                    content: slideContent,
                    level: 'task',
                    hasTitle: !!(taskTitle && taskTitle.trim()) // Has title if taskTitle is non-empty
                });
                continue;
            }

            i++;
        }

        return slides;
    }

    /**
     * Extract slides from task array
     */
    private static extractSlidesFromTasks(
        tasks: KanbanTask[],
        options: PresentationOptions
    ): Slide[] {
        // Filter out include tasks if requested
        let filteredTasks = tasks;
        if (options.filterIncludes) {
            filteredTasks = tasks.filter(task => !task.includeMode && !task.includeFiles);
        }

        return filteredTasks
            .map(task => {
                let content = '';
                const hasTitle = !!(task.title && task.title.trim());

                if (hasTitle) {
                    content = task.title;
                }

                if (task.description) {
                    if (content) {
                        content += '\n\n' + task.description;
                    } else {
                        content = task.description;
                    }
                }

                return content ? { content, level: 'task', hasTitle } : null;
            })
            .filter((slide): slide is Slide => slide !== null);
    }

    /**
     * Format slides into output string (shared by all input types)
     */
    private static formatSlides(slides: Slide[], options: PresentationOptions): string {
        // Apply tag filtering if specified
        const filteredSlides = this.applyTagFiltering(slides, options.tagVisibility);

        // Build YAML frontmatter if requested
        let yaml = '';
        if (options.includeMarpDirectives) {
            yaml = this.buildYamlFrontmatter(filteredSlides, options);
        }

        // Build slide content with proper formatting
        const slideContents = filteredSlides.map((slide, index) => {
            let content = slide.content;

            // Add local class directive for this specific slide if configured
            if (options.marp?.localClasses && options.marp.localClasses.length > 0) {
                const classDirective = `<!-- _class: ${options.marp.localClasses.join(' ')} -->\n\n`;
                content = classDirective + content;
            }

            // Add per-slide class overrides if specified
            if (options.marp?.perSlideClasses) {
                const slideClasses = options.marp.perSlideClasses.get(index);
                if (slideClasses && slideClasses.length > 0) {
                    const classDirective = `<!-- _class: ${slideClasses.join(' ')} -->\n\n`;
                    content = classDirective + content;
                }
            }

            return content;
        });

        // ═══════════════════════════════════════════════════════════════════════════
        // CRITICAL: Column Include Format - DO NOT MODIFY THIS LOGIC
        // ═══════════════════════════════════════════════════════════════════════════
        //
        // The column include file format is:
        //
        //   ## Title
        //
        //   content
        //   content
        //
        //   ---
        //
        //   ## Title2
        //   ...
        //
        // When WRITING:
        //   - Add '\n' after each slide content (creates blank line before ---)
        //   - Join with '\n---\n\n' (newline + separator + blank line after)
        //
        // When READING (in PresentationParser.parsePresentation):
        //   - We pop exactly TWO trailing empty lines per slide
        //
        // This ensures perfect round-trip: read → parse → generate → write = identical
        //
        // DO NOT CHANGE THIS WITHOUT UPDATING PresentationParser.parsePresentation!
        // ═══════════════════════════════════════════════════════════════════════════

        const formattedSlides = filteredSlides.map((slide, i) => {
            const slideContent = slideContents[i];
            // Add blank line after content (before ---) - paired with pop in parser
            return slideContent + '\n';
        });

        // Join: newline before ---, then ---, then blank line after
        const content = formattedSlides.join('\n---\n\n');

        // Combine YAML and content
        if (yaml) {
            return yaml + content + '\n';
        }

        return content + '\n';
    }

    /**
     * Apply tag filtering to slides
     */
    private static applyTagFiltering(
        slides: Slide[],
        tagVisibility?: TagVisibility
    ): Slide[] {
        if (!tagVisibility || tagVisibility === 'all') {
            return slides;
        }

        return slides.map(slide => ({
            ...slide,
            content: TagUtils.processMarkdownContent(slide.content, tagVisibility)
        }));
    }

    /**
     * Build YAML frontmatter by merging existing YAML, Marp directives, and custom YAML
     */
    private static buildYamlFrontmatter(
        slides: Slide[],
        options: PresentationOptions
    ): string {
        // Start with existing YAML from source if present
        const allYaml: Record<string, any> = {};

        if (slides.length > 0 && slides[0].yaml) {
            const existingYaml = this.parseYaml(slides[0].yaml);
            Object.assign(allYaml, existingYaml);
        }

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
                // For complex values, use JSON stringification
                result += `${key}: ${JSON.stringify(value)}\n`;
            }
        }
        result += '---\n\n';

        return result;
    }

    /**
     * Parse YAML frontmatter (simple parser)
     */
    private static parseYaml(yaml: string): Record<string, any> {
        const result: Record<string, any> = {};
        const content = yaml.replace(/^---\n/, '').replace(/\n---\n.*$/, '');
        const lines = content.split('\n');

        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const [, key, value] = match;
                result[key] = value.replace(/["']/g, '');
            }
        }

        return result;
    }
}
