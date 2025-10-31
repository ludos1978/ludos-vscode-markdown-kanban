/**
 * Domain Events
 *
 * Defines all domain events in the system.
 * Domain events represent important business occurrences that other parts of the system might be interested in.
 */

/**
 * Base domain event class
 */
export abstract class DomainEvent<T = any> {
    /** Unique event identifier */
    public readonly eventId: string;

    /** Event type for routing */
    public readonly eventType: string;

    /** When the event occurred */
    public readonly timestamp: Date;

    /** Event data */
    public readonly data: T;

    constructor(data: T) {
        this.eventId = generateEventId();
        this.eventType = this.constructor.name;
        this.timestamp = new Date();
        this.data = data;
    }
}

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Board Events
 */

export interface BoardChangedData {
    board: any; // KanbanBoard
    changes?: any[]; // BoardChange[]
    source?: string;
    timestamp: Date;
}

export class BoardChangedEvent extends DomainEvent<BoardChangedData> {
    constructor(data: BoardChangedData) {
        super(data);
    }
}

export interface BoardSavedData {
    board: any; // KanbanBoard
    filePath: string;
    timestamp: Date;
}

export class BoardSavedEvent extends DomainEvent<BoardSavedData> {
    constructor(data: BoardSavedData) {
        super(data);
    }
}

export interface BoardLoadedData {
    board: any; // KanbanBoard
    filePath: string;
    timestamp: Date;
}

export class BoardLoadedEvent extends DomainEvent<BoardLoadedData> {
    constructor(data: BoardLoadedData) {
        super(data);
    }
}

/**
 * File Events
 */

export interface FileModifiedData {
    filePath: string;
    source: 'user-edit' | 'external-change' | 'vscode-save' | 'auto-reload';
    timestamp: Date;
    metadata?: Record<string, any>;
}

export class FileModifiedEvent extends DomainEvent<FileModifiedData> {
    constructor(data: FileModifiedData) {
        super(data);
    }
}

export interface FileDeletedData {
    filePath: string;
    timestamp: Date;
}

export class FileDeletedEvent extends DomainEvent<FileDeletedData> {
    constructor(data: FileDeletedData) {
        super(data);
    }
}

export interface FileCreatedData {
    filePath: string;
    timestamp: Date;
}

export class FileCreatedEvent extends DomainEvent<FileCreatedData> {
    constructor(data: FileCreatedData) {
        super(data);
    }
}

/**
 * Save Events
 */

export interface SaveRequestData {
    board: any; // KanbanBoard
    options?: any; // SaveOptions
    timestamp: Date;
}

export class SaveRequestEvent extends DomainEvent<SaveRequestData> {
    constructor(data: SaveRequestData) {
        super(data);
    }
}

export interface SaveCompletedData {
    board: any; // KanbanBoard
    filePath: string;
    duration: number;
    timestamp: Date;
}

export class SaveCompletedEvent extends DomainEvent<SaveCompletedData> {
    constructor(data: SaveCompletedData) {
        super(data);
    }
}

export interface SaveFailedData {
    board: any; // KanbanBoard
    error: Error;
    timestamp: Date;
}

export class SaveFailedEvent extends DomainEvent<SaveFailedData> {
    constructor(data: SaveFailedData) {
        super(data);
    }
}

/**
 * Conflict Events
 */

export interface ConflictDetectedData {
    conflicts: any[]; // Conflict[]
    context: any; // ConflictContext
    timestamp: Date;
}

export class ConflictDetectedEvent extends DomainEvent<ConflictDetectedData> {
    constructor(data: ConflictDetectedData) {
        super(data);
    }
}

export interface ConflictResolvedData {
    conflict: any; // Conflict
    resolution: any; // ConflictResolution
    timestamp: Date;
}

export class ConflictResolvedEvent extends DomainEvent<ConflictResolvedData> {
    constructor(data: ConflictResolvedData) {
        super(data);
    }
}

/**
 * UI Events
 */

export interface UserActionData {
    action: string;
    target?: string;
    data?: any;
    timestamp: Date;
}

export class UserActionEvent extends DomainEvent<UserActionData> {
    constructor(data: UserActionData) {
        super(data);
    }
}

export interface ViewChangedData {
    view: string;
    previousView?: string;
    timestamp: Date;
}

export class ViewChangedEvent extends DomainEvent<ViewChangedData> {
    constructor(data: ViewChangedData) {
        super(data);
    }
}

/**
 * System Events
 */

export interface SystemErrorData {
    error: Error;
    context: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

export class SystemErrorEvent extends DomainEvent<SystemErrorData> {
    constructor(data: SystemErrorData) {
        super(data);
    }
}

export interface SystemReadyData {
    components: string[];
    timestamp: Date;
}

export class SystemReadyEvent extends DomainEvent<SystemReadyData> {
    constructor(data: SystemReadyData) {
        super(data);
    }
}

/**
 * Event Types Union
 * Useful for type-safe event handling
 */
export type KanbanEvent =
    | BoardChangedEvent
    | BoardSavedEvent
    | BoardLoadedEvent
    | FileModifiedEvent
    | FileDeletedEvent
    | FileCreatedEvent
    | SaveRequestEvent
    | SaveCompletedEvent
    | SaveFailedEvent
    | ConflictDetectedEvent
    | ConflictResolvedEvent
    | UserActionEvent
    | ViewChangedEvent
    | SystemErrorEvent
    | SystemReadyEvent;