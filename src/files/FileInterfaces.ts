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

import { KanbanBoard } from '../board/KanbanTypes';

/**
 * Represents a captured edit from the UI (task title, description, column title)
 * Used when the user is editing and we need to preserve their changes
 */
export interface CapturedEdit {
    type: 'task-title' | 'task-description' | 'column-title';
    value: string;
    taskId?: string;
    columnId?: string;
}

/**
 * Interface for MessageHandler
 * Used by MarkdownFileRegistry to avoid direct import of MessageHandler
 */
export interface IMessageHandler {
    requestStopEditing(): Promise<CapturedEdit | undefined>;
}

/**
 * Interface for MarkdownFileRegistry
 * Used by MainKanbanFile to avoid direct import of MarkdownFileRegistry
 */
export interface IMarkdownFileRegistry {
    getIncludeFiles(): IIncludeFile[];
    requestStopEditing(): Promise<CapturedEdit | undefined>;
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
    getCachedBoardFromWebview?(): KanbanBoard | undefined;
}

/**
 * Include file type union
 * Matches the type in IncludeFile.ts
 */
export type IncludeFileType = 'include-regular' | 'include-column' | 'include-task';

/**
 * Interface for IncludeFile
 * Used by MarkdownFileRegistry typing
 *
 * Only includes methods actually needed for the interface contract
 */
export interface IIncludeFile {
    getParentFile(): IMainKanbanFile;
    getFileType(): IncludeFileType;
    getPath(): string;
    hasUnsavedChanges(): boolean;
}

/**
 * Interface for FileFactory
 * Used by MarkdownFileRegistry to avoid direct import of FileFactory
 */
export interface IFileFactory {
    createIncludeDirect(
        relativePath: string,
        parentFile: IMainKanbanFile,
        fileType: IncludeFileType
    ): IIncludeFile;
}
