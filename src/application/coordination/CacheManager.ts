import { ICacheManager, CacheSubscriber, CacheEvent } from '../../core/interfaces/ICacheManager';
import { IEventBus } from '../../core/interfaces/IEventBus';
import { KanbanBoard } from '../../domain/models/KanbanBoard';

/**
 * Cache Manager Implementation
 *
 * Manages the single source of truth for board state.
 * Ensures frontend and backend cache synchronization.
 */
export class CacheManager implements ICacheManager {
    private board: KanbanBoard | null = null;
    private version: number = 0;
    private lastSync: Date | null = null;
    private subscribers: CacheSubscriber[] = [];

    constructor(private eventBus: IEventBus) {}

    getBoard(): KanbanBoard | null {
        return this.board;
    }

    setBoard(board: KanbanBoard): void {
        console.log(`[CacheManager] Setting board: ${board.id}, version: ${this.version + 1}`);

        // Deep clone to prevent external mutations
        this.board = board.clone();
        this.version++;
        this.lastSync = new Date();

        // Notify subscribers
        this.notifySubscribers({
            type: 'board-updated',
            board: this.board,
            version: this.version,
            timestamp: this.lastSync
        });

        // Sync to frontend
        this.syncToFrontend();
    }

    invalidateBoard(): void {
        console.log(`[CacheManager] Invalidating board cache, version: ${this.version + 1}`);

        this.board = null;
        this.version++;
        this.lastSync = new Date();

        this.notifySubscribers({
            type: 'board-invalidated',
            version: this.version,
            timestamp: this.lastSync
        });
    }

    async syncToFrontend(): Promise<void> {
        if (!this.board) {
            console.log('[CacheManager] No board to sync to frontend');
            return;
        }

        console.log(`[CacheManager] Syncing board to frontend, version: ${this.version}`);

        // This would send message to webview
        // For now, just log
        console.log(`[CacheManager] Would send board update to frontend: ${this.board.id}`);
    }

    subscribe(subscriber: CacheSubscriber): () => void {
        console.log('[CacheManager] Adding subscriber');
        this.subscribers.push(subscriber);

        return () => {
            const index = this.subscribers.indexOf(subscriber);
            if (index >= 0) {
                this.subscribers.splice(index, 1);
                console.log('[CacheManager] Removed subscriber');
            }
        };
    }

    private notifySubscribers(event: CacheEvent): void {
        console.log(`[CacheManager] Notifying ${this.subscribers.length} subscribers`);

        // Notify subscribers asynchronously to prevent blocking
        this.subscribers.forEach(subscriber => {
            try {
                setTimeout(() => subscriber(event), 0);
            } catch (error) {
                console.error('[CacheManager] Error notifying subscriber:', error);
            }
        });
    }

    /**
     * Get cache statistics for debugging
     */
    getStats(): {
        hasBoard: boolean;
        version: number;
        lastSync: Date | null;
        subscriberCount: number;
        boardInfo?: {
            id: string;
            title: string;
            columnCount: number;
            taskCount: number;
        };
    } {
        const stats = {
            hasBoard: this.board !== null,
            version: this.version,
            lastSync: this.lastSync,
            subscriberCount: this.subscribers.length
        };

        if (this.board) {
            stats.boardInfo = {
                id: this.board.id,
                title: this.board.title,
                columnCount: this.board.columns.length,
                taskCount: this.board.getAllTasks().length
            };
        }

        return stats;
    }

    /**
     * Clear all subscribers (useful for testing)
     */
    clearSubscribers(): void {
        this.subscribers = [];
    }

    /**
     * Force sync to frontend (useful for recovery)
     */
    async forceSyncToFrontend(): Promise<void> {
        console.log('[CacheManager] Force syncing to frontend');
        await this.syncToFrontend();
    }
}