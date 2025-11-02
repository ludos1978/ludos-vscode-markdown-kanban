import * as vscode from 'vscode';
import { MarkdownFile, FileChangeEvent } from './MarkdownFile';
import { MainKanbanFile } from './MainKanbanFile';
import { IncludeFile } from './IncludeFile';
import { ColumnIncludeFile } from './ColumnIncludeFile';
import { TaskIncludeFile } from './TaskIncludeFile';
import { RegularIncludeFile } from './RegularIncludeFile';
import type { KanbanBoard } from '../markdownParser'; // STATE-2: For generateBoard()

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

    // ============= PERFORMANCE OPTIMIZATIONS =============
    private _registrationCache = new Set<string>(); // Prevent duplicate registrations

    // ============= CHANGE EVENTS =============
    private _onDidChange = new vscode.EventEmitter<FileChangeEvent>();
    public readonly onDidChange = this._onDidChange.event;

    // ============= PANEL REFERENCE (for stopping edit mode during conflicts) =============
    private _messageHandler?: any; // MessageHandler reference for requestStopEditing()

    // ============= LIFECYCLE =============
    private _disposables: vscode.Disposable[] = [];

    constructor() {
        this._disposables.push(this._onDidChange);
    }

    // ============= MESSAGE HANDLER ACCESS =============

    /**
     * Set the message handler reference (used for stopping edit mode during conflicts)
     */
    public setMessageHandler(messageHandler: any): void {
        this._messageHandler = messageHandler;
    }

    /**
     * Request frontend to stop editing and return the captured edit value
     * Used during conflict resolution to preserve user's edit in baseline
     */
    public async requestStopEditing(): Promise<any> {
        if (this._messageHandler && typeof this._messageHandler.requestStopEditing === 'function') {
            return await this._messageHandler.requestStopEditing();
        }
        return null;
    }

    // ============= REGISTRATION =============

    /**
     * Check if file is already being registered (fast lookup to prevent duplicates)
     */
    public isBeingRegistered(relativePath: string): boolean {
        const normalized = MarkdownFile.normalizeRelativePath(relativePath);
        return this._registrationCache.has(normalized);
    }

    /**
     * Register a file in the registry
     *
     * FOUNDATION-1: Uses normalized relative path as key for case-insensitive lookups
     */
    public register(file: MarkdownFile): void {
        const path = file.getPath();
        const relativePath = file.getRelativePath();
        const normalizedRelativePath = file.getNormalizedRelativePath();

        // PERFORMANCE: Check registration cache first
        if (this._registrationCache.has(normalizedRelativePath)) {
            console.debug(`[MarkdownFileRegistry] Skipping duplicate registration: ${relativePath}`);
            return;
        }

        // FOUNDATION-1: Check for duplicates BEFORE registering (collision detection)
        const existingFile = this._filesByRelativePath.get(normalizedRelativePath);
        if (existingFile && existingFile !== file) {
            console.warn(`[MarkdownFileRegistry] ⚠️  Duplicate file detected!`);
            console.warn(`  Normalized path: ${normalizedRelativePath}`);
            console.warn(`  Existing original: ${existingFile.getRelativePath()}`);
            console.warn(`  New original: ${relativePath}`);
            console.warn(`  Action: Overwriting existing file`);

            // Dispose old file to prevent memory leak
            existingFile.dispose();
        }

        console.log(`[MarkdownFileRegistry] Registering: "${relativePath}" → "${normalizedRelativePath}" (${file.getFileType()})`);

        // PERFORMANCE: Add to registration cache
        this._registrationCache.add(normalizedRelativePath);

        // Store by absolute path (unchanged) and NORMALIZED relative path
        this._files.set(path, file);
        this._filesByRelativePath.set(normalizedRelativePath, file);

        // Subscribe to file changes and forward them
        const subscription = file.onDidChange((event) => {
            this._onDidChange.fire(event);
        });

        this._disposables.push(subscription);
    }

    /**
     * Unregister a file from the registry
     *
     * FOUNDATION-1: Uses normalized relative path for map key deletion
     */
    public unregister(path: string): void {
        const file = this._files.get(path);
        if (!file) {
            console.warn(`[MarkdownFileRegistry] File not found for unregister: ${path}`);
            return;
        }

        const normalizedRelativePath = file.getNormalizedRelativePath();
        console.log(`[MarkdownFileRegistry] Unregistering: "${file.getRelativePath()}" (${normalizedRelativePath})`);

        this._files.delete(path);
        this._filesByRelativePath.delete(normalizedRelativePath); // FOUNDATION-1: Use normalized key

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
     *
     * FOUNDATION-1: Normalizes the lookup path for case-insensitive matching
     *
     * @param relativePath The relative path to look up (any casing)
     * @returns The file if found, undefined otherwise
     *
     * @example
     * // These all return the same file:
     * registry.getByRelativePath("Folder/File.md")
     * registry.getByRelativePath("folder/file.md")
     * registry.getByRelativePath("FOLDER/FILE.MD")
     */
    public getByRelativePath(relativePath: string): MarkdownFile | undefined {
        const normalized = MarkdownFile.normalizeRelativePath(relativePath);
        const file = this._filesByRelativePath.get(normalized);

        // Debug logging for lookup misses (helps catch issues)
        if (!file && relativePath) {
            console.debug(`[MarkdownFileRegistry] Lookup miss: "${relativePath}" (normalized: "${normalized}")`);
        }

        return file;
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
     *
     * FOUNDATION-1: Normalizes the check path for case-insensitive matching
     *
     * @param relativePath The relative path to check (any casing)
     * @returns true if file exists in registry
     */
    public hasByRelativePath(relativePath: string): boolean {
        const normalized = MarkdownFile.normalizeRelativePath(relativePath);
        return this._filesByRelativePath.has(normalized);
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

    // ============= BOARD GENERATION (STATE-2) =============

    /**
     * STATE-2: Generate complete KanbanBoard from registry files
     *
     * This is the single source of truth for board generation.
     * Replaces dual board state (_board and _cachedBoardFromWebview).
     *
     * Process:
     * 1. Get main file's parsed board
     * 2. For each column with includeFiles, load tasks from ColumnIncludeFiles
     * 3. For each task with includeFiles, load description from TaskIncludeFiles
     * 4. Return complete board
     *
     * @returns KanbanBoard with all include content loaded, or undefined if main file not ready
     */
    public generateBoard(): KanbanBoard | undefined {
        console.log('[MarkdownFileRegistry] generateBoard() - Generating board from registry');

        // Step 1: Get main file
        const mainFile = this.getMainFile();
        if (!mainFile) {
            console.warn('[MarkdownFileRegistry] generateBoard() - No main file found');
            return undefined;
        }

        // Step 2: Get parsed board from main file
        const board = mainFile.getBoard();
        if (!board) {
            console.warn('[MarkdownFileRegistry] generateBoard() - Main file has no board');
            return undefined;
        }

        if (!board.valid) {
            console.warn('[MarkdownFileRegistry] generateBoard() - Board is invalid');
            return board; // Return invalid board so caller can handle
        }

        console.log(`[MarkdownFileRegistry] generateBoard() - Base board has ${board.columns.length} columns`);

        // Step 3: Load content for column includes
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                console.log(`[MarkdownFileRegistry] generateBoard() - Column "${column.title}" has ${column.includeFiles.length} includes`);

                for (const relativePath of column.includeFiles) {
                    const file = this.getByRelativePath(relativePath) as ColumnIncludeFile;
                    if (file && file.getFileType() === 'include-column') {
                        // Parse tasks from include file, preserving existing task IDs
                        const tasks = file.parseToTasks(column.tasks);
                        column.tasks = tasks;
                        console.log(`[MarkdownFileRegistry] generateBoard() - Loaded ${tasks.length} tasks from ${relativePath}`);
                    } else {
                        console.warn(`[MarkdownFileRegistry] generateBoard() - Column include not found: ${relativePath}`);
                    }
                }
            }

            // Step 4: Load content for task includes (if any)
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    console.log(`[MarkdownFileRegistry] generateBoard() - Task "${task.title}" has ${task.includeFiles.length} includes`);

                    for (const relativePath of task.includeFiles) {
                        const file = this.getByRelativePath(relativePath) as TaskIncludeFile;
                        if (file && file.getFileType() === 'include-task') {
                            // Load description from task include file
                            task.description = file.getContent();
                            console.log(`[MarkdownFileRegistry] generateBoard() - Loaded description from ${relativePath}`);
                        } else {
                            console.warn(`[MarkdownFileRegistry] generateBoard() - Task include not found: ${relativePath}`);
                        }
                    }
                }
            }
        }

        console.log('[MarkdownFileRegistry] generateBoard() - Board generation complete');
        return board;
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
