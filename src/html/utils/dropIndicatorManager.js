/**
 * Drop Indicator Manager
 *
 * Manages visual drop indicators during drag operations.
 * Handles task and column drop zone highlighting.
 *
 * Extracted from dragDrop.js for better code organization.
 *
 * State Management:
 * - Maintains internal state for drop indicator DOM elements
 * - Provides getters/setters for dragDrop.js access
 */

// ============================================================================
// MODULE STATE
// ============================================================================

// UNIFIED: Single drop indicator for both internal and external drags
let dropIndicator = null;

// Track current external drop column for cleanup
let currentExternalDropColumn = null;

// PERFORMANCE: Track highlighted elements to avoid querySelectorAll on cleanup
const highlightedElements = new Set();

// ============================================================================
// HIGHLIGHT HELPERS
// ============================================================================

/**
 * Add a highlight class to an element and track it for efficient cleanup
 * @param {HTMLElement} element - Element to highlight
 * @param {string} className - Class to add ('drag-over' or 'task-drop-target')
 */
function addHighlight(element, className) {
    if (!element) return;
    element.classList.add(className);
    highlightedElements.add({ element, className });
}

/**
 * Clear all tracked highlights efficiently (no querySelectorAll)
 */
function clearHighlights() {
    for (const { element, className } of highlightedElements) {
        element.classList.remove(className);
    }
    highlightedElements.clear();
}

// ============================================================================
// DROP INDICATOR CREATION
// ============================================================================

/**
 * Create or return existing drop indicator element
 * @returns {HTMLElement} The drop indicator element
 */
function createDropIndicator() {
    // SAFETY CHECK: Verify indicator is still in DOM
    if (dropIndicator && !document.body.contains(dropIndicator)) {
        console.warn('[DropIndicatorManager] Drop indicator was removed from DOM, recreating...');
        dropIndicator = null;
    }

    if (dropIndicator) {
        return dropIndicator;
    }

    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    document.body.appendChild(indicator);
    dropIndicator = indicator;

    return indicator;
}

// ============================================================================
// POSITIONING HELPERS
// ============================================================================

/**
 * CORE UNIFIED HELPER: Position the drop indicator at exact coordinates
 * This is the SINGLE source of truth for drop indicator positioning.
 * ALL drop indicator functions MUST use this helper.
 *
 * @param {HTMLElement} indicator - The drop indicator element
 * @param {number} left - Left position in pixels
 * @param {number} width - Width in pixels
 * @param {number} top - Top position in pixels
 */
function _positionDropIndicator(indicator, left, width, top) {
    indicator.style.position = 'fixed';
    indicator.style.left = left + 'px';
    indicator.style.width = width + 'px';
    indicator.style.top = top + 'px';
    indicator.classList.add('active');
}

/**
 * TASK-SPECIFIC HELPER: Calculate position for task insertion and show indicator
 * Used by showTaskDropIndicator
 *
 * @param {HTMLElement} indicator - The drop indicator element
 * @param {HTMLElement} tasksContainer - The tasks container
 * @param {HTMLElement|null} afterElement - Element to insert before, or null for end
 * @param {HTMLElement|null} skipElement - Element to skip when finding last task
 */
function _positionTaskDropIndicator(indicator, tasksContainer, afterElement, skipElement = null) {
    const containerRect = tasksContainer.getBoundingClientRect();

    // Calculate insertion Y based on afterElement
    let insertionY;
    if (!afterElement) {
        // Drop at end - position after last task or at add button
        const addButton = tasksContainer.querySelector('.add-task-btn');
        if (addButton) {
            insertionY = addButton.getBoundingClientRect().top - 2;
        } else {
            // Find last non-skipped task
            const tasks = tasksContainer.querySelectorAll(':scope > .task-item');
            let lastTask = null;
            for (const task of tasks) {
                if (task !== skipElement) lastTask = task;
            }
            if (lastTask) {
                insertionY = lastTask.getBoundingClientRect().bottom + 2;
            } else {
                insertionY = containerRect.top + 10;
            }
        }
    } else {
        insertionY = afterElement.getBoundingClientRect().top - 2;
    }

    // Use unified positioning helper
    _positionDropIndicator(indicator, containerRect.left + 10, containerRect.width - 20, insertionY);
}

// ============================================================================
// SHOW/HIDE FUNCTIONS
// ============================================================================

/**
 * UNIFIED: Show task drop indicator
 * Single function for ALL task drop indicators (internal and external)
 *
 * @param {HTMLElement} tasksContainer - The tasks container element
 * @param {Object} options - Configuration options
 * @param {number} [options.clientY] - Mouse Y position (calculates afterElement)
 * @param {HTMLElement} [options.afterElement] - Direct afterElement (skips calculation)
 * @param {HTMLElement} [options.skipElement] - Element to skip in calculations
 * @param {HTMLElement} [options.column] - Column element (for highlighting)
 * @param {Object} [options.dragState] - Drag state object for storing drop target info
 */
function showTaskDropIndicator(tasksContainer, options = {}) {
    if (!tasksContainer) return;

    const { clientY, afterElement: providedAfterElement, skipElement, column, dragState } = options;
    const indicator = createDropIndicator();

    let afterElement = providedAfterElement;

    // Calculate afterElement from clientY if not provided directly
    if (afterElement === undefined && clientY !== undefined) {
        const tasks = tasksContainer.querySelectorAll(':scope > .task-item');
        afterElement = null;

        for (const task of tasks) {
            if (skipElement && task === skipElement) continue;

            const taskRect = task.getBoundingClientRect();
            const taskMidpoint = (taskRect.top + taskRect.bottom) / 2;

            if (clientY < taskMidpoint) {
                afterElement = task;
                break;
            }
        }
    }

    // Position the indicator
    const skipForPosition = skipElement || (dragState && dragState.draggedTask);
    _positionTaskDropIndicator(indicator, tasksContainer, afterElement, skipForPosition);

    // Store drop target state if dragState provided
    if (dragState) {
        dragState.dropTargetContainer = tasksContainer;
        dragState.dropTargetAfterElement = afterElement;
    }

    // Add column highlight for external drags
    if (column) {
        if (currentExternalDropColumn && currentExternalDropColumn !== column) {
            clearHighlights();
        }
        addHighlight(column, 'external-drag-over');
        currentExternalDropColumn = column;
    }
}

/**
 * UNIFIED: Hide drop indicator and clear ALL related state
 * @param {Object} [dragState] - Optional drag state to clear drop target info from
 */
function hideDropIndicator(dragState) {
    if (dropIndicator) {
        dropIndicator.classList.remove('active');
    }

    clearHighlights();
    currentExternalDropColumn = null;

    if (dragState) {
        dragState.dropTargetContainer = null;
        dragState.dropTargetAfterElement = null;
        dragState.dropTargetStack = null;
        dragState.dropTargetBeforeColumn = null;
    }
}

/**
 * UNIFIED: Remove drop indicator from DOM entirely
 */
function cleanupDropIndicator() {
    hideDropIndicator();
    if (dropIndicator) {
        dropIndicator.remove();
        dropIndicator = null;
    }
}

/**
 * Show drop indicator for column drags (between columns in a stack)
 * Note: Column positioning is fundamentally different from task positioning,
 * so this remains a separate function but uses the same core indicator.
 *
 * @param {HTMLElement} targetStack - The stack element
 * @param {HTMLElement|null} beforeColumn - Column to insert before, or null for end
 * @param {Object} [options] - Optional configuration
 * @param {Object} [options.dragState] - Drag state object
 * @param {Object} [options.templateDragState] - Template drag state object
 */
function showColumnDropIndicator(targetStack, beforeColumn, options = {}) {
    const { dragState, templateDragState } = options;
    const indicator = createDropIndicator();

    let insertionY, stackLeft, stackWidth;

    // For template drags over drop zones, don't show indicator
    const isTemplateDrag = templateDragState && templateDragState.isDragging;
    if (isTemplateDrag && targetStack.classList.contains('column-drop-zone-stack')) {
        const row = targetStack.closest('.kanban-row');
        templateDragState.targetRow = row ? parseInt(row.dataset.rowNumber, 10) || 1 : 1;
        templateDragState.isDropZone = true;

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

        if (dragState) {
            dragState.dropTargetStack = targetStack;
            dragState.dropTargetBeforeColumn = beforeColumn;
        }
        indicator.classList.remove('active');
        return;
    }

    // Handle drop zone stacks
    if (targetStack.classList.contains('column-drop-zone-stack')) {
        indicator.classList.remove('active');
        if (dragState) {
            dragState.dropTargetStack = targetStack;
            dragState.dropTargetBeforeColumn = beforeColumn;
        }
        return;
    }

    const columnsInStack = targetStack.querySelectorAll(':scope > .kanban-full-height-column');
    const draggedColumn = dragState ? dragState.draggedColumn : null;

    if (!beforeColumn) {
        let lastCol = null;
        for (const col of columnsInStack) {
            if (col !== draggedColumn) lastCol = col;
        }

        if (lastCol) {
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
        } else if (draggedColumn && draggedColumn.parentNode === targetStack) {
            const draggedRect = draggedColumn.getBoundingClientRect();
            stackLeft = draggedRect.left;
            stackWidth = draggedRect.width;
            insertionY = draggedRect.bottom + 5;
        } else {
            indicator.classList.remove('active');
            if (dragState) {
                dragState.dropTargetStack = targetStack;
                dragState.dropTargetBeforeColumn = beforeColumn;
            }
            return;
        }
    } else {
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

    _positionDropIndicator(indicator, stackLeft + 10, stackWidth - 20, insertionY);

    if (dragState) {
        dragState.dropTargetStack = targetStack;
        dragState.dropTargetBeforeColumn = beforeColumn;
    }

    if (isTemplateDrag && templateDragState) {
        const row = targetStack.closest('.kanban-row');
        const stackRow = row ? parseInt(row.dataset.rowNumber, 10) || 1 : 1;
        templateDragState.targetRow = stackRow;
        templateDragState.isDropZone = false;

        if (beforeColumn) {
            templateDragState.targetPosition = 'before';
            templateDragState.targetColumnId = beforeColumn.dataset?.columnId || null;
        } else {
            const lastColumn = columnsInStack[columnsInStack.length - 1];
            templateDragState.targetPosition = 'after';
            templateDragState.targetColumnId = lastColumn?.dataset?.columnId || null;
        }

        templateDragState.lastInStackTarget = {
            row: stackRow,
            position: templateDragState.targetPosition,
            columnId: templateDragState.targetColumnId
        };
    }
}

/**
 * Cleans up all drop zone highlight classes
 * Purpose: Remove drag-over highlights from margins, drop zones, and columns
 * PERFORMANCE: Uses tracked highlights instead of querySelectorAll
 */
function cleanupDropZoneHighlights() {
    clearHighlights();
}

// ============================================================================
// STATE GETTERS/SETTERS
// ============================================================================

/**
 * Get the current drop indicator element
 * @returns {HTMLElement|null} The drop indicator element
 */
function getDropIndicator() {
    return dropIndicator;
}

/**
 * Get the highlighted elements set
 * @returns {Set} The set of highlighted elements
 */
function getHighlightedElements() {
    return highlightedElements;
}

/**
 * Get the current external drop column
 * @returns {HTMLElement|null} The current external drop column
 */
function getCurrentExternalDropColumn() {
    return currentExternalDropColumn;
}

/**
 * Set the current external drop column
 * @param {HTMLElement|null} column - The column element
 */
function setCurrentExternalDropColumn(column) {
    currentExternalDropColumn = column;
}

// ============================================================================
// WINDOW EXPORTS
// ============================================================================

// Highlight functions (also used by clipboardHandler.js)
window.addHighlight = addHighlight;
window.clearHighlights = clearHighlights;

// Drop indicator manager namespace
window.dropIndicatorManager = {
    // Creation
    createDropIndicator,

    // Positioning
    showTaskDropIndicator,
    showColumnDropIndicator,

    // Cleanup
    hideDropIndicator,
    cleanupDropIndicator,
    cleanupDropZoneHighlights,

    // State access
    getDropIndicator,
    getHighlightedElements,
    getCurrentExternalDropColumn,
    setCurrentExternalDropColumn
};
