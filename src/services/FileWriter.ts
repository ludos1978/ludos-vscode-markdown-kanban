import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getErrorMessage } from '../utils/stringUtils';

/**
 * Unified file writing utility
 * Consolidates all file write operations from across the codebase
 *
 * Replaces 8+ duplicate file write locations:
 * - exportService.ts: Multiple writeFileSync calls
 * - kanbanWebviewPanel.ts: Save operations
 * - backupService.ts: Backup file writing
 */
export class FileWriter {
    /**
     * Write content to a file with proper error handling
     *
     * @param filePath - Absolute path to the file
     * @param content - Content to write
     * @param options - Write options
     * @returns Success status
     */
    static async writeFile(
        filePath: string,
        content: string,
        options: FileWriteOptions = {}
    ): Promise<FileWriteResult> {
        const {
            createDirs = true,
            encoding = 'utf-8',
            backup = false,
            showNotification = true
        } = options;

        try {
            // Ensure directory exists
            if (createDirs) {
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            }

            // Create backup if requested
            if (backup && fs.existsSync(filePath)) {
                await this.createBackup(filePath);
            }

            // Write the file
            fs.writeFileSync(filePath, content, { encoding });

            // Show success notification
            if (showNotification) {
                vscode.window.showInformationMessage(
                    `File saved: ${path.basename(filePath)}`
                );
            }

            return {
                success: true,
                filePath,
                bytesWritten: Buffer.byteLength(content, encoding)
            };

        } catch (error) {
            const errorMessage = getErrorMessage(error);

            if (showNotification) {
                vscode.window.showErrorMessage(
                    `Failed to write file: ${errorMessage}`
                );
            }

            return {
                success: false,
                filePath,
                error: errorMessage
            };
        }
    }

    /**
     * Create a backup of a file
     *
     * @param filePath - Path to the file to backup
     * @returns Path to the backup file
     */
    private static async createBackup(filePath: string): Promise<string> {
        const timestamp = new Date().toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .split('Z')[0];

        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);

        const backupPath = path.join(dir, `${base}_backup_${timestamp}${ext}`);

        // Copy file to backup location
        fs.copyFileSync(filePath, backupPath);

        return backupPath;
    }
}

/**
 * Options for file write operations
 */
export interface FileWriteOptions {
    /** Create parent directories if they don't exist (default: true) */
    createDirs?: boolean;

    /** File encoding (default: 'utf-8') */
    encoding?: BufferEncoding;

    /** Create backup before writing (default: false) */
    backup?: boolean;

    /** Show VSCode notification on success/failure (default: true) */
    showNotification?: boolean;
}

/**
 * Result of a file write operation
 */
export interface FileWriteResult {
    /** Whether the write was successful */
    success: boolean;

    /** Path to the written file */
    filePath: string;

    /** Number of bytes written (only on success) */
    bytesWritten?: number;

    /** Error message (only on failure) */
    error?: string;
}

