import { PresentationParser } from '../../presentationParser';
import { KanbanColumn, KanbanTask } from '../../markdownParser';

/**
 * Format conversion utility
 *
 * Handles conversion between kanban and presentation formats.
 * For presentation generation, use PresentationGenerator instead.
 */
export class FormatConverter {

    /**
     * Convert presentation format to kanban format
     *
     * @param presentationContent - Content in presentation format
     * @param columnTitle - Title for the generated column (optional)
     * @returns Content in kanban format
     */
    static presentationToKanban(
        presentationContent: string,
        columnTitle?: string
    ): string {
        // Parse presentation slides
        const slides = PresentationParser.parsePresentation(presentationContent);

        if (!slides || slides.length === 0) {
            return presentationContent; // Return original if parsing failed
        }

        // Convert slides to tasks
        const tasks = PresentationParser.slidesToTasks(slides);

        // Create a kanban column
        const column: KanbanColumn = {
            id: 'column-1',
            title: columnTitle || 'Slides',
            tasks: tasks
        };

        // Convert to markdown
        return this.columnToMarkdown(column);
    }

    /**
     * Convert a kanban column to markdown format
     *
     * @param column - Kanban column
     * @param includeHeader - Whether to include the column header
     * @returns Markdown content
     */
    static columnToMarkdown(
        column: KanbanColumn,
        includeHeader: boolean = true
    ): string {
        let markdown = '';

        // Add column header
        if (includeHeader) {
            markdown += `## ${column.title}\n`;
        }

        // Add tasks
        column.tasks.forEach(task => {
            markdown += this.taskToMarkdown(task);
        });

        return markdown;
    }

    /**
     * Convert a kanban task to markdown format
     *
     * @param task - Kanban task
     * @param indentLevel - Indentation level (for subtasks)
     * @returns Markdown content
     */
    static taskToMarkdown(task: KanbanTask): string {
        let markdown = '';

        // Task checkbox line (always unchecked for now)
        markdown += `- [ ] ${task.title}\n`;

        // Add description if it exists
        if (task.description && task.description.trim()) {
            // Indent description lines
            const descLines = task.description.split('\n');
            descLines.forEach(line => {
                markdown += `  ${line}\n`;
            });
        }

        return markdown;
    }

    /**
     * Detect the format of markdown content
     *
     * @param content - Markdown content
     * @returns Format type
     */
    static detectFormat(content: string): 'kanban' | 'presentation' | 'unknown' {
        // Remove YAML frontmatter for detection
        const contentWithoutYaml = content.replace(/^---\n[\s\S]*?\n---\n/, '');

        // Check for kanban indicators
        const hasCheckboxes = /^[\s]*-\s\[[ x]\]/m.test(contentWithoutYaml);
        const hasColumns = /^##\s+/m.test(contentWithoutYaml);

        // Check for presentation indicators
        const hasSlideSeparators = /^---\s*$/m.test(contentWithoutYaml);

        if (hasCheckboxes && hasColumns) {
            return 'kanban';
        }

        if (hasSlideSeparators) {
            return 'presentation';
        }

        // Default to kanban if it has headings (columns)
        if (hasColumns) {
            return 'kanban';
        }

        return 'unknown';
    }

    /**
     * Convert content to a specific format
     * Auto-detects source format
     *
     * @param content - Source content
     * @param targetFormat - Target format
     * @param options - Conversion options
     * @returns Converted content
     */
    static convert(
        content: string,
        targetFormat: 'kanban' | 'presentation',
        options: ConversionOptions = {}
    ): string {
        const sourceFormat = this.detectFormat(content);

        // No conversion needed
        if (sourceFormat === targetFormat) {
            return content;
        }

        // Unknown source format - return original
        if (sourceFormat === 'unknown') {
            console.warn('[FormatConverter] Unable to detect source format');
            return content;
        }

        // Perform conversion
        if (targetFormat === 'presentation') {
            const { PresentationGenerator } = require('./PresentationGenerator');
            return PresentationGenerator.fromMarkdown(content, {
                format: 'presentation',
                preserveYaml: options.preserveYaml
            });
        } else {
            return this.presentationToKanban(content, options.columnTitle);
        }
    }

    /**
     * Extract only the content (remove YAML frontmatter)
     *
     * @param content - Markdown content with YAML
     * @returns Content without YAML
     */
    static stripYaml(content: string): string {
        const yamlMatch = content.match(/^---\n[\s\S]*?\n---\n/);
        if (yamlMatch) {
            return content.substring(yamlMatch[0].length);
        }
        return content;
    }

    /**
     * Extract YAML frontmatter
     *
     * @param content - Markdown content
     * @returns YAML frontmatter (including delimiters) or empty string
     */
    static extractYaml(content: string): string {
        const yamlMatch = content.match(/^---\n[\s\S]*?\n---\n/);
        return yamlMatch ? yamlMatch[0] : '';
    }

    /**
     * Add or replace YAML frontmatter
     *
     * @param content - Markdown content
     * @param yaml - YAML frontmatter (without delimiters)
     * @returns Content with YAML
     */
    static addYaml(content: string, yaml: string): string {
        // Remove existing YAML
        const contentWithoutYaml = this.stripYaml(content);

        // Format YAML with delimiters
        const formattedYaml = `---\n${yaml.trim()}\n---\n\n`;

        return formattedYaml + contentWithoutYaml;
    }
}

/**
 * Options for format conversion
 */
export interface ConversionOptions {
    /** Preserve YAML frontmatter during conversion */
    preserveYaml?: boolean;

    /** Column title when converting to kanban */
    columnTitle?: string;

    /** Additional metadata to preserve */
    preserveMetadata?: boolean;
}
