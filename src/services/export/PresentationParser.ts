import * as path from 'path';
import { KanbanTask } from '../../markdownParser';
import { IdGenerator } from '../../utils/idGenerator';

export interface PresentationSlide {
  title?: string;
  content: string;
  slideNumber: number;
}

export class PresentationParser {
  /**
   * Parse presentation markdown content into individual slides
   * Slides are separated by '---'
   *
   * Format:
   * With title:
   *   [1 blank line]
   *   Title
   *   [1 blank line]
   *   Description
   *   [1 blank line]
   *   ---
   *   [next slide...]
   *
   * Without title (description only):
   *   [2+ blank lines]
   *
   *   Description
   *   [1 blank line]
   *   ---
   *   [next slide...]
   *
   * Note: Any '---' at the beginning or end of the file are ignored (treated as empty slides)
   */
  static parsePresentation(content: string): PresentationSlide[] {
    if (!content || !content.trim()) {
      return [];
    }

    // Strip YAML frontmatter if present (e.g., ---\nmarp: true\n---\n)
    // This is critical for parsing include files that have Marp YAML headers
    let workingContent = content;
    const yamlMatch = content.match(/^---\n[\s\S]*?\n---\n/);
    if (yamlMatch) {
      workingContent = content.substring(yamlMatch[0].length);
    }

    // CRITICAL: Temporarily replace HTML comments with placeholders
    // This prevents '---' inside comments from being treated as slide separators
    // while preserving the comments in the output
    const comments: string[] = [];
    const contentWithPlaceholders = workingContent.replace(/<!--[\s\S]*?-->/g, (match) => {
      const index = comments.length;
      comments.push(match);
      return `__COMMENT_PLACEHOLDER_${index}__`;
    });

    // Split by slide separators ONLY (not column markers like ---:, :--:, :---)
    // CRITICAL: Only plain --- is a separator, others are Marp column layout markers
    // This prevents an extra leading empty line in each slide
    const rawSlides = contentWithPlaceholders.split(/^---[ \t]*\n/gm);
    const slides: PresentationSlide[] = [];

    rawSlides.forEach((slideContent, index) => {
      if (!slideContent.trim()) {
        return; // Skip empty slides
      }

      const lines = slideContent.split('\n');

      // Count CONSECUTIVE leading empty lines from the start
      let emptyLineCount = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '') {
          emptyLineCount++;
        } else {
          break; // Stop at first non-empty line
        }
      }

      // Get the first 2 lines with content (to determine structure)
      const contentLines: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== '') {
          contentLines.push(i);
          if (contentLines.length >= 2) {
            break;
          }
        }
      }

      let titleLine: number = -1; // -1 means undefined/no title
      let descriptionStartLine: number = -1; // -1 means no description
      const descriptionEndLine: number = lines.length; // Always read to end

      if (contentLines.length >= 1) {
        // Check empty line count: 0-1 empty lines = has title, 2+ = no title
        if (emptyLineCount < 2) {
          // 0 or 1 empty lines => first content is title
          const firstContentLine = lines[contentLines[0]];

          // ERROR CORRECTION: Check if first line contains patterns that indicate
          // it's part of structured content that should NOT be split
          // Patterns: Marp column markers (---:, :--:, :---), HTML comments (<!--),
          // Markdown tables (|...|), or list items (- text)
          const hasStructuredContentPattern =
            /---:|:--:|:---|<!--|\|.*\||^-\s/.test(firstContentLine);

          if (hasStructuredContentPattern) {
            // Treat as no title - all content should stay together
            titleLine = -1;
            descriptionStartLine = Math.min(contentLines[0], 3);
          } else {
            // Normal case: first content is title
            titleLine = contentLines[0];

            if (contentLines.length === 2) {
              // Have a second content line - description starts after title
              // Take the line after the title, or at max one empty line after that
              const gap = contentLines[1] - contentLines[0];
              descriptionStartLine = Math.min(contentLines[0] + Math.max(gap, 1), contentLines[0] + 3);
            } else {
              // Only one content line (the title) - no description
              descriptionStartLine = lines.length; // Beyond end = no description
            }
          }
        } else {
          // 2+ empty lines => no title, all is description
          titleLine = -1; // undefined
          descriptionStartLine = Math.min(contentLines[0], 3);
        }
      } else {
        // No content at all
        titleLine = -1;
        descriptionStartLine = -1;
      }

      // Extract title - NO TRIMMING
      let title: string | undefined;
      if (titleLine !== -1) {
        title = lines[titleLine];
      } else {
        title = undefined;
      }

      // Extract description - ALL lines from start to end (NO TRIMMING)
      // Remove the last line if it's empty (accounts for the trailing newline we add when writing)
      let description: string;
      if (descriptionStartLine !== -1 && descriptionStartLine < descriptionEndLine) {
        const descriptionLines: string[] = [];
        for (let i = descriptionStartLine; i < descriptionEndLine; i++) {
          descriptionLines.push(lines[i]);
        }
        // Remove one trailing empty line (we add it automatically when writing)
        // This preserves any extra empty lines the user manually added
        if (descriptionLines.length > 0 && descriptionLines[descriptionLines.length - 1] === '') {
          descriptionLines.pop();
        }
        description = descriptionLines.join('\n');
      } else {
        description = '';
      }

      // Restore HTML comments from placeholders
      // CRITICAL: ALL content including comments must be preserved
      if (title) {
        title = title.replace(/__COMMENT_PLACEHOLDER_(\d+)__/g, (match, index) => {
          return comments[parseInt(index)] || match;
        });
      }
      description = description.replace(/__COMMENT_PLACEHOLDER_(\d+)__/g, (match, index) => {
        return comments[parseInt(index)] || match;
      });

      slides.push({
        title,
        content: description,
        slideNumber: index + 1
      });
    });

    return slides;
  }

  /**
   * Convert presentation slides to kanban tasks
   */
  static slidesToTasks(slides: PresentationSlide[], includeFilePath?: string, mainFilePath?: string): KanbanTask[] {
    return slides.map(slide => {
      const task: KanbanTask = {
        id: IdGenerator.generateTaskId(),
        title: slide.title || '',
      };

      // Add content as description if it exists
      // NO TRIMMING - preserve exact content including whitespace
      if (slide.content !== undefined && slide.content !== '') {
        task.description = slide.content;
      }

      // Add includeContext for dynamic image path resolution
      if (includeFilePath && mainFilePath) {
        task.includeContext = {
          includeFilePath: includeFilePath,
          includeDir: path.dirname(includeFilePath),
          mainFilePath: mainFilePath,
          mainDir: path.dirname(mainFilePath)
        };
      }

      return task;
    });
  }

  /**
   * Convert kanban tasks back to presentation format
   * This enables bidirectional editing
   *
   * Format:
   * With title:
   *   [1 blank line]
   *   Title
   *   [1 blank line]
   *   Description
   *   [1 blank line]
   *   ---
   *   [next slide...]
   *
   * Without title (description only):
   *   [3 blank lines]
   *
   *
   *   Description
   *   [1 blank line]
   *   ---
   *   [next slide...]
   *
   * Note: No --- at the beginning or end of the file, only between slides
   */

  /**
   * Parse a markdown file and convert to kanban tasks
   * This is the main entry point for column includes
   */
  static parseMarkdownToTasks(content: string, includeFilePath?: string, mainFilePath?: string): KanbanTask[] {
    const slides = this.parsePresentation(content);
    return this.slidesToTasks(slides, includeFilePath, mainFilePath);
  }
}
