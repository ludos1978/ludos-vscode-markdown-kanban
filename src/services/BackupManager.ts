import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { configService } from './ConfigurationService';
import { showWarning } from './NotificationService';
import {
    getBackupFolderPath,
    getWorkspaceBackupFolderPath,
    getAutosavePath,
    getLabeledBackupPath,
    createBackupPattern
} from '../constants/FileNaming';

export interface BackupOptions {
    label?: string;           // 'backup', 'conflict', etc.
    forceCreate?: boolean;    // Skip time/content checks
    minIntervalMinutes?: number;  // Minimum time since last backup
}

export class BackupManager {
    private _backupTimer: NodeJS.Timer | null = null;
    private _lastBackupTime: Date | null = null;
    private _lastContentHash: string | null = null;

    constructor() {}

    /**
     * Write content to a backup file, creating directory if needed.
     */
    private async writeBackupFile(backupPath: string, content: string): Promise<void> {
        const backupDir = path.dirname(backupPath);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        fs.writeFileSync(backupPath, content, 'utf8');
        await this.setFileHidden(backupPath);
    }

    /**
     * Check if backups are disabled for the given options.
     * Returns true if backup should be skipped.
     */
    private isBackupDisabled(options: BackupOptions): boolean {
        const enableBackups = configService.getConfig('enableBackups');
        return !enableBackups && !options.forceCreate;
    }

    /**
     * Create a backup of the given document
     * @returns The backup file path if successful, null if failed or skipped
     */
    public async createBackup(document: vscode.TextDocument, options: BackupOptions = {}): Promise<string | null> {
        try {
            // Safety check: ensure document is valid
            if (!document) {
                console.warn('[BackupManager] Cannot create backup - document is undefined');
                return null;
            }

            if (this.isBackupDisabled(options)) {
                return null;
            }

            const defaultIntervalMinutes = configService.getConfig('backupInterval');

            const now = new Date();
            const intervalMinutes = options.minIntervalMinutes ?? defaultIntervalMinutes;

            // Check if enough time has passed since last backup (unless forced)
            if (!options.forceCreate && this._lastBackupTime) {
                const timeSinceLastBackup = now.getTime() - this._lastBackupTime.getTime();
                const intervalMs = intervalMinutes * 60 * 1000;

                if (timeSinceLastBackup < intervalMs) {
                    return null;
                }
            }

            const content = document.getText();
            const contentHash = this.hashContent(content);

            // Skip backup if content hasn't changed (unless forced)
            if (!options.forceCreate && this._lastContentHash === contentHash) {
                return null;
            }

            const backupPath = this.generateBackupPath(document, options.label || 'backup');
            await this.writeBackupFile(backupPath, content);

            this._lastBackupTime = new Date();
            this._lastContentHash = contentHash;


            // Clean up old backups
            await this.cleanupOldBackups(document);

            return backupPath;
        } catch (error) {
            console.error('[BackupManager] Failed to create backup:', error);
            showWarning(`Failed to create backup: ${error}`);
            return null;
        }
    }

    /**
     * Create a backup from raw content (without needing a TextDocument)
     * Used for backing up external file content before overwriting
     * @returns The backup file path if successful, null if failed
     */
    public async createBackupFromContent(filePath: string, content: string, options: BackupOptions = {}): Promise<string | null> {
        try {
            if (this.isBackupDisabled(options)) {
                return null;
            }

            const backupPath = this.generateBackupPathFromFilePath(filePath, options.label || 'backup');
            await this.writeBackupFile(backupPath, content);
            return backupPath;
        } catch (error) {
            console.error('[BackupManager] Failed to create backup from content:', error);
            showWarning(`Failed to create backup: ${error}`);
            return null;
        }
    }

    /**
     * Generate backup file path from file path (without TextDocument)
     */
    private generateBackupPathFromFilePath(filePath: string, label: string = 'backup'): string {
        const dir = path.dirname(filePath);
        const backupLocation = configService.getConfig('backupLocation');

        let backupDir = dir;
        if (backupLocation === 'subfolder') {
            backupDir = getBackupFolderPath(dir);
        }

        return getLabeledBackupPath(filePath, label, backupDir);
    }

    /**
     * Generate backup file path
     */
    private generateBackupPath(document: vscode.TextDocument, label: string = 'backup'): string {
        const originalPath = document.uri.fsPath;
        const dir = path.dirname(originalPath);
        const backupLocation = configService.getConfig('backupLocation');

        let backupDir = dir;

        if (backupLocation === 'workspace-folder') {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                backupDir = getWorkspaceBackupFolderPath(workspaceFolder.uri.fsPath);
            }
        }

        // For autosave, use a fixed filename (only one autosave file)
        if (label === 'auto') {
            return getAutosavePath(originalPath, backupDir);
        }

        // For backup and conflict files, use timestamp
        return getLabeledBackupPath(originalPath, label, backupDir);
    }

    /**
     * Create a backup of an arbitrary file (for include files)
     */
    public async createFileBackup(filePath: string, content: string, options: BackupOptions = {}): Promise<string | null> {
        try {
            if (this.isBackupDisabled(options)) {
                return null;
            }

            // For conflict backups, always create regardless of content comparison
            if (!options.forceCreate) {
                const contentHash = this.hashContent(content);
                // Read existing file to compare content
                try {
                    const existingContent = fs.readFileSync(filePath, 'utf8');
                    const existingHash = this.hashContent(existingContent);
                    if (existingHash === contentHash) {
                        return null; // Content hasn't changed
                    }
                } catch (error) {
                    // File might not exist yet, proceed with backup
                }
            }
            // If forceCreate is true, skip all content comparison and always create backup

            const backupPath = this.generateFileBackupPath(filePath, options.label || 'backup');

            // Ensure backup directory exists
            const backupDir = path.dirname(backupPath);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            // Use the provided content (internal kanban changes) for backup
            // This is what we want to preserve before reloading from external file
            fs.writeFileSync(backupPath, content, 'utf8');

            // Set hidden attribute on Windows
            await this.setFileHidden(backupPath);

            return backupPath;

        } catch (error) {
            console.error('[BackupManager] Error creating file backup:', error);
            return null;
        }
    }

    /**
     * Generate backup path for arbitrary files
     */
    private generateFileBackupPath(filePath: string, label: string = 'backup'): string {
        const dir = path.dirname(filePath);
        const backupLocation = configService.getConfig('backupLocation');

        let backupDir = dir;

        if (backupLocation === 'workspace-folder') {
            // Try to find workspace folder for this file
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
            if (workspaceFolder) {
                backupDir = getWorkspaceBackupFolderPath(workspaceFolder.uri.fsPath);
            }
        }

        // For autosave, use a fixed filename (only one autosave file)
        if (label === 'auto') {
            return getAutosavePath(filePath, backupDir);
        }

        // For backup and conflict files, use timestamp
        return getLabeledBackupPath(filePath, label, backupDir);
    }

    /**
     * Simple hash function to detect content changes
     */
    private hashContent(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(36);
    }

    /**
     * Clean up old backups beyond the configured maximum
     */
    private async cleanupOldBackups(document: vscode.TextDocument): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('markdown-kanban');
            const maxBackups = config.get<number>('maxBackupsPerFile', 10);
            const backupLocation = config.get<string>('backupLocation', 'same-folder');

            const originalPath = document.uri.fsPath;
            const basename = path.basename(originalPath, '.md');

            // Determine backup directory (same logic as generateBackupPath)
            let backupDir = path.dirname(originalPath);
            if (backupLocation === 'workspace-folder') {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (workspaceFolder) {
                    backupDir = getWorkspaceBackupFolderPath(workspaceFolder.uri.fsPath);
                }
            }

            // Check if backup directory exists
            if (!fs.existsSync(backupDir)) {
                return;
            }

            // Only clean up backup files with timestamps, NOT autosave or conflict files
            // Pattern matches: .basename-backup-YYYYMMDDTHHmmss.md
            // This EXCLUDES: autosave (single file) and conflict files (user-created)
            const backupPattern = createBackupPattern(basename);

            const files = fs.readdirSync(backupDir);
            const backupFiles = files
                .filter(file => backupPattern.test(file))
                .map(file => ({
                    name: file,
                    path: path.join(backupDir, file),
                    stats: fs.statSync(path.join(backupDir, file))
                }))
                .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime()); // Sort by modification time, newest first

            // Delete old backups if we exceed the maximum
            if (backupFiles.length > maxBackups) {
                const filesToDelete = backupFiles.slice(maxBackups);

                for (const file of filesToDelete) {
                    try {
                        fs.unlinkSync(file.path);
                    } catch (error) {
                        console.error(`[BackupManager] Failed to delete backup ${file.name}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('[BackupManager] Failed to cleanup old backups:', error);
        }
    }

    /**
     * Start periodic backup timer
     */
    public startPeriodicBackup(document: vscode.TextDocument): void {
        this.stopPeriodicBackup();

        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const enableBackups = config.get<boolean>('enableBackups', true);
        const intervalMinutes = config.get<number>('backupInterval', 15);

        if (!enableBackups) {
            return;
        }

        // Convert minutes to milliseconds
        const intervalMs = intervalMinutes * 60 * 1000;

        this._backupTimer = setInterval(async () => {
            await this.createBackup(document);
        }, intervalMs);
    }

    /**
     * Stop periodic backup timer
     */
    public stopPeriodicBackup(): void {
        if (this._backupTimer) {
            clearInterval(this._backupTimer);
            this._backupTimer = null;
        }
    }

    /**
     * Set file as hidden on Windows using attrib command
     * On Unix systems, files starting with . are already hidden
     */
    private async setFileHidden(filePath: string): Promise<void> {
        try {
            // Only need to set hidden attribute on Windows
            if (process.platform === 'win32') {
                const { exec } = await import('child_process');
                const util = await import('util');
                const execPromise = util.promisify(exec);

                try {
                    await execPromise(`attrib +H "${filePath}"`);
                } catch (error) {
                    // Silently fail if attrib command fails
                    // The . prefix will still make it hidden in most file managers
                }
            }
        } catch (error) {
            // Silently fail - file is still created with . prefix
        }
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.stopPeriodicBackup();
    }
}
