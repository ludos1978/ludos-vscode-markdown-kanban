/**
 * Image Path Manager
 *
 * Manages image and include path operations including:
 * - Path conversion (relative/absolute)
 * - Path menus for images and includes
 * - Broken image handling and placeholders
 * - File search and browse operations
 *
 * Extracted from webview.js for better code organization.
 *
 * Dependencies:
 * - vscode API (postMessage)
 * - window.cachedBoard (board data)
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Close all path-related menus (image, include, and floating menus)
 * Centralized cleanup to avoid code duplication across menu operations
 */
function closeAllPathMenus() {
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible, .image-not-found-menu.visible, .video-not-found-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });
    document.getElementById('floating-image-path-menu')?.remove();
    document.getElementById('floating-include-path-menu')?.remove();
    document.getElementById('floating-video-path-menu')?.remove();
    document.getElementById('floating-link-path-menu')?.remove();
}

// ============================================================================
// PATH CONVERSION
// ============================================================================

/**
 * Convert paths in main file to relative format
 */
function convertPathsToRelative() {
    vscode.postMessage({ type: 'convertPaths', direction: 'relative', isMainFile: true });
}

/**
 * Convert paths in main file to absolute format
 */
function convertPathsToAbsolute() {
    vscode.postMessage({ type: 'convertPaths', direction: 'absolute', isMainFile: true });
}

/**
 * Convert a single path (image or include)
 * Called from inline onclick handlers in rendered markdown
 */
function convertSinglePath(imagePath, direction, skipRefresh = false) {
    closeAllPathMenus();

    vscode.postMessage({
        type: 'convertSinglePath',
        imagePath: imagePath,
        direction: direction,
        skipRefresh: skipRefresh
    });
}

// ============================================================================
// PATH OPERATIONS
// ============================================================================

/**
 * Open a file path directly (in VS Code or default app)
 * Called from inline onclick handlers in rendered markdown
 */
function openPath(pathOrElement, taskId, columnId, isColumnTitle) {
    closeAllPathMenus();

    let filePath = pathOrElement;
    let sourceElement = null;

    if (pathOrElement && typeof pathOrElement === 'object' && pathOrElement.nodeType === 1) {
        sourceElement = pathOrElement;
        filePath = taskId;
        taskId = undefined;
        columnId = undefined;
        isColumnTitle = undefined;
    }

    if (taskId === 'undefined' || taskId === 'null' || taskId === '') {
        taskId = undefined;
    }
    if (columnId === 'undefined' || columnId === 'null' || columnId === '') {
        columnId = undefined;
    }

    if ((!taskId || !columnId) && sourceElement) {
        const container = sourceElement.closest(
            '.image-path-overlay-container, .video-path-overlay-container, .include-path-overlay-container, .image-not-found-container, .video-not-found-container, .image-path-menu, .include-path-menu, .image-not-found-menu, .video-not-found-menu'
        );
        const taskElement = container?.closest('.task-item');
        const columnElement = container?.closest('.kanban-full-height-column') || container?.closest('[data-column-id]');
        const columnTitleElement = container?.closest('.column-title');

        if (!taskId && taskElement?.dataset?.taskId) {
            taskId = taskElement.dataset.taskId;
        }
        if (!columnId && columnElement?.dataset?.columnId) {
            columnId = columnElement.dataset.columnId;
        }
        if (!isColumnTitle && !taskElement && columnTitleElement) {
            isColumnTitle = 'true';
        }
    }

    if (!taskId || !columnId) {
        const overlayRef = window.taskOverlayEditor?.getTaskRef?.();
        if (!taskId && overlayRef?.taskId) {
            taskId = overlayRef.taskId;
        }
        if (!columnId && overlayRef?.columnId) {
            columnId = overlayRef.columnId;
        }
    }

    let includeContext = null;
    if (taskId && columnId && window.cachedBoard?.columns) {
        const column = window.cachedBoard.columns.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === taskId);
        if (task?.includeContext) {
            includeContext = task.includeContext;
        }
    }
    if (!includeContext) {
        const overlayRef = window.taskOverlayEditor?.getTaskRef?.();
        if (overlayRef?.includeContext) {
            includeContext = overlayRef.includeContext;
        }
    }

    if (!filePath) {
        return;
    }

    const message = {
        type: 'openFileLink',
        href: filePath
    };
    if (taskId) message.taskId = taskId;
    if (columnId) message.columnId = columnId;
    if (includeContext) message.includeContext = includeContext;

    vscode.postMessage(message);
}

/**
 * Reveal a file path in the system file explorer (Finder on macOS, Explorer on Windows)
 * Called from inline onclick handlers in rendered markdown
 */
function revealPathInExplorer(filePath) {
    closeAllPathMenus();

    vscode.postMessage({
        type: 'revealPathInExplorer',
        filePath: filePath
    });
}

/**
 * Get a shortened display name for a file path
 * Shows filename + limited parent folder for context
 * @param {string} filePath - The full file path
 * @param {number} maxFolderChars - Maximum characters for folder portion (default 20)
 * @returns {string} Shortened display name like ".../folder/image.png"
 */
function getShortDisplayPath(filePath, maxFolderChars = 20) {
    if (!filePath) return 'unknown';

    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/');
    const parts = normalizedPath.split('/').filter(p => p);

    if (parts.length === 0) return 'unknown';

    const filename = parts[parts.length - 1];

    if (parts.length === 1) {
        return filename;
    }

    // Get parent folder
    const parentFolder = parts[parts.length - 2];

    // Truncate parent folder if too long
    let displayFolder = parentFolder;
    if (parentFolder.length > maxFolderChars) {
        displayFolder = parentFolder.substring(0, maxFolderChars - 1) + '...';
    }

    // Add ellipsis prefix if there are more parent folders
    const prefix = parts.length > 2 ? '.../' : '';

    return `${prefix}${displayFolder}/${filename}`;
}

/**
 * Search for a file by name
 * @param {string} filePath - The file path to search for
 * @param {string} [taskId] - Optional task ID for targeted update
 * @param {string} [columnId] - Optional column ID for targeted update
 * @param {string} [isColumnTitle] - 'true' if image is in column title (not a task)
 */
function searchForFile(filePath, taskId, columnId, isColumnTitle) {
    // Lock container dimensions to prevent scroll position loss during board update
    // This uses the centralized dimension lock system from stackLayoutManager.js
    if (typeof window.lockContainerDimensions === 'function') {
        window.lockContainerDimensions();
        // Store flag so boardUpdate knows to unlock after render
        window._pendingDimensionUnlock = {
            operation: 'searchForFile',
            timestamp: Date.now()
        };
        console.log('[DimensionLock] searchForFile: locked container dimensions, flag set:', window._pendingDimensionUnlock);
        // Verify the flag is accessible
        setTimeout(() => {
            console.log('[DimensionLock] searchForFile: verify flag after 100ms:', window._pendingDimensionUnlock);
        }, 100);
    } else {
        console.warn('[DimensionLock] searchForFile: lockContainerDimensions function not available!');
    }

    closeAllPathMenus();

    if (taskId === 'undefined' || taskId === 'null' || taskId === '') {
        taskId = undefined;
    }
    if (columnId === 'undefined' || columnId === 'null' || columnId === '') {
        columnId = undefined;
    }
    if (!taskId || !columnId) {
        const overlayRef = window.taskOverlayEditor?.getTaskRef?.();
        if (!taskId && overlayRef?.taskId) {
            taskId = overlayRef.taskId;
        }
        if (!columnId && overlayRef?.columnId) {
            columnId = overlayRef.columnId;
        }
    }

    const message = {
        type: 'searchForFile',
        filePath: filePath
    };
    if (taskId) message.taskId = taskId;
    if (columnId) message.columnId = columnId;
    if (isColumnTitle === 'true') message.isColumnTitle = true;

    vscode.postMessage(message);
}

/**
 * Search for an include file (column or task include)
 * Wrapper that extracts DOM context and calls searchForFile
 * @param {HTMLElement} buttonElement - The button element that was clicked
 * @param {string} filePath - The file path to search for
 * @param {string} isColumnTitle - 'true' if this is a column include, 'false' for task include
 */
function searchForIncludeFile(buttonElement, filePath, isColumnTitle) {
    // Extract columnId from closest column element
    const columnEl = buttonElement.closest('.kanban-full-height-column') ||
                     buttonElement.closest('[data-column-id]');
    const columnId = columnEl?.getAttribute('data-column-id') || columnEl?.id;

    // Extract taskId from closest task element (only for task includes)
    let taskId = null;
    if (isColumnTitle !== 'true') {
        const taskEl = buttonElement.closest('.task-item');
        taskId = taskEl?.getAttribute('data-task-id');
    }

    searchForFile(filePath, taskId, columnId, isColumnTitle);
}

/**
 * Browse for an image file to replace a broken image path
 * Opens a file dialog and replaces the old path with the selected file
 * @param {string} oldPath - The old file path to replace
 * @param {string} [taskId] - Optional task ID for targeted update
 * @param {string} [columnId] - Optional column ID for targeted update
 * @param {string} [isColumnTitle] - 'true' if image is in column title (not a task)
 */
function browseForImage(oldPath, taskId, columnId, isColumnTitle) {
    closeAllPathMenus();

    if (taskId === 'undefined' || taskId === 'null' || taskId === '') {
        taskId = undefined;
    }
    if (columnId === 'undefined' || columnId === 'null' || columnId === '') {
        columnId = undefined;
    }
    if (!taskId || !columnId) {
        const overlayRef = window.taskOverlayEditor?.getTaskRef?.();
        if (!taskId && overlayRef?.taskId) {
            taskId = overlayRef.taskId;
        }
        if (!columnId && overlayRef?.columnId) {
            columnId = overlayRef.columnId;
        }
    }

    const message = {
        type: 'browseForImage',
        oldPath: oldPath
    };
    if (taskId) message.taskId = taskId;
    if (columnId) message.columnId = columnId;
    if (isColumnTitle === 'true') message.isColumnTitle = true;

    vscode.postMessage(message);
}

/**
 * Delete an element from the markdown source
 * This will remove the entire markdown element (image, link, include, etc.) from the document
 */
function deleteFromMarkdown(path) {
    closeAllPathMenus();

    vscode.postMessage({
        type: 'deleteFromMarkdown',
        path: path
    });
}

// ============================================================================
// PATH MENUS
// ============================================================================

/**
 * Unified path menu for images, videos, includes, and links
 * Creates a floating menu dynamically and appends to body to avoid stacking context issues
 *
 * @param {HTMLElement} container - The container element with the menu button
 * @param {string} filePath - The file path
 * @param {'image' | 'video' | 'include' | 'link'} mediaType - The type of media
 */
function togglePathMenu(container, filePath, mediaType) {
    // Close any existing floating menus and other open menus
    closeAllPathMenus();

    // Determine button class based on media type
    const buttonClass = mediaType === 'include' ? '.include-menu-btn' :
                        mediaType === 'video' ? '.video-menu-btn' :
                        mediaType === 'link' ? '.link-menu-btn' : '.image-menu-btn';
    const button = container.querySelector(buttonClass);
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const isAbsolutePath = filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);
    const escapedPath = filePath.replace(/'/g, "\\'").replace(/"/g, '\\"');

    // Find task/column context for targeted updates
    const taskElement = container.closest('.task-item');
    const columnElement = container.closest('.kanban-full-height-column') || container.closest('[data-column-id]');
    const columnTitleElement = container.closest('.column-title');
    const taskId = taskElement?.dataset?.taskId || '';
    const columnId = columnElement?.dataset?.columnId || '';
    const isColumnTitle = !taskElement && columnTitleElement ? 'true' : '';

    // Determine if the item is broken based on media type
    let isBroken = false;
    if (mediaType === 'include') {
        // For includes, check window.cachedBoard for the includeError flag set by backend
        // This is reliable because it uses the backend's actual file existence check
        if (window.cachedBoard && columnId) {
            const column = window.cachedBoard.columns.find(c => c.id === columnId);
            if (column) {
                // Check column's includeError flag OR any task with includeError
                isBroken = column.includeError === true ||
                    column.tasks?.some(t => t.includeError === true);
            }
            // For task includes, check the specific task
            if (!isBroken && taskId && column) {
                const task = column.tasks?.find(t => t.id === taskId);
                isBroken = task?.includeError === true;
            }
        }
    } else if (mediaType === 'video') {
        isBroken = container.classList.contains('video-broken');
    } else if (mediaType === 'link') {
        isBroken = container.classList.contains('link-broken');
    } else {
        isBroken = container.classList.contains('image-broken');
    }

    // Create floating menu - use consistent styling for all types
    const menu = document.createElement('div');
    menu.id = `floating-${mediaType}-path-menu`;
    menu.className = 'image-path-menu visible';
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 2) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '999999';
    menu.dataset.filePath = filePath;

    // Build menu HTML based on broken state
    // Broken: Open disabled
    // Valid: Open enabled
    // Search and Browse are ALWAYS enabled (user may want to change to different file)
    const openDisabled = isBroken;

    menu.innerHTML = `
        <button class="image-path-menu-item${openDisabled ? ' disabled' : ''}" ${openDisabled ? 'disabled' : `onclick="event.stopPropagation(); openPath('${escapedPath}', '${taskId}', '${columnId}', '${isColumnTitle}')"`}>📄 Open</button>
        <button class="image-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
        <button class="image-path-menu-item" onclick="event.stopPropagation(); searchForFile('${escapedPath}', '${taskId}', '${columnId}', '${isColumnTitle}')">🔎 Search for File</button>
        <button class="image-path-menu-item" onclick="event.stopPropagation(); browseForImage('${escapedPath}', '${taskId}', '${columnId}', '${isColumnTitle}')">📂 Browse for File</button>
        <div class="image-path-menu-divider"></div>
        <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" ${isAbsolutePath ? `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'relative', true)"` : 'disabled'}>📁 Convert to Relative</button>
        <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" ${isAbsolutePath ? 'disabled' : `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'absolute', true)"`}>📂 Convert to Absolute</button>
        <div class="image-path-menu-divider"></div>
        <button class="image-path-menu-item" onclick="event.stopPropagation(); deleteFromMarkdown('${escapedPath}')">🗑️ Delete</button>
    `;

    document.body.appendChild(menu);

    // Adjust position if menu goes off screen
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - menuRect.width - 10) + 'px';
    }
    if (menuRect.bottom > window.innerHeight) {
        menu.style.top = (rect.top - menuRect.height - 2) + 'px';
    }

    // Close menu when clicking outside
    const closeHandler = (e) => {
        if (!menu.contains(e.target) && !container.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// Wrapper functions for backwards compatibility with existing onclick handlers
function toggleImagePathMenu(container, imagePath) {
    togglePathMenu(container, imagePath, 'image');
}

function toggleVideoPathMenu(container, videoPath) {
    togglePathMenu(container, videoPath, 'video');
}

function toggleIncludePathMenu(container, includePath) {
    togglePathMenu(container, includePath, 'include');
}

function toggleLinkPathMenu(container, linkPath) {
    togglePathMenu(container, linkPath, 'link');
}

/**
 * Toggle the image-not-found menu visibility
 */
function toggleImageNotFoundMenu(container) {
    // Close any other open menus except this container's own menu
    closeAllPathMenus();

    const menu = container.querySelector('.image-not-found-menu');
    if (menu) {
        menu.classList.toggle('visible');

        // Close menu when clicking outside
        if (menu.classList.contains('visible')) {
            const closeHandler = (e) => {
                if (!container.contains(e.target)) {
                    menu.classList.remove('visible');
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    }
}

// ============================================================================
// BROKEN IMAGE HANDLING
// ============================================================================

/**
 * Handle image not found - replace broken image with a placeholder that has a burger menu
 * Called from image onerror handlers
 * Uses data attributes instead of inline onclick to safely handle paths with special characters
 */
function handleImageNotFound(imgElement, originalSrc) {
    if (!imgElement || !imgElement.parentElement) {
        console.warn('[handleImageNotFound] No imgElement or parent');
        return;
    }

    // Check if already handled (prevent double processing)
    if (imgElement.dataset.handled === 'true') {
        return;
    }
    imgElement.dataset.handled = 'true';

    // Check if the image is inside an existing image-path-overlay-container
    // If so, we need to upgrade the existing container, not create a nested one
    const existingOverlay = imgElement.closest('.image-path-overlay-container');
    if (existingOverlay) {
        // Create a simple placeholder span for the image
        const placeholder = document.createElement('span');
        placeholder.className = 'image-not-found';
        placeholder.dataset.originalSrc = originalSrc;
        placeholder.title = `Image not found: ${originalSrc}`;
        const shortPath = getShortDisplayPath(originalSrc);
        placeholder.innerHTML = `<span class="image-not-found-text">📷 ${shortPath}</span>`;

        // Insert placeholder before the image and hide the image
        imgElement.parentElement.insertBefore(placeholder, imgElement);
        imgElement.style.display = 'none';

        // Upgrade the existing overlay container
        upgradeImageOverlayToBroken(existingOverlay, placeholder, originalSrc);
        return;
    }

    // Standalone image - create full container with menu
    const htmlEscapedPath = originalSrc.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const shortPath = getShortDisplayPath(originalSrc);
    const htmlEscapedShortPath = shortPath.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isAbsolutePath = originalSrc.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(originalSrc);

    // Create container with burger menu
    const container = document.createElement('div');
    container.className = 'image-not-found-container';
    container.dataset.imagePath = originalSrc;

    container.innerHTML = `
        <span class="image-not-found" data-original-src="${htmlEscapedPath}" title="Image not found: ${htmlEscapedPath}">
            <span class="image-not-found-text">📷 ${htmlEscapedShortPath}</span>
            <button class="image-menu-btn" data-action="toggle-menu" title="Path options">☰</button>
        </span>
        <div class="image-not-found-menu" data-is-absolute="${isAbsolutePath}">
            <button class="image-path-menu-item disabled" disabled>📄 Open</button>
            <button class="image-path-menu-item" data-action="reveal">🔍 Reveal in File Explorer</button>
            <button class="image-path-menu-item" data-action="search">🔎 Search for File</button>
            <button class="image-path-menu-item" data-action="browse">📂 Browse for File</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" data-action="to-relative" ${isAbsolutePath ? '' : 'disabled'}>📁 Convert to Relative</button>
            <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" data-action="to-absolute" ${isAbsolutePath ? 'disabled' : ''}>📂 Convert to Absolute</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item" data-action="delete">🗑️ Delete</button>
        </div>
    `;

    imgElement.parentElement.insertBefore(container, imgElement);
    imgElement.style.display = 'none';
}

/**
 * Upgrade a simple image-not-found placeholder to a full container with menu
 * Simple placeholders are created by the onerror fallback when handleImageNotFound isn't available
 * They only have: <span class="image-not-found" data-original-src="..."></span>
 * This function upgrades them to the full container with burger menu and all options
 */
function upgradeSimpleImageNotFoundPlaceholder(simpleSpan) {
    // Skip if already upgraded (has parent container)
    if (simpleSpan.closest('.image-not-found-container')) {
        return false;
    }

    // Skip if it's already a full placeholder (has the text child)
    if (simpleSpan.querySelector('.image-not-found-text')) {
        return false;
    }

    // Get the original path from data attribute
    const originalSrc = simpleSpan.dataset.originalSrc || simpleSpan.getAttribute('data-original-src');
    if (!originalSrc) {
        return false;
    }

    // Check if this placeholder is inside an existing image-path-overlay-container
    // This happens when a valid image's onerror fires - the container already has a menu
    const existingOverlay = simpleSpan.closest('.image-path-overlay-container');
    if (existingOverlay) {
        return upgradeImageOverlayToBroken(existingOverlay, simpleSpan, originalSrc);
    }

    // Standalone placeholder - create full container
    const htmlEscapedPath = originalSrc.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const shortPath = getShortDisplayPath(originalSrc);
    const htmlEscapedShortPath = shortPath.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isAbsolutePath = originalSrc.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(originalSrc);

    // Create the full container
    const container = document.createElement('div');
    container.className = 'image-not-found-container';
    container.dataset.imagePath = originalSrc;

    container.innerHTML = `
        <span class="image-not-found" data-original-src="${htmlEscapedPath}" title="Image not found: ${htmlEscapedPath}">
            <span class="image-not-found-text">📷 ${htmlEscapedShortPath}</span>
            <button class="image-menu-btn" data-action="toggle-menu" title="Path options">☰</button>
        </span>
        <div class="image-not-found-menu" data-is-absolute="${isAbsolutePath}">
            <button class="image-path-menu-item disabled" disabled>📄 Open</button>
            <button class="image-path-menu-item" data-action="reveal">🔍 Reveal in File Explorer</button>
            <button class="image-path-menu-item" data-action="search">🔎 Search for File</button>
            <button class="image-path-menu-item" data-action="browse">📂 Browse for File</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" data-action="to-relative" ${isAbsolutePath ? '' : 'disabled'}>📁 Convert to Relative</button>
            <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" data-action="to-absolute" ${isAbsolutePath ? 'disabled' : ''}>📂 Convert to Absolute</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item" data-action="delete">🗑️ Delete</button>
        </div>
    `;

    // Replace the simple span with the full container
    simpleSpan.parentElement.insertBefore(container, simpleSpan);
    simpleSpan.remove();

    return true;
}

/**
 * Upgrade an existing image-path-overlay-container to handle a broken image
 * The container already has a menu, we just need to:
 * 1. Add text to the placeholder span
 * 2. Enable "Search for File" in the existing menu
 * 3. Disable "Open" in the existing menu
 * 4. Store the path for event delegation
 */
function upgradeImageOverlayToBroken(overlayContainer, simpleSpan, originalSrc) {
    // Add the "Image not found" text with filename to the simple span
    const shortPath = getShortDisplayPath(originalSrc);
    simpleSpan.innerHTML = `<span class="image-not-found-text">📷 ${shortPath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
    simpleSpan.title = `Image not found: ${originalSrc}`;

    // Store the path on the overlay container for event delegation
    overlayContainer.dataset.imagePath = originalSrc;
    overlayContainer.classList.add('image-broken');

    // Find task/column context for targeted updates
    const taskElement = overlayContainer.closest('.task-item');
    const columnElement = overlayContainer.closest('.kanban-full-height-column') || overlayContainer.closest('[data-column-id]');
    const taskId = taskElement?.dataset?.taskId;
    const columnId = columnElement?.dataset?.columnId;

    // Find and update the existing menu
    const existingMenu = overlayContainer.querySelector('.image-path-menu');

    if (existingMenu) {
        // Find the "Open" button and disable it
        const openBtn = existingMenu.querySelector('.image-path-menu-item');
        if (openBtn && openBtn.textContent.includes('Open')) {
            openBtn.classList.add('disabled');
            openBtn.disabled = true;
            openBtn.removeAttribute('onclick');
        }

        // Find the "Search for File" button and enable it
        const searchBtn = Array.from(existingMenu.querySelectorAll('.image-path-menu-item')).find(
            btn => btn.textContent.includes('Search')
        );
        if (searchBtn) {
            searchBtn.classList.remove('disabled');
            searchBtn.disabled = false;
            // Use onclick closure - captures path and context safely
            searchBtn.onclick = function(e) {
                e.stopPropagation();
                searchForFile(originalSrc, taskId, columnId);
            };
        }

        // Find the "Browse for File" button and enable it
        const browseBtn = Array.from(existingMenu.querySelectorAll('.image-path-menu-item')).find(
            btn => btn.textContent.includes('Browse')
        );
        if (browseBtn) {
            browseBtn.classList.remove('disabled');
            browseBtn.disabled = false;
            // Use onclick closure - captures path and context safely
            browseBtn.onclick = function(e) {
                e.stopPropagation();
                browseForImage(originalSrc, taskId, columnId);
            };
        }
    }

    return true;
}

/**
 * Upgrade all simple image-not-found placeholders in the document
 * Call this after markdown rendering to ensure all placeholders have the full menu
 */
function upgradeAllSimpleImageNotFoundPlaceholders() {
    const simplePlaceholders = document.querySelectorAll('.image-not-found:not(.image-not-found-container .image-not-found)');
    let upgradedCount = 0;

    simplePlaceholders.forEach(span => {
        if (upgradeSimpleImageNotFoundPlaceholder(span)) {
            upgradedCount++;
        }
    });

}

// ============================================================================
// BROKEN VIDEO HANDLING
// ============================================================================

/**
 * Handle video not found - replace broken video with a placeholder that has a burger menu
 * Called from video onerror handlers
 */
function handleVideoNotFound(videoElement, originalSrc) {
    if (!videoElement || !videoElement.parentElement) {
        console.warn('[handleVideoNotFound] No videoElement or parent');
        return;
    }

    // Check if already handled (prevent double processing)
    if (videoElement.dataset.handled === 'true') {
        return;
    }
    videoElement.dataset.handled = 'true';

    // Check if the video is inside an existing video-path-overlay-container
    const existingOverlay = videoElement.closest('.video-path-overlay-container');
    if (existingOverlay) {
        // Mark container as broken so menu is always visible
        existingOverlay.classList.add('video-broken');

        // Create a placeholder span for the video
        const shortPath = getShortDisplayPath(originalSrc);
        const placeholder = document.createElement('span');
        placeholder.className = 'video-not-found';
        placeholder.dataset.originalSrc = originalSrc;
        placeholder.title = `Video not found: ${originalSrc}`;
        placeholder.innerHTML = `<span class="video-not-found-text">🎬 ${shortPath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;

        // Insert placeholder before the video and hide the video
        videoElement.parentElement.insertBefore(placeholder, videoElement);
        videoElement.style.display = 'none';
        return;
    }

    // Standalone video - create full container with menu
    const htmlEscapedPath = originalSrc.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const shortPath = getShortDisplayPath(originalSrc);
    const htmlEscapedShortPath = shortPath.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isAbsolutePath = originalSrc.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(originalSrc);

    // Create container with burger menu
    const container = document.createElement('div');
    container.className = 'video-not-found-container video-broken';
    container.dataset.videoPath = originalSrc;

    container.innerHTML = `
        <span class="video-not-found" data-original-src="${htmlEscapedPath}" title="Video not found: ${htmlEscapedPath}">
            <span class="video-not-found-text">🎬 ${htmlEscapedShortPath}</span>
            <button class="video-menu-btn" data-action="toggle-menu" title="Path options">☰</button>
        </span>
        <div class="video-not-found-menu" data-is-absolute="${isAbsolutePath}">
            <button class="video-path-menu-item disabled" disabled>📄 Open</button>
            <button class="video-path-menu-item" data-action="reveal">🔍 Reveal in File Explorer</button>
            <button class="video-path-menu-item" data-action="search">🔎 Search for File</button>
            <button class="video-path-menu-item" data-action="browse">📂 Browse for File</button>
            <div class="video-path-menu-divider"></div>
            <button class="video-path-menu-item${isAbsolutePath ? '' : ' disabled'}" data-action="to-relative" ${isAbsolutePath ? '' : 'disabled'}>📁 Convert to Relative</button>
            <button class="video-path-menu-item${isAbsolutePath ? ' disabled' : ''}" data-action="to-absolute" ${isAbsolutePath ? 'disabled' : ''}>📂 Convert to Absolute</button>
            <div class="video-path-menu-divider"></div>
            <button class="video-path-menu-item" data-action="delete">🗑️ Delete</button>
        </div>
    `;

    videoElement.parentElement.insertBefore(container, videoElement);
    videoElement.style.display = 'none';
}

/**
 * Toggle the video-not-found menu visibility
 */
function toggleVideoNotFoundMenu(container) {
    // Close any other open menus except this container's own menu
    closeAllPathMenus();

    const menu = container.querySelector('.video-not-found-menu');
    if (menu) {
        menu.classList.toggle('visible');

        // Close menu when clicking outside
        if (menu.classList.contains('visible')) {
            const closeHandler = (e) => {
                if (!container.contains(e.target)) {
                    menu.classList.remove('visible');
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    }
}

// ============================================================================
// BROKEN LINK HANDLING
// ============================================================================

/**
 * Mark links as broken based on a list of paths
 * Called after board render to highlight broken local file links
 * @param {string[]} brokenPaths - Array of paths that are broken/not found
 */
function markBrokenLinks(brokenPaths) {
    if (!brokenPaths || brokenPaths.length === 0) return;

    // Normalize paths for comparison
    const normalizedBrokenPaths = new Set(brokenPaths.map(p => {
        try {
            return decodeURIComponent(p).toLowerCase();
        } catch {
            return p.toLowerCase();
        }
    }));

    // Find all link containers and check if their path is in the broken list
    const linkContainers = document.querySelectorAll('.link-path-overlay-container');
    linkContainers.forEach(container => {
        const linkPath = container.dataset.linkPath;
        if (!linkPath) return;

        // Normalize the link path for comparison
        let normalizedLinkPath;
        try {
            normalizedLinkPath = decodeURIComponent(linkPath).toLowerCase();
        } catch {
            normalizedLinkPath = linkPath.toLowerCase();
        }

        // Check if this link is broken
        if (normalizedBrokenPaths.has(normalizedLinkPath)) {
            container.classList.add('link-broken');
        } else {
            container.classList.remove('link-broken');
        }
    });
}

/**
 * Clear all broken link markers
 * Call before re-marking to ensure accurate state
 */
function clearBrokenLinkMarkers() {
    document.querySelectorAll('.link-path-overlay-container.link-broken').forEach(container => {
        container.classList.remove('link-broken');
    });
}

/**
 * Mark images as broken based on backend file existence scan
 * Pre-marks images that don't exist on disk before they try to load
 * @param {string[]} brokenPaths - Array of paths that don't exist
 */
function markBrokenImages(brokenPaths) {
    if (!brokenPaths || brokenPaths.length === 0) return;

    // Normalize paths for comparison
    const normalizedBrokenPaths = new Set(brokenPaths.map(p => {
        try {
            return decodeURIComponent(p).toLowerCase();
        } catch {
            return p.toLowerCase();
        }
    }));

    // Find all image containers and check if their path is in the broken list
    const imageContainers = document.querySelectorAll('.image-path-overlay-container');
    imageContainers.forEach(container => {
        // Get path from container's data-image-path or from img's data-original-src
        let imagePath = container.dataset.imagePath;
        if (!imagePath) {
            const img = container.querySelector('img');
            imagePath = img?.dataset?.originalSrc || img?.getAttribute('src');
        }
        if (!imagePath) return;

        // Normalize the image path for comparison
        let normalizedImagePath;
        try {
            normalizedImagePath = decodeURIComponent(imagePath).toLowerCase();
        } catch {
            normalizedImagePath = imagePath.toLowerCase();
        }

        // Check if this image is broken
        if (normalizedBrokenPaths.has(normalizedImagePath)) {
            container.classList.add('image-broken');
        }
    });

    // Also check standalone images not in overlay containers
    const standaloneImages = document.querySelectorAll('img[data-original-src]:not(.image-path-overlay-container img)');
    standaloneImages.forEach(img => {
        const imagePath = img.dataset.originalSrc || img.getAttribute('src');
        if (!imagePath) return;

        let normalizedImagePath;
        try {
            normalizedImagePath = decodeURIComponent(imagePath).toLowerCase();
        } catch {
            normalizedImagePath = imagePath.toLowerCase();
        }

        if (normalizedBrokenPaths.has(normalizedImagePath)) {
            // Trigger the not-found handler to convert to broken state
            if (typeof handleImageNotFound === 'function') {
                handleImageNotFound(img, imagePath);
            }
        }
    });
}

/**
 * Mark media elements (video/audio) as broken based on backend file existence scan
 * @param {string[]} brokenPaths - Array of paths that don't exist
 */
function markBrokenMedia(brokenPaths) {
    if (!brokenPaths || brokenPaths.length === 0) return;

    // Normalize paths for comparison
    const normalizedBrokenPaths = new Set(brokenPaths.map(p => {
        try {
            return decodeURIComponent(p).toLowerCase();
        } catch {
            return p.toLowerCase();
        }
    }));

    // Find all video containers
    const videoContainers = document.querySelectorAll('.video-path-overlay-container');
    videoContainers.forEach(container => {
        let videoPath = container.dataset.videoPath;
        if (!videoPath) {
            const video = container.querySelector('video');
            videoPath = video?.getAttribute('src');
        }
        if (!videoPath) return;

        let normalizedVideoPath;
        try {
            normalizedVideoPath = decodeURIComponent(videoPath).toLowerCase();
        } catch {
            normalizedVideoPath = videoPath.toLowerCase();
        }

        if (normalizedBrokenPaths.has(normalizedVideoPath)) {
            container.classList.add('video-broken');
        }
    });

    // Check standalone videos
    const standaloneVideos = document.querySelectorAll('video:not(.video-path-overlay-container video)');
    standaloneVideos.forEach(video => {
        const videoPath = video.getAttribute('src');
        if (!videoPath) return;

        let normalizedVideoPath;
        try {
            normalizedVideoPath = decodeURIComponent(videoPath).toLowerCase();
        } catch {
            normalizedVideoPath = videoPath.toLowerCase();
        }

        if (normalizedBrokenPaths.has(normalizedVideoPath)) {
            // Trigger the not-found handler
            if (typeof handleVideoNotFound === 'function') {
                handleVideoNotFound(video, videoPath);
            }
        }
    });
}

/**
 * Clear all broken image markers (for re-scanning)
 */
function clearBrokenImageMarkers() {
    document.querySelectorAll('.image-path-overlay-container.image-broken').forEach(container => {
        container.classList.remove('image-broken');
    });
}

/**
 * Clear all broken media markers (for re-scanning)
 */
function clearBrokenMediaMarkers() {
    document.querySelectorAll('.video-path-overlay-container.video-broken').forEach(container => {
        container.classList.remove('video-broken');
    });
}

// ============================================================================
// DOM PATH UPDATES
// ============================================================================

/**
 * Update path references in the DOM and cached board after a path conversion
 * This allows updating the UI without a full board refresh
 */
function updatePathInDOM(oldPath, newPath, direction) {
    // Update the cached board data (used for editing)
    if (window.cachedBoard) {
        let boardUpdated = false;

        // Update paths in all columns and tasks
        window.cachedBoard.columns.forEach(column => {
            // Update column description/markdown
            if (column.markdown && column.markdown.includes(oldPath)) {
                column.markdown = column.markdown.split(oldPath).join(newPath);
                boardUpdated = true;
            }
            if (column.description && column.description.includes(oldPath)) {
                column.description = column.description.split(oldPath).join(newPath);
                boardUpdated = true;
            }

            // Update tasks
            if (column.tasks) {
                column.tasks.forEach(task => {
                    if (task.markdown && task.markdown.includes(oldPath)) {
                        task.markdown = task.markdown.split(oldPath).join(newPath);
                        boardUpdated = true;
                    }
                    if (task.description && task.description.includes(oldPath)) {
                        task.description = task.description.split(oldPath).join(newPath);
                        boardUpdated = true;
                    }
                    if (task.content && task.content.includes(oldPath)) {
                        task.content = task.content.split(oldPath).join(newPath);
                        boardUpdated = true;
                    }
                });
            }
        });

        if (boardUpdated) {
            // Mark as having unsaved changes
            window.hasUnsavedChanges = true;
        }
    }
}

// ============================================================================
// EVENT DELEGATION SETUP
// ============================================================================

/**
 * Set up event delegation for image-not-found menu actions
 * This is more robust than inline onclick handlers for paths with special characters
 */
function setupImagePathEventDelegation() {
    document.addEventListener('click', (e) => {
        const target = e.target;
        const action = target.dataset?.action;

        if (!action) return;

        // Find the container to get the image path
        // Check both container types: standalone broken images and broken images in overlay
        const container = target.closest('.image-not-found-container') || target.closest('.image-path-overlay-container');

        if (!container) {
            return;
        }

        const imagePath = container.dataset.imagePath;

        if (!imagePath && action !== 'toggle-menu') {
            return;
        }

        // Find task/column context for targeted updates
        const taskElement = container.closest('.task-item');
        const columnElement = container.closest('.kanban-full-height-column') || container.closest('[data-column-id]');
        const taskId = taskElement?.dataset?.taskId;
        const columnId = columnElement?.dataset?.columnId;

        e.stopPropagation();

        switch (action) {
            case 'toggle-menu':
                toggleImageNotFoundMenu(container);
                break;
            case 'reveal':
                revealPathInExplorer(imagePath);
                break;
            case 'search':
            case 'search-overlay':
                // Close the menu first
                const searchMenu = container.querySelector('.image-path-menu.visible, .image-not-found-menu.visible');
                if (searchMenu) searchMenu.classList.remove('visible');
                searchForFile(imagePath, taskId, columnId);
                break;
            case 'browse':
            case 'browse-overlay':
                // Close the menu first
                const browseMenu = container.querySelector('.image-path-menu.visible, .image-not-found-menu.visible');
                if (browseMenu) browseMenu.classList.remove('visible');
                browseForImage(imagePath, taskId, columnId);
                break;
            case 'to-relative':
                if (!target.disabled) {
                    convertSinglePath(imagePath, 'relative', true);
                }
                break;
            case 'to-absolute':
                if (!target.disabled) {
                    convertSinglePath(imagePath, 'absolute', true);
                }
                break;
            case 'delete':
                // Close the menu first
                const deleteMenu = container.querySelector('.image-path-menu.visible, .image-not-found-menu.visible');
                if (deleteMenu) deleteMenu.classList.remove('visible');
                deleteFromMarkdown(imagePath);
                break;
        }
    });
}

/**
 * Set up MutationObserver to automatically upgrade simple placeholders when they're added to the DOM
 * This handles cases where images fail to load after the initial render
 */
function setupImageNotFoundObserver() {
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', setupImageNotFoundObserver);
        return;
    }

    const imageNotFoundObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node is a simple placeholder
                        const isImageNotFound = node.classList?.contains('image-not-found');
                        const hasContainer = node.closest('.image-not-found-container');

                        if (isImageNotFound && !hasContainer) {
                            upgradeSimpleImageNotFoundPlaceholder(node);
                        }

                        // Also check for simple placeholders within the added node
                        const simplePlaceholders = node.querySelectorAll?.('.image-not-found:not(.image-not-found-container .image-not-found)');
                        if (simplePlaceholders?.length > 0) {
                            simplePlaceholders.forEach(span => upgradeSimpleImageNotFoundPlaceholder(span));
                        }
                    }
                });
            }
        }
    });

    // Start observing the document body for added nodes
    imageNotFoundObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Also run upgrade on any existing simple placeholders
    upgradeAllSimpleImageNotFoundPlaceholders();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize image path manager
 * Sets up event delegation and mutation observer
 */
function initImagePathManager() {
    setupImagePathEventDelegation();
    setupImageNotFoundObserver();
}

// Initialize when this script loads (check for guard to avoid duplicate initialization)
if (!window._imagePathManagerInitialized) {
    window._imagePathManagerInitialized = true;
    // Defer initialization to ensure DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initImagePathManager);
    } else {
        initImagePathManager();
    }
}

// ============================================================================
// WINDOW EXPORTS
// ============================================================================

// Utility functions
window.closeAllPathMenus = closeAllPathMenus;

// Path conversion
window.convertPathsToRelative = convertPathsToRelative;
window.convertPathsToAbsolute = convertPathsToAbsolute;
window.convertSinglePath = convertSinglePath;

// Path operations
window.openPath = openPath;
window.revealPathInExplorer = revealPathInExplorer;
window.getShortDisplayPath = getShortDisplayPath;
window.searchForFile = searchForFile;
window.searchForIncludeFile = searchForIncludeFile;
window.browseForImage = browseForImage;
window.deleteFromMarkdown = deleteFromMarkdown;

// Path menus
window.togglePathMenu = togglePathMenu;
window.toggleImagePathMenu = toggleImagePathMenu;
window.toggleIncludePathMenu = toggleIncludePathMenu;
window.toggleVideoPathMenu = toggleVideoPathMenu;
window.toggleLinkPathMenu = toggleLinkPathMenu;
window.toggleImageNotFoundMenu = toggleImageNotFoundMenu;
window.toggleVideoNotFoundMenu = toggleVideoNotFoundMenu;

// Broken image handling
window.handleImageNotFound = handleImageNotFound;

// Broken video handling
window.handleVideoNotFound = handleVideoNotFound;
window.upgradeSimpleImageNotFoundPlaceholder = upgradeSimpleImageNotFoundPlaceholder;
window.upgradeImageOverlayToBroken = upgradeImageOverlayToBroken;
window.upgradeAllSimpleImageNotFoundPlaceholders = upgradeAllSimpleImageNotFoundPlaceholders;

// DOM updates
window.updatePathInDOM = updatePathInDOM;

// Broken element handling
window.markBrokenLinks = markBrokenLinks;
window.clearBrokenLinkMarkers = clearBrokenLinkMarkers;
window.markBrokenImages = markBrokenImages;
window.clearBrokenImageMarkers = clearBrokenImageMarkers;
window.markBrokenMedia = markBrokenMedia;
window.clearBrokenMediaMarkers = clearBrokenMediaMarkers;

// ============================================================================
// DIAGRAM MENUS (Mermaid, PlantUML)
// ============================================================================

/**
 * Toggle diagram menu for Mermaid/PlantUML diagrams
 * @param {HTMLElement} container - The diagram container element
 * @param {string} diagramType - 'mermaid' or 'plantuml'
 */
function toggleDiagramMenu(container, diagramType) {
    // Close any existing floating menus
    closeAllPathMenus();
    document.getElementById('floating-diagram-menu')?.remove();

    const button = container.querySelector('.diagram-menu-btn');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const code = container.dataset.diagramCode || '';

    // Create floating menu
    const menu = document.createElement('div');
    menu.id = 'floating-diagram-menu';
    menu.className = 'image-path-menu visible';
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 2) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '999999';

    const typeLabel = diagramType === 'mermaid' ? 'Mermaid' : 'PlantUML';
    const isWysiwyg = Boolean(container.closest('.wysiwyg-diagram-block'));
    const editItem = isWysiwyg ? '<button class="image-path-menu-item" data-action="edit-diagram">✏️ Edit diagram</button>' : '';

    menu.innerHTML = `
        ${editItem}
        <button class="image-path-menu-item" data-action="convert-svg">💾 Convert to SVG file</button>
        <button class="image-path-menu-item" data-action="copy-svg">📋 Copy SVG to clipboard</button>
        <button class="image-path-menu-item" data-action="copy-code">📝 Copy ${typeLabel} code</button>
    `;

    // Handle menu actions
    menu.addEventListener('click', (e) => {
        const action = e.target.dataset?.action;
        if (!action) return;

        e.stopPropagation();
        menu.remove();

        switch (action) {
            case 'edit-diagram': {
                if (typeof window.toggleWysiwygDiagramEdit === 'function') {
                    window.toggleWysiwygDiagramEdit(container);
                }
                break;
            }
            case 'convert-svg':
                convertDiagramToSVG(container, diagramType, code);
                break;
            case 'copy-svg':
                copyDiagramSVG(container);
                break;
            case 'copy-code':
                copyDiagramCode(code);
                break;
        }
    });

    document.body.appendChild(menu);

    // Adjust position if menu goes off screen
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - menuRect.width - 10) + 'px';
    }
    if (menuRect.bottom > window.innerHeight) {
        menu.style.top = (rect.top - menuRect.height - 2) + 'px';
    }

    // Close menu when clicking outside
    const closeHandler = (e) => {
        if (!menu.contains(e.target) && !container.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

/**
 * Convert diagram to SVG file (sends to backend)
 */
function convertDiagramToSVG(container, diagramType, code) {
    if (typeof vscode !== 'undefined') {
        const messageType = diagramType === 'mermaid' ? 'convertMermaidToSVG' : 'convertPlantUMLToSVG';
        vscode.postMessage({
            type: messageType,
            code: code
        });
    }
}

/**
 * Copy SVG content to clipboard
 */
function copyDiagramSVG(container) {
    const svgElement = container.querySelector('svg');
    if (svgElement) {
        const svgString = new XMLSerializer().serializeToString(svgElement);
        navigator.clipboard.writeText(svgString).then(() => {
            // Could show a toast notification here
            console.log('[Diagram] SVG copied to clipboard');
        }).catch(err => {
            console.error('[Diagram] Failed to copy SVG:', err);
        });
    }
}

/**
 * Copy diagram source code to clipboard
 */
function copyDiagramCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        console.log('[Diagram] Code copied to clipboard');
    }).catch(err => {
        console.error('[Diagram] Failed to copy code:', err);
    });
}

// Diagram menus
window.toggleDiagramMenu = toggleDiagramMenu;
window.convertDiagramToSVG = convertDiagramToSVG;
window.copyDiagramSVG = copyDiagramSVG;
window.copyDiagramCode = copyDiagramCode;
