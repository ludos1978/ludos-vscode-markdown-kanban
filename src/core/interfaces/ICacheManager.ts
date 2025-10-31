import { KanbanBoard } from '../../domain/models/KanbanBoard';

/**
 * Cache Manager Interface
 *
 * Defines the contract for managing the single source of truth for board state.
 * Ensures consistent caching between frontend and backend.
 */
export interface ICacheManager {
    /**
     * Get the current cached board
     * @returns The cached board or null if not available
     */
    getBoard(): KanbanBoard | null;

    /**
     * Set/update the cached board
     * @param board The board to cache
     */
    setBoard(board: KanbanBoard): void;

    /**
     * Invalidate the current board cache
     * Forces fresh regeneration on next access
     */
    invalidateBoard(): void;

    /**
     * Synchronize cache to frontend
     * Ensures frontend has the latest board state
     */
    syncToFrontend(): Promise<void>;

    /**
     * Subscribe to cache change events
     * @param subscriber Callback function for cache events
     * @returns Unsubscribe function
     */
    subscribe(subscriber: CacheSubscriber): () => void;
}

/**
 * Cache subscriber callback type
 */
export type CacheSubscriber = (event: CacheEvent) => void;

/**
 * Cache event types
 */
export type CacheEvent =
    | { type: 'board-updated'; board: KanbanBoard; version: number; timestamp: Date }
    | { type: 'board-invalidated'; version: number; timestamp: Date };