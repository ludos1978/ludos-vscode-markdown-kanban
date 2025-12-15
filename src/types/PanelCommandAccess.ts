/**
 * PanelCommandAccess - Interface for command access to panel internals
 *
 * This interface documents the panel methods and properties that commands need to access.
 * Commands cast the panel to this type instead of `any` for better type safety.
 *
 * Note: These are internal implementation details exposed for command access.
 * Consider refactoring to expose proper public APIs in the future.
 */

import * as vscode from 'vscode';
import { KanbanBoard } from '../markdownParser';
import { ConflictResolver } from '../services/ConflictResolver';
import { MessageHandler } from '../messageHandler';
import { EditingStoppedMessage, BoardUpdateFromFrontendMessage } from '../core/bridge/MessageTypes';

/**
 * Extended MessageHandler interface for command access
 *
 * The MessageHandler class may have additional methods not exposed in its base type.
 * Commands use this interface to access handler methods.
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
export interface MessageHandlerCommandAccess extends MessageHandler {
    // Edit mode lifecycle (may not be on base type)
    handleEditModeStart?(message: unknown): Promise<void>;
    handleEditModeEnd?(message: unknown): Promise<void>;
    handleEditingStopped(message: EditingStoppedMessage): Promise<void>;
    handleBoardUpdate(message: BoardUpdateFromFrontendMessage): Promise<void>;

    // Internal handlers
    _handleColumnsUnfolded?(requestId: string): void;

    // Page/settings handlers
    handlePageHiddenWithUnsavedChanges?(): Promise<void>;
    handleUpdateMarpGlobalSetting?(key: string, value: unknown): Promise<void>;

    // Editor handlers
    handleVSCodeSnippet?(message: unknown): Promise<void>;
    handleEditorShortcut?(message: unknown): Promise<void>;

    // Template handlers
    handleGetTemplates?(): Promise<void>;
    handleApplyTemplate?(message: unknown): Promise<void>;
    handleSubmitTemplateVariables?(message: unknown): Promise<void>;
}

/**
 * Include file metadata stored in panel's _includeFiles map
 */
export interface IncludeFileInfo {
    content: string;
    baseline: string;
    hasUnsavedChanges: boolean;
    lastModified: number;
    absolutePath?: string;
}

/**
 * Internal file service access - commands access private methods
 * Uses 'any' return/param types to allow flexible access to private methods
 */
export type FileServiceAccess = Record<string, (...args: any[]) => any>;

/**
 * Interface for command access to KanbanWebviewPanel
 * Use this instead of `as any` when commands need panel internals
 *
 * Note: Some properties like _fileService provide access to private methods,
 * so they use flexible types to avoid strict type checking on internal APIs.
 */
export interface PanelCommandAccess {
    // Include file management
    _includeFiles?: Map<string, IncludeFileInfo>;
    ensureIncludeFileRegistered?(relativePath: string, type: string): void;
    updateIncludeFileContent?(relativePath: string, content: string, fromDisk: boolean): void;
    _readFileContent?(relativePath: string): Promise<string | null>;

    // File loading
    loadMarkdownFile?(document: vscode.TextDocument, forceReload?: boolean): Promise<void>;

    // Services access - flexible types for private method access
    _fileService?: FileServiceAccess;
    _conflictResolver?: ConflictResolver;
    _conflictService?: {
        createUnifiedBackup(filePath: string, reason: string, includeMetadata: boolean): Promise<string>;
    };
    _messageHandler?: MessageHandlerCommandAccess;

    // Cache management
    _cachedBoardFromWebview?: KanbanBoard | null;
}

/**
 * Type guard to check if panel has required include file methods
 */
export function hasIncludeFileMethods(panel: unknown): panel is PanelCommandAccess {
    const p = panel as PanelCommandAccess;
    return p !== null &&
           typeof p === 'object' &&
           (typeof p.ensureIncludeFileRegistered === 'function' ||
            typeof p.updateIncludeFileContent === 'function' ||
            p._includeFiles instanceof Map);
}

/**
 * Type guard to check if panel has message handler
 */
export function hasMessageHandler(panel: unknown): panel is PanelCommandAccess & { _messageHandler: MessageHandlerCommandAccess } {
    const p = panel as PanelCommandAccess;
    return p !== null &&
           typeof p === 'object' &&
           p._messageHandler !== undefined;
}

/**
 * Type guard to check if panel has conflict resolver
 */
export function hasConflictResolver(panel: unknown): panel is PanelCommandAccess & { _conflictResolver: ConflictResolver } {
    const p = panel as PanelCommandAccess;
    return p !== null &&
           typeof p === 'object' &&
           p._conflictResolver !== undefined;
}

/**
 * Type guard to check if panel has conflict service
 */
export function hasConflictService(panel: unknown): panel is PanelCommandAccess & { _conflictService: NonNullable<PanelCommandAccess['_conflictService']> } {
    const p = panel as PanelCommandAccess;
    return p !== null &&
           typeof p === 'object' &&
           p._conflictService !== undefined &&
           typeof p._conflictService.createUnifiedBackup === 'function';
}
