import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FileState } from '../fileStateManager';
import { ConflictResolver, ConflictContext, ConflictResolution } from '../conflictResolver';
import { BackupManager } from '../backupManager';

/**
 * File change event emitted when file state changes
 */
export interface FileChangeEvent {
    file: MarkdownFile;
    changeType: 'content' | 'external' | 'saved' | 'reloaded' | 'conflict';
    timestamp: Date;
}

/**
 * Abstract base class for all markdown files in the Kanban system.
 * Encapsulates file state, operations, and change detection.
 *
 * Key Responsibilities:
 * - Track file content (current, baseline, unsaved changes)
 * - Detect external file changes via file watchers
 * - Handle conflicts between local and external changes
 * - Provide read/write operations
 * - Emit events for state changes
 */
export abstract class MarkdownFile implements vscode.Disposable {
    // ============= FILE IDENTITY =============
    protected _path: string;                  // Absolute file path
    protected _relativePath: string;          // Relative path (for includes, same as _path for main)

    // ============= CONTENT STATE =============
    protected _content: string = '';          // Current content in memory
    protected _baseline: string = '';         // Last known saved content (snapshot)

    // ============= BACKEND STATE (File System & VS Code Editor) =============
    protected _exists: boolean = true;
    protected _lastModified: Date | null = null;
    protected _isDirtyInEditor: boolean = false;       // VS Code editor has unsaved changes
    protected _documentVersion: number = 0;
    protected _hasFileSystemChanges: boolean = false;  // File changed on disk outside VS Code

    // ============= FRONTEND STATE (Kanban UI) =============
    protected _hasUnsavedChanges: boolean = false;     // Kanban UI has modifications
    protected _isInEditMode: boolean = false;          // User actively editing in task/column editor

    // ============= CHANGE DETECTION =============
    protected _fileWatcher?: vscode.FileSystemWatcher;
    protected _watcherDisposable?: vscode.Disposable;
    protected _isWatching: boolean = false;

    // ============= EVENT EMITTER =============
    protected _onDidChange = new vscode.EventEmitter<FileChangeEvent>();
    public readonly onDidChange = this._onDidChange.event;

    // ============= DEPENDENCIES =============
    protected _conflictResolver: ConflictResolver;
    protected _backupManager: BackupManager;
    protected _disposables: vscode.Disposable[] = [];

    constructor(
        path: string,
        relativePath: string,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager
    ) {
        this._path = path;
        this._relativePath = relativePath;
        this._conflictResolver = conflictResolver;
        this._backupManager = backupManager;

        this._disposables.push(this._onDidChange);
    }

    // ============= ABSTRACT METHODS (must be implemented by subclasses) =============

    /**
     * Get the file type identifier
     */
    abstract getFileType(): 'main' | 'include-regular' | 'include-column' | 'include-task';

    /**
     * Read content from disk
     */
    abstract readFromDisk(): Promise<string | null>;

    /**
     * Write content to disk
     */
    abstract writeToDisk(content: string): Promise<void>;

    /**
     * Handle external file change (subclass-specific logic)
     */
    abstract handleExternalChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void>;

    /**
     * Validate file content (format-specific validation)
     */
    abstract validate(content: string): { valid: boolean; errors?: string[] };

    /**
     * Get conflict context for this file type
     */
    protected abstract getConflictContext(): ConflictContext;

    // ============= IDENTITY & INFO =============

    public getPath(): string {
        return this._path;
    }

    public getRelativePath(): string {
        return this._relativePath;
    }

    public getFileName(): string {
        return path.basename(this._path);
    }

    public exists(): boolean {
        return this._exists;
    }

    public getLastModified(): Date | null {
        return this._lastModified;
    }

    // ============= CONTENT ACCESS =============

    public getContent(): string {
        return this._content;
    }

    public getBaseline(): string {
        return this._baseline;
    }

    /**
     * Set content (marks as unsaved unless baseline is updated)
     */
    public setContent(content: string, updateBaseline: boolean = false): void {
        const oldContent = this._content;
        this._content = content;

        if (updateBaseline) {
            this._baseline = content;
            this._hasUnsavedChanges = false;
        } else {
            this._hasUnsavedChanges = (this._content !== this._baseline);
        }

        // Emit change event if content actually changed
        if (oldContent !== content) {
            this._emitChange('content');
        }
    }

    // ============= STATE QUERIES =============

    public hasUnsavedChanges(): boolean {
        return this._hasUnsavedChanges;
    }

    public hasExternalChanges(): boolean {
        return this._hasFileSystemChanges;
    }

    public isInEditMode(): boolean {
        return this._isInEditMode;
    }

    public setEditMode(inEditMode: boolean): void {
        this._isInEditMode = inEditMode;
    }

    public isDirtyInEditor(): boolean {
        return this._isDirtyInEditor;
    }

    /**
     * Check if file has a conflict (both local and external changes)
     */
    public hasConflict(): boolean {
        return (this._hasUnsavedChanges || this._isInEditMode) && this._hasFileSystemChanges;
    }

    /**
     * Check if file needs to be reloaded from disk
     * (has external changes, not editing, no unsaved changes)
     */
    public needsReload(): boolean {
        return this._hasFileSystemChanges && !this._isInEditMode && !this._hasUnsavedChanges;
    }

    /**
     * Check if file needs to be saved to disk
     * (has unsaved changes, no external changes)
     */
    public needsSave(): boolean {
        return this._hasUnsavedChanges && !this._hasFileSystemChanges;
    }

    // ============= FILE OPERATIONS =============

    /**
     * Reload content from disk and update baseline
     */
    public async reload(): Promise<void> {
        console.log(`[${this.getFileType()}] Reloading from disk: ${this._relativePath}`);

        const content = await this.readFromDisk();
        if (content !== null) {
            this._content = content;
            this._baseline = content;
            this._hasUnsavedChanges = false;
            this._hasFileSystemChanges = false;
            this._lastModified = await this._getFileModifiedTime();

            this._emitChange('reloaded');
            console.log(`[${this.getFileType()}] Reloaded successfully: ${this._relativePath}`);
        } else {
            console.error(`[${this.getFileType()}] Failed to reload: ${this._relativePath}`);
        }
    }

    /**
     * Save current content to disk and update baseline
     */
    public async save(): Promise<void> {
        console.log(`[${this.getFileType()}] Saving to disk: ${this._relativePath}`);

        // Validate before saving
        const validation = this.validate(this._content);
        if (!validation.valid) {
            const errors = validation.errors?.join(', ') || 'Unknown validation error';
            throw new Error(`Cannot save ${this._relativePath}: ${errors}`);
        }

        await this.writeToDisk(this._content);
        this._baseline = this._content;
        this._hasUnsavedChanges = false;
        this._hasFileSystemChanges = false;
        this._lastModified = new Date();

        this._emitChange('saved');
        console.log(`[${this.getFileType()}] Saved successfully: ${this._relativePath}`);
    }

    /**
     * Discard unsaved changes and revert to baseline
     */
    public discardChanges(): void {
        console.log(`[${this.getFileType()}] Discarding unsaved changes: ${this._relativePath}`);
        this._content = this._baseline;
        this._hasUnsavedChanges = false;
        this._emitChange('content');
    }

    // ============= CONFLICT RESOLUTION =============

    /**
     * Resolve conflict with specified action
     */
    public async resolveConflict(action: 'save' | 'discard' | 'backup'): Promise<void> {
        console.log(`[${this.getFileType()}] Resolving conflict with action '${action}': ${this._relativePath}`);

        switch (action) {
            case 'save':
                // Save current changes (overwrite external changes)
                await this.save();
                break;

            case 'discard':
                // Discard local changes and reload from disk
                await this.reload();
                break;

            case 'backup':
                // Create backup of current content, then reload
                await this.createBackup('conflict');
                await this.reload();
                break;
        }

        this._emitChange('conflict');
    }

    /**
     * Show conflict dialog and resolve based on user choice
     */
    public async showConflictDialog(): Promise<ConflictResolution | null> {
        const context = this.getConflictContext();
        const resolution = await this._conflictResolver.resolveConflict(context);

        if (resolution && resolution.shouldProceed) {
            if (resolution.shouldSave) {
                await this.save();
            } else if (resolution.shouldReload) {
                await this.reload();
            } else if (resolution.shouldCreateBackup) {
                await this.resolveConflict('backup');
            }
        }

        return resolution;
    }

    // ============= BACKUP =============

    /**
     * Create backup of current content
     * (Subclasses can override with specific implementation)
     */
    public async createBackup(label: string = 'manual'): Promise<void> {
        console.log(`[${this.getFileType()}] Creating backup with label '${label}': ${this._relativePath}`);
        // TODO: Implement backup logic
        // For now, this is a placeholder that subclasses can override
        // to integrate with BackupManager which requires a TextDocument
    }

    // ============= FILE WATCHING & CHANGE DETECTION =============

    /**
     * Start watching file for external changes
     */
    public startWatching(): void {
        if (this._isWatching) {
            console.log(`[${this.getFileType()}] Already watching: ${this._relativePath}`);
            return;
        }

        console.log(`[${this.getFileType()}] Starting to watch: ${this._relativePath}`);

        const pattern = new vscode.RelativePattern(
            path.dirname(this._path),
            path.basename(this._path)
        );

        this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        // Watch for modifications
        this._fileWatcher.onDidChange(async (uri) => {
            console.log(`[${this.getFileType()}] File changed on disk: ${uri.fsPath}`);
            await this._onFileSystemChange('modified');
        });

        // Watch for deletion
        this._fileWatcher.onDidDelete(async (uri) => {
            console.log(`[${this.getFileType()}] File deleted: ${uri.fsPath}`);
            await this._onFileSystemChange('deleted');
        });

        // Watch for creation
        this._fileWatcher.onDidCreate(async (uri) => {
            console.log(`[${this.getFileType()}] File created: ${uri.fsPath}`);
            await this._onFileSystemChange('created');
        });

        this._disposables.push(this._fileWatcher);
        this._isWatching = true;
    }

    /**
     * Stop watching file
     */
    public stopWatching(): void {
        if (!this._isWatching) {
            return;
        }

        console.log(`[${this.getFileType()}] Stopping watch: ${this._relativePath}`);

        if (this._fileWatcher) {
            this._fileWatcher.dispose();
            this._fileWatcher = undefined;
        }

        this._isWatching = false;
    }

    /**
     * Handle file system change detected by watcher
     */
    protected async _onFileSystemChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        console.log(`[${this.getFileType()}] File system change detected: ${changeType} - ${this._relativePath}`);

        // Mark as having external changes
        this._hasFileSystemChanges = true;
        this._emitChange('external');

        // Delegate to subclass for specific handling
        await this.handleExternalChange(changeType);
    }

    /**
     * Get file modified time from disk
     */
    protected async _getFileModifiedTime(): Promise<Date | null> {
        try {
            const stat = await fs.promises.stat(this._path);
            return stat.mtime;
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to get modified time:`, error);
            return null;
        }
    }

    /**
     * Check if file content has changed on disk
     */
    public async checkForExternalChanges(): Promise<boolean> {
        const diskContent = await this.readFromDisk();
        if (diskContent === null) {
            return false;
        }

        const hasChanged = diskContent !== this._baseline;
        if (hasChanged) {
            this._hasFileSystemChanges = true;
            this._emitChange('external');
        }

        return hasChanged;
    }

    // ============= EVENT EMISSION =============

    /**
     * Emit change event
     */
    protected _emitChange(changeType: FileChangeEvent['changeType']): void {
        this._onDidChange.fire({
            file: this,
            changeType,
            timestamp: new Date()
        });
    }

    // ============= COMPATIBILITY WITH EXISTING CODE =============

    /**
     * Convert to FileState interface for compatibility with existing code
     */
    public toFileState(): FileState {
        return {
            path: this._path,
            relativePath: this._relativePath,
            isMainFile: this.getFileType() === 'main',
            fileType: this.getFileType(),
            backend: {
                exists: this._exists,
                lastModified: this._lastModified,
                isDirtyInEditor: this._isDirtyInEditor,
                documentVersion: this._documentVersion,
                hasFileSystemChanges: this._hasFileSystemChanges
            },
            frontend: {
                hasUnsavedChanges: this._hasUnsavedChanges,
                content: this._content,
                baseline: this._baseline,
                isInEditMode: this._isInEditMode
            },
            needsReload: this.needsReload(),
            needsSave: this.needsSave(),
            hasConflict: this.hasConflict()
        };
    }

    /**
     * Update from FileState interface (for compatibility)
     */
    public fromFileState(state: FileState): void {
        this._path = state.path;
        this._relativePath = state.relativePath;
        this._exists = state.backend.exists;
        this._lastModified = state.backend.lastModified;
        this._isDirtyInEditor = state.backend.isDirtyInEditor;
        this._documentVersion = state.backend.documentVersion;
        this._hasFileSystemChanges = state.backend.hasFileSystemChanges;
        this._hasUnsavedChanges = state.frontend.hasUnsavedChanges;
        this._content = state.frontend.content;
        this._baseline = state.frontend.baseline;
        this._isInEditMode = state.frontend.isInEditMode;
    }

    // ============= CLEANUP =============

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        console.log(`[${this.getFileType()}] Disposing: ${this._relativePath}`);
        this.stopWatching();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
