/**
 * Unified File State Management System
 *
 * This module provides a single source of truth for all file state tracking,
 * clearly separating backend (file system) changes from frontend (Kanban UI) changes.
 *
 * ===== SPECIFICATION (ONLY CORRECT BEHAVIOR) =====
 *
 * When to show conflict dialog vs auto-reload:
 *
 * SHOW DIALOG when:
 *   - External file modified AND (has unsaved changes OR is in edit mode)
 *
 * AUTO-RELOAD when:
 *   - External file modified AND NOT has unsaved changes AND NOT in edit mode
 *
 * File Types:
 *   - 'main': Main kanban markdown file
 *   - 'include-column': Column include (!!!columninclude) - can be edited
 *   - 'include-task': Task include (!!!taskinclude) - can be edited
 *   - 'include-regular': Regular include (!!!include) - ALWAYS auto-reload (cannot be edited)
 *
 * NOTE: Edit mode tracking not yet implemented
 * TODO: Add isInEditMode field to FileState.frontend
 *
 * =================================================
 */

import * as vscode from 'vscode';

/**
 * Represents the complete state of a file
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

/**
 * Manages all file states for the Kanban system
 */
export class FileStateManager {
    private static instance: FileStateManager;
    private fileStates: Map<string, FileState> = new Map();

    private constructor() {}

    public static getInstance(): FileStateManager {
        if (!FileStateManager.instance) {
            FileStateManager.instance = new FileStateManager();
        }
        return FileStateManager.instance;
    }

    /**
     * Initialize or update a file's state
     */
    public initializeFile(
        path: string,
        relativePath: string,
        isMainFile: boolean,
        fileType: 'main' | 'include-regular' | 'include-column' | 'include-task',
        initialContent?: string
    ): FileState {
        let state = this.fileStates.get(path);

        if (!state) {
            state = {
                path,
                relativePath,
                isMainFile,
                fileType,
                backend: {
                    exists: true,
                    lastModified: null,
                    isDirtyInEditor: false,
                    documentVersion: 0,
                    hasFileSystemChanges: false
                },
                frontend: {
                    hasUnsavedChanges: false,
                    content: initialContent || '',
                    baseline: initialContent || '',
                    isInEditMode: false
                },
                needsReload: false,
                needsSave: false,
                hasConflict: false
            };
            this.fileStates.set(path, state);
        }

        return state;
    }

    /**
     * Update backend state when file changes on disk
     */
    public markFileSystemChange(path: string): void {
        const state = this.fileStates.get(path);
        if (state) {
            state.backend.hasFileSystemChanges = true;
            state.backend.lastModified = new Date();
            this.updateComputedState(state);
        }
    }

    /**
     * Update backend state when document changes in VS Code editor
     */
    public markEditorChange(path: string, isDirty: boolean, version: number): void {
        const state = this.fileStates.get(path);
        if (state) {
            state.backend.isDirtyInEditor = isDirty;
            state.backend.documentVersion = version;
            this.updateComputedState(state);
        }
    }

    /**
     * Update frontend state when Kanban UI modifies content
     */
    public markFrontendChange(path: string, hasChanges: boolean, content?: string): void {
        const state = this.fileStates.get(path);
        if (state) {
            state.frontend.hasUnsavedChanges = hasChanges;
            if (content !== undefined) {
                state.frontend.content = content;
            }
            this.updateComputedState(state);
        }
    }

    /**
     * Mark file as saved (clears frontend changes)
     */
    public markSaved(path: string, newBaseline: string): void {
        const state = this.fileStates.get(path);
        if (state) {
            state.frontend.hasUnsavedChanges = false;
            state.frontend.baseline = newBaseline;
            state.frontend.content = newBaseline;
            state.backend.hasFileSystemChanges = false;
            state.backend.isDirtyInEditor = false;
            this.updateComputedState(state);
        }
    }

    /**
     * Mark file as reloaded (clears backend changes)
     */
    public markReloaded(path: string, newContent: string): void {
        const state = this.fileStates.get(path);
        if (state) {
            state.backend.hasFileSystemChanges = false;
            state.backend.isDirtyInEditor = false;
            state.frontend.content = newContent;
            state.frontend.baseline = newContent;
            state.frontend.hasUnsavedChanges = false;
            this.updateComputedState(state);
            // console.log(`[FileStateManager.markReloaded] ========================================`);
            // console.log(`[FileStateManager.markReloaded] Path: ${path}`);
            // console.log(`[FileStateManager.markReloaded] New baseline (first 100 chars): "${newContent.substring(0, 100)}"`);
            // console.log(`[FileStateManager.markReloaded] Baseline length: ${newContent.length}`);
            // console.log(`[FileStateManager.markReloaded] hasUnsavedChanges cleared to: false`);
        }
    }

    /**
     * Mark file as being in edit mode (user has cursor in task/column editor)
     */
    public markEditModeStart(path: string): void {
        const state = this.fileStates.get(path);
        if (state) {
            state.frontend.isInEditMode = true;
            this.updateComputedState(state);
            console.log(`[FileStateManager.markEditModeStart] Edit mode started for: ${path}`);
        }
    }

    /**
     * Mark file as no longer being in edit mode
     */
    public markEditModeEnd(path: string): void {
        const state = this.fileStates.get(path);
        if (state) {
            state.frontend.isInEditMode = false;
            this.updateComputedState(state);
            console.log(`[FileStateManager.markEditModeEnd] Edit mode ended for: ${path}`);
        }
    }

    /**
     * Check if file is in edit mode
     */
    public isInEditMode(path: string): boolean {
        const state = this.fileStates.get(path);
        return state?.frontend.isInEditMode ?? false;
    }

    /**
     * Update computed state based on backend and frontend states
     *
     * SPEC REQUIREMENT: Auto-reload ONLY if no unsaved changes AND not in edit mode
     */
    private updateComputedState(state: FileState): void {
        // Need to reload if backend has changes but frontend doesn't AND not in edit mode
        state.needsReload = (state.backend.hasFileSystemChanges || state.backend.isDirtyInEditor)
                          && !state.frontend.hasUnsavedChanges
                          && !state.frontend.isInEditMode;

        // Need to save if frontend has changes
        state.needsSave = state.frontend.hasUnsavedChanges;

        // Has conflict if both have changes OR user is editing while backend changed
        state.hasConflict = (state.frontend.hasUnsavedChanges || state.frontend.isInEditMode)
                         && (state.backend.hasFileSystemChanges || state.backend.isDirtyInEditor);
    }

    /**
     * Get state for a specific file
     */
    public getFileState(path: string): FileState | undefined {
        return this.fileStates.get(path);
    }

    /**
     * Get all file states
     */
    public getAllStates(): Map<string, FileState> {
        return new Map(this.fileStates);
    }

    /**
     * Get all include file states (non-main files)
     */
    public getAllIncludeFiles(): FileState[] {
        return Array.from(this.fileStates.values()).filter(s => !s.isMainFile);
    }

    /**
     * Get include file by relative path
     */
    public getIncludeFileByRelativePath(relativePath: string): FileState | undefined {
        return Array.from(this.fileStates.values()).find(s => s.relativePath === relativePath && !s.isMainFile);
    }

    /**
     * Check if any include files have unsaved changes
     */
    public hasUnsavedIncludeFiles(): boolean {
        return this.getAllIncludeFiles().some(file => file.frontend.hasUnsavedChanges);
    }

    /**
     * Get legacy type from FileState fileType
     */
    public static getLegacyType(fileType: string): 'regular' | 'column' | 'task' {
        switch (fileType) {
            case 'include-column': return 'column';
            case 'include-task': return 'task';
            case 'include-regular': return 'regular';
            default: return 'regular';
        }
    }

    /**
     * Get FileState fileType from legacy type
     */
    public static getFileType(type: 'regular' | 'column' | 'task'): 'include-regular' | 'include-column' | 'include-task' {
        switch (type) {
            case 'column': return 'include-column';
            case 'task': return 'include-task';
            case 'regular': return 'include-regular';
        }
    }

    /**
     * Update file content (updates frontend content but not baseline)
     */
    public updateContent(path: string, content: string): void {
        const state = this.fileStates.get(path);
        if (state) {
            state.frontend.content = content;
            state.backend.lastModified = new Date();
            this.updateComputedState(state);
        }
    }

    /**
     * Get summary for debug overlay
     */
    public getDebugSummary(): any {
        const states = Array.from(this.fileStates.values());

        return {
            totalFiles: states.length,
            mainFile: states.find(s => s.isMainFile),
            includeFiles: states.filter(s => !s.isMainFile),
            filesNeedingReload: states.filter(s => s.needsReload).length,
            filesNeedingSave: states.filter(s => s.needsSave).length,
            filesWithConflicts: states.filter(s => s.hasConflict).length
        };
    }

    /**
     * Clear state for a file
     */
    public clearFileState(path: string): void {
        this.fileStates.delete(path);
        console.log(`[FileStateManager] Cleared state for: ${path}`);
    }

    /**
     * Clear all states
     */
    public clearAll(): void {
        this.fileStates.clear();
        console.log(`[FileStateManager] Cleared all file states`);
    }
}

/**
 * Global instance getter for convenience
 */
export function getFileStateManager(): FileStateManager {
    return FileStateManager.getInstance();
}