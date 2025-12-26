/**
 * Include Mode Manager
 *
 * Manages include mode operations for columns and tasks.
 * Handles enabling, disabling, editing, and toggling include mode.
 *
 * Extracted from menuOperations.js for better code organization.
 *
 * Dependencies:
 * - vscode API (postMessage)
 * - window.menuUtils (findColumnInBoard, findTaskInBoard, addIncludeSyntax, etc.)
 * - closeAllMenus() from menuOperations.js
 * - updateRefreshButtonState() from webview.js
 */

// ============================================================================
// COLUMN INCLUDE MODE
// ============================================================================

/**
 * Toggle include mode for a column
 * @param {string} columnId - Column ID
 */
function toggleColumnIncludeMode(columnId) {
    if (typeof window.closeAllMenus === 'function') {
        window.closeAllMenus();
    }

    const found = window.menuUtils.findColumnInBoard(columnId);
    if (!found) {
        console.error('Column not found:', columnId);
        return;
    }

    if (found.column.includeMode) {
        vscode.postMessage({
            type: 'confirmDisableIncludeMode',
            columnId: columnId,
            message: 'Disable include mode? This will convert all included slides to regular cards. The original presentation file will not be modified.'
        });
    } else {
        vscode.postMessage({ type: 'requestIncludeFileName', columnId });
    }
}

/**
 * Enable include mode for a column
 * Called from backend after user provides include file name
 * @param {string} columnId - Column ID
 * @param {string} fileName - Include file name
 */
function enableColumnIncludeMode(columnId, fileName) {
    const found = window.menuUtils.findColumnInBoard(columnId);
    if (!found) {
        console.error('Column not found:', columnId);
        return;
    }

    const newTitle = window.menuUtils.addIncludeSyntax(found.column.title, fileName);
    window.menuUtils.postEditMessage('column', columnId, null, newTitle);
    if (typeof window.updateRefreshButtonState === 'function') {
        window.updateRefreshButtonState('unsaved', 1);
    }
}

/**
 * Edit column include file
 * @param {string} columnId - Column ID
 */
function editColumnIncludeFile(columnId) {
    if (typeof window.closeAllMenus === 'function') {
        window.closeAllMenus();
    }

    const found = window.menuUtils.findColumnInBoard(columnId);
    if (!found) {
        console.error('Column not found:', columnId);
        return;
    }

    const currentFile = window.menuUtils.getIncludeFile(found.column);
    if (!currentFile) {
        vscode.postMessage({ type: 'showMessage', text: 'This column is not in include mode or has no include files.' });
        return;
    }

    vscode.postMessage({ type: 'requestEditIncludeFileName', columnId, currentFile });
}

/**
 * Update column include file
 * Called from backend after user provides edited include file name
 * @param {string} columnId - Column ID
 * @param {string} newFileName - New file name
 * @param {string} currentFile - Current file name
 */
function updateColumnIncludeFile(columnId, newFileName, currentFile) {
    const found = window.menuUtils.findColumnInBoard(columnId);
    if (!found) {
        console.error('[updateColumnIncludeFile] Column not found:', columnId);
        return;
    }

    if (newFileName?.trim() && newFileName.trim() !== currentFile) {
        const newTitle = window.menuUtils.updateIncludeInTitle(found.column.title, newFileName);
        window.menuUtils.postEditMessage('column', columnId, null, newTitle);
        if (typeof window.updateRefreshButtonState === 'function') {
            window.updateRefreshButtonState('unsaved', 1);
        }
    }
}

/**
 * Disable include mode for a column
 * Called from backend after user confirms disable include mode
 * @param {string} columnId - Column ID
 */
function disableColumnIncludeMode(columnId) {
    const found = window.menuUtils.findColumnInBoard(columnId);
    if (!found) {
        console.error('Column not found:', columnId);
        return;
    }

    let cleanTitle = window.menuUtils.removeIncludeSyntax(found.column.title);

    // If no clean title remains, use the filename
    if (!cleanTitle && found.column.includeFiles?.length > 0) {
        cleanTitle = found.column.includeFiles[0].split('/').pop().replace(/\.[^/.]+$/, '');
    }

    window.menuUtils.postEditMessage('column', columnId, null, cleanTitle || 'Untitled Column');
    if (typeof window.updateRefreshButtonState === 'function') {
        window.updateRefreshButtonState('unsaved', 1);
    }
    vscode.postMessage({ type: 'showMessage', text: 'Include mode disabled. Tasks converted to regular cards.' });
}

// ============================================================================
// TASK INCLUDE MODE
// ============================================================================

/**
 * Enable include mode for a task
 * @param {string} taskId - Task ID
 * @param {string} columnId - Column ID
 * @param {string} fileName - Include file name
 */
function enableTaskIncludeMode(taskId, columnId, fileName) {
    const found = window.menuUtils.findTaskInBoard(taskId, columnId);
    if (!found) {
        console.error('Task not found:', taskId);
        return;
    }

    const newTitle = window.menuUtils.addIncludeSyntax(found.task.title, fileName);
    window.menuUtils.postEditMessage('task', taskId, found.column.id, newTitle);
    if (typeof window.updateRefreshButtonState === 'function') {
        window.updateRefreshButtonState('unsaved', 1);
    }
}

/**
 * Edit task include file
 * @param {string} taskId - Task ID
 * @param {string} columnId - Column ID
 */
function editTaskIncludeFile(taskId, columnId) {
    if (typeof window.closeAllMenus === 'function') {
        window.closeAllMenus();
    }

    const found = window.menuUtils.findTaskInBoard(taskId, columnId);
    if (!found) {
        console.error('Task not found:', taskId);
        return;
    }

    const currentFile = window.menuUtils.getIncludeFile(found.task);
    if (!currentFile) {
        vscode.postMessage({ type: 'showMessage', text: 'This task is not in include mode or has no include files.' });
        return;
    }

    vscode.postMessage({ type: 'requestEditTaskIncludeFileName', taskId, columnId: found.column.id, currentFile });
}

/**
 * Update task include file
 * Called from backend after user provides new include file name
 * @param {string} taskId - Task ID
 * @param {string} columnId - Column ID
 * @param {string} newFileName - New file name
 * @param {string} currentFile - Current file name
 */
function updateTaskIncludeFile(taskId, columnId, newFileName, currentFile) {
    const found = window.menuUtils.findTaskInBoard(taskId, columnId);
    if (!found) {
        console.error('[updateTaskIncludeFile] Task not found:', taskId);
        return;
    }

    if (newFileName?.trim() && newFileName.trim() !== currentFile) {
        const newTitle = window.menuUtils.updateIncludeInTitle(found.task.title, newFileName);
        window.menuUtils.postEditMessage('task', taskId, found.column.id, newTitle);
        if (typeof window.updateRefreshButtonState === 'function') {
            window.updateRefreshButtonState('unsaved', 1);
        }
    }
}

/**
 * Disable include mode for a task
 * @param {string} taskId - Task ID
 * @param {string} columnId - Column ID
 */
function disableTaskIncludeMode(taskId, columnId) {
    if (typeof window.closeAllMenus === 'function') {
        window.closeAllMenus();
    }

    const found = window.menuUtils.findTaskInBoard(taskId, columnId);
    if (!found) {
        console.error('Task not found:', taskId);
        return;
    }

    const cleanTitle = window.menuUtils.removeIncludeSyntax(found.task.title);
    window.menuUtils.postEditMessage('task', taskId, found.column.id, cleanTitle);
    if (typeof window.updateRefreshButtonState === 'function') {
        window.updateRefreshButtonState('unsaved', 1);
    }
    vscode.postMessage({ type: 'showMessage', text: 'Task include mode disabled. Content converted to regular description.' });
}

/**
 * Toggle include mode for a task
 * @param {string} taskId - Task ID
 * @param {string} columnId - Column ID
 */
function toggleTaskIncludeMode(taskId, columnId) {
    const found = window.menuUtils.findTaskInBoard(taskId, columnId);
    if (!found) {
        console.error('Task not found:', taskId);
        return;
    }

    if (found.task.includeMode) {
        disableTaskIncludeMode(taskId, found.column.id);
    } else {
        vscode.postMessage({ type: 'requestTaskIncludeFileName', taskId, columnId: found.column.id });
    }
}

// ============================================================================
// WINDOW EXPORTS
// ============================================================================

// Column include mode
window.toggleColumnIncludeMode = toggleColumnIncludeMode;
window.enableColumnIncludeMode = enableColumnIncludeMode;
window.editColumnIncludeFile = editColumnIncludeFile;
window.updateColumnIncludeFile = updateColumnIncludeFile;
window.disableColumnIncludeMode = disableColumnIncludeMode;

// Task include mode
window.enableTaskIncludeMode = enableTaskIncludeMode;
window.editTaskIncludeFile = editTaskIncludeFile;
window.updateTaskIncludeFile = updateTaskIncludeFile;
window.disableTaskIncludeMode = disableTaskIncludeMode;
window.toggleTaskIncludeMode = toggleTaskIncludeMode;
