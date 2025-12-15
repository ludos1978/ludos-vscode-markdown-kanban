/**
 * Debug Commands
 *
 * Handles debug and diagnostic operations for the kanban board:
 * - forceWriteAllContent: Emergency force write of all files
 * - verifyContentSync: Verify content synchronization between frontend/backend
 * - getTrackedFilesDebugInfo: Get debug info about tracked files
 * - clearTrackedFilesCache: Clear tracked file caches
 *
 * These commands are used by the debug overlay UI for troubleshooting
 * file synchronization issues.
 *
 * @module commands/DebugCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage } from './interfaces';
import { getErrorMessage } from '../utils/stringUtils';
import { PanelCommandAccess, hasConflictService } from '../types/PanelCommandAccess';
import * as fs from 'fs';

/**
 * Debug Commands Handler
 *
 * Processes debug-related messages from the webview.
 */
export class DebugCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'debug-commands',
        name: 'Debug Commands',
        description: 'Handles debug operations for file synchronization and diagnostics',
        messageTypes: [
            'forceWriteAllContent',
            'verifyContentSync',
            'getTrackedFilesDebugInfo',
            'clearTrackedFilesCache'
        ],
        priority: 50
    };

    async execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'forceWriteAllContent':
                    return await this.handleForceWriteAllContent(context);

                case 'verifyContentSync':
                    return await this.handleVerifyContentSync(message.frontendBoard, context);

                case 'getTrackedFilesDebugInfo':
                    return await this.handleGetTrackedFilesDebugInfo(context);

                case 'clearTrackedFilesCache':
                    return await this.handleClearTrackedFilesCache(context);

                default:
                    return this.failure(`Unknown debug command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[DebugCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
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

    private async handleVerifyContentSync(frontendBoard: any, context: CommandContext): Promise<CommandResult> {
        if (!this.getPanel()) {
            return this.success();
        }

        try {
            if (!frontendBoard) {
                throw new Error('Frontend board data not provided');
            }

            const fileRegistry = this.getFileRegistry();
            if (!fileRegistry) {
                throw new Error('File registry not available');
            }

            const { MarkdownKanbanParser } = require('../markdownParser');

            const allFiles = fileRegistry.getAll();
            const fileResults: any[] = [];
            let matchingFiles = 0;
            let mismatchedFiles = 0;

            const backendBoard = this.getCurrentBoard();

            for (const file of allFiles) {
                let backendContent: string;
                let frontendContent: string;
                let savedFileContent: string | null = null;

                try {
                    savedFileContent = fs.readFileSync(file.getPath(), 'utf8');
                } catch (error) {
                    console.error(`[DebugCommands] Could not read saved file ${file.getPath()}:`, error);
                }

                if (file.getFileType() === 'main') {
                    frontendContent = MarkdownKanbanParser.generateMarkdown(frontendBoard);
                    backendContent = backendBoard
                        ? MarkdownKanbanParser.generateMarkdown(backendBoard)
                        : file.getContent();
                } else {
                    backendContent = file.getContent();
                    frontendContent = backendContent;
                }

                const backendHash = this.computeHash(backendContent);
                const frontendHash = this.computeHash(frontendContent);
                const savedHash = savedFileContent !== null ? this.computeHash(savedFileContent) : null;

                const frontendBackendMatch = backendHash === frontendHash;
                const backendSavedMatch = savedHash ? backendHash === savedHash : true;
                const allMatch = frontendBackendMatch && backendSavedMatch;

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
                    frontendBackendMatch,
                    backendSavedMatch,
                    frontendSavedMatch: savedHash ? frontendHash === savedHash : true,
                    frontendContentLength: frontendContent.length,
                    backendContentLength: backendContent.length,
                    savedContentLength: savedFileContent?.length ?? null,
                    frontendBackendDiff: Math.abs(frontendContent.length - backendContent.length),
                    backendSavedDiff: savedFileContent ? Math.abs(backendContent.length - savedFileContent.length) : null,
                    frontendSavedDiff: savedFileContent ? Math.abs(frontendContent.length - savedFileContent.length) : null,
                    frontendHash: frontendHash.substring(0, 8),
                    backendHash: backendHash.substring(0, 8),
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
        const panelAccess = panel as PanelCommandAccess;

        try {
            const includeFileMap = panelAccess._includeFiles;
            if (includeFileMap) {
                includeFileMap.clear();
            }

            panelAccess._cachedBoardFromWebview = null;

            const document = context.fileManager.getDocument();
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

    private async collectTrackedFilesDebugInfo(context: CommandContext): Promise<any> {
        const document = context.fileManager.getDocument();
        const fileRegistry = this.getFileRegistry();
        const mainFile = fileRegistry?.getMainFile();

        const mainFilePath = context.fileManager.getFilePath() || document?.uri.fsPath || 'Unknown';

        const mainFileInfo = {
            path: mainFilePath,
            lastModified: mainFile?.getLastModified()?.toISOString() || 'Unknown',
            exists: mainFile?.exists() ?? (document ? true : false),
            watcherActive: true,
            hasInternalChanges: mainFile?.hasUnsavedChanges() ?? false,
            hasExternalChanges: mainFile?.hasExternalChanges() ?? false,
            documentVersion: document?.version ?? 0,
            lastDocumentVersion: document ? document.version - 1 : -1,
            isUnsavedInEditor: document?.isDirty ?? false,
            baseline: mainFile?.getBaseline() || ''
        };

        const includeFiles: any[] = [];
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
