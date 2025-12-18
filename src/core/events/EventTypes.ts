/**
 * Event Types for the Kanban Event Bus
 *
 * Defines all event types used in the event-driven architecture.
 * Each event has a specific purpose and data structure.
 */

import { KanbanBoard } from '../../markdownParser';

/**
 * All possible event types in the system
 */
export type EventType =
    | 'board:changed'           // Board state changed (from UI edit, undo, redo, template)
    | 'board:loaded'            // Board initially loaded from file
    | 'board:invalidated'       // Board cache needs refresh
    | 'file:content-changed'    // File content updated in memory (triggers media tracking)
    | 'file:external-change'    // File changed on disk externally
    | 'file:saved'              // File saved to disk
    | 'media:changed'           // Media file (image/diagram) changed
    | 'focus:gained'            // Panel gained focus
    | 'focus:lost';             // Panel lost focus

/**
 * Trigger types for board changes
 */
export type BoardChangeTrigger =
    | 'edit'           // User edited task/column
    | 'undo'           // Undo operation
    | 'redo'           // Redo operation
    | 'template'       // Template applied
    | 'sort'           // Sort/reorder operation
    | 'include-switch' // Include file switched
    | 'load';          // Initial load

/**
 * Base interface for all events
 */
export interface BaseEvent {
    type: EventType;
    source: string;      // Component that emitted the event
    timestamp: number;   // When the event was emitted
}

/**
 * Board changed event - emitted when board state changes
 */
export interface BoardChangedEvent extends BaseEvent {
    type: 'board:changed';
    data: {
        board: KanbanBoard;
        trigger: BoardChangeTrigger;
    };
}

/**
 * Board loaded event - emitted when board is initially loaded
 */
export interface BoardLoadedEvent extends BaseEvent {
    type: 'board:loaded';
    data: {
        board: KanbanBoard;
    };
}

/**
 * Board invalidated event - emitted when cache needs refresh
 */
export interface BoardInvalidatedEvent extends BaseEvent {
    type: 'board:invalidated';
    data: {
        reason: string;
    };
}

/**
 * File content changed event - emitted when file content is updated in memory
 */
export interface FileContentChangedEvent extends BaseEvent {
    type: 'file:content-changed';
    data: {
        mainFileContent: string;
        includeFiles: Array<{ path: string; content: string }>;
    };
}

/**
 * File external change event - emitted when file changes on disk
 */
export interface FileExternalChangeEvent extends BaseEvent {
    type: 'file:external-change';
    data: {
        changedFiles: Array<{ path: string; type: 'main' | 'include' }>;
    };
}

/**
 * File saved event - emitted when file is saved to disk
 */
export interface FileSavedEvent extends BaseEvent {
    type: 'file:saved';
    data: {
        path: string;
    };
}

/**
 * Media changed event - emitted when media files change
 */
export interface MediaChangedEvent extends BaseEvent {
    type: 'media:changed';
    data: {
        changedFiles: Array<{ path: string; absolutePath: string; type: string }>;
    };
}

/**
 * Focus gained event - emitted when panel gains focus
 */
export interface FocusGainedEvent extends BaseEvent {
    type: 'focus:gained';
}

/**
 * Focus lost event - emitted when panel loses focus
 */
export interface FocusLostEvent extends BaseEvent {
    type: 'focus:lost';
}

/**
 * Union type of all events
 */
export type AppEvent =
    | BoardChangedEvent
    | BoardLoadedEvent
    | BoardInvalidatedEvent
    | FileContentChangedEvent
    | FileExternalChangeEvent
    | FileSavedEvent
    | MediaChangedEvent
    | FocusGainedEvent
    | FocusLostEvent;

/**
 * Helper to create events with common fields pre-filled
 */
export function createEvent<T extends AppEvent>(
    type: T['type'],
    source: string,
    data?: T extends { data: infer D } ? D : never
): T {
    const base = {
        type,
        source,
        timestamp: Date.now(),
    };

    if (data !== undefined) {
        return { ...base, data } as T;
    }
    return base as T;
}
