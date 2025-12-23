/**
 * WebviewUpdateService - Handles all webview update operations
 *
 * Extracts webview update logic from KanbanWebviewPanel to reduce God class size.
 * This service:
 * 1. Sends board updates to webview
 * 2. Sends configuration updates (shortcuts, settings)
 * 3. Syncs dirty items (columns/tasks that need re-render)
 * 4. Listens to 'webview:update-requested' events
 *
 * Previously: Parts of KanbanWebviewPanel.sendBoardUpdate(), _sendBoardUpdate(),
 *             _refreshAllViewConfiguration(), _sendShortcutsToWebview(), syncDirtyItems()
 */

import { KanbanBoard } from '../markdownParser';
import { BoardStore } from '../core/stores';
import { WebviewBridge } from '../core/bridge';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import { PanelContext } from '../panel/PanelContext';
import { WebviewManager } from '../panel/WebviewManager';
import { configService } from './ConfigurationService';
import { KeybindingService } from './KeybindingService';
import { findColumn, findTaskById } from '../actions/helpers';
import { eventBus, createEvent, WebviewUpdateRequestedEvent } from '../core/events';
import {
    BoardUpdateMessage,
    UpdateIncludeContentMessage,
    SyncDirtyItemsMessage,
    SyncDirtyColumnInfo,
    SyncDirtyTaskInfo,
    UpdateShortcutsMessage,
    ConfigurationUpdateMessage
} from '../core/bridge/MessageTypes';

/**
 * Dependencies required by WebviewUpdateService
 */
export interface WebviewUpdateDependencies {
    boardStore: BoardStore;
    webviewBridge: WebviewBridge;
    fileRegistry: MarkdownFileRegistry;
    webviewManager: WebviewManager;
    panelContext: PanelContext;
    getBoard: () => KanbanBoard | undefined;
    hasPanel: () => boolean;
}

/**
 * Options for board update
 */
export interface BoardUpdateOptions {
    applyDefaultFolding?: boolean;
    isFullRefresh?: boolean;
}

export class WebviewUpdateService {
    private _deps: WebviewUpdateDependencies;
    private _unsubscribe: (() => void) | null = null;

    constructor(deps: WebviewUpdateDependencies) {
        this._deps = deps;
        this._subscribe();
    }

    /**
     * Subscribe to webview update events
     */
    private _subscribe(): void {
        this._unsubscribe = eventBus.on('webview:update-requested', async (event: WebviewUpdateRequestedEvent) => {
            await this.sendBoardUpdate(event.data);
        });
    }

    /**
     * Send board update to webview
     * Main entry point for updating the webview with board state
     */
    public async sendBoardUpdate(options: BoardUpdateOptions = {}): Promise<void> {
        const { applyDefaultFolding = false, isFullRefresh = false } = options;

        if (!this._deps.hasPanel()) {
            return;
        }

        // Queue update if webview not ready yet
        if (!this._deps.panelContext.webviewReady) {
            this._deps.panelContext.setPendingBoardUpdate({ applyDefaultFolding, isFullRefresh });
            return;
        }

        let board = this._deps.getBoard() || {
            valid: false,
            title: 'Please open a Markdown Kanban file',
            columns: [],
            yamlHeader: null,
            kanbanFooter: null
        };

        // Update webview permissions to include asset directories
        this._deps.webviewManager.updatePermissionsForAssets();

        // Get version from package.json
        const packageJson = require('../../package.json');
        const version = packageJson.version || 'Unknown';

        // Send board update message
        this._sendBoardUpdateMessage(board, {
            isFullRefresh,
            applyDefaultFolding,
            version
        });

        // Refresh configuration after sending board
        await this.refreshAllConfiguration();

        // Send include file contents
        this._sendIncludeFileContents();
    }

    /**
     * Send the board update message to webview
     */
    private _sendBoardUpdateMessage(board: KanbanBoard, options: {
        isFullRefresh?: boolean;
        applyDefaultFolding?: boolean;
        version?: string;
    } = {}): void {
        if (!this._deps.hasPanel()) return;

        // Use centralized getBoardViewConfig() - single source of truth
        const layoutPresets = this._deps.webviewManager.getLayoutPresetsConfiguration();
        const viewConfig = configService.getBoardViewConfig(layoutPresets);

        // BoardUpdateMessage type matches getBoardViewConfig() output
        const message = {
            type: 'boardUpdate' as const,
            board: board,
            ...(viewConfig as Partial<BoardUpdateMessage>),
            // Optional fields for full board loads
            ...(options.isFullRefresh !== undefined && { isFullRefresh: options.isFullRefresh }),
            ...(options.applyDefaultFolding !== undefined && { applyDefaultFolding: options.applyDefaultFolding }),
            ...(options.version && { version: options.version })
        } as BoardUpdateMessage;

        this._deps.webviewBridge.send(message);
    }

    /**
     * Send include file contents to webview
     */
    private _sendIncludeFileContents(): void {
        const includeFiles = this._deps.fileRegistry.getIncludeFiles();
        if (includeFiles.length > 0) {
            for (const file of includeFiles) {
                const message: UpdateIncludeContentMessage = {
                    type: 'updateIncludeContent',
                    filePath: file.getRelativePath(),
                    content: file.getContent()
                };
                this._deps.webviewBridge.sendBatched(message);
            }
        }
    }

    /**
     * Refresh all view configuration (shortcuts, settings)
     */
    public async refreshAllConfiguration(): Promise<void> {
        if (!this._deps.hasPanel()) {
            console.warn('[WebviewUpdateService] Cannot refresh configuration - panel is null');
            return;
        }

        try {
            // 1. Load keyboard shortcuts
            await this._sendShortcutsToWebview();

            // 2. Load all workspace settings and send to webview
            const layoutPresets = this._deps.webviewManager.getLayoutPresetsConfiguration();
            const config = configService.getBoardViewConfig(layoutPresets);

            // Send configuration to webview
            const configMessage: ConfigurationUpdateMessage = {
                type: 'configurationUpdate',
                config: config
            };
            this._deps.webviewBridge.send(configMessage);

        } catch (error) {
            console.error('[WebviewUpdateService] Failed to refresh view configuration:', error);
        }
    }

    /**
     * Send keyboard shortcuts to webview
     */
    private async _sendShortcutsToWebview(): Promise<void> {
        if (!this._deps.hasPanel()) return;

        try {
            const shortcuts = await KeybindingService.getInstance().getAllShortcuts();
            const shortcutsMessage: UpdateShortcutsMessage = {
                type: 'updateShortcuts',
                shortcuts: shortcuts
            };
            this._deps.webviewBridge.send(shortcutsMessage);
        } catch (error) {
            console.error('[WebviewUpdateService] Failed to send shortcuts to webview:', error);
        }
    }

    /**
     * Sync dirty items (columns/tasks that need re-render)
     */
    public syncDirtyItems(): void {
        // Don't sync during include switches - state machine sends correct updates
        if (this._deps.panelContext.includeSwitchInProgress) {
            return;
        }

        const board = this._deps.getBoard();
        if (!board || !this._deps.hasPanel()) return;

        if (!this._deps.boardStore.hasDirtyItems()) {
            return; // Nothing to sync
        }

        // Get dirty items from BoardStore
        const dirtyColumnIds = this._deps.boardStore.getDirtyColumns();
        const dirtyTaskIds = this._deps.boardStore.getDirtyTasks();

        // Collect dirty columns
        const dirtyColumns: SyncDirtyColumnInfo[] = [];
        for (const columnId of dirtyColumnIds) {
            const column = findColumn(board, columnId);
            if (column) {
                dirtyColumns.push({
                    columnId: column.id,
                    title: column.title,
                    displayTitle: column.displayTitle,
                    includeMode: column.includeMode,
                    includeFiles: column.includeFiles
                });
            }
        }

        // Collect dirty tasks
        const dirtyTasks: SyncDirtyTaskInfo[] = [];
        for (const taskId of dirtyTaskIds) {
            const result = findTaskById(board, taskId);
            if (result) {
                dirtyTasks.push({
                    columnId: result.column.id,
                    taskId: result.task.id,
                    displayTitle: result.task.displayTitle,
                    description: result.task.description
                });
            }
        }

        // Send single batched message
        const syncMessage: SyncDirtyItemsMessage = {
            type: 'syncDirtyItems',
            columns: dirtyColumns,
            tasks: dirtyTasks
        };
        this._deps.webviewBridge.send(syncMessage);

        this._deps.boardStore.clearAllDirty();
    }

    /**
     * Dispose service and unsubscribe from events
     */
    public dispose(): void {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
    }
}
