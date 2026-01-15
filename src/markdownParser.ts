import { IdGenerator } from './utils/idGenerator';
import { PresentationParser } from './services/export/PresentationParser';
import { PathResolver } from './services/PathResolver';
import { sortColumnsByRow } from './utils/columnUtils';
import { MarkdownFile } from './files/MarkdownFile'; // FOUNDATION-1: For path comparison
import { createDisplayTitleWithPlaceholders } from './constants/IncludeConstants';
import { PluginRegistry, IncludeContextLocation } from './plugins';
import * as fs from 'fs';
import * as path from 'path';

// Re-export types from KanbanTypes
export { KanbanTask, KanbanColumn, KanbanBoard } from './board/KanbanTypes';

// Import types for internal use
import { KanbanTask, KanbanColumn, KanbanBoard } from './board/KanbanTypes';

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
  private static findExistingColumn(existingBoard: KanbanBoard | undefined, _title: string, columnIndex?: number, _newTasks?: KanbanTask[]): KanbanColumn | undefined {
    if (!existingBoard) return undefined;

    // ONLY match by position - title/content matching is FORBIDDEN
    if (columnIndex !== undefined && columnIndex >= 0 && columnIndex < existingBoard.columns.length) {
      return existingBoard.columns[columnIndex];
    }

    // No position provided or out of bounds - this is a NEW column
    return undefined;
  }

  // ============= PLUGIN-BASED INCLUDE DETECTION =============

  /**
   * Detect includes in content using plugin system
   *
   * Uses PluginRegistry.detectIncludes() exclusively.
   * Plugins MUST be loaded via PluginLoader.loadBuiltinPlugins() at extension activation.
   *
   * @param content - Content to search for includes
   * @param contextLocation - Where the content comes from (column-header, task-title, description)
   * @returns Array of detected include file paths
   * @throws Error if plugin system is not available
   */
  private static detectIncludes(content: string, contextLocation: IncludeContextLocation): string[] {
    const registry = PluginRegistry.getInstance();
    const matches = registry.detectIncludes(content, { location: contextLocation });
    return matches.map(m => m.filePath);
  }

  // Include match detection handled directly via PluginRegistry.detectIncludes()

  static parseMarkdown(content: string, basePath?: string, existingBoard?: KanbanBoard, mainFilePath?: string): { board: KanbanBoard, includedFiles: string[], columnIncludeFiles: string[], taskIncludeFiles: string[] } {
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
          // Uses plugin system exclusively (no fallback)
          const includeFilePaths = this.detectIncludes(columnTitle, 'column-header');

          if (includeFilePaths.length > 0) {
            // This is a column include - process included files as Marp presentations
            const includeFiles: string[] = [];
            includeFilePaths.forEach(filePath => {
              includeFiles.push(filePath);
              // Track for file watching (FOUNDATION-1: Use normalized comparison)
              if (!columnIncludeFiles.some(p => MarkdownFile.isSameFile(p, filePath))) {
                columnIncludeFiles.push(filePath);
              }
            });

            // Generate tasks from included files
            const includeTasks: KanbanTask[] = [];
            let hasIncludeError = false;
            for (const filePath of includeFiles) {
              const resolvedPath = basePath ? PathResolver.resolve(basePath, filePath) : filePath;
              try {
                if (fs.existsSync(resolvedPath)) {
                  const fileContent = fs.readFileSync(resolvedPath, 'utf8');
                  const slideTasks = PresentationParser.parseMarkdownToTasks(fileContent, resolvedPath, mainFilePath);
                  includeTasks.push(...slideTasks);
                } else {
                  console.warn(`[Parser] Column include file not found: ${resolvedPath}`);
                  hasIncludeError = true;
                }
              } catch (error) {
                console.error(`[Parser] Error processing column include ${filePath}:`, error);
                hasIncludeError = true;
              }
            }

            // Replace !!!include()!!! with placeholder for frontend badge rendering
            // This preserves the position of the include in the title
            // SINGLE SOURCE OF TRUTH: Use shared utility function
            let displayTitle = createDisplayTitleWithPlaceholders(columnTitle, includeFiles);

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
              includeError: hasIncludeError, // Set error flag if file not found
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
          if (trimmedLine === '' && !line.startsWith('  ')) {
            // Skip blank separator lines before a new task/column/footer/YAML or end of file
            let nextIndex = i + 1;
            while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
              nextIndex++;
            }
            const nextLine = nextIndex < lines.length ? lines[nextIndex] : null;
            const isStructuralBoundary = nextLine === null
              || nextLine.startsWith('## ')
              || nextLine.startsWith('- ')
              || nextLine.startsWith('%%')
              || nextLine.startsWith('---');
            if (isStructuralBoundary) {
              continue;
            }
          }
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

      // Parse Marp global settings from YAML frontmatter
      board.frontmatter = this.parseMarpFrontmatter(board.yamlHeader || '');

      return { board, includedFiles, columnIncludeFiles, taskIncludeFiles };
  }

  /**
   * Parse Marp global settings from YAML frontmatter
   */
  private static parseMarpFrontmatter(yamlHeader: string): Record<string, string> {
    const frontmatter: Record<string, string> = {};

    if (!yamlHeader) {
      return frontmatter;
    }

    const lines = yamlHeader.split('\n');
    const marpKeys = ['theme', 'style', 'headingDivider', 'size', 'math', 'title', 'author',
                      'description', 'keywords', 'url', 'image', 'marp', 'paginate',
                      'header', 'footer', 'class', 'backgroundColor', 'backgroundImage',
                      'backgroundPosition', 'backgroundRepeat', 'backgroundSize', 'color'];

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (match) {
        const key = match[1];
        const value = match[2].trim();
        if (marpKeys.includes(key)) {
          frontmatter[key] = value;
        }
      }
    }

    return frontmatter;
  }

  private static processTaskIncludes(board: KanbanBoard, basePath?: string, taskIncludeFiles?: string[]): void {
    for (const column of board.columns) {
      for (const task of column.tasks) {
        // Check if task title contains include syntax (location-based: task includes)
        // Uses plugin system exclusively (no fallback)
        const taskIncludeFilePaths = this.detectIncludes(task.title, 'task-title');

        if (taskIncludeFilePaths.length > 0) {
          // This is a task include - process included file (first line as title, rest as description)
          const includeFiles: string[] = [];
          taskIncludeFilePaths.forEach(filePath => {
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
                // Read COMPLETE file content WITHOUT modification
                // Image paths will be rewritten at render time by markdown-it plugin
                fullFileContent = fs.readFileSync(resolvedPath, 'utf8');
              } else {
                console.warn(`[Parser] Task include file not found: ${resolvedPath}`);
                // Error details shown on hover via include badge
                fullFileContent = '';
                task.includeError = true;
              }
            } catch (error) {
              console.error(`[Parser] Error processing task include ${filePath}:`, error);
              // Error details shown on hover via include badge
              fullFileContent = '';
              task.includeError = true;
            }
          }

          // Create placeholder for frontend badge rendering
          // SINGLE SOURCE OF TRUTH: Use shared utility function
          let displayTitle = createDisplayTitleWithPlaceholders(task.title, includeFiles);

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
    // Uses plugin system exclusively (no fallback)

    for (const column of board.columns) {
      for (const task of column.tasks) {
        // Skip tasks with includeMode - they are task includes, not regular includes
        if (task.includeMode) {
          continue;
        }

        if (task.description) {
          // Track which regular includes this task uses
          // Use plugin-based detection exclusively
          const detectedFiles = this.detectIncludes(task.description, 'description');
          const taskIncludes: string[] = [];

          for (const includeFile of detectedFiles) {
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

  private static finalizeCurrentTask(task: KanbanTask | null, column: KanbanColumn | null, existingBoard?: KanbanBoard, columnIndex?: number): void {
    if (!task || !column) {return;}

    // CRITICAL: NEVER delete or trim description - whitespace IS valid content
    // Description is always a string (empty string if not set)
    if (task.description === undefined) {
      task.description = '';
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
            // CRITICAL: Always write description - whitespace IS valid content
            const descriptionToUse = task.description ?? '';
            if (descriptionToUse) {
              const descriptionLines = descriptionToUse.split('\n');
              for (const descLine of descriptionLines) {
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
