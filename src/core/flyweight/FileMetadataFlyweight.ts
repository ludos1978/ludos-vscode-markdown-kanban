import { MarkdownFile } from '../../files/MarkdownFile';

/**
 * Flyweight Pattern - Shared File Metadata
 *
 * Shares common file metadata to reduce memory usage and improve performance.
 * Separates intrinsic state (shared) from extrinsic state (unique per file).
 */

export interface IFileMetadata {
    getSize(): number;
    getLastModified(): Date | null;
    getPermissions(): string;
    isReadable(): boolean;
    isWritable(): boolean;
    getExtension(): string;
    getMimeType(): string;
}

export interface IFileMetadataFactory {
    getMetadata(filePath: string): IFileMetadata;
}

/**
 * Intrinsic File Metadata - Shared State (Flyweight)
 */
class FileMetadataFlyweight implements IFileMetadata {
    constructor(
        private extension: string,
        private mimeType: string,
        private isTextFile: boolean,
        private isBinaryFile: boolean,
        private commonPermissions: string
    ) {}

    getSize(): number {
        // Size is extrinsic - not shared
        throw new Error('Size is extrinsic state - use FileMetadataContext');
    }

    getLastModified(): Date | null {
        // Modification time is extrinsic - not shared
        throw new Error('Last modified is extrinsic state - use FileMetadataContext');
    }

    getPermissions(): string {
        return this.commonPermissions;
    }

    isReadable(): boolean {
        return this.commonPermissions.includes('r');
    }

    isWritable(): boolean {
        return this.commonPermissions.includes('w');
    }

    getExtension(): string {
        return this.extension;
    }

    getMimeType(): string {
        return this.mimeType;
    }

    isText(): boolean {
        return this.isTextFile;
    }

    isBinary(): boolean {
        return this.isBinaryFile;
    }
}

/**
 * Extrinsic File Metadata Context
 */
export class FileMetadataContext {
    private flyweight: FileMetadataFlyweight;
    private size: number = 0;
    private lastModified: Date | null = null;
    private customPermissions: string = '';

    constructor(
        private filePath: string,
        flyweight: FileMetadataFlyweight
    ) {
        this.flyweight = flyweight;
        this.loadExtrinsicState();
    }

    private async loadExtrinsicState(): Promise<void> {
        try {
            // Load extrinsic state from file system
            const stats = await this.getFileStats();
            this.size = stats.size;
            this.lastModified = stats.mtime;
            this.customPermissions = stats.permissions;
        } catch (error) {
            console.warn(`[FileMetadataContext] Failed to load extrinsic state for ${this.filePath}:`, error);
        }
    }

    private async getFileStats(): Promise<{ size: number; mtime: Date; permissions: string }> {
        // This would use Node.js fs.stat
        // For now, return mock data
        return {
            size: Math.floor(Math.random() * 10000),
            mtime: new Date(),
            permissions: 'rw-r--r--'
        };
    }

    // Delegate intrinsic operations to flyweight
    getExtension(): string {
        return this.flyweight.getExtension();
    }

    getMimeType(): string {
        return this.flyweight.getMimeType();
    }

    isText(): boolean {
        return this.flyweight.isText();
    }

    isBinary(): boolean {
        return this.flyweight.isBinary();
    }

    // Handle extrinsic operations
    getSize(): number {
        return this.size;
    }

    getLastModified(): Date | null {
        return this.lastModified;
    }

    getPermissions(): string {
        return this.customPermissions || this.flyweight.getPermissions();
    }

    isReadable(): boolean {
        return this.getPermissions().includes('r');
    }

    isWritable(): boolean {
        return this.getPermissions().includes('w');
    }

    /**
     * Update extrinsic state
     */
    async refresh(): Promise<void> {
        await this.loadExtrinsicState();
    }
}

/**
 * File Metadata Factory - Flyweight Factory
 */
export class FileMetadataFactory implements IFileMetadataFactory {
    private flyweights: Map<string, FileMetadataFlyweight> = new Map();
    private contexts: Map<string, FileMetadataContext> = new Map();

    /**
     * Get metadata for a file (creates context with shared flyweight)
     */
    getMetadata(filePath: string): IFileMetadata {
        // Check if context already exists
        if (this.contexts.has(filePath)) {
            return this.contexts.get(filePath)!;
        }

        // Get or create flyweight based on file extension
        const extension = this.getFileExtension(filePath);
        const flyweight = this.getFlyweight(extension);

        // Create context
        const context = new FileMetadataContext(filePath, flyweight);
        this.contexts.set(filePath, context);

        return context;
    }

    /**
     * Get shared flyweight for file extension
     */
    private getFlyweight(extension: string): FileMetadataFlyweight {
        if (this.flyweights.has(extension)) {
            return this.flyweights.get(extension)!;
        }

        // Create new flyweight for this extension
        const flyweight = this.createFlyweight(extension);
        this.flyweights.set(extension, flyweight);

        return flyweight;
    }

    /**
     * Create flyweight based on file extension
     */
    private createFlyweight(extension: string): FileMetadataFlyweight {
        const ext = extension.toLowerCase();

        // Define metadata based on file extension
        switch (ext) {
            case '.md':
            case '.markdown':
                return new FileMetadataFlyweight(ext, 'text/markdown', true, false, 'rw-r--r--');

            case '.txt':
                return new FileMetadataFlyweight(ext, 'text/plain', true, false, 'rw-r--r--');

            case '.json':
                return new FileMetadataFlyweight(ext, 'application/json', true, false, 'rw-r--r--');

            case '.yaml':
            case '.yml':
                return new FileMetadataFlyweight(ext, 'application/yaml', true, false, 'rw-r--r--');

            case '.jpg':
            case '.jpeg':
                return new FileMetadataFlyweight(ext, 'image/jpeg', false, true, 'rw-r--r--');

            case '.png':
                return new FileMetadataFlyweight(ext, 'image/png', false, true, 'rw-r--r--');

            case '.svg':
                return new FileMetadataFlyweight(ext, 'image/svg+xml', true, false, 'rw-r--r--');

            case '.pdf':
                return new FileMetadataFlyweight(ext, 'application/pdf', false, true, 'rw-r--r--');

            default:
                // Unknown extension - assume text file
                return new FileMetadataFlyweight(ext, 'text/plain', true, false, 'rw-r--r--');
        }
    }

    /**
     * Extract file extension from path
     */
    private getFileExtension(filePath: string): string {
        const lastDotIndex = filePath.lastIndexOf('.');
        return lastDotIndex >= 0 ? filePath.substring(lastDotIndex) : '';
    }

    /**
     * Refresh metadata for a specific file
     */
    async refreshMetadata(filePath: string): Promise<void> {
        const context = this.contexts.get(filePath);
        if (context) {
            await context.refresh();
        }
    }

    /**
     * Remove metadata for a file (when file is deleted)
     */
    removeMetadata(filePath: string): void {
        this.contexts.delete(filePath);
    }

    /**
     * Get factory statistics
     */
    getStats(): {
        flyweightCount: number;
        contextCount: number;
        memorySavings: string;
    } {
        const flyweightCount = this.flyweights.size;
        const contextCount = this.contexts.size;

        // Calculate approximate memory savings
        // Each flyweight saves ~100 bytes of intrinsic state
        // Each context has ~50 bytes of extrinsic state
        const estimatedSavings = flyweightCount * 100;

        return {
            flyweightCount,
            contextCount,
            memorySavings: `~${estimatedSavings} bytes saved`
        };
    }

    /**
     * Clear all metadata (useful for testing)
     */
    clear(): void {
        this.flyweights.clear();
        this.contexts.clear();
    }
}

/**
 * File Metadata Cache with Flyweight Optimization
 */
export class FileMetadataCache {
    private factory: FileMetadataFactory;
    private cache: Map<string, IFileMetadata> = new Map();
    private maxCacheSize: number = 1000;

    constructor() {
        this.factory = new FileMetadataFactory();
    }

    /**
     * Get cached metadata for file
     */
    getMetadata(filePath: string): IFileMetadata {
        // Check cache first
        if (this.cache.has(filePath)) {
            return this.cache.get(filePath)!;
        }

        // Get from factory and cache it
        const metadata = this.factory.getMetadata(filePath);

        // Implement LRU-style cache eviction
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(filePath, metadata);
        return metadata;
    }

    /**
     * Refresh metadata for file
     */
    async refreshMetadata(filePath: string): Promise<void> {
        await this.factory.refreshMetadata(filePath);

        // Update cache if it exists
        if (this.cache.has(filePath)) {
            this.cache.set(filePath, this.factory.getMetadata(filePath));
        }
    }

    /**
     * Remove file from cache
     */
    removeFile(filePath: string): void {
        this.cache.delete(filePath);
        this.factory.removeMetadata(filePath);
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        cacheSize: number;
        maxCacheSize: number;
        factoryStats: any;
    } {
        return {
            cacheSize: this.cache.size,
            maxCacheSize: this.maxCacheSize,
            factoryStats: this.factory.getStats()
        };
    }

    /**
     * Clear cache
     */
    clear(): void {
        this.cache.clear();
        this.factory.clear();
    }
}

/**
 * File Type Classifier using Flyweight Metadata
 */
export class FileTypeClassifier {
    private metadataCache: FileMetadataCache;

    constructor() {
        this.metadataCache = new FileMetadataCache();
    }

    /**
     * Classify file type based on metadata
     */
    classifyFile(filePath: string): FileTypeClassification {
        const metadata = this.metadataCache.getMetadata(filePath);

        return {
            extension: metadata.getExtension(),
            mimeType: metadata.getMimeType(),
            isTextFile: this.isTextFile(metadata),
            isImageFile: this.isImageFile(metadata),
            isMarkdownFile: this.isMarkdownFile(metadata),
            isBinaryFile: this.isBinaryFile(metadata),
            size: metadata.getSize(),
            lastModified: metadata.getLastModified(),
            permissions: metadata.getPermissions()
        };
    }

    private isTextFile(metadata: IFileMetadata): boolean {
        const mimeType = metadata.getMimeType();
        return mimeType.startsWith('text/') ||
               mimeType === 'application/json' ||
               mimeType === 'application/yaml' ||
               mimeType === 'image/svg+xml';
    }

    private isImageFile(metadata: IFileMetadata): boolean {
        const mimeType = metadata.getMimeType();
        return mimeType.startsWith('image/');
    }

    private isMarkdownFile(metadata: IFileMetadata): boolean {
        return metadata.getExtension() === '.md' ||
               metadata.getExtension() === '.markdown' ||
               metadata.getMimeType() === 'text/markdown';
    }

    private isBinaryFile(metadata: IFileMetadata): boolean {
        return !this.isTextFile(metadata);
    }
}

export interface FileTypeClassification {
    extension: string;
    mimeType: string;
    isTextFile: boolean;
    isImageFile: boolean;
    isMarkdownFile: boolean;
    isBinaryFile: boolean;
    size: number;
    lastModified: Date | null;
    permissions: string;
}
