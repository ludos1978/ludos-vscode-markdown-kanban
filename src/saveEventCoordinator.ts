import * as vscode from 'vscode';

/**
 * Interface for handlers that respond to document save events
 */
export interface SaveEventHandler {
    /**
     * Unique identifier for this handler
     */
    id: string;

    /**
     * Called when a document is saved
     * @param document The document that was saved
     */
    handleSave(document: vscode.TextDocument): Promise<void> | void;

    /**
     * Optional: Check if this handler is currently enabled
     * If returns false, handler will be skipped
     */
    isEnabled?(): boolean;
}

/**
 * Centralized coordinator for all document save events.
 * Replaces multiple individual onDidSaveTextDocument listeners with a single
 * unified system that dispatches to registered handlers.
 *
 * This eliminates duplication where ExternalFileWatcher, KanbanWebviewPanel,
 * and MessageHandler (auto-export) all had separate listeners.
 */
export class SaveEventCoordinator implements vscode.Disposable {
    private static instance: SaveEventCoordinator | undefined;

    private saveListener: vscode.Disposable | null = null;
    private handlers: Map<string, SaveEventHandler> = new Map();

    /**
     * Get or create the singleton instance
     */
    public static getInstance(): SaveEventCoordinator {
        if (!SaveEventCoordinator.instance) {
            SaveEventCoordinator.instance = new SaveEventCoordinator();
        }
        return SaveEventCoordinator.instance;
    }

    private constructor() {
        this.setupSaveListener();
    }

    /**
     * Set up the single onDidSaveTextDocument listener
     */
    private setupSaveListener(): void {
        this.saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
            console.log(`[SaveEventCoordinator] ========== DOCUMENT SAVED ==========`);
            console.log(`[SaveEventCoordinator] File: ${document.uri.fsPath}`);
            console.log(`[SaveEventCoordinator] Registered handlers: ${this.handlers.size}`);

            // Dispatch to all registered handlers
            for (const handler of this.handlers.values()) {
                console.log(`[SaveEventCoordinator] Checking handler '${handler.id}'`);

                // Skip if handler is disabled
                if (handler.isEnabled && !handler.isEnabled()) {
                    console.log(`[SaveEventCoordinator] Handler '${handler.id}' is DISABLED, skipping`);
                    continue;
                }

                try {
                    console.log(`[SaveEventCoordinator] Calling handler '${handler.id}'`);
                    await handler.handleSave(document);
                    console.log(`[SaveEventCoordinator] Handler '${handler.id}' completed successfully`);
                } catch (error) {
                    console.error(`[SaveEventCoordinator] Handler '${handler.id}' failed:`, error);
                    // Continue to other handlers even if one fails
                }
            }

            console.log(`[SaveEventCoordinator] All handlers processed`);
        });
    }

    /**
     * Register a handler to receive save events
     * @param handler The handler to register
     */
    public registerHandler(handler: SaveEventHandler): void {
        if (this.handlers.has(handler.id)) {
            console.warn(`[SaveEventCoordinator] Handler '${handler.id}' already registered, replacing`);
        }
        this.handlers.set(handler.id, handler);
        console.log(`[SaveEventCoordinator] Registered handler: ${handler.id}`);
    }

    /**
     * Unregister a handler by ID
     * @param id The handler ID to unregister
     */
    public unregisterHandler(id: string): void {
        if (this.handlers.delete(id)) {
            console.log(`[SaveEventCoordinator] Unregistered handler: ${id}`);
        }
    }

    /**
     * Get count of registered handlers
     */
    public getHandlerCount(): number {
        return this.handlers.size;
    }

    /**
     * Get list of registered handler IDs
     */
    public getHandlerIds(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Dispose the coordinator and clean up
     */
    public dispose(): void {
        if (this.saveListener) {
            this.saveListener.dispose();
            this.saveListener = null;
        }
        this.handlers.clear();

        // Clear singleton instance
        if (SaveEventCoordinator.instance === this) {
            SaveEventCoordinator.instance = undefined;
        }
    }
}
