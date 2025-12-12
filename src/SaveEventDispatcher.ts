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
 * SaveEventDispatcher - Centralized dispatcher for VS Code document save events
 *
 * Replaces multiple individual onDidSaveTextDocument listeners with a single
 * unified system that dispatches to registered handlers.
 *
 * This eliminates duplication where ExternalFileWatcher, KanbanWebviewPanel,
 * and MessageHandler (auto-export) all had separate listeners.
 *
 * NOTE: This handles VS Code SAVE EVENTS (onDidSaveTextDocument).
 * For actual file save operations, see FileSaveService in core/FileSaveService.ts
 */
export class SaveEventDispatcher implements vscode.Disposable {
    private static instance: SaveEventDispatcher | undefined;

    private saveListener: vscode.Disposable | null = null;
    private handlers: Map<string, SaveEventHandler> = new Map();

    /**
     * Get or create the singleton instance
     */
    public static getInstance(): SaveEventDispatcher {
        if (!SaveEventDispatcher.instance) {
            SaveEventDispatcher.instance = new SaveEventDispatcher();
        }
        return SaveEventDispatcher.instance;
    }

    private constructor() {
        this.setupSaveListener();
    }

    /**
     * Set up the single onDidSaveTextDocument listener
     */
    private setupSaveListener(): void {
        this.saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {

            // Dispatch to all registered handlers
            for (const handler of this.handlers.values()) {

                // Skip if handler is disabled
                if (handler.isEnabled && !handler.isEnabled()) {
                    continue;
                }

                try {
                    await handler.handleSave(document);
                } catch (error) {
                    console.error(`[SaveEventDispatcher] Handler '${handler.id}' failed:`, error);
                    // Continue to other handlers even if one fails
                }
            }

        });
    }

    /**
     * Register a handler to receive save events
     * @param handler The handler to register
     */
    public registerHandler(handler: SaveEventHandler): void {
        if (this.handlers.has(handler.id)) {
            console.warn(`[SaveEventDispatcher] Handler '${handler.id}' already registered, replacing`);
        }
        this.handlers.set(handler.id, handler);
    }

    /**
     * Unregister a handler by ID
     * @param id The handler ID to unregister
     */
    public unregisterHandler(id: string): void {
        if (this.handlers.delete(id)) {
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
     * Dispose the dispatcher and clean up
     */
    public dispose(): void {
        if (this.saveListener) {
            this.saveListener.dispose();
            this.saveListener = null;
        }
        this.handlers.clear();

        // Clear singleton instance
        if (SaveEventDispatcher.instance === this) {
            SaveEventDispatcher.instance = undefined;
        }
    }
}
