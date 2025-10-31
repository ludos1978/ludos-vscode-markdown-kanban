import { KanbanBoard } from '../../domain/models/KanbanBoard';

/**
 * Save Manager Interface
 *
 * Defines the contract for managing board save operations.
 * Ensures thread-safe, queue-based saving without race conditions.
 */
export interface ISaveManager {
    /**
     * Save a board to persistent storage
     * @param board The board to save
     * @param options Save options
     * @returns Promise that resolves when save is complete
     */
    saveBoard(board: KanbanBoard, options?: SaveOptions): Promise<void>;

    /**
     * Get current save status
     * @returns Current save operation status
     */
    getSaveStatus(): SaveStatus;

    /**
     * Cancel current save operation
     */
    cancelSave(): void;

    /**
     * Subscribe to save events
     * @param subscriber Callback function for save events
     * @returns Unsubscribe function
     */
    subscribe(subscriber: SaveSubscriber): () => void;
}

/**
 * Save options
 */
export interface SaveOptions {
    createBackup?: boolean;
    force?: boolean;
    includeIncludes?: boolean;
    [key: string]: any;
}

/**
 * Save status information
 */
export interface SaveStatus {
    isProcessing: boolean;
    queueLength: number;
    currentOperation?: SaveOperation;
    lastError?: Error;
}

/**
 * Save operation information
 */
export interface SaveOperation {
    id: string;
    board: KanbanBoard;
    options: SaveOptions;
    timestamp: Date;
    status: 'queued' | 'processing' | 'completed' | 'failed';
}

/**
 * Save subscriber callback type
 */
export type SaveSubscriber = (event: SaveEvent) => void;

/**
 * Save event types
 */
export type SaveEvent =
    | { type: 'save-started'; operation: SaveOperation }
    | { type: 'save-completed'; operation: SaveOperation }
    | { type: 'save-failed'; operation: SaveOperation; error: Error }
    | { type: 'save-cancelled'; operation: SaveOperation };