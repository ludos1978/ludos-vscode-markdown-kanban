/**
 * Debug Commands
 *
 * Handles debug and diagnostic operations for the kanban board:
 * - forceWriteAllContent: Emergency force write of all files
 * - verifyContentSync: Verify content synchronization between registry and saved file
 * - getTrackedFilesDebugInfo: Get debug info about tracked files
 * - clearTrackedFilesCache: Clear tracked file caches
 *
 * These commands are used by the debug overlay UI for troubleshooting
 * file synchronization issues.
 *
 * @module commands/DebugCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import { getErrorMessage } from '../utils/stringUtils';
import { PanelCommandAccess, hasConflictService } from '../types/PanelCommandAccess';
import { MarkdownKanbanParser } from '../markdownParser';
import { KanbanBoard } from '../board/KanbanTypes';
import * as fs from 'fs';
import { SetDebugModeMessage } from '../core/bridge/MessageTypes';

/**
 * File verification result for content sync check
 */
interface FileVerificationResult {
    path: string;
    relativePath: string;
    isMainFile: boolean;
    matches: boolean;
    canonicalSavedMatch: boolean;
    canonicalContentLength: number;
    savedContentLength: number | null;
    canonicalSavedDiff: number | null;
    canonicalHash: string;
    savedHash: string | null;
}

/**
 * Include file debug info
 */
interface IncludeFileDebugInfo {
    path: string;
    type: string;
    exists: boolean;
    lastModified: string;
    size: string;
    hasInternalChanges: boolean;
    hasExternalChanges: boolean;
    isUnsavedInEditor: boolean;
    baseline: string;
    content: string;
    externalContent: string;
    contentLength: number;
    baselineLength: number;
    externalContentLength: number;
}

/**
 * Tracked files debug info structure
 */
interface TrackedFilesDebugInfo {
    mainFile: string;
    mainFileLastModified: string;
    fileWatcherActive: boolean;
    includeFiles: IncludeFileDebugInfo[];
    conflictManager: {
        healthy: boolean;
        trackedFiles: number;
        activeWatchers: number;
        pendingConflicts: number;
        watcherFailures: number;
        listenerEnabled: boolean;
        documentSaveListenerActive: boolean;
    };
    systemHealth: {
        overall: string;
        extensionState: string;
        memoryUsage: string;
        lastError: string | null;
    };
    hasUnsavedChanges: boolean;
    timestamp: string;
    watcherDetails: {
        path: string;
        lastModified: string;
        exists: boolean;
        watcherActive: boolean;
        hasInternalChanges: boolean;
        hasExternalChanges: boolean;
        documentVersion: number;
        lastDocumentVersion: number;
        isUnsavedInEditor: boolean;
        baseline: string;
    };
}

interface FrontendSnapshotInfo {
    hash: string;
    contentLength: number;
    matchesRegistry: boolean;
    diffChars: number;
    registryLength: number;
}

/**
 * Debug Commands Handler
 *
 * Processes debug-related messages from the webview.
 */
export class DebugCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'debug-commands',
        name: 'Debug Commands',
        description: 'Handles debug operations for file synchronization and diagnostics',
        messageTypes: [
            'forceWriteAllContent',
            'verifyContentSync',
            'getTrackedFilesDebugInfo',
            'clearTrackedFilesCache',
            'setDebugMode'
        ],
        priority: 50
    };

    protected handlers: Record<string, MessageHandler> = {
        'forceWriteAllContent': (_msg, ctx) => this.handleForceWriteAllContent(ctx),
        'verifyContentSync': (msg, ctx) => this.handleVerifyContentSync((msg as any).frontendBoard, ctx),
        'getTrackedFilesDebugInfo': (_msg, ctx) => this.handleGetTrackedFilesDebugInfo(ctx),
        'clearTrackedFilesCache': (_msg, ctx) => this.handleClearTrackedFilesCache(ctx),
        'setDebugMode': (msg, ctx) => this.handleSetDebugMode(msg as SetDebugModeMessage, ctx)
    };

    private async handleSetDebugMode(message: SetDebugModeMessage, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel() as PanelCommandAccess | undefined;
        if (!panel || typeof panel.setDebugMode !== 'function') {
            return this.success();
        }

        panel.setDebugMode(message.enabled);
        return this.success();
    }

    // ============= FORCE WRITE / VERIFICATION HANDLERS =============

    private async handleForceWriteAllContent(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.success();
        }

        console.warn('[DebugCommands] FORCE WRITE ALL: Starting emergency file write operation');

        let backupPath: string | undefined;
        try {
            const document = context.fileManager.getDocument();
            if (document && hasConflictService(panel)) {
                backupPath = await panel._conflictService.createUnifiedBackup(
                    document.uri.fsPath,
                    'force-write',
                    true
                );
            }
        } catch (error) {
            console.error('[DebugCommands] Failed to create backup before force write:', error);
        }

        try {
            const fileRegistry = this.getFileRegistry();
            if (!fileRegistry?.forceWriteAll) {
                throw new Error('File registry not available or forceWriteAll method not found');
            }
            if (!fileRegistry.getMainFile()) {
                throw new Error('No main file registered - cannot force write');
            }

            const result = await fileRegistry.forceWriteAll();

            this.postMessage({
                type: 'forceWriteAllResult',
                success: result.errors.length === 0,
                filesWritten: result.filesWritten,
                errors: result.errors,
                backupCreated: !!backupPath,
                backupPath: backupPath,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            this.postMessage({
                type: 'forceWriteAllResult',
                success: false,
                filesWritten: 0,
                errors: [getErrorMessage(error)],
                backupCreated: false,
                timestamp: new Date().toISOString()
            });
        }
        return this.success();
    }

    private async handleVerifyContentSync(frontendBoard: unknown, _context: CommandContext): Promise<CommandResult> {
        if (!this.getPanel()) {
            return this.success();
        }

        try {
            const panel = this.getPanel() as PanelCommandAccess | undefined;
            await panel?.refreshMainFileContext?.('other');

            const fileRegistry = this.getFileRegistry();
            if (!fileRegistry) {
                throw new Error('File registry not available');
            }

            const allFiles = fileRegistry.getAll();
            const fileResults: FileVerificationResult[] = [];
            let matchingFiles = 0;
            let mismatchedFiles = 0;
            let frontendSnapshot: FrontendSnapshotInfo | null = null;

            if (frontendBoard && fileRegistry.getMainFile()) {
                try {
                    const registryMain = fileRegistry.getMainFile();
                    const registryContent = registryMain?.getContent() ?? '';
                    const frontendContent = MarkdownKanbanParser.generateMarkdown(frontendBoard as KanbanBoard);
                    const registryHash = this.computeHash(registryContent);
                    const frontendHash = this.computeHash(frontendContent);
                    frontendSnapshot = {
                        hash: frontendHash.substring(0, 8),
                        contentLength: frontendContent.length,
                        matchesRegistry: registryHash === frontendHash,
                        diffChars: Math.abs(frontendContent.length - registryContent.length),
                        registryLength: registryContent.length
                    };
                } catch (error) {
                    console.warn('[DebugCommands] Failed to generate frontend snapshot hash:', error);
                }
            }

            for (const file of allFiles) {
                let canonicalContent: string;
                let savedFileContent: string | null = null;

                try {
                    if (fs.existsSync(file.getPath())) {
                        savedFileContent = fs.readFileSync(file.getPath(), 'utf8');
                    }
                } catch (error) {
                    console.error(`[DebugCommands] Could not read saved file ${file.getPath()}:`, error);
                }

                canonicalContent = file.getContent();

                const canonicalHash = this.computeHash(canonicalContent);
                const savedHash = savedFileContent !== null ? this.computeHash(savedFileContent) : null;

                const canonicalSavedMatch = savedHash ? canonicalHash === savedHash : true;
                const allMatch = canonicalSavedMatch;

                if (allMatch) {
                    matchingFiles++;
                } else {
                    mismatchedFiles++;
                }

                fileResults.push({
                    path: file.getPath(),
                    relativePath: file.getRelativePath(),
                    isMainFile: file.getFileType() === 'main',
                    matches: allMatch,
                    canonicalSavedMatch,
                    canonicalContentLength: canonicalContent.length,
                    savedContentLength: savedFileContent?.length ?? null,
                    canonicalSavedDiff: savedFileContent ? Math.abs(canonicalContent.length - savedFileContent.length) : null,
                    canonicalHash: canonicalHash.substring(0, 8),
                    savedHash: savedHash?.substring(0, 8) ?? null
                });
            }

            this.postMessage({
                type: 'verifyContentSyncResult',
                success: true,
                timestamp: new Date().toISOString(),
                totalFiles: allFiles.length,
                matchingFiles: matchingFiles,
                mismatchedFiles: mismatchedFiles,
                missingFiles: 0,
                fileResults: fileResults,
                frontendSnapshot: frontendSnapshot,
                summary: `${matchingFiles} files match, ${mismatchedFiles} differ`
            });
        } catch (error) {
            this.postMessage({
                type: 'verifyContentSyncResult',
                success: false,
                timestamp: new Date().toISOString(),
                totalFiles: 0,
                matchingFiles: 0,
                mismatchedFiles: 0,
                missingFiles: 0,
                fileResults: [],
                summary: `Verification failed: ${getErrorMessage(error)}`
            });
        }
        return this.success();
    }

    // ============= DEBUG INFO HANDLERS =============

    private async handleGetTrackedFilesDebugInfo(context: CommandContext): Promise<CommandResult> {
        if (!this.getPanel()) {
            return this.success();
        }

        const debugData = await this.collectTrackedFilesDebugInfo(context);
        this.postMessage({
            type: 'trackedFilesDebugInfo',
            data: debugData
        });
        return this.success();
    }

    private async handleClearTrackedFilesCache(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.success();
        }

        try {
            const fileRegistry = this.getFileRegistry();
            if (fileRegistry) {
                const includeFiles = fileRegistry.getIncludeFiles();
                for (const file of includeFiles) {
                    fileRegistry.unregister(file.getPath());
                }
            }

            const document = context.fileManager.getDocument();
            const panelAccess = panel as PanelCommandAccess;
            if (document && panelAccess.loadMarkdownFile) {
                await panelAccess.loadMarkdownFile(document, false);
            }
        } catch (error) {
            console.warn('[DebugCommands] Error clearing panel caches:', error);
        }

        this.postMessage({
            type: 'debugCacheCleared'
        });
        return this.success();
    }

    // ============= HELPER METHODS =============

    private computeHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }

    private async collectTrackedFilesDebugInfo(context: CommandContext): Promise<TrackedFilesDebugInfo> {
        const document = context.fileManager.getDocument();
        const panel = context.getWebviewPanel?.() as PanelCommandAccess | undefined;
        await panel?.refreshMainFileContext?.('other');
        const fileRegistry = this.getFileRegistry();
        const mainFile = fileRegistry?.getMainFile();

        const mainFilePath = panel?.getCanonicalMainFilePath?.() || mainFile?.getPath() || 'Unknown';

        const mainFileInfo = {
            path: mainFilePath,
            lastModified: mainFile?.getLastModified()?.toISOString() || 'Unknown',
            exists: mainFile?.exists() ?? false,
            watcherActive: true,
            hasInternalChanges: mainFile?.hasUnsavedChanges() ?? false,
            hasExternalChanges: mainFile?.hasExternalChanges() ?? false,
            documentVersion: document?.version ?? 0,
            lastDocumentVersion: document ? document.version - 1 : -1,
            isUnsavedInEditor: document?.isDirty ?? false,
            baseline: mainFile?.getBaseline() || ''
        };

        const includeFiles: IncludeFileDebugInfo[] = [];
        const allIncludeFiles = fileRegistry?.getIncludeFiles() || [];

        for (const file of allIncludeFiles) {
            includeFiles.push({
                path: file.getRelativePath(),
                type: file.getFileType(),
                exists: file.exists(),
                lastModified: file.getLastModified()?.toISOString() || 'Unknown',
                size: 'Unknown',
                hasInternalChanges: file.hasUnsavedChanges(),
                hasExternalChanges: file.hasExternalChanges(),
                isUnsavedInEditor: file.isDirtyInEditor(),
                baseline: file.getBaseline(),
                content: file.getContent(),
                externalContent: '',
                contentLength: file.getContent().length,
                baselineLength: file.getBaseline().length,
                externalContentLength: 0
            });
        }

        const conflictManager = {
            healthy: true,
            trackedFiles: 1 + includeFiles.length,
            activeWatchers: 1 + includeFiles.length,
            pendingConflicts: 0,
            watcherFailures: 0,
            listenerEnabled: true,
            documentSaveListenerActive: true
        };

        const systemHealth = {
            overall: includeFiles.length > 0 ? 'good' : 'warn',
            extensionState: 'active',
            memoryUsage: 'normal',
            lastError: null
        };

        // Check for unsaved changes via file registry
        const hasUnsavedChanges = fileRegistry
            ? fileRegistry.getFilesWithUnsavedChanges().length > 0
            : false;

        return {
            mainFile: mainFileInfo.path,
            mainFileLastModified: mainFileInfo.lastModified,
            fileWatcherActive: mainFileInfo.watcherActive,
            includeFiles: includeFiles,
            conflictManager: conflictManager,
            systemHealth: systemHealth,
            hasUnsavedChanges: hasUnsavedChanges,
            timestamp: new Date().toISOString(),
            watcherDetails: mainFileInfo
        };
    }
}
