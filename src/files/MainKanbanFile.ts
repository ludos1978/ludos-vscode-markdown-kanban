import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
import { MarkdownFileRegistry } from './MarkdownFileRegistry';
import { KanbanBoard, MarkdownKanbanParser } from '../markdownParser';
import { ConflictResolver, ConflictContext, ConflictResolution } from '../conflictResolver';
import { BackupManager } from '../backupManager';
import { FileManager } from '../fileManager';
import { UnifiedChangeHandler } from '../core/UnifiedChangeHandler';
import { SaveCoordinator } from '../core/SaveCoordinator';

/**
 * Represents the main kanban markdown file.
 *
 * Responsibilities:
 * - Manage the primary kanban.md file
 * - Parse markdown <-> KanbanBoard structure
 * - Handle YAML frontmatter and footer
 * - Coordinate with VS Code document when open
 * - Handle main file conflicts and external changes
 */
export class MainKanbanFile extends MarkdownFile {
    // ============= BOARD STATE =============
    private _board?: KanbanBoard;
    private _yamlHeader: string | null = null;
    private _kanbanFooter: string | null = null;
    private _includedFiles: string[] = []; // Regular includes (!!!include(file)!!!)
    private _cachedBoardFromWebview?: KanbanBoard; // Cached board from webview for conflict detection

    // ============= DEPENDENCIES =============
    private _fileManager: FileManager;
    private _fileRegistry: MarkdownFileRegistry;
    private _parser: typeof MarkdownKanbanParser;

    constructor(
        filePath: string,
        fileManager: FileManager,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        fileRegistry: MarkdownFileRegistry
    ) {
        // FOUNDATION-1: For main file, use basename as relative path
        // Main file doesn't have a "parent", so relative path = filename
        const path = require('path');
        const relativePath = path.basename(filePath);

        super(filePath, relativePath, conflictResolver, backupManager);
        this._fileManager = fileManager;
        this._fileRegistry = fileRegistry;
        this._parser = MarkdownKanbanParser;
    }

    // ============= FILE TYPE =============

    public getFileType(): 'main' {
        return 'main';
    }

    // ============= BOARD OPERATIONS =============

    /**
     * Get the parsed board (cached)
     */
    public getBoard(): KanbanBoard | undefined {
        return this._board;
    }

    /**
     * Parse current content into board structure
     */
    public parseToBoard(): KanbanBoard {
        console.log(`[MainKanbanFile] Parsing content to board: ${this._relativePath}`);
        // Pass existing board to preserve task/column IDs during re-parse
        const parseResult = this._parser.parseMarkdown(this._content, undefined, this._board);
        this._board = parseResult.board;
        this._includedFiles = parseResult.includedFiles || [];

        console.log(`[MainKanbanFile] Parsed board with ${this._includedFiles.length} regular includes`);

        // Extract YAML and footer if present
        // (This would use the existing parsing logic)
        return parseResult.board;
    }

    /**
     * Get regular include files (!!!include(file)!!!)
     */
    public getIncludedFiles(): string[] {
        return this._includedFiles;
    }

    /**
     * Update content from board structure
     */
    public updateFromBoard(board: KanbanBoard, preserveYaml: boolean = true): void {
        console.log(`[MainKanbanFile] Updating content from board: ${this._relativePath}`);

        this._board = board;

        // Generate markdown from board
        // (This would use the existing generation logic from kanbanFileService)
        // For now, we'll just mark that this needs to be implemented
        const generatedContent = this._generateMarkdownFromBoard(board);

        this.setContent(generatedContent, false);
    }

    /**
     * Get YAML frontmatter
     */
    public getYamlHeader(): string | null {
        return this._yamlHeader;
    }

    /**
     * Set YAML frontmatter
     */
    public setYamlHeader(yaml: string | null): void {
        this._yamlHeader = yaml;
    }

    /**
     * Get kanban footer
     */
    public getKanbanFooter(): string | null {
        return this._kanbanFooter;
    }

    /**
     * Set kanban footer
     */
    public setKanbanFooter(footer: string | null): void {
        this._kanbanFooter = footer;
    }

    /**
     * Update cached board from webview (for conflict detection)
     */
    public setCachedBoardFromWebview(board: KanbanBoard | undefined): void {
        this._cachedBoardFromWebview = board;
    }

    /**
     * Get cached board from webview (for conflict detection)
     */
    public getCachedBoardFromWebview(): KanbanBoard | undefined {
        return this._cachedBoardFromWebview;
    }

    // ============= FILE I/O =============

    /**
     * Read content from VS Code document or disk
     */
    public async readFromDisk(): Promise<string | null> {
        console.log(`[MainKanbanFile] Reading from disk: ${this._path}`);

        // Try to get from open document first
        const document = this._fileManager.getDocument();
        if (document && document.uri.fsPath === this._path) {
            console.log(`[MainKanbanFile] Reading from open document`);
            return document.getText();
        }

        // Read from file system
        try {
            const content = await fs.promises.readFile(this._path, 'utf-8');
            console.log(`[MainKanbanFile] Read ${content.length} characters from disk`);
            return content;
        } catch (error) {
            console.error(`[MainKanbanFile] Failed to read file:`, error);
            return null;
        }
    }

    /**
     * Write content to disk using VS Code API
     */
    public async writeToDisk(content: string): Promise<void> {
        console.log(`[MainKanbanFile] Writing to disk: ${this._path} (${content.length} characters)`);

        try {
            const uri = vscode.Uri.file(this._path);
            const encoder = new TextEncoder();
            const contentBytes = encoder.encode(content);

            await vscode.workspace.fs.writeFile(uri, contentBytes);

            // Update document version if document is open
            const document = this._fileManager.getDocument();
            if (document && document.uri.fsPath === this._path) {
                this._documentVersion = document.version;
            }

            this._lastModified = new Date();
            console.log(`[MainKanbanFile] Successfully wrote to disk`);
        } catch (error) {
            console.error(`[MainKanbanFile] Failed to write file:`, error);
            throw error;
        }
    }

    // ============= EXTERNAL CHANGE HANDLING =============

    /**
     * Handle external file change using unified change handler
     * This replaces the complex conflict detection logic with a single, consistent system
     */
    public async handleExternalChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        const changeHandler = UnifiedChangeHandler.getInstance();
        await changeHandler.handleExternalChange(this, changeType);
    }

    /**
     * Ultra-comprehensive conflict analysis
     * Checks EVERY possible source of unsaved changes to prevent data loss
     */
    private async _analyzeConflictSituation(): Promise<{
        hasAnyUnsavedChanges: boolean;
        reasons: string[];
        details: {
            internalState: boolean;
            editMode: boolean;
            documentDirty: boolean;
            documentOpen: boolean;
            boardModified: boolean;
            cacheModified: boolean;
        };
    }> {
        const reasons: string[] = [];
        const details = {
            internalState: false,
            editMode: false,
            documentDirty: false,
            documentOpen: false,
            boardModified: false,
            cacheModified: false
        };

        // 1. Internal state flag (kanban UI modifications)
        if (this._hasUnsavedChanges) {
            details.internalState = true;
            reasons.push('Internal unsaved changes flag is true');
        }

        // 2. Edit mode (user actively editing)
        if (this._isInEditMode) {
            details.editMode = true;
            reasons.push('User is in edit mode');
        }

        // 3. VSCode document dirty status (text editor has unsaved changes)
        const document = this._fileManager.getDocument();
        if (document && document.uri.fsPath === this._path) {
            details.documentOpen = true;
            if (document.isDirty) {
                details.documentDirty = true;
                reasons.push('VSCode document is dirty (unsaved text editor changes)');
            }
        }

        // 4. Document is open but we can't access it (be safe)
        const allDocs = vscode.workspace.textDocuments;
        const docOpen = allDocs.some(d => d.uri.fsPath === this._path);
        if (docOpen && !document) {
            details.documentOpen = true;
            reasons.push('Document is open but inaccessible (assuming unsaved changes)');
        }

        // 5. Board state differs from baseline (extra safety check)
        if (this._board) {
            // Generate what the content SHOULD be from current board
            const expectedContent = this._generateMarkdownFromBoard(this._board);
            if (expectedContent !== this._baseline) {
                details.boardModified = true;
                reasons.push('Board state differs from saved baseline');
            }
        }

        // 6. Check if there's a cached board that differs from current board
        // This would indicate unsaved kanban changes
        const currentBoard = this._board;
        if (currentBoard && this._cachedBoardFromWebview) {
            // Deep comparison of board structure (excluding volatile fields like timestamps)
            const currentNormalized = this._normalizeBoardForComparison(currentBoard);
            const cachedNormalized = this._normalizeBoardForComparison(this._cachedBoardFromWebview);

            if (JSON.stringify(currentNormalized) !== JSON.stringify(cachedNormalized)) {
                details.cacheModified = true;
                reasons.push('Cached board differs from current board (unsaved kanban changes)');
                console.log(`[MainKanbanFile._analyzeConflictSituation] 🔍 BOARD DIFFERENCE DETECTED:`);
                console.log(`[MainKanbanFile._analyzeConflictSituation]   Current board columns: ${currentBoard.columns.length}`);
                console.log(`[MainKanbanFile._analyzeConflictSituation]   Cached board columns: ${this._cachedBoardFromWebview.columns.length}`);
            }
        } else if (!this._cachedBoardFromWebview) {
            console.log(`[MainKanbanFile._analyzeConflictSituation] ⚠️  No cached board available for comparison`);
        }

        // 7. Check file registry for any unsaved include files
        const includeFiles = this._fileRegistry.getIncludeFiles();
        const unsavedIncludes = includeFiles.filter(f => f.hasUnsavedChanges());
        if (unsavedIncludes.length > 0) {
            reasons.push(`${unsavedIncludes.length} include files have unsaved changes`);
        }

        // 8. Time-based safety check: If external change happened very recently,
        // it might be concurrent editing
        const now = Date.now();
        const lastModified = this._lastModified?.getTime() || 0;
        const timeSinceChange = now - lastModified;
        if (timeSinceChange < 2000) { // Less than 2 seconds ago
            reasons.push(`External change very recent (${timeSinceChange}ms ago) - possible concurrent editing`);
        }

        const hasAnyUnsavedChanges = reasons.length > 0;

        return {
            hasAnyUnsavedChanges,
            reasons,
            details
        };
    }

    // ============= VALIDATION =============

    /**
     * Validate kanban markdown content
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
        try {
            const parseResult = this._parser.parseMarkdown(content);
            const board = parseResult.board;

            if (!board.valid) {
                return {
                    valid: false,
                    errors: ['Invalid kanban markdown format']
                };
            }

            // Additional validation
            const errors: string[] = [];

            if (board.columns.length === 0) {
                errors.push('Board must have at least one column');
            }

            return {
                valid: errors.length === 0,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error) {
            return {
                valid: false,
                errors: [`Parse error: ${error}`]
            };
        }
    }

    // ============= CONFLICT CONTEXT =============

    protected getConflictContext(): ConflictContext {
        // Check if any include files have unsaved changes
        const includeFiles = this._fileRegistry.getIncludeFiles();
        const hasIncludeUnsavedChanges = includeFiles.some(file =>
            file.hasUnsavedChanges()
        );

        // Check if VSCode document is dirty (text editor unsaved changes)
        const document = this._fileManager.getDocument();
        const documentIsDirty = !!(document && document.uri.fsPath === this._path && document.isDirty);

        // CRITICAL: Check if there's a cached board from webview (UI edits not yet saved)
        const cachedBoard = this.getCachedBoardFromWebview();
        const hasCachedBoardChanges = !!cachedBoard;

        // Main has unsaved changes if ANY of:
        // - Internal state flag is true (from kanban UI edits)
        // - OR VSCode document is dirty (from text editor edits)
        // - OR Cached board exists (UI edits not yet written to file)
        const hasMainUnsavedChanges = this._hasUnsavedChanges || documentIsDirty || hasCachedBoardChanges;

        console.log(`[MainKanbanFile.getConflictContext] Computing hasMainUnsavedChanges:`);
        console.log(`[MainKanbanFile.getConflictContext]   _hasUnsavedChanges: ${this._hasUnsavedChanges}`);
        console.log(`[MainKanbanFile.getConflictContext]   documentIsDirty: ${documentIsDirty}`);
        console.log(`[MainKanbanFile.getConflictContext]   hasCachedBoardChanges: ${hasCachedBoardChanges}`);
        console.log(`[MainKanbanFile.getConflictContext]   → hasMainUnsavedChanges: ${hasMainUnsavedChanges}`);

        return {
            type: 'external_main',
            fileType: 'main',
            filePath: this._path,
            fileName: path.basename(this._path),
            hasMainUnsavedChanges: hasMainUnsavedChanges,
            hasIncludeUnsavedChanges: hasIncludeUnsavedChanges,
            hasExternalChanges: this._hasFileSystemChanges,
            changedIncludeFiles: [],
            isClosing: false,
            isInEditMode: this._isInEditMode
        };
    }

    // ============= SIMPLIFIED CONFLICT DETECTION =============

    /**
     * Check if there are ANY unsaved changes (simplified 3-variant approach)
     * Returns true if ANY of these conditions are met:
     * - Internal state flag is true (kanban UI edits)
     * - User is in edit mode
     * - VSCode document is dirty (text editor edits)
     * - Document is open but we can't access it (safe default)
     */
    public hasAnyUnsavedChanges(): boolean {
        // Check 1: Internal state flag (from kanban UI)
        if (this._hasUnsavedChanges) return true;

        // Check 2: Edit mode (user is actively editing)
        if (this._isInEditMode) return true;

        // Check 3: VSCode document dirty status (text editor edits)
        const document = this._fileManager.getDocument();
        if (document && document.uri.fsPath === this._path && document.isDirty) {
            return true;
        }

        // Check 4: If document is open but we can't find it, be safe
        const allDocs = vscode.workspace.textDocuments;
        const docOpen = allDocs.some(d => d.uri.fsPath === this._path);
        if (docOpen && !document) {
            // Document is open but we can't access it - assume it might have changes
            return true;
        }

        return false;
    }

    /**
     * Get detailed reasons for unsaved changes (for logging)
     */
    private _getUnsavedChangesReasons(): { [key: string]: boolean } {
        const document = this._fileManager.getDocument();
        const allDocs = vscode.workspace.textDocuments;
        const docOpen = allDocs.some(d => d.uri.fsPath === this._path);

        return {
            hasUnsavedChanges_flag: this._hasUnsavedChanges,
            isInEditMode_flag: this._isInEditMode,
            documentIsDirty: !!(document && document.uri.fsPath === this._path && document.isDirty),
            documentOpenButInaccessible: docOpen && !document
        };
    }

    // ============= OVERRIDES =============

    /**
     * Override hasConflict to also check VSCode document dirty status
     * This ensures conflicts are detected when editing in text editor (not just kanban UI)
     */
    public hasConflict(): boolean {
        // Check base class flags (kanban UI changes)
        const baseHasConflict = super.hasConflict();

        // Also check if VSCode document is dirty (text editor changes)
        const document = this._fileManager.getDocument();
        const documentIsDirty = !!(document && document.uri.fsPath === this._path && document.isDirty);

        // Conflict if:
        // - Base class detects conflict (kanban UI changes + external changes)
        // - OR document is dirty (text editor changes) AND has external changes
        const hasConflict = baseHasConflict || (documentIsDirty && this._hasFileSystemChanges);

        if (hasConflict) {
            console.log(`[MainKanbanFile.hasConflict] CONFLICT DETECTED:`, {
                file: this._relativePath,
                baseConflict: baseHasConflict,
                documentIsDirty: documentIsDirty,
                hasFileSystemChanges: this._hasFileSystemChanges,
                hasUnsavedChanges: this._hasUnsavedChanges,
                isInEditMode: this._isInEditMode
            });
        }

        return hasConflict;
    }

    /**
     * Override reload to also parse board
     * OPTIMIZATION: Skip re-parsing if content hasn't actually changed
     */
    public async reload(): Promise<void> {
        console.log(`[MainKanbanFile] ============ RELOAD START ============`);
        console.log(`[MainKanbanFile] Current baseline length: ${this._baseline?.length || 0}`);
        console.log(`[MainKanbanFile] Current content length: ${this._content?.length || 0}`);

        // Read and update content WITHOUT emitting events yet
        const content = await this._readFromDiskWithVerification();
        if (content !== null) {
            console.log(`[MainKanbanFile] Read ${content.length} chars from disk`);

            // CRITICAL OPTIMIZATION: Skip re-parse if content exactly the same
            // This prevents infinite loops and unnecessary board regeneration
            if (content === this._baseline) {
                console.log(`[MainKanbanFile] ✓ Content UNCHANGED - skipping parse and event`);
                console.log(`[MainKanbanFile] → This prevents infinite reload loop`);
                this._hasFileSystemChanges = false;
                this._lastModified = await this._getFileModifiedTime();
                console.log(`[MainKanbanFile] ============ RELOAD END (NO-OP) ============`);
                return;
            }

            // Content actually changed - proceed with full reload
            console.log(`[MainKanbanFile] ⚡ Content CHANGED - proceeding with parse`);
            console.log(`[MainKanbanFile]   Old length: ${this._baseline?.length || 0}`);
            console.log(`[MainKanbanFile]   New length: ${content.length}`);

            this._content = content;
            this._baseline = content;
            this._hasUnsavedChanges = false;
            this._hasFileSystemChanges = false;
            this._lastModified = await this._getFileModifiedTime();

            // CRITICAL: Re-parse board BEFORE emitting event
            // This ensures event handlers see the updated board
            console.log(`[MainKanbanFile] → Re-parsing board...`);
            this.parseToBoard();
            console.log(`[MainKanbanFile] ✓ Board re-parsed successfully`);

            // Now emit the event
            this._emitChange('reloaded');
            console.log(`[MainKanbanFile] ✓ Emitted 'reloaded' event`);
            console.log(`[MainKanbanFile] ============ RELOAD END (SUCCESS) ============`);
        } else {
            console.warn(`[MainKanbanFile] ⚠️ Reload failed - null content returned`);
            console.log(`[MainKanbanFile] ============ RELOAD END (FAILED) ============`);
        }
    }

    /**
     * Override save to validate board before saving
     */
    public async save(): Promise<void> {
        // CRITICAL: Use cached board from webview if it exists (current UI state)
        // Otherwise fall back to parsed board
        const boardToSave = this._cachedBoardFromWebview || this._board;

        console.log(`[MainKanbanFile] save() - using ${this._cachedBoardFromWebview ? 'CACHED BOARD from webview' : 'parsed board'}`);

        if (boardToSave) {
            // Regenerate content from board before saving
            const content = this._generateMarkdownFromBoard(boardToSave);
            console.log(`[MainKanbanFile] Generated ${content.length} chars from board`);
            this._content = content;
        }

        await super.save();

        // CRITICAL: Clear cached board AFTER save completes
        // Note: save() method automatically sets instance-level skipNextReloadDetection flag
        // This prevents the file watcher from triggering unnecessary reloads
        console.log(`[MainKanbanFile] Clearing cached board after save`);
        this._cachedBoardFromWebview = undefined;
    }

    /**
     * Override to handle special reload case and clear cached board
     */
    public async showConflictDialog(): Promise<ConflictResolution | null> {
        const hadCachedBoard = !!this._cachedBoardFromWebview;
        console.log(`[MainKanbanFile] showConflictDialog - before resolution, cachedBoard exists: ${hadCachedBoard}`);

        const context = this.getConflictContext();
        console.log(`[MainKanbanFile] showConflictDialog - Awaiting user choice...`);
        const resolution = await this._conflictResolver.resolveConflict(context);
        console.log(`[MainKanbanFile] showConflictDialog - Resolution received:`, {
            action: resolution?.action,
            shouldProceed: resolution?.shouldProceed,
            shouldCreateBackup: resolution?.shouldCreateBackup,
            shouldSave: resolution?.shouldSave,
            shouldReload: resolution?.shouldReload,
            shouldIgnore: resolution?.shouldIgnore
        });

        if (resolution && resolution.shouldProceed) {
            // CRITICAL: Check shouldCreateBackup FIRST because backup-and-reload sets both shouldCreateBackup AND shouldReload
            console.log(`[MainKanbanFile] Checking shouldCreateBackup: ${resolution.shouldCreateBackup}`);
            if (resolution.shouldCreateBackup) {
                console.log(`[MainKanbanFile] → Executing: backup-and-reload`);
                await this.resolveConflict('backup');
                this._cachedBoardFromWebview = undefined;
                this._hasFileSystemChanges = false;
            } else if (resolution.shouldSave) {
                console.log(`[MainKanbanFile] → Executing: save`);
                // save() method marks itself as legitimate automatically
                await this.save();  // save() already clears cached board
            } else if (resolution.shouldReload && hadCachedBoard) {
                // SPECIAL CASE: If reloading with cached board, force reload from disk
                console.log(`[MainKanbanFile] → Special case: Reload with cached board - discarding UI edits`);
                // Clear cached board FIRST
                this._cachedBoardFromWebview = undefined;
                this._hasFileSystemChanges = false;

                // CRITICAL: Actually read from disk, don't just re-parse old content
                console.log(`[MainKanbanFile] → Reading fresh content from disk...`);
                const freshContent = await this.readFromDisk();
                if (freshContent !== null && freshContent !== this._baseline) {
                    // Content changed on disk
                    console.log(`[MainKanbanFile] → Disk content changed (${freshContent.length} chars), updating...`);
                    this._content = freshContent;
                    this._baseline = freshContent;
                    this._hasUnsavedChanges = false;
                    this._lastModified = await this._getFileModifiedTime();
                    this.parseToBoard();
                    this._emitChange('reloaded');
                    console.log(`[MainKanbanFile] → UI updated to show disk content`);
                } else if (freshContent !== null) {
                    // Content unchanged, but still re-parse to update UI (discard UI edits)
                    console.log(`[MainKanbanFile] → Disk content unchanged, re-parsing to discard UI edits...`);
                    this._content = freshContent;
                    this.parseToBoard();
                    this._emitChange('reloaded');
                    console.log(`[MainKanbanFile] → UI updated (UI edits discarded)`);
                }
            } else if (resolution.shouldReload) {
                console.log(`[MainKanbanFile] → Executing: reload (normal)`);
                await this.reload();
            } else if (resolution.shouldIgnore) {
                console.log(`[MainKanbanFile] → Executing: ignore`);
                // CRITICAL: Keep cached board (user wants to keep their UI edits!)
                // Only clear the external change flag for this specific external change
                this._hasFileSystemChanges = false;
                // DO NOT clear cached board - user chose to ignore external, keep UI edits
                console.log(`[MainKanbanFile] → Kept cached board (user's UI edits preserved)`);
            }
        }

        console.log(`[MainKanbanFile] showConflictDialog - after cleanup, cachedBoard exists: ${!!this._cachedBoardFromWebview}`);

        return resolution;
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Generate markdown from board structure using the shared parser logic
     */
    private _generateMarkdownFromBoard(board: KanbanBoard): string {
        // Use the existing markdown generation logic from MarkdownKanbanParser
        // This ensures consistency with how the main save process generates markdown
        return this._parser.generateMarkdown(board);
    }

    /**
     * Normalize board for comparison by removing volatile fields
     * This ensures consistent comparison of board state for conflict detection
     */
    private _normalizeBoardForComparison(board: KanbanBoard): any {
        // Deep clone to avoid modifying original
        const normalized = JSON.parse(JSON.stringify(board));

        // Remove volatile fields that don't affect content
        if (normalized.columns) {
            for (const column of normalized.columns) {
                // Remove any volatile column properties
                delete column.isLoadingContent;

                if (column.tasks) {
                    for (const task of column.tasks) {
                        // Remove volatile task properties
                        delete task.isLoadingContent;
                        // Keep essential content: title, description, includeFiles, etc.
                    }
                }
            }
        }

        return normalized;
    }
}
