/**
 * ChangeTypes - Shared types for the change state machine
 *
 * Extracted from ChangeStateMachine.ts to break circular dependency
 * with IncludeLoadingProcessor.ts
 *
 * @module core/ChangeTypes
 */

import * as vscode from 'vscode';
import { MarkdownFile } from '../files/MarkdownFile';
import { KanbanBoard, KanbanTask } from '../markdownParser';
import { CapturedEdit } from '../files/FileInterfaces';
import { BoardChangeTrigger } from './events';

// Re-export for consumers
export { CapturedEdit };

// ============= DEPENDENCY INTERFACES =============

/**
 * Interface for file registry methods used by ChangeStateMachine
 * Avoids circular dependency with MarkdownFileRegistry
 */
export interface IFileRegistryForStateMachine {
    getByRelativePath(path: string): MarkdownFile | undefined;
    getMainFile(): MarkdownFile | undefined;
    requestStopEditing?(): Promise<CapturedEdit | undefined>;
}

/**
 * Interface for webview panel methods used by ChangeStateMachine
 * Avoids circular dependency with KanbanWebviewPanel
 */
export interface IWebviewPanelForStateMachine {
    setIncludeSwitchInProgress(inProgress: boolean): void;
    isEditingInProgress?(): boolean;
    getBoard(): KanbanBoard | undefined;
    getPanel(): vscode.WebviewPanel | undefined;
    syncIncludeFilesWithBoard?(board: KanbanBoard): void;
    /** Emit board:changed event to sync board state */
    emitBoardChanged?(board: KanbanBoard, trigger?: BoardChangeTrigger): void;
    invalidateBoardCache?(): void;
    refreshWebviewContent?(): Promise<void>;
    clearColumnDirty?(columnId: string): void;
    clearTaskDirty?(taskId: string): void;
}

// ============= STATUS MESSAGES =============

/**
 * Internal status message for state machine tracking
 * These are not OutgoingMessage types - they're internal status indicators
 */
export interface StateMachineStatusMessage {
    type: string;
    [key: string]: unknown;
}

// ============= STATE DEFINITIONS =============

/**
 * Simplified state machine states
 *
 * VALIDATE: Capture edits, check unsaved, prompt user, save if needed
 * LOAD: Clear old includes, register files, ALWAYS reload content, parse
 * UPDATE: Update backend, emit events, sync frontend
 * COMPLETE/CANCELLED/ERROR: Terminal states
 */
export enum ChangeState {
    IDLE = 'IDLE',
    VALIDATE = 'VALIDATE',
    LOAD = 'LOAD',
    UPDATE = 'UPDATE',
    COMPLETE = 'COMPLETE',
    CANCELLED = 'CANCELLED',
    ERROR = 'ERROR'
}

// ============= EVENT TYPES =============

export interface FileSystemChangeEvent {
    type: 'file_system_change';
    file: MarkdownFile;
    changeType: 'modified' | 'deleted' | 'created';
    timestamp: number;
}

export interface UserEditEvent {
    type: 'user_edit';
    editType: 'task_title' | 'task_description' | 'column_title';
    params: {
        taskId?: string;
        columnId?: string;
        value: string;
        includeSwitch?: {
            oldFiles: string[];
            newFiles: string[];
        };
    };
}

export interface SaveEvent {
    type: 'save';
    file: MarkdownFile;
    source: 'user_command' | 'auto_save' | 'pre_unload';
}

export interface IncludeSwitchEvent {
    type: 'include_switch';
    target: 'column' | 'task';
    targetId: string;
    columnIdForTask?: string;
    oldFiles: string[];
    newFiles: string[];
    newTitle?: string;
    /** Pre-loaded content for include files (bypasses registry caching) */
    preloadedContent?: Map<string, string>;
}

export type ChangeEvent =
    | FileSystemChangeEvent
    | UserEditEvent
    | SaveEvent
    | IncludeSwitchEvent;

// ============= CHANGE CONTEXT =============

/**
 * Context object passed through all state transitions
 * Contains all information needed to process the change
 */
export interface ChangeContext {
    // Original event that triggered this change
    event: ChangeEvent;

    // Impact analysis results
    impact: {
        mainFileChanged: boolean;
        includeFilesChanged: boolean;
        includesSwitched: boolean;
        affectedFiles: MarkdownFile[];
    };

    // Edit state capture
    editCapture?: {
        wasEditing: boolean;
        editedFile?: MarkdownFile;
        capturedValue?: CapturedEdit;
    };

    // Unsaved files management
    unsaved: {
        files: MarkdownFile[];
        userChoice?: 'save' | 'discard' | 'cancel';
    };

    // Switch operations
    switches: {
        oldFiles: string[];
        newFiles: string[];
        unloadingFiles: string[];
        loadingFiles: string[];
    };

    // Result tracking
    result: {
        success: boolean;
        error?: Error;
        updatedFiles: string[];
        frontendMessages: StateMachineStatusMessage[];
    };

    // Modified board reference (to avoid re-fetching stale data)
    modifiedBoard?: KanbanBoard;

    // Rollback data for error recovery
    rollback?: {
        columnId?: string;
        taskId?: string;
        taskColumnId?: string;
        oldState: {
            title?: string;
            tasks?: KanbanTask[];
            includeFiles?: string[];
            includeMode?: boolean;
            description?: string;
            displayTitle?: string;
        };
    };

    // Metadata
    startTime: number;
    currentState: ChangeState;
    stateHistory: ChangeState[];
}

// ============= CHANGE RESULT =============

export interface ChangeResult {
    success: boolean;
    error?: Error;
    context: ChangeContext;
    duration: number;
}
