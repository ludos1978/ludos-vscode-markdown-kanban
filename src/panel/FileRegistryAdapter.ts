/**
 * FileRegistryAdapter - Simplified interface to MarkdownFileRegistry
 *
 * Provides convenient query methods and status aggregation for the panel.
 * Encapsulates all file registry operations in one place.
 *
 * @module panel/FileRegistryAdapter
 */

import { MarkdownFileRegistry, MarkdownFile, MainKanbanFile, IncludeFile, FileFactory } from '../files';

/**
 * File attention status
 */
export interface FileAttentionStatus {
    conflicts: MarkdownFile[];
    unsaved: MarkdownFile[];
    needReload: MarkdownFile[];
}

/**
 * Include files unsaved status
 */
export interface IncludeUnsavedStatus {
    hasChanges: boolean;
    changedFiles: string[];
}

/**
 * Unified unsaved changes state
 */
export interface UnsavedChangesState {
    hasUnsavedChanges: boolean;
    details: string;
}

/**
 * FileRegistryAdapter - Query interface for file registry
 *
 * Consolidates 15+ query methods from KanbanWebviewPanel into a single adapter.
 */
export class FileRegistryAdapter {
    constructor(
        private _registry: MarkdownFileRegistry,
        private _factory: FileFactory
    ) {}

    // ============= MAIN FILE OPERATIONS =============

    /**
     * Get the main kanban file instance
     */
    getMainFile(): MainKanbanFile | undefined {
        return this._registry.getMainFile();
    }

    /**
     * Check if registry has a main file
     */
    isReady(): boolean {
        return this._registry.getMainFile() !== undefined;
    }

    /**
     * Get main file content
     */
    getMainFileContent(): string | undefined {
        return this.getMainFile()?.getContent();
    }

    // ============= INCLUDE FILE OPERATIONS =============

    /**
     * Get an include file by relative path
     */
    getIncludeFile(relativePath: string): IncludeFile | undefined {
        const file = this._registry.getByRelativePath(relativePath);
        if (file && file.getFileType() !== 'main') {
            return file as IncludeFile;
        }
        return undefined;
    }

    /**
     * Get all column include files
     */
    getColumnIncludeFiles(): IncludeFile[] {
        return this._registry.getColumnIncludeFiles();
    }

    /**
     * Get all task include files
     */
    getTaskIncludeFiles(): IncludeFile[] {
        return this._registry.getTaskIncludeFiles();
    }

    /**
     * Get all include files (any type)
     */
    getAllIncludeFiles(): IncludeFile[] {
        return this._registry.getIncludeFiles();
    }

    /**
     * Check if include file exists in registry
     */
    hasIncludeFile(relativePath: string): boolean {
        return this._registry.hasByRelativePath(relativePath);
    }

    /**
     * Ensure an include file is registered
     */
    ensureIncludeFile(relativePath: string, type: 'regular' | 'column' | 'task'): void {
        this._registry.ensureIncludeFileRegistered(relativePath, type, this._factory);
    }

    // ============= FILE CONTENT OPERATIONS =============

    /**
     * Get file content by relative path
     * Use '.' for main file
     */
    getFileContent(relativePath: string): string | undefined {
        const file = relativePath === '.'
            ? this.getMainFile()
            : this.getIncludeFile(relativePath);

        return file?.getContent();
    }

    // ============= FILE STATUS CHECKS =============

    /**
     * Check if file has unsaved changes
     */
    fileHasUnsavedChanges(relativePath: string): boolean {
        const file = relativePath === '.'
            ? this.getMainFile()
            : this.getIncludeFile(relativePath);

        return file?.hasUnsavedChanges() || false;
    }

    /**
     * Check if file has conflicts
     */
    fileHasConflict(relativePath: string): boolean {
        const file = relativePath === '.'
            ? this.getMainFile()
            : this.getIncludeFile(relativePath);

        return file?.hasConflict() || false;
    }

    /**
     * Check if file needs reload
     */
    fileNeedsReload(relativePath: string): boolean {
        const file = relativePath === '.'
            ? this.getMainFile()
            : this.getIncludeFile(relativePath);

        return file?.needsReload() || false;
    }

    /**
     * Check if file needs save
     */
    fileNeedsSave(relativePath: string): boolean {
        const file = relativePath === '.'
            ? this.getMainFile()
            : this.getIncludeFile(relativePath);

        return file?.needsSave() || false;
    }

    // ============= AGGREGATE STATUS =============

    /**
     * Get all files with conflicts
     */
    getFilesWithConflicts(): MarkdownFile[] {
        return this._registry.getFilesWithConflicts();
    }

    /**
     * Get all files with unsaved changes
     */
    getFilesWithUnsavedChanges(): MarkdownFile[] {
        return this._registry.getFilesWithUnsavedChanges();
    }

    /**
     * Get all files that need reload
     */
    getFilesThatNeedReload(): MarkdownFile[] {
        return this._registry.getFilesThatNeedReload();
    }

    /**
     * Get files that need attention (conflicts, unsaved, need reload)
     */
    getFilesThatNeedAttention(): FileAttentionStatus {
        return {
            conflicts: this.getFilesWithConflicts(),
            unsaved: this.getFilesWithUnsavedChanges(),
            needReload: this.getFilesThatNeedReload()
        };
    }

    /**
     * Get include files unsaved status
     */
    getIncludeFilesUnsavedStatus(): IncludeUnsavedStatus {
        const includeFiles = this._registry.getAll().filter(f => f.getFileType() !== 'main');
        const changedFiles = includeFiles
            .filter(f => f.hasUnsavedChanges())
            .map(f => f.getRelativePath());

        return {
            hasChanges: changedFiles.length > 0,
            changedFiles
        };
    }

    /**
     * Get unified unsaved changes state
     */
    getUnifiedUnsavedChangesState(): UnsavedChangesState {
        const filesWithChanges = this.getFilesWithUnsavedChanges();

        if (filesWithChanges.length === 0) {
            return { hasUnsavedChanges: false, details: 'No unsaved changes' };
        }

        const details = filesWithChanges.map(f => f.getRelativePath()).join(', ');
        return {
            hasUnsavedChanges: true,
            details: `Unsaved changes in: ${details}`
        };
    }

    /**
     * Check if any file has unsaved changes (main or includes)
     */
    hasAnyUnsavedChanges(): boolean {
        const mainFile = this.getMainFile();
        const mainHasChanges = mainFile?.hasUnsavedChanges() || false;
        const includeStatus = this.getIncludeFilesUnsavedStatus();

        return mainHasChanges || includeStatus.hasChanges;
    }

    // ============= REGISTRY PASS-THROUGH =============

    /**
     * Get all files in registry
     */
    getAll(): MarkdownFile[] {
        return this._registry.getAll();
    }

    /**
     * Get file by relative path
     */
    getByRelativePath(relativePath: string): MarkdownFile | undefined {
        return this._registry.getByRelativePath(relativePath);
    }

    /**
     * Register a file
     */
    register(file: MarkdownFile): void {
        this._registry.register(file);
    }

    /**
     * Unregister a file by path
     */
    unregister(path: string): void {
        this._registry.unregister(path);
    }

    /**
     * Clear all files from registry
     */
    clear(): void {
        this._registry.clear();
    }

    /**
     * Log registry statistics
     */
    logStatistics(): void {
        this._registry.logStatistics();
    }

    // ============= DIRECT REGISTRY ACCESS =============

    /**
     * Get the underlying registry (for advanced operations)
     */
    getRegistry(): MarkdownFileRegistry {
        return this._registry;
    }

    /**
     * Get the file factory
     */
    getFactory(): FileFactory {
        return this._factory;
    }
}
