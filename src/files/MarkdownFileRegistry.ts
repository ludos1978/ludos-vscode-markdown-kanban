import * as vscode from 'vscode';
import * as path from 'path';
import { MarkdownFile, FileChangeEvent } from './MarkdownFile';
import { MainKanbanFile } from './MainKanbanFile';
import { IncludeFile, IncludeFileType } from './IncludeFile';
import { FileSaveService } from '../core/FileSaveService';
import type { KanbanBoard } from '../markdownParser'; // STATE-2: For generateBoard()
import type { IMessageHandler, IFileFactory, CapturedEdit } from './FileInterfaces';

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
    private _messageHandler?: IMessageHandler; // MessageHandler reference for requestStopEditing()

    // ============= UNIFIED SAVE SERVICE =============
    private _fileSaveService: FileSaveService;

    // ============= LIFECYCLE =============
    private _disposables: vscode.Disposable[] = [];

    constructor() {
        this._disposables.push(this._onDidChange);
        this._fileSaveService = FileSaveService.getInstance();
    }

    // ============= MESSAGE HANDLER ACCESS =============

    /**
     * Set the message handler reference (used for stopping edit mode during conflicts)
     */
    public setMessageHandler(messageHandler: IMessageHandler): void {
        this._messageHandler = messageHandler;
    }

    /**
     * Request frontend to stop editing and return the captured edit value
     * Used during conflict resolution to preserve user's edit in baseline
     */
    public async requestStopEditing(): Promise<CapturedEdit | undefined> {
        if (this._messageHandler) {
            return await this._messageHandler.requestStopEditing();
        }
        return undefined;
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
        const normalizedRelativePath = file.getNormalizedRelativePath();

        // PERFORMANCE: Check registration cache first
        if (this._registrationCache.has(normalizedRelativePath)) {
            return;
        }

        // FOUNDATION-1: Check for duplicates BEFORE registering (collision detection)
        const existingFile = this._filesByRelativePath.get(normalizedRelativePath);
        if (existingFile && existingFile !== file) {
            console.warn(`[MarkdownFileRegistry] Duplicate file detected: ${normalizedRelativePath} (overwriting)`);
            existingFile.dispose();
        }


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

        this._files.delete(path);
        this._filesByRelativePath.delete(normalizedRelativePath); // FOUNDATION-1: Use normalized key
        this._registrationCache.delete(normalizedRelativePath); // Allow re-registration after unregister

        // Dispose the file
        file.dispose();
    }

    /**
     * Clear all files from the registry
     */
    public clear(): void {

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
        return this._filesByRelativePath.get(normalized);
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
        return this.getByType(IncludeFile);
    }

    /**
     * Get column include files
     */
    public getColumnIncludeFiles(): IncludeFile[] {
        return this.getIncludeFiles().filter(f => f.getFileType() === 'include-column');
    }

    /**
     * Get task include files
     */
    public getTaskIncludeFiles(): IncludeFile[] {
        return this.getIncludeFiles().filter(f => f.getFileType() === 'include-task');
    }

    /**
     * Get regular include files
     */
    public getRegularIncludeFiles(): IncludeFile[] {
        return this.getIncludeFiles().filter(f => f.getFileType() === 'include-regular');
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

        await Promise.all(filesToSave.map(f => this._fileSaveService.saveFile(f)));
    }

    /**
     * Force write ALL files unconditionally (emergency recovery)
     * This bypasses all change detection and writes every registered file
     * Use ONLY when sync is broken and normal save doesn't work
     */
    public async forceWriteAll(): Promise<{ filesWritten: number; errors: string[] }> {
        const allFiles = this.getAll();
        console.warn(`[MarkdownFileRegistry] FORCE WRITE: Writing ${allFiles.length} files unconditionally`);

        const errors: string[] = [];
        let filesWritten = 0;

        // Write all files in parallel with force: true to bypass hash check
        await Promise.all(
            allFiles.map(async (file) => {
                try {
                    await this._fileSaveService.saveFile(file, undefined, { force: true });
                    filesWritten++;
                } catch (error) {
                    const errorMsg = `Failed to write ${file.getRelativePath()}: ${error}`;
                    console.error(`[MarkdownFileRegistry] ${errorMsg}`);
                    errors.push(errorMsg);
                }
            })
        );

        return { filesWritten, errors };
    }

    /**
     * Check all files for external changes
     */
    public async checkAllForExternalChanges(): Promise<Map<string, boolean>> {

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
        this.getAll().forEach(f => f.startWatching());
    }

    /**
     * Stop watching all files
     */
    public stopWatchingAll(): void {
        this.getAll().forEach(f => f.stopWatching());
    }

    // ============= CONVENIENCE METHODS (merged from FileRegistryAdapter) =============

    /**
     * Check if registry has a main file (is ready for operations)
     */
    public isReady(): boolean {
        return this.getMainFile() !== undefined;
    }

    /**
     * Get an include file by relative path (convenience method)
     */
    public getIncludeFile(relativePath: string): IncludeFile | undefined {
        const file = this.getByRelativePath(relativePath);
        if (file && file.getFileType() !== 'main') {
            return file as IncludeFile;
        }
        return undefined;
    }

    /**
     * Get include files unsaved status
     */
    public getIncludeFilesUnsavedStatus(): { hasChanges: boolean; changedFiles: string[] } {
        const includeFiles = this.getAll().filter(f => f.getFileType() !== 'main');
        const changedFiles = includeFiles
            .filter(f => f.hasUnsavedChanges())
            .map(f => f.getRelativePath());

        return {
            hasChanges: changedFiles.length > 0,
            changedFiles
        };
    }

    /**
     * Check if any file has unsaved changes (main or includes)
     */
    public hasAnyUnsavedChanges(): boolean {
        const mainFile = this.getMainFile();
        const mainHasChanges = mainFile?.hasUnsavedChanges() || false;
        const includeStatus = this.getIncludeFilesUnsavedStatus();

        return mainHasChanges || includeStatus.hasChanges;
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
        // Stats available via getStatistics() for debugging
        this.getStatistics();
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
     * 2. For each column with includeFiles, load tasks from IncludeFile (type=include-column)
     * 3. For each task with includeFiles, load description from IncludeFile (type=include-task)
     * 4. Return complete board
     *
     * @param existingBoard Optional existing board to preserve column/task IDs during regeneration
     * @returns KanbanBoard with all include content loaded, or undefined if main file not ready
     */
    public generateBoard(existingBoard?: KanbanBoard): KanbanBoard | undefined {
        // Step 1: Get main file
        const mainFile = this.getMainFile();
        if (!mainFile) {
            console.warn('[MarkdownFileRegistry] generateBoard() - No main file found');
            return undefined;
        }

        // Step 2: Get parsed board from main file (parser will preserve IDs if existingBoard passed)
        const board = mainFile.getBoard(existingBoard);
        if (!board) {
            console.warn('[MarkdownFileRegistry] generateBoard() - Main file has no board');
            return undefined;
        }

        if (!board.valid) {
            console.warn('[MarkdownFileRegistry] generateBoard() - Board is invalid');
            return board; // Return invalid board so caller can handle
        }


        // Step 3: Load content for column includes
        const mainFilePath = mainFile.getPath();
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {

                for (const relativePath of column.includeFiles) {
                    const file = this.getByRelativePath(relativePath) as IncludeFile;
                    if (file && file.getFileType() === 'include-column') {
                        // Parse tasks from include file, preserving existing task IDs
                        const tasks = file.parseToTasks(column.tasks, column.id, mainFilePath);
                        column.tasks = tasks;
                    } else {
                        console.warn(`[MarkdownFileRegistry] generateBoard() - Column include not found: ${relativePath}`);
                    }
                }
            }

            // Step 4: Load content for task includes (if any)
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {

                    for (const relativePath of task.includeFiles) {
                        const file = this.getByRelativePath(relativePath) as IncludeFile;
                        if (file && file.getFileType() === 'include-task') {
                            // Load description from task include file
                            task.description = file.getContent();
                        } else {
                            console.warn(`[MarkdownFileRegistry] generateBoard() - Task include not found: ${relativePath}`);
                        }
                    }
                }
            }
        }

        return board;
    }

    // ============= INCLUDE FILE OPERATIONS =============
    // (Migrated from IncludeFileManager - these are the active methods)

    /**
     * Ensure an include file is registered with the correct type.
     * Handles type mismatch by replacing the existing registration.
     *
     * This is the consolidated registration method used by both:
     * - IncludeLoadingProcessor (for include switch operations)
     * - IncludeFileCoordinator (for board sync operations)
     *
     * @param relativePath - Relative path to the include file
     * @param fileType - Include type
     * @param fileFactory - FileFactory instance for creating files
     * @param mainFile - Parent main kanban file
     * @param context - Column/task context for setting IDs and titles
     * @returns The registered include file, or undefined if registration failed
     */
    public ensureIncludeRegistered(
        relativePath: string,
        fileType: IncludeFileType,
        fileFactory: { createIncludeDirect: (path: string, mainFile: MainKanbanFile, type: IncludeFileType, isInline: boolean) => IncludeFile },
        mainFile: MainKanbanFile,
        context: {
            columnId?: string;
            columnTitle?: string;
            taskId?: string;
            taskTitle?: string;
        }
    ): IncludeFile | undefined {
        const existingFile = this.getByRelativePath(relativePath);
        const isCorrectType = existingFile?.getFileType() === fileType;

        // If file exists with wrong type, replace it
        if (existingFile && !isCorrectType) {
            console.warn(`[MarkdownFileRegistry] File ${relativePath} registered as ${existingFile.getFileType()} but should be ${fileType}! Replacing...`);
            existingFile.stopWatching();
            this.unregister(existingFile.getPath());
        }

        // If file already registered with correct type, return it
        if (existingFile && isCorrectType) {
            return existingFile as IncludeFile;
        }

        // Create and register new include file
        const isInline = fileType === 'include-regular';
        const includeFile = fileFactory.createIncludeDirect(relativePath, mainFile, fileType, isInline);

        // Set context based on file type
        if (fileType === 'include-column' && context.columnId) {
            includeFile.setColumnId(context.columnId);
            if (context.columnTitle) {
                includeFile.setColumnTitle(context.columnTitle);
            }
        } else if (fileType === 'include-task') {
            if (context.taskId) {
                includeFile.setTaskId(context.taskId);
            }
            if (context.taskTitle) {
                includeFile.setTaskTitle(context.taskTitle);
            }
            if (context.columnId) {
                includeFile.setColumnId(context.columnId);
            }
        }

        this.register(includeFile);
        includeFile.startWatching();

        return includeFile;
    }

    /**
     * Track unsaved changes in include files by syncing board state to file instances.
     * Updates IncludeFile content from board data WITHOUT saving to disk.
     *
     * @param board - Current board state to sync from
     * @returns false (main file also needs saving)
     */
    public async trackIncludeFileUnsavedChanges(board: KanbanBoard): Promise<boolean> {
        // Update IncludeFile instances (type=include-column) with current task content
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const file = this.getByRelativePath(relativePath) as IncludeFile;
                    if (file && file.getFileType() === 'include-column') {
                        const content = file.generateFromTasks(column.tasks);
                        const currentContent = file.getContent();
                        const baseline = file.getBaseline();

                        // CRITICAL PROTECTION: Never replace existing content with empty
                        if (!content.trim() && currentContent.trim()) {
                            console.warn(`[MarkdownFileRegistry] ⚠️ PROTECTED: Refusing to wipe column content to empty`);
                            continue; // Don't modify file at all
                        }

                        // Only update if content differs from what's on disk (baseline)
                        // This prevents false "unsaved changes" from formatting differences
                        if (content !== baseline) {
                            file.setContent(content, false); // false = NOT saved yet
                        }
                        // If content === baseline, file already has correct hasUnsavedChanges state
                    }
                }
            }
        }

        // Update IncludeFile instances (type=include-task) with current task content
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const file = this.getByRelativePath(relativePath) as IncludeFile;
                        if (file && file.getFileType() === 'include-task') {
                            const fullContent = task.description || '';
                            const currentContent = file.getContent();
                            const baseline = file.getBaseline();

                            // CRITICAL PROTECTION: Never replace existing content with empty
                            if (!fullContent.trim() && currentContent.trim()) {
                                console.warn(`[MarkdownFileRegistry] ⚠️ PROTECTED: Refusing to wipe task content to empty`);
                                continue; // Don't modify file at all
                            }

                            // Only update if content differs from what's on disk (baseline)
                            if (fullContent !== baseline) {
                                file.setTaskDescription(fullContent);
                            }
                            // If fullContent === baseline, file already has correct hasUnsavedChanges state
                        }
                    }
                }
            }
        }

        return false; // Return false = main file also needs saving
    }

    /**
     * Ensure an include file is registered (lazy registration)
     *
     * @param relativePath - Relative path to the include file
     * @param type - Include type ('regular', 'column', 'task')
     * @param fileFactory - FileFactory instance for creating files
     */
    public ensureIncludeFileRegistered(
        relativePath: string,
        type: 'regular' | 'column' | 'task',
        fileFactory: IFileFactory
    ): void {
        // Convert absolute path to relative if needed
        if (path.isAbsolute(relativePath)) {
            const mainFile = this.getMainFile();
            if (!mainFile) {
                console.error(`[MarkdownFileRegistry] Cannot convert absolute to relative - no main file`);
                return;
            }
            const baseDir = path.dirname(mainFile.getPath());
            relativePath = path.relative(baseDir, relativePath);
        }

        // Normalize ./ prefix
        if (relativePath.startsWith('./')) {
            relativePath = relativePath.substring(2);
        }

        // Fast check using registration cache
        if (this.isBeingRegistered(relativePath)) {
            return;
        }

        // Check if file is already registered
        if (this.hasByRelativePath(relativePath)) {
            return;
        }

        // Schedule actual registration for next tick (lazy loading)
        setTimeout(() => {
            this._performLazyRegistration(relativePath, type, fileFactory);
        }, 0);
    }

    /**
     * Perform the actual lazy registration
     */
    private async _performLazyRegistration(
        relativePath: string,
        type: 'regular' | 'column' | 'task',
        fileFactory: IFileFactory
    ): Promise<void> {
        try {
            // Double-check if file is still needed
            if (this.hasByRelativePath(relativePath)) {
                return;
            }

            const mainFile = this.getMainFile();
            if (!mainFile) {
                console.error(`[MarkdownFileRegistry] Cannot lazy-register - no main file`);
                return;
            }

            // Map type to IncludeFileType
            const fileType: IncludeFileType = type === 'column' ? 'include-column'
                : type === 'task' ? 'include-task'
                : 'include-regular';

            // Create and register (cast to IncludeFile for full type support)
            const includeFile = fileFactory.createIncludeDirect(relativePath, mainFile, fileType, true) as IncludeFile;
            this.register(includeFile);
            includeFile.startWatching();
        } catch (error) {
            console.error(`[MarkdownFileRegistry] Error during lazy registration:`, error);
        }
    }

    /**
     * Get include files by type
     */
    public getIncludeFilesByType(type: 'regular' | 'column' | 'task'): string[] {
        const files = this.getIncludeFiles();
        return files
            .filter(file => {
                if (type === 'column') return file.getFileType() === 'include-column';
                if (type === 'task') return file.getFileType() === 'include-task';
                return file.getFileType() === 'include-regular';
            })
            .map(file => file.getRelativePath());
    }

    /**
     * Get all include file paths
     */
    public getAllIncludeFilePaths(): string[] {
        return this.getIncludeFiles().map(f => f.getRelativePath());
    }

    // ============= CLEANUP =============

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.clear();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
