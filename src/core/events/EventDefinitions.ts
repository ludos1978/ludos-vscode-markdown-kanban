/**
 * Event Definitions for PanelEventBus
 *
 * All events in the system are defined here with their payload types.
 * This provides compile-time type safety for event emission and handling.
 *
 * NOTE: This is NEW infrastructure. No existing code is being replaced.
 * Events will be emitted IN PARALLEL with existing behavior during migration.
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from '../../markdownParser';
import * as vscode from 'vscode';

// ============= EVENT PAYLOAD TYPES =============

export interface BoardLoadingPayload {
    path: string;
}

export interface BoardLoadedPayload {
    board: KanbanBoard;
    source: 'file' | 'cache' | 'external_reload';
    mainFilePath?: string;
}

export interface BoardUpdatedPayload {
    board: KanbanBoard;
    changeType: string;
    previousBoard?: KanbanBoard;
}

export interface BoardDirtyPayload {
    dirtyColumns: string[];
    dirtyTasks: string[];
}

export interface BoardErrorPayload {
    error: Error;
    operation: string;
    path?: string;
}

export interface FileLoadRequestedPayload {
    uri: vscode.Uri;
    forceReload?: boolean;
    preserveUnsaved?: boolean;
}

export interface FileSaveRequestedPayload {
    silent?: boolean;
    includeAll?: boolean;
    createBackup?: boolean;
}

export interface FileChangedPayload {
    path: string;
    changeType: 'external' | 'save' | 'delete';
}

export interface FileConflictPayload {
    path: string;
    localContent: string;
    externalContent: string;
}

export interface FileSavedPayload {
    path: string;
    silent?: boolean;
}

export interface FileSaveErrorPayload {
    error: Error;
    path?: string;
}

export interface FileReloadRequestedPayload {
    path: string;
}

export interface FileReloadedPayload {
    path: string;
}

export interface FileUnsavedOnClosePayload {
    mainFile?: string;
    unsavedIncludes: string[];
}

export interface IncludeLoadedPayload {
    path: string;
    type: 'column' | 'task' | 'regular';
    targetId: string;
    columnId?: string;
    content: string;
}

export interface IncludeSavedPayload {
    path: string;
}

export interface IncludeErrorPayload {
    path: string;
    error: Error;
}

export interface IncludeSwitchRequestedPayload {
    type: 'column' | 'task';
    targetId: string;
    columnId?: string;
    oldPath: string;
    newPath: string;
}

export interface IncludeSwitchedPayload {
    type: 'column' | 'task';
    targetId: string;
    oldPath: string;
    newPath: string;
}

export interface EditStartedPayload {
    targetType: 'task' | 'column';
    targetId: string;
    columnId?: string;
}

export interface EditCompletedPayload {
    targetType: 'task' | 'column';
    targetId: string;
    columnId?: string;
    value: string;
}

export interface EditCancelledPayload {
    targetType: 'task' | 'column';
    targetId: string;
}

export interface UndoRedoStateChangedPayload {
    canUndo: boolean;
    canRedo: boolean;
}

export interface UndoCompletedPayload {
    board: KanbanBoard;
}

export interface RedoCompletedPayload {
    board: KanbanBoard;
}

export interface WebviewMessagePayload {
    message: any;
}

export interface DebugEventSlowPayload {
    eventType: string;
    eventId: string;
    duration: number;
}

export interface DebugHandlerErrorPayload {
    eventType: string;
    eventId: string;
    error: Error;
    handlerName: string;
}

export interface BridgeReadyPayload {
    bridge: any; // WebviewBridge - using any to avoid circular dependency
}

// ============= EVENT DEFINITIONS MAP =============

/**
 * Central registry of all event types and their payloads.
 * Add new events here to get type safety everywhere.
 */
export interface EventDefinitions {
    // Board lifecycle
    'board:loading': BoardLoadingPayload;
    'board:loaded': BoardLoadedPayload;
    'board:updated': BoardUpdatedPayload;
    'board:dirty': BoardDirtyPayload;
    'board:clean': undefined;
    'board:error': BoardErrorPayload;
    'board:load_cancelled': { reason: string };

    // File operations
    'file:load_requested': FileLoadRequestedPayload;
    'file:save_requested': FileSaveRequestedPayload;
    'file:reload_requested': FileReloadRequestedPayload;
    'file:saved': FileSavedPayload;
    'file:save_error': FileSaveErrorPayload;
    'file:changed': FileChangedPayload;
    'file:conflict': FileConflictPayload;
    'file:reloaded': FileReloadedPayload;
    'file:unsaved_on_close': FileUnsavedOnClosePayload;

    // Include files
    'include:loaded': IncludeLoadedPayload;
    'include:saved': IncludeSavedPayload;
    'include:error': IncludeErrorPayload;
    'include:switch_requested': IncludeSwitchRequestedPayload;
    'include:switched': IncludeSwitchedPayload;

    // Edit session
    'edit:started': EditStartedPayload;
    'edit:completed': EditCompletedPayload;
    'edit:cancelled': EditCancelledPayload;

    // Undo/Redo
    'undo:requested': undefined;
    'redo:requested': undefined;
    'undo:completed': UndoCompletedPayload;
    'redo:completed': RedoCompletedPayload;
    'undoredo:state_changed': UndoRedoStateChangedPayload;

    // Webview
    'webview:ready': undefined;
    'webview:message': WebviewMessagePayload;

    // Panel lifecycle
    'panel:initialized': undefined;
    'panel:visible': undefined;
    'panel:disposing': undefined;

    // Debug/Monitoring (internal use)
    'debug:event_slow': DebugEventSlowPayload;
    'debug:handler_error': DebugHandlerErrorPayload;

    // Bridge lifecycle
    'bridge:ready': BridgeReadyPayload;
}

// ============= TYPE HELPERS =============

/**
 * Get the payload type for a specific event
 */
export type EventPayload<K extends keyof EventDefinitions> = EventDefinitions[K];

/**
 * All valid event type names
 */
export type EventType = keyof EventDefinitions;
