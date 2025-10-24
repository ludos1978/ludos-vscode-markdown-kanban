import * as vscode from 'vscode';
import { KanbanBoard, KanbanColumn, KanbanTask } from './markdownParser';
import { PresentationParser } from './presentationParser';
import { BackupManager } from './backupManager';
import { ConflictResolver } from './conflictResolver';
import { MarkdownFileRegistry, IncludeFile, ColumnIncludeFile, TaskIncludeFile, FileState, FileFactory } from './files';

/**
 * IncludeFileManager - Thin wrapper around MarkdownFileRegistry
 * Delegates all file operations to the registry
 */
export class IncludeFileManager {
    private _recentlyReloadedFiles: Set<string> = new Set();
    private _filesToRemoveAfterSave: string[] = [];
    private _unsavedFilesToPrompt: string[] = [];

    constructor(
        private fileRegistry: MarkdownFileRegistry,
        private fileFactory: FileFactory,
        private conflictResolver: ConflictResolver,
        private backupManager: BackupManager,
        private mainFilePath: () => string | undefined,
        private board: () => KanbanBoard | undefined,
        private sendMessageToWebview: (message: any) => void,
        private isUpdatingFromPanel: () => boolean,
        private cachedBoardFromWebview: () => any
    ) {}

    // All methods now delegate to fileRegistry

    public getOrCreateIncludeFile(relativePath: string, type: string, documentGetter: any): FileState | null {
        const file = this.fileRegistry.getByRelativePath(relativePath);
        return file?.toFileState() || null;
    }

    public getIncludeFilesByType(type: 'regular' | 'column' | 'task'): string[] {
        const files = this.fileRegistry.getIncludeFiles();
        return files
            .filter(file => {
                if (type === 'column') return file instanceof ColumnIncludeFile;
                if (type === 'task') return file instanceof TaskIncludeFile;
                return file.getFileType() === 'include-regular';
            })
            .map(file => file.getRelativePath());
    }

    public async trackIncludeFileUnsavedChanges(board: KanbanBoard, documentGetter: any, filePathGetter: any): Promise<boolean> {
        // Update ColumnIncludeFile instances with current task content (without saving to disk)
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    const file = this.fileRegistry.getByRelativePath(relativePath) as ColumnIncludeFile;
                    if (file) {
                        // Generate content from current tasks
                        const content = file.generateFromTasks(column.tasks);
                        const currentContent = file.getContent();

                        // Only update if content actually changed to prevent infinite loop
                        if (content !== currentContent) {
                            file.setContent(content, false); // false = NOT saved yet
                        }
                    } else {
                        console.log(`[trackIncludeFileUnsavedChanges] ⚠️  File NOT found in registry: ${relativePath}`);
                    }
                }
            }
        }

        // Update TaskIncludeFile instances with current task content (without saving to disk)
        for (const column of board.columns) {
            for (const task of column.tasks) {
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const relativePath of task.includeFiles) {
                        const file = this.fileRegistry.getByRelativePath(relativePath) as TaskIncludeFile;
                        if (file) {
                            // Reconstruct full content: displayTitle + description
                            let fullContent = '';
                            if (task.displayTitle) {
                                fullContent = task.displayTitle + '\n\n';
                            }
                            if (task.description) {
                                fullContent += task.description;
                            }

                            // Only update if content actually changed
                            // Reader/writer are now symmetric so exact comparison works
                            const currentContent = file.getContent();
                            if (fullContent !== currentContent) {
                                // Update file content (marks as unsaved if changed)
                                file.setTaskDescription(fullContent);
                            }
                        }
                    }
                }
            }
        }

        return false; // Return false = main file also needs saving
    }

    public async saveColumnIncludeChanges(column: KanbanColumn, documentGetter: any): Promise<boolean> {
        if (!column.includeFiles || column.includeFiles.length === 0) return true;

        for (const relativePath of column.includeFiles) {
            const file = this.fileRegistry.getByRelativePath(relativePath) as ColumnIncludeFile;
            if (file) {
                const content = file.generateFromTasks(column.tasks);
                file.setContent(content);
                await file.save();
            }
        }
        return true;
    }

    public async saveTaskIncludeChanges(task: KanbanTask, documentGetter: any): Promise<boolean> {
        if (!task.includeFiles || task.includeFiles.length === 0) return true;

        for (const relativePath of task.includeFiles) {
            const file = this.fileRegistry.getByRelativePath(relativePath) as TaskIncludeFile;
            if (file) {
                // Reconstruct full content: displayTitle (header) + description
                // When parsing, the first line is stored as displayTitle and the rest as description
                // We need to combine them back when saving with a blank line separator
                let fullContent = '';

                if (task.displayTitle) {
                    fullContent = task.displayTitle + '\n\n'; // Add blank line after header
                }

                if (task.description) {
                    fullContent += task.description;
                }

                // Only save if there's content (either header or description)
                if (fullContent.trim()) {
                    file.setTaskDescription(fullContent);
                    await file.save();
                }
            }
        }
        return true;
    }

    public async saveAllColumnIncludeChanges(): Promise<void> {
        const board = this.board();
        if (!board) return;

        for (const column of board.columns) {
            await this.saveColumnIncludeChanges(column, null);
        }
    }

    public async saveAllTaskIncludeChanges(): Promise<void> {
        const board = this.board();
        if (!board) return;

        for (const column of board.columns) {
            for (const task of column.tasks) {
                await this.saveTaskIncludeChanges(task, null);
            }
        }
    }

    public async handleExternalFileChange(event: any, onInlineChange: (path: string, changeType: string) => Promise<void>): Promise<void> {
        // File instances handle their own external changes via watchers
        // This method is legacy - actual handling is in MarkdownFile.handleExternalChange()
    }

    public hasUnsavedIncludeFileChanges(): boolean {
        return this.fileRegistry.getFilesWithUnsavedChanges().length > 0;
    }

    public checkColumnIncludeUnsavedChanges(column: KanbanColumn): boolean {
        if (!column.includeFiles) return false;

        for (const relativePath of column.includeFiles) {
            const file = this.fileRegistry.getByRelativePath(relativePath);
            if (file?.hasUnsavedChanges()) return true;
        }
        return false;
    }

    public checkTaskIncludeUnsavedChanges(task: KanbanTask): boolean {
        if (!task.includeFiles) return false;

        for (const relativePath of task.includeFiles) {
            const file = this.fileRegistry.getByRelativePath(relativePath);
            if (file?.hasUnsavedChanges()) return true;
        }
        return false;
    }

    public checkForExternalIncludeFileChanges(): boolean {
        return this.fileRegistry.getFilesThatNeedReload().length > 0;
    }

    public getAllIncludeFilePaths(): string[] {
        return this.fileRegistry.getIncludeFiles().map(f => f.getRelativePath());
    }

    public ensureIncludeFileRegistered(relativePath: string, type: string, documentGetter: any): void {
        console.log(`\n========== ensureIncludeFileRegistered ==========`);
        console.log(`[IncludeFileManager] CALLED with: ${relativePath}, type: ${type}`);

        // Check if file is already registered
        if (this.fileRegistry.hasByRelativePath(relativePath)) {
            console.log(`[IncludeFileManager] ✓ Already registered: ${relativePath}`);
            const file = this.fileRegistry.getByRelativePath(relativePath);
            console.log(`[IncludeFileManager]   - File type: ${file?.getFileType()}`);
            console.log(`[IncludeFileManager]   - Has watcher: ${file ? 'yes' : 'no'}`);
            console.log(`================================================\n`);
            return;
        }

        // Get main file
        const mainFile = this.fileRegistry.getMainFile();
        if (!mainFile) {
            console.error(`[IncludeFileManager] ✗ NO MAIN FILE - Cannot register!`);
            console.error(`[IncludeFileManager]   Registry has ${this.fileRegistry.getAll().length} files`);
            console.log(`================================================\n`);
            return;
        }

        console.log(`[IncludeFileManager] → Creating ${type} include file...`);

        // Create appropriate file type
        let includeFile;
        try {
            if (type === 'regular') {
                includeFile = this.fileFactory.createRegularInclude(relativePath, mainFile, true);
            } else if (type === 'column') {
                includeFile = this.fileFactory.createColumnInclude(relativePath, mainFile, true);
            } else if (type === 'task') {
                includeFile = this.fileFactory.createTaskInclude(relativePath, mainFile, true);
            } else {
                console.error(`[IncludeFileManager] ✗ Unknown type: ${type}`);
                console.log(`================================================\n`);
                return;
            }

            // Register and start watching
            this.fileRegistry.register(includeFile);
            console.log(`[IncludeFileManager] ✓ Registered in file registry`);

            includeFile.startWatching();
            console.log(`[IncludeFileManager] ✓ Started file watcher`);

            console.log(`[IncludeFileManager] ✓✓✓ SUCCESS! Now tracking: ${relativePath}`);
            console.log(`[IncludeFileManager]   Total files in registry: ${this.fileRegistry.getAll().length}`);
            console.log(`================================================\n`);
        } catch (error) {
            console.error(`[IncludeFileManager] ✗✗✗ ERROR:`, error);
            console.log(`================================================\n`);
        }
    }

    public async readFileContent(relativePath: string, documentGetter: any): Promise<string | null> {
        const file = this.fileRegistry.getByRelativePath(relativePath);
        return file?.getContent() || null;
    }

    public async readAndUpdateIncludeContent(relativePath: string, documentGetter: any): Promise<void> {
        const file = this.fileRegistry.getByRelativePath(relativePath);
        if (file) {
            await file.reload();
        }
    }

    public async reprocessTaskIncludes(task: KanbanTask, documentGetter: any): Promise<void> {
        // Registry handles reprocessing automatically
    }

    public updateIncludeContentUnified(relativePath: string, content: string): void {
        const file = this.fileRegistry.getByRelativePath(relativePath);
        if (file) {
            file.setContent(content);
        }
    }

    public updateInlineIncludeFile(relativePath: string, content: string): void {
        this.updateIncludeContentUnified(relativePath, content);
    }

    // Internal/private methods - mostly no-ops now since registry handles everything

    public _handleUnsavedIncludeFileChanges(): Promise<void> {
        return Promise.resolve();
    }

    public _initializeUnifiedIncludeContents(documentGetter: any): Promise<void> {
        return Promise.resolve();
    }

    public _isSameIncludePath(path1: string, path2: string): boolean {
        return this._normalizeIncludePath(path1) === this._normalizeIncludePath(path2);
    }

    public _normalizeIncludePath(includePath: string): string {
        return includePath.trim().toLowerCase().replace(/\\/g, '/');
    }

    public _recheckIncludeFileChanges(): void {
        // Registry tracks changes automatically
    }

    public _updateUnifiedIncludeSystem(board: KanbanBoard, documentGetter: any): Promise<void> {
        return Promise.resolve();
    }

    public _removeTrackedFiles(): void {
        // No-op - registry manages lifecycle
    }
}
