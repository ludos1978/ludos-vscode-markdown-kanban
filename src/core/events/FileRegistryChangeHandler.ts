/**
 * FileRegistryChangeHandler - Handles file registry change events
 *
 * Extracts file registry change logic from KanbanWebviewPanel to reduce God class size.
 * This handler:
 * 1. Listens to file registry change events
 * 2. Routes external/reloaded events appropriately
 * 3. Updates frontend when files are reloaded
 *
 * Previously: KanbanWebviewPanel._handleFileRegistryChange() (~62 lines)
 */

import { KanbanBoard } from '../../markdownParser';
import { MarkdownFileRegistry, FileChangeEvent, MarkdownFile } from '../../files';
import { PanelContext } from '../../panel/PanelContext';
import { ConcurrencyManager } from '../../panel/ConcurrencyManager';
import { IncludeFileCoordinator } from '../../panel/IncludeFileCoordinator';
import { BoardStore } from '../stores';

/**
 * Dependencies required by FileRegistryChangeHandler
 */
export interface FileRegistryChangeDependencies {
    fileRegistry: MarkdownFileRegistry;
    boardStore: BoardStore;
    panelContext: PanelContext;
    concurrencyManager: ConcurrencyManager;
    includeCoordinator: IncludeFileCoordinator;
    getBoard: () => KanbanBoard | undefined;
    invalidateBoardCache: () => void;
    sendBoardUpdate: (applyDefaultFolding: boolean, isFullRefresh: boolean) => Promise<void>;
}

export class FileRegistryChangeHandler {
    private _deps: FileRegistryChangeDependencies;
    private _unsubscribe: (() => void) | null = null;

    constructor(deps: FileRegistryChangeDependencies) {
        this._deps = deps;
        this._subscribe();
    }

    /**
     * Subscribe to file registry change events
     */
    private _subscribe(): void {
        const disposable = this._deps.fileRegistry.onDidChange((event) => {
            this._handleChange(event);
        });
        this._unsubscribe = () => disposable.dispose();
    }

    /**
     * Handle file registry change events
     */
    private async _handleChange(event: FileChangeEvent): Promise<void> {
        const file = event.file;
        const fileType = file.getFileType();

        // CRITICAL: Only route EXTERNAL changes to unified handler
        // 'content' events are internal cache updates from user edits - DON'T reload!
        // 'external' events are from file watchers - DO reload!
        // 'reloaded' events are explicit reload requests - DO reload!
        if (event.changeType === 'content' || event.changeType === 'saved') {
            // Internal cache update - do NOT trigger reload
            return;
        }

        // UNIFIED APPROACH: All files (main + includes) handle external changes autonomously
        // 'external' events → File's handleExternalChange() handles it → emits 'reloaded'
        // 'reloaded' events → Update frontend
        if (event.changeType === 'external') {
            // All files handle external changes independently via handleExternalChange()
            // They will show dialogs, reload, and emit 'reloaded' event
            // We just wait for the 'reloaded' event to update frontend
            return;
        }

        // Handle 'reloaded' events for all file types
        if (fileType === 'main') {
            await this._handleMainFileReloaded(event);
        } else if (fileType === 'include-column' || fileType === 'include-task' || fileType === 'include-regular') {
            await this._handleIncludeFileReloaded(event, file);
        }
    }

    /**
     * Handle main file reloaded event
     */
    private async _handleMainFileReloaded(event: FileChangeEvent): Promise<void> {
        if (event.changeType !== 'reloaded') return;

        // CRITICAL: Skip 'reloaded' events during initial board load
        if (this._deps.panelContext.initialBoardLoad) {
            return;
        }

        const existingIncludePaths = new Set(
            this._deps.fileRegistry.getIncludeFiles().map(file => file.getNormalizedRelativePath())
        );

        // Main file reloaded from disk, regenerate board and update frontend
        this._deps.invalidateBoardCache();
        const board = this._deps.getBoard();
        if (board) {
            this._deps.includeCoordinator.registerBoardIncludeFiles(board);

            const newIncludeFiles = this._deps.fileRegistry
                .getIncludeFiles()
                .filter(file => !existingIncludePaths.has(file.getNormalizedRelativePath()));

            for (const file of newIncludeFiles) {
                await file.reload();
            }

            this._deps.invalidateBoardCache();
            // Use sendBoardUpdate to ensure image mappings are regenerated
            console.log('[FileRegistryChangeHandler._handleMainFileReloaded] About to call sendBoardUpdate(false, true)');
            await this._deps.sendBoardUpdate(false, true);
        }
    }

    /**
     * Handle include file reloaded event
     */
    private async _handleIncludeFileReloaded(event: FileChangeEvent, file: MarkdownFile): Promise<void> {
        if (event.changeType !== 'reloaded') return;

        // CRITICAL: Skip 'reloaded' events during initial board load
        // These are just loading content for the first time, not actual changes
        if (this._deps.panelContext.initialBoardLoad) {
            return;
        }

        // RACE-3: Only process if this event is newer than last processed
        // When multiple external changes happen rapidly, reloads can complete out of order.
        // This ensures only the newest data is applied to the frontend.
        if (!this._deps.concurrencyManager.isEventNewer(file.getRelativePath(), event.timestamp)) {
            return;
        }

        // File has been reloaded (either from external change or manual reload)
        // Send updated content to frontend via coordinator
        this._deps.includeCoordinator.sendIncludeFileUpdateToFrontend(file);
    }

    /**
     * Dispose handler and unsubscribe from events
     */
    public dispose = (): void => {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
    };
}
