import { KanbanBoard, KanbanColumn, KanbanTask } from '../../markdownParser';

/**
 * Memento Pattern - Advanced State Management
 *
 * Provides sophisticated state capture, restoration, and comparison capabilities.
 * Extends the Prototype pattern with metadata and versioning.
 */

export interface IMemento<T> {
    getState(): T;
    getMetadata(): MementoMetadata;
    getVersion(): number;
}

export interface IOriginator<T> {
    createMemento(): IMemento<T>;
    restoreFromMemento(memento: IMemento<T>): void;
}

export interface ICaretaker<T> {
    addMemento(memento: IMemento<T>): void;
    getMemento(index: number): IMemento<T> | null;
    getMementos(): IMemento<T>[];
    clear(): void;
}

export interface MementoMetadata {
    timestamp: Date;
    description: string;
    author?: string;
    tags?: string[];
    checksum?: string;
}

/**
 * Board Memento - Concrete Memento Implementation
 */
export class BoardMemento implements IMemento<KanbanBoard> {
    constructor(
        private state: KanbanBoard,
        private metadata: MementoMetadata,
        private version: number
    ) {}

    getState(): KanbanBoard {
        // Return deep clone to prevent external mutations
        return JSON.parse(JSON.stringify(this.state));
    }

    getMetadata(): MementoMetadata {
        return { ...this.metadata };
    }

    getVersion(): number {
        return this.version;
    }

    /**
     * Compare this memento with another
     */
    compare(other: BoardMemento): MementoDiff {
        return new MementoDiff(this, other);
    }

    /**
     * Calculate checksum for integrity verification
     */
    private calculateChecksum(): string {
        const data = JSON.stringify(this.state);
        // Simple checksum - in real implementation, use proper hashing
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }
}

/**
 * Board Originator - Creates and restores mementos
 */
export class BoardOriginator implements IOriginator<KanbanBoard> {
    constructor(private board: KanbanBoard) {}

    /**
     * Update the current board state
     */
    setBoard(board: KanbanBoard): void {
        this.board = board;
    }

    /**
     * Get the current board state
     */
    getBoard(): KanbanBoard {
        return this.board;
    }

    /**
     * Create a memento of the current state
     */
    createMemento(description?: string, tags?: string[]): IMemento<KanbanBoard> {
        const metadata: MementoMetadata = {
            timestamp: new Date(),
            description: description || `Board state at ${new Date().toISOString()}`,
            tags: tags || []
        };

        // Calculate version based on existing mementos (would be managed by caretaker)
        const version = Date.now(); // Simple versioning

        return new BoardMemento(this.board, metadata, version);
    }

    /**
     * Restore state from memento
     */
    restoreFromMemento(memento: IMemento<KanbanBoard>): void {
        this.board = memento.getState();
        console.log(`[BoardOriginator] Restored state: ${memento.getMetadata().description}`);
    }
}

/**
 * Board Caretaker - Manages memento history
 */
export class BoardCaretaker implements ICaretaker<KanbanBoard> {
    private mementos: IMemento<KanbanBoard>[] = [];
    private maxHistorySize: number = 100;

    /**
     * Add a memento to history
     */
    addMemento(memento: IMemento<KanbanBoard>): void {
        this.mementos.push(memento);

        // Maintain history size limit
        if (this.mementos.length > this.maxHistorySize) {
            this.mementos.shift();
        }

        console.log(`[BoardCaretaker] Added memento: ${memento.getMetadata().description} (total: ${this.mementos.length})`);
    }

    /**
     * Get memento by index
     */
    getMemento(index: number): IMemento<KanbanBoard> | null {
        if (index < 0 || index >= this.mementos.length) {
            return null;
        }
        return this.mementos[index];
    }

    /**
     * Get the latest memento
     */
    getLatestMemento(): IMemento<KanbanBoard> | null {
        return this.mementos.length > 0 ? this.mementos[this.mementos.length - 1] : null;
    }

    /**
     * Get all mementos
     */
    getMementos(): IMemento<KanbanBoard>[] {
        return [...this.mementos];
    }

    /**
     * Find mementos by criteria
     */
    findMementos(criteria: {
        description?: string;
        tags?: string[];
        since?: Date;
        until?: Date;
    }): IMemento<KanbanBoard>[] {
        return this.mementos.filter(memento => {
            const metadata = memento.getMetadata();

            if (criteria.description && !metadata.description.includes(criteria.description)) {
                return false;
            }

            if (criteria.tags && criteria.tags.length > 0) {
                const hasAllTags = criteria.tags.every(tag =>
                    metadata.tags?.includes(tag)
                );
                if (!hasAllTags) return false;
            }

            if (criteria.since && metadata.timestamp < criteria.since) {
                return false;
            }

            if (criteria.until && metadata.timestamp > criteria.until) {
                return false;
            }

            return true;
        });
    }

    /**
     * Clear all mementos
     */
    clear(): void {
        this.mementos = [];
        console.log(`[BoardCaretaker] Cleared all mementos`);
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalMementos: number;
        maxHistorySize: number;
        oldestMemento?: Date;
        newestMemento?: Date;
    } {
        const stats = {
            totalMementos: this.mementos.length,
            maxHistorySize: this.maxHistorySize,
            oldestMemento: undefined as Date | undefined,
            newestMemento: undefined as Date | undefined
        };

        if (this.mementos.length > 0) {
            const timestamps = this.mementos.map(m => m.getMetadata().timestamp);
            stats.oldestMemento = new Date(Math.min(...timestamps.map(d => d.getTime())));
            stats.newestMemento = new Date(Math.max(...timestamps.map(d => d.getTime())));
        }

        return stats;
    }
}

/**
 * Memento Diff - Compares two mementos
 */
export class MementoDiff {
    public readonly addedColumns: KanbanColumn[] = [];
    public readonly removedColumns: KanbanColumn[] = [];
    public readonly modifiedColumns: Array<{ oldColumn: KanbanColumn; newColumn: KanbanColumn }> = [];

    public readonly addedTasks: Array<{ columnId: string; task: KanbanTask }> = [];
    public readonly removedTasks: Array<{ columnId: string; task: KanbanTask }> = [];
    public readonly modifiedTasks: Array<{ columnId: string; oldTask: KanbanTask; newTask: KanbanTask }> = [];

    constructor(
        private fromMemento: IMemento<KanbanBoard>,
        private toMemento: IMemento<KanbanBoard>
    ) {
        this.calculateDiff();
    }

    private calculateDiff(): void {
        const fromBoard = this.fromMemento.getState();
        const toBoard = this.toMemento.getState();

        // Compare columns
        const fromColumns = new Map(fromBoard.columns.map(col => [col.id, col]));
        const toColumns = new Map(toBoard.columns.map(col => [col.id, col]));

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
        for (const toColumn of toBoard.columns) {
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

    hasChanges(): boolean {
        return this.addedColumns.length > 0 ||
               this.removedColumns.length > 0 ||
               this.modifiedColumns.length > 0 ||
               this.addedTasks.length > 0 ||
               this.removedTasks.length > 0 ||
               this.modifiedTasks.length > 0;
    }

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

    getDetailedChanges(): {
        columns: {
            added: KanbanColumn[];
            removed: KanbanColumn[];
            modified: Array<{ oldColumn: KanbanColumn; newColumn: KanbanColumn }>;
        };
        tasks: {
            added: Array<{ columnId: string; task: KanbanTask }>;
            removed: Array<{ columnId: string; task: KanbanTask }>;
            modified: Array<{ columnId: string; oldTask: KanbanTask; newTask: KanbanTask }>;
        };
    } {
        return {
            columns: {
                added: [...this.addedColumns],
                removed: [...this.removedColumns],
                modified: [...this.modifiedColumns]
            },
            tasks: {
                added: [...this.addedTasks],
                removed: [...this.removedTasks],
                modified: [...this.modifiedTasks]
            }
        };
    }
}

/**
 * Command Pattern Integration - Undoable Commands with Memento
 */
export interface IUndoableCommand {
    execute(): Promise<void>;
    undo(): Promise<void>;
    getDescription(): string;
    createMemento(): IMemento<any>;
}

export class UndoableCommandManager {
    private commandHistory: IUndoableCommand[] = [];
    private redoStack: IUndoableCommand[] = [];
    private maxHistorySize: number = 50;

    async executeCommand(command: IUndoableCommand): Promise<void> {
        await command.execute();

        // Add to history
        this.commandHistory.push(command);
        if (this.commandHistory.length > this.maxHistorySize) {
            this.commandHistory.shift();
        }

        // Clear redo stack
        this.redoStack = [];

        console.log(`[UndoableCommandManager] Executed command: ${command.getDescription()}`);
    }

    async undo(): Promise<void> {
        if (this.commandHistory.length === 0) {
            throw new Error('No commands to undo');
        }

        const command = this.commandHistory.pop()!;
        await command.undo();

        // Add to redo stack
        this.redoStack.push(command);

        console.log(`[UndoableCommandManager] Undid command: ${command.getDescription()}`);
    }

    async redo(): Promise<void> {
        if (this.redoStack.length === 0) {
            throw new Error('No commands to redo');
        }

        const command = this.redoStack.pop()!;
        await command.execute();

        // Add back to history
        this.commandHistory.push(command);

        console.log(`[UndoableCommandManager] Redid command: ${command.getDescription()}`);
    }

    canUndo(): boolean {
        return this.commandHistory.length > 0;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    clear(): void {
        this.commandHistory = [];
        this.redoStack = [];
        console.log(`[UndoableCommandManager] Cleared command history`);
    }

    getHistory(): string[] {
        return this.commandHistory.map(cmd => cmd.getDescription());
    }
}
