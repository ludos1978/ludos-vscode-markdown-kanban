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
export { ConcurrencyManager } from './ConcurrencyManager';
export {
    FileRegistryAdapter,
    FileAttentionStatus,
    IncludeUnsavedStatus,
    UnsavedChangesState
} from './FileRegistryAdapter';

// Core Operations (Phase 2)
export { IncludeFileCoordinator, IncludeCoordinatorDependencies } from './IncludeFileCoordinator';
