/**
 * Type definitions for the Kanban Dashboard side panel
 *
 * The dashboard aggregates data from multiple kanban boards,
 * showing upcoming items and tag summaries.
 */

/**
 * Configuration for a single board in the dashboard
 */
export interface DashboardBoardConfig {
    /** File URI of the kanban board */
    uri: string;
    /** Timeframe in days for showing upcoming items (3, 7, or 30) */
    timeframe: 3 | 7 | 30;
    /** Tags to filter/highlight in this board */
    tagFilters: string[];
    /** Whether this board is enabled in the dashboard */
    enabled: boolean;
}

/**
 * Overall dashboard configuration stored in workspace settings
 */
export interface DashboardConfig {
    /** List of boards included in the dashboard */
    boards: DashboardBoardConfig[];
    /** Default timeframe for new boards */
    defaultTimeframe: 3 | 7 | 30;
}

/**
 * An upcoming item (task with temporal tag within timeframe)
 */
export interface UpcomingItem {
    /** File URI of the board containing this item */
    boardUri: string;
    /** Display name of the board (filename) */
    boardName: string;
    /** Column ID containing the task */
    columnId: string;
    /** Column title */
    columnTitle: string;
    /** Task ID */
    taskId: string;
    /** Task title (may include tags) */
    taskTitle: string;
    /** The temporal tag that matched (e.g., "!20.1.2026") */
    temporalTag: string;
    /** Parsed date for sorting (may be undefined for week/weekday tags) */
    date?: Date;
    /** Week number if this is a week tag */
    week?: number;
    /** Year for week tag */
    year?: number;
    /** Original raw title with all tags */
    rawTitle: string;
}

/**
 * Tag information with usage count
 */
export interface TagInfo {
    /** Tag name (without prefix) */
    name: string;
    /** Number of occurrences in the board */
    count: number;
    /** Tag type: hash (#), person (@), or temporal (!) */
    type: 'hash' | 'person' | 'temporal';
}

/**
 * Summary of tags used in a board
 */
export interface BoardTagSummary {
    /** File URI of the board */
    boardUri: string;
    /** Display name of the board */
    boardName: string;
    /** List of tags with counts */
    tags: TagInfo[];
    /** Total number of tasks in the board */
    totalTasks: number;
    /** Number of tasks with temporal tags */
    temporalTasks: number;
}

/**
 * Complete dashboard data sent to the webview
 */
export interface DashboardData {
    /** Upcoming items across all boards, sorted by date */
    upcomingItems: UpcomingItem[];
    /** Tag summaries per board */
    boardSummaries: BoardTagSummary[];
    /** Current dashboard configuration */
    config: DashboardConfig;
}

// Message types for dashboard webview communication

/**
 * Message sent when dashboard webview is ready
 */
export interface DashboardReadyMessage {
    type: 'dashboardReady';
}

/**
 * Request to refresh dashboard data
 */
export interface DashboardRefreshMessage {
    type: 'dashboardRefresh';
}

/**
 * Request to add a board to the dashboard
 */
export interface DashboardAddBoardMessage {
    type: 'dashboardAddBoard';
    boardUri: string;
}

/**
 * Request to remove a board from the dashboard
 */
export interface DashboardRemoveBoardMessage {
    type: 'dashboardRemoveBoard';
    boardUri: string;
}

/**
 * Request to update a board's configuration
 */
export interface DashboardUpdateConfigMessage {
    type: 'dashboardUpdateConfig';
    boardUri: string;
    timeframe?: 3 | 7 | 30;
    tagFilters?: string[];
    enabled?: boolean;
}

/**
 * Request to navigate to a specific task
 */
export interface DashboardNavigateMessage {
    type: 'dashboardNavigate';
    boardUri: string;
    columnId: string;
    taskId: string;
}

/**
 * Data sent from backend to dashboard webview
 */
export interface DashboardDataMessage {
    type: 'dashboardData';
    data: DashboardData;
}

/**
 * Notification that configuration was updated
 */
export interface DashboardConfigUpdatedMessage {
    type: 'dashboardConfigUpdated';
    config: DashboardConfig;
}

/**
 * Union type for all dashboard messages from webview to backend
 */
export type DashboardIncomingMessage =
    | DashboardReadyMessage
    | DashboardRefreshMessage
    | DashboardAddBoardMessage
    | DashboardRemoveBoardMessage
    | DashboardUpdateConfigMessage
    | DashboardNavigateMessage;

/**
 * Union type for all dashboard messages from backend to webview
 */
export type DashboardOutgoingMessage =
    | DashboardDataMessage
    | DashboardConfigUpdatedMessage;
