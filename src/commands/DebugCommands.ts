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
import { getErrorMessage, safeDecodeURIComponent } from '../utils/stringUtils';
import { PanelCommandAccess, hasConflictService } from '../types/PanelCommandAccess';
import { MarkdownKanbanParser } from '../markdownParser';
import { KanbanBoard } from '../board/KanbanTypes';
import { IncludeFile } from '../files/IncludeFile';
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
    registryNormalizedHash?: string | null;
    registryNormalizedLength?: number | null;
    savedNormalizedHash?: string | null;
    savedNormalizedLength?: number | null;
    frontendHash?: string | null;
    frontendContentLength?: number | null;
    frontendRegistryMatch?: boolean | null;
    frontendRegistryDiff?: number | null;
    frontendMatchesRaw?: boolean | null;
    frontendMatchesNormalized?: boolean | null;
    frontendAvailable?: boolean;
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
    registryRawHash?: string;
    registryRawLength?: number;
    registryNormalizedHash?: string;
    registryNormalizedLength?: number;
    registryIsNormalized?: boolean;
    matchKind?: 'raw' | 'normalized' | 'none';
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

    private async handleVerifyContentSync(
        frontendBoard: unknown,
        _context: CommandContext
    ): Promise<CommandResult> {
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
            let normalizedRegistryMainHash: string | null = null;
            let normalizedRegistryMainLength: number | null = null;
            let registryRawMainHash: string | null = null;
            let registryRawMainLength: number | null = null;
            if (frontendBoard && fileRegistry.getMainFile()) {
                try {
                    const registryMain = fileRegistry.getMainFile();
                    const registryContent = registryMain?.getContent() ?? '';
                    const frontendContent = MarkdownKanbanParser.generateMarkdown(frontendBoard as KanbanBoard);
                    const registryHash = this.computeHash(registryContent);
                    const frontendHash = this.computeHash(frontendContent);
                    registryRawMainHash = registryHash;
                    registryRawMainLength = registryContent.length;
                    const normalizedRegistry = this.normalizeMainContent(registryContent, registryMain?.getPath());
                    if (normalizedRegistry) {
                        normalizedRegistryMainHash = this.computeHash(normalizedRegistry.content);
                        normalizedRegistryMainLength = normalizedRegistry.content.length;
                    }
                    const compareHash = normalizedRegistryMainHash ?? registryHash;
                    const compareLength = normalizedRegistryMainLength ?? registryContent.length;
                    const matchesRaw = frontendHash === registryHash;
                    const matchesNormalized = normalizedRegistryMainHash ? frontendHash === normalizedRegistryMainHash : false;
                    const matchKind: 'raw' | 'normalized' | 'none' = matchesRaw
                        ? 'raw'
                        : (matchesNormalized ? 'normalized' : 'none');
                    frontendSnapshot = {
                        hash: frontendHash.substring(0, 8),
                        contentLength: frontendContent.length,
                        matchesRegistry: compareHash === frontendHash,
                        diffChars: Math.abs(frontendContent.length - compareLength),
                        registryLength: compareLength,
                        registryRawHash: registryRawMainHash?.substring(0, 8) ?? undefined,
                        registryRawLength: registryRawMainLength ?? undefined,
                        registryNormalizedHash: normalizedRegistryMainHash?.substring(0, 8) ?? undefined,
                        registryNormalizedLength: normalizedRegistryMainLength ?? undefined,
                        registryIsNormalized: normalizedRegistryMainHash !== null,
                        matchKind: matchKind
                    };
                } catch (error) {
                    console.warn('[DebugCommands] Failed to generate frontend snapshot hash:', error);
                }
            }

            for (const file of allFiles) {
                let canonicalContent: string;
                let savedFileContent: string | null = null;
                let frontendContent: string | null = null;
                let savedNormalizedHash: string | null = null;
                let savedNormalizedLength: number | null = null;
                let normalizedRegistryContent: string | null = null;
                let normalizedSavedContent: string | null = null;

                try {
                    if (fs.existsSync(file.getPath())) {
                        savedFileContent = fs.readFileSync(file.getPath(), 'utf8');
                    }
                } catch (error) {
                    console.error(`[DebugCommands] Could not read saved file ${file.getPath()}:`, error);
                }

                canonicalContent = file.getContent();

                if (file.getFileType() === 'main' && frontendBoard) {
                    try {
                        frontendContent = MarkdownKanbanParser.generateMarkdown(frontendBoard as KanbanBoard);
                    } catch (error) {
                        console.warn('[DebugCommands] Failed to generate frontend main markdown:', error);
                    }
                } else if (file.getFileType() !== 'main' && frontendBoard) {
                    frontendContent = this.resolveIncludeFrontendContentFromBoard(
                        frontendBoard as KanbanBoard,
                        file as IncludeFile
                    );
                }

                if (file.getFileType() === 'main') {
                    const normalizedRegistry = this.normalizeMainContent(canonicalContent, file.getPath());
                    normalizedRegistryContent = normalizedRegistry?.content ?? null;
                }

                const canonicalHash = this.computeHash(canonicalContent);
                const savedHash = savedFileContent !== null ? this.computeHash(savedFileContent) : null;
                const frontendHash = frontendContent ? this.computeHash(frontendContent) : null;

                const canonicalSavedMatch = savedHash ? canonicalHash === savedHash : true;
                let frontendRegistryMatch = frontendHash ? frontendHash === canonicalHash : null;
                let frontendRegistryDiff = frontendContent ? Math.abs(frontendContent.length - canonicalContent.length) : null;
                let frontendMatchesRaw = frontendHash ? frontendHash === canonicalHash : null;
                let frontendMatchesNormalized: boolean | null = null;
                if (file.getFileType() === 'main' && normalizedRegistryMainHash && frontendHash) {
                    frontendRegistryMatch = frontendHash === normalizedRegistryMainHash;
                    if (frontendContent && normalizedRegistryMainLength !== null) {
                        frontendRegistryDiff = Math.abs(frontendContent.length - normalizedRegistryMainLength);
                    }
                    frontendMatchesNormalized = frontendHash === normalizedRegistryMainHash;
                }
                if (file.getFileType() === 'main' && savedFileContent) {
                    const normalizedSaved = this.normalizeMainContent(savedFileContent, file.getPath());
                    if (normalizedSaved) {
                        savedNormalizedHash = this.computeHash(normalizedSaved.content);
                        savedNormalizedLength = normalizedSaved.content.length;
                        normalizedSavedContent = normalizedSaved.content;
                    }
                }
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
                    savedHash: savedHash?.substring(0, 8) ?? null,
                    registryNormalizedHash: file.getFileType() === 'main' && normalizedRegistryMainHash
                        ? normalizedRegistryMainHash.substring(0, 8)
                        : null,
                    registryNormalizedLength: file.getFileType() === 'main' && normalizedRegistryMainLength !== null
                        ? normalizedRegistryMainLength
                        : null,
                    frontendHash: frontendHash ? frontendHash.substring(0, 8) : null,
                    frontendContentLength: frontendContent ? frontendContent.length : null,
                    frontendRegistryMatch: frontendRegistryMatch,
                    frontendRegistryDiff: frontendRegistryDiff,
                    frontendMatchesRaw: frontendMatchesRaw,
                    frontendMatchesNormalized: frontendMatchesNormalized,
                    savedNormalizedHash: savedNormalizedHash ? savedNormalizedHash.substring(0, 8) : null,
                    savedNormalizedLength: savedNormalizedLength,
                    frontendAvailable: !!frontendContent
                });

                if (file.getFileType() === 'main' && frontendContent) {
                    const panelDebug = panel?.getDebugMode?.() ?? false;
                    if (panelDebug) {
                        this.logContentDiff('[DebugCommands] main.raw vs normalized', canonicalContent, normalizedRegistryContent);
                        if (savedFileContent) {
                            this.logContentDiff('[DebugCommands] main.saved raw vs normalized', savedFileContent, normalizedSavedContent);
                        }
                        this.logContentDiff('[DebugCommands] main.frontend vs normalized', frontendContent, normalizedRegistryContent);
                        this.logContentDiff('[DebugCommands] main.frontend vs saved raw', frontendContent, savedFileContent);
                    }
                }
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

    private resolveIncludeFrontendContentFromBoard(
        frontendBoard: KanbanBoard,
        file: IncludeFile
    ): string | null {
        const fileType = file.getFileType();
        if (fileType === 'include-regular') {
            return null;
        }

        const candidates = this.buildIncludePathCandidates(file.getRelativePath(), file.getPath());

        if (fileType === 'include-column') {
            const matches = frontendBoard.columns.filter(column =>
                column.includeFiles?.some(includePath => this.matchesIncludePath(includePath, candidates))
            );
            if (matches.length === 0) {
                return null;
            }
            const contents = matches.map(column => file.generateFromTasks(column.tasks));
            return this.ensureConsistentIncludeContent(contents, 'include-column', file.getRelativePath());
        }

        if (fileType === 'include-task') {
            const matches: string[] = [];
            for (const column of frontendBoard.columns) {
                for (const task of column.tasks) {
                    if (task.includeFiles?.some(includePath => this.matchesIncludePath(includePath, candidates))) {
                        matches.push(task.description || '');
                    }
                }
            }
            if (matches.length === 0) {
                return null;
            }
            return this.ensureConsistentIncludeContent(matches, 'include-task', file.getRelativePath());
        }

        return null;
    }

    private buildIncludePathCandidates(relativePath: string, absolutePath: string): Set<string> {
        const candidates = new Set<string>();
        const decodedRelative = safeDecodeURIComponent(relativePath || '');
        const decodedAbsolute = safeDecodeURIComponent(absolutePath || '');
        const normalizedRelative = this.normalizePath(decodedRelative);
        const normalizedAbsolute = this.normalizePath(decodedAbsolute);

        if (relativePath) candidates.add(relativePath);
        if (absolutePath) candidates.add(absolutePath);
        if (decodedRelative) candidates.add(decodedRelative);
        if (decodedAbsolute) candidates.add(decodedAbsolute);
        if (normalizedRelative) candidates.add(normalizedRelative);
        if (normalizedAbsolute) candidates.add(normalizedAbsolute);

        const baseName = normalizedRelative.split('/').pop() || normalizedAbsolute.split('/').pop();
        if (baseName) {
            candidates.add(baseName);
        }

        return candidates;
    }

    private matchesIncludePath(includePath: string, candidates: Set<string>): boolean {
        const decoded = safeDecodeURIComponent(includePath || '');
        const normalized = this.normalizePath(decoded);
        if (candidates.has(includePath) || candidates.has(decoded) || candidates.has(normalized)) {
            return true;
        }
        const baseName = normalized.split('/').pop();
        if (baseName && candidates.has(baseName)) {
            return true;
        }
        return false;
    }

    private ensureConsistentIncludeContent(contents: string[], fileType: string, relativePath: string): string {
        if (contents.length === 0) {
            return '';
        }
        const unique = new Set(contents);
        if (unique.size > 1) {
            console.warn(`[DebugCommands] ${fileType} include has inconsistent frontend content: ${relativePath}`);
        }
        return contents[0];
    }

    private normalizeMainContent(content: string, mainFilePath?: string): { content: string } | null {
        try {
            const parsed = MarkdownKanbanParser.parseMarkdown(content, undefined, undefined, mainFilePath);
            if (!parsed.board?.valid) {
                return null;
            }
            return { content: MarkdownKanbanParser.generateMarkdown(parsed.board) };
        } catch (error) {
            console.warn('[DebugCommands] Failed to normalize registry content:', error);
            return null;
       }
    }

    private logContentDiff(label: string, left: string | null, right: string | null): void {
        if (left === null || right === null) {
            return;
        }
        if (left === right) {
            return;
        }
        const diff = this.getFirstDiffSnippet(left, right);
        if (!diff) {
            return;
        }
        const leftLine = this.getLineAtIndex(left, diff.index);
        const rightLine = this.getLineAtIndex(right, diff.index);
        console.log(label, {
            leftLength: left.length,
            rightLength: right.length,
            diffIndex: diff.index,
            leftSnippet: diff.leftSnippet,
            rightSnippet: diff.rightSnippet,
            leftLine: leftLine ? { line: leftLine.line, text: JSON.stringify(leftLine.text) } : null,
            rightLine: rightLine ? { line: rightLine.line, text: JSON.stringify(rightLine.text) } : null,
            leftTrailing: this.getTrailingBlankInfo(left),
            rightTrailing: this.getTrailingBlankInfo(right),
            leftTailLines: this.getTailLines(left, 3),
            rightTailLines: this.getTailLines(right, 3)
        });
    }

    private getFirstDiffSnippet(left: string, right: string, context = 40): { index: number; leftSnippet: string; rightSnippet: string } | null {
        const minLen = Math.min(left.length, right.length);
        let index = 0;
        while (index < minLen && left.charCodeAt(index) === right.charCodeAt(index)) {
            index++;
        }
        if (index === minLen && left.length === right.length) {
            return null;
        }
        const start = Math.max(0, index - context);
        const leftEnd = Math.min(left.length, index + context);
        const rightEnd = Math.min(right.length, index + context);
        return {
            index,
            leftSnippet: JSON.stringify(left.slice(start, leftEnd)),
            rightSnippet: JSON.stringify(right.slice(start, rightEnd))
        };
    }

    private getLineAtIndex(content: string, index: number): { line: number; text: string } | null {
        if (index < 0 || index > content.length) {
            return null;
        }
        let line = 1;
        let lastBreak = -1;
        for (let i = 0; i < index; i++) {
            if (content.charCodeAt(i) === 10) {
                line++;
                lastBreak = i;
            }
        }
        const nextBreak = content.indexOf('\n', index);
        const lineEnd = nextBreak === -1 ? content.length : nextBreak;
        const lineText = content.slice(lastBreak + 1, lineEnd);
        return { line, text: lineText };
    }

    private getTrailingBlankInfo(content: string): { trailingBlankLines: number; trailingIndentBlankLines: number; trailingWhitespaceChars: number } {
        const lines = content.split('\n');
        let trailingBlankLines = 0;
        let trailingIndentBlankLines = 0;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line.trim() === '') {
                trailingBlankLines++;
                if (line === '  ') {
                    trailingIndentBlankLines++;
                }
            } else {
                break;
            }
        }
        const match = content.match(/\s+$/);
        const trailingWhitespaceChars = match ? match[0].length : 0;
        return {
            trailingBlankLines,
            trailingIndentBlankLines,
            trailingWhitespaceChars
        };
    }

    private getTailLines(content: string, count: number): string[] {
        const lines = content.split('\n');
        const tail = lines.slice(Math.max(0, lines.length - count));
        return tail.map(line => JSON.stringify(line));
    }

    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
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
