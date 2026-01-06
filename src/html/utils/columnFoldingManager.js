/**
 * Column Folding Manager
 *
 * Manages column and task collapse/expand states.
 * Handles fold buttons, state persistence, and bulk fold operations.
 *
 * Extracted from boardRenderer.js for better code organization.
 *
 * Dependencies:
 * - stackLayoutManager.js (getDefaultFoldMode, enforceFoldModesForStacks, updateStackLayout, applyStackedColumnStyles)
 * - window.cachedBoard (board data)
 * - window.collapsedColumns, window.collapsedTasks, window.columnFoldModes, window.columnFoldStates (state)
 */

// ============================================================================
// COLUMN COLLAPSE STATE CHECKING
// ============================================================================

/**
 * Check if a column element is collapsed (either vertically or horizontally)
 * @param {HTMLElement} columnElement - Column DOM element
 * @returns {boolean} True if column is collapsed in any mode
 */
function isColumnCollapsed(columnElement) {
    return columnElement && (
        columnElement.classList.contains('collapsed-vertical') ||
        columnElement.classList.contains('collapsed-horizontal')
    );
}

// ============================================================================
// GLOBAL COLUMN FOLD STATE
// ============================================================================

/**
 * Determines the global fold state of all columns
 * Purpose: Controls the fold-all/unfold-all button state
 * Used by: updateGlobalColumnFoldButton(), toggleAllColumns()
 * @returns {'fold-expanded'|'fold-collapsed'|'fold-mixed'} Current global state
 */
function getGlobalColumnFoldState() {
    if (!window.cachedBoard || !window.cachedBoard.columns || window.cachedBoard.columns.length === 0) {
        return 'fold-mixed';
    }

    // Count columns with tasks that are collapsed
    const columnsWithTasks = window.cachedBoard.columns.filter(column => column.tasks && column.tasks.length > 0);
    const emptyColumns = window.cachedBoard.columns.filter(column => !column.tasks || column.tasks.length === 0);

    if (columnsWithTasks.length === 0) {
        // All columns are empty - consider them as all folded
        return 'fold-collapsed';
    }

    const collapsedWithTasks = columnsWithTasks.filter(column => window.collapsedColumns.has(column.id)).length;
    const collapsedEmpty = emptyColumns.filter(column => window.collapsedColumns.has(column.id)).length;

    // If all columns with tasks are expanded and all empty columns are collapsed
    if (collapsedWithTasks === 0 && collapsedEmpty === emptyColumns.length) {
        return 'fold-expanded'; // This is the "expanded" state
    } else if (collapsedWithTasks === columnsWithTasks.length) {
        // All columns with tasks are collapsed
        return 'fold-collapsed';
    } else {
        // Mixed state - return last manual state or default
        return window.globalColumnFoldState || 'fold-mixed';
    }
}

/**
 * Updates the global fold button appearance based on column states
 * Purpose: Visual feedback for current fold state
 * Used by: After any column fold/unfold operation
 * Updates: Button text, title, and data-state attribute
 */
function updateGlobalColumnFoldButton() {
    const globalFoldButton = document.getElementById('global-fold-btn');
    const globalFoldIcon = document.getElementById('global-fold-icon');

    if (!globalFoldButton || !globalFoldIcon) {return;}

    // Remove all state classes
    globalFoldButton.classList.remove('fold-collapsed', 'fold-expanded', 'fold-mixed');

    // Get current state
    const currentState = getGlobalColumnFoldState();
    globalFoldButton.classList.add(currentState);

    // Update icon and title
    if (currentState === 'fold-collapsed') {
        globalFoldIcon.textContent = '▶';
        globalFoldButton.title = 'Expand all columns';
    } else if (currentState === 'fold-expanded') {
        globalFoldIcon.textContent = '▼';
        globalFoldButton.title = 'Collapse all columns';
    } else {
        globalFoldIcon.textContent = '▽';
        globalFoldButton.title = 'Fold/unfold all columns';
    }
}

// ============================================================================
// DEFAULT FOLDING STATE
// ============================================================================

/**
 * Applies the default folding state for all columns
 * Purpose: Empty columns collapsed, non-empty columns expanded (default state)
 * Used by: applyFoldingStates(), toggleAllColumns() when expanding
 * Side effects: Updates collapsedColumns set and DOM elements
 */
function applyDefaultFoldingState() {
    if (!window.cachedBoard || !window.cachedBoard.columns || window.cachedBoard.columns.length === 0) {return;}

    // Ensure folding state variables are initialized
    if (!window.collapsedColumns) {window.collapsedColumns = new Set();}
    if (!window.columnFoldModes) {window.columnFoldModes = new Map();}

    window.cachedBoard.columns.forEach(column => {
        const hasNoTasks = !column.tasks || column.tasks.length === 0;
        const columnElement = document.querySelector(`[data-column-id="${column.id}"]`);
        const toggle = columnElement?.querySelector('.collapse-toggle');

        if (hasNoTasks) {
            // Empty columns should be collapsed by default
            window.collapsedColumns.add(column.id);
            const foldMode = window.getDefaultFoldMode(column.id);
            window.columnFoldModes.set(column.id, foldMode);
            if (foldMode === 'vertical') {
                columnElement?.classList.add('collapsed-vertical');
            } else {
                columnElement?.classList.add('collapsed-horizontal');
            }
            toggle?.classList.add('rotated');
        } else {
            // Non-empty columns should be expanded by default
            window.collapsedColumns.delete(column.id);
            window.columnFoldModes.delete(column.id);
            columnElement?.classList.remove('collapsed-vertical', 'collapsed-horizontal');
            toggle?.classList.remove('rotated');
        }
    });

    // Set the global fold state to expanded (the default state)
    window.globalColumnFoldState = 'fold-expanded';

    // Recalculate heights after applying default folding
    // Use requestAnimationFrame to ensure DOM has finished updating all column states
    requestAnimationFrame(() => {
        if (typeof window.enforceFoldModesForStacks === 'function') {
            window.enforceFoldModesForStacks();
        }
        if (typeof window.updateStackLayoutImmediate === 'function') {
            window.updateStackLayoutImmediate();
        }
    });
}

/**
 * Sets the default folding state for all columns (data only)
 * Purpose: Apply default logic without DOM changes (for initialization)
 * Used by: applyFoldingStates() when detecting fresh load
 * Side effects: Updates collapsedColumns set based on column content
 */
function setDefaultFoldingState() {
    if (!window.cachedBoard || !window.cachedBoard.columns || window.cachedBoard.columns.length === 0) {return;}

    // Ensure folding state variables are initialized
    if (!window.collapsedColumns) {window.collapsedColumns = new Set();}

    window.cachedBoard.columns.forEach(column => {
        const hasNoTasks = !column.tasks || column.tasks.length === 0;

        if (hasNoTasks) {
            // Empty columns should be collapsed by default
            window.collapsedColumns.add(column.id);
        } else {
            // Non-empty columns should be expanded by default
            window.collapsedColumns.delete(column.id);
        }
    });

    // Set the global fold state to expanded (the default state)
    window.globalColumnFoldState = 'fold-expanded';
}

// ============================================================================
// APPLY FOLDING STATES
// ============================================================================

/**
 * Applies saved folding states to columns and tasks after render
 * Purpose: Persists fold state across board refreshes
 * Used by: renderBoard() after DOM creation
 * Side effects: Adds 'collapsed' class to previously collapsed elements
 */
function applyFoldingStates() {
    // Ensure folding state variables are initialized
    if (!window.collapsedColumns) {window.collapsedColumns = new Set();}
    if (!window.collapsedTasks) {window.collapsedTasks = new Set();}
    if (!window.columnFoldStates) {window.columnFoldStates = new Map();}

    if (!window.cachedBoard || !window.cachedBoard.columns) {
        return;
    }

    // Only reset to defaults if this is a truly fresh load (no global state at all)
    // Don't reset for "inconsistencies" as this causes unwanted unfolding when adding tasks to empty columns
    if (!window.globalColumnFoldState) {
        setDefaultFoldingState();
    }

    // Apply column folding states
    window.collapsedColumns.forEach(columnId => {
        const columnElement = document.querySelector(`[data-column-id="${columnId}"]`);
        const toggle = columnElement?.querySelector('.collapse-toggle');

        if (columnElement) {
            // Get fold mode from map, or use default based on stack status
            const foldMode = window.columnFoldModes?.get(columnId) || window.getDefaultFoldMode(columnId);
            if (foldMode === 'vertical') {
                columnElement.classList.add('collapsed-vertical');
            } else {
                columnElement.classList.add('collapsed-horizontal');
            }
            if (toggle) {toggle.classList.add('rotated');}
        }
    });

    // Apply task folding states
    window.collapsedTasks.forEach(taskId => {
        const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
        const toggle = taskElement?.querySelector('.task-collapse-toggle');

        if (taskElement) {
            taskElement.classList.add('collapsed');
            if (toggle) {toggle.classList.add('rotated');}
        }
    });

    // Update fold all buttons for each column
    if (window.cachedBoard && window.cachedBoard.columns) {
        window.cachedBoard.columns.forEach(column => {
            updateFoldAllButton(column.id);
        });
    }

    // Update global fold button
    updateGlobalColumnFoldButton();
}

// ============================================================================
// TOGGLE ALL COLUMNS
// ============================================================================

/**
 * Toggles all columns between collapsed and expanded states
 * Purpose: Bulk fold/unfold operation for all columns
 * Used by: Global fold button in board header
 * Side effects: Updates collapsedColumns set, re-renders board
 */
function toggleAllColumns() {
    if (!window.cachedBoard || !window.cachedBoard.columns || window.cachedBoard.columns.length === 0) {return;}

    // Ensure state variables are initialized
    if (!window.collapsedColumns) {window.collapsedColumns = new Set();}

    const currentState = getGlobalColumnFoldState();
    const collapsedCount = window.cachedBoard.columns.filter(column => window.collapsedColumns.has(column.id)).length;
    const totalColumns = window.cachedBoard.columns.length;

    // Determine action based on current state
    let shouldCollapse;
    if (collapsedCount === totalColumns) {
        // All folded -> expand all (except empty ones)
        shouldCollapse = false;
    } else if (collapsedCount === 0) {
        // All expanded -> collapse all
        shouldCollapse = true;
    } else {
        // Mixed state -> use opposite of last manual state, or default to collapse
        if (window.globalColumnFoldState === 'fold-collapsed') {
            shouldCollapse = false; // Was manually set to collapsed, so expand
        } else {
            shouldCollapse = true; // Default or was expanded, so collapse
        }
    }

    // Apply the action to all columns
    if (shouldCollapse) {
        // When collapsing, collapse all columns with their default fold mode
        if (!window.columnFoldModes) {window.columnFoldModes = new Map();}
        window.cachedBoard.columns.forEach(column => {
            const columnElement = document.querySelector(`[data-column-id="${column.id}"]`);
            const toggle = columnElement?.querySelector('.collapse-toggle');

            window.collapsedColumns.add(column.id);
            const foldMode = window.getDefaultFoldMode(column.id);
            window.columnFoldModes.set(column.id, foldMode);
            if (foldMode === 'vertical') {
                columnElement?.classList.add('collapsed-vertical');
            } else {
                columnElement?.classList.add('collapsed-horizontal');
            }
            toggle?.classList.add('rotated');
        });
    } else {
        // When expanding, apply the default folding logic (empty collapsed, non-empty expanded)
        applyDefaultFoldingState();
        return; // Early return since applyDefaultFoldingState() sets the global state
    }

    // Remember this manual state
    window.globalColumnFoldState = shouldCollapse ? 'fold-collapsed' : 'fold-expanded';

    // Update the global fold button appearance
    updateGlobalColumnFoldButton();

    // Recalculate stacked column heights after bulk fold/unfold
    // Use requestAnimationFrame to ensure DOM has finished updating all column states
    requestAnimationFrame(() => {
        if (typeof window.enforceFoldModesForStacks === 'function') {
            window.enforceFoldModesForStacks();
        }
        if (typeof window.updateStackLayoutImmediate === 'function') {
            window.updateStackLayoutImmediate();
        }
    });

    // Save state immediately
    if (window.saveCurrentFoldingState) {
        window.saveCurrentFoldingState();
    }
}

// ============================================================================
// COLUMN FOLD BUTTON STATE
// ============================================================================

/**
 * Gets the fold state of tasks within a column
 * @param {string} columnId - Column ID
 * @returns {'fold-expanded'|'fold-collapsed'|'fold-mixed'} Current fold state
 */
function getFoldAllButtonState(columnId) {
    if (!window.cachedBoard || !window.cachedBoard.columns) {return 'fold-mixed';}

    const column = window.cachedBoard.columns.find(c => c.id === columnId);
    if (!column || column.tasks.length === 0) {return 'fold-mixed';}

    const collapsedCount = column.tasks.filter(task => window.collapsedTasks.has(task.id)).length;
    const totalTasks = column.tasks.length;

    if (collapsedCount === totalTasks) {
        return 'fold-collapsed'; // All folded
    } else if (collapsedCount === 0) {
        return 'fold-expanded'; // All expanded
    } else {
        // Mixed state - use last manual state or default
        const lastState = window.columnFoldStates.get(columnId);
        return lastState || 'fold-mixed';
    }
}

/**
 * Updates the fold all button appearance for a column
 * @param {string} columnId - Column ID
 */
function updateFoldAllButton(columnId) {
    const foldButton = document.querySelector(`[data-column-id="${columnId}"] .fold-all-btn`);
    if (!foldButton) {return;}

    // Remove all state classes
    foldButton.classList.remove('fold-collapsed', 'fold-expanded', 'fold-mixed');

    // Add current state class
    const currentState = getFoldAllButtonState(columnId);
    foldButton.classList.add(currentState);

    // Update icon and title
    const icon = foldButton.querySelector('.fold-icon');
    if (icon) {
        if (currentState === 'fold-collapsed') {
            icon.textContent = '▶';
            foldButton.title = 'Expand all cards';
        } else if (currentState === 'fold-expanded') {
            icon.textContent = '▼';
            foldButton.title = 'Collapse all cards';
        } else {
            icon.textContent = '▽';
            foldButton.title = 'Fold/unfold all cards';
        }
    }
}

/**
 * Updates fold button state for a column (wrapper)
 * @param {string} columnId - Column ID
 */
function updateColumnFoldState(columnId) {
    updateFoldAllButton(columnId);
}

// ============================================================================
// TOGGLE ALL TASKS IN COLUMN
// ============================================================================

/**
 * Toggles all tasks in a column between collapsed and expanded
 * @param {string} columnId - Column ID
 */
function toggleAllTasksInColumn(columnId) {
    if (!window.cachedBoard || !window.cachedBoard.columns) {
        return;
    }

    // Ensure state variables are initialized
    if (!window.collapsedTasks) {window.collapsedTasks = new Set();}
    if (!window.columnFoldStates) {window.columnFoldStates = new Map();}

    const column = window.cachedBoard.columns.find(c => c.id === columnId);
    if (!column) {
        return;
    }

    // Get the full column element (kanban-full-height-column)
    const columnElement = document.querySelector(`[data-column-id="${columnId}"].kanban-full-height-column`);
    if (!columnElement) {
        return;
    }

    // Find the tasks container within the column structure
    const tasksContainer = columnElement.querySelector('.column-content');
    if (!tasksContainer) {
        return;
    }

    // Get all task elements currently in this column's tasks container
    const taskElements = tasksContainer.querySelectorAll('.task-item[data-task-id]');
    if (taskElements.length === 0) {
        return;
    }

    // Count collapsed tasks in this column's DOM
    let collapsedCount = 0;
    taskElements.forEach(taskElement => {
        if (taskElement.classList.contains('collapsed')) {
            collapsedCount++;
        }
    });

    const totalTasks = taskElements.length;

    // Determine action based on current state
    let shouldCollapse;
    if (collapsedCount === totalTasks) {
        // All folded -> expand all
        shouldCollapse = false;
    } else if (collapsedCount === 0) {
        // All expanded -> collapse all
        shouldCollapse = true;
    } else {
        // Mixed state -> use opposite of last manual state, or default to collapse
        const lastState = window.columnFoldStates.get(columnId);
        if (lastState === 'fold-collapsed') {
            shouldCollapse = false; // Was manually set to collapsed, so expand
        } else {
            shouldCollapse = true; // Default or was expanded, so collapse
        }
    }

    // Apply the action to all tasks using existing toggleTaskCollapse function
    // CRITICAL: Pass the task ELEMENT directly, not the ID, to avoid querySelector issues
    taskElements.forEach(taskElement => {
        const isCollapsed = taskElement.classList.contains('collapsed');

        // Only toggle if state needs to change (skip recalculation for bulk operation)
        if (shouldCollapse && !isCollapsed) {
            toggleTaskCollapse(taskElement, true); // Pass element directly!
        } else if (!shouldCollapse && isCollapsed) {
            toggleTaskCollapse(taskElement, true); // Pass element directly!
        }
    });

    // Recalculate once after all tasks are toggled (only this stack)
    if (typeof window.applyStackedColumnStyles === 'function') {
        window.applyStackedColumnStyles(columnId);
    }

    // Remember this manual state
    window.columnFoldStates.set(columnId, shouldCollapse ? 'fold-collapsed' : 'fold-expanded');

    // Update the fold button appearance
    updateFoldAllButton(columnId);

    // Save state immediately
    if (window.saveCurrentFoldingState) {
        window.saveCurrentFoldingState();
    }
}

// ============================================================================
// TOGGLE COLUMN COLLAPSE
// ============================================================================

/**
 * Toggles a column between collapsed and expanded states
 * Purpose: Show/hide column content for space management
 * Used by: Column fold button clicks
 * @param {string} columnId - ID of column to toggle
 * @param {Event} event - Click event (optional, used to detect Alt key)
 * Side effects: Updates collapsedColumns set, columnFoldModes map, DOM classes
 */
function toggleColumnCollapse(columnId, event) {
    const column = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    if (!column) {
        console.error('[kanban.toggleColumnCollapse] Column element not found', {columnId});
        return;
    }

    const toggle = column.querySelector('.collapse-toggle');
    if (!toggle) {
        console.error('[kanban.toggleColumnCollapse] Collapse toggle not found in column', {columnId});
        return;
    }

    // Ensure state variables are initialized
    if (!window.collapsedColumns) {window.collapsedColumns = new Set();}
    if (!window.columnFoldModes) {window.columnFoldModes = new Map();}

    const isCurrentlyCollapsed = column.classList.contains('collapsed-vertical') ||
                                  column.classList.contains('collapsed-horizontal');

    // Determine default fold mode based on whether column is in a multi-column stack
    // Use DOM check (same as getDefaultFoldMode) for immediate, accurate detection
    let defaultFoldMode = 'vertical'; // Default for non-stacked columns
    let forceHorizontal = false; // Flag to enforce horizontal folding in multi-column stacks

    const stackElement = column.closest('.kanban-column-stack');
    if (stackElement) {
        const columnsInStack = stackElement.querySelectorAll('.kanban-full-height-column').length;
        // Multiple columns in stack: ONLY allow horizontal folding
        if (columnsInStack > 1) {
            defaultFoldMode = 'horizontal';
            forceHorizontal = true;
        }
        // Single column in stack: vertical is allowed (defaultFoldMode stays 'vertical')
    }

    if (isCurrentlyCollapsed) {
        const currentMode = column.classList.contains('collapsed-vertical') ? 'vertical' : 'horizontal';

        if (event && event.altKey && !forceHorizontal) {
            // Alt+click while collapsed: switch fold direction (only if not forced horizontal)
            const newMode = currentMode === 'vertical' ? 'horizontal' : 'vertical';
            column.classList.remove('collapsed-vertical', 'collapsed-horizontal');
            column.classList.add(`collapsed-${newMode}`);
            window.columnFoldModes.set(columnId, newMode);
            // Stay collapsed, just rotated differently
        } else if (forceHorizontal && currentMode === 'vertical') {
            // Force conversion from vertical to horizontal if in multi-column stack
            column.classList.remove('collapsed-vertical', 'collapsed-horizontal');
            column.classList.add('collapsed-horizontal');
            window.columnFoldModes.set(columnId, 'horizontal');
            // Stay collapsed, just changed to horizontal
        } else {
            // Regular click while collapsed: unfold
            column.classList.remove('collapsed-vertical', 'collapsed-horizontal');
            toggle.classList.remove('rotated');
            window.collapsedColumns.delete(columnId);
            window.columnFoldModes.delete(columnId);
        }
    } else {
        // Currently unfolded - fold with mode based on Alt key
        let foldMode;
        if (event && event.altKey && !forceHorizontal) {
            // Alt+click while unfolded: fold to non-default mode (only if not forced horizontal)
            foldMode = defaultFoldMode === 'vertical' ? 'horizontal' : 'vertical';
        } else {
            // Regular click: fold to default mode (or forced mode)
            foldMode = defaultFoldMode;
        }

        column.classList.add(`collapsed-${foldMode}`);
        toggle.classList.add('rotated');
        window.collapsedColumns.add(columnId);
        window.columnFoldModes.set(columnId, foldMode);
    }

    // Save state immediately
    if (window.saveCurrentFoldingState) {
        window.saveCurrentFoldingState();
    }

    // Update global fold button after individual column toggle
    setTimeout(() => {
        updateGlobalColumnFoldButton();
        // Re-apply user's fixed height setting after column state change (if not auto)
        if (window.currentRowHeight && window.currentRowHeight !== 'auto') {
            window.applyRowHeight(window.currentRowHeight);
        }
        // For 'auto' mode, CSS handles the layout naturally
        // Apply stacked column styles after state change (only for this stack)
        if (typeof window.applyStackedColumnStyles === 'function') {
            window.applyStackedColumnStyles(columnId);
        }
    }, 10);
}

// ============================================================================
// TOGGLE TASK COLLAPSE
// ============================================================================

/**
 * Toggle task collapse by ID - wrapper that finds element then calls element-based version
 * CRITICAL: Scopes query to specific column to ensure correct task selection
 * Used by: onclick handlers in HTML that pass task ID and column ID
 * @param {string} taskId - Task ID to toggle
 * @param {string} columnId - Column ID containing the task (for scoping)
 */
function toggleTaskCollapseById(taskId, columnId) {
    // CRITICAL: Scope query to the specific column to ensure we get the RIGHT task
    const columnElement = document.querySelector(`[data-column-id="${columnId}"]`);
    if (!columnElement) {
        console.error(`[toggleTaskCollapseById] Column not found: ${columnId}`);
        return;
    }

    // Search for task ONLY within this column - prevents wrong task selection
    const task = columnElement.querySelector(`[data-task-id="${taskId}"]`);
    if (!task) {
        console.error(`[toggleTaskCollapseById] Task ${taskId} not found in column ${columnId}`);
        return;
    }

    // Call the element-based version
    toggleTaskCollapse(task, false);
}

/**
 * Toggle task collapse by element - direct DOM manipulation
 * CRITICAL: Only accepts DOM elements, never searches by ID or title
 * Used by: toggleAllTasksInColumn, direct element references
 * @param {HTMLElement} taskElement - The task DOM element to toggle
 * @param {boolean} skipRecalculation - Skip height recalculation for bulk operations
 */
function toggleTaskCollapse(taskElement, skipRecalculation = false) {
    if (!taskElement || !taskElement.nodeType) {
        console.error(`[toggleTaskCollapse] Invalid task element:`, taskElement);
        return;
    }

    const taskId = taskElement.getAttribute('data-task-id');
    if (!taskId) {
        console.error(`[toggleTaskCollapse] Task element missing data-task-id attribute`);
        return;
    }

    const toggle = taskElement.querySelector('.task-collapse-toggle');
    if (!toggle) {
        console.error(`[toggleTaskCollapse] Toggle button not found in task:`, taskId);
        return;
    }

    taskElement.classList.toggle('collapsed');
    toggle.classList.toggle('rotated');

    // Ensure state variables are initialized
    if (!window.collapsedTasks) {window.collapsedTasks = new Set();}

    const isNowCollapsed = taskElement.classList.contains('collapsed');

    // Store state
    if (isNowCollapsed) {
        window.collapsedTasks.add(taskId);
    } else {
        window.collapsedTasks.delete(taskId);
    }

    // Update title for tasks with no title when folding/unfolding
    const titleDisplay = taskElement.querySelector('.task-title-display');
    if (titleDisplay) {
        // Get task data from cached board - use window.findTaskById from boardRenderer
        const task = window.findTaskById ? window.findTaskById(taskId) : null;
        if (task) {
            const hasNoTitle = !task.title || !task.title.trim();

            // If task has no title and is now collapsed, show alternative title
            if (hasNoTitle && isNowCollapsed && task.description) {
                const alternativeTitle = window.generateAlternativeTitle ? window.generateAlternativeTitle(task.description) : null;
                if (alternativeTitle) {
                    const escapedTitle = window.escapeHtml ? window.escapeHtml(alternativeTitle) : alternativeTitle;
                    titleDisplay.innerHTML = `<span class="task-alternative-title">${escapedTitle}</span>`;
                }
            } else if (hasNoTitle && !isNowCollapsed) {
                // When unfolding, clear the alternative title
                titleDisplay.innerHTML = '';
            }
        }
    }

    // Recalculate stacked column heights after collapse/expand (unless skipped for bulk operations)
    if (!skipRecalculation && typeof window.applyStackedColumnStyles === 'function') {
        // Get columnId to only recalculate THIS stack, not all stacks
        const columnId = window.getColumnIdFromElement ? window.getColumnIdFromElement(taskElement) : null;
        if (columnId) {
            window.applyStackedColumnStyles(columnId);
        }
    }

    // Save state immediately
    if (window.saveCurrentFoldingState) {
        window.saveCurrentFoldingState();
    }
}

// ============================================================================
// WINDOW EXPORTS
// ============================================================================

window.isColumnCollapsed = isColumnCollapsed;
window.getGlobalColumnFoldState = getGlobalColumnFoldState;
window.updateGlobalColumnFoldButton = updateGlobalColumnFoldButton;
window.applyDefaultFoldingState = applyDefaultFoldingState;
window.setDefaultFoldingState = setDefaultFoldingState;
window.applyFoldingStates = applyFoldingStates;
window.toggleAllColumns = toggleAllColumns;
window.getFoldAllButtonState = getFoldAllButtonState;
window.updateFoldAllButton = updateFoldAllButton;
window.updateColumnFoldState = updateColumnFoldState;
window.toggleAllTasksInColumn = toggleAllTasksInColumn;
window.toggleColumnCollapse = toggleColumnCollapse;
window.toggleTaskCollapseById = toggleTaskCollapseById;
window.toggleTaskCollapse = toggleTaskCollapse;
