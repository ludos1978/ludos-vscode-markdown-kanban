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

    // If we have a valid drop target, create empty column using SAME logic as regular column drops
    if (typeof window.templateDragState !== 'undefined' &&
        window.templateDragState.isDragging &&
        window.templateDragState.isEmptyColumn &&
        window.templateDragState.targetRow !== null &&
        window.cachedBoard) {

        const targetRow = window.templateDragState.targetRow || 1;
        const targetPosition = window.templateDragState.targetPosition;
        const targetColumnId = window.templateDragState.targetColumnId;

        // CRITICAL: Determine if we need #stack BEFORE rendering, based on current DOM
        // This uses the same logic as processColumnDrop's stack normalization
        let needsStackTag = false;

        if (targetColumnId) {
            const targetColElement = document.querySelector(`[data-column-id="${targetColumnId}"]`);
            if (targetColElement) {
                const targetStack = targetColElement.closest('.kanban-column-stack:not(.column-drop-zone-stack)');
                if (targetStack) {
                    if (targetPosition === 'after') {
                        // Inserting after a column in a stack - always need #stack (we're not first)
                        needsStackTag = true;
                    } else if (targetPosition === 'before') {
                        // Inserting before target
                        const targetData = window.cachedBoard.columns.find(c => c.id === targetColumnId);
                        if (targetData) {
                            if (/#stack\b/i.test(targetData.title)) {
                                // Target has #stack - we're inserting into middle of stack
                                needsStackTag = true;
                            } else {
                                // Target is first in its stack - we become new first, target gets #stack
                                // Add #stack to target BEFORE rendering so it stays in the same stack
                                const trimmedTitle = targetData.title.trim();
                                targetData.title = trimmedTitle ? trimmedTitle + ' #stack' : '#stack';
                                // New column doesn't need #stack (it becomes the new first)
                                needsStackTag = false;
                            }
                        }
                    }
                }
            }
        }
        // 'first' or 'last' position means starting a new stack, so no #stack needed

        // Create new column data with correct #stack tag
        let columnTitle = 'New Column';
        if (targetRow > 1) {
            columnTitle = `New Column #row${targetRow}`;
        }
        if (needsStackTag) {
            columnTitle = columnTitle + ' #stack';
        }

        const newColumn = {
            id: `col-${Date.now()}`,
            title: columnTitle,
            tasks: [],
            settings: {}
        };

        // Find insert position in cachedBoard.columns based on target
        let insertIndex = window.cachedBoard.columns.length;

        if (targetColumnId) {
            const targetIdx = window.cachedBoard.columns.findIndex(c => c.id === targetColumnId);
            if (targetIdx >= 0) {
                if (targetPosition === 'after') {
                    insertIndex = targetIdx + 1;
                } else if (targetPosition === 'before') {
                    insertIndex = targetIdx;
                }
            }
        } else if (targetPosition === 'first' || targetPosition === 'last') {
            // Find position in target row
            const getColumnRow = (col) => {
                const rowMatch = col.title?.match(/#row(\d+)/i);
                return rowMatch ? parseInt(rowMatch[1], 10) : 1;
            };

            if (targetPosition === 'first') {
                const firstInRow = window.cachedBoard.columns.findIndex(c => getColumnRow(c) === targetRow);
                insertIndex = firstInRow >= 0 ? firstInRow : window.cachedBoard.columns.length;
            } else {
                // 'last' - find last column in row and insert after it
                let lastInRowIdx = -1;
                for (let i = 0; i < window.cachedBoard.columns.length; i++) {
                    if (getColumnRow(window.cachedBoard.columns[i]) === targetRow) {
                        lastInRowIdx = i;
                    }
                }
                insertIndex = lastInRowIdx >= 0 ? lastInRowIdx + 1 : window.cachedBoard.columns.length;
            }
        }

        // Insert column into cachedBoard
        window.cachedBoard.columns.splice(insertIndex, 0, newColumn);

        // Re-render the board - this creates the DOM structure with correct stacking
        if (typeof window.renderBoard === 'function') {
            window.renderBoard();
        }

        // Normalize ALL stack tags to handle edge cases (same as processColumnDrop does)
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

    // If we have a valid drop target, create column from clipboard content
    if (typeof window.templateDragState !== 'undefined' &&
        window.templateDragState.isDragging &&
        window.templateDragState.isClipboardColumn &&
        window.templateDragState.targetRow !== null &&
        window.cachedBoard) {

        const targetRow = window.templateDragState.targetRow || 1;
        const targetPosition = window.templateDragState.targetPosition;
        const targetColumnId = window.templateDragState.targetColumnId;
        const clipboardContent = window.templateDragState.clipboardContent;

        // Parse clipboard content into tasks
        const parsedData = parseClipboardPresentationContent(clipboardContent);

        // Determine if we need #stack tag (same logic as empty column)
        let needsStackTag = false;

        if (targetColumnId) {
            const targetColElement = document.querySelector(`[data-column-id="${targetColumnId}"]`);
            if (targetColElement) {
                const targetStack = targetColElement.closest('.kanban-column-stack:not(.column-drop-zone-stack)');
                if (targetStack) {
                    if (targetPosition === 'after') {
                        needsStackTag = true;
                    } else if (targetPosition === 'before') {
                        const targetData = window.cachedBoard.columns.find(c => c.id === targetColumnId);
                        if (targetData) {
                            if (/#stack\b/i.test(targetData.title)) {
                                needsStackTag = true;
                            } else {
                                const trimmedTitle = targetData.title.trim();
                                targetData.title = trimmedTitle ? trimmedTitle + ' #stack' : '#stack';
                                needsStackTag = false;
                            }
                        }
                    }
                }
            }
        }

        // Create column title
        let columnTitle = parsedData.columnTitle || '';
        if (targetRow > 1 && !/#row\d+/i.test(columnTitle)) {
            columnTitle = columnTitle ? `${columnTitle} #row${targetRow}` : `#row${targetRow}`;
        }
        if (needsStackTag && !/#stack\b/i.test(columnTitle)) {
            columnTitle = columnTitle ? `${columnTitle} #stack` : '#stack';
        }

        // Create new column with parsed tasks
        const newColumn = {
            id: `col-${Date.now()}`,
            title: columnTitle,
            tasks: parsedData.tasks,
            settings: {}
        };

        // Find insert position (same logic as empty column)
        let insertIndex = window.cachedBoard.columns.length;

        if (targetColumnId) {
            const targetIdx = window.cachedBoard.columns.findIndex(c => c.id === targetColumnId);
            if (targetIdx >= 0) {
                if (targetPosition === 'after') {
                    insertIndex = targetIdx + 1;
                } else if (targetPosition === 'before') {
                    insertIndex = targetIdx;
                }
            }
        } else if (targetPosition === 'first' || targetPosition === 'last') {
            const getColumnRow = (col) => {
                const rowMatch = col.title?.match(/#row(\d+)/i);
                return rowMatch ? parseInt(rowMatch[1], 10) : 1;
            };

            if (targetPosition === 'first') {
                const firstInRow = window.cachedBoard.columns.findIndex(c => getColumnRow(c) === targetRow);
                insertIndex = firstInRow >= 0 ? firstInRow : window.cachedBoard.columns.length;
            } else {
                let lastInRowIdx = -1;
                for (let i = 0; i < window.cachedBoard.columns.length; i++) {
                    if (getColumnRow(window.cachedBoard.columns[i]) === targetRow) {
                        lastInRowIdx = i;
                    }
                }
                insertIndex = lastInRowIdx >= 0 ? lastInRowIdx + 1 : window.cachedBoard.columns.length;
            }
        }

        // Insert column into cachedBoard
        window.cachedBoard.columns.splice(insertIndex, 0, newColumn);

        // Re-render the board
        if (typeof window.renderBoard === 'function') {
            window.renderBoard();
        }

        // Normalize stack tags
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
    }

    // Hide any internal drop indicator
    const indicator = document.querySelector('.internal-drop-indicator');
    if (indicator) {
        indicator.classList.remove('active');
    }
};

/**
 * Parse clipboard content in presentation format into column title and tasks
 * Mirrors the backend PresentationParser logic exactly
 *
 * Rules:
 * - Split content by \n\n---\n\n (slide separator)
 * - First slide: if it has title only (no content), use as column title
 * - Otherwise, column title is empty
 * - All remaining slides become tasks
 */
function parseClipboardPresentationContent(content) {
    if (!content) {
        return { columnTitle: '', tasks: [] };
    }

    // Normalize line endings (CRITICAL: must happen first)
    let workingContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Strip YAML frontmatter if present
    const yamlMatch = workingContent.match(/^---\n[\s\S]*?\n---\n/);
    if (yamlMatch) {
        workingContent = workingContent.substring(yamlMatch[0].length);
    }

    // CRITICAL: Temporarily replace HTML comments with placeholders
    // This prevents '---' inside comments from being treated as slide separators
    const comments = [];
    const contentWithPlaceholders = workingContent.replace(/<!--[\s\S]*?-->/g, (match) => {
        const index = comments.length;
        comments.push(match);
        return `__COMMENT_PLACEHOLDER_${index}__`;
    });

    // Split by slide separator (CRITICAL: use [ \t]* not \s* to avoid matching newlines)
    const rawSlides = contentWithPlaceholders.split(/\n\n---[ \t]*\n\n/);
    const slides = [];

    for (const slideContent of rawSlides) {
        const parsed = parseSlide(slideContent, comments);
        slides.push(parsed);
    }

    // Determine column title and tasks
    let columnTitle = '';
    let tasks = [];

    if (slides.length > 0) {
        const firstSlide = slides[0];
        // If first slide has title but no content (or only whitespace), use as column title
        if (firstSlide.title && (!firstSlide.content || firstSlide.content.trim() === '')) {
            columnTitle = firstSlide.title;
            // Remaining slides become tasks
            for (let i = 1; i < slides.length; i++) {
                tasks.push(slideToTask(slides[i]));
            }
        } else {
            // All slides become tasks
            for (const slide of slides) {
                tasks.push(slideToTask(slide));
            }
        }
    }

    return { columnTitle, tasks };
}

/**
 * Parse a single slide content into title and content
 * @param {string} slideContent - The slide content (may contain comment placeholders)
 * @param {string[]} comments - Array of original HTML comments to restore
 */
function parseSlide(slideContent, comments) {
    const lines = slideContent.split('\n');

    // Count leading empty lines
    let emptyLineCount = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') {
            emptyLineCount++;
        } else {
            break;
        }
    }

    // Find first content lines
    const contentLines = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== '') {
            contentLines.push(i);
            if (contentLines.length >= 2) break;
        }
    }

    let title = undefined;
    let descriptionStartLine = -1;

    if (contentLines.length >= 1) {
        if (emptyLineCount < 1) {
            // First content is title
            const firstContentLine = lines[contentLines[0]];
            // Check for structured content patterns that shouldn't be split
            const hasStructuredContentPattern = /---:|:--:|:---|<!--|\|.*\||^-\s/.test(firstContentLine);

            if (hasStructuredContentPattern) {
                title = undefined;
                descriptionStartLine = Math.min(contentLines[0], 3);
            } else {
                title = lines[contentLines[0]];
                const lineAfterTitle = contentLines[0] + 1;
                if (lineAfterTitle < lines.length && lines[lineAfterTitle] === '') {
                    descriptionStartLine = contentLines[0] + 2;
                } else {
                    descriptionStartLine = contentLines[0] + 1;
                }
            }
        } else {
            // No title, all is description
            title = undefined;
            descriptionStartLine = Math.min(contentLines[0], 3);
        }
    } else {
        title = undefined;
        descriptionStartLine = lines.length > 0 ? 0 : -1;
    }

    // Extract description
    let description = '';
    if (descriptionStartLine !== -1 && descriptionStartLine < lines.length) {
        const descriptionLines = [];
        for (let i = descriptionStartLine; i < lines.length; i++) {
            descriptionLines.push(lines[i]);
        }
        description = descriptionLines.join('\n');
    }

    // Restore HTML comments from placeholders
    const restoreComments = (text) => {
        if (!text || !comments || comments.length === 0) return text;
        return text.replace(/__COMMENT_PLACEHOLDER_(\d+)__/g, (match, index) => {
            return comments[parseInt(index)] || match;
        });
    };

    return {
        title: restoreComments(title),
        content: restoreComments(description)
    };
}

/**
 * Convert parsed slide to task object
 */
function slideToTask(slide) {
    return {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: slide.title || '',
        description: slide.content || ''
    };
}

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
