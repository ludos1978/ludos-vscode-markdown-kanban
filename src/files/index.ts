/**
 * File Abstraction Module
 *
 * This module provides an object-oriented abstraction layer for all markdown files
 * in the kanban system, replacing the interface-based FileState approach.
 *
 * Key Classes:
 * - MarkdownFile: Abstract base class with state, operations, and change detection
 * - MainKanbanFile: The main kanban.md file
 * - IncludeFile: Unified class for all include file types
 *   - fileType='include-column': Column includes (presentation format)
 *   - fileType='include-task': Task includes (markdown description)
 *   - fileType='include-regular': Regular includes (inline markdown)
 * - MarkdownFileRegistry: Central registry for file management
 * - FileFactory: Factory for creating file instances (uses plugin system)
 *
 * Benefits:
 * - Type-safe file operations (instanceof checks)
 * - Polymorphic behavior (file.handleExternalChange() works for all types)
 * - Encapsulation (state and behavior together)
 * - Integrated change detection (built-in file watchers)
 * - Event system (subscribe to file changes)
 * - Plugin-based creation (FileFactory uses PluginRegistry)
 */

// Base classes
export { MarkdownFile, FileChangeEvent } from './MarkdownFile';
export { MainKanbanFile } from './MainKanbanFile';
export { IncludeFile, IncludeFileType } from './IncludeFile';

// Registry and factory
export { MarkdownFileRegistry } from './MarkdownFileRegistry';
export { FileFactory } from './FileFactory';

// FileState interface for compatibility with legacy code
export { FileState } from './FileState';
