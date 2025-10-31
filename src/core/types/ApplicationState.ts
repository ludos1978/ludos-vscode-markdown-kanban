/**
 * Application State Types
 *
 * Defines the single source of truth for all application state.
 */

/**
 * File State - Complete state for any file in the system
 */
export interface FileState {
    // Identity
    path: string;
    relativePath: string;
    normalizedRelativePath: string;
    fileType: 'main' | 'include-regular' | 'include-column' | 'include-task';

    // Content
    content: string;
    baseline: string;

    // Backend State (VS Code & File System)
    exists: boolean;
    lastModified: Date | null;
    isDirtyInEditor: boolean;
    documentVersion: number;
    hasFileSystemChanges: boolean;

    // Frontend State (Kanban UI)
    hasUnsavedChanges: boolean;
    isInEditMode: boolean;

    // Metadata
    lastExternalSaveTime?: Date;
    externalChangeTime?: Date;
    version: number;
}

/**
 * Board State - Complete kanban board state
 */
export interface BoardState {
    board: import('../../domain/models/KanbanBoard').KanbanBoard | null;
    version: number;
    lastSync: Date | null;
    isCacheValid: boolean;
}

/**
 * Conflict State - Current conflict status
 */
export interface ConflictState {
    activeConflicts: import('./ConflictTypes').Conflict[];
    lastConflictCheck: Date | null;
    isDialogActive: boolean;
}

/**
 * Save State - Current save operation status
 */
export interface SaveState {
    isProcessing: boolean;
    currentOperation: import('../interfaces/ISaveManager').SaveOperation | null;
    queueLength: number;
    lastSaveTime: Date | null;
}

/**
 * Complete Application State
 */
export interface ApplicationState {
    files: Map<string, FileState>;
    board: BoardState;
    conflicts: ConflictState;
    save: SaveState;
    version: number;
    lastUpdate: Date;
}

/**
 * State Update Types
 */
export type StateUpdate =
    | { type: 'file-update'; filePath: string; state: Partial<FileState> }
    | { type: 'board-update'; state: Partial<BoardState> }
    | { type: 'conflict-update'; state: Partial<ConflictState> }
    | { type: 'save-update'; state: Partial<SaveState> }
    | { type: 'reset' };

/**
 * State Subscriber
 */
export interface StateSubscriber {
    onStateUpdate(update: StateUpdate, newState: ApplicationState): void;
}

/**
 * State Manager Interface
 */
export interface IStateManager {
    getState(): ApplicationState;
    update(update: StateUpdate): void;
    subscribe(subscriber: StateSubscriber): () => void;
    getFileState(filePath: string): FileState | undefined;
    updateFileState(filePath: string, state: Partial<FileState>): void;
    reset(): void;
}
