/**
 * Row Layout Manager
 *
 * Manages column row assignments for multi-row board layouts.
 * Handles #row1, #row2, etc. tags on columns.
 *
 * Extracted from webview.js for better code organization.
 *
 * Dependencies:
 * - window.tagUtils (for getColumnDisplayTitle)
 * - window.removeTagsForDisplay (for title rendering)
 */

// ============================================================================
// ROW DETECTION
// ============================================================================

/**
 * Detect the number of rows in a board based on column #row tags
 * @param {Object} board - Board object with columns array
 * @returns {number} Detected number of rows
 */
function detectRowsFromBoard(board) {
    if (!board || !board.columns) { return 1; }

    let maxRow = 1;
    board.columns.forEach(column => {
        if (column.title) {
            // Look for #row{number} format only (hashtag required)
            const rowMatch = column.title.match(/#row(\d+)/i);
            if (rowMatch) {
                const rowNum = parseInt(rowMatch[1]);
                if (rowNum > maxRow) {
                    maxRow = rowNum;
                }
            }
        }
    });

    return maxRow; // No cap - support unlimited rows
}

/**
 * Get column row from title
 * @param {string} title - Column title
 * @returns {number} Row number (1 if not specified)
 */
function getColumnRow(title) {
    if (!title) { return 1; }

    // More comprehensive regex to find row tags
    const rowMatches = title.match(/#row(\d+)\b/gi);
    if (rowMatches && rowMatches.length > 0) {
        // Get the last match in case there are multiple (shouldn't happen, but just in case)
        const lastMatch = rowMatches[rowMatches.length - 1];
        const rowNum = parseInt(lastMatch.replace(/#row/i, ''));
        return Math.max(rowNum, 1); // No upper limit - support unlimited rows
    }
    return 1;
}

/**
 * Sort columns by row number, maintaining original order within each row
 * Mirrors the backend sortColumnsByRow() function from columnUtils.ts
 * @param {Array} columns - Array of columns with title property
 * @returns {Array} Sorted array of columns (row 1 first, then row 2, etc.)
 */
function sortColumnsByRow(columns) {
    if (!columns || !Array.isArray(columns)) return columns;
    return columns
        .map((column, index) => ({
            column,
            index,
            row: getColumnRow(column.title)
        }))
        .sort((a, b) => {
            // First sort by row number
            if (a.row !== b.row) {
                return a.row - b.row;
            }
            // Within same row, maintain original order
            return a.index - b.index;
        })
        .map(item => item.column);
}

// ============================================================================
// ROW UPDATES
// ============================================================================

/**
 * Update column row tag
 * @param {string} columnId - Column ID
 * @param {number} newRow - New row number
 * @param {Object} options - Configuration options
 * @param {Object} options.currentBoard - Current board object
 * @param {Object} [options.cachedBoard] - Cached board object (optional)
 * @param {Function} options.postMessage - Function to send messages (vscode.postMessage)
 */
function updateColumnRowTag(columnId, newRow, options) {
    const { currentBoard, cachedBoard, postMessage } = options;

    if (!currentBoard || !currentBoard.columns) { return; }

    const column = currentBoard.columns.find(c => c.id === columnId);
    if (!column) { return; }

    // Also update cachedBoard if it exists and is different
    let cachedColumn = null;
    if (cachedBoard && cachedBoard !== currentBoard) {
        cachedColumn = cachedBoard.columns.find(c => c.id === columnId);
    }

    // Remove ALL existing row tags - more comprehensive regex patterns
    let cleanTitle = column.title
        .replace(/#row\d+\b/gi, '')  // Remove #row followed by digits
        .replace(/\s+#row\d+/gi, '')  // Remove with preceding space
        .replace(/#row\d+\s+/gi, '')  // Remove with following space
        .replace(/\s+#row\d+\s+/gi, '');  // Remove with following and preceding space

    // Update the column title
    if (newRow > 1) {
        // Add row tag for rows 2, 3, 4
        // Ensure space before #row tag if title is not empty
        column.title = cleanTitle ? cleanTitle + ` #row${newRow}` : ` #row${newRow}`;
        if (cachedColumn) {
            cachedColumn.title = cleanTitle ? cleanTitle + ` #row${newRow}` : ` #row${newRow}`;
        }
    } else {
        // For row 1, just use the clean title without any row tag
        column.title = cleanTitle;
        if (cachedColumn) {
            cachedColumn.title = cleanTitle;
        }
    }

    // Update the visual element immediately
    const columnElement = document.querySelector(`[data-column-id="${columnId}"]`)?.closest('.kanban-full-height-column');
    if (columnElement) {
        columnElement.setAttribute('data-row', newRow);

        // Update the displayed title using shared function
        const titleElement = columnElement.querySelector('.column-title-text');
        if (titleElement) {
            const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(column, window.removeTagsForDisplay) : (column.title || '');
            titleElement.innerHTML = renderedTitle;
        }

        // Update the edit textarea
        const editElement = columnElement.querySelector('.column-title-edit');
        if (editElement) {
            editElement.value = column.title;
        }
    }

    // CRITICAL: Get current column ID by POSITION from currentBoard (source of truth)
    // DOM might have stale IDs if a boardUpdate just arrived
    let currentColumnId = columnId; // Default to what we have

    // Find column's position in DOM to match with current board
    if (columnElement) {
        const allColumns = Array.from(document.querySelectorAll('.kanban-full-height-column'));
        const columnIndex = allColumns.indexOf(columnElement);

        if (columnIndex !== -1 && currentBoard?.columns?.[columnIndex]) {
            // Match by position - use current ID from board at this position
            currentColumnId = currentBoard.columns[columnIndex].id;
        }
    }

    // Send update to backend with the full title including row tag
    postMessage({
        type: 'editColumnTitle',
        columnId: currentColumnId,
        title: column.title
    });
}

/**
 * Clean up any duplicate or invalid row tags
 * @param {Object} options - Configuration options
 * @param {Object} options.currentBoard - Current board object
 * @param {Function} options.renderBoard - Function to re-render the board
 */
function cleanupRowTags(options) {
    const { currentBoard, renderBoard } = options;

    if (!currentBoard || !currentBoard.columns) { return; }

    let needsUpdate = false;

    currentBoard.columns.forEach(column => {
        const originalTitle = column.title;

        // Find all row tags
        const rowTags = column.title.match(/#row\d+\b/gi) || [];

        if (rowTags.length > 1) {
            // Remove all row tags first
            let cleanTitle = column.title;
            rowTags.forEach(tag => {
                cleanTitle = cleanTitle.replace(new RegExp(tag, 'gi'), '');
            });
            cleanTitle = cleanTitle.replace(/\s{2,}/g, ' ').trim();

            // Add back only the last tag
            const lastTag = rowTags[rowTags.length - 1];
            column.title = cleanTitle + ' ' + lastTag;

            if (column.title !== originalTitle) {
                needsUpdate = true;
            }
        }
    });

    if (needsUpdate && renderBoard) {
        // Trigger a board update if we made changes
        renderBoard();
    }
}

// ============================================================================
// WINDOW EXPORTS
// ============================================================================

window.rowLayoutManager = {
    // Detection
    detectRowsFromBoard,
    getColumnRow,
    sortColumnsByRow,

    // Updates
    updateColumnRowTag,
    cleanupRowTags
};

// Also export individual functions for backward compatibility
window.detectRowsFromBoard = detectRowsFromBoard;
window.getColumnRow = getColumnRow;
window.sortColumnsByRow = sortColumnsByRow;
