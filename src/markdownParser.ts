import { IdGenerator } from './utils/idGenerator';
import { PresentationParser } from './presentationParser';
import { PathResolver } from './services/PathResolver';
import { sortColumnsByRow } from './utils/columnUtils';
import { MarkdownFile } from './files/MarkdownFile'; // FOUNDATION-1: For path comparison
import { INCLUDE_SYNTAX } from './constants/IncludeConstants';
import * as fs from 'fs';
import * as path from 'path';

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  includeMode?: boolean;  // When true, content is generated from included files
  includeFiles?: string[]; // Paths to included files (for task includes - includeMode=true)
  regularIncludeFiles?: string[]; // Paths to regular includes (!!!include()!!! in description)
  originalTitle?: string;  // Original title before include processing
  displayTitle?: string;   // Cleaned title for display (without include syntax)
  alternativeTitle?: string; // Generated title from content when no title exists (used when folded)
  isLoadingContent?: boolean;  // When true, frontend shows loading indicator while include content loads
}

export interface KanbanColumn {
  id: string;
  title: string;
  tasks: KanbanTask[];
  includeMode?: boolean;  // When true, tasks are generated from included files
  includeFiles?: string[]; // Paths to included presentation files
  originalTitle?: string;  // Original title before include processing
  displayTitle?: string;   // Cleaned title for display (without include syntax)
  isLoadingContent?: boolean;  // When true, frontend shows loading indicator while include content loads
}

export interface KanbanBoard {
  valid: boolean;
  title: string;
  columns: KanbanColumn[];
  yamlHeader: string | null;
  kanbanFooter: string | null;
}

export class MarkdownKanbanParser {
  // Runtime-only ID generation - no persistence to markdown

  /**
   * Find existing column by position with content verification
   * Backend markdown is source of truth - preserve IDs only when content matches
   */
  /**
   * Find existing column by POSITION ONLY
   * CRITICAL: NEVER match by title - position determines identity
   * Titles can be duplicated, changed, or empty
   */
  private static findExistingColumn(existingBoard: KanbanBoard | undefined, title: string, columnIndex?: number, newTasks?: KanbanTask[]): KanbanColumn | undefined {
    if (!existingBoard) return undefined;

    // ONLY match by position - title/content matching is FORBIDDEN
    if (columnIndex !== undefined && columnIndex >= 0 && columnIndex < existingBoard.columns.length) {
      return existingBoard.columns[columnIndex];
    }

    // No position provided or out of bounds - this is a NEW column
    return undefined;
  }

  static parseMarkdown(content: string, basePath?: string, existingBoard?: KanbanBoard): { board: KanbanBoard, includedFiles: string[], columnIncludeFiles: string[], taskIncludeFiles: string[] } {
      // First parse with original content to preserve raw descriptions
      const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

      // Location-based include detection:
      // - Column includes: !!!include()!!! in column headers (## header)
      // - Task includes: !!!include()!!! in task titles (- [ ] title)
      // - Regular includes: !!!include()!!! in task descriptions (indented lines)
      // We detect these during parsing based on context, not upfront
      let includedFiles: string[] = []; // Regular includes only (from descriptions)
      let columnIncludeFiles: string[] = [];
      let taskIncludeFiles: string[] = [];
      const board: KanbanBoard = {
        valid: false,
        title: '',
        columns: [],
        yamlHeader: null,
        kanbanFooter: null
      };

      let currentColumn: KanbanColumn | null = null;
      let currentTask: KanbanTask | null = null;
      let collectingDescription = false;
      let inYamlHeader = false;
      let inKanbanFooter = false;
      let yamlLines: string[] = [];
      let footerLines: string[] = [];
      let yamlStartFound = false;
      let columnIndex = 0;  // Add counter for columns
      let taskIndexInColumn = 0;  // Add counter for tasks within column

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Handle YAML front matter
        if (line.startsWith('---')) {
          if (!yamlStartFound) {
            yamlStartFound = true;
            inYamlHeader = true;
            yamlLines.push(line);
            continue;
          } 
          // finish the header reading
          else if (inYamlHeader) {
            yamlLines.push(line);
            board.yamlHeader = yamlLines.join('\n');
            board.valid = board.yamlHeader.includes('kanban-plugin: board');
            if (!board.valid) {
              return { board, includedFiles, columnIncludeFiles, taskIncludeFiles };
            }
            inYamlHeader = false;
            continue;
          }
        }

        if (inYamlHeader) {
          yamlLines.push(line);
          continue;
        }

        // Handle Kanban footer
        if (line.startsWith('%%')) {
          if (collectingDescription) {
            this.finalizeCurrentTask(currentTask, currentColumn, existingBoard, columnIndex - 1);
            collectingDescription = false;
          }
          inKanbanFooter = true;
          footerLines.push(line);
          continue;
        }

        if (inKanbanFooter) {
          footerLines.push(line);
          continue;
        }

        // Parse column with runtime UUID generation
        if (line.startsWith('## ')) {
          if (collectingDescription) {
            this.finalizeCurrentTask(currentTask, currentColumn, existingBoard, columnIndex - 1);
            collectingDescription = false;
          }
          currentTask = null;
          if (currentColumn) {
            board.columns.push(currentColumn);
          }

          const columnTitle = line.substring(3);

          // Check for include syntax in column header (location-based: column includes)
          const columnIncludeMatches = columnTitle.match(INCLUDE_SYNTAX.REGEX);

          if (columnIncludeMatches && columnIncludeMatches.length > 0) {
            // This is a column include - process included files as Marp presentations
            const includeFiles: string[] = [];
            columnIncludeMatches.forEach(match => {
              const filePath = match.replace(INCLUDE_SYNTAX.REGEX_SINGLE, '$1').trim();
              includeFiles.push(filePath);
              // Track for file watching (FOUNDATION-1: Use normalized comparison)
              if (!columnIncludeFiles.some(p => MarkdownFile.isSameFile(p, filePath))) {
                columnIncludeFiles.push(filePath);
              }
            });

            // Generate tasks from included files
            const includeTasks: KanbanTask[] = [];
            for (const filePath of includeFiles) {
              const resolvedPath = basePath ? PathResolver.resolve(basePath, filePath) : filePath;
              try {
                if (fs.existsSync(resolvedPath)) {
                  const fileContent = fs.readFileSync(resolvedPath, 'utf8');
                  const slideTasks = PresentationParser.parseMarkdownToTasks(fileContent);
                  includeTasks.push(...slideTasks);
                } else {
                  console.warn(`[Parser] Column include file not found: ${resolvedPath}`);
                }
              } catch (error) {
                console.error(`[Parser] Error processing column include ${filePath}:`, error);
              }
            }

            // Replace !!!include()!!! with placeholder for frontend badge rendering
            // This preserves the position of the include in the title
            let displayTitle = columnTitle;
            columnIncludeMatches.forEach((match, index) => {
              // Extract the file path from the match: !!!include(path)!!!
              const pathMatch = match.match(/!!!include\s*\(([^)]+)\)\s*!!!/);
              if (pathMatch && includeFiles[index]) {
                // Use the resolved file path as a unique identifier
                const filePath = includeFiles[index];
                const placeholder = `%INCLUDE_BADGE:${filePath}%`;
                displayTitle = displayTitle.replace(match, placeholder);
              } else {
                displayTitle = displayTitle.replace(match, '').trim();
              }
            });

            // Use filename as title if no display title provided
            if (!displayTitle && includeFiles.length > 0) {
              displayTitle = path.basename(includeFiles[0], path.extname(includeFiles[0]));
            }

            // Preserve existing column ID by position (NOT title - title changes with include switches!)
            const existingCol = this.findExistingColumn(existingBoard, columnTitle, columnIndex);
            currentColumn = {
              id: existingCol?.id || IdGenerator.generateColumnId(),
              title: columnTitle, // Keep full title with include syntax for editing
              tasks: includeTasks,
              includeMode: true,
              includeFiles: includeFiles,
              originalTitle: columnTitle,
              displayTitle: displayTitle || 'Included Column' // Store cleaned title for display
            };
          } else {
            // Regular column - preserve existing ID by position
            const existingCol = this.findExistingColumn(existingBoard, columnTitle, columnIndex);
            currentColumn = {
              id: existingCol?.id || IdGenerator.generateColumnId(),
              title: columnTitle,
              tasks: []
            };
          }

          columnIndex++;
          taskIndexInColumn = 0;  // Reset task counter for new column
          continue;
        }

        // Parse task with runtime UUID generation
        if (line.startsWith('- ')) {
          if (collectingDescription) {
            this.finalizeCurrentTask(currentTask, currentColumn, existingBoard, columnIndex - 1);
            collectingDescription = false;
          }

          if (currentColumn && !currentColumn.includeMode) {
            // Only parse tasks for non-include columns
            const taskTitle = line.substring(6);

            // Create task with temporary ID - will be matched by content during finalization
            currentTask = {
              id: IdGenerator.generateTaskId(), // Temporary, replaced if content matches
              title: taskTitle,
              description: ''
            };

            taskIndexInColumn++;
            collectingDescription = true;
          } else if (currentColumn && currentColumn.includeMode) {
            // For include columns, skip task parsing as tasks are already generated
            currentTask = null;
            collectingDescription = false;
          }
          continue;
        }

        // Collect description from any indented content
        if (currentTask && collectingDescription) {
          let descLine = line;
          // remove the first leading spaces if there
          if (line.startsWith('  ')) {
            descLine = line.substring(2);
          }

          // Store description (frontend will handle include processing)
          if (!currentTask.description) {
            currentTask.description = descLine;
          } else {
            currentTask.description += '\n' + descLine;
          }
          continue;
        }

        if (trimmedLine === '') {
          continue;
        }
      }

      // Add the last task and column
      if (collectingDescription) {
        this.finalizeCurrentTask(currentTask, currentColumn, existingBoard, columnIndex - 1);
      }
      if (currentColumn) {
        board.columns.push(currentColumn);
      }

      if (footerLines.length > 0) {
        board.kanbanFooter = footerLines.join('\n');
      }

      // Process task includes AFTER normal parsing
      this.processTaskIncludes(board, basePath, taskIncludeFiles);

      // Detect regular includes in task descriptions (not handled by parser, but tracked for file watching)
      this.detectRegularIncludes(board, includedFiles);

      return { board, includedFiles, columnIncludeFiles, taskIncludeFiles };
  }

  private static processTaskIncludes(board: KanbanBoard, basePath?: string, taskIncludeFiles?: string[]): void {
    for (const column of board.columns) {
      for (const task of column.tasks) {
        // Check if task title contains include syntax (location-based: task includes)
        const taskIncludeMatches = task.title.match(INCLUDE_SYNTAX.REGEX);

        if (taskIncludeMatches && taskIncludeMatches.length > 0) {
          // This is a task include - process included file (first line as title, rest as description)
          const includeFiles: string[] = [];
          taskIncludeMatches.forEach(match => {
            const filePath = match.replace(/!!!include\(([^)]+)\)!!!/, '$1').trim();
            includeFiles.push(filePath);
            // Track for file watching (FOUNDATION-1: Use normalized comparison)
            if (taskIncludeFiles && !taskIncludeFiles.some(p => MarkdownFile.isSameFile(p, filePath))) {
              taskIncludeFiles.push(filePath);
            }
          });

          // STRATEGY: Load full content into description, displayTitle is just metadata
          // The displayTitle shows file info in the UI, description contains the actual file content
          let fullFileContent = '';

          for (const filePath of includeFiles) {
            const resolvedPath = basePath ? PathResolver.resolve(basePath, filePath) : filePath;
            try {
              if (fs.existsSync(resolvedPath)) {
                // Read COMPLETE file content
                fullFileContent = fs.readFileSync(resolvedPath, 'utf8');
              } else {
                console.warn(`[Parser] Task include file not found: ${resolvedPath}`);
              }
            } catch (error) {
              console.error(`[Parser] Error processing task include ${filePath}:`, error);
            }
          }

          // Create placeholder for frontend badge rendering
          // Extract any text before the !!!include()!!! and use that as displayTitle with placeholder
          let displayTitle = task.title;
          const taskIncludeRegex = /!!!include\s*\(([^)]+)\)\s*!!!/g;
          let match;
          let index = 0;
          while ((match = taskIncludeRegex.exec(task.title)) !== null) {
            if (includeFiles[index]) {
              const filePath = includeFiles[index];
              const placeholder = `%INCLUDE_BADGE:${filePath}%`;
              displayTitle = displayTitle.replace(match[0], placeholder);
              index++;
            }
          }
          // Remove checkbox prefix from displayTitle for cleaner display
          displayTitle = displayTitle.replace(/^- \[ \]\s*/, '').trim();

          // Update task properties for include mode
          task.includeMode = true;
          // FOUNDATION-1: Store ORIGINAL paths (preserve casing)
          // Registry will normalize internally for lookups
          // DO NOT normalize here - files need original paths for display
          task.includeFiles = includeFiles.map(f => f.trim()); // Just trim whitespace, keep original casing
          task.originalTitle = task.title; // Keep original title with include syntax
          task.displayTitle = displayTitle; // UI metadata with placeholder for badge
          task.description = fullFileContent; // COMPLETE file content
        }
      }
    }
  }

  private static detectRegularIncludes(board: KanbanBoard, includedFiles: string[]): void {
    // Scan all task descriptions for !!!include()!!! patterns (regular includes)
    const includeRegex = new RegExp(INCLUDE_SYNTAX.REGEX.source, 'gi');

    for (const column of board.columns) {
      for (const task of column.tasks) {
        // Skip tasks with includeMode - they are task includes, not regular includes
        if (task.includeMode) {
          continue;
        }

        if (task.description) {
          // Track which regular includes this task uses
          const taskIncludes: string[] = [];

          let match;
          // Reset regex state
          includeRegex.lastIndex = 0;
          while ((match = includeRegex.exec(task.description)) !== null) {
            const includeFile = match[1].trim();

            // Add to global list if not already present
            if (!includedFiles.includes(includeFile)) {
              includedFiles.push(includeFile);
            }

            // Track this include for this specific task
            if (!taskIncludes.includes(includeFile)) {
              taskIncludes.push(includeFile);
            }
          }

          // Store the list of regular includes for this task
          if (taskIncludes.length > 0) {
            task.regularIncludeFiles = taskIncludes;
          }
        }
      }
    }
  }

  /**
   * Generate alternative title from task content when no title exists
   *
   * Format for images:
   * ![alt text](path/to/screenshot.png "image description") => image description - alt text
   * ![](path/to/screenshot.png "image description") => image description (screenshot.png)
   * ![alt text](path/to/screenshot.png) => alt text (screenshot.png)
   * ![](path/to/screenshot.png) => (screenshot.png)
   *
   * If no images: Use first 20 characters of text
   */
  private static generateAlternativeTitle(description: string | undefined): string | undefined {
    if (!description || description.trim() === '') {
      return undefined;
    }

    // Match markdown images: ![alt text](path "title")
    const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g;
    const match = imageRegex.exec(description);

    if (match) {
      const altText = match[1] || '';  // Can be empty
      const imagePath = match[2];
      const imageDescription = match[3] || '';  // Title attribute

      // Extract filename from path
      const filename = imagePath.split('/').pop()?.split('\\').pop() || imagePath;

      // Apply formatting rules
      if (imageDescription && altText) {
        // Rule 1: image description - alt text
        return `${imageDescription} - ${altText}`;
      } else if (imageDescription && !altText) {
        // Rule 2: image description (filename)
        return `${imageDescription} (${filename})`;
      } else if (altText && !imageDescription) {
        // Rule 3: alt text (filename)
        return `${altText} (${filename})`;
      } else {
        // Rule 4: (filename)
        return `(${filename})`;
      }
    }

    // Fallback: First 20 characters of text content
    // Remove all markdown syntax to get clean text
    let cleanText = description
      .replace(/^#+\s+/gm, '')           // Remove headers
      .replace(/^\s*[-*+]\s+/gm, '')     // Remove list markers
      .replace(/^\s*\d+\.\s+/gm, '')     // Remove numbered lists
      .replace(/!\[.*?\]\(.*?\)/g, '')   // Remove images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
      .replace(/\[\[([^\]]+)\]\]/g, '$1')      // Convert wiki links to text
      .replace(/`{1,3}[^`]*`{1,3}/g, '')       // Remove code
      .replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, '$1') // Remove bold/italic
      .replace(/\n+/g, ' ')              // Replace newlines with spaces
      .trim();

    if (cleanText.length > 0) {
      // Return first 20 characters
      if (cleanText.length > 20) {
        return cleanText.substring(0, 20) + '...';
      }
      return cleanText;
    }

    return undefined;
  }

  private static finalizeCurrentTask(task: KanbanTask | null, column: KanbanColumn | null, existingBoard?: KanbanBoard, columnIndex?: number): void {
    if (!task || !column) {return;}

    // Clean up description - only remove if completely empty, preserve whitespace otherwise
    if (task.description !== undefined) {
      if (task.description.trim() === '') {
        delete task.description;
      }
      // DO NOT trim whitespace - preserve user's formatting including trailing newlines
    }

    // Generate alternative title if no title exists
    // This provides a meaningful preview when task is folded
    const hasNoTitle = !task.title || task.title.trim() === '';
    if (hasNoTitle && task.description) {
      task.alternativeTitle = this.generateAlternativeTitle(task.description);
    }

    // CRITICAL: Match by POSITION to preserve ID (Backend is source of truth)
    // Content matching alone is WRONG - empty tasks would all share the same ID!
    let existingCol: KanbanColumn | undefined;
    if (existingBoard && columnIndex !== undefined && columnIndex >= 0 && columnIndex < existingBoard.columns.length) {
      existingCol = existingBoard.columns[columnIndex];
    }

    if (existingCol) {
      // CRITICAL FIX: Match by POSITION in array, not content
      // Position determines identity - content can be duplicated (e.g., multiple empty tasks)
      const taskPosition = column.tasks.length; // Current position being added
      const existingTask = existingCol.tasks[taskPosition];

      if (existingTask) {
        // Position matches - preserve the existing ID
        task.id = existingTask.id;
      }
      // else: New task at this position - keep the generated UUID
    }

    column.tasks.push(task);
  }

  static generateMarkdown(board: KanbanBoard): string {
    let markdown = '';

    // Add YAML front matter if it exists
    if (board.yamlHeader) {
      markdown += board.yamlHeader + '\n\n';
    }

    // Add board title if it exists
    // if (board.title) {
    //   markdown += `# ${board.title}\n\n`;
    // }

    // Sort columns by row before saving to ensure correct order in file
    // This maintains row 1 columns before row 2 columns in the saved markdown
    const sortedColumns = sortColumnsByRow(board.columns);

    // Add columns (no ID persistence - runtime only)
    for (const column of sortedColumns) {
      if (column.includeMode) {
        // For include columns, use the current title (which may have been updated with tags)
        // column.title should contain the include syntax plus any added tags
        const titleToUse = column.title;
        markdown += `## ${titleToUse}\n`;
        // Skip generating tasks for include columns - they remain as includes
      } else {
        // Regular column processing
        markdown += `## ${column.title}\n`;

        for (const task of column.tasks) {
          // For taskinclude tasks, use the original title with include syntax
          const titleToSave = task.includeMode && task.originalTitle ? task.originalTitle : task.title;
          markdown += `- [ ] ${titleToSave}\n`;

          // For taskinclude tasks, don't save the description (it comes from the file)
          if (!task.includeMode) {
            // Add description with proper indentation
            const descriptionToUse = task.description;
            if (descriptionToUse && descriptionToUse.trim() !== '') {
              const descriptionLines = descriptionToUse.split('\n');
              // Filter out the last element if it's empty (happens when description ends with \n)
              // This prevents adding extra blank lines
              const linesToWrite = descriptionLines[descriptionLines.length - 1] === ''
                ? descriptionLines.slice(0, -1)
                : descriptionLines;

              for (const descLine of linesToWrite) {
                markdown += `  ${descLine}\n`;
              }
            }
          }
        }
      }

      markdown += '\n';
    }

    // Add Kanban footer if it exists
    if (board.kanbanFooter) {
      if (markdown.endsWith('\n\n')) {
        markdown = markdown.slice(0, -1);
      }
      markdown += board.kanbanFooter;
      if (!board.kanbanFooter.endsWith('\n')) {
        markdown += '\n';
      }
    } else {
      markdown += '\n';
    }

    return markdown;
  }
}