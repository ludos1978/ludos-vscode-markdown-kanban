import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConflictResolver, ConflictContext, ConflictResolution } from '../services/ConflictResolver';
import { BackupManager } from '../services/BackupManager';
import { SaveOptions } from './SaveOptions';
import { SaveTransactionManager } from './SaveTransactionManager';
import { WatcherCoordinator } from './WatcherCoordinator';

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
    protected _relativePath: string;          // Relative path (for includes, same as _path for main) - ORIGINAL CASING
    protected _normalizedRelativePath: string; // Normalized relative path (lowercase, forward slashes) - FOR LOOKUPS

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
    // NOTE: _hasUnsavedChanges removed - now computed from (_content !== _baseline)
    protected _isInEditMode: boolean = false;          // User actively editing in task/column editor

    // ============= SAVE STATE (Instance-level, no global registry!) =============
    private _skipNextReloadDetection: boolean = false; // Skip reload for our own save

    // ============= CHANGE DETECTION =============
    protected _fileWatcher?: vscode.FileSystemWatcher;
    protected _watcherDisposable?: vscode.Disposable;
    protected _watcherSubscriptions: vscode.Disposable[] = []; // Store event listener disposables
    protected _isWatching: boolean = false;

    // PERFORMANCE: Shared watcher registry to prevent duplicates
    private static _activeWatchers = new Map<string, { watcher: vscode.FileSystemWatcher; refCount: number; lastActivity: Date }>();

    // PERFORMANCE: Transaction-based save operations (extracted to SaveTransactionManager.ts)
    protected static get _saveTransactionManager(): SaveTransactionManager {
        return SaveTransactionManager.getInstance();
    }

    // PERFORMANCE: Centralized watcher coordination (extracted to WatcherCoordinator.ts)
    protected static get _watcherCoordinator(): WatcherCoordinator {
        return WatcherCoordinator.getInstance();
    }

    // ============= EVENT EMITTER =============
    protected _onDidChange = new vscode.EventEmitter<FileChangeEvent>();
    public readonly onDidChange = this._onDidChange.event;

    // ============= CANCELLATION (FOUNDATION-2) =============
    private _currentReloadSequence: number = 0;     // Sequence counter for reload operations

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
        // FOUNDATION-1: Validate relative path before normalization
        this._validateRelativePath(relativePath);

        this._path = path;
        this._relativePath = relativePath;

        // FOUNDATION-1: Normalize and cache the normalized path
        this._normalizedRelativePath = MarkdownFile.normalizeRelativePath(relativePath);

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

    // ============= PATH NORMALIZATION (FOUNDATION-1) =============

    /**
     * Centralized normalization function for relative paths
     *
     * Rules:
     * 1. Trim whitespace
     * 2. Convert to lowercase (case-insensitive comparison)
     * 3. Convert backslashes to forward slashes (Windows compatibility)
     *
     * IMPORTANT:
     * - Does NOT resolve relative paths (./file stays ./file)
     * - Does NOT handle absolute paths (not intended for absolute paths)
     * - Use this for all path normalization throughout the codebase
     *
     * @param relativePath The relative path to normalize
     * @returns Normalized path (lowercase, forward slashes, trimmed)
     *
     * @example
     * normalizeRelativePath("Folder/File.md")     // "folder/file.md"
     * normalizeRelativePath("Folder\\File.md")    // "folder/file.md"
     * normalizeRelativePath("  folder/file.md  ") // "folder/file.md"
     */
    public static normalizeRelativePath(relativePath: string): string {
        if (!relativePath) {
            return '';
        }

        return relativePath
            .trim()
            .toLowerCase()
            .replace(/\\/g, '/');
    }

    /**
     * Compare two paths for equality (normalized comparison)
     *
     * Use this instead of === when comparing paths to ensure case-insensitive
     * and platform-independent comparison.
     *
     * @param path1 First path to compare
     * @param path2 Second path to compare
     * @returns true if paths are equivalent (after normalization)
     *
     * @example
     * isSameFile("Folder/File.md", "folder/file.md")   // true
     * isSameFile("Folder\\File.md", "folder/file.md")  // true
     * isSameFile("Folder/File.md", "Other/File.md")    // false
     */
    public static isSameFile(path1: string, path2: string): boolean {
        return MarkdownFile.normalizeRelativePath(path1) ===
               MarkdownFile.normalizeRelativePath(path2);
    }

    // ============= CANCELLATION HELPERS (FOUNDATION-2) =============

    /**
     * Start a new reload operation, invalidating all previous operations
     * FOUNDATION-2: Pattern 2 (Helper Method)
     *
     * @returns The sequence number for this operation
     */
    private _startNewReload(): number {
        this._currentReloadSequence++;
        const sequence = this._currentReloadSequence;
        return sequence;
    }

    /**
     * Check if this reload operation has been cancelled by a newer operation
     * FOUNDATION-2: Pattern 2 (Helper Method)
     *
     * @param mySequence - The sequence number of this operation
     * @param stage - Description of where the check is happening
     * @returns true if cancelled, false if still current
     */
    private _checkReloadCancelled(mySequence: number, stage: string): boolean {
        if (mySequence !== this._currentReloadSequence) {
            return true;
        }
        return false;
    }

    /**
     * Validate relative path before normalization
     * Detects common issues like pre-normalization, empty paths, etc.
     *
     * @param relativePath The relative path to validate
     * @throws Error if path is invalid
     */
    private _validateRelativePath(relativePath: string): void {
        // Check 1: Empty path
        if (!relativePath || relativePath.trim().length === 0) {
            throw new Error('[MarkdownFile] Relative path cannot be empty');
        }

        // Check 2: Absolute path passed as relative (security/correctness issue)
        // if (path.isAbsolute(relativePath)) {
        //     throw new Error(`[MarkdownFile] Expected relative path, got absolute: "${relativePath}"`);
        // }

        // Check 3: Excessive parent directory traversal (potential security concern)
        const normalized = path.normalize(relativePath);
        const parentDirCount = (normalized.match(/\.\.\//g) || []).length;
        if (parentDirCount > 3) {
            console.warn(`[MarkdownFile] ⚠️  Excessive parent directory traversal (${parentDirCount} levels): "${relativePath}"`);
        }
    }

    // ============= IDENTITY & INFO =============

    public getPath(): string {
        return this._path;
    }

    /**
     * Get the original relative path (preserves casing)
     *
     * Use for:
     * - Display in UI
     * - Logging
     * - User messages
     *
     * DO NOT use for:
     * - Path comparisons (use isSameFile() instead)
     * - Registry lookups (use getNormalizedRelativePath() or let registry handle it)
     *
     * @example
     */
    public getRelativePath(): string {
        return this._relativePath;
    }

    /**
     * Get the normalized relative path (lowercase, forward slashes)
     *
     * Use for:
     * - Registry operations (internal use)
     * - Path comparisons (or use isSameFile() helper)
     * - Map keys
     *
     * DO NOT use for:
     * - Display in UI (use getRelativePath() for original casing)
     * - User messages (use getRelativePath())
     *
     * @example
     * const file = registry.getByRelativePath(file.getNormalizedRelativePath());
     */
    public getNormalizedRelativePath(): string {
        return this._normalizedRelativePath;
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
            // NOTE: No need to set _hasUnsavedChanges - it's now computed from (_content !== _baseline)
            // Do NOT emit 'content' event when updateBaseline=true
            // This is used after saving to update internal state - not an actual change
        } else {
            // NOTE: No need to set _hasUnsavedChanges - it's now computed from (_content !== _baseline)
            // Only emit 'content' event for actual unsaved changes
            if (oldContent !== content) {
                this._emitChange('content');
            }
        }
    }

    // ============= STATE QUERIES =============

    public hasUnsavedChanges(): boolean {
        // Computed property: always compare current content to baseline
        // This ensures it's always accurate and can never drift out of sync
        return this._content !== this._baseline;
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
        return (this.hasUnsavedChanges() || this._isInEditMode) && this._hasFileSystemChanges;
    }

    /**
     * Check if file needs to be reloaded from disk
     * (has external changes, not editing, no unsaved changes)
     */
    public needsReload(): boolean {
        return this._hasFileSystemChanges && !this._isInEditMode && !this.hasUnsavedChanges();
    }

    // ============= FILE OPERATIONS =============

    /**
     * Reload content from disk and update baseline
     * Verifies content has actually changed before accepting
     * FOUNDATION-2: Protected against race conditions via sequence counter
     */
    public async reload(): Promise<void> {

        // PERFORMANCE: Use watcher coordinator to prevent conflicts
        await MarkdownFile._watcherCoordinator.startOperation(this._relativePath, 'reload');

        try {
            // FOUNDATION-2: Start new reload sequence, invalidating previous operations
            const mySequence = this._startNewReload();

            const content = await this._readFromDiskWithVerification();

            // FOUNDATION-2: Check if this reload was cancelled during async operation
            if (this._checkReloadCancelled(mySequence, 'after disk read')) {
                return;
            }

            if (content !== null) {
                // Check if content actually changed (verification returns baseline if unchanged)
                if (content !== this._baseline) {
                    // FOUNDATION-2: Final check before applying changes
                    if (this._checkReloadCancelled(mySequence, 'before applying changes')) {
                        return;
                    }

                    this._content = content;
                    this._baseline = content;
                    // NOTE: No need to set _hasUnsavedChanges - it's now computed from (_content !== _baseline)
                    this._hasFileSystemChanges = false;
                    this._lastModified = await this._getFileModifiedTime();

                    this._emitChange('reloaded');
                } else {
                    // Content unchanged - verification returned baseline, this is a false alarm
                    this._hasFileSystemChanges = false;
                    this._lastModified = await this._getFileModifiedTime();
                }
            } else {
                console.warn(`[${this.getFileType()}] ⚠ Reload failed - null returned`);
            }
        } finally {
            // PERFORMANCE: End operation in coordinator
            MarkdownFile._watcherCoordinator.endOperation(this._relativePath, 'reload');
        }
    }

    /**
     * Read from disk with verification that content has actually changed
     * Retries if file appears unchanged (incomplete write)
     */
    protected async _readFromDiskWithVerification(): Promise<string | null> {
        const maxRetries = 10;
        const retryDelay = 100;


        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // Check file modification time first
            const currentMtime = await this._getFileModifiedTime();
            if (currentMtime && this._lastModified) {
                const mtimeChanged = currentMtime.getTime() !== this._lastModified.getTime();

                if (!mtimeChanged && attempt === 0) {
                    console.warn(`[${this.getFileType()}] ⚠ File mtime unchanged - false alarm from watcher, keeping content`);
                    return this._baseline; // Return baseline to keep existing content, prevent reload failure
                }
            }

            // Read content
            const content = await this.readFromDisk();

            if (content === null) {
                console.error(`[${this.getFileType()}] Read failed on attempt ${attempt + 1}`);
                return null;
            }


            // Verify content has actually changed
            if (content !== this._baseline) {
                return content;
            }

            // Content unchanged - this could be a false alarm or legitimate no-change
            // If mtime changed but content is the same, the file was touched but not modified
            // Return baseline to indicate "no actual change" rather than error
            if (attempt === 0) {
                return this._baseline; // Return baseline to skip reload, keep existing content
            }

            // Content unchanged after waiting - file write may be incomplete, wait and retry
            if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
                // After max retries, content still equals baseline - this is OK, not an error
                // The file was genuinely not modified (false alarm from watcher)
                return this._baseline; // Return baseline to keep existing content
            }
        }

        return null;
    }

    /**
     * Save current content to disk and update baseline
     * @param options - Save options (skipReloadDetection, source, etc.)
     */
    public async save(options: SaveOptions = {}): Promise<void> {
        const skipReloadDetection = options.skipReloadDetection ?? true; // Default: skip (our own save)
        const source = options.source ?? 'unknown';


        // PERFORMANCE: Use watcher coordinator to prevent conflicts
        await MarkdownFile._watcherCoordinator.startOperation(this._relativePath, 'save');

        // TRANSACTION: Begin save transaction for rollback capability
        const originalState = {
            content: this._content,
            baseline: this._baseline,
            // NOTE: No need to store hasUnsavedChanges - it's computed from (content !== baseline)
            hasFileSystemChanges: this._hasFileSystemChanges,
            lastModified: this._lastModified
        };
        const transactionId = MarkdownFile._saveTransactionManager.beginTransaction(this._relativePath, originalState);

        // Pause file watcher before saving to prevent our own save from triggering "external" change
        const wasWatching = this._isWatching;
        if (wasWatching) {
            this.stopWatching();
        }

        try {
            // Validate before saving
            const validation = this.validate(this._content);
            if (!validation.valid) {
                const errors = validation.errors?.join(', ') || 'Unknown validation error';
                throw new Error(`Cannot save ${this._relativePath}: ${errors}`);
            }

            await this.writeToDisk(this._content);

            // CRITICAL: Set flag AFTER successful write (not before!)
            // This prevents flag from lingering if write fails
            if (skipReloadDetection) {
                this._skipNextReloadDetection = true;
            }

            // Update state after successful write
            this._baseline = this._content;
            // NOTE: No need to set _hasUnsavedChanges - it's now computed from (_content !== _baseline)
            this._hasFileSystemChanges = false;
            this._lastModified = new Date();

            // TRANSACTION: Commit the transaction
            MarkdownFile._saveTransactionManager.commitTransaction(this._relativePath, transactionId);

            this._emitChange('saved');
        } catch (error) {
            // TRANSACTION: Rollback on failure
            console.error(`[${this.getFileType()}] Save failed, rolling back:`, error);
            MarkdownFile._saveTransactionManager.rollbackTransaction(this._relativePath, transactionId);

            // Restore original state
            this._content = originalState.content;
            this._baseline = originalState.baseline;
            // NOTE: No need to restore hasUnsavedChanges - it's computed from (content !== baseline)
            this._hasFileSystemChanges = originalState.hasFileSystemChanges;
            this._lastModified = originalState.lastModified;

            throw error; // Re-throw the error
        } finally {
            // Resume file watcher after save
            if (wasWatching) {
                this.startWatching();
            }

            // PERFORMANCE: End operation in coordinator
            MarkdownFile._watcherCoordinator.endOperation(this._relativePath, 'save');
        }
    }

    /**
     * Discard unsaved changes and revert to baseline
     */
    public discardChanges(): void {
        this._content = this._baseline;
        // NOTE: No need to set _hasUnsavedChanges - it's now computed from (_content !== _baseline)

        // NEVER emit 'content' event when discarding changes
        // We're reverting to baseline (what's on disk) - nothing on disk changed
        // Board was already parsed from this baseline content, no need to re-parse
    }

    // ============= CONFLICT RESOLUTION =============

    /**
     * Show conflict dialog and resolve based on user choice
     */
    public async showConflictDialog(): Promise<ConflictResolution | null> {
        const context = this.getConflictContext();
        const resolution = await this._conflictResolver.resolveConflict(context);

        if (resolution && resolution.shouldProceed) {
            // Check shouldCreateBackup FIRST because backup-and-reload sets both flags
            if (resolution.shouldCreateBackup) {
                // resolveConflict('backup') creates backup AND reloads
                // Create backup of current content, then reload
                await this.createBackup('conflict');
                await this.reload();
                this._emitChange('conflict');
            } else if (resolution.shouldSave) {
                // save() method marks itself as legitimate automatically
                await this.save();
            } else if (resolution.shouldReload) {
                await this.reload();
            } else if (resolution.shouldIgnore) {
            } else {
            }
        } else {
        }

        return resolution;
    }

    // ============= BACKUP =============

    /**
     * Create backup of current content
     * (Subclasses can override with specific implementation)
     */
    public async createBackup(label: string = 'manual'): Promise<void> {

        try {
            // Get the VS Code TextDocument for this file
            const document = await vscode.workspace.openTextDocument(this._path);

            if (!document) {
                console.error(`[${this.getFileType()}] Cannot create backup - failed to open document: ${this._relativePath}`);
                return;
            }

            // Use BackupManager to create the backup
            const backupManager = new BackupManager();
            const success = await backupManager.createBackup(document, {
                label: label,
                forceCreate: true  // Always create backup for conflict resolution
            });

            if (success) {
            } else {
                console.warn(`[${this.getFileType()}] ⚠️  Backup creation returned false: ${this._relativePath}`);
            }
        } catch (error) {
            console.error(`[${this.getFileType()}] ❌ Failed to create backup:`, error);
        }
    }

    // ============= FILE WATCHING & CHANGE DETECTION =============

    /**
     * Start watching file for external changes (with deduplication)
     */
    public startWatching(): void {
        if (this._isWatching) {
            return;
        }

        const watchPath = this._path;

        // BUGFIX: Don't create watcher for non-existent files to prevent listener leaks
        // The _exists flag may not be set yet, so also check file system synchronously
        if (!fs.existsSync(watchPath)) {
            console.warn(`[${this.getFileType()}] Skipping watcher for non-existent file: ${this._relativePath}`);
            this._exists = false;
            return;
        }

        // PERFORMANCE: Check if we already have a watcher for this file
        const existingWatcher = MarkdownFile._activeWatchers.get(watchPath);
        if (existingWatcher) {
            existingWatcher.refCount++;
            this._fileWatcher = existingWatcher.watcher;

            // CRITICAL: Each instance needs its own event subscriptions even when sharing a watcher
            const changeSubscription = this._fileWatcher.onDidChange(async (uri) => {
                await this._onFileSystemChange('modified');
            });
            this._watcherSubscriptions.push(changeSubscription);

            const deleteSubscription = this._fileWatcher.onDidDelete(async (uri) => {
                await this._onFileSystemChange('deleted');
            });
            this._watcherSubscriptions.push(deleteSubscription);

            const createSubscription = this._fileWatcher.onDidCreate(async (uri) => {
                await this._onFileSystemChange('created');
            });
            this._watcherSubscriptions.push(createSubscription);

            this._isWatching = true;
            return;
        }


        const pattern = new vscode.RelativePattern(
            path.dirname(this._path),
            path.basename(this._path)
        );

        this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        // Watch for modifications - CRITICAL: Store disposables to prevent memory leak
        const changeSubscription = this._fileWatcher.onDidChange(async (uri) => {
            await this._onFileSystemChange('modified');
        });
        this._watcherSubscriptions.push(changeSubscription);

        // Watch for deletion
        const deleteSubscription = this._fileWatcher.onDidDelete(async (uri) => {
            await this._onFileSystemChange('deleted');
        });
        this._watcherSubscriptions.push(deleteSubscription);

        // Watch for creation
        const createSubscription = this._fileWatcher.onDidCreate(async (uri) => {
            await this._onFileSystemChange('created');
        });
        this._watcherSubscriptions.push(createSubscription);

        // PERFORMANCE: Register in shared watcher registry
        MarkdownFile._activeWatchers.set(watchPath, { watcher: this._fileWatcher, refCount: 1, lastActivity: new Date() });

        this._disposables.push(this._fileWatcher);
        this._isWatching = true;
    }

    /**
     * Stop watching file (with reference counting)
     */
    public stopWatching(): void {
        if (!this._isWatching) {
            return;
        }

        // CRITICAL: Dispose event listener subscriptions to prevent memory leak
        this._watcherSubscriptions.forEach(sub => sub.dispose());
        this._watcherSubscriptions = [];

        const watchPath = this._path;
        const existingWatcher = MarkdownFile._activeWatchers.get(watchPath);

        if (existingWatcher) {
            existingWatcher.refCount--;

            if (existingWatcher.refCount <= 0) {
                // Last reference - dispose the watcher
                existingWatcher.watcher.dispose();
                MarkdownFile._activeWatchers.delete(watchPath);
            } else {
            }
        } else {
            console.warn(`[${this.getFileType()}] No watcher found in registry for: ${this._relativePath}`);
        }

        this._fileWatcher = undefined;
        this._isWatching = false;
    }

    /**
     * Handle file system change detected by watcher
     */
    protected async _onFileSystemChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {

        // CRITICAL: Always reset flag when watcher fires (prevents lingering flag)
        const hadSkipFlag = this._skipNextReloadDetection;
        if (hadSkipFlag) {
            this._skipNextReloadDetection = false; // Reset flag immediately

            // Only skip reload for 'modified' events (our own save)
            if (changeType === 'modified') {
                this._hasFileSystemChanges = false; // No need to mark as external
                return; // Skip external change handling
            }

            // For 'deleted' or 'created', flag was set but file state changed unexpectedly
            // Continue to handle as external change (don't skip)
        }

        // CRITICAL: If user is in edit mode, stop editing IMMEDIATELY before any processing
        // This prevents board corruption when external changes occur during editing
        if (this._isInEditMode) {
            await this.requestStopEditing();
            // Keep the edit mode flag true for conflict detection (will be cleared after resolution)
        }

        // Mark as having external changes
        this._hasFileSystemChanges = true;
        this._emitChange('external');

        // Delegate to subclass for specific handling
        await this.handleExternalChange(changeType);
    }

    /**
     * Request the frontend to stop editing and capture the edited value
     * The captured value is applied to the baseline (not saved to disk)
     * This preserves the user's edit as "local state" for conflict resolution
     */
    protected async requestStopEditing(): Promise<void> {
        // Access the file registry to request stop editing and capture value
        const mainFile = this.getFileType() === 'main' ? this as any : (this as any)._parentFile;
        if (mainFile && mainFile._fileRegistry) {
            const capturedEdit = await mainFile._fileRegistry.requestStopEditing();

            // If we got an edit value, apply it to the baseline (not save to disk)
            if (capturedEdit && capturedEdit.value !== undefined) {

                // Apply the edit to baseline - this becomes the "local state" for conflict
                await this.applyEditToBaseline(capturedEdit);

            }
        }
    }

    /**
     * Apply a captured edit to the baseline (in-memory, not saved to disk)
     * This updates the "local state" to include the user's edit
     */
    protected async applyEditToBaseline(capturedEdit: any): Promise<void> {
        // Subclasses override this to handle their specific edit types
        // Default: do nothing (main file handles via board, includes override)
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

    // ============= CLEANUP =============

    /**
     * Dispose of all resources
     */
    public dispose(): void {

        // FOUNDATION-2: Cancel any in-flight reload operations
        this._currentReloadSequence++;

        this.stopWatching();
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
