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
}

export interface KanbanColumn {
  id: string;
  title: string;
  tasks: KanbanTask[];
  includeMode?: boolean;  // When true, tasks are generated from included files
  includeFiles?: string[]; // Paths to included presentation files
  originalTitle?: string;  // Original title before include processing
  displayTitle?: string;   // Cleaned title for display (without include syntax)
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
   * Find existing column by title to preserve ID
   */
  private static findExistingColumn(existingBoard: KanbanBoard | undefined, title: string): KanbanColumn | undefined {
    if (!existingBoard) return undefined;
    return existingBoard.columns.find(col => col.title === title);
  }

  /**
   * Find existing task by title in a column to preserve ID
   */
  private static findExistingTask(existingColumn: KanbanColumn | undefined, title: string): KanbanTask | undefined {
    if (!existingColumn) return undefined;
    return existingColumn.tasks.find(task => task.title === title);
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
            this.finalizeCurrentTask(currentTask, currentColumn);
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
            this.finalizeCurrentTask(currentTask, currentColumn);
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

            // Preserve existing column ID if found
            const existingCol = this.findExistingColumn(existingBoard, columnTitle);
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
            // Regular column - preserve existing ID if found
            const existingCol = this.findExistingColumn(existingBoard, columnTitle);
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
            this.finalizeCurrentTask(currentTask, currentColumn);
            collectingDescription = false;
          }

          if (currentColumn && !currentColumn.includeMode) {
            // Only parse tasks for non-include columns
            const taskTitle = line.substring(6);

            // Preserve existing task ID if found
            const existingCol = this.findExistingColumn(existingBoard, currentColumn.title);
            const existingTask = this.findExistingTask(existingCol, taskTitle);

            currentTask = {
              id: existingTask?.id || IdGenerator.generateTaskId(),
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
        this.finalizeCurrentTask(currentTask, currentColumn);
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

          // Read content from included files
          let includeTitle = '';
          let includeDescription = '';

          for (const filePath of includeFiles) {
            const resolvedPath = basePath ? PathResolver.resolve(basePath, filePath) : filePath;
            try {
              if (fs.existsSync(resolvedPath)) {
                const fileContent = fs.readFileSync(resolvedPath, 'utf8');
                const lines = fileContent.split('\n');

                // Find first non-empty line for title
                let titleFound = false;
                let descriptionLines: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i].trim();
                  if (!titleFound && line) {
                    includeTitle = lines[i]; // Use original line with indentation
                    titleFound = true;
                  } else if (titleFound && line) {
                    // Skip blank lines immediately after title (writer adds \n\n separator)
                    descriptionLines.push(lines[i]);
                  } else if (titleFound && descriptionLines.length > 0) {
                    // Once we have content, preserve blank lines (including trailing)
                    descriptionLines.push(lines[i]);
                  }
                }

                // Join remaining lines as description - preserve trailing whitespace for symmetric read/write
                includeDescription = descriptionLines.join('\n');

              } else {
                console.warn(`[Parser] Task include file not found: ${resolvedPath}`);
              }
            } catch (error) {
              console.error(`[Parser] Error processing task include ${filePath}:`, error);
            }
          }

          // If no title found in file, use filename
          if (!includeTitle && includeFiles.length > 0) {
            includeTitle = path.basename(includeFiles[0], path.extname(includeFiles[0]));
          }

          // Update task properties for include mode
          task.includeMode = true;
          task.includeFiles = includeFiles;
          task.originalTitle = task.title; // Keep original title with include syntax
          task.displayTitle = includeTitle || 'Untitled'; // Display title from file
          task.description = includeDescription; // Description from file
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

  private static finalizeCurrentTask(task: KanbanTask | null, column: KanbanColumn | null): void {
    if (!task || !column) {return;}

    // Clean up description
    if (task.description) {
      task.description = task.description.trimEnd();
      if (task.description === '') {
        delete task.description;
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