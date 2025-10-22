/**
 * File Abstraction Module
 *
 * This module provides an object-oriented abstraction layer for all markdown files
 * in the kanban system, replacing the interface-based FileState approach.
 *
 * Key Classes:
 * - MarkdownFile: Abstract base class with state, operations, and change detection
 * - MainKanbanFile: The main kanban.md file
 * - IncludeFile: Abstract base for all include files
 *   - ColumnIncludeFile: Column includes (presentation format)
 *   - TaskIncludeFile: Task includes (markdown description)
 *   - RegularIncludeFile: Regular includes (kanban format)
 * - MarkdownFileRegistry: Central registry for file management
 * - FileFactory: Factory for creating file instances
 *
 * Benefits:
 * - Type-safe file operations (instanceof checks instead of string types)
 * - Polymorphic behavior (file.handleExternalChange() works for all types)
 * - Encapsulation (state and behavior together)
 * - Integrated change detection (built-in file watchers)
 * - Event system (subscribe to file changes)
 * - Easy extension (add new file types by subclassing)
 */

// Base classes
export { MarkdownFile, FileChangeEvent } from './MarkdownFile';
export { MainKanbanFile } from './MainKanbanFile';
export { IncludeFile } from './IncludeFile';

// Concrete include types
export { ColumnIncludeFile } from './ColumnIncludeFile';
export { TaskIncludeFile } from './TaskIncludeFile';
export { RegularIncludeFile } from './RegularIncludeFile';

// Registry and factory
export { MarkdownFileRegistry } from './MarkdownFileRegistry';
export { FileFactory } from './FileFactory';
