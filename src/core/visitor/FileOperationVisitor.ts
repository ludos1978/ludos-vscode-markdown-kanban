import { MarkdownFile } from '../../files/MarkdownFile';
import { MainKanbanFile } from '../../files/MainKanbanFile';
import { IncludeFile } from '../../files/IncludeFile';

/**
 * Visitor Pattern - File Operation Visitor
 *
 * Defines operations that can be performed on different file types
 * without modifying the file classes themselves.
 *
 * Uses the unified IncludeFile class with fileType-based dispatch.
 */

export interface IFileVisitor<T = any> {
    visitMainFile(file: MainKanbanFile): Promise<T>;
    visitIncludeFile(file: IncludeFile): Promise<T>;
}

export interface IVisitableFile {
    accept<T>(visitor: IFileVisitor<T>): Promise<T>;
}

/**
 * File Operation Visitors
 */

export class ValidationVisitor implements IFileVisitor<boolean> {
    async visitMainFile(file: MainKanbanFile): Promise<boolean> {

        const validation = file.validate(file.getContent());
        if (!validation.valid) {
            console.error(`[ValidationVisitor] Main file validation failed:`, validation.errors);
            return false;
        }

        // Additional main file validation
        const board = file.getBoard();
        if (!board || !board.valid) {
            console.error(`[ValidationVisitor] Main file has invalid board`);
            return false;
        }

        return true;
    }

    async visitIncludeFile(file: IncludeFile): Promise<boolean> {

        const validation = file.validate(file.getContent());
        if (!validation.valid) {
            console.error(`[ValidationVisitor] Include file validation failed:`, validation.errors);
            return false;
        }

        // Type-specific validation
        const fileType = file.getFileType();
        if (fileType === 'include-column') {
            try {
                const mainFilePath = file.getParentFile()?.getPath();
                const tasks = file.parseToTasks(undefined, undefined, mainFilePath);
                if (tasks.length === 0) {
                    console.warn(`[ValidationVisitor] Column include has no tasks`);
                }
            } catch (error) {
                console.error(`[ValidationVisitor] Column include parsing failed:`, error);
                return false;
            }
        } else if (fileType === 'include-task') {
            const content = file.getTaskDescription();
            if (!content || content.trim().length === 0) {
                console.warn(`[ValidationVisitor] Task include is empty`);
            }
        }

        return true;
    }
}

export class BackupVisitor implements IFileVisitor<void> {
    constructor(private label: string = 'visitor-backup') {}

    async visitMainFile(file: MainKanbanFile): Promise<void> {
        await file.createBackup(this.label);
    }

    async visitIncludeFile(file: IncludeFile): Promise<void> {
        await file.createBackup(this.label);
    }
}

export class ContentAnalysisVisitor implements IFileVisitor<ContentStats> {
    async visitMainFile(file: MainKanbanFile): Promise<ContentStats> {
        const content = file.getContent();
        const board = file.getBoard();

        return {
            fileType: 'main',
            size: content.length,
            lines: content.split('\n').length,
            hasUnsavedChanges: file.hasUnsavedChanges(),
            metadata: {
                columns: board?.columns.length || 0,
                tasks: board?.columns.reduce((total, col) => total + col.tasks.length, 0) || 0,
                includes: file.getIncludedFiles().length
            }
        };
    }

    async visitIncludeFile(file: IncludeFile): Promise<ContentStats> {
        const content = file.getContent();
        const fileType = file.getFileType();

        let metadata: Record<string, any> = {};

        if (fileType === 'include-column') {
            const mainFilePath = file.getParentFile()?.getPath();
            const tasks = file.parseToTasks(undefined, undefined, mainFilePath);
            metadata = {
                tasks: tasks.length,
                columnId: file.getColumnId(),
                columnTitle: file.getColumnTitle()
            };
        } else if (fileType === 'include-task') {
            metadata = {
                taskId: file.getTaskId(),
                taskTitle: file.getTaskTitle(),
                columnId: file.getColumnId()
            };
        }

        return {
            fileType: fileType,
            size: content.length,
            lines: content.split('\n').length,
            hasUnsavedChanges: file.hasUnsavedChanges(),
            metadata
        };
    }
}

export class SaveVisitor implements IFileVisitor<void> {
    async visitMainFile(file: MainKanbanFile): Promise<void> {
        await file.save();
    }

    async visitIncludeFile(file: IncludeFile): Promise<void> {
        await file.save();
    }
}

export class ReloadVisitor implements IFileVisitor<void> {
    async visitMainFile(file: MainKanbanFile): Promise<void> {
        await file.reload();
    }

    async visitIncludeFile(file: IncludeFile): Promise<void> {
        await file.reload();
    }
}

/**
 * Content Statistics Interface
 */
export interface ContentStats {
    fileType: string;
    size: number;
    lines: number;
    hasUnsavedChanges: boolean;
    metadata: Record<string, any>;
}

/**
 * File Operation Manager using Visitor Pattern
 */
export class FileOperationManager {
    private visitors = {
        validate: new ValidationVisitor(),
        backup: new BackupVisitor(),
        analyze: new ContentAnalysisVisitor(),
        save: new SaveVisitor(),
        reload: new ReloadVisitor()
    };

    /**
     * Validate a file
     */
    async validateFile(file: MarkdownFile): Promise<boolean> {
        return await this.acceptVisitor(file, this.visitors.validate);
    }

    /**
     * Create backup of a file
     */
    async backupFile(file: MarkdownFile, label?: string): Promise<void> {
        if (label) {
            const backupVisitor = new BackupVisitor(label);
            await this.acceptVisitor(file, backupVisitor);
        } else {
            await this.acceptVisitor(file, this.visitors.backup);
        }
    }

    /**
     * Analyze file content
     */
    async analyzeFile(file: MarkdownFile): Promise<ContentStats> {
        return await this.acceptVisitor(file, this.visitors.analyze);
    }

    /**
     * Save a file
     */
    async saveFile(file: MarkdownFile): Promise<void> {
        return await this.acceptVisitor(file, this.visitors.save);
    }

    /**
     * Reload a file
     */
    async reloadFile(file: MarkdownFile): Promise<void> {
        return await this.acceptVisitor(file, this.visitors.reload);
    }

    /**
     * Batch operations on multiple files
     */
    async validateFiles(files: MarkdownFile[]): Promise<boolean[]> {
        return await Promise.all(files.map(file => this.validateFile(file)));
    }

    async saveFiles(files: MarkdownFile[]): Promise<void[]> {
        return await Promise.all(files.map(file => this.saveFile(file)));
    }

    async analyzeFiles(files: MarkdownFile[]): Promise<ContentStats[]> {
        return await Promise.all(files.map(file => this.analyzeFile(file)));
    }

    /**
     * Accept visitor for a file (double dispatch)
     */
    private async acceptVisitor<T>(file: MarkdownFile, visitor: IFileVisitor<T>): Promise<T> {
        // Type guard to determine file type and call appropriate visit method
        if (file instanceof MainKanbanFile) {
            return await visitor.visitMainFile(file);
        } else if (file instanceof IncludeFile) {
            return await visitor.visitIncludeFile(file);
        } else {
            throw new Error(`Unknown file type: ${file.constructor.name}`);
        }
    }
}

/**
 * Composite File Operations
 */
export class CompositeFileOperation implements IFileVisitor<void> {
    private operations: IFileVisitor<void>[] = [];

    addOperation(operation: IFileVisitor<void>): void {
        this.operations.push(operation);
    }

    async visitMainFile(file: MainKanbanFile): Promise<void> {
        for (const operation of this.operations) {
            await operation.visitMainFile(file);
        }
    }

    async visitIncludeFile(file: IncludeFile): Promise<void> {
        for (const operation of this.operations) {
            await operation.visitIncludeFile(file);
        }
    }
}
