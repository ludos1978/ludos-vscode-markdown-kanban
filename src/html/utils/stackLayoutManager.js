/**
 * Stack Layout Manager
 *
 * Handles sticky positioning and layout for vertically stacked columns.
 * Columns can be stacked using the #stack tag, and this module manages:
 * - Sticky header/footer positioning
 * - Fold mode enforcement (horizontal-only in multi-column stacks)
 * - Stack reorganization when #stack tags change
 * - Scroll-based position updates
 *
 * Extracted from boardRenderer.js for better code organization.
 */

// ============================================================================
// MODULE STATE
// ============================================================================

// Debounce timer for layout updates
let updateStackLayoutTimer = null;
let pendingStackElement = null;

// ============================================================================
// CENTRALIZED DIMENSION LOCK SYSTEM
// ============================================================================

/**
 * Active dimension locks - maps element to its original styles
 * This allows multiple systems to lock dimensions without conflict
 */
const activeDimensionLocks = new Map();

/**
 * Lock an element's dimensions to its current size.
 * Prevents layout shifts during DOM updates.
 * @param {HTMLElement} element - Element to lock
 * @returns {Object|null} Lock object for unlocking, or null if element invalid
 */
function lockElementDimensions(element) {
    if (!element) return null;

    // If already locked, return existing lock
    if (activeDimensionLocks.has(element)) {
        return activeDimensionLocks.get(element);
    }

    const rect = element.getBoundingClientRect();
    const lock = {
        element,
        originalStyles: {
            width: element.style.width,
            height: element.style.height,
            minWidth: element.style.minWidth,
            minHeight: element.style.minHeight
        },
        lockedAt: Date.now()
    };

    // Fix dimensions to current values
    element.style.width = rect.width + 'px';
    element.style.height = rect.height + 'px';
    element.style.minWidth = rect.width + 'px';
    element.style.minHeight = rect.height + 'px';

    activeDimensionLocks.set(element, lock);
    return lock;
}

/**
 * Unlock an element's dimensions, restoring original styles.
 * @param {Object|HTMLElement} lockOrElement - Lock object from lockElementDimensions, or the element itself
 */
function unlockElementDimensions(lockOrElement) {
    if (!lockOrElement) return;

    // Support both lock object and direct element reference
    const element = lockOrElement.element || lockOrElement;
    const lock = activeDimensionLocks.get(element);

    if (!lock) return;

    // Restore original styles
    element.style.width = lock.originalStyles.width;
    element.style.height = lock.originalStyles.height;
    element.style.minWidth = lock.originalStyles.minWidth;
    element.style.minHeight = lock.originalStyles.minHeight;

    activeDimensionLocks.delete(element);
}

/**
 * Lock the main kanban container's dimensions.
 * Use this before operations that might cause layout shifts.
 * @returns {Object|null} Lock object
 */
function lockContainerDimensions() {
    const container = document.getElementById('kanban-container');
    if (!container) return null;

    console.log('[DimensionLock] Locking container dimensions');
    return lockElementDimensions(container);
}

/**
 * Unlock the main kanban container's dimensions.
 */
function unlockContainerDimensions() {
    const container = document.getElementById('kanban-container');
    if (container) {
        console.log('[DimensionLock] Unlocking container dimensions');
        unlockElementDimensions(container);
    }
}

/**
 * Check if an element is currently dimension-locked.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isElementDimensionLocked(element) {
    return activeDimensionLocks.has(element);
}

// Export dimension lock functions globally
window.lockElementDimensions = lockElementDimensions;
window.unlockElementDimensions = unlockElementDimensions;
window.lockContainerDimensions = lockContainerDimensions;
window.unlockContainerDimensions = unlockContainerDimensions;
window.isElementDimensionLocked = isElementDimensionLocked;

// ============================================================================
// SCROLL ELEMENT UTILITIES
// ============================================================================

function describeScrollElement(element) {
    if (!element) return null;
    const columnId = element.getAttribute ? element.getAttribute('data-column-id') : null;
    return {
        tag: element.tagName,
        id: element.id || null,
        class: element.className || null,
        columnId
    };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a column is in a vertical stack
 * A column is in a vertical stack if it or the next column has #stack tag
 * @param {string} columnId - Column ID to check
 * @returns {boolean} True if column is in vertical stack
 */
function isInVerticalStack(columnId) {
    const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
    if (!column) return false;

    // Check if this column has #stack tag
    if (/#stack\b/i.test(column.title)) {
        return true;
    }

    // Check if next column has #stack tag
    const columnIndex = window.cachedBoard.columns.indexOf(column);
    if (columnIndex >= 0 && columnIndex < window.cachedBoard.columns.length - 1) {
        const nextColumn = window.cachedBoard.columns[columnIndex + 1];
        if (/#stack\b/i.test(nextColumn.title)) {
            return true;
        }
    }

    return false;
}

/**
 * Get the default fold mode for a column based on whether it's in a stack
 * @param {string} columnId - Column ID
 * @returns {string} 'horizontal' or 'vertical'
 */
function getDefaultFoldMode(columnId) {
    const column = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    if (!column) {
        return 'horizontal'; // Fallback
    }

    // Check if column is in a stack
    const isInStack = column.closest('.kanban-column-stack') !== null;
    let defaultFoldMode = 'vertical'; // Default for non-stacked columns

    if (isInStack) {
        const stackElement = column.closest('.kanban-column-stack');
        if (stackElement) {
            const columnsInStack = stackElement.querySelectorAll('.kanban-full-height-column').length;
            // Multiple columns in stack: horizontal folding
            // Single column in stack: vertical folding
            defaultFoldMode = columnsInStack > 1 ? 'horizontal' : 'vertical';
        } else {
            // Fallback: if no stack element found, use horizontal for safety
            defaultFoldMode = 'horizontal';
        }
    }

    return defaultFoldMode;
}

// ============================================================================
// FOLD MODE ENFORCEMENT
// ============================================================================

/**
 * Enforce horizontal folding for multi-column stacks
 * ONLY call when column structure changes (add/remove from stack, column fold/unfold)
 * @param {HTMLElement} stackElement - Specific stack to enforce, or null for all stacks
 */
function enforceFoldModesForStacks(stackElement = null) {
    const stacks = stackElement ? [stackElement] : document.querySelectorAll('.kanban-column-stack');

    stacks.forEach(stack => {
        const columns = Array.from(stack.querySelectorAll('.kanban-full-height-column'));

        // ENFORCE: Multi-column stacks ONLY allow horizontal folding
        if (columns.length > 1) {
            let convertedAny = false;
            columns.forEach(col => {
                if (col.classList.contains('collapsed-vertical')) {
                    // Convert any vertically-folded columns to horizontal
                    col.classList.remove('collapsed-vertical');
                    col.classList.add('collapsed-horizontal');
                    convertedAny = true;

                    // Update stored fold mode
                    const columnId = col.getAttribute('data-column-id');
                    if (columnId && window.columnFoldModes) {
                        window.columnFoldModes.set(columnId, 'horizontal');
                    }
                }
            });

            // If we converted any columns, the stack can no longer be all-vertical-folded
            if (convertedAny) {
                stack.classList.remove('all-vertical-folded');
            }
        }
    });
}

// ============================================================================
// HIGH-LEVEL ORCHESTRATION
// ============================================================================

/**
 * Apply stacked column styles for a specific column or all columns
 * High-level orchestrator that preserves scroll position and coordinates layout updates.
 * @param {string|null} columnId - Column ID to update its stack, or null for all stacks
 */
function applyStackedColumnStyles(columnId = null) {
    // Preserve the actual viewport scroll for both container and board before rearranging stacks
    if (typeof window.logViewMovement === 'function') {
        const stackSummary = pendingStackElement
            ? (pendingStackElement.id || pendingStackElement.getAttribute('data-column-id') || 'stack-element')
            : 'all-stacks';
        window.logViewMovement('applyStackedColumnStyles.start', {
            columnId,
            stackSummary
        });
    }
    const container = document.getElementById('kanban-container');
    const board = document.getElementById('kanban-board');
    const scrollPositions = [];
    const dimensionLocks = [];

    // Capture and fix dimensions to prevent layout shift during reflow
    const lockDimensions = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const originalStyles = {
            element,
            width: element.style.width,
            height: element.style.height,
            minWidth: element.style.minWidth,
            minHeight: element.style.minHeight
        };
        // Fix dimensions to current values
        element.style.width = rect.width + 'px';
        element.style.height = rect.height + 'px';
        element.style.minWidth = rect.width + 'px';
        element.style.minHeight = rect.height + 'px';
        return originalStyles;
    };

    const unlockDimensions = (lock) => {
        if (!lock || !lock.element) return;
        lock.element.style.width = lock.width;
        lock.element.style.height = lock.height;
        lock.element.style.minWidth = lock.minWidth;
        lock.element.style.minHeight = lock.minHeight;
    };

    // Lock dimensions before capturing scroll positions
    if (container) {
        dimensionLocks.push(lockDimensions(container));
        scrollPositions.push({
            element: container,
            left: container.scrollLeft,
            top: container.scrollTop
        });
    }
    if (board) {
        dimensionLocks.push(lockDimensions(board));
        scrollPositions.push({
            element: board,
            left: board.scrollLeft,
            top: board.scrollTop
        });
    }

    let targetStack = null;
    if (columnId) {
        // Find the specific stack containing this column
        const columnElement = document.querySelector(`[data-column-id="${columnId}"]`);
        if (columnElement) {
            targetStack = columnElement.closest('.kanban-column-stack');
        }
    }

    // Update only the target stack (or all if columnId is null)
    enforceFoldModesForStacks(targetStack);
    updateStackLayoutCore(targetStack);

    const restoreScrollAndDimensions = () => {
        // First restore scroll positions
        scrollPositions.forEach(({ element, left, top }) => {
            if (typeof window.logViewMovement === 'function') {
                window.logViewMovement('applyStackedColumnStyles.restore', {
                    element: describeScrollElement(element),
                    left,
                    top
                });
            }
            element.scrollLeft = left;
            element.scrollTop = top;
        });
        // Then unlock dimensions so layout can flow naturally
        dimensionLocks.forEach(unlockDimensions);
    };

    // Restore after the layout pass settles to avoid scroll jumps.
    requestAnimationFrame(() => requestAnimationFrame(restoreScrollAndDimensions));
}

// ============================================================================
// STACK REORGANIZATION
// ============================================================================

/**
 * Reorganize stacks around a specific column after #stack tag change
 * This is much faster than full renderBoard() as it only touches affected stacks
 * @param {string} columnId - The column whose #stack tag changed
 */
function reorganizeStacksForColumn(columnId) {
    const columnElement = document.querySelector(`[data-column-id="${columnId}"]`);
    if (!columnElement || !window.cachedBoard) return false;

    const column = window.cachedBoard.columns.find(c => c.id === columnId);
    if (!column) return false;

    const rowContainer = columnElement.closest('.kanban-row');
    if (!rowContainer) return false;

    const hasStackTag = /#stack\b/i.test(column.title);
    const currentStack = columnElement.closest('.kanban-column-stack');

    // Get columns in the same row
    const columnRow = window.getColumnRow ? window.getColumnRow(column.title) : 1;
    const columnsInRow = window.cachedBoard.columns
        .map((col, idx) => ({ col, idx }))
        .filter(({ col }) => (window.getColumnRow ? window.getColumnRow(col.title) : 1) === columnRow);

    // Find this column's position in the row
    const posInRow = columnsInRow.findIndex(({ col }) => col.id === columnId);
    const prevInRow = posInRow > 0 ? columnsInRow[posInRow - 1] : null;
    const nextInRow = posInRow < columnsInRow.length - 1 ? columnsInRow[posInRow + 1] : null;

    if (hasStackTag) {
        // ADDING #stack - merge with previous column's stack
        if (prevInRow) {
            const prevElement = document.querySelector(`[data-column-id="${prevInRow.col.id}"]`);
            if (prevElement) {
                const prevStack = prevElement.closest('.kanban-column-stack');
                if (prevStack && prevStack !== currentStack) {
                    // Move this column (and any following #stack columns) to the previous stack
                    // First, collect columns to move (this column + consecutive #stack columns after)
                    const columnsToMove = [columnElement];

                    // Check if there are more #stack columns after this one in the current stack
                    if (currentStack) {
                        const siblings = Array.from(currentStack.querySelectorAll('.kanban-full-height-column'));
                        const myIndex = siblings.indexOf(columnElement);
                        for (let i = myIndex + 1; i < siblings.length; i++) {
                            const siblingId = siblings[i].getAttribute('data-column-id');
                            const siblingCol = window.cachedBoard.columns.find(c => c.id === siblingId);
                            if (siblingCol && /#stack\b/i.test(siblingCol.title)) {
                                columnsToMove.push(siblings[i]);
                            } else {
                                break;
                            }
                        }
                    }

                    // Move columns to previous stack
                    columnsToMove.forEach(col => {
                        prevStack.appendChild(col);
                    });

                    // Clean up empty stack
                    if (currentStack && currentStack.children.length === 0) {
                        currentStack.remove();
                    }
                }
            }
        }
    } else {
        // REMOVING #stack - split from current stack
        if (currentStack) {
            const siblings = Array.from(currentStack.querySelectorAll('.kanban-full-height-column'));
            const myIndex = siblings.indexOf(columnElement);

            if (myIndex > 0) {
                // This column is not the first in the stack - need to split
                // Create new stack for this column and all following columns
                const newStack = document.createElement('div');
                newStack.className = 'kanban-column-stack';

                // Move this column and all following to the new stack
                for (let i = myIndex; i < siblings.length; i++) {
                    newStack.appendChild(siblings[i]);
                }

                // Insert new stack after the current stack
                currentStack.parentNode.insertBefore(newStack, currentStack.nextSibling);

                // Now check if the new stack needs further splitting
                // (if there are non-#stack columns after this one that should be separate)
                const newSiblings = Array.from(newStack.querySelectorAll('.kanban-full-height-column'));
                for (let i = 1; i < newSiblings.length; i++) {
                    const siblingId = newSiblings[i].getAttribute('data-column-id');
                    const siblingCol = window.cachedBoard.columns.find(c => c.id === siblingId);
                    if (siblingCol && !/#stack\b/i.test(siblingCol.title)) {
                        // This column doesn't have #stack - needs its own stack
                        // But first check if next columns have #stack (they'd stay with this one)
                        const splitStack = document.createElement('div');
                        splitStack.className = 'kanban-column-stack';

                        // Move this and remaining columns
                        while (newSiblings[i]) {
                            splitStack.appendChild(newSiblings[i]);
                            i++;
                        }
                        newStack.parentNode.insertBefore(splitStack, newStack.nextSibling);
                        break;
                    }
                }
            }
        }
    }

    // Recalculate heights for affected stacks
    const affectedStacks = new Set();
    const finalStack = columnElement.closest('.kanban-column-stack');
    if (finalStack) affectedStacks.add(finalStack);
    if (currentStack && currentStack !== finalStack) affectedStacks.add(currentStack);

    // Also get prev/next stacks
    if (prevInRow) {
        const prevEl = document.querySelector(`[data-column-id="${prevInRow.col.id}"]`);
        if (prevEl) {
            const prevStack = prevEl.closest('.kanban-column-stack');
            if (prevStack) affectedStacks.add(prevStack);
        }
    }
    if (nextInRow) {
        const nextEl = document.querySelector(`[data-column-id="${nextInRow.col.id}"]`);
        if (nextEl) {
            const nextStack = nextEl.closest('.kanban-column-stack');
            if (nextStack) affectedStacks.add(nextStack);
        }
    }

    // Recalculate only affected stacks
    affectedStacks.forEach(stack => {
        if (stack && stack.parentNode) {
            enforceFoldModesForStacks(stack);
            updateStackLayout(stack);
        }
    });

    // Update drop zones
    if (typeof window.cleanupStacksAndAddDropZones === 'function') {
        window.cleanupStacksAndAddDropZones(rowContainer);
    }

    return true;
}

// ============================================================================
// CORE LAYOUT ENGINE
// ============================================================================

/**
 * Debounced version of updateStackLayout
 * Use this for most events to prevent excessive recalculations
 * @param {HTMLElement} stackElement - Specific stack to update, or null for all stacks
 */
function updateStackLayoutDebounced(stackElement = null) {
    // Store the stack element - if null is passed, it will update all
    // If a specific stack is passed multiple times, we still only update once
    if (stackElement === null) {
        pendingStackElement = null; // null means update all
    } else if (pendingStackElement !== null) {
        // If we already have a specific stack pending and another specific stack is requested,
        // upgrade to update all
        if (pendingStackElement !== stackElement) {
            pendingStackElement = null;
        }
    } else {
        pendingStackElement = stackElement;
    }

    if (updateStackLayoutTimer) {
        clearTimeout(updateStackLayoutTimer);
    }

    updateStackLayoutTimer = setTimeout(() => {
        // Use applyStackedColumnStyles for proper scroll/dimension preservation
        // when updating all stacks, otherwise call core directly for single-stack updates
        if (pendingStackElement === null) {
            // Updating all stacks - use the high-level orchestrator
            applyStackedColumnStyles(null);
        } else {
            // Single stack update - still preserve scroll/dimensions
            const container = document.getElementById('kanban-container');
            const board = document.getElementById('kanban-board');
            const scrollPositions = [];
            const dimensionLocks = [];

            const lockDimensions = (element) => {
                if (!element) return null;
                const rect = element.getBoundingClientRect();
                return {
                    element,
                    width: element.style.width,
                    height: element.style.height,
                    minWidth: element.style.minWidth,
                    minHeight: element.style.minHeight,
                    setWidth: rect.width + 'px',
                    setHeight: rect.height + 'px'
                };
            };

            if (container) {
                const lock = lockDimensions(container);
                if (lock) {
                    container.style.width = lock.setWidth;
                    container.style.height = lock.setHeight;
                    container.style.minWidth = lock.setWidth;
                    container.style.minHeight = lock.setHeight;
                    dimensionLocks.push(lock);
                }
                scrollPositions.push({
                    element: container,
                    left: container.scrollLeft,
                    top: container.scrollTop
                });
            }
            if (board) {
                const lock = lockDimensions(board);
                if (lock) {
                    board.style.width = lock.setWidth;
                    board.style.height = lock.setHeight;
                    board.style.minWidth = lock.setWidth;
                    board.style.minHeight = lock.setHeight;
                    dimensionLocks.push(lock);
                }
                scrollPositions.push({
                    element: board,
                    left: board.scrollLeft,
                    top: board.scrollTop
                });
            }

            updateStackLayoutCore(pendingStackElement);

            // Restore after layout settles
            requestAnimationFrame(() => requestAnimationFrame(() => {
                scrollPositions.forEach(({ element, left, top }) => {
                    element.scrollLeft = left;
                    element.scrollTop = top;
                });
                dimensionLocks.forEach(lock => {
                    if (!lock || !lock.element) return;
                    lock.element.style.width = lock.width;
                    lock.element.style.height = lock.height;
                    lock.element.style.minWidth = lock.minWidth;
                    lock.element.style.minHeight = lock.minHeight;
                });
            }));
        }
        updateStackLayoutTimer = null;
        pendingStackElement = null;
    }, 150); // 150ms debounce delay
}

/**
 * Update stack layout positions (core implementation)
 * Calculates and applies sticky positioning for columns within vertical stacks.
 *
 * This is the core layout engine that:
 * 1. Measures column part heights (header, footer, content, margin)
 * 2. Calculates sticky positions based on #sticky tag and global mode
 * 3. Calculates z-indexes for proper layering
 * 4. Applies CSS styles via requestAnimationFrame for smooth updates
 *
 * @param {HTMLElement} stackElement - Specific stack to update, or null for all stacks
 */
function updateStackLayoutCore(stackElement = null) {
    const perfEnabled = false; // window.kanbanDebug?.enabled;
    const perfStart = perfEnabled ? performance.now() : 0;
    const stacks = stackElement ? [stackElement] : document.querySelectorAll('.kanban-column-stack');
    const stackCount = stackElement ? 1 : stacks.length;
    let columnCount = 0;
    let measuredColumns = 0;
    const measureStart = perfEnabled ? performance.now() : 0;

    stacks.forEach(stack => {
        const columns = Array.from(stack.querySelectorAll('.kanban-full-height-column'));
        columnCount += columns.length;

        // Check if all columns in stack are vertically folded
        const allVerticalFolded = columns.length > 0 && columns.every(col =>
            col.classList.contains('collapsed-vertical')
        );

        if (allVerticalFolded) {
            // All columns vertically folded - display horizontally
            stack.classList.add('all-vertical-folded');
            if (typeof window.updateStackBottomDropZones === 'function') {
                const stackToUpdate = stack; // Capture for closure
                requestAnimationFrame(() => window.updateStackBottomDropZones(stackToUpdate));
            }
        } else {
            // At least one column is expanded or horizontally folded - display vertically
            stack.classList.remove('all-vertical-folded');

            // OPTIMIZATION: Measure heights WITHOUT clearing styles first to prevent visual flicker
            // Instead of reset → reflow → measure → apply (causes flash)
            // We now: measure → calculate → apply in one batch (smooth)

            // Measure actual content heights
            const columnData = [];
            const measureTimings = perfEnabled ? [] : null;
            columns.forEach((col, idx) => {
                const colMeasureStart = perfEnabled ? performance.now() : 0;
                const isVerticallyFolded = col.classList.contains('collapsed-vertical');
                const isHorizontallyFolded = col.classList.contains('collapsed-horizontal');

                // Query DOM elements for measurement and style application
                const columnHeader = col.querySelector('.column-header');
                const header = col.querySelector('.column-title');
                const footer = col.querySelector('.column-footer');

                // Measure heights directly from DOM - these trigger forced reflow if DOM was modified
                const t1 = perfEnabled ? performance.now() : 0;
                const columnHeaderHeight = columnHeader ? columnHeader.offsetHeight : 0;
                const t2 = perfEnabled ? performance.now() : 0;
                const headerHeight = header ? header.offsetHeight : 0;
                const t3 = perfEnabled ? performance.now() : 0;
                const footerHeight = footer ? footer.offsetHeight : 0;
                const t4 = perfEnabled ? performance.now() : 0;

                // Measure the actual content height on column-content for accurate measurement
                const columnContent = col.querySelector('.column-content');
                const contentHeight = (isVerticallyFolded || isHorizontallyFolded) ? 0 : (columnContent ? columnContent.scrollHeight : 0);
                const t5 = perfEnabled ? performance.now() : 0;

                const footerBarsContainer = footer ? footer.querySelector('.stacked-footer-bars') : null;
                const footerBarsHeight = footerBarsContainer ? footerBarsContainer.offsetHeight : 0;
                const t6 = perfEnabled ? performance.now() : 0;

                const columnMargin = col.querySelector('.column-margin');
                const marginHeight = columnMargin ? columnMargin.offsetHeight : 4;
                const t7 = perfEnabled ? performance.now() : 0;

                if (perfEnabled && measureTimings) {
                    const colTotal = t7 - colMeasureStart;
                    // Only log if this column took >5ms (likely caused the reflow)
                    if (colTotal > 5) {
                        const colId = col.getAttribute('data-column-id') || `col-${idx}`;
                        measureTimings.push({
                            colId,
                            columnHeader: Math.round((t2 - t1) * 10) / 10,
                            header: Math.round((t3 - t2) * 10) / 10,
                            footer: Math.round((t4 - t3) * 10) / 10,
                            content: Math.round((t5 - t4) * 10) / 10,
                            footerBars: Math.round((t6 - t5) * 10) / 10,
                            margin: Math.round((t7 - t6) * 10) / 10,
                            total: Math.round(colTotal * 10) / 10
                        });
                    }
                }

                const totalHeight = columnHeaderHeight + headerHeight + footerHeight + footerBarsHeight + contentHeight;

                columnData.push({
                    col,
                    index: idx,
                    columnHeader,
                    header,
                    footer,
                    columnHeaderHeight,
                    headerHeight,
                    footerHeight,
                    contentHeight,
                    totalHeight,
                    footerBarsHeight,
                    marginHeight,
                    isVerticallyFolded,
                    isHorizontallyFolded
                });
            });
            measuredColumns += columns.length;

            // Log detailed measurement timings if any column took >5ms
            if (perfEnabled && measureTimings && measureTimings.length > 0) {
                console.log('[PERF-DEBUG] Forced reflow measurements (columns >5ms):', measureTimings);
            }

            // All columns (including both horizontally and vertically folded) are included in stacking calculations
            const expandedColumns = columnData;

            // Get current sticky stack mode (only applies to columns with #sticky tag)
            const globalStickyMode = window.currentStickyStackMode || 'titleonly';

            // Third pass: Calculate all sticky positions based on per-column sticky state and global mode
            // Note: HTML order is: margin, column-header, column-title, column-content, column-footer
            let cumulativeStickyTop = 0;
            const positions = expandedColumns.map((data, expandedIdx) => {
                // Check if this column has sticky enabled
                const isColumnSticky = data.col.getAttribute('data-column-sticky') === 'true';

                // Determine effective mode for this column:
                // - If data-column-sticky="false" (no #sticky tag) → behave like old "none" mode (nothing sticky)
                // - If data-column-sticky="true" (#sticky tag) → use global sticky stack mode (full or titleonly)
                const isFullMode = isColumnSticky && globalStickyMode === 'full';
                const isNoneMode = !isColumnSticky; // Column has no #sticky tag

                // Margin comes first in HTML
                const marginTop = cumulativeStickyTop;
                if (isFullMode) {
                    cumulativeStickyTop += data.marginHeight;
                }

                // Then column-header
                const columnHeaderTop = cumulativeStickyTop;
                if (isFullMode) {
                    cumulativeStickyTop += data.columnHeaderHeight;
                }

                // Then column-title
                const headerTop = cumulativeStickyTop;
                if (!isNoneMode) { // Both full and titleonly modes have sticky title
                    cumulativeStickyTop += data.headerHeight;
                }

                // Then column-footer
                const footerTop = cumulativeStickyTop;
                if (isFullMode) {
                    cumulativeStickyTop += data.footerHeight;
                }

                return {
                    ...data,
                    marginTop,
                    columnHeaderTop,
                    headerTop,
                    footerTop,
                    zIndex: 1000000 + (expandedColumns.length - expandedIdx),
                    isColumnSticky, // Store for bottom calculation
                    effectiveMode: isNoneMode ? 'none' : globalStickyMode
                };
            });

            // Calculate bottom positions based on per-column mode
            // Bottom to top order: footer, column-content, column-title, column-header, margin
            let cumulativeFromBottom = 0;
            for (let i = expandedColumns.length - 1; i >= 0; i--) {
                const isColumnSticky = positions[i].isColumnSticky;
                const isFullMode = isColumnSticky && globalStickyMode === 'full';
                const isNoneMode = !isColumnSticky;

                // Footer is at the bottom
                const footerBottom = cumulativeFromBottom;
                if (isFullMode) {
                    cumulativeFromBottom += positions[i].footerHeight;
                }

                // Then column-title
                const headerBottom = cumulativeFromBottom;
                if (!isNoneMode) { // Both full and titleonly modes have sticky title
                    cumulativeFromBottom += positions[i].headerHeight;
                }

                // Then column-header
                const columnHeaderBottom = cumulativeFromBottom;
                if (isFullMode) {
                    cumulativeFromBottom += positions[i].columnHeaderHeight;
                }

                // Margin is at the top (furthest from bottom)
                const marginBottom = cumulativeFromBottom;
                if (isFullMode) {
                    cumulativeFromBottom += positions[i].marginHeight;
                }

                positions[i].marginBottom = marginBottom;
                positions[i].columnHeaderBottom = columnHeaderBottom;
                positions[i].headerBottom = headerBottom;
                positions[i].footerBottom = footerBottom;
            }

            // Calculate padding
            let cumulativePadding = 0;
            positions.forEach((pos, idx) => {
                pos.contentPadding = idx > 0 ? cumulativePadding : 0;
                cumulativePadding += pos.totalHeight + pos.marginHeight;
            });

            // OPTIMIZATION: Split DOM writes and reads into separate frames to avoid forced reflow.
            // Frame 1: apply styles only. Frame 2: read layout + update derived data.
            requestAnimationFrame(() => {
                const measureEnd = perfEnabled ? performance.now() : 0;
                const measureMs = perfEnabled ? (measureEnd - measureStart) : 0;
                const applyStart = perfEnabled ? performance.now() : 0;
                // Apply all calculated positions
                positions.forEach(({ col, columnHeader, header, footer, marginTop, columnHeaderTop, headerTop, footerTop, marginBottom, columnHeaderBottom, headerBottom, footerBottom, contentPadding, zIndex, isColumnSticky }) => {
                    // Recalculate mode flags from stored values
                    const isFullMode = isColumnSticky && globalStickyMode === 'full';
                    const isNoneMode = !isColumnSticky;

                    col.dataset.columnHeaderTop = columnHeaderTop;
                    col.dataset.headerTop = headerTop;
                    col.dataset.footerTop = footerTop;
                    col.dataset.columnHeaderBottom = columnHeaderBottom;
                    col.dataset.headerBottom = headerBottom;
                    col.dataset.footerBottom = footerBottom;
                    col.dataset.zIndex = zIndex;

                    // Apply inline styles only for elements that will be sticky
                    // - isNoneMode (no #sticky): No inline styles
                    // - isFullMode (#sticky + full): Margin, header, title, footer get inline styles
                    // - Title-only (#sticky + titleonly): Only title gets inline styles

                    // Column margin: only in full mode
                    const columnMargin = col.querySelector('.column-margin');
                    if (columnMargin) {
                        if (isFullMode) {
                            columnMargin.style.top = `${marginTop}px`;
                            columnMargin.style.bottom = `${marginBottom}px`;
                            columnMargin.style.zIndex = zIndex;
                        } else {
                            columnMargin.style.top = '';
                            columnMargin.style.bottom = '';
                            columnMargin.style.zIndex = '';
                        }
                    }

                    // Column header: only in full mode
                    if (columnHeader) {
                        if (isFullMode) {
                            columnHeader.style.top = `${columnHeaderTop}px`;
                            columnHeader.style.bottom = `${columnHeaderBottom}px`;
                            columnHeader.style.zIndex = zIndex + 1;
                        } else {
                            columnHeader.style.top = '';
                            columnHeader.style.bottom = '';
                            columnHeader.style.zIndex = '';
                        }
                    }

                    // Column title: in both full and title-only modes (not in none mode)
                    if (header) {
                        if (!isNoneMode) {
                            header.style.top = `${headerTop}px`;
                            header.style.bottom = `${headerBottom}px`;
                            header.style.zIndex = zIndex;
                        } else {
                            header.style.top = '';
                            header.style.bottom = '';
                            header.style.zIndex = '';
                        }
                    }

                    // Column footer: only in full mode
                    if (footer) {
                        if (isFullMode) {
                            footer.style.top = `${footerTop}px`;
                            footer.style.bottom = `${footerBottom}px`;
                            footer.style.zIndex = zIndex;
                        } else {
                            footer.style.top = '';
                            footer.style.bottom = '';
                            footer.style.zIndex = '';
                        }
                    }

                    // Column offset: always calculated for proper spacing
                    const columnOffset = col.querySelector('.column-offset');
                    if (columnOffset) {
                        columnOffset.style.marginTop = contentPadding > 0 ? `${contentPadding}px` : '';
                    }
                });

                // Update scroll handler data with all columns (including horizontally folded)
                window.stackedColumnsData = positions.map(pos => ({
                    col: pos.col,
                    headerHeight: pos.headerHeight,
                    footerHeight: pos.footerHeight,
                    totalHeight: pos.totalHeight
                }));

                requestAnimationFrame(() => {
                    const applyMs = perfEnabled ? (performance.now() - applyStart) : 0;
                    const scrollY = window.scrollY || window.pageYOffset;

                    // Store content area boundaries (absolute positions from top of page)
                    // Content starts at bottom of header, ends at top of footer
                    positions.forEach(({ col, header, footer }) => {
                        if (!header || !footer) return;

                        const headerRect = header.getBoundingClientRect();
                        const footerRect = footer.getBoundingClientRect();

                        col.dataset.contentAreaTop = scrollY + headerRect.bottom;
                        col.dataset.contentAreaBottom = scrollY + footerRect.top;
                    });

                    // Update drop zones AFTER column positions are applied
                    if (typeof window.updateStackBottomDropZones === 'function') {
                        window.updateStackBottomDropZones(stack);
                    }

                    if (perfEnabled) {
                        const totalMs = performance.now() - perfStart;
                        if (totalMs >= 50) {
                            const stackId = stackElement
                                ? (stackElement.id || stackElement.getAttribute('data-stack-id') || 'stack-element')
                                : 'all';
                            console.log('[PERF-DEBUG] updateStackLayoutCore', {
                                scope: stackId,
                                stackCount,
                                columnCount,
                                measuredColumns,
                                measureMs: Math.round(measureMs),
                                applyMs: Math.round(applyMs),
                                totalMs: Math.round(totalMs)
                            });
                        }
                    }
                });
            }); // End requestAnimationFrame
        }
    });
}

// ============================================================================
// SCROLL HANDLER
// ============================================================================

/**
 * Setup scroll handler to keep all column headers visible at all times
 * Uses position:sticky for top, position:fixed for bottom (sticky bottom doesn't work with margin-top positioning)
 */
function setupStackedColumnScrollHandler(columnsData) {
    // Remove existing scroll handler if any
    if (window.stackedColumnScrollHandler) {
        window.removeEventListener('scroll', window.stackedColumnScrollHandler, true);
    }

    // Store columns data
    window.stackedColumnsData = columnsData;

    // Create scroll handler with FIXED positioning for bottom headers
    // Use requestAnimationFrame throttling to prevent excessive calls
    let ticking = false;

    const updateScrollPositions = () => {
        if (!window.stackedColumnsData) return;

        const scrollY = window.scrollY || window.pageYOffset;
        const viewportTop = scrollY;

        window.stackedColumnsData.forEach(({ col, headerHeight }) => {
            const header = col.querySelector('.column-title');
            const footer = col.querySelector('.column-footer');

            if (!header || !footer) return;

            const headerBottom = parseFloat(col.dataset.headerBottom || 0);
            const footerBottom = parseFloat(col.dataset.footerBottom || 0);
            const zIndex = parseInt(col.dataset.zIndex || 100);

            const rect = col.getBoundingClientRect();

            // Check if content area (between title bottom and footer top) is still within viewport
            // Use stored absolute positions from when layout was calculated
            const contentAreaBottom = parseFloat(col.dataset.contentAreaBottom || 0);
            const contentStillInView = contentAreaBottom >= viewportTop;

            if (!contentStillInView) {
                // Column is above viewport - use FIXED positioning at TOP
                const footerTop = headerHeight;

                header.style.position = 'fixed';
                header.style.top = '0px';
                header.style.bottom = '';
                header.style.left = rect.left + 'px';
                header.style.width = rect.width + 'px';
                header.style.zIndex = zIndex;

                footer.style.position = 'fixed';
                footer.style.top = `${footerTop}px`;
                footer.style.bottom = '';
                footer.style.left = rect.left + 'px';
                footer.style.width = rect.width + 'px';
                footer.style.zIndex = zIndex;
            } else {
                // Column is visible or below viewport - use STICKY at BOTTOM
                header.style.position = 'sticky';
                header.style.bottom = `${headerBottom}px`;
                header.style.top = '';
                header.style.left = '';
                header.style.right = '';
                header.style.zIndex = zIndex;

                footer.style.position = 'sticky';
                footer.style.bottom = `${footerBottom}px`;
                footer.style.top = '';
                footer.style.left = '';
                footer.style.right = '';
                footer.style.zIndex = zIndex;
            }

            // Compact-view feature disabled due to performance issues
            // See tmp/CLEANUP-2-DEFERRED-ISSUES.md #3 for replacement with IntersectionObserver
        });

        ticking = false;
    };

    const scrollHandler = () => {
        if (!ticking) {
            requestAnimationFrame(updateScrollPositions);
            ticking = true;
        }
    };

    // Store handler reference
    window.stackedColumnScrollHandler = scrollHandler;

    // Attach scroll listener
    window.addEventListener('scroll', scrollHandler, true);

    // Run once immediately
    updateScrollPositions();
}

// ============================================================================
// SCROLL/DIMENSION PRESERVATION WRAPPER
// ============================================================================

/**
 * Wrapper for immediate layout updates that preserves scroll position and dimensions
 * @param {HTMLElement} stackElement - Specific stack to update, or null for all stacks
 */
function updateStackLayoutWithPreservation(stackElement = null) {
    const container = document.getElementById('kanban-container');
    const board = document.getElementById('kanban-board');
    const scrollPositions = [];
    const dimensionLocks = [];

    const lockDimensions = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const lock = {
            element,
            width: element.style.width,
            height: element.style.height,
            minWidth: element.style.minWidth,
            minHeight: element.style.minHeight
        };
        // Fix dimensions to current values
        element.style.width = rect.width + 'px';
        element.style.height = rect.height + 'px';
        element.style.minWidth = rect.width + 'px';
        element.style.minHeight = rect.height + 'px';
        return lock;
    };

    const unlockDimensions = (lock) => {
        if (!lock || !lock.element) return;
        lock.element.style.width = lock.width;
        lock.element.style.height = lock.height;
        lock.element.style.minWidth = lock.minWidth;
        lock.element.style.minHeight = lock.minHeight;
    };

    // Lock dimensions and capture scroll positions
    if (container) {
        dimensionLocks.push(lockDimensions(container));
        scrollPositions.push({
            element: container,
            left: container.scrollLeft,
            top: container.scrollTop
        });
    }
    if (board) {
        dimensionLocks.push(lockDimensions(board));
        scrollPositions.push({
            element: board,
            left: board.scrollLeft,
            top: board.scrollTop
        });
    }

    // Run the core layout update
    updateStackLayoutCore(stackElement);

    // Restore after layout settles
    requestAnimationFrame(() => requestAnimationFrame(() => {
        scrollPositions.forEach(({ element, left, top }) => {
            element.scrollLeft = left;
            element.scrollTop = top;
        });
        dimensionLocks.forEach(unlockDimensions);
    }));
}

// ============================================================================
// WINDOW EXPORTS
// ============================================================================

// Utility functions
window.isInVerticalStack = isInVerticalStack;
window.getDefaultFoldMode = getDefaultFoldMode;

// Fold mode enforcement
window.enforceFoldModesForStacks = enforceFoldModesForStacks;

// High-level orchestration
window.applyStackedColumnStyles = applyStackedColumnStyles;

// Stack reorganization
window.reorganizeStacksForColumn = reorganizeStacksForColumn;

// Core layout engine - all exported functions now preserve scroll/dimensions
window.updateStackLayout = updateStackLayoutDebounced;
window.updateStackLayoutImmediate = updateStackLayoutWithPreservation;
window.updateStackLayoutDebounced = updateStackLayoutDebounced;

// Legacy aliases - all use preservation wrapper
window.recalculateStackHeights = updateStackLayoutDebounced;
window.recalculateStackHeightsDebounced = updateStackLayoutDebounced;
window.recalculateStackHeightsImmediate = updateStackLayoutWithPreservation;
window.recalculateAllStackHeights = () => updateStackLayoutWithPreservation(null); // null = all stacks

// Scroll handler
window.setupStackedColumnScrollHandler = setupStackedColumnScrollHandler;
