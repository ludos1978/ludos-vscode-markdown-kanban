/**
 * FileInterfaces - Interface definitions to break circular dependencies
 *
 * These interfaces define the minimal contract needed for cross-file
 * dependencies without requiring direct class imports.
 *
 * This file should have NO imports from other files in the files/ folder
 * to ensure it can be imported without creating cycles.
 *
 * @module files/FileInterfaces
 */

/**
 * Interface for MarkdownFileRegistry
 * Used by MainKanbanFile to avoid direct import of MarkdownFileRegistry
 */
export interface IMarkdownFileRegistry {
    getIncludeFiles(): IIncludeFile[];
    requestStopEditing(): Promise<any>;
}

/**
 * Interface for MainKanbanFile
 * Used by IncludeFile to avoid direct import of MainKanbanFile
 *
 * Only includes methods actually used by IncludeFile
 */
export interface IMainKanbanFile {
    checkForExternalChanges(): Promise<boolean>;
    hasUnsavedChanges(): boolean;
    getPath(): string;
    getFileType(): 'main';
    getFileRegistry(): IMarkdownFileRegistry | undefined;
}

/**
 * Interface for IncludeFile
 * Used by MarkdownFileRegistry typing
 *
 * Only includes methods actually needed for the interface contract
 */
export interface IIncludeFile {
    getParentFile(): IMainKanbanFile;
    getFileType(): 'include-column' | 'include-task' | 'include-regular';
    getPath(): string;
    hasUnsavedChanges(): boolean;
}
