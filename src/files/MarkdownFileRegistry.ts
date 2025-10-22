import * as vscode from 'vscode';
import { MarkdownFile, FileChangeEvent } from './MarkdownFile';
import { MainKanbanFile } from './MainKanbanFile';
import { IncludeFile } from './IncludeFile';
import { ColumnIncludeFile } from './ColumnIncludeFile';
import { TaskIncludeFile } from './TaskIncludeFile';
import { RegularIncludeFile } from './RegularIncludeFile';

/**
 * Central registry for all markdown files (main and includes).
 *
 * Provides type-safe access to files, query operations, and bulk operations.
 * Manages file lifecycle and change event subscriptions.
 *
 * This registry is per-panel (not a singleton) to support multiple kanban panels.
 */
export class MarkdownFileRegistry implements vscode.Disposable {
    // ============= FILE STORAGE =============
    private _files: Map<string, MarkdownFile> = new Map();        // Path -> File
    private _filesByRelativePath: Map<string, MarkdownFile> = new Map(); // Relative path -> File

    // ============= CHANGE EVENTS =============
    private _onDidChange = new vscode.EventEmitter<FileChangeEvent>();
    public readonly onDidChange = this._onDidChange.event;

    // ============= LIFECYCLE =============
    private _disposables: vscode.Disposable[] = [];

    constructor() {
        this._disposables.push(this._onDidChange);
    }

    // ============= REGISTRATION =============

    /**
     * Register a file in the registry
     */
    public register(file: MarkdownFile): void {
        const path = file.getPath();
        const relativePath = file.getRelativePath();

        console.log(`[MarkdownFileRegistry] Registering file: ${relativePath} (${file.getFileType()})`);

        // Store by both absolute and relative paths
        this._files.set(path, file);
        this._filesByRelativePath.set(relativePath, file);

        // Subscribe to file changes and forward them
        const subscription = file.onDidChange((event) => {
            this._onDidChange.fire(event);
        });

        this._disposables.push(subscription);
    }

    /**
     * Unregister a file from the registry
     */
    public unregister(path: string): void {
        const file = this._files.get(path);
        if (!file) {
            console.warn(`[MarkdownFileRegistry] File not found for unregister: ${path}`);
            return;
        }

        console.log(`[MarkdownFileRegistry] Unregistering file: ${file.getRelativePath()}`);

        this._files.delete(path);
        this._filesByRelativePath.delete(file.getRelativePath());

        // Dispose the file
        file.dispose();
    }

    /**
     * Clear all files from the registry
     */
    public clear(): void {
        console.log(`[MarkdownFileRegistry] Clearing all files (${this._files.size} files)`);

        // Dispose all files
        for (const file of this._files.values()) {
            file.dispose();
        }

        this._files.clear();
        this._filesByRelativePath.clear();
    }

    // ============= RETRIEVAL =============

    /**
     * Get file by absolute path
     */
    public get(path: string): MarkdownFile | undefined {
        return this._files.get(path);
    }

    /**
     * Get file by relative path
     */
    public getByRelativePath(relativePath: string): MarkdownFile | undefined {
        return this._filesByRelativePath.get(relativePath);
    }

    /**
     * Get all files
     */
    public getAll(): MarkdownFile[] {
        return Array.from(this._files.values());
    }

    /**
     * Check if file is registered
     */
    public has(path: string): boolean {
        return this._files.has(path);
    }

    /**
     * Check if file is registered by relative path
     */
    public hasByRelativePath(relativePath: string): boolean {
        return this._filesByRelativePath.has(relativePath);
    }

    /**
     * Get number of registered files
     */
    public size(): number {
        return this._files.size;
    }

    // ============= TYPE-SPECIFIC QUERIES =============

    /**
     * Get files by type (using instanceof check)
     */
    public getByType<T extends MarkdownFile>(type: new (...args: any[]) => T): T[] {
        return this.getAll().filter(f => f instanceof type) as T[];
    }

    /**
     * Get the main kanban file
     */
    public getMainFile(): MainKanbanFile | undefined {
        const mainFiles = this.getByType(MainKanbanFile);
        return mainFiles[0]; // Should only be one main file per panel
    }

    /**
     * Get all include files
     */
    public getIncludeFiles(): IncludeFile[] {
        // Can't use getByType with abstract class, so filter manually
        return this.getAll().filter(f =>
            f instanceof ColumnIncludeFile ||
            f instanceof TaskIncludeFile ||
            f instanceof RegularIncludeFile
        ) as IncludeFile[];
    }

    /**
     * Get column include files
     */
    public getColumnIncludeFiles(): ColumnIncludeFile[] {
        return this.getByType(ColumnIncludeFile);
    }

    /**
     * Get task include files
     */
    public getTaskIncludeFiles(): TaskIncludeFile[] {
        return this.getByType(TaskIncludeFile);
    }

    /**
     * Get regular include files
     */
    public getRegularIncludeFiles(): RegularIncludeFile[] {
        return this.getByType(RegularIncludeFile);
    }

    // ============= STATE QUERIES =============

    /**
     * Get files with conflicts
     */
    public getFilesWithConflicts(): MarkdownFile[] {
        return this.getAll().filter(f => f.hasConflict());
    }

    /**
     * Get files with unsaved changes
     */
    public getFilesWithUnsavedChanges(): MarkdownFile[] {
        return this.getAll().filter(f => f.hasUnsavedChanges());
    }

    /**
     * Get files with external changes
     */
    public getFilesWithExternalChanges(): MarkdownFile[] {
        return this.getAll().filter(f => f.hasExternalChanges());
    }

    /**
     * Get files that need reload
     */
    public getFilesThatNeedReload(): MarkdownFile[] {
        return this.getAll().filter(f => f.needsReload());
    }

    /**
     * Get files that need save
     */
    public getFilesThatNeedSave(): MarkdownFile[] {
        return this.getAll().filter(f => f.needsSave());
    }

    /**
     * Get files in edit mode
     */
    public getFilesInEditMode(): MarkdownFile[] {
        return this.getAll().filter(f => f.isInEditMode());
    }

    // ============= BULK OPERATIONS =============

    /**
     * Save all files with unsaved changes
     */
    public async saveAll(): Promise<void> {
        const filesToSave = this.getFilesWithUnsavedChanges();
        console.log(`[MarkdownFileRegistry] Saving ${filesToSave.length} files`);

        await Promise.all(filesToSave.map(f => f.save()));
    }

    /**
     * Reload all files with external changes (that don't have unsaved changes)
     */
    public async reloadAll(): Promise<void> {
        const filesToReload = this.getFilesThatNeedReload();
        console.log(`[MarkdownFileRegistry] Reloading ${filesToReload.length} files`);

        await Promise.all(filesToReload.map(f => f.reload()));
    }

    /**
     * Check all files for external changes
     */
    public async checkAllForExternalChanges(): Promise<Map<string, boolean>> {
        console.log(`[MarkdownFileRegistry] Checking ${this._files.size} files for external changes`);

        const results = new Map<string, boolean>();

        await Promise.all(
            this.getAll().map(async (file) => {
                const hasChanges = await file.checkForExternalChanges();
                results.set(file.getPath(), hasChanges);
            })
        );

        return results;
    }

    /**
     * Start watching all files
     */
    public startWatchingAll(): void {
        console.log(`[MarkdownFileRegistry] Starting watch on ${this._files.size} files`);
        this.getAll().forEach(f => f.startWatching());
    }

    /**
     * Stop watching all files
     */
    public stopWatchingAll(): void {
        console.log(`[MarkdownFileRegistry] Stopping watch on ${this._files.size} files`);
        this.getAll().forEach(f => f.stopWatching());
    }

    /**
     * Create backups for all files with unsaved changes
     */
    public async backupAll(label: string = 'manual'): Promise<void> {
        const filesToBackup = this.getFilesWithUnsavedChanges();
        console.log(`[MarkdownFileRegistry] Creating backups for ${filesToBackup.length} files`);

        await Promise.all(filesToBackup.map(f => f.createBackup(label)));
    }

    // ============= STATISTICS =============

    /**
     * Get registry statistics
     */
    public getStatistics(): {
        total: number;
        mainFiles: number;
        includeFiles: number;
        columnIncludes: number;
        taskIncludes: number;
        regularIncludes: number;
        withConflicts: number;
        withUnsavedChanges: number;
        withExternalChanges: number;
        inEditMode: number;
    } {
        return {
            total: this.size(),
            mainFiles: this.getByType(MainKanbanFile).length,
            includeFiles: this.getIncludeFiles().length,
            columnIncludes: this.getColumnIncludeFiles().length,
            taskIncludes: this.getTaskIncludeFiles().length,
            regularIncludes: this.getRegularIncludeFiles().length,
            withConflicts: this.getFilesWithConflicts().length,
            withUnsavedChanges: this.getFilesWithUnsavedChanges().length,
            withExternalChanges: this.getFilesWithExternalChanges().length,
            inEditMode: this.getFilesInEditMode().length
        };
    }

    /**
     * Log current statistics
     */
    public logStatistics(): void {
        const stats = this.getStatistics();
        console.log('[MarkdownFileRegistry] Statistics:', stats);
    }

    // ============= CLEANUP =============

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        console.log(`[MarkdownFileRegistry] Disposing registry with ${this._files.size} files`);
        this.clear();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
