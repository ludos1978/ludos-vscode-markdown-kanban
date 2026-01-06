/**
 * Search Panel JavaScript
 * Frontend logic for the Kanban Search sidebar panel
 */

(function() {
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
    let currentMode = 'broken';
    let hasActivePanel = false;
    let searchDebounceTimer = null;

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

        // Notify extension that we're ready
        vscode.postMessage({ type: 'ready' });
    }

    /**
     * Set search mode
     */
    function setMode(mode) {
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

        // Clear results when switching modes
        clearResults();
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
        Object.keys(grouped).forEach(type => {
            const group = grouped[type];
            const groupEl = createResultGroup(type, group, searchType);
            resultsList.appendChild(groupEl);
        });

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
    function createResultGroup(type, items, searchType) {
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
        items.forEach(item => {
            const itemEl = createResultItem(item, searchType);
            group.appendChild(itemEl);
        });

        return group;
    }

    /**
     * Create a result item element
     */
    function createResultItem(item, searchType) {
        const el = document.createElement('div');
        el.className = 'result-item';
        el.addEventListener('click', () => navigateToElement(item));

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
            elementPath: item.path
        });
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
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Escape regex special characters
     */
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Clear results
     */
    function clearResults() {
        resultsList.innerHTML = '';
        resultsEmpty.style.display = 'flex';
        resultsList.style.display = 'none';
        hideStatus();
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
