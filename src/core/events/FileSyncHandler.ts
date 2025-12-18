/**
 * FileSyncHandler - Unified handler for file synchronization events
 *
 * Combines INIT and FOCUS pathways into a single reusable code path.
 *
 * Subscribes to:
 * - `focus:gained` - Check for external file changes when panel gains focus
 *
 * Public methods:
 * - `syncAllFiles(force)` - Called by INIT path with force=true, by FOCUS with force=false
 *
 * Replaces:
 * - `_checkIncludeFilesForExternalChanges()` from KanbanWebviewPanel
 * - `_checkMediaFilesForChanges()` from KanbanWebviewPanel
 * - Parts of `_syncMainFileToRegistry()` related to include file loading
 */

import { eventBus, FocusGainedEvent, createEvent } from './index';
import { KanbanBoard } from '../../markdownParser';
import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';
import { MediaTracker } from '../../services/MediaTracker';
import { BoardStore } from '../stores';
import { WebviewBridge } from '../bridge';
import { PanelContext } from '../../panel/PanelContext';

/**
 * Options for sync operation
 */
export interface FileSyncOptions {
    /** Force reload all files regardless of mtime changes */
    force: boolean;
    /** Skip if initial board load is in progress */
    skipDuringInitialLoad?: boolean;
}

/**
 * Dependencies required by FileSyncHandler
 */
export interface FileSyncDependencies {
    fileRegistry: MarkdownFileRegistry;
    boardStore: BoardStore;
    getMediaTracker: () => MediaTracker | null;
    getWebviewBridge: () => WebviewBridge | null;
    getBoard: () => KanbanBoard | undefined;
    panelContext: PanelContext;
    sendBoardUpdate: (isFullRefresh?: boolean, applyDefaultFolding?: boolean) => void;
    emitBoardLoaded: (board: KanbanBoard) => void;
}

/**
 * Result of a sync operation
 */
export interface FileSyncResult {
    includeFilesChanged: boolean;
    mediaFilesChanged: boolean;
    changedIncludeFiles: string[];
    changedMediaFiles: string[];
}

export class FileSyncHandler {
    private _deps: FileSyncDependencies;
    private _unsubscribeFocus: (() => void) | null = null;

    constructor(deps: FileSyncDependencies) {
        this._deps = deps;
        this._subscribe();
    }

    /**
     * Subscribe to events
     */
    private _subscribe(): void {
        // Subscribe to focus:gained for external change detection
        this._unsubscribeFocus = eventBus.on('focus:gained', async (_event: FocusGainedEvent) => {
            await this.syncAllFiles({ force: false, skipDuringInitialLoad: true });
        });
    }

    /**
     * Unified sync method - called by both INIT and FOCUS pathways
     *
     * @param options.force - If true, reload all files. If false, only reload changed files.
     * @param options.skipDuringInitialLoad - If true, skip sync during initial board load
     * @returns Result of sync operation
     */
    public async syncAllFiles(options: FileSyncOptions): Promise<FileSyncResult> {
        const { force, skipDuringInitialLoad = false } = options;

        const result: FileSyncResult = {
            includeFilesChanged: false,
            mediaFilesChanged: false,
            changedIncludeFiles: [],
            changedMediaFiles: []
        };

        // Skip if registry not ready
        if (!this._deps.fileRegistry.isReady()) {
            console.log('[FileSyncHandler] Registry not ready, skipping sync');
            return result;
        }

        // Skip during initial board loading if requested
        if (skipDuringInitialLoad && this._deps.panelContext.initialBoardLoad) {
            console.log('[FileSyncHandler] Initial loading in progress, skipping sync');
            return result;
        }

        try {
            // Step 1: Sync include files (markdown content)
            const includeResult = await this._syncIncludeFiles(force);
            result.includeFilesChanged = includeResult.hasChanges;
            result.changedIncludeFiles = includeResult.changedFiles;

            // Step 2: Sync media files (images, diagrams)
            const mediaResult = this._syncMediaFiles();
            result.mediaFilesChanged = mediaResult.hasChanges;
            result.changedMediaFiles = mediaResult.changedFiles;

            // Step 3: If any changes, send board update
            if (result.includeFilesChanged || force) {
                this._deps.boardStore.invalidateCache();
                this._deps.sendBoardUpdate(false, true);

                // Emit board:loaded to trigger media tracking update
                const board = this._deps.getBoard();
                if (board) {
                    this._deps.emitBoardLoaded(board);
                }
            }

            console.log(`[FileSyncHandler] Sync complete: includeChanges=${result.includeFilesChanged}, mediaChanges=${result.mediaFilesChanged}`);
            return result;

        } catch (error) {
            console.error('[FileSyncHandler] Error during sync:', error);
            return result;
        }
    }

    /**
     * Sync include files - check for external changes and reload if needed
     *
     * @param force - If true, reload all files regardless of mtime
     * @returns Object with hasChanges flag and list of changed file paths
     */
    private async _syncIncludeFiles(force: boolean): Promise<{ hasChanges: boolean; changedFiles: string[] }> {
        const changedFiles: string[] = [];

        // Log registry contents for debugging
        const allFiles = this._deps.fileRegistry.getAll();
        console.log(`[FileSyncHandler] Registry contains ${allFiles.length} file(s):`,
            allFiles.map(f => `${f.getPath()} (${f.getFileType()})`));

        if (force) {
            // Force mode: reload all files
            console.log('[FileSyncHandler] Force mode: reloading all include files');
            for (const file of allFiles) {
                if (file.getFileType() !== 'main') {
                    await file.reload();
                    changedFiles.push(file.getPath());
                }
            }
            return { hasChanges: changedFiles.length > 0, changedFiles };
        }

        // Check mode: only reload files that changed externally
        const changesMap = await this._deps.fileRegistry.checkAllForExternalChanges();

        changesMap.forEach((hasChanged, path) => {
            console.log(`[FileSyncHandler] File ${path}: hasChanged=${hasChanged}`);
            if (hasChanged) {
                changedFiles.push(path);
            }
        });

        if (changedFiles.length > 0) {
            console.log(`[FileSyncHandler] Found ${changedFiles.length} changed include file(s):`, changedFiles);

            // Force sync baseline for changed files
            for (const file of allFiles) {
                if (changesMap.get(file.getPath())) {
                    console.log(`[FileSyncHandler] Syncing baseline for: ${file.getPath()}`);
                    await file.forceSyncBaseline();
                }
            }
        }

        return { hasChanges: changedFiles.length > 0, changedFiles };
    }

    /**
     * Sync media files - check for external changes
     *
     * Note: Media changes are handled via MediaTracker's callback mechanism,
     * so we just trigger the check here.
     *
     * @returns Object with hasChanges flag and list of changed file paths
     */
    private _syncMediaFiles(): { hasChanges: boolean; changedFiles: string[] } {
        const mediaTracker = this._deps.getMediaTracker();
        if (!mediaTracker) {
            console.log('[FileSyncHandler] No media tracker initialized');
            return { hasChanges: false, changedFiles: [] };
        }

        try {
            // Log tracked files for debugging
            const trackedFiles = mediaTracker.getTrackedFiles();
            console.log(`[FileSyncHandler] Checking ${trackedFiles.length} tracked media file(s):`,
                trackedFiles.map(f => `${f.path} (${f.type})`));

            // checkForChanges() compares mtimes and triggers callback if changes found
            // The callback (set in KanbanWebviewPanel) handles notifying the frontend
            const changedFiles = mediaTracker.checkForChanges();

            return {
                hasChanges: changedFiles.length > 0,
                changedFiles: changedFiles.map(f => f.path)
            };
        } catch (error) {
            console.error('[FileSyncHandler] Error checking media files:', error);
            return { hasChanges: false, changedFiles: [] };
        }
    }

    /**
     * Dispose handler and unsubscribe from events
     */
    public dispose(): void {
        if (this._unsubscribeFocus) {
            this._unsubscribeFocus();
            this._unsubscribeFocus = null;
        }
    }
}
