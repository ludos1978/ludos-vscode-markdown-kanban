/**
 * File Search Modal - Handles the file search overlay dialog
 *
 * This module provides a modal overlay for searching and selecting replacement files
 * when a broken link is detected in the kanban board.
 */

// eslint-disable-next-line no-unused-vars
const fileSearchModal = (function() {
    'use strict';

    // DOM elements
    let overlay;
    let originalPathEl;
    let brokenBadgeEl;
    let searchInputEl;
    let caseBtnEl;
    let wordBtnEl;
    let regexBtnEl;
    let resultsEl;
    let batchPanelEl;
    let batchCountEl;
    let batchListEl;
    let batchCheckboxEl;
    let batchInfoEl;
    let cancelBtnEl;
    let mediaFolderBtnEl;
    let selectBtnEl;

    // State
    let results = [];
    let selectedIndex = -1;
    let originalPath = '';
    let brokenPathData = null;
    let batchAnalysisData = null;
    let batchAnalysisCache = {};
    let isVisible = false;
    let showOpenMediaFolder = false;
    let isSearching = false;
    let currentSearchTerm = '';

    /**
     * Initialize the modal (called once on page load)
     */
    function init() {
        // Get DOM elements
        overlay = document.getElementById('file-search-overlay');
        originalPathEl = document.getElementById('file-search-original-path');
        brokenBadgeEl = document.getElementById('file-search-broken-badge');
        searchInputEl = document.getElementById('file-search-input');
        caseBtnEl = document.getElementById('file-search-case-btn');
        wordBtnEl = document.getElementById('file-search-word-btn');
        regexBtnEl = document.getElementById('file-search-regex-btn');
        resultsEl = document.getElementById('file-search-results');
        batchPanelEl = document.getElementById('file-search-batch-panel');
        batchCountEl = document.getElementById('file-search-batch-count');
        batchListEl = document.getElementById('file-search-batch-list');
        batchCheckboxEl = document.getElementById('file-search-batch-checkbox');
        batchInfoEl = document.getElementById('file-search-batch-info');
        cancelBtnEl = document.getElementById('file-search-cancel-btn');
        mediaFolderBtnEl = document.getElementById('file-search-media-folder-btn');
        selectBtnEl = document.getElementById('file-search-select-btn');

        if (!overlay) {
            console.warn('[FileSearchModal] Modal elements not found');
            return;
        }

        // Set up event listeners
        setupEventListeners();
    }

    /**
     * Set up all event listeners
     */
    function setupEventListeners() {
        // Search input
        searchInputEl.addEventListener('input', () => {
            vscode.postMessage({ type: 'fileSearchQuery', term: searchInputEl.value });
        });

        // Toggle buttons
        caseBtnEl.addEventListener('click', () => {
            vscode.postMessage({ type: 'fileSearchToggleOption', option: 'caseSensitive' });
        });
        wordBtnEl.addEventListener('click', () => {
            vscode.postMessage({ type: 'fileSearchToggleOption', option: 'wholeWord' });
        });
        regexBtnEl.addEventListener('click', () => {
            vscode.postMessage({ type: 'fileSearchToggleOption', option: 'regex' });
        });

        // Batch checkbox
        batchCheckboxEl.addEventListener('change', () => {
            updateBatchPanel();
            if (batchCheckboxEl.checked) {
                requestAllBatchAnalysis();
            }
        });

        // Buttons
        cancelBtnEl.addEventListener('click', close);
        mediaFolderBtnEl.addEventListener('click', openMediaFolder);
        selectBtnEl.addEventListener('click', selectCurrentItem);

        // Keyboard navigation
        overlay.addEventListener('keydown', handleKeydown);

        // Click outside to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close();
            }
        });
    }

    /**
     * Handle keyboard navigation
     */
    function handleKeydown(e) {
        if (!isVisible) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            selectCurrentItem();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectItem(selectedIndex + 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectItem(selectedIndex - 1);
        } else if (e.altKey && e.key === 'c') {
            e.preventDefault();
            vscode.postMessage({ type: 'fileSearchToggleOption', option: 'caseSensitive' });
        } else if (e.altKey && e.key === 'w') {
            e.preventDefault();
            vscode.postMessage({ type: 'fileSearchToggleOption', option: 'wholeWord' });
        } else if (e.altKey && e.key === 'r') {
            e.preventDefault();
            vscode.postMessage({ type: 'fileSearchToggleOption', option: 'regex' });
        }
    }

    /**
     * Show the modal with the given parameters
     * @param {string} path - The original path to search for
     * @param {string} initialSearch - Initial search term
     * @param {boolean} showMediaFolderBtn - Whether to show the "Open media folder" button
     */
    function show(path, initialSearch, showMediaFolderBtn) {
        if (!overlay) {
            init();
        }

        // Reset state
        originalPath = path;
        results = [];
        selectedIndex = -1;
        brokenPathData = null;
        batchAnalysisData = null;
        batchAnalysisCache = {};
        showOpenMediaFolder = showMediaFolderBtn || false;

        // Update UI
        originalPathEl.textContent = path;
        searchInputEl.value = initialSearch || '';
        brokenBadgeEl.textContent = 'Scanning...';
        batchCheckboxEl.checked = false;
        batchPanelEl.style.display = 'none';
        batchInfoEl.textContent = '';
        selectBtnEl.disabled = true;
        resultsEl.innerHTML = '<div class="file-search-status searching">Searching...</div>';
        mediaFolderBtnEl.style.display = showOpenMediaFolder ? '' : 'none';

        // Show modal
        isVisible = true;
        overlay.classList.add('visible');

        // Focus search input
        setTimeout(() => {
            searchInputEl.focus();
            searchInputEl.select();
        }, 50);

        // Request initial search and broken path scan
        vscode.postMessage({ type: 'fileSearchQuery', term: searchInputEl.value });
        vscode.postMessage({ type: 'fileSearchScanBrokenPath' });
    }

    /**
     * Close the modal
     */
    function close() {
        isVisible = false;
        overlay.classList.remove('visible');
        vscode.postMessage({ type: 'fileSearchCancelled' });
    }

    /**
     * Open media folder (does not close the modal)
     */
    function openMediaFolder() {
        vscode.postMessage({ type: 'openMediaFolder' });
    }

    /**
     * Select the current item
     */
    function selectCurrentItem() {
        if (selectedIndex >= 0 && results[selectedIndex]) {
            isVisible = false;
            overlay.classList.remove('visible');
            vscode.postMessage({
                type: 'fileSearchSelected',
                path: results[selectedIndex].fullPath,
                batchReplace: batchCheckboxEl.checked
            });
        }
    }

    /**
     * Select item by index
     */
    function selectItem(index) {
        if (results.length === 0) return;

        // Clamp index
        if (index < 0) index = 0;
        if (index >= results.length) index = results.length - 1;

        selectedIndex = index;
        renderResults();
        updateBatchInfo();

        // Request preview
        if (results[index]) {
            vscode.postMessage({ type: 'fileSearchPreview', path: results[index].fullPath });
        }

        // Scroll into view
        const rows = resultsEl.querySelectorAll('tr[data-index]');
        if (rows[index]) {
            rows[index].scrollIntoView({ block: 'nearest' });
        }

        selectBtnEl.disabled = selectedIndex < 0;

        // Trigger batch analysis if checkbox is checked
        if (batchCheckboxEl.checked) {
            requestBatchAnalysis();
        }
    }

    /**
     * Handle click on result row
     */
    function handleRowClick(index) {
        selectItem(index);
    }

    /**
     * Handle double click on result row
     */
    function handleRowDblClick(index) {
        selectedIndex = index;
        selectCurrentItem();
    }

    /**
     * Get directory from full path (without trailing slash)
     */
    function getDir(fullPath) {
        const sep = fullPath.includes('/') ? '/' : '\\';
        const lastSep = fullPath.lastIndexOf(sep);
        return lastSep >= 0 ? fullPath.substring(0, lastSep) : fullPath;
    }

    /**
     * Request batch analysis for current selection
     */
    function requestBatchAnalysis() {
        if (selectedIndex >= 0 && results[selectedIndex] && batchCheckboxEl.checked) {
            const selectedPath = results[selectedIndex].fullPath;
            const newDir = getDir(selectedPath);

            // Check cache first
            if (batchAnalysisCache[newDir]) {
                batchAnalysisData = batchAnalysisCache[newDir];
                renderBatchFilesList();
                renderResults();
                updateBatchInfo();
                return;
            }

            // Request from extension
            vscode.postMessage({
                type: 'fileSearchAnalyzeBatch',
                selectedPath: selectedPath
            });
        }
    }

    /**
     * Request batch analysis for all unique directories in results
     */
    function requestAllBatchAnalysis() {
        if (!batchCheckboxEl.checked || results.length === 0) return;
        const dirs = new Set();
        results.forEach(r => {
            const dir = getDir(r.fullPath);
            if (!batchAnalysisCache[dir]) dirs.add(dir);
        });
        dirs.forEach(dir => {
            const file = results.find(r => getDir(r.fullPath) === dir);
            if (file) vscode.postMessage({ type: 'fileSearchAnalyzeBatch', selectedPath: file.fullPath });
        });
    }

    /**
     * Update batch panel visibility
     */
    function updateBatchPanel() {
        if (batchCheckboxEl.checked && brokenPathData && brokenPathData.files) {
            batchPanelEl.style.display = 'block';
            batchCountEl.textContent = brokenPathData.files.length + ' unique files';
            renderBatchFilesList();
        } else {
            batchPanelEl.style.display = 'none';
        }
        renderResults();
    }

    /**
     * Update batch info text
     */
    function updateBatchInfo() {
        if (!batchCheckboxEl.checked) {
            batchInfoEl.textContent = '';
            return;
        }

        if (selectedIndex >= 0 && results[selectedIndex]) {
            const selectedPath = results[selectedIndex].fullPath;
            const newDir = getDir(selectedPath);

            if (batchAnalysisCache[newDir] && !batchAnalysisCache[newDir].scanning) {
                const analysis = batchAnalysisCache[newDir];
                batchInfoEl.textContent = analysis.canReplace + ' files can be replaced' +
                    (analysis.missing > 0 ? ', ' + analysis.missing + ' missing' : '');
            } else if (batchAnalysisData && batchAnalysisData.newDir === newDir) {
                const scanningIndicator = batchAnalysisData.scanning ? ' ⏳' : '';
                batchInfoEl.textContent = batchAnalysisData.canReplace + ' files can be replaced' +
                    (batchAnalysisData.missing > 0 ? ', ' + batchAnalysisData.missing + ' missing' : '') +
                    scanningIndicator;
            } else {
                batchInfoEl.textContent = 'Analyzing...';
            }
        } else {
            batchInfoEl.textContent = 'Select a file to see batch info';
        }
    }

    /**
     * Update broken path count display
     */
    function updateBrokenCountDisplay() {
        if (brokenPathData) {
            const scanningIndicator = brokenPathData.scanning ? ' ⏳' : '';
            brokenBadgeEl.textContent = brokenPathData.uniqueFiles + ' files with this path' + scanningIndicator;
        }
    }

    /**
     * Render the batch files list
     */
    function renderBatchFilesList() {
        if (!brokenPathData || !brokenPathData.files) return;

        const files = brokenPathData.files;
        let html = '';

        files.forEach(filename => {
            let className = 'file-search-batch-item';
            if (batchAnalysisData) {
                if (batchAnalysisData.filesCanReplace && batchAnalysisData.filesCanReplace.includes(filename)) {
                    className += ' can-replace';
                } else if (batchAnalysisData.filesMissing && batchAnalysisData.filesMissing.includes(filename)) {
                    className += ' cannot-replace';
                }
            }
            html += '<span class="' + className + '">' + escapeHtml(filename) + '</span>';
        });

        batchListEl.innerHTML = html;
    }

    /**
     * Render the results table
     */
    function renderResults() {
        if (results.length === 0) {
            if (isSearching) {
                resultsEl.innerHTML = '<div class="file-search-status searching">Searching...</div>';
            } else {
                resultsEl.innerHTML = '<div class="file-search-status">No results found</div>';
            }
            selectBtnEl.disabled = true;
            return;
        }

        const showBatchColumn = batchCheckboxEl.checked;

        // Show streaming indicator in header if still searching
        const streamingIndicator = isSearching ? ' <span class="streaming-indicator">⏳</span>' : '';

        let html = '<table class="file-search-table"><thead><tr>';
        html += '<th>Filename' + streamingIndicator + '</th>';
        html += '<th>Path (' + results.length + ' found)</th>';
        if (showBatchColumn) {
            html += '<th style="width: 120px;">Files Found</th>';
        }
        html += '</tr></thead><tbody>';

        results.forEach((r, i) => {
            const isSelected = i === selectedIndex;
            html += '<tr class="' + (isSelected ? 'selected' : '') + '" data-index="' + i + '">';
            html += '<td><div class="file-search-result-label">' + escapeHtml(r.label) + '</div></td>';
            html += '<td><div class="file-search-result-path">' + escapeHtml(r.fullPath) + '</div></td>';

            if (showBatchColumn) {
                const resultDir = getDir(r.fullPath);

                if (batchAnalysisCache[resultDir] && !batchAnalysisCache[resultDir].scanning) {
                    const analysis = batchAnalysisCache[resultDir];
                    html += '<td class="file-search-batch-count">';
                    html += '<span class="found">' + analysis.canReplace + ' ✓</span>';
                    if (analysis.missing > 0) {
                        html += ' <span class="missing">' + analysis.missing + ' ✗</span>';
                    }
                    html += '</td>';
                } else if (isSelected && batchAnalysisData) {
                    html += '<td class="file-search-batch-count">';
                    html += '<span class="found">' + batchAnalysisData.canReplace + ' ✓</span>';
                    if (batchAnalysisData.missing > 0) {
                        html += ' <span class="missing">' + batchAnalysisData.missing + ' ✗</span>';
                    }
                    html += '</td>';
                } else {
                    html += '<td class="file-search-batch-count"><span class="scanning">—</span></td>';
                }
            }

            html += '</tr>';
        });

        html += '</tbody></table>';
        resultsEl.innerHTML = html;

        // Add click handlers
        resultsEl.querySelectorAll('tr[data-index]').forEach(row => {
            const index = parseInt(row.getAttribute('data-index'), 10);
            row.addEventListener('click', () => handleRowClick(index));
            row.addEventListener('dblclick', () => handleRowDblClick(index));
        });
    }

    /**
     * Escape HTML entities
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Update the search status display during streaming
     */
    function updateSearchStatus() {
        if (isSearching) {
            const count = results.length;
            if (count === 0) {
                resultsEl.innerHTML = '<div class="file-search-status searching">Searching...</div>';
            } else {
                // Results are shown in table, but we could show count in a header
                // The table is already rendered, just ensure it shows
            }
        }
    }

    /**
     * Handle messages from the extension
     */
    function handleMessage(message) {
        console.log('[FileSearchModal] Received message:', message.type);
        switch (message.type) {
            case 'fileSearchShow':
                console.log('[FileSearchModal] Received fileSearchShow');
                show(message.originalPath, message.initialSearch, message.showOpenMediaFolder);
                break;

            case 'fileSearchSearching':
                console.log('[FileSearchModal] Received fileSearchSearching');
                // New search starting - reset state
                results = [];
                selectedIndex = -1;
                isSearching = true;
                currentSearchTerm = '';
                resultsEl.innerHTML = '<div class="file-search-status searching">Searching...</div>';
                selectBtnEl.disabled = true;
                break;

            case 'fileSearchResultsBatch':
                console.log('[FileSearchModal] Received fileSearchResultsBatch with', message.results?.length, 'results, term:', message.term);
                // Streaming: append new results
                if (message.term !== currentSearchTerm) {
                    console.log('[FileSearchModal] New term, resetting. Old:', currentSearchTerm, 'New:', message.term);
                    // New search term - reset results
                    results = [];
                    currentSearchTerm = message.term;
                }
                // Append new results
                results = results.concat(message.results);
                console.log('[FileSearchModal] Total results now:', results.length);
                // Auto-select first result if none selected
                if (selectedIndex < 0 && results.length > 0) {
                    selectedIndex = 0;
                    vscode.postMessage({ type: 'fileSearchPreview', path: results[0].fullPath });
                }
                renderResults();
                selectBtnEl.disabled = selectedIndex < 0;
                break;

            case 'fileSearchComplete':
                // Search finished
                isSearching = false;
                if (results.length === 0) {
                    resultsEl.innerHTML = '<div class="file-search-status">No results found</div>';
                } else {
                    // Re-render to remove streaming indicator
                    renderResults();
                }
                selectBtnEl.disabled = selectedIndex < 0;
                if (batchCheckboxEl.checked) {
                    requestAllBatchAnalysis();
                }
                break;

            case 'fileSearchResults':
                // Legacy: full results in one message (backward compatibility)
                results = message.results;
                selectedIndex = results.length > 0 ? 0 : -1;
                isSearching = false;
                renderResults();
                if (selectedIndex >= 0) {
                    vscode.postMessage({ type: 'fileSearchPreview', path: results[0].fullPath });
                }
                selectBtnEl.disabled = selectedIndex < 0;
                if (batchCheckboxEl.checked) {
                    requestAllBatchAnalysis();
                }
                break;

            case 'fileSearchOptionsUpdated':
                caseBtnEl.classList.toggle('active', message.caseSensitive);
                wordBtnEl.classList.toggle('active', message.wholeWord);
                regexBtnEl.classList.toggle('active', message.regex);
                // Re-trigger search
                vscode.postMessage({ type: 'fileSearchQuery', term: searchInputEl.value });
                break;

            case 'fileSearchBrokenPathCount':
                brokenPathData = message;
                updateBrokenCountDisplay();
                if (batchCheckboxEl.checked) {
                    updateBatchPanel();
                }
                break;

            case 'fileSearchBatchAnalysis':
                batchAnalysisData = message;
                // Only cache completed scans
                if (message.newDir && !message.scanning) {
                    batchAnalysisCache[message.newDir] = message;
                }
                renderBatchFilesList();
                renderResults();
                updateBatchInfo();
                break;
        }
    }

    // Public API
    return {
        init: init,
        show: show,
        close: close,
        handleMessage: handleMessage,
        isVisible: function() { return isVisible; }
    };
})();

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => fileSearchModal.init());
} else {
    fileSearchModal.init();
}
