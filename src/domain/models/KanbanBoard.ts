/**
 * Kanban Board Domain Model
 *
 * Represents the core business entity of a Kanban board.
 * Contains all business logic for board operations.
 */

export interface KanbanColumn {
    id: string;
    title: string;
    displayTitle: string;
    tasks: KanbanTask[];
    includeMode: boolean;
    includeFiles: string[];
    metadata?: Record<string, any>;
}

export interface KanbanTask {
    id: string;
    title: string;
    displayTitle: string;
    description?: string;
    includeMode: boolean;
    includeFiles: string[];
    metadata?: Record<string, any>;
}

export interface BoardMetadata {
    version: string;
    created: Date;
    modified: Date;
    author?: string;
    tags?: string[];
}

/**
 * Kanban Board - Domain Entity
 *
 * Encapsulates all board-related business logic and state.
 * Follows Domain-Driven Design principles.
 */
export class KanbanBoard {
    private _id: string;
    private _title: string;
    private _columns: KanbanColumn[];
    private _metadata: BoardMetadata;
    private _version: number;

    constructor(
        id: string,
        title: string,
        columns: KanbanColumn[] = [],
        metadata?: Partial<BoardMetadata>
    ) {
        this._id = id;
        this._title = title;
        this._columns = [...columns];
        this._metadata = {
            version: '1.0',
            created: new Date(),
            modified: new Date(),
            ...metadata
        };
        this._version = 0;
    }

    // Getters
    get id(): string { return this._id; }
    get title(): string { return this._title; }
    get columns(): readonly KanbanColumn[] { return [...this._columns]; }
    get metadata(): Readonly<BoardMetadata> { return { ...this._metadata }; }
    get version(): number { return this._version; }

    // Setters with validation
    set title(value: string) {
        if (!value || value.trim().length === 0) {
            throw new Error('Board title cannot be empty');
        }
        this._title = value.trim();
        this.updateModified();
    }

    /**
     * Add a new column to the board
     */
    addColumn(title: string, position?: number): void {
        if (!title || title.trim().length === 0) {
            throw new Error('Column title cannot be empty');
        }

        const column: KanbanColumn = {
            id: this.generateColumnId(),
            title: title.trim(),
            displayTitle: title.trim(),
            tasks: [],
            includeMode: false,
            includeFiles: []
        };

        if (position !== undefined && position >= 0 && position <= this._columns.length) {
            this._columns.splice(position, 0, column);
        } else {
            this._columns.push(column);
        }

        this.incrementVersion();
    }

    /**
     * Remove a column from the board
     */
    removeColumn(columnId: string): KanbanColumn | null {
        const index = this._columns.findIndex(col => col.id === columnId);
        if (index === -1) {
            return null;
        }

        const removedColumn = this._columns.splice(index, 1)[0];
        this.incrementVersion();
        return removedColumn;
    }

    /**
     * Update a column's title
     */
    updateColumnTitle(columnId: string, newTitle: string): boolean {
        if (!newTitle || newTitle.trim().length === 0) {
            throw new Error('Column title cannot be empty');
        }

        const column = this._columns.find(col => col.id === columnId);
        if (!column) {
            return false;
        }

        column.title = newTitle.trim();
        column.displayTitle = newTitle.trim();
        this.incrementVersion();
        return true;
    }

    /**
     * Move a column to a new position
     */
    moveColumn(columnId: string, newPosition: number): boolean {
        const currentIndex = this._columns.findIndex(col => col.id === columnId);
        if (currentIndex === -1) {
            return false;
        }

        if (newPosition < 0 || newPosition >= this._columns.length) {
            return false;
        }

        const column = this._columns.splice(currentIndex, 1)[0];
        this._columns.splice(newPosition, 0, column);
        this.incrementVersion();
        return true;
    }

    /**
     * Add a task to a column
     */
    addTask(columnId: string, title: string, position?: number): string | null {
        if (!title || title.trim().length === 0) {
            throw new Error('Task title cannot be empty');
        }

        const column = this._columns.find(col => col.id === columnId);
        if (!column) {
            return null;
        }

        const task: KanbanTask = {
            id: this.generateTaskId(),
            title: title.trim(),
            displayTitle: title.trim(),
            includeMode: false,
            includeFiles: []
        };

        if (position !== undefined && position >= 0 && position <= column.tasks.length) {
            column.tasks.splice(position, 0, task);
        } else {
            column.tasks.push(task);
        }

        this.incrementVersion();
        return task.id;
    }

    /**
     * Remove a task from a column
     */
    removeTask(columnId: string, taskId: string): KanbanTask | null {
        const column = this._columns.find(col => col.id === columnId);
        if (!column) {
            return null;
        }

        const taskIndex = column.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) {
            return null;
        }

        const removedTask = column.tasks.splice(taskIndex, 1)[0];
        this.incrementVersion();
        return removedTask;
    }

    /**
     * Update a task's title
     */
    updateTaskTitle(columnId: string, taskId: string, newTitle: string): boolean {
        if (!newTitle || newTitle.trim().length === 0) {
            throw new Error('Task title cannot be empty');
        }

        const column = this._columns.find(col => col.id === columnId);
        if (!column) {
            return false;
        }

        const task = column.tasks.find(task => task.id === taskId);
        if (!task) {
            return false;
        }

        task.title = newTitle.trim();
        task.displayTitle = newTitle.trim();
        this.incrementVersion();
        return true;
    }

    /**
     * Update a task's description
     */
    updateTaskDescription(columnId: string, taskId: string, description: string): boolean {
        const column = this._columns.find(col => col.id === columnId);
        if (!column) {
            return false;
        }

        const task = column.tasks.find(task => task.id === taskId);
        if (!task) {
            return false;
        }

        task.description = description;
        this.incrementVersion();
        return true;
    }

    /**
     * Move a task between columns
     */
    moveTask(taskId: string, fromColumnId: string, toColumnId: string, newPosition?: number): boolean {
        const fromColumn = this._columns.find(col => col.id === fromColumnId);
        const toColumn = this._columns.find(col => col.id === toColumnId);

        if (!fromColumn || !toColumn) {
            return false;
        }

        const taskIndex = fromColumn.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) {
            return false;
        }

        const task = fromColumn.tasks.splice(taskIndex, 1)[0];

        if (newPosition !== undefined && newPosition >= 0 && newPosition <= toColumn.tasks.length) {
            toColumn.tasks.splice(newPosition, 0, task);
        } else {
            toColumn.tasks.push(task);
        }

        this.incrementVersion();
        return true;
    }

    /**
     * Move a task within the same column
     */
    reorderTask(columnId: string, taskId: string, newPosition: number): boolean {
        const column = this._columns.find(col => col.id === columnId);
        if (!column) {
            return false;
        }

        const currentIndex = column.tasks.findIndex(task => task.id === taskId);
        if (currentIndex === -1) {
            return false;
        }

        if (newPosition < 0 || newPosition >= column.tasks.length) {
            return false;
        }

        const task = column.tasks.splice(currentIndex, 1)[0];
        column.tasks.splice(newPosition, 0, task);
        this.incrementVersion();
        return true;
    }

    /**
     * Get a column by ID
     */
    getColumn(columnId: string): KanbanColumn | null {
        return this._columns.find(col => col.id === columnId) || null;
    }

    /**
     * Get a task by ID and column ID
     */
    getTask(columnId: string, taskId: string): KanbanTask | null {
        const column = this.getColumn(columnId);
        return column?.tasks.find(task => task.id === taskId) || null;
    }

    /**
     * Get all tasks across all columns
     */
    getAllTasks(): KanbanTask[] {
        return this._columns.flatMap(column => column.tasks);
    }

    /**
     * Search for tasks by title or description
     */
    searchTasks(query: string): { column: KanbanColumn; task: KanbanTask }[] {
        const results: { column: KanbanColumn; task: KanbanTask }[] = [];
        const searchTerm = query.toLowerCase();

        for (const column of this._columns) {
            for (const task of column.tasks) {
                if (task.title.toLowerCase().includes(searchTerm) ||
                    (task.description && task.description.toLowerCase().includes(searchTerm))) {
                    results.push({ column, task });
                }
            }
        }

        return results;
    }

    /**
     * Validate board integrity
     */
    validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Check for duplicate column IDs
        const columnIds = this._columns.map(col => col.id);
        const duplicateColumnIds = columnIds.filter((id, index) => columnIds.indexOf(id) !== index);
        if (duplicateColumnIds.length > 0) {
            errors.push(`Duplicate column IDs found: ${duplicateColumnIds.join(', ')}`);
        }

        // Check for duplicate task IDs within columns
        for (const column of this._columns) {
            const taskIds = column.tasks.map(task => task.id);
            const duplicateTaskIds = taskIds.filter((id, index) => taskIds.indexOf(id) !== index);
            if (duplicateTaskIds.length > 0) {
                errors.push(`Duplicate task IDs in column "${column.title}": ${duplicateTaskIds.join(', ')}`);
            }
        }

        // Check for empty titles
        if (!this._title || this._title.trim().length === 0) {
            errors.push('Board title cannot be empty');
        }

        for (const column of this._columns) {
            if (!column.title || column.title.trim().length === 0) {
                errors.push(`Column title cannot be empty (column ID: ${column.id})`);
            }

            for (const task of column.tasks) {
                if (!task.title || task.title.trim().length === 0) {
                    errors.push(`Task title cannot be empty (task ID: ${task.id})`);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Create a deep copy of the board
     */
    clone(): KanbanBoard {
        return new KanbanBoard(
            this._id,
            this._title,
            JSON.parse(JSON.stringify(this._columns)),
            { ...this._metadata }
        );
    }

    /**
     * Convert to plain object for serialization
     */
    toJSON(): any {
        return {
            id: this._id,
            title: this._title,
            columns: this._columns,
            metadata: this._metadata,
            version: this._version
        };
    }

    /**
     * Create board from plain object
     */
    static fromJSON(data: any): KanbanBoard {
        return new KanbanBoard(
            data.id,
            data.title,
            data.columns || [],
            data.metadata
        );
    }

    // Private helper methods

    private generateColumnId(): string {
        return `col_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateTaskId(): string {
        return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private incrementVersion(): void {
        this._version++;
        this.updateModified();
    }

    private updateModified(): void {
        this._metadata.modified = new Date();
    }
}