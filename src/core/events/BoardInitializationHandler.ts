/**
 * BoardInitializationHandler - Handles board initialization from document
 *
 * Extracts board initialization logic from KanbanWebviewPanel to reduce God class size.
 * This handler:
 * 1. Creates/updates MainKanbanFile instances
 * 2. Initializes MediaTracker with callbacks
 * 3. Registers include files via coordinator
 * 4. Loads include content via FileSyncHandler
 *
 * Previously: KanbanWebviewPanel._initializeBoardFromDocument() (~100 lines)
 */

import * as vscode from 'vscode';
import { KanbanBoard } from '../../markdownParser';
import { MarkdownFileRegistry, FileFactory, MainKanbanFile } from '../../files';
import { MediaTracker, ChangedMediaFile } from '../../services/MediaTracker';
import { PanelContext } from '../../panel/PanelContext';
import { IncludeFileCoordinator } from '../../panel/IncludeFileCoordinator';
import { FileSyncHandler } from './FileSyncHandler';

/**
 * Dependencies required by BoardInitializationHandler
 */
export interface BoardInitializationDependencies {
    fileRegistry: MarkdownFileRegistry;
    fileFactory: FileFactory;
    includeCoordinator: IncludeFileCoordinator;
    panelContext: PanelContext;
    getFileSyncHandler: () => FileSyncHandler | null;
    getBoard: () => KanbanBoard | undefined;
    getPanel: () => vscode.WebviewPanel;
    onMediaChanged: (changedFiles: ChangedMediaFile[]) => void;
}

/**
 * Result of board initialization
 */
export interface BoardInitializationResult {
    mainFile: MainKanbanFile;
    mediaTracker: MediaTracker;
}

export class BoardInitializationHandler {
    private _deps: BoardInitializationDependencies;

    constructor(deps: BoardInitializationDependencies) {
        this._deps = deps;
    }

    /**
     * Initialize board from document - creates MainKanbanFile and registers include files
     *
     * @param document The VS Code text document to initialize from
     * @param existingMediaTracker Existing MediaTracker to dispose (if any)
     * @returns The initialized MainKanbanFile and MediaTracker
     */
    public async initializeFromDocument(
        document: vscode.TextDocument,
        existingMediaTracker: MediaTracker | null
    ): Promise<BoardInitializationResult> {
        const filePath = document.uri.fsPath;

        // Step 1: Create or update MainKanbanFile
        const mainFile = this._ensureMainFile(filePath);

        // Step 2: Load content into file instance
        try {
            await mainFile.reload();
        } catch (error) {
            console.error(`[BoardInitializationHandler] Failed to load MainKanbanFile content:`, error);
        }

        // Step 3: Initialize MediaTracker
        const mediaTracker = this._initializeMediaTracker(filePath, existingMediaTracker, mainFile);

        // Step 4: Load include files if board is available
        await this._loadIncludeFiles();

        return { mainFile, mediaTracker };
    }

    /**
     * Ensure MainKanbanFile exists for the given path
     */
    private _ensureMainFile(filePath: string): MainKanbanFile {
        let mainFile = this._deps.fileRegistry.getMainFile();

        if (!mainFile || mainFile.getPath() !== filePath) {
            // Clear existing files if switching to a different file
            if (mainFile && mainFile.getPath() !== filePath) {
                this._deps.fileRegistry.clear();
            }

            // Create new MainKanbanFile instance
            mainFile = this._deps.fileFactory.createMainFile(filePath);
            this._deps.fileRegistry.register(mainFile);
            mainFile.startWatching();
        }

        return mainFile;
    }

    /**
     * Initialize MediaTracker for the kanban file
     */
    private _initializeMediaTracker(
        filePath: string,
        existingTracker: MediaTracker | null,
        mainFile: MainKanbanFile
    ): MediaTracker {
        // Dispose old tracker before creating new one to cleanup file watchers
        if (existingTracker) {
            console.log('[BoardInitializationHandler] Disposing old MediaTracker before creating new one');
            existingTracker.dispose();
        }

        console.log(`[BoardInitializationHandler] Creating new MediaTracker for: ${filePath}`);
        const mediaTracker = new MediaTracker(filePath);

        // Set up callback for real-time media file change detection
        mediaTracker.setOnMediaChanged((changedFiles) => {
            console.log(`[BoardInitializationHandler] Real-time change detected for ${changedFiles.length} file(s):`,
                changedFiles.map(f => f.path));
            this._deps.onMediaChanged(changedFiles);
        });

        // Update tracked media files from current content
        const content = mainFile.getContent();
        console.log(`[BoardInitializationHandler] Main file content length: ${content?.length || 0}`);
        if (content) {
            const trackedFiles = mediaTracker.updateTrackedFiles(content);
            console.log(`[BoardInitializationHandler] Tracking ${trackedFiles.length} media files from main file`);
        } else {
            console.warn(`[BoardInitializationHandler] No content from main file - skipping media tracking`);
        }

        // Setup file watchers for diagram files (real-time change detection)
        mediaTracker.setupFileWatchers();

        return mediaTracker;
    }

    /**
     * Load include files if board is available
     */
    private async _loadIncludeFiles(): Promise<void> {
        const board = this._deps.getBoard();
        if (!board || !board.valid) {
            console.warn(`[BoardInitializationHandler] Skipping include file sync - board not available or invalid`);
            this._deps.panelContext.setInitialBoardLoad(false);
            return;
        }

        // Step 1: Create include file instances in registry
        this._deps.includeCoordinator.registerBoardIncludeFiles(board);

        // Step 2: Load include content using the UNIFIED FileSyncHandler
        // This is the SAME code path used by FOCUS (focus:gained event)
        const fileSyncHandler = this._deps.getFileSyncHandler();
        if (fileSyncHandler) {
            try {
                await fileSyncHandler.reloadExternallyModifiedFiles({ force: true, skipBoardUpdate: true });
                console.log('[BoardInitializationHandler] Include files loaded via FileSyncHandler (unified path)');
            } catch (error) {
                console.error('[BoardInitializationHandler] Error loading include content:', error);
            } finally {
                this._deps.panelContext.setInitialBoardLoad(false);
            }
        } else {
            console.warn('[BoardInitializationHandler] FileSyncHandler not available');
            this._deps.panelContext.setInitialBoardLoad(false);
        }
    }
}
