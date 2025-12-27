/**
 * Menu Utilities
 * Shared utilities for menu operations to reduce code duplication
 */

/**
 * Throttle execution to prevent duplicate calls
 * @param {string} key - Unique key for this operation
 * @param {number} throttleMs - Minimum time between executions (default 500ms)
 * @returns {boolean} - true if execution should proceed, false if throttled
 */
function shouldExecute(key, throttleMs = 500) {
    const now = Date.now();
    if (!window._lastTagExecution) {
        window._lastTagExecution = {};
    }
    if (window._lastTagExecution[key] && now - window._lastTagExecution[key] < throttleMs) {
        return false;
    }
    window._lastTagExecution[key] = now;
    return true;
}

/**
 * Find a column in the board data
 * @param {string} columnId - Column ID to find
 * @returns {{board: object, column: object}|null} - Found board and column, or null
 */
function findColumnInBoard(columnId) {
    let board = null;
    let column = null;

    // Try cachedBoard first (most current)
    if (window.cachedBoard?.columns) {
        column = window.cachedBoard.columns.find(c => c.id === columnId);
        if (column) {
            board = window.cachedBoard;
        }
    }

    // Fallback to currentBoard if not found
    if (!column && window.currentBoard?.columns) {
        column = window.currentBoard.columns.find(c => c.id === columnId);
        if (column) {
            board = window.currentBoard;
        }
    }

    return column ? { board, column } : null;
}

/**
 * Find a task in the board data
 * @param {string} taskId - Task ID to find
 * @param {string} columnId - Expected column ID (optional, will search all if not found)
 * @returns {{board: object, column: object, task: object}|null} - Found elements, or null
 */
function findTaskInBoard(taskId, columnId = null) {
    let board = null;
    let column = null;
    let task = null;

    // Helper to search for task in a board
    function searchBoard(boardData) {
        if (!boardData?.columns) return null;

        // Try expected column first
        if (columnId) {
            const col = boardData.columns.find(c => c.id === columnId);
            const t = col?.tasks?.find(t => t.id === taskId);
            if (t) return { board: boardData, column: col, task: t };
        }

        // Search all columns
        for (const col of boardData.columns) {
            const t = col.tasks?.find(t => t.id === taskId);
            if (t) return { board: boardData, column: col, task: t };
        }
        return null;
    }

    // Try cachedBoard first
    let result = searchBoard(window.cachedBoard);
    if (result) return result;

    // Fallback to currentBoard
    result = searchBoard(window.currentBoard);
    return result;
}

/**
 * Build a regex pattern for matching a tag in text
 * @param {string} tagName - Tag name without # prefix
 * @returns {{pattern: string, regex: RegExp}} - Pattern string and compiled regex
 */
function buildTagPattern(tagName) {
    // Escape special regex characters
    const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // For special character tags (++, +, ø, -, --), use (?=\s|$) instead of \b
    // Word boundary \b doesn't work with non-word characters
    const isSpecialTag = /^[\+\-øØ]+$/.test(tagName);
    const pattern = isSpecialTag
        ? `#${escapedTagName}(?=\\s|$)`
        : `#${escapedTagName}\\b`;

    return {
        pattern,
        regex: new RegExp(pattern, 'gi')
    };
}

/**
 * Toggle a tag in a title string
 * @param {string} title - Current title
 * @param {string} tagName - Tag name without # prefix
 * @param {boolean} preserveRowTag - Whether to preserve #rowN tags at end (for columns)
 * @returns {{newTitle: string, wasActive: boolean}} - New title and whether tag was active
 */
function toggleTagInTitle(title, tagName, preserveRowTag = false) {
    const { pattern, regex } = buildTagPattern(tagName);
    const wasActive = regex.test(title);
    const tagWithHash = `#${tagName}`;

    let newTitle;
    if (wasActive) {
        // Remove tag
        newTitle = title.replace(new RegExp(pattern, 'gi'), '').replace(/\s+/g, ' ').trim();
    } else {
        // Add tag
        if (preserveRowTag) {
            // For columns, insert before #rowN tag if present
            const rowMatch = title.match(/(#row\d+)$/i);
            if (rowMatch) {
                const beforeRow = title.substring(0, title.length - rowMatch[0].length).trim();
                newTitle = `${beforeRow} ${tagWithHash} ${rowMatch[0]}`;
            } else {
                newTitle = `${title} ${tagWithHash}`.trim();
            }
        } else {
            newTitle = `${title} ${tagWithHash}`.trim();
        }
    }

    return { newTitle, wasActive };
}

/**
 * Sync title change across all board references
 * @param {string} elementType - 'column' or 'task'
 * @param {string} elementId - Column or task ID
 * @param {string} columnId - Column ID (for tasks)
 * @param {string} newTitle - New title to set
 */
function syncTitleToBoards(elementType, elementId, columnId, newTitle) {
    const boards = [window.cachedBoard, window.currentBoard].filter(b => b?.columns);

    for (const board of boards) {
        if (elementType === 'column') {
            const column = board.columns.find(c => c.id === elementId);
            if (column) column.title = newTitle;
        } else {
            // Task
            const column = board.columns.find(c => c.id === columnId);
            const task = column?.tasks?.find(t => t.id === elementId);
            if (task) task.title = newTitle;
        }
    }
}

/**
 * Update temporal attributes on an element
 * @param {HTMLElement} element - DOM element to update
 * @param {string} text - Text to check for temporal tags
 * @param {string} elementType - 'column' or 'task'
 * @param {object} context - Additional context for hierarchical gating (task only)
 */
function updateTemporalAttributes(element, text, elementType, context = {}) {
    if (!window.tagUtils) return;

    // Remove all temporal attributes first
    element.removeAttribute('data-current-day');
    element.removeAttribute('data-current-week');
    element.removeAttribute('data-current-weekday');
    element.removeAttribute('data-current-hour');
    element.removeAttribute('data-current-time');

    if (elementType === 'column') {
        // Simple check for columns
        if (window.tagUtils.isCurrentDate(text)) element.setAttribute('data-current-day', 'true');
        if (window.tagUtils.isCurrentWeek(text)) element.setAttribute('data-current-week', 'true');
        if (window.tagUtils.isCurrentWeekday(text)) element.setAttribute('data-current-weekday', 'true');
        if (window.tagUtils.isCurrentTime(text)) element.setAttribute('data-current-hour', 'true');
        if (window.tagUtils.isCurrentTimeSlot(text)) element.setAttribute('data-current-time', 'true');
    } else if (elementType === 'task' && window.getActiveTemporalAttributes) {
        // Hierarchical gating for tasks
        const { columnTitle = '', taskDescription = '' } = context;
        const activeAttrs = window.getActiveTemporalAttributes(columnTitle, text, taskDescription);
        for (const [attr, isActive] of Object.entries(activeAttrs)) {
            if (isActive) element.setAttribute(attr, 'true');
        }
    }
}

/**
 * Update tag-related data attributes on an element
 * @param {HTMLElement} element - DOM element to update
 * @param {string} newTitle - New title with tags
 * @param {string} elementType - 'column' or 'task'
 */
function updateTagDataAttributes(element, newTitle, elementType) {
    const attrPrefix = elementType === 'column' ? 'data-column-tag' : 'data-task-tag';

    // Update first tag attribute
    const firstTag = window.extractFirstTag ? window.extractFirstTag(newTitle) : null;
    if (firstTag) {
        element.setAttribute(attrPrefix, firstTag);
    } else {
        element.removeAttribute(attrPrefix);
    }

    // Update all tags attribute
    const allTags = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(newTitle) : [];
    if (allTags.length > 0) {
        element.setAttribute('data-all-tags', allTags.join(' '));
    } else {
        element.removeAttribute('data-all-tags');
    }

    return allTags;
}

/**
 * Update tag chip button state
 * @param {string} elementId - Element ID (column or task)
 * @param {string} tagName - Tag name
 * @param {boolean} isActive - Whether tag is active
 */
function updateTagChipButton(elementId, tagName, isActive) {
    const button = document.querySelector(`.donut-menu-tag-chip[data-element-id="${elementId}"][data-tag-name="${tagName}"]`);
    if (button) {
        button.classList.toggle('active', isActive);
        const checkbox = button.querySelector('.tag-chip-check');
        if (checkbox) {
            checkbox.textContent = isActive ? '✓' : '';
        }
        if (typeof updateTagChipStyle === 'function') {
            updateTagChipStyle(button, tagName, isActive);
        }
    }
}

/**
 * Apply visual flash effect to show tag was applied
 * @param {HTMLElement} element - Element to flash
 * @param {boolean} isActive - Whether tag was activated (only flash on activation)
 */
function applyTagFlash(element, isActive) {
    if (isActive && element) {
        element.classList.add('tag-applied-flash');
        setTimeout(() => {
            if (element?.classList) {
                element.classList.remove('tag-applied-flash');
            }
        }, 300);
    }
}

// ============================================================================
// Include Mode Utilities
// ============================================================================

const INCLUDE_PATTERN = /!!!include\([^)]+\)!!!/g;

/**
 * Add include syntax to a title
 * @param {string} title - Current title
 * @param {string} fileName - File name to include
 * @returns {string} - Title with include syntax
 */
function addIncludeSyntax(title, fileName) {
    return `${title || ''} !!!include(${fileName.trim()})!!!`.trim();
}

/**
 * Remove include syntax from a title
 * @param {string} title - Current title with include syntax
 * @returns {string} - Clean title without include syntax
 */
function removeIncludeSyntax(title) {
    return (title || '').replace(INCLUDE_PATTERN, '').trim();
}

/**
 * Update include file in title (replace old include with new)
 * @param {string} title - Current title with include syntax
 * @param {string} newFileName - New file name
 * @returns {string} - Title with updated include syntax
 */
function updateIncludeInTitle(title, newFileName) {
    const cleanTitle = removeIncludeSyntax(title);
    return addIncludeSyntax(cleanTitle, newFileName);
}

/**
 * Check if element has include mode enabled
 * @param {object} element - Column or task object
 * @returns {boolean} - Whether include mode is enabled
 */
function hasIncludeMode(element) {
    return element?.includeMode && element?.includeFiles?.length > 0;
}

/**
 * Get current include file from element
 * @param {object} element - Column or task object
 * @returns {string|null} - Current include file or null
 */
function getIncludeFile(element) {
    return hasIncludeMode(element) ? element.includeFiles[0] : null;
}

/**
 * Post edit message to VS Code
 * @param {string} elementType - 'column' or 'task'
 * @param {string} elementId - Column or task ID
 * @param {string} columnId - Column ID (for tasks)
 * @param {string} newTitle - New title to set
 */
function postEditMessage(elementType, elementId, columnId, newTitle) {
    if (elementType === 'column') {
        vscode.postMessage({
            type: 'editColumnTitle',
            columnId: elementId,
            title: newTitle
        });
    } else {
        vscode.postMessage({
            type: 'editTask',
            taskId: elementId,
            columnId: columnId,
            taskData: { title: newTitle }
        });
    }
}

/**
 * Unified dropdown positioning function
 * Positions a dropdown menu relative to a trigger button, handling viewport boundaries
 *
 * @param {HTMLElement} triggerButton - The button that triggers the dropdown
 * @param {HTMLElement} dropdown - The dropdown element to position
 * @param {Object} options - Positioning options
 * @param {boolean} options.moveToBody - Move dropdown to body to escape stacking contexts (default: false)
 * @param {number} options.offsetY - Vertical offset from trigger (default: 5)
 * @param {number} options.margin - Minimum margin from viewport edges (default: 10)
 * @param {number} options.defaultWidth - Fallback width if measurement fails (default: 180)
 * @param {number} options.defaultHeight - Fallback height if measurement fails (default: 200)
 * @param {string} options.zIndex - Z-index for dropdown (default: '2147483640')
 */
function positionDropdownMenu(triggerButton, dropdown, options = {}) {
    const {
        moveToBody = false,
        offsetY = 5,
        margin = 10,
        defaultWidth = 180,
        defaultHeight = 200,
        zIndex = '2147483640'
    } = options;

    const rect = triggerButton.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Move dropdown to body if needed to escape stacking contexts
    if (moveToBody && dropdown.parentElement !== document.body) {
        dropdown._originalParent = dropdown.parentElement;
        dropdown._originalNextSibling = dropdown.nextSibling;
        document.body.appendChild(dropdown);
        dropdown.classList.add('moved-to-body');
    }

    // Set positioning styles
    dropdown.style.position = 'fixed';
    dropdown.style.zIndex = zIndex;

    // Get actual dropdown dimensions by temporarily showing it
    const originalDisplay = dropdown.style.display;
    const originalVisibility = dropdown.style.visibility;
    dropdown.style.visibility = 'hidden';
    dropdown.style.display = 'block';

    const dropdownRect = dropdown.getBoundingClientRect();
    const dropdownWidth = dropdownRect.width || defaultWidth;
    const dropdownHeight = dropdownRect.height || defaultHeight;

    // Calculate horizontal position (prefer right edge aligned with trigger)
    let left = rect.right - dropdownWidth;

    // Check horizontal boundaries
    if (left < margin) { left = margin; }
    if (left + dropdownWidth > viewportWidth - margin) {
        left = viewportWidth - dropdownWidth - margin;
    }

    // Calculate vertical position (prefer below trigger)
    let top = rect.bottom + offsetY;

    // If dropdown goes off bottom, position above trigger
    if (top + dropdownHeight > viewportHeight - margin) {
        top = rect.top - dropdownHeight - offsetY;
    }

    // Final vertical boundary check
    if (top < margin) { top = margin; }
    if (top + dropdownHeight > viewportHeight - margin) {
        top = viewportHeight - dropdownHeight - margin;
    }

    // Apply positioning
    dropdown.style.left = left + 'px';
    dropdown.style.top = top + 'px';

    // Restore original visibility
    dropdown.style.visibility = originalVisibility;
    dropdown.style.display = originalDisplay;
}

/**
 * Restore a dropdown that was moved to body back to its original parent
 * @param {HTMLElement} dropdown - The dropdown to restore
 */
function restoreDropdownPosition(dropdown) {
    if (dropdown._originalParent && dropdown.classList.contains('moved-to-body')) {
        if (dropdown._originalNextSibling) {
            dropdown._originalParent.insertBefore(dropdown, dropdown._originalNextSibling);
        } else {
            dropdown._originalParent.appendChild(dropdown);
        }
        dropdown.classList.remove('moved-to-body');
        dropdown._originalParent = null;
        dropdown._originalNextSibling = null;
    }
}

// Create menuUtils object
const menuUtils = {
    shouldExecute,
    findColumnInBoard,
    findTaskInBoard,
    buildTagPattern,
    toggleTagInTitle,
    syncTitleToBoards,
    updateTemporalAttributes,
    updateTagDataAttributes,
    updateTagChipButton,
    applyTagFlash,
    // Include mode utilities
    INCLUDE_PATTERN,
    addIncludeSyntax,
    removeIncludeSyntax,
    updateIncludeInTitle,
    hasIncludeMode,
    getIncludeFile,
    postEditMessage,
    // Dropdown positioning utilities
    positionDropdownMenu,
    restoreDropdownPosition
};

// Global window exposure
if (typeof window !== 'undefined') {
    window.menuUtils = menuUtils;
}
