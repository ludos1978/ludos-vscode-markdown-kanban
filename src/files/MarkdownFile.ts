import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConflictResolver, ConflictContext, ConflictResolution } from '../services/ConflictResolver';
import { BackupManager } from '../services/BackupManager';
import { SaveOptions } from './SaveOptions';
import { SaveTransactionManager } from './SaveTransactionManager';
import { WatcherCoordinator } from './WatcherCoordinator';
import { normalizePathForLookup, isSamePath } from '../utils/stringUtils';
import { CapturedEdit, IMarkdownFileRegistry } from './FileInterfaces';

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

    /**
     * Get the file registry (if accessible from this file type)
     * MainKanbanFile returns its _fileRegistry, IncludeFile delegates to parent
     */
    public abstract getFileRegistry(): IMarkdownFileRegistry | undefined;

    // ============= PATH NORMALIZATION (FOUNDATION-1) =============
    // Note: Core path functions are in utils/stringUtils.ts
    // These static methods delegate to the centralized functions for backwards compatibility

    /**
     * Centralized normalization function for relative paths.
     * Delegates to normalizePathForLookup from stringUtils.
     *
     * @param relativePath The relative path to normalize
     * @returns Normalized path (lowercase, forward slashes, trimmed)
     */
    public static normalizeRelativePath(relativePath: string): string {
        return normalizePathForLookup(relativePath);
    }

    /**
     * Compare two paths for equality (normalized comparison).
     * Delegates to isSamePath from stringUtils.
     *
     * @param path1 First path to compare
     * @param path2 Second path to compare
     * @returns true if paths are equivalent (after normalization)
     */
    public static isSameFile(path1: string, path2: string): boolean {
        return isSamePath(path1, path2);
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
     * @returns true if cancelled, false if still current
     */
    private _checkReloadCancelled(mySequence: number): boolean {
        return mySequence !== this._currentReloadSequence;
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

        // Check 2: Excessive parent directory traversal (potential security concern)
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

    public setExists(value: boolean): void {
        this._exists = value;
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
        // Delegates to actual VS Code document dirty check
        return this.isDocumentDirtyInVSCode();
    }

    /**
     * Check if VS Code has this file open and it's dirty (unsaved in text editor)
     * This is the common pattern used by both MainKanbanFile and IncludeFile
     */
    protected isDocumentDirtyInVSCode(): boolean {
        const openDocuments = vscode.workspace.textDocuments;
        return openDocuments.some(doc =>
            doc.uri.fsPath === this._path && doc.isDirty
        );
    }

    /**
     * Check if file has any unsaved changes from any source:
     * - Internal state (kanban UI edits)
     * - Edit mode (user actively editing)
     * - VS Code document dirty (text editor edits)
     */
    public hasAnyUnsavedChanges(): boolean {
        // Check 1: Internal state flag (from kanban UI) - computed from content comparison
        if (this.hasUnsavedChanges()) return true;

        // Check 2: Edit mode (user is actively editing)
        if (this._isInEditMode) return true;

        // Check 3: VSCode document dirty status (text editor edits)
        if (this.isDocumentDirtyInVSCode()) return true;

        return false;
    }

    /**
     * Check if file has a conflict (both local and external changes)
     * Includes VS Code document dirty status in conflict detection
     */
    public hasConflict(): boolean {
        // Base check: kanban UI changes + external changes
        const hasKanbanConflict = (this.hasUnsavedChanges() || this._isInEditMode) && this._hasFileSystemChanges;

        // Also check VS Code document dirty status
        const documentIsDirty = this.isDocumentDirtyInVSCode();
        const hasEditorConflict = documentIsDirty && this._hasFileSystemChanges;

        return hasKanbanConflict || hasEditorConflict;
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
            if (this._checkReloadCancelled(mySequence)) {
                return;
            }

            if (content !== null) {
                // Check if content actually changed (verification returns baseline if unchanged)
                if (content !== this._baseline) {
                    // FOUNDATION-2: Final check before applying changes
                    if (this._checkReloadCancelled(mySequence)) {
                        return;
                    }

                    console.log(`[MarkdownFile] reload() updating baseline for: ${this._relativePath}`);
                    this._content = content;
                    this._baseline = content;
                    // NOTE: No need to set _hasUnsavedChanges - it's now computed from (_content !== _baseline)
                    this._hasFileSystemChanges = false;
                    this._lastModified = await this._getFileModifiedTime();

                    this._emitChange('reloaded');
                } else {
                    // Content unchanged - verification returned baseline, this is a false alarm
                    console.log(`[MarkdownFile] reload() skipped - content matches baseline for: ${this._relativePath}`);
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
        // Check mtime
        const currentMtime = await this._getFileModifiedTime();
        const mtimeChanged = currentMtime && this._lastModified &&
            currentMtime.getTime() !== this._lastModified.getTime();

        // Check file size
        const currentSize = await this._getFileSize();
        const baselineSize = Buffer.byteLength(this._baseline, 'utf8');
        const sizeChanged = currentSize !== null && currentSize !== baselineSize;

        // If BOTH mtime and size are unchanged, no change
        if (!mtimeChanged && !sizeChanged && this._baseline) {
            console.log(`[${this.getFileType()}] Mtime & size unchanged, no change`);
            return this._baseline;
        }

        // Either mtime or size changed - read content
        const content = await this.readFromDisk();
        if (content === null) {
            console.error(`[${this.getFileType()}] Read failed`);
            return null;
        }

        return content;
    }

    /**
     * Save current content to disk and update baseline
     * @param options - Save options (skipReloadDetection, source, etc.)
     */
    public async save(options: SaveOptions = {}): Promise<void> {
        const skipReloadDetection = options.skipReloadDetection ?? true; // Default: skip (our own save)
        // options.source available for debugging if needed


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
                const backupPath = await this.createBackup('conflict');
                await this.reload();
                this._emitChange('conflict');

                // Show notification with link to open backup file
                if (backupPath) {
                    this._showBackupNotification(backupPath);
                }
            } else if (resolution.shouldSave) {
                // save() method marks itself as legitimate automatically
                await this.save();
            } else if (resolution.shouldReload) {
                await this.reload();
            }
            // resolution.shouldIgnore: do nothing (user chose to ignore the conflict)
        }

        return resolution;
    }

    // ============= BACKUP =============

    /**
     * Create backup of current content
     * (Subclasses can override with specific implementation)
     * @returns The backup file path if successful, null if failed
     */
    public async createBackup(label: string = 'manual'): Promise<string | null> {

        try {
            // Get the VS Code TextDocument for this file
            const document = await vscode.workspace.openTextDocument(this._path);

            if (!document) {
                console.error(`[${this.getFileType()}] Cannot create backup - failed to open document: ${this._relativePath}`);
                return null;
            }

            // Use BackupManager to create the backup
            const backupManager = new BackupManager();
            const backupPath = await backupManager.createBackup(document, {
                label: label,
                forceCreate: true  // Always create backup for conflict resolution
            });

            if (!backupPath) {
                console.warn(`[${this.getFileType()}] Backup creation returned null: ${this._relativePath}`);
            }

            return backupPath;
        } catch (error) {
            console.error(`[${this.getFileType()}] Failed to create backup:`, error);
            return null;
        }
    }

    /**
     * Show notification with link to open backup file
     */
    protected _showBackupNotification(backupPath: string, message?: string): void {
        const fileName = path.basename(backupPath);
        const displayMessage = message || `Your changes have been saved to backup: ${fileName}`;
        vscode.window.showInformationMessage(
            displayMessage,
            'Open Backup'
        ).then(choice => {
            if (choice === 'Open Backup') {
                vscode.workspace.openTextDocument(backupPath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
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
            this._setupWatcherSubscriptions();
            this._isWatching = true;
            return;
        }

        const pattern = new vscode.RelativePattern(
            path.dirname(this._path),
            path.basename(this._path)
        );

        this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        this._setupWatcherSubscriptions();

        // PERFORMANCE: Register in shared watcher registry
        MarkdownFile._activeWatchers.set(watchPath, { watcher: this._fileWatcher, refCount: 1, lastActivity: new Date() });

        this._disposables.push(this._fileWatcher);
        this._isWatching = true;
    }

    /**
     * Setup event subscriptions for the file watcher
     * CRITICAL: Each instance needs its own subscriptions even when sharing a watcher
     */
    private _setupWatcherSubscriptions(): void {
        if (!this._fileWatcher) return;

        this._watcherSubscriptions.push(
            this._fileWatcher.onDidChange(async () => {
                await this._onFileSystemChange('modified');
            }),
            this._fileWatcher.onDidDelete(async () => {
                await this._onFileSystemChange('deleted');
            }),
            this._fileWatcher.onDidCreate(async () => {
                await this._onFileSystemChange('created');
            })
        );
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
        const fileRegistry = this.getFileRegistry();
        if (fileRegistry) {
            const capturedEdit = await fileRegistry.requestStopEditing();

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
     * Subclasses override this to handle their specific edit types
     */
    public async applyEditToBaseline(_capturedEdit: CapturedEdit): Promise<void> {
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
     * Get file size from disk (fast check for content changes)
     */
    protected async _getFileSize(): Promise<number | null> {
        try {
            const stat = await fs.promises.stat(this._path);
            return stat.size;
        } catch (error) {
            // File might not exist, which is OK
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

    /**
     * Force sync baseline with disk content
     *
     * Unlike reload() which uses _readFromDiskWithVerification() (which may return
     * the old baseline in some cases), this method directly reads from disk and
     * updates both content and baseline unconditionally.
     *
     * Use this after checkForExternalChanges() detects a change to ensure the
     * baseline is updated and the same file won't be detected as "changed" again.
     */
    public async forceSyncBaseline(): Promise<void> {
        const diskContent = await this.readFromDisk();
        if (diskContent === null) {
            console.warn(`[${this.getFileType()}] forceSyncBaseline failed - could not read disk`);
            return;
        }

        // Unconditionally update content and baseline to match disk
        this._content = diskContent;
        this._baseline = diskContent;
        this._hasFileSystemChanges = false;
        this._lastModified = await this._getFileModifiedTime();

        console.log(`[${this.getFileType()}] forceSyncBaseline updated: ${this._relativePath}`);
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
