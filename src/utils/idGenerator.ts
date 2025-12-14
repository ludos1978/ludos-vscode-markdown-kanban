/**
 * UUID Generation Utilities for Kanban Board
 * Provides consistent, unique identifiers for columns and tasks
 * that persist across saves/loads and frontend/backend operations
 * 
 * State: manually verified.
 */

export class IdGenerator {
    /**
     * Generates a RFC4122-compliant UUID v4
     * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
     * Where x is any hexadecimal digit and y is one of 8, 9, A, or B
     */
    static generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Generates a column ID with a specific prefix
     * Format: col-{uuid}
     */
    static generateColumnId(): string {
        return `col-${IdGenerator.generateUUID()}`;
    }

    /**
     * Generates a task ID with a specific prefix
     * Format: task-{uuid}
     */
    static generateTaskId(): string {
        return `task-${IdGenerator.generateUUID()}`;
    }
}