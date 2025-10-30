import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
import { MarkdownFileRegistry } from './MarkdownFileRegistry';
import { KanbanBoard, MarkdownKanbanParser } from '../markdownParser';
import { ConflictResolver, ConflictContext } from '../conflictResolver';
import { BackupManager } from '../backupManager';
import { FileManager } from '../fileManager';

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
     * Handle external file change (file changed on disk)
     */
    public async handleExternalChange(changeType: 'modified' | 'deleted' | 'created'): Promise<void> {
        console.log(`[MainKanbanFile.handleExternalChange] TRIGGERED:`, {
            changeType,
            file: this._relativePath,
            hasUnsaved: this._hasUnsavedChanges,
            hasFileSystemChanges: this._hasFileSystemChanges,
            isInEditMode: this._isInEditMode
        });

        if (changeType === 'deleted') {
            this._exists = false;
            console.warn(`[MainKanbanFile.handleExternalChange] FILE-DELETED: ${this._path}`);
            return;
        }

        if (changeType === 'created') {
            this._exists = true;
        }

        // Check for conflict FIRST - only clear content if auto-reloading
        const hasConflict = this.hasConflict();
        const needsReload = this.needsReload();

        console.log(`[MainKanbanFile.handleExternalChange] DECISION-FACTORS:`, {
            hasConflict,
            needsReload,
            hasUnsaved: this._hasUnsavedChanges,
            isInEditMode: this._isInEditMode
        });

        if (hasConflict) {
            console.log(`[MainKanbanFile.handleExternalChange] CONFLICT-DIALOG: Showing dialog to user (keeping current content for potential save)`);
            await this.showConflictDialog();
        } else if (needsReload) {
            console.log(`[MainKanbanFile.handleExternalChange] AUTO-RELOAD: Reloading from disk (no conflict detected)`);
            await this.reload(); // reload() emits 'reloaded' which triggers notification automatically
        } else {
            console.log(`[MainKanbanFile.handleExternalChange] NO-ACTION: External change detected but neither conflict nor reload needed`);
        }
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

        // Main has unsaved changes if either:
        // - Internal state flag is true (from kanban UI edits)
        // - OR VSCode document is dirty (from text editor edits)
        const hasMainUnsavedChanges = this._hasUnsavedChanges || documentIsDirty;

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
     */
    public async reload(): Promise<void> {
        console.log(`[MainKanbanFile] Starting reload override`);
        const baselineBeforeReload = this._baseline;

        // Read and update content WITHOUT emitting events yet
        const content = await this._readFromDiskWithVerification();
        if (content !== null) {
            // Check if content actually changed
            if (content !== this._baseline) {
                console.log(`[MainKanbanFile] Content changed, updating and re-parsing board`);
                this._content = content;
                this._baseline = content;
                this._hasUnsavedChanges = false;
                this._hasFileSystemChanges = false;
                this._lastModified = await this._getFileModifiedTime();

                // CRITICAL: Re-parse board BEFORE emitting event
                // This ensures event handlers see the updated board
                this.parseToBoard();

                // Now emit the event
                this._emitChange('reloaded');
                console.log(`[MainKanbanFile] Reloaded successfully with updated board: ${this._relativePath}`);
            } else {
                // Content unchanged - false alarm from watcher
                console.log(`[MainKanbanFile] Content unchanged - false alarm from watcher, keeping existing content`);
                this._hasFileSystemChanges = false;
                this._lastModified = await this._getFileModifiedTime();
            }
        } else {
            console.warn(`[MainKanbanFile] ⚠ Reload failed - null returned`);
        }
    }

    /**
     * Override save to validate board before saving
     */
    public async save(): Promise<void> {
        // Ensure we have a valid board
        if (this._board) {
            // Regenerate content from board before saving
            const content = this._generateMarkdownFromBoard(this._board);
            this._content = content;
        }

        await super.save();
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
