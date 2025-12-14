/**
 * KanbanTypes - Core data structure interfaces for Kanban boards
 *
 * Extracted from markdownParser.ts to break circular dependencies
 * with plugins that need to reference these types.
 *
 * @module board/KanbanTypes
 */

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  includeMode?: boolean;  // When true, content is generated from included files
  includeFiles?: string[]; // Paths to included files (for task includes - includeMode=true)
  regularIncludeFiles?: string[]; // Paths to regular includes (!!!include()!!! in description)
  originalTitle?: string;  // Original title before include processing
  displayTitle?: string;   // Cleaned title for display (without include syntax)
  isLoadingContent?: boolean;  // When true, frontend shows loading indicator while include content loads
  includeContext?: {  // Context for dynamic image path resolution in include files
    includeFilePath: string;  // Absolute path to the include file
    includeDir: string;       // Directory of the include file
    mainFilePath: string;     // Absolute path to the main kanban file
    mainDir: string;          // Directory of the main kanban file
  };
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
  frontmatter?: Record<string, string>;
}
