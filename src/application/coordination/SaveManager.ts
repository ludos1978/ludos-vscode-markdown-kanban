import { ISaveManager, SaveOptions, SaveStatus, SaveOperation, SaveSubscriber, SaveEvent } from '../../core/interfaces/ISaveManager';
import { IEventBus } from '../../core/interfaces/IEventBus';
import { KanbanBoard } from '../../domain/models/KanbanBoard';
import { SaveCompletedEvent, SaveFailedEvent } from '../../core/events/DomainEvents';

/**
 * Save Manager Implementation
 *
 * Manages board save operations with queue-based processing.
 * Eliminates race conditions through sequential processing.
 */
export class SaveManager implements ISaveManager {
    private saveQueue: SaveOperation[] = [];
    private isProcessing: boolean = false;
    private currentOperation: SaveOperation | null = null;
    private subscribers: SaveSubscriber[] = [];
    private operationCounter: number = 0;

    constructor(private eventBus: IEventBus) {}

    async saveBoard(board: KanbanBoard, options: SaveOptions = {}): Promise<void> {
        const operation: SaveOperation = {
            id: this.generateOperationId(),
            board: board.clone(), // Deep clone to prevent mutations during save
            options,
            timestamp: new Date(),
            status: 'queued'
        };

        console.log(`[SaveManager] Queuing save operation: ${operation.id}`);

        this.saveQueue.push(operation);
        this.notifySubscribers({
            type: 'save-started',
            operation
        });

        return this.processQueue();
    }

    getSaveStatus(): SaveStatus {
        return {
            isProcessing: this.isProcessing,
            queueLength: this.saveQueue.length,
            currentOperation: this.currentOperation || undefined
        };
    }

    cancelSave(): void {
        console.log('[SaveManager] Cancelling current save operation');

        if (this.currentOperation) {
            this.currentOperation.status = 'failed';
            this.notifySubscribers({
                type: 'save-cancelled',
                operation: this.currentOperation
            });
        }

        // Clear queue
        this.saveQueue.forEach(op => {
            op.status = 'failed';
            this.notifySubscribers({
                type: 'save-cancelled',
                operation: op
            });
        });

        this.saveQueue = [];
        this.currentOperation = null;
        this.isProcessing = false;
    }

    subscribe(subscriber: SaveSubscriber): () => void {
        this.subscribers.push(subscriber);

        return () => {
            const index = this.subscribers.indexOf(subscriber);
            if (index >= 0) {
                this.subscribers.splice(index, 1);
            }
        };
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.saveQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.saveQueue.length > 0) {
            const operation = this.saveQueue.shift()!;
            this.currentOperation = operation;

            operation.status = 'processing';

            try {
                console.log(`[SaveManager] Processing save operation: ${operation.id}`);
                await this.executeSave(operation);

                operation.status = 'completed';
                this.notifySubscribers({
                    type: 'save-completed',
                    operation
                });

                // Publish domain event
                await this.eventBus.publish(new SaveCompletedEvent({
                    board: operation.board,
                    filePath: this.getCurrentFilePath(),
                    duration: Date.now() - operation.timestamp.getTime(),
                    timestamp: new Date()
                }));

            } catch (error) {
                console.error(`[SaveManager] Save operation failed: ${operation.id}`, error);

                operation.status = 'failed';
                this.notifySubscribers({
                    type: 'save-failed',
                    operation,
                    error: error as Error
                });

                // Publish domain event
                await this.eventBus.publish(new SaveFailedEvent({
                    board: operation.board,
                    error: error as Error,
                    timestamp: new Date()
                }));

                // Continue processing other operations even if one fails
            } finally {
                this.currentOperation = null;
            }
        }

        this.isProcessing = false;
    }

    private async executeSave(operation: SaveOperation): Promise<void> {
        const startTime = Date.now();

        try {
            // Validate board before saving
            const validation = operation.board.validate();
            if (!validation.valid) {
                throw new Error(`Board validation failed: ${validation.errors.join(', ')}`);
            }

            // Generate markdown content
            const markdown = this.generateMarkdown(operation.board);

            // Get current document
            const document = await this.getCurrentDocument();
            if (!document) {
                throw new Error('No active document to save to');
            }

            // Pause file watchers to prevent our own save from triggering external change detection
            await this.pauseFileWatchers();

            try {
                // Apply the edit
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    markdown
                );

                const success = await vscode.workspace.applyEdit(edit);
                if (!success) {
                    throw new Error('Failed to apply workspace edit');
                }

                // Save the document
                await document.save();

                const duration = Date.now() - startTime;
                console.log(`[SaveManager] Save completed in ${duration}ms for operation: ${operation.id}`);

            } finally {
                // Always resume file watchers
                await this.resumeFileWatchers();
            }

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[SaveManager] Save failed after ${duration}ms for operation: ${operation.id}`, error);
            throw error;
        }
    }

    private generateMarkdown(board: KanbanBoard): string {
        // This would use the MarkdownParser service
        // For now, return a placeholder
        return `# ${board.title}\n\n<!-- Kanban Board Content -->\n`;
    }

    private async getCurrentDocument(): Promise<vscode.TextDocument | null> {
        // This would integrate with VSCode API
        // For now, return null as placeholder
        return null;
    }

    private getCurrentFilePath(): string {
        // This would get the current file path from VSCode
        // For now, return placeholder
        return 'current-file.md';
    }

    private async pauseFileWatchers(): Promise<void> {
        // This would pause file watchers to prevent self-triggering
        console.log('[SaveManager] Pausing file watchers');
    }

    private async resumeFileWatchers(): Promise<void> {
        // This would resume file watchers
        console.log('[SaveManager] Resuming file watchers');
    }

    private generateOperationId(): string {
        return `save_${++this.operationCounter}_${Date.now()}`;
    }

    private notifySubscribers(event: SaveEvent): void {
        // Notify subscribers asynchronously
        this.subscribers.forEach(subscriber => {
            try {
                setTimeout(() => subscriber(event), 0);
            } catch (error) {
                console.error('[SaveManager] Error notifying subscriber:', error);
            }
        });
    }

    /**
     * Get save statistics for debugging
     */
    getStats(): {
        queueLength: number;
        isProcessing: boolean;
        totalOperations: number;
        subscriberCount: number;
    } {
        return {
            queueLength: this.saveQueue.length,
            isProcessing: this.isProcessing,
            totalOperations: this.operationCounter,
            subscriberCount: this.subscribers.length
        };
    }

    /**
     * Clear all subscribers (useful for testing)
     */
    clearSubscribers(): void {
        this.subscribers = [];
    }
}

// Import vscode at the top level for the implementation
import * as vscode from 'vscode';