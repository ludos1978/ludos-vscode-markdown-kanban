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
    document.getElementById('floating-embed-menu')?.remove();
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
function searchForFile(filePath, taskId, columnId, isColumnTitle, includeDirFromContainer) {
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

    // Extract includeContext for correct path resolution in include files
    // Priority: 1. includeDirFromContainer (regular includes), 2. task.includeContext (task/column includes), 3. overlay ref
    let includeContext = null;

    // Check if we have includeDir from the include container (for regular includes)
    if (includeDirFromContainer && includeDirFromContainer !== '' && includeDirFromContainer !== 'undefined') {
        includeContext = { includeDir: includeDirFromContainer };
        console.log('[searchForFile] Using includeDir from container:', includeDirFromContainer);
    }

    // If no container includeDir, try to get from task's includeContext (for task/column includes)
    if (!includeContext && taskId && columnId && window.cachedBoard?.columns) {
        const column = window.cachedBoard.columns.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === taskId);
        if (task?.includeContext) {
            includeContext = task.includeContext;
            console.log('[searchForFile] Using includeContext from task:', task.includeContext);
        }
    }

    // Fallback to overlay ref
    if (!includeContext) {
        const overlayRef = window.taskOverlayEditor?.getTaskRef?.();
        if (overlayRef?.includeContext) {
            includeContext = overlayRef.includeContext;
            console.log('[searchForFile] Using includeContext from overlay:', overlayRef.includeContext);
        }
    }

    const message = {
        type: 'searchForFile',
        filePath: filePath
    };
    if (taskId) message.taskId = taskId;
    if (columnId) message.columnId = columnId;
    if (isColumnTitle === 'true') message.isColumnTitle = true;
    if (includeContext) message.includeContext = includeContext;

    console.log('[searchForFile] Sending message:', message);
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
function browseForImage(oldPath, taskId, columnId, isColumnTitle, includeDirFromContainer) {
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

    // Extract includeContext for correct path resolution in include files
    // Priority: 1. includeDirFromContainer (regular includes), 2. task.includeContext (task/column includes), 3. overlay ref
    let includeContext = null;

    // Check if we have includeDir from the include container (for regular includes)
    if (includeDirFromContainer && includeDirFromContainer !== '' && includeDirFromContainer !== 'undefined') {
        includeContext = { includeDir: includeDirFromContainer };
        console.log('[browseForImage] Using includeDir from container:', includeDirFromContainer);
    }

    // If no container includeDir, try to get from task's includeContext (for task/column includes)
    if (!includeContext && taskId && columnId && window.cachedBoard?.columns) {
        const column = window.cachedBoard.columns.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === taskId);
        if (task?.includeContext) {
            includeContext = task.includeContext;
            console.log('[browseForImage] Using includeContext from task:', task.includeContext);
        }
    }

    // Fallback to overlay ref
    if (!includeContext) {
        const overlayRef = window.taskOverlayEditor?.getTaskRef?.();
        if (overlayRef?.includeContext) {
            includeContext = overlayRef.includeContext;
            console.log('[browseForImage] Using includeContext from overlay:', overlayRef.includeContext);
        }
    }

    const message = {
        type: 'browseForImage',
        oldPath: oldPath
    };
    if (taskId) message.taskId = taskId;
    if (columnId) message.columnId = columnId;
    if (isColumnTitle === 'true') message.isColumnTitle = true;
    if (includeContext) message.includeContext = includeContext;

    console.log('[browseForImage] Sending message:', message);
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

    // Check if image is inside a regular include container (!!!include()!!! in description)
    // If so, extract the includeDir from the container's data attribute
    const includeContainer = container.closest('.include-container');
    const includeDir = includeContainer?.dataset?.includeDir || '';

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
    const escapedIncludeDir = includeDir.replace(/'/g, "\\'").replace(/"/g, '\\"');

    menu.innerHTML = `
        <button class="image-path-menu-item${openDisabled ? ' disabled' : ''}" ${openDisabled ? 'disabled' : `onclick="event.stopPropagation(); openPath('${escapedPath}', '${taskId}', '${columnId}', '${isColumnTitle}')"`}>📄 Open</button>
        <button class="image-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
        <button class="image-path-menu-item" onclick="event.stopPropagation(); searchForFile('${escapedPath}', '${taskId}', '${columnId}', '${isColumnTitle}', '${escapedIncludeDir}')">🔎 Search for File</button>
        <button class="image-path-menu-item" onclick="event.stopPropagation(); browseForImage('${escapedPath}', '${taskId}', '${columnId}', '${isColumnTitle}', '${escapedIncludeDir}')">📂 Browse for File</button>
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
 * Toggle embed menu for iframe embeds
 * @param {HTMLElement} container - The embed container element
 */
function toggleEmbedMenu(container) {
    // Close any existing floating menus
    closeAllPathMenus();
    document.getElementById('floating-embed-menu')?.remove();

    const button = container.querySelector('.embed-menu-btn');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const embedUrl = container.dataset.embedUrl || '';
    const embedFallback = container.dataset.embedFallback || '';
    const embedCaption = container.dataset.embedCaption || '';

    // Create floating menu
    const menu = document.createElement('div');
    menu.id = 'floating-embed-menu';
    menu.className = 'image-path-menu visible';
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 2) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '999999';

    menu.innerHTML = `
        <button class="image-path-menu-item" data-action="open-embed-url">🌐 Open URL in browser</button>
        <button class="image-path-menu-item" data-action="copy-embed-url">📋 Copy URL</button>
        ${embedFallback ? `<button class="image-path-menu-item" data-action="open-fallback">📷 Open fallback image</button>` : ''}
        <div class="image-path-menu-divider"></div>
        <button class="image-path-menu-item" data-action="delete-embed">🗑️ Remove embed</button>
    `;

    // Store data on menu for action handling
    menu.dataset.embedUrl = embedUrl;
    menu.dataset.embedFallback = embedFallback;

    // Handle menu actions
    menu.addEventListener('click', (e) => {
        const action = e.target.dataset?.action;
        if (!action) return;

        e.stopPropagation();
        menu.remove();

        switch (action) {
            case 'open-embed-url':
                if (embedUrl) {
                    vscode.postMessage({ type: 'openExternal', url: embedUrl });
                }
                break;
            case 'copy-embed-url':
                if (embedUrl) {
                    navigator.clipboard.writeText(embedUrl).then(() => {
                        console.log('[Embed] URL copied to clipboard');
                    }).catch(err => {
                        console.error('[Embed] Failed to copy URL:', err);
                    });
                }
                break;
            case 'open-fallback':
                if (embedFallback) {
                    openPath(embedFallback);
                }
                break;
            case 'delete-embed':
                // Delete the embed markdown from source
                // We need to find the original markdown syntax
                // For now, send a message to delete by URL
                vscode.postMessage({
                    type: 'deleteFromMarkdown',
                    path: embedUrl
                });
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
 * Toggle the not-found menu visibility for any media type
 * @param {HTMLElement} container - The container element
 * @param {'image'|'video'} mediaType - The media type
 */
function toggleMediaNotFoundMenu(container, mediaType = 'image') {
    closeAllPathMenus();

    const config = MEDIA_TYPE_CONFIG[mediaType];
    if (!config) return;

    // Look for both standalone menu and overlay menu
    const menu = container.querySelector(`.${config.notFoundMenuClass}`) ||
                 container.querySelector(`.${mediaType}-path-menu`);
    if (menu) {
        menu.classList.toggle('visible');

        if (menu.classList.contains('visible')) {
            const closeHandler = (e) => {
                if (!container.contains(e.target)) {
                    menu.classList.remove('visible');
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    } else {
        // For overlay containers, create a floating menu
        const filePath = container.dataset[config.pathDataAttr];
        if (filePath) {
            togglePathMenu(container, filePath, mediaType);
        }
    }
}


// ============================================================================
// BROKEN IMAGE HANDLING
// ============================================================================

/**
 * Check if a path is an external URL (http://, https://, data:, blob:)
 * External URLs that fail to load are not "broken" - they just can't load in webview
 */
function isExternalUrl(path) {
    if (!path) return false;
    return /^(https?:|data:|blob:)/i.test(path);
}

// ============================================================================
// SHARED HELPERS FOR BROKEN FILE HANDLING
// ============================================================================

/**
 * Media type configurations for unified broken file handling
 */
const MEDIA_TYPE_CONFIG = {
    image: {
        emoji: '📷',
        containerClass: 'image-path-overlay-container',
        notFoundClass: 'image-not-found',
        notFoundContainerClass: 'image-not-found-container',
        notFoundTextClass: 'image-not-found-text',
        notFoundMenuClass: 'image-not-found-menu',
        brokenClass: 'image-broken',
        menuBtnClass: 'image-menu-btn',
        menuItemClass: 'image-path-menu-item',
        pathDataAttr: 'filePath',  // Unified: all types use data-file-path
        mediaLabel: 'image'
    },
    video: {
        emoji: '🎬',
        containerClass: 'video-path-overlay-container',
        notFoundClass: 'video-not-found',
        notFoundContainerClass: 'video-not-found-container',
        notFoundTextClass: 'video-not-found-text',
        notFoundMenuClass: 'video-not-found-menu',
        brokenClass: 'video-broken',
        menuBtnClass: 'video-menu-btn',
        menuItemClass: 'video-path-menu-item',
        pathDataAttr: 'filePath',  // Unified: all types use data-file-path
        mediaLabel: 'video'
    },
    link: {
        emoji: '🔗',
        containerClass: 'link-path-overlay-container',
        notFoundClass: 'link-not-found',
        notFoundContainerClass: 'link-not-found-container',
        notFoundTextClass: 'link-not-found-text',
        notFoundMenuClass: 'link-not-found-menu',
        brokenClass: 'link-broken',
        menuBtnClass: 'link-menu-btn',
        menuItemClass: 'link-path-menu-item',
        pathDataAttr: 'filePath',  // Unified: all types use data-file-path
        mediaLabel: 'link'
    },
    include: {
        emoji: '📎',
        containerClass: 'include-path-overlay-container',
        notFoundClass: 'include-not-found',
        notFoundContainerClass: 'include-not-found-container',
        notFoundTextClass: 'include-not-found-text',
        notFoundMenuClass: 'include-not-found-menu',
        brokenClass: 'include-broken',
        menuBtnClass: 'include-menu-btn',
        menuItemClass: 'include-path-menu-item',
        pathDataAttr: 'filePath',  // Unified: all types use data-file-path
        mediaLabel: 'include'
    },
    embed: {
        emoji: '🔗',
        containerClass: 'embed-container',
        notFoundClass: 'embed-not-found',
        notFoundContainerClass: 'embed-not-found-container',
        notFoundTextClass: 'embed-not-found-text',
        notFoundMenuClass: 'embed-not-found-menu',
        brokenClass: 'embed-broken',
        menuBtnClass: 'embed-menu-btn',
        menuItemClass: 'embed-menu-item',
        pathDataAttr: 'embedUrl',  // Uses data-embed-url
        mediaLabel: 'embed'
    }
};

/**
 * Escape HTML special characters for safe insertion
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtmlForBroken(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Create an external URL placeholder element
 * @param {string} originalSrc - The external URL
 * @param {string} mediaType - 'image' or 'video'
 * @returns {HTMLElement} The placeholder element
 */
/**
 * Extract YouTube video ID from various URL formats
 * @param {string} url - YouTube URL
 * @returns {string|null} Video ID or null if not a YouTube URL
 */
function extractYouTubeVideoId(url) {
    if (!url) return null;

    // Match various YouTube URL formats:
    // - youtube.com/watch?v=VIDEO_ID
    // - youtu.be/VIDEO_ID
    // - youtube.com/embed/VIDEO_ID
    // - youtube-nocookie.com/embed/VIDEO_ID
    const patterns = [
        /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function createExternalUrlPlaceholder(originalSrc, mediaType) {
    const placeholder = document.createElement('span');
    placeholder.className = 'external-url-blocked';
    placeholder.dataset.externalUrl = originalSrc;

    // Extract domain for cleaner display
    let domain = '';
    let displayText = '';
    try {
        const urlObj = new URL(originalSrc);
        domain = urlObj.hostname.replace('www.', '');
    } catch (e) {
        domain = 'link';
    }

    // Check for YouTube URLs and extract video ID
    const youtubeVideoId = extractYouTubeVideoId(originalSrc);
    if (youtubeVideoId) {
        displayText = `YouTube: ${youtubeVideoId}`;
        placeholder.title = `YouTube video (Alt+click to open in browser)\n${originalSrc}`;
        placeholder.innerHTML = `<span class="external-url-text">🎬 ${escapeHtmlForBroken(displayText)} (Alt+click to open)</span>`;

        // Fetch video title via oEmbed (no API key required)
        fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtubeVideoId}&format=json`)
            .then(response => response.ok ? response.json() : null)
            .then(data => {
                if (data && data.title) {
                    const textSpan = placeholder.querySelector('.external-url-text');
                    if (textSpan) {
                        textSpan.innerHTML = `🎬 ${escapeHtmlForBroken(data.title)} (Alt+click to open)`;
                    }
                    placeholder.title = `YouTube: ${data.title}\n${originalSrc}`;
                }
            })
            .catch(() => {
                // Silently fail - keep showing video ID
            });
    } else {
        displayText = domain;
        placeholder.title = `External link (Alt+click to open in browser)\n${originalSrc}`;
        placeholder.innerHTML = `<span class="external-url-text">🔗 ${escapeHtmlForBroken(displayText)} (Alt+click to open)</span>`;
    }
    placeholder.style.cursor = 'pointer';
    placeholder.onclick = (e) => {
        if (e.altKey) {
            e.stopPropagation();
            e.preventDefault();
            vscode.postMessage({ type: 'openExternal', url: originalSrc });
        }
    };
    return placeholder;
}

/**
 * Create a broken path matcher function from a list of broken paths
 * @param {string[]} brokenPaths - Array of paths that are broken
 * @returns {function(string): boolean} Function to check if a path is broken
 */
function createBrokenPathMatcher(brokenPaths) {
    const normalizedBrokenPaths = new Set();
    brokenPaths.forEach(p => {
        normalizedBrokenPaths.add(normalizeBrokenPath(p));
    });

    return function isPathBroken(path) {
        const normalized = normalizeBrokenPath(path);
        if (normalizedBrokenPaths.has(normalized)) {
            return true;
        }
        for (const brokenPath of normalizedBrokenPaths) {
            if (normalized.endsWith(brokenPath) || brokenPath.endsWith(normalized)) {
                return true;
            }
        }
        return false;
    };
}

/**
 * Generate the not-found menu HTML for broken media
 * @param {string} htmlEscapedPath - HTML-escaped path
 * @param {boolean} isAbsolutePath - Whether path is absolute
 * @param {object} config - Media type config
 * @returns {string} Menu HTML
 */
function generateBrokenMediaMenuHtml(htmlEscapedPath, isAbsolutePath, config) {
    return `
        <div class="${config.notFoundMenuClass}" data-is-absolute="${isAbsolutePath}">
            <button class="${config.menuItemClass} disabled" disabled>📄 Open</button>
            <button class="${config.menuItemClass}" data-action="reveal">🔍 Reveal in File Explorer</button>
            <button class="${config.menuItemClass}" data-action="search">🔎 Search for File</button>
            <button class="${config.menuItemClass}" data-action="browse">📂 Browse for File</button>
            <div class="${config.menuItemClass.replace('-item', '-divider')}"></div>
            <button class="${config.menuItemClass}${isAbsolutePath ? '' : ' disabled'}" data-action="to-relative" ${isAbsolutePath ? '' : 'disabled'}>📁 Convert to Relative</button>
            <button class="${config.menuItemClass}${isAbsolutePath ? ' disabled' : ''}" data-action="to-absolute" ${isAbsolutePath ? 'disabled' : ''}>📂 Convert to Absolute</button>
            <div class="${config.menuItemClass.replace('-item', '-divider')}"></div>
            <button class="${config.menuItemClass}" data-action="delete">🗑️ Delete</button>
        </div>
    `;
}

/**
 * Unified handler for media not found (image/video)
 * @param {HTMLElement} element - The media element that failed to load
 * @param {string} originalSrc - The original source path
 * @param {'image'|'video'} mediaType - The type of media
 */
function handleMediaNotFound(element, originalSrc, mediaType) {
    const config = MEDIA_TYPE_CONFIG[mediaType];
    if (!config) {
        console.warn(`[handleMediaNotFound] Unknown media type: ${mediaType}`);
        return;
    }

    if (!element || !element.parentElement) {
        console.warn(`[handleMediaNotFound] No element or parent for ${mediaType}`);
        return;
    }

    // Skip external URLs - they fail to load due to webview security
    if (isExternalUrl(originalSrc)) {
        element.dataset.handled = 'true';
        const placeholder = createExternalUrlPlaceholder(originalSrc, config.mediaLabel);
        element.parentElement.insertBefore(placeholder, element);
        element.style.display = 'none';
        return;
    }

    // Check if already handled
    if (element.dataset.handled === 'true') {
        return;
    }
    element.dataset.handled = 'true';

    // Check if inside an existing overlay container
    const existingOverlay = element.closest(`.${config.containerClass}`);
    if (existingOverlay) {
        existingOverlay.classList.add(config.brokenClass);

        const shortPath = getShortDisplayPath(originalSrc);

        const placeholder = document.createElement('span');
        placeholder.className = config.notFoundClass;
        placeholder.dataset.originalSrc = originalSrc;
        placeholder.title = `${config.mediaLabel.charAt(0).toUpperCase() + config.mediaLabel.slice(1)} not found: ${originalSrc}`;
        placeholder.innerHTML = `<span class="${config.notFoundTextClass}">${config.emoji} ${escapeHtmlForBroken(shortPath)}</span>`;

        // Get reference to the existing button before inserting placeholder
        const existingButton = existingOverlay.querySelector(`.${config.menuBtnClass}`);

        element.parentElement.insertBefore(placeholder, element);
        element.style.display = 'none';

        // For images, also upgrade the overlay menu (this modifies placeholder.innerHTML)
        if (mediaType === 'image') {
            upgradeImageOverlayToBroken(existingOverlay, placeholder, originalSrc);
        }

        // Move the existing overlay button inside the placeholder AFTER upgradeImageOverlayToBroken
        // (which replaces innerHTML), so the button doesn't get removed
        if (existingButton) {
            existingButton.removeAttribute('onclick');
            existingButton.dataset.action = 'toggle-menu';
            // Set onclick to stop propagation and toggle menu
            // (event delegation at document level runs too late - after parent handlers)
            existingButton.onclick = (e) => {
                e.stopPropagation();
                toggleMediaNotFoundMenu(existingOverlay, mediaType);
            };
            placeholder.appendChild(existingButton);
        }
        return;
    }

    // Standalone media - create full container with menu
    const htmlEscapedPath = escapeHtmlForBroken(originalSrc);
    const shortPath = getShortDisplayPath(originalSrc);
    const htmlEscapedShortPath = escapeHtmlForBroken(shortPath);
    const isAbsolutePath = originalSrc.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(originalSrc);

    const container = document.createElement('div');
    container.className = `${config.notFoundContainerClass}${mediaType === 'video' ? ' ' + config.brokenClass : ''}`;
    container.dataset[config.pathDataAttr] = originalSrc;

    container.innerHTML = `
        <span class="${config.notFoundClass}" data-original-src="${htmlEscapedPath}" title="${config.mediaLabel.charAt(0).toUpperCase() + config.mediaLabel.slice(1)} not found: ${htmlEscapedPath}">
            <span class="${config.notFoundTextClass}">${config.emoji} ${htmlEscapedShortPath}</span>
            <button class="${config.menuBtnClass}" data-action="toggle-menu" title="Path options">☰</button>
        </span>
        ${generateBrokenMediaMenuHtml(htmlEscapedPath, isAbsolutePath, config)}
    `;

    element.parentElement.insertBefore(container, element);
    element.style.display = 'none';
}

/**
 * Unified function to mark elements as broken based on path list
 * @param {string[]} brokenPaths - Array of broken paths
 * @param {'image'|'video'|'link'} mediaType - Type of media to mark
 * @param {function} [notFoundHandler] - Optional handler for standalone elements
 */
function markBrokenElements(brokenPaths, mediaType, notFoundHandler) {
    if (!brokenPaths || brokenPaths.length === 0) return;

    const config = MEDIA_TYPE_CONFIG[mediaType];
    if (!config) return;

    const isPathBroken = createBrokenPathMatcher(brokenPaths);

    // Find all containers and mark broken ones
    const containers = document.querySelectorAll(`.${config.containerClass}`);
    containers.forEach(container => {
        let path = container.dataset[config.pathDataAttr];

        // Try to get path from child element if not on container
        if (!path) {
            const childSelector = mediaType === 'image' ? 'img' : mediaType === 'video' ? 'video' : 'a';
            const child = container.querySelector(childSelector);
            path = child?.dataset?.originalSrc || child?.getAttribute('src') || child?.getAttribute('href');
        }
        if (!path) return;

        if (isPathBroken(path)) {
            container.classList.add(config.brokenClass);
        } else {
            container.classList.remove(config.brokenClass);
        }
    });

    // Handle standalone elements if handler provided
    if (notFoundHandler && (mediaType === 'image' || mediaType === 'video')) {
        const tagName = mediaType === 'image' ? 'img' : 'video';
        const selector = `${tagName}[data-original-src]:not(.${config.containerClass} ${tagName}), ${tagName}:not(.${config.containerClass} ${tagName})`;
        const standaloneElements = document.querySelectorAll(selector);

        standaloneElements.forEach(el => {
            const path = el.dataset?.originalSrc || el.getAttribute('src');
            if (path && isPathBroken(path)) {
                notFoundHandler(el, path);
            }
        });
    }
}

/**
 * Unified function to clear broken markers
 * @param {'image'|'video'|'link'|'all'} mediaType - Type to clear, or 'all' for all types
 */
function clearBrokenMarkers(mediaType) {
    const types = mediaType === 'all' ? ['image', 'video', 'link'] : [mediaType];

    types.forEach(type => {
        const config = MEDIA_TYPE_CONFIG[type];
        if (config) {
            document.querySelectorAll(`.${config.containerClass}.${config.brokenClass}`).forEach(container => {
                container.classList.remove(config.brokenClass);
            });
        }
    });
}

// ============================================================================
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
    container.dataset.filePath = originalSrc;

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
    overlayContainer.dataset.filePath = originalSrc;
    overlayContainer.classList.add('image-broken');

    // Find task/column context for targeted updates
    const taskElement = overlayContainer.closest('.task-item');
    const columnElement = overlayContainer.closest('.kanban-full-height-column') || overlayContainer.closest('[data-column-id]');
    const taskId = taskElement?.dataset?.taskId;
    const columnId = columnElement?.dataset?.columnId;

    // Check if image is inside a regular include container
    const includeContainer = overlayContainer.closest('.include-container');
    const includeDir = includeContainer?.dataset?.includeDir || '';

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
                searchForFile(originalSrc, taskId, columnId, '', includeDir);
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
                browseForImage(originalSrc, taskId, columnId, '', includeDir);
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


/**
 * Normalize a path for comparison
 * @param {string} p - The path to normalize
 * @returns {string} Normalized path
 */
function normalizeBrokenPath(p) {
    if (!p) return '';
    try {
        // Decode URL encoding
        let normalized = decodeURIComponent(p);
        // Unescape markdown escape sequences (e.g., \' -> ', \" -> ", \[ -> [, etc.)
        // These are characters that might be escaped in markdown paths
        normalized = normalized.replace(/\\(['"()\[\]\\])/g, '$1');
        // Normalize Windows-style path separators to forward slashes
        // After unescaping, remaining backslashes should be path separators
        normalized = normalized.replace(/\\/g, '/');
        // Remove leading ./
        if (normalized.startsWith('./')) {
            normalized = normalized.substring(2);
        }
        // Lowercase for case-insensitive matching
        return normalized.toLowerCase();
    } catch {
        // Fallback: unescape and normalize
        return p.replace(/\\(['"()\[\]\\])/g, '$1').toLowerCase().replace(/\\/g, '/');
    }
}

/**
 * Extract filename from a path
 * @param {string} p - The path
 * @returns {string} Filename
 */
function extractFilename(p) {
    if (!p) return '';
    const normalized = p.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash >= 0 ? normalized.substring(lastSlash + 1).toLowerCase() : normalized.toLowerCase();
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
 * Determine media type from container classes
 * @param {HTMLElement} container - The container element
 * @returns {{type: string, filePath: string}|null}
 */
function getMediaTypeFromContainer(container) {
    for (const [type, config] of Object.entries(MEDIA_TYPE_CONFIG)) {
        if (container.classList.contains(config.containerClass) ||
            container.classList.contains(config.notFoundContainerClass)) {
            const filePath = container.dataset[config.pathDataAttr];
            return { type, filePath };
        }
    }
    return null;
}

/**
 * Set up event delegation for all not-found menu actions (image, video, link, include)
 * This is more robust than inline onclick handlers for paths with special characters
 */
function setupMediaPathEventDelegation() {
    document.addEventListener('click', (e) => {
        const target = e.target;
        const action = target.dataset?.action;

        if (!action) return;

        // Find the container - check all media types
        const containerSelectors = Object.values(MEDIA_TYPE_CONFIG)
            .flatMap(c => [`.${c.containerClass}`, `.${c.notFoundContainerClass}`])
            .join(', ');
        const container = target.closest(containerSelectors);

        if (!container) {
            return;
        }

        // Determine media type and get file path
        const mediaInfo = getMediaTypeFromContainer(container);
        if (!mediaInfo) return;

        const { type: mediaType, filePath } = mediaInfo;

        // Stop propagation early to prevent task editing for any media action
        // This must happen before any early returns
        e.stopPropagation();

        // Allow toggle-menu and embed-menu to proceed even without filePath
        // (embed-menu gets URL from container data attributes)
        const menuActions = ['toggle-menu', 'embed-menu'];
        if (!filePath && !menuActions.includes(action)) {
            return;
        }

        // Find task/column context for targeted updates
        const taskElement = container.closest('.task-item');
        const columnElement = container.closest('.kanban-full-height-column') || container.closest('[data-column-id]');
        const taskId = taskElement?.dataset?.taskId;
        const columnId = columnElement?.dataset?.columnId;

        // Check if inside a regular include container
        const includeContainer = container.closest('.include-container');
        const includeDir = includeContainer?.dataset?.includeDir || '';

        // Close any visible menus selector - all media types
        const menuSelector = Object.values(MEDIA_TYPE_CONFIG)
            .flatMap(c => [`.${c.notFoundMenuClass}.visible`, `.${mediaType}-path-menu.visible`])
            .join(', ');

        switch (action) {
            case 'toggle-menu':
                toggleMediaNotFoundMenu(container, mediaType);
                break;
            case 'image-menu':
            case 'video-menu':
            case 'link-menu':
            case 'include-menu':
                // Handle working media menu toggle (not broken/not-found)
                togglePathMenu(container, filePath, mediaType);
                break;
            case 'embed-menu':
                // Handle embed menu toggle
                toggleEmbedMenu(container);
                break;
            case 'reveal':
                revealPathInExplorer(filePath);
                break;
            case 'search':
            case 'search-overlay':
                const searchMenu = container.querySelector(menuSelector);
                if (searchMenu) searchMenu.classList.remove('visible');
                searchForFile(filePath, taskId, columnId, '', includeDir);
                break;
            case 'browse':
            case 'browse-overlay':
                const browseMenu = container.querySelector(menuSelector);
                if (browseMenu) browseMenu.classList.remove('visible');
                browseForImage(filePath, taskId, columnId, '', includeDir);
                break;
            case 'to-relative':
                if (!target.disabled) {
                    convertSinglePath(filePath, 'relative', true);
                }
                break;
            case 'to-absolute':
                if (!target.disabled) {
                    convertSinglePath(filePath, 'absolute', true);
                }
                break;
            case 'delete':
                const deleteMenu = container.querySelector(menuSelector);
                if (deleteMenu) deleteMenu.classList.remove('visible');
                deleteFromMarkdown(filePath);
                break;
        }
    });
}

// Alias for backwards compatibility
const setupImagePathEventDelegation = setupMediaPathEventDelegation;

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
window.toggleMediaNotFoundMenu = toggleMediaNotFoundMenu;

// Unified broken media handling
window.handleMediaNotFound = handleMediaNotFound;
window.markBrokenElements = markBrokenElements;
window.clearBrokenMarkers = clearBrokenMarkers;
window.createBrokenPathMatcher = createBrokenPathMatcher;

// Image placeholder upgrade functions
window.upgradeSimpleImageNotFoundPlaceholder = upgradeSimpleImageNotFoundPlaceholder;
window.upgradeImageOverlayToBroken = upgradeImageOverlayToBroken;
window.upgradeAllSimpleImageNotFoundPlaceholders = upgradeAllSimpleImageNotFoundPlaceholders;

// DOM updates
window.updatePathInDOM = updatePathInDOM;

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

// Embed menus
window.toggleEmbedMenu = toggleEmbedMenu;
