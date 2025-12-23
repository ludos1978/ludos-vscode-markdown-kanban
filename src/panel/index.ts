/**
 * Panel Module - Clean architecture for KanbanWebviewPanel
 *
 * This module provides single-responsibility components that together
 * implement the kanban webview panel functionality.
 *
 * @module panel
 */

// Unified State (replaces PanelStateModel + DocumentStateModel)
export { PanelContext, PendingBoardUpdate } from './PanelContext';

// Foundation
export { ConcurrencyManager } from './ConcurrencyManager';

// Core Operations
export { IncludeFileCoordinator, IncludeCoordinatorDependencies } from './IncludeFileCoordinator';

// Webview Management
export { WebviewManager, WebviewManagerDependencies } from './WebviewManager';
