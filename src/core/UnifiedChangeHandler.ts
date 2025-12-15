import { MarkdownFile } from '../files/MarkdownFile';
import { MainKanbanFile } from '../files/MainKanbanFile';

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
 *
 * NOTE: Parent notification for include files is handled by the file registry change
 * notification system (_handleFileRegistryChange -> _sendIncludeFileUpdateToFrontend).
 * This handler only handles conflict detection and resolution.
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
        // Handle file deletion
        if (changeType === 'deleted') {
            await this.handleFileDeleted(file);
            return;
        }

        // Handle file creation
        if (changeType === 'created') {
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
        // Mark file as deleted
        file.setExists(false);
        // Parent notification handled by file registry change notification system
    }

    /**
     * Handle file creation
     */
    private async handleFileCreated(file: MarkdownFile): Promise<void> {
        // Mark file as existing
        file.setExists(true);

        // Reload content
        await file.reload();
        // Parent notification handled by file registry change notification system
    }

    /**
     * Handle file modification - the complex conflict resolution logic
     */
    private async handleFileModified(file: MarkdownFile): Promise<void> {
        const hasUnsavedChanges = file.hasUnsavedChanges();
        const hasConflict = file.hasConflict(); // Use the file's conflict detection logic
        const hasFileSystemChanges = file.hasExternalChanges();

        // For main file changes, also check if any include files have unsaved changes
        const hasAnyUnsavedChanges = file.getFileType() === 'main'
            ? this.hasAnyUnsavedChangesInRegistry(file)
            : hasUnsavedChanges;

        // NOTE: Legitimate saves are already filtered out by _onFileSystemChange()
        // If _skipNextReloadDetection flag was set, the watcher returns early
        // So we only reach this point for TRUE external changes

        // CASE 1: Check for race condition - external save with unsaved Kanban changes
        // This happens when user saves externally (Ctrl+S) while having Kanban UI changes
        if (file.getFileType() === 'main' && hasAnyUnsavedChanges && hasFileSystemChanges) {
            await this.showConflictDialog(file);
            return;
        }

        // CASE 2: No conflict detected by file's logic (safe auto-reload)
        if (!hasConflict) {
            await file.reload();
            // Parent notification handled by file registry change notification system
            return;
        }

        // CASE 3: Conflict detected (show dialog)
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
                file.setEditMode(false);
            }

            await file.showConflictDialog();
            // Parent notification handled by file registry change notification system
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
        // Access the file registry through the public method
        const fileRegistry = file.getFileRegistry();
        if (fileRegistry) {
            // Check for files with unsaved changes via include files
            const includeFiles = fileRegistry.getIncludeFiles();
            const hasIncludeChanges = includeFiles.some(f => f.hasUnsavedChanges());

            // CRITICAL: Also check if there's a cached board from webview (UI edits)
            // This is essential for conflict detection when user edits in UI but hasn't saved
            // Note: getCachedBoardFromWebview is only on MainKanbanFile
            if (file.getFileType() === 'main') {
                const mainFile = file as MainKanbanFile;
                const cachedBoard = mainFile.getCachedBoardFromWebview?.();
                const hasCachedBoardChanges = !!cachedBoard;
                return hasIncludeChanges || hasCachedBoardChanges;
            }

            return hasIncludeChanges;
        }

        // Fallback: just check the file itself
        return file.hasUnsavedChanges();
    }
}
