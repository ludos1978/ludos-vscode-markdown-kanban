import { MarkdownFile } from '../../files/MarkdownFile';

/**
 * Decorator Pattern - File Operation Decorators
 *
 * Adds cross-cutting concerns to file operations without modifying core logic.
 */

export interface IFileOperation {
    execute(): Promise<void>;
}

export abstract class FileOperationDecorator implements IFileOperation {
    constructor(protected operation: IFileOperation) {}

    abstract execute(): Promise<void>;
}

/**
 * Logging Decorator
 */
export class LoggingDecorator extends FileOperationDecorator {
    constructor(
        operation: IFileOperation,
        private operationName: string,
        private file?: MarkdownFile
    ) {
        super(operation);
    }

    async execute(): Promise<void> {
        const startTime = Date.now();
        const fileInfo = this.file ? ` (${this.file.getRelativePath()})` : '';


        try {
            await this.operation.execute();
            const duration = Date.now() - startTime;
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[FileOp] Failed ${this.operationName}${fileInfo} after ${duration}ms:`, error);
            throw error;
        }
    }
}

/**
 * Validation Decorator
 */
export class ValidationDecorator extends FileOperationDecorator {
    constructor(
        operation: IFileOperation,
        private validator: (data?: any) => Promise<boolean>,
        private data?: any
    ) {
        super(operation);
    }

    async execute(): Promise<void> {
        // Pre-operation validation
        const isValid = await this.validator(this.data);
        if (!isValid) {
            throw new Error('Pre-operation validation failed');
        }

        await this.operation.execute();

        // Post-operation validation could be added here
    }
}

/**
 * Backup Decorator
 */
export class BackupDecorator extends FileOperationDecorator {
    constructor(
        operation: IFileOperation,
        private file: MarkdownFile,
        private backupLabel: string = 'auto'
    ) {
        super(operation);
    }

    async execute(): Promise<void> {
        // Create backup before operation
        try {
            await this.file.createBackup(this.backupLabel);
        } catch (error) {
            console.warn(`[BackupDecorator] Failed to create backup:`, error);
            // Continue with operation even if backup fails
        }

        await this.operation.execute();
    }
}

/**
 * Retry Decorator
 */
export class RetryDecorator extends FileOperationDecorator {
    constructor(
        operation: IFileOperation,
        private maxRetries: number = 3,
        private delayMs: number = 1000
    ) {
        super(operation);
    }

    async execute(): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                await this.operation.execute();
                return; // Success
            } catch (error) {
                lastError = error as Error;
                console.warn(`[RetryDecorator] Attempt ${attempt}/${this.maxRetries} failed:`, error);

                if (attempt < this.maxRetries) {
                    await this.delay(this.delayMs * attempt); // Exponential backoff
                }
            }
        }

        throw new Error(`Operation failed after ${this.maxRetries} attempts. Last error: ${lastError?.message}`);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Transaction Decorator
 */
export class TransactionDecorator extends FileOperationDecorator {
    constructor(
        operation: IFileOperation,
        private files: MarkdownFile[]
    ) {
        super(operation);
    }

    async execute(): Promise<void> {
        // Create snapshots of all files
        const snapshots = await this.createSnapshots();

        try {
            await this.operation.execute();
        } catch (error) {
            // Rollback on failure
            await this.rollbackSnapshots(snapshots);
            throw error;
        }
    }

    private async createSnapshots(): Promise<Map<MarkdownFile, string>> {
        const snapshots = new Map<MarkdownFile, string>();

        for (const file of this.files) {
            try {
                const content = file.getContent();
                snapshots.set(file, content);
            } catch (error) {
                console.warn(`[TransactionDecorator] Failed to create snapshot for ${file.getRelativePath()}:`, error);
            }
        }

        return snapshots;
    }

    private async rollbackSnapshots(snapshots: Map<MarkdownFile, string>): Promise<void> {

        for (const [file, content] of snapshots) {
            try {
                file.setContent(content, true); // Update baseline
            } catch (error) {
                console.error(`[TransactionDecorator] Failed to rollback ${file.getRelativePath()}:`, error);
            }
        }
    }
}

/**
 * File Operation Factory
 */
export class FileOperationFactory {
    static createSaveOperation(file: MarkdownFile): IFileOperation {
        return new LoggingDecorator(
            new ValidationDecorator(
                new BackupDecorator(
                    new BasicSaveOperation(file),
                    file,
                    'pre-save'
                ),
                async () => {
                    const validation = file.validate(file.getContent());
                    return validation.valid;
                }
            ),
            'save',
            file
        );
    }

    static createLoadOperation(file: MarkdownFile): IFileOperation {
        return new LoggingDecorator(
            new RetryDecorator(
                new BasicLoadOperation(file),
                2, // Max 2 retries
                500 // 500ms delay
            ),
            'load',
            file
        );
    }

    static createBatchSaveOperation(files: MarkdownFile[]): IFileOperation {
        return new LoggingDecorator(
            new TransactionDecorator(
                new BatchSaveOperation(files),
                files
            ),
            `batch-save-${files.length}-files`
        );
    }
}

/**
 * Basic Operation Implementations
 */
class BasicSaveOperation implements IFileOperation {
    constructor(private file: MarkdownFile) {}

    async execute(): Promise<void> {
        await this.file.save();
    }
}

class BasicLoadOperation implements IFileOperation {
    constructor(private file: MarkdownFile) {}

    async execute(): Promise<void> {
        await this.file.reload();
    }
}

class BatchSaveOperation implements IFileOperation {
    constructor(private files: MarkdownFile[]) {}

    async execute(): Promise<void> {
        await Promise.all(this.files.map(file => file.save()));
    }
}
