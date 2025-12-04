
// Add debugging flag
let lastIndicatorUpdate = 0;
const INDICATOR_UPDATE_THROTTLE = 100; // milliseconds
const DEBUG_DROP = false;

// Create smart logger for drag and drop
// const dragLogger = window.createSmartLogger ? window.createSmartLogger('DragDrop') : {
//     log: () => {},
//     always: console.log.bind(console, '[DragDrop]'),
//     clear: () => {},
//     once: () => {}
// };

// Track if drag/drop is already set up to prevent multiple listeners
let dragDropInitialized = false;
let isProcessingDrop = false; // Prevent multiple simultaneous drops
let currentExternalDropColumn = null;
let externalDropIndicator = null;

// PERFORMANCE: Internal task/column drop indicator (no DOM moves during drag)
let internalDropIndicator = null;

// Use centralized DragStateManager instead of local state
// The dragStateManager is already available globally as window.dragState
// for backward compatibility

// Create local references for frequently accessed properties
// Wait for dragStateManager to be available via window.dragState
let dragState = window.dragState;

// Add custom properties that aren't in base DragStateManager
// Initialize dragState if not available yet
if (!dragState) {
    dragState = {
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
        leftViewTimestamp: null
    };
    window.dragState = dragState;
} else if (!dragState.originalColumnIndex) {
    Object.assign(dragState, {
        // Column-specific
        draggedColumnId: null,
        originalColumnIndex: -1,
        originalColumnNextSibling: null,
        originalColumnParent: null,
        originalDataIndex: -1,

        // Task-specific
        originalTaskIndex: -1,
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
    });
}

// Template drag state (separate from main drag state for clarity)
let templateDragState = {
    isDragging: false,
    templatePath: null,
    templateName: null,
    targetRow: null,
    targetPosition: null,  // 'before' | 'after'
    targetColumnId: null
};

// External file drop location indicators
function createExternalDropIndicator() {
    if (externalDropIndicator) {
        return externalDropIndicator;
    }
    
    const indicator = document.createElement('div');
    indicator.className = 'external-drop-indicator';
    indicator.style.display = 'none';
    indicator.style.pointerEvents = 'none'; // Ensure it doesn't interfere with drops
    document.body.appendChild(indicator);
    externalDropIndicator = indicator;
    
    if (DEBUG_DROP) {
    }
    
    return indicator;
}

function showExternalDropIndicator(column, clientY) {
    // Remove highlight from previous column when switching to a different column
    if (currentExternalDropColumn && currentExternalDropColumn !== column) {
        currentExternalDropColumn.classList.remove('external-drag-over');
    }
    const indicator = createExternalDropIndicator();
    const tasksContainer = column.querySelector('.tasks-container');
    
    if (!tasksContainer) {return;}
    
    // Calculate insertion position
    const containerRect = tasksContainer.getBoundingClientRect();
    
    // Find insertion point between tasks
    const tasks = Array.from(tasksContainer.children);
    let insertionY = containerRect.top;
    
    if (tasks.length === 0) {
        insertionY = containerRect.top + 10;
    } else {
        let foundPosition = false;
        for (let i = 0; i < tasks.length; i++) {
            const taskRect = tasks[i].getBoundingClientRect();
            const taskCenter = taskRect.top + taskRect.height / 2;
            
            if (clientY < taskCenter) {
                insertionY = taskRect.top - 2;
                foundPosition = true;
                break;
            }
        }
        
        if (!foundPosition && tasks.length > 0) {
            const lastTaskRect = tasks[tasks.length - 1].getBoundingClientRect();
            insertionY = lastTaskRect.bottom + 2;
        }
    }
    
    // Position the indicator
    const columnRect = column.getBoundingClientRect();
    indicator.style.position = 'fixed';
    indicator.style.left = (columnRect.left + columnRect.width * 0.1) + 'px';
    indicator.style.right = 'auto';
    indicator.style.width = (columnRect.width * 0.8) + 'px';
    indicator.style.top = insertionY + 'px';
    indicator.style.display = 'block';
    indicator.classList.add('active');
    
    // Add highlight to column
    column.classList.add('external-drag-over');
    currentExternalDropColumn = column;
}

function hideExternalDropIndicator() {

    if (externalDropIndicator) {
        externalDropIndicator.classList.remove('active');
        externalDropIndicator.style.display = 'none';
    }
    
    if (currentExternalDropColumn) {
        currentExternalDropColumn.classList.remove('external-drag-over');
        currentExternalDropColumn = null;
    }
    
    // Remove highlight from all columns
    document.querySelectorAll('.kanban-full-height-column').forEach(col => {
        col.classList.remove('external-drag-over');
    });
}

function cleanupExternalDropIndicators() {

    hideExternalDropIndicator();
    if (externalDropIndicator) {
        externalDropIndicator.remove();
        externalDropIndicator = null;
    }
}

// ============================================================================
// PERFORMANCE OPTIMIZATION: Internal Drop Indicator (Tasks & Columns)
// ============================================================================
// Shows where task/column will be dropped WITHOUT moving it during drag
// Eliminates DOM reflows and layout thrashing for massive performance gains

function createInternalDropIndicator() {
    if (internalDropIndicator) {
        return internalDropIndicator;
    }

    const indicator = document.createElement('div');
    indicator.className = 'internal-drop-indicator';
    indicator.style.display = 'none';
    indicator.style.pointerEvents = 'none';
    document.body.appendChild(indicator);
    internalDropIndicator = indicator;

    return indicator;
}

function showInternalTaskDropIndicator(tasksContainer, afterElement) {
    const indicator = createInternalDropIndicator();

    // CRITICAL: Always store drop target FIRST!
    dragState.dropTargetContainer = tasksContainer;
    dragState.dropTargetAfterElement = afterElement;

    // Direct DOM queries - NO CACHE
    let insertionY;
    let containerLeft, containerWidth;

    // Get container dimensions from direct DOM query
    const containerRect = tasksContainer.getBoundingClientRect();
    containerLeft = containerRect.left;
    containerWidth = containerRect.width;

    // Get tasks and add button via direct DOM query
    const tasks = tasksContainer.querySelectorAll(':scope > .task-item');
    const addButton = tasksContainer.querySelector('.add-task-btn');

    if (!afterElement) {
        // Drop at end
        if (addButton) {
            const addBtnRect = addButton.getBoundingClientRect();
            insertionY = addBtnRect.top - 2;
        } else if (tasks.length > 0) {
            // Find last non-dragged task
            let lastTask = null;
            for (const task of tasks) {
                if (task !== dragState.draggedTask) {
                    lastTask = task;
                }
            }
            if (lastTask) {
                const lastRect = lastTask.getBoundingClientRect();
                insertionY = lastRect.bottom + 2;
            } else {
                // Only dragged task in container
                insertionY = containerRect.top + 10;
            }
        } else {
            // Empty container
            insertionY = containerRect.top + 10;
        }
    } else {
        // Drop before afterElement - direct DOM query
        const afterRect = afterElement.getBoundingClientRect();
        insertionY = afterRect.top - 2;
    }

    // Position the indicator
    indicator.style.position = 'fixed';
    indicator.style.left = (containerLeft + 10) + 'px';
    indicator.style.width = (containerWidth - 20) + 'px';
    indicator.style.top = insertionY + 'px';
    indicator.style.display = 'block';
    indicator.classList.add('active');
}

function showInternalColumnDropIndicator(targetStack, beforeColumn) {
    const indicator = createInternalDropIndicator();

    // Direct DOM queries - NO CACHE
    let insertionY, stackLeft, stackWidth;

    // For template drags over drop zones, don't show indicator - drop zone highlight is sufficient
    const isTemplateDrag = typeof templateDragState !== 'undefined' && templateDragState.isDragging;
    if (isTemplateDrag && targetStack.classList.contains('column-drop-zone-stack')) {
        // CRITICAL: Still need to set templateDragState for the drop zone!
        const row = targetStack.closest('.kanban-row');
        if (row) {
            templateDragState.targetRow = parseInt(row.dataset.rowNumber, 10) || 1;
        } else {
            templateDragState.targetRow = 1;
        }

        const prevStack = targetStack.previousElementSibling;
        const nextStack = targetStack.nextElementSibling;

        if (prevStack && prevStack.classList.contains('kanban-column-stack')) {
            const lastCol = prevStack.querySelector('.kanban-full-height-column:last-of-type');
            if (lastCol) {
                templateDragState.targetPosition = 'after';
                templateDragState.targetColumnId = lastCol.dataset?.columnId || null;
            }
        } else if (nextStack && nextStack.classList.contains('kanban-column-stack')) {
            const firstCol = nextStack.querySelector('.kanban-full-height-column:first-of-type');
            if (firstCol) {
                templateDragState.targetPosition = 'before';
                templateDragState.targetColumnId = firstCol.dataset?.columnId || null;
            }
        } else {
            templateDragState.targetPosition = 'first';
            templateDragState.targetColumnId = null;
        }

        indicator.style.display = 'none';
        return;
    }

    // Handle drop zone stacks (for column drags)
    if (targetStack.classList.contains('column-drop-zone-stack')) {
        indicator.style.display = 'none';
        dragState.dropTargetStack = targetStack;
        dragState.dropTargetBeforeColumn = beforeColumn;
        return;
    }

    // Direct DOM query for columns in stack
    const columnsInStack = targetStack.querySelectorAll(':scope > .kanban-full-height-column');

    if (!beforeColumn) {
        // Drop at end of stack (after last column)
        // Find last non-dragged column
        let lastCol = null;
        for (const col of columnsInStack) {
            if (col !== dragState.draggedColumn) {
                lastCol = col;
            }
        }

        if (lastCol) {
            // Direct DOM query for position
            const colRect = lastCol.getBoundingClientRect();
            const bottomMargin = lastCol.querySelector('.column-margin-bottom');

            if (bottomMargin) {
                const marginRect = bottomMargin.getBoundingClientRect();
                stackLeft = marginRect.left;
                stackWidth = marginRect.width;
                insertionY = marginRect.top + (marginRect.height / 2);
            } else {
                stackLeft = colRect.left;
                stackWidth = colRect.width;
                insertionY = colRect.bottom;
            }
        } else if (dragState.draggedColumn && dragState.draggedColumn.parentNode === targetStack) {
            // Only dragged column in stack - use its position
            const draggedRect = dragState.draggedColumn.getBoundingClientRect();
            stackLeft = draggedRect.left;
            stackWidth = draggedRect.width;
            insertionY = draggedRect.bottom + 5;
        } else {
            // Empty stack
            indicator.style.display = 'none';
            dragState.dropTargetStack = targetStack;
            dragState.dropTargetBeforeColumn = beforeColumn;
            return;
        }
    } else {
        // Drop before specific column - direct DOM query
        const colRect = beforeColumn.getBoundingClientRect();
        const topMargin = beforeColumn.querySelector('.column-margin:not(.column-margin-bottom)');

        if (topMargin) {
            const marginRect = topMargin.getBoundingClientRect();
            stackLeft = marginRect.left;
            stackWidth = marginRect.width;
            insertionY = marginRect.top + (marginRect.height / 2);
        } else {
            stackLeft = colRect.left;
            stackWidth = colRect.width;
            insertionY = colRect.top;
        }
    }

    // Show horizontal indicator for column stacking
    indicator.style.position = 'fixed';
    indicator.style.left = (stackLeft + 10) + 'px';
    indicator.style.width = (stackWidth - 20) + 'px';
    indicator.style.top = insertionY + 'px';
    indicator.style.height = '3px';
    indicator.style.display = 'block';
    indicator.classList.add('active');

    // CRITICAL: Always store drop target!
    dragState.dropTargetStack = targetStack;
    dragState.dropTargetBeforeColumn = beforeColumn;

    // For template drags, also update templateDragState with target position
    if (isTemplateDrag && typeof templateDragState !== 'undefined') {
        const row = targetStack.closest('.kanban-row');
        const stackRow = row ? parseInt(row.dataset.rowNumber, 10) || 1 : 1;
        templateDragState.targetRow = stackRow;

        if (beforeColumn) {
            templateDragState.targetPosition = 'before';
            templateDragState.targetColumnId = beforeColumn.dataset?.columnId || null;
        } else {
            const lastColumn = columnsInStack[columnsInStack.length - 1];
            templateDragState.targetPosition = 'after';
            templateDragState.targetColumnId = lastColumn?.dataset?.columnId || null;
        }
    }
}

function hideInternalDropIndicator() {
    if (internalDropIndicator) {
        internalDropIndicator.classList.remove('active');
        internalDropIndicator.style.display = 'none';
    }

    // Clear stored drop targets
    dragState.dropTargetContainer = null;
    dragState.dropTargetAfterElement = null;
    dragState.dropTargetStack = null;
    dragState.dropTargetBeforeColumn = null;
}

function cleanupInternalDropIndicator() {
    hideInternalDropIndicator();
    if (internalDropIndicator) {
        internalDropIndicator.remove();
        internalDropIndicator = null;
    }
}

/**
 * Cleans up all drop zone highlight classes
 * Purpose: Remove drag-over highlights from margins, drop zones, and columns
 * Used by: handleExternalDrop, cleanupDragVisuals, dragleave handlers, document dragover
 */
function cleanupDropZoneHighlights() {
    document.querySelectorAll('.column-margin.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.stack-bottom-drop-zone.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.column-drop-zone.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.column-title.task-drop-target').forEach(el => el.classList.remove('task-drop-target'));
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
        
        if (dragState.isDragging && (dragState.draggedColumn || dragState.draggedTask) && !dragState.draggedClipboardCard && !dragState.draggedEmptyCard) {
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

        // Check if this is an internal column/task drag (not clipboard/empty cards)
        const isInternalDrag = dragState.isDragging &&
            (dragState.draggedColumn || dragState.draggedTask) &&
            !dragState.draggedClipboardCard &&
            !dragState.draggedEmptyCard;

        if (isInternalDrag) {
                return;
        }

        // Check if this is a template drag - let template handlers handle it
        if (typeof templateDragState !== 'undefined' && templateDragState.isDragging) {
            return;
        }
        
        // Stop event propagation to prevent duplicate handling
        e.stopPropagation();
        
        // Always clean up visual indicators
        hideDropFeedback();
        hideExternalDropIndicator();
        hideInternalDropIndicator();
        document.querySelectorAll('.kanban-full-height-column').forEach(col => {
            col.classList.remove('external-drag-over');
        });
        cleanupDropZoneHighlights();

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
            if (dragState.draggedClipboardCard) {
                dragState.draggedClipboardCard = null;
                dragState.isDragging = false;
            }
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
            dragState.draggedClipboardCard = null;
            dragState.isDragging = false;
            return;
        }
        
        if (dragState.draggedEmptyCard) {
            const emptyCardData = JSON.stringify({
                type: 'empty-card',
                task: dragState.draggedEmptyCard
            });
            handleEmptyCardDrop(e, emptyCardData);
            dragState.draggedEmptyCard = null;
            dragState.isDragging = false;
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
            } else if (textData2.startsWith('MULTIPLE_FILES:')) {
                const filesContent = textData2.substring('MULTIPLE_FILES:'.length);
                handleMultipleFilesDrop(e, filesContent);
            } else if (textData2.startsWith('CLIPBOARD_IMAGE:')) {
                const imageData = textData2.substring('CLIPBOARD_IMAGE:'.length);
                handleClipboardImageDrop(e, imageData);
            } else if (textData2.includes('/')) {
                // Looks like a file path
                handleVSCodeUriDrop(e, textData2);
            } else {
                // Plain text - create a new card
                createNewTaskWithContent(
                    textData2,
                    { x: e.clientX, y: e.clientY },
                    ''
                );
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
    
    // Board container dragover for external file drag indicators
    boardContainer.addEventListener('dragover', function(e) {
        // Always prevent default to allow drops
        e.preventDefault();

        // Skip visual indicators for internal column/task drags
        if (dragState.isDragging && (dragState.draggedColumn || dragState.draggedTask) &&
            !dragState.draggedClipboardCard && !dragState.draggedEmptyCard) {
            return; // Don't show external drop indicators during internal drags
        }

        // Skip visual indicators for template drags - they use column drop zones
        if (typeof templateDragState !== 'undefined' && templateDragState.isDragging) {
            return; // Don't show external drop indicators during template drags
        }

        // Show drop indicators for external drags using hierarchical lookup
        const now = Date.now();
        if (now - lastIndicatorUpdate >= INDICATOR_UPDATE_THROTTLE) {
            lastIndicatorUpdate = now;

            // Use hierarchical position finder: Row (Y) → Stack (X) → Column (X) → Task (Y midpoint)
            const dropResult = findDropPositionHierarchical(e.clientX, e.clientY, null);

            if (dropResult && dropResult.columnElement) {
                showExternalDropIndicator(dropResult.columnElement, e.clientY);
            } else {
                hideExternalDropIndicator();
            }
            showDropFeedback();
        }
    }, false);
    
    boardContainer.addEventListener('drop', handleExternalDrop, false);
    
    boardContainer.addEventListener('dragenter', function(e) {
        // Skip external file drag handling if we're dragging internal elements
        if (dragState.isDragging && (dragState.draggedColumn || dragState.draggedTask)) {
            return; // Don't show external drop feedback during internal drags
        }

        // Skip for template drags
        if (typeof templateDragState !== 'undefined' && templateDragState.isDragging) {
            return;
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
            hideDropFeedback();
            hideExternalDropIndicator();
            hideInternalDropIndicator();
            cleanupDropZoneHighlights();
        }
    }, false);
    
    // Removed duplicate drop handler that was causing double card creation
    // The main handler at line 305 already handles all external drops
    
    // Document level handlers
    document.addEventListener('dragover', function(e) {
        // If we left the view and now dragover is firing, we're back!
        if (dragState.isDragging && dragState.leftView) {
            dragState.leftView = false;
        }

        if (!boardContainer.contains(e.target) && isExternalFileDrag(e)) {
            e.preventDefault();
        }
    }, false);

    // Use mousemove as a fallback to detect re-entry since dragenter/dragover might not fire
    document.addEventListener('mousemove', function(e) {
        if (dragState.isDragging && dragState.leftView) {
            dragState.leftView = false;
        }
    }, false);

    // Try mouseenter on body as another detection method
    document.body.addEventListener('mouseenter', function(e) {
        if (dragState.isDragging && dragState.leftView) {
            dragState.leftView = false;
        }
    }, false);

    // Try pointerenter which works during drag in some browsers
    document.addEventListener('pointerenter', function(e) {
        if (dragState.isDragging && dragState.leftView) {
            dragState.leftView = false;
        }
    }, { capture: true });

    document.addEventListener('drop', function(e) {
        if (!boardContainer.contains(e.target)) {
            e.preventDefault();
            // Clean up indicators if drop happens outside board
            hideDropFeedback();
            hideExternalDropIndicator();
            hideInternalDropIndicator();
            cleanupDropZoneHighlights();
        }
    }, false);

    // ============================================================================
    // UNIFIED DRAGEND HELPER FUNCTIONS
    // ============================================================================

    function restoreTaskToOriginalPosition() {
        if (!dragState.draggedTask || !dragState.originalTaskParent) {
            return;
        }

        // dragLogger.always('Restoring task to original position');

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
        const originalColumnId = originalColumnElement?.dataset.columnId;

        const finalIndex = Array.from(finalParent.children).indexOf(taskItem);

        // Check if position actually changed
        const positionChanged = finalParent !== dragState.originalTaskParent ||
                               finalIndex !== dragState.originalTaskIndex;

        if (!positionChanged || !originalColumnId) {
            return;
        }

        // Calculate the proper index for the data model
        const dropIndex = finalIndex >= 0 ? finalIndex : 0;

        // Unfold the destination column if it's collapsed (unless Alt key was pressed during drag)
        if (typeof unfoldColumnIfCollapsed === 'function') {
            const skipUnfold = dragState.altKeyPressed;
            unfoldColumnIfCollapsed(finalColumnId, skipUnfold);
        }

        // Update cached board
        if (window.cachedBoard) {
            const taskId = taskItem.dataset.taskId;

            // Save undo state
            vscode.postMessage({
                type: 'saveUndoState',
                operation: originalColumnId !== finalColumnId ? 'moveTaskViaDrag' : 'reorderTaskViaDrag',
                taskId: taskId,
                fromColumnId: originalColumnId,
                toColumnId: finalColumnId,
                currentBoard: window.cachedBoard
            });

            // Find and remove task from original column
            const originalColumn = window.cachedBoard.columns.find(col => col.id === originalColumnId);
            const finalColumn = window.cachedBoard.columns.find(col => col.id === finalColumnId);

            if (originalColumn && finalColumn) {
                const taskIndex = originalColumn.tasks.findIndex(t => t.id === taskId);
                if (taskIndex >= 0) {
                    const [task] = originalColumn.tasks.splice(taskIndex, 1);

                    // Log detailed task move information BEFORE the move

                    // Add task to new column at correct position
                    const insertIndex = Math.min(dropIndex, finalColumn.tasks.length);
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

                    // HYBRID APPROACH: Re-initialize the task element after move
                    // This ensures drag handlers are properly re-attached
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

        // Invalidate height cache for affected columns (content changed)
        if (typeof window.invalidateColumnHeightCache === 'function') {
            window.invalidateColumnHeightCache(originalColumnId);
            if (finalColumnId !== originalColumnId) {
                window.invalidateColumnHeightCache(finalColumnId);
            }
        }

        // Recalculate only affected stacks (not entire board)
        const sourceStack = originalColumnElement?.closest('.kanban-column-stack');
        const targetStack = finalColumnElement?.closest('.kanban-column-stack');
        if (typeof window.recalculateStackHeightsDebounced === 'function') {
            if (sourceStack) {
                window.recalculateStackHeightsDebounced(sourceStack);
            }
            if (targetStack && targetStack !== sourceStack) {
                window.recalculateStackHeightsDebounced(targetStack);
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

        // Update stack tags in destination stack
        const destinationStack = columnElement.closest('.kanban-column-stack');
        if (destinationStack) {
            const allColumnsInStack = Array.from(destinationStack.querySelectorAll('.kanban-full-height-column'));
            const columnsInDestStack = allColumnsInStack.filter(col => {
                return col.closest('.kanban-column-stack') === destinationStack;
            });

            columnsInDestStack.forEach((col, idx) => {
                const colId = col.getAttribute('data-column-id');

                if (idx === 0) {
                    // First column - remove #stack tag
                    if (window.cachedBoard) {
                        const cachedCol = window.cachedBoard.columns.find(c => c.id === colId);
                        if (cachedCol) {
                            cachedCol.title = cachedCol.title.replace(/#stack\b/gi, '').replace(/\s+/g, ' ').trim();
                        }
                    }
                    updateColumnTitleDisplay(colId);
                } else {
                    // Other columns - ensure they have #stack tag
                    if (window.cachedBoard) {
                        const cachedCol = window.cachedBoard.columns.find(c => c.id === colId);
                        if (cachedCol && !/#stack\b/i.test(cachedCol.title)) {
                            const trimmedTitle = cachedCol.title.trim();
                            cachedCol.title = trimmedTitle ? trimmedTitle + ' #stack' : ' #stack';
                        }
                    }
                    updateColumnTitleDisplay(colId);
                }
            });
        }

        // Handle the edge case where column is not in any stack
        const stackContainer = columnElement.closest('.kanban-column-stack');
        if (!stackContainer) {
            if (window.cachedBoard) {
                const cachedColumn = window.cachedBoard.columns.find(col => col.id === columnId);
                if (cachedColumn) {
                    cachedColumn.title = cachedColumn.title.replace(/#stack\b/gi, '').replace(/\s+/g, ' ').trim();
                }
            }
        }

        // Update the visual display
        const titleElement = columnElement.querySelector('.column-title-text');
        if (titleElement && window.cachedBoard) {
            const columnData = window.cachedBoard.columns.find(col => col.id === columnId);
            if (columnData) {
                const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(columnData, window.filterTagsFromText) : (columnData.title || '');
                titleElement.innerHTML = renderedTitle;
            }
        }

        // Reorder columns in cached board to match DOM order
        if (window.cachedBoard) {
            const reorderedColumns = newOrder.map(colId =>
                window.cachedBoard.columns.find(col => col.id === colId)
            ).filter(Boolean);

            window.cachedBoard.columns = reorderedColumns;
        }

        // Mark as unsaved
        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }

        // Recalculate only affected stacks (column heights unchanged, just positions)
        // Cache remains valid - no invalidation needed for column reorder
        const sourceStack = dragState.originalColumnParent;
        const targetStack = columnElement.closest('.kanban-column-stack');
        if (typeof window.recalculateStackHeightsDebounced === 'function') {
            if (sourceStack && sourceStack.classList?.contains('kanban-column-stack')) {
                window.recalculateStackHeightsDebounced(sourceStack);
            }
            if (targetStack && targetStack !== sourceStack) {
                window.recalculateStackHeightsDebounced(targetStack);
            }
        }

        // Enforce horizontal folding for stacked columns:
        // If a column is already folded (vertically), convert it to horizontal folding
        // Do NOT fold unfolded columns
        if (typeof window.enforceFoldModesForStacks === 'function' && targetStack) {
            window.enforceFoldModesForStacks(targetStack);
        }

        // Update drop zones after column reorder
        if (typeof window.updateStackBottomDropZones === 'function') {
            window.updateStackBottomDropZones();
        }
    }

    function cleanupDragVisuals() {
        // PERFORMANCE: Hide internal drop indicator
        hideInternalDropIndicator();

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

        // Clean up drop zone highlights
        cleanupDropZoneHighlights();

        // Hide drop feedback and indicators
        hideDropFeedback();
        hideExternalDropIndicator();
    }

    function resetDragState() {
        // PERFORMANCE: Remove scroll handler if it exists
        if (dragState.scrollHandler) {
            document.removeEventListener('scroll', dragState.scrollHandler, { capture: true });
            dragState.scrollHandler = null;
        }

        // CRITICAL: Clear all position caches to prevent memory leaks and stale references
        dragState.cachedColumnPositions = null;
        dragState.cachedStacks = null;
        dragState.cachedRows = null;
        dragState.cachedAddButtonRect = null;
        dragState.draggedColumnCache = null;
        if (dragState.allColumnPositions) {
            dragState.allColumnPositions.clear();
            dragState.allColumnPositions = null;
        }

        // Reset all drag state properties
        dragState.draggedClipboardCard = null;
        dragState.draggedEmptyCard = null;
        dragState.draggedTask = null;
        dragState.originalTaskParent = null;
        dragState.originalTaskNextSibling = null;
        dragState.originalTaskIndex = -1;
        dragState.draggedColumn = null;
        dragState.draggedColumnId = null;
        dragState.originalDataIndex = -1;
        dragState.originalColumnParent = null;
        dragState.originalColumnNextSibling = null;
        dragState.originalColumnIndex = -1;
        dragState.isDragging = false;
        dragState.lastDropTarget = null;
        dragState.leftView = false;
        dragState.leftViewTimestamp = null;

        // Reset drop target tracking
        dragState.dropTargetContainer = null;
        dragState.dropTargetAfterElement = null;
        dragState.dropTargetStack = null;
        dragState.dropTargetBeforeColumn = null;
        dragState.pendingDropZone = null;

        // Reset RAF throttle flags
        dragState.columnDragoverPending = false;
        dragState.documentDragoverPending = false;
    }

    // ============================================================================
    // UNIFIED GLOBAL DRAGEND HANDLER
    // ============================================================================

    // Global dragend handler - UNIFIED APPROACH
    document.addEventListener('dragend', function(e) {
        // dragLogger.always('[dragend] Event fired', {
        //     hasTask: !!dragState.draggedTask,
        //     hasColumn: !!dragState.draggedColumn,
        //     isDragging: dragState.isDragging,
        //     dropEffect: e.dataTransfer?.dropEffect
        // });

        // 1. CAPTURE STATE BEFORE ANY CLEANUP
        const wasTask = !!dragState.draggedTask;
        const wasColumn = !!dragState.draggedColumn;
        const wasDragging = dragState.isDragging;
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
        } else if (wasDragging) {
            // PROCESS - valid drop, process the changes
            // dragLogger.always('[dragend] Executing PROCESS path');
            if (wasTask) {
                processTaskDrop();
            }
            if (wasColumn) {
                processColumnDrop();
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
                    if (restoredStack && typeof window.recalculateStackHeightsDebounced === 'function') {
                        window.recalculateStackHeightsDebounced(restoredStack);
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

        createNewTaskWithContent(
            title,
            { x: e.clientX, y: e.clientY },
            description
        );
    } catch (error) {
        // Failed to parse clipboard data
        // Fallback: treat as plain text
        createNewTaskWithContent(
            'Clipboard Content',
            { x: e.clientX, y: e.clientY },
            typeof clipboardData === 'string' ? clipboardData : 'Clipboard content'
        );
    }
}

function handleEmptyCardDrop(e, emptyCardData) {

    try {
        const parsedData = JSON.parse(emptyCardData);

        // Create empty task

        createNewTaskWithContent(
            '',
            { x: e.clientX, y: e.clientY },
            ''
        );
    } catch (error) {
        // Failed to parse empty card data
        // Fallback: create empty task anyway
        createNewTaskWithContent(
            '',
            { x: e.clientX, y: e.clientY },
            ''
        );
    }
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
    createMultipleTasksWithContent(tasksData, { x: e.clientX, y: e.clientY });
}

function handleClipboardImageDrop(e, imageData) {
    try {
        // Parse the image data
        const parsedData = JSON.parse(imageData);

        const base64Data = parsedData.data;
        const imageType = parsedData.imageType || 'image/png';

        if (!base64Data) {
            console.error('No image data found in parsed data');
            createNewTaskWithContent(
                'Clipboard Image',
                { x: e.clientX, y: e.clientY },
                'Failed to save image: No image data found'
            );
            return;
        }

        // Extract the base64 part (remove data:image/png;base64, prefix if present)
        const base64Only = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

        processImageSave(e, base64Only, imageType, parsedData.md5Hash);

    } catch (error) {
        console.error('Failed to handle clipboard image drop:', error);
        createNewTaskWithContent(
            'Clipboard Image',
            { x: e.clientX, y: e.clientY },
            'Failed to process clipboard image'
        );
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
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + 'T' +
                         new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('-')[0];
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

        // Fallback: create a text card indicating the error
        createNewTaskWithContent(
            'Clipboard Image',
            { x: e.clientX, y: e.clientY },
            'Failed to process clipboard image'
        );
    }
}

function handleVSCodeFileDrop(e, files) {
    const file = files[0];
    const fileName = file.name;

    // Check if it's an image file
    const isImage = file.type.startsWith('image/');

    if (isImage) {
        // Read image file contents and save to MEDIA folder
        // This works for external drops (Finder/Explorer) where we don't have the path
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const base64Data = event.target.result.split(',')[1];

                // Send to backend to save (reuse clipboard image infrastructure)
                vscode.postMessage({
                    type: 'saveDroppedImageFromContents',
                    imageData: base64Data,
                    originalFileName: fileName,
                    imageType: file.type,
                    dropPosition: { x: e.clientX, y: e.clientY }
                });
            } catch (error) {
                console.error('[Image-Drop] Failed to process image:', error);

                // Fallback: create task with broken link
                createNewTaskWithContent(
                    fileName,
                    { x: e.clientX, y: e.clientY },
                    `![${fileName}](${fileName}) - Failed to copy image`
                );
            }
        };

        reader.onerror = function(error) {
            console.error('[Image-Drop] FileReader error:', error);
            createNewTaskWithContent(
                fileName,
                { x: e.clientX, y: e.clientY },
                `![${fileName}](${fileName}) - Failed to read image`
            );
        };

        reader.readAsDataURL(file);
    } else {
        // Non-image file - read contents and send to backend to save
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const base64Data = btoa(
                    new Uint8Array(event.target.result)
                        .reduce((data, byte) => data + String.fromCharCode(byte), '')
                );

                // Send to backend to save to MEDIA folder
                vscode.postMessage({
                    type: 'saveDroppedFileFromContents',
                    fileData: base64Data,
                    originalFileName: fileName,
                    fileType: file.type || 'application/octet-stream',
                    dropPosition: { x: e.clientX, y: e.clientY }
                });
            } catch (error) {
                console.error('[File-Drop] Failed to process file:', error);
                createNewTaskWithContent(
                    fileName,
                    { x: e.clientX, y: e.clientY },
                    `[${fileName}](${fileName}) - Failed to copy file`
                );
            }
        };

        reader.onerror = function(error) {
            console.error('[File-Drop] FileReader error:', error);
            createNewTaskWithContent(
                fileName,
                { x: e.clientX, y: e.clientY },
                `[${fileName}](${fileName}) - Failed to read file`
            );
        };

        reader.readAsArrayBuffer(file);
    }
}


function handleVSCodeUriDrop(e, uriData) {
    const uris = uriData.split('\n').filter(uri => uri.trim()).filter(uri => {
        const isFile = uri.startsWith('file://') || (uri.includes('/') && !uri.includes('task_') && !uri.includes('col_'));
        return isFile;
    });

    if (uris.length > 0) {
        // Separate images from other files
        const imageUris = [];
        const otherFileUris = [];

        uris.forEach(uri => {
            const filename = uri.split('/').pop() || uri;
            const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(filename);

            if (isImage) {
                imageUris.push(uri);
            } else {
                otherFileUris.push(uri);
            }
        });

        // Handle image URIs: copy to MEDIA folder
        imageUris.forEach(uri => {
            const fullPath = uri.startsWith('file://')
                ? decodeURIComponent(uri.replace('file://', ''))
                : uri;
            const filename = fullPath.split('/').pop() || uri;


            // Ask backend to copy from source path to MEDIA
            vscode.postMessage({
                type: 'copyImageToMedia',
                sourcePath: fullPath,
                originalFileName: filename,
                dropPosition: { x: e.clientX, y: e.clientY }
            });
        });

        // Handle non-image files: send to backend for workspace check
        if (otherFileUris.length > 0) {
            otherFileUris.forEach(uri => {
                const fullPath = uri.startsWith('file://')
                    ? decodeURIComponent(uri.replace('file://', ''))
                    : uri;
                const filename = fullPath.split('/').pop() || uri;

                // Ask backend to check workspace and copy/link appropriately
                vscode.postMessage({
                    type: 'handleFileUriDrop',
                    sourcePath: fullPath,
                    originalFileName: filename,
                    dropPosition: { x: e.clientX, y: e.clientY }
                });
            });
        }
    } else {
        // Could not process dropped file URIs
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
 * Creates new task from dropped content
 * Purpose: Convert external drops to tasks
 * Used by: File drops, clipboard drops, empty card drops
 * @param {string} content - Task title content
 * @param {Object} dropPosition - Column and index info
 * @param {string} description - Optional description
 * Side effects: Sends create task message to VS Code
 */
function createNewTaskWithContent(content, dropPosition, description = '', explicitColumnId = null, explicitInsertionIndex = null) {

    // Check board availability - NEW CACHE SYSTEM

    if (!window.cachedBoard) {
        // No cached board available
        vscode.postMessage({
            type: 'showMessage',
            text: 'Cannot create task: No board loaded'
        });
        return;
    }

    if (!window.cachedBoard.columns || window.cachedBoard.columns.length === 0) {
        // Board has no columns
        vscode.postMessage({
            type: 'showMessage',
            text: 'Cannot create task: No columns available'
        });
        return;
    }

    // Find target column using hierarchical lookup
    let targetColumnId = explicitColumnId;
    let insertionIndex = explicitInsertionIndex !== null ? explicitInsertionIndex : -1;

    // Only calculate position if explicit values not provided
    if (targetColumnId === null) {
        // Use hierarchical position finder: Row (Y) → Stack (X) → Column (X) → Task (Y midpoint)
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
        // Create new task with cache-first approach (no VS Code message)
        // Ensure all task fields are strings, not blobs or other objects
        const newTask = {
            id: `temp-drop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: typeof content === 'string' ? content : 'New Task',
            description: typeof description === 'string' ? description : ''
        };

        // Find the target column in cached board
        const targetColumn = window.cachedBoard.columns.find(col => col.id === targetColumnId);
        if (targetColumn) {
            // Insert task into cache
            if (insertionIndex >= 0 && insertionIndex <= targetColumn.tasks.length) {
                targetColumn.tasks.splice(insertionIndex, 0, newTask);
            } else {
                targetColumn.tasks.push(newTask);
                insertionIndex = targetColumn.tasks.length - 1;
            }

            // Mark as unsaved changes
            if (typeof markUnsavedChanges === 'function') {
                markUnsavedChanges();
            }

            // Update refresh button to show unsaved state
            if (typeof updateRefreshButtonState === 'function') {
                updateRefreshButtonState('unsaved', 1);
            }

            // PERFORMANCE: Use incremental DOM update instead of full re-render
            if (typeof window.addSingleTaskToDOM === 'function') {
                window.addSingleTaskToDOM(targetColumnId, newTask, insertionIndex);
            } else {
                // Fallback to full render if incremental function not available
                if (typeof renderBoard === 'function') {
                    renderBoard();
                }
            }

            // Recalculate affected stack after adding task (cache already invalidated by addSingleTaskToDOM)
            const targetColumnElement = document.querySelector(`[data-column-id="${targetColumnId}"]`);
            const targetStack = targetColumnElement?.closest('.kanban-column-stack');
            if (targetStack && typeof window.recalculateStackHeightsDebounced === 'function') {
                window.recalculateStackHeightsDebounced(targetStack);
            }
        }
    } else {
        // Could not find suitable column
        vscode.postMessage({ 
            type: 'showMessage', 
            text: 'Could not find a suitable column. Please ensure at least one column is not collapsed.' 
        });
    }
}


/**
 * Batch create multiple tasks at once (optimized for performance)
 * @param {Array} tasksData - Array of {title, description} objects
 * @param {Object} dropPosition - Drop position {x, y}
 */
function createMultipleTasksWithContent(tasksData, dropPosition) {
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

    // Calculate target column and insertion index ONCE using hierarchical lookup
    let targetColumnId = null;
    let insertionIndex = -1;

    // Use hierarchical position finder: Row (Y) → Stack (X) → Column (X) → Task (Y midpoint)
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

        // Mark as unsaved changes
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
        if (targetStack && typeof window.recalculateStackHeightsDebounced === 'function') {
            window.recalculateStackHeightsDebounced(targetStack);
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
    const tasksContainer = columnElement.querySelector('.tasks-container');

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
            dragState.originalTaskIndex = Array.from(dragState.originalTaskParent.children).indexOf(taskItem);
            dragState.isDragging = true; // IMPORTANT: Set this BEFORE setting data
            dragState.altKeyPressed = e.altKey; // Track Alt key state from the start
            dragState.affectedColumns = new Set(); // PERFORMANCE: Track affected columns for targeted cleanup
            dragState.affectedColumns.add(dragState.originalTaskParent); // Add origin column

            // PERFORMANCE: Cache task positions for ALL columns at dragstart
            // This eliminates ALL querySelectorAll and getBoundingClientRect calls during drag
            dragState.allColumnPositions = new Map();
            document.querySelectorAll('.column-tasks-container').forEach(container => {
                const containerKey = container.id || container.dataset.columnId || container;
                const tasks = Array.from(container.querySelectorAll('.task-item'))
                    .filter(task => task !== taskItem)
                    .map(task => ({
                        element: task,
                        rect: task.getBoundingClientRect()
                    }));
                const addButton = container.querySelector('.add-task-btn');
                const addButtonRect = addButton ? addButton.getBoundingClientRect() : null;

                dragState.allColumnPositions.set(containerKey, {
                    tasks: tasks,
                    addButton: addButton,
                    addButtonRect: addButtonRect
                });
            });

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

    // Add ESC key handler to cancel task drag
    if (!handle.hasEscListener) {
        handle.hasEscListener = true;
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && dragState.isDragging && dragState.draggedTask) {
                restoreTaskPosition();
                dragState.draggedTask.classList.remove('dragging', 'drag-preview');
                
                // Reset drag state
                dragState.draggedTask = null;
                dragState.originalTaskParent = null;
                dragState.originalTaskNextSibling = null;
                dragState.originalTaskIndex = -1;
                dragState.isDragging = false;
                dragState.altKeyPressed = false;
            }
        });
    }
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
    const tasksContainer = targetColumn.querySelector('.tasks-container');
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
    
    // Only set up global drag/drop once to prevent multiple listeners
    if (!dragDropInitialized) {
        setupGlobalDragAndDrop();
        dragDropInitialized = true;
    } else {
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
        // This matches the calculation in recalculateStackHeights()
        let cumulativeTop = 0;
        columns.forEach(col => {
            const isVerticallyFolded = col.classList.contains('collapsed-vertical');
            const isHorizontallyFolded = col.classList.contains('collapsed-horizontal');

            const columnMargin = col.querySelector('.column-margin');
            const columnHeader = col.querySelector('.column-header');
            const columnTitle = col.querySelector('.column-title');
            const columnInner = col.querySelector('.column-inner');
            const columnFooter = col.querySelector('.column-footer');

            if (columnMargin) {cumulativeTop += columnMargin.offsetHeight;}
            if (columnHeader) {cumulativeTop += columnHeader.offsetHeight;}
            if (columnTitle) {cumulativeTop += columnTitle.offsetHeight;}

            // Include column-inner content height (skip if column is folded)
            if (columnInner && !isVerticallyFolded && !isHorizontallyFolded) {
                cumulativeTop += columnInner.scrollHeight;
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
    const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(column, window.filterTagsFromText) : (column.title || '');

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

            // PERFORMANCE: Cache column AND margin/title positions for fast lookup during drag
            const allColumns = document.querySelectorAll('.kanban-full-height-column');

            // Cache dragged column separately (needed for drop-below-last-column indicator)
            const draggedColumnTitle = columnElement.querySelector('.column-title');
            const draggedIsSticky = draggedColumnTitle && window.getComputedStyle(draggedColumnTitle).position === 'sticky';
            const draggedContent = columnElement.querySelector('.column-content');
            const draggedContentRect = draggedContent ? draggedContent.getBoundingClientRect() : null;
            const draggedTitleRect = draggedColumnTitle ? draggedColumnTitle.getBoundingClientRect() : null;
            const draggedContentVisible = draggedContentRect && draggedContentRect.bottom > 0 && draggedContentRect.top < window.innerHeight;

            dragState.draggedColumnCache = {
                element: columnElement,
                rect: columnElement.getBoundingClientRect(),
                columnId: columnId,
                isSticky: draggedIsSticky,
                isFolded: draggedIsSticky && !draggedContentVisible,
                isContentVisible: draggedContentVisible,
                contentRect: draggedContentRect,
                columnTitleRect: draggedTitleRect
            };

            // HIERARCHICAL CACHE: Rows → Stacks → Columns
            const board = document.getElementById('kanban-board');

            // STEP 1: Cache ROW positions
            const rows = board.querySelectorAll('.kanban-row');
            if (rows.length > 0) {
                dragState.cachedRows = Array.from(rows).map(row => {
                    const rect = row.getBoundingClientRect();
                    return {
                        element: row,
                        rowNumber: parseInt(row.dataset.rowNumber, 10) || 1,
                        top: rect.top,
                        bottom: rect.bottom
                    };
                });
            } else {
                // Single row layout - use board as the row
                const boardRect = board.getBoundingClientRect();
                dragState.cachedRows = [{
                    element: board,
                    rowNumber: 1,
                    top: boardRect.top,
                    bottom: boardRect.bottom
                }];
            }

            // STEP 2: Cache ALL STACKS (including drop-zone-stacks) with hierarchical column data
            dragState.cachedStacks = Array.from(board.querySelectorAll('.kanban-column-stack')).map(stack => {
                const stackRect = stack.getBoundingClientRect();
                const isDropZoneStack = stack.classList.contains('column-drop-zone-stack');
                const rowElement = stack.closest('.kanban-row') || board;

                // For regular stacks, cache columns with header/footer positions
                let columnsData = [];
                if (!isDropZoneStack) {
                    const columnsInStack = Array.from(stack.querySelectorAll('.kanban-full-height-column'));
                    columnsData = columnsInStack.map(col => {
                        const columnTitle = col.querySelector('.column-title');
                        const columnFooter = col.querySelector('.column-footer');
                        const topMargin = col.querySelector('.column-margin:not(.column-margin-bottom)');
                        const bottomMargin = col.querySelector('.column-margin-bottom');

                        // Get header top (column-title top)
                        const headerTop = columnTitle ? columnTitle.getBoundingClientRect().top : col.getBoundingClientRect().top;

                        // Get footer bottom (column-footer bottom, or column bottom if no footer)
                        let footerBottom;
                        if (columnFooter) {
                            footerBottom = columnFooter.getBoundingClientRect().bottom;
                        } else {
                            // Use column bottom as fallback
                            footerBottom = col.getBoundingClientRect().bottom;
                        }

                        return {
                            element: col,
                            columnId: col.getAttribute('data-column-id'),
                            headerTop: headerTop,
                            footerBottom: footerBottom,
                            topMarginElement: topMargin,
                            bottomMarginElement: bottomMargin
                        };
                    });
                }

                // Find stack-bottom-drop-zone if exists
                const stackBottomDropZone = stack.querySelector('.stack-bottom-drop-zone');

                return {
                    element: stack,
                    rowElement: rowElement,
                    isDropZoneStack: isDropZoneStack,
                    left: stackRect.left,
                    right: stackRect.right,
                    top: stackRect.top,
                    bottom: stackRect.bottom,
                    columns: columnsData,
                    lastColumn: columnsData.length > 0 ? columnsData[columnsData.length - 1].element : null,
                    stackBottomDropZone: stackBottomDropZone
                };
            });

            // Keep cachedColumnPositions for backward compatibility with showInternalColumnDropIndicator
            dragState.cachedColumnPositions = Array.from(allColumns)
                .filter(col => col !== columnElement)
                .map(col => {
                    const colId = col.getAttribute('data-column-id');
                    const columnTitle = col.querySelector('.column-title');
                    const isSticky = columnTitle && window.getComputedStyle(columnTitle).position === 'sticky';
                    const topMargin = col.querySelector('.column-margin:not(.column-margin-bottom)');
                    const bottomMargin = col.querySelector('.column-margin-bottom');
                    const columnTitleRect = columnTitle ? columnTitle.getBoundingClientRect() : null;
                    const columnContent = col.querySelector('.column-content');
                    const contentRect = columnContent ? columnContent.getBoundingClientRect() : null;
                    const viewportHeight = window.innerHeight;
                    const isContentVisible = contentRect && contentRect.bottom > 0 && contentRect.top < viewportHeight;
                    const isFolded = isSticky && !isContentVisible;

                    return {
                        element: col,
                        rect: col.getBoundingClientRect(),
                        columnId: colId,
                        isSticky: isSticky,
                        isFolded: isFolded,
                        isContentVisible: isContentVisible,
                        contentRect: contentRect,
                        topMarginRect: topMargin ? topMargin.getBoundingClientRect() : null,
                        bottomMarginRect: bottomMargin ? bottomMargin.getBoundingClientRect() : null,
                        columnTitleRect: columnTitleRect
                    };
                });

            // Track throttling for column dragover
            dragState.columnDragoverThrottleId = null;

            // PERFORMANCE: Add scroll handler to update cache during drag
            // This keeps cached positions accurate if user scrolls while dragging
            const scrollHandler = () => {
                if (!dragState.isDragging || !dragState.draggedColumn) return;

                const board = document.getElementById('kanban-board');

                // Re-cache dragged column position
                const draggedCol = dragState.draggedColumn;
                const draggedTitle = draggedCol.querySelector('.column-title');
                const draggedSticky = draggedTitle && window.getComputedStyle(draggedTitle).position === 'sticky';
                const draggedCont = draggedCol.querySelector('.column-content');
                const draggedContRect = draggedCont ? draggedCont.getBoundingClientRect() : null;
                const draggedTitleRect = draggedTitle ? draggedTitle.getBoundingClientRect() : null;
                const draggedContVisible = draggedContRect && draggedContRect.bottom > 0 && draggedContRect.top < window.innerHeight;

                dragState.draggedColumnCache = {
                    element: draggedCol,
                    rect: draggedCol.getBoundingClientRect(),
                    columnId: draggedCol.getAttribute('data-column-id'),
                    isSticky: draggedSticky,
                    isFolded: draggedSticky && !draggedContVisible,
                    isContentVisible: draggedContVisible,
                    contentRect: draggedContRect,
                    columnTitleRect: draggedTitleRect
                };

                // Re-cache ROW positions
                const rows = board.querySelectorAll('.kanban-row');
                if (rows.length > 0) {
                    dragState.cachedRows = Array.from(rows).map(row => {
                        const rect = row.getBoundingClientRect();
                        return {
                            element: row,
                            rowNumber: parseInt(row.dataset.rowNumber, 10) || 1,
                            top: rect.top,
                            bottom: rect.bottom
                        };
                    });
                } else {
                    const boardRect = board.getBoundingClientRect();
                    dragState.cachedRows = [{
                        element: board,
                        rowNumber: 1,
                        top: boardRect.top,
                        bottom: boardRect.bottom
                    }];
                }

                // Re-cache STACKS with hierarchical column data
                dragState.cachedStacks = Array.from(board.querySelectorAll('.kanban-column-stack')).map(stack => {
                    const stackRect = stack.getBoundingClientRect();
                    const isDropZoneStack = stack.classList.contains('column-drop-zone-stack');
                    const rowElement = stack.closest('.kanban-row') || board;

                    let columnsData = [];
                    if (!isDropZoneStack) {
                        const columnsInStack = Array.from(stack.querySelectorAll('.kanban-full-height-column'));
                        columnsData = columnsInStack.map(col => {
                            const columnTitle = col.querySelector('.column-title');
                            const columnFooter = col.querySelector('.column-footer');
                            const topMargin = col.querySelector('.column-margin:not(.column-margin-bottom)');
                            const bottomMargin = col.querySelector('.column-margin-bottom');
                            const headerTop = columnTitle ? columnTitle.getBoundingClientRect().top : col.getBoundingClientRect().top;
                            let footerBottom = columnFooter ? columnFooter.getBoundingClientRect().bottom : col.getBoundingClientRect().bottom;

                            return {
                                element: col,
                                columnId: col.getAttribute('data-column-id'),
                                headerTop: headerTop,
                                footerBottom: footerBottom,
                                topMarginElement: topMargin,
                                bottomMarginElement: bottomMargin
                            };
                        });
                    }

                    const stackBottomDropZone = stack.querySelector('.stack-bottom-drop-zone');

                    return {
                        element: stack,
                        rowElement: rowElement,
                        isDropZoneStack: isDropZoneStack,
                        left: stackRect.left,
                        right: stackRect.right,
                        top: stackRect.top,
                        bottom: stackRect.bottom,
                        columns: columnsData,
                        lastColumn: columnsData.length > 0 ? columnsData[columnsData.length - 1].element : null,
                        stackBottomDropZone: stackBottomDropZone
                    };
                });

                // Re-cache all other column positions (for backward compatibility)
                const allColumns = document.querySelectorAll('.kanban-full-height-column');
                dragState.cachedColumnPositions = Array.from(allColumns)
                    .filter(col => col !== dragState.draggedColumn)
                    .map(col => {
                        const colId = col.getAttribute('data-column-id');
                        const columnTitle = col.querySelector('.column-title');
                        const isSticky = columnTitle && window.getComputedStyle(columnTitle).position === 'sticky';
                        const topMargin = col.querySelector('.column-margin:not(.column-margin-bottom)');
                        const bottomMargin = col.querySelector('.column-margin-bottom');
                        const columnTitleRect = columnTitle ? columnTitle.getBoundingClientRect() : null;
                        const columnContent = col.querySelector('.column-content');
                        const contentRect = columnContent ? columnContent.getBoundingClientRect() : null;
                        const viewportHeight = window.innerHeight;
                        const isContentVisible = contentRect && contentRect.bottom > 0 && contentRect.top < viewportHeight;
                        const isFolded = isSticky && !isContentVisible;

                        return {
                            element: col,
                            rect: col.getBoundingClientRect(),
                            columnId: colId,
                            isSticky: isSticky,
                            isFolded: isFolded,
                            isContentVisible: isContentVisible,
                            contentRect: contentRect,
                            topMarginRect: topMargin ? topMargin.getBoundingClientRect() : null,
                            bottomMarginRect: bottomMargin ? bottomMargin.getBoundingClientRect() : null,
                            columnTitleRect: columnTitleRect
                        };
                    });
            };
            dragState.scrollHandler = scrollHandler;
            document.addEventListener('scroll', scrollHandler, { passive: true, capture: true });

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
            cleanupDropZoneHighlights();

            // For task/clipboard/emptycard drags, clear drop target and hide indicator at start
            // If no valid target is found, task returns to original position with no highlight
            if (stillTaskDrag || stillClipboardDrag || stillEmptyCardDrag) {
                dragState.dropTargetContainer = null;
                dragState.dropTargetAfterElement = null;
                // Hide the visual indicator - it will be shown again only if valid target found
                if (internalDropIndicator) {
                    internalDropIndicator.classList.remove('active');
                    internalDropIndicator.style.display = 'none';
                }
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
                    dropZone.classList.add('drag-over');
                    dragState.pendingDropZone = dropZone;

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
                showInternalColumnDropIndicator(foundStack, null);
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

                let targetColumn = null;
                let dropAtEnd = false;

                // RULE 1: Check if hovering over header area (margin, header, or title) → drop at end
                for (const col of columnsArray) {
                    const margin = col.querySelector('.column-margin');
                    const header = col.querySelector('.column-header');
                    const title = col.querySelector('.column-title');

                    // Check margin
                    if (margin) {
                        const marginRect = margin.getBoundingClientRect();
                        if (mouseY >= marginRect.top && mouseY <= marginRect.bottom) {
                            targetColumn = col;
                            dropAtEnd = true;
                            break;
                        }
                    }
                    // Check header
                    if (header) {
                        const headerRect = header.getBoundingClientRect();
                        if (mouseY >= headerRect.top && mouseY <= headerRect.bottom) {
                            targetColumn = col;
                            dropAtEnd = true;
                            break;
                        }
                    }
                    // Check title
                    if (title) {
                        const titleRect = title.getBoundingClientRect();
                        if (mouseY >= titleRect.top && mouseY <= titleRect.bottom) {
                            targetColumn = col;
                            dropAtEnd = true;
                            break;
                        }
                    }
                }

                // RULE 2: Check if between column-margin.top and column-footer.bottom
                if (!targetColumn) {
                    for (const col of columnsArray) {
                        const margin = col.querySelector('.column-margin');
                        const footer = col.querySelector('.column-footer');
                        const marginTop = margin ? margin.getBoundingClientRect().top : col.getBoundingClientRect().top;
                        const footerBottom = footer ? footer.getBoundingClientRect().bottom : col.getBoundingClientRect().bottom;

                        if (mouseY >= marginTop && mouseY <= footerBottom) {
                            targetColumn = col;
                            break;
                        }
                    }
                }

                if (!targetColumn) {return;}

                // Add drag-source class to dim the task (only for actual task drags)
                if (stillTaskDrag && dragState.draggedTask && !dragState.draggedTask.classList.contains('drag-source')) {
                    dragState.draggedTask.classList.add('drag-source');
                }

                // Get tasks container
                const tasksContainer = targetColumn.querySelector('.tasks-container');
                if (!tasksContainer) {return;}

                // If over column-title, highlight column-header and drop at end
                if (dropAtEnd) {
                    // Hide line indicator
                    hideInternalDropIndicator();
                    // Highlight the column-title with a border
                    const columnTitle = targetColumn.querySelector('.column-title');
                    if (columnTitle) {
                        columnTitle.classList.add('task-drop-target');
                    }
                    // Store drop target
                    dragState.dropTargetContainer = tasksContainer;
                    dragState.dropTargetAfterElement = null;
                    return;
                }

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
                showInternalTaskDropIndicator(tasksContainer, afterElement);
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
                highlightMargin.classList.add('drag-over');
            }

            // Show the drop indicator and update state
            showInternalColumnDropIndicator(foundStack, beforeColumn);

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

    // Clear all template-drag-over classes
    document.querySelectorAll('.template-drag-over').forEach(el => {
        el.classList.remove('template-drag-over');
    });

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

    // Highlight the drop zone
    dropZone.classList.add('template-drag-over');

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

    dropZone.classList.remove('template-drag-over');
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
            position: templateDragState.targetPosition
        });
    }
}

/**
 * Cache column positions for template drags
 * Called when template drag starts to enable same drop behavior as column drags
 * MUST match the caching logic in setupColumnDragAndDrop exactly!
 */
function cacheColumnPositionsForTemplateDrag() {
    const allColumns = document.querySelectorAll('.kanban-full-height-column');
    const board = document.getElementById('kanban-board');
    const viewportHeight = window.innerHeight;

    // Cache stack structure (same as column drag)
    dragState.cachedStacks = Array.from(board.querySelectorAll('.kanban-column-stack:not(.column-drop-zone-stack)')).map(stack => {
        const columnsInStack = Array.from(stack.querySelectorAll('.kanban-full-height-column'));
        return {
            element: stack,
            columns: columnsInStack,
            lastColumn: columnsInStack[columnsInStack.length - 1]
        };
    });

    // Cache column positions (same logic as column drag in setupColumnDragAndDrop)
    dragState.cachedColumnPositions = Array.from(allColumns).map(col => {
        const colId = col.getAttribute('data-column-id');
        const columnTitle = col.querySelector('.column-title');

        // Check if column is using sticky positioning (collapsed/stacked)
        const isSticky = columnTitle && window.getComputedStyle(columnTitle).position === 'sticky';

        // Cache margins (used when NOT sticky) - use actual DOM elements
        const topMargin = col.querySelector('.column-margin:not(.column-margin-bottom)');
        const bottomMargin = col.querySelector('.column-margin-bottom');

        // Cache column title rect (used when sticky)
        const columnTitleRect = columnTitle ? columnTitle.getBoundingClientRect() : null;

        // CRITICAL: Check if column-content is visible in viewport (determines folded state)
        const columnContent = col.querySelector('.column-content');
        const contentRect = columnContent ? columnContent.getBoundingClientRect() : null;

        // Column is "folded" only if content is NOT visible in viewport
        // If any part of content is visible, it's NOT folded
        const isContentVisible = contentRect &&
            contentRect.bottom > 0 &&
            contentRect.top < viewportHeight;
        const isFolded = isSticky && !isContentVisible;

        return {
            element: col,
            rect: col.getBoundingClientRect(),
            columnId: colId,
            isSticky: isSticky,
            isFolded: isFolded,
            isContentVisible: isContentVisible,
            contentRect: contentRect,
            topMarginRect: topMargin ? topMargin.getBoundingClientRect() : null,
            bottomMarginRect: bottomMargin ? bottomMargin.getBoundingClientRect() : null,
            columnTitleRect: columnTitleRect
        };
    });
}

/**
 * Clear cached positions after template drag ends
 */
function clearTemplateDragCache() {
    dragState.cachedColumnPositions = null;
    dragState.cachedStacks = null;
    dragState.cachedRows = null;
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
window.cacheColumnPositionsForTemplateDrag = cacheColumnPositionsForTemplateDrag;
window.clearTemplateDragCache = clearTemplateDragCache;
window.normalizeAllStackTags = normalizeAllStackTags;