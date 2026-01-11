let scrollPositions = new Map();

/**
 * Insert HTML nodes from a string before or after a reference element
 * @param {string} htmlString - HTML string to insert
 * @param {HTMLElement} referenceElement - Element to insert relative to
 * @param {string} position - 'before' or 'after'
 */
function insertHtmlNodes(htmlString, referenceElement, position = 'before') {
    if (!htmlString || !htmlString.trim() || !referenceElement) return;

    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = htmlString;

    if (position === 'after') {
        let insertAfter = referenceElement;
        while (tempContainer.firstChild) {
            insertAfter.parentNode.insertBefore(tempContainer.firstChild, insertAfter.nextSibling);
            insertAfter = insertAfter.nextSibling;
        }
    } else {
        while (tempContainer.firstChild) {
            referenceElement.parentNode.insertBefore(tempContainer.firstChild, referenceElement);
        }
    }
}

// Make folding state variables global for persistence
window.collapsedColumns = window.collapsedColumns || new Set();
window.collapsedTasks = window.collapsedTasks || new Set();
window.columnFoldStates = window.columnFoldStates || new Map(); // Track last manual fold state for each column
window.globalColumnFoldState = window.globalColumnFoldState || 'fold-mixed'; // Track global column fold state

// Template bar state
window.availableTemplates = window.availableTemplates || [];
window.showTemplateBar = window.showTemplateBar !== false; // Default to true

let renderTimeout = null;

/**
 * TASK INITIALIZATION
 *
 * Centralized function to initialize task elements with all required event handlers.
 * Called explicitly after:
 * - Full board render (renderBoard)
 * - Single column re-render (renderSingleColumn)
 * - Single task add (addSingleTaskToDOM)
 * - Drag & drop move (dragDrop.js)
 *
 * @param {HTMLElement} taskElement - The task DOM element to initialize
 * @returns {boolean} - True if initialization succeeded, false otherwise
 */
function initializeTaskElement(taskElement) {
    if (!taskElement) {
        console.warn('[TaskInit] initializeTaskElement: No task element provided');
        return false;
    }

    // Check if already initialized (idempotent - safe to call multiple times)
    if (taskElement.dataset.taskInitialized === 'true') {
        return true; // Already initialized, nothing to do
    }

    const taskId = taskElement.dataset.taskId;

    // 1. DRAG HANDLER SETUP
    const dragHandle = taskElement.querySelector('.task-drag-handle');
    if (dragHandle) {
        // Setup drag handler using existing function from dragDrop.js
        // Note: setupTaskDragHandle has its own duplicate prevention via dataset.dragSetup
        // We rely on that instead of clearing the marker ourselves
        if (typeof setupTaskDragHandle === 'function') {
            setupTaskDragHandle(dragHandle);
        } else {
            console.warn('[TaskInit] setupTaskDragHandle function not available');
        }
    }

    // 2. EDIT HANDLER VERIFICATION (defensive check)
    // Edit handlers are attached via inline onclick attributes in HTML.
    // We check for both .onclick property AND onclick attribute to avoid false positives.
    const columnEl = taskElement.closest('[data-column-id]');
    if (columnEl) {
        const columnId = columnEl.dataset.columnId;

        // Verify title click handler - check container (where onclick is defined)
        const titleContainer = taskElement.querySelector('.task-title-container');
        if (titleContainer && !titleContainer.onclick && !titleContainer.hasAttribute('onclick')) {
            const titleEl = taskElement.querySelector('.task-title-display');
            if (titleEl) {
                titleEl.onclick = (e) => handleTaskTitleClick(e, titleEl, taskId, columnId);
            }
        }

        // Verify description click handler - check the actual display element (not container)
        const descEl = taskElement.querySelector('.task-description-display');
        if (descEl && !descEl.onclick && !descEl.hasAttribute('onclick')) {
            descEl.onclick = (e) => handleDescriptionClick(e, descEl, taskId, columnId);
        }

        // Verify collapse toggle click handler
        const collapseToggle = taskElement.querySelector('.task-collapse-toggle');
        if (collapseToggle && !collapseToggle.onclick && !collapseToggle.hasAttribute('onclick')) {
            collapseToggle.onclick = () => {
                toggleTaskCollapseById(taskId, columnId);
                if (typeof updateFoldAllButton === 'function') {
                    updateFoldAllButton(columnId);
                }
            };
        }
    }

    // 3. VISUAL ELEMENTS SETUP
    // Inject stackable bars (headers/footers) for this specific task
    if (window.injectStackableBars) {
        window.injectStackableBars(taskElement);
    }

    // Update visual tag elements (badges) for this specific task
    if (window.updateAllVisualTagElements) {
        const tags = taskElement.getAttribute('data-all-tags');
        if (tags) {
            const tagArray = tags.split(' ').filter(tag => tag.trim());
            window.updateAllVisualTagElements(taskElement, tagArray, 'task');
        }
    }

    // Mark as initialized
    taskElement.dataset.taskInitialized = 'true';

    return true;
}

// Make globally accessible
window.initializeTaskElement = initializeTaskElement;

/**
 * Generate alternative title from task description when no title exists
 *
 * Format for images:
 * ![alt text](path/to/screenshot.png "image description") => image description - alt text
 * ![](path/to/screenshot.png "image description") => image description (screenshot.png)
 * ![alt text](path/to/screenshot.png) => alt text (screenshot.png)
 * ![](path/to/screenshot.png) => (screenshot.png)
 *
 * If no images: Use first 20 characters of text
 */
function generateAlternativeTitle(description) {
    if (!description || typeof description !== 'string' || description.trim() === '') {
        return undefined;
    }

    // Match markdown images: ![alt text](path "title")
    const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/;
    const match = imageRegex.exec(description);

    if (match) {
        const altText = match[1] || '';  // Can be empty
        const imagePath = match[2];
        const imageDescription = match[3] || '';  // Title attribute

        // Extract filename from path
        const filename = imagePath.split('/').pop().split('\\').pop() || imagePath;

        // Apply formatting rules
        if (imageDescription && altText) {
            // Rule 1: image description - alt text
            return `${imageDescription} - ${altText}`;
        } else if (imageDescription && !altText) {
            // Rule 2: image description (filename)
            return `${imageDescription} (${filename})`;
        } else if (altText && !imageDescription) {
            // Rule 3: alt text (filename)
            return `${altText} (${filename})`;
        } else {
            // Rule 4: (filename)
            return `(${filename})`;
        }
    }

    // Fallback: First 20 characters of text content
    // Remove all markdown syntax to get clean text
    let cleanText = description
        .replace(/^#+\s+/gm, '')           // Remove headers
        .replace(/^\s*[-*+]\s+/gm, '')     // Remove list markers
        .replace(/^\s*\d+\.\s+/gm, '')     // Remove numbered lists
        .replace(/!\[.*?\]\(.*?\)/g, '')   // Remove images
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
        .replace(/\[\[([^\]]+)\]\]/g, '$1')      // Convert wiki links to text
        .replace(/`{1,3}[^`]*`{1,3}/g, '')       // Remove code
        .replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, '$1') // Remove bold/italic
        .replace(/\n+/g, ' ')              // Replace newlines with spaces
        .trim();

    if (cleanText.length > 0) {
        // Return first 60 characters (no ellipsis - CSS will handle overflow)
        if (cleanText.length > 60) {
            return cleanText.substring(0, 60);
        }
        return cleanText;
    }

    return undefined;
}

// Cache board element reference for performance
let cachedBoardElement = null;
function getBoardElement() {
    if (!cachedBoardElement) {
        cachedBoardElement = document.getElementById('kanban-board');
    }
    return cachedBoardElement;
}

// cachedEditorBg, getEditorBackground moved to utils/tagStyleManager.js

/**
 * Gets the column ID for any element by traversing up the DOM tree
 * This avoids storing redundant data-column-id on task elements
 * @param {HTMLElement} element - Any element within a column
 * @returns {string|null} The column ID, or null if not found
 */
function getColumnIdFromElement(element) {
    if (!element) return null;
    const columnElement = element.closest('.kanban-full-height-column');
    return columnElement?.dataset.columnId || null;
}

/**
 * Gets the task ID for any element by traversing up the DOM tree
 * This avoids storing redundant data-task-id on child elements
 * @param {HTMLElement} element - Any element within a task
 * @returns {string|null} The task ID, or null if not found
 */
function getTaskIdFromElement(element) {
    if (!element) return null;
    const taskElement = element.closest('.task-item');
    return taskElement?.dataset.taskId || null;
}

/**
 * Finds a task by ID across all columns in the cached board
 * @param {string} taskId - The task ID to find
 * @returns {object|null} The task object, or null if not found
 */
function findTaskById(taskId) {
    if (!window.cachedBoard?.columns) return null;
    for (const column of window.cachedBoard.columns) {
        const task = column.tasks.find(t => t.id === taskId);
        if (task) return task;
    }
    return null;
}

// Make them globally accessible
window.getColumnIdFromElement = getColumnIdFromElement;
window.getTaskIdFromElement = getTaskIdFromElement;
window.findTaskById = findTaskById;

// extractFirstTag function now in utils/tagUtils.js


// Import colorUtils at the top of the file (will be included via HTML)
// The colorUtils module provides: hexToRgb, rgbToHex, withAlpha, etc.



/**
 * Wraps rendered HTML content in task-section divs for keyboard navigation
 * Sections are separated by <hr> tags
 * @param {string} html - Rendered HTML content
 * @returns {string} HTML with sections wrapped
 */
function wrapTaskSections(html) {
    // Always create at least one section, even for empty content
    // This ensures tasks are focusable with keyboard navigation
    if (!html || !html.trim()) {
        return `<div class="task-section" tabindex="0"></div>`;
    }

    // Create a temporary container to parse the HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const hrs = Array.from(temp.querySelectorAll('hr'));

    if (hrs.length === 0) {
        // No HRs: wrap entire content in a section
        return `<div class="task-section" tabindex="0">${html}</div>`;
    }

    // Has HRs: wrap sections between HRs
    const sections = [];
    let currentSection = [];

    Array.from(temp.childNodes).forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'HR') {
            // Save current section if it has content
            if (currentSection.length > 0) {
                sections.push({ type: 'section', nodes: currentSection });
                currentSection = [];
            }
            sections.push({ type: 'hr', node: node });
        } else {
            currentSection.push(node);
        }
    });

    // Don't forget the last section
    if (currentSection.length > 0) {
        sections.push({ type: 'section', nodes: currentSection });
    }

    // Build HTML string
    return sections.map(section => {
        if (section.type === 'hr') {
            return section.node.outerHTML;
        } else {
            const sectionHtml = section.nodes.map(node =>
                node.nodeType === Node.ELEMENT_NODE ? node.outerHTML : node.textContent
            ).join('');
            return `<div class="task-section" tabindex="0">${sectionHtml}</div>`;
        }
    }).join('');
}

// applyTagStyles, ensureTagStyleExists moved to utils/tagStyleManager.js



/**
 * Debounced board rendering to prevent performance issues
 * Purpose: Prevents rapid re-renders when multiple updates occur
 * Used by: All board update operations
 * Delay: 50ms to batch multiple changes
 */
function debouncedRenderBoard() {
    if (renderTimeout) {
        clearTimeout(renderTimeout);
    }

    renderTimeout = setTimeout(() => {
        renderBoard();
        renderTimeout = null;
    }, 50);
}

// applyDefaultFoldingState, setDefaultFoldingState, getGlobalColumnFoldState,
// toggleAllColumns, updateGlobalColumnFoldButton, applyFoldingStates
// moved to utils/columnFoldingManager.js

// Helper function to get active tags in a title
/**
 * Extracts all active tag names from text (without # symbol)
 * Purpose: Identifies which tags are applied to an element
 * Used by: Tag menu generation, visual tag state updates
 * @param {string} text - Text containing hashtags
 * @returns {Array<string>} Lowercase tag names without #
 */
function getActiveTagsInTitle(text) {
    if (!text || typeof text !== 'string') {return [];}

    const tags = [];

    // Match standard tags (alphanumeric, gather tags, etc.)
    // Skip layout tags: row, span, and stack
    // Must start with alphanumeric or underscore to exclude pure symbol tags like ++, --, etc.
    const standardMatches = text.match(/#(?!row\d+\b)(?!span\d+\b)(?!stack\b)([a-zA-Z0-9_][a-zA-Z0-9_-]*(?:[&|=><][a-zA-Z0-9_-]+)*)/g) || [];
    standardMatches.forEach(tag => {
        const fullTag = tag.substring(1);
        // For gather tags, keep the full expression
        if (fullTag.startsWith('gather_')) {
            tags.push(fullTag);
        } else {
            // For other tags, extract base name
            const baseMatch = fullTag.match(/^([a-zA-Z0-9_][a-zA-Z0-9_-]*)/);
            if (baseMatch) {
                tags.push(baseMatch[1].toLowerCase());
            }
        }
    });

    // Match special positivity tags: #++, #+, #ø, #-, #--
    // Use negative lookahead to ensure - doesn't match when it's part of --
    // Order matters: match longer patterns first
    const positivityMatches = text.match(/#(\+\+|--|\+|ø|Ø|-(?!-))/g) || [];
    positivityMatches.forEach(tag => {
        const symbol = tag.substring(1).toLowerCase();
        tags.push(symbol);
    });

    return tags;
}

// Helper function to collect all tags currently in use across the board
/**
 * Collects all unique tags currently used in the board
 * Purpose: Builds complete tag inventory for menus
 * Used by: Tag menu generation, available tags display
 * @returns {Set<string>} Unique lowercase tag names
 */
function getAllTagsInUse() {
    const tagsInUse = new Set();
    
    if (!window.cachedBoard || !window.cachedBoard.columns) {return tagsInUse;}
    
    // Collect tags from all columns and tasks
    window.cachedBoard.columns.forEach(column => {
        // Get tags from column title
        const columnTags = getActiveTagsInTitle(column.title);
        columnTags.forEach(tag => tagsInUse.add(tag.toLowerCase()));
        
        // Get tags from all tasks
        column.tasks.forEach(task => {
            const taskTitleTags = getActiveTagsInTitle(task.title);
            taskTitleTags.forEach(tag => tagsInUse.add(tag.toLowerCase()));
            
            const taskDescTags = getActiveTagsInTitle(task.description);
            taskDescTags.forEach(tag => tagsInUse.add(tag.toLowerCase()));
        });
    });
    
    return tagsInUse;
}

  // Helper function to get user-added tags (not in configuration)
/**
 * Gets tags that users added but aren't in configuration
 * Purpose: Shows custom/unconfigured tags in menus
 * Used by: Tag menu generation for 'Custom Tags' section
 * @returns {Array<string>} Sorted array of custom tag names
 */
function getUserAddedTags() {
    const allTagsInUse = getAllTagsInUse();
    const configuredTags = new Set();
    const tagConfig = window.tagColors || {};
    
    // Dynamically collect all configured tags regardless of group names
    Object.keys(tagConfig).forEach(key => {
        // Skip the default group (contains column/card defaults, not tags)
        if (key === 'default') return;

        const value = tagConfig[key];

        // Check if this is a group (contains objects)
        if (value && typeof value === 'object') {
            // Check if this is a direct tag configuration (has any styling properties)
            const isDirectTag = value.light || value.dark || value.headerBar ||
                               value.border || value.footerBar || value.cornerBadge;

            if (isDirectTag) {
                // This is a direct tag configuration
                configuredTags.add(key.toLowerCase());
            } else {
                // This might be a group, check its children
                Object.keys(value).forEach(subKey => {
                    const subValue = value[subKey];
                    if (subValue && typeof subValue === 'object') {
                        // Check if this has any valid tag styling properties
                        const hasTagProperties = subValue.light || subValue.dark || subValue.headerBar ||
                                                subValue.border || subValue.footerBar || subValue.cornerBadge;
                        if (hasTagProperties) {
                            configuredTags.add(subKey.toLowerCase());
                        }
                    }
                });
            }
        }
    });
    
    // Find tags that are in use but not configured
    const userAddedTags = [];
    allTagsInUse.forEach(tag => {
        if (!configuredTags.has(tag) && !tag.startsWith('row')) { // Exclude row tags
            userAddedTags.push(tag);
        }
    });
    
    return userAddedTags.sort(); // Sort alphabetically
}

/**
 * Find first tag that has a specific styling property defined
 * Purpose: Determines which tag should provide each type of styling (border, background, etc.)
 * Used by: Column and task rendering to set styling attributes
 * @param {string} text - Text containing tags
 * @param {string} property - Property to check for ('border', 'background', 'headerBar', 'footerBar', 'cornerBadge')
 * @returns {string|null} First tag with that property or null
 */
function getFirstTagWithProperty(text, property) {
    const allTags = getActiveTagsInTitle(text);

    for (const tagName of allTags) {
        // Skip layout tags
        if (tagName.startsWith('row') || tagName.startsWith('gather_') || tagName.startsWith('span') || tagName === 'stack') continue;

        // Skip sticky tag
        if (tagName === 'sticky') continue;

        const config = window.getTagConfig(tagName);
        if (!config) continue; // Skip tags with no configuration (like numeric tags #1, #2, etc.)

        // Check if this tag has the requested property
        if (property === 'background') {
            // Check for background in light/dark themes or direct background
            const hasBackground = (config.light?.background || config.dark?.background ||
                                  config.column?.light?.background || config.column?.dark?.background ||
                                  config.card?.light?.background || config.card?.dark?.background);
            if (hasBackground) return tagName;
        } else if (property === 'border') {
            if (config.border) return tagName;
        } else if (config[property]) {
            return tagName;
        }
    }

    return null;
}

// Helper function to generate tag menu items from configuration and user-added tags
/**
 * Generates complete HTML for tag selection menu
 * Purpose: Creates interactive tag toggle menu for columns/tasks
 * Used by: Column and task burger menus
 * @param {string} id - Element ID (column or task)
 * @param {string} type - 'column' or 'task'
 * @param {string} columnId - Parent column ID for tasks
 * @returns {string} HTML string for menu items
 */
function generateTagMenuItems(id, type, columnId = null) {
    const tagConfig = window.tagColors || {};

    const userAddedTags = getUserAddedTags();

    let menuHtml = '';
    let hasAnyTags = false;
    
    // Get enabled categories based on element type
    const enabledCategories = type === 'column'
        ? (window.enabledTagCategoriesColumn || {})
        : (window.enabledTagCategoriesTask || {});

    // Map group keys to config keys (kebab-case to camelCase)
    const groupKeyToConfigKey = (groupKey) => {
        // Convert kebab-case to camelCase: 'content-type-teaching' -> 'contentTypeTeaching'
        return groupKey.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    };

    // Dynamically generate menu for all groups in configuration
    Object.keys(tagConfig).forEach(groupKey => {
        // Skip the default group (contains column/card defaults, not tags)
        if (groupKey === 'default') return;

        // Check if this category is enabled for the current element type
        const configKey = groupKeyToConfigKey(groupKey);
        if (enabledCategories[configKey] !== true) {
            return; // Skip if NOT explicitly enabled
        }

        const groupValue = tagConfig[groupKey];

        // Check if this is a group (contains tag objects)
        if (groupValue && typeof groupValue === 'object') {
            let groupTags = [];

            // Check if this is a direct tag configuration (has any styling properties)
            const isDirectTag = groupValue.light || groupValue.dark || groupValue.headerBar ||
                               groupValue.border || groupValue.footerBar || groupValue.cornerBadge;

            if (isDirectTag) {
                // This is a single tag, not a group
                groupTags = [groupKey];
            } else {
                // This is a group, collect its tags
                Object.keys(groupValue).forEach(tagKey => {
                    const tagValue = groupValue[tagKey];
                    if (tagValue && typeof tagValue === 'object') {
                        // Check if this has any valid tag styling properties
                        const hasTagProperties = tagValue.light || tagValue.dark || tagValue.headerBar ||
                                                tagValue.border || tagValue.footerBar || tagValue.cornerBadge;
                        if (hasTagProperties) {
                            groupTags.push(tagKey);
                        }
                    }
                });
            }
            
            if (groupTags.length > 0) {
                hasAnyTags = true;

                // Use dynamic submenu generation - just add placeholder with data attributes
                // Count badges will be added dynamically by updateTagCategoryCounts() when menu opens
                const groupLabel = groupKey.charAt(0).toUpperCase() + groupKey.slice(1);
                menuHtml += `
                    <div class="donut-menu-item has-submenu" data-submenu-type="tags" data-group="${groupKey}" data-id="${id}" data-type="${type}" data-column-id="${columnId || ''}" style="display: flex; align-items: center;">
                        <span>${groupLabel}</span>
                    </div>
                `;
            }
        }
    });
    
    // Add user-added tags if any exist
    if (userAddedTags.length > 0) {
        hasAnyTags = true;
        // Count badges will be added dynamically by updateTagCategoryCounts() when menu opens

        menuHtml += `
            <div class="donut-menu-item has-submenu" data-submenu-type="tags" data-group="custom" data-id="${id}" data-type="${type}" data-column-id="${columnId || ''}" style="display: flex; align-items: center;">
                <span>Custom Tags</span>
            </div>
        `;
    }
    
    // Note: "Remove all tags" option is added dynamically by updateTagCategoryCounts() when tags are active

    // If no tags at all, show a message (but keep data attributes for updateTagCategoryCounts)
    if (!hasAnyTags) {
        menuHtml = `<button class="donut-menu-item" disabled data-group="none" data-id="${id}" data-type="${type}" data-column-id="${columnId || ''}">No tags available</button>`;
    }

    return menuHtml;
}

/**
 * Regenerates all burger menus' tag sections with updated configuration
 * Called when tag categories are enabled/disabled in settings
 * This avoids a full board re-render by only updating the tag menu parts
 */
function regenerateAllBurgerMenus() {
    const columns = document.querySelectorAll('.kanban-full-height-column');

    // Find all column dropdowns and update their tag menu sections
    columns.forEach(columnElement => {
        const columnId = columnElement.getAttribute('data-column-id');
        if (!columnId) return;

        const dropdown = columnElement.querySelector('.donut-menu-dropdown');
        if (!dropdown) return;

        // Find tag menu items using data-group attribute (catches both tag categories and "No tags available")
        // Tag items have: data-group="groupKey" and data-type="column"
        const tagItems = Array.from(dropdown.querySelectorAll('[data-group][data-type="column"]'));

        if (tagItems.length === 0) {
            // No existing tag items - find where to insert (after "Move column right" divider)
            const moveRightBtn = dropdown.querySelector('[onclick*="moveColumnRight"]');
            if (moveRightBtn) {
                let divider = moveRightBtn.nextElementSibling;
                if (divider && divider.classList.contains('donut-menu-divider')) {
                    // Create new tag menu HTML and insert after the divider
                    const newTagHtml = generateTagMenuItems(columnId, 'column', null);
                    insertHtmlNodes(newTagHtml, divider, 'after');
                }
            }
        } else {
            // Get insertion point (before first tag item)
            const insertPoint = tagItems[0];

            // Generate new tag menu HTML and insert before first tag item
            const newTagHtml = generateTagMenuItems(columnId, 'column', null);
            insertHtmlNodes(newTagHtml, insertPoint, 'before');

            // Remove old items
            tagItems.forEach(item => item.remove());
        }
    });

    // Find all task dropdowns and update their tag menu sections
    document.querySelectorAll('.task-item').forEach(taskElement => {
        const taskId = taskElement.getAttribute('data-task-id');
        const columnElement = taskElement.closest('.kanban-full-height-column');
        const columnId = columnElement?.getAttribute('data-column-id');
        if (!taskId || !columnId) return;

        const dropdown = taskElement.querySelector('.donut-menu-dropdown');
        if (!dropdown) return;

        // Find tag menu items using data-group attribute
        const tagItems = Array.from(dropdown.querySelectorAll('[data-group][data-type="task"]'));
        if (tagItems.length === 0) return; // Skip if no tag section exists

        // Get insertion point and generate new tag menu HTML
        const insertPoint = tagItems[0];
        const newTagHtml = generateTagMenuItems(taskId, 'task', columnId);
        insertHtmlNodes(newTagHtml, insertPoint, 'before');

        // Remove old items
        tagItems.forEach(item => item.remove());
    });
}
window.regenerateAllBurgerMenus = regenerateAllBurgerMenus;

// Helper function to generate tag items for a group (horizontal layout)
function generateGroupTagItems(tags, id, type, columnId = null, isConfigured = true) {

    // Get current title to check which tags are active
    let currentTitle = '';
    if (type === 'column') {
        const column = window.cachedBoard?.columns?.find(c => c.id === id);
        currentTitle = column?.title || '';
    } else if (type === 'task' && columnId) {
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === id);
        currentTitle = task?.title || '';
    }

    // Check which tags are currently in the title
    const activeTags = getActiveTagsInTitle(currentTitle);
    
    // Create a grid container with tag buttons
    const tagButtons = tags.map(tagName => {
        const isActive = activeTags.includes(tagName.toLowerCase());
        const checkbox = isActive ? '✓' : '';

        // Create unique ID for this button - encode special characters to avoid collisions
        // E.g., ++ becomes plus-plus, -- becomes minus-minus, ø becomes o-slash
        const encodedTag = tagName
            .replace(/\+\+/g, 'plus-plus')
            .replace(/\+/g, 'plus')
            .replace(/--/g, 'minus-minus')
            .replace(/-/g, 'minus')
            .replace(/ø/gi, 'o-slash');
        const buttonId = `tag-chip-${type}-${id}-${encodedTag}`.replace(/[^a-zA-Z0-9-]/g, '-');

        const displayName = isConfigured ? tagName : tagName;
        const title = isConfigured ? tagName : `Custom tag: ${tagName}`;
        
        // Store the handler in a global object
        if (!window.tagHandlers) {window.tagHandlers = {};}
        window.tagHandlers[buttonId] = function(event) {
            event.stopPropagation();
            event.preventDefault();
            if (type === 'column') {
                if (typeof handleColumnTagClick === 'function') {
                    handleColumnTagClick(id, tagName, event);
                } else if (typeof window.handleColumnTagClick === 'function') {
                    window.handleColumnTagClick(id, tagName, event);
                }
                // No handler available - fail silently
            } else {
                if (typeof handleTaskTagClick === 'function') {
                    handleTaskTagClick(id, columnId, tagName, event);
                } else if (typeof window.handleTaskTagClick === 'function') {
                    window.handleTaskTagClick(id, columnId, tagName, event);
                }
                // No handler available - fail silently
            }
            return false;
        };
        
        return `
            <button id="${buttonId}"
                    class="donut-menu-tag-chip kanban-tag ${isActive ? 'active' : ''} ${isConfigured ? '' : 'custom-tag'}"
                    data-tag="${tagName.toLowerCase()}"
                    data-tag-name="${tagName}"
                    data-tag-type="${type}"
                    onmousedown="event.preventDefault();"
                    onclick="window.tagHandlers['${buttonId}'](event); return false;"
                    title="${title}">
                <span class="tag-chip-check">${checkbox}</span>
                <span class="tag-chip-name">${displayName}</span>
            </button>
        `;
    }).join('');
    
    return tagButtons;
}


// Helper function for flat structure (backward compatibility)
function generateFlatTagItems(tags, id, type, columnId = null) {
    if (tags.length === 0) {
        return '<button class="donut-menu-item" disabled>No tags configured</button>';
    }
    
    // Get current title to check which tags are active
    let currentTitle = '';
    if (type === 'column') {
        const column = window.cachedBoard?.columns?.find(c => c.id === id);
        currentTitle = column?.title || '';
    } else if (type === 'task' && columnId) {
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === id);
        currentTitle = task?.title || '';
    }
    
    // Check which tags are currently in the title
    const activeTags = getActiveTagsInTitle(currentTitle);
    
    // Create horizontal layout for flat structure too
    return tags.map(tagName => {
        const isActive = activeTags.includes(tagName.toLowerCase());
        const checkbox = isActive ? '✓' : '';
        const onclick = type === 'column'
            ? `handleColumnTagClick('${id}', '${tagName}', event)`
            : `handleTaskTagClick('${id}', '${columnId}', '${tagName}', event)`;

        return `
            <button class="donut-menu-tag-chip ${isActive ? 'active' : ''}"
                    onmousedown="event.preventDefault();"
                    onclick="${onclick}"
                    data-element-id="${id}"
                    data-tag-name="${tagName}"
                    title="${tagName}">
                <span class="tag-chip-check">${checkbox}</span>
                <span class="tag-chip-name">${tagName}</span>
            </button>
        `;
    }).join('');
}


/**
 * Render a single column - used for targeted updates of include columns
 * Purpose: Updates just one column without losing overall board state
 * Used by: Include file changes, targeted column updates
 * Side effects: Updates DOM for specific column, preserves styles
 */
function renderSingleColumn(columnId, columnData) {

    // Find the existing column element (must target the column root, not nested elements)
    const matchingColumns = Array.from(document.querySelectorAll(`.kanban-full-height-column[data-column-id="${columnId}"]`));
    const existingColumnElement = matchingColumns[0];
    if (!existingColumnElement) {
        console.warn('[kanban.boardRenderer.renderSingleColumn.missing-element]', {
            columnId: columnId,
            hasCachedBoard: !!window.cachedBoard,
            cachedColumnIds: window.cachedBoard?.columns?.map(c => c.id) || [],
            matchCount: matchingColumns.length
        });
        if (typeof window.renderBoard === 'function') {
            console.warn('[kanban.boardRenderer.renderSingleColumn.full-render]', {
                columnId: columnId
            });
            window.renderBoard();
        }
        return;
    }

    // Clean up old tag handlers for this column to prevent memory leaks
    if (window.tagHandlers) {
        // Find all tag handlers that belong to this column (both column tags and task tags)
        const handlersToCleanup = Object.keys(window.tagHandlers).filter(key => {
            // Pattern: tag-chip-column-{columnId}-{tagName} or tag-chip-task-{taskId}-{tagName}
            return key.startsWith(`tag-chip-column-${columnId}-`) ||
                   (key.startsWith(`tag-chip-task-`) && existingColumnElement.querySelector(`[data-task-id]`));
        });

        // Also find task handlers by checking actual task IDs in the existing column
        const taskElements = existingColumnElement.querySelectorAll('[data-task-id]');
        taskElements.forEach(taskEl => {
            const taskId = taskEl.getAttribute('data-task-id');
            const taskHandlerPrefix = `tag-chip-task-${taskId}-`;
            Object.keys(window.tagHandlers).forEach(key => {
                if (key.startsWith(taskHandlerPrefix)) {
                    handlersToCleanup.push(key);
                }
            });
        });

        // Remove duplicates and clean up
        const uniqueHandlers = [...new Set(handlersToCleanup)];
        uniqueHandlers.forEach(key => {
            delete window.tagHandlers[key];
        });
    }

    // Get the column index to maintain positioning
    if (matchingColumns.length > 1) {
        console.warn('[kanban.boardRenderer.renderSingleColumn.multiple-matches]', {
            columnId: columnId,
            matchCount: matchingColumns.length
        });
    }

    const allColumns = Array.from(document.querySelectorAll('.kanban-full-height-column[data-column-id]'));
    const columnIndex = allColumns.indexOf(existingColumnElement);
    const existingTaskCount = existingColumnElement.querySelectorAll('.task-item').length;
    if (window.kanbanDebug && window.kanbanDebug.enabled) {
        window.kanbanDebug.log('[kanban.boardRenderer.renderSingleColumn.replace]', {
            columnId: columnId,
            columnIndex: columnIndex,
            taskCount: columnData?.tasks?.length ?? 0,
            existingTaskCount: existingTaskCount
        });
    }

    // Create new column element
    const newColumnElement = createColumnElement(columnData, columnIndex);

    // Preserve scroll position
    const tasksContainer = existingColumnElement.querySelector(`#tasks-${columnId}`);
    const scrollTop = tasksContainer ? tasksContainer.scrollTop : 0;

    // Replace the old element with the new one
    existingColumnElement.parentNode.replaceChild(newColumnElement, existingColumnElement);

    // Restore scroll position
    const newTasksContainer = newColumnElement.querySelector(`#tasks-${columnId}`);
    if (newTasksContainer) {
        if (typeof window.logViewMovement === 'function') {
            window.logViewMovement('renderSingleColumn.restoreScroll', {
                columnId,
                scrollTop
            });
        }
        newTasksContainer.scrollTop = scrollTop;
    }

    const renderedTaskIds = Array.from(newColumnElement.querySelectorAll('.task-item'))
        .map(taskElement => taskElement.getAttribute('data-task-id'));
    if (window.kanbanDebug && window.kanbanDebug.enabled) {
        window.kanbanDebug.log('[kanban.boardRenderer.renderSingleColumn.dom]', {
            columnId: columnId,
            renderedTaskCount: renderedTaskIds.length,
            renderedTaskIds: renderedTaskIds
        });
    }

    // Apply current column state (collapsed/expanded)
    if (window.collapsedColumns && window.collapsedColumns.has(columnId)) {
        const foldMode = window.columnFoldModes?.get(columnId) || getDefaultFoldMode(columnId);
        if (foldMode === 'vertical') {
            newColumnElement.classList.add('collapsed-vertical');
        } else {
            newColumnElement.classList.add('collapsed-horizontal');
        }
        const toggle = newColumnElement.querySelector('.collapse-toggle');
        if (toggle) {
            toggle.classList.add('rotated');
        }
    }

    // Update image sources for the new content
    if (typeof updateImageSources === 'function') {
        updateImageSources();
    }

    // Re-initialize drag & drop for the new column elements
    // Since we replaced the entire column DOM element, we need to re-setup all drag & drop
    // handlers that were attached to the old element and its children

    // Initialize all tasks in the new column
    newColumnElement.querySelectorAll('.task-item').forEach(taskElement => {
        initializeTaskElement(taskElement);
    });

    // Re-setup drag & drop for all columns and tasks to ensure event handlers are properly attached
    // This is needed because setupTaskDragAndDrop() also sets up drop zones on the tasks container
    if (typeof setupTaskDragAndDrop === 'function') {
        setupTaskDragAndDrop();
    }

    if (typeof setupColumnDragAndDrop === 'function') {
        setupColumnDragAndDrop();
    }

    // Note: Visual tag elements (badges, bars) are now created within createColumnElement
    // before the element is inserted into the DOM, eliminating timing/race conditions

}

/**
 * Render a single task - used for targeted updates of individual tasks
 * Purpose: Updates just one task without re-rendering the entire column
 * Used by: Path replacement for broken images, single task content updates
 * @param {string} taskId - ID of the task to render
 * @param {Object} taskData - Task data object
 * @param {string} columnId - Parent column ID
 * @returns {boolean} True if successful, false otherwise
 */
function renderSingleTask(taskId, taskData, columnId) {
    // Find the existing task element
    const existingTaskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!existingTaskElement) {
        return false;
    }

    // Get the task index from the existing element
    const taskIndex = parseInt(existingTaskElement.getAttribute('data-task-index') || '0', 10);

    // Clean up old tag handlers for this task to prevent memory leaks
    if (window.tagHandlers) {
        const taskHandlerPrefix = `tag-chip-task-${taskId}-`;
        Object.keys(window.tagHandlers).forEach(key => {
            if (key.startsWith(taskHandlerPrefix)) {
                delete window.tagHandlers[key];
            }
        });
    }

    // Create new task element HTML
    const newTaskHtml = createTaskElement(taskData, columnId, taskIndex);
    if (!newTaskHtml) {
        return false;
    }

    // Create a temporary container to parse the HTML
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = newTaskHtml;
    const newTaskElement = tempContainer.firstElementChild;

    if (!newTaskElement) {
        return false;
    }

    // Replace the old element with the new one
    existingTaskElement.parentNode.replaceChild(newTaskElement, existingTaskElement);

    // Initialize the new task element (drag handle, etc.)
    if (typeof initializeTaskElement === 'function') {
        initializeTaskElement(newTaskElement);
    }

    // Update image sources for the new content
    if (typeof updateImageSources === 'function') {
        updateImageSources();
    }

    // Apply stackable bars to this task if needed
    if (typeof window.injectStackableBars === 'function') {
        requestAnimationFrame(() => {
            window.injectStackableBars();
        });
    }

    return true;
}

// ============================================================================
// TEMPLATE HANDLING
// ============================================================================

/**
 * Request templates from backend
 */
function requestTemplates() {
    if (typeof vscode !== 'undefined') {
        vscode.postMessage({
            type: 'getTemplates'
        });
    }
}

/**
 * Update templates list (called from webview message handler)
 * Populates the template dropdown in the file-info header and the columns menu
 */
window.updateTemplates = function(templates, showBar = true) {
    window.availableTemplates = templates || [];
    window.showTemplateBar = showBar;

    // Get the template source container and select element (hidden)
    const templateSource = document.getElementById('template-source');
    const templateSelect = document.getElementById('template-select');

    // Get the new columns menu dropdown
    const columnsMenuDropdown = document.getElementById('columns-menu-dropdown');

    // Update template select (hidden)
    if (templateSelect) {
        // Clear existing options (keep first placeholder)
        while (templateSelect.options.length > 1) {
            templateSelect.remove(1);
        }

        if (templates && templates.length > 0) {
            templates.forEach(template => {
                const option = document.createElement('option');
                option.value = template.path;
                option.textContent = (template.icon ? template.icon + ' ' : '') + template.name;
                option.dataset.templateName = template.name;
                option.dataset.templatePath = template.path;
                templateSelect.appendChild(option);
            });
        }
    }

    // Keep template source hidden (using new drag menus instead)
    if (templateSource) {
        templateSource.style.display = 'none';
    }

    // Populate the columns menu dropdown with templates
    if (columnsMenuDropdown) {
        // Remove existing template items and separators (keep empty column source)
        const existingTemplates = columnsMenuDropdown.querySelectorAll('.template-item, .drag-menu-separator');
        existingTemplates.forEach(el => el.remove());

        // Add templates if available
        if (templates && templates.length > 0) {
            // Add each template as a draggable menu item (no separator - match cards menu style)
            templates.forEach(template => {
                const item = document.createElement('div');
                item.className = 'drag-menu-item template-item';
                item.draggable = true;
                item.dataset.templatePath = template.path;
                item.dataset.templateName = template.name;
                item.ondragstart = window.handleTemplateMenuDragStart;
                item.ondragend = window.handleTemplateMenuDragEnd;

                const icon = document.createElement('span');
                icon.className = 'drag-menu-item-icon';
                icon.textContent = template.icon || '📑';

                const text = document.createElement('span');
                text.className = 'drag-menu-item-text';
                text.textContent = template.name;

                item.appendChild(icon);
                item.appendChild(text);
                columnsMenuDropdown.appendChild(item);
            });
        }
    }
};

// ============================================================================

// Render Kanban board
/**
 * Main board rendering function - creates entire kanban UI
 * Purpose: Converts board data to interactive HTML
 * Used by: Initial load, board updates, refresh operations
 * Side effects: Updates DOM, applies styles, restores state
 * Performance: Debounced to prevent rapid re-renders
 */
function renderBoard(options = null) {
    if (typeof window.logViewMovement === 'function') {
        window.logViewMovement('renderBoard.start', {
            options: options ? Object.keys(options) : null,
            columnCount: window.cachedBoard?.columns?.length ?? 0,
            editing: Boolean(window.taskEditor && window.taskEditor.currentEditor)
        });
    }

    // Apply tag styles first
    applyTagStyles();

    // Check if we're currently editing - if so, skip the render
    if (window.taskEditor && window.taskEditor.currentEditor) {
        return;
    }

    // Selective rendering: only update specific columns or tasks
    if (options) {
        if (options.tasks && options.tasks.length > 0) {
            // Re-render specific tasks - delegate to column re-render
            // Group tasks by column to minimize re-renders
            const columnIds = new Set();
            options.tasks.forEach(({ columnId }) => {
                if (columnId) columnIds.add(columnId);
            });
            options = { columns: Array.from(columnIds) };
            // Fall through to column rendering below
        }
        if (options.columns && options.columns.length > 0) {
            // Re-render specific columns only using existing renderSingleColumn
            if (!window.cachedBoard || !window.cachedBoard.columns) {
                console.warn('[renderBoard] No cached board for selective render, doing full render');
                options = null; // Fall through to full render
            } else {
                options.columns.forEach(columnId => {
                    const column = window.cachedBoard.columns.find(c => c.id === columnId);
                    if (column) {
                        renderSingleColumn(columnId, column);
                    }
                });
                return;
            }
        }
    }

    // Full board render (default behavior)
    window.isBoardRendering = true;
    window.boardRenderNonce = (window.boardRenderNonce || 0) + 1;

    const boardElement = getBoardElement();
    if (!boardElement) {
        window.isBoardRendering = false;
        console.error('Board element not found');
        return;
    }

    if (!window.cachedBoard) {
        boardElement.innerHTML = `
            <div class="empty-board" style="
                text-align: center;
                padding: 40px;
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            ">
                No board data available. Please open a Markdown file.
            </div>`;
        return;
    }

    if (!window.cachedBoard.columns) {
        window.cachedBoard.columns = [];
    }
    
    // Save current scroll positions - scope to board element for performance
    boardElement.querySelectorAll('.column-content').forEach(container => {
        const columnId = container.id.replace('tasks-', '');
        scrollPositions.set(columnId, container.scrollTop);
    });

    boardElement.innerHTML = '';

    // Check if board is valid (has proper kanban header)
    if (window.cachedBoard.valid === false) {
        // Show initialize button instead of columns
        const initializeContainer = document.createElement('div');
        initializeContainer.className = 'initialize-container';

        const message = document.createElement('div');
        message.className = 'initialize-message';
        message.innerHTML = `
            This file is not initialized as a Kanban board.<br><br>
            Click the button below to add the required header.<br><br>
            This might overwrite content of the file if not structured correctly!
        `;
        initializeContainer.appendChild(message);

        const initializeBtn = document.createElement('button');
        initializeBtn.className = 'initialise-btn';
        initializeBtn.textContent = 'Initialize File';
        initializeBtn.onclick = () => initializeFile();

        initializeContainer.appendChild(initializeBtn);
        boardElement.appendChild(initializeContainer);
        return;
    }

    /**
     * Adds a margin element after the last column in a stack (for drop target)
     */
    function addMarginAfterLastColumn(stack, columns) {
        const lastColumn = columns[columns.length - 1];

        // Check if margin already exists
        const existingMargin = lastColumn.querySelector('.column-margin-bottom');
        if (existingMargin) {
            return; // Already has margin
        }

        // Create margin element
        const margin = document.createElement('div');
        margin.className = 'column-margin column-margin-bottom';

        // Append to last column
        lastColumn.appendChild(margin);
    }

    /**
     * Removes empty kanban-column-stack containers and adds drop zones between remaining stacks/columns
     */
    function cleanupStacksAndAddDropZones(rowContainer) {
        // 1. Remove all empty kanban-column-stack elements
        const allStacks = rowContainer.querySelectorAll('.kanban-column-stack');
        allStacks.forEach(stack => {
            const columns = stack.querySelectorAll('.kanban-full-height-column');
            if (columns.length === 0) {
                stack.remove();
            } 
            // else {
            //     // Add margin after last column in stack (for drop target)
            //     addMarginAfterLastColumn(stack, columns);
            // }
        });

        // 2. Get all remaining children (stacks and single columns)
        const children = Array.from(rowContainer.children).filter(child =>
            child.classList.contains('kanban-column-stack') ||
            child.classList.contains('kanban-full-height-column')
        );

        if (children.length === 0) return;

        // 3. Insert drop zones before, between, and after stacks/columns
        // Insert before first element
        const firstDropZoneStack = window.dropIndicatorManager.createDropZoneStack('before');
        rowContainer.insertBefore(firstDropZoneStack, children[0]);

        // Insert between elements
        for (let i = 0; i < children.length - 1; i++) {
            const betweenDropZoneStack = window.dropIndicatorManager.createDropZoneStack('between');
            children[i].parentNode.insertBefore(betweenDropZoneStack, children[i].nextSibling);
        }

        // Insert after last element
        const lastDropZoneStack = window.dropIndicatorManager.createDropZoneStack('after');
        children[children.length - 1].parentNode.insertBefore(lastDropZoneStack, children[children.length - 1].nextSibling);
    }

    // Detect number of rows from the board
    const detectedRows = detectRowsFromBoard(window.cachedBoard);
    const numRows = Math.max(currentLayoutRows, detectedRows);

    // Always use row containers (even for single row)
    boardElement.classList.add('multi-row');

    // Use DocumentFragment to batch DOM insertions for better performance
    const fragment = document.createDocumentFragment();

    // Sort columns by row first, then by their original index within each row
    // This ensures row 1 columns come before row 2 columns in the DOM
    const sortedColumns = window.cachedBoard.columns
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
        });

    // Group sorted columns by row
    const columnsByRow = {};
    for (let row = 1; row <= numRows; row++) {
        columnsByRow[row] = [];
    }

    sortedColumns.forEach(({ column, index, row }) => {
        columnsByRow[row].push({ column, index });
    });

    // Create row containers in order
    for (let row = 1; row <= numRows; row++) {
            const rowContainer = document.createElement('div');
            rowContainer.className = 'kanban-row';
            rowContainer.setAttribute('data-row-number', row);

            // Add row header
            // const rowHeader = document.createElement('div');
            // rowHeader.className = 'kanban-row-header';
            // rowHeader.textContent = `Row ${row}`;
            // rowContainer.appendChild(rowHeader);

            // Add columns for this row with stacking support
            let currentStackContainer = null;
            let lastColumnElement = null;

            // Process columns in the order they appear in the board data
            columnsByRow[row].forEach(({ column, index }) => {
                const columnElement = createColumnElement(column, index);
                const isStacked = /#stack\b/i.test(column.title);

                if (isStacked && lastColumnElement) {
                    // This column should be stacked below the previous one
                    if (!currentStackContainer) {
                        // Create a new stack container and move the previous column into it
                        currentStackContainer = document.createElement('div');
                        currentStackContainer.className = 'kanban-column-stack';

                        // Replace the previous column's wrapper with the stack container
                        const lastWrapper = lastColumnElement.parentNode;
                        lastWrapper.parentNode.replaceChild(currentStackContainer, lastWrapper);
                        currentStackContainer.appendChild(lastColumnElement);
                    }

                    // Add the current stacked column to the stack
                    currentStackContainer.appendChild(columnElement);
                } else {
                    // Regular column - wrap in its own stack container
                    const stackContainer = document.createElement('div');
                    stackContainer.className = 'kanban-column-stack';
                    stackContainer.appendChild(columnElement);
                    rowContainer.appendChild(stackContainer);
                    currentStackContainer = null;
                    lastColumnElement = columnElement;
                }
            });

            // Clean up empty stacks and add drop zones
            cleanupStacksAndAddDropZones(rowContainer);

            // Add the "Add Column" button to each row
            const addColumnBtn = document.createElement('button');
            addColumnBtn.className = 'add-column-btn multi-row-add-btn'; // Add the multi-row-add-btn class
            addColumnBtn.textContent = '+ Add Column';
            addColumnBtn.onclick = () => addColumn(row);
            rowContainer.appendChild(addColumnBtn);    

            // Add a drop zone spacer that fills remaining horizontal space
            const dropZoneSpacer = document.createElement('div');
            dropZoneSpacer.className = 'row-drop-zone-spacer';
            rowContainer.appendChild(dropZoneSpacer);

            fragment.appendChild(rowContainer);
        }

    // Append all rows at once to minimize reflows
    boardElement.appendChild(fragment);

    // Apply folding states after rendering
    setTimeout(() => {
        applyFoldingStates();

        // Apply user-configured row height if set
        if (window.currentRowHeight && window.currentRowHeight !== 'auto') {
            window.applyRowHeight(window.currentRowHeight);
        }
        // For 'auto' mode, CSS handles the layout naturally without any JS intervention

        // Restore scroll positions
        scrollPositions.forEach((scrollTop, columnId) => {
            const container = document.getElementById(`tasks-${columnId}`);
            if (container) {
                if (typeof window.logViewMovement === 'function') {
                    window.logViewMovement('renderBoard.restoreScroll', {
                        columnId,
                        scrollTop
                    });
                }
                container.scrollTop = scrollTop;
            }
        });

        // Update image sources after rendering
        updateImageSources();

        // Notify that rendering is complete (for focus functionality)
        window.isBoardRendering = false;
        if (window.onBoardRenderingComplete) {
            window.onBoardRenderingComplete();
        }

        // Recalculate task description heights after board renders
        if (window.calculateTaskDescriptionHeight) {
            window.calculateTaskDescriptionHeight();
        }
    }, 10);

    setupDragAndDrop();

    // Initialize all task elements after full board render
    // This ensures drag handlers, edit handlers, and visual elements are properly set up
    const taskItems = boardElement.querySelectorAll('.task-item');
    taskItems.forEach(taskElement => {
        initializeTaskElement(taskElement);
    });

    // Inject header/footer bars after DOM is rendered
    // This adds the actual bar elements to the DOM
    if (typeof injectStackableBars === 'function') {
        injectStackableBars();
    }

    // Apply stacked column styles AFTER bars are injected
    // Use setTimeout to ensure this happens after any rapid re-renders complete
    if (typeof applyStackedColumnStyles === 'function') {
        // Clear any pending call
        if (window.stackedColumnStylesTimeout) {
            clearTimeout(window.stackedColumnStylesTimeout);
        }
        // Batch post-render operations to reduce DOM thrashing
        window.stackedColumnStylesTimeout = setTimeout(() => {
            // Apply stacked column styles
            applyStackedColumnStyles();

            // Re-apply column width after render to preserve user's UI settings
            if (window.currentColumnWidth && window.applyColumnWidth) {
                window.applyColumnWidth(window.currentColumnWidth, true); // Skip render to prevent loop
            }

            // CRITICAL: If any columns have loading placeholders, recalculate again after a short delay
            // This ensures the placeholder heights are properly measured
            const loadingColumns = document.querySelectorAll('.column-loading-placeholder');
            if (loadingColumns.length > 0) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        applyStackedColumnStyles();
                    });
                });
            }

            // Set up column resize observer AFTER initial stack calculation
            // This automatically recalculates heights when any column content changes (images, diagrams, etc.)
            if (typeof setupColumnResizeObserver === 'function') {
                setupColumnResizeObserver();
            }

            window.stackedColumnStylesTimeout = null;
        }, 50);
    }

    // Apply immediate visual updates to all elements with tags - done earlier for visual feedback
    setTimeout(() => {
        document.querySelectorAll('[data-all-tags]').forEach(element => {
            // Safety check - skip null elements
            if (!element || !element.classList) return;
            const tags = element.getAttribute('data-all-tags').split(' ').filter(tag => tag.trim());
            const elementType = element.classList.contains('kanban-full-height-column') ? 'column' : 'task';
            if (window.updateAllVisualTagElements) {
                window.updateAllVisualTagElements(element, tags, elementType);
            }
        });

    }, 20);

    if (typeof window.updateActiveSpecialCharOverlay === 'function') {
        window.updateActiveSpecialCharOverlay();
    }

    // Setup compact view detection for ALL columns
    // DISABLED: Causes severe performance issues with expensive scroll handlers
    // - Runs querySelectorAll on every scroll event
}

// getFoldAllButtonState, toggleAllTasksInColumn, updateFoldAllButton moved to utils/columnFoldingManager.js

/**
 * Creates HTML element for a single column
 * Purpose: Generates column structure with header, tasks, footer
 * Used by: renderBoard() for each column
 * @param {Object} column - Column data object
 * @param {number} columnIndex - Position in column array
 * @returns {string} Complete HTML for column
 */
function createColumnElement(column, columnIndex) {
    if (!column) {
        return document.createElement('div');
    }

    if (!column.tasks) {
        column.tasks = [];
    }

    // CRITICAL: Check for pending local changes and use them instead of backend data
    // This prevents backend updates from overwriting user's immediate edits
    if (window.pendingColumnChanges && window.pendingColumnChanges.has(column.id)) {
        const pendingChange = window.pendingColumnChanges.get(column.id);
        column = { ...column, title: pendingChange.title };
    }

    // Extract ALL tags from column title for stacking features
    const allTags = getActiveTagsInTitle(column.title);

    // Find first tag with border definition
    const columnBorderTag = getFirstTagWithProperty(column.title, 'border');

    // Find first tag with background definition
    const columnBgTag = getFirstTagWithProperty(column.title, 'background');

    const columnDiv = document.createElement('div');
    const isCollapsed = window.collapsedColumns.has(column.id);

    // Header/footer bars handled by immediate update system
    const headerBarsHtml = '';
    const footerBarsHtml = '';

    // Determine classes
    let headerClasses = '';
    let footerClasses = '';

    if (headerBarsHtml) {
        headerClasses = 'has-header-bar';
        if (headerBarsHtml.includes('label')) {headerClasses += ' has-header-label';}
    }
    if (footerBarsHtml) {
        footerClasses = 'has-footer-bar';
        if (footerBarsHtml.includes('label')) {footerClasses += ' has-footer-label';}
    }

    // Check for span tag to set column width (only blocked by viewport-based widths, not pixel widths)
    let spanClass = '';
    const spanMatch = column.title.match(/#span(\d+)\b/i);
    const hasViewportWidth = window.currentColumnWidth && (window.currentColumnWidth === '50percent' || window.currentColumnWidth === '100percent');
    if (spanMatch && !hasViewportWidth) {
        const spanCount = parseInt(spanMatch[1]);
        if (spanCount >= 2 && spanCount <= 4) { // Limit to reasonable span values
            spanClass = `column-span-${spanCount}`;
        }
    }

    // Check for #sticky tag to determine sticky state (default: false = not sticky)
    const hasStickyTag = /#sticky\b/i.test(column.title);

    // Column include error: ONLY when ALL THREE conditions are met:
    // 1. Column has includeFiles (it's actually a column include)
    // 2. Column has includeMode === true (parsing recognized it as include)
    // 3. Column has includeError === true (the include file was NOT found)
    const isColumnInclude = column.includeFiles && column.includeFiles.length > 0;
    const hasColumnIncludeError = isColumnInclude && column.includeMode === true && column.includeError === true;

    columnDiv.className = `kanban-full-height-column ${isCollapsed ? 'collapsed' : ''} ${headerClasses} ${footerClasses} ${spanClass} ${hasColumnIncludeError ? 'include-error' : ''}`.trim();
    columnDiv.setAttribute('data-column-id', column.id);
    columnDiv.setAttribute('data-column-index', columnIndex);
    columnDiv.setAttribute('data-row', getColumnRow(column.title));
    columnDiv.setAttribute('data-column-sticky', hasStickyTag ? 'true' : 'false');

    // Add separate tag attributes for border and background (skips tags without those properties)
    if (columnBorderTag) {
        columnDiv.setAttribute('data-column-border-tag', columnBorderTag);
    }
    if (columnBgTag) {
        columnDiv.setAttribute('data-column-bg-tag', columnBgTag);
    }

    // Add all tags as a separate attribute for stacking features (header/footer bars, badges)
    if (allTags.length > 0) {
        columnDiv.setAttribute('data-all-tags', allTags.join(' '));
    }

    // Check each temporal type separately for granular column highlighting
    if (window.tagUtils) {
        const colText = column.title || '';
        if (window.tagUtils.isCurrentDate(colText)) columnDiv.setAttribute('data-current-day', 'true');
        if (window.tagUtils.isCurrentWeek(colText)) columnDiv.setAttribute('data-current-week', 'true');
        if (window.tagUtils.isCurrentWeekday(colText)) columnDiv.setAttribute('data-current-weekday', 'true');
        if (window.tagUtils.isCurrentTime(colText)) columnDiv.setAttribute('data-current-hour', 'true');
        if (window.tagUtils.isCurrentTimeSlot(colText)) columnDiv.setAttribute('data-current-time', 'true');
    }

    // Corner badges handled by immediate update system
    const cornerBadgesHtml = '';

    // Get display title using shared utility function
    const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(column, window.removeTagsForDisplay) : (column.title || '');

    // For editing, always use the full title including include syntax
    const editTitle = column.title || '';
    const foldButtonState = getFoldAllButtonState(column.id);

		// the column-header and column-title MUST be outside the column-content to be able to be sticky over the full height!!!
    columnDiv.innerHTML = `
				<div class="column-offset"></div>
				<div class="column-margin"></div>
				<div class="column-header">
						${headerBarsHtml || ''}
				</div>
				<div class="column-title">
						${cornerBadgesHtml}
						<div class="column-title-section">
								<span class="drag-handle column-drag-handle" draggable="true">⋮⋮</span>
								<span class="collapse-toggle ${isCollapsed ? 'rotated' : ''}" data-column-id="${column.id}">▶</span>
								<button class="pin-btn ${hasStickyTag ? 'pinned' : 'unpinned'}" onclick="toggleColumnSticky('${column.id}')" title="${hasStickyTag ? 'Unpin header (remove #sticky)' : 'Pin header (add #sticky)'}">
										<span class="pin-icon">📌</span>
								</button>
								<div class="column-title-container">
										<div class="column-title-text markdown-content" onclick="handleColumnTitleClick(event, '${column.id}')">${renderedTitle}</div>
										<textarea class="column-title-edit"
																data-column-id="${column.id}"
																style="display: none;">${escapeHtml(editTitle)}</textarea>
								</div>
								<span class="task-count">${column.tasks.length}
										<button class="fold-all-btn ${foldButtonState}" onclick="toggleAllTasksInColumn('${column.id}')" title="Fold/unfold all cards">
												<span class="fold-icon">${foldButtonState === 'fold-collapsed' ? '▶' : foldButtonState === 'fold-expanded' ? '▼' : '▽'}</span>
										</button>
								</span>
								${!column.includeError ? `<button class="collapsed-add-task-btn" onclick="addTaskAndUnfold('${column.id}')" title="Add task and unfold column">+</button>` : ''}
								<div class="donut-menu">
										<button class="donut-menu-btn" onmousedown="event.preventDefault();" onclick="toggleDonutMenu(event, this)">⋯</button>
										<div class="donut-menu-dropdown">
												<button class="donut-menu-item" onclick="insertColumnBefore('${column.id}')">Insert column before</button>
												<button class="donut-menu-item" onclick="insertColumnAfter('${column.id}')">Insert column after</button>
												<button class="donut-menu-item" onclick="duplicateColumn('${column.id}')">Duplicate column</button>
												<button class="donut-menu-item danger" onclick="deleteColumn('${column.id}')">Delete column</button>
												<div class="donut-menu-divider"></div>
												<button class="donut-menu-item" onclick="moveColumnLeft('${column.id}')">Move column left</button>
												<button class="donut-menu-item" onclick="moveColumnRight('${column.id}')">Move column right</button>
												<div class="donut-menu-divider"></div>
												${generateTagMenuItems(column.id, 'column', null)}
												<div class="donut-menu-divider"></div>
												<div class="donut-menu-item has-submenu" data-submenu-type="marp-classes" data-scope="column" data-id="${column.id}">
														Marp Classes
												</div>
												<div class="donut-menu-item has-submenu" data-submenu-type="marp-colors" data-scope="column" data-id="${column.id}">
														Marp Colors
												</div>
												<div class="donut-menu-item has-submenu" data-submenu-type="marp-header-footer" data-scope="column" data-id="${column.id}">
														Marp Header & Footer
												</div>
												<div class="donut-menu-divider"></div>
												<div class="donut-menu-item span-width-control">
													<span class="span-width-label">Width:</span>
													<div class="span-width-controls">
														<button class="span-width-btn" onclick="changeColumnSpan('${column.id}', -1)">−</button>
														<span class="span-width-value" data-column-id="${column.id}">${(() => {
															const spanMatch = column.title.match(/#span(\d+)\b/i);
															return spanMatch ? spanMatch[1] : '1';
														})()}</span>
														<button class="span-width-btn" onclick="changeColumnSpan('${column.id}', 1)">+</button>
													</div>
												</div>
												<div class="donut-menu-item stack-control">
													<span class="stack-label">Stack:</span>
													<button class="stack-toggle-btn ${/#stack\b/i.test(column.title) ? 'active' : ''}" onclick="toggleColumnStack('${column.id}')">
														${/#stack\b/i.test(column.title) ? 'On' : 'Off'}
													</button>
												</div>
												<div class="donut-menu-item has-submenu" data-submenu-type="sort" data-id="${column.id}" data-type="column" data-column-id="${column.id}">
														Sort by
												</div>
												<div class="donut-menu-divider"></div>
												<button class="donut-menu-item" onclick="copyColumnAsMarkdown('${column.id}')">Copy as markdown</button>
												<button class="donut-menu-item" onclick="exportColumn('${column.id}')">Export column</button>
												<div class="donut-menu-divider"></div>
												${column.includeMode ? `
													<button class="donut-menu-item" onclick="toggleColumnIncludeMode('${column.id}')">
														Disable include mode
													</button>
													<button class="donut-menu-item" onclick="editColumnIncludeFile('${column.id}')">
														Edit include file
													</button>
												` : `
													<button class="donut-menu-item" onclick="toggleColumnIncludeMode('${column.id}')">
														Enable include mode
													</button>
												`}
										</div>
								</div>
						</div>
				</div>
        <div class="column-content${column.isLoadingContent ? ' column-loading' : ''}" id="tasks-${column.id}">
            ${column.isLoadingContent
                ? '<div class="column-loading-placeholder"><div class="loading-spinner"></div><div class="loading-text">Loading tasks...</div></div>'
                : column.tasks.map((task, index) => createTaskElement(task, column.id, index)).join('')
            }
            ${!column.isLoadingContent && column.tasks.length === 0 && !column.includeError ? `<button class="add-task-btn" onclick="addTask('${column.id}')">
                + Add Task
            </button>` : ''}
            ${!column.isLoadingContent && column.tasks.length === 0 && column.includeError ? `<div class="broken-include-placeholder">
                Tasks unavailable for broken include
            </div>` : ''}
        </div>
        <div class="column-footer">
            ${footerBarsHtml || ''}
        </div>
    `;

    // CRITICAL: Apply visual tag elements (badges, bars) BEFORE returning
    // This ensures the element is fully constructed with all visual elements
    // before being inserted into the DOM - prevents timing/race conditions
    if (allTags.length > 0 && window.updateAllVisualTagElements) {
        window.updateAllVisualTagElements(columnDiv, allTags, 'column');
    }

    // Apply visual elements to tasks as well
    columnDiv.querySelectorAll('[data-task-id][data-all-tags]').forEach(taskElement => {
        const taskTags = taskElement.getAttribute('data-all-tags');
        if (taskTags && window.updateAllVisualTagElements) {
            const taskTagArray = taskTags.split(' ').filter(tag => tag.trim());
            window.updateAllVisualTagElements(taskElement, taskTagArray, 'task');
        }
    });

    return columnDiv;
}

/**
 * Get the content that should be shown in the edit field for a task
 * For task includes, this is the complete file content
 * For regular tasks, this is just the description
 */
function getTaskEditContent(task) {
    // FIX BUG #3: No-parsing approach
    // For task includes, task.description ALREADY contains the complete file content
    // displayTitle is just "# include in path" (UI indicator only, not part of file)
    // Don't reconstruct - just return description directly!
    const content = task.description || '';

    return content;
}

/**
 * Creates HTML element for a single task/card
 * Purpose: Generates task card with title, description, tags
 * Used by: createColumnElement() for each task
 * @param {Object} task - Task data object
 * @param {string} columnId - Parent column ID
 * @param {number} taskIndex - Position in task array
 * @returns {string} Complete HTML for task card
 */
function createTaskElement(task, columnId, taskIndex) {
    if (!task) {
        return '';
    }

    // Extract time slot from task title to use as parent context for minute slots in description
    // This enables hierarchical temporal inheritance: task title !15:00-16:00 -> content !:15-:30
    window.currentRenderingTimeSlot = null; // Reset first
    if (task.title && window.tagUtils && typeof window.tagUtils.extractTimeSlotTag === 'function') {
        const extracted = window.tagUtils.extractTimeSlotTag(task.title);
        if (extracted) {
            window.currentRenderingTimeSlot = extracted;
        }
    }

    let renderedDescription = (task.description && typeof task.description === 'string' && task.description.trim()) ? renderMarkdown(task.description, task.includeContext) : '';

    // Clear the rendering context AFTER description is rendered
    window.currentRenderingTimeSlot = null;

    // For broken task includes, show placeholder instead of empty description
    const isTaskIncludeWithError = task.includeMode === true && task.includeError === true;
    if (isTaskIncludeWithError && !renderedDescription) {
        renderedDescription = '<div class="broken-include-placeholder">Description unavailable for broken include</div>';
    } else {
        // Always wrap description in task sections for keyboard navigation
        // Even empty tasks need at least one section to be focusable
        renderedDescription = wrapTaskSections(renderedDescription);
    }

    // Use same pattern as column includes:
    // - displayTitle for display (content from file or filtered title)
    // - task.title for editing (includes the !!!taskinclude(...)!!! syntax)
    // Use getTaskDisplayTitle to handle taskinclude filepaths as clickable links
    const isCollapsed = window.collapsedTasks.has(task.id);

    // Check if task has no meaningful title
    const hasNoTitle = !task.title || !task.title.trim();

    // Generate alternative title when task is folded and has no title
    let renderedTitle;
    if (hasNoTitle && isCollapsed && task.description) {
        // Generate alternative title from description
        const alternativeTitle = generateAlternativeTitle(task.description);
        if (alternativeTitle) {
            renderedTitle = `<span class="task-alternative-title">${escapeHtml(alternativeTitle)}</span>`;
        } else {
            renderedTitle = '';
        }
    } else {
        // Normal title rendering
        renderedTitle = window.tagUtils ? window.tagUtils.getTaskDisplayTitle(task) :
            ((task.displayTitle || (task.title ? window.removeTagsForDisplay(task.title) : '')) &&
             typeof (task.displayTitle || task.title) === 'string' &&
             (task.displayTitle || task.title).trim()) ?
            renderMarkdown(task.displayTitle || task.title, task.includeContext) : '';
    }

    // Extract ALL tags for stacking features (from the full title)
    const allTags = getActiveTagsInTitle(task.title);

    // Find first tag with border definition
    const taskBorderTag = getFirstTagWithProperty(task.title, 'border');

    // Find first tag with background definition
    const taskBgTag = getFirstTagWithProperty(task.title, 'background');

    // Add separate tag attributes for border and background (skips tags without those properties)
    const borderTagAttribute = taskBorderTag ? ` data-task-border-tag="${taskBorderTag}"` : '';
    const bgTagAttribute = taskBgTag ? ` data-task-bg-tag="${taskBgTag}"` : '';

    // Add all tags attribute for stacking features (header/footer bars, badges)
    const allTagsAttribute = allTags.length > 0 ? ` data-all-tags="${allTags.join(' ')}"` : '';
    
    // Corner badges and header/footer bars handled by immediate update system
    const cornerBadgesHtml = '';
    const headerBarsData = { html: '', totalHeight: 0, hasLabel: false };
    const footerBarsData = { html: '', totalHeight: 0, hasLabel: false };
    
    // Calculate padding
    let paddingTopStyle = '';
    let paddingBottomStyle = '';
    let headerClasses = '';
    let footerClasses = '';
    
    if (headerBarsData && headerBarsData.totalHeight) {
        paddingTopStyle = `padding-top: ${headerBarsData.totalHeight}px);`; /*calc(var(--whitespace-div2) + */
        headerClasses = 'has-header-bar';
        if (headerBarsData.hasLabel) {headerClasses += ' has-header-label';}
    }
    if (footerBarsData && footerBarsData.totalHeight) {
        paddingBottomStyle = `padding-bottom: ${footerBarsData.totalHeight}px);`; /*calc(var(--whitespace-div2) + */
        footerClasses = 'has-footer-bar';
        if (footerBarsData.hasLabel) {footerClasses += ' has-footer-label';}
    }
    
    const headerBarsHtml = headerBarsData.html || '';
    const footerBarsHtml = footerBarsData.html || '';

    const loadingClass = task.isLoadingContent ? ' task-loading' : '';
    const loadingOverlay = task.isLoadingContent ? '<div class="loading-overlay"><div class="loading-spinner"></div><div class="loading-text">Loading...</div></div>' : '';

    // Check temporal tags with hierarchical gating (column > task title > task content)
    // Higher-order temporals in columns gate lower-order temporals in tasks
    const temporalAttributes = [];
    if (window.tagUtils && window.getActiveTemporalAttributes) {
        // Get column title for hierarchical gating
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const columnTitle = column?.title || '';

        // Get active temporal attributes with hierarchical gating
        const activeAttrs = window.getActiveTemporalAttributes(columnTitle, task.title || '', task.description || '');

        // Convert to attribute strings
        for (const [attr, isActive] of Object.entries(activeAttrs)) {
            if (isActive) {
                temporalAttributes.push(`${attr}="true"`);
            }
        }
    }
    const temporalAttributeString = temporalAttributes.length > 0 ? ' ' + temporalAttributes.join(' ') : '';

    // Task include error: ONLY when ALL THREE conditions are met:
    // 1. Task has includeFiles (it's actually a task include)
    // 2. Task has includeMode === true (parsing recognized it as include)
    // 3. Task has includeError === true (the include file was NOT found)
    const isTaskInclude = task.includeFiles && task.includeFiles.length > 0;
    const hasTaskIncludeError = isTaskInclude && task.includeMode === true && task.includeError === true;
    const taskIncludeErrorClass = hasTaskIncludeError ? 'include-error' : '';
    const taskIncludeErrorAttr = hasTaskIncludeError ? ' data-include-error="true"' : '';

    return `
        <div class="${['task-item', isCollapsed ? 'collapsed' : '', headerClasses || '', footerClasses || '', taskIncludeErrorClass].filter(cls => cls && cls.trim()).join(' ')}${loadingClass}"
             data-task-id="${task.id}"
             data-task-index="${taskIndex}"${borderTagAttribute}${bgTagAttribute}${allTagsAttribute}${temporalAttributeString}${taskIncludeErrorAttr}
             style="${paddingTopStyle} ${paddingBottomStyle}">
            ${loadingOverlay}
            ${headerBarsHtml}
            ${cornerBadgesHtml}
            <div class="task-header">
                <div class="task-drag-handle" title="Drag to move task">⋮⋮</div>
                <span class="task-collapse-toggle ${isCollapsed ? 'rotated' : ''}" onclick="toggleTaskCollapseById('${task.id}', '${columnId}'); updateFoldAllButton('${columnId}')">▶</span>
                <div class="task-title-container" onclick="handleTaskTitleClick(event, this, '${task.id}', '${columnId}')">
                <div class="task-title-display markdown-content">${renderedTitle}</div>
                    <textarea class="task-title-edit"
                                data-field="title"
                                placeholder="Task title (Markdown supported)..."
                                style="display: none;">${escapeHtml(task.title || '')}</textarea>
                </div>
                <div class="task-menu-container">
                    <div class="donut-menu">
                        <button class="donut-menu-btn" onmousedown="event.preventDefault();" onclick="toggleDonutMenu(event, this)">⋯</button>
                        <div class="donut-menu-dropdown">
                            <button class="donut-menu-item" onclick="insertTaskBefore('${task.id}', '${columnId}')">Insert card before</button>
                            <button class="donut-menu-item" onclick="insertTaskAfter('${task.id}', '${columnId}')">Insert card after</button>
                            <button class="donut-menu-item" onclick="duplicateTask('${task.id}', '${columnId}')">Duplicate card</button>
                            <button class="donut-menu-item danger" onclick="deleteTask('${task.id}', '${columnId}')">Delete card</button>
                            <div class="donut-menu-divider"></div>
                            <div class="donut-menu-item has-submenu" data-submenu-type="move" data-id="${task.id}" data-type="task" data-column-id="${columnId}">
                                Move
                            </div>
                            <div class="donut-menu-item has-submenu" data-submenu-type="move-to-list" data-id="${task.id}" data-type="task" data-column-id="${columnId}">
                                Move to list
                            </div>
                            <div class="donut-menu-divider"></div>
                            ${generateTagMenuItems(task.id, 'task', columnId)}
                            <div class="donut-menu-divider"></div>
                            <div class="donut-menu-item has-submenu" data-submenu-type="marp-classes" data-scope="task" data-id="${task.id}" data-column-id="${columnId}">
                                Marp Classes
                            </div>
                            <div class="donut-menu-item has-submenu" data-submenu-type="marp-colors" data-scope="task" data-id="${task.id}" data-column-id="${columnId}">
                                Marp Colors
                            </div>
                            <div class="donut-menu-item has-submenu" data-submenu-type="marp-header-footer" data-scope="task" data-id="${task.id}" data-column-id="${columnId}">
                                Marp Header & Footer
                            </div>
                            <div class="donut-menu-divider"></div>
                            <button class="donut-menu-item" onclick="copyTaskAsMarkdown('${task.id}', '${columnId}')">Copy as markdown</button>
                            <div class="donut-menu-divider"></div>
                            ${task.includeMode ?
                                `<button class="donut-menu-item" onclick="toggleTaskIncludeMode('${task.id}', '${columnId}')">Disable include mode</button>
                                <button class="donut-menu-item" onclick="editTaskIncludeFile('${task.id}', '${columnId}')">Edit include file</button>` :
                                `<button class="donut-menu-item" onclick="toggleTaskIncludeMode('${task.id}', '${columnId}')">Enable include mode</button>`
                            }
                        </div>
                    </div>
                </div>
            </div>

            <div class="task-description-container">
                <div class="task-description-display markdown-content"
                        onclick="handleDescriptionClick(event, this, '${task.id}', '${columnId}')">${renderedDescription}</div>
                <textarea class="task-description-edit"
                            data-field="description"
                            placeholder="Add description (Markdown supported)..."
                            style="display: none;">${escapeHtml(getTaskEditContent(task))}</textarea>
            </div>
            ${footerBarsHtml}
        </div>
    `;
}

// updateTagStylesForTheme moved to utils/tagStyleManager.js

function initializeFile() {
    vscode.postMessage({
        type: 'initializeFile'
    });
}

function updateImageSources() {
    // This function would handle updating image sources if needed
    // Currently handled by the backend processing
}

// toggleAllColumns, isColumnCollapsed, toggleColumnCollapse moved to utils/columnFoldingManager.js

// isInVerticalStack and getDefaultFoldMode moved to utils/stackLayoutManager.js

// applyStackedColumnStyles moved to utils/stackLayoutManager.js

// reorganizeStacksForColumn, enforceFoldModesForStacks moved to utils/stackLayoutManager.js


// COLUMN RESIZE OBSERVER: Automatically updates stack layout when column content changes
// This handles all dynamic content: images, diagrams, text changes, etc.
let columnResizeObserver = null;
let columnMutationObserver = null; // Detects DOM changes (innerHTML) that ResizeObserver misses
let isRecalculatingHeights = false; // Prevent infinite loops
let pendingRecalcNeeded = false; // Track if recalc was requested during processing
let heightPollingInterval = null; // Polling interval for delayed content rendering
let heightPollingEndTime = 0; // When to stop polling

// Baseline heights before DOM changes - used to detect if recalculation is needed
let baselineHeights = new Map();

// Update baseline heights (call this periodically when heights are stable)
function updateBaselineHeights() {
    baselineHeights.clear();
    document.querySelectorAll('.kanban-full-height-column').forEach(col => {
        const content = col.querySelector('.column-content');
        if (content) {
            baselineHeights.set(col.getAttribute('data-column-id'), content.scrollHeight);
        }
    });
}

// Poll for height changes after content modifications
// This catches delayed rendering (images, fonts, iframes, etc.)
function startHeightPolling() {
    const POLLING_DURATION = 2000; // Poll for 2 seconds
    const POLLING_INTERVAL = 200; // Check every 200ms (reduced from 100ms)

    // Extend polling time if already polling
    heightPollingEndTime = Date.now() + POLLING_DURATION;

    // Don't start a new interval if one is already running
    if (heightPollingInterval) {
        return;
    }

    heightPollingInterval = setInterval(() => {
        // Check if we should stop polling
        if (Date.now() > heightPollingEndTime) {
            clearInterval(heightPollingInterval);
            heightPollingInterval = null;
            updateBaselineHeights();
            return;
        }

        // Check if any heights differ from baseline
        let heightChanged = false;
        document.querySelectorAll('.kanban-full-height-column').forEach(col => {
            const content = col.querySelector('.column-content');
            if (content) {
                const colId = col.getAttribute('data-column-id');
                const currentHeight = content.scrollHeight;
                const baselineHeight = baselineHeights.get(colId);
                if (baselineHeight !== undefined && currentHeight !== baselineHeight) {
                    heightChanged = true;
                }
            }
        });

        // If any height differs from baseline, recalculate and update baseline
        if (heightChanged) {
            document.querySelectorAll('.kanban-column-stack').forEach(stack => {
                updateStackLayoutDebounced(stack);
            });
            updateBaselineHeights();
        }
    }, POLLING_INTERVAL);
}

function setupColumnResizeObserver() {
    // Disconnect existing observer if any
    if (columnResizeObserver) {
        columnResizeObserver.disconnect();
    }

    columnResizeObserver = new ResizeObserver((entries) => {
        // If we're currently recalculating, just mark that another recalc is needed
        if (isRecalculatingHeights) {
            pendingRecalcNeeded = true;
            return;
        }

        const affectedStacks = new Set();

        entries.forEach(entry => {
            const column = entry.target.closest('.kanban-full-height-column');
            let stack = entry.target.closest('.kanban-column-stack');

            // If stack not found via closest, try finding it via column's parent
            if (column && !stack) {
                stack = column.parentElement?.closest('.kanban-column-stack');
            }

            if (column && stack) {
                affectedStacks.add(stack);
            } else if (column && !stack) {
                // Column not in a stack - recalculate all stacks
                document.querySelectorAll('.kanban-column-stack').forEach(s => affectedStacks.add(s));
            }
        });

        // Batch recalculate affected stacks
        if (affectedStacks.size > 0) {
            requestAnimationFrame(() => {
                isRecalculatingHeights = true;
                pendingRecalcNeeded = false;
                affectedStacks.forEach(stack => {
                    updateStackLayout(stack);
                });
                requestAnimationFrame(() => {
                    isRecalculatingHeights = false;
                    if (pendingRecalcNeeded) {
                        pendingRecalcNeeded = false;
                        document.querySelectorAll('.kanban-column-stack').forEach(stack => {
                            updateStackLayout(stack);
                        });
                    }
                });
            });
        }
    });

    // Observe all existing column-content elements
    // NOTE: We only observe containers, NOT individual task-items
    // Observing 600+ task-items causes feedback loops and 100% CPU
    // Container resize is sufficient - it changes when any child content changes
    document.querySelectorAll('.column-content').forEach(columnContent => {
        columnResizeObserver.observe(columnContent);
    });

    // MUTATION OBSERVER: Detects DOM changes (innerHTML) that ResizeObserver doesn't catch
    if (columnMutationObserver) {
        columnMutationObserver.disconnect();
    }

    columnMutationObserver = new MutationObserver((mutations) => {
        // Check for structural changes OR class changes
        const hasRelevantChanges = mutations.some(m => {
            if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
                return true;
            }
            // Class changes on task-item (task collapse) or column elements (column fold)
            if (m.type === 'attributes' && m.attributeName === 'class') {
                const target = m.target;
                if (target.classList) {
                    if (target.classList.contains('task-item') || target.classList.contains('kanban-full-height-column')) {
                        return true;
                    }
                }
            }
            return false;
        });

        if (!hasRelevantChanges) {
            return;
        }

        // If we're currently recalculating, just mark that another recalc is needed
        if (isRecalculatingHeights) {
            pendingRecalcNeeded = true;
            return;
        }

        // Recalculate, then poll for height changes (catches delayed rendering)
        document.querySelectorAll('.kanban-column-stack').forEach(stack => {
            updateStackLayoutDebounced(stack);
        });

        // Start polling for height changes - content might still be loading
        startHeightPolling();
    });

    // Observe all column-content elements for DOM changes AND class changes
    document.querySelectorAll('.column-content').forEach(columnContent => {
        columnMutationObserver.observe(columnContent, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    });

    // Also observe column elements for fold/unfold class changes
    const columns = document.querySelectorAll('.kanban-full-height-column');
    columns.forEach(column => {
        columnMutationObserver.observe(column, {
            attributes: true,
            attributeFilter: ['class']
        });
    });

    // Initialize baseline heights for polling comparison
    updateBaselineHeights();
}

// Observe a new column when it's added to the DOM
function observeColumnForResize(columnElement) {
    const columnContent = columnElement.querySelector('.column-content');

    // Add to ResizeObserver (only container, not individual tasks)
    if (columnResizeObserver && columnContent) {
        columnResizeObserver.observe(columnContent);
    }

    // Add to MutationObserver
    if (columnMutationObserver) {
        // Observe column content for content changes
        if (columnContent) {
            columnMutationObserver.observe(columnContent, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
        }
        // Observe column element for fold/unfold class changes
        columnMutationObserver.observe(columnElement, {
            attributes: true,
            attributeFilter: ['class']
        });
    }
}
window.observeColumnForResize = observeColumnForResize;

// Export setup function
window.setupColumnResizeObserver = setupColumnResizeObserver;

// updateStackLayoutDebounced, updateStackLayout, setupStackedColumnScrollHandler
// and their window exports moved to utils/stackLayoutManager.js


// toggleTaskCollapseById, toggleTaskCollapse moved to utils/columnFoldingManager.js

// Single function to handle opening links/images/wiki links
function handleLinkOrImageOpen(event, target, taskId = null, columnId = null) {
    const link = target.closest('a');
    const img = target.closest('img');
    const imageNotFound = target.closest('.image-not-found'); // Handle missing image placeholders
    const wikiLink = target.closest('.wiki-link');

    // Function to find the position index of clicked element among similar elements
    function findElementIndex(clickedElement, containerElement, attributeName) {
        if (!clickedElement || !containerElement) return 0;

        const attributeValue = clickedElement.getAttribute(attributeName);
        if (!attributeValue) return 0;

        // Find all elements with the same tag name in the container
        const tagName = clickedElement.tagName.toLowerCase();
        const allElementsWithTag = containerElement.querySelectorAll(tagName);

        // Filter by attribute value (avoid CSS selector escaping issues)
        const allSimilar = Array.from(allElementsWithTag).filter(el =>
            el.getAttribute(attributeName) === attributeValue
        );

        // Find the index of our clicked element
        const index = allSimilar.indexOf(clickedElement);

        return index >= 0 ? index : 0;
    }

    // Find the task or column container to scope the search
    let containerElement = null;
    let linkIndex = 0;
    let includeContext = null;

    if (taskId) {
        // Look for task container
        containerElement = target.closest(`[data-task-id="${taskId}"]`);
        if (!containerElement) {
            containerElement = target.closest('.task-item');
        }

        // Get includeContext from the task if it exists
        if (window.cachedBoard && taskId && columnId) {
            const column = window.cachedBoard.columns.find(c => c.id === columnId);
            if (column) {
                const task = column.tasks.find(t => t.id === taskId);
                if (task && task.includeContext) {
                    includeContext = task.includeContext;
                }
            }
        }
    } else if (columnId) {
        // Look for column container
        containerElement = target.closest(`[data-column-id="${columnId}"]`);
        if (!containerElement) {
            containerElement = target.closest('.column');
        }
    }

    if (!containerElement) {
        // Fallback to the entire board
        containerElement = document.querySelector('.kanban-board');
    }
    
    // Handle wiki links
    if (wikiLink) {
        event.preventDefault();
        event.stopPropagation();
        const documentName = wikiLink.getAttribute('data-document');
        if (documentName) {
            // Calculate index for wiki links
            linkIndex = findElementIndex(wikiLink, containerElement, 'data-document');

            vscode.postMessage({
                type: 'openWikiLink',
                documentName: documentName,
                linkIndex: linkIndex,
                taskId: taskId,
                columnId: columnId
            });
        }
        return true;
    }
    
    // Handle regular links
    if (link) {
        event.preventDefault();
        event.stopPropagation();
        const href = link.getAttribute('data-original-href') || link.getAttribute('href');
        if (href && href !== '#') {
            if (href.startsWith('http://') || href.startsWith('https://')) {
                vscode.postMessage({
                    type: 'openExternalLink',
                    href: href
                });
            } else {
                // Calculate index for file links using the href attribute
                const hrefAttr = link.getAttribute('data-original-href') ? 'data-original-href' : 'href';
                linkIndex = findElementIndex(link, containerElement, hrefAttr);

                vscode.postMessage({
                    type: 'openFileLink',
                    href: href,
                    linkIndex: linkIndex,
                    taskId: taskId,
                    columnId: columnId,
                    includeContext: includeContext
                });
            }
        }
        return true;
    }
    
    // Handle images
    if (img) {
        event.preventDefault();
        event.stopPropagation();
        const originalSrc = img.getAttribute('data-original-src') || img.getAttribute('src');

        if (originalSrc && !originalSrc.startsWith('data:') && !originalSrc.startsWith('vscode-webview://')) {
            // Calculate index for images using the src attribute
            const srcAttr = img.getAttribute('data-original-src') ? 'data-original-src' : 'src';
            linkIndex = findElementIndex(img, containerElement, srcAttr);

            vscode.postMessage({
                type: 'openFileLink',
                href: originalSrc,
                linkIndex: linkIndex,
                taskId: taskId,
                columnId: columnId,
                includeContext: includeContext
            });
        }
        return true;
    }

    // Handle missing image placeholders (triggers search for alternative image)
    if (imageNotFound) {
        event.preventDefault();
        event.stopPropagation();
        const originalSrc = imageNotFound.getAttribute('data-original-src');

        if (originalSrc) {
            // Calculate index for image-not-found placeholders
            linkIndex = findElementIndex(imageNotFound, containerElement, 'data-original-src');

            vscode.postMessage({
                type: 'openFileLink',
                href: originalSrc,
                linkIndex: linkIndex,
                taskId: taskId,
                columnId: columnId,
                includeContext: includeContext
            });
        }
        return true;
    }

    return false;
}

// Global click handlers that check for Alt key
function handleColumnTitleClick(event, columnId) {
    if (event.altKey) {
        // Alt+click: open link/image (no taskId for column titles)
        if (handleLinkOrImageOpen(event, event.target, null, columnId)) {return;}
        return; // Don't edit if Alt is pressed
    }

    // Default: unfold if collapsed, then edit
    event.preventDefault();
    event.stopPropagation();

    // Use DOM traversal from clicked element - this is guaranteed to be the correct column
    const columnElement = event.target.closest('.kanban-full-height-column');
    if (!columnElement) {
        console.error(`[handleColumnTitleClick] Could not find column element from click target`);
        return;
    }

    // Get the actual column ID from the DOM element (source of truth)
    const actualColumnId = columnElement.dataset.columnId;
    if (actualColumnId !== columnId) {
        console.warn(`[handleColumnTitleClick] Column ID mismatch - onclick: "${columnId}", DOM: "${actualColumnId}". Using DOM value.`);
        columnId = actualColumnId; // Use the DOM value as source of truth
    }

    if (isColumnCollapsed(columnElement)) {
        // Unfold the column first
        toggleColumnCollapse(columnId);
        // Use a short delay to allow the unfold animation to start, then enter edit mode
        setTimeout(() => {
            window.editColumnTitle(columnId, columnElement);
        }, 50);
    } else {
        // Column is already unfolded, edit immediately
        window.editColumnTitle(columnId, columnElement);
    }
}

function handleTaskTitleClick(event, element, taskId, columnId) {

    if (event.altKey) {
        // Alt+click: open link/image
        if (handleLinkOrImageOpen(event, event.target, taskId, columnId)) {return;}
        return; // Don't edit if Alt is pressed
    }

    // Default: always edit
    event.preventDefault();
    event.stopPropagation();

    if (typeof window.editTitle === 'function') {
        window.editTitle(element, taskId, columnId);
    } else {
        console.error('editTitle is not a function:', typeof window.editTitle);
    }
}

function handleDescriptionClick(event, element, taskId, columnId) {
    // DEBUG: Log scroll position at the VERY START of click handling
    if (window.kanbanDebug?.enabled) {
        const container = document.getElementById('kanban-container');
        const board = document.getElementById('kanban-board');
        const body = document.body;
        const webviewBody = document.documentElement;
        // Find the nearest scrollable parent
        let scrollParent = element?.parentElement;
        let scrollParentInfo = null;
        while (scrollParent) {
            const style = window.getComputedStyle(scrollParent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                scrollParentInfo = {
                    id: scrollParent.id || scrollParent.className.split(' ')[0],
                    scrollTop: scrollParent.scrollTop
                };
                break;
            }
            scrollParent = scrollParent.parentElement;
        }
        console.log('[CLICK-DEBUG] handleDescriptionClick entry', {
            containerScrollTop: container?.scrollTop,
            boardScrollTop: board?.scrollTop,
            boardHasMultiRow: board?.classList?.contains('multi-row'),
            bodyScrollTop: body?.scrollTop,
            documentScrollTop: webviewBody?.scrollTop,
            scrollParent: scrollParentInfo,
            clickedElementRect: element?.getBoundingClientRect()?.top,
            taskId
        });
    }

    if (event.altKey) {
        // Alt+click: open link/image
        if (handleLinkOrImageOpen(event, event.target, taskId, columnId)) {return;}
        return; // Don't edit if Alt is pressed
    }

    // Default: always edit
    event.preventDefault();
    event.stopPropagation();

    if (typeof window.editDescription === 'function') {
        if (taskId && columnId) {
            window.editDescription(element, taskId, columnId);
        } else {
            window.editDescription(element);
        }
    } else {
        console.error('editDescription is not a function:', typeof window.editDescription);
    }
}

// getTagConfig, generateTagStyles moved to utils/tagStyleManager.js

// Function to inject header, footer bars, and border text after render
// Modified injectStackableBars function
function injectStackableBars(targetElement = null) {
    let elementsToProcess;
    if (targetElement) {
        // Safety check - skip if targetElement doesn't have classList
        if (!targetElement.classList) return;
        // Always process the target element (even without data-all-tags) to clean up existing bars
        elementsToProcess = [targetElement];
    } else {
        elementsToProcess = document.querySelectorAll('[data-all-tags]');
    }

    elementsToProcess.forEach((element) => {
        // Safety check - skip null elements
        if (!element || !element.classList) return;

        const allTagsAttr = element.getAttribute('data-all-tags');
        let tags = allTagsAttr ? allTagsAttr.split(' ').filter(tag => tag.trim()) : [];
        const isColumn = element.classList.contains('kanban-full-height-column');
        const isCollapsed = isColumn && isColumnCollapsed(element);

        // Update background and border tag attributes based on title tags
        // Get the element's title to check which tags have background/border properties
        let titleText = '';
        if (isColumn) {
            const columnId = element.getAttribute('data-column-id');
            if (window.cachedBoard && window.cachedBoard.columns && columnId) {
                const column = window.cachedBoard.columns.find(c => c.id === columnId);
                titleText = column ? column.title : '';
            }
        } else {
            const taskId = element.getAttribute('data-task-id');
            if (window.cachedBoard && window.cachedBoard.columns && taskId) {
                // Find task across all columns
                for (const column of window.cachedBoard.columns) {
                    const task = column.tasks.find(t => t.id === taskId);
                    if (task) {
                        titleText = task.title;
                        break;
                    }
                }
            }
        }

        // Update border tag attribute
        const borderTag = window.getFirstTagWithProperty ? window.getFirstTagWithProperty(titleText, 'border') : null;
        const borderTagAttr = isColumn ? 'data-column-border-tag' : 'data-task-border-tag';
        if (borderTag) {
            element.setAttribute(borderTagAttr, borderTag);
        } else {
            element.removeAttribute(borderTagAttr);
        }

        // Update background tag attribute
        const bgTag = window.getFirstTagWithProperty ? window.getFirstTagWithProperty(titleText, 'background') : null;
        const bgTagAttr = isColumn ? 'data-column-bg-tag' : 'data-task-bg-tag';
        if (bgTag) {
            element.setAttribute(bgTagAttr, bgTag);
        } else {
            element.removeAttribute(bgTagAttr);
        }

        // Filter out tags that are ONLY in description (not in title) for task elements
        if (!isColumn) { // This is a task element
            const taskTitleDisplay = element.querySelector('.task-title-display');
            const taskDescDisplay = element.querySelector('.task-description-display');

            if (taskTitleDisplay && taskDescDisplay) {
                // Get tags from title
                const titleTags = new Set();
                taskTitleDisplay.querySelectorAll('.kanban-tag').forEach(tagSpan => {
                    const tagName = tagSpan.getAttribute('data-tag');
                    if (tagName) {
                        titleTags.add(tagName);
                    }
                });

                // Get tags from description
                const descriptionTags = new Set();
                taskDescDisplay.querySelectorAll('.kanban-tag').forEach(tagSpan => {
                    const tagName = tagSpan.getAttribute('data-tag');
                    if (tagName) {
                        descriptionTags.add(tagName);
                    }
                });

                // Only use tags that are in the title (even if also in description)
                // Filter out tags that are ONLY in description
                tags = tags.filter(tag => titleTags.has(tag) || !descriptionTags.has(tag));
            }
        }

        // Deduplicate tags array to prevent duplicate header/footer bars
        tags = [...new Set(tags)];

        // Remove existing bars/containers - only from appropriate areas
        if (isColumn) {
            // For columns: only remove from column-header and column-footer, not from nested task cards
            const columnHeader = element.querySelector('.column-header');
            if (columnHeader) {
                columnHeader.querySelectorAll('.header-bar, .header-bars-container').forEach(el => el.remove());
            }
            const columnFooter = element.querySelector('.column-footer');
            if (columnFooter) {
                columnFooter.querySelectorAll('.footer-bar, .footer-bars-container').forEach(el => el.remove());
            }
            // Also remove any direct children that are visual elements (for collapsed state)
            Array.from(element.children).forEach(child => {
                if (child.classList.contains('header-bar') ||
                    child.classList.contains('footer-bar') ||
                    child.classList.contains('header-bars-container') ||
                    child.classList.contains('footer-bars-container')) {
                    child.remove();
                }
            });
        } else {
            // For non-column elements (tasks), safe to remove all
            element.querySelectorAll('.header-bar, .footer-bar, .header-bars-container, .footer-bars-container').forEach(bar => bar.remove());
        }
        
        // Also remove old classes
        element.classList.remove('has-header-bar', 'has-footer-bar', 'has-header-label', 'has-footer-label');
        
        let headerBars = [];
        let footerBars = [];
        let hasHeaderLabel = false;
        let hasFooterLabel = false;
        
        // Collect header and footer bars
        tags.forEach(tag => {
            const config = getTagConfig(tag);

            if (config && config.headerBar) {
                const headerBar = document.createElement('div');
                headerBar.className = `header-bar header-bar-${tag}`;

                // Don't set inline top style - let CSS handle layout via flexbox/normal flow
                // The header-bars-container uses flex layout, so bars stack naturally

                headerBars.push(headerBar);
                // Only add label class for columns, not for tasks
                if (config.headerBar.label && isColumn) {hasHeaderLabel = true;}
            }

            if (config && config.footerBar) {
                const footerBar = document.createElement('div');
                footerBar.className = `footer-bar footer-bar-${tag}`;

                // Don't set inline bottom style - let CSS handle layout via flexbox/normal flow
                // The footer-bars-container uses flex layout, so bars stack naturally

                footerBars.push(footerBar);
                // Only add label class for columns, not for tasks
                if (config.footerBar.label && isColumn) {hasFooterLabel = true;}
            }
        });
        
        // Handle collapsed columns with flex containers
        if (isCollapsed) {
            // Find the header and footer elements to insert bars into
						const columnHeader = element.querySelector('.column-header');
						const columnFooter = element.querySelector('.column-footer');

            // Create and insert header container at the beginning of column-header
            if (headerBars.length > 0 && columnHeader) {
                const headerContainer = document.createElement('div');
                headerContainer.className = 'header-bars-container';
                headerBars.forEach(bar => headerContainer.appendChild(bar));
                columnHeader.insertBefore(headerContainer, columnHeader.firstChild);
                element.classList.add('has-header-bar');
                if (hasHeaderLabel) {element.classList.add('has-header-label');}
            }

            // Create and append footer container to column-footer (not column-content)
            if (footerBars.length > 0 && columnFooter) {
                const footerContainer = document.createElement('div');
                footerContainer.className = 'footer-bars-container';
                footerBars.forEach(bar => footerContainer.appendChild(bar));
                columnFooter.appendChild(footerContainer);
                element.classList.add('has-footer-bar');
                if (hasFooterLabel) {element.classList.add('has-footer-label');}
            }

            // Clear any inline padding styles for collapsed columns
            element.style.paddingTop = '';
            element.style.paddingBottom = '';

        } else {
            // For non-collapsed columns, use column-header and column-footer
            if (isColumn) {
                const columnHeader = element.querySelector('.column-header');
                const columnFooter = element.querySelector('.column-footer');
                const isInStack = element.closest('.kanban-column-stack') !== null;

                if (columnHeader && headerBars.length > 0) {
                    // Create and insert header container at the beginning of column-header
                    const headerContainer = document.createElement('div');
                    headerContainer.className = 'header-bars-container';
                    headerBars.forEach(bar => headerContainer.appendChild(bar));
                    columnHeader.insertBefore(headerContainer, columnHeader.firstChild);
                    element.classList.add('has-header-bar');
                    if (hasHeaderLabel) {element.classList.add('has-header-label');}
                }

                // Footer bars always go in column-footer, but stacked ones get special class
                if (columnFooter && footerBars.length > 0) {
                    const footerContainer = document.createElement('div');
                    footerContainer.className = 'footer-bars-container';
                    if (isInStack) {
                        footerContainer.classList.add('stacked-footer-bars');
                    }
                    footerBars.forEach(bar => footerContainer.appendChild(bar));
                    columnFooter.appendChild(footerContainer);
                    element.classList.add('has-footer-bar');
                    if (hasFooterLabel) {element.classList.add('has-footer-label');}
                }
            } else {
                // For non-column elements (tasks), use appendChild and rely on CSS flexbox order
                if (headerBars.length > 0) {
                    const headerContainer = document.createElement('div');
                    headerContainer.className = 'header-bars-container';
                    headerBars.forEach(bar => headerContainer.appendChild(bar));
                    element.appendChild(headerContainer);
                    element.classList.add('has-header-bar');
                    if (hasHeaderLabel) {element.classList.add('has-header-label');}
                }

                if (footerBars.length > 0) {
                    const footerContainer = document.createElement('div');
                    footerContainer.className = 'footer-bars-container';
                    footerBars.forEach(bar => footerContainer.appendChild(bar));
                    element.appendChild(footerContainer);
                    element.classList.add('has-footer-bar');
                    if (hasFooterLabel) {element.classList.add('has-footer-label');}
                }
            }
        }
    });

    // Force a full reflow to ensure all bars are laid out
    void document.body.offsetHeight;
}

// isDarkTheme moved to utils/tagStyleManager.js

// Make functions globally available
window.handleColumnTitleClick = handleColumnTitleClick;
window.handleTaskTitleClick = handleTaskTitleClick;
window.handleDescriptionClick = handleDescriptionClick;

window.getActiveTagsInTitle = getActiveTagsInTitle;
window.generateTagMenuItems = generateTagMenuItems;
window.generateGroupTagItems = generateGroupTagItems;
window.generateFlatTagItems = generateFlatTagItems;

// getTagConfig now provided by utils/tagStyleManager.js

// Function to remove all tags from a card or column
/**
 * Removes all tags from a column or task
 * Purpose: Bulk tag removal operation
 * Used by: 'Remove all tags' menu option
 * @param {string} id - Element ID
 * @param {string} type - 'column' or 'task'
 * @param {string} columnId - Parent column for tasks
 * Side effects: Updates pending changes, triggers save
 */
function removeAllTags(id, type, columnId = null) {
    
    // Get current title
    let currentTitle = '';
    let element = null;
    
    if (type === 'column') {
        const column = window.cachedBoard?.columns?.find(c => c.id === id);
        if (column) {
            currentTitle = column.title || '';
            element = column;
        }
    } else if (type === 'task' && columnId) {
        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const task = column?.tasks?.find(t => t.id === id);
        if (task) {
            currentTitle = task.title || '';
            element = task;
        }
    }
    
    if (!element) {
        return;
    }
    
    // Remove all tags from the title (keep everything except tags)
    // Tags are in format #tagname, but preserve #row tags and #span tags
    // Must start with alphanumeric or underscore to exclude pure symbol tags like ++, --, etc.
    let newTitle = currentTitle.replace(/#(?!row\d+\b)(?!span\d+\b)[a-zA-Z0-9_][a-zA-Z0-9_-]*(?:[&|=><][a-zA-Z0-9_-]+)*/g, '').trim();

    // Also remove special positivity tags: #++, #+, #ø, #-, #--
    // Use negative lookahead to ensure - doesn't match when it's part of --
    newTitle = newTitle.replace(/#(\+\+|--|\+|ø|Ø|-(?!-))/g, '').replace(/\s+/g, ' ').trim();
    
    // Update the element
    element.title = newTitle;
    
    // Store the change in pending changes
    if (type === 'column') {
        if (!window.pendingColumnChanges) {
            window.pendingColumnChanges = new Map();
        }
        window.pendingColumnChanges.set(id, { title: newTitle, columnId: id });
        
        // Update display immediately
        if (typeof updateColumnDisplayImmediate === 'function') {
            updateColumnDisplayImmediate(id, newTitle, false, '');
        }
    } else if (type === 'task') {
        const task = element; // element is the task object
        task.title = newTitle; // Update the task title

        // Send editTask message immediately when tags are removed
        vscode.postMessage({
            type: 'editTask',
            taskId: id,
            columnId: columnId,
            taskData: task
        });

        // Update display immediately
        if (typeof updateTaskDisplayImmediate === 'function') {
            updateTaskDisplayImmediate(id, newTitle, false, '');
        }
    }

    // Update refresh button state (note: tasks now send immediately, only columns use pending)
    const totalPending = (window.pendingColumnChanges?.size || 0);
    if (typeof updateRefreshButtonState === 'function') {
        updateRefreshButtonState(totalPending > 0 ? 'unsaved' : 'default', totalPending);
    }
    
    // Update tag category counts if menu is still open
    if (typeof updateTagCategoryCounts === 'function') {
        updateTagCategoryCounts(id, type, columnId);
    }
    
    // Close the menu
    if (typeof closeAllMenus === 'function') {
        closeAllMenus();
    } else {
        document.querySelectorAll('.donut-menu').forEach(menu => menu.classList.remove('active'));
    }
    
}

window.removeAllTags = removeAllTags;

// Function to update task count display for a column
function updateColumnTaskCount(columnId) {
    const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
    if (!column) {
        return;
    }

    const taskCountElement = document.querySelector(`[data-column-id="${columnId}"] .task-count`);
    if (taskCountElement) {
        // Update the text content while preserving the button
        const buttonHTML = taskCountElement.innerHTML.match(/<button[\s\S]*<\/button>/);
        taskCountElement.innerHTML = `${column.tasks.length}${buttonHTML ? buttonHTML[0] : ''}`;
    }
}

// updateColumnFoldState moved to utils/columnFoldingManager.js

// Function to update both task count and fold state after task moves
function updateColumnDisplay(columnId) {
    updateColumnTaskCount(columnId);
    window.updateColumnFoldState(columnId);
}

// toggleTaskCollapse, toggleAllTasksInColumn now exported from utils/columnFoldingManager.js
window.updateColumnDisplay = updateColumnDisplay;

// Expose rendering functions for include file updates
window.renderSingleColumn = renderSingleColumn;
window.injectStackableBars = injectStackableBars;
// isDarkTheme now provided by utils/tagStyleManager.js

window.getAllTagsInUse = getAllTagsInUse;
window.getUserAddedTags = getUserAddedTags;

// Expose section wrapping function for taskEditor
window.wrapTaskSections = wrapTaskSections;

window.handleLinkOrImageOpen = handleLinkOrImageOpen;

/**
 * Incrementally adds a single task to a column without redrawing everything
 * Purpose: Optimize performance when adding new tasks
 * @param {string} columnId - Column to add task to
 * @param {object} task - Task data
 * @param {number} insertIndex - Position to insert at (-1 for end)
 * @returns {HTMLElement} - The created task element
 */
function addSingleTaskToDOM(columnId, task, insertIndex = -1) {
    const tasksContainer = document.querySelector(`#tasks-${columnId}`);
    if (!tasksContainer) {
        return null;
    }

    const column = window.cachedBoard?.columns.find(c => c.id === columnId);
    if (!column) {
        return null;
    }

    // Get the task index within the column
    const taskIndex = insertIndex >= 0 ? insertIndex : column.tasks.length - 1;

    // Create the task element HTML
    const taskHtml = createTaskElement(task, columnId, taskIndex);

    // Create a temporary container to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = taskHtml;
    const taskElement = tempDiv.firstElementChild;

    // Get only task elements (exclude add-task-btn and other non-task children)
    // This is critical because the add-task-btn may be hidden but still in DOM
    const taskElements = tasksContainer.querySelectorAll(':scope > .task-item');

    try {
        // Insert the task at the correct position among task elements only
        if (insertIndex >= 0 && insertIndex < taskElements.length) {
            // Insert BEFORE the task currently at insertIndex
            const referenceNode = taskElements[insertIndex];
            if (referenceNode && referenceNode.parentNode === tasksContainer) {
                tasksContainer.insertBefore(taskElement, referenceNode);
            } else {
                tasksContainer.appendChild(taskElement);
            }
        } else if (taskElements.length > 0) {
            // Insert at end - insert AFTER the last task element
            const lastTask = taskElements[taskElements.length - 1];
            if (lastTask.nextSibling) {
                tasksContainer.insertBefore(taskElement, lastTask.nextSibling);
            } else {
                tasksContainer.appendChild(taskElement);
            }
        } else {
            // No tasks exist - just append (will be before or after hidden button, doesn't matter)
            tasksContainer.appendChild(taskElement);
        }
    } catch (error) {
        console.error('[addSingleTaskToDOM] Error inserting task:', error);
        // On error, try appending to end as fallback
        try {
            tasksContainer.appendChild(taskElement);
        } catch (appendError) {
            console.error('[addSingleTaskToDOM] Error appending task:', appendError);
            return null;
        }
    }

    // Update image sources
    if (typeof updateImageSources === 'function') {
        updateImageSources();
    }

    // Initialize task (drag handlers, edit handlers, visual elements)
    initializeTaskElement(taskElement);

    // Update column task count
    updateColumnTaskCount(columnId);

    return taskElement;
}

/**
 * Incrementally adds a single column to the board without redrawing everything
 * Purpose: Optimize performance when adding new columns
 * @param {object} column - Column data
 * @param {number} insertIndex - Position to insert at (-1 for end)
 * @returns {HTMLElement} - The created column element
 */
function addSingleColumnToDOM(column, insertIndex = -1, referenceColumnId = null) {
    const boardElement = getBoardElement();
    if (!boardElement) {
        return null;
    }

    // Get the column index
    const columnIndex = insertIndex >= 0 ? insertIndex : window.cachedBoard?.columns.length - 1;

    // Create the column element
    const columnElement = createColumnElement(column, columnIndex);

    // Check if board is in multi-row mode
    const isMultiRow = boardElement.classList.contains('multi-row');

    if (isMultiRow) {
        // In multi-row mode, columns must be inserted into the correct row container
        // Determine which row this column belongs to based on its title
        const columnRow = getColumnRow(column.title);

        // Find the row container
        let rowContainer = boardElement.querySelector(`.kanban-row[data-row-number="${columnRow}"]`);

        // If row doesn't exist, create it
        if (!rowContainer) {
            rowContainer = document.createElement('div');
            rowContainer.className = 'kanban-row';
            rowContainer.setAttribute('data-row-number', columnRow);

            // Insert the row in the correct position
            const existingRows = Array.from(boardElement.querySelectorAll('.kanban-row'));
            const insertBeforeRow = existingRows.find(r => parseInt(r.getAttribute('data-row-number')) > columnRow);

            if (insertBeforeRow) {
                boardElement.insertBefore(rowContainer, insertBeforeRow);
            } else {
                boardElement.appendChild(rowContainer);
            }

            // Add the "Add Column" button to the new row
            const addColumnBtn = document.createElement('button');
            addColumnBtn.className = 'add-column-btn multi-row-add-btn';
            addColumnBtn.textContent = '+ Add Column';
            addColumnBtn.onclick = () => addColumn(columnRow);
            rowContainer.appendChild(addColumnBtn);

            // Add drop zone spacer
            const dropZoneSpacer = document.createElement('div');
            dropZoneSpacer.className = 'row-drop-zone-spacer';
            rowContainer.appendChild(dropZoneSpacer);
        }

        // Find the correct position to insert within this row based on data model order
        // Get all columns in the data model that should be in this row, in order
        const columnsInThisRow = window.cachedBoard.columns.filter(col => {
            return getColumnRow(col.title) === columnRow;
        });

        // Find where the new column should be positioned within this row
        const positionInRow = columnsInThisRow.findIndex(col => col.id === column.id);

        // Find the stack by looking ONLY at the reference column
        let targetStack = null;
        let insertBeforeColumn = null;
        let insertAfterColumn = null;

        const allStacks = rowContainer.querySelectorAll('.kanban-column-stack:not(.column-drop-zone-stack)');

        // If we have a reference column ID, find it in the DOM
        if (referenceColumnId) {
            for (const stack of allStacks) {
                const refColumnElement = stack.querySelector(`[data-column-id="${referenceColumnId}"]`);
                if (refColumnElement) {
                    targetStack = stack;

                    // Determine if we're inserting before or after based on position
                    const refColumnIndex = columnsInThisRow.findIndex(c => c.id === referenceColumnId);
                    if (positionInRow < refColumnIndex) {
                        // Inserting before the reference column
                        insertBeforeColumn = refColumnElement;
                    } else {
                        // Inserting after the reference column
                        insertAfterColumn = refColumnElement;
                    }
                    break;
                }
            }
        }

        if (targetStack) {
            // Add to existing stack
            if (insertBeforeColumn) {
                targetStack.insertBefore(columnElement, insertBeforeColumn);
            } else if (insertAfterColumn) {
                // Insert after the reference column
                if (insertAfterColumn.nextSibling) {
                    targetStack.insertBefore(columnElement, insertAfterColumn.nextSibling);
                } else {
                    targetStack.appendChild(columnElement);
                }
            } else {
                targetStack.appendChild(columnElement);
            }
        } else {
            // No adjacent columns found - create a new stack
            const stackContainer = document.createElement('div');
            stackContainer.className = 'kanban-column-stack';
            stackContainer.appendChild(columnElement);

            // Find the correct position to insert the new stack
            let insertBeforeStack = null;
            if (positionInRow >= 0 && positionInRow < columnsInThisRow.length - 1) {
                // Get the column that should come after the new column in the data model
                const nextColumnId = columnsInThisRow[positionInRow + 1].id;

                // Find the DOM stack containing that column
                for (const stack of allStacks) {
                    const stackColumn = stack.querySelector(`[data-column-id="${nextColumnId}"]`);
                    if (stackColumn) {
                        insertBeforeStack = stack;
                        break;
                    }
                }
            }

            if (insertBeforeStack) {
                // Insert before the found stack
                rowContainer.insertBefore(stackContainer, insertBeforeStack);
            } else {
                // Insert before the "Add Column" button (at the end of row)
                const addColumnBtn = rowContainer.querySelector('.add-column-btn');
                if (addColumnBtn) {
                    rowContainer.insertBefore(stackContainer, addColumnBtn);
                } else {
                    // Fallback: append to the end of row
                    rowContainer.appendChild(stackContainer);
                }
            }
        }
    } else {
        // Single-row mode: insert directly into boardElement
        const directChildren = Array.from(boardElement.children).filter(child =>
            child.classList.contains('kanban-full-height-column') ||
            child.classList.contains('kanban-column-stack') ||
            child.classList.contains('column-drop-zone-stack')
        );

        try {
            if (insertIndex >= 0 && insertIndex < directChildren.length) {
                const referenceNode = directChildren[insertIndex];
                if (referenceNode && referenceNode.parentNode === boardElement) {
                    boardElement.insertBefore(columnElement, referenceNode);
                } else {
                    boardElement.appendChild(columnElement);
                }
            } else {
                boardElement.appendChild(columnElement);
            }
        } catch (error) {
            console.error('[addSingleColumnToDOM] Error inserting column:', error);
            try {
                boardElement.appendChild(columnElement);
            } catch (appendError) {
                console.error('[addSingleColumnToDOM] Error appending column:', appendError);
                return null;
            }
        }
    }

    // Update image sources
    if (typeof updateImageSources === 'function') {
        updateImageSources();
    }

    // Setup drag & drop for the new column
    if (typeof setupColumnDragAndDrop === 'function') {
        setupColumnDragAndDrop();
    }

    // CRITICAL: Setup task drag & drop for this specific column (optimized)
    if (typeof setupTaskDragAndDropForColumn === 'function') {
        setupTaskDragAndDropForColumn(columnElement);
    }

    // Recreate drop zones for the row/board that was modified
    if (isMultiRow) {
        const columnRow = getColumnRow(column.title);
        const rowContainer = boardElement.querySelector(`.kanban-row[data-row-number="${columnRow}"]`);
        if (rowContainer && typeof window.cleanupAndRecreateDropZones === 'function') {
            window.cleanupAndRecreateDropZones(rowContainer);
        }
    } else {
        // For single-row boards, recreate drop zones for the entire board
        if (typeof window.cleanupAndRecreateDropZones === 'function') {
            window.cleanupAndRecreateDropZones(boardElement);
        }
    }

    return columnElement;
}

// Expose incremental rendering functions
window.addSingleTaskToDOM = addSingleTaskToDOM;
window.addSingleColumnToDOM = addSingleColumnToDOM;
window.renderSingleTask = renderSingleTask;
