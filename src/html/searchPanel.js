/**
 * Search Panel JavaScript
 * Frontend logic for the Kanban Search sidebar panel
 * Uses VS Code explorer tree styling (same as Dashboard)
 */

(function() {
    const escapeHtml = window.escapeHtml;
    const escapeRegExp = window.escapeRegExp;

    // VS Code API
    const vscode = acquireVsCodeApi();

    // DOM Elements
    const modeButtons = document.querySelectorAll('.mode-btn');
    const searchInputContainer = document.querySelector('.search-input-container');
    const findBrokenContainer = document.querySelector('.find-broken-container');
    const searchInput = document.querySelector('.search-input');
    const searchBtn = document.querySelector('.search-btn');
    const regexToggleBtn = document.querySelector('.regex-toggle-btn');
    const findBrokenBtn = document.querySelector('.find-broken-btn');
    const statusMessage = document.querySelector('.status-message');
    const resultsEmpty = document.querySelector('.results-empty');
    const resultsList = document.querySelector('.results-list');

    // State
    let currentMode = 'text';
    let hasActivePanel = false;
    let searchDebounceTimer = null;
    let currentResults = [];
    let resultElements = [];
    let currentResultIndex = -1;
    let useRegex = false;

    // Icon mappings for element types
    const typeIcons = {
        image: 'file-media',
        include: 'symbol-file',
        link: 'link',
        media: 'play',
        diagram: 'graph',
        text: 'quote'
    };

    // Labels for element types
    const typeLabels = {
        image: 'Images',
        include: 'Includes',
        link: 'Links',
        media: 'Media',
        diagram: 'Diagrams',
        text: 'Text Matches'
    };

    // Track folded state per type
    const foldedGroups = new Set();

    /**
     * Initialize the panel
     */
    function init() {
        // Mode toggle
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => setMode(btn.dataset.mode));
        });

        // Default to text search mode
        setMode('text');

        // Find broken button
        findBrokenBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'searchBrokenElements' });
            showLoading('Scanning for broken elements...');
        });

        // Regex toggle button
        if (regexToggleBtn) {
            regexToggleBtn.addEventListener('click', () => {
                useRegex = !useRegex;
                regexToggleBtn.classList.toggle('active', useRegex);
                // Re-run search with new mode if there's a query
                if (searchInput.value.trim().length >= 2) {
                    performTextSearch();
                }
            });
        }

        // Search button
        searchBtn.addEventListener('click', performTextSearch);

        // Search input enter key
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performTextSearch();
            }
        });

        // Search input live search (debounced)
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                if (searchInput.value.length >= 2) {
                    performTextSearch();
                }
            }, 300);
        });

        // Handle messages from extension
        window.addEventListener('message', handleMessage);

        document.addEventListener('keydown', (e) => {
            const isModifier = e.ctrlKey || e.metaKey;
            if (!isModifier) {
                return;
            }

            if (e.key.toLowerCase() === 'f') {
                e.preventDefault();
                if (currentMode !== 'text') {
                    setMode('text', { clearResults: false });
                }
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
                return;
            }

            if (e.key.toLowerCase() === 'g') {
                if (currentResults.length === 0) {
                    return;
                }
                e.preventDefault();
                const direction = e.shiftKey ? -1 : 1;
                const nextIndex = (currentResultIndex + direction + currentResults.length) % currentResults.length;
                navigateToIndex(nextIndex);
            }
        });

        // Notify extension that we're ready
        vscode.postMessage({ type: 'ready' });
    }

    /**
     * Set search mode
     */
    function setMode(mode, options = {}) {
        currentMode = mode;

        // Update button states
        modeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Show/hide appropriate controls
        if (mode === 'broken') {
            searchInputContainer.style.display = 'none';
            findBrokenContainer.style.display = 'flex';
            updateEmptyHint('Click "Find Broken Elements" to scan the board');
        } else {
            searchInputContainer.style.display = 'flex';
            findBrokenContainer.style.display = 'none';
            updateEmptyHint('Enter text to search the board');
            searchInput.focus();
        }

        if (options.clearResults !== false) {
            clearResults();
        }
    }

    /**
     * Perform text search
     */
    function performTextSearch() {
        const query = searchInput.value.trim();
        if (query.length === 0) {
            clearResults();
            return;
        }

        const msg = {
            type: 'searchText',
            query: query
        };
        if (useRegex) {
            msg.useRegex = true;
        }
        vscode.postMessage(msg);
        showLoading('Searching...');
    }

    /**
     * Handle messages from the extension
     */
    function handleMessage(event) {
        const message = event.data;

        switch (message.type) {
            case 'panelStatus':
                hasActivePanel = message.hasActivePanel;
                if (!hasActivePanel) {
                    showNoActivePanel();
                } else {
                    hideStatus();
                }
                break;

            case 'searchResults':
                displayResults(message.results, message.searchType);
                break;

            case 'error':
                showError(message.message);
                break;

            case 'noActivePanel':
                showNoActivePanel();
                break;

            case 'setSearchQuery':
                if (message.query) {
                    if (currentMode !== 'text') {
                        setMode('text', { clearResults: false });
                    }
                    searchInput.value = message.query;
                    performTextSearch();
                }
                break;
        }
    }

    /**
     * Display search results using tree-row structure
     */
    function displayResults(results, searchType) {
        hideStatus();
        resultsList.innerHTML = '';
        currentResults = results || [];
        resultElements = [];
        currentResultIndex = -1;

        if (results.length === 0) {
            resultsEmpty.style.display = 'flex';
            resultsList.style.display = 'none';
            updateEmptyHint(searchType === 'broken'
                ? 'No broken elements found! All references are valid.'
                : 'No matches found');
            return;
        }

        resultsEmpty.style.display = 'none';
        resultsList.style.display = 'block';

        // Group results by type
        const grouped = {};
        results.forEach(result => {
            const type = result.type;
            if (!grouped[type]) {
                grouped[type] = [];
            }
            grouped[type].push(result);
        });

        // Render grouped results using tree structure
        let indexCounter = 0;
        Object.keys(grouped).forEach(type => {
            const group = grouped[type];
            const groupEl = createResultGroup(type, group, searchType, indexCounter);
            indexCounter += group.length;
            resultsList.appendChild(groupEl);
        });

        if (currentResults.length > 0) {
            navigateToIndex(0, { scroll: false, focus: false });
        }

        // Show summary
        const totalCount = results.length;
        const typeCount = Object.keys(grouped).length;
        if (searchType === 'broken') {
            showStatus(`Found ${totalCount} broken element${totalCount !== 1 ? 's' : ''} in ${typeCount} categor${typeCount !== 1 ? 'ies' : 'y'}`, 'warning');
        } else {
            showStatus(`Found ${totalCount} match${totalCount !== 1 ? 'es' : ''}`);
        }
    }

    /**
     * Create a result group element using tree structure
     */
    function createResultGroup(type, items, searchType, startIndex = 0) {
        const group = document.createElement('div');
        group.className = 'tree-group';
        group.dataset.type = type;

        // Check if this group should be folded (persisted state)
        const isFolded = foldedGroups.has(type);
        if (isFolded) {
            group.classList.add('folded');
        }

        // Header using tree-row structure
        const header = document.createElement('div');
        header.className = 'tree-row tree-group-toggle';
        header.innerHTML = `
            <div class="tree-indent"><div class="indent-guide"></div></div>
            <div class="tree-twistie collapsible ${isFolded ? '' : 'expanded'}"></div>
            <div class="tree-contents">
                <span class="tree-label-name">${escapeHtml(typeLabels[type] || type)} (${items.length})</span>
            </div>
        `;

        // Click handler to toggle fold
        header.addEventListener('click', () => {
            const isNowFolded = group.classList.toggle('folded');
            const twistie = header.querySelector('.tree-twistie');
            if (twistie) {
                twistie.classList.toggle('expanded', !isNowFolded);
            }
            // Persist fold state
            if (isNowFolded) {
                foldedGroups.add(type);
            } else {
                foldedGroups.delete(type);
            }
        });

        group.appendChild(header);

        // Items container
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'tree-group-items';
        items.forEach((item, offset) => {
            const itemEl = createResultItem(item, searchType, startIndex + offset);
            itemsContainer.appendChild(itemEl);
        });
        group.appendChild(itemsContainer);

        return group;
    }

    /**
     * Create a result item element using tree-row structure with 2 lines
     */
    function createResultItem(item, searchType, resultIndex) {
        const el = document.createElement('div');
        el.className = 'tree-row';
        el.dataset.resultIndex = String(resultIndex);

        const isBroken = searchType === 'broken';

        // Main content (title)
        let mainContent = '';
        if (item.path) {
            mainContent = escapeHtml(item.path);
        } else if (item.matchText) {
            mainContent = escapeHtml(item.matchText);
        } else if (item.context) {
            mainContent = highlightMatch(item.context, item.matchText);
        }

        // Location (second line)
        const locationText = formatLocation(item.location);

        el.innerHTML = `
            <div class="tree-indent"><div class="indent-guide"></div><div class="indent-guide"></div></div>
            <div class="tree-twistie"></div>
            <div class="tree-contents">
                <div class="tree-label-2line">
                    <span class="entry-title ${isBroken ? 'result-icon-broken' : ''}">${mainContent}</span>
                    <span class="entry-location">${locationText}</span>
                </div>
            </div>
        `;

        el.addEventListener('click', () => {
            navigateToIndex(resultIndex, { focus: true, scroll: true });
        });

        resultElements[resultIndex] = el;
        return el;
    }

    /**
     * Navigate to an element on the board
     */
    function navigateToElement(item) {
        vscode.postMessage({
            type: 'navigateToElement',
            columnId: item.location.columnId,
            taskId: item.location.taskId,
            elementPath: item.path,
            elementType: item.type,
            field: item.location.field
        });
    }

    function logSearchScroll(index, element) {
        if (typeof window.logViewMovement === 'function' && element) {
            window.logViewMovement('searchPanel.navigateToIndex', {
                index,
                element: {
                    tag: element.tagName,
                    id: element.id,
                    class: element.className
                }
            });
        }
    }

    function updateActiveResult() {
        resultElements.forEach((el, index) => {
            if (!el) return;
            el.classList.toggle('active', index === currentResultIndex);
        });
    }

    function navigateToIndex(index, options = {}) {
        const { scroll = true, focus = true } = options;
        if (index < 0 || index >= currentResults.length) {
            return;
        }
        currentResultIndex = index;
        updateActiveResult();
        const item = currentResults[index];
        if (focus) {
            navigateToElement(item);
        }
        if (scroll) {
            const el = resultElements[index];
            if (el && typeof el.scrollIntoView === 'function') {
                logSearchScroll(index, el);
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    /**
     * Format location for display
     */
    function formatLocation(location) {
        let text = escapeHtml(location.columnTitle);
        if (location.taskTitle) {
            text += ' / ' + escapeHtml(location.taskTitle);
        }
        if (location.field === 'description') {
            text += ' (description)';
        }
        return text;
    }

    /**
     * Highlight match in context
     */
    function highlightMatch(context, matchText) {
        if (!matchText) return escapeHtml(context);

        const escaped = escapeHtml(context);
        const matchEscaped = escapeHtml(matchText);
        const regex = new RegExp(`(${escapeRegExp(matchEscaped)})`, 'gi');
        return escaped.replace(regex, '<span class="highlight">$1</span>');
    }

    /**
     * Clear results
     */
    function clearResults() {
        resultsList.innerHTML = '';
        resultsEmpty.style.display = 'flex';
        resultsList.style.display = 'none';
        hideStatus();
        currentResults = [];
        resultElements = [];
        currentResultIndex = -1;
    }

    /**
     * Update empty hint text
     */
    function updateEmptyHint(text) {
        const hint = resultsEmpty.querySelector('.hint');
        if (hint) {
            hint.textContent = text;
        }
    }

    /**
     * Show status message
     */
    function showStatus(text, type = '') {
        statusMessage.textContent = text;
        statusMessage.className = 'status-message visible' + (type ? ` ${type}` : '');
    }

    /**
     * Show error message
     */
    function showError(text) {
        showStatus(text, 'error');
    }

    /**
     * Hide status message
     */
    function hideStatus() {
        statusMessage.className = 'status-message';
    }

    /**
     * Show loading state
     */
    function showLoading(text) {
        resultsEmpty.style.display = 'none';
        resultsList.style.display = 'block';
        resultsList.innerHTML = `<div class="loading">${text}</div>`;
    }

    /**
     * Show no active panel warning
     */
    function showNoActivePanel() {
        resultsEmpty.style.display = 'none';
        resultsList.style.display = 'block';
        resultsList.innerHTML = `
            <div class="no-panel-warning">
                <span class="codicon codicon-info"></span>
                <p>No kanban board is currently open</p>
                <p class="hint">Open a kanban markdown file to search</p>
            </div>
        `;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
