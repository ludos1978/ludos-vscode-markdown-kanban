import * as vscode from 'vscode';
import { SaveEventCoordinator } from '../saveEventCoordinator';
import { MarkdownFile } from '../files/MarkdownFile';

/**
 * Unified Save Coordinator - Single source for all save operations
 *
 * Consolidates multiple conflicting save implementations into one system.
 * Ensures consistent state tracking and proper save operation detection.
 */
export class SaveCoordinator {
    private static instance: SaveCoordinator | undefined;
    private saveCoordinator: SaveEventCoordinator;
    private activeSaves = new Map<string, Promise<void>>();
    private legitimateSaves = new Map<string, { timestamp: number; timeout: NodeJS.Timeout }>();

    public constructor() {
        this.saveCoordinator = SaveEventCoordinator.getInstance();
    }

    public static getInstance(): SaveCoordinator {
        if (!SaveCoordinator.instance) {
            SaveCoordinator.instance = new SaveCoordinator();
        }
        return SaveCoordinator.instance;
    }

    /**
     * Unified save method for all file types
     * Replaces multiple conflicting save implementations
     */
    public async saveFile(file: MarkdownFile, content?: string): Promise<void> {
        const filePath = file.getPath();
        const saveKey = `${file.getFileType()}:${filePath}`;

        // Prevent concurrent saves on the same file
        if (this.activeSaves.has(saveKey)) {
            console.log(`[SaveCoordinator] Waiting for existing save: ${saveKey}`);
            await this.activeSaves.get(saveKey);
            return;
        }

        const savePromise = this.performSave(file, content);
        this.activeSaves.set(saveKey, savePromise);

        try {
            await savePromise;
        } finally {
            this.activeSaves.delete(saveKey);
        }
    }

    /**
     * Perform the actual save operation
     */
    private async performSave(file: MarkdownFile, content?: string): Promise<void> {
        const filePath = file.getPath();
        const fileType = file.getFileType();

        console.log(`[SaveCoordinator] Starting save: ${fileType} - ${filePath}`);

        // Mark this save as legitimate for conflict detection
        this.markSaveAsLegitimate(filePath);

        try {
            // Use the file's content or provided content
            const contentToSave = content ?? file.getContent();

            if (!contentToSave) {
                throw new Error('No content to save');
            }

            // Perform the save using the file's save method (which handles state updates)
            await file.save();

            console.log(`[SaveCoordinator] Save completed: ${fileType} - ${filePath}`);

        } catch (error) {
            console.error(`[SaveCoordinator] Save failed: ${fileType} - ${filePath}`, error);
            throw error;
        }
    }

    /**
     * Mark a save operation as legitimate for conflict detection
     * Public method for external callers (like SaveEventCoordinator handlers)
     */
    public markSaveAsLegitimate(filePath: string): void {
        const normalizedPath = MarkdownFile.normalizeRelativePath(filePath);

        // Clear any existing timeout for this file
        const existing = this.legitimateSaves.get(normalizedPath);
        if (existing) {
            clearTimeout(existing.timeout);
        }

        // Set a timeout to automatically clear the legitimate save flag
        // This gives a 2-second window for the file watcher to detect the change
        const timeout = setTimeout(() => {
            this.legitimateSaves.delete(normalizedPath);
            console.log(`[SaveCoordinator] Cleared legitimate save flag for: ${normalizedPath}`);
        }, 2000);

        this.legitimateSaves.set(normalizedPath, {
            timestamp: Date.now(),
            timeout
        });

        console.log(`[SaveCoordinator] Marked legitimate save for: ${filePath} (normalized: ${normalizedPath})`);
    }

    /**
     * Check if a file change was caused by a legitimate save operation
     * This replaces all time-based heuristics
     */
    public isLegitimateSave(filePath: string): boolean {
        const normalizedPath = MarkdownFile.normalizeRelativePath(filePath);
        const legitimateSave = this.legitimateSaves.get(normalizedPath);

        console.log(`[SaveCoordinator] Checking legitimate save for: ${filePath} (normalized: ${normalizedPath})`);
        console.log(`[SaveCoordinator]   Found legitimate save entry: ${!!legitimateSave}`);

        if (!legitimateSave) {
            console.log(`[SaveCoordinator]   → NOT legitimate (no entry found)`);
            return false;
        }

        // Check if the save is still within the legitimate window (2 seconds)
        const age = Date.now() - legitimateSave.timestamp;
        const isStillLegitimate = age < 2000;

        console.log(`[SaveCoordinator]   Save timestamp: ${legitimateSave.timestamp}`);
        console.log(`[SaveCoordinator]   Current time: ${Date.now()}`);
        console.log(`[SaveCoordinator]   Age: ${age}ms`);
        console.log(`[SaveCoordinator]   Still legitimate: ${isStillLegitimate}`);

        if (isStillLegitimate) {
            console.log(`[SaveCoordinator]   → LEGITIMATE SAVE (${age}ms ago)`);
        } else {
            console.log(`[SaveCoordinator]   → NOT legitimate (${age}ms ago - expired)`);
        }

        return isStillLegitimate;
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
