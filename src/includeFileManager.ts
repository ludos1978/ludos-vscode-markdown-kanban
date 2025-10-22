import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { KanbanBoard, KanbanColumn, KanbanTask } from './markdownParser';
import { PresentationParser } from './presentationParser';
import { BackupManager } from './backupManager';
import { ConflictResolver, ConflictContext } from './conflictResolver';
import { getFileStateManager, FileState, FileStateManager } from './fileStateManager';
import { PathResolver } from './services/PathResolver';
import { FileWriter } from './services/FileWriter';

/**
 * Manages all include file operations for the Kanban board.
 *
 * This class handles:
 * - Include file registration and tracking
 * - Loading and updating include file content
 * - Saving changes to include files
 * - Change detection (unsaved changes and external changes)
 * - Conflict resolution when external changes occur
 * - Type detection (column/task/regular includes)
 */
export class IncludeFileManager {
    private _recentlyReloadedFiles: Set<string> = new Set(); // Track files that were just reloaded from external
    private _filesToRemoveAfterSave: string[] = [];  // Files to remove after unsaved changes are handled
    private _unsavedFilesToPrompt: string[] = [];  // Files with unsaved changes that need user prompt

    constructor(
        private fileStateManager: FileStateManager,
        private conflictResolver: ConflictResolver,
        private backupManager: BackupManager,
        private mainFilePath: () => string | undefined,  // getter function
        private board: () => KanbanBoard | undefined,    // getter function
        private sendMessageToWebview: (message: any) => void,  // callback
        private isUpdatingFromPanel: () => boolean,  // getter function
        private cachedBoardFromWebview: () => any  // getter function for board cache
    ) {}

    // ============= FILE TRACKING & REGISTRATION =============

    /**
     * Get or create include file entry in the unified system
     */
    public getOrCreateIncludeFile(relativePath: string, type: 'regular' | 'column' | 'task', documentGetter: () => vscode.TextDocument | undefined): FileState {
        const fileStateManager = getFileStateManager();
        let fileState = fileStateManager.getIncludeFileByRelativePath(relativePath);
        if (!fileState) {
            const currentDocument = documentGetter();
            const basePath = currentDocument ? path.dirname(currentDocument.uri.fsPath) : '';
            const absolutePath = PathResolver.resolve(basePath, relativePath);
            let fileContent = '';
            try {
                if (fs.existsSync(absolutePath)) {
                    fileContent = fs.readFileSync(absolutePath, 'utf8');
                }
            } catch (error) {
                console.error(`[getOrCreateIncludeFile] Error reading file ${absolutePath}:`, error);
            }
            const fileType = FileStateManager.getFileType(type);
            fileState = fileStateManager.initializeFile(absolutePath, relativePath, false, fileType, fileContent);
        }
        return fileState;
    }

    /**
     * Get all include files of a specific type
     */
    public getIncludeFilesByType(type: 'regular' | 'column' | 'task'): string[] {
        return getFileStateManager().getAllIncludeFiles()
            .filter(file => FileStateManager.getLegacyType(file.fileType) === type)
            .map(file => file.relativePath);
    }

    /**
     * Update include file content and baseline
     */
    public updateIncludeFileContent(relativePath: string, content: string, updateBaseline: boolean = true, preserveUnsavedFlag: boolean = false): void {
        console.log(`[updateIncludeFileContent] ===== UPDATING CONTENT =====`);
        console.log(`[updateIncludeFileContent] relativePath: ${relativePath}`);
        console.log(`[updateIncludeFileContent] updateBaseline: ${updateBaseline}`);
        console.log(`[updateIncludeFileContent] preserveUnsavedFlag: ${preserveUnsavedFlag}`);
        console.log(`[updateIncludeFileContent] content length: ${content.length}`);

        const fileState = getFileStateManager().getIncludeFileByRelativePath(relativePath);
        if (fileState) {
            console.log(`[updateIncludeFileContent] fileState found for: ${relativePath}`);
            console.log(`[updateIncludeFileContent] Before update - baseline exists: ${!!fileState.frontend.baseline}, baseline length: ${fileState.frontend.baseline?.length || 0}`);
            console.log(`[updateIncludeFileContent] Before update - hasUnsavedChanges: ${fileState.frontend.hasUnsavedChanges}`);

            // FIXME: Use FileStateManager.updateContent - fileState.frontend.content = content;
            // FIXME: Use FileStateManager methods - fileState.backend.lastModified = new Date();
            if (updateBaseline) {
                // FIXME: Use FileStateManager.markSaved - fileState.frontend.baseline = content;
                const previousUnsaved = fileState.frontend.hasUnsavedChanges;

                // Only reset hasUnsavedChanges if we're not preserving it
                if (!preserveUnsavedFlag) {
                    // FIXME: Use FileStateManager.markFrontendChange - fileState.frontend.hasUnsavedChanges = false;
                    console.log(`[updateIncludeFileContent] Clearing hasUnsavedChanges (was: ${previousUnsaved})`);
                    if (previousUnsaved) {
                    }
                } else {
                    console.log(`[updateIncludeFileContent] Preserving hasUnsavedChanges (keeping: ${previousUnsaved})`);
                }
            }

            // Also update FileStateManager
            const fileStateManager = getFileStateManager();
            if (updateBaseline) {
                // File was reloaded from disk, update baseline and clear changes
                console.log(`[updateIncludeFileContent] Calling fileStateManager.markReloaded to set baseline`);
                fileStateManager.markReloaded(fileState.path, content);
            } else {
                // Just update content but not baseline
                console.log(`[updateIncludeFileContent] Calling fileStateManager.markFrontendChange (no baseline update)`);
                fileStateManager.markFrontendChange(fileState.path, true, content);
            }

            console.log(`[updateIncludeFileContent] After update - baseline exists: ${!!fileState.frontend.baseline}, baseline length: ${fileState.frontend.baseline?.length || 0}`);
            console.log(`[updateIncludeFileContent] After update - hasUnsavedChanges: ${fileState.frontend.hasUnsavedChanges}`);
        } else {
            console.log(`[updateIncludeFileContent] ❌ NO fileState found for: ${relativePath}`);
        }
    }

    /**
     * Normalize include path for consistent storage/lookup
     * PathResolver.normalize() handles URL decoding and adds ./ prefix
     */
    public _normalizeIncludePath(relativePath: string): string {
        if (!relativePath) return '';
        // PathResolver.normalize() now handles URL decoding internally
        return PathResolver.normalize(relativePath);
    }

    /**
     * Find include file in map, handling path variations
     * Returns undefined if not found
     */
    public _findIncludeFile(relativePath: string): FileState | undefined {
        const normalized = this._normalizeIncludePath(relativePath);
        return getFileStateManager().getIncludeFileByRelativePath(normalized);
    }

    /**
     * Check if two include paths refer to same file
     */
    public _isSameIncludePath(path1: string, path2: string): boolean {
        if (!path1 || !path2) return path1 === path2;
        return PathResolver.areEqual(
            this._normalizeIncludePath(path1),
            this._normalizeIncludePath(path2)
        );
    }

    /**
     * Handle unsaved changes in files that need to be removed during include file path changes
     */
    public async _handleUnsavedIncludeFileChanges(documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        if (this._unsavedFilesToPrompt.length === 0) {
            // No unsaved changes, safe to remove files
            this._removeTrackedFiles();
            return;
        }

        // Build a user-friendly message about unsaved changes
        const fileNames = this._unsavedFilesToPrompt.map(relativePath => path.basename(relativePath));
        const fileList = fileNames.join(', ');

        const message = `The following include files have unsaved changes and will no longer be included:\n\n${fileList}\n\nWhat would you like to do?`;

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            'Save Changes',
            'Discard Changes',
            'Cancel'
        );

        if (choice === 'Save Changes') {
            // Save all unsaved include files first
            for (const relativePath of this._unsavedFilesToPrompt) {
                const fileState = getFileStateManager().getIncludeFileByRelativePath(relativePath);
                if (fileState?.frontend.hasUnsavedChanges && (FileStateManager.getLegacyType(fileState.fileType) === 'column' || FileStateManager.getLegacyType(fileState.fileType) === 'task')) {
                    // Only column and task includes can be saved back to files
                    await this.saveIncludeFileChanges(fileState.path, documentGetter);
                }
            }
            // Now safe to remove files
            this._removeTrackedFiles();

        } else if (choice === 'Discard Changes') {
            // User wants to discard changes, safe to remove files
            this._removeTrackedFiles();

        } else {
            // User cancelled - we need to revert the board change
            // This is complex since the board has already been updated
            // For now, show a warning and proceed with removal
            vscode.window.showWarningMessage('Cannot cancel include file change after board has been updated. Unsaved changes will be lost.');
            this._removeTrackedFiles();
        }

        // Clear the tracking arrays
        this._filesToRemoveAfterSave = [];
        this._unsavedFilesToPrompt = [];
    }

    /**
     * Remove files from tracking after unsaved changes have been handled
     */
    public _removeTrackedFiles(): void {
        for (const relativePath of this._filesToRemoveAfterSave) {
            // Get the include file before removing it
            const fileState = getFileStateManager().getIncludeFileByRelativePath(relativePath);

            // Remove from include files map

            // Also clear from FileStateManager
            if (fileState) {
                const fileStateManager = getFileStateManager();
                fileStateManager.clearFileState(fileState.path);
            }
        }
    }

    /**
     * Initialize content for new include files (preserve existing baselines)
     */
    public async _initializeUnifiedIncludeContents(documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        const board = this.board();
        for (const fileState of getFileStateManager().getAllIncludeFiles()) {
            // Only initialize if we don't have content yet
            if (!fileState.frontend.content && !fileState.frontend.baseline) {
                const content = await this._readFileContent(fileState.relativePath, documentGetter);
                if (content !== null) {
                    // FIXME: Use FileStateManager.updateContent - fileState.frontend.content = content;

                    // For column includes, we need to set baseline to the presentation format
                    // not the original file content, since we compare against tasksToPresentation output
                    if (FileStateManager.getLegacyType(fileState.fileType) === 'column') {
                        // Find the column that uses this include file to set proper baseline
                        let presentationBaseline = '';
                        if (board && board.columns) {
                            for (const column of board.columns) {
                                if (column.includeMode && column.includeFiles?.includes(fileState.relativePath)) {
                                    presentationBaseline = column.tasks.length > 0
                                        ? PresentationParser.tasksToPresentation(column.tasks)
                                        : '';
                                    break;
                                }
                            }
                        }
                        // FIXME: Use FileStateManager.markSaved - fileState.frontend.baseline = presentationBaseline;
                        // Also update FileStateManager with the presentation format baseline
                        const fileStateManager = getFileStateManager();
                        fileStateManager.markReloaded(fileState.path, presentationBaseline);
                    } else {
                        // For regular and task includes, use file content as baseline
                        // FIXME: Use FileStateManager.markSaved - fileState.frontend.baseline = content;

                        // Also update FileStateManager with the content baseline
                        const fileStateManager = getFileStateManager();
                        fileStateManager.markReloaded(fileState.path, content);
                    }

                    // FIXME: Use FileStateManager methods - fileState.backend.lastModified = new Date();
                }
            }

            // Check if this file is currently open in VS Code and has unsaved changes
            const openTextDocuments = vscode.workspace.textDocuments;
            for (const doc of openTextDocuments) {
                if (doc.uri.fsPath === fileState.path) {
                    fileState.backend.isDirtyInEditor = doc.isDirty;
                    if (doc.isDirty) {
                    }
                    break;
                }
            }
        }
    }

    /**
     * Get all include file paths for file watcher registration
     */
    public getAllIncludeFilePaths(): string[] {
        return getFileStateManager().getAllIncludeFiles().map(file => file.path);
    }

    /**
     * Update the unified include system with parsed file lists
     */
    public _updateUnifiedIncludeSystem(includedFiles: string[], columnIncludeFiles: string[], taskIncludeFiles: string[], documentGetter: () => vscode.TextDocument | undefined): void {

        // Helper function to normalize include paths consistently
        // Use PathResolver.normalize for consistent path handling
        const normalizePath = (filePath: string): string => {
            return PathResolver.normalize(filePath);
        };

        // Create or update entries for each file type
        includedFiles.forEach(relativePath => {
            const normalizedPath = normalizePath(relativePath);
            const fileState = this.getOrCreateIncludeFile(normalizedPath, 'regular', documentGetter);
        });

        columnIncludeFiles.forEach(relativePath => {
            const normalizedPath = normalizePath(relativePath);
            const fileState = this.getOrCreateIncludeFile(normalizedPath, 'column', documentGetter);
        });

        taskIncludeFiles.forEach(relativePath => {
            const normalizedPath = normalizePath(relativePath);
            const fileState = this.getOrCreateIncludeFile(normalizedPath, 'task', documentGetter);
        });

        // Remove files that are no longer referenced
        const allCurrentFiles = new Set([
            ...includedFiles.map(normalizePath),
            ...columnIncludeFiles.map(normalizePath),
            ...taskIncludeFiles.map(normalizePath)
        ]);

        // Check for unsaved changes in files that will be removed
        const filesToRemove: string[] = [];
        const unsavedFilesToPrompt: string[] = [];

        for (const fileState of getFileStateManager().getAllIncludeFiles()) {
            if (!allCurrentFiles.has(fileState.relativePath)) {
                filesToRemove.push(fileState.relativePath);
                if (fileState.frontend.hasUnsavedChanges) {
                    unsavedFilesToPrompt.push(fileState.relativePath);
                }
            }
        }

        // If there are unsaved changes, we need to handle this asynchronously
        // Store the files to remove for later processing
        this._filesToRemoveAfterSave = filesToRemove;
        this._unsavedFilesToPrompt = unsavedFilesToPrompt;

        // For now, don't remove files here - this will be handled by the async check

    }

    /**
     * Ensure an include file is registered in the unified system for conflict resolution
     */
    public ensureIncludeFileRegistered(relativePath: string, type: 'regular' | 'column' | 'task', documentGetter: () => vscode.TextDocument | undefined): void {
        // Simply use getOrCreateIncludeFile which handles everything
        this.getOrCreateIncludeFile(relativePath, type, documentGetter);
    }

    // ============= LOADING & CONTENT =============

    /**
     * Load new content into a column when its include files change
     * INTERNAL METHOD - should only be called from updateIncludeContentUnified
     */
    public async loadNewIncludeContent(column: KanbanColumn, newIncludeFiles: string[], documentGetter: () => vscode.TextDocument | undefined, fileWatcherUpdater: (paths: string[]) => void): Promise<void> {

        try {
            const currentDocument = documentGetter();
            if (!currentDocument) {
                console.warn(`[loadNewIncludeContent] No current document available`);
                return;
            }

            const basePath = path.dirname(currentDocument.uri.fsPath);

            // For now, handle single file includes
            const fileState = newIncludeFiles[0];
            const absolutePath = PathResolver.resolve(basePath, fileState);

            // Ensure the new include file is registered in the unified system
            this.getOrCreateIncludeFile(fileState, 'column', documentGetter);

            // Use shared method to read and update content
            const fileContent = await this.readAndUpdateIncludeContent(absolutePath, fileState);

            if (fileContent !== null) {

                console.log(`[loadNewIncludeContent] ========================================`);
                console.log(`[loadNewIncludeContent] FILE CONTENT LOADED`);
                console.log(`[loadNewIncludeContent] fileContent length: ${fileContent.length}`);
                console.log(`[loadNewIncludeContent] fileContent (first 200): "${fileContent.substring(0, 200)}"`);
                console.log(`[loadNewIncludeContent] ========================================`);

                // columninclude files are ALWAYS parsed as presentation slides (separated by ---)
                // Each slide becomes one task
                // No special parsing of markdown task lists (- [ ]) or any other syntax
                let newTasks: KanbanTask[];
                newTasks = PresentationParser.parseMarkdownToTasks(fileContent);

                console.log(`[loadNewIncludeContent] Parsed ${newTasks.length} tasks from file`);
                if (newTasks.length > 0) {
                    console.log(`[loadNewIncludeContent] First task title: "${newTasks[0].title?.substring(0, 100)}"`);
                    console.log(`[loadNewIncludeContent] First task description (first 100): "${newTasks[0].description?.substring(0, 100)}"`);
                }

                // Update the column's tasks directly
                console.log(`[loadNewIncludeContent] BEFORE update - column.tasks.length: ${column.tasks?.length || 0}`);
                column.tasks = newTasks;
                console.log(`[loadNewIncludeContent] AFTER update - column.tasks.length: ${column.tasks?.length || 0}`);

                const updateMessage = {
                    type: 'updateColumnContent',
                    columnId: column.id,
                    tasks: newTasks,
                    fileState: fileState,
                    columnTitle: column.title,
                    displayTitle: column.displayTitle,
                    includeMode: column.includeMode,
                    includeFiles: column.includeFiles
                };

                console.log(`[loadNewIncludeContent] ========================================`);
                console.log(`[loadNewIncludeContent] SENDING MESSAGE TO FRONTEND`);
                console.log(`[loadNewIncludeContent] Message type: ${updateMessage.type}`);
                console.log(`[loadNewIncludeContent] Column ID: ${updateMessage.columnId}`);
                console.log(`[loadNewIncludeContent] Tasks count: ${updateMessage.tasks.length}`);
                if (updateMessage.tasks.length > 0) {
                    console.log(`[loadNewIncludeContent] First task in message: "${updateMessage.tasks[0].title?.substring(0, 100)}"`);
                }
                console.log(`[loadNewIncludeContent] ========================================`);

                // Send targeted update message to frontend instead of full refresh
                this.sendMessageToWebview(updateMessage);
                console.log(`[loadNewIncludeContent] Message sent successfully`);

                // Update file watcher to monitor the new include file
                const allIncludePaths = this.getAllIncludeFilePaths();
                fileWatcherUpdater(allIncludePaths);

            } else {
                console.warn(`[LoadNewInclude] Include file not found: ${absolutePath}`);
                // Clear tasks if file doesn't exist
                column.tasks = [];

                // Send targeted update with empty tasks
                this.sendMessageToWebview({
                    type: 'updateColumnContent',
                    columnId: column.id,
                    tasks: [],
                    fileState: fileState,
                    columnTitle: column.title,
                    displayTitle: column.displayTitle,
                    includeMode: column.includeMode,
                    includeFiles: column.includeFiles
                });

                // Still update file watcher even for missing files (in case they get created later)
                const allIncludePaths = this.getAllIncludeFilePaths();
                fileWatcherUpdater(allIncludePaths);
            }
        } catch (error) {
            console.error(`[LoadNewInclude] Error loading new include content:`, error);
        }
    }

    /**
     * Load new content into a task when its include files change
     */
    public async loadNewTaskIncludeContent(task: KanbanTask, newIncludeFiles: string[], documentGetter: () => vscode.TextDocument | undefined): Promise<void> {

        try {
            const currentDocument = documentGetter();
            if (!currentDocument) {
                return;
            }

            const basePath = path.dirname(currentDocument.uri.fsPath);

            // For now, handle single file includes
            const fileState = newIncludeFiles[0];
            const absolutePath = PathResolver.resolve(basePath, fileState);

            // Normalize the path to match keys in _includeFiles map
            const normalizedIncludeFile = this._normalizeIncludePath(fileState);

            // Use shared method to read and update content
            const fileContent = await this.readAndUpdateIncludeContent(absolutePath, normalizedIncludeFile);

            if (fileContent !== null) {
                const lines = fileContent.split('\n');

                // Parse first non-empty line as title, rest as description
                let titleFound = false;
                let newTitle = '';
                let descriptionLines: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!titleFound && line) {
                        newTitle = lines[i]; // Use original line with indentation
                        titleFound = true;
                    } else if (titleFound) {
                        descriptionLines.push(lines[i]);
                    }
                }

                // Update the task with parsed content
                // Keep the original title (with include syntax) and set display properties
                task.includeMode = true;
                task.includeFiles = newIncludeFiles;
                task.originalTitle = task.title; // Preserve the include syntax
                task.displayTitle = newTitle || 'Untitled'; // Title from file
                task.description = descriptionLines.join('\n').trim(); // Description from file

                console.log(`[loadNewTaskIncludeContent] ======== TASK UPDATED AFTER RELOAD ========`);
                console.log(`[loadNewTaskIncludeContent] File: ${normalizedIncludeFile}`);
                console.log(`[loadNewTaskIncludeContent] displayTitle: "${task.displayTitle}"`);
                console.log(`[loadNewTaskIncludeContent] description (first 100): "${task.description.substring(0, 100)}"`);
                console.log(`[loadNewTaskIncludeContent] description length: ${task.description.length}`);

                // Send targeted update message to frontend instead of full refresh
                this.sendMessageToWebview({
                    type: 'updateTaskContent',
                    taskId: task.id,
                    description: task.description,
                    fileState: normalizedIncludeFile,
                    taskTitle: task.title,
                    displayTitle: task.displayTitle,
                    originalTitle: task.originalTitle,
                    includeMode: task.includeMode,
                    includeFiles: task.includeFiles
                });

                // Clear the hasUnsavedChanges flag since we just loaded from external file
                const includeFileEntry = getFileStateManager().getIncludeFileByRelativePath(normalizedIncludeFile);
                if (includeFileEntry) {
                    console.log(`[loadNewTaskIncludeContent] Clearing hasUnsavedChanges for: ${includeFileEntry.relativePath}`);
                    getFileStateManager().markFrontendChange(includeFileEntry.path, false);
                }

            } else {
                console.warn(`[LoadNewTaskInclude] Include file not found: ${absolutePath}`);
                // Clear description if file doesn't exist
                task.description = '';

                // Send targeted update with empty description
                this.sendMessageToWebview({
                    type: 'updateTaskContent',
                    taskId: task.id,
                    description: '',
                    fileState: fileState,
                    taskTitle: task.title,
                    displayTitle: task.displayTitle,
                    originalTitle: task.originalTitle,
                    includeMode: task.includeMode,
                    includeFiles: task.includeFiles
                });
            }
        } catch (error) {
            console.error(`[LoadNewTaskInclude] Error loading new task include content:`, error);
        }
    }

    /**
     * Read and update include content from disk
     */
    public async readAndUpdateIncludeContent(filePath: string, relativePath: string): Promise<string | null> {
        console.log(`[readAndUpdateIncludeContent] ===== LOADING FILE =====`);
        console.log(`[readAndUpdateIncludeContent] filePath: ${filePath}`);
        console.log(`[readAndUpdateIncludeContent] relativePath: ${relativePath}`);

        let updatedContent: string | null = null;
        try {
            if (fs.existsSync(filePath)) {
                updatedContent = fs.readFileSync(filePath, 'utf8');
                console.log(`[readAndUpdateIncludeContent] File loaded, content length: ${updatedContent.length}`);
                console.log(`[readAndUpdateIncludeContent] Content (first 100): "${updatedContent.substring(0, 100)}"`);
            } else {
                console.log(`[readAndUpdateIncludeContent] File does NOT exist: ${filePath}`);
            }
        } catch (error) {
            console.error(`[readAndUpdateIncludeContent] Error reading file:`, error);
            return null;
        }

        // Update the unified system content and baseline
        if (updatedContent !== null) {
            // CRITICAL: Don't reset hasUnsavedChanges when loading external content if user has unsaved changes
            const fileState = getFileStateManager().getIncludeFileByRelativePath(relativePath);
            const preserveUnsavedFlag = fileState?.frontend.hasUnsavedChanges === true;

            console.log(`[readAndUpdateIncludeContent] Updating content, preserveUnsavedFlag: ${preserveUnsavedFlag}`);
            console.log(`[readAndUpdateIncludeContent] fileState exists: ${!!fileState}`);
            if (fileState) {
                console.log(`[readAndUpdateIncludeContent] fileState.frontend.hasUnsavedChanges: ${fileState.frontend.hasUnsavedChanges}`);
                console.log(`[readAndUpdateIncludeContent] fileState.frontend.baseline exists: ${!!fileState.frontend.baseline}`);
            }

            this.updateIncludeFileContent(relativePath, updatedContent, true, preserveUnsavedFlag);

            console.log(`[readAndUpdateIncludeContent] After updateIncludeFileContent, checking if baseline was set...`);
            const fileStateAfter = getFileStateManager().getIncludeFileByRelativePath(relativePath);
            if (fileStateAfter) {
                console.log(`[readAndUpdateIncludeContent] ✅ Baseline set: ${!!fileStateAfter.frontend.baseline}, length: ${fileStateAfter.frontend.baseline?.length || 0}`);
            } else {
                console.log(`[readAndUpdateIncludeContent] ❌ NO fileState found after update!`);
            }
        }

        return updatedContent;
    }

    /**
     * Read file content from disk (internal helper)
     */
    public async _readFileContent(filePath: string, documentGetter: () => vscode.TextDocument | undefined): Promise<string | null> {
        try {
            // Check if it's a relative path and convert to absolute if needed
            let absolutePath = filePath;
            if (!path.isAbsolute(filePath)) {
                const document = documentGetter();
                if (document) {
                    const basePath = path.dirname(document.uri.fsPath);
                    absolutePath = PathResolver.resolve(basePath, filePath);
                }
            }

            const uri = vscode.Uri.file(absolutePath);
            const content = await vscode.workspace.fs.readFile(uri);
            return Buffer.from(content).toString('utf8');
        } catch (error) {
            console.error(`[Include Debug] Failed to read file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Read content from a file on disk
     */
    public async readFileContent(filePath: string): Promise<string | null> {
        try {
            const fsPromises = require('fs').promises;
            const content = await fsPromises.readFile(filePath, 'utf8');
            return content;
        } catch (error) {
            console.warn(`[IncludeFileManager] Could not read file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Refresh include file contents without affecting the board
     * This is used for manual refresh operations, not external file changes
     */
    public async _refreshIncludeFileContents(documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        // Refresh all include files using unified system
        for (const fileState of getFileStateManager().getAllIncludeFiles()) {
            const content = await this._readFileContent(fileState.relativePath, documentGetter);
            if (content !== null) {
                // FIXME: Use FileStateManager.updateContent - fileState.frontend.content = content;
                // FIXME: Use FileStateManager.markSaved - fileState.frontend.baseline = content;
                // FIXME: Use FileStateManager.markFrontendChange - fileState.frontend.hasUnsavedChanges = false;
                // FIXME: Use FileStateManager methods - fileState.backend.lastModified = new Date();
            }
        }
    }

    /**
     * Re-check if any include files have changed after a reload/update operation
     * This ensures that include file change tracking is maintained across document operations
     */
    public async _recheckIncludeFileChanges(usingPreservedBaselines: boolean = false, documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        let hasChanges = false;
        const changedFiles = new Set<string>();

        for (const fileState of getFileStateManager().getAllIncludeFiles()) {
            const currentContent = await this._readFileContent(fileState.relativePath, documentGetter);

            if (currentContent === null || !fileState.frontend.baseline) {
                continue; // Skip this file since we can't compare
            }

            if (currentContent.trim() !== fileState.frontend.baseline.trim()) {
                hasChanges = true;
                changedFiles.add(fileState.relativePath);

                // Update current content but preserve baseline for continuous change detection
                // FIXME: Use FileStateManager.updateContent - fileState.frontend.content = currentContent;
                if (!usingPreservedBaselines) {
                    // FIXME: Use FileStateManager.markSaved - fileState.frontend.baseline = currentContent;
                    // FIXME: Use FileStateManager.markFrontendChange - fileState.frontend.hasUnsavedChanges = false;
                }
            }
        }

        // Update tracking state if changes were found
        if (hasChanges) {

            // Merge with existing changed files (don't clear existing ones)
            for (const file of changedFiles) {

            }
        }
    }

    // ============= SAVING =============

    /**
     * Save column include changes to disk
     */
    public async saveColumnIncludeChanges(column: KanbanColumn, documentGetter: () => vscode.TextDocument | undefined): Promise<boolean> {
        if (!column.includeMode || !column.includeFiles || column.includeFiles.length === 0) {
            return false;
        }

        try {
            const currentDocument = documentGetter();
            if (!currentDocument) {
                return false;
            }

            const basePath = path.dirname(currentDocument.uri.fsPath);

            // For now, handle single file includes (could be extended for multi-file)
            const fileState = column.includeFiles[0];
            const absolutePath = PathResolver.resolve(basePath, fileState);

            // Check if the file exists - if not, this might be a new file path that hasn't been loaded yet
            if (!fs.existsSync(absolutePath)) {
                return false;
            }

            // CRITICAL: Check if the unified system has this include file and if it matches the column
            const unifiedIncludeFile = this._findIncludeFile(fileState);

            if (!unifiedIncludeFile) {
                console.warn('[saveColumnIncludeChanges] No unified include file found for:', fileState);
                return false;
            }

            // Check if we have any tasks to save
            if (column.tasks.length === 0) {
                console.log('[saveColumnIncludeChanges] No tasks to save, skipping');
                return false;
            }

            // Convert tasks back to presentation format
            const presentationContent = PresentationParser.tasksToPresentation(column.tasks);

            // Don't write if the content would be empty or just separators
            if (!presentationContent || presentationContent.trim() === '' || presentationContent.trim() === '---') {
                console.log('[saveColumnIncludeChanges] Empty content, skipping');
                return false;
            }

            // Read current file content to check if it's actually different
            const currentFileContent = fs.readFileSync(absolutePath, 'utf8');

            // Don't write if the generated content is identical to current file
            if (currentFileContent.trim() === presentationContent.trim()) {
                console.log('[saveColumnIncludeChanges] Content unchanged, skipping');
                return false;
            }

            console.log(`[saveColumnIncludeChanges] Saving ${column.tasks.length} tasks to ${fileState}`);

            // Create backup before writing (same protection as main file)
            await this.backupManager.createFileBackup(absolutePath, presentationContent, {
                label: 'auto',
                forceCreate: false
            });

            // Write to file
            await FileWriter.writeFile(absolutePath, presentationContent, {
                createDirs: false,
                showNotification: false
            });

            // Update unified system tracking (reuse the variable we already found)
            if (unifiedIncludeFile) {
                unifiedIncludeFile.frontend.content = presentationContent;
                unifiedIncludeFile.frontend.baseline = presentationContent;
                unifiedIncludeFile.frontend.hasUnsavedChanges = false;
                unifiedIncludeFile.backend.lastModified = new Date();
            }

            // Clear from changed files tracking and update visual indicators

            if (!getFileStateManager().hasUnsavedIncludeFiles()) {

            }

            return true;

        } catch (error) {
            console.error(`[Column Include] Error saving changes to ${column.includeFiles[0]}:`, error);
            vscode.window.showErrorMessage(`Failed to save changes to column include file: ${error}`);
            return false;
        }
    }

    /**
     * Save task include changes to disk
     */
    public async saveTaskIncludeChanges(task: KanbanTask, documentGetter: () => vscode.TextDocument | undefined): Promise<boolean> {
        if (!task.includeMode || !task.includeFiles || task.includeFiles.length === 0) {
            return false;
        }

        try {
            const currentDocument = documentGetter();
            if (!currentDocument) {
                return false;
            }

            const basePath = path.dirname(currentDocument.uri.fsPath);

            // For now, handle single file includes (could be extended for multi-file)
            const fileState = task.includeFiles[0];
            const absolutePath = PathResolver.resolve(basePath, fileState);

            // Check if the file exists - if not, create it
            if (!fs.existsSync(absolutePath)) {
                // Ensure directory exists
                const dir = path.dirname(absolutePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            }

            // Reconstruct file content from task title and description
            let fileContent = '';

            // First line: use displayTitle (the content from the file), not title (which contains include syntax)
            // This matches the column include pattern where displayTitle is the actual content
            const titleToSave = task.displayTitle || '';
            if (titleToSave) {
                fileContent = titleToSave;
            }

            // Remaining lines: task description
            if (task.description && task.description.trim()) {
                if (fileContent) {
                    fileContent += '\n\n'; // Add blank line between title and description
                }
                fileContent += task.description;
            }

            // Don't write if the content would be empty
            if (!fileContent || fileContent.trim() === '') {
                return false;
            }

            // Read current file content to check if it's actually different
            let currentFileContent = '';
            if (fs.existsSync(absolutePath)) {
                currentFileContent = fs.readFileSync(absolutePath, 'utf8');
            }

            // Don't write if the content is identical
            if (currentFileContent.trim() === fileContent.trim()) {
                return false;
            }

            // Create backup before writing (same protection as main file)
            await this.backupManager.createFileBackup(absolutePath, fileContent, {
                label: 'auto',
                forceCreate: false
            });

            // Write to file
            await FileWriter.writeFile(absolutePath, fileContent, {
                createDirs: false,
                showNotification: false
            });

            // Update unified system tracking
            const unifiedIncludeFile = getFileStateManager().getIncludeFileByRelativePath(fileState);
            if (unifiedIncludeFile) {
                unifiedIncludeFile.frontend.content = fileContent;
                unifiedIncludeFile.frontend.baseline = fileContent;
                unifiedIncludeFile.frontend.hasUnsavedChanges = false;
                unifiedIncludeFile.backend.lastModified = new Date();
            }

            // Clear from changed files tracking and update visual indicators

            if (!getFileStateManager().hasUnsavedIncludeFiles()) {

            }

            return true;

        } catch (error) {
            console.error(`[Task Include] Error saving changes to ${task.includeFiles[0]}:`, error);
            vscode.window.showErrorMessage(`Failed to save changes to task include file: ${error}`);
            return false;
        }
    }

    /**
     * Save all modified column includes when the board is saved
     */
    public async saveAllColumnIncludeChanges(documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        const board = this.board();
        if (!board) {
            return;
        }

        const includeColumns = board.columns.filter(col => col.includeMode);

        // Filter out columns whose include files were recently reloaded from external
        const columnsToSave = includeColumns.filter(col => {
            if (!col.includeFiles || col.includeFiles.length === 0) {
                return true; // No include files to check
            }

            // Check if any of the column's include files were recently reloaded
            return !col.includeFiles.some(file => {
                // Use helper method for consistent path comparison
                return Array.from(this._recentlyReloadedFiles).some(reloadedPath =>
                    this._isSameIncludePath(file, reloadedPath)
                );
            });
        });

        const savePromises = columnsToSave.map(col => this.saveColumnIncludeChanges(col, documentGetter));

        try {
            await Promise.all(savePromises);
        } catch (error) {
            console.error('[Column Include] Error saving column include changes:', error);
        }
    }

    /**
     * Save all modified task includes when the board is saved
     */
    public async saveAllTaskIncludeChanges(documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        const board = this.board();
        if (!board) {
            return;
        }

        // Collect all tasks with include mode from all columns
        const includeTasks: KanbanTask[] = [];
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeMode) {
                    // Check if any of the task's include files were recently reloaded
                    const shouldSkip = task.includeFiles?.some(file => {
                        // Use helper method for consistent path comparison
                        return Array.from(this._recentlyReloadedFiles).some(reloadedPath =>
                            this._isSameIncludePath(file, reloadedPath)
                        );
                    });

                    if (!shouldSkip) {
                        includeTasks.push(task);
                    }
                }
            }
        }

        if (includeTasks.length === 0) {
            return;
        }

        const savePromises = includeTasks.map(task => this.saveTaskIncludeChanges(task, documentGetter));

        try {
            await Promise.all(savePromises);
        } catch (error) {
            console.error('[Task Include] Error saving task include changes:', error);
        }
    }

    /**
     * Save current kanban changes to include file
     */
    public async saveIncludeFileChanges(filePath: string, documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        const board = this.board();
        if (!board) {
            return;
        }

        const currentDocument = documentGetter();
        if (!currentDocument) {
            return;
        }

        const basePath = path.dirname(currentDocument.uri.fsPath);
        let relativePath: string;

        // Handle both absolute and relative paths
        if (path.isAbsolute(filePath)) {
            relativePath = path.relative(basePath, filePath);
        } else {
            relativePath = filePath;
        }

        // Check column includes - use helper method for path comparison
        for (const column of board.columns) {
            if (column.includeMode && column.includeFiles) {
                // Check if any of the stored paths match our target file
                const hasMatch = column.includeFiles.some(storedPath =>
                    this._isSameIncludePath(storedPath, relativePath)
                );

                if (hasMatch) {
                    await this.saveColumnIncludeChanges(column, documentGetter);
                    return; // Found and saved column include
                }
            }
        }

        // Check task includes - use helper method for path comparison
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeMode && task.includeFiles) {
                    // Check if any of the stored paths match our target file
                    const hasMatch = task.includeFiles.some(storedPath =>
                        this._isSameIncludePath(storedPath, relativePath)
                    );

                    if (hasMatch) {
                        // Save task include content
                        await this.saveTaskIncludeChanges(task, documentGetter);

                        // Also clear the unsaved changes flag in unified system
                        const fileState = this._findIncludeFile(relativePath);
                        if (fileState) {
                            // FIXME: Use FileStateManager.markFrontendChange - fileState.frontend.hasUnsavedChanges = false;
                        }

                        return; // Found and saved task include
                    }
                }
            }
        }
    }

    /**
     * Save include file changes before external reload
     */
    public async saveIncludeFileAsBackup(filePath: string, documentGetter: () => vscode.TextDocument | undefined, openFileCallback: (path: string) => Promise<void>): Promise<void> {
        const board = this.board();
        if (!board) {
            return;
        }

        // Find the column that uses this include file and save its content as backup
        const currentDocument = documentGetter();
        if (!currentDocument) {
            return;
        }

        const basePath = path.dirname(currentDocument.uri.fsPath);
        const relativePath = path.relative(basePath, filePath);

        for (const column of board.columns) {
            // Check column includes using helper method for consistent path comparison
            if (column.includeMode && column.includeFiles?.some(file => this._isSameIncludePath(file, relativePath))) {
                const presentationContent = PresentationParser.tasksToPresentation(column.tasks);

                // Use BackupManager for consistent backup creation
                const backupPath = await this.backupManager.createFileBackup(filePath, presentationContent, {
                    label: 'conflict',
                    forceCreate: true
                });

                if (backupPath) {
                    vscode.window.showInformationMessage(
                        `Backup saved as "${path.basename(backupPath)}"`,
                        'Open backup file'
                    ).then(async choice => {
                        if (choice === 'Open backup file') {
                            await openFileCallback(backupPath);
                        }
                    });
                }
                return; // Found and handled column include
            }

            // Check task includes using helper method for consistent path comparison
            for (const task of column.tasks) {
                if (task.includeMode && task.includeFiles?.some(file => this._isSameIncludePath(file, relativePath))) {
                    // Reconstruct what the file content should be from task data
                    let expectedContent = '';
                    if (task.displayTitle) {
                        expectedContent = task.displayTitle;
                    }
                    if (task.description && task.description.trim()) {
                        if (expectedContent) {
                            expectedContent += '\n\n';
                        }
                        expectedContent += task.description;
                    }

                    // Use BackupManager for consistent backup creation
                    const backupPath = await this.backupManager.createFileBackup(filePath, expectedContent, {
                        label: 'conflict',
                        forceCreate: true
                    });

                    if (backupPath) {
                        vscode.window.showInformationMessage(
                            `Backup saved as "${path.basename(backupPath)}"`,
                            'Open backup file'
                        ).then(async choice => {
                            if (choice === 'Open backup file') {
                                await openFileCallback(backupPath);
                            }
                        });
                    }
                    return; // Found and handled task include
                }
            }
        }
    }

    // ============= CHANGE DETECTION =============

    /**
     * Check if a column's include files have unsaved changes
     */
    public async checkColumnIncludeUnsavedChanges(column: KanbanColumn): Promise<boolean> {
        if (!column.includeMode || !column.includeFiles || column.includeFiles.length === 0) {
            return false;
        }

        const fileState = column.includeFiles[0];
        const unifiedIncludeFile = this._findIncludeFile(fileState);

        // Check if this file has unsaved changes using unified system
        return unifiedIncludeFile?.frontend.hasUnsavedChanges === true;
    }

    /**
     * Check if a task's include files have unsaved changes
     */
    public async checkTaskIncludeUnsavedChanges(task: KanbanTask): Promise<boolean> {
        if (!task.includeMode || !task.includeFiles || task.includeFiles.length === 0) {
            return false;
        }

        const fileState = task.includeFiles[0];
        const unifiedIncludeFile = this._findIncludeFile(fileState);

        // Check if this file has unsaved changes using unified system
        return unifiedIncludeFile?.frontend.hasUnsavedChanges === true;
    }

    /**
     * Check if a specific include file has unsaved changes
     */
    public hasUnsavedIncludeFileChanges(relativePath: string): boolean {
        const unifiedIncludeFile = getFileStateManager().getIncludeFileByRelativePath(relativePath);
        return unifiedIncludeFile?.frontend.hasUnsavedChanges === true;
    }

    /**
     * Track unsaved changes in include files when board is modified
     * @returns true if ONLY include files have changes (no main file changes), false otherwise
     */
    public async trackIncludeFileUnsavedChanges(board: KanbanBoard, documentGetter: () => vscode.TextDocument | undefined, getMainFilePath: () => string | undefined): Promise<boolean> {
        console.log('[trackIncludeFileUnsavedChanges] ===== FUNCTION ENTRY =====');
        if (!board.columns) {
            console.log('[trackIncludeFileUnsavedChanges] No columns in board');
            return false;
        }

        // Use getFilePath() instead of getDocument() - it persists even when document is cleared
        const mainFilePath = getMainFilePath();
        if (!mainFilePath) {
            console.log('[trackIncludeFileUnsavedChanges] No main file path');
            return false;
        }

        const fileStateManager = getFileStateManager();
        const basePath = path.dirname(mainFilePath);
        console.log('[trackIncludeFileUnsavedChanges] mainFilePath:', mainFilePath);
        let hasIncludeChanges = false;
        let hasMainFileChanges = false;

        console.log('[trackIncludeFileUnsavedChanges] basePath:', basePath);
        console.log('[trackIncludeFileUnsavedChanges] Checking', board.columns.length, 'columns');

        // Check each column that has include mode enabled
        for (const column of board.columns) {
            if (column.includeMode && column.includeFiles && column.includeFiles.length > 0) {
                for (const includePath of column.includeFiles) {
                    const absolutePath = PathResolver.resolve(basePath, includePath);

                    // CRITICAL: Normalize the path to match keys in _includeFiles map
                    const normalizedIncludeFile = this._normalizeIncludePath(includePath);

                    // Get or create include file in unified system (this loads content with proper baseline)
                    const unifiedIncludeFile = this.getOrCreateIncludeFile(normalizedIncludeFile, 'column', documentGetter);

                    // Use the baseline from FileStateManager (it was set by getOrCreateIncludeFile)
                    const effectiveBaseline = unifiedIncludeFile.frontend.baseline;

                    const currentPresentationContent = column.tasks.length > 0
                        ? PresentationParser.tasksToPresentation(column.tasks)
                        : '';

                    // CRITICAL: Only compare if we have a valid baseline
                    // During initial load, baseline might not be set yet, so we skip comparison to avoid false positives
                    if (effectiveBaseline && effectiveBaseline.trim() !== currentPresentationContent.trim()) {
                        // Mark frontend changes in FileStateManager
                        fileStateManager.markFrontendChange(absolutePath, true, currentPresentationContent);
                        hasIncludeChanges = true;

                        // Keep legacy tracking for compatibility
                        const unifiedIncludeFile = getFileStateManager().getIncludeFileByRelativePath(normalizedIncludeFile);
                        if (unifiedIncludeFile) {
                            unifiedIncludeFile.frontend.hasUnsavedChanges = true;

                            // CRITICAL: Also synchronize to FileStateManager for recovery
                            fileStateManager.markFrontendChange(absolutePath, true, currentPresentationContent);



                        }
                    } else {
                        // Clear frontend changes in FileStateManager
                        fileStateManager.markFrontendChange(absolutePath, false);

                        // Clear legacy tracking
                        if (unifiedIncludeFile && unifiedIncludeFile.frontend.hasUnsavedChanges) {
                            unifiedIncludeFile.frontend.hasUnsavedChanges = false;


                            if (!getFileStateManager().hasUnsavedIncludeFiles()) {

                            }
                        }
                    }
                }
            }

            // Check each task that has include mode enabled
            for (const task of column.tasks) {
                if (task.includeMode && task.includeFiles && task.includeFiles.length > 0) {
                    console.log('[trackIncludeFileUnsavedChanges] Found task with includeMode:', {
                        title: task.title,
                        displayTitle: task.displayTitle,
                        descriptionLength: task.description?.length || 0,
                        includeFiles: task.includeFiles
                    });

                    for (const includePath of task.includeFiles) {
                        const absolutePath = PathResolver.resolve(basePath, includePath);

                        // CRITICAL: Normalize the path to match keys in _includeFiles map
                        const normalizedIncludeFile = this._normalizeIncludePath(includePath);

                        console.log('[trackIncludeFileUnsavedChanges] Processing task include:', normalizedIncludeFile);

                        // Get or create include file in unified system (this loads content with proper baseline)
                        const unifiedIncludeFile = this.getOrCreateIncludeFile(normalizedIncludeFile, 'task', documentGetter);

                        // Use the baseline from FileStateManager (it was set by getOrCreateIncludeFile)
                        const effectiveBaseline = unifiedIncludeFile.frontend.baseline;
                        console.log('[trackIncludeFileUnsavedChanges] effectiveBaseline length:', effectiveBaseline?.length || 0);

                        // Reconstruct what the file content should be from task data
                        // CRITICAL: Must match the parsing format in loadNewTaskIncludeContent (lines 3177-3185)
                        // File format: Title\nDescription (single newline, no blank line)
                        let expectedContent = '';
                        if (task.displayTitle) {
                            expectedContent = task.displayTitle;
                        }
                        if (task.description && task.description.trim()) {
                            if (expectedContent) {
                                expectedContent += '\n'; // Single newline to match file format
                            }
                            expectedContent += task.description;
                        }

                        console.log(`[trackIncludeFileUnsavedChanges] ========================================`);
                        console.log(`[trackIncludeFileUnsavedChanges] Task include file: ${includePath}`);
                        console.log(`[trackIncludeFileUnsavedChanges] Baseline (first 100 chars): "${effectiveBaseline?.substring(0, 100)}"`);
                        console.log(`[trackIncludeFileUnsavedChanges] Expected (first 100 chars): "${expectedContent.substring(0, 100)}"`);
                        console.log(`[trackIncludeFileUnsavedChanges] Baseline length: ${effectiveBaseline?.length}`);
                        console.log(`[trackIncludeFileUnsavedChanges] Expected length: ${expectedContent.length}`);
                        console.log(`[trackIncludeFileUnsavedChanges] Match (after trim): ${effectiveBaseline?.trim() === expectedContent.trim()}`);

                        // CRITICAL: Only compare if we have a valid baseline
                        // During initial load, baseline might not be set yet, so we skip comparison to avoid false positives
                        if (effectiveBaseline && effectiveBaseline.trim() !== expectedContent.trim()) {
                            console.log(`[trackIncludeFileUnsavedChanges] ✅ DETECTED CHANGE - Marking as unsaved`);
                            // Mark frontend changes in FileStateManager
                            fileStateManager.markFrontendChange(absolutePath, true, expectedContent);
                            hasIncludeChanges = true;

                            // Keep legacy tracking for compatibility
                            if (unifiedIncludeFile) {
                                unifiedIncludeFile.frontend.hasUnsavedChanges = true;
                                console.log(`[trackIncludeFileUnsavedChanges] Set unifiedIncludeFile.frontend.hasUnsavedChanges = true`);

                                // CRITICAL: Also synchronize to FileStateManager for recovery
                                fileStateManager.markFrontendChange(absolutePath, true, expectedContent);



                            }
                        } else {
                            console.log(`[trackIncludeFileUnsavedChanges] ❌ NO CHANGE - Clearing unsaved flag (effectiveBaseline exists: ${!!effectiveBaseline})`);
                            // Clear frontend changes in FileStateManager
                            fileStateManager.markFrontendChange(absolutePath, false);

                            // Clear legacy tracking
                            if (unifiedIncludeFile && unifiedIncludeFile.frontend.hasUnsavedChanges) {
                                unifiedIncludeFile.frontend.hasUnsavedChanges = false;
                                console.log(`[trackIncludeFileUnsavedChanges] Cleared unifiedIncludeFile.frontend.hasUnsavedChanges`);

                                if (!getFileStateManager().hasUnsavedIncludeFiles()) {

                                }
                            }
                        }
                    }
                }
            }
        }

        // Return true if ONLY include files have changes
        // This means: include files changed, but main kanban structure did NOT change

        // If no include changes, then main file changed
        if (!hasIncludeChanges) {
            console.log('[trackIncludeFileUnsavedChanges] ===== NO INCLUDE CHANGES DETECTED - Returning false =====');
            return false;
        }

        console.log('[trackIncludeFileUnsavedChanges] ===== INCLUDE CHANGES DETECTED - Checking if main file also changed =====');

        // We have include changes. Now check if main file ALSO changed.
        // The main file stores: column structure, titles, tags, metadata, include file paths
        // But NOT the actual content from includes (that's in the include files)

        // To check if main file changed, we'll generate the markdown and compare with current file
        try {
            // Get the current document to read its content
            const { MarkdownKanbanParser } = require('./markdownParser');
            const currentDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(mainFilePath));

            // Generate markdown from current board
            const generatedMarkdown = MarkdownKanbanParser.generateMarkdown(board);
            const currentFileContent = currentDocument.getText();

            // If markdown is identical, then ONLY includes changed (main file unchanged)
            const mainFileUnchanged = generatedMarkdown.trim() === currentFileContent.trim();

            if (mainFileUnchanged) {
                console.log('[trackIncludeFileUnsavedChanges] Only include files changed, main file unchanged');
                return true; // Only includes changed
            } else {
                console.log('[trackIncludeFileUnsavedChanges] Both main file and include files changed');
                return false; // Both main and includes changed
            }
        } catch (error) {
            console.error('[trackIncludeFileUnsavedChanges] Error comparing main file:', error);
            return false; // Assume main file changed if we can't compare
        }
    }

    /**
     * Check for external changes in include files
     */
    public async checkForExternalIncludeFileChanges(showConflictDialogCallback: (context: ConflictContext) => Promise<any>): Promise<boolean> {
        const board = this.board();
        if (!board) {
            return true;
        }

        // Check all include files using unified system
        for (const fileState of getFileStateManager().getAllIncludeFiles()) {
            // Skip if file doesn't exist
            if (!fs.existsSync(fileState.path)) {
                continue;
            }

            // Read current file content
            const currentFileContent = fs.readFileSync(fileState.path, 'utf8');

            // Check for external changes using unified system
            if (fileState.frontend.baseline && fileState.frontend.baseline.trim() !== currentFileContent.trim()) {
                if (fileState.frontend.hasUnsavedChanges) {
                    // We have both internal changes and external changes - conflict!
                    const fileName = path.basename(fileState.path);
                    const context: ConflictContext = {
                        type: 'presave_check',
                        fileType: 'include',
                        filePath: fileState.path,
                        fileName: fileName,
                        hasMainUnsavedChanges: false,
                        hasIncludeUnsavedChanges: true,
                        changedIncludeFiles: [fileState.path]
                    };

                    try {
                        const resolution = await showConflictDialogCallback(context);
                        if (!resolution || !resolution.shouldProceed) {
                            return false; // User chose not to proceed
                        }
                        // If user chose to proceed, update our baseline to the external version
                        // FIXME: Use FileStateManager.markSaved - fileState.frontend.baseline = currentFileContent;
                    } catch (error) {
                        console.error(`[checkForExternalIncludeFileChanges] Error in include file conflict resolution for ${fileState.relativePath}:`, error);
                        return false;
                    }
                } else {
                    // External changes but no internal changes - update our baseline
                    // FIXME: Use FileStateManager.markSaved - fileState.frontend.baseline = currentFileContent;
                    // FIXME: Use FileStateManager.updateContent - fileState.frontend.content = currentFileContent;
                }
            }
        }

        return true; // All include file checks passed
    }

    /**
     * Check if an include file has external changes (content differs from baseline)
     */
    public hasExternalChanges(relativePath: string): boolean {
        const fileState = getFileStateManager().getIncludeFileByRelativePath(relativePath);
        if (!fileState || !fileState.frontend.baseline) {
            return true; // No baseline means treat as external change
        }

        // Read current file content from disk to check for external changes
        try {
            const currentFileContent = fs.existsSync(fileState.path)
                ? fs.readFileSync(fileState.path, 'utf8')
                : '';
            return fileState.frontend.baseline.trim() !== currentFileContent.trim();
        } catch (error) {
            console.error(`[hasExternalChanges] Error reading file ${fileState.path}:`, error);
            return true; // Assume external change if we can't read the file
        }
    }

    /**
     * Check if provided content differs from baseline (has external changes)
     * This version doesn't read the file, it uses the provided content
     */
    public hasExternalChangesForContent(relativePath: string, externalContent: string): boolean {
        const fileState = getFileStateManager().getIncludeFileByRelativePath(relativePath);
        if (!fileState || !fileState.frontend.baseline) {
            return true; // No baseline means treat as external change
        }

        return fileState.frontend.baseline.trim() !== externalContent.trim();
    }

    // ============= UPDATES & CONFLICT =============

    /**
     * UNIFIED ENTRY POINT for all include content updates
     * This method MUST be used for all include content changes to ensure proper conflict detection
     */
    public async updateIncludeContentUnified(
        column: KanbanColumn,
        newIncludeFiles: string[],
        source: 'external_file_change' | 'column_title_edit' | 'manual_refresh' | 'conflict_resolution',
        documentGetter: () => vscode.TextDocument | undefined,
        fileWatcherUpdater: (paths: string[]) => void
    ): Promise<void> {

        // For external file changes, we MUST go through conflict detection
        if (source === 'external_file_change') {
            throw new Error('External file changes must go through handleIncludeFileConflict for proper conflict detection');
        }

        // For all other sources, proceed with direct update
        await this.loadNewIncludeContent(column, newIncludeFiles, documentGetter, fileWatcherUpdater);
    }

    /**
     * Unified method to update any type of include file
     */
    public async updateIncludeFile(filePath: string, isColumnInclude: boolean, isTaskInclude: boolean, skipConflictDetection: boolean = false): Promise<void> {
        console.log('[updateIncludeFile] ===== ENTRY =====');
        console.log(`[updateIncludeFile] filePath: ${filePath}`);
        console.log(`[updateIncludeFile] isTaskInclude: ${isTaskInclude}, skipConflictDetection: ${skipConflictDetection}`);

        const board = this.board();
        if (!board) {
            console.log('[updateIncludeFile] No board - returning early');
            return;
        }

        // FIXED: Use getFilePath() instead of getDocument() - document can be undefined
        const mainFilePathStr = this.mainFilePath();
        if (!mainFilePathStr) {
            console.log('[updateIncludeFile] No main file path - returning early');
            return;
        }
        console.log(`[updateIncludeFile] mainFilePath: ${mainFilePathStr}`);

        const basePath = path.dirname(mainFilePathStr);
        let relativePath = path.relative(basePath, filePath);
        console.log(`[updateIncludeFile] relativePath (computed): ${relativePath}`);

        // Normalize path format to match how includes are stored (with ./ prefix for relative paths)
        if (!path.isAbsolute(relativePath) && !relativePath.startsWith('.')) {
            relativePath = './' + relativePath;
        }

        if (isColumnInclude) {
            // Handle column includes using existing system
            for (const column of board.columns) {
                // Use helper method for consistent path comparison
                const hasFile = column.includeMode && column.includeFiles?.some(file =>
                    this._isSameIncludePath(file, relativePath)
                );
                if (hasFile) {
                    // Note: updateIncludeContentUnified needs to be called from KanbanWebviewPanel
                    // This method will need to be called externally
                    break;
                }
            }
        } else if (isTaskInclude) {
            // Handle task includes - need to find and update the specific task with conflict detection
            for (const column of board.columns) {
                for (const task of column.tasks) {
                    // Use helper method for consistent path comparison
                    const hasFile = task.includeMode && task.includeFiles?.some(file =>
                        this._isSameIncludePath(file, relativePath)
                    );
                    if (hasFile) {
                        if (skipConflictDetection) {
                            // Skip conflict detection and update directly (already resolved)
                            // Note: loadNewTaskIncludeContent needs documentGetter which comes from caller
                        } else {
                            // Use task-specific conflict detection
                            // Note: This needs to be handled externally
                        }
                        return; // Found and updated the task
                    }
                }
            }
        } else {
            // Handle regular includes using unified system
            const updatedContent = await this.readAndUpdateIncludeContent(filePath, relativePath);

            // Send updated content to frontend only if content was successfully read
            if (updatedContent !== null) {
                this.sendMessageToWebview({
                    type: 'updateIncludeContent',
                    filePath: relativePath,
                    content: updatedContent
                });

                // NOTE: Don't send includesUpdated message here as it causes redundant renders
                // The frontend will re-render when it receives the updateIncludeContent message
            }
        }
    }

    /**
     * Update an inline include file by reading content and sending to frontend
     */
    public async updateInlineIncludeFile(absolutePath: string, relativePath: string): Promise<void> {
        try {
            let updatedContent: string | null = null;
            if (fs.existsSync(absolutePath)) {
                updatedContent = fs.readFileSync(absolutePath, 'utf8');
            }

            // Update the unified system
            const fileState = getFileStateManager().getIncludeFileByRelativePath(relativePath);
            if (fileState && updatedContent !== null) {
                // FIXME: Use FileStateManager.updateContent - fileState.frontend.content = updatedContent;
                // FIXME: Use FileStateManager.markSaved - fileState.frontend.baseline = updatedContent;
                // FIXME: Use FileStateManager.markFrontendChange - fileState.frontend.hasUnsavedChanges = false;
                // FIXME: Use FileStateManager methods - fileState.backend.lastModified = new Date();
            }

            // Send updated content to frontend
            this.sendMessageToWebview({
                type: 'includeFileContent',
                filePath: relativePath,
                content: updatedContent
            });

        } catch (error) {
            console.error('[InlineInclude] Error updating inline include file:', error);
        }
    }

    /**
     * Update task include with conflict detection
     */
    public async updateTaskIncludeWithConflictDetection(task: KanbanTask, relativePath: string, documentGetter: () => vscode.TextDocument | undefined, handleConflictCallback: (filePath: string, changeType: string) => Promise<void>): Promise<void> {
        try {
            const currentDocument = documentGetter();
            if (!currentDocument) {
                return;
            }

            const basePath = path.dirname(currentDocument.uri.fsPath);
            const absolutePath = PathResolver.resolve(basePath, relativePath);

            // Normalize the path to match keys in _includeFiles map
            const normalizedPath = this._normalizeIncludePath(relativePath);

            // Get or create the include file entry
            const unifiedIncludeFile = this.getOrCreateIncludeFile(normalizedPath, 'task', documentGetter);

            // Check if there are unsaved changes that would be overwritten
            if (unifiedIncludeFile?.frontend.hasUnsavedChanges === true) {
                // Show conflict dialog just like column includes
                await handleConflictCallback(absolutePath, normalizedPath);
            } else {
                // No conflicts, proceed with direct update
                await this.loadNewTaskIncludeContent(task, [relativePath], documentGetter);
            }
        } catch (error) {
            console.error(`[TASK-CONFLICT-ERROR] Error in updateTaskIncludeWithConflictDetection:`, error);
        }
    }

    /**
     * Save modifications from task includes back to their original files
     * This enables bidirectional editing for task includes
     */
    public async reprocessTaskIncludes(documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        const board = this.board();
        if (!board) {
            return;
        }

        const currentDocument = documentGetter();
        if (!currentDocument) {
            return;
        }

        const basePath = path.dirname(currentDocument.uri.fsPath);

        // Process task includes in the current board
        let tasksProcessed = 0;
        for (const column of board.columns) {
            for (const task of column.tasks) {
                tasksProcessed++;
                // Check if task title contains taskinclude syntax
                const taskIncludeMatches = task.title.match(/!!!taskinclude\(([^)]+)\)!!!/g);

                if (taskIncludeMatches && taskIncludeMatches.length > 0) {

                    // Process this task as a task include
                    const includeFiles: string[] = [];
                    taskIncludeMatches.forEach(match => {
                        const filePath = match.replace(/!!!taskinclude\(([^)]+)\)!!!/, '$1').trim();
                        includeFiles.push(filePath);
                    });

                    // Read content from included files
                    let includeTitle = '';
                    let includeDescription = '';

                    for (const filePath of includeFiles) {
                        const resolvedPath = PathResolver.resolve(basePath, filePath);
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
                                    } else if (titleFound) {
                                        descriptionLines.push(lines[i]);
                                    }
                                }

                                // Join remaining lines as description
                                includeDescription = descriptionLines.join('\n').trim();

                            } else {
                                console.warn(`[ReprocessTaskIncludes] File not found: ${resolvedPath}`);
                            }
                        } catch (error) {
                            console.error(`[ReprocessTaskIncludes] Error processing ${filePath}:`, error);
                        }
                    }

                    // If no title found in file, use filename
                    if (!includeTitle && includeFiles.length > 0) {
                        const pathModule = require('path');
                        includeTitle = pathModule.basename(includeFiles[0], pathModule.extname(includeFiles[0]));
                    }

                    // Update task properties for include mode
                    task.includeMode = true;
                    task.includeFiles = includeFiles;
                    task.originalTitle = task.title; // Keep original title with include syntax
                    task.displayTitle = includeTitle || 'Untitled'; // Display title from file
                    task.description = includeDescription; // Description from file

                    // Send targeted update to frontend for this specific task
                    this.sendMessageToWebview({
                        type: 'updateTaskContent',
                        taskId: task.id,
                        taskTitle: task.title, // Contains include syntax
                        displayTitle: task.displayTitle, // Content from file
                        description: task.description, // Description from file
                        includeMode: task.includeMode,
                        includeFiles: task.includeFiles
                    });
                }
            }
        }

        // Send targeted update to frontend instead of full board refresh
        // This mimics how column includes work - only update the affected elements
    }

    /**
     * Handle conflicts when include files are changed externally
     */
    public async handleIncludeFileConflict(filePath: string, changeType: string, documentGetter: () => vscode.TextDocument | undefined, showConflictDialogCallback: (context: ConflictContext) => Promise<any>): Promise<void> {
        console.log(`[handleIncludeFileConflict] ENTRY - filePath: ${filePath}, changeType: ${changeType}`);
        const fileName = path.basename(filePath);
        console.log(`[handleIncludeFileConflict] START - File: ${fileName}`);

        // Get the relative path for unified system lookup
        // Use getFilePath() fallback since document might be null
        const currentDocument = documentGetter();
        const mainFilePathStr = currentDocument?.uri.fsPath || this.mainFilePath();

        if (!mainFilePathStr) {
            console.log(`[handleIncludeFileConflict] No main file path available, aborting`);
            return;
        }

        console.log(`[handleIncludeFileConflict] Main file path: ${mainFilePathStr}`);
        const basePath = path.dirname(mainFilePathStr);
        const relativePath = path.relative(basePath, filePath);

        // Get the include file from unified system using helper method
        const fileState = this._findIncludeFile(relativePath);
        if (!fileState) {
            return;
        }

        // Get file state manager instance for API calls
        const fileStateManager = getFileStateManager();

        // Don't process include file changes if we're currently updating from the panel
        // But only for column/task includes (!!!columninclude/!!!taskinclude) which can be edited internally
        // Regular includes (!!!include) should always auto-reload since they cannot be modified internally
        if (this.isUpdatingFromPanel() && (FileStateManager.getLegacyType(fileState.fileType) === 'column' || FileStateManager.getLegacyType(fileState.fileType) === 'task')) {
            return;
        }

        // SPEC: Regular includes (!!!include) ALWAYS auto-reload - they cannot be edited internally
        if (fileState.fileType === 'include-regular') {
            console.log('[handleIncludeFileConflict] Regular include file - ALWAYS auto-reload');
            const hasExternalChanges = this.hasExternalChanges(relativePath);
            if (hasExternalChanges) {
                await this.updateIncludeFile(filePath, false, false, true);
            }
            return;
        }

        // For column/task includes: Check both unsaved changes AND edit mode
        const hasUnsavedIncludeChanges = fileState.frontend.hasUnsavedChanges;
        const isInEditMode = fileStateManager.isInEditMode(fileState.path);

        // console.log(`[handleIncludeFileConflict] ========================================`);
        // console.log(`[handleIncludeFileConflict] File: ${fileName}`);
        // console.log(`[handleIncludeFileConflict] fileType: ${fileState.fileType}`);
        // console.log(`[handleIncludeFileConflict] frontend.hasUnsavedChanges: ${hasUnsavedIncludeChanges}`);
        // console.log(`[handleIncludeFileConflict] frontend.isInEditMode: ${isInEditMode}`);
        // console.log(`[handleIncludeFileConflict] backend.isDirtyInEditor: ${fileState.backend.isDirtyInEditor} (not checked - kanban only tracks frontend unsaved changes)`);
        // console.log(`[handleIncludeFileConflict] backend.hasFileSystemChanges: ${fileState.backend.hasFileSystemChanges}`);
        // console.log(`[handleIncludeFileConflict] fileState.path: ${fileState.path}`);
        // console.log(`[handleIncludeFileConflict] fileState.relativePath: ${fileState.relativePath}`);

        // Check if the external file has actually changed
        const hasExternalChanges = this.hasExternalChanges(relativePath);
        console.log(`[handleIncludeFileConflict] hasExternalChanges: ${hasExternalChanges}`);

        // CASE 1: No unsaved changes AND not in edit mode + external changes = Auto-reload immediately (no dialog)
        // This is SAFE because there are no unsaved changes to lose and user is not actively editing
        if (!hasUnsavedIncludeChanges && !isInEditMode && hasExternalChanges) {
            console.log('[handleIncludeFileConflict] CASE 1: Auto-reload (no unsaved changes, not in edit mode)');
            // Safe auto-reload: update internal content to match external file
            await this.updateIncludeFile(filePath, FileStateManager.getLegacyType(fileState.fileType) === 'column', FileStateManager.getLegacyType(fileState.fileType) === 'task', true);
            return;
        }

        // console.log('[handleIncludeFileConflict] CASE 2: Has unsaved changes or is in edit mode or no external changes initially');

        // CASE 2: Has unsaved changes OR is in edit mode - need to show conflict dialog
        // CRITICAL: Only READ the external content, don't update anything yet
        // We must preserve the internal changes until the user makes a decision
        let externalContent: string | null = null;
        try {
            if (fs.existsSync(filePath)) {
                externalContent = fs.readFileSync(filePath, 'utf8');
            }
        } catch (error) {
            console.error(`[handleIncludeFileConflict] Error reading external file:`, error);
            return;
        }

        if (externalContent === null) {
            return;
        }

        // Check if external content differs from baseline (has external changes)
        const hasExternalChangesForContent = this.hasExternalChangesForContent(fileState.relativePath, externalContent);

        // If no real external changes, no need for conflict dialog
        if (!hasExternalChangesForContent) {
            console.log('[handleIncludeFileConflict] No actual external changes detected, skipping conflict dialog');
            return;
        }

        // Show conflict dialog via callback
        const context: ConflictContext = {
            type: 'external_include',
            fileType: 'include',
            filePath: filePath,
            fileName: fileName,
            hasMainUnsavedChanges: false,
            hasIncludeUnsavedChanges: hasUnsavedIncludeChanges,
            changedIncludeFiles: [filePath]
        };

        try {
            const resolution = await showConflictDialogCallback(context);
            // Resolution is handled by the caller (KanbanWebviewPanel)
        } catch (error) {
            console.error(`[handleIncludeFileConflict] Error showing conflict dialog:`, error);
        }
    }

    // ============= TYPE DETECTION & HELPERS =============

    /**
     * Check if a file path is used as a column include file
     */
    public async isColumnIncludeFile(filePath: string): Promise<boolean> {
        console.log(`[isColumnIncludeFile] Checking: ${filePath}`);

        // Use _cachedBoardFromWebview if available (reflects current webview state with unsaved changes)
        const cachedBoard = this.cachedBoardFromWebview();
        const board = cachedBoard || this.board();
        if (!board) {
            console.log(`[isColumnIncludeFile] No board available`);
            return false;
        }

        // Get base path from document OR from file manager's persisted file path
        const mainFilePathStr = this.mainFilePath();

        if (!mainFilePathStr) {
            console.log(`[isColumnIncludeFile] No current document or file path`);
            return false;
        }

        console.log(`[isColumnIncludeFile] Base file path: ${mainFilePathStr}`);
        const basePath = path.dirname(mainFilePathStr);
        let relativePath = path.relative(basePath, filePath);

        // Normalize path format to match how includes are stored (with ./ prefix for relative paths)
        if (!path.isAbsolute(relativePath) && !relativePath.startsWith('.')) {
            relativePath = './' + relativePath;
        }

        console.log(`[isColumnIncludeFile] Relative path: ${relativePath}`);
        console.log(`[isColumnIncludeFile] Board has ${board.columns.length} columns`);

        // Check if any column uses this file as an include file
        for (const column of board.columns) {
            if (column.includeMode && column.includeFiles) {
                console.log(`[isColumnIncludeFile] Column "${column.title}" has includes:`, column.includeFiles);
                // Use helper method for consistent path comparison
                const hasMatch = column.includeFiles.some((file: string) => {
                    const matches = this._isSameIncludePath(file, relativePath);
                    console.log(`[isColumnIncludeFile] Comparing "${file}" with "${relativePath}": ${matches}`);
                    return matches;
                });
                if (hasMatch) {
                    console.log(`[isColumnIncludeFile] MATCH FOUND!`);
                    return true;
                }
            }
        }
        console.log(`[isColumnIncludeFile] No match found`);
        return false;
    }

    /**
     * Check if a file path is used as a task include file
     */
    public async isTaskIncludeFile(filePath: string): Promise<boolean> {
        console.log(`[isTaskIncludeFile] Checking: ${filePath}`);

        // Use _cachedBoardFromWebview if available (reflects current webview state with unsaved changes)
        const cachedBoard = this.cachedBoardFromWebview();
        const board = cachedBoard || this.board();
        if (!board) {
            console.log(`[isTaskIncludeFile] No board available`);
            return false;
        }

        // Get base path from document OR from file manager's persisted file path
        const mainFilePathStr = this.mainFilePath();

        if (!mainFilePathStr) {
            console.log(`[isTaskIncludeFile] No current document or file path`);
            return false;
        }

        console.log(`[isTaskIncludeFile] Base file path: ${mainFilePathStr}`);
        const basePath = path.dirname(mainFilePathStr);
        let relativePath = path.relative(basePath, filePath);

        // Normalize path format to match how includes are stored (with ./ prefix for relative paths)
        if (!path.isAbsolute(relativePath) && !relativePath.startsWith('.')) {
            relativePath = './' + relativePath;
        }

        console.log(`[isTaskIncludeFile] Relative path: ${relativePath}`);

        // Check if any task uses this file as an include file
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeMode && task.includeFiles) {
                    console.log(`[isTaskIncludeFile] Task "${task.title}" has includes:`, task.includeFiles);
                    // Use helper method for consistent path comparison
                    const hasMatch = task.includeFiles.some((file: string) => {
                        const matches = this._isSameIncludePath(file, relativePath);
                        console.log(`[isTaskIncludeFile] Comparing "${file}" with "${relativePath}": ${matches}`);
                        return matches;
                    });
                    if (hasMatch) {
                        console.log(`[isTaskIncludeFile] MATCH FOUND!`);
                        return true;
                    }
                }
            }
        }
        console.log(`[isTaskIncludeFile] No match found`);
        return false;
    }

    /**
     * Handle external file changes from the file watcher
     */
    public async handleExternalFileChange(
        event: import('./externalFileWatcher').FileChangeEvent,
        handleInlineIncludeCallback: (filePath: string, changeType: string) => Promise<void>
    ): Promise<void> {
        console.log(`[handleExternalFileChange] CALLED! Path: ${event.path}, FileType: ${event.fileType}, ChangeType: ${event.changeType}`);
        try {
            console.log(`[handleExternalFileChange] This panel is affected, processing...`);

            // Handle different types of file changes
            if (event.fileType === 'include') {
                console.log(`[handleExternalFileChange] Handling include file...`);
                // Check if this is a column include file or inline include file
                const isColumnInclude = await this.isColumnIncludeFile(event.path);
                const isTaskInclude = await this.isTaskIncludeFile(event.path);
                console.log(`[handleExternalFileChange] isColumnInclude: ${isColumnInclude}, isTaskInclude: ${isTaskInclude}`);

                // This is a column or task include file - handle conflict resolution
                if (isColumnInclude || isTaskInclude) {
                    console.log(`[handleExternalFileChange] Calling handleIncludeFileConflict for ${event.path}...`);
                    // Note: handleIncludeFileConflict needs callbacks which must be provided by caller
                    console.log(`[handleExternalFileChange] handleIncludeFileConflict completed`);
                }
                // This is a regular include file (!!!include()) - should auto-reload immediately since it cannot be modified internally
                else {
                    console.log(`[handleExternalFileChange] Calling handleInlineIncludeFileChange for ${event.path}...`);
                    await handleInlineIncludeCallback(event.path, event.changeType);
                }
            }

        } catch (error) {
            console.error('[ExternalFileChange] Error handling file change:', error);
        }
    }

    /**
     * Write file content to disk
     */
    public async _writeFileContent(filePath: string, content: string, documentGetter: () => vscode.TextDocument | undefined): Promise<void> {
        try {
            const currentDocument = documentGetter();
            if (!currentDocument) {
                throw new Error('No current document available');
            }

            const basePath = path.dirname(currentDocument.uri.fsPath);
            const absolutePath = PathResolver.resolve(basePath, filePath);

            await FileWriter.writeFile(absolutePath, content, {
                createDirs: false,
                showNotification: false
            });

        } catch (error) {
            console.error(`[_writeFileContent] Error writing file ${filePath}:`, error);
            throw error;
        }
    }

    // ============= PUBLIC ACCESSORS =============

    /**
     * Get recently reloaded files set
     */
    public getRecentlyReloadedFiles(): Set<string> {
        return this._recentlyReloadedFiles;
    }

    /**
     * Add file to recently reloaded set
     */
    public addRecentlyReloadedFile(path: string): void {
        this._recentlyReloadedFiles.add(path);
    }

    /**
     * Clear recently reloaded files set
     */
    public clearRecentlyReloadedFiles(): void {
        this._recentlyReloadedFiles.clear();
    }
}
