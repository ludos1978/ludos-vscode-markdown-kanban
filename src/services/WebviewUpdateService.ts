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
import * as vscode from 'vscode';
import { BoardStore } from '../core/stores';
import { WebviewBridge } from '../core/bridge';
import { MarkdownFileRegistry } from '../files/MarkdownFileRegistry';
import { PanelContext } from '../panel/PanelContext';
import { WebviewManager } from '../panel/WebviewManager';
import { configService } from './ConfigurationService';
import { getDocumentPreference } from '../utils/documentPreference';
import { KeybindingService } from './KeybindingService';
import { findColumn, findTaskById } from '../actions/helpers';
import { eventBus, WebviewUpdateRequestedEvent } from '../core/events';
import { logger } from '../utils/logger';
import {
    BoardUpdateMessage,
    UpdateIncludeContentMessage,
    SyncDirtyItemsMessage,
    SyncDirtyColumnInfo,
    SyncDirtyTaskInfo,
    UpdateShortcutsMessage,
    ConfigurationUpdateMessage
} from '../core/bridge/MessageTypes';
import { BoardContentScanner } from './BoardContentScanner';
import * as path from 'path';

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
    extensionContext: vscode.ExtensionContext;
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
     * Subscribe to webview update events on the panel's scoped event bus.
     * This ensures update events from other panels don't trigger this handler.
     */
    private _subscribe(): void {
        const scopedBus = this._deps.panelContext.scopedEventBus;
        this._unsubscribe = scopedBus.on<BoardUpdateOptions>('webview:update-requested', async (data) => {
            await this.sendBoardUpdate(data);
        });
    }

    /**
     * Send board update to webview
     * Main entry point for updating the webview with board state
     */
    public async sendBoardUpdate(options: BoardUpdateOptions = {}): Promise<void> {
        const { applyDefaultFolding = false, isFullRefresh = false } = options;
        const stack = new Error().stack?.split('\n').slice(1, 8).join('\n') || 'no stack';
        logger.debug('[WebviewUpdateService.sendBoardUpdate] CALLER STACK:\n' + stack);
        logger.debug('[WebviewUpdateService.sendBoardUpdate] START - webviewReady:', this._deps.panelContext.webviewReady, 'hasPanel:', this._deps.hasPanel(), 'isFullRefresh:', isFullRefresh, 'applyDefaultFolding:', applyDefaultFolding);

        if (!this._deps.hasPanel()) {
            logger.debug('[WebviewUpdateService.sendBoardUpdate] No panel - returning');
            return;
        }

        // Queue update if webview not ready yet
        if (!this._deps.panelContext.webviewReady) {
            logger.debug('[WebviewUpdateService.sendBoardUpdate] Webview not ready - queueing pending update');
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
        logger.debug('[WebviewUpdateService.sendBoardUpdate] Board valid:', board.valid, 'columns:', board.columns?.length);

        // Update webview permissions to include asset directories
        this._deps.webviewManager.updatePermissionsForAssets();

        const extension = vscode.extensions.getExtension('ludos.ludos-kanban');
        const version = extension?.packageJSON?.version || 'Unknown';

        // Send board update message
        logger.debug('[WebviewUpdateService.sendBoardUpdate] Sending boardUpdate message');
        this._sendBoardUpdateMessage(board, {
            isFullRefresh,
            applyDefaultFolding,
            version,
            debugMode: this._deps.panelContext.debugMode
        });

        // Refresh configuration after sending board
        await this.refreshAllConfiguration();

        // NOTE: Don't call _sendIncludeFileContents() here.
        // The frontend will request include files via 'requestIncludeFile' during rendering,
        // and the backend responds via 'includeFileContent'. Sending proactively here
        // causes duplicate messages because the board is rendered before the batch is flushed.
        // Proactive updates are handled by FileSyncHandler and IncludeFileCoordinator for file changes.
    }

    /**
     * Send the board update message to webview
     */
    private _sendBoardUpdateMessage(board: KanbanBoard, options: {
        isFullRefresh?: boolean;
        applyDefaultFolding?: boolean;
        version?: string;
        debugMode?: boolean;
    } = {}): void {
        if (!this._deps.hasPanel()) return;

        // Use centralized getBoardViewConfig() - single source of truth
        const layoutPresets = this._deps.webviewManager.getLayoutPresetsConfiguration();
        const viewConfig = configService.getBoardViewConfig(layoutPresets);
        this._applyDocumentMarpPreference(viewConfig);

        // Get main file path for image resolution in webview
        const mainFile = this._deps.fileRegistry.getMainFile();
        const mainFilePath = mainFile?.getPath();

        // Find broken link paths for visual indication (only on full refresh to minimize performance impact)
        let brokenLinkPaths: string[] | undefined;
        if (options.isFullRefresh && mainFilePath) {
            try {
                const basePath = path.dirname(mainFilePath);
                const scanner = new BoardContentScanner(basePath);
                const brokenElements = scanner.findBrokenElements(board);
                // Filter to only link type elements
                brokenLinkPaths = brokenElements
                    .filter(elem => elem.type === 'link')
                    .map(elem => elem.path);
            } catch (error) {
                logger.warn('[WebviewUpdateService] Failed to scan for broken links:', error);
            }
        }

        // BoardUpdateMessage type matches getBoardViewConfig() output
        const message = {
            type: 'boardUpdate' as const,
            board: board,
            ...(mainFilePath && { mainFilePath }),
            ...(viewConfig as Partial<BoardUpdateMessage>),
            // Optional fields for full board loads
            ...(options.isFullRefresh !== undefined && { isFullRefresh: options.isFullRefresh }),
            ...(options.applyDefaultFolding !== undefined && { applyDefaultFolding: options.applyDefaultFolding }),
            ...(options.version && { version: options.version }),
            ...(options.debugMode !== undefined && { debugMode: options.debugMode }),
            // Include broken link paths if available
            ...(brokenLinkPaths && brokenLinkPaths.length > 0 && { brokenLinkPaths })
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
                const fileExists = file.exists();
                const relativePath = file.getRelativePath();
                const message: UpdateIncludeContentMessage = {
                    type: 'updateIncludeContent',
                    filePath: relativePath,
                    content: file.getContent(),
                    error: fileExists ? undefined : `File not found: ${relativePath}`
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
            const config = this._applyDocumentMarpPreference(configService.getBoardViewConfig(layoutPresets));

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

    private _applyDocumentMarpPreference<T extends { showMarpSettings?: boolean }>(config: T): T {
        const documentUri = this._deps.panelContext.lastDocumentUri;
        if (!documentUri) {
            return config;
        }
        const storedMarpPreference = getDocumentPreference(this._deps.extensionContext, documentUri, 'showMarpSettings');
        if (storedMarpPreference !== undefined) {
            config.showMarpSettings = Boolean(storedMarpPreference);
        }
        return config;
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
                    includeFiles: column.includeFiles,
                    includeError: column.includeError
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
                    description: result.task.description,
                    includeMode: result.task.includeMode,
                    includeFiles: result.task.includeFiles,
                    includeError: result.task.includeError
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
