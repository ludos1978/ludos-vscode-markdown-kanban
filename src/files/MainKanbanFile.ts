import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownFile } from './MarkdownFile';
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
    private _parser: typeof MarkdownKanbanParser;

    constructor(
        filePath: string,
        fileManager: FileManager,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager
    ) {
        super(filePath, filePath, conflictResolver, backupManager);
        this._fileManager = fileManager;
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
        console.log(`[MainKanbanFile] Handling external change: ${changeType} - ${this._relativePath}`);

        if (changeType === 'deleted') {
            this._exists = false;
            console.warn(`[MainKanbanFile] Main file was deleted: ${this._path}`);
            return;
        }

        if (changeType === 'created') {
            this._exists = true;
        }

        // Check for conflict FIRST - only clear content if auto-reloading
        if (this.hasConflict()) {
            console.log(`[MainKanbanFile] ✋ Conflict detected - showing dialog (keeping current content for potential save)`);
            await this.showConflictDialog();
        } else if (this.needsReload()) {
            console.log(`[MainKanbanFile] ⚠ Auto-reload: Reloading from disk`);
            await this.reload(); // reload() emits 'reloaded' which triggers notification automatically
        } else {
            console.log(`[MainKanbanFile] ⏸ External change detected but neither conflict nor reload needed`);
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
        return {
            type: 'external_main',
            fileType: 'main',
            filePath: this._path,
            fileName: path.basename(this._path),
            hasMainUnsavedChanges: this._hasUnsavedChanges,
            hasIncludeUnsavedChanges: false,
            hasExternalChanges: this._hasFileSystemChanges,
            changedIncludeFiles: [],
            isClosing: false,
            isInEditMode: this._isInEditMode
        };
    }

    // ============= OVERRIDES =============

    /**
     * Override reload to also parse board
     */
    public async reload(): Promise<void> {
        const baselineBeforeReload = this._baseline;
        await super.reload();

        // Only parse if content actually changed (not a false alarm)
        // This prevents generating new column/task IDs on false alarm reloads
        if (this._baseline !== baselineBeforeReload && this._content) {
            this.parseToBoard();
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
     * Generate markdown from board structure
     * (This is a placeholder - actual implementation would use existing generation logic)
     */
    private _generateMarkdownFromBoard(board: KanbanBoard): string {
        // TODO: Use the existing markdown generation logic from KanbanFileService
        // For now, this is a placeholder that maintains the structure

        let markdown = '';

        // Add YAML header if present
        if (this._yamlHeader) {
            markdown += this._yamlHeader + '\n\n';
        }

        // Add board title
        if (board.title) {
            markdown += `# ${board.title}\n\n`;
        }

        // Add columns
        for (const column of board.columns) {
            markdown += `## ${column.title}\n\n`;

            // Add tasks
            for (const task of column.tasks) {
                markdown += `- ${task.title}\n`;
                if (task.description) {
                    // Indent description
                    const indentedDesc = task.description
                        .split('\n')
                        .map(line => `  ${line}`)
                        .join('\n');
                    markdown += indentedDesc + '\n';
                }
                markdown += '\n';
            }
        }

        // Add footer if present
        if (this._kanbanFooter) {
            markdown += '\n' + this._kanbanFooter;
        }

        return markdown;
    }
}
