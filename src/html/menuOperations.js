// Unified Menu System - Simple and DRY

// Declare window properties for TypeScript
if (typeof window !== 'undefined') {
    window._lastFlushedChanges = null;
    window.handleColumnTagClick = null;
    window.handleTaskTagClick = null;
}

// Global state
let activeTagMenu = null;

/**
 * Scrolls an element into view only if it's outside the viewport
 * @param {HTMLElement} element - Element to check and potentially scroll
 * @param {string} type - 'task' or 'column' for logging purposes
 */
function scrollToElementIfNeeded(element, type = 'element') {
    if (!element) return;

    const rect = element.getBoundingClientRect();

    // For columns, check horizontal visibility
    // For tasks, check vertical visibility
    let isVisible;
    if (type === 'column') {
        isVisible = rect.left >= 0 && rect.right <= window.innerWidth;
    } else {
        isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
    }


    if (!isVisible) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

/**
 * Moves a task element in the DOM without full re-render
 * @param {string} taskId - The task ID to move
 * @param {string} columnId - The column ID containing the task (source)
 * @param {number} newIndex - The new index position in the column
 * @param {string} [targetColumnId] - Target column ID if moving between columns
 */
function moveTaskInDOM(taskId, columnId, newIndex, targetColumnId = null) {
    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!taskElement) return false;

    const targetColId = targetColumnId || columnId;
    const targetContainer = document.querySelector(`#tasks-${targetColId}`);
    if (!targetContainer) return false;

    // Track source stack before moving (for height recalculation)
    const sourceColumn = taskElement.closest('.kanban-full-height-column');
    const sourceStack = sourceColumn?.closest('.kanban-column-stack');

    // Get all task items in the target container (excluding the task being moved if same column)
    const taskItems = Array.from(targetContainer.querySelectorAll('.task-item'))
        .filter(el => el.dataset.taskId !== taskId);

    // Find the add button to insert before if needed
    const addButton = targetContainer.querySelector('.add-task-btn');

    // Remove task from current position
    taskElement.parentNode.removeChild(taskElement);

    // Insert at new position
    if (newIndex >= taskItems.length) {
        // Insert at end (before add button if exists)
        if (addButton) {
            targetContainer.insertBefore(taskElement, addButton);
        } else {
            targetContainer.appendChild(taskElement);
        }
    } else {
        // Insert before the element at newIndex
        targetContainer.insertBefore(taskElement, taskItems[newIndex]);
    }

    // Recalculate stack heights after task move (use debounced for better performance)
    const targetColumn = targetContainer.closest('.kanban-full-height-column');
    const targetStack = targetColumn?.closest('.kanban-column-stack');

    if (typeof updateStackLayoutDebounced === 'function') {
        // Recalculate source stack
        if (sourceStack) {
            updateStackLayoutDebounced(sourceStack);
        }
        // Recalculate target stack (if different from source)
        if (targetStack && targetStack !== sourceStack) {
            updateStackLayoutDebounced(targetStack);
        }
    }

    // Scroll to make the moved task visible
    scrollToElementIfNeeded(taskElement, 'task');

    return true;
}

// Simple Menu Manager - handles all menu types
class SimpleMenuManager {
    constructor() {
        this.activeSubmenu = null;
        this.hideTimeout = null;
    }

    // Safe button click handler - works for all button types without eval
    handleButtonClick(button, shouldCloseMenu = true) {
        
        // Check if this is a tag chip button - these have their own click handlers
        // and should not be double-handled
        if (button.classList.contains('donut-menu-tag-chip')) {
            // Still close the menu, but don't re-execute the onclick
            if (shouldCloseMenu) {
                setTimeout(() => this.hideSubmenu(), 100);
            }
            return;
        }
        
        // Get onclick attribute and parse it safely
        const onclick = button.getAttribute('onclick');
        if (onclick) {
            try {
                // Parse and execute without eval for security
                const executed = this.executeSafeFunction(onclick, button);
                if (executed) {
                } else {
                    console.warn('Could not execute:', onclick);
                }
            } catch (error) {
                console.error('Failed to execute:', onclick, error);
            }
        }
        
        // Close submenu if requested
        if (shouldCloseMenu) {
            setTimeout(() => this.hideSubmenu(), 100);
        }
    }

    // Safe function execution without eval
    executeSafeFunction(functionString, element) {

        // Handle window.tagHandlers pattern - but check if already handled
        const tagHandlerMatch = functionString.match(/window\.tagHandlers\['([^']+)'\]\(([^)]*)\)/);
        if (tagHandlerMatch) {
            const handlerKey = tagHandlerMatch[1];
            const params = tagHandlerMatch[2];
            
            // Check if this is a tag handler that we've already executed
            if (window.tagHandlers && window.tagHandlers[handlerKey]) {
                // Skip if this was already handled by the direct tag system
                const now = Date.now();
                const lastExecuted = element._lastTagExecution || 0;
                if (now - lastExecuted < 100) {
                    return true;
                }
                element._lastTagExecution = now;
                
                // Create event object if needed
                const event = params.includes('event') ? new Event('click') : undefined;
                window.tagHandlers[handlerKey](event);
                return true;
            }
        }
        
        // Handle common function patterns
        const patterns = [
            // Pattern: functionName('param1', 'param2', etc.)
            /^(\w+)\((.*)\)$/,
            // Pattern: object.method('param1', 'param2')
            /^(\w+)\.(\w+)\((.*)\)$/
        ];
        
        for (const pattern of patterns) {
            const match = functionString.match(pattern);
            if (match) {
                if (match.length === 3) {
                    // Simple function call
                    const funcName = match[1];
                    const params = this.parseParameters(match[2]);

                    if (window[funcName] && typeof window[funcName] === 'function') {
                        window[funcName].apply(window, params);
                        return true;
                    }
                } else if (match.length === 4) {
                    // Object method call
                    const objName = match[1];
                    const methodName = match[2]; 
                    const params = this.parseParameters(match[3]);
                    
                    if (window[objName] && window[objName][methodName] && 
                        typeof window[objName][methodName] === 'function') {
                        window[objName][methodName].apply(window[objName], params);
                        return true;
                    }
                }
            }
        }
        
        // Handle multiple statements separated by semicolons
        if (functionString.includes(';')) {
            const statements = functionString.split(';').filter(s => s.trim());
            let allExecuted = true;
            for (const statement of statements) {
                if (statement.trim() && statement.trim() !== 'return false') {
                    if (!this.executeSafeFunction(statement.trim(), element)) {
                        allExecuted = false;
                    }
                }
            }
            return allExecuted;
        }
        
        return false; // Could not execute
    }

    /**
     * Parses function parameters from string safely
     * Purpose: Extract arguments without eval
     * Used by: executeSafeFunction() for parameter extraction
     * @param {string} paramString - Comma-separated parameters
     * @returns {Array} Parsed parameter values
     */
    parseParameters(paramString) {
        if (!paramString || !paramString.trim()) {return [];}
        
        const params = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';
        
        for (let i = 0; i < paramString.length; i++) {
            const char = paramString[i];
            
            if (!inQuotes && (char === '"' || char === "'")) {
                inQuotes = true;
                quoteChar = char;
                current += char;
            } else if (inQuotes && char === quoteChar) {
                inQuotes = false;
                current += char;
            } else if (!inQuotes && char === ',') {
                params.push(this.parseValue(current.trim()));
                current = '';
            } else {
                current += char;
            }
        }
        
        if (current.trim()) {
            params.push(this.parseValue(current.trim()));
        }
        
        return params;
    }
    
    // Helper method to parse individual parameter values
    parseValue(value) {
        const trimmed = value.trim();
        
        // String values
        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
            (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            return trimmed.slice(1, -1);
        }
        
        // Number values
        if (!isNaN(trimmed) && trimmed !== '') {
            return Number(trimmed);
        }
        
        // Boolean values
        if (trimmed === 'true') {return true;}
        if (trimmed === 'false') {return false;}
        if (trimmed === 'null') {return null;}
        if (trimmed === 'undefined') {return undefined;}
        
        // Return as string for everything else
        return trimmed;
    }

    // Show submenu - unified approach
    showSubmenu(menuItem, id, type, columnId = null) {
        this.hideSubmenu(); // Clear any existing

        const submenu = document.createElement('div');
        submenu.className = 'donut-menu-submenu dynamic-submenu';

        // Store submenu type as data attribute for refresh functionality
        const submenuType = menuItem.dataset.submenuType;
        if (submenuType) {
            submenu.setAttribute('data-submenu-type', submenuType);
        }

        // Create content based on submenu type
        submenu.innerHTML = this.createSubmenuContent(menuItem, id, type, columnId);

        // Base styles from CSS class - positioning is done later
        submenu.classList.add('donut-submenu');

        // Append to body to escape any stacking contexts
        document.body.appendChild(submenu);

        // Store reference to the menu item for positioning
        submenu._menuItem = menuItem;

        this.setupSubmenuEvents(submenu);
        this.activeSubmenu = submenu;

        return submenu;
    }

    // Create submenu content - simplified
    createSubmenuContent(menuItem, id, type, columnId) {
        const submenuType = menuItem.dataset.submenuType;
        
        switch (submenuType) {
            case 'tags':
                return this.createTagContent(menuItem.dataset.group, id, type, columnId);
            case 'marp-directives':
                return this.createMarpDirectivesContent(menuItem.dataset.scope, id, type, columnId);
            case 'move':
                return `
                    <button class="donut-menu-item" onclick="moveTaskToTop('${id}', '${columnId}')">Top</button>
                    <button class="donut-menu-item" onclick="moveTaskUp('${id}', '${columnId}')">Up</button>
                    <button class="donut-menu-item" onclick="moveTaskDown('${id}', '${columnId}')">Down</button>
                    <button class="donut-menu-item" onclick="moveTaskToBottom('${id}', '${columnId}')">Bottom</button>
                `;
            case 'move-to-list':
                return this.createMoveToListContent(id, columnId);
            case 'sort':
                return `
                    <button class="donut-menu-item" onclick="sortColumn('${columnId}', 'unsorted')">Unsorted</button>
                    <button class="donut-menu-item" onclick="sortColumn('${columnId}', 'title')">Sort by title</button>
                    <button class="donut-menu-item" onclick="sortColumn('${columnId}', 'numericTag')">Sort by index (#)</button>
                `;
            case 'marp-classes':
                return this.createMarpClassesContent(menuItem.dataset.scope, id, type, columnId);
            case 'marp-colors':
                return this.createMarpColorsContent(menuItem.dataset.scope, id, type, columnId);
            case 'marp-header-footer':
                return this.createMarpHeaderFooterContent(menuItem.dataset.scope, id, type, columnId);
            default:
                return '';
        }
    }

    // Create Marp Classes submenu - includes class toggles and paginate
    createMarpClassesContent(scope, id, type, columnId) {
        let html = '<div style="padding: 8px; max-width: 450px; min-width: 300px;">';

        // Get current element to check scoped state
        let element = null;
        if (scope === 'column') {
            element = window.cachedBoard?.columns?.find(c => c.id === id);
        } else if (scope === 'task' && columnId) {
            const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
            element = column?.tasks?.find(t => t.id === id);
        }
        const title = element?.title || '';

        // Get both local and scoped classes
        const localClassMatch = title.match(/<!--\s*class:\s*([^>]+?)\s*-->/);
        const scopedClassMatch = title.match(/<!--\s*_class:\s*([^>]+?)\s*-->/);

        const localClasses = localClassMatch ? localClassMatch[1].trim().split(/\s+/).filter(c => c.length > 0) : [];
        const scopedClasses = scopedClassMatch ? scopedClassMatch[1].trim().split(/\s+/).filter(c => c.length > 0) : [];

        // Classes grid - TWO sections: Local and Scoped
        html += '<div style="margin-bottom: 12px;">';

        const availableClasses = window.marpAvailableClasses || [];

        // LOCAL classes section - title and content on same line
        html += '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-direction: column; align-items: baseline;">';
        html += '<div style="font-weight: bold; color: #ddd; font-size: 10px; white-space: nowrap;">LOCAL</div>';
        html += '<div class="donut-menu-tags-grid" style="flex: 1;">';

        availableClasses.forEach(className => {
            const isActive = localClasses.includes(className);
            html += `
                <button class="donut-menu-tag-chip ${isActive ? 'active' : ''}"
                        onclick="toggleMarpClass('${scope}', '${id}', '${columnId || ''}', '${className}', 'local')"
                        style="border-color: #4a90e2; background: ${isActive ? '#4a90e2' : 'var(--vscode-menu-background)'};">
                    <span class="tag-chip-check">${isActive ? '✓' : ''}</span>
                    <span class="tag-chip-name">${className}</span>
                </button>
            `;
        });
        html += '</div></div>';

        // SCOPED classes section - title and content on same line
        html += '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-direction: column; align-items: baseline;">';
        html += '<div style="font-weight: bold; color: #ddd; font-size: 10px; white-space: nowrap;">SCOPED</div>';
        html += '<div class="donut-menu-tags-grid" style="flex: 1;">';

        availableClasses.forEach(className => {
            const isActive = scopedClasses.includes(className);
            html += `
                <button class="donut-menu-tag-chip ${isActive ? 'active' : ''}"
                        onclick="toggleMarpClass('${scope}', '${id}', '${columnId || ''}', '${className}', 'scoped')"
                        style="border-color: #ff9500; background: ${isActive ? '#ff9500' : 'var(--vscode-menu-background)'};">
                    <span class="tag-chip-check">${isActive ? '✓' : ''}</span>
                    <span class="tag-chip-name">${className}</span>
                </button>
            `;
        });
        html += '</div></div>';

        html += '</div>';
        html += '</div>';
        return html;
    }

    // Create Marp Colors submenu - includes color, backgroundColor, backgroundImage, and all background properties
    createMarpColorsContent(scope, id, type, columnId) {
        let html = '<div style="padding: 8px; max-width: 350px; min-width: 250px;">';

        // Get current element to check scoped states
        let element = null;
        if (scope === 'column') {
            element = window.cachedBoard?.columns?.find(c => c.id === id);
        } else if (scope === 'task' && columnId) {
            const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
            element = column?.tasks?.find(t => t.id === id);
        }
        const title = element?.title || '';

        // Helper function to create TWO directive inputs (local and scoped)
        const createDirectiveInput = (directiveName, label, placeholder) => {
            return `
                <div style="margin-bottom: 12px;">
                    <div style="font-weight: bold; margin-bottom: 6px; color: #ddd; font-size: 10px;">${label}</div>
                    <div style="display: flex; gap: 8px; margin-bottom: 4px;">
                        <input type="text" placeholder="Local (this + following)"
                               onkeypress="if(event.key==='Enter'){setMarpDirective('${scope}','${id}','${columnId||''}','${directiveName}',this.value,'local');this.value='';}"
                               style="flex: 1; padding: 6px; background: var(--board-background); border: 1px solid #4a90e2; color: var(--vscode-foreground); border-radius: 4px; font-size: 11px;">
                        <input type="text" placeholder="Scoped (this only)"
                               onkeypress="if(event.key==='Enter'){setMarpDirective('${scope}','${id}','${columnId||''}','${directiveName}',this.value,'scoped');this.value='';}"
                               style="flex: 1; padding: 6px; background: var(--board-background); border: 1px solid #ff9500; color: var(--vscode-foreground); border-radius: 4px; font-size: 11px;">
                    </div>
                </div>
            `;
        };

        // Use helper to create all color directive inputs
        html += createDirectiveInput('color', 'TEXT COLOR', 'e.g., red, #FF5733');
        html += createDirectiveInput('backgroundColor', 'BACKGROUND COLOR', 'e.g., black, #333333');
        html += createDirectiveInput('backgroundImage', 'BACKGROUND IMAGE', 'e.g., url(image.jpg)');
        html += createDirectiveInput('backgroundPosition', 'BACKGROUND POSITION', 'e.g., center, top left');
        html += createDirectiveInput('backgroundRepeat', 'BACKGROUND REPEAT', 'e.g., no-repeat, repeat-x');
        html += createDirectiveInput('backgroundSize', 'BACKGROUND SIZE', 'e.g., cover, contain, 50%');

        html += '</div>';
        return html;
    }

    // Create Marp Header & Footer submenu
    createMarpHeaderFooterContent(scope, id, type, columnId) {
        let html = '<div style="padding: 8px; max-width: 350px; min-width: 250px;">';

        // Get current element to check scoped states
        let element = null;
        if (scope === 'column') {
            element = window.cachedBoard?.columns?.find(c => c.id === id);
        } else if (scope === 'task' && columnId) {
            const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
            element = column?.tasks?.find(t => t.id === id);
        }
        const title = element?.title || '';

        // Helper function to create TWO directive inputs (local and scoped)
        const createDirectiveInput = (directiveName, label, placeholder) => {
            return `
                <div style="margin-bottom: 12px;">
                    <div style="font-weight: bold; margin-bottom: 6px; color: #ddd; font-size: 10px;">${label}</div>
                    <div style="display: flex; gap: 8px; margin-bottom: 4px;">
                        <input type="text" placeholder="Local (this + following)"
                               onkeypress="if(event.key==='Enter'){setMarpDirective('${scope}','${id}','${columnId||''}','${directiveName}',this.value,'local');this.value='';}"
                               style="flex: 1; padding: 6px; background: var(--board-background); border: 1px solid #4a90e2; color: var(--vscode-foreground); border-radius: 4px; font-size: 11px;">
                        <input type="text" placeholder="Scoped (this only)"
                               onkeypress="if(event.key==='Enter'){setMarpDirective('${scope}','${id}','${columnId||''}','${directiveName}',this.value,'scoped');this.value='';}"
                               style="flex: 1; padding: 6px; background: var(--board-background); border: 1px solid #ff9500; color: var(--vscode-foreground); border-radius: 4px; font-size: 11px;">
                    </div>
                </div>
            `;
        };

        html += createDirectiveInput('header', 'HEADER TEXT', 'Header content');
        html += createDirectiveInput('footer', 'FOOTER TEXT', 'Footer content');

        // Paginate - TWO buttons: local and scoped
        const isLocalPaginateActive = /<!--\s*paginate:\s*true\s*-->/.test(title);
        const isScopedPaginateActive = /<!--\s*_paginate:\s*true\s*-->/.test(title);

        html += '<div style="margin-bottom: 8px;">';
        html += '<div style="font-weight: bold; margin-bottom: 6px; color: #ddd; font-size: 10px;">PAGE NUMBERING</div>';
        html += '<div style="display: flex; gap: 8px;">';

        // Local paginate button
        html += `
            <button class="donut-menu-tag-chip ${isLocalPaginateActive ? 'active' : ''}"
                    onclick="toggleMarpDirective('${scope}', '${id}', '${columnId || ''}', 'paginate', 'true', 'local')"
                    style="flex: 1; padding: 6px 8px; font-size: 11px; border: 1px solid #4a90e2; border-radius: 4px; background: ${isLocalPaginateActive ? '#4a90e2' : 'var(--board-background)'}; color: var(--vscode-foreground); cursor: pointer; text-align: center;">
                ${isLocalPaginateActive ? '✓ ' : ''}Local
            </button>
        `;

        // Scoped paginate button
        html += `
            <button class="donut-menu-tag-chip ${isScopedPaginateActive ? 'active' : ''}"
                    onclick="toggleMarpDirective('${scope}', '${id}', '${columnId || ''}', 'paginate', 'true', 'scoped')"
                    style="flex: 1; padding: 6px 8px; font-size: 11px; border: 1px solid #ff9500; border-radius: 4px; background: ${isScopedPaginateActive ? '#ff9500' : 'var(--board-background)'}; color: var(--vscode-foreground); cursor: pointer; text-align: center;">
                ${isScopedPaginateActive ? '✓ ' : ''}Scoped
            </button>
        `;

        html += '</div></div>';

        html += '</div>';
        return html;
    }


    // Create tag content - simplified
    createTagContent(group, id, type, columnId) {
        if (window.generateGroupTagItems) {
            const tagConfig = window.tagColors || {};
            let tags = [];

            // Get current element's active tags to ensure they're always shown
            const currentBoard = window.cachedBoard;
            let currentTitle = '';
            if (type === 'column') {
                const column = currentBoard?.columns?.find(c => c.id === id);
                currentTitle = column?.title || '';
            } else if (type === 'task' && columnId) {
                const column = currentBoard?.columns?.find(c => c.id === columnId);
                const task = column?.tasks?.find(t => t.id === id);
                currentTitle = task?.title || '';
            }
            const activeTags = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(currentTitle) : [];

            if (group === 'custom') {
                tags = window.getUserAddedTags ? window.getUserAddedTags() : [];
            } else {
                const groupValue = tagConfig[group];

                if (groupValue && typeof groupValue === 'object') {
                    // Check if this is a direct tag (has any styling properties)
                    const isDirectTag = groupValue.light || groupValue.dark || groupValue.headerBar ||
                                       groupValue.border || groupValue.footerBar || groupValue.cornerBadge;

                    if (isDirectTag) {
                        tags = [group];
                    } else {
                        // It's a group, collect its tags that have styling OR are currently active
                        tags = Object.keys(groupValue).filter(key => {
                            const val = groupValue[key];
                            // Include if has styling properties OR if currently active on this element
                            const hasTagProperties = val && typeof val === 'object' &&
                                                    (val.light || val.dark || val.headerBar ||
                                                     val.border || val.footerBar || val.cornerBadge);
                            const isActive = activeTags.includes(key.toLowerCase());
                            return hasTagProperties || isActive;
                        });
                    }
                }
            }

            return window.generateGroupTagItems(tags, id, type, columnId, group !== 'custom');
        }
        return '<div>No tags available</div>';
    }

    // Create move to list content
    createMoveToListContent(taskId, columnId) {
        const currentBoard = window.cachedBoard;
        if (!currentBoard?.columns) {return '';}
        
        return currentBoard.columns
            .filter(col => col.id !== columnId)
            .map(col => `<button class="donut-menu-item" onclick="moveTaskToColumn('${taskId}', '${columnId}', '${col.id}')">${window.escapeHtml ? window.escapeHtml(col.title || 'Untitled') : col.title || 'Untitled'}</button>`)
            .join('');
    }

    // Setup submenu events - unified approach
    setupSubmenuEvents(submenu) {
        // Add click handlers to all buttons
        submenu.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Check if this is a move operation button
                const onclick = button.getAttribute('onclick');
                const isMoveOperation = onclick && onclick.includes('moveTask');
                
                // Tag chips don't close menu, move operations force close
                const shouldClose = !button.classList.contains('donut-menu-tag-chip');
                
                // For move operations, ensure menu closes immediately
                if (isMoveOperation) {
                    this.handleButtonClick(button, true);
                    // Force immediate menu closure for move operations
                    setTimeout(() => {
                        closeAllMenus();
                        this.hideSubmenu();
                    }, 10);
                } else {
                    this.handleButtonClick(button, shouldClose);
                }
            });
        });

        // Hover management - track when we're in a submenu
        submenu.addEventListener('mouseenter', () => {
            this.clearTimeout();
            window._inSubmenu = true;
            // Also set dropdown state to prevent closing during transition
            window._inDropdown = true;
        });
        submenu.addEventListener('mouseleave', () => {
            window._inSubmenu = false;
            // Clear dropdown state when leaving submenu
            window._inDropdown = false;
            this.startHideTimer();
        });
    }

    // Smart positioning that handles viewport boundaries
    positionSubmenu(menuItem, submenu) {
        const rect = menuItem.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Ensure submenu is hidden but measurable (CSS class has visibility:hidden, display:flex)
        submenu.classList.remove('visible');

        // Get submenu dimensions
        const submenuRect = submenu.getBoundingClientRect();
        const submenuWidth = submenuRect.width || 250;
        const submenuHeight = submenuRect.height || 300;

        // Calculate horizontal position
        let left = rect.right - 1; // 1px overlap for easy mouse movement

        // If submenu goes off right edge, position to the left of menu item
        if (left + submenuWidth > viewportWidth - 10) {
            left = rect.left - submenuWidth + 1; // 1px overlap on left side
        }

        // Final horizontal boundary check
        if (left < 10) {
            left = 10;
        }
        if (left + submenuWidth > viewportWidth - 10) {
            left = viewportWidth - submenuWidth - 10;
        }

        // Calculate vertical position
        let top = rect.top; // Align with menu item top

        // If submenu goes off bottom edge, move it up
        if (top + submenuHeight > viewportHeight - 10) {
            top = viewportHeight - submenuHeight - 10;
        }

        // If still off top edge (very tall submenu), align with viewport top
        if (top < 10) {
            top = 10;
        }

        // Apply final positioning
        submenu.style.left = left + 'px';
        submenu.style.top = top + 'px';

        // Show submenu via CSS class
        submenu.classList.add('visible');
    }

    // Timeout management
    startHideTimer() {
        this.clearTimeout();
        this.hideTimeout = setTimeout(() => {
            // RECHECK: Verify we're actually not hovering before closing
            // This prevents menus from closing if mouse quickly re-enters
            const isHoveringSubmenu = this.activeSubmenu && this.activeSubmenu.matches(':hover');
            const isHoveringDropdown = Array.from(document.querySelectorAll('.donut-menu-dropdown, .file-bar-menu-dropdown'))
                .some(el => el.matches(':hover'));

            if (isHoveringSubmenu || isHoveringDropdown) {
                // Mouse is back in menu, don't close
                return;
            }

            this.hideSubmenu();

            // Also close parent menu if we're not hovering over it
            setTimeout(() => {
                // RECHECK again before closing parent menu
                const isHoveringMenu = document.querySelector('.donut-menu.active:hover') !== null;
                const isHoveringAnyDropdown = Array.from(document.querySelectorAll('.donut-menu-dropdown, .file-bar-menu-dropdown'))
                    .some(el => el.matches(':hover'));
                const isHoveringAnySubmenu = document.querySelector('.dynamic-submenu:hover') !== null;

                if (isHoveringMenu || isHoveringAnyDropdown || isHoveringAnySubmenu) {
                    // Still hovering, don't close
                    return;
                }

                // CRITICAL: Don't close menu if a button inside a moved dropdown has focus
                // This prevents scroll issues when clicking tag buttons
                const activeElement = document.activeElement;
                const isInMovedDropdown = activeElement?.closest('.donut-menu-dropdown.moved-to-body, .file-bar-menu-dropdown.moved-to-body');

                if (isInMovedDropdown) {
                    return; // Don't close the menu
                }

                document.querySelectorAll('.donut-menu.active').forEach(menu => {
                    menu.classList.remove('active');

                    // Clean up any moved dropdowns - check both in menu and moved to body
                    let dropdown = menu.querySelector('.donut-menu-dropdown, .file-bar-menu-dropdown');
                    if (!dropdown) {
                        // Look for moved dropdowns in body that belong to this menu
                        const movedDropdowns = document.body.querySelectorAll('.donut-menu-dropdown.moved-to-body, .file-bar-menu-dropdown.moved-to-body');
                        dropdown = Array.from(movedDropdowns).find(d => d._originalParent === menu);
                    }

                    if (dropdown) {
                        cleanupDropdown(dropdown);
                    }
                });
            }, 100);
        }, 300);
    }

    clearTimeout() {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    // Hide submenu
    hideSubmenu() {
        this.clearTimeout();
        if (this.activeSubmenu) {
            this.activeSubmenu.remove();
            this.activeSubmenu = null;
        }
        document.querySelectorAll('.dynamic-submenu').forEach(s => s.remove());
    }
}

// Global menu manager instance
window.menuManager = new SimpleMenuManager();

/**
 * Cleans up dropdowns that were moved to document.body
 * Purpose: Restore dropdowns to original position when closing
 * Used by: closeAllMenus(), menu close operations
 * @param {HTMLElement} dropdown - Dropdown element to clean up
 * Side effects: Restores DOM position, clears positioning styles
 */
function cleanupDropdown(dropdown) {
    if (dropdown._originalParent && dropdown.parentElement === document.body) {
        // Restore to original position
        if (dropdown._originalNextSibling) {
            dropdown._originalParent.insertBefore(dropdown, dropdown._originalNextSibling);
        } else {
            dropdown._originalParent.appendChild(dropdown);
        }

        // Clean up tracking properties and CSS classes
        delete dropdown._originalParent;
        delete dropdown._originalNextSibling;
        dropdown.classList.remove('moved-to-body');

        // Reset styles
        dropdown.style.position = '';
        dropdown.style.left = '';
        dropdown.style.top = '';
        dropdown.style.zIndex = '';
    }
}

/**
 * Closes all open menus and cleans up moved dropdowns
 * Purpose: Complete menu cleanup including repositioned elements
 * Used by: Click outside, task moves, saves
 * Side effects: Removes active classes, restores dropdown positions
 */
function closeAllMenus() {
    // Close donut menus and only clean up dropdowns that were actually moved to body
    document.querySelectorAll('.donut-menu, .file-bar-menu').forEach(m => {
        m.classList.remove('active');
    });
    
    // Only clean up dropdowns that were actually moved to body
    document.querySelectorAll('.donut-menu-dropdown.moved-to-body, .file-bar-menu-dropdown.moved-to-body').forEach(dropdown => {
        cleanupDropdown(dropdown);
    });
}

/**
 * Toggles burger/donut menu open/closed state
 * Purpose: Main menu activation for columns and tasks
 * Used by: Burger button clicks on columns and tasks
 * @param {Event} event - Click event
 * @param {HTMLElement} button - Menu button element
 */
function toggleDonutMenu(event, button) {
    event.stopPropagation();
    const menu = button.parentElement;
    const wasActive = menu.classList.contains('active');
    
    // Close all menus and clean up their dropdowns (only needed here for moved dropdowns)
    closeAllMenus();
    
    if (!wasActive) {
        menu.classList.add('active');
        activeTagMenu = menu;
        
        const dropdown = menu.querySelector('.donut-menu-dropdown');
        if (dropdown) {
            positionDropdown(button, dropdown);
            setupMenuHoverHandlers(menu, dropdown);
            
            // Update tag category counts when menu opens
            // Find tag menu items (including "No tags available" button which has data-group="none")
            const tagMenuItem = dropdown.querySelector('[data-group][data-id][data-type]');
            if (tagMenuItem) {
                const id = tagMenuItem.getAttribute('data-id');
                const type = tagMenuItem.getAttribute('data-type');
                const columnId = tagMenuItem.getAttribute('data-column-id');
                updateTagCategoryCounts(id, type, columnId);
            }
        }
    }
}

/**
 * Sets up hover interactions for menu and submenus
 * Purpose: Enable smooth menu navigation with hover delays
 * Used by: toggleDonutMenu() after menu opens
 * @param {HTMLElement} menu - Menu container
 * @param {HTMLElement} dropdown - Dropdown container
 */
function setupMenuHoverHandlers(menu, dropdown) {
    // Add hover handlers to the menu button itself to maintain hover state
    const menuButton = menu.querySelector('.donut-menu-btn');
    if (menuButton) {
        menuButton.addEventListener('mouseenter', () => {
            window.menuManager.clearTimeout();
            window._inDropdown = true;
        });
        menuButton.addEventListener('mouseleave', () => {
            window._inDropdown = false;
            window.menuManager.startHideTimer();
        });
    }
    
    // Add hover handlers to the dropdown itself (including padding border area)
    dropdown.addEventListener('mouseenter', () => {
        window.menuManager.clearTimeout();
        window._inDropdown = true;
    });
    dropdown.addEventListener('mouseleave', () => {
        window._inDropdown = false;
        window.menuManager.startHideTimer();
    });

    // Close submenu when hovering over items without submenus
    dropdown.querySelectorAll('.donut-menu-item:not(.has-submenu)').forEach(menuItem => {
        menuItem.addEventListener('mouseenter', () => {
            window.menuManager.hideSubmenu();
        });
    });

    dropdown.querySelectorAll('.donut-menu-item.has-submenu').forEach(menuItem => {
        menuItem.addEventListener('mouseenter', () => {
            window.menuManager.clearTimeout();
            
            const submenu = window.menuManager.showSubmenu(
                menuItem, 
                menuItem.dataset.id, 
                menuItem.dataset.type, 
                menuItem.dataset.columnId
            );
            
            if (submenu) {
                window.menuManager.positionSubmenu(menuItem, submenu);
            }
        });
        
        menuItem.addEventListener('mouseleave', () => {
            window.menuManager.startHideTimer();
        });
    });
}

// Simple dropdown positioning - uses unified menuUtils.positionDropdownMenu
function positionDropdown(triggerButton, dropdown) {
    // Use unified function with moveToBody enabled (for donut menu stacking context escape)
    if (window.menuUtils && window.menuUtils.positionDropdownMenu) {
        window.menuUtils.positionDropdownMenu(triggerButton, dropdown, {
            moveToBody: true,
            offsetY: 5,
            defaultWidth: 180,
            defaultHeight: 300
        });
    }
}

// NOTE: toggleFileBarMenu and positionFileBarDropdown are defined in webview.js
// (webview.js version has essential submenu/Marp handling that loads after this file)

// Column operations - keep existing functions
function insertColumnBefore(columnId) {
    // Close all menus properly
    closeAllMenus();

    // Get reference column and its row
    const referenceIndex = window.cachedBoard?.columns.findIndex(col => col.id === columnId) || 0;
    const referenceColumn = window.cachedBoard?.columns[referenceIndex];

    // Extract row tag from reference column
    let tags = '';
    if (referenceColumn && referenceColumn.title) {
        const rowMatch = referenceColumn.title.match(/#row(\d+)\b/i);
        if (rowMatch) {
            tags = ` ${rowMatch[0]}`;
        }

        // CRITICAL: Check if reference has #stack BEFORE modifying it
        const hasStack = /#stack\b/i.test(referenceColumn.title);

        // New column gets #stack only if reference already had it
        if (hasStack) {
            tags += ' #stack';
        }

        // Reference column gets #stack tag if it doesn't have it
        if (!hasStack) {
            const trimmedTitle = referenceColumn.title.trim();
            referenceColumn.title = trimmedTitle ? `${trimmedTitle} #stack` : ' #stack';

            // Update the reference column title in the DOM
            if (typeof updateColumnTitleDisplay === 'function') {
                updateColumnTitleDisplay(columnId);
            }
        }
    }

    // Cache-first: Create new column and insert before reference column
    const newColumn = {
        id: `temp-column-before-${Date.now()}`,
        title: tags.trim(), // Row tag only (NO #stack tag)
        tasks: []
    };

    updateCacheForNewColumn(newColumn, referenceIndex, columnId);

    // No VS Code message - cache-first system requires explicit save via Cmd+S
}

function insertColumnAfter(columnId) {
    // Close all menus properly
    closeAllMenus();

    // Get reference column and its row
    const referenceIndex = window.cachedBoard?.columns.findIndex(col => col.id === columnId) || 0;
    const referenceColumn = window.cachedBoard?.columns[referenceIndex];

    // Extract row tag and stack tag from reference column
    let tags = '';
    if (referenceColumn && referenceColumn.title) {
        const rowMatch = referenceColumn.title.match(/#row(\d+)\b/i);
        if (rowMatch) {
            tags = ` ${rowMatch[0]}`;
        }

        // Only add #stack if reference column already has it (joining existing stack)
        const hasStack = /#stack\b/i.test(referenceColumn.title);
        if (hasStack) {
            tags += ' #stack';
        }
    }

    // Cache-first: Create new column and insert after reference column
    const newColumn = {
        id: `temp-column-after-${Date.now()}`,
        title: tags.trim(), // Row tag and #stack tag
        tasks: []
    };

    updateCacheForNewColumn(newColumn, referenceIndex + 1, columnId);

    // No VS Code message - cache-first system requires explicit save via Cmd+S
}

function duplicateColumn(columnId) {
    // Close all menus properly
    closeAllMenus();

    // Cache-first: Only update cached board, no automatic save
    if (window.cachedBoard) {
        const originalIndex = window.cachedBoard.columns.findIndex(col => col.id === columnId);
        if (originalIndex >= 0) {
            const originalColumn = window.cachedBoard.columns[originalIndex];

            // Deep copy the tasks array
            const duplicatedTasks = originalColumn.tasks.map(task => ({
                id: `temp-duplicate-task-${Date.now()}-${Math.random()}`,
                title: task.title || '',
                description: task.description || '',
                includeMode: task.includeMode || false,
                includeFile: task.includeFile || null
            }));

            // Create duplicated column
            const duplicatedColumn = {
                id: `temp-duplicate-column-${Date.now()}`,
                title: originalColumn.title || '',
                tasks: duplicatedTasks,
                includeMode: originalColumn.includeMode || false,
                includeFile: originalColumn.includeFile || null
            };

            // Insert after the original column
            updateCacheForNewColumn(duplicatedColumn, originalIndex + 1, columnId);
        }
    }

    // No VS Code message - cache-first system requires explicit save via Cmd+S
}

function moveColumnLeft(columnId) {
    if (!currentBoard?.columns) {return;}

    // Flush pending tag changes before moving
    if ((window.pendingTaskChanges && window.pendingTaskChanges.size > 0) ||
        (window.pendingColumnChanges && window.pendingColumnChanges.size > 0)) {
        flushPendingTagChanges();
    }

    const index = currentBoard.columns.findIndex(c => c.id === columnId);
    if (index > 0) {
        const column = currentBoard.columns[index];
        const currentRow = getColumnRow(column.title);

        // Update cache immediately
        const [movedColumn] = currentBoard.columns.splice(index, 1);
        currentBoard.columns.splice(index - 1, 0, movedColumn);
        if (window.cachedBoard && window.cachedBoard !== currentBoard) {
            const cachedIndex = window.cachedBoard.columns.findIndex(c => c.id === columnId);
            if (cachedIndex > 0) {
                const [cachedMovedColumn] = window.cachedBoard.columns.splice(cachedIndex, 1);
                window.cachedBoard.columns.splice(cachedIndex - 1, 0, cachedMovedColumn);
            }
        }

        // Move DOM element immediately
        const columnElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
        if (columnElement) {
            const parent = columnElement.parentNode;
            const prevSibling = columnElement.previousElementSibling;
            if (prevSibling && parent) {
                parent.insertBefore(columnElement, prevSibling);

                // Only recalculate if columns are stacked (have multiple columns in stack)
                const stack = columnElement.closest('.kanban-column-stack');
                if (stack) {
                    const columnsInStack = stack.querySelectorAll('.kanban-full-height-column').length;
                    if (columnsInStack > 1 && typeof updateStackLayoutDebounced === 'function') {
                        updateStackLayoutDebounced(stack);
                    }
                }

                // Update drop zones after column move
                if (typeof window.updateStackBottomDropZones === 'function') {
                    window.updateStackBottomDropZones();
                }
            }
        }

        // Send to backend (no re-render needed)
        vscode.postMessage({
            type: 'moveColumnWithRowUpdate',
            columnId,
            newPosition: index - 1,
            newRow: currentRow
        });

        // Close all menus
        document.querySelectorAll('.donut-menu').forEach(menu => menu.classList.remove('active'));

        // Update button state to show unsaved changes
        markUnsavedChanges();
    }
}

function moveColumnRight(columnId) {
    if (!currentBoard?.columns) {return;}

    // Flush pending tag changes before moving
    if ((window.pendingTaskChanges && window.pendingTaskChanges.size > 0) ||
        (window.pendingColumnChanges && window.pendingColumnChanges.size > 0)) {
        flushPendingTagChanges();
    }

    const index = currentBoard.columns.findIndex(c => c.id === columnId);
    if (index < currentBoard.columns.length - 1) {
        const column = currentBoard.columns[index];
        const currentRow = getColumnRow(column.title);

        // Update cache immediately
        const [movedColumn] = currentBoard.columns.splice(index, 1);
        currentBoard.columns.splice(index + 1, 0, movedColumn);
        if (window.cachedBoard && window.cachedBoard !== currentBoard) {
            const cachedIndex = window.cachedBoard.columns.findIndex(c => c.id === columnId);
            if (cachedIndex >= 0 && cachedIndex < window.cachedBoard.columns.length - 1) {
                const [cachedMovedColumn] = window.cachedBoard.columns.splice(cachedIndex, 1);
                window.cachedBoard.columns.splice(cachedIndex + 1, 0, cachedMovedColumn);
            }
        }

        // Move DOM element immediately
        const columnElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
        if (columnElement) {
            const parent = columnElement.parentNode;
            const nextSibling = columnElement.nextElementSibling;
            if (nextSibling && parent) {
                // Insert after nextSibling (before nextSibling.nextSibling)
                parent.insertBefore(columnElement, nextSibling.nextElementSibling);

                // Only recalculate if columns are stacked (have multiple columns in stack)
                const stack = columnElement.closest('.kanban-column-stack');
                if (stack) {
                    const columnsInStack = stack.querySelectorAll('.kanban-full-height-column').length;
                    if (columnsInStack > 1 && typeof updateStackLayoutDebounced === 'function') {
                        updateStackLayoutDebounced(stack);
                    }
                }

                // Update drop zones after column move
                if (typeof window.updateStackBottomDropZones === 'function') {
                    window.updateStackBottomDropZones();
                }
            }
        }

        // Send to backend (no re-render needed)
        vscode.postMessage({
            type: 'moveColumnWithRowUpdate',
            columnId,
            newPosition: index + 1,
            newRow: currentRow
        });

        // Close all menus
        document.querySelectorAll('.donut-menu').forEach(menu => menu.classList.remove('active'));

        // Update button state to show unsaved changes
        markUnsavedChanges();
    }
}

function changeColumnSpan(columnId, delta) {
    if (!currentBoard?.columns) {return;}

    const column = currentBoard.columns.find(c => c.id === columnId);
    if (!column) {return;}

    // Extract current span value
    const spanMatch = column.title.match(/#span(\d+)\b/i);
    let currentSpan = spanMatch ? parseInt(spanMatch[1]) : 1;

    // Calculate new span value (1-4 range)
    let newSpan = currentSpan + delta;
    newSpan = Math.max(1, Math.min(4, newSpan));

    // If no change needed, return early
    if (newSpan === currentSpan) {return;}

    // Flush pending tag changes first
    if ((window.pendingTaskChanges && window.pendingTaskChanges.size > 0) ||
        (window.pendingColumnChanges && window.pendingColumnChanges.size > 0)) {
        flushPendingTagChanges();
    }

    // Update the column title
    let newTitle = column.title;

    if (newSpan === 1) {
        // Remove span tag entirely
        newTitle = newTitle.replace(/#span\d+\b\s*/gi, '').replace(/\s+/g, ' ').trim();
    } else {
        if (spanMatch) {
            // Replace existing span tag
            newTitle = newTitle.replace(/#span\d+\b/gi, `#span${newSpan}`);
        } else {
            // Add new span tag
            newTitle += ` #span${newSpan}`;
        }
    }

    // Update the column in currentBoard and cachedBoard
    column.title = newTitle;

    if (typeof cachedBoard !== 'undefined' && cachedBoard?.columns) {
        const cachedColumn = cachedBoard.columns.find(c => c.id === columnId);
        if (cachedColumn) {
            cachedColumn.title = newTitle;
        }
    }

    // Update the column element immediately
    const columnElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    if (columnElement) {
        // Update CSS classes (only blocked by viewport-based widths, not pixel widths)
        columnElement.classList.remove('column-span-2', 'column-span-3', 'column-span-4');
        const hasViewportWidth = window.currentColumnWidth && (window.currentColumnWidth === '33percent' || window.currentColumnWidth === '50percent' || window.currentColumnWidth === '100percent');
        if (newSpan >= 2 && !hasViewportWidth) {
            columnElement.classList.add(`column-span-${newSpan}`);
        }

        // Update the title display using shared function (fixed selector)
        const titleElement = columnElement.querySelector('.column-title-text');
        if (titleElement && window.cachedBoard) {
            const columnData = window.cachedBoard.columns.find(c => c.id === columnId);
            if (columnData) {
                const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(columnData, window.filterTagsFromText) : (columnData.title || '');
                titleElement.innerHTML = renderedTitle;
            }
        }

        // Update the span value display in the menu
        const spanValueElement = document.querySelector(`[data-column-id="${columnId}"].span-width-value`);
        if (spanValueElement) {
            spanValueElement.textContent = newSpan.toString();
        }
    }

    // Mark as unsaved
    if (typeof markUnsavedChanges === 'function') {
        markUnsavedChanges();
    }

    // Update button state to show unsaved changes
    updateRefreshButtonState('unsaved', 1);
}

/**
 * Global sticky toggle with two modes:
 * - Normal click: Temporarily override all columns (no save)
 * - Alt+click: Toggle all columns and save #sticky tags
 */
function toggleGlobalSticky(event) {
    if (!currentBoard?.columns) { return; }

    const isAltClick = event.altKey;
    const allColumns = document.querySelectorAll('.kanban-full-height-column');

    if (isAltClick) {
        // Alt+click: Toggle #sticky tag on all columns and save (clears global override)
        const hasAnyStickyColumn = Array.from(allColumns).some(col =>
            col.getAttribute('data-column-sticky') === 'true'
        );

        // Toggle opposite: if any are sticky, make all non-sticky; otherwise make all sticky
        const targetState = !hasAnyStickyColumn;

        currentBoard.columns.forEach(column => {
            const hasStickyTag = /#sticky\b/i.test(column.title);

            if (targetState && !hasStickyTag) {
                // Add #sticky tag
                column.title += ' #sticky';
            } else if (!targetState && hasStickyTag) {
                // Remove #sticky tag
                column.title = column.title.replace(/#sticky\b/gi, '').trim();
            }

            // Update cachedBoard
            if (typeof cachedBoard !== 'undefined' && cachedBoard?.columns) {
                const cachedColumn = cachedBoard.columns.find(c => c.id === column.id);
                if (cachedColumn) {
                    cachedColumn.title = column.title;
                }
            }
        });

        // Clear global override since we're saving permanent state
        window.globalStickyOverride = null;

        // Mark as unsaved and re-render
        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }
        updateRefreshButtonState('unsaved', currentBoard.columns.length);

        // Trigger full board re-render to update all UI elements
        if (typeof window.renderBoard === 'function') {
            window.renderBoard(currentBoard);
        }

        // CRITICAL: Recalculate stack positions after board re-render
        // This ensures sticky headers update immediately with proper positioning
        if (typeof window.applyStackedColumnStyles === 'function') {
            requestAnimationFrame(() => {
                window.applyStackedColumnStyles(null); // Recalculate all stacks
            });
        }

    } else {
        // Normal click: Toggle between override active and override disabled
        // If override is active, clicking disables it and restores actual #sticky tag states
        // If override is not active, clicking enables it and forces all columns to same state

        if (typeof window.globalStickyOverride !== 'undefined' && window.globalStickyOverride !== null) {
            // Override is active - disable it and restore actual states
            window.globalStickyOverride = null;

            allColumns.forEach(columnElement => {
                // Restore to actual #sticky tag state
                const columnId = columnElement.getAttribute('data-column-id');
                const column = currentBoard.columns.find(c => c.id === columnId);
                const hasStickyTag = column && /#sticky\b/i.test(column.title);

                columnElement.setAttribute('data-column-sticky', hasStickyTag ? 'true' : 'false');

                // Update pin button
                const pinBtn = columnElement.querySelector('.pin-btn');
                if (pinBtn) {
                    pinBtn.classList.toggle('pinned', hasStickyTag);
                    pinBtn.classList.toggle('unpinned', !hasStickyTag);
                    pinBtn.classList.remove('global-override');
                }
            });

        } else {
            // Override is not active - enable it (make all columns sticky)
            window.globalStickyOverride = true;

            allColumns.forEach(columnElement => {
                // When global override is ON, all columns become sticky
                columnElement.setAttribute('data-column-sticky', 'true');

                // Keep pin button showing actual #sticky tag state, add outline when global override active
                const pinBtn = columnElement.querySelector('.pin-btn');
                if (pinBtn) {
                    // Check actual #sticky tag in the model
                    const columnId = columnElement.getAttribute('data-column-id');
                    const column = currentBoard.columns.find(c => c.id === columnId);
                    const hasStickyTag = column && /#sticky\b/i.test(column.title);

                    // Pin button shows actual saved state
                    pinBtn.classList.toggle('pinned', hasStickyTag);
                    pinBtn.classList.toggle('unpinned', !hasStickyTag);

                    // Add outline to all buttons when global override is active
                    pinBtn.classList.add('global-override');
                }
            });
        }

        // Recalculate stack positions for all columns
        if (typeof window.applyStackedColumnStyles === 'function') {
            window.applyStackedColumnStyles(null);
        }
    }

    // Update global button appearance
    updateGlobalStickyButton();
}

/**
 * Update the global sticky button appearance based on current state
 */
function updateGlobalStickyButton() {
    const btn = document.getElementById('global-sticky-btn');
    if (!btn) { return; }

    // Button state only reflects global override, not individual column states
    const isOverrideActive = window.globalStickyOverride === true;
    btn.classList.toggle('active', isOverrideActive);
}

/**
 * Toggle #sticky tag on a column to control sticky header state
 */
function toggleColumnSticky(columnId) {
    if (!currentBoard?.columns) { return; }

    const columnIndex = currentBoard.columns.findIndex(c => c.id === columnId);
    const column = currentBoard.columns[columnIndex];
    if (!column || columnIndex === -1) { return; }

    // Flush pending tag changes first
    if ((window.pendingTaskChanges && window.pendingTaskChanges.size > 0) ||
        (window.pendingColumnChanges && window.pendingColumnChanges.size > 0)) {
        flushPendingTagChanges();
    }

    let newTitle = column.title;

    // Check if #sticky tag exists
    const hasStickyTag = /#sticky\b/i.test(newTitle);

    if (hasStickyTag) {
        // Remove #sticky tag
        newTitle = newTitle.replace(/#sticky\b/gi, '').trim();
    } else {
        // Add #sticky tag at the end
        newTitle += ' #sticky';
    }

    // Update the column in currentBoard and cachedBoard
    column.title = newTitle;

    if (typeof cachedBoard !== 'undefined' && cachedBoard?.columns) {
        const cachedColumn = cachedBoard.columns.find(c => c.id === columnId);
        if (cachedColumn) {
            cachedColumn.title = newTitle;
        }
    }

    // Update the column element immediately (no full re-render needed)
    const columnElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    if (columnElement) {
        // Update sticky data attribute
        const newHasStickyTag = /#sticky\b/i.test(newTitle);
        columnElement.setAttribute('data-column-sticky', newHasStickyTag ? 'true' : 'false');

        // Update pin button state
        const pinBtn = columnElement.querySelector('.pin-btn');
        if (pinBtn) {
            pinBtn.classList.toggle('pinned', newHasStickyTag);
            pinBtn.classList.toggle('unpinned', !newHasStickyTag);
            pinBtn.title = newHasStickyTag ? 'Unpin header (remove #sticky)' : 'Pin header (add #sticky)';

            // ONLY OUTLINE CHANGE: show outline if global override is active
            if (typeof window.globalStickyOverride !== 'undefined' && window.globalStickyOverride !== null) {
                pinBtn.classList.add('global-override');
            } else {
                pinBtn.classList.remove('global-override');
            }
        }

        // Update the title display to filter #sticky tag
        const titleElement = columnElement.querySelector('.column-title-text');
        if (titleElement && window.cachedBoard) {
            const columnData = window.cachedBoard.columns.find(c => c.id === columnId);
            if (columnData) {
                const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(columnData, window.filterTagsFromText) : (columnData.title || '');
                titleElement.innerHTML = renderedTitle;
            }
        }
    }

    // Recalculate ONLY this column's stack (row), not the whole board
    if (typeof window.applyStackedColumnStyles === 'function') {
        window.applyStackedColumnStyles(columnId);
    }

    // Mark as unsaved
    if (typeof markUnsavedChanges === 'function') {
        markUnsavedChanges();
    }

    // Update button state to show unsaved changes
    updateRefreshButtonState('unsaved', 1);

    // Update global sticky button appearance
    if (typeof updateGlobalStickyButton === 'function') {
        updateGlobalStickyButton();
    }
}

function toggleColumnStack(columnId) {
    if (!currentBoard?.columns) {return;}

    const columnIndex = currentBoard.columns.findIndex(c => c.id === columnId);
    const column = currentBoard.columns[columnIndex];
    if (!column || columnIndex === -1) {return;}

    // Flush pending tag changes first
    if ((window.pendingTaskChanges && window.pendingTaskChanges.size > 0) ||
        (window.pendingColumnChanges && window.pendingColumnChanges.size > 0)) {
        flushPendingTagChanges();
    }

    // Check current stack state
    const hasStack = /#stack\b/i.test(column.title);
    let newTitle = column.title;
    let needsRepositioning = false;
    let newPosition = columnIndex;

    if (hasStack) {
        // REMOVING stack tag - column separates from its current stack
        // Any following columns with #stack will naturally stay with this column (forming a new stack)
        // The rendering logic handles this automatically - no repositioning needed
        newTitle = newTitle.replace(/#stack\b\s*/gi, '').replace(/\s+/g, ' ').trim();
        needsRepositioning = false;

    } else {
        // ADDING stack tag - move column to stack with previous column
        newTitle += ' #stack';

        // Find the previous column in the same row
        let prevColumnIndex = -1;
        for (let i = columnIndex - 1; i >= 0; i--) {
            if (getColumnRow(currentBoard.columns[i].title) === getColumnRow(column.title)) {
                prevColumnIndex = i;
                break;
            }
        }

        // If there's a previous column in the same row, move this column right after it
        if (prevColumnIndex !== -1) {
            // Find the last column in the previous column's stack
            let targetPosition = prevColumnIndex;
            for (let i = prevColumnIndex + 1; i < columnIndex; i++) {
                const nextCol = currentBoard.columns[i];
                if (getColumnRow(nextCol.title) !== getColumnRow(column.title) ||
                    !/#stack\b/i.test(nextCol.title)) {
                    break;
                }
                targetPosition = i;
            }

            // Move to right after the target position (last in that stack)
            newPosition = targetPosition + 1;
            if (newPosition !== columnIndex) {
                needsRepositioning = true;
            }
        }
    }

    // Update the column title
    column.title = newTitle;

    // Reposition if needed
    if (needsRepositioning && newPosition !== columnIndex) {
        // Remove from current position
        const [movedColumn] = currentBoard.columns.splice(columnIndex, 1);
        // Insert at new position (adjust if we removed from before the target)
        const adjustedPosition = newPosition > columnIndex ? newPosition - 1 : newPosition;
        currentBoard.columns.splice(adjustedPosition, 0, movedColumn);
    }

    // Sync with cachedBoard
    if (typeof cachedBoard !== 'undefined' && cachedBoard?.columns) {
        cachedBoard.columns = [...currentBoard.columns];
    }

    // Update the column element immediately
    const columnElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    if (columnElement) {
        // Update the title display using shared function (fixed selector)
        const titleElement = columnElement.querySelector('.column-title-text');
        if (titleElement && window.cachedBoard) {
            const columnData = window.cachedBoard.columns.find(c => c.id === columnId);
            if (columnData) {
                const renderedTitle = window.tagUtils ? window.tagUtils.getColumnDisplayTitle(columnData, window.filterTagsFromText) : (columnData.title || '');
                titleElement.innerHTML = renderedTitle;
            }
        }

        // Update the stack toggle button
        const stackToggleBtn = document.querySelector(`button.stack-toggle-btn[onclick*="${columnId}"]`);
        if (stackToggleBtn) {
            const newHasStack = /#stack\b/i.test(newTitle);
            stackToggleBtn.textContent = newHasStack ? 'On' : 'Off';
            if (newHasStack) {
                stackToggleBtn.classList.add('active');
            } else {
                stackToggleBtn.classList.remove('active');
            }
        }
    }

    // Close all menus before full board re-render
    // CRITICAL: renderBoard() destroys and recreates all DOM elements
    // This breaks hover detection, so we must close menus first
    if (typeof closeAllMenus === 'function') {
        closeAllMenus();
    }

    // Trigger full board re-render for layout changes
    // This recalculates all column positions including stacks
    if (typeof window.renderBoard === 'function' && window.cachedBoard) {
        window.renderBoard(); // Full re-render to recalculate positions
    }

    // CRITICAL: Recalculate stack positions after board re-render
    // This ensures columns stack/unstack immediately with proper positioning
    // Recalculate all stacks since adding/removing #stack affects neighboring columns
    if (typeof window.applyStackedColumnStyles === 'function') {
        requestAnimationFrame(() => {
            window.applyStackedColumnStyles(); // Recalculate all stacks, not just one
        });
    }

    // Mark as unsaved
    if (typeof markUnsavedChanges === 'function') {
        markUnsavedChanges();
    }

    // Update button state to show unsaved changes
    updateRefreshButtonState('unsaved', 1);
}

function deleteColumn(columnId) {
    // Close all menus properly
    closeAllMenus();

    // NEW CACHE SYSTEM: Remove column from cached board first
    if (window.cachedBoard) {
        const columnIndex = window.cachedBoard.columns.findIndex(col => col.id === columnId);
        if (columnIndex >= 0) {
            const deletedColumn = window.cachedBoard.columns.splice(columnIndex, 1)[0];

            // Also update currentBoard for compatibility
            if (window.cachedBoard !== window.cachedBoard) {
                const currentColumnIndex = window.cachedBoard.columns.findIndex(col => col.id === columnId);
                if (currentColumnIndex >= 0) {
                    window.cachedBoard.columns.splice(currentColumnIndex, 1);
                }
            }

            // Remove column from DOM immediately - use specific selector to avoid removing tasks
            const columnElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
            if (columnElement) {
                // Get the stack before removing the column
                const stack = columnElement.closest('.kanban-column-stack');

                columnElement.remove();

                // Normalize stack tags - ensures first column in stack has no #stack tag
                // This handles the case where deleting the top column makes the second column the new top
                if (typeof window.normalizeAllStackTags === 'function') {
                    window.normalizeAllStackTags();
                }

                // Recalculate stack heights after column deletion
                if (stack && typeof updateStackLayoutDebounced === 'function') {
                    updateStackLayoutDebounced(stack);
                }

                // Update drop zones after column deletion
                if (typeof window.updateStackBottomDropZones === 'function') {
                    window.updateStackBottomDropZones();
                }
            }

            // NOTE: We intentionally do NOT call markUnsavedChanges() here.
            // The deleteColumn message goes through the action system, which properly
            // handles undo state capture BEFORE applying changes via ColumnActions.remove.
            // Calling markUnsavedChanges() would sync the already-modified board to backend
            // BEFORE deleteColumn is processed, causing undo to capture the wrong "before" state.
            // See: ColumnCommands.ts handleDeleteColumn() for backend handling.

            // Send message to VS Code - action system handles undo capture and board sync
            vscode.postMessage({ type: 'deleteColumn', columnId });

        }
    }
}

function sortColumn(columnId, sortType) {
    closeAllMenus();
    vscode.postMessage({ type: 'sortColumn', columnId, sortType });
}

// Copy operations - using unified export system
async function copyColumnAsMarkdown(columnId) {
    closeAllMenus();

    // Use window.cachedBoard directly to ensure we have the latest board state
    const board = window.cachedBoard;
    if (!board?.columns) {return;}
    const columnIndex = board.columns.findIndex(c => c.id === columnId);
    if (columnIndex === -1) {return;}

    // Use NEW unified export system with presentation format
    // mergeIncludes: true is required to use board-based path which respects scope/selection
    // Send BOTH columnId and columnIndex - backend prefers columnId for reliable lookup
    vscode.postMessage({
        type: 'export',
        options: {
            mode: 'copy',
            scope: 'column',
            format: 'presentation',
            tagVisibility: 'allexcludinglayout',
            packAssets: false,
            mergeIncludes: true,
            selection: {
                columnId: columnId,
                columnIndex: columnIndex
            }
        }
    });
}

async function copyTaskAsMarkdown(taskId, columnId) {
    closeAllMenus();

    // Use window.cachedBoard directly to ensure we have the latest board state
    const board = window.cachedBoard;
    if (!board?.columns) {return;}
    const columnIndex = board.columns.findIndex(c => c.id === columnId);
    if (columnIndex === -1) {return;}

    // Use NEW unified export system with presentation format
    // mergeIncludes: true is required to use board-based path which respects scope/selection
    // Send BOTH columnId and columnIndex - backend prefers columnId for reliable lookup
    vscode.postMessage({
        type: 'export',
        options: {
            mode: 'copy',
            scope: 'task',
            format: 'presentation',
            tagVisibility: 'allexcludinglayout',
            packAssets: false,
            mergeIncludes: true,
            selection: {
                columnId: columnId,
                columnIndex: columnIndex,
                taskId: taskId
            }
        }
    });
}

function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            vscode.postMessage({ type: 'showMessage', text: 'Copied to clipboard!' });
        }).catch(err => console.error('Failed to copy:', err));
    }
}

// ============================================================================
// TASK AND COLUMN OPERATIONS
// ============================================================================

function duplicateTask(taskId, columnId) {
    // Close all menus properly
    closeAllMenus();

    // Cache-first: Only update cached board, no automatic save
    if (window.cachedBoard) {
        const found = findTaskInBoard(taskId, columnId);
        if (found) {
            const { task: originalTask, column: targetColumn } = found;
            const duplicatedTask = {
                id: `temp-duplicate-${Date.now()}`,
                title: originalTask.title,
                description: originalTask.description
            };

            // Insert after the original task
            const originalIndex = targetColumn.tasks.findIndex(task => task.id === taskId);
            updateCacheForNewTask(targetColumn.id, duplicatedTask, originalIndex + 1);
        }
    }

    // No VS Code message - cache-first system requires explicit save via Cmd+S
}

function insertTaskBefore(taskId, columnId) {
    // Close all menus properly
    closeAllMenus();

    // Cache-first: Only update cached board, no automatic save
    if (window.cachedBoard) {
        const found = findTaskInBoard(taskId, columnId);
        if (found) {
            const { column: targetColumn } = found;
            const targetIndex = targetColumn.tasks.findIndex(task => task.id === taskId);

            if (targetIndex >= 0) {
                const newTask = {
                    id: `temp-insert-before-${Date.now()}`,
                    title: '',
                    description: ''
                };

                updateCacheForNewTask(targetColumn.id, newTask, targetIndex);
            }
        }
    }

    // No VS Code message - cache-first system requires explicit save via Cmd+S
}

function insertTaskAfter(taskId, columnId) {
    // Close all menus properly
    closeAllMenus();

    // Cache-first: Only update cached board, no automatic save
    if (window.cachedBoard) {
        const found = findTaskInBoard(taskId, columnId);
        if (found) {
            const { column: targetColumn } = found;
            const targetIndex = targetColumn.tasks.findIndex(task => task.id === taskId);
            if (targetIndex >= 0) {
                const newTask = {
                    id: `temp-insert-after-${Date.now()}`,
                    title: '',
                    description: ''
                };

                updateCacheForNewTask(targetColumn.id, newTask, targetIndex + 1);
            }
        }
    }

    // No VS Code message - cache-first system requires explicit save via Cmd+S
}

/**
 * Move a task within its column in a specified direction
 * @param {string} taskId - Task to move
 * @param {string} columnId - Column containing the task
 * @param {'top'|'up'|'down'|'bottom'} direction - Direction to move
 */
function moveTaskInDirection(taskId, columnId, direction) {
    closeAllMenus();

    if (!window.cachedBoard) return;

    const found = findTaskInBoard(taskId, columnId);
    if (!found) return;

    const { column } = found;
    const taskIndex = column.tasks.findIndex(t => t.id === taskId);
    if (taskIndex < 0) return;

    let newIndex;
    const lastIndex = column.tasks.length - 1;

    switch (direction) {
        case 'top':
            if (taskIndex === 0) return; // Already at top
            column.tasks.splice(taskIndex, 1);
            column.tasks.unshift(found.task);
            newIndex = 0;
            break;

        case 'up':
            if (taskIndex === 0) return; // Can't go up
            // Swap with previous
            [column.tasks[taskIndex], column.tasks[taskIndex - 1]] =
                [column.tasks[taskIndex - 1], column.tasks[taskIndex]];
            newIndex = taskIndex - 1;
            break;

        case 'down':
            if (taskIndex === lastIndex) return; // Can't go down
            // Swap with next
            [column.tasks[taskIndex], column.tasks[taskIndex + 1]] =
                [column.tasks[taskIndex + 1], column.tasks[taskIndex]];
            newIndex = taskIndex + 1;
            break;

        case 'bottom':
            if (taskIndex === lastIndex) return; // Already at bottom
            column.tasks.splice(taskIndex, 1);
            column.tasks.push(found.task);
            newIndex = column.tasks.length - 1;
            break;

        default:
            return;
    }

    moveTaskInDOM(taskId, column.id, newIndex);
    markUnsavedChanges();
}

// Shorthand functions for menu onclick handlers
function moveTaskToTop(taskId, columnId) { moveTaskInDirection(taskId, columnId, 'top'); }
function moveTaskUp(taskId, columnId) { moveTaskInDirection(taskId, columnId, 'up'); }
function moveTaskDown(taskId, columnId) { moveTaskInDirection(taskId, columnId, 'down'); }
function moveTaskToBottom(taskId, columnId) { moveTaskInDirection(taskId, columnId, 'bottom'); }

/**
 * Moves a task to a different column
 * Purpose: Drag and drop or menu-based task relocation
 * Used by: Move submenu selections
 * @param {string} taskId - Task to move
 * @param {string} fromColumnId - Source column
 * @param {string} toColumnId - Destination column
 * Side effects: Unfolds target column
 */
function moveTaskToColumn(taskId, fromColumnId, toColumnId) {
    // Unfold the destination column if it's collapsed BEFORE any DOM changes
    unfoldColumnIfCollapsed(toColumnId);

    if (!window.cachedBoard) {
        closeAllMenus();
        return;
    }

    const fromColumn = window.cachedBoard.columns.find(col => col.id === fromColumnId);
    const toColumn = window.cachedBoard.columns.find(col => col.id === toColumnId);

    if (!fromColumn || !toColumn) {
        closeAllMenus();
        return;
    }

    const taskIndex = fromColumn.tasks.findIndex(t => t.id === taskId);
    if (taskIndex < 0) {
        closeAllMenus();
        return;
    }

    // Update cache - move task to end of target column
    const task = fromColumn.tasks.splice(taskIndex, 1)[0];
    toColumn.tasks.push(task);

    // Update DOM directly - move to end of target column
    moveTaskInDOM(taskId, fromColumnId, toColumn.tasks.length - 1, toColumnId);

    markUnsavedChanges();
    closeAllMenus();
}

function deleteTask(taskId, columnId) {
    // Close all menus properly
    closeAllMenus();

    // NEW CACHE SYSTEM: Remove task from cached board instead of sending to VS Code immediately
    if (window.cachedBoard) {
        // Find the task in any column (task might have been moved since the menu was generated)
        let foundColumn = null;
        let taskIndex = -1;

        for (const column of window.cachedBoard.columns) {
            taskIndex = column.tasks.findIndex(t => t.id === taskId);
            if (taskIndex >= 0) {
                foundColumn = column;
                break;
            }
        }

        if (foundColumn && taskIndex >= 0) {
            const deletedTask = foundColumn.tasks.splice(taskIndex, 1)[0];

            // Remove task from DOM immediately
            const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
            if (taskElement) {
                // Get the column element before removing the task
                const columnElement = taskElement.closest('.kanban-full-height-column');

                taskElement.remove();

                // Check if column is now empty and add placeholder button (before height recalc)
                updateColumnEmptyState(foundColumn.id);

                // Recalculate stack heights after task deletion and button restoration
                if (columnElement) {
                    const stack = columnElement.closest('.kanban-column-stack');
                    if (stack && typeof updateStackLayoutDebounced === 'function') {
                        updateStackLayoutDebounced(stack);
                    }
                }
            }

            // Send message to VS Code - action system handles undo capture and board sync
            vscode.postMessage({ type: 'deleteTask', taskId, columnId: foundColumn.id });
        }
    }
}

// Helper function to update column empty state (add/remove placeholder button)
function updateColumnEmptyState(columnId) {
    const tasksContainer = document.querySelector(`#tasks-${columnId}`);
    if (!tasksContainer) { return; }

    // Count actual task elements (not placeholder buttons)
    const taskElements = tasksContainer.querySelectorAll('.task-item');
    const hasAddButton = tasksContainer.querySelector('.add-task-btn');

    // Add button if column is empty (CSS handles hiding when tasks present)
    if (taskElements.length === 0 && !hasAddButton) {
        const addButton = document.createElement('button');
        addButton.className = 'add-task-btn';
        addButton.setAttribute('onclick', `addTask('${columnId}')`);
        addButton.innerHTML = '\n                        + Add Task\n                    ';
        tasksContainer.appendChild(addButton);
    }
}

// Make updateColumnEmptyState globally available
window.updateColumnEmptyState = updateColumnEmptyState;

// Helper function to update cache when creating tasks
function updateCacheForNewTask(columnId, newTask, insertIndex = -1) {
    if (window.cachedBoard) {
        const targetColumn = window.cachedBoard.columns.find(col => col.id === columnId);
        if (targetColumn) {
            if (insertIndex >= 0 && insertIndex <= targetColumn.tasks.length) {
                targetColumn.tasks.splice(insertIndex, 0, newTask);
            } else {
                targetColumn.tasks.push(newTask);
            }

            // Mark as unsaved since we added a task
            markUnsavedChanges();

            // Use incremental DOM update instead of full redraw
            if (typeof window.addSingleTaskToDOM === 'function') {
                const taskElement = window.addSingleTaskToDOM(columnId, newTask, insertIndex);

                // Focus the newly created task and start editing
                if (taskElement) {
                    setTimeout(() => {
                        scrollToElementIfNeeded(taskElement, 'task');

                        // Start editing the title
                        const titleContainer = taskElement.querySelector('.task-title-container');
                        if (titleContainer && window.editTitle) {
                            window.editTitle(titleContainer, newTask.id, columnId);
                        }
                    }, 50);
                }
            } else {
                // Fallback to full render if incremental function not available
                if (typeof renderBoard === 'function') {
                    renderBoard();
                }
            }
        }
    }
}

// Helper function to update cache when creating columns
function updateCacheForNewColumn(newColumn, insertIndex = -1, referenceColumnId = null) {
    if (window.cachedBoard) {
        let actualInsertIndex = insertIndex;

        if (referenceColumnId) {
            // Insert relative to reference column
            const referenceIndex = window.cachedBoard.columns.findIndex(col => col.id === referenceColumnId);
            if (referenceIndex >= 0) {
                actualInsertIndex = insertIndex >= 0 ? insertIndex : referenceIndex + 1;
                window.cachedBoard.columns.splice(actualInsertIndex, 0, newColumn);
            } else {
                // Fallback: add to end
                window.cachedBoard.columns.push(newColumn);
                actualInsertIndex = window.cachedBoard.columns.length - 1;
            }
        } else {
            // Simple insertion
            if (insertIndex >= 0 && insertIndex <= window.cachedBoard.columns.length) {
                window.cachedBoard.columns.splice(insertIndex, 0, newColumn);
            } else {
                window.cachedBoard.columns.push(newColumn);
                actualInsertIndex = window.cachedBoard.columns.length - 1;
            }
        }

        // CRITICAL: Sort columns by row to match backend ordering
        if (typeof window.sortColumnsByRow === 'function') {
            window.cachedBoard.columns = window.sortColumnsByRow(window.cachedBoard.columns);
            // Recalculate actual insert index after sorting
            actualInsertIndex = window.cachedBoard.columns.findIndex(col => col.id === newColumn.id);
        }

        // Mark as unsaved
        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }

        // Use incremental DOM update instead of full redraw
        if (typeof window.addSingleColumnToDOM === 'function') {
            const columnElement = window.addSingleColumnToDOM(newColumn, actualInsertIndex, referenceColumnId);

            // Focus the newly created column and start editing its title
            if (columnElement) {
                setTimeout(() => {
                    scrollToElementIfNeeded(columnElement, 'column');

                    // Start editing the column title
                    if (window.editColumnTitle) {
                        window.editColumnTitle(newColumn.id, columnElement);
                    }
                }, 50);
            }
        } else {
            // Fallback to full render if incremental function not available
            if (typeof renderBoard === 'function') {
                renderBoard();
            }
        }
    }
}

function addTask(columnId) {
    // Close all menus properly
    closeAllMenus();

    // Cache-first: Only update cached board, no automatic save
    const newTask = {
        id: `temp-menu-${Date.now()}`,
        title: '',
        description: ''
    };

    updateCacheForNewTask(columnId, newTask);

    // No VS Code message - cache-first system requires explicit save via Cmd+S
}

// Helper function to unfold a column if it's collapsed
function unfoldColumnIfCollapsed(columnId, skipUnfold = false) {
    if (skipUnfold) {
        return false; // Skip unfolding
    }
    const column = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    if (window.isColumnCollapsed && window.isColumnCollapsed(column)) {
        toggleColumnCollapse(columnId);
        return true; // Column was unfolded
    }
    return false; // Column was already unfolded
}

function addTaskAndUnfold(columnId) {
    unfoldColumnIfCollapsed(columnId);
    addTask(columnId);
}

function addColumn(rowNumber) {
    // Cache-first: Create new column and add to end of the specified row
    const title = (rowNumber && rowNumber > 1) ? `#row${rowNumber}` : '';
    const newColumn = {
        id: `temp-column-${Date.now()}`,
        title: title,
        tasks: []
    };

    // Find the last column in this row to determine insert position
    let insertIndex = -1;
    if (window.cachedBoard?.columns) {
        // Find the index after the last column in this row
        for (let i = window.cachedBoard.columns.length - 1; i >= 0; i--) {
            const col = window.cachedBoard.columns[i];
            const colRow = getColumnRow(col.title);
            if (colRow === rowNumber) {
                // Found the last column in this row, insert after it
                insertIndex = i + 1;
                break;
            }
        }

        // If no columns found in this row, find where this row should start
        if (insertIndex === -1) {
            // Find the first column that belongs to a higher row number
            for (let i = 0; i < window.cachedBoard.columns.length; i++) {
                const col = window.cachedBoard.columns[i];
                const colRow = getColumnRow(col.title);
                if (colRow > rowNumber) {
                    insertIndex = i;
                    break;
                }
            }
        }
    }

    updateCacheForNewColumn(newColumn, insertIndex);

    // No VS Code message - cache-first system requires explicit save via Cmd+S
}

// Window exports for task/column operations
window.duplicateTask = duplicateTask;
window.insertTaskBefore = insertTaskBefore;
window.insertTaskAfter = insertTaskAfter;
window.addTask = addTask;
window.addTaskAndUnfold = addTaskAndUnfold;
window.addColumn = addColumn;

// Include mode operations moved to utils/includeModeManager.js:
// - toggleColumnIncludeMode, enableColumnIncludeMode, editColumnIncludeFile
// - updateColumnIncludeFile, disableColumnIncludeMode
// - enableTaskIncludeMode, editTaskIncludeFile, updateTaskIncludeFile
// - disableTaskIncludeMode, toggleTaskIncludeMode

// ============================================================================
// TAG TOGGLE OPERATIONS
// ============================================================================

/**
 * Toggles a tag on/off for a column
 * Purpose: Add or remove tags from column titles
 * Used by: Tag menu clicks for columns
 * @param {string} columnId - Column to modify
 * @param {string} tagName - Tag to toggle
 * @param {Event} event - Click event
 * Side effects: Updates pending changes, triggers visual updates
 */
function toggleColumnTag(columnId, tagName, event) {
    // Throttle duplicate calls
    if (!window.menuUtils.shouldExecute(`column-${columnId}-${tagName}`)) {
        return;
    }

    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    // Find column in board data
    const found = window.menuUtils.findColumnInBoard(columnId);
    if (!found) return;
    const { column } = found;

    // Check DOM element exists
    const domElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    if (!domElement) return;

    // Toggle tag in title (preserving row tags for columns)
    const oldTitle = column.title || '';
    const { newTitle, wasActive } = window.menuUtils.toggleTagInTitle(oldTitle, tagName, true);

    // Sync to all board references
    window.menuUtils.syncTitleToBoards('column', columnId, null, newTitle);

    // Add to pending changes
    if (!window.pendingColumnChanges) {
        window.pendingColumnChanges = new Map();
    }
    window.pendingColumnChanges.set(columnId, { columnId, title: newTitle });

    // Mark as unsaved
    markUnsavedChanges();

    // Check visibility before layout changes
    const rect = domElement.getBoundingClientRect();
    const isVisible = rect.left >= 0 && rect.right <= window.innerWidth;

    // Update DOM immediately
    updateColumnDisplayImmediate(columnId, newTitle, !wasActive, tagName);
    updateTagButtonAppearance(columnId, 'column', tagName, !wasActive);
    updateTagCategoryCounts(columnId, 'column');

    // Recalculate stack heights if visual tags changed (only this stack)
    const visualTagsBefore = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(oldTitle) : [];
    const visualTagsAfter = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(newTitle) : [];
    if (visualTagsBefore.length !== visualTagsAfter.length) {
        if (typeof window.applyStackedColumnStyles === 'function') {
            window.applyStackedColumnStyles(columnId);
        }
    }

    // Scroll to element if needed
    if (!isVisible) {
        requestAnimationFrame(() => {
            scrollToElementIfNeeded(domElement, 'column');
        });
    }
}

/**
 * Toggles a tag on/off for a task
 * Purpose: Add or remove tags from task titles
 * Used by: Tag menu clicks for tasks
 * @param {string} taskId - Task to modify
 * @param {string} columnId - Parent column ID
 * @param {string} tagName - Tag to toggle
 * @param {Event} event - Click event
 * Side effects: Updates pending changes, triggers visual updates
 */
function toggleTaskTag(taskId, columnId, tagName, event) {
    // Throttle duplicate calls
    if (!window.menuUtils.shouldExecute(`task-${taskId}-${tagName}`)) {
        return;
    }

    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    // Find task in board data
    const found = window.menuUtils.findTaskInBoard(taskId, columnId);
    if (!found) return;
    const { column, task } = found;

    // Check DOM element exists
    const domElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!domElement) return;

    // Toggle tag in title (no row tag preservation for tasks)
    const oldTitle = task.title || '';
    const { newTitle, wasActive } = window.menuUtils.toggleTagInTitle(oldTitle, tagName, false);

    // Sync to all board references
    window.menuUtils.syncTitleToBoards('task', taskId, column.id, newTitle);

    // Mark as unsaved
    markUnsavedChanges();

    // Check visibility before layout changes
    const rect = domElement.getBoundingClientRect();
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

    // Update DOM immediately
    updateTaskDisplayImmediate(taskId, newTitle, !wasActive, tagName);
    updateTagButtonAppearance(taskId, 'task', tagName, !wasActive);
    updateTagCategoryCounts(taskId, 'task', columnId);

    // Recalculate stack heights if visual tags changed (only this stack)
    const visualTagsBefore = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(oldTitle) : [];
    const visualTagsAfter = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(newTitle) : [];
    if (visualTagsBefore.length !== visualTagsAfter.length) {
        if (typeof window.applyStackedColumnStyles === 'function') {
            window.applyStackedColumnStyles(columnId);
        }
    }

    // Scroll to element if needed
    if (!isVisible) {
        requestAnimationFrame(() => {
            scrollToElementIfNeeded(domElement, 'task');
        });
    }
}

// Window exports for tag operations
window.toggleColumnTag = toggleColumnTag;
window.toggleTaskTag = toggleTaskTag;

// Enhanced DOM update functions using unique IDs
// CRITICAL: Always use data-column-id and data-task-id selectors to avoid title conflicts
/**
 * Immediately updates column visual state in DOM
 * Purpose: Real-time visual feedback before save
 * Used by: Tag toggle operations
 * @param {string} columnId - Column to update
 * @param {string} newTitle - New title with tags
 * @param {boolean} isActive - Whether tag is active
 * @param {string} tagName - Tag being modified
 */
function updateColumnDisplayImmediate(columnId, newTitle, isActive, tagName) {
    const columnElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    if (!columnElement) return;

    // Update cached board data
    if (window.cachedBoard) {
        const columnData = window.cachedBoard.columns.find(c => c.id === columnId);
        if (columnData) columnData.title = newTitle;
    }

    // Update title display
    const titleElement = columnElement.querySelector('.column-title-text');
    if (titleElement && window.cachedBoard) {
        const columnData = window.cachedBoard.columns.find(c => c.id === columnId);
        if (columnData) {
            titleElement.innerHTML = window.tagUtils
                ? window.tagUtils.getColumnDisplayTitle(columnData, window.filterTagsFromText)
                : (columnData.title || '');
        }
    }

    // Update edit field
    const editElement = columnElement.querySelector('.column-title-edit');
    if (editElement) editElement.value = newTitle;

    // Update data attributes (tag, all-tags) using shared utility
    const allTags = window.menuUtils.updateTagDataAttributes(columnElement, newTitle, 'column');

    // Update temporal attributes using shared utility
    window.menuUtils.updateTemporalAttributes(columnElement, newTitle, 'column');

    // Update border/background tag attributes and stackable bars
    if (window.injectStackableBars) {
        window.injectStackableBars(columnElement);
    }

    // Update visual tag state
    if (window.updateVisualTagState) {
        const isCollapsed = columnElement.classList.contains('collapsed');
        window.updateVisualTagState(columnElement, allTags, 'column', isCollapsed);
    }

    // Update tag chip button using shared utility
    window.menuUtils.updateTagChipButton(columnId, tagName, isActive);

    // Ensure tag style exists
    if (window.ensureTagStyleExists) window.ensureTagStyleExists(tagName);

    // Apply visual flash using shared utility
    window.menuUtils.applyTagFlash(columnElement, isActive);
}

// CRITICAL: Always use unique task IDs to prevent targeting wrong tasks with same titles
function updateTaskDisplayImmediate(taskId, newTitle, isActive, tagName) {
    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!taskElement) return;

    // Update title display
    const titleElement = taskElement.querySelector('.task-title-display');
    if (titleElement) {
        titleElement.innerHTML = newTitle
            ? (window.renderMarkdown ? window.renderMarkdown(newTitle) : newTitle)
            : '';
    }

    // Update edit field
    const editElement = taskElement.querySelector('.task-title-edit');
    if (editElement) editElement.value = newTitle;

    // Update data attributes (tag, all-tags) using shared utility
    const allTags = window.menuUtils.updateTagDataAttributes(taskElement, newTitle, 'task');

    // Update temporal attributes with hierarchical gating using shared utility
    const found = window.menuUtils.findTaskInBoard(taskId);
    const context = found ? {
        columnTitle: found.column.title || '',
        taskDescription: found.task.description || ''
    } : {};
    window.menuUtils.updateTemporalAttributes(taskElement, newTitle, 'task', context);

    // Update border/background tag attributes and stackable bars
    if (window.injectStackableBars) {
        window.injectStackableBars(taskElement);
    }

    // Update visual tag state
    if (window.updateVisualTagState) {
        const isCollapsed = taskElement.classList.contains('collapsed');
        window.updateVisualTagState(taskElement, allTags, 'task', isCollapsed);
    }

    // Update tag chip button using shared utility
    window.menuUtils.updateTagChipButton(taskId, tagName, isActive);

    // Ensure tag style exists
    if (window.ensureTagStyleExists) window.ensureTagStyleExists(tagName);

    // Apply visual flash using shared utility
    window.menuUtils.applyTagFlash(taskElement, isActive);
}

function updateTagChipStyle(button, tagName, isActive) {
    const config = window.getTagConfig ? window.getTagConfig(tagName) : null;
    const isDarkTheme = document.body.classList.contains('vscode-dark') || 
                       document.body.classList.contains('vscode-high-contrast');
    
    let bgColor = '#666';
    let textColor = '#fff';
    
    if (config) {
        const themeKey = isDarkTheme ? 'dark' : 'light';
        const themeColors = config[themeKey] || config.light || {};
        bgColor = themeColors.background || '#666';
        textColor = themeColors.text || '#fff';
    } else if (isDarkTheme) {
        bgColor = '#555';
        textColor = '#ddd';
    } else {
        bgColor = '#999';
        textColor = '#fff';
    }
    
    if (isActive) {
        button.style.backgroundColor = bgColor;
        button.style.color = textColor;
    } else {
        button.style.backgroundColor = 'transparent';
        button.style.color = 'inherit';
    }
}

/**
 * Marks the cached board as having unsaved changes
 * Purpose: Track when user makes changes that need saving
 * Used by: All operations that modify the board
 * Side effects: Updates unsaved flag and UI state
 */
function markUnsavedChanges() {
    window.hasUnsavedChanges = true;
    updateRefreshButtonState('unsaved', 1);

    // Always notify backend about unsaved changes state AND send the current cached board data
    if (typeof vscode !== 'undefined') {
        const boardToSend = window.cachedBoard || window.cachedBoard;

        if (boardToSend && boardToSend.columns) {
            // Log all include tasks
            let includeTaskCount = 0;
            boardToSend.columns.forEach((col, colIdx) => {
                if (col.tasks) {
                    col.tasks.forEach((task, taskIdx) => {
                        if (task.includeMode) {
                            includeTaskCount++;
                        }
                    });
                }
            });
        }

        vscode.postMessage({
            type: 'markUnsavedChanges',
            hasUnsavedChanges: true,
            cachedBoard: boardToSend // Send the current board data
        });
    }
}

/**
 * Marks changes as saved in frontend only
 * Purpose: Update UI state when backend confirms save completed
 * Used by: Backend messages after save completion
 * Side effects: Clears unsaved flag and updates UI state
 * NOTE: Frontend cannot clear backend unsaved state - only backend can do that after save completes
 */
function markSavedChanges() {
    window.hasUnsavedChanges = false;
    updateRefreshButtonState('default');
}

/**
 * Checks if there are any unsaved changes in the cached board
 * Purpose: Determine if save confirmation dialog should be shown
 * Used by: Close/exit handlers
 * Returns: true if there are unsaved changes
 */
function hasUnsavedChanges() {
    return window.hasUnsavedChanges === true;
}

/**
 * Compares two board states to find what has changed
 * Purpose: Detect specific changes to send to VS Code
 * Used by: Save operation to minimize messages sent
 * Returns: Object with arrays of changes by type
 */
function compareBoards(savedBoard, cachedBoard) {
    const changes = {
        columnTitleChanges: [],
        taskChanges: [],
        taskMoves: [],
        taskDeletions: [],
        columnOrderChanged: false
    };
    
    // Check if column order changed
    const savedOrder = savedBoard.columns.map(col => col.id).join(',');
    const cachedOrder = cachedBoard.columns.map(col => col.id).join(',');
    if (savedOrder !== cachedOrder) {
        changes.columnOrderChanged = true;
    }
    
    // Find deleted tasks
    savedBoard.columns.forEach(savedCol => {
        savedCol.tasks.forEach(savedTask => {
            let foundInCached = false;
            for (const cachedCol of cachedBoard.columns) {
                if (cachedCol.tasks.find(t => t.id === savedTask.id)) {
                    foundInCached = true;
                    break;
                }
            }
            if (!foundInCached) {
                changes.taskDeletions.push({
                    taskId: savedTask.id,
                    columnId: savedCol.id
                });
            }
        });
    });
    
    // Compare each column
    cachedBoard.columns.forEach(cachedCol => {
        const savedCol = savedBoard.columns.find(col => col.id === cachedCol.id);
        if (!savedCol) {return;} // New column (shouldn't happen in our cache system)
        
        // Check column title changes
        if (savedCol.title !== cachedCol.title) {
            changes.columnTitleChanges.push({
                columnId: cachedCol.id,
                oldTitle: savedCol.title,
                newTitle: cachedCol.title
            });
        }
        
        // Compare each task in this column
        cachedCol.tasks.forEach((cachedTask, cachedIndex) => {
            // Find task in saved board (it might be in a different column)
            let savedTask = null;
            let savedTaskColumn = null;
            let savedTaskIndex = -1;
            
            for (const savedColumn of savedBoard.columns) {
                const foundIndex = savedColumn.tasks.findIndex(t => t.id === cachedTask.id);
                if (foundIndex >= 0) {
                    savedTask = savedColumn.tasks[foundIndex];
                    savedTaskColumn = savedColumn.id;
                    savedTaskIndex = foundIndex;
                    break;
                }
            }
            
            if (!savedTask) {return;} // New task (shouldn't happen in our cache system)
            
            // Check if task moved between columns or changed position
            if (savedTaskColumn !== cachedCol.id || savedTaskIndex !== cachedIndex) {
                changes.taskMoves.push({
                    taskId: cachedTask.id,
                    fromColumn: savedTaskColumn,
                    toColumn: cachedCol.id,
                    newIndex: cachedIndex
                });
            }
            
            // Check task content changes
            if (savedTask.title !== cachedTask.title || savedTask.description !== cachedTask.description) {
                changes.taskChanges.push({
                    taskId: cachedTask.id,
                    columnId: cachedCol.id, // Current column
                    taskData: {
                        title: cachedTask.title,
                        description: cachedTask.description
                    }
                });
            }
        });
    });
    
    return changes;
}

/**
 * NEW CLEAN SAVE SYSTEM: Save complete cached board to markdown file
 * Purpose: Save all changes (tags, moves, edits) from cache to file
 * Used by: Manual save (Cmd+S) only
 * Side effects: Sends board to VS Code for file write
 * Note: Single source of truth - no more pending changes mess
 */
function saveCachedBoard() {

    if (!window.cachedBoard) {
        return;
    }


    // Log each column's includeMode status
    if (window.cachedBoard.columns) {
        for (const col of window.cachedBoard.columns) {
        }
    }

    // Capture any in-progress edits and include them in the save
    let boardToSave = window.cachedBoard;
    let hadInProgressEdits = false;
    if (window.taskEditor) {
        const editState = window.taskEditor.getCurrentEditState();
        if (editState) {
            boardToSave = window.taskEditor.applyCurrentEditToBoard(window.cachedBoard);
            hadInProgressEdits = true;
        }
    }


    // Send the complete board state to VS Code using a simple message
    // This avoids complex sequential processing that might cause issues
    vscode.postMessage({
        type: 'saveBoardState',
        board: boardToSave
    });
    
    
    // Mark as saved and notify backend
    if (boardToSave) {
        // Update our cached state to include the in-progress edits
        window.cachedBoard = JSON.parse(JSON.stringify(boardToSave));
        window.savedBoardState = JSON.parse(JSON.stringify(boardToSave));

        // Update editor state if we had in-progress edits
        if (hadInProgressEdits && window.taskEditor) {
            window.taskEditor.handlePostSaveUpdate();
        }
    }
    markSavedChanges();
    
    // Update UI to show saved state
    updateRefreshButtonState('saved');
    
    // Clear any old pending changes (obsolete system cleanup)
    if (window.pendingColumnChanges) {window.pendingColumnChanges.clear();}
    if (window.pendingTaskChanges) {window.pendingTaskChanges.clear();}
    
}

// Alias for saveCachedBoard
function flushPendingTagChanges() {
    saveCachedBoard();
}

// Retry function for failed saves
function retryLastFlushedChanges() {
    if (!window._lastFlushedChanges) {
        return false;
    }
    
    const { columns, tasks, timestamp } = window._lastFlushedChanges;
    const timeSinceFlush = Date.now() - timestamp;
    
    // Don't retry if too much time has passed (5 minutes)
    if (timeSinceFlush > 300000) {
        window._lastFlushedChanges = null;
        return false;
    }
    
    
    // Re-add changes to pending and flush again
    if (columns.size > 0) {
        if (!window.pendingColumnChanges) {
            window.pendingColumnChanges = new Map();
        }
        columns.forEach((value, key) => {
            window.pendingColumnChanges.set(key, value);
        });
    }
    
    if (tasks.size > 0) {
        if (!window.pendingTaskChanges) {
            window.pendingTaskChanges = new Map();
        }
        tasks.forEach((value, key) => {
            window.pendingTaskChanges.set(key, value);
        });
    }
    
    // Clear the retry data and flush again
    window._lastFlushedChanges = null;
    
    // Add a small delay before retrying
    setTimeout(() => {
        flushPendingTagChanges();
    }, 1000);
    
    return true;
}


// Function to handle save errors from the backend
function handleSaveError(errorMessage) {
    console.error('❌ Save error from backend:', errorMessage);
    
    // Update UI to show error state
    updateRefreshButtonState('error');
    
    // Show user-friendly error message
    if (errorMessage.includes('workspace edit')) {
        // Attempt to retry after a delay
        setTimeout(() => {
            if (retryLastFlushedChanges()) {
            }
        }, 2000);
    }
}

// Modal functions - delegate to centralized modalUtils
function showInputModal(title, message, placeholder, onConfirm) {
    modalUtils.showInputModal(title, message, placeholder, onConfirm);
}

function closeInputModal() {
    modalUtils.closeInputModal();
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

function performSort() {
    vscode.postMessage({ type: 'performSort' });
}

// Manual refresh function
function manualRefresh() {
    // First flush any pending tag changes immediately
    flushPendingTagChanges();
    
    // Send all pending column changes
    if (window.pendingColumnChanges && window.pendingColumnChanges.size > 0) {
        window.pendingColumnChanges.forEach((change) => {
            vscode.postMessage({
                type: 'editColumnTitle',
                columnId: change.columnId,
                title: change.title
            });
        });
        window.pendingColumnChanges.clear();
    }

    // Send all pending task changes
    if (window.pendingTaskChanges && window.pendingTaskChanges.size > 0) {
        window.pendingTaskChanges.forEach((change) => {
            vscode.postMessage({
                type: 'editTask',
                taskId: change.taskId,
                columnId: change.columnId,
                taskData: change.taskData
            });
        });
        window.pendingTaskChanges.clear();
    }

    // Clear any pending timeouts
    if (window.columnTagUpdateTimeout) {
        clearTimeout(window.columnTagUpdateTimeout);
        window.columnTagUpdateTimeout = null;
    }
    if (window.taskTagUpdateTimeout) {
        clearTimeout(window.taskTagUpdateTimeout);
        window.taskTagUpdateTimeout = null;
    }
    
    // Update button state to saved
    updateRefreshButtonState('saved');
    
    // Small delay to let changes process, then force refresh from source
    setTimeout(() => {
        vscode.postMessage({ type: 'requestBoardUpdate', force: true });
        vscode.postMessage({ type: 'showMessage', text: 'Refreshing from source...' });
    }, 100);
}


// Function to update refresh button state
/**
 * Updates the refresh button to show save state
 * Purpose: Visual feedback for pending/saved changes
 * Used by: After any change, after saves
 * @param {string} state - 'pending', 'saved', 'error', etc
 * @param {number} count - Number of pending changes
 */
function updateRefreshButtonState(state, count = 0) {
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshIcon = refreshBtn?.querySelector('.refresh-icon');
    const refreshText = refreshBtn?.querySelector('.refresh-text');
    
    if (!refreshBtn || !refreshIcon || !refreshText) {
        return;
    }
    
    switch (state) {
        case 'pending':
            refreshBtn.classList.add('pending');
            refreshBtn.classList.remove('saved');
            refreshIcon.textContent = count > 0 ? count.toString() : '●';
            refreshText.textContent = count > 0 ? `Pending (${count})` : 'Pending';
            refreshBtn.title = `${count} changes pending - press Cmd+S (or Ctrl+S) to save`;
            break;
        case 'saved':
            refreshBtn.classList.remove('pending');
            refreshBtn.classList.add('saved');
            refreshIcon.textContent = '✓';
            refreshText.textContent = 'Saved';
            refreshBtn.title = 'Changes saved - click to refresh from source';
            // Reset to normal state after 2 seconds
            setTimeout(() => {
                refreshBtn.classList.remove('saved');
                refreshIcon.textContent = '↻';
                refreshText.textContent = 'Refresh';
                refreshBtn.title = 'Refresh from source markdown';
            }, 2000);
            break;
        case 'unsaved':
            refreshBtn.classList.remove('saved');
            refreshBtn.classList.add('pending');
            refreshIcon.textContent = '!';
            refreshText.textContent = 'Unsaved';
            refreshBtn.title = 'Changes have been made - click to refresh and save all changes';
            break;
        case 'error':
            refreshBtn.classList.remove('pending', 'saved');
            refreshBtn.classList.add('error');
            refreshIcon.textContent = '❌';
            refreshText.textContent = 'Error';
            refreshBtn.title = 'Save failed - click to try again';
            break;
        default:
            refreshBtn.classList.remove('pending', 'saved');
            refreshIcon.textContent = '↻';
            refreshText.textContent = 'Refresh';
            refreshBtn.title = 'Refresh from source markdown';
            break;
    }
}

// Update tag button appearance immediately when toggled
function updateTagButtonAppearance(id, type, tagName, isActive) {

    // Find the tag button using the same ID pattern as in generateGroupTagItems
    // Encode special characters to match the encoding in generateGroupTagItems
    const encodedTag = tagName
        .replace(/\+\+/g, 'plus-plus')
        .replace(/\+/g, 'plus')
        .replace(/--/g, 'minus-minus')
        .replace(/-/g, 'minus')
        .replace(/ø/gi, 'o-slash');
    const buttonId = `tag-chip-${type}-${id}-${encodedTag}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const button = document.getElementById(buttonId);
    
    if (!button) {
        return;
    }
    
    // Get tag configuration for colors (reuse logic from boardRenderer.js)
    const config = window.getTagConfig ? window.getTagConfig(tagName) : null;
    let bgColor = '#666';
    let textColor = '#fff';
    let bgDark = null;
    
    if (config) {
        const isDarkTheme = document.body.classList.contains('vscode-dark') || 
                           document.body.classList.contains('vscode-high-contrast');
        const themeKey = isDarkTheme ? 'dark' : 'light';
        
        // Use the appropriate color config based on type (card or column)
        let colorConfig = null;
        if (type === 'column' && config.column) {
            colorConfig = config.column[themeKey] || config.column.light || {};
            bgDark = colorConfig.backgroundDark || colorConfig.background;
        } else if (type === 'task' && config.card) {
            colorConfig = config.card[themeKey] || config.card.light || {};
            bgDark = colorConfig.backgroundDark || colorConfig.background;
        } else {
            // Fallback to basic theme colors if specific type not found
            colorConfig = config[themeKey] || config.light || {};
        }
        
        bgColor = colorConfig.background || '#666';
        textColor = colorConfig.text || '#fff';
        
        // If we have a backgroundDark, interpolate it for a subtle effect
        if (bgDark && typeof colorUtils !== 'undefined') {
            const editorBg = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background') || '#ffffff';
            // Use a lighter interpolation for the button background when active
            bgColor = colorUtils.interpolateColor(editorBg, bgDark, isActive ? 0.25 : 0.1);
        }
    }
    
    // Update button class
    if (isActive) {
        button.classList.add('active');
    } else {
        button.classList.remove('active');
    }
    
    // Update button styling
    button.style.backgroundColor = isActive ? bgColor : 'transparent';
    button.style.color = isActive ? textColor : (bgDark ? bgDark : 'inherit');
    button.style.borderColor = bgDark || bgColor;
    
    if (!isActive && bgDark) {
        button.style.border = `2px solid ${bgDark}`;
    }
    
    // Update the checkmark
    const checkElement = button.querySelector('.tag-chip-check');
    if (checkElement) {
        checkElement.textContent = isActive ? '✓' : '';
    }
    
    // Update the tag name color for inactive buttons
    const nameElement = button.querySelector('.tag-chip-name');
    if (nameElement && !isActive && bgDark) {
        nameElement.style.color = bgDark;
    } else if (nameElement) {
        nameElement.style.color = '';
    }
    
}

// Update corner badges immediately for an element
function updateCornerBadgesImmediate(elementId, elementType, newTitle) {

    // Find the element
    const selector = elementType === 'column' ? `[data-column-id="${elementId}"]` : `[data-task-id="${elementId}"]`;
    const element = document.querySelector(selector);
    if (!element) {
        return;
    }

    // Get all active tags from the new title
    const activeTags = getActiveTagsInTitle(newTitle);

    // Update data-all-tags attribute
    if (activeTags.length > 0) {
        element.setAttribute('data-all-tags', activeTags.join(' '));
    } else {
        element.removeAttribute('data-all-tags');
    }

    // For columns, append to column-title; for tasks, append to task-header
    const targetContainer = elementType === 'column'
        ? element.querySelector('.column-title') || element
        : element.querySelector('.task-header') || element;

    // Remove existing badge containers
    targetContainer.querySelectorAll('.corner-badges-container').forEach(el => el.remove());

    // Extract numeric tags first to check if we need to render badges
    const numericTags = window.tagUtils ? window.tagUtils.extractNumericTag(newTitle) : null;
    const hasNumericTags = numericTags && Array.isArray(numericTags) && numericTags.length > 0;

    // Render badges if we have active tags OR numeric tags
    if (window.tagColors && (activeTags.length > 0 || hasNumericTags)) {
        const positions = {
            'top-left': [],
            'top-right': [],
            'bottom-left': [],
            'bottom-right': []
        };

        // Add numeric badges to positions (already extracted above)
        if (numericTags && Array.isArray(numericTags)) {
            numericTags.forEach(numericValue => {
                const displayValue = numericValue % 1 === 0 ? numericValue.toString() : numericValue.toFixed(2).replace(/\.?0+$/, '');
                // Add to top-left position using SAME system as other corner badges
                positions['top-left'].push({
                    tag: `numeric-${numericValue}`,
                    badge: {
                        label: displayValue,
                        position: 'top-left',
                        color: 'var(--vscode-badge-background, #4d4d4d)',
                        labelColor: 'var(--vscode-badge-foreground, #ffffff)'
                    }
                });
            });
        }

        // Collect badges by position
        activeTags.forEach(tag => {
            const config = getTagConfig(tag);

            if (config && config.cornerBadge) {
                // Get theme colors for this tag
                const isDarkTheme = document.body.classList.contains('vscode-dark') ||
                                    document.body.classList.contains('vscode-high-contrast');
                const themeKey = isDarkTheme ? 'dark' : 'light';
                const themeColors = config[themeKey] || config.light || {};

                // Fallback to themeColors.background if badge.color is not defined (like other tags)
                const badgeColor = config.cornerBadge.color || themeColors.background;

                // Calculate text color automatically (matching boardRenderer.js logic)
                const opaqueBadgeColor = badgeColor && badgeColor.length === 9 ? badgeColor.substring(0, 7) : badgeColor;
                const badgeTextColor = colorUtils ? colorUtils.getContrastText(opaqueBadgeColor) : '#ffffff';

                const position = config.cornerBadge.position || 'top-right';
                positions[position].push({
                    tag: tag,
                    badge: {
                        ...config.cornerBadge,
                        color: badgeColor,
                        labelColor: badgeTextColor
                    }
                });
            }
        });

        // Create separate flex containers for each corner position
        Object.entries(positions).forEach(([position, badgesAtPosition]) => {
            if (badgesAtPosition.length === 0) return; // Skip empty positions

            // Create container for this corner
            const cornerContainer = document.createElement('div');
            cornerContainer.className = `corner-badges-container ${position}`;

            // Append badges to this corner's container
            badgesAtPosition.forEach((item, index) => {
                const badge = item.badge;

                // Encode special characters for CSS class names
                let cssClassName = item.tag;
                if (cssClassName === '++') cssClassName = 'plusplus';
                else if (cssClassName === '+') cssClassName = 'plus';
                else if (cssClassName === '--') cssClassName = 'minusminus';
                else if (cssClassName === '-') cssClassName = 'minus';
                else if (cssClassName === 'ø') cssClassName = 'oslash';
                else {
                    cssClassName = item.tag;
                }

                const badgeContent = badge.image ? '' : (badge.label || '');

                // Only apply background and color styles - NO position calculations!
                const bgColor = badge.color || '#FF0000';
                const textColor = badge.labelColor || '#ffffff';
                const inlineStyles = `background: ${bgColor} !important; color: ${textColor} !important;`;

                const badgeElement = document.createElement('div');
                badgeElement.className = `corner-badge corner-badge-${cssClassName}`;
                badgeElement.style.cssText = inlineStyles;
                badgeElement.setAttribute('data-badge-position', position);
                badgeElement.setAttribute('data-badge-index', index);
                badgeElement.textContent = badgeContent;

                cornerContainer.appendChild(badgeElement);
            });

            // Append this corner's container to the target
            targetContainer.appendChild(cornerContainer);
        });
    }

}

// Update tag category counts in the open dropdown menu
function updateTagCategoryCounts(id, type, columnId = null) {

    // Get current title to check which tags are active
    const currentBoard = window.cachedBoard;

    let currentTitle = '';
    if (type === 'column') {
        const column = currentBoard?.columns?.find(c => c.id === id);
        currentTitle = column?.title || '';
    } else if (type === 'task') {
        // For tasks, columnId is required
        if (columnId) {
            const column = currentBoard?.columns?.find(c => c.id === columnId);
            const task = column?.tasks?.find(t => t.id === id);
            currentTitle = task?.title || '';
        }
    }

    // Get active tags
    const activeTags = getActiveTagsInTitle(currentTitle);

    // Find the active dropdown menu that contains category items for this element
    // First try to find it in the menu, then check if it's been moved to body
    const activeMenu = document.querySelector('.donut-menu.active');
    let activeDropdown = activeMenu?.querySelector('.donut-menu-dropdown');
    
    if (!activeDropdown) {
        // Look for moved dropdowns in body that belong to the active menu
        const movedDropdowns = document.body.querySelectorAll('.donut-menu-dropdown.moved-to-body');
        activeDropdown = Array.from(movedDropdowns).find(d => d._originalParent === activeMenu);
    }
    
    if (!activeDropdown) {
        return;
    }
    
    // Update configured tag group counts
    const tagConfig = window.tagColors || {};
    Object.keys(tagConfig).forEach(groupKey => {
        const groupValue = tagConfig[groupKey];
        
        if (groupValue && typeof groupValue === 'object') {
            let groupTags = [];

            // Check if this is a direct tag configuration or a group (check ALL styling properties)
            const isDirectTag = groupValue.light || groupValue.dark || groupValue.headerBar ||
                               groupValue.border || groupValue.footerBar || groupValue.cornerBadge;

            if (isDirectTag) {
                groupTags = [groupKey];
            } else {
                Object.keys(groupValue).forEach(tagKey => {
                    const tagValue = groupValue[tagKey];
                    const hasTagProperties = tagValue && typeof tagValue === 'object' &&
                                            (tagValue.light || tagValue.dark || tagValue.headerBar ||
                                             tagValue.border || tagValue.footerBar || tagValue.cornerBadge);
                    if (hasTagProperties) {
                        groupTags.push(tagKey);
                    }
                });
            }
            
            if (groupTags.length > 0) {
                // Find the menu item for this group
                const menuItem = activeDropdown.querySelector(`[data-group="${groupKey}"]`);
                if (menuItem) {
                    // Count active tags in this group
                    const activeCount = groupTags.filter(tag => 
                        activeTags.includes(tag.toLowerCase())
                    ).length;
                    
                    // Update or create count badge
                    let countBadge = menuItem.querySelector('.menu-count-badge');
                    if (activeCount > 0) {
                        if (countBadge) {
                            // Update existing badge
                            countBadge.textContent = activeCount;
                        } else {
                            // Create new badge
                            const badge = document.createElement('span');
                            badge.className = 'menu-count-badge';
                            badge.textContent = activeCount;
                            menuItem.appendChild(badge);
                        }
                    } else {
                        // Remove badge if count is 0
                        if (countBadge) {
                            countBadge.remove();
                        }
                    }
                }
            }
        }
    });
    
    // Update custom tag group count
    const customMenuItem = activeDropdown.querySelector('[data-group="custom"]');
    if (customMenuItem) {
        const userAddedTags = getUserAddedTags();
        const activeCustomCount = userAddedTags.filter(tag => 
            activeTags.includes(tag.toLowerCase())
        ).length;
        
        let customCountBadge = customMenuItem.querySelector('.menu-count-badge');
        if (activeCustomCount > 0) {
            if (customCountBadge) {
                customCountBadge.textContent = activeCustomCount;
            } else {
                const badge = document.createElement('span');
                badge.className = 'menu-count-badge';
                badge.textContent = activeCustomCount;
                customMenuItem.appendChild(badge);
            }
        } else {
            if (customCountBadge) {
                customCountBadge.remove();
            }
        }
    }

    // Show/hide "Remove all tags" option - ensure only one exists
    const existingRemoveAllButtons = activeDropdown.querySelectorAll('[data-action="remove-all-tags"]');

    if (activeTags.length > 0) {
        // Remove any existing "remove all tags" buttons first to prevent duplicates
        existingRemoveAllButtons.forEach(button => {
            button.remove();
        });

        // Add single "Remove all tags" option as the last item in the tags group
        const button = document.createElement('button');
        button.className = 'donut-menu-item';
        button.setAttribute('data-action', 'remove-all-tags');
        button.onclick = () => removeAllTags(id, type, columnId);
        button.textContent = 'Remove all tags';

        // Find all tag category items (they have data-submenu-type="tags")
        const tagItems = activeDropdown.querySelectorAll('[data-submenu-type="tags"]');

        // Also check for the "No tags available" message
        const noTagsMessage = activeDropdown.querySelector('.donut-menu-item[disabled][data-group="none"]');

        if (tagItems.length > 0) {
            // Get the last tag category item
            const lastTagItem = tagItems[tagItems.length - 1];

            // Find the next divider after the last tag item
            let nextElement = lastTagItem.nextElementSibling;
            while (nextElement && !nextElement.classList.contains('donut-menu-divider')) {
                nextElement = nextElement.nextElementSibling;
            }

            // Insert before the divider (at the end of tags group)
            if (nextElement && nextElement.classList.contains('donut-menu-divider')) {
                activeDropdown.insertBefore(button, nextElement);
            } else {
                // Fallback: insert after the last tag item
                if (lastTagItem.nextSibling) {
                    activeDropdown.insertBefore(button, lastTagItem.nextSibling);
                } else {
                    activeDropdown.appendChild(button);
                }
            }
        } else if (noTagsMessage) {
            // Find divider after "No tags available"
            let nextElement = noTagsMessage.nextElementSibling;
            while (nextElement && !nextElement.classList.contains('donut-menu-divider')) {
                nextElement = nextElement.nextElementSibling;
            }

            if (nextElement && nextElement.classList.contains('donut-menu-divider')) {
                activeDropdown.insertBefore(button, nextElement);
            } else {
                activeDropdown.appendChild(button);
            }
        }
    } else {
        // Remove all "Remove all tags" options if no active tags
        existingRemoveAllButtons.forEach(button => {
            button.remove();
        });
    }
}

// Make functions globally available
window.toggleDonutMenu = toggleDonutMenu;
// NOTE: toggleFileBarMenu is defined in webview.js (has essential submenu/Marp handling)
window.closeAllMenus = closeAllMenus;
window.handleColumnTagClick = (columnId, tagName, event) => {
    // CRITICAL: Clear any pending hover timeouts to prevent menu from closing
    // When you click a tag, the menu should stay open
    if (window.menuManager && typeof window.menuManager.clearTimeout === 'function') {
        window.menuManager.clearTimeout();
    }

    // Set dropdown state to prevent the hover timeout from closing the menu
    window._inDropdown = true;

    return toggleColumnTag(columnId, tagName, event);
};
window.handleTaskTagClick = (taskId, columnId, tagName, event) => {
    // CRITICAL: Clear any pending hover timeouts to prevent menu from closing
    // When you click a tag, the menu should stay open
    if (window.menuManager && typeof window.menuManager.clearTimeout === 'function') {
        window.menuManager.clearTimeout();
    }

    // Set dropdown state to prevent the hover timeout from closing the menu
    window._inDropdown = true;

    return toggleTaskTag(taskId, columnId, tagName, event);
};
window.updateTagChipStyle = updateTagChipStyle;
window.updateTagButtonAppearance = updateTagButtonAppearance;
// NEW CACHE SYSTEM - Single save function
window.saveCachedBoard = saveCachedBoard;
window.markUnsavedChanges = markUnsavedChanges;
window.hasUnsavedChanges = hasUnsavedChanges;
window.flushPendingTagChanges = flushPendingTagChanges;
window.updateRefreshButtonState = updateRefreshButtonState;
window.handleSaveError = handleSaveError;

// Task movement functions (called from submenu onclick handlers via executeSafeFunction)
window.moveTaskToColumn = moveTaskToColumn;
window.moveTaskToTop = moveTaskToTop;
window.moveTaskUp = moveTaskUp;
window.moveTaskDown = moveTaskDown;
window.moveTaskToBottom = moveTaskToBottom;
window.deleteTask = deleteTask;

// Update visual tag state - handles borders and other tag-based styling
function updateVisualTagState(element, allTags, elementType, isCollapsed) {

    // Update primary tag attribute (for primary styling like borders)
    const primaryTag = allTags.length > 0 ? allTags[0] : null;
    const tagAttribute = elementType === 'column' ? 'data-column-tag' : 'data-task-tag';

    if (primaryTag) {
        element.setAttribute(tagAttribute, primaryTag);

        // Ensure style exists for the primary tag
        if (window.ensureTagStyleExists) {
            window.ensureTagStyleExists(primaryTag);
        }
    } else {
        element.removeAttribute(tagAttribute);
    }

    // Update all-tags attribute (for multi-tag styling)
    if (allTags.length > 0) {
        element.setAttribute('data-all-tags', allTags.join(' '));

        // Ensure styles exist for all tags
        if (window.ensureTagStyleExists) {
            allTags.forEach(tag => {
                window.ensureTagStyleExists(tag);
            });
        }
    } else {
        element.removeAttribute('data-all-tags');
    }

    // Update background and border tag attributes (needed for colors/borders to work dynamically)
    // Get the element's title to check which tags have background/border properties
    let titleText = '';
    if (elementType === 'column') {
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
    const borderTagAttr = elementType === 'column' ? 'data-column-border-tag' : 'data-task-border-tag';
    if (borderTag) {
        element.setAttribute(borderTagAttr, borderTag);
    } else {
        element.removeAttribute(borderTagAttr);
    }

    // Update background tag attribute
    const bgTag = window.getFirstTagWithProperty ? window.getFirstTagWithProperty(titleText, 'background') : null;
    const bgTagAttr = elementType === 'column' ? 'data-column-bg-tag' : 'data-task-bg-tag';
    if (bgTag) {
        element.setAttribute(bgTagAttr, bgTag);
    } else {
        element.removeAttribute(bgTagAttr);
    }

    // Update all visual tag elements immediately (headers, footers, borders, badges)
    updateAllVisualTagElements(element, allTags, elementType);

    // Force a style recalculation to ensure CSS changes are applied immediately
    element.offsetHeight; // Trigger reflow

}

// Comprehensive function to update ALL visual tag elements immediately
function updateAllVisualTagElements(element, allTags, elementType) {

    // 0. UPDATE TITLE DISPLAY for elements with includes
    if (elementType === 'column') {
        const columnId = element.getAttribute('data-column-id');
        if (window.cachedBoard && window.cachedBoard.columns && columnId) {
            const column = window.cachedBoard.columns.find(c => c.id === columnId);
            if (column) {
                // Check if title has include syntax
                const hasInclude = /!!!include\([^)]+\)!!!/.test(column.title);
                if (hasInclude) {
                    // Update the title display using the shared utility function
                    const displayElement = element.querySelector('.column-title-text');
                    if (displayElement && window.tagUtils) {
                        const renderedTitle = window.tagUtils.getColumnDisplayTitle(column, window.filterTagsFromText);
                        displayElement.innerHTML = renderedTitle;
                    }
                }
            }
        }
    } else if (elementType === 'task') {
        const taskId = element.getAttribute('data-task-id');
        if (window.cachedBoard && window.cachedBoard.columns && taskId) {
            // Find task across all columns
            for (const column of window.cachedBoard.columns) {
                const task = column.tasks.find(t => t.id === taskId);
                if (task) {
                    // Check if task is in include mode or has include syntax
                    if (task.includeMode || /!!!include\([^)]+\)!!!/.test(task.title)) {
                        // Update the title display
                        const displayElement = element.querySelector('.task-title-display');
                        if (displayElement && window.renderMarkdownWithTags) {
                            const renderedHtml = window.renderMarkdownWithTags(task.title);
                            displayElement.innerHTML = window.wrapTaskSections ? window.wrapTaskSections(renderedHtml) : renderedHtml;
                        }
                    }
                    break;
                }
            }
        }
    }

    // 1. CLEAN UP - Remove visual elements only from column-title and column-footer areas
    if (elementType === 'column') {
        // For columns: clean up only within column-header and column-footer (never column-inner)

        const columnHeader = element.querySelector('.column-header');
        if (columnHeader) {
            // Remove visual tag elements from column-header (NOT corner badges - they're managed separately)
            columnHeader.querySelectorAll('.header-bar, .header-bars-container').forEach(el => el.remove());
        }

        const columnTitle = element.querySelector('.column-title');
        if (columnTitle) {
            // CRITICAL: Remove corner badges from column-title so they can be recreated
            // This ensures badges update immediately when tags change
            columnTitle.querySelectorAll('.corner-badges-container').forEach(el => el.remove());
        }

        const columnFooter = element.querySelector('.column-footer');
        if (columnFooter) {
            // Remove all visual tag elements from column-footer
            columnFooter.querySelectorAll('.footer-bar, .footer-bars-container').forEach(el => el.remove());
        }

        // For collapsed state: remove direct children that are visual elements
        Array.from(element.children).forEach(child => {
            if (child.classList.contains('header-bar') ||
                child.classList.contains('footer-bar') ||
                child.classList.contains('header-bars-container') ||
                child.classList.contains('footer-bars-container') ||
                child.classList.contains('corner-badges-container')) {
                child.remove();
            }
        });
    } else {
        // For tasks, remove visual elements from task-header and task element
        const taskHeader = element.querySelector('.task-header');
        if (taskHeader) {
            taskHeader.querySelectorAll('.corner-badges-container').forEach(el => el.remove());
        }
        element.querySelectorAll('.header-bar, .footer-bar, .header-bars-container, .footer-bars-container').forEach(el => el.remove());
    }
    element.classList.remove('has-header-bar', 'has-footer-bar', 'has-header-label', 'has-footer-label');
    
    if (allTags.length === 0) {
        return;
    }
    
    // 2. ENSURE STYLES - Make sure CSS exists for all tags
    allTags.forEach(tag => {
        if (window.ensureTagStyleExists) {
            window.ensureTagStyleExists(tag);
        }
    });
    
    // 3. CORNER BADGES - Update badges immediately
    // CRITICAL: For columns, only check for badges in column-title (not in nested tasks)
    // For tasks, check directly in the element
    let badgesContainer;
    if (elementType === 'column') {
        const columnTitle = element.querySelector('.column-title');
        badgesContainer = columnTitle ? columnTitle.querySelector('.corner-badges-container') : null;
    } else {
        badgesContainer = element.querySelector('.corner-badges-container');
    }
    if (!badgesContainer && window.getTagConfig) {
        // Extract numeric tags from element's title first
        // Get title from cached board data using element ID
        let titleText = '';
        if (elementType === 'column') {
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

        const numericTags = window.tagUtils && titleText ? window.tagUtils.extractNumericTag(titleText) : null;
        const hasNumericTags = numericTags && Array.isArray(numericTags) && numericTags.length > 0;

        // Generate badges HTML inline (if we have active tags OR numeric tags)
        let badgesHtml = '';
        if (window.tagColors && (allTags.length > 0 || hasNumericTags)) {
            const positions = {
                'top-left': [],
                'top-right': [],
                'bottom-left': [],
                'bottom-right': []
            };

            // Add numeric badges to positions (already extracted above)
            if (numericTags && Array.isArray(numericTags)) {
                numericTags.forEach(numericValue => {
                    const displayValue = numericValue % 1 === 0 ? numericValue.toString() : numericValue.toFixed(2).replace(/\.?0+$/, '');
                    positions['top-left'].push({
                        tag: `numeric-${numericValue}`,
                        badge: {
                            label: displayValue,
                            position: 'top-left',
                            color: 'var(--vscode-badge-background, #4d4d4d)',
                            labelColor: 'var(--vscode-badge-foreground, #ffffff)'
                        }
                    });
                });
            }

            // Collect badges by position
            allTags.forEach(tag => {
                const config = window.getTagConfig(tag);
                if (config && config.cornerBadge) {
                    // Get theme colors for this tag
                    const isDarkTheme = document.body.classList.contains('vscode-dark') ||
                                        document.body.classList.contains('vscode-high-contrast');
                    const themeKey = isDarkTheme ? 'dark' : 'light';
                    const themeColors = config[themeKey] || config.light || {};

                    // Fallback to themeColors.background if badge.color is not defined (like other tags)
                    const badgeColor = config.cornerBadge.color || themeColors.background;

                    // Calculate text color automatically (matching boardRenderer.js logic)
                    const opaqueBadgeColor = badgeColor && badgeColor.length === 9 ? badgeColor.substring(0, 7) : badgeColor;
                    const badgeTextColor = colorUtils ? colorUtils.getContrastText(opaqueBadgeColor) : '#ffffff';

                    const position = config.cornerBadge.position || 'top-right';
                    positions[position].push({
                        tag: tag,
                        badge: {
                            ...config.cornerBadge,
                            color: badgeColor,
                            labelColor: badgeTextColor
                        }
                    });
                }
            });

            // Create separate flex containers for each corner position
            Object.entries(positions).forEach(([position, badgesAtPosition]) => {
                if (badgesAtPosition.length === 0) return; // Skip empty positions

                // Create container for this corner
                const cornerContainer = document.createElement('div');
                cornerContainer.className = `corner-badges-container ${position}`;

                // Append badges to this corner's container
                badgesAtPosition.forEach((item, index) => {
                    const badge = item.badge;

                    // Encode special characters for CSS class names
                    let cssClassName = item.tag;
                    if (cssClassName === '++') cssClassName = 'plusplus';
                    else if (cssClassName === '+') cssClassName = 'plus';
                    else if (cssClassName === '--') cssClassName = 'minusminus';
                    else if (cssClassName === '-') cssClassName = 'minus';
                    else if (cssClassName === 'ø') cssClassName = 'oslash';

                    const badgeContent = badge.image ? '' : (badge.label || '');

                    // Only apply background and color styles - NO position calculations!
                    const bgColor = badge.color || '#FF0000';
                    const textColor = badge.labelColor || '#ffffff';
                    const inlineStyles = `background: ${bgColor} !important; color: ${textColor} !important;`;

                    const badgeElement = document.createElement('div');
                    badgeElement.className = `corner-badge corner-badge-${cssClassName}`;
                    badgeElement.style.cssText = inlineStyles;
                    badgeElement.setAttribute('data-badge-position', position);
                    badgeElement.setAttribute('data-badge-index', index);
                    badgeElement.textContent = badgeContent;

                    cornerContainer.appendChild(badgeElement);
                });

                // For columns, append to column-title; for tasks, append to task-header
                const targetContainer = elementType === 'column'
                    ? element.querySelector('.column-title') || element
                    : element.querySelector('.task-header') || element;
                targetContainer.appendChild(cornerContainer);
            });
        }
    }
    
    // 4. HEADER BARS - Create header bars only for title tags (not description tags)
    const headerBars = [];
    let hasHeaderLabel = false;

    // Filter out tags that are only in description for task elements
    let tagsForCardStyling = allTags;
    if (elementType === 'task') {
        // For tasks, check if tags exist in description and exclude them
        const taskDescDisplay = element.querySelector('.task-description-display');
        if (taskDescDisplay) {
            const descriptionTags = new Set();
            // Find all tag spans in the description
            taskDescDisplay.querySelectorAll('.kanban-tag').forEach(tagSpan => {
                const tagName = tagSpan.getAttribute('data-tag');
                if (tagName) {
                    descriptionTags.add(tagName);
                }
            });

            // Only use tags that are NOT in description for card-level styling
            tagsForCardStyling = allTags.filter(tag => !descriptionTags.has(tag));
        }
    }

    tagsForCardStyling.forEach(tag => {
        if (window.getTagConfig) {
            const config = window.getTagConfig(tag);
            if (config && config.headerBar) {
                const headerBar = document.createElement('div');
                headerBar.className = `header-bar header-bar-${tag.toLowerCase()}`;
                headerBars.push(headerBar);
                if (config.headerBar.label) {hasHeaderLabel = true;}
            }
        }
    });

    // Always try to add header-bars-container to column-header (regardless of collapsed state)
    const columnHeader = element.querySelector('.column-header');
    if (columnHeader && headerBars.length > 0) {
        const headerContainer = document.createElement('div');
        headerContainer.className = 'header-bars-container';
        headerBars.forEach(bar => headerContainer.appendChild(bar));
        // Header container should be first child, so insert at the beginning
        columnHeader.insertBefore(headerContainer, columnHeader.firstChild);
    } else if (headerBars.length > 0) {
        // Fallback: add directly to element if no column-header found
        const headerContainer = document.createElement('div');
        headerContainer.className = 'header-bars-container';
        headerBars.forEach(bar => headerContainer.appendChild(bar));
        element.appendChild(headerContainer);
    }

    // Set classes only if there are actual header bars
    if (headerBars.length > 0) {
        element.classList.add('has-header-bar');
        // if (hasHeaderLabel) element.classList.add('has-header-label');
    }
    
    // 5. FOOTER BARS - Create footer bars only for title tags (not description tags)
    const footerBars = [];
    let hasFooterLabel = false;
    // Use the same filtered tags as for header bars
    tagsForCardStyling.forEach(tag => {
        if (window.getTagConfig) {
            const config = window.getTagConfig(tag);
            if (config && config.footerBar) {
                const footerBar = document.createElement('div');
                footerBar.className = `footer-bar footer-bar-${tag.toLowerCase()}`;
                footerBars.push(footerBar);
                if (config.footerBar.label) {hasFooterLabel = true;}
            }
        }
    });
    
    if (footerBars.length > 0) {
        // Always try to add footer-bars-container to column-footer (regardless of collapsed state)
        const columnFooter = element.querySelector('.column-footer');
        if (columnFooter) {
            const footerContainer = document.createElement('div');
            footerContainer.className = 'footer-bars-container';
            footerBars.forEach(bar => footerContainer.appendChild(bar));
            columnFooter.appendChild(footerContainer);
        } else {
            // Fallback: add directly to element if no column-footer found
            const footerContainer = document.createElement('div');
            footerContainer.className = 'footer-bars-container';
            footerBars.forEach(bar => footerContainer.appendChild(bar));
            element.appendChild(footerContainer);
        }
        element.classList.add('has-footer-bar');
        if (hasFooterLabel) {element.classList.add('has-footer-label');}
    }
    
}

window.updateTagCategoryCounts = updateTagCategoryCounts;
window.unfoldColumnIfCollapsed = unfoldColumnIfCollapsed;
window.cleanupDropdown = cleanupDropdown;
window.columnTagUpdateTimeout = null;
window.taskTagUpdateTimeout = null;
window.toggleColumnTag = toggleColumnTag;
window.toggleTaskTag = toggleTaskTag;
window.submenuGenerator = window.menuManager; // Compatibility alias
window.manualRefresh = manualRefresh;
window.updateVisualTagState = updateVisualTagState;
window.updateAllVisualTagElements = updateAllVisualTagElements;
window.toggleTaskIncludeMode = toggleTaskIncludeMode;
window.editTaskIncludeFile = editTaskIncludeFile;

