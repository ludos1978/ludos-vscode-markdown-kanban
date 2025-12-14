/**
 * Panel Module - Clean architecture for KanbanWebviewPanel
 *
 * This module provides single-responsibility components that together
 * implement the kanban webview panel functionality.
 *
 * @module panel
 */

// Foundation (Phase 1)
export { PanelStateModel, PanelStateFlags } from './PanelStateModel';
export { DocumentStateModel, DocumentStateSnapshot, PendingBoardUpdate } from './DocumentStateModel';
export { ConcurrencyManager } from './ConcurrencyManager';

// Core Operations (Phase 2)
export { IncludeFileCoordinator, IncludeCoordinatorDependencies } from './IncludeFileCoordinator';

// Webview Management (Phase 3)
export { WebviewManager, WebviewManagerDependencies } from './WebviewManager';
