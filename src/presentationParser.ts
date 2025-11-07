import { KanbanTask } from './markdownParser';
import { IdGenerator } from './utils/idGenerator';

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

    // Split by slide separators
    // Use [ \t]* instead of \s* to match only spaces/tabs, NOT newlines
    const rawSlides = content.split(/^---[ \t]*$/gm);
    const slides: PresentationSlide[] = [];

    rawSlides.forEach((slideContent, index) => {
      if (!slideContent.trim()) {
        return; // Skip empty slides
      }

      const lines = slideContent.split('\n');

      // Count leading empty lines after ---
      let emptyLineCount = 0;
      for (const line of lines) {
        if (line.trim() === '') {
          emptyLineCount++;
        } else {
          break; // Stop at first non-empty line
        }
      }

      let title: string | undefined;
      let description: string;

      if (emptyLineCount >= 2) {
        // 2+ empty lines → no title, everything after empty lines is description
        title = undefined;
        description = lines.slice(emptyLineCount).join('\n').trim();
      } else if (emptyLineCount === 1) {
        // 1 empty line → next line is title
        // Format: [empty line (0), title line (1), empty line (2), ...description (3+)]
        const titleLine = lines[1];
        title = titleLine !== undefined ? titleLine : ''; // Can be empty string

        // Description starts after: empty line (0), title (1), empty line (2)
        description = lines.slice(3).join('\n').trim();
      } else {
        // 0 empty lines → fallback to old behavior for backwards compatibility
        // First non-empty line is title
        const firstNonEmpty = lines.findIndex(l => l.trim() !== '');
        if (firstNonEmpty !== -1) {
          title = lines[firstNonEmpty].trim();
          description = lines.slice(firstNonEmpty + 1).join('\n').trim();
        } else {
          title = undefined;
          description = '';
        }
      }

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
  static slidesToTasks(slides: PresentationSlide[]): KanbanTask[] {
    return slides.map(slide => {
      const task: KanbanTask = {
        id: IdGenerator.generateTaskId(),
        title: slide.title || '',
      };

      // Add content as description if it exists
      if (slide.content && slide.content.trim()) {
        task.description = slide.content;
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
  static tasksToPresentation(tasks: KanbanTask[]): string {
    if (!tasks || tasks.length === 0) {
      return '';
    }

    // Filter out task includes - they shouldn't be written to presentation format
    // Task includes have includeMode=true or includeFiles set
    const regularTasks = tasks.filter(task => !task.includeMode && !task.includeFiles);

    if (regularTasks.length === 0) {
      return '';
    }

    const slides = regularTasks.map(task => {
      let slideContent = '';

      // Check if task has a non-empty title
      if (task.title && task.title.trim() !== '') {
        // Has title: 1 blank line, title, 1 blank line, description
        // After split, we want: ['', 'Title', '', 'Description']
        slideContent += '\n';              // Start with newline (creates first empty line after split)
        slideContent += task.title + '\n'; // Title
        slideContent += '\n';              // Empty line separator
        if (task.description) {
          slideContent += task.description;
        }
      } else {
        // No title or empty title: 3 blank lines, description
        // After split, we want: ['', '', '', 'Description']
        slideContent += '\n\n\n';          // 3 newlines = 3 empty lines after split
        if (task.description) {
          slideContent += task.description;
        }
      }

      // Add 1 empty line at the end of each slide (before ---)
      slideContent += '\n';

      return slideContent;
    });

    // Join slides with slide separators
    // Format: [slide1]\n---\n[slide2]\n---\n[slide3]
    // Note: We don't add --- at the beginning or end - only between slides
    const filteredSlides = slides.filter(slide => slide);
    if (filteredSlides.length === 0) {
      return '';
    }

    // Join slides with --- separator between them (not at start/end)
    return filteredSlides.join('\n---\n');
  }

  /**
   * Parse a markdown file and convert to kanban tasks
   * This is the main entry point for column includes
   */
  static parseMarkdownToTasks(content: string): KanbanTask[] {
    const slides = this.parsePresentation(content);
    return this.slidesToTasks(slides);
  }
}