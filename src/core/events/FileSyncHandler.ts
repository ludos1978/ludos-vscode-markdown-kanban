/**
 * FileSyncHandler - Detects and reloads externally modified files
 *
 * Combines INIT and FOCUS pathways into a single reusable code path.
 *
 * Subscribes to:
 * - `focus:gained` - Check for external file changes when panel gains focus
 *
 * Public methods:
 * - `reloadExternallyModifiedFiles(options)` - Called by INIT (force=true) and FOCUS (force=false)
 *
 * Replaces (deleted functions):
 * - `_checkIncludeFilesForExternalChanges()` from KanbanWebviewPanel
 * - `_checkMediaFilesForChanges()` from KanbanWebviewPanel
 * - Parts of `_initializeBoardFromDocument()` related to include file loading
 */

import { eventBus, FocusGainedEvent } from './index';
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
    /** Skip sending board update (use during init when loadMarkdownFile already sent it) */
    skipBoardUpdate?: boolean;
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
    sendBoardUpdate: (applyDefaultFolding?: boolean, isFullRefresh?: boolean) => void;
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
     * Subscribe to events on the panel's scoped event bus.
     * This ensures focus events from other panels don't trigger this handler.
     */
    private _subscribe(): void {
        const scopedBus = this._deps.panelContext.scopedEventBus;

        // Subscribe to focus:gained for external change detection
        this._unsubscribeFocus = scopedBus.on<Record<string, never>>('focus:gained', async () => {
            console.log('[FileSyncHandler] focus:gained event received - calling reloadExternallyModifiedFiles');
            await this.reloadExternallyModifiedFiles({ force: false, skipDuringInitialLoad: true });
        });
    }

    /**
     * Reload files that were modified externally (outside VS Code)
     *
     * Called by both INIT and FOCUS pathways:
     * - INIT: force=true → reload all files regardless of mtime
     * - FOCUS: force=false → only reload files with changed mtime
     *
     * @param options.force - If true, reload all files. If false, only reload changed files.
     * @param options.skipDuringInitialLoad - If true, skip during initial board load
     * @returns Result with lists of changed files
     */
    public async reloadExternallyModifiedFiles(options: FileSyncOptions): Promise<FileSyncResult> {
        const { force, skipDuringInitialLoad = false, skipBoardUpdate = false } = options;
        const stack = new Error().stack?.split('\n').slice(1, 5).join('\n') || 'no stack';
        console.log('[FileSyncHandler.reloadExternallyModifiedFiles] START', { force, skipDuringInitialLoad, skipBoardUpdate });
        console.log('[FileSyncHandler.reloadExternallyModifiedFiles] CALLER:\n' + stack);

        const result: FileSyncResult = {
            includeFilesChanged: false,
            mediaFilesChanged: false,
            changedIncludeFiles: [],
            changedMediaFiles: []
        };

        // Skip if registry not ready
        if (!this._deps.fileRegistry.isReady()) {
            return result;
        }

        // Skip during initial board loading if requested
        if (skipDuringInitialLoad && this._deps.panelContext.initialBoardLoad) {
            return result;
        }

        try {
            // Step 1: Check and reload include files that changed externally
            const includeResult = await this._reloadChangedIncludeFiles(force);
            result.includeFilesChanged = includeResult.hasChanges;
            result.changedIncludeFiles = includeResult.changedFiles;

            // Step 2: Check media files for external changes
            const mediaResult = this._checkMediaForExternalChanges();
            result.mediaFilesChanged = mediaResult.hasChanges;
            result.changedMediaFiles = mediaResult.changedFiles;

            // Step 3: Send updates to webview
            if (result.includeFilesChanged || force) {
                console.log('[FileSyncHandler] Sending board update', {
                    includeFilesChanged: result.includeFilesChanged,
                    force,
                    skipBoardUpdate,
                    changedFiles: result.changedIncludeFiles
                });
                if (skipBoardUpdate) {
                    // During initial load, loadMarkdownFile() already sent the board update.
                    // We only need to send include content, not another full board update.
                    // This avoids redundant rendering while still delivering include content.
                    this._sendIncludeContentOnly();

                    // Still emit board:loaded for media tracking
                    const board = this._deps.getBoard();
                    if (board) {
                        this._deps.emitBoardLoaded(board);
                    }
                } else {
                    // Use targeted include content update instead of full board refresh
                    // The webview's updateIncludeFileCache handles re-rendering only affected tasks
                    console.log('[FileSyncHandler] Sending targeted include content update (not full board refresh)');
                    this._sendIncludeContentOnly();

                    // Emit board:loaded to trigger media tracking update
                    const board = this._deps.getBoard();
                    if (board) {
                        this._deps.emitBoardLoaded(board);
                    }
                }
            }

            return result;

        } catch (error) {
            console.error('[FileSyncHandler] Error during sync:', error);
            return result;
        }
    }

    /**
     * Check include files for external changes and reload if needed
     *
     * @param force - If true, reload all files regardless of mtime
     * @returns Object with hasChanges flag and list of changed file paths
     */
    private async _reloadChangedIncludeFiles(force: boolean): Promise<{ hasChanges: boolean; changedFiles: string[] }> {
        const changedFiles: string[] = [];
        const allFiles = this._deps.fileRegistry.getAll();

        if (force) {
            // Force mode: reload all files
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

        for (const file of allFiles) {
            if (!changesMap.get(file.getPath())) {
                continue;
            }

            if (file.getFileType() === 'main') {
                await file.handleExternalChange('modified');
                continue;
            }

            changedFiles.push(file.getPath());
            await file.handleExternalChange('modified');
        }

        return { hasChanges: changedFiles.length > 0, changedFiles };
    }

    /**
     * Check media files (images, diagrams) for external changes
     *
     * Note: Media changes are handled via MediaTracker's callback mechanism,
     * so we just trigger the check here.
     *
     * @returns Object with hasChanges flag and list of changed file paths
     */
    private _checkMediaForExternalChanges(): { hasChanges: boolean; changedFiles: string[] } {
        const mediaTracker = this._deps.getMediaTracker();
        if (!mediaTracker) {
            console.log('[FileSyncHandler] No media tracker available - skipping media check');
            return { hasChanges: false, changedFiles: [] };
        }

        try {
            const trackedFiles = mediaTracker.getTrackedFiles();
            console.log(`[FileSyncHandler] Checking ${trackedFiles.length} tracked media files for changes`);

            // checkForChanges() compares mtimes and triggers callback if changes found
            // The callback (set in KanbanWebviewPanel) handles notifying the frontend
            const changedFiles = mediaTracker.checkForChanges();

            if (changedFiles.length > 0) {
                console.log('[FileSyncHandler] Media files changed:', changedFiles.map(f => `${f.path} (${f.type})`));
            }

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
     * Send include content to webview without triggering a full board update.
     * Used during initialization when loadMarkdownFile() already sent the board.
     */
    private _sendIncludeContentOnly(): void {
        const webviewBridge = this._deps.getWebviewBridge();
        if (!webviewBridge) {
            return;
        }

        const includeFiles = this._deps.fileRegistry.getIncludeFiles();
        if (includeFiles.length === 0) {
            return;
        }

        for (const file of includeFiles) {
            const fileExists = file.exists();
            const message = {
                type: 'updateIncludeContent' as const,
                filePath: file.getRelativePath(),
                content: file.getContent(),
                error: fileExists ? undefined : `File not found: ${file.getRelativePath()}`
            };
            webviewBridge.sendBatched(message);
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
