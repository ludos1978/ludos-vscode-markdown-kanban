import { KanbanBoard, KanbanColumn, KanbanTask } from '../../markdownParser';
import { MarkdownFileRegistry } from '../../files';

/**
 * Builder Pattern - Board Operation Builder
 *
 * Constructs complex board operations step by step.
 * Allows for flexible composition of board modifications.
 */

export interface IBoardOperation {
    execute(): Promise<void>;
    undo(): Promise<void>;
    getDescription(): string;
}

export class BoardOperationBuilder {
    private operations: IBoardOperation[] = [];
    private board: KanbanBoard | null = null;
    private registry: MarkdownFileRegistry | null = null;

    constructor(board?: KanbanBoard, registry?: MarkdownFileRegistry) {
        this.board = board || null;
        this.registry = registry || null;
    }

    /**
     * Set the board context
     */
    withBoard(board: KanbanBoard): BoardOperationBuilder {
        this.board = board;
        return this;
    }

    /**
     * Set the registry context
     */
    withRegistry(registry: MarkdownFileRegistry): BoardOperationBuilder {
        this.registry = registry;
        return this;
    }

    /**
     * Add column creation operation
     */
    addColumn(title: string, position?: number): BoardOperationBuilder {
        this.operations.push(new CreateColumnOperation(this.board!, title, position));
        return this;
    }

    /**
     * Add column deletion operation
     */
    deleteColumn(columnId: string): BoardOperationBuilder {
        this.operations.push(new DeleteColumnOperation(this.board!, columnId));
        return this;
    }

    /**
     * Add column update operation
     */
    updateColumn(columnId: string, updates: Partial<KanbanColumn>): BoardOperationBuilder {
        this.operations.push(new UpdateColumnOperation(this.board!, columnId, updates));
        return this;
    }

    /**
     * Add task creation operation
     */
    addTask(columnId: string, task: Omit<KanbanTask, 'id'>): BoardOperationBuilder {
        this.operations.push(new CreateTaskOperation(this.board!, columnId, task));
        return this;
    }

    /**
     * Add task deletion operation
     */
    deleteTask(columnId: string, taskId: string): BoardOperationBuilder {
        this.operations.push(new DeleteTaskOperation(this.board!, columnId, taskId));
        return this;
    }

    /**
     * Add task update operation
     */
    updateTask(columnId: string, taskId: string, updates: Partial<KanbanTask>): BoardOperationBuilder {
        this.operations.push(new UpdateTaskOperation(this.board!, columnId, taskId, updates));
        return this;
    }

    /**
     * Add move task operation
     */
    moveTask(taskId: string, fromColumnId: string, toColumnId: string, position?: number): BoardOperationBuilder {
        this.operations.push(new MoveTaskOperation(this.board!, taskId, fromColumnId, toColumnId, position));
        return this;
    }

    /**
     * Add include file operation
     */
    addIncludeFile(columnId: string, relativePath: string, type: 'column' | 'task'): BoardOperationBuilder {
        this.operations.push(new AddIncludeOperation(this.board!, this.registry!, columnId, relativePath, type));
        return this;
    }

    /**
     * Add batch save operation
     */
    saveAll(): BoardOperationBuilder {
        this.operations.push(new BatchSaveOperation(this.registry!));
        return this;
    }

    /**
     * Build the composite operation
     */
    build(): IBoardOperation {
        return new CompositeBoardOperation(this.operations);
    }

    /**
     * Execute operations immediately
     */
    async execute(): Promise<void> {
        const operation = this.build();
        await operation.execute();
    }
}

/**
 * Individual Board Operations
 */

class CreateColumnOperation implements IBoardOperation {
    private createdColumnId: string | null = null;

    constructor(
        private board: KanbanBoard,
        private title: string,
        private position?: number
    ) {}

    async execute(): Promise<void> {
        const newColumn: KanbanColumn = {
            id: `column_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            title: this.title,
            originalTitle: this.title,
            tasks: [],
            includeMode: false
        };

        if (this.position !== undefined && this.position >= 0 && this.position <= this.board.columns.length) {
            this.board.columns.splice(this.position, 0, newColumn);
        } else {
            this.board.columns.push(newColumn);
        }

        this.createdColumnId = newColumn.id;
        console.log(`[CreateColumnOperation] Created column: ${newColumn.id}`);
    }

    async undo(): Promise<void> {
        if (this.createdColumnId) {
            const index = this.board.columns.findIndex(col => col.id === this.createdColumnId);
            if (index >= 0) {
                this.board.columns.splice(index, 1);
                console.log(`[CreateColumnOperation] Undid creation of column: ${this.createdColumnId}`);
            }
        }
    }

    getDescription(): string {
        return `Create column "${this.title}"`;
    }
}

class DeleteColumnOperation implements IBoardOperation {
    private deletedColumn: KanbanColumn | null = null;
    private deletedIndex: number = -1;

    constructor(
        private board: KanbanBoard,
        private columnId: string
    ) {}

    async execute(): Promise<void> {
        const index = this.board.columns.findIndex(col => col.id === this.columnId);
        if (index >= 0) {
            this.deletedColumn = { ...this.board.columns[index] };
            this.deletedIndex = index;
            this.board.columns.splice(index, 1);
            console.log(`[DeleteColumnOperation] Deleted column: ${this.columnId}`);
        }
    }

    async undo(): Promise<void> {
        if (this.deletedColumn && this.deletedIndex >= 0) {
            this.board.columns.splice(this.deletedIndex, 0, this.deletedColumn);
            console.log(`[DeleteColumnOperation] Restored column: ${this.deletedColumn.id}`);
        }
    }

    getDescription(): string {
        return `Delete column ${this.columnId}`;
    }
}

class UpdateColumnOperation implements IBoardOperation {
    private originalColumn: KanbanColumn | null = null;

    constructor(
        private board: KanbanBoard,
        private columnId: string,
        private updates: Partial<KanbanColumn>
    ) {}

    async execute(): Promise<void> {
        const column = this.board.columns.find(col => col.id === this.columnId);
        if (column) {
            this.originalColumn = { ...column };
            Object.assign(column, this.updates);
            console.log(`[UpdateColumnOperation] Updated column: ${this.columnId}`);
        }
    }

    async undo(): Promise<void> {
        if (this.originalColumn) {
            const column = this.board.columns.find(col => col.id === this.columnId);
            if (column) {
                Object.assign(column, this.originalColumn);
                console.log(`[UpdateColumnOperation] Reverted column: ${this.columnId}`);
            }
        }
    }

    getDescription(): string {
        return `Update column ${this.columnId}`;
    }
}

class CreateTaskOperation implements IBoardOperation {
    private createdTaskId: string | null = null;

    constructor(
        private board: KanbanBoard,
        private columnId: string,
        private taskData: Omit<KanbanTask, 'id'>
    ) {}

    async execute(): Promise<void> {
        const column = this.board.columns.find(col => col.id === this.columnId);
        if (column) {
            const newTask: KanbanTask = {
                ...this.taskData,
                id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };

            column.tasks.push(newTask);
            this.createdTaskId = newTask.id;
            console.log(`[CreateTaskOperation] Created task: ${newTask.id} in column: ${this.columnId}`);
        }
    }

    async undo(): Promise<void> {
        if (this.createdTaskId) {
            const column = this.board.columns.find(col => col.id === this.columnId);
            if (column) {
                const index = column.tasks.findIndex(task => task.id === this.createdTaskId);
                if (index >= 0) {
                    column.tasks.splice(index, 1);
                    console.log(`[CreateTaskOperation] Undid creation of task: ${this.createdTaskId}`);
                }
            }
        }
    }

    getDescription(): string {
        return `Create task "${this.taskData.title}" in column ${this.columnId}`;
    }
}

class DeleteTaskOperation implements IBoardOperation {
    private deletedTask: KanbanTask | null = null;
    private deletedIndex: number = -1;

    constructor(
        private board: KanbanBoard,
        private columnId: string,
        private taskId: string
    ) {}

    async execute(): Promise<void> {
        const column = this.board.columns.find(col => col.id === this.columnId);
        if (column) {
            const index = column.tasks.findIndex(task => task.id === this.taskId);
            if (index >= 0) {
                this.deletedTask = { ...column.tasks[index] };
                this.deletedIndex = index;
                column.tasks.splice(index, 1);
                console.log(`[DeleteTaskOperation] Deleted task: ${this.taskId}`);
            }
        }
    }

    async undo(): Promise<void> {
        if (this.deletedTask && this.deletedIndex >= 0) {
            const column = this.board.columns.find(col => col.id === this.columnId);
            if (column) {
                column.tasks.splice(this.deletedIndex, 0, this.deletedTask);
                console.log(`[DeleteTaskOperation] Restored task: ${this.deletedTask.id}`);
            }
        }
    }

    getDescription(): string {
        return `Delete task ${this.taskId} from column ${this.columnId}`;
    }
}

class UpdateTaskOperation implements IBoardOperation {
    private originalTask: KanbanTask | null = null;

    constructor(
        private board: KanbanBoard,
        private columnId: string,
        private taskId: string,
        private updates: Partial<KanbanTask>
    ) {}

    async execute(): Promise<void> {
        const column = this.board.columns.find(col => col.id === this.columnId);
        if (column) {
            const task = column.tasks.find(t => t.id === this.taskId);
            if (task) {
                this.originalTask = { ...task };
                Object.assign(task, this.updates);
                console.log(`[UpdateTaskOperation] Updated task: ${this.taskId}`);
            }
        }
    }

    async undo(): Promise<void> {
        if (this.originalTask) {
            const column = this.board.columns.find(col => col.id === this.columnId);
            if (column) {
                const task = column.tasks.find(t => t.id === this.taskId);
                if (task) {
                    Object.assign(task, this.originalTask);
                    console.log(`[UpdateTaskOperation] Reverted task: ${this.taskId}`);
                }
            }
        }
    }

    getDescription(): string {
        return `Update task ${this.taskId} in column ${this.columnId}`;
    }
}

class MoveTaskOperation implements IBoardOperation {
    private movedTask: KanbanTask | null = null;
    private originalColumnId: string = '';
    private originalIndex: number = -1;

    constructor(
        private board: KanbanBoard,
        private taskId: string,
        private fromColumnId: string,
        private toColumnId: string,
        private position?: number
    ) {}

    async execute(): Promise<void> {
        const fromColumn = this.board.columns.find(col => col.id === this.fromColumnId);
        const toColumn = this.board.columns.find(col => col.id === this.toColumnId);

        if (fromColumn && toColumn) {
            const taskIndex = fromColumn.tasks.findIndex(task => task.id === this.taskId);
            if (taskIndex >= 0) {
                this.movedTask = fromColumn.tasks[taskIndex];
                this.originalColumnId = this.fromColumnId;
                this.originalIndex = taskIndex;

                // Remove from source column
                fromColumn.tasks.splice(taskIndex, 1);

                // Add to destination column
                if (this.position !== undefined && this.position >= 0 && this.position <= toColumn.tasks.length) {
                    toColumn.tasks.splice(this.position, 0, this.movedTask);
                } else {
                    toColumn.tasks.push(this.movedTask);
                }

                console.log(`[MoveTaskOperation] Moved task ${this.taskId} from ${this.fromColumnId} to ${this.toColumnId}`);
            }
        }
    }

    async undo(): Promise<void> {
        if (this.movedTask && this.originalIndex >= 0) {
            const currentColumn = this.board.columns.find(col => col.id === this.toColumnId);
            const originalColumn = this.board.columns.find(col => col.id === this.originalColumnId);

            if (currentColumn && originalColumn) {
                // Remove from current column
                const currentIndex = currentColumn.tasks.findIndex(task => task.id === this.taskId);
                if (currentIndex >= 0) {
                    currentColumn.tasks.splice(currentIndex, 1);
                }

                // Restore to original column and position
                originalColumn.tasks.splice(this.originalIndex, 0, this.movedTask);
                console.log(`[MoveTaskOperation] Moved task ${this.taskId} back to ${this.originalColumnId}`);
            }
        }
    }

    getDescription(): string {
        return `Move task ${this.taskId} from ${this.fromColumnId} to ${this.toColumnId}`;
    }
}

class AddIncludeOperation implements IBoardOperation {
    constructor(
        private board: KanbanBoard,
        private registry: MarkdownFileRegistry,
        private columnId: string,
        private relativePath: string,
        private type: 'column' | 'task'
    ) {}

    async execute(): Promise<void> {
        // Implementation would add include file to column/task
        console.log(`[AddIncludeOperation] Added ${this.type} include ${this.relativePath} to ${this.columnId}`);
    }

    async undo(): Promise<void> {
        // Implementation would remove include file from column/task
        console.log(`[AddIncludeOperation] Removed ${this.type} include ${this.relativePath} from ${this.columnId}`);
    }

    getDescription(): string {
        return `Add ${this.type} include ${this.relativePath} to ${this.columnId}`;
    }
}

class BatchSaveOperation implements IBoardOperation {
    constructor(private registry: MarkdownFileRegistry) {}

    async execute(): Promise<void> {
        const filesToSave = this.registry.getFilesWithUnsavedChanges();
        console.log(`[BatchSaveOperation] Saving ${filesToSave.length} files`);

        for (const file of filesToSave) {
            await file.save();
        }
    }

    async undo(): Promise<void> {
        // Batch save operations are typically not undone
        console.log(`[BatchSaveOperation] Undo not supported for batch save`);
    }

    getDescription(): string {
        return 'Save all modified files';
    }
}

/**
 * Composite Operation - Executes multiple operations as a unit
 */
class CompositeBoardOperation implements IBoardOperation {
    constructor(private operations: IBoardOperation[]) {}

    async execute(): Promise<void> {
        console.log(`[CompositeBoardOperation] Executing ${this.operations.length} operations`);

        for (const operation of this.operations) {
            await operation.execute();
        }
    }

    async undo(): Promise<void> {
        console.log(`[CompositeBoardOperation] Undoing ${this.operations.length} operations`);

        // Undo in reverse order
        for (let i = this.operations.length - 1; i >= 0; i--) {
            await this.operations[i].undo();
        }
    }

    getDescription(): string {
        if (this.operations.length === 1) {
            return this.operations[0].getDescription();
        }
        return `${this.operations.length} board operations`;
    }
}
