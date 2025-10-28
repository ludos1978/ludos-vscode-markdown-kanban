import { IdGenerator } from './utils/idGenerator';
import { PresentationParser } from './presentationParser';
import { PathResolver } from './services/PathResolver';
import { sortColumnsByRow } from './utils/columnUtils';
import * as fs from 'fs';
import * as path from 'path';

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  includeMode?: boolean;  // When true, content is generated from included files
  includeFiles?: string[]; // Paths to included files
  originalTitle?: string;  // Original title before include processing
  displayTitle?: string;   // Cleaned title for display (without include syntax)
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
  private static findExistingColumn(existingBoard: KanbanBoard | undefined, title: string, columnIndex?: number, newTasks?: KanbanTask[]): KanbanColumn | undefined {
    if (!existingBoard) return undefined;

    // Try to match by position first
    if (columnIndex !== undefined && columnIndex >= 0 && columnIndex < existingBoard.columns.length) {
      const candidateColumn = existingBoard.columns[columnIndex];

      // CRITICAL VERIFICATION: For columns, verify task composition hasn't changed
      // If we're checking a column with tasks, verify all task IDs are present
      if (newTasks && newTasks.length > 0) {
        const newTaskIds = new Set(newTasks.map(t => t.id));
        const oldTaskIds = new Set(candidateColumn.tasks.map(t => t.id));

        // If task IDs match, it's the same column (even if title changed)
        const sameTaskIds =
          newTaskIds.size === oldTaskIds.size &&
          [...newTaskIds].every(id => oldTaskIds.has(id));

        if (sameTaskIds) {
          return candidateColumn;
        }
        // Task composition changed - this is a DIFFERENT column, don't preserve ID
        return undefined;
      }

      // For columns without tasks or include columns, match by title
      if (candidateColumn.title === title) {
        return candidateColumn;
      }

      return undefined;
    }

    // Fallback: match by title
    return existingBoard.columns.find(col => col.title === title);
  }

  /**
   * Find existing task by CONTENT (title + description)
   * Backend markdown is source of truth - match by complete content, not position
   * Position can change when tasks are reordered, but content is the identifier
   */
  private static findExistingTask(existingColumn: KanbanColumn | undefined, title: string, description?: string): KanbanTask | undefined {
    if (!existingColumn) return undefined;

    // CRITICAL: Match by CONTENT (title + description), not position
    // If both title AND description match exactly, it's the same task
    return existingColumn.tasks.find(task =>
      task.title === title &&
      task.description === (description || '')
    );
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
          const columnIncludeMatches = columnTitle.match(/!!!include\(([^)]+)\)!!!/g);

          if (columnIncludeMatches && columnIncludeMatches.length > 0) {
            // This is a column include - process included files as Marp presentations
            const includeFiles: string[] = [];
            columnIncludeMatches.forEach(match => {
              const filePath = match.replace(/!!!include\(([^)]+)\)!!!/, '$1').trim();
              includeFiles.push(filePath);
              // Track for file watching
              if (!columnIncludeFiles.includes(filePath)) {
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

            // Clean title from include syntax for display
            let displayTitle = columnTitle;
            columnIncludeMatches.forEach(match => {
              displayTitle = displayTitle.replace(match, '').trim();
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
        const taskIncludeMatches = task.title.match(/!!!include\(([^)]+)\)!!!/g);

        if (taskIncludeMatches && taskIncludeMatches.length > 0) {
          // This is a task include - process included file (first line as title, rest as description)
          const includeFiles: string[] = [];
          taskIncludeMatches.forEach(match => {
            const filePath = match.replace(/!!!include\(([^)]+)\)!!!/, '$1').trim();
            includeFiles.push(filePath);
            // Track for file watching
            if (taskIncludeFiles && !taskIncludeFiles.includes(filePath)) {
              taskIncludeFiles.push(filePath);
            }
          });

          // STRATEGY 1: Load full content without parsing
          // Read complete file content without parsing into title/description
          let fullFileContent = '';

          for (const filePath of includeFiles) {
            const resolvedPath = basePath ? PathResolver.resolve(basePath, filePath) : filePath;
            try {
              if (fs.existsSync(resolvedPath)) {
                // Read COMPLETE file content (NO PARSING!)
                fullFileContent = fs.readFileSync(resolvedPath, 'utf8');
                console.log(`[Parser] Loaded ${fullFileContent.length} chars from ${filePath} (no parsing)`);
              } else {
                console.warn(`[Parser] Task include file not found: ${resolvedPath}`);
              }
            } catch (error) {
              console.error(`[Parser] Error processing task include ${filePath}:`, error);
            }
          }

          // Generate displayTitle for UI (visual indicator only, not part of file content)
          const displayTitle = includeFiles.length > 0
            ? `# include in ${includeFiles[0]}`
            : '# include';

          // Update task properties for include mode
          task.includeMode = true;
          // FIX BUG #A: Normalize paths before storing to ensure consistent registry lookups
          // All includeFiles paths MUST be normalized (lowercase, forward slashes) for consistent registry lookups
          task.includeFiles = includeFiles.map(f => f.trim().toLowerCase().replace(/\\/g, '/'));
          task.originalTitle = task.title; // Keep original title with include syntax
          task.displayTitle = displayTitle; // UI header only
          task.description = fullFileContent; // COMPLETE file content, no parsing!
        }
      }
    }
  }

  private static detectRegularIncludes(board: KanbanBoard, includedFiles: string[]): void {
    // Scan all task descriptions for !!!include()!!! patterns (regular includes)
    const includeRegex = /!!!include\(([^)]+)\)!!!/gi;

    for (const column of board.columns) {
      for (const task of column.tasks) {
        // Skip tasks with includeMode - they are task includes, not regular includes
        if (task.includeMode) {
          continue;
        }

        if (task.description) {
          let match;
          // Reset regex state
          includeRegex.lastIndex = 0;
          while ((match = includeRegex.exec(task.description)) !== null) {
            const includeFile = match[1].trim();
            if (!includedFiles.includes(includeFile)) {
              includedFiles.push(includeFile);
            }
          }
        }
      }
    }
  }

  private static finalizeCurrentTask(task: KanbanTask | null, column: KanbanColumn | null, existingBoard?: KanbanBoard, columnIndex?: number): void {
    if (!task || !column) {return;}

    // Clean up description
    if (task.description) {
      task.description = task.description.trimEnd();
      if (task.description === '') {
        delete task.description;
      }
    }

    // CRITICAL: Match by content to preserve ID (Backend is source of truth)
    // Find existing column by POSITION (title may have changed with include switch!)
    let existingCol: KanbanColumn | undefined;
    if (existingBoard && columnIndex !== undefined && columnIndex >= 0 && columnIndex < existingBoard.columns.length) {
      existingCol = existingBoard.columns[columnIndex];
    }

    if (existingCol) {
      // Try to find matching task by complete content (title + description)
      const existingTask = this.findExistingTask(existingCol, task.title, task.description);
      if (existingTask) {
        // Content matches - preserve the existing ID
        task.id = existingTask.id;
        console.log(`[Parser] Task content matched - preserving ID ${existingTask.id} for "${task.title.substring(0, 30)}..."`);
      }
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
      console.log(`[generateMarkdown] Column "${column.title}" includeMode=${column.includeMode}, includeFiles=${column.includeFiles?.join(',')}, tasks=${column.tasks.length}`);

      if (column.includeMode) {
        // For include columns, use the current title (which may have been updated with tags)
        // column.title should contain the include syntax plus any added tags
        const titleToUse = column.title;
        markdown += `## ${titleToUse}\n`;
        console.log(`[generateMarkdown] Skipping ${column.tasks.length} tasks for includeMode column`);
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