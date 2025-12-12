import { MarkdownFile } from '../files/MarkdownFile';
import { SaveOptions } from '../files/SaveOptions';

/**
 * FileSaveService - Unified service for all file save operations
 *
 * Uses SaveOptions interface for consistent, parameter-based save handling.
 * NO timing-based heuristics - uses instance-level flags instead (SaveOptions.skipReloadDetection).
 *
 * ARCHITECTURE:
 * - All saves go through FileSaveService.saveFile()
 * - FileSaveService calls file.save(SaveOptions)
 * - SaveOptions.skipReloadDetection (default: true) sets instance flag _skipNextReloadDetection
 * - File watcher checks instance flag and skips reload if true
 * - No global state, no timing windows, just clean parameter-based design
 *
 * NOTE: This handles actual FILE SAVE OPERATIONS.
 * For VS Code save events (onDidSaveTextDocument), see SaveEventDispatcher.
 */
export class FileSaveService {
    private static instance: FileSaveService | undefined;
    private activeSaves = new Map<string, Promise<void>>();

    public constructor() {
        // No initialization needed
    }

    public static getInstance(): FileSaveService {
        if (!FileSaveService.instance) {
            FileSaveService.instance = new FileSaveService();
        }
        return FileSaveService.instance;
    }

    /**
     * Unified save method for all file types
     * Uses SaveOptions for consistent, parameter-based save handling
     */
    public async saveFile(file: MarkdownFile, content?: string, options?: SaveOptions): Promise<void> {
        const filePath = file.getPath();
        const saveKey = `${file.getFileType()}:${filePath}`;

        // Prevent concurrent saves on the same file
        if (this.activeSaves.has(saveKey)) {
            await this.activeSaves.get(saveKey);
            return;
        }

        const savePromise = this.performSave(file, content, options);
        this.activeSaves.set(saveKey, savePromise);

        try {
            await savePromise;
        } finally {
            this.activeSaves.delete(saveKey);
        }
    }

    /**
     * Perform the actual save operation using SaveOptions
     */
    private async performSave(file: MarkdownFile, content?: string, options?: SaveOptions): Promise<void> {
        try {
            // If content is provided, update file content first
            // Use updateBaseline=true to prevent emitting 'content' event and triggering save loop
            // This is safe because we're about to save immediately anyway
            if (content !== undefined) {
                file.setContent(content, true);
            }

            // Use SaveOptions with defaults:
            // - skipReloadDetection: true (our own save, don't reload)
            // - source: 'auto-save' (unless specified otherwise)
            const saveOptions: SaveOptions = {
                skipReloadDetection: options?.skipReloadDetection ?? true,
                source: options?.source ?? 'auto-save',
                skipValidation: options?.skipValidation ?? false
            };


            // Perform the save using the file's save method with SaveOptions
            await file.save(saveOptions);
        } catch (error) {
            console.error(`[FileSaveService] Save failed: ${file.getFileType()} - ${file.getPath()}`, error);
            throw error;
        }
    }

    /**
     * Get save statistics for debugging
     */
    public getStats(): { activeSaves: number } {
        return {
            activeSaves: this.activeSaves.size
        };
    }
}
