/**
 * UndoCapture - Smart undo/redo entry creation with target tracking
 *
 * Captures metadata about what changed so undo/redo can perform
 * targeted updates instead of full board refresh.
 *
 * Plan 3C: Hybrid Smart Approach
 * - Uses existing ChangeEvent types for event-based operations
 * - Provides helper methods for manual call sites
 * - Stores resolved targets for targeted updates
 */

import { KanbanBoard } from '../../markdownParser';
import { ChangeEvent, UserEditEvent, IncludeSwitchEvent } from '../ChangeTypes';

// ============= TYPES =============

/**
 * Resolved target - what was actually changed
 */
export interface ResolvedTarget {
    type: 'task' | 'column';
    id: string;
    /** Column ID when target is a task */
    columnId?: string;
    /** Content hash for comparison (optional) */
    contentHash?: string;
}

/**
 * Source information for the undo entry
 */
export interface UndoSource {
    type: 'event' | 'manual' | 'inferred';
    /** Original ChangeEvent if event-based */
    event?: ChangeEvent;
    /** Operation name for manual captures */
    operation?: string;
}

/**
 * Enhanced undo entry with target metadata
 */
export interface UndoEntry {
    /** The board state to restore */
    board: KanbanBoard;
    /** Targets that were changed (for targeted updates) */
    targets: ResolvedTarget[];
    /** Source of this change */
    source: UndoSource;
    /** Timestamp when captured */
    timestamp: number;
}

// ============= HELPER FUNCTIONS =============

function deepCloneBoard(board: KanbanBoard): KanbanBoard {
    return JSON.parse(JSON.stringify(board));
}

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

// ============= MAIN CLASS =============

/**
 * Factory for creating UndoEntry objects with proper target resolution
 */
export class UndoCapture {

    /**
     * Create an UndoEntry from a ChangeEvent
     * Automatically resolves targets from the event
     */
    static fromEvent(board: KanbanBoard, event: ChangeEvent): UndoEntry {
        const targets = UndoCapture.resolveTargetsFromEvent(event, board);

        return {
            board: deepCloneBoard(board),
            targets,
            source: {
                type: 'event',
                event
            },
            timestamp: Date.now()
        };
    }

    /**
     * Create an UndoEntry for a single task change
     */
    static forTask(board: KanbanBoard, taskId: string, columnId: string, operation: string): UndoEntry {
        const task = UndoCapture.findTaskInBoard(board, taskId);

        return {
            board: deepCloneBoard(board),
            targets: [{
                type: 'task',
                id: taskId,
                columnId,
                contentHash: task ? simpleHash(JSON.stringify(task)) : undefined
            }],
            source: {
                type: 'manual',
                operation
            },
            timestamp: Date.now()
        };
    }

    /**
     * Create an UndoEntry for a single column change
     */
    static forColumn(board: KanbanBoard, columnId: string, operation: string): UndoEntry {
        const column = board.columns.find(c => c.id === columnId);

        return {
            board: deepCloneBoard(board),
            targets: [{
                type: 'column',
                id: columnId,
                contentHash: column ? simpleHash(JSON.stringify(column)) : undefined
            }],
            source: {
                type: 'manual',
                operation
            },
            timestamp: Date.now()
        };
    }

    /**
     * Create an UndoEntry for multiple targets
     */
    static forMultiple(board: KanbanBoard, targets: ResolvedTarget[], operation: string): UndoEntry {
        return {
            board: deepCloneBoard(board),
            targets,
            source: {
                type: 'manual',
                operation
            },
            timestamp: Date.now()
        };
    }

    /**
     * Create an UndoEntry for a full board change (no targeted update possible)
     */
    static forFullBoard(board: KanbanBoard, operation: string): UndoEntry {
        return {
            board: deepCloneBoard(board),
            targets: [], // Empty targets = full board update needed
            source: {
                type: 'manual',
                operation
            },
            timestamp: Date.now()
        };
    }

    /**
     * Create an UndoEntry with inferred targets
     * Used when call site doesn't provide target info
     */
    static inferred(board: KanbanBoard, operation: string): UndoEntry {
        return {
            board: deepCloneBoard(board),
            targets: [], // Will trigger full board refresh
            source: {
                type: 'inferred',
                operation
            },
            timestamp: Date.now()
        };
    }

    // ============= TARGET RESOLUTION =============

    /**
     * Resolve targets from a ChangeEvent
     */
    private static resolveTargetsFromEvent(event: ChangeEvent, board: KanbanBoard): ResolvedTarget[] {
        switch (event.type) {
            case 'user_edit':
                return UndoCapture.resolveUserEditTargets(event, board);

            case 'include_switch':
                return UndoCapture.resolveIncludeSwitchTargets(event, board);

            case 'file_system_change':
            case 'save':
                // File system changes can affect multiple elements - need full refresh
                return [];

            default:
                return [];
        }
    }

    /**
     * Resolve targets from a UserEditEvent
     */
    private static resolveUserEditTargets(event: UserEditEvent, board: KanbanBoard): ResolvedTarget[] {
        const targets: ResolvedTarget[] = [];

        if (event.editType === 'task_title' || event.editType === 'task_description') {
            if (event.params.taskId) {
                const columnId = UndoCapture.findColumnForTask(board, event.params.taskId);
                targets.push({
                    type: 'task',
                    id: event.params.taskId,
                    columnId
                });
            }
        } else if (event.editType === 'column_title') {
            if (event.params.columnId) {
                targets.push({
                    type: 'column',
                    id: event.params.columnId
                });
            }
        }

        return targets;
    }

    /**
     * Resolve targets from an IncludeSwitchEvent
     */
    private static resolveIncludeSwitchTargets(event: IncludeSwitchEvent, _board: KanbanBoard): ResolvedTarget[] {
        const targets: ResolvedTarget[] = [];

        if (event.target === 'task') {
            targets.push({
                type: 'task',
                id: event.targetId,
                columnId: event.columnIdForTask
            });
        } else if (event.target === 'column') {
            targets.push({
                type: 'column',
                id: event.targetId
            });
        }

        return targets;
    }

    // ============= BOARD HELPERS =============

    /**
     * Find which column contains a task
     */
    private static findColumnForTask(board: KanbanBoard, taskId: string): string | undefined {
        for (const column of board.columns) {
            const task = column.tasks.find(t => t.id === taskId);
            if (task) {
                return column.id;
            }
        }
        return undefined;
    }

    /**
     * Find a task in the board
     */
    private static findTaskInBoard(board: KanbanBoard, taskId: string): unknown | undefined {
        for (const column of board.columns) {
            const task = column.tasks.find(t => t.id === taskId);
            if (task) {
                return task;
            }
        }
        return undefined;
    }

    // ============= UTILITY METHODS =============

    /**
     * Check if an UndoEntry supports targeted update
     */
    static supportsTargetedUpdate(entry: UndoEntry): boolean {
        return entry.targets.length > 0;
    }

    /**
     * Check if an UndoEntry is a single-element change
     */
    static isSingleElementChange(entry: UndoEntry): boolean {
        return entry.targets.length === 1;
    }

    /**
     * Get the primary target from an entry (if single element)
     */
    static getPrimaryTarget(entry: UndoEntry): ResolvedTarget | undefined {
        return entry.targets.length === 1 ? entry.targets[0] : undefined;
    }
}
