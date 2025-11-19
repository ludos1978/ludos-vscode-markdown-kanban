
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

// Track recently created tasks to prevent duplicates
let recentlyCreatedTasks = new Set();

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
        leftViewTimestamp: null
    });
}

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
    if (DEBUG_DROP && currentExternalDropColumn !== column) {
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

function showInternalTaskDropIndicatorFallback(tasksContainer, afterElement) {
    const indicator = createInternalDropIndicator();
    const containerRect = tasksContainer.getBoundingClientRect();

    let insertionY;

    if (!afterElement) {
        // Drop at end (before add button if exists)
        const addButton = tasksContainer.querySelector('.add-task-btn');
        if (addButton) {
            const btnRect = addButton.getBoundingClientRect();
            insertionY = btnRect.top - 2;
        } else {
            insertionY = containerRect.bottom - 2;
        }
    } else {
        // Drop before afterElement
        const elementRect = afterElement.getBoundingClientRect();
        insertionY = elementRect.top - 2;
    }

    // Position the indicator
    indicator.style.position = 'fixed';
    indicator.style.left = (containerRect.left + 10) + 'px';
    indicator.style.width = (containerRect.width - 20) + 'px';
    indicator.style.top = insertionY + 'px';
    indicator.style.display = 'block';
    indicator.classList.add('active');

    // Store target position in dragState for dragend
    dragState.dropTargetContainer = tasksContainer;
    dragState.dropTargetAfterElement = afterElement;
}

function showInternalTaskDropIndicator(tasksContainer, afterElement) {
    const indicator = createInternalDropIndicator();

    // CRITICAL: Always store drop target FIRST, even if indicator can't be shown!
    // Otherwise processTaskDrop() won't know where to drop
    dragState.dropTargetContainer = tasksContainer;
    dragState.dropTargetAfterElement = afterElement;

    // PERFORMANCE: Look up cached data instead of querying DOM!
    const containerKey = tasksContainer.id || tasksContainer.dataset.columnId || tasksContainer;
    const cachedData = dragState.allColumnPositions?.get(containerKey);

    if (!cachedData) {
        // Can't show indicator, but drop target is already stored
        indicator.style.display = 'none';
        return;
    }

    let insertionY;
    let containerLeft, containerWidth;
    let canShowIndicator = false;

    // Use cached container dimensions
    if (cachedData.tasks.length > 0) {
        // Estimate container bounds from task positions
        const firstTask = cachedData.tasks[0];
        containerLeft = firstTask.rect.left;
        containerWidth = firstTask.rect.width;
        canShowIndicator = true;
    } else if (cachedData.addButtonRect) {
        containerLeft = cachedData.addButtonRect.left;
        containerWidth = cachedData.addButtonRect.width;
        canShowIndicator = true;
    }

    if (!canShowIndicator) {
        indicator.style.display = 'none';
        return;
    }

    if (!afterElement) {
        // Drop at end (before add button if exists)
        if (cachedData.addButtonRect) {
            insertionY = cachedData.addButtonRect.top - 2;
        } else if (cachedData.tasks.length > 0) {
            // After last task
            const lastTask = cachedData.tasks[cachedData.tasks.length - 1];
            insertionY = lastTask.rect.bottom + 2;
        } else {
            indicator.style.display = 'none';
            return;
        }
    } else {
        // Drop before afterElement - find it in cached positions
        const taskData = cachedData.tasks.find(t => t.element === afterElement);
        if (taskData) {
            insertionY = taskData.rect.top - 2;
        } else {
            // Can't find in cache - hide indicator but drop target already stored
            indicator.style.display = 'none';
            return;
        }
    }

    // Position the indicator using CACHED dimensions
    indicator.style.position = 'fixed';
    indicator.style.left = (containerLeft + 10) + 'px';
    indicator.style.width = (containerWidth - 20) + 'px';
    indicator.style.top = insertionY + 'px';
    indicator.style.display = 'block';
    indicator.classList.add('active');
}

function showInternalColumnDropIndicator(targetStack, beforeColumn) {
    const indicator = createInternalDropIndicator();

    // PERFORMANCE: Use cached column positions instead of querying DOM!
    let insertionY, stackLeft, stackWidth;

    if (dragState.cachedColumnPositions && dragState.cachedColumnPositions.length > 0) {
        if (!beforeColumn) {
            // Drop at end of stack (after last column)
            const stackColumns = dragState.cachedColumnPositions.filter(
                pos => pos.element.parentNode === targetStack
            );

            if (stackColumns.length > 0) {
                const lastCol = stackColumns[stackColumns.length - 1];

                // Drop at END: Need LIVE position (not cached) because viewport may have scrolled
                const liveRect = lastCol.element.getBoundingClientRect();
                stackLeft = liveRect.left;
                stackWidth = liveRect.width;
                insertionY = liveRect.bottom + 5;

                console.log('[ColumnIndicator] Drop at end (LIVE position):', {
                    columnId: lastCol.columnId,
                    liveBottom: liveRect.bottom,
                    cachedBottom: lastCol.rect.bottom,
                    insertionY: insertionY
                });
            } else if (dragState.draggedColumn && dragState.draggedColumn.parentNode === targetStack) {
                // No OTHER columns in stack, but dragged column IS in this stack
                // Use dragged column's position for indicator
                const draggedRect = dragState.draggedColumn.getBoundingClientRect();
                stackLeft = draggedRect.left;
                stackWidth = draggedRect.width;
                insertionY = draggedRect.bottom + 5;
                console.log('[ColumnIndicator] Drop at end (only dragged column in stack):', {
                    draggedColumnId: dragState.draggedColumnId,
                    insertionY: insertionY
                });
            } else if (targetStack.classList.contains('column-drop-zone-stack')) {
                // Empty drop zone stack (horizontal drop area) - show vertical indicator in the zone
                const dropZone = targetStack.querySelector('.column-drop-zone');
                if (dropZone) {
                    const dropZoneRect = dropZone.getBoundingClientRect();
                    stackLeft = dropZoneRect.left;
                    stackWidth = dropZoneRect.width;
                    // Position indicator vertically in the middle of the drop zone
                    insertionY = dropZoneRect.top + (dropZoneRect.height / 2);
                    console.log('[ColumnIndicator] Drop zone (horizontal drop):', {
                        dropZoneRect: dropZoneRect,
                        insertionY: insertionY
                    });
                } else {
                    indicator.style.display = 'none';
                    return;
                }
            } else {
                // Truly empty stack - hide indicator
                indicator.style.display = 'none';
                return;
            }
        } else {
            // Drop before specific column - position in that column's margin
            const colData = dragState.cachedColumnPositions.find(pos => pos.element === beforeColumn);
            if (colData) {
                // Use this column's dimensions for indicator width/left
                stackLeft = colData.rect.left;
                stackWidth = colData.rect.width;

                // PERFORMANCE: Use cached margin position (no DOM queries!)
                if (colData.marginRect) {
                    insertionY = colData.marginRect.top + (colData.marginRect.height / 2);
                    console.log('[ColumnIndicator] Using margin:', {
                        columnId: colData.columnId,
                        marginTop: colData.marginRect.top,
                        marginHeight: colData.marginRect.height,
                        insertionY: insertionY
                    });
                } else {
                    insertionY = colData.rect.top - 2;
                    console.log('[ColumnIndicator] NO margin, using column edge:', {
                        columnId: colData.columnId,
                        columnTop: colData.rect.top,
                        insertionY: insertionY
                    });
                }
            } else {
                // Fallback: not in cache
                indicator.style.display = 'none';
                return;
            }
        }
    } else {
        // No cache available - can't position indicator precisely
        // But STILL store drop target so drop works!
        indicator.style.display = 'none';
        stackLeft = 0;
        stackWidth = 200; // Fallback width
        insertionY = 0;
    }

    // Show horizontal indicator for column stacking (if cache available)
    if (dragState.cachedColumnPositions && dragState.cachedColumnPositions.length > 0) {
        indicator.style.position = 'fixed';
        indicator.style.left = (stackLeft + 10) + 'px';
        indicator.style.width = (stackWidth - 20) + 'px';
        indicator.style.top = insertionY + 'px';
        indicator.style.height = '3px';
        indicator.style.display = 'block';
        indicator.classList.add('active');

        console.log('[ColumnIndicator] Positioned:', {
            left: stackLeft + 10,
            width: stackWidth - 20,
            top: insertionY,
            beforeColumn: beforeColumn?.dataset?.columnId || 'end'
        });
    }

    // CRITICAL: Always store drop target, even if indicator can't be shown!
    // Otherwise processColumnDrop() won't know where to drop
    dragState.dropTargetStack = targetStack;
    dragState.dropTargetBeforeColumn = beforeColumn;
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
        
        // Stop event propagation to prevent duplicate handling
        e.stopPropagation();
        
        // Always clean up visual indicators
        hideDropFeedback();
        hideExternalDropIndicator();
        document.querySelectorAll('.kanban-full-height-column').forEach(col => {
            col.classList.remove('external-drag-over');
        });
        
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
    
    // PERFORMANCE-OPTIMIZED: Board container dragover with throttling
    // Cache column positions for external file drag indicators
    let cachedBoardColumns = null;
    let boardCacheTimestamp = 0;
    const BOARD_CACHE_DURATION = 1000; // Re-cache every 1 second

    boardContainer.addEventListener('dragover', function(e) {
        // Always prevent default to allow drops
        e.preventDefault();

        // Skip visual indicators for internal column/task drags
        if (dragState.isDragging && (dragState.draggedColumn || dragState.draggedTask) &&
            !dragState.draggedClipboardCard && !dragState.draggedEmptyCard) {
            return; // Don't show external drop indicators during internal drags
        }

        // Show drop indicators for external drags
        const now = Date.now();
        if (now - lastIndicatorUpdate >= INDICATOR_UPDATE_THROTTLE) {
            lastIndicatorUpdate = now;

            // Check if we're over a column (works for both single and multi-row layouts)
            const column = e.target && e.target.closest ? e.target.closest('.kanban-full-height-column') : null;
            if (column) {
                // Allow drops on collapsed columns - they will be unfolded on drop
                showExternalDropIndicator(column, e.clientY);
            } else {
                // Check if we're over a row or spacer in multi-row mode
                const row = e.target && e.target.closest ? e.target.closest('.kanban-row') : null;
                const spacer = e.target && e.target.closest ? e.target.closest('.row-drop-zone-spacer') : null;
                if (row || spacer) {
                    // PERFORMANCE: Cache column positions for 1 second to avoid repeated querySelectorAll
                    if (!cachedBoardColumns || (now - boardCacheTimestamp) > BOARD_CACHE_DURATION) {
                        const columns = boardContainer.querySelectorAll('.kanban-full-height-column');
                        cachedBoardColumns = Array.from(columns).map(col => ({
                            element: col,
                            rect: col.getBoundingClientRect()
                        }));
                        boardCacheTimestamp = now;
                    }

                    // Find nearest column using cached positions
                    let nearestColumn = null;
                    let minDistance = Infinity;

                    cachedBoardColumns.forEach(item => {
                        const distance = Math.abs(item.rect.left + item.rect.width / 2 - e.clientX);
                        if (distance < minDistance) {
                            minDistance = distance;
                            nearestColumn = item.element;
                        }
                    });

                    if (nearestColumn) {
                        showExternalDropIndicator(nearestColumn, e.clientY);
                    } else {
                        hideExternalDropIndicator();
                    }
                } else {
                    hideExternalDropIndicator();
                }
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

        // Recalculate stack heights if needed
        if (originalColumnId !== finalColumnId && typeof window.recalculateStackHeights === 'function') {
            requestAnimationFrame(() => {
                const originalCol = originalColumnElement;
                const finalCol = finalColumnElement;

                const originalStack = originalCol?.closest('.kanban-column-stack');
                const finalStack = finalCol?.closest('.kanban-column-stack');

                if (originalStack) {
                    window.recalculateStackHeights(originalStack);
                }
                if (finalStack && finalStack !== originalStack) {
                    window.recalculateStackHeights(finalStack);
                }
            });
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

            console.log('[ColumnDrop] Moving column', {
                columnId: columnId,
                targetStack: targetStack,
                beforeColumn: beforeColumn,
                beforeColumnId: beforeColumn?.dataset?.columnId
            });

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

        // Recalculate stacked column styles after drag
        if (typeof window.applyStackedColumnStyles === 'function') {
            window.applyStackedColumnStyles();
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

        // Clean up drop zone styles
        document.querySelectorAll('.column-drop-zone.drag-over').forEach(dz => {
            dz.classList.remove('drag-over');
        });

        // Hide drop feedback and indicators
        hideDropFeedback();
        hideExternalDropIndicator();
    }

    function resetDragState() {
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
                dragLogger.always('[DragDrop] *** CURSOR LEFT VIEW - RESTORING TO ORIGINAL POSITION ***');

                // Store references before cleanup
                const droppedTask = dragState.draggedTask;
                const droppedColumn = dragState.draggedColumn;

                dragLogger.always('Cursor left view - restoration state', {
                    hasTask: !!droppedTask,
                    hasColumn: !!droppedColumn,
                    isDragging: dragState.isDragging
                });

                // Restore to original position
                if (droppedTask) {
                    dragLogger.always('Calling restoreTaskToOriginalPosition');
                    restoreTaskToOriginalPosition();
                }
                if (droppedColumn) {
                    dragLogger.always('Calling restoreColumnToOriginalPosition');
                    restoreColumnToOriginalPosition();

                    // Update stacked column styles after DOM restoration
                    if (typeof window.applyStackedColumnStyles === 'function') {
                        window.applyStackedColumnStyles();
                        dragLogger.always('Applied stacked column styles after restoration');
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
                        const parent = droppedColumn.parentNode;
                        const currentIdx = parent ? Array.from(parent.children).indexOf(droppedColumn) : -1;
                        dragLogger.always('Column position check BEFORE highlight', {
                            isConnected: droppedColumn.isConnected,
                            currentIndex: currentIdx,
                            parentClass: parent?.className
                        });

                        scrollToElementIfNeeded(droppedColumn, 'column');

                        // Check again after highlight
                        setTimeout(() => {
                            const parent2 = droppedColumn.parentNode;
                            const idx2 = parent2 ? Array.from(parent2.children).indexOf(droppedColumn) : -1;
                            dragLogger.always('Column position check AFTER highlight', {
                                isConnected: droppedColumn.isConnected,
                                currentIndex: idx2,
                                parentClass: parent2?.className
                            });
                        }, 200);
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
                dragLogger.always('[DragDrop] *** CURSOR RE-ENTERED VIEW *** resuming drag - clearing leftView');

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
        // If we were dragging and mouseup fires, clean up
        if (dragState.isDragging) {
            dragLogger.always('Mouse released during drag - cleaning up');

            // Restore the task to its original position if it was moved
            if (dragState.draggedTask && dragState.originalTaskParent) {

                // Check if originalTaskNextSibling is still in the DOM
                const nextSiblingStillValid = dragState.originalTaskNextSibling &&
                    dragState.originalTaskNextSibling.parentNode === dragState.originalTaskParent;

                // Remove from current position
                if (dragState.draggedTask.parentNode) {
                    dragState.draggedTask.parentNode.removeChild(dragState.draggedTask);
                }

                // Restore to original position
                if (nextSiblingStillValid) {
                    dragState.originalTaskParent.insertBefore(dragState.draggedTask, dragState.originalTaskNextSibling);
                } else {
                    // Next sibling might have been moved/deleted, use index instead
                    const children = Array.from(dragState.originalTaskParent.children);
                    const taskItems = children.filter(c => c.classList.contains('task-item'));

                    if (dragState.originalTaskIndex >= 0 && dragState.originalTaskIndex < taskItems.length) {
                        dragState.originalTaskParent.insertBefore(dragState.draggedTask, taskItems[dragState.originalTaskIndex]);
                    } else {
                        dragState.originalTaskParent.appendChild(dragState.draggedTask);
                    }
                }

                // Remove drag classes
                dragState.draggedTask.classList.remove('dragging', 'drag-preview');
            }

            // Restore the column to its original position if it was moved
            if (dragState.draggedColumn && dragState.originalColumnParent) {
                // Check if originalColumnNextSibling is still in the DOM
                const nextSiblingStillValid = dragState.originalColumnNextSibling &&
                    dragState.originalColumnNextSibling.parentNode === dragState.originalColumnParent;

                // Remove from current position
                if (dragState.draggedColumn.parentNode) {
                    dragState.draggedColumn.parentNode.removeChild(dragState.draggedColumn);
                }

                // Restore to original position
                if (nextSiblingStillValid) {
                    dragState.originalColumnParent.insertBefore(dragState.draggedColumn, dragState.originalColumnNextSibling);
                } else {
                    // Next sibling might have been moved, append to original parent
                    dragState.originalColumnParent.appendChild(dragState.draggedColumn);
                }

                // Remove drag classes
                dragState.draggedColumn.classList.remove('dragging', 'drag-preview');
            }

            // Clean up all visual feedback
            hideDropFeedback();
            hideExternalDropIndicator();

            // Reset drag state
            dragState.draggedTask = null;
            dragState.draggedColumn = null;
            dragState.draggedColumnId = null;
            dragState.originalTaskParent = null;
            dragState.originalTaskNextSibling = null;
            dragState.originalTaskIndex = -1;
            dragState.originalColumnParent = null;
            dragState.originalColumnNextSibling = null;
            dragState.originalDataIndex = -1;
            dragState.isDragging = false;
        }
    }, false);

    // Handle visibility change (when tab loses focus or window is minimized)
    document.addEventListener('visibilitychange', function() {
        if (document.hidden && dragState.isDragging) {
            dragLogger.always('Document hidden during drag - cleaning up');

            // Clean up drag state when document becomes hidden
            if (dragState.draggedTask) {
                dragState.draggedTask.classList.remove('dragging', 'drag-preview');
            }
            if (dragState.draggedColumn) {
                dragState.draggedColumn.classList.remove('dragging', 'drag-preview');
            }

            hideDropFeedback();
            hideExternalDropIndicator();

            // Reset state
            dragState.isDragging = false;
            dragState.draggedTask = null;
            dragState.draggedColumn = null;
            dragState.draggedColumnId = null;
            dragState.originalTaskParent = null;
            dragState.originalTaskNextSibling = null;
            dragState.originalTaskIndex = -1;
            dragState.originalColumnParent = null;
            dragState.originalColumnNextSibling = null;
            dragState.originalDataIndex = -1;
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

    // Create appropriate link format based on file type
    const fileLink = createFileMarkdownLink(fileName); // For direct file drops, use filename as path

    createNewTaskWithContent(
        fileName,  // Title: actual filename
        { x: e.clientX, y: e.clientY },
        fileLink   // Description: formatted link
    );
}


function handleVSCodeUriDrop(e, uriData) {
    const uris = uriData.split('\n').filter(uri => uri.trim()).filter(uri => {
        const isFile = uri.startsWith('file://') || (uri.includes('/') && !uri.includes('task_') && !uri.includes('col_'));
        return isFile;
    });

    if (uris.length > 0) {
        // Prepare all tasks data
        const tasksData = uris.map(uri => {
            let filename = uri;
            let fullPath = uri;

            if (uri.startsWith('file://')) {
                // Extract filename from file:// URIs
                filename = decodeURIComponent(uri).split('/').pop() || uri;
                fullPath = decodeURIComponent(uri); // Keep full path for link creation
            } else {
                // For non-file URIs, try to get the filename
                filename = uri.split('/').pop() || uri;
                fullPath = uri;
            }

            // Create appropriate link format based on file type
            const fileLink = createFileMarkdownLink(fullPath);

            return {
                title: filename,
                description: fileLink
            };
        });

        // Batch create all tasks at once (single render)
        createMultipleTasksWithContent(tasksData, { x: e.clientX, y: e.clientY });
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

    // Find target column
    let targetColumnId = explicitColumnId;
    let insertionIndex = explicitInsertionIndex !== null ? explicitInsertionIndex : -1;

    // Only calculate position if explicit values not provided
    if (targetColumnId === null) {
        const elementAtPoint = document.elementFromPoint(dropPosition.x, dropPosition.y);

        // Try multiple strategies to find the column
        let columnElement = elementAtPoint?.closest('.kanban-full-height-column');

        // If we didn't find a column, try the parent elements
        if (!columnElement) {
            // Check if we're on a row
            const row = elementAtPoint?.closest('.kanban-row');
            if (row) {
                // Find the column that contains this x position
                const columns = row.querySelectorAll('.kanban-full-height-column');
                for (const col of columns) {
                    const rect = col.getBoundingClientRect();
                    if (dropPosition.x >= rect.left && dropPosition.x <= rect.right) {
                        columnElement = col;
                        break;
                    }
                }
            }
        }

        if (columnElement) {
            targetColumnId = columnElement.dataset.columnId;

            // Unfold the column if it's collapsed
            if (columnElement.classList.contains('collapsed')) {
                if (typeof unfoldColumnIfCollapsed === 'function') {
                    unfoldColumnIfCollapsed(targetColumnId);
                }
            }

            insertionIndex = calculateInsertionIndex(columnElement, dropPosition.y);
        } else {
            const columns = document.querySelectorAll('.kanban-full-height-column'); // Allow collapsed columns
            let minDistance = Infinity;

            columns.forEach(column => {
                const rect = column.getBoundingClientRect();
                const distX = Math.abs((rect.left + rect.right) / 2 - dropPosition.x);
                const distY = Math.abs((rect.top + rect.bottom) / 2 - dropPosition.y);
                const distance = Math.sqrt(distX * distX + distY * distY);

                if (distance < minDistance) {
                    minDistance = distance;
                    targetColumnId = column.dataset.columnId;

                    // Unfold the nearest column if it's collapsed
                    if (column.classList.contains('collapsed')) {
                        if (typeof unfoldColumnIfCollapsed === 'function') {
                            unfoldColumnIfCollapsed(targetColumnId);
                        }
                    }

                    insertionIndex = calculateInsertionIndex(column, dropPosition.y);
                }
            });

            if (targetColumnId) {
            }
        }

        if (!targetColumnId && window.cachedBoard.columns.length > 0) {
            // Try non-collapsed first, then any column
            let fallbackColumn = window.cachedBoard.columns.find(col =>
                !window.collapsedColumns || !window.collapsedColumns.has(col.id)
            );

            if (!fallbackColumn) {
                // If all columns are collapsed, use the first one and unfold it
                fallbackColumn = window.cachedBoard.columns[0];
            }

            if (fallbackColumn) {
                targetColumnId = fallbackColumn.id;

                // Unfold if collapsed
                if (typeof unfoldColumnIfCollapsed === 'function') {
                    unfoldColumnIfCollapsed(targetColumnId);
                }

                insertionIndex = -1;
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

    // Calculate target column and insertion index ONCE
    let targetColumnId = null;
    let insertionIndex = -1;

    const elementAtPoint = document.elementFromPoint(dropPosition.x, dropPosition.y);
    let columnElement = elementAtPoint?.closest('.kanban-full-height-column');

    if (!columnElement) {
        const row = elementAtPoint?.closest('.kanban-row');
        if (row) {
            const columns = row.querySelectorAll('.kanban-full-height-column');
            for (const col of columns) {
                const rect = col.getBoundingClientRect();
                if (dropPosition.x >= rect.left && dropPosition.x <= rect.right) {
                    columnElement = col;
                    break;
                }
            }
        }
    }

    if (columnElement) {
        targetColumnId = columnElement.dataset.columnId;

        // Unfold the column if it's collapsed
        if (columnElement.classList.contains('collapsed')) {
            if (typeof unfoldColumnIfCollapsed === 'function') {
                unfoldColumnIfCollapsed(targetColumnId);
            }
        }

        insertionIndex = calculateInsertionIndex(columnElement, dropPosition.y);
    } else {
        const columns = document.querySelectorAll('.kanban-full-height-column');
        let minDistance = Infinity;

        columns.forEach(column => {
            const rect = column.getBoundingClientRect();
            const distX = Math.abs((rect.left + rect.right) / 2 - dropPosition.x);
            const distY = Math.abs((rect.top + rect.bottom) / 2 - dropPosition.y);
            const distance = Math.sqrt(distX * distX + distY * distY);

            if (distance < minDistance) {
                minDistance = distance;
                targetColumnId = column.dataset.columnId;

                if (column.classList.contains('collapsed')) {
                    if (typeof unfoldColumnIfCollapsed === 'function') {
                        unfoldColumnIfCollapsed(targetColumnId);
                    }
                }

                insertionIndex = calculateInsertionIndex(column, dropPosition.y);
            }
        });
    }

    if (!targetColumnId && window.cachedBoard.columns.length > 0) {
        let fallbackColumn = window.cachedBoard.columns.find(col =>
            !window.collapsedColumns || !window.collapsedColumns.has(col.id)
        );

        if (!fallbackColumn) {
            fallbackColumn = window.cachedBoard.columns[0];
        }

        if (fallbackColumn) {
            targetColumnId = fallbackColumn.id;

            if (typeof unfoldColumnIfCollapsed === 'function') {
                unfoldColumnIfCollapsed(targetColumnId);
            }

            insertionIndex = -1;
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
    } else {
        vscode.postMessage({
            type: 'showMessage',
            text: 'Could not find a suitable column. Please ensure at least one column is not collapsed.'
        });
    }
}


function calculateInsertionIndex(column, clientY) {

    const tasksContainer = column.querySelector('.tasks-container');
    if (!tasksContainer) {
        return -1;
    }
    
    const tasks = Array.from(tasksContainer.children);
    
    if (tasks.length === 0) {
        return 0;
    }
    
    for (let i = 0; i < tasks.length; i++) {
        const taskRect = tasks[i].getBoundingClientRect();
        const taskCenter = taskRect.top + taskRect.height / 2;
        
        if (clientY < taskCenter) {
            return i;
        }
    }
    
    return -1;
}


// Helper function to restore original task position
function restoreTaskPosition() {

    if (dragState.draggedTask && dragState.originalTaskParent) {
        // Remove from current position
        if (dragState.draggedTask.parentNode) {
            dragState.draggedTask.parentNode.removeChild(dragState.draggedTask);
        }
        
        // Insert back to original position
        if (dragState.originalTaskNextSibling) {
            dragState.originalTaskParent.insertBefore(dragState.draggedTask, dragState.originalTaskNextSibling);
        } else {
            dragState.originalTaskParent.appendChild(dragState.draggedTask);
        }
        
        dragState.draggedTask.classList.remove('drag-source-hidden');
    }
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

function calculateColumnDropIndexInRow(draggedColumn) {

    if (!currentBoard || !currentBoard.columns) {return -1;}
    
    const boardElement = document.getElementById('kanban-board');
    const columnId = draggedColumn.getAttribute('data-column-id');
    
    // Get all columns in their visual order
    let allColumnsInOrder = [];
    
    // If multi-row layout
    const rows = boardElement.querySelectorAll('.kanban-row');
    if (rows.length > 0) {
        rows.forEach(row => {
            const columnsInRow = row.querySelectorAll('.kanban-full-height-column');
            columnsInRow.forEach(col => {
                allColumnsInOrder.push(col.getAttribute('data-column-id'));
            });
        });
    } else {
        // Single row layout
        const columns = boardElement.querySelectorAll('.kanban-full-height-column');
        columns.forEach(col => {
            allColumnsInOrder.push(col.getAttribute('data-column-id'));
        });
    }
    
    // Find the target index in the data model
    const visualIndex = allColumnsInOrder.indexOf(columnId);
    
    // Map visual order to data model order
    let targetIndex = 0;
    for (let i = 0; i < visualIndex; i++) {
        const colId = allColumnsInOrder[i];
        if (currentBoard.columns.findIndex(c => c.id === colId) !== -1) {
            targetIndex++;
        }
    }
    
    return targetIndex;
}

function calculateColumnDropIndex(boardElement, draggedColumn) {

    const columns = Array.from(boardElement.querySelectorAll('.kanban-full-height-column'));
    const currentIndex = columns.indexOf(draggedColumn);
    
    if (!currentBoard || !currentBoard.columns) {return -1;}
    
    // Map DOM position to data model position
    const columnId = draggedColumn.getAttribute('data-column-id');
    let targetIndex = 0;
    
    for (let i = 0; i < currentIndex; i++) {
        const col = columns[i];
        const colId = col.getAttribute('data-column-id');
        const dataIndex = currentBoard.columns.findIndex(c => c.id === colId);
        if (dataIndex !== -1) {
            targetIndex++;
        }
    }
    
    return targetIndex;
}

/**
 * Sets up drag and drop for task elements
 * Purpose: Enable dragging tasks between columns
 * Used by: setupDragAndDrop() after board render
 * Side effects: Makes tasks draggable, adds drop zones
 */
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

    // Add dragover handler to the entire column for appending to end
    columnElement.addEventListener('dragover', e => {
        // Update Alt key state during drag (user might press/release Alt mid-drag)
        if (dragState.isDragging) {
            dragState.altKeyPressed = e.altKey;
        }

        // Only process if we have a dragged task
        if (!dragState.draggedTask) {return;}

        // Check if we're over the tasks container specifically
        const isOverTasksContainer = tasksContainer.contains(e.target);

        if (!isOverTasksContainer) {
            // We're over the column but not the tasks container (e.g., header area)
            e.preventDefault();

            // PERFORMANCE: Just show indicator at end, DON'T move actual element!
            // Store target for dragend to perform actual move
            dragState.dropTargetContainer = tasksContainer;
            dragState.dropTargetAfterElement = null; // null = append at end

            // Show drop indicator at end of column
            showInternalTaskDropIndicator(tasksContainer, null);

            // Add visual feedback
            columnElement.classList.add('drag-over-append');
        }
    });

    // Add drop handler to entire column
    columnElement.addEventListener('drop', e => {
        if (!dragState.draggedTask) {return;}

        const isOverTasksContainer = tasksContainer.contains(e.target);
        if (!isOverTasksContainer) {
            e.preventDefault();
            columnElement.classList.remove('drag-over-append');
        }
    });

    // Clean up visual feedback when leaving column
    columnElement.addEventListener('dragleave', e => {
        if (!columnElement.contains(e.relatedTarget)) {
            columnElement.classList.remove('drag-over-append');
        }
    });

    // PERFORMANCE-OPTIMIZED: Throttled dragover handler with cached positions
    tasksContainer.addEventListener('dragover', e => {
        e.preventDefault();

        // Update Alt key state during drag (user might press/release Alt mid-drag)
        if (dragState.isDragging) {
            dragState.altKeyPressed = e.altKey;
        }

        // Only stop propagation for internal task drags, not external drops
        if (dragState.draggedTask && !dragState.draggedClipboardCard && !dragState.draggedEmptyCard) {
            e.stopPropagation(); // Prevent column-level handler from interfering
        }

        if (!dragState.draggedTask) {
            return;
        }

        // PERFORMANCE: Add drag-source class to dim the task (stays in original position)
        if (!dragState.draggedTask.classList.contains('drag-source')) {
            dragState.draggedTask.classList.add('drag-source');
        }

        // Remove any column-level visual feedback when over tasks
        columnElement.classList.remove('drag-over-append');

        // PERFORMANCE: Use pre-cached positions from dragstart - ZERO recalculation during drag!
        const containerKey = tasksContainer.id || tasksContainer.dataset.columnId || tasksContainer;
        const cachedData = dragState.allColumnPositions?.get(containerKey);

        if (!cachedData) {
            // DEBUG: Log cache miss to help diagnose
            console.warn('[DragPerf] Cache miss for container', {
                hasMap: !!dragState.allColumnPositions,
                mapSize: dragState.allColumnPositions?.size,
                containerKey: containerKey,
                keys: dragState.allColumnPositions ? Array.from(dragState.allColumnPositions.keys()) : []
            });

            // FALLBACK: Calculate positions on-the-fly (slower but functional)
            const tasks = Array.from(tasksContainer.querySelectorAll('.task-item'))
                .filter(task => task !== dragState.draggedTask);
            const afterElement = getDragAfterTaskElement(tasksContainer, e.clientY);

            // Show indicator with fallback positioning
            showInternalTaskDropIndicatorFallback(tasksContainer, afterElement);
            return;
        }

        // Use cached positions to find drop location (no DOM queries!)
        const afterElement = getDragAfterTaskElementFromCache(
            e.clientY,
            cachedData.tasks,
            cachedData.addButtonRect
        );

        // Show drop indicator at calculated position
        showInternalTaskDropIndicator(tasksContainer, afterElement);
    });

    tasksContainer.addEventListener('drop', e => {
        e.preventDefault();

        // Only stop propagation for internal task drags, let external drops bubble up
        if (dragState.draggedTask && !dragState.draggedClipboardCard && !dragState.draggedEmptyCard) {
            e.stopPropagation(); // Prevent column-level handler for internal drags only
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

function getDragAfterTaskElement(container, y) {

    const draggableElements = [...container.querySelectorAll('.task-item')].filter(el => el !== dragState.draggedTask);
    const addButton = container.querySelector('.add-task-btn');

    // If column is empty (only has add button), always drop at the beginning (before add button)
    if (draggableElements.length === 0) {
        return null; // This means insert at the end (before add button if it exists)
    }

    // If dragging over or near the add button area, treat it as dropping at the end
    if (addButton) {
        const addButtonBox = addButton.getBoundingClientRect();
        if (y >= addButtonBox.top - 10) { // Add 10px buffer above the button
            // Return null to indicate dropping at the end (but before the add button)
            return null;
        }
    }

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * PERFORMANCE-OPTIMIZED: Get the element to insert after using CACHED positions
 * This eliminates querySelectorAll and getBoundingClientRect calls during drag
 * Uses positions cached at dragstart in dragState.cachedTaskPositions
 */
function getDragAfterTaskElementCached(y) {
    const cachedPositions = dragState.cachedTaskPositions;

    // If column is empty, return null (insert at end)
    if (!cachedPositions || cachedPositions.length === 0) {
        return null;
    }

    // Check if dragging over add button area
    if (dragState.cachedAddButtonRect) {
        if (y >= dragState.cachedAddButtonRect.top - 10) {
            return null; // Drop at end (before add button)
        }
    }

    // Use cached positions instead of getBoundingClientRect
    const result = cachedPositions.reduce((closest, item) => {
        const offset = y - item.rect.top - item.rect.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: item.element };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY });

    return result.element;
}

/**
 * PERFORMANCE-OPTIMIZED: Get element to insert after using ANY cached positions
 * Generic version that works with any position cache (original column or new column)
 * @param {number} y - Mouse Y position
 * @param {Array} cachedPositions - Array of {element, rect} objects
 * @param {DOMRect|null} addButtonRect - Optional add button rect
 */
function getDragAfterTaskElementFromCache(y, cachedPositions, addButtonRect) {
    // If column is empty, return null (insert at end)
    if (!cachedPositions || cachedPositions.length === 0) {
        return null;
    }

    // Check if dragging over add button area
    if (addButtonRect && y >= addButtonRect.top - 10) {
        return null; // Drop at end (before add button)
    }

    // Use cached positions instead of getBoundingClientRect
    const result = cachedPositions.reduce((closest, item) => {
        const offset = y - item.rect.top - item.rect.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: item.element };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY });

    return result.element;
}

function calculateTaskDropIndex(tasksContainer, draggedTask, event) {

    const tasks = Array.from(tasksContainer.children);
    const currentIndex = tasks.indexOf(draggedTask);
    
    // Return the current index in the DOM
    return currentIndex >= 0 ? currentIndex : 0;
}

/**
 * Calculates insertion index based on mouse position
 * Purpose: Determine where to insert dropped task
 * Used by: Task drop operations
 * @param {HTMLElement} tasksContainer - Target container
 * @param {number} clientY - Mouse Y position
 * @returns {number} Insertion index
 */
function calculateDropIndex(tasksContainer, clientY) {

    const tasks = Array.from(tasksContainer.children);
    let dropIndex = tasks.length;

    for (let i = 0; i < tasks.length; i++) {
        const taskElement = tasks[i];
        const rect = taskElement.getBoundingClientRect();
        const taskCenter = rect.top + rect.height / 2;

        if (clientY < taskCenter) {
            dropIndex = i;
            break;
        }
    }

    return dropIndex;
}

function getOriginalColumnIndex(columnId) {
    if (!currentBoard || !currentBoard.columns) {return -1;}
    return currentBoard.columns.findIndex(col => col.id === columnId);
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
        `;

        // Add dragover handler for this drop zone
        dropZone.addEventListener('dragover', e => {
            if (!dragState.draggedColumn) {return;}
            e.preventDefault();

            // PERFORMANCE: Just show indicator, DON'T move column!
            // Drop at end of stack (before drop zone)
            showInternalColumnDropIndicator(stack, null);
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
            const originalIndex = currentBoard.columns.findIndex(c => c.id === columnId);

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

            // PERFORMANCE: Cache column AND margin positions for fast lookup during drag
            const allColumns = document.querySelectorAll('.kanban-full-height-column');
            dragState.cachedColumnPositions = Array.from(allColumns)
                .filter(col => col !== columnElement)
                .map(col => {
                    // Each column has ONE .column-margin at the top
                    const margin = col.querySelector('.column-margin');
                    const colId = col.getAttribute('data-column-id');

                    console.log('[ColumnDragstart] Caching column margin:', {
                        columnId: colId,
                        hasMargin: !!margin,
                        marginRect: margin ? margin.getBoundingClientRect() : null
                    });

                    return {
                        element: col,
                        rect: col.getBoundingClientRect(),
                        columnId: colId,
                        marginRect: margin ? margin.getBoundingClientRect() : null
                    };
                });

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


        // PERFORMANCE-OPTIMIZED: Show indicator only, NO DOM moves during drag
        column.addEventListener('dragover', e => {
            if (!dragState.draggedColumn || dragState.draggedColumn === column) {return;}

            // Don't handle if we're currently over a drop zone - let the drop zone handle it
            if (dragState.pendingDropZone) {
                return;
            }

            e.preventDefault();

            const draggedStack = dragState.draggedColumn.parentNode;
            const targetStack = column.parentNode;

            if (!draggedStack || !targetStack ||
                !draggedStack.classList.contains('kanban-column-stack') ||
                !targetStack.classList.contains('kanban-column-stack')) {
                console.warn('[ColumnDragover] Not in stacks', {
                    draggedStack: draggedStack?.className,
                    targetStack: targetStack?.className
                });
                return;
            }

            // Use LIVE rect for accurate midpoint calculation (viewport may have scrolled)
            const rect = column.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;

            // Determine drop position based on mouse Y
            let beforeColumn;
            if (e.clientY < midpoint) {
                // Drop before this column
                beforeColumn = column;
            } else {
                // Drop after this column
                beforeColumn = column.nextSibling;
            }

            console.log('[ColumnDragover] Midpoint calculation', {
                columnId: column.dataset.columnId,
                rectTop: rect.top,
                rectHeight: rect.height,
                midpoint: midpoint,
                clientY: e.clientY,
                isBeforeColumn: e.clientY < midpoint
            });

            console.log('[ColumnDragover] Showing indicator', {
                targetColumnId: column.dataset.columnId,
                beforeColumnId: beforeColumn?.dataset?.columnId,
                clientY: e.clientY,
                midpoint: midpoint,
                dropPosition: e.clientY < midpoint ? 'before' : 'after'
            });

            // Show indicator, DON'T move actual column!
            showInternalColumnDropIndicator(targetStack, beforeColumn);
        });
    });

    // Add dragover handler to allow dropping below the last column in a stack
    // Use event delegation on document to handle dynamically created stacks
    document.addEventListener('dragover', e => {
        if (!dragState.draggedColumn) {return;}

        // Don't interfere if directly over a column or drop zone
        if (e.target.classList.contains('kanban-full-height-column') ||
            e.target.closest('.kanban-full-height-column') ||
            e.target.classList.contains('column-drop-zone')) {
            return;
        }

        // First try to find stack directly
        let stack = e.target.closest('.kanban-column-stack');

        // If not hovering over stack, check if hovering over row below a stack
        if (!stack) {
            const row = e.target.closest('.kanban-row');
            if (!row) {return;}

            // Find all stacks in this row and check if mouse is below any of them
            const stacks = Array.from(row.querySelectorAll('.kanban-column-stack'));

            for (const candidateStack of stacks) {
                if (candidateStack.classList.contains('column-drop-zone-stack')) {continue;}

                const columns = Array.from(candidateStack.querySelectorAll('.kanban-full-height-column'));
                if (columns.length === 0) {continue;}

                const lastColumn = columns[columns.length - 1];
                const lastRect = lastColumn.getBoundingClientRect();
                const stackRect = candidateStack.getBoundingClientRect();

                // Check if mouse is horizontally within stack bounds and vertically below last column
                if (e.clientX >= stackRect.left &&
                    e.clientX <= stackRect.right &&
                    e.clientY > lastRect.bottom) {
                    stack = candidateStack;
                    break;
                }
            }
        }

        if (!stack || stack.classList.contains('column-drop-zone-stack')) {
            return;
        }

        e.preventDefault();

        // Check if mouse is below all columns (vertical stacking)
        const columns = Array.from(stack.querySelectorAll('.kanban-full-height-column'));
        if (columns.length === 0) {return;}

        const lastColumn = columns[columns.length - 1];
        const lastRect = lastColumn.getBoundingClientRect();

        // Only handle vertical drops below the last column
        if (e.clientY > lastRect.bottom) {
            console.log('[DocumentDragover] Below last column, showing end indicator:', {
                clientY: e.clientY,
                lastColumnBottom: lastRect.bottom,
                stackColumns: columns.length
            });
            // PERFORMANCE: Just show indicator at end of stack, DON'T move column!
            showInternalColumnDropIndicator(stack, null);
        }
    });

    // Add dragover handlers specifically to drop zones - visual feedback only
    document.addEventListener('dragover', (e) => {
        // ONLY handle if the direct target is a drop zone (not a child element)
        if (!e.target.classList.contains('column-drop-zone')) {
            // Clear any previous drag-over states
            document.querySelectorAll('.column-drop-zone.drag-over').forEach(dz => {
                dz.classList.remove('drag-over');
            });
            dragState.pendingDropZone = null;
            return;
        }

        // Only handle drop zones for column drags, not task drags
        if (!dragState.draggedColumn) {
            return;
        }

        const dropZone = e.target;
        e.preventDefault();

        // Add visual feedback only - don't move anything yet
        document.querySelectorAll('.column-drop-zone.drag-over').forEach(dz => {
            if (dz !== dropZone) {dz.classList.remove('drag-over');}
        });
        dropZone.classList.add('drag-over');

        // Show indicator in the drop zone
        const dropZoneStack = dropZone.parentNode;
        if (dropZoneStack && dropZoneStack.classList.contains('column-drop-zone-stack')) {
            console.log('[DropZoneDragover] Showing indicator in horizontal drop zone');
            // Show indicator at the drop zone (null = drop at end, which positions it in the zone)
            showInternalColumnDropIndicator(dropZoneStack, null);
        }

        // Store the drop zone for processing on dragend
        dragState.pendingDropZone = dropZone;
    });

    // NOTE: Drop zone cleanup dragend handler removed - now handled by unified global dragend handler (cleanupDragVisuals)
}

function calculateColumnNewPosition(draggedColumn) {

    if (!currentBoard || !currentBoard.columns) {return 0;}
    
    const boardElement = document.getElementById('kanban-board');
    const columnId = draggedColumn.getAttribute('data-column-id');
    
    // Build the desired final order of ALL columns based on current DOM state
    let desiredOrder = [];
    
    // Check if we have multi-row layout
    const rows = boardElement.querySelectorAll('.kanban-row');
    if (rows.length > 0) {
        // Multi-row layout - collect columns row by row, left to right
        rows.forEach(row => {
            const columnsInRow = row.querySelectorAll('.kanban-full-height-column');
            columnsInRow.forEach(col => {
                const colId = col.getAttribute('data-column-id');
                if (colId) {
                    desiredOrder.push(colId);
                }
            });
        });
    } else {
        // Single row layout
        const columns = boardElement.querySelectorAll('.kanban-full-height-column');
        columns.forEach(col => {
            const colId = col.getAttribute('data-column-id');
            if (colId) {
                desiredOrder.push(colId);
            }
        });
    }
    
    // Find where our dragged column should be in the final order
    const targetPosition = desiredOrder.indexOf(columnId);
    
    
    return targetPosition >= 0 ? targetPosition : 0;
}