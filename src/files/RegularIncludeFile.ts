import { IncludeFile } from './IncludeFile';
import { MainKanbanFile } from './MainKanbanFile';
import { ConflictResolver } from '../conflictResolver';
import { BackupManager } from '../backupManager';
import { KanbanBoard, MarkdownKanbanParser } from '../markdownParser';

/**
 * Represents a regular include file (include syntax).
 *
 * Regular includes contain full kanban format markdown that gets merged into the main board.
 *
 * Responsibilities:
 * - Parse kanban format into board structure
 * - Generate kanban format from board structure
 * - Handle board-level validation
 * - Merge with parent board
 */
export class RegularIncludeFile extends IncludeFile {
    // ============= BOARD STATE =============
    private _board?: KanbanBoard;

    constructor(
        relativePath: string,
        parentFile: MainKanbanFile,
        conflictResolver: ConflictResolver,
        backupManager: BackupManager,
        isInline: boolean = false
    ) {
        super(relativePath, parentFile, conflictResolver, backupManager, isInline);
    }

    // ============= FILE TYPE =============

    public getFileType(): 'include-regular' {
        return 'include-regular';
    }

    // ============= BOARD OPERATIONS =============

    /**
     * Get the parsed board (cached)
     */
    public getBoard(): KanbanBoard | undefined {
        return this._board;
    }

    /**
     * Parse content into board structure
     */
    public parseToBoard(): KanbanBoard {
        console.log(`[RegularIncludeFile] Parsing content to board: ${this._relativePath}`);

        const parseResult = MarkdownKanbanParser.parseMarkdown(this._content);
        this._board = parseResult.board;

        return parseResult.board;
    }

    /**
     * Generate markdown from board structure
     */
    public generateFromBoard(board: KanbanBoard): string {
        console.log(`[RegularIncludeFile] Generating markdown from board: ${this._relativePath}`);

        this._board = board;

        // Generate markdown (use same logic as main file)
        let markdown = '';

        if (board.title) {
            markdown += `# ${board.title}\n\n`;
        }

        for (const column of board.columns) {
            markdown += `## ${column.title}\n\n`;

            for (const task of column.tasks) {
                markdown += `- ${task.title}\n`;

                if (task.description) {
                    const indentedDesc = task.description
                        .split('\n')
                        .map(line => `  ${line}`)
                        .join('\n');
                    markdown += indentedDesc + '\n';
                }

                markdown += '\n';
            }
        }

        return markdown;
    }

    /**
     * Update board (regenerate content from board and mark as unsaved)
     */
    public updateBoard(board: KanbanBoard): void {
        const newContent = this.generateFromBoard(board);
        this.setContent(newContent, false);
    }

    // ============= VALIDATION =============

    /**
     * Validate kanban format content
     */
    public validate(content: string): { valid: boolean; errors?: string[] } {
        try {
            const parseResult = MarkdownKanbanParser.parseMarkdown(content);
            const board = parseResult.board;

            if (!board.valid) {
                return {
                    valid: false,
                    errors: ['Invalid kanban markdown format']
                };
            }

            const errors: string[] = [];

            // Validate structure
            if (board.columns.length === 0) {
                errors.push('Include file must have at least one column');
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

    // ============= OVERRIDES =============

    /**
     * Override reload to also parse board
     */
    public async reload(): Promise<void> {
        await super.reload();

        // Parse the loaded content
        if (this._content) {
            this.parseToBoard();
        }
    }
}
