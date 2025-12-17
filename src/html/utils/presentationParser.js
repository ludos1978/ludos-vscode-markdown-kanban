/**
 * Presentation Parser (Browser-compatible)
 *
 * This is a browser-compatible version of the parsing logic from
 * src/services/export/PresentationParser.ts
 *
 * It parses presentation markdown (slides separated by ---) into
 * structured slide objects with title and content.
 */

/**
 * Parse presentation markdown content into individual slides
 * Slides are separated by '---'
 *
 * Format:
 * With title:
 *   Title
 *   [1 blank line]
 *   Description
 *   [1 blank line]
 *   ---
 *   [next slide...]
 *
 * Without title (description only):
 *   [1+ blank lines]
 *   Description
 *   [1 blank line]
 *   ---
 *   [next slide...]
 *
 * @param {string} content - The markdown content to parse
 * @returns {Array<{title: string|undefined, content: string, slideNumber: number}>}
 */
function parsePresentation(content) {
    // CRITICAL: Only skip if content is null/undefined/empty string
    if (!content) {
        return [];
    }

    // CRITICAL: Normalize CRLF to LF (Windows line endings to Unix)
    let workingContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Strip YAML frontmatter if present (e.g., ---\nmarp: true\n---\n)
    const yamlMatch = workingContent.match(/^---\n[\s\S]*?\n---\n/);
    if (yamlMatch) {
        workingContent = workingContent.substring(yamlMatch[0].length);
    }

    // CRITICAL: Temporarily replace HTML comments with placeholders
    // This prevents '---' inside comments from being treated as slide separators
    const comments = [];
    const contentWithPlaceholders = workingContent.replace(/<!--[\s\S]*?-->/g, (match) => {
        const index = comments.length;
        comments.push(match);
        return `__COMMENT_PLACEHOLDER_${index}__`;
    });

    // Split by slide separators: \n\n---\n\n (blank line + --- + blank line)
    // CRITICAL: Only plain --- is a separator, use [ \t]* not \s* to avoid matching newlines
    const rawSlides = contentWithPlaceholders.split(/\n\n---[ \t]*\n\n/g);
    const slides = [];

    rawSlides.forEach((slideContent, index) => {
        const lines = slideContent.split('\n');

        // Count CONSECUTIVE leading empty lines from the start
        let emptyLineCount = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === '') {
                emptyLineCount++;
            } else {
                break;
            }
        }

        // Get the first 2 lines with content (to determine structure)
        const contentLines = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] !== '') {
                contentLines.push(i);
                if (contentLines.length >= 2) {
                    break;
                }
            }
        }

        let titleLine = -1;
        let descriptionStartLine = -1;
        const descriptionEndLine = lines.length;

        if (contentLines.length >= 1) {
            if (emptyLineCount < 1) {
                // 0 empty lines => first content is title
                const firstContentLine = lines[contentLines[0]];

                // Check if first line contains patterns that indicate
                // it's part of structured content that should NOT be split
                const hasStructuredContentPattern =
                    /---:|:--:|:---|<!--|\|.*\||^-\s/.test(firstContentLine);

                if (hasStructuredContentPattern) {
                    titleLine = -1;
                    descriptionStartLine = Math.min(contentLines[0], 3);
                } else {
                    titleLine = contentLines[0];
                    const lineAfterTitle = titleLine + 1;
                    if (lineAfterTitle < lines.length && lines[lineAfterTitle] === '') {
                        descriptionStartLine = titleLine + 2;
                    } else {
                        descriptionStartLine = titleLine + 1;
                    }
                }
            } else {
                // 1+ empty lines => no title, all is description
                titleLine = -1;
                descriptionStartLine = Math.min(contentLines[0], 3);
            }
        } else {
            titleLine = -1;
            descriptionStartLine = lines.length > 0 ? 0 : -1;
        }

        // Extract title
        let title;
        if (titleLine !== -1) {
            title = lines[titleLine];
        } else {
            title = undefined;
        }

        // Extract description
        let description;
        if (descriptionStartLine !== -1 && descriptionStartLine < descriptionEndLine) {
            const descriptionLines = [];
            for (let i = descriptionStartLine; i < descriptionEndLine; i++) {
                descriptionLines.push(lines[i]);
            }
            description = descriptionLines.join('\n');
        } else {
            description = '';
        }

        // Restore HTML comments from placeholders
        const restoreComments = (text) => {
            if (!text || comments.length === 0) return text;
            return text.replace(/__COMMENT_PLACEHOLDER_(\d+)__/g, (match, idx) => {
                return comments[parseInt(idx)] || match;
            });
        };

        if (title) {
            title = restoreComments(title);
        }
        description = restoreComments(description);

        slides.push({
            title,
            content: description,
            slideNumber: index + 1
        });
    });

    return slides;
}

/**
 * Convert presentation slides to task objects
 * @param {Array<{title: string|undefined, content: string}>} slides
 * @returns {Array<{id: string, title: string, description: string}>}
 */
function slidesToTasks(slides) {
    return slides.map((slide) => ({
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: slide.title ?? '',
        description: slide.content || ''
    }));
}

/**
 * Parse markdown content and convert to tasks
 * @param {string} content - The markdown content to parse
 * @returns {Array<{id: string, title: string, description: string}>}
 */
function parseMarkdownToTasks(content) {
    const slides = parsePresentation(content);
    return slidesToTasks(slides);
}

/**
 * Parse clipboard content in presentation format into column title and tasks
 *
 * Rules:
 * - Split content by \n\n---\n\n (slide separator)
 * - First slide: if it has title only (no content), use as column title
 * - Otherwise, column title is empty
 * - All remaining slides become tasks
 *
 * @param {string} content - The markdown content
 * @returns {{columnTitle: string, tasks: Array<{id: string, title: string, description: string}>}}
 */
function parseClipboardAsColumn(content) {
    if (!content) {
        return { columnTitle: '', tasks: [] };
    }

    const slides = parsePresentation(content);

    let columnTitle = '';
    let tasks = [];

    if (slides.length > 0) {
        const firstSlide = slides[0];
        // If first slide has title but no content (or only whitespace), use as column title
        if (firstSlide.title && (!firstSlide.content || firstSlide.content.trim() === '')) {
            columnTitle = firstSlide.title;
            // Remaining slides become tasks
            for (let i = 1; i < slides.length; i++) {
                tasks.push({
                    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    title: slides[i].title ?? '',
                    description: slides[i].content || ''
                });
            }
        } else {
            // All slides become tasks
            tasks = slidesToTasks(slides);
        }
    }

    return { columnTitle, tasks };
}

// Export for use in other modules
window.PresentationParser = {
    parsePresentation,
    slidesToTasks,
    parseMarkdownToTasks,
    parseClipboardAsColumn
};
