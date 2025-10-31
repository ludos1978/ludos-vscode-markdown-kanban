import { KanbanBoard } from '../../markdownParser';

/**
 * Adapter Pattern - Storage Backend Abstraction
 *
 * Provides a unified interface for different storage backends
 * (file system, cloud storage, databases, etc.)
 */

export interface IStorageAdapter {
    /**
     * Read data from storage
     */
    read(path: string): Promise<string>;

    /**
     * Write data to storage
     */
    write(path: string, data: string): Promise<void>;

    /**
     * Check if path exists
     */
    exists(path: string): Promise<boolean>;

    /**
     * Delete path
     */
    delete(path: string): Promise<void>;

    /**
     * List contents of directory
     */
    list(directory: string): Promise<string[]>;

    /**
     * Get metadata for path
     */
    getMetadata(path: string): Promise<StorageMetadata>;

    /**
     * Create backup
     */
    createBackup(path: string, label?: string): Promise<string>;
}

/**
 * Storage metadata interface
 */
export interface StorageMetadata {
    size: number;
    lastModified: Date;
    permissions: string;
    isDirectory: boolean;
    mimeType?: string;
}

/**
 * File System Storage Adapter
 * Adapts Node.js file system operations to storage interface
 */
export class FileSystemAdapter implements IStorageAdapter {
    constructor(private basePath: string = '') {}

    async read(path: string): Promise<string> {
        const fs = await import('fs');
        const fullPath = this.resolvePath(path);
        return fs.promises.readFile(fullPath, 'utf-8');
    }

    async write(path: string, data: string): Promise<void> {
        const fs = await import('fs');
        const pathModule = await import('path');
        const fullPath = this.resolvePath(path);

        // Ensure directory exists
        const dir = pathModule.dirname(fullPath);
        await fs.promises.mkdir(dir, { recursive: true });

        await fs.promises.writeFile(fullPath, data, 'utf-8');
    }

    async exists(path: string): Promise<boolean> {
        const fs = await import('fs');
        try {
            await fs.promises.access(this.resolvePath(path));
            return true;
        } catch {
            return false;
        }
    }

    async delete(path: string): Promise<void> {
        const fs = await import('fs');
        const fullPath = this.resolvePath(path);
        await fs.promises.unlink(fullPath);
    }

    async list(directory: string): Promise<string[]> {
        const fs = await import('fs');
        const fullPath = this.resolvePath(directory);
        return fs.promises.readdir(fullPath);
    }

    async getMetadata(path: string): Promise<StorageMetadata> {
        const fs = await import('fs');
        const fullPath = this.resolvePath(path);
        const stats = await fs.promises.stat(fullPath);

        return {
            size: stats.size,
            lastModified: stats.mtime,
            permissions: stats.mode.toString(8),
            isDirectory: stats.isDirectory(),
            mimeType: this.inferMimeType(path)
        };
    }

    async createBackup(path: string, label: string = 'backup'): Promise<string> {
        const pathModule = await import('path');
        const fs = await import('fs');

        const fullPath = this.resolvePath(path);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${fullPath}.${timestamp}.${label}`;

        await fs.promises.copyFile(fullPath, backupPath);
        return backupPath;
    }

    private resolvePath(path: string): string {
        // Import synchronously since path is a built-in module
        const pathModule = require('path');
        return this.basePath ? pathModule.resolve(this.basePath, path) : path;
    }

    private inferMimeType(path: string): string {
        const ext = path.toLowerCase().split('.').pop();
        switch (ext) {
            case 'md': return 'text/markdown';
            case 'json': return 'application/json';
            case 'txt': return 'text/plain';
            case 'jpg': case 'jpeg': return 'image/jpeg';
            case 'png': return 'image/png';
            case 'svg': return 'image/svg+xml';
            case 'pdf': return 'application/pdf';
            default: return 'application/octet-stream';
        }
    }
}

/**
 * In-Memory Storage Adapter
 * Useful for testing and temporary storage
 */
export class InMemoryAdapter implements IStorageAdapter {
    private storage: Map<string, string> = new Map();
    private metadata: Map<string, StorageMetadata> = new Map();

    async read(path: string): Promise<string> {
        const data = this.storage.get(path);
        if (data === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        return data;
    }

    async write(path: string, data: string): Promise<void> {
        this.storage.set(path, data);
        this.metadata.set(path, {
            size: data.length,
            lastModified: new Date(),
            permissions: 'rw-r--r--',
            isDirectory: false,
            mimeType: this.inferMimeType(path)
        });
    }

    async exists(path: string): Promise<boolean> {
        return this.storage.has(path);
    }

    async delete(path: string): Promise<void> {
        this.storage.delete(path);
        this.metadata.delete(path);
    }

    async list(directory: string): Promise<string[]> {
        const prefix = directory.endsWith('/') ? directory : directory + '/';
        return Array.from(this.storage.keys())
            .filter(key => key.startsWith(prefix))
            .map(key => key.substring(prefix.length).split('/')[0])
            .filter((value, index, array) => array.indexOf(value) === index);
    }

    async getMetadata(path: string): Promise<StorageMetadata> {
        const meta = this.metadata.get(path);
        if (!meta) {
            throw new Error(`File not found: ${path}`);
        }
        return { ...meta };
    }

    async createBackup(path: string, label: string = 'backup'): Promise<string> {
        const data = await this.read(path);
        const backupPath = `${path}.${label}`;
        await this.write(backupPath, data);
        return backupPath;
    }

    private inferMimeType(path: string): string {
        const ext = path.toLowerCase().split('.').pop();
        switch (ext) {
            case 'md': return 'text/markdown';
            case 'json': return 'application/json';
            case 'txt': return 'text/plain';
            default: return 'application/octet-stream';
        }
    }

    /**
     * Get all stored data (for testing)
     */
    getAllData(): Map<string, string> {
        return new Map(this.storage);
    }

    /**
     * Clear all data
     */
    clear(): void {
        this.storage.clear();
        this.metadata.clear();
    }
}

/**
 * Cloud Storage Adapter (Abstract)
 * Base class for cloud storage implementations
 */
export abstract class CloudStorageAdapter implements IStorageAdapter {
    constructor(protected bucketName: string, protected region?: string) {}

    abstract read(path: string): Promise<string>;
    abstract write(path: string, data: string): Promise<void>;
    abstract exists(path: string): Promise<boolean>;
    abstract delete(path: string): Promise<void>;
    abstract list(directory: string): Promise<string[]>;
    abstract getMetadata(path: string): Promise<StorageMetadata>;
    abstract createBackup(path: string, label?: string): Promise<string>;

    /**
     * Upload with progress callback
     */
    abstract uploadWithProgress(path: string, data: string, onProgress?: (progress: number) => void): Promise<void>;

    /**
     * Download with progress callback
     */
    abstract downloadWithProgress(path: string, onProgress?: (progress: number) => void): Promise<string>;
}

/**
 * AWS S3 Adapter Example
 */
export class S3Adapter extends CloudStorageAdapter {
    constructor(bucketName: string, region: string = 'us-east-1') {
        super(bucketName, region);
    }

    async read(path: string): Promise<string> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.read not implemented');
    }

    async write(path: string, data: string): Promise<void> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.write not implemented');
    }

    async exists(path: string): Promise<boolean> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.exists not implemented');
    }

    async delete(path: string): Promise<void> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.delete not implemented');
    }

    async list(directory: string): Promise<string[]> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.list not implemented');
    }

    async getMetadata(path: string): Promise<StorageMetadata> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.getMetadata not implemented');
    }

    async createBackup(path: string, label?: string): Promise<string> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.createBackup not implemented');
    }

    async uploadWithProgress(path: string, data: string, onProgress?: (progress: number) => void): Promise<void> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.uploadWithProgress not implemented');
    }

    async downloadWithProgress(path: string, onProgress?: (progress: number) => void): Promise<string> {
        // AWS S3 implementation would go here
        throw new Error('S3Adapter.downloadWithProgress not implemented');
    }
}

/**
 * Storage Adapter Factory
 */
export class StorageAdapterFactory {
    private static adapters: Map<string, IStorageAdapter> = new Map();

    static registerAdapter(name: string, adapter: IStorageAdapter): void {
        this.adapters.set(name, adapter);
    }

    static getAdapter(name: string): IStorageAdapter {
        const adapter = this.adapters.get(name);
        if (!adapter) {
            throw new Error(`Storage adapter not found: ${name}`);
        }
        return adapter;
    }

    static createFileSystemAdapter(basePath?: string): FileSystemAdapter {
        return new FileSystemAdapter(basePath);
    }

    static createInMemoryAdapter(): InMemoryAdapter {
        return new InMemoryAdapter();
    }

    static createS3Adapter(bucketName: string, region?: string): S3Adapter {
        return new S3Adapter(bucketName, region);
    }

    static getRegisteredAdapters(): string[] {
        return Array.from(this.adapters.keys());
    }
}

/**
 * Board Storage Service using Adapter Pattern
 */
export class BoardStorageService {
    constructor(private adapter: IStorageAdapter) {}

    /**
     * Save board to storage
     */
    async saveBoard(board: KanbanBoard, path: string): Promise<void> {
        const markdown = this.boardToMarkdown(board);
        await this.adapter.write(path, markdown);
    }

    /**
     * Load board from storage
     */
    async loadBoard(path: string): Promise<KanbanBoard> {
        const markdown = await this.adapter.read(path);
        return this.markdownToBoard(markdown);
    }

    /**
     * Check if board exists
     */
    async boardExists(path: string): Promise<boolean> {
        return this.adapter.exists(path);
    }

    /**
     * Create backup of board
     */
    async backupBoard(path: string, label?: string): Promise<string> {
        return this.adapter.createBackup(path, label);
    }

    /**
     * Get board metadata
     */
    async getBoardMetadata(path: string): Promise<StorageMetadata> {
        return this.adapter.getMetadata(path);
    }

    private boardToMarkdown(board: KanbanBoard): string {
        // Convert board to markdown (simplified)
        return `# ${board.title}\n\n${board.columns.map(col =>
            `## ${col.title}\n\n${col.tasks.map(task => `- ${task.title}`).join('\n')}`
        ).join('\n\n')}`;
    }

    private markdownToBoard(markdown: string): KanbanBoard {
        // Parse markdown to board (simplified)
        const lines = markdown.split('\n');
        const title = lines[0]?.replace('# ', '') || 'Untitled Board';

        return {
            valid: true,
            title,
            columns: [],
            yamlHeader: null,
            kanbanFooter: null
        };
    }
}
