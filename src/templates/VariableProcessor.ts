import { TemplateVariable } from './TemplateParser';

/**
 * Processor for template variable substitution
 * Handles:
 * - Basic substitution: {variable}
 * - Formatted substitution: {variable:format} (Python-style format specifiers)
 * - Conditionals: {#if variable}...{/if} and {#if variable}...{#else}...{/if}
 */
export class VariableProcessor {
    /**
     * Substitute all variables in content
     * @param content The content with variable placeholders
     * @param values The variable values to substitute
     * @param variables Optional variable definitions for format specs
     */
    public static substitute(
        content: string,
        values: Record<string, string | number>,
        variables?: TemplateVariable[]
    ): string {
        let result = content;

        // First process conditionals
        result = this.processConditionals(result, values);

        // Then substitute variables
        result = this.substituteVariables(result, values, variables);

        return result;
    }

    /**
     * Substitute variables in a filename
     * Same as substitute but ensures result is valid for filenames
     */
    public static substituteFilename(
        filename: string,
        values: Record<string, string | number>,
        variables?: TemplateVariable[]
    ): string {
        let result = this.substitute(filename, values, variables);

        // Sanitize for filesystem (remove/replace invalid characters)
        result = result.replace(/[<>:"/\\|?*]/g, '_');

        return result;
    }

    /**
     * Substitute {variable} and {variable:format} patterns
     */
    private static substituteVariables(
        content: string,
        values: Record<string, string | number>,
        variables?: TemplateVariable[]
    ): string {
        // Match {varname} or {varname:format}
        return content.replace(/\{(\w+)(?::([^}]+))?\}/g, (match, varName, format) => {
            const value = values[varName];
            if (value === undefined) {
                // Leave unchanged if variable not provided
                return match;
            }

            // Get format from variable definition if not inline
            if (!format && variables) {
                const varDef = variables.find(v => v.name === varName);
                if (varDef?.format) {
                    format = varDef.format;
                }
            }

            if (format) {
                return this.formatValue(value, format);
            }

            return String(value);
        });
    }

    /**
     * Format a value using Python-style format specifiers
     * Supports: d, s, 02d, 03d, etc.
     */
    private static formatValue(value: string | number, format: string): string {
        // Parse format specifier
        // Format: [[fill]align][sign][#][0][width][.precision][type]
        // Common patterns: 02d, 03d, s, .2f

        // Integer formats with zero padding
        const intMatch = format.match(/^0?(\d+)d$/);
        if (intMatch) {
            const width = parseInt(intMatch[1], 10);
            const num = typeof value === 'number' ? value : parseInt(String(value), 10);
            return String(num).padStart(width, '0');
        }

        // Simple integer
        if (format === 'd') {
            const num = typeof value === 'number' ? value : parseInt(String(value), 10);
            return String(num);
        }

        // String format
        if (format === 's') {
            return String(value);
        }

        // Float formats
        const floatMatch = format.match(/^\.(\d+)f$/);
        if (floatMatch) {
            const precision = parseInt(floatMatch[1], 10);
            const num = typeof value === 'number' ? value : parseFloat(String(value));
            return num.toFixed(precision);
        }

        // Uppercase
        if (format === 'upper' || format === 'U') {
            return String(value).toUpperCase();
        }

        // Lowercase
        if (format === 'lower' || format === 'L') {
            return String(value).toLowerCase();
        }

        // Title case
        if (format === 'title' || format === 'T') {
            return String(value).replace(/\b\w/g, c => c.toUpperCase());
        }

        // Slug (lowercase with hyphens)
        if (format === 'slug') {
            return String(value)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
        }

        // Unknown format, return as-is
        return String(value);
    }

    /**
     * Process conditional blocks
     * Supports:
     * - {#if variable}content{/if}
     * - {#if variable}content{#else}other{/if}
     * - Nested conditionals
     */
    public static processConditionals(
        content: string,
        values: Record<string, string | number>
    ): string {
        let result = content;
        let changed = true;
        let iterations = 0;
        const maxIterations = 100; // Prevent infinite loops

        // Process from innermost to outermost
        while (changed && iterations < maxIterations) {
            changed = false;
            iterations++;

            // Match innermost {#if ...}...{/if} (no nested {#if inside)
            result = result.replace(
                /\{#if\s+(\w+)\}((?:(?!\{#if).)*?)\{\/if\}/gs,
                (match, varName, body) => {
                    changed = true;
                    const value = values[varName];
                    const isTruthy = this.isTruthy(value);

                    // Check for {#else}
                    const elseParts = body.split('{#else}');
                    if (elseParts.length === 2) {
                        return isTruthy ? elseParts[0] : elseParts[1];
                    }

                    return isTruthy ? body : '';
                }
            );
        }

        return result;
    }

    /**
     * Check if a value is truthy for conditionals
     */
    private static isTruthy(value: string | number | undefined): boolean {
        if (value === undefined || value === null) {
            return false;
        }
        if (typeof value === 'string') {
            return value.trim() !== '';
        }
        if (typeof value === 'number') {
            return value !== 0;
        }
        return Boolean(value);
    }

    /**
     * Extract variable names used in content
     * Useful for detecting which variables a template needs
     */
    public static extractUsedVariables(content: string): string[] {
        const variables = new Set<string>();

        // Match {varname} and {varname:format}
        const varMatches = content.matchAll(/\{(\w+)(?::[^}]+)?\}/g);
        for (const match of varMatches) {
            // Skip conditional keywords
            if (!['#if', '#else', '/if'].includes(match[1])) {
                variables.add(match[1]);
            }
        }

        // Match conditional variable names
        const condMatches = content.matchAll(/\{#if\s+(\w+)\}/g);
        for (const match of condMatches) {
            variables.add(match[1]);
        }

        return Array.from(variables);
    }

    /**
     * Validate that all required variables have values
     */
    public static validateVariables(
        variables: TemplateVariable[],
        values: Record<string, string | number>
    ): { valid: boolean; missing: string[] } {
        const missing: string[] = [];

        for (const variable of variables) {
            if (variable.required !== false) {
                const value = values[variable.name];
                if (value === undefined || value === '') {
                    missing.push(variable.label || variable.name);
                }
            }
        }

        return {
            valid: missing.length === 0,
            missing
        };
    }

    /**
     * Apply default values for missing variables
     */
    public static applyDefaults(
        variables: TemplateVariable[],
        values: Record<string, string | number>
    ): Record<string, string | number> {
        const result = { ...values };

        for (const variable of variables) {
            if (result[variable.name] === undefined && variable.default !== undefined) {
                result[variable.name] = variable.default;
            }
        }

        return result;
    }
}
