/**
 * Constants for timeouts, delays, and limits
 * Centralized to avoid magic numbers throughout the codebase
 */

// =============================================================================
// EDITING & DEBOUNCE TIMEOUTS
// =============================================================================

/** Delay before stopping edit mode after user stops typing (ms) */
export const STOP_EDITING_TIMEOUT_MS = 2000;

/** Debounce delay for file search operations (ms) */
export const SEARCH_DEBOUNCE_DELAY_MS = 200;

/** Debounce delay for webview message batching (ms) */
export const BATCH_FLUSH_DELAY_MS = 50;

// =============================================================================
// PANEL & REVIVAL
// =============================================================================

/** Delay before clearing revival tracking URIs (ms) */
export const REVIVAL_TRACKING_CLEAR_DELAY_MS = 5000;

// =============================================================================
// LIMITS
// =============================================================================

/** Maximum number of undo states to keep in history */
export const MAX_UNDO_STACK_SIZE = 100;

/** Maximum messages to batch before flushing to webview */
export const MAX_BATCH_SIZE = 10;

/** Maximum search results to return */
export const MAX_SEARCH_RESULTS = 200;

/** Maximum results per search pattern */
export const MAX_RESULTS_PER_PATTERN = 200;

/** Maximum regex search results */
export const MAX_REGEX_RESULTS = 1000;

// =============================================================================
// FILE SYSTEM TIMEOUTS
// =============================================================================

/** Debounce delay for document change handling (ms) */
export const DOCUMENT_CHANGE_DEBOUNCE_MS = 150;

/** Timeout for file watcher operations (ms) */
export const WATCHER_TIMEOUT_MS = 5000;

/** Timeout for save transactions (ms) */
export const TRANSACTION_TIMEOUT_MS = 30000;

// =============================================================================
// EXTERNAL PROCESS TIMEOUTS
// =============================================================================

/** Timeout for external drawing services (DrawIO, PDF conversion) (ms) */
export const EXTERNAL_SERVICE_TIMEOUT_MS = 30000;

// =============================================================================
// UI INTERACTION DELAYS
// =============================================================================

/** Short delay for UI interactions like focus (ms) */
export const UI_FOCUS_DELAY_MS = 50;

/** Medium delay for UI transitions (ms) */
export const UI_TRANSITION_DELAY_MS = 100;

/** Delay for submenu hide operations (ms) */
export const SUBMENU_HIDE_DELAY_MS = 100;

/** Delay for debug overlay refresh (ms) */
export const DEBUG_REFRESH_DELAY_MS = 500;
