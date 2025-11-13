import { KanbanBoard, KanbanColumn, KanbanTask } from '../../markdownParser';

/**
 * Prototype Pattern - Board State Cloning
 *
 * Creates deep clones of board states for undo/redo operations
 * and safe state manipulation without side effects.
 */

export interface IPrototype<T> {
    clone(): T;
}

export class BoardPrototype implements IPrototype<KanbanBoard> {
    constructor(private board: KanbanBoard) {}

    /**
     * Deep clone the board state
     */
    clone(): KanbanBoard {
        return {
            valid: this.board.valid,
            title: this.board.title,
            columns: this.board.columns.map(column => this.cloneColumn(column)),
            yamlHeader: this.board.yamlHeader,
            kanbanFooter: this.board.kanbanFooter
        };
    }

    /**
     * Clone a column with all its tasks
     */
    private cloneColumn(column: KanbanColumn): KanbanColumn {
        return {
            id: column.id,
            title: column.title,
            originalTitle: column.originalTitle,
            displayTitle: column.displayTitle,
            tasks: column.tasks.map(task => this.cloneTask(task)),
            includeMode: column.includeMode,
            includeFiles: column.includeFiles ? [...column.includeFiles] : undefined,
            isLoadingContent: column.isLoadingContent
        };
    }

    /**
     * Clone a task with all its properties
     */
    private cloneTask(task: KanbanTask): KanbanTask {
        return {
            id: task.id,
            title: task.title,
            originalTitle: task.originalTitle,
            displayTitle: task.displayTitle,
            description: task.description,
            includeMode: task.includeMode,
            includeFiles: task.includeFiles ? [...task.includeFiles] : undefined,
            isLoadingContent: task.isLoadingContent,
            // Clone any additional properties that might exist
            ...(task as any)
        };
    }
}

/**
 * Board State Manager with Prototype Support
 */
export class BoardStateManager {
    private states: Map<string, KanbanBoard> = new Map();
    private currentStateId: string | null = null;

    /**
     * Save a board state with an identifier
     */
    saveState(id: string, board: KanbanBoard): void {
        const prototype = new BoardPrototype(board);
        const clonedBoard = prototype.clone();
        this.states.set(id, clonedBoard);

        if (!this.currentStateId) {
            this.currentStateId = id;
        }

    }

    /**
     * Restore a board state by identifier
     */
    restoreState(id: string): KanbanBoard | null {
        const state = this.states.get(id);
        if (state) {
            // Return a clone to prevent external mutations
            const prototype = new BoardPrototype(state);
            const restoredBoard = prototype.clone();
            this.currentStateId = id;
            return restoredBoard;
        }
        return null;
    }

    /**
     * Get all saved state IDs
     */
    getStateIds(): string[] {
        return Array.from(this.states.keys());
    }

    /**
     * Check if a state exists
     */
    hasState(id: string): boolean {
        return this.states.has(id);
    }

    /**
     * Delete a saved state
     */
    deleteState(id: string): boolean {
        const deleted = this.states.delete(id);
        if (deleted) {
        }
        return deleted;
    }

    /**
     * Clear all saved states
     */
    clearStates(): void {
        this.states.clear();
        this.currentStateId = null;
    }

    /**
     * Get current state ID
     */
    getCurrentStateId(): string | null {
        return this.currentStateId;
    }

    /**
     * Create a diff between two board states
     */
    createDiff(fromStateId: string, toStateId: string): BoardDiff | null {
        const fromState = this.states.get(fromStateId);
        const toState = this.states.get(toStateId);

        if (!fromState || !toState) {
            return null;
        }

        return new BoardDiff(fromState, toState);
    }
}

/**
 * Board Diff - Represents changes between two board states
 */
export class BoardDiff {
    public readonly addedColumns: KanbanColumn[] = [];
    public readonly removedColumns: KanbanColumn[] = [];
    public readonly modifiedColumns: Array<{ oldColumn: KanbanColumn; newColumn: KanbanColumn }> = [];

    public readonly addedTasks: Array<{ columnId: string; task: KanbanTask }> = [];
    public readonly removedTasks: Array<{ columnId: string; task: KanbanTask }> = [];
    public readonly modifiedTasks: Array<{ columnId: string; oldTask: KanbanTask; newTask: KanbanTask }> = [];

    constructor(private fromBoard: KanbanBoard, private toBoard: KanbanBoard) {
        this.calculateDiff();
    }

    private calculateDiff(): void {
        // Compare columns
        const fromColumns = new Map(this.fromBoard.columns.map(col => [col.id, col]));
        const toColumns = new Map(this.toBoard.columns.map(col => [col.id, col]));

        // Find added columns
        for (const [id, column] of toColumns) {
            if (!fromColumns.has(id)) {
                this.addedColumns.push(column);
            }
        }

        // Find removed columns
        for (const [id, column] of fromColumns) {
            if (!toColumns.has(id)) {
                this.removedColumns.push(column);
            }
        }

        // Find modified columns
        for (const [id, toColumn] of toColumns) {
            const fromColumn = fromColumns.get(id);
            if (fromColumn && this.columnsDiffer(fromColumn, toColumn)) {
                this.modifiedColumns.push({ oldColumn: fromColumn, newColumn: toColumn });
            }
        }

        // Compare tasks within matching columns
        for (const toColumn of this.toBoard.columns) {
            const fromColumn = fromColumns.get(toColumn.id);
            if (fromColumn) {
                this.compareColumnTasks(fromColumn, toColumn);
            }
        }
    }

    private columnsDiffer(col1: KanbanColumn, col2: KanbanColumn): boolean {
        return col1.title !== col2.title ||
               col1.includeMode !== col2.includeMode ||
               JSON.stringify(col1.includeFiles) !== JSON.stringify(col2.includeFiles);
    }

    private compareColumnTasks(fromColumn: KanbanColumn, toColumn: KanbanColumn): void {
        const fromTasks = new Map(fromColumn.tasks.map(task => [task.id, task]));
        const toTasks = new Map(toColumn.tasks.map(task => [task.id, task]));

        // Find added tasks
        for (const [id, task] of toTasks) {
            if (!fromTasks.has(id)) {
                this.addedTasks.push({ columnId: toColumn.id, task });
            }
        }

        // Find removed tasks
        for (const [id, task] of fromTasks) {
            if (!toTasks.has(id)) {
                this.removedTasks.push({ columnId: fromColumn.id, task });
            }
        }

        // Find modified tasks
        for (const [id, toTask] of toTasks) {
            const fromTask = fromTasks.get(id);
            if (fromTask && this.tasksDiffer(fromTask, toTask)) {
                this.modifiedTasks.push({
                    columnId: toColumn.id,
                    oldTask: fromTask,
                    newTask: toTask
                });
            }
        }
    }

    private tasksDiffer(task1: KanbanTask, task2: KanbanTask): boolean {
        return task1.title !== task2.title ||
               task1.description !== task2.description ||
               task1.includeMode !== task2.includeMode ||
               JSON.stringify(task1.includeFiles) !== JSON.stringify(task2.includeFiles);
    }

    /**
     * Check if there are any changes
     */
    hasChanges(): boolean {
        return this.addedColumns.length > 0 ||
               this.removedColumns.length > 0 ||
               this.modifiedColumns.length > 0 ||
               this.addedTasks.length > 0 ||
               this.removedTasks.length > 0 ||
               this.modifiedTasks.length > 0;
    }

    /**
     * Get a summary of changes
     */
    getSummary(): string {
        const changes = [
            this.addedColumns.length > 0 ? `${this.addedColumns.length} columns added` : '',
            this.removedColumns.length > 0 ? `${this.removedColumns.length} columns removed` : '',
            this.modifiedColumns.length > 0 ? `${this.modifiedColumns.length} columns modified` : '',
            this.addedTasks.length > 0 ? `${this.addedTasks.length} tasks added` : '',
            this.removedTasks.length > 0 ? `${this.removedTasks.length} tasks removed` : '',
            this.modifiedTasks.length > 0 ? `${this.modifiedTasks.length} tasks modified` : ''
        ].filter(change => change.length > 0);

        return changes.length > 0 ? changes.join(', ') : 'No changes';
    }
}

/**
 * Undo/Redo Manager using Prototype Pattern
 */
export class UndoRedoManager {
    private undoStack: KanbanBoard[] = [];
    private redoStack: KanbanBoard[] = [];
    private maxHistorySize: number = 50;

    /**
     * Save current board state for undo
     */
    saveState(board: KanbanBoard): void {
        const prototype = new BoardPrototype(board);
        const clonedBoard = prototype.clone();

        this.undoStack.push(clonedBoard);

        // Limit history size
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        // Clear redo stack when new action is performed
        this.redoStack = [];

    }

    /**
     * Undo last operation
     */
    undo(): KanbanBoard | null {
        if (this.undoStack.length === 0) {
            return null;
        }

        const currentState = this.undoStack.pop()!;
        const prototype = new BoardPrototype(currentState);
        const restoredBoard = prototype.clone();

        // Save current state to redo stack
        this.redoStack.push(restoredBoard);

        return restoredBoard;
    }

    /**
     * Redo last undone operation
     */
    redo(): KanbanBoard | null {
        if (this.redoStack.length === 0) {
            return null;
        }

        const redoState = this.redoStack.pop()!;
        const prototype = new BoardPrototype(redoState);
        const restoredBoard = prototype.clone();

        // Save to undo stack
        this.undoStack.push(restoredBoard);

        return restoredBoard;
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Clear undo/redo history
     */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Get history statistics
     */
    getStats(): {
        undoCount: number;
        redoCount: number;
        maxHistorySize: number;
    } {
        return {
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length,
            maxHistorySize: this.maxHistorySize
        };
    }
}
