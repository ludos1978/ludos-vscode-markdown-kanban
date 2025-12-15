import * as path from 'path';
import { KanbanTask } from '../../board/KanbanTypes';
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
    // CRITICAL: Only skip if content is null/undefined/empty string
    // Do NOT use trim() - whitespace/newlines ARE valid content
    if (!content) {
      return [];
    }

    // CRITICAL: Normalize CRLF to LF (Windows line endings to Unix)
    // This MUST happen FIRST before any other processing!
    // Without this, \r would remain at end of lines after split('\n')
    // and break all empty line checks (since '\r' !== '')
    let workingContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Strip YAML frontmatter if present (e.g., ---\nmarp: true\n---\n)
    // This is critical for parsing include files that have Marp YAML headers
    // NOTE: Must use workingContent (normalized) not original content!
    const yamlMatch = workingContent.match(/^---\n[\s\S]*?\n---\n/);
    if (yamlMatch) {
      workingContent = workingContent.substring(yamlMatch[0].length);
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
      // CRITICAL: Process ALL slides - never skip based on content
      // Empty/whitespace content IS valid content

      const lines = slideContent.split('\n');

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
      // When READING, we pop exactly TWO trailing empty lines:
      //   1. The empty string after the last \n (artifact of split)
      //   2. The blank line before --- (formatting, not content)
      //
      // When WRITING (in PresentationGenerator.formatSlides):
      //   - We add '\n' after each slide content (restores the blank before ---)
      //   - We join with '\n---\n\n' (separator + blank after)
      //
      // This ensures perfect round-trip: read → parse → generate → write = identical
      //
      // DO NOT CHANGE THIS WITHOUT UPDATING PresentationGenerator.formatSlides!
      // ═══════════════════════════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════════════════════════
      // NEVER CHANGE THESE POPS! UP TO 2 POPS IF LAST LINES ARE EMPTY!
      // NO OTHER WAY IS PERMITTED! NEVER EVER!
      // ═══════════════════════════════════════════════════════════════════════════
      // Pop 1: Remove trailing empty from split (after last \n)
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      // Pop 2: Remove the blank line before --- (we add it back when writing)
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }

      // Count CONSECUTIVE leading empty lines from the start
      // CRITICAL: Only check for exact empty string, NOT trim
      let emptyLineCount = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') {
          emptyLineCount++;
        } else {
          break; // Stop at first non-empty line
        }
      }

      // Get the first 2 lines with content (to determine structure)
      // CRITICAL: Only check for exact empty string, NOT trim
      const contentLines: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== '') {
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

            // CRITICAL: Skip AT MAX ONE empty line between title and content
            // BUT ONLY if that line is actually empty!
            const lineAfterTitle = titleLine + 1;
            if (lineAfterTitle < lines.length && lines[lineAfterTitle] === '') {
              descriptionStartLine = titleLine + 2; // Skip the one empty line
            } else {
              descriptionStartLine = titleLine + 1; // No empty line, start right after title
            }
          }
        } else {
          // 2+ empty lines => no title, all is description
          titleLine = -1; // undefined
          descriptionStartLine = Math.min(contentLines[0], 3);
        }
      } else {
        // No non-whitespace content, but whitespace IS content
        // CRITICAL: Preserve whitespace-only slides as description
        titleLine = -1;
        descriptionStartLine = lines.length > 0 ? 0 : -1;
      }

      // Extract title - NO TRIMMING
      let title: string | undefined;
      if (titleLine !== -1) {
        title = lines[titleLine];
      } else {
        title = undefined;
      }

      // Extract description - ALL lines from start to end (NO TRIMMING)
      let description: string;
      if (descriptionStartLine !== -1 && descriptionStartLine < descriptionEndLine) {
        const descriptionLines: string[] = [];
        for (let i = descriptionStartLine; i < descriptionEndLine; i++) {
          descriptionLines.push(lines[i]);
        }
        description = descriptionLines.join('\n');

        // DEBUG: Trace description extraction
        console.log(`[PresentationParser.parsePresentation] Slide ${index}: titleLine=${titleLine}, descStart=${descriptionStartLine}, descEnd=${descriptionEndLine}, descLines=${JSON.stringify(descriptionLines)}, desc=${JSON.stringify(description)}`);
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
    return slides.map((slide, index) => {
      const task: KanbanTask = {
        id: IdGenerator.generateTaskId(),
        // CRITICAL: Use ?? not || - empty string IS a valid title
        title: slide.title ?? '',
      };

      // CRITICAL: Always set description - never check for empty
      // Empty/whitespace content IS valid content
      task.description = slide.content;

      // DEBUG: Trace exact description content
      console.log(`[PresentationParser.slidesToTasks] Slide ${index}: title="${slide.title}", content length=${slide.content?.length}, content JSON=${JSON.stringify(slide.content)}`);

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
