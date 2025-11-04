import { MarkdownFile } from '../../files/MarkdownFile';

/**
 * Iterator Pattern - File Collection Traversal
 *
 * Provides different ways to iterate through file collections
 * without exposing the underlying data structures.
 */

export interface IIterator<T> {
    hasNext(): boolean;
    next(): T;
    current(): T | null;
    reset(): void;
}

export interface IIterable<T> {
    createIterator(): IIterator<T>;
}

/**
 * File Iterator - Basic file collection iterator
 */
export class FileIterator implements IIterator<MarkdownFile> {
    private position: number = 0;

    constructor(private files: MarkdownFile[]) {}

    hasNext(): boolean {
        return this.position < this.files.length;
    }

    next(): MarkdownFile {
        if (!this.hasNext()) {
            throw new Error('No more files in iterator');
        }
        return this.files[this.position++];
    }

    current(): MarkdownFile | null {
        if (this.position === 0 || this.position > this.files.length) {
            return null;
        }
        return this.files[this.position - 1];
    }

    reset(): void {
        this.position = 0;
    }

    /**
     * Get current position
     */
    getPosition(): number {
        return this.position;
    }

    /**
     * Get total count
     */
    getCount(): number {
        return this.files.length;
    }
}

/**
 * Filtered File Iterator - Iterator with filtering capabilities
 */
export class FilteredFileIterator implements IIterator<MarkdownFile> {
    private position: number = 0;
    private filteredFiles: MarkdownFile[] = [];

    constructor(
        files: MarkdownFile[],
        private filter: (file: MarkdownFile) => boolean
    ) {
        this.filteredFiles = files.filter(filter);
    }

    hasNext(): boolean {
        return this.position < this.filteredFiles.length;
    }

    next(): MarkdownFile {
        if (!this.hasNext()) {
            throw new Error('No more files in iterator');
        }
        return this.filteredFiles[this.position++];
    }

    current(): MarkdownFile | null {
        if (this.position === 0 || this.position > this.filteredFiles.length) {
            return null;
        }
        return this.filteredFiles[this.position - 1];
    }

    reset(): void {
        this.position = 0;
    }

    /**
     * Get filtered count
     */
    getFilteredCount(): number {
        return this.filteredFiles.length;
    }
}

/**
 * Sorted File Iterator - Iterator with sorting capabilities
 */
export class SortedFileIterator implements IIterator<MarkdownFile> {
    private position: number = 0;
    private sortedFiles: MarkdownFile[] = [];

    constructor(
        files: MarkdownFile[],
        private comparator: (a: MarkdownFile, b: MarkdownFile) => number
    ) {
        this.sortedFiles = [...files].sort(comparator);
    }

    hasNext(): boolean {
        return this.position < this.sortedFiles.length;
    }

    next(): MarkdownFile {
        if (!this.hasNext()) {
            throw new Error('No more files in iterator');
        }
        return this.sortedFiles[this.position++];
    }

    current(): MarkdownFile | null {
        if (this.position === 0 || this.position > this.sortedFiles.length) {
            return null;
        }
        return this.sortedFiles[this.position - 1];
    }

    reset(): void {
        this.position = 0;
    }
}

/**
 * Paged File Iterator - Iterator with pagination support
 */
export class PagedFileIterator implements IIterator<MarkdownFile[]> {
    private currentPage: number = 0;
    private pages: MarkdownFile[][] = [];

    constructor(
        files: MarkdownFile[],
        private pageSize: number
    ) {
        // Split files into pages
        for (let i = 0; i < files.length; i += pageSize) {
            this.pages.push(files.slice(i, i + pageSize));
        }
    }

    hasNext(): boolean {
        return this.currentPage < this.pages.length;
    }

    next(): MarkdownFile[] {
        if (!this.hasNext()) {
            throw new Error('No more pages in iterator');
        }
        return this.pages[this.currentPage++];
    }

    current(): MarkdownFile[] | null {
        if (this.currentPage === 0 || this.currentPage > this.pages.length) {
            return null;
        }
        return this.pages[this.currentPage - 1];
    }

    reset(): void {
        this.currentPage = 0;
    }

    /**
     * Get current page number
     */
    getCurrentPage(): number {
        return this.currentPage;
    }

    /**
     * Get total pages
     */
    getTotalPages(): number {
        return this.pages.length;
    }

    /**
     * Get page size
     */
    getPageSize(): number {
        return this.pageSize;
    }

    /**
     * Go to specific page
     */
    goToPage(pageNumber: number): void {
        if (pageNumber < 0 || pageNumber >= this.pages.length) {
            throw new Error(`Invalid page number: ${pageNumber}`);
        }
        this.currentPage = pageNumber;
    }
}

/**
 * File Collection - Iterable file collection
 */
export class FileCollection implements IIterable<MarkdownFile> {
    constructor(private files: MarkdownFile[] = []) {}

    /**
     * Add file to collection
     */
    addFile(file: MarkdownFile): void {
        this.files.push(file);
    }

    /**
     * Remove file from collection
     */
    removeFile(file: MarkdownFile): boolean {
        const index = this.files.indexOf(file);
        if (index >= 0) {
            this.files.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Get file count
     */
    getCount(): number {
        return this.files.length;
    }

    /**
     * Create basic iterator
     */
    createIterator(): IIterator<MarkdownFile> {
        return new FileIterator(this.files);
    }

    /**
     * Create filtered iterator
     */
    createFilteredIterator(filter: (file: MarkdownFile) => boolean): IIterator<MarkdownFile> {
        return new FilteredFileIterator(this.files, filter);
    }

    /**
     * Create sorted iterator
     */
    createSortedIterator(comparator: (a: MarkdownFile, b: MarkdownFile) => number): IIterator<MarkdownFile> {
        return new SortedFileIterator(this.files, comparator);
    }

    /**
     * Create paged iterator
     */
    createPagedIterator(pageSize: number): IIterator<MarkdownFile[]> {
        return new PagedFileIterator(this.files, pageSize);
    }

    /**
     * Get files as array
     */
    getFiles(): MarkdownFile[] {
        return [...this.files];
    }

    /**
     * Clear collection
     */
    clear(): void {
        this.files = [];
    }
}

/**
 * File Collection Manager - Factory for different iterator types
 */
export class FileCollectionManager {
    private collections: Map<string, FileCollection> = new Map();

    /**
     * Create or get a collection
     */
    getCollection(name: string): FileCollection {
        if (!this.collections.has(name)) {
            this.collections.set(name, new FileCollection());
        }
        return this.collections.get(name)!;
    }

    /**
     * Remove a collection
     */
    removeCollection(name: string): boolean {
        return this.collections.delete(name);
    }

    /**
     * Get all collection names
     */
    getCollectionNames(): string[] {
        return Array.from(this.collections.keys());
    }

    /**
     * Create iterator for specific use cases
     */
    createUnsavedFilesIterator(collectionName: string): IIterator<MarkdownFile> {
        const collection = this.getCollection(collectionName);
        return collection.createFilteredIterator(file => file.hasUnsavedChanges());
    }

    createModifiedFilesIterator(collectionName: string): IIterator<MarkdownFile> {
        const collection = this.getCollection(collectionName);
        return collection.createFilteredIterator(file => file.hasExternalChanges());
    }

    createByTypeIterator(collectionName: string, fileType: string): IIterator<MarkdownFile> {
        const collection = this.getCollection(collectionName);
        return collection.createFilteredIterator(file => file.getFileType() === fileType);
    }

    createBySizeIterator(collectionName: string, ascending: boolean = true): IIterator<MarkdownFile> {
        const collection = this.getCollection(collectionName);
        const comparator = (a: MarkdownFile, b: MarkdownFile) => {
            // This would need access to file size - simplified for demo
            const aSize = a.getContent().length;
            const bSize = b.getContent().length;
            return ascending ? aSize - bSize : bSize - aSize;
        };
        return collection.createSortedIterator(comparator);
    }

    createByNameIterator(collectionName: string, ascending: boolean = true): IIterator<MarkdownFile> {
        const collection = this.getCollection(collectionName);
        const comparator = (a: MarkdownFile, b: MarkdownFile) => {
            const aName = a.getFileName().toLowerCase();
            const bName = b.getFileName().toLowerCase();
            return ascending ? aName.localeCompare(bName) : bName.localeCompare(aName);
        };
        return collection.createSortedIterator(comparator);
    }

    /**
     * Batch operations using iterators
     */
    async saveAllUnsavedFiles(collectionName: string): Promise<number> {
        const iterator = this.createUnsavedFilesIterator(collectionName);
        let savedCount = 0;

        while (iterator.hasNext()) {
            const file = iterator.next();
            await file.save();
            savedCount++;
        }

        return savedCount;
    }

    async reloadAllModifiedFiles(collectionName: string): Promise<number> {
        const iterator = this.createModifiedFilesIterator(collectionName);
        let reloadedCount = 0;

        while (iterator.hasNext()) {
            const file = iterator.next();
            await file.reload();
            reloadedCount++;
        }

        return reloadedCount;
    }

    /**
     * Get collection statistics
     */
    getCollectionStats(collectionName: string): {
        totalFiles: number;
        unsavedFiles: number;
        modifiedFiles: number;
        fileTypes: Record<string, number>;
    } {
        const collection = this.getCollection(collectionName);
        const files = collection.getFiles();

        const stats = {
            totalFiles: files.length,
            unsavedFiles: 0,
            modifiedFiles: 0,
            fileTypes: {} as Record<string, number>
        };

        for (const file of files) {
            if (file.hasUnsavedChanges()) stats.unsavedFiles++;
            if (file.hasExternalChanges()) stats.modifiedFiles++;

            const type = file.getFileType();
            stats.fileTypes[type] = (stats.fileTypes[type] || 0) + 1;
        }

        return stats;
    }
}

/**
 * Iterator Chain - Chain multiple iterators together
 */
export class IteratorChain<T> implements IIterator<T> {
    private iterators: IIterator<T>[] = [];
    private currentIteratorIndex: number = 0;

    constructor(iterators: IIterator<T>[]) {
        this.iterators = iterators;
    }

    hasNext(): boolean {
        // Check current iterator
        if (this.currentIteratorIndex < this.iterators.length &&
            this.iterators[this.currentIteratorIndex].hasNext()) {
            return true;
        }

        // Check remaining iterators
        for (let i = this.currentIteratorIndex + 1; i < this.iterators.length; i++) {
            if (this.iterators[i].hasNext()) {
                return true;
            }
        }

        return false;
    }

    next(): T {
        // Move to next iterator if current is exhausted
        while (this.currentIteratorIndex < this.iterators.length &&
               !this.iterators[this.currentIteratorIndex].hasNext()) {
            this.currentIteratorIndex++;
        }

        if (this.currentIteratorIndex >= this.iterators.length) {
            throw new Error('No more items in iterator chain');
        }

        return this.iterators[this.currentIteratorIndex].next();
    }

    current(): T | null {
        if (this.currentIteratorIndex < this.iterators.length) {
            return this.iterators[this.currentIteratorIndex].current();
        }
        return null;
    }

    reset(): void {
        this.currentIteratorIndex = 0;
        for (const iterator of this.iterators) {
            iterator.reset();
        }
    }
}
