/**
 * Tag utility functions for export service
 * Handles tag removal based on visibility settings
 */

export type TagVisibility = 'all' | 'allexcludinglayout' | 'customonly' | 'mentionsonly' | 'none';

export class TagUtils {
    // Regular expressions for different tag patterns
    // Tags are space-delimited: match up to whitespace or end-of-string
    private static readonly BASIC_TAG_PATTERN = /#[^\s]+/g;
    private static readonly AT_TAG_PATTERN = /@[^\s]+/g;
    private static readonly ROW_TAG_PATTERN = /#row\d*(?=\s|$)/gi;
    private static readonly SPAN_TAG_PATTERN = /#span\d*(?=\s|$)/gi;
    private static readonly STACK_TAG_PATTERN = /#stack(?=\s|$)/gi;

    /**
     * Remove tags from text based on visibility setting
     * IMPORTANT: Leading whitespace is structurally significant in kanban markdown
     * (indented ## is slide content, non-indented ## is column header)
     */
    static filterTagsFromText(text: string, visibility: TagVisibility): string {
        if (!text) {
            return text;
        }

        // Preserve leading whitespace - it's structurally significant!
        const leadingMatch = text.match(/^(\s*)/);
        const leadingWhitespace = leadingMatch ? leadingMatch[1] : '';
        const contentPart = text.substring(leadingWhitespace.length);

        let processed: string;

        switch (visibility) {
            case 'all':
                // Keep all tags
                return text;

            case 'allexcludinglayout':
                // Remove layout tags (#span, #row, #stack)
                processed = contentPart
                    .replace(this.ROW_TAG_PATTERN, '')
                    .replace(this.SPAN_TAG_PATTERN, '')
                    .replace(this.STACK_TAG_PATTERN, '')
                    .replace(/  +/g, ' ')  // Collapse multiple spaces (not all whitespace)
                    .trim();
                break;

            case 'customonly':
                // Keep only custom tags and @ tags
                processed = this.removeConfiguredTags(contentPart);
                break;

            case 'mentionsonly':
                // Remove all # tags, keep only @ tags
                processed = contentPart
                    .replace(this.BASIC_TAG_PATTERN, '')
                    .replace(/  +/g, ' ')  // Collapse multiple spaces (not all whitespace)
                    .trim();
                break;

            case 'none':
                // Remove all tags
                processed = contentPart
                    .replace(this.BASIC_TAG_PATTERN, '')
                    .replace(this.AT_TAG_PATTERN, '')
                    .replace(/  +/g, ' ')  // Collapse multiple spaces (not all whitespace)
                    .trim();
                break;

            default:
                return text;
        }

        // Restore leading whitespace
        return leadingWhitespace + processed;
    }

    /**
     * Remove configured tags (simplified version)
     * In a full implementation, this would check against the actual configured tags
     * NOTE: Caller passes content WITHOUT leading whitespace
     */
    private static removeConfiguredTags(text: string): string {
        // Common configured tags to remove
        const configuredTags = [
            '#urgent', '#high', '#medium', '#low',
            '#todo', '#doing', '#done', '#blocked',
            '#bug', '#feature', '#enhancement',
            '#red', '#green', '#blue', '#yellow', '#orange',
            '#row', '#span', '#stack'
        ];

        let result = text;
        for (const tag of configuredTags) {
            const pattern = new RegExp(tag + '\\d*(?=\\s|$)', 'gi');
            result = result.replace(pattern, '');
        }

        // Collapse multiple spaces (not all whitespace), trim trailing
        return result.replace(/  +/g, ' ').trim();
    }

    /**
     * Process markdown content to filter tags
     */
    static processMarkdownContent(content: string, visibility: TagVisibility): string {
        if (visibility === 'all') {
            return content;
        }

        const lines = content.split('\n');
        const processedLines: string[] = [];

        for (const line of lines) {
            // Process headers (## Column Title #tag1 #tag2)
            if (line.startsWith('## ')) {
                processedLines.push(this.filterTagsFromText(line, visibility));
            }
            // Process task lines (- [ ] Task text #tag1 #tag2)
            else if (line.match(/^-\s*\[[x\s]\]/i)) {
                processedLines.push(this.filterTagsFromText(line, visibility));
            }
            // Process regular lines that might contain tags
            else if (line.includes('#') || line.includes('@')) {
                processedLines.push(this.filterTagsFromText(line, visibility));
            }
            // Keep other lines as-is
            else {
                processedLines.push(line);
            }
        }

        return processedLines.join('\n');
    }
}