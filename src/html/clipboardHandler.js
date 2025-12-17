/**
 * Clipboard and Drag Handler Module
 *
 * Handles clipboard card creation, empty card/column drag operations,
 * and template menu drag operations.
 * Extracted from webview.js for better code organization.
 */

// =============================================================================
// STATE VARIABLES
// =============================================================================

let clipboardCardData = null;
let lastClipboardCheck = 0;
const CLIPBOARD_CHECK_THROTTLE = 1000; // Only check clipboard once per second

// =============================================================================
// CLIPBOARD HANDLERS
// =============================================================================

/**
 * Legacy clipboard mousedown handler (deprecated)
 * Purpose: Previously handled clipboard interactions
 * Used by: Clipboard card source (now unused)
 * @param {MouseEvent} e - Mouse event
 */
window.handleClipboardMouseDown = async function(e) {
    // Ensure element is focused for clipboard access
    e.target.focus();

    // Wait a moment for focus to be established
    setTimeout(async () => {
        await updateClipboardCardSource(true); // Force update
    }, 50);
};

/**
 * Handles drag start for clipboard card creation
 * Purpose: Enables dragging clipboard content to create cards
 * Used by: Clipboard card source UI element
 * @param {DragEvent} e - Drag event
 * Side effects: Sets drag state, formats clipboard data
 */
window.handleClipboardDragStart = function(e) {

    // Create default data if no clipboard data
    if (!clipboardCardData) {
        clipboardCardData = {
            title: 'Clipboard Content',
            content: 'Drag to create card from clipboard',
            isLink: false
        };
    }

    // Handle clipboard images
    if (clipboardCardData && clipboardCardData.isImage) {
        // For images, we have the base64 data already
        const imageData = clipboardCardData.content; // This is base64 now

        // Create data transfer with the base64 image data
        e.dataTransfer.setData('text/plain', `CLIPBOARD_IMAGE:${JSON.stringify({
            title: clipboardCardData.title,
            type: 'base64',
            imageType: clipboardCardData.imageType,
            data: imageData, // Include the actual base64 data
            md5Hash: clipboardCardData.md5Hash // Include the MD5 hash for filename
        })}`);

        e.dataTransfer.effectAllowed = 'copy';

        if (window.dragState) {
            window.dragState.isDragging = true;
            // Don't set draggedClipboardCard for images - let dataTransfer handle it
        }

        e.target.classList.add('dragging');
        return;
    }
    // Handle multiple files by passing pre-formatted links
    if (clipboardCardData && clipboardCardData.multipleFiles) {
        e.dataTransfer.setData('text/plain', `MULTIPLE_FILES:${clipboardCardData.content}`);
        e.dataTransfer.effectAllowed = 'copy';

        // Set drag state but don't set clipboard card
        if (window.dragState) {
            window.dragState.isDragging = true;
        }

        e.target.classList.add('dragging');
        return;
    }

    // Create task data for single content
    const tempTask = {
        id: 'temp-clipboard-' + Date.now(),
        title: clipboardCardData.title,
        description: clipboardCardData.isImage ? '[Image from clipboard]' : clipboardCardData.content,
        isFromClipboard: true
    };

    // Set drag state
    if (window.dragState) {
        window.dragState.isDragging = true;
        window.dragState.draggedClipboardCard = tempTask;
    }

    // Set drag data
    const dragData = JSON.stringify({
        type: 'clipboard-card',
        task: tempTask
    });
    e.dataTransfer.setData('text/plain', `CLIPBOARD_CARD:${dragData}`);
    e.dataTransfer.effectAllowed = 'copy';

    // Add visual feedback
    e.target.classList.add('dragging');
};

/**
 * Handles drag end for clipboard operations
 * Purpose: Cleanup after clipboard drag operation
 * Used by: Clipboard card source drag end
 * @param {DragEvent} e - Drag event
 * Side effects: Clears drag state and visual feedback
 */
window.handleClipboardDragEnd = function(e) {

    // Clear visual feedback
    e.target.classList.remove('dragging');

    // Clear drag state
    if (window.dragState) {
        window.dragState.isDragging = false;
        window.dragState.draggedClipboardCard = null;
    }
};

/**
 * Shows preview of clipboard content
 * Purpose: Display what will be created from clipboard
 * Used by: Clipboard card source hover/focus
 * Side effects: Updates preview UI elements
 */
window.showClipboardPreview = function() {
    const preview = document.getElementById('clipboard-preview');
    const header = document.getElementById('clipboard-preview-header');
    const body = document.getElementById('clipboard-preview-body');

    if (!preview || !clipboardCardData) {return;}

    // Update header based on content type
    if (clipboardCardData.isImage) {
        header.textContent = 'Clipboard Image';
    } else if (clipboardCardData.isLink) {
        if (clipboardCardData.content.startsWith('![')) {
            header.textContent = 'Image Link';
        } else if (clipboardCardData.content.startsWith('[')) {
            header.textContent = 'File Link';
        } else {
            header.textContent = 'URL Link';
        }
    } else {
        header.textContent = 'Clipboard Content';
    }

    // Clear previous content
    body.innerHTML = '';

    // Show image preview for clipboard images (base64)
    if (clipboardCardData.isImage && clipboardCardData.content) {
        const img = document.createElement('img');
        img.className = 'clipboard-preview-image';
        img.src = clipboardCardData.content; // This is base64 data URL

        const textDiv = document.createElement('div');
        textDiv.className = 'clipboard-preview-text';
        textDiv.textContent = '[Image from clipboard - will be saved when dropped]';

        img.onload = function() {
            body.appendChild(img);
            body.appendChild(textDiv);
        };

        img.onerror = function() {
            // If image fails to load, show fallback text
            textDiv.textContent = '[Clipboard contains image data]';
            body.appendChild(textDiv);
        };

    // Show image preview if it's an image link
    } else if (clipboardCardData.isLink && clipboardCardData.content.startsWith('![')) {
        // Extract image path from markdown ![alt](path)
        const imageMatch = clipboardCardData.content.match(/!\[.*?\]\((.*?)\)/);
        if (imageMatch && imageMatch[1]) {
            const imagePath = imageMatch[1];

            // Create image element
            const img = document.createElement('img');
            img.className = 'clipboard-preview-image';
            img.src = imagePath;

            // Add the markdown text first
            const textDiv = document.createElement('div');
            textDiv.className = 'clipboard-preview-text';
            textDiv.textContent = clipboardCardData.content;

            img.onerror = function() {
                // If image fails to load, just show text
                body.appendChild(textDiv);
            };

            img.onload = function() {
                // Image loaded successfully - show image then text
                body.appendChild(img);
                body.appendChild(textDiv);
            };

            // Start loading the image
            // If it fails, only text will show; if it succeeds, both will show

        } else {
            // Fallback to text
            const textDiv = document.createElement('div');
            textDiv.className = 'clipboard-preview-text';
            textDiv.textContent = clipboardCardData.content;
            body.appendChild(textDiv);
        }
    } else {
        // Show text content
        const textDiv = document.createElement('div');
        textDiv.className = 'clipboard-preview-text';
        textDiv.textContent = clipboardCardData.content;
        body.appendChild(textDiv);
    }

    // Show the preview
    preview.classList.add('show');
};

/**
 * Hides clipboard content preview
 * Purpose: Clean up preview display
 * Used by: Mouse leave, blur events
 * Side effects: Hides preview element
 */
window.hideClipboardPreview = function() {
    const preview = document.getElementById('clipboard-preview');
    if (preview) {
        preview.classList.remove('show');
    }
};

// =============================================================================
// EMPTY CARD DRAG HANDLERS
// =============================================================================

window.handleEmptyCardDragStart = function(e) {

    // Create empty task data
    const tempTask = {
        id: 'temp-empty-' + Date.now(),
        title: '',
        description: '',
        isFromEmptyCard: true
    };

    // Set drag state
    if (window.dragState) {
        window.dragState.isDragging = true;
        window.dragState.draggedEmptyCard = tempTask;
    }

    // Set drag data
    const dragData = JSON.stringify({
        type: 'empty-card',
        task: tempTask
    });
    e.dataTransfer.setData('text/plain', `EMPTY_CARD:${dragData}`);
    e.dataTransfer.effectAllowed = 'copy';

    // Add visual feedback
    e.target.classList.add('dragging');
};

window.handleEmptyCardDragEnd = function(e) {

    // Clear visual feedback
    e.target.classList.remove('dragging');

    // Clear drag state
    if (window.dragState) {
        window.dragState.isDragging = false;
        window.dragState.draggedEmptyCard = null;
    }
};

// =============================================================================
// EMPTY COLUMN DRAG HANDLERS
// =============================================================================

// Empty column drag handlers - Uses templateDragState like templates do
window.handleEmptyColumnDragStart = function(e) {
    // Use templateDragState - same as column templates
    if (typeof window.templateDragState !== 'undefined') {
        window.templateDragState.isDragging = true;
        window.templateDragState.templatePath = null;
        window.templateDragState.templateName = 'Empty Column';
        window.templateDragState.isEmptyColumn = true;
        window.templateDragState.targetRow = null;
        window.templateDragState.targetPosition = null;
        window.templateDragState.targetColumnId = null;
        window.templateDragState.isDropZone = false;
        window.templateDragState.lastInStackTarget = null;  // Reset last in-stack target
    }

    // Set drag data
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'empty-column');

    // Visual feedback
    e.target.classList.add('dragging');

    // Add class to board for drop zone highlighting
    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardElement.classList.add('template-dragging');
    }
};

window.handleEmptyColumnDragEnd = function(e) {
    // Clear visual feedback
    e.target.classList.remove('dragging');

    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardElement.classList.remove('template-dragging');
    }

    // Clear all tracked highlights efficiently
    if (typeof window.clearHighlights === 'function') {
        window.clearHighlights();
    }

    // FIX: Use SAME approach as processColumnDrop - use dragState.dropTargetStack/dropTargetBeforeColumn
    // These DOM elements are stored during dragover and are the reliable source of drop position
    const dropTargetStack = window.dragState?.dropTargetStack;
    const dropTargetBeforeColumn = window.dragState?.dropTargetBeforeColumn;

    // DEBUG: Log drop targets
    console.log('[EmptyColumn DROP] dragState targets:', {
        hasDropTargetStack: !!dropTargetStack,
        dropTargetStackClass: dropTargetStack?.className,
        hasDropTargetBeforeColumn: dropTargetBeforeColumn !== undefined,
        dropTargetBeforeColumnId: dropTargetBeforeColumn?.dataset?.columnId
    });

    // If we have valid drop targets from dragState, use those (same as processColumnDrop)
    if (typeof window.templateDragState !== 'undefined' &&
        window.templateDragState.isDragging &&
        window.templateDragState.isEmptyColumn &&
        window.cachedBoard &&
        dropTargetStack) {

        // Determine row from the stack's parent row
        const parentRow = dropTargetStack.closest('.kanban-row');
        const targetRow = parentRow ? parseInt(parentRow.getAttribute('data-row-number') || '1') : 1;

        // Check if dropping on a drop zone (new stack) vs within existing stack
        const isDropZone = dropTargetStack.classList.contains('column-drop-zone-stack');

        // Determine insert position from DOM elements
        let insertBeforeColumnId = null;
        let insertAfterColumnId = null;

        if (isDropZone) {
            // Dropping on drop zone - find adjacent columns
            const prevStack = dropTargetStack.previousElementSibling;
            const nextStack = dropTargetStack.nextElementSibling;

            if (prevStack && prevStack.classList.contains('kanban-column-stack')) {
                const lastCol = prevStack.querySelector('.kanban-full-height-column:last-of-type');
                if (lastCol) {
                    insertAfterColumnId = lastCol.dataset?.columnId;
                }
            } else if (nextStack && nextStack.classList.contains('kanban-column-stack')) {
                const firstCol = nextStack.querySelector('.kanban-full-height-column:first-of-type');
                if (firstCol) {
                    insertBeforeColumnId = firstCol.dataset?.columnId;
                }
            }
        } else {
            // Dropping within a stack
            if (dropTargetBeforeColumn) {
                insertBeforeColumnId = dropTargetBeforeColumn.dataset?.columnId;
            } else {
                // Dropping at end of stack - insert after last column
                const lastCol = dropTargetStack.querySelector('.kanban-full-height-column:last-of-type');
                if (lastCol) {
                    insertAfterColumnId = lastCol.dataset?.columnId;
                }
            }
        }

        console.log('[EmptyColumn DROP] Position calc:', {
            targetRow,
            isDropZone,
            insertBeforeColumnId,
            insertAfterColumnId
        });

        // Create new column data - DON'T set #stack tag here, let normalizeAllStackTags handle it
        let columnTitle = 'New Column';
        if (targetRow > 1) {
            columnTitle = `New Column #row${targetRow}`;
        }

        const newColumn = {
            id: `col-${Date.now()}`,
            title: columnTitle,
            tasks: [],
            settings: {}
        };

        // Find insert position in cachedBoard.columns
        let insertIndex = window.cachedBoard.columns.length;

        if (insertBeforeColumnId) {
            const idx = window.cachedBoard.columns.findIndex(c => c.id === insertBeforeColumnId);
            if (idx >= 0) {
                insertIndex = idx;
            }
        } else if (insertAfterColumnId) {
            const idx = window.cachedBoard.columns.findIndex(c => c.id === insertAfterColumnId);
            if (idx >= 0) {
                insertIndex = idx + 1;
            }
        }

        console.log('[EmptyColumn DROP] Inserting at index:', insertIndex);

        // Insert column into cachedBoard
        window.cachedBoard.columns.splice(insertIndex, 0, newColumn);

        // CRITICAL: Sort columns by row to match backend ordering
        if (typeof window.sortColumnsByRow === 'function') {
            window.cachedBoard.columns = window.sortColumnsByRow(window.cachedBoard.columns);
        }

        // Re-render the board - this creates the DOM structure
        if (typeof window.renderBoard === 'function') {
            window.renderBoard();
        }

        // CRITICAL: Normalize stack tags based on actual DOM structure (same as processColumnDrop)
        // This is the KEY - let the DOM structure determine the stack tags
        if (typeof window.normalizeAllStackTags === 'function') {
            window.normalizeAllStackTags();
        }

        // Mark as unsaved to trigger backend save
        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }
    }

    // Reset templateDragState
    if (typeof window.templateDragState !== 'undefined') {
        window.templateDragState.isDragging = false;
        window.templateDragState.templatePath = null;
        window.templateDragState.templateName = null;
        window.templateDragState.isEmptyColumn = false;
        window.templateDragState.targetRow = null;
        window.templateDragState.targetPosition = null;
        window.templateDragState.targetColumnId = null;
        window.templateDragState.isDropZone = false;
        window.templateDragState.lastInStackTarget = null;
    }

    // Clear dragState drop targets
    if (window.dragState) {
        window.dragState.dropTargetStack = null;
        window.dragState.dropTargetBeforeColumn = null;
    }

    // Hide any internal drop indicator
    const indicator = document.querySelector('.internal-drop-indicator');
    if (indicator) {
        indicator.classList.remove('active');
    }
};

// =============================================================================
// CLIPBOARD COLUMN DRAG HANDLERS
// =============================================================================

// Clipboard column drag handlers - Creates column with tasks from clipboard content
window.handleClipboardColumnDragStart = function(e) {
    // Check if we have presentation format content
    if (!window.clipboardCardData || !window.clipboardCardData.isPresentationFormat) {
        e.preventDefault();
        return;
    }

    // Use templateDragState - same as column templates
    if (typeof window.templateDragState !== 'undefined') {
        window.templateDragState.isDragging = true;
        window.templateDragState.templatePath = null;
        window.templateDragState.templateName = 'Clipboard Column';
        window.templateDragState.isEmptyColumn = false;
        window.templateDragState.isClipboardColumn = true;
        window.templateDragState.clipboardContent = window.clipboardCardData.content;
        window.templateDragState.targetRow = null;
        window.templateDragState.targetPosition = null;
        window.templateDragState.targetColumnId = null;
        window.templateDragState.isDropZone = false;  // Initialize to false - will be updated during drag
        window.templateDragState.lastInStackTarget = null;  // Reset last in-stack target
    }

    // Set drag data
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'clipboard-column');

    // Visual feedback
    e.target.classList.add('dragging');

    // Add class to board for drop zone highlighting
    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardElement.classList.add('template-dragging');
    }
};

window.handleClipboardColumnDragEnd = function(e) {
    // Clear visual feedback
    e.target.classList.remove('dragging');

    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardElement.classList.remove('template-dragging');
    }

    // Clear all tracked highlights efficiently
    if (typeof window.clearHighlights === 'function') {
        window.clearHighlights();
    }

    // FIX: Use SAME approach as processColumnDrop - use dragState.dropTargetStack/dropTargetBeforeColumn
    // These DOM elements are stored during dragover and are the reliable source of drop position
    const dropTargetStack = window.dragState?.dropTargetStack;
    const dropTargetBeforeColumn = window.dragState?.dropTargetBeforeColumn;

    // DEBUG: Log drop targets
    console.log('[ClipboardColumn DROP] dragState targets:', {
        hasDropTargetStack: !!dropTargetStack,
        dropTargetStackClass: dropTargetStack?.className,
        hasDropTargetBeforeColumn: dropTargetBeforeColumn !== undefined,
        dropTargetBeforeColumnId: dropTargetBeforeColumn?.dataset?.columnId
    });

    // If we have valid drop targets from dragState, use those (same as processColumnDrop)
    if (typeof window.templateDragState !== 'undefined' &&
        window.templateDragState.isDragging &&
        window.templateDragState.isClipboardColumn &&
        window.cachedBoard &&
        dropTargetStack) {

        const clipboardContent = window.templateDragState.clipboardContent;

        // Parse clipboard content into tasks using shared parser
        if (!window.PresentationParser) {
            console.error('[ClipboardColumn] PresentationParser not loaded - check script order in webview.html');
            return;
        }
        const parsedData = window.PresentationParser.parseClipboardAsColumn(clipboardContent);

        // Determine row from the stack's parent row
        const parentRow = dropTargetStack.closest('.kanban-row');
        const targetRow = parentRow ? parseInt(parentRow.getAttribute('data-row-number') || '1') : 1;

        // Check if dropping on a drop zone (new stack) vs within existing stack
        const isDropZone = dropTargetStack.classList.contains('column-drop-zone-stack');

        // Determine insert position from DOM elements
        let insertBeforeColumnId = null;
        let insertAfterColumnId = null;

        if (isDropZone) {
            // Dropping on drop zone - find adjacent columns
            const prevStack = dropTargetStack.previousElementSibling;
            const nextStack = dropTargetStack.nextElementSibling;

            if (prevStack && prevStack.classList.contains('kanban-column-stack')) {
                const lastCol = prevStack.querySelector('.kanban-full-height-column:last-of-type');
                if (lastCol) {
                    insertAfterColumnId = lastCol.dataset?.columnId;
                }
            } else if (nextStack && nextStack.classList.contains('kanban-column-stack')) {
                const firstCol = nextStack.querySelector('.kanban-full-height-column:first-of-type');
                if (firstCol) {
                    insertBeforeColumnId = firstCol.dataset?.columnId;
                }
            }
        } else {
            // Dropping within a stack
            if (dropTargetBeforeColumn) {
                insertBeforeColumnId = dropTargetBeforeColumn.dataset?.columnId;
            } else {
                // Dropping at end of stack - insert after last column
                const lastCol = dropTargetStack.querySelector('.kanban-full-height-column:last-of-type');
                if (lastCol) {
                    insertAfterColumnId = lastCol.dataset?.columnId;
                }
            }
        }

        console.log('[ClipboardColumn DROP] Position calc:', {
            targetRow,
            isDropZone,
            insertBeforeColumnId,
            insertAfterColumnId
        });

        // Create column title - DON'T set #stack tag here, let normalizeAllStackTags handle it
        let columnTitle = parsedData.columnTitle || '';
        if (targetRow > 1 && !/#row\d+/i.test(columnTitle)) {
            columnTitle = columnTitle ? `${columnTitle} #row${targetRow}` : `#row${targetRow}`;
        }

        // Create new column with parsed tasks
        const newColumn = {
            id: `col-${Date.now()}`,
            title: columnTitle,
            tasks: parsedData.tasks,
            settings: {}
        };

        // Find insert position in cachedBoard.columns
        let insertIndex = window.cachedBoard.columns.length;

        if (insertBeforeColumnId) {
            const idx = window.cachedBoard.columns.findIndex(c => c.id === insertBeforeColumnId);
            if (idx >= 0) {
                insertIndex = idx;
            }
        } else if (insertAfterColumnId) {
            const idx = window.cachedBoard.columns.findIndex(c => c.id === insertAfterColumnId);
            if (idx >= 0) {
                insertIndex = idx + 1;
            }
        }

        console.log('[ClipboardColumn DROP] Inserting at index:', insertIndex);

        // Insert column into cachedBoard
        window.cachedBoard.columns.splice(insertIndex, 0, newColumn);

        // CRITICAL: Sort columns by row to match backend ordering
        if (typeof window.sortColumnsByRow === 'function') {
            window.cachedBoard.columns = window.sortColumnsByRow(window.cachedBoard.columns);
        }

        // Re-render the board - this creates the DOM structure
        if (typeof window.renderBoard === 'function') {
            window.renderBoard();
        }

        // CRITICAL: Normalize stack tags based on actual DOM structure (same as processColumnDrop)
        // This is the KEY - let the DOM structure determine the stack tags
        if (typeof window.normalizeAllStackTags === 'function') {
            window.normalizeAllStackTags();
        }

        // Mark as unsaved
        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }
    }

    // Reset templateDragState
    if (typeof window.templateDragState !== 'undefined') {
        window.templateDragState.isDragging = false;
        window.templateDragState.templatePath = null;
        window.templateDragState.templateName = null;
        window.templateDragState.isEmptyColumn = false;
        window.templateDragState.isClipboardColumn = false;
        window.templateDragState.clipboardContent = null;
        window.templateDragState.targetRow = null;
        window.templateDragState.targetPosition = null;
        window.templateDragState.targetColumnId = null;
        window.templateDragState.isDropZone = false;
        window.templateDragState.lastInStackTarget = null;
    }

    // Clear dragState drop targets
    if (window.dragState) {
        window.dragState.dropTargetStack = null;
        window.dragState.dropTargetBeforeColumn = null;
    }

    // Hide any internal drop indicator
    const indicator = document.querySelector('.internal-drop-indicator');
    if (indicator) {
        indicator.classList.remove('active');
    }
};

// =============================================================================
// TEMPLATE MENU DRAG HANDLERS
// =============================================================================

// Template menu item drag handlers (for columns menu)
window.handleTemplateMenuDragStart = function(e) {
    const templatePath = e.target.dataset.templatePath;
    const templateName = e.target.dataset.templateName;

    if (!templatePath) {
        e.preventDefault();
        return;
    }

    // Set template drag state
    if (typeof window.templateDragState !== 'undefined') {
        window.templateDragState.isDragging = true;
        window.templateDragState.templatePath = templatePath;
        window.templateDragState.templateName = templateName;
        window.templateDragState.isEmptyColumn = false;
    }

    // Set drag data
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', `template:${templatePath}`);
    e.dataTransfer.setData('application/x-kanban-template', JSON.stringify({
        path: templatePath,
        name: templateName
    }));

    // Visual feedback
    e.target.classList.add('dragging');

    // Add class to board for drop zone highlighting
    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardElement.classList.add('template-dragging');
    }
};

window.handleTemplateMenuDragEnd = function(e) {
    // Clear visual feedback
    e.target.classList.remove('dragging');

    // Remove drop zone highlighting
    const boardElement = document.getElementById('kanban-board');
    if (boardElement) {
        boardElement.classList.remove('template-dragging');
    }

    // Clear all tracked highlights efficiently
    if (typeof window.clearHighlights === 'function') {
        window.clearHighlights();
    }

    // If we have a valid drop target, apply the template
    if (typeof window.templateDragState !== 'undefined' &&
        window.templateDragState.isDragging &&
        window.templateDragState.targetRow !== null) {

        // Call the apply function from dragDrop.js
        if (typeof applyTemplateAtPosition === 'function') {
            applyTemplateAtPosition();
        } else if (typeof window.applyTemplateAtPosition === 'function') {
            window.applyTemplateAtPosition();
        } else {
            // Fallback: send message directly
            if (typeof vscode !== 'undefined') {
                vscode.postMessage({
                    type: 'applyTemplate',
                    templatePath: window.templateDragState.templatePath,
                    templateName: window.templateDragState.templateName,
                    targetRow: window.templateDragState.targetRow || 1,
                    insertAfterColumnId: window.templateDragState.targetPosition === 'after' ? window.templateDragState.targetColumnId : null,
                    insertBeforeColumnId: window.templateDragState.targetPosition === 'before' ? window.templateDragState.targetColumnId : null,
                    position: window.templateDragState.targetPosition
                });
            }
        }
    }

    // Reset state
    if (typeof window.templateDragState !== 'undefined') {
        window.templateDragState.isDragging = false;
        window.templateDragState.templatePath = null;
        window.templateDragState.templateName = null;
        window.templateDragState.isEmptyColumn = false;
        window.templateDragState.targetRow = null;
        window.templateDragState.targetPosition = null;
        window.templateDragState.targetColumnId = null;
        window.templateDragState.isDropZone = false;
    }

    // Hide any internal drop indicator
    const indicator = document.querySelector('.internal-drop-indicator');
    if (indicator) {
        indicator.classList.remove('active');
    }
};

// =============================================================================
// CLIPBOARD DATA MANAGEMENT
// =============================================================================

/**
 * Set clipboard card data from external source
 * @param {object} data - Clipboard data object
 */
function setClipboardCardData(data) {
    clipboardCardData = data;
}

/**
 * Get current clipboard card data
 * @returns {object|null} Current clipboard data
 */
function getClipboardCardData() {
    return clipboardCardData;
}

/**
 * Check if clipboard was recently checked (throttle)
 * @returns {boolean} True if should throttle
 */
function shouldThrottleClipboardCheck() {
    const now = Date.now();
    if (now - lastClipboardCheck < CLIPBOARD_CHECK_THROTTLE) {
        return true;
    }
    lastClipboardCheck = now;
    return false;
}

// =============================================================================
// DIAGRAM CARD DRAG HANDLERS (Excalidraw, Draw.io)
// =============================================================================

// Diagram drag state
let diagramDragState = {
    isDragging: false,
    diagramType: null  // 'excalidraw' or 'drawio'
};

/**
 * Handle diagram card drag start (Excalidraw or Draw.io)
 * @param {DragEvent} e - Drag event
 * @param {string} diagramType - Type of diagram ('excalidraw' or 'drawio')
 */
window.handleDiagramCardDragStart = function(e, diagramType) {
    // Set drag state
    diagramDragState.isDragging = true;
    diagramDragState.diagramType = diagramType;

    if (window.dragState) {
        window.dragState.isDragging = true;
        window.dragState.draggedDiagramCard = {
            type: diagramType,
            id: 'temp-diagram-' + Date.now()
        };
    }

    // Set drag data
    const dragData = JSON.stringify({
        type: 'diagram-card',
        diagramType: diagramType
    });
    e.dataTransfer.setData('text/plain', `DIAGRAM_CARD:${dragData}`);
    e.dataTransfer.effectAllowed = 'copy';

    // Add visual feedback
    e.target.classList.add('dragging');
};

/**
 * Handle diagram card drag end
 */
window.handleDiagramCardDragEnd = function(e) {
    // Clear visual feedback
    e.target.classList.remove('dragging');

    // Clear drag state
    diagramDragState.isDragging = false;
    diagramDragState.diagramType = null;

    if (window.dragState) {
        window.dragState.isDragging = false;
        window.dragState.draggedDiagramCard = null;
    }
};

/**
 * Handle diagram card drop - creates a new diagram file and task
 * @param {DragEvent} e - Drop event
 * @param {string} diagramData - JSON string with diagram type
 */
window.handleDiagramCardDrop = function(e, diagramData) {
    try {
        const parsedData = JSON.parse(diagramData);
        const diagramType = parsedData.diagramType;

        // Find target column using hierarchical lookup
        const dropResult = window.findDropPositionHierarchical
            ? window.findDropPositionHierarchical(e.clientX, e.clientY, null)
            : null;

        if (!dropResult || !dropResult.columnId) {
            vscode.postMessage({
                type: 'showMessage',
                text: 'Cannot create diagram: No target column found'
            });
            return;
        }

        // Find the column data to determine include file context
        const column = window.cachedBoard?.columns?.find(c => c.id === dropResult.columnId);
        if (!column) {
            vscode.postMessage({
                type: 'showMessage',
                text: 'Cannot create diagram: Column not found'
            });
            return;
        }

        // Determine the source file path for media folder
        // If column has includeFiles, use the first include file's path
        // Otherwise, use the main file path
        let sourceFilePath = null;
        if (column.includeFiles && column.includeFiles.length > 0) {
            sourceFilePath = column.includeFiles[0];
        }

        // Send message to backend to show dialog and create diagram
        vscode.postMessage({
            type: 'createDiagramFile',
            diagramType: diagramType,
            columnId: dropResult.columnId,
            insertionIndex: dropResult.insertionIndex,
            dropPosition: { x: e.clientX, y: e.clientY },
            sourceFilePath: sourceFilePath  // null means use main file
        });

    } catch (error) {
        console.error('Failed to handle diagram card drop:', error);
        vscode.postMessage({
            type: 'showMessage',
            text: 'Failed to create diagram: ' + error.message
        });
    }
};

// =============================================================================
// GLOBAL EXPORTS
// =============================================================================

window.setClipboardCardData = setClipboardCardData;
window.getClipboardCardData = getClipboardCardData;
window.shouldThrottleClipboardCheck = shouldThrottleClipboardCheck;
window.diagramDragState = diagramDragState;
