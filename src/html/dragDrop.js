/**
 * dragDrop.js - Drag and Drop System for Kanban Board
 *
 * ARCHITECTURE NOTES:
 * This module handles all drag/drop operations for tasks, columns, templates, and external files.
 *
 * EVENT LISTENER PATTERN:
 * - Global event listeners are added ONCE via setupGlobalDragAndDrop() using the
 *   `dragDropInitialized` guard flag to prevent duplicate listeners
 * - 28+ event listeners are added to document/boardContainer
 * - Only 1 removeEventListener is used (scroll handler during drag)
 *
 * MEMORY CONSIDERATIONS:
 * Since VS Code webviews are fully destroyed on panel close, event listeners
 * on document/elements are cleaned up automatically. However, if the webview
 * is revived (serialized/deserialized), the guard flag ensures listeners
 * aren't duplicated.
 *
 * FUTURE MAINTENANCE:
 * If memory issues arise or listeners need explicit cleanup:
 * 1. Store listener references (e.g., `const dragStartHandler = (e) => {...}`)
 * 2. Create a teardown function that calls removeEventListener for each
 * 3. Expose teardown via window.cleanupDragDrop for panel disposal
 *
 * STATE MANAGEMENT:
 * Uses window.dragState (DragStateManager) for centralized drag state.
 * Local state variables track initialization and drop processing.
 */

const DEBUG_DROP = false;


// Track if drag/drop is already set up to prevent multiple listeners
let dragDropInitialized = false;
let isProcessingDrop = false; // Prevent multiple simultaneous drops

// Drop indicator functions moved to utils/dropIndicatorManager.js
// Access via window.dropIndicatorManager.*

// File drop dialogue: store pending File objects until user confirms action
const pendingFileDrops = new Map();
const FILE_SIZE_LIMIT_MB = 10;
const FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_MB * 1024 * 1024;
const PARTIAL_HASH_SIZE = 1024 * 1024; // 1MB for partial hash calculation

/**
 * Get column DOM element by column ID
 * @param {string} columnId - The column ID
 * @returns {HTMLElement|null} The column element or null
 */
function getColumnElement(columnId) {
    if (!columnId) return null;
    return document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
}

/**
 * Read first 1MB of file for hash calculation (safe for large files)
 * @param {File} file - File object to read
 * @returns {Promise<string>} Base64 encoded first 1MB (or entire file if smaller)
 */
function readPartialFileForHash(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const bytesToRead = Math.min(file.size, PARTIAL_HASH_SIZE);
        const blob = file.slice(0, bytesToRead);

        reader.onload = function(event) {
            try {
                const arrayBuffer = event.target.result;
                const uint8Array = new Uint8Array(arrayBuffer);
                let binary = '';
                for (let i = 0; i < uint8Array.length; i++) {
                    binary += String.fromCharCode(uint8Array[i]);
                }
                const base64 = btoa(binary);
                resolve(base64);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = function(error) {
            reject(error);
        };

        reader.readAsArrayBuffer(blob);
    });
}


// Use centralized DragStateManager instead of local state
// The dragStateManager is already available globally as window.dragState
// for backward compatibility

const DRAG_STATE_DEFAULTS = {
    isDragging: false,
    draggedTask: null,
    draggedColumn: null,
    draggedClipboardCard: null,
    draggedEmptyCard: null,
    // Column-specific
    draggedColumnId: null,
    originalColumnIndex: -1,
    originalColumnNextSibling: null,
    originalColumnParent: null,
    originalDataIndex: -1,

    // Task-specific
    originalTaskIndex: -1,
    originalTaskColumnId: null,
    originalTaskParent: null,
    originalTaskNextSibling: null,

    // Drop tracking
    lastValidDropTarget: null,
    lastDropTarget: null,
    lastRowDropTarget: null,
    lastRow: null,
    targetRowNumber: null,
    targetPosition: null,
    finalRowNumber: null,

    // Modifier keys
    altKeyPressed: false,

    // View tracking
    leftView: false,
    leftViewTimestamp: null,

    // Template dragging
    draggedTemplate: null,
    draggedTemplatePath: null,
    draggedTemplateName: null
};

function ensureDragStateDefaults(state) {
    const resolvedState = state || {};
    for (const [key, value] of Object.entries(DRAG_STATE_DEFAULTS)) {
        if (resolvedState[key] === undefined) {
            resolvedState[key] = value;
        }
    }
    return resolvedState;
}

// Create local references for frequently accessed properties
// Wait for dragStateManager to be available via window.dragState
let dragState = ensureDragStateDefaults(window.dragState);
window.dragState = dragState;

// Template drag state (separate from main drag state for clarity)
let templateDragState = {
    isDragging: false,
    templatePath: null,
    templateName: null,
    targetRow: null,
    targetPosition: null,  // 'before' | 'after' | 'first' | 'last'
    targetColumnId: null,
    isDropZone: false,     // true = dropping on drop zone (new stack), false = dropping within existing stack
    // FIX: Track the last valid in-stack target position
    // This prevents the target from being overwritten when mouse briefly crosses a drop zone during release
    lastInStackTarget: null  // { row, position, columnId } - saved when indicator shows between columns
};

// ============================================================================
// DROP INDICATOR FUNCTIONS (moved to utils/dropIndicatorManager.js)
// ============================================================================
// Helper wrappers that add dragState context to the manager calls
function showTaskDropIndicatorWithState(container, options) {
    window.dropIndicatorManager.showTaskDropIndicator(container, { ...options, dragState });
}
function showColumnDropIndicatorWithState(stack, beforeCol) {
    window.dropIndicatorManager.showColumnDropIndicator(stack, beforeCol, { dragState, templateDragState });
}
function hideDropIndicatorWithState() {
    window.dropIndicatorManager.hideDropIndicator(dragState);
}
function cleanupDropIndicatorLocal() {
    window.dropIndicatorManager.cleanupDropIndicator();
}
function cleanupDropZoneHighlightsLocal() {
    window.dropIndicatorManager.cleanupDropZoneHighlights();
}

function cleanupExternalDropIndicators() {
    hideDropFeedback();
    hideDropIndicatorWithState();
    cleanupDropZoneHighlightsLocal();
}

function resetTaskDragState() {
    dragState.draggedTask = null;
    dragState.originalTaskParent = null;
    dragState.originalTaskNextSibling = null;
    dragState.originalTaskIndex = -1;
    dragState.originalTaskColumnId = null;
}

function resetColumnDragState() {
    dragState.draggedColumn = null;
    dragState.draggedColumnId = null;
    dragState.originalDataIndex = -1;
    dragState.originalColumnParent = null;
    dragState.originalColumnNextSibling = null;
    dragState.originalColumnIndex = -1;
}

function resetDropTargets() {
    dragState.dropTargetContainer = null;
    dragState.dropTargetAfterElement = null;
    dragState.dropTargetStack = null;
    dragState.dropTargetBeforeColumn = null;
    dragState.pendingDropZone = null;
}

function clearLeftViewFlag() {
    if (dragState.isDragging && dragState.leftView) {
        dragState.leftView = false;
    }
}

function isInternalDragActive() {
    return dragState.isDragging &&
        (dragState.draggedColumn || dragState.draggedTask) &&
        !dragState.draggedClipboardCard &&
        !dragState.draggedEmptyCard;
}

function finalizeExternalDragState() {
    dragState.draggedClipboardCard = null;
    dragState.draggedEmptyCard = null;
    dragState.draggedDiagramCard = null;
    dragState.isDragging = false;
}

/**
 * Sets up global drag and drop event listeners
 * Purpose: Handle external file drops and clipboard operations
 * Used by: Board initialization
 * Side effects: Adds document-level event listeners
 */
function setupGlobalDragAndDrop() {

    const boardContainer = document.getElementById('kanban-container');
    const dropFeedback = document.getElementById('drop-zone-feedback');

    if (!boardContainer) {
        // Board container not found
        return;
    }

    // GLOBAL ESC key handler to cancel any drag operation
    // MEMORY FIX: This is added once globally, not per-task handle
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && dragState.isDragging && dragState.draggedTask) {
            restoreTaskPosition();
            dragState.draggedTask.classList.remove('dragging', 'drag-preview');

            // Reset drag state
            resetTaskDragState();
            dragState.isDragging = false;
            dragState.altKeyPressed = false;
        }
    });

    // CRITICAL FIX: Prevent text selections from being draggable
    // This prevents the bug where selecting text and dragging creates unintended tasks from text content
    // STRENGTHENED: Now prevents ALL text selection drags, even with Alt key
    document.addEventListener('dragstart', (e) => {
        // Check if there's an active text selection
        if (window.getSelection) {
            const selection = window.getSelection();
            const hasSelection = selection && selection.toString().trim().length > 0;

            if (hasSelection) {
                // There's a text selection - check if drag is from a designated drag handle
                const target = e.target;

                // More robust check for drag handles
                const isDragHandle = target &&
                    typeof target.closest === 'function' && (
                        target.classList?.contains('drag-handle') ||
                        target.classList?.contains('task-drag-handle') ||
                        target.closest('.drag-handle') ||
                        target.closest('.task-drag-handle') ||
                        target.closest('.column-drag-handle')
                    );

                // If NOT from a drag handle, prevent the text selection from being dragged
                if (!isDragHandle) {
                    console.warn('[DragDrop] Prevented text selection drag (text: "' + selection.toString().substring(0, 30) + '...")');
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation(); // Stop other listeners too
                    // Clear the selection
                    selection.removeAllRanges();
                    return false;
                }
            }
        }
    }, true); // Use capture phase to intercept early
    
    // Variables for throttling
    let lastIndicatorUpdate = 0;
    const INDICATOR_UPDATE_THROTTLE = 100;
    
    // Helper functions
    function isExternalFileDrag(e) {
        const dt = e.dataTransfer;
        if (!dt) {
            return false;
        }
        
        // Only log on drop events to reduce spam
        const isDropEvent = e.type === 'drop';
        if (isDropEvent) {
            }
        
        const hasFiles = Array.from(dt.types).some(t => t === 'Files' || t === 'files');
        if (hasFiles) {
            return true;
        }
        
        // Check for clipboard card type using drag state
        // We can't reliably read data during dragover due to browser security
        const hasClipboardCard = dragState.draggedClipboardCard !== null;
        const hasEmptyCard = dragState.draggedEmptyCard !== null;
        
        if (hasClipboardCard || hasEmptyCard) {
            return true;
        }
        
        if (isInternalDragActive()) {
            return false;
        }
        
        const hasUriList = Array.from(dt.types).some(t => t.toLowerCase() === 'text/uri-list');
        return hasUriList;
    }
    
    function showDropFeedback() {
        if (dropFeedback) {
            dropFeedback.classList.add('active');
        }
    }
    
    function hideDropFeedback() {
        if (dropFeedback) {
            dropFeedback.classList.remove('active');
        }
        boardContainer.classList.remove('drag-highlight');
    }
    
    // Main drop handler function  
    function handleExternalDrop(e) {
        // Handle external drop event

        // Prevent default browser behavior
        e.preventDefault();

        if (shouldSkipExternalDragIndicators()) {
            return;
        }
        
        // Stop event propagation to prevent duplicate handling
        e.stopPropagation();
        
        // Always clean up visual indicators
        cleanupExternalDropIndicators();

        const dt = e.dataTransfer;
        if (!dt) {
            // No dataTransfer available
            return;
        }
        
        
        // Priority 1: Check for clipboard images via dataTransfer (most reliable for images)
        const textData = dt.getData('text/plain');
        if (textData && textData.startsWith('CLIPBOARD_IMAGE:')) {
            const imageData = textData.substring('CLIPBOARD_IMAGE:'.length);
            handleClipboardImageDrop(e, imageData);
            finalizeExternalDragState();
            return;
        }

        // Priority 2: Check dragState for text clipboard/empty cards
        if (dragState.draggedClipboardCard) {
            // Regular clipboard card (text only)
            const clipboardData = JSON.stringify({
                type: 'clipboard-card',
                task: dragState.draggedClipboardCard
            });
            handleClipboardCardDrop(e, clipboardData);
            finalizeExternalDragState();
            return;
        }
        
        if (dragState.draggedEmptyCard) {
            const emptyCardData = JSON.stringify({
                type: 'empty-card',
                task: dragState.draggedEmptyCard
            });
            handleEmptyCardDrop(e, emptyCardData);
            finalizeExternalDragState();
            return;
        }

        // Priority 1.5: Check for diagram card (Excalidraw/DrawIO)
        if (dragState.draggedDiagramCard) {
            const diagramData = JSON.stringify({
                type: 'diagram-card',
                diagramType: dragState.draggedDiagramCard.type
            });
            if (typeof handleDiagramCardDrop === 'function') {
                handleDiagramCardDrop(e, diagramData);
            }
            finalizeExternalDragState();
            return;
        }

        // Priority 2: Check for files
        if (dt.files && dt.files.length > 0) {
            handleVSCodeFileDrop(e, dt.files);
            return;
        }
        
        // Priority 3: Check text data for special formats
        const textData2 = dt.getData('text/plain');
        
        if (textData2) {
            if (textData2.startsWith('CLIPBOARD_CARD:')) {
                const clipboardData = textData2.substring('CLIPBOARD_CARD:'.length);
                handleClipboardCardDrop(e, clipboardData);
            } else if (textData2.startsWith('EMPTY_CARD:')) {
                const emptyCardData = textData2.substring('EMPTY_CARD:'.length);
                handleEmptyCardDrop(e, emptyCardData);
            } else if (textData2.startsWith('DIAGRAM_CARD:')) {
                const diagramData = textData2.substring('DIAGRAM_CARD:'.length);
                if (typeof handleDiagramCardDrop === 'function') {
                    handleDiagramCardDrop(e, diagramData);
                }
            } else if (textData2.startsWith('MULTIPLE_FILES:')) {
                const filesContent = textData2.substring('MULTIPLE_FILES:'.length);
                handleMultipleFilesDrop(e, filesContent);
            } else if (textData2.startsWith('CLIPBOARD_IMAGE:')) {
                const imageData = textData2.substring('CLIPBOARD_IMAGE:'.length);
                handleClipboardImageDrop(e, imageData);
            } else if (fileTypeUtils.isFilePath(textData2)) {
                // File path detected (Unix or Windows)
                handleVSCodeUriDrop(e, textData2);
            } else {
                // Plain text - create a new card
                createTasksWithContent([{ title: textData2, description: '' }], { x: e.clientX, y: e.clientY });
            }
            return;
        }
        
        // Priority 4: Check for URI list
        const uriList = dt.getData('text/uri-list');
        if (uriList) {
            handleVSCodeUriDrop(e, uriList);
            return;
        }
    }
    
    function shouldSkipExternalDragIndicators() {
        if (isInternalDragActive()) {
            return true;
        }
        if (typeof templateDragState !== 'undefined' && templateDragState.isDragging) {
            return true;
        }
        return false;
    }

    // Board container dragover for external file drag indicators
    boardContainer.addEventListener('dragover', function(e) {
        // Always prevent default to allow drops
        e.preventDefault();

        // Skip visual indicators for internal column/task drags
        if (shouldSkipExternalDragIndicators()) {
            return; // Don't show external drop indicators during internal/template drags
        }

        // DIAGNOSTIC: Log external file drag handling (once per session)
        if (!window._externalDragLogged) {
            window._externalDragLogged = true;
        }

        // Show drop indicators for external drags using hierarchical lookup
        const now = Date.now();
        if (now - lastIndicatorUpdate >= INDICATOR_UPDATE_THROTTLE) {
            lastIndicatorUpdate = now;

            // Use hierarchical position finder: Row (Y) → Stack (X) → Column (X) → Task (Y midpoint)
            const dropResult = findDropPositionHierarchical(e.clientX, e.clientY, null);

            if (dropResult && dropResult.columnElement) {
                const columnContent = dropResult.columnElement.querySelector('.column-content');
                showTaskDropIndicatorWithState(columnContent, { clientY: e.clientY, column: dropResult.columnElement });
            } else {
                hideDropIndicatorWithState();
            }
            showDropFeedback();
        }
    }, false);
    
    boardContainer.addEventListener('drop', handleExternalDrop, false);
    
    boardContainer.addEventListener('dragenter', function(e) {
        // Skip external file drag handling if we're dragging internal elements
        if (shouldSkipExternalDragIndicators()) {
            return; // Don't show external drop feedback during internal/template drags
        }

        if (isExternalFileDrag(e)) {
            e.preventDefault();
            showDropFeedback();
        }
    }, false);
    
    boardContainer.addEventListener('dragleave', function(e) {
        // More robust check for actually leaving the board
        const rect = boardContainer.getBoundingClientRect();
        const isReallyLeaving = e.clientX < rect.left || e.clientX > rect.right ||
                               e.clientY < rect.top || e.clientY > rect.bottom;

        if (isReallyLeaving || (!boardContainer.contains(e.relatedTarget) && e.relatedTarget !== null)) {
            cleanupExternalDropIndicators();
        }
    }, false);

    // Document level handlers
    document.addEventListener('dragover', function(e) {
        // If we left the view and now dragover is firing, we're back!
        clearLeftViewFlag();

        if (!boardContainer.contains(e.target) && isExternalFileDrag(e)) {
            e.preventDefault();
        }
    }, false);

    // Use mousemove as a fallback to detect re-entry since dragenter/dragover might not fire
    document.addEventListener('mousemove', function(e) {
        clearLeftViewFlag();
    }, false);

    // Try mouseenter on body as another detection method
    document.body.addEventListener('mouseenter', function(e) {
        clearLeftViewFlag();
    }, false);

    // Try pointerenter which works during drag in some browsers
    document.addEventListener('pointerenter', function(e) {
        clearLeftViewFlag();
    }, { capture: true });

    document.addEventListener('drop', function(e) {
        if (!boardContainer.contains(e.target)) {
            e.preventDefault();
            // Clean up indicators if drop happens outside board
            cleanupExternalDropIndicators();
        }
    }, false);

    // ============================================================================
    // UNIFIED DRAGEND HELPER FUNCTIONS
    // ============================================================================

    function restoreTaskToOriginalPosition() {
        restoreTaskPosition();
    }

    function restoreColumnToOriginalPosition() {
        // dragLogger.always('restoreColumnToOriginalPosition called', {
        //     hasColumn: !!dragState.draggedColumn,
        //     hasParent: !!dragState.originalColumnParent,
        //     hasSibling: !!dragState.originalColumnNextSibling,
        //     columnId: dragState.draggedColumn?.dataset?.columnId,
        //     currentParent: dragState.draggedColumn?.parentNode?.className
        // });

        if (!dragState.draggedColumn || !dragState.originalColumnParent) {
            // dragLogger.always('restoreColumnToOriginalPosition ABORTED - missing column or parent');
            return;
        }

        // Store current position before restoration
        const currentParent = dragState.draggedColumn.parentNode;
        const currentIndex = currentParent ? Array.from(currentParent.children).indexOf(dragState.draggedColumn) : -1;
        const originalIndex = dragState.originalColumnIndex;

        // dragLogger.always('Restoring column to original position', {
        //     currentParentClass: currentParent?.className,
        //     currentIndex: currentIndex,
        //     originalParentClass: dragState.originalColumnParent?.className,
        //     originalIndex: originalIndex
        // });

        // Check if restoration is actually needed
        const sameParent = currentParent === dragState.originalColumnParent;
        const needsRestore = !sameParent || currentIndex !== originalIndex;

        // dragLogger.always('Column restoration check', {
        //     sameParent,
        //     needsRestore,
        //     originalIndex,
        //     currentIndex
        // });

        if (!needsRestore) {
            // dragLogger.always('Column already at original position - no restoration needed');
            return;
        }

        // Remove from current position
        if (dragState.draggedColumn.parentNode) {
            dragState.draggedColumn.parentNode.removeChild(dragState.draggedColumn);
            // dragLogger.always('Removed column from current position');
        }

        // Restore to original position using the stored index
        const parentChildren = Array.from(dragState.originalColumnParent.children);
        if (originalIndex >= parentChildren.length) {
            // Restore at end
            dragState.originalColumnParent.appendChild(dragState.draggedColumn);
            // dragLogger.always('Column restored using appendChild (at end)', {
            //     finalIndex: Array.from(dragState.originalColumnParent.children).indexOf(dragState.draggedColumn)
            // });
        } else {
            // Insert at original index
            const referenceNode = parentChildren[originalIndex];
            dragState.originalColumnParent.insertBefore(dragState.draggedColumn, referenceNode);
            // dragLogger.always('Column restored using insertBefore', {
            //     finalIndex: Array.from(dragState.originalColumnParent.children).indexOf(dragState.draggedColumn),
            //     targetIndex: originalIndex
            // });
        }

        // ALSO restore in the data model (cachedBoard) to prevent re-renders from moving it back
        const columnId = dragState.draggedColumnId;

        // dragLogger.always('Checking data model restoration', {
        //     hasCachedBoard: !!window.cachedBoard,
        //     hasColumnId: !!columnId,
        //     originalDataIndex: dragState.originalDataIndex
        // });

        if (window.cachedBoard && columnId && dragState.originalDataIndex >= 0) {
            const currentColumnIndex = window.cachedBoard.columns.findIndex(c => c.id === columnId);

            // dragLogger.always('Data model column position', {
            //     currentColumnIndex,
            //     originalDataIndex: dragState.originalDataIndex,
            //     needsRestore: currentColumnIndex !== dragState.originalDataIndex
            // });

            if (currentColumnIndex >= 0 && currentColumnIndex !== dragState.originalDataIndex) {
                // Remove from current position
                const [column] = window.cachedBoard.columns.splice(currentColumnIndex, 1);

                // Insert at original position
                const insertIndex = Math.min(dragState.originalDataIndex, window.cachedBoard.columns.length);
                window.cachedBoard.columns.splice(insertIndex, 0, column);

                // dragLogger.always('Column restored in data model', {
                //     from: currentColumnIndex,
                //     to: insertIndex,
                //     originalDataIndex: dragState.originalDataIndex
                // });
            } else {
                // dragLogger.always('Data model restoration SKIPPED', {
                //     reason: currentColumnIndex < 0 ? 'column not found' : 'already at correct position'
                // });
            }
        } else {
            // dragLogger.always('Data model restoration ABORTED', {
            //     reason: !window.cachedBoard ? 'no cachedBoard' : !columnId ? 'no columnId' : 'invalid originalDataIndex'
            // });
        }
    }

    function processTaskDrop() {
        const taskItem = dragState.draggedTask;
        if (!taskItem) {
            return;
        }

        // PERFORMANCE: Use stored drop target from indicator (not current DOM position)
        const finalParent = dragState.dropTargetContainer || taskItem.parentNode;
        const afterElement = dragState.dropTargetAfterElement;

        // Now perform the ACTUAL DOM move (only happens once on drop, not during drag!)
        if (afterElement) {
            finalParent.insertBefore(taskItem, afterElement);
        } else {
            // Drop at end
            const addButton = finalParent.querySelector('.add-task-btn');
            if (addButton) {
                finalParent.insertBefore(taskItem, addButton);
            } else {
                finalParent.appendChild(taskItem);
            }
        }

        // Remove drag-source class
        taskItem.classList.remove('drag-source');

        // Get final position after move
        const finalColumnElement = finalParent?.closest('.kanban-full-height-column');
        const finalColumnId = finalColumnElement?.dataset.columnId;

        if (!finalParent || !finalColumnId) {
            return;
        }

        const originalColumnElement = dragState.originalTaskParent?.closest('.kanban-full-height-column');
        const originalColumnId = dragState.originalTaskColumnId || originalColumnElement?.dataset.columnId;

        const finalTaskItems = Array.from(finalParent.querySelectorAll(':scope > .task-item'));
        const finalIndex = finalTaskItems.indexOf(taskItem);

        // Check if position actually changed
        const positionChanged = finalParent !== dragState.originalTaskParent ||
                               finalIndex !== dragState.originalTaskIndex;

        if (!positionChanged || !originalColumnId) {
            return;
        }

        // Calculate the proper index for the data model based on task-only order
        const toIndex = finalTaskItems.indexOf(taskItem);
        const fromIndex = dragState.originalTaskIndex;

        // Unfold the destination column if it's collapsed (unless Alt key was pressed during drag)
        if (typeof unfoldColumnIfCollapsed === 'function') {
            const skipUnfold = dragState.altKeyPressed;
            unfoldColumnIfCollapsed(finalColumnId, skipUnfold);
        }

        // Update cached board
        if (window.cachedBoard) {
            const taskId = taskItem.dataset.taskId;

            // Find and remove task from original column
            const originalColumn = window.cachedBoard.columns.find(col => col.id === originalColumnId);
            const finalColumn = window.cachedBoard.columns.find(col => col.id === finalColumnId);

            if (originalColumn && finalColumn) {
                const taskIndex = originalColumn.tasks.findIndex(t => t.id === taskId);
                if (taskIndex >= 0) {
                    const insertIndex = toIndex >= 0 ? Math.min(toIndex, finalColumn.tasks.length) : finalColumn.tasks.length;
                    const undoSnapshot = JSON.parse(JSON.stringify(window.cachedBoard));

                    // Save undo state with positions BEFORE mutating cached board
                    console.log('[kanban.dragDrop.processTaskDrop.undo-capture]', {
                        taskId: taskId,
                        fromColumnId: originalColumnId,
                        toColumnId: finalColumnId,
                        fromIndex: fromIndex,
                        toIndex: insertIndex
                    });
                    vscode.postMessage({
                        type: 'saveUndoState',
                        operation: originalColumnId !== finalColumnId ? 'moveTaskViaDrag' : 'reorderTaskViaDrag',
                        taskId: taskId,
                        fromColumnId: originalColumnId,
                        fromIndex: fromIndex,
                        toColumnId: finalColumnId,
                        toIndex: insertIndex,
                        currentBoard: undoSnapshot
                    });

                    const [task] = originalColumn.tasks.splice(taskIndex, 1);

                    // Add task to new column at correct position
                    finalColumn.tasks.splice(insertIndex, 0, task);

                    // Update column displays after task move
                    if (typeof window.updateColumnDisplay === 'function') {
                        window.updateColumnDisplay(originalColumnId);
                        if (originalColumnId !== finalColumnId) {
                            window.updateColumnDisplay(finalColumnId);
                        }
                    }

                    // Check empty state for both columns
                    if (typeof updateColumnEmptyState === 'function') {
                        updateColumnEmptyState(originalColumnId);
                        if (originalColumnId !== finalColumnId) {
                            updateColumnEmptyState(finalColumnId);
                        }
                    }

                    // Update the task element's onclick handlers to reference the new columnId
                    if (originalColumnId !== finalColumnId) {
                        const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
                        if (taskElement) {
                            const taskItemEl = taskElement.closest('.task-item');
                            if (taskItemEl) {
                                // Update task-title-container onclick
                                const titleContainer = taskItemEl.querySelector('.task-title-container');
                                if (titleContainer) {
                                    const oldOnclick = titleContainer.getAttribute('onclick');
                                    if (oldOnclick) {
                                        const newOnclick = oldOnclick.replace(
                                            `'${originalColumnId}'`,
                                            `'${finalColumnId}'`
                                        );
                                        titleContainer.setAttribute('onclick', newOnclick);
                                    }
                                }

                                // Update task-description onclick
                                const descContainer = taskItemEl.querySelector('.task-description');
                                if (descContainer) {
                                    const oldOnclick = descContainer.getAttribute('onclick');
                                    if (oldOnclick) {
                                        const newOnclick = oldOnclick.replace(
                                            `'${originalColumnId}'`,
                                            `'${finalColumnId}'`
                                        );
                                        descContainer.setAttribute('onclick', newOnclick);
                                    }
                                }

                                // Update task-collapse-toggle onclick
                                const collapseToggle = taskItemEl.querySelector('.task-collapse-toggle');
                                if (collapseToggle) {
                                    const oldOnclick = collapseToggle.getAttribute('onclick');
                                    if (oldOnclick) {
                                        const newOnclick = oldOnclick.replace(
                                            `'${originalColumnId}'`,
                                            `'${finalColumnId}'`
                                        );
                                        collapseToggle.setAttribute('onclick', newOnclick);
                                    }
                                }
                            }
                        }
                    }

                    // Re-initialize the task element after move
                    if (typeof window.initializeTaskElement === 'function') {
                        const movedTaskElement = document.querySelector(`[data-task-id="${taskId}"]`);
                        if (movedTaskElement) {
                            window.initializeTaskElement(movedTaskElement);
                        }
                    }
                }
            }
        }

        // Mark as unsaved
        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }

        // Recalculate only affected stacks (not entire board)
        const sourceStack = originalColumnElement?.closest('.kanban-column-stack');
        const targetStack = finalColumnElement?.closest('.kanban-column-stack');
        if (typeof window.updateStackLayoutDebounced === 'function') {
            if (sourceStack) {
                window.updateStackLayoutDebounced(sourceStack);
            }
            if (targetStack && targetStack !== sourceStack) {
                window.updateStackLayoutDebounced(targetStack);
            }
        }
    }

    function processColumnDrop() {
        // dragLogger.always('[processColumnDrop] Called', {
        //     hasColumn: !!dragState.draggedColumn,
        //     columnId: dragState.draggedColumnId
        // });

        const columnElement = dragState.draggedColumn;
        const columnId = dragState.draggedColumnId;

        if (!columnElement || !columnId) {
            // dragLogger.always('[processColumnDrop] ABORTED - missing column or columnId');
            return;
        }

        const boardElement = document.getElementById('kanban-board');
        if (!boardElement) {
            // dragLogger.always('[processColumnDrop] ABORTED - no board element');
            return;
        }

        // Capture undo state BEFORE modifying the board
        // Column drops modify order, row tags, and #stack tags - all need to be undoable
        if (window.cachedBoard) {
            vscode.postMessage({
                type: 'saveUndoState',
                operation: 'moveColumnViaDrag',
                columnId: columnId,
                currentBoard: window.cachedBoard
            });
        }

        // dragLogger.always('[processColumnDrop] Processing column drop');

        // PERFORMANCE: Move column to drop target NOW (was stored during dragover)
        if (dragState.dropTargetStack && dragState.dropTargetBeforeColumn !== undefined) {
            const targetStack = dragState.dropTargetStack;
            const beforeColumn = dragState.dropTargetBeforeColumn;

            // Move column from its current position to target position
            if (beforeColumn) {
                targetStack.insertBefore(columnElement, beforeColumn);
            } else {
                // Append at end of stack
                targetStack.appendChild(columnElement);
            }

            // Clean up empty source stack if needed
            const sourceStack = dragState.originalColumnParent;
            if (sourceStack && sourceStack !== targetStack && sourceStack.classList.contains('kanban-column-stack')) {
                cleanupEmptyStack(sourceStack);
            }
        } else {
            console.warn('[ColumnDrop] No drop target stored!', {
                hasStack: !!dragState.dropTargetStack,
                beforeColumn: dragState.dropTargetBeforeColumn,
                pendingDropZone: !!dragState.pendingDropZone
            });
        }

        // Process pending drop zone if hovering over one
        if (dragState.pendingDropZone) {
            const dropZone = dragState.pendingDropZone;
            const dropZoneStack = dropZone.parentNode;

            if (dropZoneStack && dropZoneStack.parentNode) {
                const rowOrBoard = dropZoneStack.parentNode;
                const currentStack = dragState.draggedColumn.parentNode;

                if (currentStack && currentStack.classList.contains('kanban-column-stack')) {
                    // Extract column from current stack
                    currentStack.removeChild(dragState.draggedColumn);
                    cleanupEmptyStack(currentStack);

                    // Remove drop zone element
                    if (dropZone.parentNode === dropZoneStack) {
                        dropZoneStack.removeChild(dropZone);
                    }

                    // Convert drop zone stack to regular stack
                    dropZoneStack.classList.remove('column-drop-zone-stack');
                    dropZoneStack.appendChild(dragState.draggedColumn);

                    // Recreate drop zones
                    cleanupAndRecreateDropZones(rowOrBoard);

                    // Recalculate heights for both source and new target stack
                    if (typeof window.updateStackLayoutImmediate === 'function') {
                        if (currentStack && document.body.contains(currentStack)) {
                            window.updateStackLayoutImmediate(currentStack);
                        }
                        window.updateStackLayoutImmediate(dropZoneStack);
                    }
                }
            }

            dragState.pendingDropZone = null;
        }

        // Clean up any duplicate or orphaned elements in the DOM
        const allColumnsForCleanup = document.querySelectorAll('.kanban-full-height-column');
        const seenColumnIds = new Set();
        allColumnsForCleanup.forEach(col => {
            const colId = col.getAttribute('data-column-id');
            if (seenColumnIds.has(colId)) {
                col.remove();
            } else {
                seenColumnIds.add(colId);
            }
        });

        // Calculate target position based on where the column is in the DOM now
        const allColumns = Array.from(boardElement.querySelectorAll('.kanban-full-height-column'));
        const newOrder = allColumns.map(col => col.getAttribute('data-column-id'));

        // Get row number
        const parentRow = columnElement.closest('.kanban-row');
        const newRow = parentRow ? parseInt(parentRow.getAttribute('data-row-number') || '1') : 1;

        // Update the column's row tag in the data
        if (window.cachedBoard) {
            const cachedColumn = window.cachedBoard.columns.find(col => col.id === columnId);
            if (cachedColumn) {
                let cleanTitle = cachedColumn.title
                    .replace(/#row\d+\b/gi, '')
                    .replace(/\s+#row\d+/gi, '')
                    .replace(/#row\d+\s+/gi, '')
                    .replace(/\s+#row\d+\s+/gi, '')
                    .trim();

                if (newRow > 1) {
                    cachedColumn.title = cleanTitle ? cleanTitle + ` #row${newRow}` : ` #row${newRow}`;
                } else {
                    cachedColumn.title = cleanTitle;
                }
            }
        }

        // SHARED: Sync data to DOM order
        syncColumnDataToDOMOrder();

        // SHARED: Finalize (normalize tags, recalc heights, update drop zones)
        finalizeColumnDrop();

        // Additional processing specific to column moves (not new columns)
        const sourceStack = dragState.originalColumnParent;
        const targetStack = columnElement.closest('.kanban-column-stack');

        // Enforce horizontal folding for stacked columns
        if (typeof window.enforceFoldModesForStacks === 'function' && targetStack) {
            window.enforceFoldModesForStacks(targetStack);
        }
    }

    /**
     * SHARED: Sync cachedBoard.columns order to match DOM order.
     * Called after any column position change (move or insert).
     */
    function syncColumnDataToDOMOrder() {
        const boardElement = document.getElementById('kanban-board');
        if (!boardElement || !window.cachedBoard) return;

        const allColumns = Array.from(boardElement.querySelectorAll('.kanban-full-height-column'));
        const newOrder = allColumns.map(col => col.getAttribute('data-column-id'));

        const reorderedColumns = newOrder.map(colId =>
            window.cachedBoard.columns.find(col => col.id === colId)
        ).filter(Boolean);

        window.cachedBoard.columns = reorderedColumns;
    }

    /**
     * SHARED: Finalize column drop - normalize tags, recalc heights, update drop zones.
     * Called after any column position change (move or insert).
     */
    function finalizeColumnDrop() {
        // Normalize stack tags based on DOM structure
        normalizeAllStackTags();

        // Mark as unsaved
        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }

        // Recalculate stack heights
        if (typeof window.recalculateAllStackHeights === 'function') {
            window.recalculateAllStackHeights();
        }

        // Update drop zones - both stack-bottom zones AND between-stack drop zones
        if (typeof window.updateStackBottomDropZones === 'function') {
            window.updateStackBottomDropZones();
        }

        // Recreate drop zone stacks (between columns) for all rows and the board
        const boardElement = document.getElementById('kanban-board');
        if (boardElement) {
            // Update drop zones for each row
            const rows = boardElement.querySelectorAll('.kanban-row');
            rows.forEach(row => {
                cleanupAndRecreateDropZones(row);
            });

            // Update drop zones for board level (row 1 columns not in a .kanban-row)
            const hasRowContainers = rows.length > 0;
            if (!hasRowContainers) {
                cleanupAndRecreateDropZones(boardElement);
            }
        }
    }

    /**
     * Insert a new column using the SAME approach as processColumnDrop:
     * 1. Save target info (column IDs) before render
     * 2. Add column to cachedBoard, render
     * 3. Move new column element to target using DOM manipulation (same as processColumnDrop)
     * 4. normalizeAllStackTags() handles #stack tags (same as processColumnDrop)
     */
    function insertColumnAtPosition(columnData) {
        if (!window.cachedBoard || !dragState.dropTargetStack) {
            console.warn('[insertColumnAtPosition] Missing cachedBoard or dropTargetStack', {
                hasCachedBoard: !!window.cachedBoard,
                hasDropTargetStack: !!dragState.dropTargetStack
            });
            return false;
        }

        // Capture undo state BEFORE modifying the board
        // Column insertion modifies columns array, row tags, and #stack tags - all need to be undoable
        vscode.postMessage({
            type: 'saveUndoState',
            operation: 'insertColumnAtPosition',
            currentBoard: window.cachedBoard
        });

        // Step 1: Save target info BEFORE render destroys DOM references
        const targetStackFirstColId = dragState.dropTargetStack.querySelector('.kanban-full-height-column')?.dataset?.columnId;
        const beforeColumnId = dragState.dropTargetBeforeColumn?.dataset?.columnId || null;
        const isDropZone = dragState.dropTargetStack.classList.contains('column-drop-zone-stack');

        // Get row number for #row tag
        const targetRowElement = dragState.dropTargetStack.closest('.kanban-row');
        const targetRow = targetRowElement ? parseInt(targetRowElement.getAttribute('data-row-number') || '1') : 1;

        // For drop zones, save info to find position after render
        let dropZonePrevColId = null;
        let dropZoneNextColId = null;
        if (isDropZone) {
            const prevStack = dragState.dropTargetStack.previousElementSibling;
            if (prevStack?.classList.contains('kanban-column-stack')) {
                const lastCol = prevStack.querySelector('.kanban-full-height-column:last-child');
                dropZonePrevColId = lastCol?.dataset?.columnId;
            }
            const nextStack = dragState.dropTargetStack.nextElementSibling;
            if (nextStack?.classList.contains('kanban-column-stack')) {
                const firstCol = nextStack.querySelector('.kanban-full-height-column:first-child');
                dropZoneNextColId = firstCol?.dataset?.columnId;
            }
        }

        // Step 2: Create column data (only #row tag - #stack handled by normalizeAllStackTags)
        const newColumnId = columnData.id || `col-${Date.now()}`;
        let title = columnData.title || '';
        if (targetRow > 1 && !/#row\d+/i.test(title)) {
            title = title ? `${title} #row${targetRow}` : `#row${targetRow}`;
        }

        const newColumn = {
            id: newColumnId,
            title: title,
            tasks: columnData.tasks || [],
            settings: columnData.settings || {}
        };

        // Step 3: Add to cachedBoard at END and render (column will appear at end)
        window.cachedBoard.columns.push(newColumn);
        if (typeof window.renderBoard === 'function') {
            window.renderBoard();
        }

        // Step 4: Find elements after render
        const newColumnElement = getColumnElement(newColumnId);
        if (!newColumnElement) {
            console.warn('[insertColumnAtPosition] Could not find new column element');
            return false;
        }

        // Save source stack BEFORE moving (for cleanup later)
        const sourceStack = newColumnElement.closest('.kanban-column-stack');

        // Find target stack and beforeColumn after render
        let targetStack = null;
        let beforeColumn = null;

        if (isDropZone) {
            // For drop zones: column should be in its own new stack
            // Just need to position it correctly between stacks
            // The column is already in its own stack from render, just need to move that stack
            const newColStack = sourceStack;
            const parentRow = newColStack?.closest('.kanban-row');

            if (parentRow && dropZonePrevColId) {
                const prevCol = getColumnElement(dropZonePrevColId);
                const prevStack = prevCol?.closest('.kanban-column-stack');
                if (prevStack && newColStack && prevStack.nextElementSibling !== newColStack) {
                    // Move the new column's stack to after the previous stack
                    prevStack.parentNode.insertBefore(newColStack, prevStack.nextElementSibling);
                }
            } else if (parentRow && dropZoneNextColId) {
                const nextCol = getColumnElement(dropZoneNextColId);
                const nextStack = nextCol?.closest('.kanban-column-stack');
                if (nextStack && newColStack) {
                    // Move the new column's stack to before the next stack
                    nextStack.parentNode.insertBefore(newColStack, nextStack);
                }
            }
            // For drop zones, column stays in its own stack - no cleanup needed
        } else if (targetStackFirstColId) {
            // Find target stack by its first column
            const firstCol = getColumnElement(targetStackFirstColId);
            targetStack = firstCol?.closest('.kanban-column-stack');

            if (beforeColumnId) {
                beforeColumn = getColumnElement(beforeColumnId);
            }

            // Step 5: Move column to target position - SAME as processColumnDrop
            if (targetStack && targetStack !== sourceStack) {
                if (beforeColumn) {
                    targetStack.insertBefore(newColumnElement, beforeColumn);
                } else {
                    targetStack.appendChild(newColumnElement);
                }

                // Clean up empty source stack - use saved reference, check for columns not :empty
                if (sourceStack && !sourceStack.querySelector('.kanban-full-height-column')) {
                    sourceStack.remove();
                }
            } else if (targetStack && beforeColumn) {
                // Same stack, just reposition
                targetStack.insertBefore(newColumnElement, beforeColumn);
            }
        }
        // Fallback: if neither isDropZone nor targetStackFirstColId, column stays where render put it

        // Step 6: Sync cachedBoard to match DOM order (same as processColumnDrop)
        syncColumnDataToDOMOrder();

        // Step 7: Finalize - normalizeAllStackTags() will fix #stack tags (same as processColumnDrop)
        // IMPORTANT: Call directly (not in requestAnimationFrame) to match processColumnDrop behavior
        finalizeColumnDrop();

        return true;
    }

    /**
     * Handle template columns after they're applied by backend
     * Uses the SAME approach as insertColumnAtPosition:
     * - Move columns in DOM to correct position
     * - syncColumnDataToDOMOrder()
     * - finalizeColumnDrop() which calls normalizeAllStackTags()
     *
     * @param {object} message - The templateApplied message from backend
     */
    function handleTemplateApplied(message) {
        if (!message.newColumnIds || message.newColumnIds.length === 0) return;

        const { newColumnIds, insertAfterColumnId, insertBeforeColumnId, isDropZone } = message;

        if (isDropZone) {
            // Drop zone: each template column stays in its own stack, just position between stacks
            let lastMovedStack = null;

            if (insertAfterColumnId) {
                const afterCol = getColumnElement(insertAfterColumnId);
                lastMovedStack = afterCol?.closest('.kanban-column-stack');

                if (lastMovedStack) {
                    for (const colId of newColumnIds) {
                        const colElement = getColumnElement(colId);
                        const colStack = colElement?.closest('.kanban-column-stack');
                        if (colStack && colStack !== lastMovedStack) {
                            lastMovedStack.parentNode.insertBefore(colStack, lastMovedStack.nextElementSibling);
                            lastMovedStack = colStack; // Track for next iteration
                        }
                    }
                }
            } else if (insertBeforeColumnId) {
                const beforeCol = getColumnElement(insertBeforeColumnId);
                const beforeStack = beforeCol?.closest('.kanban-column-stack');

                if (beforeStack) {
                    for (const colId of newColumnIds) {
                        const colElement = getColumnElement(colId);
                        const colStack = colElement?.closest('.kanban-column-stack');
                        if (colStack && colStack !== beforeStack) {
                            beforeStack.parentNode.insertBefore(colStack, beforeStack);
                        }
                    }
                }
            }
        } else {
            // Not a drop zone: move columns INTO an existing stack (same as insertColumnAtPosition)
            let targetStack = null;
            let beforeColumn = null;

            if (insertAfterColumnId) {
                const afterCol = getColumnElement(insertAfterColumnId);
                targetStack = afterCol?.closest('.kanban-column-stack');
                beforeColumn = afterCol?.nextElementSibling;
            } else if (insertBeforeColumnId) {
                beforeColumn = getColumnElement(insertBeforeColumnId);
                targetStack = beforeColumn?.closest('.kanban-column-stack');
            }

            if (targetStack) {
                for (const colId of newColumnIds) {
                    const colElement = getColumnElement(colId);
                    if (!colElement) continue;

                    const sourceStack = colElement.closest('.kanban-column-stack');

                    // Move column to target (same as insertColumnAtPosition)
                    if (targetStack !== sourceStack) {
                        if (beforeColumn) {
                            targetStack.insertBefore(colElement, beforeColumn);
                        } else {
                            targetStack.appendChild(colElement);
                        }

                        // Clean up empty source stack
                        if (sourceStack && !sourceStack.querySelector('.kanban-full-height-column')) {
                            sourceStack.remove();
                        }
                    } else if (beforeColumn) {
                        targetStack.insertBefore(colElement, beforeColumn);
                    }

                    // Update beforeColumn for next column (insert after this one)
                    beforeColumn = colElement.nextElementSibling;
                }
            }
        }

        // Use the SAME finalization as processColumnDrop
        // IMPORTANT: Call directly (not in requestAnimationFrame) to match processColumnDrop behavior
        syncColumnDataToDOMOrder();
        finalizeColumnDrop();
    }

    // Expose handleTemplateApplied to window for webview.js to call
    window.handleTemplateApplied = handleTemplateApplied;

    /**
     * Process template column drop (empty column, clipboard column, or template)
     * Uses the SAME position tracking as processColumnDrop (dragState.dropTargetStack/dropTargetBeforeColumn)
     */
    function processTemplateColumnDrop() {
        // Check drop target directly (same as processColumnDrop)
        if (!dragState.dropTargetStack) {
            console.warn('[processTemplateColumnDrop] No drop target stack');
            return;
        }

        if (templateDragState.isEmptyColumn) {
            // Create empty column - uses dragState.dropTargetStack/dropTargetBeforeColumn directly
            insertColumnAtPosition({
                title: 'New Column',
                tasks: [],
                settings: {}
            });
        } else if (templateDragState.isClipboardColumn) {
            // Parse clipboard content and create column
            const clipboardContent = templateDragState.clipboardContent;
            if (window.PresentationParser && clipboardContent) {
                const parsedData = window.PresentationParser.parseClipboardAsColumn(clipboardContent);
                insertColumnAtPosition({
                    title: parsedData.columnTitle || '',
                    tasks: parsedData.tasks || [],
                    settings: {}
                });
            }
        } else if (templateDragState.templatePath) {
            // Template column - use existing applyTemplateAtPosition (sends to backend)
            applyTemplateAtPosition();
        }

        // Reset templateDragState
        templateDragState.isDragging = false;
        templateDragState.templatePath = null;
        templateDragState.templateName = null;
        templateDragState.isEmptyColumn = false;
        templateDragState.isClipboardColumn = false;
        templateDragState.clipboardContent = null;
        templateDragState.targetRow = null;
        templateDragState.targetPosition = null;
        templateDragState.targetColumnId = null;
        templateDragState.isDropZone = false;
        templateDragState.lastInStackTarget = null;

        // Clear dragState drop targets
        dragState.dropTargetStack = null;
        dragState.dropTargetBeforeColumn = null;

        // Hide indicator
        hideDropIndicatorWithState();

        // Remove board template-dragging class
        const boardElement = document.getElementById('kanban-board');
        if (boardElement) {
            boardElement.classList.remove('template-dragging');
        }

        // Clear highlights
        clearHighlights();
    }

    function cleanupDragVisuals() {
        // PERFORMANCE: Hide internal drop indicator
        hideDropIndicatorWithState();

        // Remove visual feedback from tasks
        if (dragState.draggedTask) {
            dragState.draggedTask.classList.remove('dragging', 'drag-preview', 'drag-source');
        }

        // Remove visual feedback from columns
        if (dragState.draggedColumn) {
            dragState.draggedColumn.classList.remove('dragging', 'drag-preview', 'drag-source');
        }

        const boardElement = document.getElementById('kanban-board');
        if (boardElement) {
            // PERFORMANCE: Clean up task styles ONLY in affected columns (not all tasks on board!)
            if (dragState.affectedColumns && dragState.affectedColumns.size > 0) {
                dragState.affectedColumns.forEach(tasksContainer => {
                    if (tasksContainer && tasksContainer.querySelectorAll) {
                        tasksContainer.querySelectorAll('.task-item').forEach(task => {
                            task.classList.remove('drag-transitioning');
                        });
                    }
                });
                dragState.affectedColumns.clear();
            } else {
                // Fallback: clean all tasks if tracking failed
                boardElement.querySelectorAll('.task-item').forEach(task => {
                    task.classList.remove('drag-transitioning');
                });
            }

            // Clean up column styles
            boardElement.querySelectorAll('.kanban-full-height-column').forEach(col => {
                col.classList.remove('drag-over-append', 'drag-over', 'drag-transitioning', 'external-drag-over');
            });

            // Clean up row styles
            boardElement.querySelectorAll('.kanban-row').forEach(row => {
                row.classList.remove('drag-over');
            });
        }

        // Clean up drop feedback and indicators
        cleanupExternalDropIndicators();
    }

    function resetDragState() {
        // Reset all drag state properties
        dragState.draggedClipboardCard = null;
        dragState.draggedEmptyCard = null;
        resetTaskDragState();
        resetColumnDragState();
        dragState.isDragging = false;
        dragState.lastDropTarget = null;
        dragState.leftView = false;
        dragState.leftViewTimestamp = null;

        // Reset drop target tracking
        resetDropTargets();

        // Reset RAF throttle flags
        dragState.columnDragoverPending = false;
        dragState.documentDragoverPending = false;
    }

    // ============================================================================
    // UNIFIED GLOBAL DRAGEND HANDLER
    // ============================================================================

    // Global dragend handler - UNIFIED APPROACH
    document.addEventListener('dragend', function(e) {
        // DIAGNOSTIC: Reset log flags for next drag session
        window._dragoverLogCount = 0;
        window._currentDragSessionLogged = false;
        window._dropAtEndLogged = false;
        window._indicatorShownLogged = false;
        window._externalDragLogged = false;
        window._externalInWrongHandlerLogged = false;

        // 1. CAPTURE STATE BEFORE ANY CLEANUP
        const wasTask = !!dragState.draggedTask;
        const wasColumn = !!dragState.draggedColumn;
        const wasDragging = dragState.isDragging;

        // Also check for template column drags (empty column, clipboard column, or template)
        const wasTemplateColumnDrag = typeof templateDragState !== 'undefined' &&
            templateDragState.isDragging &&
            (templateDragState.isEmptyColumn || templateDragState.isClipboardColumn || templateDragState.templatePath);
        const droppedOutside = e.dataTransfer?.dropEffect === 'none';

        const leftView = dragState.leftView;

        // Get current position for debugging
        const currentTaskParent = wasTask ? dragState.draggedTask?.parentNode : null;
        const currentColumnParent = wasColumn ? dragState.draggedColumn?.parentNode : null;

        // Log for debugging (only if state changed)
        const timeSinceLeftView = dragState.leftViewTimestamp ? Date.now() - dragState.leftViewTimestamp : null;
        const logData = {
            dropEffect: e.dataTransfer?.dropEffect,
            wasDragging: wasDragging,
            wasTask: wasTask,
            wasColumn: wasColumn,
            leftView: leftView,
            timeSinceLeftView: timeSinceLeftView,
            taskMovedFromOriginal: wasTask && currentTaskParent !== dragState.originalTaskParent,
            columnMovedFromOriginal: wasColumn && currentColumnParent !== dragState.originalColumnParent
        };

        // dragLogger.always('[dragend] State captured', logData);

        // 2. DECIDE: RESTORE OR PROCESS
        let shouldRestore = false;

        if (wasDragging) {
            // Only restore if explicitly dropped outside window (dropEffect === 'none')
            // Do NOT restore based on leftView since we can't detect re-entry in VS Code webviews
            shouldRestore = droppedOutside;

            // dragLogger.always('[dragend] Decision', {
            //     shouldRestore,
            //     reason: shouldRestore ? 'dropped outside window' : 'process drop'
            // });
        } else {
            // dragLogger.always('[dragend] SKIPPING - wasDragging is false (already cleaned up by dragleave?)');
        }

        // 3. EXECUTE RESTORATION OR PROCESSING
        if (shouldRestore) {
            // RESTORE - user dragged outside or cancelled
            // dragLogger.always('[dragend] Executing RESTORE path');
            if (wasTask) {
                restoreTaskToOriginalPosition();
            }
            if (wasColumn) {
                restoreColumnToOriginalPosition();
            }
        } else if (wasDragging || wasTemplateColumnDrag) {
            // PROCESS - valid drop, process the changes
            // dragLogger.always('[dragend] Executing PROCESS path');
            if (wasTask) {
                processTaskDrop();
            }
            if (wasColumn) {
                processColumnDrop();
            }
            // Handle template column drags (empty column, clipboard column, or template)
            if (wasTemplateColumnDrag && dragState.dropTargetStack) {
                processTemplateColumnDrop();
            }
        }

        // 4. VISUAL CLEANUP (always, regardless of restore or process)
        cleanupDragVisuals();

        // 5. STATE CLEANUP (always, at the very end)
        resetDragState();

    }, false);

    // Handle cursor leaving the window during drag
    // This helps detect when the drag operation is lost
    document.addEventListener('dragleave', function(e) {
        if (dragState.isDragging) {
            // Use smart logger to avoid spam - only log when relatedTarget changes
            // const logKey = 'dragleave-' + (e.relatedTarget ? 'element' : 'null');
            // dragLogger.log(logKey, {
            //     targetTag: e.target?.tagName,
            //     relatedTarget: e.relatedTarget,
            //     clientX: e.clientX,
            //     clientY: e.clientY
            // }, 'dragleave event');

            // Check if we're leaving the document entirely
            // relatedTarget is null when leaving the window
            if (e.relatedTarget === null) {
                // dragLogger.always('[DragDrop] *** CURSOR LEFT VIEW - RESTORING TO ORIGINAL POSITION ***');

                // Store references before cleanup
                const droppedTask = dragState.draggedTask;
                const droppedColumn = dragState.draggedColumn;

                // dragLogger.always('Cursor left view - restoration state', {
                //     hasTask: !!droppedTask,
                //     hasColumn: !!droppedColumn,
                //     isDragging: dragState.isDragging
                // });

                // Restore to original position
                if (droppedTask) {
                    // dragLogger.always('Calling restoreTaskToOriginalPosition');
                    restoreTaskToOriginalPosition();
                }
                if (droppedColumn) {
                    // dragLogger.always('Calling restoreColumnToOriginalPosition');
                    restoreColumnToOriginalPosition();

                    // Recalculate affected stack after restoration (no cache invalidation - just position restore)
                    const restoredStack = droppedColumn?.closest('.kanban-column-stack');
                    if (restoredStack && typeof window.updateStackLayoutDebounced === 'function') {
                        window.updateStackLayoutDebounced(restoredStack);
                        // dragLogger.always('Applied stacked column styles after restoration');
                    }

                    // Update drop zones after restoration
                    if (typeof window.updateStackBottomDropZones === 'function') {
                        window.updateStackBottomDropZones();
                    }
                }

                // Clean up visuals and state
                cleanupDragVisuals();
                resetDragState();

                // Scroll to the restored element if it's outside the viewport
                if (droppedTask && typeof scrollToElementIfNeeded === 'function') {
                    setTimeout(() => {
                        scrollToElementIfNeeded(droppedTask, 'task');
                    }, 100);
                }
                if (droppedColumn && typeof scrollToElementIfNeeded === 'function') {
                    // Verify column position after a delay to see if something moved it
                    setTimeout(() => {
                        // const parent = droppedColumn.parentNode;
                        // const currentIdx = parent ? Array.from(parent.children).indexOf(droppedColumn) : -1;
                        // dragLogger.always('Column position check BEFORE highlight', {
                        //     isConnected: droppedColumn.isConnected,
                        //     currentIndex: currentIdx,
                        //     parentClass: parent?.className
                        // });

                        scrollToElementIfNeeded(droppedColumn, 'column');

                        // Check again after highlight
                        // setTimeout(() => {
                        //     const parent2 = droppedColumn.parentNode;
                        //     const idx2 = parent2 ? Array.from(parent2.children).indexOf(droppedColumn) : -1;
                        //     dragLogger.always('Column position check AFTER highlight', {
                        //         isConnected: droppedColumn.isConnected,
                        //         currentIndex: idx2,
                        //         parentClass: parent2?.className
                        //     });
                        // }, 200);
                    }, 100);
                }
            }
        }
    }, false);

    // Handle cursor re-entering the window during drag
    // Resume drag preview when cursor comes back
    document.addEventListener('dragenter', function(e) {
        if (dragState.isDragging) {
            // Use smart logger
            // const logKey = 'dragenter-leftView-' + dragState.leftView;
            // dragLogger.log(logKey, {
            //     targetTag: e.target?.tagName,
            //     leftView: dragState.leftView,
            //     relatedTarget: e.relatedTarget
            // }, 'dragenter event');

            if (dragState.leftView) {
                // dragLogger.always('[DragDrop] *** CURSOR RE-ENTERED VIEW *** resuming drag - clearing leftView');

                // Clear leftView - allow dragging to continue normally
                // Will only restore if user leaves AGAIN or drops outside
                dragState.leftView = false;

                // Re-add dragging classes if they were removed
                if (dragState.draggedTask && !dragState.draggedTask.classList.contains('dragging')) {
                    dragState.draggedTask.classList.add('dragging', 'drag-preview');
                }
                if (dragState.draggedColumn && !dragState.draggedColumn.classList.contains('dragging')) {
                    dragState.draggedColumn.classList.add('dragging', 'drag-preview');
                }
            }
        }
    }, false);

    // Handle mouseup outside the webview
    // This catches cases where the drag ends outside the window
    document.addEventListener('mouseup', function(e) {
        // If we were dragging and mouseup fires, restore to original position and clean up
        if (dragState.isDragging) {
            // Restore elements to original positions
            restoreTaskToOriginalPosition();
            restoreColumnToOriginalPosition();

            // Clean up visuals and state using existing helpers
            cleanupDragVisuals();
            resetDragState();
        }
    }, false);

    // Handle visibility change (when tab loses focus or window is minimized)
    document.addEventListener('visibilitychange', function() {
        if (document.hidden && dragState.isDragging) {
            // Clean up visuals and state using existing helpers
            cleanupDragVisuals();
            resetDragState();
        }
    }, false);

}


function handleClipboardCardDrop(e, clipboardData) {

    try {
        const parsedData = JSON.parse(clipboardData);

        // Extract the task data
        const taskData = parsedData.task || parsedData;

        const title = taskData.title || taskData.content || parsedData.content || 'New Card';

        // Ensure description is always a string, never a blob object
        let description = taskData.description || '';
        if (typeof description !== 'string') {
            description = taskData.content || '';
            if (typeof description !== 'string') {
                description = 'Clipboard content';
            }
        }

        createTasksWithContent([{ title, description }], { x: e.clientX, y: e.clientY });
    } catch (error) {
        // Failed to parse clipboard data - treat as plain text
        createTasksWithContent([{
            title: 'Clipboard Content',
            description: typeof clipboardData === 'string' ? clipboardData : 'Clipboard content'
        }], { x: e.clientX, y: e.clientY });
    }
}

function handleEmptyCardDrop(e, emptyCardData) {
    createTasksWithContent([{ title: '', description: '' }], { x: e.clientX, y: e.clientY });
}

function handleMultipleFilesDrop(e, filesContent) {
    // Split the pre-formatted markdown links by lines
    const links = filesContent.split(/\r\n|\r|\n/).filter(line => line.trim().length > 0);

    // Prepare all tasks data
    const tasksData = links.map(link => {
        // Extract title from the markdown link format
        let title = 'File';

        // Try to extract filename from different link formats
        if (link.startsWith('![](')) {
            // Image: ![](path) - extract filename from path
            const pathMatch = link.match(/!\[\]\(([^)]+)\)/);
            if (pathMatch) {
                const path = decodeURIComponent(pathMatch[1]);
                title = path.split(/[\/\\]/).pop() || 'Image';
            }
        } else if (link.startsWith('[[')) {
            // Wiki link: [[filename]] - extract filename
            const fileMatch = link.match(/\[\[([^\]]+)\]\]/);
            if (fileMatch) {
                title = fileMatch[1];
            }
        } else if (link.startsWith('[') && link.includes('](')) {
            // Standard link: [title](path) - extract title
            const titleMatch = link.match(/\[([^\]]+)\]/);
            if (titleMatch) {
                title = titleMatch[1];
            }
        } else if (link.startsWith('<') && link.endsWith('>')) {
            // URL: <url> - extract domain
            const urlMatch = link.match(/<([^>]+)>/);
            if (urlMatch) {
                try {
                    const url = new URL(urlMatch[1]);
                    title = url.hostname.replace('www.', '');
                } catch {
                    title = 'URL';
                }
            }
        }

        return {
            title: title,
            description: link
        };
    });

    // Batch create all tasks at once (single render)
    createTasksWithContent(tasksData, { x: e.clientX, y: e.clientY });
}

function handleClipboardImageDrop(e, imageData) {
    try {
        // Parse the image data
        const parsedData = JSON.parse(imageData);

        const base64Data = parsedData.data;
        const imageType = parsedData.imageType || 'image/png';

        if (!base64Data) {
            console.error('No image data found in parsed data');
            createTasksWithContent([{ title: 'Clipboard Image', description: 'Failed to save image: No image data found' }], { x: e.clientX, y: e.clientY });
            return;
        }

        // Extract the base64 part (remove data:image/png;base64, prefix if present)
        const base64Only = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

        processImageSave(e, base64Only, imageType, parsedData.md5Hash);

    } catch (error) {
        console.error('Failed to handle clipboard image drop:', error);
        createTasksWithContent([{ title: 'Clipboard Image', description: 'Failed to process clipboard image' }], { x: e.clientX, y: e.clientY });
    }
}

function processImageSave(e, base64Data, imageType, md5Hash) {
    try {

        // Get the current markdown file information
        let currentFilePath = window.currentFileInfo?.filePath;

        // Fallback: Request file path from backend if not available
        if (!currentFilePath) {
            // Send message to backend to get current file path and save image
            vscode.postMessage({
                type: 'saveClipboardImageWithPath',
                imageData: base64Data,
                imageType: imageType,
                dropPosition: { x: e.clientX, y: e.clientY },
                md5Hash: md5Hash // Pass MD5 hash for filename
            });
            return;
        }

        // Extract base filename without extension
        const pathParts = currentFilePath.split(/[\/\\]/);
        const fileName = pathParts.pop() || 'kanban';
        const baseFileName = fileName.replace(/\.[^/.]+$/, '');
        const directory = pathParts.join('/'); // Always use forward slash for consistency

        // Generate unique filename for the image
        const timestamp = window.DateUtils.generateTimestamp();
        const extension = imageType.split('/')[1] || 'png';
        const imageFileName = `clipboard-image-${timestamp}.${extension}`;

        // Create the media folder path
        const mediaFolderName = `${baseFileName}-MEDIA`;
        const mediaFolderPath = `${directory}/${mediaFolderName}`;
        const imagePath = `${mediaFolderPath}/${imageFileName}`;


        // Send message to VS Code to save the image
        // The task card will be created by the 'clipboardImageSaved' message handler
        // after the backend confirms the file was saved successfully
        vscode.postMessage({
            type: 'saveClipboardImage',
            imageData: base64Data,
            imagePath: imagePath,
            mediaFolderPath: mediaFolderPath,
            dropPosition: { x: e.clientX, y: e.clientY },
            imageFileName: imageFileName,
            mediaFolderName: mediaFolderName
        });

    } catch (error) {
        console.error('Failed to process clipboard image save:', error);
        createTasksWithContent([{ title: 'Clipboard Image', description: 'Failed to process clipboard image' }], { x: e.clientX, y: e.clientY });
    }
}

async function handleVSCodeFileDrop(e, files) {
    const file = files[0];
    const fileName = file.name;
    const fileSize = file.size;
    // Treat images, videos, and audio as media files that use ![]() syntax
    const isMedia = file.type.startsWith('image/') ||
                    file.type.startsWith('video/') ||
                    file.type.startsWith('audio/');
    // Keep isImage for backwards compatibility with backend messages
    const isImage = isMedia;

    // Generate unique ID for this drop
    const dropId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store file object for later use if user chooses to copy
    pendingFileDrops.set(dropId, {
        file: file,
        dropPosition: { x: e.clientX, y: e.clientY }
    });

    // Read first 1MB for hash calculation (safe even for large files)
    let partialHashData = null;
    try {
        partialHashData = await readPartialFileForHash(file);
    } catch (error) {
        console.warn('[File-Drop] Could not read partial hash data:', error);
    }

    // Request dialogue from backend (backend will respond with available options)
    vscode.postMessage({
        type: 'requestFileDropDialogue',
        dropId: dropId,
        fileName: fileName,
        fileSize: fileSize,
        isImage: isImage,
        fileType: file.type || 'application/octet-stream',
        hasSourcePath: false, // File objects don't have accessible paths
        partialHashData: partialHashData, // First 1MB for hash matching
        dropPosition: { x: e.clientX, y: e.clientY }
    });
}

/**
 * Execute the file copy after user confirms in dialogue (for File objects)
 */
function executeFileObjectCopy(dropId, isImage) {
    const pending = pendingFileDrops.get(dropId);
    if (!pending) {
        console.error('[File-Drop] No pending file found for dropId:', dropId);
        return;
    }

    const { file, dropPosition } = pending;
    const fileName = file.name;

    // Clean up pending entry
    pendingFileDrops.delete(dropId);

    if (isImage) {
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const base64Data = event.target.result.split(',')[1];
                vscode.postMessage({
                    type: 'saveDroppedImageFromContents',
                    imageData: base64Data,
                    originalFileName: fileName,
                    imageType: file.type,
                    dropPosition: dropPosition
                });
            } catch (error) {
                console.error('[Image-Drop] Failed to process image:', error);
                createTasksWithContent([{ title: fileName, description: `![${fileName}](${fileName}) - Failed to copy image` }], dropPosition);
            }
        };
        reader.onerror = function(error) {
            console.error('[Image-Drop] FileReader error:', error);
            createTasksWithContent([{ title: fileName, description: `![${fileName}](${fileName}) - Failed to read image` }], dropPosition);
        };
        reader.readAsDataURL(file);
    } else {
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const base64Data = btoa(
                    new Uint8Array(event.target.result)
                        .reduce((data, byte) => data + String.fromCharCode(byte), '')
                );
                vscode.postMessage({
                    type: 'saveDroppedFileFromContents',
                    fileData: base64Data,
                    originalFileName: fileName,
                    fileType: file.type || 'application/octet-stream',
                    dropPosition: dropPosition
                });
            } catch (error) {
                console.error('[File-Drop] Failed to process file:', error);
                createTasksWithContent([{ title: fileName, description: `[${fileName}](${fileName}) - Failed to copy file` }], dropPosition);
            }
        };
        reader.onerror = function(error) {
            console.error('[File-Drop] FileReader error:', error);
            createTasksWithContent([{ title: fileName, description: `[${fileName}](${fileName}) - Failed to read file` }], dropPosition);
        };
        reader.readAsArrayBuffer(file);
    }
}

/**
 * Cancel a pending file drop (user cancelled dialogue)
 */
function cancelPendingFileDrop(dropId) {
    pendingFileDrops.delete(dropId);
}

/**
 * Format file size for display (e.g., "2.5 MB")
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

/**
 * Show file drop dialogue with options based on backend response
 * Options: Link existing file (if found), Open media folder, Cancel
 * @param {Object} options - Options from backend
 */
function showFileDropDialogue(options) {
    const {
        dropId,
        fileName,
        fileSize,
        isImage,
        existingFile,
        existingFilePath,
        dropPosition
    } = options;

    const sizeText = fileSize ? ` (${formatFileSize(fileSize)})` : '';
    const buttons = [];

    // Option 1: Link existing file (if found in workspace by hash match - FIRST option)
    if (existingFile) {
        buttons.push({
            text: `Link existing file`,
            primary: true,
            action: () => {
                cancelPendingFileDrop(dropId);
                vscode.postMessage({
                    type: 'linkExistingFile',
                    dropId: dropId,
                    existingFile: existingFile,
                    existingFilePath: existingFilePath,
                    fileName: fileName,
                    isImage: isImage,
                    dropPosition: dropPosition
                });
            }
        });
    }

    // Option 2: Search for file in workspace (always available)
    buttons.push({
        text: 'Search for file',
        primary: !existingFile, // Primary if no existing file found
        action: () => {
            cancelPendingFileDrop(dropId);
            vscode.postMessage({
                type: 'searchForDroppedFile',
                fileName: fileName,
                isImage: isImage,
                dropPosition: dropPosition
            });
        }
    });

    // Option 3: Open media folder (always available)
    buttons.push({
        text: 'Open media folder',
        primary: false,
        action: () => {
            cancelPendingFileDrop(dropId);
            vscode.postMessage({
                type: 'openMediaFolder'
            });
            // Show instructions
            modalUtils.showAlert(
                'Copy file manually',
                `Please copy "${fileName}" to the media folder that just opened, then drag it from the VS Code Explorer into the kanban.`
            );
        }
    });

    // Cancel button
    buttons.push({
        text: 'Cancel',
        action: () => {
            cancelPendingFileDrop(dropId);
        }
    });

    // Show the modal
    const message = existingFile
        ? `File "${existingFile}" already exists in media folder. Link it, search for another, or copy manually.`
        : `File not found in media folder${sizeText}. Search for it in your workspace or copy it manually.`;

    modalUtils.showConfirmModal(
        `Add file: ${fileName}`,
        message,
        buttons,
        { maxWidth: '500px' }
    );
}

// Make functions globally available
if (typeof window !== 'undefined') {
    window.showFileDropDialogue = showFileDropDialogue;
    window.executeFileObjectCopy = executeFileObjectCopy;
    window.cancelPendingFileDrop = cancelPendingFileDrop;
}

function handleVSCodeUriDrop(e, uriData) {
    const uris = uriData.split('\n').filter(uri => uri.trim()).filter(uri => {
        // Use fileTypeUtils for proper path detection (handles Unix and Windows)
        return fileTypeUtils.isFilePath(uri);
    });

    if (uris.length > 0) {
        uris.forEach(uri => {
            // Decode file:// URI but keep original path separators for backend filesystem operations
            const fullPath = uri.startsWith('file://')
                ? decodeURIComponent(uri.replace('file://', ''))
                : uri;
            // Extract filename (handles both / and \ separators)
            const filename = fileTypeUtils.getFileName(fullPath);
            // Check for media files (images, videos, audio) that use ![]() syntax
            const isMedia = /\.(png|jpg|jpeg|gif|svg|webp|bmp|avif|heic|heif|ico|tiff|tif|mp4|webm|mov|avi|mkv|m4v|ogv|wmv|mpg|mpeg|mp3|wav|ogg|m4a|flac|aac)$/i.test(filename);
            const isImage = isMedia;

            // Generate unique ID for this drop
            const dropId = `uri_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Request dialogue from backend (backend checks workspace and returns options)
            vscode.postMessage({
                type: 'requestFileDropDialogue',
                dropId: dropId,
                fileName: filename,
                sourcePath: fullPath,
                isImage: isImage,
                hasSourcePath: true,
                dropPosition: { x: e.clientX, y: e.clientY }
            });
        });
    }
}


function getActiveTextEditor() {

    if (taskEditor.currentEditor) {
        const editor = taskEditor.currentEditor;
        return {
            type: editor.type.replace('task-', '').replace('-', '-'),
            taskId: editor.taskId,
            columnId: editor.columnId,
            cursorPosition: editor.element.selectionStart || 0,
            element: editor.element
        };
    }
    
    return null;
}

/**
 * UNIFIED: Create one or more tasks at a drop position
 * @param {Array} tasksData - Array of {title, description} objects
 * @param {Object} dropPosition - Drop position {x, y}
 * @param {string|null} explicitColumnId - Optional explicit column ID (overrides position-based lookup)
 * @param {number} explicitInsertionIndex - Optional explicit insertion index (overrides position-based calculation)
 */
function createTasksWithContent(tasksData, dropPosition, explicitColumnId = null, explicitInsertionIndex = -1) {
    if (!tasksData || tasksData.length === 0) {
        return;
    }

    // Check board availability
    if (!window.cachedBoard) {
        vscode.postMessage({
            type: 'showMessage',
            text: 'Cannot create tasks: No board loaded'
        });
        return;
    }

    if (!window.cachedBoard.columns || window.cachedBoard.columns.length === 0) {
        vscode.postMessage({
            type: 'showMessage',
            text: 'Cannot create tasks: No columns available'
        });
        return;
    }

    // Use explicit values if provided, otherwise calculate from drop position
    let targetColumnId = explicitColumnId;
    let insertionIndex = explicitInsertionIndex;

    if (!targetColumnId) {
        // Calculate target column and insertion index using hierarchical lookup
        // Row (Y) → Stack (X) → Column (X) → Task (Y midpoint)
        const dropResult = findDropPositionHierarchical(dropPosition.x, dropPosition.y, null);

        if (dropResult) {
            targetColumnId = dropResult.columnId;
            insertionIndex = dropResult.insertionIndex;

            // Unfold the column if it's collapsed
            if (dropResult.columnElement && dropResult.columnElement.classList.contains('collapsed')) {
                if (typeof unfoldColumnIfCollapsed === 'function') {
                    unfoldColumnIfCollapsed(targetColumnId);
                }
            }
        }
    }

    if (targetColumnId) {
        // Find the target column in cached board
        const targetColumn = window.cachedBoard.columns.find(col => col.id === targetColumnId);
        if (!targetColumn) {
            vscode.postMessage({
                type: 'showMessage',
                text: 'Could not find target column'
            });
            return;
        }

        // Capture undo state BEFORE modifying the board
        // This is a cache-first operation, so we need to explicitly save undo state
        vscode.postMessage({
            type: 'saveUndoState',
            operation: 'createTasksFromDrop',
            columnId: targetColumnId,
            currentBoard: window.cachedBoard
        });

        // Create all tasks at once
        const newTasks = tasksData.map((taskData, index) => ({
            id: `temp-drop-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
            title: typeof taskData.title === 'string' ? taskData.title : 'New Task',
            description: typeof taskData.description === 'string' ? taskData.description : ''
        }));

        // Insert all tasks into the column at the correct position
        const actualInsertionIndex = insertionIndex >= 0 && insertionIndex <= targetColumn.tasks.length
            ? insertionIndex
            : targetColumn.tasks.length;

        if (actualInsertionIndex >= 0 && actualInsertionIndex <= targetColumn.tasks.length) {
            targetColumn.tasks.splice(actualInsertionIndex, 0, ...newTasks);
        } else {
            targetColumn.tasks.push(...newTasks);
        }

        // Mark as unsaved changes (syncs modified board to backend)
        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }

        // Update refresh button to show unsaved state
        if (typeof updateRefreshButtonState === 'function') {
            updateRefreshButtonState('unsaved', newTasks.length);
        }

        // PERFORMANCE: Use incremental DOM updates instead of full re-render
        if (typeof window.addSingleTaskToDOM === 'function') {
            // Add each task to DOM incrementally (much faster than full re-render)
            newTasks.forEach((task, index) => {
                const taskInsertIndex = actualInsertionIndex + index;
                window.addSingleTaskToDOM(targetColumnId, task, taskInsertIndex);
            });
        } else {
            // Fallback to full render if incremental function not available
            if (typeof renderBoard === 'function') {
                renderBoard();
            }
        }

        // Recalculate affected stack after adding tasks (cache already invalidated by addSingleTaskToDOM)
        const targetColumnElement = document.querySelector(`[data-column-id="${targetColumnId}"]`);
        const targetStack = targetColumnElement?.closest('.kanban-column-stack');
        if (targetStack && typeof window.updateStackLayoutDebounced === 'function') {
            window.updateStackLayoutDebounced(targetStack);
        }
    } else {
        vscode.postMessage({
            type: 'showMessage',
            text: 'Could not find a suitable column. Please ensure at least one column is not collapsed.'
        });
    }
}

// Helper function to restore original task position (improved with index fallback)
function restoreTaskPosition() {
    if (!dragState.draggedTask || !dragState.originalTaskParent) {
        return;
    }

    // Check if originalTaskNextSibling is still valid
    const nextSiblingStillValid = dragState.originalTaskNextSibling &&
        dragState.originalTaskNextSibling.parentNode === dragState.originalTaskParent;

    // Remove from current position
    if (dragState.draggedTask.parentNode) {
        dragState.draggedTask.parentNode.removeChild(dragState.draggedTask);
    }

    // Restore to original position
    if (nextSiblingStillValid) {
        dragState.originalTaskParent.insertBefore(dragState.draggedTask, dragState.originalTaskNextSibling);
    } else if (dragState.originalTaskIndex >= 0) {
        // Use index as fallback
        const children = Array.from(dragState.originalTaskParent.children);
        const taskItems = children.filter(c => c.classList.contains('task-item'));
        if (dragState.originalTaskIndex < taskItems.length) {
            dragState.originalTaskParent.insertBefore(dragState.draggedTask, taskItems[dragState.originalTaskIndex]);
        } else {
            dragState.originalTaskParent.appendChild(dragState.draggedTask);
        }
    } else {
        dragState.originalTaskParent.appendChild(dragState.draggedTask);
    }

    dragState.draggedTask.classList.remove('drag-source-hidden');
}

function setupRowDragAndDrop() {
    const boardElement = document.getElementById('kanban-board');
    const rows = boardElement.querySelectorAll('.kanban-row');

    rows.forEach(row => {
        // Row dragover is now handled by drop zones only
        // This prevents columns from being inserted directly into rows

        row.addEventListener('dragleave', e => {
            if (!row.contains(e.relatedTarget)) {
                row.classList.remove('drag-over');
            }
        });

        row.addEventListener('drop', e => {
            // Only handle drops for column dragging, let external drops bubble up
            if (dragState.draggedColumn && !dragState.draggedClipboardCard && !dragState.draggedEmptyCard) {
                e.preventDefault();
                e.stopPropagation();
                row.classList.remove('drag-over');

                // Clear the row tracking
                dragState.lastRowDropTarget = null;
                dragState.lastRow = null;
            }
        });
    });
}

/**
 * Sets up task drag and drop for a single column
 * Purpose: Enable task dropping into a specific column
 * @param {HTMLElement} columnElement - The column element to setup
 */
function setupTaskDragAndDropForColumn(columnElement) {
    if (!columnElement) return;

    const columnId = columnElement.dataset.columnId;
    const tasksContainer = columnElement.querySelector('.column-content');

    if (!tasksContainer) {return;}

    // Prevent duplicate event listeners
    if (tasksContainer.dataset.taskDragSetup === 'true') {
        return;
    }
    tasksContainer.dataset.taskDragSetup = 'true';

    // NOTE: Task dragover handlers removed - now handled by unified hierarchical document handler
    // Drop handler kept for cleanup
    tasksContainer.addEventListener('drop', e => {
        e.preventDefault();

        // Only stop propagation for internal task drags, let external drops bubble up
        if (dragState.draggedTask && !dragState.draggedClipboardCard && !dragState.draggedEmptyCard) {
            e.stopPropagation();
        }

        columnElement.classList.remove('drag-over');
        columnElement.classList.remove('drag-over-append');

        // The actual position change is handled in dragend
    });

    // Setup drag handles for all tasks in this column
    columnElement.querySelectorAll('.task-drag-handle').forEach(handle => {
        setupTaskDragHandle(handle);
    });
}

/**
 * Sets up task drag and drop for all columns on the board
 * Purpose: Initialize task dropping for entire board
 */
function setupTaskDragAndDrop() {
    // Get all columns across all rows
    const boardElement = document.getElementById('kanban-board');
    const allColumns = boardElement.querySelectorAll('.kanban-full-height-column');

    // Setup drag & drop for each column using the per-column function
    allColumns.forEach(columnElement => {
        setupTaskDragAndDropForColumn(columnElement);
    });
}

function setupTaskDragHandle(handle) {
    // Prevent duplicate event listeners
    if (handle.dataset.dragSetup === 'true') {
        return;
    }
    handle.dataset.dragSetup = 'true';

    handle.draggable = true;

    handle.addEventListener('dragstart', e => {
        const taskItem = e.target && e.target.closest ? e.target.closest('.task-item') : null;

        if (taskItem) {
            e.stopPropagation();

            // CRITICAL FIX: Clear any text selection to prevent it from being dragged instead of the task
            // This prevents the bug where selecting text and then dragging creates unintended tasks
            if (window.getSelection) {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    selection.removeAllRanges();
                }
            }

            const taskId = taskItem.dataset.taskId;
            const columnId = window.getColumnIdFromElement(taskItem);

            // Store original position
            dragState.draggedTask = taskItem;
            dragState.originalTaskParent = taskItem.parentNode;
            dragState.originalTaskNextSibling = taskItem.nextSibling;
            const originalTaskItems = Array.from(dragState.originalTaskParent.querySelectorAll(':scope > .task-item'));
            dragState.originalTaskIndex = originalTaskItems.indexOf(taskItem);
            dragState.originalTaskColumnId = columnId || null;
            dragState.isDragging = true; // IMPORTANT: Set this BEFORE setting data
            dragState.altKeyPressed = e.altKey; // Track Alt key state from the start
            dragState.affectedColumns = new Set(); // PERFORMANCE: Track affected columns for targeted cleanup
            dragState.affectedColumns.add(dragState.originalTaskParent); // Add origin column

            // Set multiple data formats
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', `kanban-task:${taskId}`); // Add prefix
            e.dataTransfer.setData('application/kanban-task', taskId);
            e.dataTransfer.setData('application/x-kanban-task', taskId); // Fallback

            // DON'T add dragging class here - causes layout shift that cancels drag
            // Will be added on first dragover event instead
        }
    });

    // NOTE: Task dragend handler removed - now handled by unified global dragend handler
    // NOTE: ESC key handler moved to setupGlobalDragAndDrop() to prevent duplicate listeners
}

/**
 * HIERARCHICAL POSITION FINDER
 * Finds drop position using strict hierarchy: Row (Y) → Stack (X) → Column (X) → Task (Y midpoint)
 * Used by ALL drop operations (internal drags and external drops)
 * @param {number} mouseX - X coordinate
 * @param {number} mouseY - Y coordinate
 * @param {HTMLElement|null} draggedTask - Task being dragged (to skip in position calculation), or null for external drops
 * @returns {Object} { columnElement, columnId, insertionIndex, tasksContainer }
 */
function findDropPositionHierarchical(mouseX, mouseY, draggedTask = null) {
    const board = document.getElementById('kanban-board');
    if (!board) {return null;}

    // STEP 1: Find ROW by Y coordinate
    let foundRow = null;
    const rows = board.querySelectorAll('.kanban-row');
    if (rows.length > 0) {
        for (const row of rows) {
            const rect = row.getBoundingClientRect();
            if (mouseY >= rect.top && mouseY <= rect.bottom) {
                foundRow = row;
                break;
            }
        }
    } else {
        // Single row layout - use board as the row
        const boardRect = board.getBoundingClientRect();
        if (mouseY >= boardRect.top && mouseY <= boardRect.bottom) {
            foundRow = board;
        }
    }
    if (!foundRow) {return null;}

    // STEP 2: Within ROW, find STACK by X coordinate
    let foundStack = null;
    const stacks = foundRow.querySelectorAll(':scope > .kanban-column-stack');
    for (const stack of stacks) {
        // Skip drop zone stacks
        if (stack.classList.contains('column-drop-zone-stack')) {continue;}
        const stackRect = stack.getBoundingClientRect();
        if (mouseX >= stackRect.left && mouseX <= stackRect.right) {
            foundStack = stack;
            break;
        }
    }
    if (!foundStack) {return null;}

    // STEP 3: Within STACK, find COLUMN
    // In stacked mode, columns overlap in X (same grid cell) - use Y to find target
    // In side-by-side mode (multiple columns horizontally), use X to find target
    let targetColumn = null;
    const columns = Array.from(foundStack.querySelectorAll(':scope > .kanban-full-height-column'));

    if (columns.length === 0) {return null;}

    // Check if columns are stacked (overlapping in X) by comparing first two columns
    const isStackedLayout = columns.length > 1 && (() => {
        const rect1 = columns[0].getBoundingClientRect();
        const rect2 = columns[1].getBoundingClientRect();
        // If X ranges overlap significantly, it's stacked mode
        const overlap = Math.min(rect1.right, rect2.right) - Math.max(rect1.left, rect2.left);
        return overlap > 50; // More than 50px overlap means stacked
    })();

    if (isStackedLayout) {
        // STACKED MODE: Find column by Y coordinate using header positions
        // Columns are stacked vertically, each header is at a cumulative Y offset
        // Iterate from last (bottom) to first (top) to find the column whose header area contains mouseY
        for (let i = columns.length - 1; i >= 0; i--) {
            const col = columns[i];
            const header = col.querySelector('.column-title') || col.querySelector('.column-header');
            if (header) {
                const headerRect = header.getBoundingClientRect();
                // Check if mouseY is at or below this header's top
                // The column "owns" the space from its header top to the next column's header top (or bottom of stack)
                if (mouseY >= headerRect.top) {
                    targetColumn = col;
                    break;
                }
            }
        }
        // If no match found (mouseY above all headers), use first column
        if (!targetColumn && columns.length > 0) {
            targetColumn = columns[0];
        }
    } else {
        // SIDE-BY-SIDE MODE: Find column by X coordinate
        for (const col of columns) {
            const colRect = col.getBoundingClientRect();
            if (mouseX >= colRect.left && mouseX <= colRect.right) {
                targetColumn = col;
                break;
            }
        }
    }
    if (!targetColumn) {return null;}

    // STEP 4: Within COLUMN, find TASK position by Y midpoint
    const tasksContainer = targetColumn.querySelector('.column-content');
    if (!tasksContainer) {
        return {
            columnElement: targetColumn,
            columnId: targetColumn.dataset.columnId,
            insertionIndex: -1,
            tasksContainer: null
        };
    }

    const tasks = tasksContainer.querySelectorAll(':scope > .task-item');
    let insertionIndex = -1; // -1 means append at end

    let taskIndex = 0;
    for (const task of tasks) {
        // Skip the dragged task if provided
        if (draggedTask && task === draggedTask) {
            continue;
        }

        const taskRect = task.getBoundingClientRect();
        // Task midpoint: (task.top + task.bottom) / 2
        const taskMidpoint = (taskRect.top + taskRect.bottom) / 2;

        if (mouseY < taskMidpoint) {
            // Insert BEFORE this task
            insertionIndex = taskIndex;
            break;
        }
        taskIndex++;
    }

    return {
        columnElement: targetColumn,
        columnId: targetColumn.dataset.columnId,
        insertionIndex: insertionIndex,
        tasksContainer: tasksContainer
    };
}

// Drag and drop setup
function setupDragAndDrop() {

    // Clear any existing drag state when setting up
    dragState = {
        draggedColumn: null,
        draggedColumnId: null,
        originalColumnIndex: -1,
        originalColumnNextSibling: null,
        originalColumnParent: null,
        originalDataIndex: -1,
        draggedTask: null,
        originalTaskIndex: -1,
        originalTaskColumnId: null,
        originalTaskParent: null,
        originalTaskNextSibling: null,
        isDragging: false,  // This is the key flag
        lastValidDropTarget: null,
        lastDropTarget: null,
        lastRowDropTarget: null,
        lastRow: null,
        targetRowNumber: null,
        targetPosition: null,
        finalRowNumber: null,
        draggedClipboardCard: null,
        draggedEmptyCard: null
    };

    // CRITICAL: Update window.dragState to match local dragState
    // Clipboard/empty card handlers use window.dragState, so they must reference the same object
    window.dragState = dragState;
    
    // Only set up global drag/drop once to prevent multiple listeners
    if (!dragDropInitialized) {
        setupGlobalDragAndDrop();
        dragDropInitialized = true;
    }
    
    // Always refresh column, task, and row drag/drop since DOM changes
    setupRowDragAndDrop(); // Setup rows first
    setupColumnDragAndDrop(); // Then columns
    setupTaskDragAndDrop(); // Then tasks
    
    // Initialize drop zones for the entire board and all rows
    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        const rows = boardElement.querySelectorAll('.kanban-row');

        if (rows.length > 0) {
            // Multi-row mode: setup drop zones for each row individually
            rows.forEach(row => {
                cleanupAndRecreateDropZones(row);
            });
        } else {
            // Single row mode: setup drop zones for the entire board
            cleanupAndRecreateDropZones(boardElement);
        }
    }
}

/**
 * Cleans up an empty stack and its adjacent drop zone during drag
 * @param {HTMLElement} stack - The stack that might be empty
 */
function cleanupEmptyStack(stack) {
    if (!stack || !stack.classList.contains('kanban-column-stack')) {
        return;
    }

    // Check if stack is empty (no columns)
    const hasColumns = stack.querySelectorAll('.kanban-full-height-column').length > 0;
    if (hasColumns || stack.classList.contains('column-drop-zone-stack')) {
        return; // Stack still has columns or is a drop zone, don't remove
    }

    // Find the drop zone to the right of this stack
    const nextSibling = stack.nextSibling;

    // Remove the empty stack
    stack.remove();

    // Remove the adjacent drop zone if it exists
    if (nextSibling && nextSibling.classList &&
        nextSibling.classList.contains('column-drop-zone-stack')) {
        nextSibling.remove();
    }
}

/**
 * Cleans up and recreates drop zones in a row or board
 * Removes consecutive empty stacks and ensures drop zones before/between/after content stacks
 */
function cleanupAndRecreateDropZones(container) {
    // Get all stacks
    const allStacks = Array.from(container.children).filter(child =>
        child.classList.contains('kanban-column-stack')
    );

    // Separate content stacks from drop-zone stacks
    const contentStacks = [];
    const dropZoneStacks = [];

    allStacks.forEach(stack => {
        const hasColumns = stack.querySelectorAll('.kanban-full-height-column').length > 0;
        if (hasColumns) {
            contentStacks.push(stack);
        } else {
            dropZoneStacks.push(stack);
        }
    });

    // Remove all existing drop-zone stacks
    dropZoneStacks.forEach(stack => {
        stack.remove();
    });

    // Insert new drop zones: before first, between each, and after last
    if (contentStacks.length > 0) {
        // Before first
        const dropZoneBefore = createDropZoneStack('column-drop-zone-before');
        container.insertBefore(dropZoneBefore, contentStacks[0]);

        // Between each
        for (let i = 0; i < contentStacks.length - 1; i++) {
            const dropZoneBetween = createDropZoneStack('column-drop-zone-between');
            container.insertBefore(dropZoneBetween, contentStacks[i].nextSibling);
        }

        // After last
        const dropZoneAfter = createDropZoneStack('column-drop-zone-after');
        const addBtn = container.querySelector('.add-column-btn');
        if (addBtn) {
            container.insertBefore(dropZoneAfter, addBtn);
        } else {
            container.appendChild(dropZoneAfter);
        }
    }
}

/**
 * Creates a drop zone stack with the specified class
 */
function createDropZoneStack(dropZoneClass) {
    const dropZoneStack = document.createElement('div');
    dropZoneStack.className = 'kanban-column-stack column-drop-zone-stack';

    const dropZone = document.createElement('div');
    dropZone.className = `column-drop-zone ${dropZoneClass}`;

    dropZoneStack.appendChild(dropZone);
    return dropZoneStack;
}

/**
 * Creates or updates transparent drop zones below the last column in each stack
 * These zones allow dropping columns to stack them vertically
 */
function updateStackBottomDropZones() {
    const stacks = document.querySelectorAll('.kanban-column-stack:not(.column-drop-zone-stack)');

    stacks.forEach(stack => {
        // Remove existing bottom drop zone if any
        const existingZone = stack.querySelector('.stack-bottom-drop-zone');
        if (existingZone) {
            existingZone.remove();
        }

        // Check if stack has columns
        const columns = stack.querySelectorAll('.kanban-full-height-column');
        if (columns.length === 0) {return;}

        // Create transparent drop zone element that fills remaining stack height
        // Position it absolutely using same calculation as column sticky positioning
        const dropZone = document.createElement('div');
        dropZone.className = 'stack-bottom-drop-zone';

        // Calculate top position by summing up heights of all columns' elements
        // This matches the calculation in updateStackLayout()
        let cumulativeTop = 0;
        columns.forEach(col => {
            const isVerticallyFolded = col.classList.contains('collapsed-vertical');
            const isHorizontallyFolded = col.classList.contains('collapsed-horizontal');

            const columnMargin = col.querySelector('.column-margin');
            const columnHeader = col.querySelector('.column-header');
            const columnTitle = col.querySelector('.column-title');
            const columnContent = col.querySelector('.column-content');
            const columnFooter = col.querySelector('.column-footer');

            if (columnMargin) {cumulativeTop += columnMargin.offsetHeight;}
            if (columnHeader) {cumulativeTop += columnHeader.offsetHeight;}
            if (columnTitle) {cumulativeTop += columnTitle.offsetHeight;}

            // Include column-content height (skip if column is folded)
            if (columnContent && !isVerticallyFolded && !isHorizontallyFolded) {
                cumulativeTop += columnContent.scrollHeight;
            }

            if (columnFooter) {
                cumulativeTop += columnFooter.offsetHeight;
                // Account for footer borders and margins using computed style
                const footerStyle = window.getComputedStyle(columnFooter);
                const marginBottom = parseFloat(footerStyle.marginBottom) || 0;
                cumulativeTop += marginBottom;
            }
        });

        dropZone.style.cssText = `
            position: absolute;
            top: ${cumulativeTop}px;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: auto;
            z-index: 1;
            transform: translateZ(-1px);
        `;

        // NOTE: dragover handler removed - now handled by unified hierarchical document handler
        // dragleave handler kept for cleanup
        dropZone.addEventListener('dragleave', e => {
            dropZone.classList.remove('drag-over');
        });

        // Append to stack
        stack.appendChild(dropZone);
    });
}

// Make it globally accessible for layout updates
window.updateStackBottomDropZones = updateStackBottomDropZones;
window.cleanupAndRecreateDropZones = cleanupAndRecreateDropZones;
window.setupTaskDragAndDropForColumn = setupTaskDragAndDropForColumn;

/**
 * Updates the visual column title display in the DOM after modifying the data model
 * @param {string} columnId - The ID of the column to update
 */
function updateColumnTitleDisplay(columnId) {
    const columnElement = document.querySelector(`[data-column-id="${columnId}"]`);
    if (!columnElement) {
        console.warn('[dragDrop-updateTitle] Column element not found:', columnId);
        return;
    }

    // Get updated title from data model
    const column = window.cachedBoard?.columns.find(c => c.id === columnId);
    if (!column) {
        console.warn('[dragDrop-updateTitle] Column not found in data model:', columnId);
        return;
    }

    // Get display title using shared utility function
    const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(column, window.removeTagsForDisplay) : (column.title || '');

    // Update the column title DOM element
    const titleElement = columnElement.querySelector('.column-title-text.markdown-content');
    if (titleElement) {
        titleElement.innerHTML = renderedTitle;
    } else {
        console.warn('[dragDrop-updateTitle] Title element not found for:', columnId);
    }

    // Update stack toggle button state
    const stackToggleBtn = columnElement.querySelector('.stack-toggle-btn');
    if (stackToggleBtn) {
        const hasStack = /#stack\b/i.test(column.title);
        if (hasStack) {
            stackToggleBtn.classList.add('active');
            stackToggleBtn.textContent = 'On';
        } else {
            stackToggleBtn.classList.remove('active');
            stackToggleBtn.textContent = 'Off';
        }
    }
}

/**
 * Sets up drag and drop for column reordering
 * Purpose: Enable column rearrangement
 * Used by: setupDragAndDrop() after board render
 * Side effects: Makes column headers draggable
 */
function setupColumnDragAndDrop() {

    const boardElement = document.getElementById('kanban-board');
    const columns = boardElement.querySelectorAll('.kanban-full-height-column');

    columns.forEach(column => {
        const dragHandle = column.querySelector('.column-drag-handle');
        if (!dragHandle) {return;}

        // Prevent duplicate event listeners
        if (dragHandle.dataset.dragSetup === 'true') {
            return;
        }
        dragHandle.dataset.dragSetup = 'true';

        dragHandle.addEventListener('dragstart', e => {
            const columnElement = column;
            const columnId = columnElement.getAttribute('data-column-id');

            // CRITICAL FIX: Clear any text selection to prevent interference with drag operation
            if (window.getSelection) {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    selection.removeAllRanges();
                }
            }

            // Find the original position in the data model
            const originalIndex = window.cachedBoard?.columns?.findIndex(c => c.id === columnId) ?? -1;

            // Store drag state including original parent stack
            dragState.draggedColumn = columnElement;
            dragState.draggedColumnId = columnId;
            dragState.originalDataIndex = originalIndex;
            dragState.originalColumnParent = columnElement.parentNode; // Store original stack
            dragState.originalColumnNextSibling = columnElement.nextSibling; // Store position in stack
            dragState.originalColumnIndex = Array.from(columnElement.parentNode.children).indexOf(columnElement); // Store DOM index
            dragState.isDragging = true;
            dragState.lastDropTarget = null;  // Track last drop position
            dragState.styleUpdatePending = false;  // Track if style update is needed

            // Track throttling for column dragover
            dragState.columnDragoverThrottleId = null;

            // Set drag data
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', `kanban-full-height-column:${columnId}`);

            // PERFORMANCE: Visual feedback - dim the source column (no DOM movement)
            columnElement.classList.add('drag-source');

            // DON'T add column-drag-active here - it causes layout shift that cancels drag
            // It will be added on first dragover event instead

            // FIX SOURCE STACK TAGS: Update tags for remaining columns in source stack
            const sourceStack = columnElement.closest('.kanban-column-stack');
            if (sourceStack) {
                // Get ALL columns in this stack, but EXCLUDE columns from nested stacks
                const allColumnsInStack = Array.from(sourceStack.querySelectorAll('.kanban-full-height-column'));
                const columnsInSourceStack = allColumnsInStack.filter(col => {
                    // Keep this column only if its CLOSEST parent stack is THIS stack (not a nested one)
                    return col !== columnElement && col.closest('.kanban-column-stack') === sourceStack;
                });

                columnsInSourceStack.forEach((col, idx) => {
                    const colId = col.getAttribute('data-column-id');

                    if (idx === 0) {
                        // First remaining column - remove #stack tag
                        if (window.cachedBoard) {
                            const cachedCol = window.cachedBoard.columns.find(c => c.id === colId);
                            if (cachedCol) {
                                cachedCol.title = cachedCol.title.replace(/#stack\b/gi, '').replace(/\s+/g, ' ').trim();
                            }
                        }
                        if (window.cachedBoard) {
                            const currentCol = window.cachedBoard.columns.find(c => c.id === colId);
                            if (currentCol) {
                                currentCol.title = currentCol.title.replace(/#stack\b/gi, '').replace(/\s+/g, ' ').trim();
                            }
                        }
                        // DELAY: Update visual display after dragstart to avoid canceling drag
                        setTimeout(() => updateColumnTitleDisplay(colId), 50);
                    } else {
                        // Other columns - ensure they have #stack tag
                        if (window.cachedBoard) {
                            const cachedCol = window.cachedBoard.columns.find(c => c.id === colId);
                            if (cachedCol && !/#stack\b/i.test(cachedCol.title)) {
                                const trimmedTitle = cachedCol.title.trim();
                                // Ensure space before #stack if title is not empty
                                cachedCol.title = trimmedTitle ? trimmedTitle + ' #stack' : ' #stack';
                            }
                        }
                        if (window.cachedBoard) {
                            const currentCol = window.cachedBoard.columns.find(c => c.id === colId);
                            if (currentCol && !/#stack\b/i.test(currentCol.title)) {
                                const trimmedTitle = currentCol.title.trim();
                                // Ensure space before #stack if title is not empty
                                currentCol.title = trimmedTitle ? trimmedTitle + ' #stack' : ' #stack';
                            }
                        }
                        // DELAY: Update visual display after dragstart to avoid canceling drag
                        setTimeout(() => updateColumnTitleDisplay(colId), 50);
                    }
                });
            }


        });

        // NOTE: Column dragend handler removed - now handled by unified global dragend handler
        // NOTE: Column dragover handler removed - now handled by unified hierarchical document handler
    });

    // HIERARCHICAL DRAGOVER HANDLER for column drags
    // Follows strict hierarchy: Row (by Y) → Stack (by X) → Column (by midpoint)
    // NO CACHE - Direct DOM queries according to rules
    // Highlights .column-margin elements for drop position
    document.addEventListener('dragover', e => {
        const isTemplateDrag = typeof templateDragState !== 'undefined' && templateDragState.isDragging;
        const isColumnDrag = !!dragState.draggedColumn;
        const isTaskDrag = !!dragState.draggedTask;
        const isClipboardDrag = !!dragState.draggedClipboardCard;
        const isEmptyCardDrag = !!dragState.draggedEmptyCard;

        // Handle column drags, template drags, task drags, clipboard drags, empty card drags
        if (!isColumnDrag && !isTemplateDrag && !isTaskDrag && !isClipboardDrag && !isEmptyCardDrag) {return;}

        // DIAGNOSTIC: Check if this handler is processing something it shouldn't
        const hasFiles = e.dataTransfer?.types?.includes('Files');
        if (hasFiles && !window._externalInWrongHandlerLogged) {
            window._externalInWrongHandlerLogged = true;
            console.warn('[DragDrop] WARNING: External file drag in INTERNAL handler!', {
                isTemplateDrag, isColumnDrag, isTaskDrag, isClipboardDrag, isEmptyCardDrag,
                types: Array.from(e.dataTransfer?.types || [])
            });
        }

        e.preventDefault();

        // Update Alt key state during drag (for task-like drags)
        if ((isTaskDrag || isClipboardDrag || isEmptyCardDrag) && dragState.isDragging) {
            dragState.altKeyPressed = e.altKey;
        }

        // CRITICAL: Capture mouse coordinates BEFORE RAF
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // RAF throttle
        if (dragState.columnDragoverPending) {return;}

        dragState.columnDragoverPending = true;
        requestAnimationFrame(() => {
            dragState.columnDragoverPending = false;

            // Re-check state in case drag ended
            const stillTemplateDrag = typeof templateDragState !== 'undefined' && templateDragState.isDragging;
            const stillColumnDrag = !!dragState.draggedColumn;
            const stillTaskDrag = !!dragState.draggedTask;
            const stillClipboardDrag = !!dragState.draggedClipboardCard;
            const stillEmptyCardDrag = !!dragState.draggedEmptyCard;
            if (!stillColumnDrag && !stillTemplateDrag && !stillTaskDrag && !stillClipboardDrag && !stillEmptyCardDrag) {return;}

            const board = document.getElementById('kanban-board');
            if (!board) {return;}

            // Clear previous highlights
            cleanupDropZoneHighlightsLocal();

            // For task/clipboard/emptycard drags, reset drop state at start of each dragover
            // If no valid target is found, task returns to original position with no highlight
            if (stillTaskDrag || stillClipboardDrag || stillEmptyCardDrag) {
                hideDropIndicatorWithState();
            }

            // STEP 1: Find ROW by Y coordinate (direct DOM query)
            let foundRow = null;
            let foundRowNumber = 1;
            const rows = board.querySelectorAll('.kanban-row');
            if (rows.length > 0) {
                for (const row of rows) {
                    const rect = row.getBoundingClientRect();
                    if (mouseY >= rect.top && mouseY <= rect.bottom) {
                        foundRow = row;
                        foundRowNumber = parseInt(row.dataset.rowNumber, 10) || 1;
                        break;
                    }
                }
            } else {
                // Single row layout - use board as the row
                const boardRect = board.getBoundingClientRect();
                if (mouseY >= boardRect.top && mouseY <= boardRect.bottom) {
                    foundRow = board;
                }
            }
            if (!foundRow) {return;}

            // STEP 2: Within that ROW, find STACK by X coordinate (direct DOM query)
            let foundStack = null;
            let isDropZoneStack = false;
            const stacks = foundRow.querySelectorAll(':scope > .kanban-column-stack');
            for (const stack of stacks) {
                const stackRect = stack.getBoundingClientRect();
                if (mouseX >= stackRect.left && mouseX <= stackRect.right) {
                    foundStack = stack;
                    isDropZoneStack = stack.classList.contains('column-drop-zone-stack');
                    break;
                }
            }

            // Handle drop zone stacks (vertical dividers between stacks) - only for column/template drags
            // Task/clipboard/emptycard drags skip drop zones - they go INTO columns
            if (foundStack && isDropZoneStack && !stillTaskDrag && !stillClipboardDrag && !stillEmptyCardDrag) {
                const dropZone = foundStack.querySelector('.column-drop-zone');
                if (dropZone) {
                    addHighlight(dropZone, 'drag-over');
                    dragState.pendingDropZone = dropZone;

                    // CRITICAL: Set dropTargetStack for insertColumnAtPosition() to work correctly
                    // Empty column and clipboard column drops use this to position the new column
                    dragState.dropTargetStack = foundStack;
                    dragState.dropTargetBeforeColumn = null;  // No specific before column in drop zone

                    // For template drags, set target position
                    if (stillTemplateDrag) {
                        templateDragState.targetRow = foundRowNumber;
                        const prevStack = foundStack.previousElementSibling;
                        const nextStack = foundStack.nextElementSibling;
                        if (prevStack && prevStack.classList.contains('kanban-column-stack') && !prevStack.classList.contains('column-drop-zone-stack')) {
                            const prevColumn = prevStack.querySelector('.kanban-full-height-column');
                            if (prevColumn) {
                                templateDragState.targetColumnId = prevColumn.dataset.columnId;
                                templateDragState.targetPosition = 'after';
                            }
                        } else if (nextStack && nextStack.classList.contains('kanban-column-stack') && !nextStack.classList.contains('column-drop-zone-stack')) {
                            const nextColumn = nextStack.querySelector('.kanban-full-height-column');
                            if (nextColumn) {
                                templateDragState.targetColumnId = nextColumn.dataset.columnId;
                                templateDragState.targetPosition = 'before';
                            }
                        } else {
                            templateDragState.targetColumnId = null;
                            templateDragState.targetPosition = 'first';
                        }
                    }
                }
                showColumnDropIndicatorWithState(foundStack, null);
                return;
            }

            if (!foundStack) {return;}
            dragState.pendingDropZone = null;

            // STEP 3: Within that STACK, find COLUMN by midpoint (header.top + footer.bottom) / 2
            const columns = foundStack.querySelectorAll(':scope > .kanban-full-height-column');
            if (columns.length === 0) {return;}

            // For TASK/CLIPBOARD/EMPTYCARD drags: find which column we're over, then find task position within it
            if (stillTaskDrag || stillClipboardDrag || stillEmptyCardDrag) {
                const columnsArray = Array.from(columns);

                // DIAGNOSTIC: Log once per drag session (not every frame)
                if (!window._currentDragSessionLogged) {
                    window._currentDragSessionLogged = true;
                }

                let targetColumn = null;
                let dropAtEnd = false;

                // RULE 1: Check if hovering over column-title → drop at end of that column
                for (const col of columnsArray) {
                    const title = col.querySelector('.column-title');
                    if (title) {
                        const titleRect = title.getBoundingClientRect();
                        if (mouseY >= titleRect.top && mouseY <= titleRect.bottom) {
                            targetColumn = col;
                            dropAtEnd = true;
                            break;
                        }
                    }
                }

                // RULE 2: Check if between column-header.top and column-footer.bottom
                if (!targetColumn) {
                    for (const col of columnsArray) {
                        const header = col.querySelector('.column-header');
                        const footer = col.querySelector('.column-footer');
                        const headerTop = header ? header.getBoundingClientRect().top : col.getBoundingClientRect().top;
                        const footerBottom = footer ? footer.getBoundingClientRect().bottom : col.getBoundingClientRect().bottom;

                        if (mouseY >= headerTop && mouseY <= footerBottom) {
                            targetColumn = col;
                            break;
                        }
                    }
                }

                // If no valid column found (e.g., hovering over margin), return - task stays at original position
                if (!targetColumn) {return;}

                // Get tasks container
                const tasksContainer = targetColumn.querySelector('.column-content');

                // For folded columns, always drop at end (highlight the title)
                const isFolded = targetColumn.classList.contains('collapsed-vertical') ||
                                 targetColumn.classList.contains('collapsed-horizontal');
                if (isFolded) {
                    dropAtEnd = true;
                }

                // Add drag-source class to dim the task (only for actual task drags)
                if (stillTaskDrag && dragState.draggedTask && !dragState.draggedTask.classList.contains('drag-source')) {
                    dragState.draggedTask.classList.add('drag-source');
                }

                // If over column-title or folded column, highlight title and drop at end
                if (dropAtEnd) {
                    const columnTitle = targetColumn.querySelector('.column-title');
                    if (columnTitle) {
                        addHighlight(columnTitle, 'task-drop-target');
                    }
                    if (tasksContainer) {
                        dragState.dropTargetContainer = tasksContainer;
                        dragState.dropTargetAfterElement = null;
                    }
                    return;
                }

                // For task position finding, we need tasks container
                if (!tasksContainer) {return;}

                // Find TASK position by iterating and checking task midpoint
                const tasks = tasksContainer.querySelectorAll(':scope > .task-item');
                let afterElement = null;

                for (const task of tasks) {
                    // Skip the dragged task (only for actual task drags)
                    if (stillTaskDrag && task === dragState.draggedTask) {continue;}

                    const taskRect = task.getBoundingClientRect();
                    const taskMidpoint = (taskRect.top + taskRect.bottom) / 2;

                    if (mouseY < taskMidpoint) {
                        // Place ABOVE this task (before it)
                        afterElement = task;
                        break;
                    }
                }

                // If no task found, afterElement stays null (drop at end)
                showTaskDropIndicatorWithState(tasksContainer, { afterElement });
                return;
            }

            // For COLUMN/TEMPLATE drags: find position between columns
            let beforeColumn = null;
            let highlightMargin = null;

            for (const col of columns) {
                // Skip the dragged column
                if (col === dragState.draggedColumn) {continue;}

                // Get header (column-header) top
                const columnHeader = col.querySelector('.column-header');
                const headerTop = columnHeader ? columnHeader.getBoundingClientRect().top : col.getBoundingClientRect().top;

                // Get footer bottom (column-footer bottom, or column bottom if no footer)
                const columnFooter = col.querySelector('.column-footer');
                const footerBottom = columnFooter ? columnFooter.getBoundingClientRect().bottom : col.getBoundingClientRect().bottom;

                // Calculate midpoint: (header.top + footer.bottom) / 2
                const midpoint = (headerTop + footerBottom) / 2;

                if (mouseY < midpoint) {
                    // Drop BEFORE this column
                    beforeColumn = col;
                    // Highlight top margin of this column
                    highlightMargin = col.querySelector('.column-margin:not(.column-margin-bottom)');
                    break;
                }
            }

            // If no column found (mouse is below all columns), drop at end of stack
            if (!beforeColumn) {
                // Highlight stack-bottom-drop-zone for last position
                highlightMargin = foundStack.querySelector('.stack-bottom-drop-zone');
            }

            // Highlight the appropriate margin element
            if (highlightMargin) {
                addHighlight(highlightMargin, 'drag-over');
            }

            // Update drop target state
            dragState.dropTargetStack = foundStack;
            dragState.dropTargetBeforeColumn = beforeColumn;

            // Only show line indicator for template drags, not column drags
            if (!stillColumnDrag) {
                showColumnDropIndicatorWithState(foundStack, beforeColumn);
            }

            // For template drags, update target info
            if (stillTemplateDrag) {
                templateDragState.targetRow = foundRowNumber;
                if (beforeColumn) {
                    templateDragState.targetColumnId = beforeColumn.dataset?.columnId || null;
                    templateDragState.targetPosition = 'before';
                } else {
                    // Find last column for "after" position
                    let lastCol = null;
                    for (const col of columns) {
                        if (col !== dragState.draggedColumn) {
                            lastCol = col;
                        }
                    }
                    if (lastCol) {
                        templateDragState.targetColumnId = lastCol.dataset?.columnId || null;
                        templateDragState.targetPosition = 'after';
                    }
                }
            }
        }); // End RAF callback
    });

    // NOTE: Drop zone cleanup dragend handler removed - now handled by unified global dragend handler (cleanupDragVisuals)
}

// ============================================================================
// TEMPLATE DRAG AND DROP
// ============================================================================

/**
 * Setup drag handlers for template items in the template bar
 * Called after template bar is rendered
 */
function setupTemplateDragHandlers() {
    const templateItems = document.querySelectorAll('.template-item');

    templateItems.forEach(item => {
        // Skip if already setup
        if (item.dataset.dragSetup === 'true') {
            return;
        }

        item.addEventListener('dragstart', handleTemplateDragStart);
        item.addEventListener('dragend', handleTemplateDragEnd);
        item.dataset.dragSetup = 'true';
    });
}

/**
 * Handle template drag start
 */
function handleTemplateDragStart(e) {
    const templateItem = e.target.closest('.template-item');
    if (!templateItem) {
        return;
    }

    // Store template info
    templateDragState.isDragging = true;
    templateDragState.templatePath = templateItem.dataset.templatePath;
    templateDragState.templateName = templateItem.dataset.templateName;

    // Set drag data
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', `template:${templateDragState.templatePath}`);
    e.dataTransfer.setData('application/x-kanban-template', JSON.stringify({
        path: templateDragState.templatePath,
        name: templateDragState.templateName
    }));

    // Visual feedback
    templateItem.classList.add('dragging');

    // Add class to board for drop zone highlighting
    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardElement.classList.add('template-dragging');
    }
}

/**
 * Handle template drag end
 */
function handleTemplateDragEnd(e) {
    const templateItem = e.target.closest('.template-item');
    if (templateItem) {
        templateItem.classList.remove('dragging');
    }

    // Remove drop zone highlighting
    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardElement.classList.remove('template-dragging');
    }

    // Clear all tracked highlights (including template-drag-over)
    clearHighlights();

    // If we have a valid drop target, apply the template
    if (templateDragState.isDragging && templateDragState.targetRow !== null) {
        applyTemplateAtPosition();
    }

    // Reset state
    templateDragState.isDragging = false;
    templateDragState.templatePath = null;
    templateDragState.templateName = null;
    templateDragState.targetRow = null;
    templateDragState.targetPosition = null;
    templateDragState.targetColumnId = null;
    templateDragState.isDropZone = false;
}

/**
 * Handle template drag over a drop zone
 * Called from existing dragover handlers
 */
function handleTemplateDragOver(e, dropZone) {
    if (!templateDragState.isDragging) {
        return false;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Highlight the drop zone using tracking system
    addHighlight(dropZone, 'template-drag-over');

    // Determine target row and position
    const row = dropZone.closest('.kanban-row');
    if (row) {
        templateDragState.targetRow = parseInt(row.dataset.rowNumber, 10) || 1;
    }

    // Find the column before/after this drop zone
    const stack = dropZone.closest('.kanban-column-stack');
    if (stack) {
        const prevStack = stack.previousElementSibling;
        const nextStack = stack.nextElementSibling;

        if (prevStack && prevStack.classList.contains('kanban-column-stack')) {
            const prevColumn = prevStack.querySelector('.kanban-full-height-column');
            if (prevColumn) {
                templateDragState.targetColumnId = prevColumn.dataset.columnId;
                templateDragState.targetPosition = 'after';
            }
        } else if (nextStack && nextStack.classList.contains('kanban-column-stack')) {
            const nextColumn = nextStack.querySelector('.kanban-full-height-column');
            if (nextColumn) {
                templateDragState.targetColumnId = nextColumn.dataset.columnId;
                templateDragState.targetPosition = 'before';
            }
        } else {
            // First or last position
            templateDragState.targetColumnId = null;
            templateDragState.targetPosition = dropZone.classList.contains('column-drop-zone-before') ? 'first' : 'last';
        }
    }

    return true;
}

/**
 * Handle template drag leave
 */
function handleTemplateDragLeave(e, dropZone) {
    if (!templateDragState.isDragging) {
        return;
    }

    // Clear highlights when leaving (will be re-added if entering another zone)
    clearHighlights();
}

/**
 * Apply template at the determined position
 * Sends message to backend to show variable dialog and apply template
 */
function applyTemplateAtPosition() {
    if (!templateDragState.templatePath) {
        return;
    }

    // Send message to backend
    if (typeof vscode !== 'undefined') {
        vscode.postMessage({
            type: 'applyTemplate',
            templatePath: templateDragState.templatePath,
            templateName: templateDragState.templateName,
            targetRow: templateDragState.targetRow || 1,
            insertAfterColumnId: templateDragState.targetPosition === 'after' ? templateDragState.targetColumnId : null,
            insertBeforeColumnId: templateDragState.targetPosition === 'before' ? templateDragState.targetColumnId : null,
            position: templateDragState.targetPosition,
            // isDropZone indicates dropping between stacks (new stack) vs within a stack (join stack)
            isDropZone: templateDragState.isDropZone || false
        });
    }
}


/**
 * Normalize stack tags for all columns based on DOM positions
 * Same logic as processColumnDrop uses - first column in stack has no #stack tag,
 * all subsequent columns have #stack tag
 * Call this after board updates (e.g., after creating empty columns or applying templates)
 */
function normalizeAllStackTags() {
    const boardElement = document.getElementById('kanban-board');
    if (!boardElement || !window.cachedBoard) return;

    let hasChanges = false;

    // Get all column stacks (not drop zone stacks)
    const allStacks = boardElement.querySelectorAll('.kanban-column-stack:not(.column-drop-zone-stack)');

    allStacks.forEach(stack => {
        const columnsInStack = Array.from(stack.querySelectorAll('.kanban-full-height-column')).filter(col => {
            return col.closest('.kanban-column-stack') === stack;
        });

        columnsInStack.forEach((col, idx) => {
            const colId = col.getAttribute('data-column-id');
            const cachedCol = window.cachedBoard.columns.find(c => c.id === colId);
            if (!cachedCol) return;

            if (idx === 0) {
                // First column - remove #stack tag
                const hadStack = /#stack\b/i.test(cachedCol.title);
                if (hadStack) {
                    cachedCol.title = cachedCol.title.replace(/#stack\b/gi, '').replace(/\s+/g, ' ').trim();
                    updateColumnTitleDisplay(colId);
                    hasChanges = true;
                }
            } else {
                // Other columns - ensure they have #stack tag
                if (!/#stack\b/i.test(cachedCol.title)) {
                    const trimmedTitle = cachedCol.title.trim();
                    cachedCol.title = trimmedTitle ? trimmedTitle + ' #stack' : ' #stack';
                    updateColumnTitleDisplay(colId);
                    hasChanges = true;
                }
            }
        });
    });

    // If changes were made, mark as unsaved
    if (hasChanges && typeof markUnsavedChanges === 'function') {
        markUnsavedChanges();
    }

    return hasChanges;
}

// Make template functions globally available
window.setupTemplateDragHandlers = setupTemplateDragHandlers;
window.handleTemplateDragOver = handleTemplateDragOver;
window.handleTemplateDragLeave = handleTemplateDragLeave;
window.templateDragState = templateDragState;
window.normalizeAllStackTags = normalizeAllStackTags;
window.setupDragAndDrop = setupDragAndDrop;
