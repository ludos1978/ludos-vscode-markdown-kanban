import * as vscode from 'vscode';
import * as path from 'path';
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
        console.log('[trackIncludeFileUnsavedChanges] ===== TRACKING INCLUDE CHANGES =====');

        // Update ColumnIncludeFile instances with current task content (without saving to disk)
        for (const column of board.columns) {
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const relativePath of column.includeFiles) {
                    // FOUNDATION-1: Registry handles normalization internally
                    const file = this.fileRegistry.getByRelativePath(relativePath) as ColumnIncludeFile;
                    if (file) {
                        // Generate content from current tasks
                        const content = file.generateFromTasks(column.tasks);
                        const currentContent = file.getContent();
                        const hasUnsaved = file.hasUnsavedChanges();

                        console.log(`[trackIncludeFileUnsavedChanges] Column include: ${relativePath}`);
                        console.log(`  Generated content length: ${content.length}`);
                        console.log(`  Current content length: ${currentContent.length}`);
                        console.log(`  Content changed: ${content !== currentContent}`);
                        console.log(`  Already has unsaved: ${hasUnsaved}`);

                        // CRITICAL PROTECTION: Never replace existing content with empty
                        if (!content.trim() && currentContent.trim()) {
                            console.warn(`  ⚠️  PROTECTED: Refusing to wipe column content to empty`);
                            console.warn(`  → Keeping existing content (${currentContent.length} chars)`);
                            // Keep existing content - don't wipe it
                            file.setContent(currentContent, false);
                            continue;
                        }

                        // Only update if content actually changed to prevent infinite loop
                        if (content !== currentContent) {
                            console.log(`  → Updating content (marking as unsaved)`);
                            file.setContent(content, false); // false = NOT saved yet
                        } else {
                            // Content is already correct, but column was edited - still mark as unsaved
                            console.log(`  → Content already correct, but marking as unsaved (column was edited)`);
                            file.setContent(currentContent, false); // Force hasUnsavedChanges = true
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
                        // FOUNDATION-1: Registry handles normalization internally
                        const file = this.fileRegistry.getByRelativePath(relativePath) as TaskIncludeFile;
                        if (file) {
                            // STRATEGY 1: No-parsing approach
                            // task.displayTitle is now a formatted header "# include in ./path" (UI only, not file content)
                            // task.description contains the COMPLETE file content (no parsing, no truncation)

                            // Get full content from task (no reconstruction needed!)
                            const fullContent = task.description || '';

                            // Get current content from file
                            const currentContent = file.getContent();
                            const hasUnsaved = file.hasUnsavedChanges();

                            console.log(`[trackIncludeFileUnsavedChanges] Task include: ${relativePath}`);
                            console.log(`  task.displayTitle: "${task.displayTitle}" (UI header only)`);
                            console.log(`  task.description length: ${task.description?.length || 0}`);
                            console.log(`  task.description (first 100 chars): "${task.description?.substring(0, 100)}"`);
                            console.log(`  file.getContent() length: ${currentContent.length}`);
                            console.log(`  file.getContent() (first 100 chars): "${currentContent.substring(0, 100)}"`);
                            console.log(`  Content changed: ${fullContent !== currentContent}`);
                            console.log(`  Already has unsaved: ${hasUnsaved}`);

                            // CRITICAL PROTECTION: Never replace existing content with empty
                            // This prevents content loss when include files aren't found during re-parse
                            if (!fullContent.trim() && currentContent.trim()) {
                                console.warn(`  ⚠️  PROTECTED: Refusing to wipe content to empty`);
                                console.warn(`  → Keeping existing content (${currentContent.length} chars)`);
                                console.warn(`  → This usually means include file wasn't found during parse`);
                                // Keep existing content - don't wipe it
                                // Still mark as unsaved since task was edited
                                file.setContent(currentContent, false); // Force hasUnsavedChanges = true
                                continue;
                            }

                            if (fullContent !== currentContent) {
                                console.log(`  → Updating content (marking as unsaved)`);
                                // Update file content (marks as unsaved if changed)
                                file.setTaskDescription(fullContent);
                            } else {
                                // Content is already correct, but task was edited - still mark as unsaved
                                console.log(`  → Content already correct, but marking as unsaved (task was edited)`);
                                file.setContent(currentContent, false); // Force hasUnsavedChanges = true
                            }
                        }
                    }
                }
            }
        }

        console.log('[trackIncludeFileUnsavedChanges] ===== DONE =====');

        return false; // Return false = main file also needs saving
    }

    public async saveColumnIncludeChanges(column: KanbanColumn, documentGetter: any): Promise<boolean> {
        if (!column.includeFiles || column.includeFiles.length === 0) return true;

        for (const relativePath of column.includeFiles) {
            // FOUNDATION-1: Registry handles normalization internally
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
            // FOUNDATION-1: Registry handles normalization internally
            const file = this.fileRegistry.getByRelativePath(relativePath) as TaskIncludeFile;
            if (file) {
                // STRATEGY 1: No-parsing approach
                // task.displayTitle is now a formatted header "# include in ./path" (UI only, not file content)
                // task.description contains the COMPLETE file content (no parsing, no reconstruction needed)

                // Just use task.description directly - it contains the full file content
                const fullContent = task.description || '';

                console.log(`[saveTaskIncludeChanges] Saving ${relativePath}`);
                console.log(`  task.displayTitle: "${task.displayTitle}" (UI header only, not saved)`);
                console.log(`  task.description length: ${fullContent.length}`);
                console.log(`  task.description (first 100 chars): "${fullContent.substring(0, 100)}"`);

                // Only save if there's content
                if (fullContent.trim()) {
                    file.setTaskDescription(fullContent);
                    await file.save();
                } else {
                    console.warn(`[saveTaskIncludeChanges] Skipping save - content is empty`);
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
            // FOUNDATION-1: Registry handles normalization internally
            const file = this.fileRegistry.getByRelativePath(relativePath);
            if (file?.hasUnsavedChanges()) return true;
        }
        return false;
    }

    public checkTaskIncludeUnsavedChanges(task: KanbanTask): boolean {
        if (!task.includeFiles) return false;

        for (const relativePath of task.includeFiles) {
            // FOUNDATION-1: Registry handles normalization internally
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

        // BUGFIX: If an absolute path is passed, convert it to relative
        // This can happen during include switches when resolved paths are passed
        if (path.isAbsolute(relativePath)) {
            const mainFile = this.fileRegistry.getMainFile();
            if (!mainFile) {
                console.error(`[IncludeFileManager] ✗ Cannot convert absolute to relative - no main file`);
                return;
            }
            const baseDir = path.dirname(mainFile.getPath());
            relativePath = path.relative(baseDir, relativePath);
            console.log(`[IncludeFileManager] 🔄 Converted absolute to relative: ${relativePath}`);
        }

        // PERFORMANCE: Fast check using registration cache
        if (this.fileRegistry.isBeingRegistered(relativePath)) {
            console.debug(`[IncludeFileManager] ⏭️  Already being registered: ${relativePath}`);
            console.log(`================================================\n`);
            return;
        }

        // Check if file is already registered
        if (this.fileRegistry.hasByRelativePath(relativePath)) {
            console.log(`[IncludeFileManager] ✓ Already registered: ${relativePath}`);
            const file = this.fileRegistry.getByRelativePath(relativePath);
            console.log(`[IncludeFileManager]   - File type: ${file?.getFileType()}`);
            console.log(`[IncludeFileManager]   - Has watcher: ${file ? 'yes' : 'no'}`);
            console.log(`================================================\n`);
            return;
        }

        // PERFORMANCE: Lazy loading - defer actual file creation until needed
        // Just mark as being registered to prevent duplicate attempts
        this._markAsBeingRegistered(relativePath);

        // Schedule actual registration for next tick to avoid blocking UI
        setTimeout(() => {
            this._performLazyRegistration(relativePath, type);
        }, 0);

        console.log(`[IncludeFileManager] ⏰ Scheduled lazy registration: ${relativePath}`);
        console.log(`================================================\n`);
    }

    /**
     * Mark a file as being registered (prevents duplicate registration attempts)
     */
    private _markAsBeingRegistered(relativePath: string): void {
        // This is a simple implementation - in a real system you'd use a proper cache
        // For now, we'll just prevent immediate duplicate calls
    }

    /**
     * Perform the actual lazy registration
     */
    private async _performLazyRegistration(relativePath: string, type: string): Promise<void> {
        try {
            // Double-check if file is still needed (might have been registered by another call)
            if (this.fileRegistry.hasByRelativePath(relativePath)) {
                console.debug(`[IncludeFileManager] File already registered during lazy load: ${relativePath}`);
                return;
            }

            // Get main file
            const mainFile = this.fileRegistry.getMainFile();
            if (!mainFile) {
                console.error(`[IncludeFileManager] ✗ NO MAIN FILE - Cannot register!`);
                return;
            }

            console.log(`[IncludeFileManager] → Creating ${type} include file (lazy): ${relativePath}`);

            // Create appropriate file type
            let includeFile;
            if (type === 'regular') {
                includeFile = this.fileFactory.createRegularInclude(relativePath, mainFile, true);
            } else if (type === 'column') {
                includeFile = this.fileFactory.createColumnInclude(relativePath, mainFile, true);
            } else if (type === 'task') {
                includeFile = this.fileFactory.createTaskInclude(relativePath, mainFile, true);
            } else {
                console.error(`[IncludeFileManager] ✗ Unknown type: ${type}`);
                return;
            }

            // Register and start watching
            this.fileRegistry.register(includeFile);
            console.log(`[IncludeFileManager] ✓ Registered in file registry (lazy)`);

            includeFile.startWatching();
            console.log(`[IncludeFileManager] ✓ Started file watcher (lazy)`);

            console.log(`[IncludeFileManager] ✓✓✓ SUCCESS! Now tracking: ${relativePath} (lazy)`);
        } catch (error) {
            console.error(`[IncludeFileManager] ✗✗✗ ERROR during lazy registration:`, error);
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

    // FOUNDATION-1: Use MarkdownFile helpers instead of manual normalization
    public _isSameIncludePath(path1: string, path2: string): boolean {
        // Import MarkdownFile at top if not already imported
        const { MarkdownFile } = require('./files/MarkdownFile');
        return MarkdownFile.isSameFile(path1, path2);
    }

    /**
     * Normalize include paths for consistent registry lookups
     * CRITICAL: Registry does NOT normalize internally - we MUST normalize before ALL registry lookups!
     */
    public normalizeIncludePath(includePath: string): string {
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
