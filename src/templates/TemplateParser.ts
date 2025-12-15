import * as path from 'path';
import { INCLUDE_SYNTAX } from '../constants/IncludeConstants';

/**
 * Variable definition from template YAML frontmatter
 */
export interface TemplateVariable {
    name: string;
    label: string;
    type: 'string' | 'number';
    format?: string;        // Python-style format specifier, e.g., "02d"
    default?: string | number;
    required?: boolean;
}

/**
 * Parsed template column
 */
export interface TemplateColumn {
    title: string;
    tasks: TemplateTask[];
    tags?: string[];        // Tags extracted from title (e.g., #stack)
}

/**
 * Parsed template task
 */
export interface TemplateTask {
    title: string;
    description?: string;
    completed?: boolean;
    includeFiles?: string[];  // Include file references
}

/**
 * Full template definition parsed from template.md
 */
export interface TemplateDefinition {
    name: string;
    description?: string;
    icon?: string;
    variables: TemplateVariable[];
    columns: TemplateColumn[];
    path: string;           // Absolute path to template folder
    files: string[];        // List of files/folders to copy (relative to template folder)
}

/**
 * Parser for template.md files
 * Parses YAML frontmatter and kanban-format markdown body
 */
export class TemplateParser {
    /**
     * Parse a template.md file content
     */
    public static parse(content: string, templateFolder: string): TemplateDefinition {
        const { frontmatter, body } = this.splitFrontmatter(content);
        const metadata = this.parseFrontmatter(frontmatter);
        const columns = this.parseBody(body);

        // Extract files to copy (all files in template folder except template.md)
        const files = this.extractFilesToCopy(templateFolder);

        return {
            name: metadata.name || path.basename(templateFolder),
            description: metadata.description,
            icon: metadata.icon,
            variables: metadata.variables || [],
            columns,
            path: templateFolder,
            files
        };
    }

    /**
     * Split content into YAML frontmatter and body
     */
    private static splitFrontmatter(content: string): { frontmatter: string; body: string } {
        const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (match) {
            return {
                frontmatter: match[1],
                body: match[2]
            };
        }
        return {
            frontmatter: '',
            body: content
        };
    }

    /**
     * Parse YAML frontmatter (simple parser, no external dependency)
     */
    private static parseFrontmatter(yaml: string): {
        name?: string;
        description?: string;
        icon?: string;
        variables?: TemplateVariable[];
    } {
        if (!yaml.trim()) {
            return {};
        }

        const result: {
            name?: string;
            description?: string;
            icon?: string;
            variables?: TemplateVariable[];
        } = {};

        const lines = yaml.split('\n');
        let inVariables = false;
        let currentVariable: Partial<TemplateVariable> | null = null;
        let indent = 0;

        for (const line of lines) {
            // Skip empty lines
            if (!line.trim()) {
                continue;
            }

            // Check for top-level keys
            const topMatch = line.match(/^(\w+):\s*(.*)$/);
            if (topMatch) {
                const key = topMatch[1];
                const value = topMatch[2].trim();

                if (key === 'name') {
                    result.name = this.unquote(value);
                    inVariables = false;
                } else if (key === 'description') {
                    result.description = this.unquote(value);
                    inVariables = false;
                } else if (key === 'icon') {
                    result.icon = this.unquote(value);
                    inVariables = false;
                } else if (key === 'variables') {
                    inVariables = true;
                    result.variables = [];
                }
                continue;
            }

            // Parse variable list items
            if (inVariables) {
                // New variable item (starts with -)
                const itemMatch = line.match(/^\s*-\s*(\w+):\s*(.*)$/);
                if (itemMatch) {
                    // Save previous variable
                    if (currentVariable && currentVariable.name) {
                        result.variables!.push(this.normalizeVariable(currentVariable));
                    }
                    // Start new variable
                    currentVariable = {} as Partial<TemplateVariable>;
                    const key = itemMatch[1] as keyof TemplateVariable;
                    const value = this.unquote(itemMatch[2].trim());
                    (currentVariable as Record<string, unknown>)[key] = value;
                    indent = line.search(/\S/);
                    continue;
                }

                // Variable property continuation
                const propMatch = line.match(/^\s+(\w+):\s*(.*)$/);
                if (propMatch && currentVariable) {
                    const propIndent = line.search(/\S/);
                    if (propIndent > indent) {
                        const key = propMatch[1];
                        let value: string | number | boolean = this.unquote(propMatch[2].trim());

                        // Type coercion
                        if (key === 'required') {
                            value = value === 'true';
                        } else if (key === 'default' && currentVariable.type === 'number') {
                            value = parseInt(value as string, 10);
                        }

                        (currentVariable as Record<string, unknown>)[key] = value;
                    }
                }
            }
        }

        // Save last variable
        if (currentVariable && currentVariable.name && result.variables) {
            result.variables.push(this.normalizeVariable(currentVariable));
        }

        return result;
    }

    /**
     * Remove quotes from a YAML string value
     */
    private static unquote(value: string): string {
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            return value.slice(1, -1);
        }
        return value;
    }

    /**
     * Normalize a partial variable to full TemplateVariable
     */
    private static normalizeVariable(partial: Partial<TemplateVariable>): TemplateVariable {
        return {
            name: partial.name || '',
            label: partial.label || partial.name || '',
            type: (partial.type as 'string' | 'number') || 'string',
            format: partial.format,
            default: partial.default,
            required: partial.required ?? true
        };
    }

    /**
     * Parse the markdown body as kanban columns and tasks
     */
    private static parseBody(body: string): TemplateColumn[] {
        const columns: TemplateColumn[] = [];
        let currentColumn: TemplateColumn | null = null;
        let currentTask: TemplateTask | null = null;
        let descriptionLines: string[] = [];

        const lines = body.split('\n');

        for (const line of lines) {
            // Column header (## Title)
            const columnMatch = line.match(/^##\s+(.+)$/);
            if (columnMatch) {
                // Save previous task description
                if (currentTask && descriptionLines.length > 0) {
                    currentTask.description = descriptionLines.join('\n').trim();
                    descriptionLines = [];
                }
                currentTask = null;

                // Save previous column
                if (currentColumn) {
                    columns.push(currentColumn);
                }

                const fullTitle = columnMatch[1].trim();
                const tags = this.extractTags(fullTitle);

                currentColumn = {
                    title: fullTitle,
                    tasks: [],
                    tags
                };
                continue;
            }

            // Task (- [ ] or - [x])
            const taskMatch = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
            if (taskMatch && currentColumn) {
                // Save previous task description
                if (currentTask && descriptionLines.length > 0) {
                    currentTask.description = descriptionLines.join('\n').trim();
                    descriptionLines = [];
                }

                const completed = taskMatch[1] === 'x';
                const title = taskMatch[2].trim();
                const includeFiles = this.extractIncludes(title);

                currentTask = {
                    title,
                    completed,
                    includeFiles: includeFiles.length > 0 ? includeFiles : undefined
                };
                currentColumn.tasks.push(currentTask);
                continue;
            }

            // Task description (indented content after task)
            if (currentTask && line.match(/^\s{2,}/)) {
                descriptionLines.push(line.trim());
                continue;
            }

            // Non-indented content after a task ends the description
            if (currentTask && line.trim() && !line.match(/^\s/)) {
                if (descriptionLines.length > 0) {
                    currentTask.description = descriptionLines.join('\n').trim();
                    descriptionLines = [];
                }
            }
        }

        // Save final task description
        if (currentTask && descriptionLines.length > 0) {
            currentTask.description = descriptionLines.join('\n').trim();
        }

        // Save final column
        if (currentColumn) {
            columns.push(currentColumn);
        }

        return columns;
    }

    /**
     * Extract hashtags from title
     */
    private static extractTags(title: string): string[] {
        const tags: string[] = [];
        const matches = title.matchAll(/#(\w+)/g);
        for (const match of matches) {
            tags.push(match[1]);
        }
        return tags;
    }

    /**
     * Extract !!!include()!!! references from text
     */
    private static extractIncludes(text: string): string[] {
        const includes: string[] = [];
        const matches = text.matchAll(INCLUDE_SYNTAX.REGEX);
        for (const match of matches) {
            includes.push(match[1]);
        }
        return includes;
    }

    /**
     * Get list of files/folders to copy from template folder
     * Excludes template.md itself
     */
    private static extractFilesToCopy(templateFolder: string): string[] {
        // This will be populated during actual template application
        // For now, return empty - the FileCopyService will scan the folder
        return [];
    }
}
