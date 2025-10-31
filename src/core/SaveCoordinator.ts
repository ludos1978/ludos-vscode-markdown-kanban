import { IEventBus } from './interfaces/IEventBus';
import { SaveOperation } from './types/SaveTypes';
import { SaveCompletedEvent, SaveFailedEvent } from './events/DomainEvents';

/**
 * Save Coordinator - Mediator Pattern Implementation
 *
 * Coordinates save operations between multiple components.
 * Ensures proper sequencing and conflict resolution.
 */
export class SaveCoordinator {
    private saveQueue: SaveOperation[] = [];
    private isProcessing: boolean = false;
    private currentOperation: SaveOperation | null = null;

    constructor(private eventBus: IEventBus) {}

    /**
     * Enqueue save operation with conflict resolution
     */
    async enqueueSave(operation: () => Promise<void>): Promise<void> {
        const saveOp: SaveOperation = {
            id: `save_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            operation,
            timestamp: new Date(),
            priority: 'normal'
        };

        this.saveQueue.push(saveOp);

        // Sort by priority (high first)
        this.saveQueue.sort((a, b) => {
            const priorityOrder: Record<string, number> = { high: 3, normal: 2, low: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        });

        return this.processQueue();
    }

    /**
     * Process save queue sequentially
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.saveQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.saveQueue.length > 0) {
            const operation = this.saveQueue.shift()!;
            this.currentOperation = operation;

            try {
                console.log(`[SaveCoordinator] Processing save operation: ${operation.id}`);
                await operation.operation();

                // Publish success event
                const event = new SaveCompletedEvent({
                    board: null, // Will be filled by actual save operation
                    filePath: '',
                    duration: Date.now() - operation.timestamp.getTime(),
                    timestamp: new Date()
                });
                await this.eventBus.publish(event);

            } catch (error) {
                console.error(`[SaveCoordinator] Save operation failed: ${operation.id}`, error);

                // Publish failure event
                const event = new SaveFailedEvent({
                    board: null, // Will be filled by actual save operation
                    error: error as Error,
                    timestamp: new Date()
                });
                await this.eventBus.publish(event);

                // Continue processing other operations
            } finally {
                this.currentOperation = null;
            }
        }

        this.isProcessing = false;
    }

    /**
     * Cancel current operation
     */
    cancelCurrent(): void {
        if (this.currentOperation) {
            console.log(`[SaveCoordinator] Cancelling operation: ${this.currentOperation.id}`);
            this.currentOperation = null;
        }
    }

    /**
     * Get queue status
     */
    getStatus(): {
        isProcessing: boolean;
        queueLength: number;
        currentOperationId: string | null;
    } {
        return {
            isProcessing: this.isProcessing,
            queueLength: this.saveQueue.length,
            currentOperationId: this.currentOperation?.id || null
        };
    }
}
