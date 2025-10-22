import * as vscode from 'vscode';
import { KanbanBoard, KanbanColumn, KanbanTask } from './markdownParser';
import { PresentationParser } from './presentationParser';
import { BackupManager } from './backupManager';
import { ConflictResolver } from './conflictResolver';
import { MarkdownFileRegistry, IncludeFile, ColumnIncludeFile, TaskIncludeFile, FileState } from './files';

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
        // Registry tracks changes automatically
        return false; // No unsaved changes (handled by registry)
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
                // We need to combine them back when saving
                let fullContent = '';

                if (task.displayTitle) {
                    fullContent = task.displayTitle + '\n';
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
        // Files are registered when board is loaded - this is a no-op
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
