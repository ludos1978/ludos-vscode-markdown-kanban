/**
 * HandlerRegistry - Manages lifecycle of event handlers and services
 *
 * Consolidates handler initialization and disposal from KanbanWebviewPanel.
 * This registry:
 * 1. Stores references to all handlers/services
 * 2. Provides typed access to handlers
 * 3. Handles disposal of all handlers in correct order
 *
 * Previously: Handler fields and dispose() logic in KanbanWebviewPanel (~50 lines)
 */

import { BoardSyncHandler } from '../core/events/BoardSyncHandler';
import { FileSyncHandler } from '../core/events/FileSyncHandler';
import { LinkReplacementHandler } from '../core/events/LinkReplacementHandler';
import { BoardInitializationHandler } from '../core/events/BoardInitializationHandler';
import { FileRegistryChangeHandler } from '../core/events/FileRegistryChangeHandler';
import { UnsavedChangesService } from '../services/UnsavedChangesService';
import { WebviewUpdateService } from '../services/WebviewUpdateService';

/**
 * Disposable interface for handlers
 */
interface Disposable {
    dispose(): void;
}

/**
 * Handler types managed by the registry
 */
export interface RegisteredHandlers {
    boardSync: BoardSyncHandler | null;
    fileSync: FileSyncHandler | null;
    linkReplacement: LinkReplacementHandler | null;
    boardInit: BoardInitializationHandler | null;
    fileRegistryChange: FileRegistryChangeHandler | null;
    unsavedChanges: UnsavedChangesService | null;
    webviewUpdate: WebviewUpdateService | null;
}

export class HandlerRegistry {
    private _handlers: RegisteredHandlers = {
        boardSync: null,
        fileSync: null,
        linkReplacement: null,
        boardInit: null,
        fileRegistryChange: null,
        unsavedChanges: null,
        webviewUpdate: null
    };

    /**
     * Register a board sync handler
     */
    public registerBoardSync(handler: BoardSyncHandler): void {
        this._handlers.boardSync = handler;
    }

    /**
     * Register a file sync handler
     */
    public registerFileSync(handler: FileSyncHandler): void {
        this._handlers.fileSync = handler;
    }

    /**
     * Register a link replacement handler
     */
    public registerLinkReplacement(handler: LinkReplacementHandler): void {
        this._handlers.linkReplacement = handler;
    }

    /**
     * Register a board initialization handler
     */
    public registerBoardInit(handler: BoardInitializationHandler): void {
        this._handlers.boardInit = handler;
    }

    /**
     * Register a file registry change handler
     */
    public registerFileRegistryChange(handler: FileRegistryChangeHandler): void {
        this._handlers.fileRegistryChange = handler;
    }

    /**
     * Register an unsaved changes service
     */
    public registerUnsavedChanges(service: UnsavedChangesService): void {
        this._handlers.unsavedChanges = service;
    }

    /**
     * Register a webview update service
     */
    public registerWebviewUpdate(service: WebviewUpdateService): void {
        this._handlers.webviewUpdate = service;
    }

    /**
     * Get the file sync handler
     */
    public getFileSync(): FileSyncHandler | null {
        return this._handlers.fileSync;
    }

    /**
     * Get the unsaved changes service
     */
    public getUnsavedChanges(): UnsavedChangesService | null {
        return this._handlers.unsavedChanges;
    }

    /**
     * Get the webview update service
     */
    public getWebviewUpdate(): WebviewUpdateService | null {
        return this._handlers.webviewUpdate;
    }

    /**
     * Get the board init handler
     */
    public getBoardInit(): BoardInitializationHandler | null {
        return this._handlers.boardInit;
    }

    /**
     * Dispose all registered handlers in reverse order
     */
    public dispose(): void {
        // Dispose in reverse registration order (LIFO)
        const disposables: Array<Disposable | null> = [
            this._handlers.webviewUpdate,
            this._handlers.fileRegistryChange,
            this._handlers.linkReplacement,
            this._handlers.fileSync,
            this._handlers.boardSync
            // Note: unsavedChanges and boardInit don't need disposal
        ];

        for (const handler of disposables) {
            if (handler && typeof handler.dispose === 'function') {
                handler.dispose();
            }
        }

        // Clear all references
        this._handlers = {
            boardSync: null,
            fileSync: null,
            linkReplacement: null,
            boardInit: null,
            fileRegistryChange: null,
            unsavedChanges: null,
            webviewUpdate: null
        };
    }
}
