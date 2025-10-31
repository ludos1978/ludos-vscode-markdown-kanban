import { MarkdownFile } from '../../files/MarkdownFile';

/**
 * Composite Pattern - Hierarchical File System Structure
 *
 * Represents file system hierarchies as tree structures where
 * both individual files and directories can be treated uniformly.
 */

export interface IFileSystemComponent {
    getName(): string;
    getPath(): string;
    getSize(): number;
    isDirectory(): boolean;
    getLastModified(): Date | null;

    /**
     * Accept visitor for operations
     */
    accept(visitor: IFileSystemVisitor): void;
}

/**
 * Leaf - Individual File
 */
export class FileLeaf implements IFileSystemComponent {
    constructor(private file: MarkdownFile) {}

    getName(): string {
        return this.file.getFileName();
    }

    getPath(): string {
        return this.file.getPath();
    }

    getSize(): number {
        return this.file.getContent().length;
    }

    isDirectory(): boolean {
        return false;
    }

    getLastModified(): Date | null {
        // This would need access to file system stats
        return new Date(); // Placeholder
    }

    getFile(): MarkdownFile {
        return this.file;
    }

    accept(visitor: IFileSystemVisitor): void {
        visitor.visitFile(this);
    }
}

/**
 * Composite - Directory containing files and subdirectories
 */
export class DirectoryComposite implements IFileSystemComponent {
    private children: IFileSystemComponent[] = [];

    constructor(
        private name: string,
        private path: string,
        private parent?: DirectoryComposite
    ) {}

    getName(): string {
        return this.name;
    }

    getPath(): string {
        return this.path;
    }

    getSize(): number {
        // Sum of all children sizes
        return this.children.reduce((total, child) => total + child.getSize(), 0);
    }

    isDirectory(): boolean {
        return true;
    }

    getLastModified(): Date | null {
        // Last modified of most recent child
        let latest: Date | null = null;
        for (const child of this.children) {
            const childModified = child.getLastModified();
            if (childModified && (!latest || childModified > latest)) {
                latest = childModified;
            }
        }
        return latest;
    }

    /**
     * Add child component
     */
    add(component: IFileSystemComponent): void {
        this.children.push(component);
        if (component instanceof DirectoryComposite) {
            component.setParent(this);
        }
    }

    /**
     * Remove child component
     */
    remove(component: IFileSystemComponent): boolean {
        const index = this.children.indexOf(component);
        if (index >= 0) {
            this.children.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Get child components
     */
    getChildren(): IFileSystemComponent[] {
        return [...this.children];
    }

    /**
     * Get child by name
     */
    getChild(name: string): IFileSystemComponent | null {
        return this.children.find(child => child.getName() === name) || null;
    }

    /**
     * Set parent directory
     */
    setParent(parent: DirectoryComposite): void {
        this.parent = parent;
    }

    /**
     * Get parent directory
     */
    getParent(): DirectoryComposite | undefined {
        return this.parent;
    }

    /**
     * Get full path from root
     */
    getFullPath(): string {
        if (!this.parent) {
            return this.path;
        }
        return `${this.parent.getFullPath()}/${this.path}`;
    }

    accept(visitor: IFileSystemVisitor): void {
        visitor.visitDirectory(this);
    }
}

/**
 * Visitor for file system operations
 */
export interface IFileSystemVisitor {
    visitFile(file: FileLeaf): void;
    visitDirectory(directory: DirectoryComposite): void;
}

/**
 * File System Operations Visitors
 */

export class SizeCalculatorVisitor implements IFileSystemVisitor {
    private totalSize: number = 0;
    private fileCount: number = 0;
    private directoryCount: number = 0;

    visitFile(file: FileLeaf): void {
        this.totalSize += file.getSize();
        this.fileCount++;
        console.log(`[SizeCalculator] File: ${file.getName()} (${file.getSize()} bytes)`);
    }

    visitDirectory(directory: DirectoryComposite): void {
        this.directoryCount++;
        console.log(`[SizeCalculator] Directory: ${directory.getName()} (${directory.getChildren().length} items)`);

        // Visit all children
        for (const child of directory.getChildren()) {
            child.accept(this);
        }
    }

    getTotalSize(): number {
        return this.totalSize;
    }

    getFileCount(): number {
        return this.fileCount;
    }

    getDirectoryCount(): number {
        return this.directoryCount;
    }

    getStats(): {
        totalSize: number;
        fileCount: number;
        directoryCount: number;
        averageFileSize: number;
    } {
        return {
            totalSize: this.totalSize,
            fileCount: this.fileCount,
            directoryCount: this.directoryCount,
            averageFileSize: this.fileCount > 0 ? this.totalSize / this.fileCount : 0
        };
    }
}

export class FileSearchVisitor implements IFileSystemVisitor {
    private results: FileLeaf[] = [];

    constructor(
        private searchCriteria: {
            namePattern?: RegExp;
            type?: string;
            minSize?: number;
            maxSize?: number;
            modifiedAfter?: Date;
            modifiedBefore?: Date;
        }
    ) {}

    visitFile(file: FileLeaf): void {
        if (this.matchesCriteria(file)) {
            this.results.push(file);
        }
    }

    visitDirectory(directory: DirectoryComposite): void {
        // Visit all children
        for (const child of directory.getChildren()) {
            child.accept(this);
        }
    }

    private matchesCriteria(file: FileLeaf): boolean {
        const criteria = this.searchCriteria;

        // Name pattern
        if (criteria.namePattern && !criteria.namePattern.test(file.getName())) {
            return false;
        }

        // File type (would need access to file type)
        // if (criteria.type && file.getFile().getFileType() !== criteria.type) {
        //     return false;
        // }

        // Size range
        const size = file.getSize();
        if (criteria.minSize !== undefined && size < criteria.minSize) {
            return false;
        }
        if (criteria.maxSize !== undefined && size > criteria.maxSize) {
            return false;
        }

        // Modification date range
        const modified = file.getLastModified();
        if (criteria.modifiedAfter && modified && modified <= criteria.modifiedAfter) {
            return false;
        }
        if (criteria.modifiedBefore && modified && modified >= criteria.modifiedBefore) {
            return false;
        }

        return true;
    }

    getResults(): FileLeaf[] {
        return [...this.results];
    }

    getResultCount(): number {
        return this.results.length;
    }
}

export class BackupVisitor implements IFileSystemVisitor {
    private backedUpFiles: FileLeaf[] = [];
    private backedUpDirectories: DirectoryComposite[] = [];

    constructor(private backupRoot: string) {}

    visitFile(file: FileLeaf): void {
        // Create backup of file
        console.log(`[BackupVisitor] Backing up file: ${file.getName()}`);
        // Implementation would copy file to backup location
        this.backedUpFiles.push(file);
    }

    visitDirectory(directory: DirectoryComposite): void {
        console.log(`[BackupVisitor] Backing up directory: ${directory.getName()}`);
        this.backedUpDirectories.push(directory);

        // Visit all children
        for (const child of directory.getChildren()) {
            child.accept(this);
        }
    }

    getBackedUpFiles(): FileLeaf[] {
        return [...this.backedUpFiles];
    }

    getBackedUpDirectories(): DirectoryComposite[] {
        return [...this.backedUpDirectories];
    }

    getStats(): {
        filesBackedUp: number;
        directoriesBackedUp: number;
        totalItems: number;
    } {
        return {
            filesBackedUp: this.backedUpFiles.length,
            directoriesBackedUp: this.backedUpDirectories.length,
            totalItems: this.backedUpFiles.length + this.backedUpDirectories.length
        };
    }
}

export class PermissionCheckerVisitor implements IFileSystemVisitor {
    private issues: Array<{
        component: IFileSystemComponent;
        issue: string;
        severity: 'warning' | 'error';
    }> = [];

    visitFile(file: FileLeaf): void {
        // Check file permissions
        const issues = this.checkFilePermissions(file);
        this.issues.push(...issues);
    }

    visitDirectory(directory: DirectoryComposite): void {
        // Check directory permissions
        const issues = this.checkDirectoryPermissions(directory);
        this.issues.push(...issues);

        // Visit all children
        for (const child of directory.getChildren()) {
            child.accept(this);
        }
    }

    private checkFilePermissions(file: FileLeaf): Array<{
        component: IFileSystemComponent;
        issue: string;
        severity: 'warning' | 'error';
    }> {
        const issues: Array<{
            component: IFileSystemComponent;
            issue: string;
            severity: 'warning' | 'error';
        }> = [];

        // Check if file is readable
        // This would check actual file permissions
        const isReadable = true; // Placeholder
        if (!isReadable) {
            issues.push({
                component: file,
                issue: 'File is not readable',
                severity: 'error' as const
            });
        }

        // Check if file is writable
        const isWritable = true; // Placeholder
        if (!isWritable) {
            issues.push({
                component: file,
                issue: 'File is not writable',
                severity: 'warning' as const
            });
        }

        return issues;
    }

    private checkDirectoryPermissions(directory: DirectoryComposite): Array<{
        component: IFileSystemComponent;
        issue: string;
        severity: 'warning' | 'error';
    }> {
        const issues: Array<{
            component: IFileSystemComponent;
            issue: string;
            severity: 'warning' | 'error';
        }> = [];

        // Check if directory is accessible
        const isAccessible = true; // Placeholder
        if (!isAccessible) {
            issues.push({
                component: directory,
                issue: 'Directory is not accessible',
                severity: 'error' as const
            });
        }

        return issues;
    }

    getIssues(): Array<{
        component: IFileSystemComponent;
        issue: string;
        severity: 'warning' | 'error';
    }> {
        return [...this.issues];
    }

    getIssueCount(): number {
        return this.issues.length;
    }

    getErrors(): Array<{
        component: IFileSystemComponent;
        issue: string;
    }> {
        return this.issues
            .filter(issue => issue.severity === 'error')
            .map(issue => ({
                component: issue.component,
                issue: issue.issue
            }));
    }

    getWarnings(): Array<{
        component: IFileSystemComponent;
        issue: string;
    }> {
        return this.issues
            .filter(issue => issue.severity === 'warning')
            .map(issue => ({
                component: issue.component,
                issue: issue.issue
            }));
    }
}

/**
 * File System Builder - Builder Pattern for creating file system structures
 */
export class FileSystemBuilder {
    private root: DirectoryComposite | null = null;
    private currentDirectory: DirectoryComposite | null = null;

    /**
     * Create root directory
     */
    createRoot(name: string, path: string): FileSystemBuilder {
        this.root = new DirectoryComposite(name, path);
        this.currentDirectory = this.root;
        return this;
    }

    /**
     * Add subdirectory
     */
    addDirectory(name: string): FileSystemBuilder {
        if (!this.currentDirectory) {
            throw new Error('No current directory set');
        }

        const newDir = new DirectoryComposite(name, name, this.currentDirectory);
        this.currentDirectory.add(newDir);
        this.currentDirectory = newDir;
        return this;
    }

    /**
     * Add file
     */
    addFile(file: MarkdownFile): FileSystemBuilder {
        if (!this.currentDirectory) {
            throw new Error('No current directory set');
        }

        const fileLeaf = new FileLeaf(file);
        this.currentDirectory.add(fileLeaf);
        return this;
    }

    /**
     * Go up one directory level
     */
    goUp(): FileSystemBuilder {
        if (this.currentDirectory && this.currentDirectory.getParent()) {
            this.currentDirectory = this.currentDirectory.getParent()!;
        }
        return this;
    }

    /**
     * Go to root directory
     */
    goToRoot(): FileSystemBuilder {
        this.currentDirectory = this.root;
        return this;
    }

    /**
     * Build the file system structure
     */
    build(): DirectoryComposite {
        if (!this.root) {
            throw new Error('Root directory not created');
        }
        return this.root;
    }
}

/**
 * File System Manager - Facade for file system operations
 */
export class FileSystemManager {
    constructor(private root: DirectoryComposite) {}

    /**
     * Calculate total size
     */
    calculateTotalSize(): {
        totalSize: number;
        fileCount: number;
        directoryCount: number;
        averageFileSize: number;
    } {
        const visitor = new SizeCalculatorVisitor();
        this.root.accept(visitor);
        return visitor.getStats();
    }

    /**
     * Search for files
     */
    searchFiles(criteria: {
        namePattern?: RegExp;
        minSize?: number;
        maxSize?: number;
        modifiedAfter?: Date;
        modifiedBefore?: Date;
    }): FileLeaf[] {
        const visitor = new FileSearchVisitor(criteria);
        this.root.accept(visitor);
        return visitor.getResults();
    }

    /**
     * Create backup of entire structure
     */
    async createBackup(backupRoot: string): Promise<{
        filesBackedUp: number;
        directoriesBackedUp: number;
        totalItems: number;
    }> {
        const visitor = new BackupVisitor(backupRoot);
        this.root.accept(visitor);
        return visitor.getStats();
    }

    /**
     * Check permissions throughout structure
     */
    checkPermissions(): {
        issues: Array<{
            component: IFileSystemComponent;
            issue: string;
            severity: 'warning' | 'error';
        }>;
        errorCount: number;
        warningCount: number;
    } {
        const visitor = new PermissionCheckerVisitor();
        this.root.accept(visitor);

        return {
            issues: visitor.getIssues(),
            errorCount: visitor.getErrors().length,
            warningCount: visitor.getWarnings().length
        };
    }

    /**
     * Get root directory
     */
    getRoot(): DirectoryComposite {
        return this.root;
    }

    /**
     * Find component by path
     */
    findByPath(path: string): IFileSystemComponent | null {
        const parts = path.split('/').filter(part => part.length > 0);
        let current: IFileSystemComponent = this.root;

        for (const part of parts) {
            if (current instanceof DirectoryComposite) {
                const child = current.getChild(part);
                if (!child) {
                    return null;
                }
                current = child;
            } else {
                return null; // Can't traverse into a file
            }
        }

        return current;
    }

    /**
     * Get all files recursively
     */
    getAllFiles(): FileLeaf[] {
        const files: FileLeaf[] = [];

        const collectFiles = (component: IFileSystemComponent) => {
            if (component instanceof FileLeaf) {
                files.push(component);
            } else if (component instanceof DirectoryComposite) {
                for (const child of component.getChildren()) {
                    collectFiles(child);
                }
            }
        };

        collectFiles(this.root);
        return files;
    }

    /**
     * Get directory structure as tree
     */
    getTreeString(indent: string = ''): string {
        let result = `${indent}${this.root.getName()}/\n`;

        const buildTree = (component: IFileSystemComponent, currentIndent: string) => {
            if (component instanceof DirectoryComposite) {
                for (const child of component.getChildren()) {
                    if (child instanceof FileLeaf) {
                        result += `${currentIndent}  ${child.getName()}\n`;
                    } else if (child instanceof DirectoryComposite) {
                        result += `${currentIndent}  ${child.getName()}/\n`;
                        buildTree(child, currentIndent + '  ');
                    }
                }
            }
        };

        buildTree(this.root, indent);
        return result;
    }
}
