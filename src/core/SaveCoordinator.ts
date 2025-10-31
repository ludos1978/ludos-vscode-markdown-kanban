import { IStateManager } from './types/ApplicationState';

/**
 * Save Coordinator - Single-Threaded Save Processing
 *
 * Eliminates race conditions in save operations by ensuring only one save
 * operation can run at a time, with proper queuing and state management.
 */

export interface SaveOperation {
    id: string;
    board: any; // KanbanBoard
    options: any; // SaveOptions
    timestamp: Date;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    error?: Error;
}

export interface SaveSubscriber {
    onSaveUpdate(operation: SaveOperation): void;
}

/**
 * Save Coordinator with Single-Threaded Processing
 *
 * Ensures save operations are processed sequentially to prevent race conditions
 * and data corruption from concurrent save attempts.
 */
export class SaveCoordinator {
    private _queue: SaveOperation[] = [];
    private _isProcessing = false;
    private _subscribers: SaveSubscriber[] = [];
    private _operationCounter = 0;

    constructor(private stateManager: IStateManager) {}

    /**
     * Enqueue a save operation
     */
    async enqueueSave(board: any, options?: any): Promise<void> {
        const operation: SaveOperation = {
            id: `save_${++this._operationCounter}_${Date.now()}`,
            board,
            options,
            timestamp: new Date(),
            status: 'queued'
        };

        console.log(`[SaveCoordinator] Enqueuing save operation: ${operation.id}`);
        this._queue.push(operation);

        // Notify subscribers of new operation
        this._notifySubscribers(operation);

        // Start processing if not already running
        await this._processQueue();
    }

    /**
     * Cancel all pending save operations
     */
    cancelAll(): void {
        console.log(`[SaveCoordinator] Cancelling all operations (${this._queue.length} queued)`);

        // Mark all queued operations as failed
        for (const operation of this._queue) {
            if (operation.status === 'queued') {
                operation.status = 'failed';
                operation.error = new Error('Operation cancelled');
                this._notifySubscribers(operation);
            }
        }

        this._queue = [];
    }

    /**
     * Get current save status
     */
    getStatus(): {
        isProcessing: boolean;
        queueLength: number;
        currentOperation: SaveOperation | null;
    } {
        const currentOperation = this._queue.find(op => op.status === 'processing') || null;

        return {
            isProcessing: this._isProcessing,
            queueLength: this._queue.filter(op => op.status === 'queued').length,
            currentOperation
        };
    }

    /**
     * Subscribe to save operation updates
     */
    subscribe(subscriber: SaveSubscriber): () => void {
        this._subscribers.push(subscriber);

        return () => {
            const index = this._subscribers.indexOf(subscriber);
            if (index >= 0) {
                this._subscribers.splice(index, 1);
            }
        };
    }

    /**
     * Process the save queue sequentially
     */
    private async _processQueue(): Promise<void> {
        if (this._isProcessing || this._queue.length === 0) {
            return;
        }

        this._isProcessing = true;
        console.log(`[SaveCoordinator] Starting queue processing (${this._queue.length} operations)`);

        try {
            while (this._queue.length > 0) {
                // Find next queued operation
                const operationIndex = this._queue.findIndex(op => op.status === 'queued');

                if (operationIndex === -1) {
                    // No more queued operations
                    break;
                }

                const operation = this._queue[operationIndex];
                operation.status = 'processing';
                this._notifySubscribers(operation);

                console.log(`[SaveCoordinator] Processing operation: ${operation.id}`);

                try {
                    // Execute the save operation
                    await this._executeSave(operation);

                    operation.status = 'completed';
                    console.log(`[SaveCoordinator] Operation completed: ${operation.id}`);

                } catch (error) {
                    operation.status = 'failed';
                    operation.error = error as Error;
                    console.error(`[SaveCoordinator] Operation failed: ${operation.id}`, error);
                }

                // Notify subscribers of final status
                this._notifySubscribers(operation);

                // Remove completed/failed operations from queue
                this._queue.splice(operationIndex, 1);
            }
        } finally {
            this._isProcessing = false;
            console.log(`[SaveCoordinator] Queue processing complete`);
        }
    }

    /**
     * Execute a single save operation
     */
    private async _executeSave(operation: SaveOperation): Promise<void> {
        const startTime = Date.now();

        try {
            // Update state manager with save in progress
            this.stateManager.update({
                type: 'save-update',
                state: {
                    isProcessing: true,
                    currentOperation: operation,
                    queueLength: this._queue.filter(op => op.status === 'queued').length,
                    lastSaveTime: operation.timestamp
                }
            });

            // Validate board before saving
            if (!operation.board || !operation.board.valid) {
                throw new Error('Invalid board data');
            }

            // Generate markdown content
            const markdown = this._generateMarkdown(operation.board);

            // Get current document (this would be injected in real implementation)
            const document = this._getCurrentDocument();
            if (!document) {
                throw new Error('No active document to save to');
            }

            // Pause file watchers to prevent self-triggering
            await this._pauseFileWatchers();

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
                console.log(`[SaveCoordinator] Save completed in ${duration}ms for operation: ${operation.id}`);

            } finally {
                // Always resume file watchers
                await this._resumeFileWatchers();
            }

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[SaveCoordinator] Save failed after ${duration}ms for operation: ${operation.id}`, error);
            throw error;
        } finally {
            // Update state manager with save completed
            this.stateManager.update({
                type: 'save-update',
                state: {
                    isProcessing: this._isProcessing,
                    currentOperation: null,
                    queueLength: this._queue.filter(op => op.status === 'queued').length,
                    lastSaveTime: new Date()
                }
            });
        }
    }

    /**
     * Generate markdown from board (placeholder - would use real parser)
     */
    private _generateMarkdown(board: any): string {
        // This would use the MarkdownKanbanParser in real implementation
        return `# ${board.title || 'Kanban Board'}\n\n<!-- Board content would go here -->`;
    }

    /**
     * Get current document (placeholder - would be injected)
     */
    private _getCurrentDocument(): any {
        // This would be injected in real implementation
        return null;
    }

    /**
     * Pause file watchers (placeholder)
     */
    private async _pauseFileWatchers(): Promise<void> {
        console.log('[SaveCoordinator] Pausing file watchers');
        // Implementation would pause all file watchers
    }

    /**
     * Resume file watchers (placeholder)
     */
    private async _resumeFileWatchers(): Promise<void> {
        console.log('[SaveCoordinator] Resuming file watchers');
        // Implementation would resume all file watchers
    }

    /**
     * Notify subscribers of operation updates
     */
    private _notifySubscribers(operation: SaveOperation): void {
        this._subscribers.forEach(subscriber => {
            try {
                subscriber.onSaveUpdate(operation);
            } catch (error) {
                console.error('[SaveCoordinator] Error notifying subscriber:', error);
            }
        });
    }

    /**
     * Get save statistics
     */
    getStats(): {
        totalOperations: number;
        queueLength: number;
        isProcessing: boolean;
        subscriberCount: number;
    } {
        return {
            totalOperations: this._operationCounter,
            queueLength: this._queue.length,
            isProcessing: this._isProcessing,
            subscriberCount: this._subscribers.length
        };
    }
}

// Import vscode for the implementation
import * as vscode from 'vscode';
