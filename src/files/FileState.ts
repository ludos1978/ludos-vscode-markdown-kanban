/**
 * FileState interface - compatibility layer for legacy code
 *
 * This interface represents the old FileStateManager's state structure.
 * It's kept for backward compatibility with code that still uses toFileState().
 * New code should use MarkdownFile methods directly instead of FileState.
 */
export interface FileState {
    // File identification
    path: string;
    relativePath: string;
    isMainFile: boolean;
    fileType: 'main' | 'include-regular' | 'include-column' | 'include-task';

    // Backend states (file system & VS Code editor)
    backend: {
        exists: boolean;
        lastModified: Date | null;
        isDirtyInEditor: boolean;      // VS Code editor has unsaved changes
        documentVersion: number;        // VS Code document version
        lastDocumentVersion: number;    // Previous document version
        hasFileSystemChanges: boolean; // File changed on disk outside VS Code
    };

    // Frontend states (Kanban UI)
    frontend: {
        hasUnsavedChanges: boolean;    // Kanban UI has modifications
        content: string;                // Current content in Kanban
        baseline: string;               // Last known saved content
        isInEditMode: boolean;          // User is actively editing (cursor in task/column editor)
    };

    // Computed state
    needsReload: boolean;              // Backend changes need to be loaded into frontend (if not editing and no unsaved changes)
    needsSave: boolean;                // Frontend changes need to be saved to backend
    hasConflict: boolean;              // Both backend and frontend have changes (or user is editing while backend changed)
}
