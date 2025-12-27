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
    document.querySelectorAll('.image-path-menu.visible, .include-path-menu.visible, .image-not-found-menu.visible').forEach(menu => {
        menu.classList.remove('visible');
    });
    document.getElementById('floating-image-path-menu')?.remove();
    document.getElementById('floating-include-path-menu')?.remove();
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
    console.log(`[convertSinglePath] Called with path: "${imagePath}", direction: ${direction}, skipRefresh: ${skipRefresh}`);
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
function openPath(filePath) {
    console.log(`[openPath] Called with path: "${filePath}"`);
    closeAllPathMenus();

    vscode.postMessage({
        type: 'openPath',
        filePath: filePath
    });
}

/**
 * Reveal a file path in the system file explorer (Finder on macOS, Explorer on Windows)
 * Called from inline onclick handlers in rendered markdown
 */
function revealPathInExplorer(filePath) {
    console.log(`[revealPathInExplorer] Called with path: "${filePath}"`);
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
 * @returns {string} Shortened display name like "…/folder/image.png"
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
        displayFolder = parentFolder.substring(0, maxFolderChars - 1) + '…';
    }

    // Add ellipsis prefix if there are more parent folders
    const prefix = parts.length > 2 ? '…/' : '';

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
    console.log(`[searchForFile] Called with path: "${filePath}", taskId: ${taskId}, columnId: ${columnId}, isColumnTitle: ${isColumnTitle}`);
    closeAllPathMenus();

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
 * Browse for an image file to replace a broken image path
 * Opens a file dialog and replaces the old path with the selected file
 * @param {string} oldPath - The old file path to replace
 * @param {string} [taskId] - Optional task ID for targeted update
 * @param {string} [columnId] - Optional column ID for targeted update
 * @param {string} [isColumnTitle] - 'true' if image is in column title (not a task)
 */
function browseForImage(oldPath, taskId, columnId, isColumnTitle) {
    console.log(`[browseForImage] Called with oldPath: "${oldPath}", taskId: ${taskId}, columnId: ${columnId}, isColumnTitle: ${isColumnTitle}`);
    closeAllPathMenus();

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
    console.log(`[deleteFromMarkdown] Called with path: "${path}"`);
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
 * Toggle the image path menu visibility
 * Called from inline onclick handlers in rendered markdown
 * Creates menu dynamically and appends to body to avoid stacking context issues
 */
function toggleImagePathMenu(container, imagePath) {
    // Close any existing floating menus and other open menus
    closeAllPathMenus();

    // Get button position for menu placement
    const button = container.querySelector('.image-menu-btn');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const isAbsolutePath = imagePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(imagePath);
    const escapedPath = imagePath.replace(/'/g, "\\'").replace(/"/g, '\\"');

    // Find task/column context for targeted updates
    const taskElement = container.closest('.task-item');
    const columnElement = container.closest('.kanban-full-height-column') || container.closest('[data-column-id]');
    const columnTitleElement = container.closest('.column-title');
    const taskId = taskElement?.dataset?.taskId || '';
    const columnId = columnElement?.dataset?.columnId || '';
    // Detect if image is in column title (not in a task)
    const isColumnTitle = !taskElement && columnTitleElement ? 'true' : '';

    // Check if the image is broken (has the image-broken class)
    const isBroken = container.classList.contains('image-broken');

    // Create floating menu
    const menu = document.createElement('div');
    menu.id = 'floating-image-path-menu';
    menu.className = 'image-path-menu visible';
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 2) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '999999';
    menu.dataset.imagePath = imagePath;

    if (isBroken) {
        // Menu for broken images - Open disabled, Search/Browse enabled
        menu.innerHTML = `
            <button class="image-path-menu-item disabled" disabled>📄 Open</button>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); searchForFile('${escapedPath}', '${taskId}', '${columnId}', '${isColumnTitle}')">🔎 Search for File</button>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); browseForImage('${escapedPath}', '${taskId}', '${columnId}', '${isColumnTitle}')">📂 Browse for File</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" ${isAbsolutePath ? `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'relative', true)"` : 'disabled'}>📁 Convert to Relative</button>
            <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" ${isAbsolutePath ? 'disabled' : `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'absolute', true)"`}>📂 Convert to Absolute</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); deleteFromMarkdown('${escapedPath}')">🗑️ Delete</button>
        `;
    } else {
        // Menu for valid images - Open enabled, Search/Browse disabled
        menu.innerHTML = `
            <button class="image-path-menu-item" onclick="event.stopPropagation(); openPath('${escapedPath}')">📄 Open</button>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
            <button class="image-path-menu-item disabled" disabled>🔎 Search for File</button>
            <button class="image-path-menu-item disabled" disabled>📂 Browse for File</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item${isAbsolutePath ? '' : ' disabled'}" ${isAbsolutePath ? `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'relative', true)"` : 'disabled'}>📁 Convert to Relative</button>
            <button class="image-path-menu-item${isAbsolutePath ? ' disabled' : ''}" ${isAbsolutePath ? 'disabled' : `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'absolute', true)"`}>📂 Convert to Absolute</button>
            <div class="image-path-menu-divider"></div>
            <button class="image-path-menu-item" onclick="event.stopPropagation(); deleteFromMarkdown('${escapedPath}')">🗑️ Delete</button>
        `;
    }

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
 * Toggle the include path menu visibility
 * Called from inline onclick handlers in rendered include links
 * Creates a floating menu appended to body to escape stacking context issues
 */
function toggleIncludePathMenu(container, includePath) {
    // Close any existing floating menus and other open menus
    closeAllPathMenus();

    // Get button position for menu placement
    const button = container.querySelector('.include-menu-btn');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const isAbsolutePath = includePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(includePath);
    const escapedPath = includePath.replace(/'/g, "\\'").replace(/"/g, '\\"');

    // Create floating menu
    const menu = document.createElement('div');
    menu.id = 'floating-include-path-menu';
    menu.className = 'include-path-menu visible';
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 2) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '999999';
    menu.dataset.includePath = includePath;

    menu.innerHTML = `
        <button class="include-path-menu-item" onclick="event.stopPropagation(); openPath('${escapedPath}')">📄 Open</button>
        <button class="include-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
        <button class="include-path-menu-item disabled" disabled>🔎 Search for File</button>
        <div class="include-path-menu-divider"></div>
        <button class="include-path-menu-item${isAbsolutePath ? '' : ' disabled'}" ${isAbsolutePath ? `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'relative', true)"` : 'disabled'}>📁 Convert to Relative</button>
        <button class="include-path-menu-item${isAbsolutePath ? ' disabled' : ''}" ${isAbsolutePath ? 'disabled' : `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'absolute', true)"`}>📂 Convert to Absolute</button>
        <div class="include-path-menu-divider"></div>
        <button class="include-path-menu-item" onclick="event.stopPropagation(); deleteFromMarkdown('${escapedPath}')">🗑️ Delete</button>
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
    console.log(`[handleImageNotFound] Called with path: "${originalSrc}"`);

    if (!imgElement || !imgElement.parentElement) {
        console.warn('[handleImageNotFound] No imgElement or parent');
        return;
    }

    // Check if already handled (prevent double processing)
    if (imgElement.dataset.handled === 'true') {
        console.log('[handleImageNotFound] Already handled, skipping');
        return;
    }
    imgElement.dataset.handled = 'true';

    // Check if the image is inside an existing image-path-overlay-container
    // If so, we need to upgrade the existing container, not create a nested one
    const existingOverlay = imgElement.closest('.image-path-overlay-container');
    if (existingOverlay) {
        console.log('[handleImageNotFound] Image is inside overlay container, upgrading existing menu');

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
    console.log('[handleImageNotFound] Standalone image, creating full container');

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

    if (upgradedCount > 0) {
        console.log(`[upgradeAllSimpleImageNotFoundPlaceholders] Upgraded ${upgradedCount} placeholder(s)`);
    }
}

// ============================================================================
// DOM PATH UPDATES
// ============================================================================

/**
 * Update path references in the DOM and cached board after a path conversion
 * This allows updating the UI without a full board refresh
 */
function updatePathInDOM(oldPath, newPath, direction) {
    console.log(`[updatePathInDOM] Updating path from "${oldPath}" to "${newPath}"`);

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
            console.log(`[updatePathInDOM] Updated cached board data`);
            // Mark as having unsaved changes
            window.hasUnsavedChanges = true;
        }
    }

    console.log(`[updatePathInDOM] Path updated in cached board`);
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

        // Debug: Log all clicks on menu items
        if (target.classList?.contains('image-path-menu-item')) {
            console.log('[EventDelegation] Click on menu item:', {
                target: target,
                action: action,
                text: target.textContent,
                disabled: target.disabled,
                classList: Array.from(target.classList)
            });
        }

        if (!action) return;

        console.log('[EventDelegation] Action detected:', action);

        // Find the container to get the image path
        // Check both container types: standalone broken images and broken images in overlay
        const container = target.closest('.image-not-found-container') || target.closest('.image-path-overlay-container');
        console.log('[EventDelegation] Container found:', container);

        if (!container) {
            console.log('[EventDelegation] No container found, returning');
            return;
        }

        const imagePath = container.dataset.imagePath;
        console.log('[EventDelegation] imagePath:', imagePath);

        if (!imagePath && action !== 'toggle-menu') {
            console.log('[EventDelegation] No imagePath and action is not toggle-menu, returning');
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
                console.log('[EventDelegation] Toggling menu');
                toggleImageNotFoundMenu(container);
                break;
            case 'reveal':
                console.log('[EventDelegation] Revealing path');
                revealPathInExplorer(imagePath);
                break;
            case 'search':
            case 'search-overlay':
                console.log('[EventDelegation] Searching for replacement:', imagePath);
                // Close the menu first
                const searchMenu = container.querySelector('.image-path-menu.visible, .image-not-found-menu.visible');
                if (searchMenu) searchMenu.classList.remove('visible');
                searchForFile(imagePath, taskId, columnId);
                break;
            case 'browse':
            case 'browse-overlay':
                console.log('[EventDelegation] Browsing for replacement:', imagePath);
                // Close the menu first
                const browseMenu = container.querySelector('.image-path-menu.visible, .image-not-found-menu.visible');
                if (browseMenu) browseMenu.classList.remove('visible');
                browseForImage(imagePath, taskId, columnId);
                break;
            case 'to-relative':
                if (!target.disabled) {
                    console.log('[EventDelegation] Converting to relative');
                    convertSinglePath(imagePath, 'relative', true);
                }
                break;
            case 'to-absolute':
                if (!target.disabled) {
                    console.log('[EventDelegation] Converting to absolute');
                    convertSinglePath(imagePath, 'absolute', true);
                }
                break;
            case 'delete':
                console.log('[EventDelegation] Deleting element:', imagePath);
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
window.browseForImage = browseForImage;
window.deleteFromMarkdown = deleteFromMarkdown;

// Path menus
window.toggleImagePathMenu = toggleImagePathMenu;
window.toggleIncludePathMenu = toggleIncludePathMenu;
window.toggleImageNotFoundMenu = toggleImageNotFoundMenu;

// Broken image handling
window.handleImageNotFound = handleImageNotFound;
window.upgradeSimpleImageNotFoundPlaceholder = upgradeSimpleImageNotFoundPlaceholder;
window.upgradeImageOverlayToBroken = upgradeImageOverlayToBroken;
window.upgradeAllSimpleImageNotFoundPlaceholders = upgradeAllSimpleImageNotFoundPlaceholders;

// DOM updates
window.updatePathInDOM = updatePathInDOM;
