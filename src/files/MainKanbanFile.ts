import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
import { IMarkdownFileRegistry, CapturedEdit } from './FileInterfaces';
import { KanbanBoard } from '../board/KanbanTypes';
import { BoardCrudOperations } from '../board/BoardCrudOperations';
import { MarkdownKanbanParser } from '../markdownParser';
import { ConflictResolver, ConflictContext, ConflictResolution } from '../services/ConflictResolver';
import { BackupManager } from '../services/BackupManager';
import { FileManager } from '../fileManager';
import { UnifiedChangeHandler } from '../core/UnifiedChangeHandler';

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
    private _includedFiles: string[] = []; // Regular includes (!!!include(file)!!!)
    private _cachedBoardFromWebview?: KanbanBoard; // Cached board from webview for conflict detection

    // ============= DEPENDENCIES =============
    private _fileManager: FileManager;
    private _fileRegistry: IMarkdownFileRegistry;
    private _parser: typeof MarkdownKanbanParser;

    constructor(
        filePath: string,
        fileManager: FileManager,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        fileRegistry: IMarkdownFileRegistry
    ) {
        // FOUNDATION-1: For main file, use basename as relative path
        // Main file doesn't have a "parent", so relative path = filename
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

    public getFileRegistry(): IMarkdownFileRegistry | undefined {
        return this._fileRegistry;
    }

    // ============= BOARD OPERATIONS =============

    /**
     * Get the parsed board (cached)
     *
     * @param existingBoard Optional existing board to preserve IDs during re-parsing.
     *                      When provided, triggers re-parse with ID preservation.
     */
    public getBoard(existingBoard?: KanbanBoard): KanbanBoard | undefined {
        // If existingBoard provided, re-parse to preserve IDs
        if (existingBoard) {
            return this.parseToBoard(existingBoard);
        }
        return this._board;
    }

    /**
     * Parse current content into board structure
     *
     * @param existingBoard Optional existing board to preserve task/column IDs during re-parse
     */
    public parseToBoard(existingBoard?: KanbanBoard): KanbanBoard {

        // Pass existing board to preserve task/column IDs during re-parse
        // Priority: provided existingBoard > cached _board
        const boardForIdPreservation = existingBoard || this._board;

        // CRITICAL FIX: Pass basePath for resolving relative include paths
        const basePath = path.dirname(this._path);
        const parseResult = this._parser.parseMarkdown(this._content, basePath, boardForIdPreservation, this._path);
        this._board = parseResult.board;
        this._includedFiles = parseResult.includedFiles || [];


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
     *
     * @param board The board to generate content from
     * @param preserveYaml Whether to preserve YAML frontmatter (default: true)
     * @param updateBaseline Whether to update the baseline (default: false)
     *                       Set to true when called after save to mark content as saved
     */
    public updateFromBoard(board: KanbanBoard, preserveYaml: boolean = true, updateBaseline: boolean = false): void {

        this._board = board;

        // Generate markdown from board
        // (This would use the existing generation logic from kanbanFileService)
        // For now, we'll just mark that this needs to be implemented
        const generatedContent = this._generateMarkdownFromBoard(board);

        // Update content and optionally baseline
        this.setContent(generatedContent, updateBaseline);
    }

    /**
     * Apply a captured edit to the baseline (in-memory, not saved to disk)
     * This updates the "local state" to include the user's edit for conflict resolution
     */
    public async applyEditToBaseline(capturedEdit: CapturedEdit): Promise<void> {

        // Get the current board (from webview cache or parse from content)
        let board = this._cachedBoardFromWebview;
        if (!board) {
            board = this.parseToBoard();
        }

        // Apply the edit to the board based on type
        if (capturedEdit.type === 'task-title' && capturedEdit.taskId) {
            const task = this._findTaskInBoard(board, capturedEdit.taskId, capturedEdit.columnId);
            if (task) {
                task.title = capturedEdit.value;
            }
        } else if (capturedEdit.type === 'task-description' && capturedEdit.taskId) {
            const task = this._findTaskInBoard(board, capturedEdit.taskId, capturedEdit.columnId);
            if (task) {
                task.description = capturedEdit.value;
            }
        } else if (capturedEdit.type === 'column-title' && capturedEdit.columnId) {
            const column = BoardCrudOperations.findColumnById(board, capturedEdit.columnId);
            if (column) {
                column.title = capturedEdit.value;
            }
        }

        // Regenerate markdown from the modified board
        const newContent = this._generateMarkdownFromBoard(board);

        // Update content with the edit
        // NOTE: We only update content, NOT baseline, since baseline represents what's on disk
        // hasUnsavedChanges() will now correctly return true since (_content !== _baseline)
        this._content = newContent;
        // Do NOT update baseline - baseline should always reflect what's on disk!

    }

    /**
     * Find a task in the board by ID
     */
    private _findTaskInBoard(board: KanbanBoard, taskId: string, columnId?: string): any {
        // If columnId provided, search only that column first
        if (columnId) {
            const result = BoardCrudOperations.findTaskInColumn(board, columnId, taskId);
            if (result) return result.task;
        }

        // Search all columns
        const result = BoardCrudOperations.findTaskById(board, taskId);
        return result?.task ?? null;
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
     * CRITICAL: Normalizes CRLF to LF to ensure consistent line endings
     */
    public async readFromDisk(): Promise<string | null> {

        // Try to get from open document first
        const document = this._fileManager.getDocument();
        if (document && document.uri.fsPath === this._path) {
            const text = document.getText();
            // CRITICAL: Normalize CRLF to LF (Windows line endings to Unix)
            return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        }

        // Read from file system
        try {
            const content = await fs.promises.readFile(this._path, 'utf-8');
            // CRITICAL: Normalize CRLF to LF (Windows line endings to Unix)
            return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        } catch (error) {
            console.error(`[MainKanbanFile] Failed to read file:`, error);
            return null;
        }
    }

    /**
     * Write content to disk using VS Code API
     */
    public async writeToDisk(content: string): Promise<void> {

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

    // ============= VALIDATION =============

    /**
     * Validate kanban markdown content
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
        try {
            // CRITICAL FIX: Pass basePath for resolving relative include paths
            const basePath = path.dirname(this._path);
            const parseResult = this._parser.parseMarkdown(content, basePath, undefined, this._path);
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
        // - Internal state flag is true (from kanban UI edits) - computed from content comparison
        // - OR VSCode document is dirty (from text editor edits)
        // - OR Cached board exists (UI edits not yet written to file)
        const hasMainUnsavedChanges = this.hasUnsavedChanges() || documentIsDirty || hasCachedBoardChanges;


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

    // hasAnyUnsavedChanges() and hasConflict() are now implemented in base class MarkdownFile
    // The base class handles VS Code document dirty checks via isDocumentDirtyInVSCode()

    /**
     * Override reload to also parse board
     * OPTIMIZATION: Skip re-parsing if content hasn't actually changed
     */
    public async reload(): Promise<void> {

        // Read and update content WITHOUT emitting events yet
        const content = await this._readFromDiskWithVerification();
        if (content !== null) {

            // CRITICAL OPTIMIZATION: Skip re-parse if content exactly the same
            // This prevents infinite loops and unnecessary board regeneration
            if (content === this._baseline) {
                this._hasFileSystemChanges = false;
                this._lastModified = await this._getFileModifiedTime();
                return;
            }

            // Content actually changed - proceed with full reload

            this._content = content;
            this._baseline = content;
            // NOTE: No need to set _hasUnsavedChanges - it's now computed from (_content !== _baseline)
            this._hasFileSystemChanges = false;
            this._lastModified = await this._getFileModifiedTime();

            // CRITICAL: Re-parse board BEFORE emitting event
            // This ensures event handlers see the updated board
            this.parseToBoard();

            // Now emit the event
            this._emitChange('reloaded');
        } else {
            console.warn(`[MainKanbanFile] ⚠️ Reload failed - null content returned`);
        }
    }

    /**
     * Override save to validate board before saving
     */
    public async save(): Promise<void> {
        // CRITICAL: Use cached board from webview if it exists (current UI state)
        // Otherwise fall back to parsed board
        const boardToSave = this._cachedBoardFromWebview || this._board;


        if (boardToSave) {
            // Regenerate content from board before saving
            const content = this._generateMarkdownFromBoard(boardToSave);
            this._content = content;
        }

        await super.save();

        // CRITICAL: Clear cached board AFTER save completes
        // Note: save() method automatically sets instance-level skipNextReloadDetection flag
        // This prevents the file watcher from triggering unnecessary reloads
        this._cachedBoardFromWebview = undefined;
    }

    /**
     * Override to handle special reload case and clear cached board
     */
    public async showConflictDialog(): Promise<ConflictResolution | null> {
        const hadCachedBoard = !!this._cachedBoardFromWebview;

        const context = this.getConflictContext();
        const resolution = await this._conflictResolver.resolveConflict(context);

        if (resolution && resolution.shouldProceed) {
            // CRITICAL: Check shouldCreateBackup FIRST because backup-and-reload sets both shouldCreateBackup AND shouldReload
            if (resolution.shouldCreateBackup) {
                // Create backup of current content, then reload
                await this.createBackup('conflict');
                await this.reload();
                this._emitChange('conflict');
                this._cachedBoardFromWebview = undefined;
                this._hasFileSystemChanges = false;
            } else if (resolution.shouldSave) {
                // save() method marks itself as legitimate automatically
                await this.save();  // save() already clears cached board
            } else if (resolution.shouldReload && hadCachedBoard) {
                // SPECIAL CASE: If reloading with cached board, force reload from disk
                // Clear cached board FIRST
                this._cachedBoardFromWebview = undefined;
                this._hasFileSystemChanges = false;

                // CRITICAL: Actually read from disk, don't just re-parse old content
                const freshContent = await this.readFromDisk();
                if (freshContent !== null && freshContent !== this._baseline) {
                    // Content changed on disk
                    this._content = freshContent;
                    this._baseline = freshContent;
                    // NOTE: No need to set _hasUnsavedChanges - it's now computed from (_content !== _baseline)
                    this._lastModified = await this._getFileModifiedTime();
                    this.parseToBoard();
                    this._emitChange('reloaded');
                } else if (freshContent !== null) {
                    // Content unchanged, but still re-parse to update UI (discard UI edits)
                    this._content = freshContent;
                    this.parseToBoard();
                    this._emitChange('reloaded');
                }
            } else if (resolution.shouldReload) {
                await this.reload();
            } else if (resolution.shouldIgnore) {
                // CRITICAL: Keep cached board (user wants to keep their UI edits!)
                // Only clear the external change flag for this specific external change
                this._hasFileSystemChanges = false;
                // DO NOT clear cached board - user chose to ignore external, keep UI edits
            }
        }


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
}
