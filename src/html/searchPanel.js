/**
 * Search Panel JavaScript
 * Frontend logic for the Kanban Search sidebar panel
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

        vscode.postMessage({
            type: 'searchText',
            query: query
        });
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
        }
    }

    /**
     * Display search results
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

        // Render grouped results
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
     * Create a result group element
     */
    function createResultGroup(type, items, searchType, startIndex = 0) {
        const group = document.createElement('div');
        group.className = 'result-group';

        // Header
        const header = document.createElement('div');
        header.className = 'result-group-header';
        header.innerHTML = `
            <span class="codicon codicon-${typeIcons[type] || 'file'}"></span>
            <span>${typeLabels[type] || type}</span>
            <span class="result-group-count">${items.length}</span>
        `;
        group.appendChild(header);

        // Items
        items.forEach((item, offset) => {
            const itemEl = createResultItem(item, searchType, startIndex + offset);
            group.appendChild(itemEl);
        });

        return group;
    }

    /**
     * Create a result item element
     */
    function createResultItem(item, searchType, resultIndex) {
        const el = document.createElement('div');
        el.className = 'result-item';
        el.dataset.resultIndex = String(resultIndex);
        el.addEventListener('click', () => {
            navigateToIndex(resultIndex, { focus: true, scroll: true });
        });

        const isBroken = searchType === 'broken';
        const iconClass = isBroken ? 'broken' : 'text';
        const iconName = isBroken ? 'warning' : typeIcons[item.type] || 'quote';

        let mainContent = '';
        if (item.path) {
            mainContent = escapeHtml(item.path);
        } else if (item.matchText) {
            mainContent = escapeHtml(item.matchText);
        }

        let contextHtml = '';
        if (item.context) {
            contextHtml = `<div class="result-item-context">${highlightMatch(item.context, item.matchText)}</div>`;
        }

        const locationText = formatLocation(item.location);

        el.innerHTML = `
            <div class="result-item-main">
                <div class="result-item-icon ${iconClass}">
                    <span class="codicon codicon-${iconName}"></span>
                </div>
                <div class="result-item-content">
                    <div class="result-item-path">${mainContent}</div>
                    ${contextHtml}
                </div>
            </div>
            <div class="result-item-location">
                <span class="codicon codicon-location"></span>
                ${locationText}
            </div>
        `;

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
            text += ` > ${escapeHtml(location.taskTitle)}`;
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
