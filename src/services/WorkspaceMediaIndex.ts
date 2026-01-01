/**
 * WorkspaceMediaIndex Service
 *
 * SQLite-based workspace-wide media file index for fast hash lookups.
 * Enables instant duplicate detection when files are dropped.
 *
 * Uses sql.js (pure JavaScript SQLite) with WASM for database operations.
 * Database is stored at .vscode/kanban-media-index.db
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import initSqlJs, { Database } from 'sql.js';
import { DOTTED_EXTENSIONS } from '../shared/fileTypeDefinitions';
import { DRAWIO_EXTENSIONS, EXCALIDRAW_EXTENSIONS } from '../constants/FileExtensions';

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'diagram';

export interface MediaFileRecord {
    path: string;
    hash: string;
    mtime: number;
    size: number;
    type: MediaType;
}

export class WorkspaceMediaIndex implements vscode.Disposable {
    private static instance: WorkspaceMediaIndex | null = null;
    private db: Database | null = null;
    private dbPath: string | null = null;
    private extensionPath: string;
    private initialized = false;

    private static readonly PARTIAL_HASH_SIZE = 1024 * 1024; // 1MB

    // Build media extensions map from centralized definitions
    private static readonly MEDIA_EXTENSIONS: Map<string, MediaType> = (() => {
        const map = new Map<string, MediaType>();

        // Images
        DOTTED_EXTENSIONS.image.forEach(ext => map.set(ext.toLowerCase(), 'image'));

        // Video
        DOTTED_EXTENSIONS.video.forEach(ext => map.set(ext.toLowerCase(), 'video'));

        // Audio
        DOTTED_EXTENSIONS.audio.forEach(ext => map.set(ext.toLowerCase(), 'audio'));

        // Documents (PDF only for media tracking)
        map.set('.pdf', 'document');

        // Diagrams
        DRAWIO_EXTENSIONS.forEach(ext => map.set(ext.toLowerCase(), 'diagram'));
        EXCALIDRAW_EXTENSIONS.forEach(ext => map.set(ext.toLowerCase(), 'diagram'));

        return map;
    })();

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    static getInstance(extensionPath?: string): WorkspaceMediaIndex | null {
        if (!WorkspaceMediaIndex.instance && extensionPath) {
            WorkspaceMediaIndex.instance = new WorkspaceMediaIndex(extensionPath);
        }
        return WorkspaceMediaIndex.instance;
    }

    /**
     * Initialize the SQLite database
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            console.warn('[WorkspaceMediaIndex] No workspace folder found');
            return;
        }

        try {
            // Initialize sql.js with WASM file
            const wasmPath = path.join(this.extensionPath, 'dist', 'sql-wasm.wasm');
            const SQL = await initSqlJs({
                locateFile: () => wasmPath
            });

            // Ensure .vscode directory exists
            const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }

            // Database path
            this.dbPath = path.join(vscodeDir, 'kanban-media-index.db');

            // Load existing database or create new one
            if (fs.existsSync(this.dbPath)) {
                const buffer = fs.readFileSync(this.dbPath);
                this.db = new SQL.Database(buffer);
                console.log('[WorkspaceMediaIndex] Loaded existing database');
            } else {
                this.db = new SQL.Database();
                console.log('[WorkspaceMediaIndex] Created new database');
            }

            // Create schema
            this.db.run(`
                CREATE TABLE IF NOT EXISTS media_files (
                    path TEXT PRIMARY KEY,
                    hash TEXT NOT NULL,
                    mtime INTEGER NOT NULL,
                    size INTEGER NOT NULL,
                    type TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_hash ON media_files(hash);
                CREATE INDEX IF NOT EXISTS idx_type ON media_files(type);
            `);

            this.save();
            this.initialized = true;
            console.log('[WorkspaceMediaIndex] Initialized successfully');

        } catch (error) {
            console.error('[WorkspaceMediaIndex] Failed to initialize:', error);
        }
    }

    /**
     * Check if service is initialized
     */
    isInitialized(): boolean {
        return this.initialized && this.db !== null;
    }

    /**
     * Calculate partial hash for a file (first 1MB + size for large files)
     */
    private calculateHash(filePath: string): string {
        const stats = fs.statSync(filePath);
        let buffer: Buffer;

        if (stats.size <= WorkspaceMediaIndex.PARTIAL_HASH_SIZE) {
            buffer = fs.readFileSync(filePath);
        } else {
            // For large files: read first 1MB and append file size
            const fd = fs.openSync(filePath, 'r');
            buffer = Buffer.alloc(WorkspaceMediaIndex.PARTIAL_HASH_SIZE);
            fs.readSync(fd, buffer, 0, WorkspaceMediaIndex.PARTIAL_HASH_SIZE, 0);
            fs.closeSync(fd);
            // Append size for uniqueness
            buffer = Buffer.concat([buffer, Buffer.from(stats.size.toString())]);
        }

        return crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 12);
    }

    /**
     * Calculate hash from buffer data (for dropped files from frontend)
     */
    calculateHashFromBuffer(buffer: Buffer, fileSize: number): string {
        let hashBuffer: Buffer;

        if (fileSize <= WorkspaceMediaIndex.PARTIAL_HASH_SIZE) {
            hashBuffer = buffer;
        } else {
            // For large files: use first 1MB and append file size
            const partialBuffer = buffer.subarray(0, WorkspaceMediaIndex.PARTIAL_HASH_SIZE);
            hashBuffer = Buffer.concat([partialBuffer, Buffer.from(fileSize.toString())]);
        }

        return crypto.createHash('sha256').update(hashBuffer).digest('hex').substring(0, 12);
    }

    /**
     * Get media type from file path
     */
    private getMediaType(filePath: string): MediaType | null {
        const lowerPath = filePath.toLowerCase();

        // Check compound extensions first (e.g., .excalidraw.json)
        for (const [ext, type] of WorkspaceMediaIndex.MEDIA_EXTENSIONS) {
            if (lowerPath.endsWith(ext)) {
                return type;
            }
        }

        return null;
    }

    /**
     * Find files by hash
     */
    findByHash(hash: string): MediaFileRecord[] {
        if (!this.db) {
            return [];
        }

        try {
            const stmt = this.db.prepare('SELECT path, hash, mtime, size, type FROM media_files WHERE hash = ?');
            stmt.bind([hash]);

            const results: MediaFileRecord[] = [];
            while (stmt.step()) {
                const row = stmt.getAsObject() as Record<string, unknown>;
                results.push({
                    path: row.path as string,
                    hash: row.hash as string,
                    mtime: row.mtime as number,
                    size: row.size as number,
                    type: row.type as MediaType
                });
            }
            stmt.free();

            return results;
        } catch (error) {
            console.error('[WorkspaceMediaIndex] Error finding by hash:', error);
            return [];
        }
    }

    /**
     * Get a file record by path
     */
    getByPath(relativePath: string): MediaFileRecord | null {
        if (!this.db) {
            return null;
        }

        try {
            const stmt = this.db.prepare('SELECT path, hash, mtime, size, type FROM media_files WHERE path = ?');
            stmt.bind([relativePath]);

            if (stmt.step()) {
                const row = stmt.getAsObject() as Record<string, unknown>;
                stmt.free();
                return {
                    path: row.path as string,
                    hash: row.hash as string,
                    mtime: row.mtime as number,
                    size: row.size as number,
                    type: row.type as MediaType
                };
            }
            stmt.free();
            return null;
        } catch (error) {
            console.error('[WorkspaceMediaIndex] Error getting by path:', error);
            return null;
        }
    }

    /**
     * Update index for a single file
     */
    updateFile(absolutePath: string): boolean {
        if (!this.db) return false;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return false;

        const type = this.getMediaType(absolutePath);
        if (!type) return false;

        const relativePath = path.relative(workspaceFolder.uri.fsPath, absolutePath);

        // Check if file exists
        if (!fs.existsSync(absolutePath)) {
            // File deleted - remove from index
            this.db.run('DELETE FROM media_files WHERE path = ?', [relativePath]);
            this.save();
            return true;
        }

        try {
            const stats = fs.statSync(absolutePath);
            const mtime = Math.floor(stats.mtimeMs);

            // Check if needs update (mtime changed)
            const existing = this.getByPath(relativePath);
            if (existing && existing.mtime === mtime) {
                return false; // No change needed
            }

            // Calculate hash and update/insert
            const hash = this.calculateHash(absolutePath);
            this.db.run(
                'INSERT OR REPLACE INTO media_files (path, hash, mtime, size, type) VALUES (?, ?, ?, ?, ?)',
                [relativePath, hash, mtime, stats.size, type]
            );
            this.save();

            return true;
        } catch (error) {
            console.error('[WorkspaceMediaIndex] Error updating file:', error);
            return false;
        }
    }

    /**
     * Remove a file from the index
     */
    removeFile(absolutePath: string): void {
        if (!this.db) return;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const relativePath = path.relative(workspaceFolder.uri.fsPath, absolutePath);
        this.db.run('DELETE FROM media_files WHERE path = ?', [relativePath]);
        this.save();
    }

    /**
     * Scan workspace for media files and update index
     */
    async scanWorkspace(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<number> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder || !this.db) return 0;

        // Build glob pattern from all media extensions
        const extensions = Array.from(WorkspaceMediaIndex.MEDIA_EXTENSIONS.keys())
            .map(ext => ext.slice(1)) // Remove leading dot
            .filter(ext => !ext.includes('.')); // Skip compound extensions for glob

        // Add compound extensions separately
        const compoundExts = ['excalidraw.json', 'excalidraw.svg'];

        const patterns = [
            `**/*.{${extensions.join(',')}}`,
            ...compoundExts.map(ext => `**/*.${ext}`)
        ];

        const exclude = '**/node_modules/**';

        let totalUpdated = 0;
        let totalFiles = 0;

        for (const pattern of patterns) {
            const files = await vscode.workspace.findFiles(pattern, exclude);
            totalFiles += files.length;

            for (let i = 0; i < files.length; i++) {
                const updated = this.updateFile(files[i].fsPath);
                if (updated) totalUpdated++;

                if (progress && i % 50 === 0) {
                    progress.report({
                        message: `Indexing media files... (${totalUpdated} updated)`,
                        increment: 1
                    });
                }
            }
        }

        console.log(`[WorkspaceMediaIndex] Scanned ${totalFiles} files, updated ${totalUpdated}`);
        return totalUpdated;
    }

    /**
     * Get statistics about the index
     */
    getStats(): { totalFiles: number; byType: Record<string, number> } {
        if (!this.db) {
            return { totalFiles: 0, byType: {} };
        }

        try {
            const totalResult = this.db.exec('SELECT COUNT(*) as count FROM media_files');
            const totalFiles = totalResult[0]?.values[0]?.[0] as number || 0;

            const typeResult = this.db.exec('SELECT type, COUNT(*) as count FROM media_files GROUP BY type');
            const byType: Record<string, number> = {};
            if (typeResult[0]) {
                for (const row of typeResult[0].values) {
                    byType[row[0] as string] = row[1] as number;
                }
            }

            return { totalFiles, byType };
        } catch (error) {
            console.error('[WorkspaceMediaIndex] Error getting stats:', error);
            return { totalFiles: 0, byType: {} };
        }
    }

    /**
     * Clear the entire index
     */
    clear(): void {
        if (!this.db) return;
        this.db.run('DELETE FROM media_files');
        this.save();
        console.log('[WorkspaceMediaIndex] Index cleared');
    }

    /**
     * Save database to disk
     */
    private save(): void {
        if (!this.db || !this.dbPath) return;

        try {
            const data = this.db.export();
            fs.writeFileSync(this.dbPath, Buffer.from(data));
        } catch (error) {
            console.error('[WorkspaceMediaIndex] Failed to save database:', error);
        }
    }

    /**
     * Dispose and cleanup
     */
    dispose(): void {
        if (this.db) {
            this.save();
            this.db.close();
            this.db = null;
        }
        this.initialized = false;
        WorkspaceMediaIndex.instance = null;
        console.log('[WorkspaceMediaIndex] Disposed');
    }
}
