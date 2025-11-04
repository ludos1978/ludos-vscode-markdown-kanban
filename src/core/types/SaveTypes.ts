/**
 * Save Operation Types
 * Defines types for save operations and coordination
 */

export interface SaveOperation {
    id: string;
    operation: () => Promise<void>;
    timestamp: Date;
    priority: 'low' | 'normal' | 'high';
}

export interface SaveResult {
    success: boolean;
    operationId: string;
    duration: number;
    error?: Error;
}

export interface SaveEvent {
    type: 'save-queued' | 'save-started' | 'save-completed' | 'save-failed' | 'save-cancelled';
    operationId: string;
    timestamp: Date;
    error?: Error;
}
