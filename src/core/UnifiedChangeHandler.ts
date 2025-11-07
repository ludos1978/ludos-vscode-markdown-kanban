import { MarkdownFile } from '../files/MarkdownFile';

/**
 * Unified External Change Handler - Single logic for all file types
 *
 * Consolidates the conflicting handleExternalChange implementations from:
 * - MainKanbanFile.handleExternalChange()
 * - IncludeFile.handleExternalChange()
 *
 * Provides consistent conflict resolution for all file types.
 *
 * NOTE: Legitimate saves (our own writes) are filtered out by _onFileSystemChange()
 * using the _skipNextReloadDetection flag (set via SaveOptions). This handler only
 * receives TRUE external changes.
 */
export class UnifiedChangeHandler {
    private static instance: UnifiedChangeHandler | undefined;

    private constructor() {
        // No dependencies needed - conflict detection is handled by files themselves
    }

    public static getInstance(): UnifiedChangeHandler {
        if (!UnifiedChangeHandler.instance) {
            UnifiedChangeHandler.instance = new UnifiedChangeHandler();
        }
        return UnifiedChangeHandler.instance;
    }

    /**
     * Unified external change handling for all file types
     * Replaces multiple conflicting implementations
     */
    public async handleExternalChange(
        file: MarkdownFile,
        changeType: 'modified' | 'deleted' | 'created'
    ): Promise<void> {
        const fileType = file.getFileType();
        const filePath = file.getPath();

        console.log(`[UnifiedChangeHandler] 🔴 EXTERNAL CHANGE DETECTED: ${changeType} - ${fileType}:${filePath}`);

        // Handle file deletion
        if (changeType === 'deleted') {
            console.log(`[UnifiedChangeHandler] FILE-DELETED: ${filePath}`);
            await this.handleFileDeleted(file);
            return;
        }

        // Handle file creation
        if (changeType === 'created') {
            console.log(`[UnifiedChangeHandler] FILE-CREATED: ${filePath}`);
            await this.handleFileCreated(file);
            return;
        }

        // Handle file modification - this is where conflicts can occur
        await this.handleFileModified(file);
    }

    /**
     * Handle file deletion
     */
    private async handleFileDeleted(file: MarkdownFile): Promise<void> {
        // Mark file as deleted and notify parent
        file['_exists'] = false;

        // For include files, notify parent of change
        if (file.getFileType() !== 'main') {
            await this.notifyParentOfChange(file);
        }
    }

    /**
     * Handle file creation
     */
    private async handleFileCreated(file: MarkdownFile): Promise<void> {
        // Mark file as existing
        file['_exists'] = true;

        // Reload content
        await file.reload();

        // For include files, notify parent of change
        if (file.getFileType() !== 'main') {
            await this.notifyParentOfChange(file);
        }
    }

    /**
     * Handle file modification - the complex conflict resolution logic
     */
    private async handleFileModified(file: MarkdownFile): Promise<void> {
        const hasUnsavedChanges = file.hasUnsavedChanges();
        const isInEditMode = file.isInEditMode();
        const hasConflict = file.hasConflict(); // Use the file's conflict detection logic
        const hasFileSystemChanges = file['_hasFileSystemChanges'];

        // For main file changes, also check if any include files have unsaved changes
        const hasAnyUnsavedChanges = file.getFileType() === 'main'
            ? this.hasAnyUnsavedChangesInRegistry(file)
            : hasUnsavedChanges;

        console.log(`[UnifiedChangeHandler] 🔍 DETAILED CONFLICT ANALYSIS for ${file.getFileType()}:${file.getPath()}:`);
        console.log(`[UnifiedChangeHandler]   hasUnsavedChanges: ${hasUnsavedChanges}`);
        console.log(`[UnifiedChangeHandler]   hasAnyUnsavedChanges: ${hasAnyUnsavedChanges}`);
        console.log(`[UnifiedChangeHandler]   isInEditMode: ${isInEditMode}`);
        console.log(`[UnifiedChangeHandler]   hasFileSystemChanges: ${hasFileSystemChanges}`);
        console.log(`[UnifiedChangeHandler]   hasConflict (computed): ${hasConflict}`);

        // Additional debugging for MainKanbanFile
        if (file.getFileType() === 'main') {
            const mainFile = file as any;
            const document = mainFile._fileManager?.getDocument();
            const documentIsDirty = document ? document.isDirty : 'no document';
            console.log(`[UnifiedChangeHandler]   MAIN FILE DETAILS:`);
            console.log(`[UnifiedChangeHandler]     document.isDirty: ${documentIsDirty}`);
            console.log(`[UnifiedChangeHandler]     _content.length: ${mainFile._content?.length || 0}`);
            console.log(`[UnifiedChangeHandler]     _baseline.length: ${mainFile._baseline?.length || 0}`);
            console.log(`[UnifiedChangeHandler]     content === baseline: ${mainFile._content === mainFile._baseline}`);
        }

        // NOTE: Legitimate saves are already filtered out by _onFileSystemChange()
        // If _skipNextReloadDetection flag was set, the watcher returns early
        // So we only reach this point for TRUE external changes

        // CASE 1: Check for race condition - external save with unsaved Kanban changes
        // This happens when user saves externally (Ctrl+S) while having Kanban UI changes
        if (file.getFileType() === 'main' && hasAnyUnsavedChanges && hasFileSystemChanges) {
            console.log(`[UnifiedChangeHandler] ⚠️  CASE 1: CONFLICT DETECTED - External save with Kanban changes`);
            console.log(`[UnifiedChangeHandler]   User has unsaved Kanban changes (including include files) AND external file changes`);
            console.log(`[UnifiedChangeHandler]   This indicates external save (Ctrl+S) while Kanban UI had changes`);
            console.log(`[UnifiedChangeHandler]   → TREATING AS CONFLICT: Showing dialog`);

            await this.showConflictDialog(file);
            return;
        }

        // CASE 3: No conflict detected by file's logic (safe auto-reload)
        if (!hasConflict) {
            console.log(`[UnifiedChangeHandler] ✅ CASE 3: SAFE AUTO-RELOAD - No conflict detected`);
            await file.reload();

            // For include files, notify parent of change
            if (file.getFileType() !== 'main') {
                await this.notifyParentOfChange(file);
            }
            return;
        }

        // CASE 4: Conflict detected (show dialog)
        console.log(`[UnifiedChangeHandler] ⚠️  CASE 4: CONFLICT DETECTED - About to show dialog`);
        console.log(`[UnifiedChangeHandler]   Conflict reason: hasUnsavedChanges=${hasUnsavedChanges}, hasFileSystemChanges=${hasFileSystemChanges}`);
        await this.showConflictDialog(file);
    }

    /**
     * Show conflict resolution dialog
     */
    private async showConflictDialog(file: MarkdownFile): Promise<void> {
        try {
            // NOTE: Editing is already stopped in MarkdownFile._onFileSystemChange()
            // Just clear the flag here before showing dialog
            if (file.isInEditMode()) {
                console.log(`[UnifiedChangeHandler] Clearing edit mode flag before showing conflict dialog`);
                file.setEditMode(false);
            }

            const resolution = await file.showConflictDialog();

            if (resolution) {
                console.log(`[UnifiedChangeHandler] Conflict resolved:`, resolution);

                // For include files, notify parent after conflict resolution
                if (file.getFileType() !== 'main') {
                    await this.notifyParentOfChange(file);
                }
            } else {
                console.log(`[UnifiedChangeHandler] Conflict dialog cancelled or failed`);
            }
        } catch (error) {
            console.error(`[UnifiedChangeHandler] Conflict dialog failed:`, error);
            // If dialog fails, keep current state to prevent data loss
        }
    }

    /**
     * Check if any files in the registry have unsaved changes
     * Used for main file conflict detection to include include file changes
     */
    private hasAnyUnsavedChangesInRegistry(file: MarkdownFile): boolean {
        // Access the file registry through the main file
        const mainFile = file as any;
        if (mainFile._fileRegistry) {
            const filesWithChanges = mainFile._fileRegistry.getFilesWithUnsavedChanges();

            // CRITICAL: Also check if there's a cached board from webview (UI edits)
            // This is essential for conflict detection when user edits in UI but hasn't saved
            const cachedBoard = mainFile.getCachedBoardFromWebview?.();
            const hasCachedBoardChanges = !!cachedBoard;

            console.log(`[UnifiedChangeHandler] hasAnyUnsavedChangesInRegistry check:`);
            console.log(`[UnifiedChangeHandler]   filesWithChanges.length: ${filesWithChanges.length}`);
            console.log(`[UnifiedChangeHandler]   hasCachedBoardChanges: ${hasCachedBoardChanges}`);

            return filesWithChanges.length > 0 || hasCachedBoardChanges;
        }

        // Fallback: just check the file itself
        return file.hasUnsavedChanges();
    }

    /**
     * Notify parent of changes (for include files)
     *
     * NOTE: This is intentionally minimal because the file registry change notification
     * already triggers proper updates through _handleFileRegistryChange -> _sendIncludeFileUpdateToFrontend
     * Adding additional board updates here would cause duplicate updates and race conditions.
     */
    private async notifyParentOfChange(file: MarkdownFile): Promise<void> {
        console.log(`[UnifiedChangeHandler] Include file change will be handled by file registry notification system`);
        console.log(`[UnifiedChangeHandler]   File: ${file.getFileType()}:${file.getPath()}`);
        // The file registry change notification system handles the rest
    }
}
