/**
 * Debug overlay system for tracking file states and conflict management
 */

// Debug overlay state
let debugOverlayVisible = false;
let debugOverlayElement = null;
let trackedFilesData = {};
let lastTrackedFilesDataHash = null;
let refreshCount = 0;
let debugOverlaySticky = false; // New: sticky/pin state

// Hover behavior state
let hoverShowTimer = null;
let hoverHideTimer = null;
let autoRefreshTimer = null;
const HOVER_SHOW_DELAY = 500; // ms
const HOVER_HIDE_DELAY = 300; // ms

/**
 * Create and show the debug overlay
 */
function showDebugOverlay() {

    if (debugOverlayElement) {
        debugOverlayElement.remove();
    }

    // Check if vscode is available
    if (typeof window.vscode === 'undefined') {
        console.error('[DebugOverlay] vscode API not available, cannot request debug info');
        alert('Debug overlay error: vscode API not available');
        return;
    }

    // Request current file tracking state from backend
    window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });

    // Create overlay element
    debugOverlayElement = document.createElement('div');
    debugOverlayElement.id = 'debug-overlay';
    debugOverlayElement.innerHTML = createDebugOverlayContent();

    // Add to DOM
    document.body.appendChild(debugOverlayElement);

    debugOverlayVisible = true;

    // Request initial data
    if (window.vscode) {
        window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });
    }

    // Handle mouse interactions with the overlay
    debugOverlayElement.addEventListener('mouseenter', () => {
        // Cancel hide timer when mouse enters overlay
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
    });

    debugOverlayElement.addEventListener('mouseleave', () => {
        // Only hide overlay when mouse leaves if not sticky
        if (!debugOverlaySticky) {
            hideDebugOverlayDelayed();
        }
    });

    // Close on click outside
    debugOverlayElement.addEventListener('click', (e) => {
        if (e.target === debugOverlayElement) {
            hideDebugOverlay();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && debugOverlayVisible) {
            hideDebugOverlay();
        }
    });

    debugOverlayVisible = true;

    // Start auto-refresh when overlay is visible
    startAutoRefresh();

    // Auto-verify content sync on open (silent mode)
    verifyContentSync(true);

}

/**
 * Hide and remove the debug overlay
 */
function hideDebugOverlay() {
    // When explicitly closed, clear sticky state too
    debugOverlaySticky = false;

    // Stop auto-refresh
    stopAutoRefresh();

    if (debugOverlayElement) {
        debugOverlayElement.remove();
        debugOverlayElement = null;
    }
    debugOverlayVisible = false;
}

/**
 * Schedule showing the debug overlay after hover delay
 */
function scheduleDebugOverlayShow() {
    // Cancel any pending hide
    if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
    }

    // If already visible, don't schedule again
    if (debugOverlayVisible) {
        return;
    }

    // Schedule show after delay
    if (!hoverShowTimer) {
        hoverShowTimer = setTimeout(() => {
            showDebugOverlay();
            hoverShowTimer = null;
        }, HOVER_SHOW_DELAY);
    }
}

/**
 * Cancel scheduled debug overlay show
 */
function cancelDebugOverlayShow() {
    if (hoverShowTimer) {
        clearTimeout(hoverShowTimer);
        hoverShowTimer = null;
    }
}

/**
 * Hide debug overlay with delay
 */
function hideDebugOverlayDelayed() {
    // Don't hide if sticky mode is enabled
    if (debugOverlaySticky) {
        return;
    }

    // Don't hide if mouse is over the overlay itself
    if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
    }

    hoverHideTimer = setTimeout(() => {
        hideDebugOverlay();
        hoverHideTimer = null;
    }, HOVER_HIDE_DELAY);
}

/**
 * Update the debug overlay with fresh data
 */
function refreshDebugOverlay() {

    if (!debugOverlayVisible || !debugOverlayElement) {
        return;
    }

    refreshCount++;

    // Only request new data if we don't have recent data
    if (window.vscode) {
        window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });
    }

    // Don't rebuild DOM here - let updateTrackedFilesData handle it
}

/**
 * Toggle sticky/pin state of debug overlay
 */
function toggleDebugOverlaySticky() {
    debugOverlaySticky = !debugOverlaySticky;

    // Update the pin button appearance
    const pinButton = debugOverlayElement?.querySelector('.debug-pin-btn');
    if (pinButton) {
        pinButton.textContent = debugOverlaySticky ? '📌 Pinned' : '📌 Pin';
    }
}

/**
 * Start auto-refresh timer for sticky mode
 */
function startAutoRefresh() {
    // Clear existing timer
    stopAutoRefresh();

    // Only start timer if overlay is actually visible or sticky
    if (!debugOverlayVisible && !debugOverlaySticky) {
        return;
    }

    // Start new auto-refresh timer (refresh every 5 seconds, less frequent)
    autoRefreshTimer = setInterval(() => {
        if (debugOverlayVisible && (debugOverlaySticky || document.querySelector('#debug-overlay:hover'))) {
            refreshDebugOverlay();
        } else {
            // Stop timer if overlay is no longer visible
            stopAutoRefresh();
        }
    }, 5000);

}

/**
 * Stop auto-refresh timer
 */
function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

/**
 * Create a simple hash of the data to detect changes
 */
function createDataHash(data) {
    try {
        return JSON.stringify(data).replace(/\s/g, '');
    } catch (error) {
        return Math.random().toString();
    }
}

/**
 * Update tracked files data from backend
 */
function updateTrackedFilesData(data) {

    // ENHANCED DEBUG: Show main file state specifically
    if (data && data.watcherDetails) {
    }

    const newDataHash = createDataHash(data);

    // Only update if data actually changed
    if (newDataHash === lastTrackedFilesDataHash) {
        return;
    }

    lastTrackedFilesDataHash = newDataHash;
    trackedFilesData = data;

    if (debugOverlayVisible && debugOverlayElement) {
        // Only update the content, preserve scroll position
        updateFileStatesContent();
    }
}

/**
 * Update only the content without rebuilding the entire DOM
 */
function updateFileStatesContent() {

    if (!debugOverlayElement) {
        return;
    }

    // Batch DOM updates to reduce reflow
    requestAnimationFrame(() => {
        const allFiles = createAllFilesArray();

        // Update summary stats (includes timestamp now)
        const summaryElement = debugOverlayElement.querySelector('.file-states-summary');
        if (summaryElement) {
            const newSummaryHTML = createFileStatesSummary(allFiles);
            if (summaryElement.innerHTML !== newSummaryHTML) {
                summaryElement.innerHTML = newSummaryHTML;
            }
        }

        // Update file list (only if content changed)
        const listElement = debugOverlayElement.querySelector('.file-states-list');
        if (listElement) {
            const newListHTML = createFileStatesList(allFiles);
            const htmlChanged = listElement.innerHTML !== newListHTML;
            if (htmlChanged) {
                listElement.innerHTML = newListHTML;
            }
        }
    });
}

/**
 * Create the HTML content for the debug overlay
 */
function createDebugOverlayContent() {
    return `
        <div class="debug-panel">
            <div class="debug-header">
                <h3>ⓘ File States Overview</h3>
                <div class="debug-controls">
                    <button onclick="toggleDebugOverlaySticky()" class="debug-btn debug-pin-btn">
                        📌 Pin
                    </button>
                    <button onclick="hideDebugOverlay()" class="debug-close">
                        ✕
                    </button>
                </div>
            </div>
            <div class="debug-content">
                ${createFileStatesContent()}
            </div>
        </div>
    `;
}

/**
 * Create the main debug content
 */
function createFileStatesContent() {
    const allFiles = createAllFilesArray();

    return `
        <div class="file-states-section">
            <div class="file-states-summary">
                ${createFileStatesSummary(allFiles)}
            </div>
            <div class="file-states-list">
                ${createFileStatesList(allFiles)}
            </div>
        </div>
    `;
}

/**
 * Create file watcher status section
 */
function createFileWatcherSection() {
    const mainFile = trackedFilesData.mainFile || 'Unknown';
    const watcherActive = trackedFilesData.fileWatcherActive !== false;
    const mainFileInfo = trackedFilesData.watcherDetails || {};
    const hasInternalChanges = mainFileInfo.hasInternalChanges || false;
    const hasExternalChanges = mainFileInfo.hasExternalChanges || false;

    return `
        <div class="debug-group">
            <h4>📄 Main File Tracking</h4>
            <div class="debug-item">
                <span class="debug-label">File:</span>
                <span class="debug-value file-path" title="${mainFile}">
                    ${mainFile ? mainFile.split('/').pop() : 'None'}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Watcher:</span>
                <span class="debug-value ${watcherActive ? 'status-good' : 'status-bad'}">
                    ${watcherActive ? '✅ Active' : '❌ Inactive'}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Internal Changes:</span>
                <span class="debug-value ${hasInternalChanges ? 'status-warn' : 'status-good'}">
                    ${hasInternalChanges ? '🟡 Modified' : '🟢 Saved'}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">External Changes:</span>
                <span class="debug-value ${hasExternalChanges ? 'status-warn' : 'status-good'}">
                    ${hasExternalChanges ? '🔄 Externally Modified' : '🟢 In Sync'}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Document Version:</span>
                <span class="debug-value">
                    ${mainFileInfo.documentVersion || 0} (Last: ${mainFileInfo.lastDocumentVersion || -1})
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Last Modified:</span>
                <span class="debug-value">
                    ${trackedFilesData.mainFileLastModified || 'Unknown'}
                </span>
            </div>
        </div>
    `;
}

/**
 * Create external file watcher section
 */
function createExternalFileWatcherSection() {
    const watchers = trackedFilesData.externalWatchers || [];

    return `
        <div class="debug-group">
            <h4>🔍 External File Watchers</h4>
            <div class="debug-item">
                <span class="debug-label">Total Watchers:</span>
                <span class="debug-value">${watchers.length}</span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Status:</span>
                <span class="debug-value ${watchers.length > 0 ? 'status-good' : 'status-warn'}">
                    ${watchers.length > 0 ? '✅ Monitoring' : '⚠️ No watchers'}
                </span>
            </div>
            <div class="watcher-list">
                ${watchers.map(w => `
                    <div class="watcher-item">
                        <span class="watcher-file" title="${w.path}">${w.path.split('/').pop()}</span>
                        <span class="watcher-type ${w.type}">${w.type}</span>
                        <span class="watcher-status ${w.active ? 'active' : 'inactive'}">
                            ${w.active ? '🟢' : '🔴'}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Create conflict manager section
 */
function createConflictManagerSection() {
    const conflicts = trackedFilesData.conflictManager || {};

    return `
        <div class="debug-group">
            <h4>⚡ Conflict Management</h4>
            <div class="debug-item">
                <span class="debug-label">System Status:</span>
                <span class="debug-value ${conflicts.healthy ? 'status-good' : 'status-bad'}">
                    ${conflicts.healthy ? '✅ Healthy' : '❌ Issues Detected'}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Tracked Files:</span>
                <span class="debug-value">${conflicts.trackedFiles || 0}</span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Pending Conflicts:</span>
                <span class="debug-value ${(conflicts.pendingConflicts || 0) > 0 ? 'status-warn' : 'status-good'}">
                    ${conflicts.pendingConflicts || 0}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Watcher Failures:</span>
                <span class="debug-value ${(conflicts.watcherFailures || 0) > 0 ? 'status-bad' : 'status-good'}">
                    ${conflicts.watcherFailures || 0}
                </span>
            </div>
        </div>
    `;
}

/**
 * Create include files section
 */
function createIncludeFilesSection() {
    const includeFiles = trackedFilesData.includeFiles || [];
    const internalChangesCount = includeFiles.filter(f => f.hasInternalChanges).length;
    const externalChangesCount = includeFiles.filter(f => f.hasExternalChanges).length;

    return `
        <div class="debug-group">
            <h4>📎 Include Files</h4>
            <div class="debug-item">
                <span class="debug-label">Total Includes:</span>
                <span class="debug-value">${includeFiles.length}</span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Internal:</span>
                <span class="debug-value ${internalChangesCount > 0 ? 'status-warn' : 'status-good'}">
                    ${internalChangesCount > 0 ? `🟡 ${internalChangesCount} Modified` : '🟢 All Saved'}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">External:</span>
                <span class="debug-value ${externalChangesCount > 0 ? 'status-warn' : 'status-good'}">
                    ${externalChangesCount > 0 ? `🔄 ${externalChangesCount} Externally Modified` : '🟢 All In Sync'}
                </span>
            </div>
            <div class="debug-controls" style="margin: 8px 0;">
                <button onclick="reloadAllIncludedFiles()" class="debug-btn" style="width: 100%;">
                    🔄 Reload All Included Files (Images, Videos, Includes)
                </button>
            </div>
            <div class="include-list">
                ${includeFiles.map(file => `
                    <div class="include-item">
                        <div class="include-header">
                            <span class="include-file" title="${file.path}">${file.path.split('/').pop()}</span>
                            <span class="include-type ${file.type}">${
                                file.type === 'regular' || file.type === 'include-regular' ? 'REGULAR' :
                                file.type === 'column' || file.type === 'include-column' ? 'COLUMN' :
                                file.type === 'task' || file.type === 'include-task' ? 'TASK' :
                                file.type
                            }</span>
                            <span class="include-status ${file.exists ? 'exists' : 'missing'}">
                                ${file.exists ? '📄' : '❌'}
                            </span>
                        </div>
                        <div class="include-details">
                            <span class="detail-item">Modified: ${file.lastModified || 'Unknown'}</span>
                            <span class="detail-item">
                                Content: ${file.contentLength || 0} chars
                                ${file.baselineLength > 0 ? `(Baseline: ${file.baselineLength})` : ''}
                            </span>
                            <span class="detail-item ${file.hasInternalChanges ? 'status-warn' : 'status-good'}">
                                Internal: ${file.hasInternalChanges ? '🟡 Modified' : '🟢 Saved'}
                            </span>
                            <span class="detail-item ${file.hasExternalChanges ? 'status-warn' : 'status-good'}">
                                External: ${file.hasExternalChanges ? '🔄 Changed' : '🟢 In Sync'}
                            </span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Create pending changes section
 */
function createPendingChangesSection() {
    const columnChanges = window.pendingColumnChanges?.size || 0;
    const taskChanges = window.pendingTaskChanges?.size || 0;
    const totalChanges = columnChanges + taskChanges;

    return `
        <div class="debug-group">
            <h4>💾 Pending Changes</h4>
            <div class="debug-item">
                <span class="debug-label">Total Pending:</span>
                <span class="debug-value ${totalChanges > 0 ? 'status-warn' : 'status-good'}">
                    ${totalChanges}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Column Changes:</span>
                <span class="debug-value">${columnChanges}</span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Task Changes:</span>
                <span class="debug-value">${taskChanges}</span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Unsaved Status:</span>
                <span class="debug-value ${trackedFilesData.hasUnsavedChanges ? 'status-warn' : 'status-good'}">
                    ${trackedFilesData.hasUnsavedChanges ? '🟡 Has Unsaved' : '🟢 All Saved'}
                </span>
            </div>
        </div>
    `;
}

/**
 * Create system health section
 */
function createSystemHealthSection() {
    const health = trackedFilesData.systemHealth || {};

    return `
        <div class="debug-group">
            <h4>🏥 System Health</h4>
            <div class="debug-item">
                <span class="debug-label">Overall Status:</span>
                <span class="debug-value ${health.overall || 'status-unknown'}">
                    ${health.overall === 'good' ? '✅ Good' :
                      health.overall === 'warn' ? '⚠️ Warning' :
                      health.overall === 'bad' ? '❌ Critical' : '❓ Unknown'}
                </span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Extension State:</span>
                <span class="debug-value">${health.extensionState || 'Unknown'}</span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Memory Usage:</span>
                <span class="debug-value">${health.memoryUsage || 'Unknown'}</span>
            </div>
            <div class="debug-item">
                <span class="debug-label">Last Error:</span>
                <span class="debug-value ${health.lastError ? 'status-bad' : 'status-good'}">
                    ${health.lastError || 'None'}
                </span>
            </div>
        </div>
    `;
}

/**
 * Get short label for include type (for path line)
 */
function getIncludeTypeShortLabel(fileType) {
    let result;
    switch (fileType) {
        case 'include-regular':
        case 'regular':
            result = 'include';
            break;
        case 'include-column':
        case 'column':
            result = 'colinc';
            break;
        case 'include-task':
        case 'task':
            result = 'taskinc';
            break;
        default:
            result = 'include'; // default fallback
            break;
    }
    return result;
}

/**
 * Get user-friendly label for include type
 */
function getIncludeTypeLabel(fileType) {
    switch (fileType) {
        case 'include-regular':
        case 'regular':
            return 'inline';
        case 'include-column':
        case 'column':
            return 'column';
        case 'include-task':
        case 'task':
            return 'task';
        default:
            return 'inline'; // default fallback
    }
}

/**
 * Get description for include type
 */
function getIncludeTypeDescription(fileType) {
    switch (fileType) {
        case 'include-regular':
        case 'regular':
            return 'Regular include (!!!include()) - read-only content insertion';
        case 'include-column':
        case 'column':
            return 'Column include (!!!include() in column header) - bidirectional sync for column tasks';
        case 'include-task':
        case 'task':
            return 'Task include (!!!include() in task title) - bidirectional sync for individual tasks';
        default:
            return 'Regular include (!!!include() in task description) - inline content display';
    }
}

/**
 * Create array of all files (main + included) with their states
 */
function createAllFilesArray() {
    const allFiles = [];

    // Add main file
    const mainFile = trackedFilesData.mainFile || 'Unknown';
    const mainFileInfo = trackedFilesData.watcherDetails || {};


    const mainFileData = {
        path: mainFile,
        relativePath: mainFile ? mainFile.split('/').pop() : 'Unknown', // Just filename for main file
        name: mainFile ? mainFile.split('/').pop() : 'Unknown',
        type: 'main',
        isMainFile: true,
        exists: true,
        hasInternalChanges: mainFileInfo.hasInternalChanges || false,
        hasExternalChanges: mainFileInfo.hasExternalChanges || false,
        documentVersion: mainFileInfo.documentVersion || 0,
        lastDocumentVersion: mainFileInfo.lastDocumentVersion || -1,
        isUnsavedInEditor: mainFileInfo.isUnsavedInEditor || false,
        lastModified: trackedFilesData.mainFileLastModified || 'Unknown'
    };

    allFiles.push(mainFileData);

    // Add include files
    const includeFiles = trackedFilesData.includeFiles || [];

    includeFiles.forEach(file => {

        allFiles.push({
            path: file.path,
            relativePath: file.path, // Use the path from backend directly (it's already relative for includes)
            name: file.path.split('/').pop(),
            type: file.type || 'include',
            isMainFile: false,
            exists: file.exists !== false,
            hasInternalChanges: file.hasInternalChanges || false,
            hasExternalChanges: file.hasExternalChanges || false,
            isUnsavedInEditor: file.isUnsavedInEditor || false,
            contentLength: file.contentLength || 0,
            baselineLength: file.baselineLength || 0,
            lastModified: file.lastModified || 'Unknown'
        });
    });

    return allFiles;
}

/**
 * Create summary of file states
 */
function createFileStatesSummary(allFiles) {
    const totalFiles = allFiles.length;
    const internalChanges = allFiles.filter(f => f.hasInternalChanges).length;
    const externalChanges = allFiles.filter(f => f.hasExternalChanges).length;
    const bothChanges = allFiles.filter(f => f.hasInternalChanges && f.hasExternalChanges).length;
    const cleanFiles = allFiles.filter(f => !f.hasInternalChanges && !f.hasExternalChanges).length;
    const now = new Date().toLocaleTimeString();

    return `
        <div class="file-states-stats">
            <div class="stat-group">
                <div class="stat-item">
                    <span class="stat-label">Total Files:</span>
                    <span class="stat-value">${totalFiles}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Clean:</span>
                    <span class="stat-value ${cleanFiles > 0 ? 'status-good' : 'status-unknown'}">${cleanFiles}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Internal Changes:</span>
                    <span class="stat-value ${internalChanges > 0 ? 'status-warn' : 'status-good'}">${internalChanges}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">External Changes:</span>
                    <span class="stat-value ${externalChanges > 0 ? 'status-warn' : 'status-good'}">${externalChanges}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Both:</span>
                    <span class="stat-value ${bothChanges > 0 ? 'status-bad' : 'status-good'}">${bothChanges}</span>
                </div>
            </div>
            <div class="debug-timestamp">Updated: ${now}</div>
        </div>
    `;
}

/**
 * Truncate path to specified length with ellipsis
 */
function truncatePath(path, maxLength = 10) {
    if (!path || path.length <= maxLength) {
        return path;
    }
    return path.substring(0, maxLength) + '...';
}

/**
 * Get sync status for a file from last verification results
 */
function getFileSyncStatus(filePath) {
    if (!lastVerificationResults || !lastVerificationResults.fileResults) {
        return null;
    }

    // Normalize path for comparison (remove ./ prefix and get basename for main files)
    const normalizedInputPath = filePath.replace(/^\.\//, '');
    const inputBasename = filePath.split('/').pop();

    return lastVerificationResults.fileResults.find(f => {
        const resultPath = f.path.replace(/^\.\//, '');
        const resultBasename = f.path.split('/').pop();

        // Try multiple matching strategies:
        // 1. Exact match on normalized paths
        // 2. Match on basenames (for main file which might be full path vs filename)
        // 3. Match if input path ends with result path (for absolute vs relative)
        return resultPath === normalizedInputPath ||
               resultBasename === inputBasename ||
               normalizedInputPath.endsWith(resultPath);
    });
}

/**
 * Toggle sync details section visibility
 */
function toggleSyncDetails() {
    syncDetailsExpanded = !syncDetailsExpanded;
    updateFileStatesContent();
}

/**
 * Create the sync details collapsible section
 */
function createSyncDetailsSection() {
    if (!lastVerificationResults) {
        return `
            <div class="sync-details-section collapsed">
                <div class="sync-details-header" onclick="toggleSyncDetails()">
                    <span class="sync-details-toggle">▶</span>
                    <span class="sync-details-title">🔍 Sync Verification Details</span>
                    <span class="sync-details-hint">(Not run yet - click Verify Sync button)</span>
                </div>
            </div>
        `;
    }

    const toggleIcon = syncDetailsExpanded ? '▼' : '▶';
    const contentClass = syncDetailsExpanded ? 'expanded' : 'collapsed';
    const timestamp = new Date(lastVerificationResults.timestamp).toLocaleString();

    const detailsContent = syncDetailsExpanded ? `
        <div class="sync-details-content">
            <div class="sync-details-summary">
                <div class="sync-stat">
                    <span class="sync-stat-label">Total Files:</span>
                    <span class="sync-stat-value">${lastVerificationResults.totalFiles}</span>
                </div>
                <div class="sync-stat sync-stat-good">
                    <span class="sync-stat-label">✅ Matching:</span>
                    <span class="sync-stat-value">${lastVerificationResults.matchingFiles}</span>
                </div>
                <div class="sync-stat ${lastVerificationResults.mismatchedFiles > 0 ? 'sync-stat-warn' : ''}">
                    <span class="sync-stat-label">⚠️ Mismatched:</span>
                    <span class="sync-stat-value">${lastVerificationResults.mismatchedFiles}</span>
                </div>
                <div class="sync-stat-timestamp">
                    Last verified: ${timestamp}
                </div>
            </div>
            <div class="sync-details-note">
                <strong>Frontend is the baseline</strong> - comparing Frontend → Backend and Frontend → Saved File
            </div>
            <div class="sync-details-files">
                ${lastVerificationResults.fileResults.map(file => {
                    const backendMatch = file.frontendBackendMatch;
                    const savedMatch = file.savedHash ? file.frontendSavedMatch : null;
                    const allMatch = backendMatch && (savedMatch === null || savedMatch);

                    return `
                    <div class="sync-file-detail ${allMatch ? 'sync-match' : 'sync-mismatch'}">
                        <div class="sync-file-header">
                            <span class="sync-file-icon">${allMatch ? '✅' : '⚠️'}</span>
                            <span class="sync-file-name" title="${file.path}">${file.relativePath}</span>
                        </div>
                        <div class="sync-file-stats">
                            <div class="sync-file-stat baseline-stat">
                                <span class="sync-file-stat-label">📋 Frontend (Baseline):</span>
                                <span class="sync-file-stat-value">${file.frontendHash} (${file.frontendContentLength} chars)</span>
                            </div>
                            <div class="sync-file-stat">
                                <span class="sync-file-stat-label">Backend:</span>
                                <span class="sync-file-stat-value ${backendMatch ? 'sync-match-indicator' : 'sync-mismatch-indicator'}">
                                    ${file.backendHash} (${file.backendContentLength} chars)
                                    ${backendMatch ? '✅ synced' : `⚠️ differs by ${file.frontendBackendDiff} chars`}
                                </span>
                            </div>
                            ${file.savedHash ? `
                                <div class="sync-file-stat">
                                    <span class="sync-file-stat-label">Saved File:</span>
                                    <span class="sync-file-stat-value ${savedMatch ? 'sync-match-indicator' : 'sync-mismatch-indicator'}">
                                        ${file.savedHash} (${file.savedContentLength} chars)
                                        ${savedMatch ? '✅ synced' : `⚠️ differs by ${file.frontendSavedDiff} chars`}
                                    </span>
                                </div>
                            ` : '<div class="sync-file-stat"><span class="sync-file-stat-label">Saved File:</span><span class="sync-file-stat-value sync-unknown-indicator">Not available</span></div>'}
                        </div>
                    </div>
                `}).join('')}
            </div>
        </div>
    ` : '';

    return `
        <div class="sync-details-section ${contentClass}">
            <div class="sync-details-header" onclick="toggleSyncDetails()">
                <span class="sync-details-toggle">${toggleIcon}</span>
                <span class="sync-details-title">🔍 Sync Verification Details</span>
                <span class="sync-details-status ${lastVerificationResults.mismatchedFiles > 0 ? 'status-warn' : 'status-good'}">
                    ${lastVerificationResults.matchingFiles} match, ${lastVerificationResults.mismatchedFiles} differ
                </span>
            </div>
            ${detailsContent}
        </div>
    `;
}

/**
 * Create list of all files with their states and action buttons
 */
function createFileStatesList(allFiles) {
    return `
        <div class="files-table-container">
            <div class="files-table-actions">
                <button onclick="verifyContentSync()" class="debug-btn" title="Re-verify all hashes and sync status">
                    🔍 Verify Sync
                </button>
                <button onclick="forceWriteAllContent()" class="debug-btn" title="Force write all files (emergency recovery)">
                    ⚠️ Force Save All
                </button>
                <button onclick="reloadAllIncludedFiles()" class="debug-btn" title="Reload all included files from disk">
                    🔄 Reload All
                </button>
                <span class="debug-btn-separator">|</span>
                <button onclick="convertAllPaths('relative')" class="debug-btn" title="Convert all paths to relative format">
                    📁 All to Relative
                </button>
                <button onclick="convertAllPaths('absolute')" class="debug-btn" title="Convert all paths to absolute format">
                    📂 All to Absolute
                </button>
            </div>
            <table class="files-table">
                <thead>
                    <tr>
                        <th class="col-file">File</th>
                        <th class="col-frontend" title="Frontend board state">Frontend</th>
                        <th class="col-backend" title="Backend cache state">Backend</th>
                        <th class="col-saved" title="Saved file on disk">Saved File</th>
                        <th class="col-actions">Save/Load</th>
                        <th class="col-image">Image</th>
                    </tr>
                </thead>
                <tbody>
                    ${allFiles.map(file => {
                        const mainFileClass = file.isMainFile ? 'main-file' : '';

                        // Get sync status from verification results
                        const syncStatus = getFileSyncStatus(file.path);

                        // Frontend data
                        let frontendHash = 'N/A';
                        let frontendChars = '?';
                        let frontendDisplay = '⚪ Not verified';

                        // Backend data and sync status
                        let backendHash = 'N/A';
                        let backendChars = '?';
                        let backendIcon = '⚪';
                        let backendClass = 'sync-unknown';
                        let backendDisplay = '⚪ Not verified';

                        // Saved file data and sync status
                        let savedHash = 'N/A';
                        let savedChars = '?';
                        let savedIcon = '⚪';
                        let savedClass = 'sync-unknown';
                        let savedDisplay = '⚪ Not verified';

                        if (syncStatus) {
                            // Frontend data (always available from verification)
                            frontendHash = syncStatus.frontendHash || 'N/A';
                            frontendChars = syncStatus.frontendContentLength || 0;
                            frontendDisplay = `${frontendHash}<br><span class="char-count">${frontendChars} chars</span>`;

                            // Backend data and sync
                            backendHash = syncStatus.backendHash || 'N/A';
                            backendChars = syncStatus.backendContentLength || 0;

                            if (syncStatus.frontendBackendMatch) {
                                backendIcon = '✅';
                                backendClass = 'sync-good';
                            } else {
                                backendIcon = '⚠️';
                                backendClass = 'sync-warn';
                            }
                            backendDisplay = `${backendIcon} ${backendHash}<br><span class="char-count">${backendChars} chars</span>`;

                            // Saved file data and sync
                            if (syncStatus.savedHash) {
                                savedHash = syncStatus.savedHash;
                                savedChars = syncStatus.savedContentLength || 0;

                                if (syncStatus.frontendSavedMatch) {
                                    savedIcon = '✅';
                                    savedClass = 'sync-good';
                                } else {
                                    savedIcon = '⚠️';
                                    savedClass = 'sync-warn';
                                }
                                savedDisplay = `${savedIcon} ${savedHash}<br><span class="char-count">${savedChars} chars</span>`;
                            } else {
                                savedDisplay = '❓ Not available';
                            }
                        }

                        // Truncate directory path
                        const dirPath = file.relativePath.includes('/')
                            ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))
                            : '.';
                        const truncatedDirPath = truncatePath(dirPath, 10);

                        return `
                            <tr class="file-row ${mainFileClass}" data-file-path="${file.path}">
                                <td class="col-file">
                                    <div class="file-directory-path" title="${file.path}">
                                        ${truncatedDirPath}
                                        ${!file.isMainFile ? `<span class="include-type-label ${file.type || 'include'}">[${getIncludeTypeShortLabel(file.type)}]</span>` : ''}
                                    </div>
                                    <div class="file-name-clickable" onclick="openFile('${file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="${file.path}">
                                        ${file.isMainFile ? '📄' : '📎'} ${truncatePath(file.name, 15)}
                                    </div>
                                </td>
                                <td class="col-frontend">
                                    <div class="hash-display">
                                        ${frontendDisplay}
                                    </div>
                                </td>
                                <td class="col-backend">
                                    <div class="hash-display ${backendClass}">
                                        ${backendDisplay}
                                    </div>
                                </td>
                                <td class="col-saved">
                                    <div class="hash-display ${savedClass}">
                                        ${savedDisplay}
                                    </div>
                                </td>
                                <td class="col-actions">
                                    <div class="action-buttons">
                                        <button onclick="saveIndividualFile('${file.path}', ${file.isMainFile}, true)" class="action-btn save-btn" title="Force save file (writes unconditionally)">💾</button>
                                        <button onclick="reloadIndividualFile('${file.path}', ${file.isMainFile})" class="action-btn reload-btn" title="Reload file from disk">🔄</button>
                                        <button onclick="convertFilePaths('${file.path}', ${file.isMainFile}, 'relative')" class="action-btn" title="Convert paths to relative format">📁</button>
                                        <button onclick="convertFilePaths('${file.path}', ${file.isMainFile}, 'absolute')" class="action-btn" title="Convert paths to absolute format">📂</button>
                                    </div>
                                </td>
                                <td class="col-image">
                                    <div class="action-buttons">
                                        <button onclick="reloadImages()" class="action-btn reload-images-btn" title="Reload all images in the board">🖼️</button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>

            <div class="icon-legend">
                <div class="legend-section">
                    <div class="legend-title">Sync Status Icons:</div>
                    <div class="legend-items">
                        <div class="legend-item">
                            <span class="legend-icon">✅</span>
                            <span class="legend-text">Matches Frontend</span>
                        </div>
                        <div class="legend-item">
                            <span class="legend-icon">⚠️</span>
                            <span class="legend-text">Differs from Frontend</span>
                        </div>
                        <div class="legend-item">
                            <span class="legend-icon">⚪</span>
                            <span class="legend-text">Not Verified</span>
                        </div>
                    </div>
                </div>
                <div class="legend-section">
                    <div class="legend-title">Include Types:</div>
                    <div class="legend-items">
                        <div class="legend-item">
                            <span class="include-type-label regular legend-badge">[INCLUDE]</span>
                            <span class="legend-text">!!!include() - read-only</span>
                        </div>
                        <div class="legend-item">
                            <span class="include-type-label column legend-badge">[COLINC]</span>
                            <span class="legend-text">!!!include() in column header - bidirectional</span>
                        </div>
                        <div class="legend-item">
                            <span class="include-type-label task legend-badge">[TASKINC]</span>
                            <span class="legend-text">!!!include() in task title - bidirectional</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Save an individual file (force write)
 */
function saveIndividualFile(filePath, isMainFile, forceSave = true) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'saveIndividualFile',
            filePath: filePath,
            isMainFile: isMainFile,
            forceSave: forceSave
        });
    }
}

/**
 * Reload an individual file from saved state
 */
function reloadIndividualFile(filePath, isMainFile) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'reloadIndividualFile',
            filePath: filePath,
            isMainFile: isMainFile
        });
    }
}

/**
 * Convert paths in a specific file
 * @param {string} filePath - The file path to convert
 * @param {boolean} isMainFile - Whether this is the main file
 * @param {'relative'|'absolute'} direction - The conversion direction
 */
function convertFilePaths(filePath, isMainFile, direction) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'convertPaths',
            filePath: filePath,
            isMainFile: isMainFile,
            direction: direction
        });
    }
}

/**
 * Convert all paths in main file and all includes
 * @param {'relative'|'absolute'} direction - The conversion direction
 */
function convertAllPaths(direction) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'convertAllPaths',
            direction: direction
        });
    }
}

/**
 * Open a file in VS Code
 */
function openFile(filePath) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'openFile',
            filePath: filePath
        });
    }
}


/**
 * Reload images and media content
 */
function reloadImages() {
    // Force reload all images by appending timestamp query parameter
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        if (img.src) {
            const url = new URL(img.src, window.location.href);
            url.searchParams.set('_reload', Date.now().toString());
            img.src = url.toString();
        }
    });

    // Also reload any other media elements
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (video.src) {
            const url = new URL(video.src, window.location.href);
            url.searchParams.set('_reload', Date.now().toString());
            video.load();
        }
    });

}

/**
 * Clear debug cache and request fresh data
 */
function clearDebugCache() {
    trackedFilesData = {};
    refreshCount = 0;
    if (window.vscode) {
        window.vscode.postMessage({ type: 'clearTrackedFilesCache' });
    }
    refreshDebugOverlay();
}

/**
 * Reload all included files (images, videos, includes)
 */
function reloadAllIncludedFiles() {
    if (window.vscode) {
        window.vscode.postMessage({ type: 'reloadAllIncludedFiles' });
        // Refresh the debug overlay after a short delay to show updated data
        setTimeout(() => {
            refreshDebugOverlay();
        }, 500);
    }
}

// Force write state
let pendingForceWrite = false;
let lastVerificationResults = null;
let syncDetailsExpanded = false;

/**
 * Force write all content (EMERGENCY RECOVERY)
 * Writes ALL files unconditionally, bypassing broken change detection
 */
function forceWriteAllContent() {
    if (pendingForceWrite) {
        return;
    }

    if (!window.vscode) {
        alert('Error: vscode API not available');
        return;
    }

    // Show confirmation dialog
    showForceWriteConfirmation();
}

/**
 * Show confirmation dialog before force write
 */
function showForceWriteConfirmation() {
    const allFiles = createAllFilesArray();
    const fileCount = allFiles.length;

    const confirmHtml = `
        <div class="force-write-confirmation-overlay" id="force-write-confirmation">
            <div class="confirmation-dialog">
                <div class="confirmation-header">
                    <h3>⚠️ Force Write All Files</h3>
                </div>
                <div class="confirmation-content">
                    <p><strong>WARNING:</strong> This will unconditionally write ALL ${fileCount} files to disk, bypassing change detection.</p>
                    <p>Use this ONLY when:</p>
                    <ul>
                        <li>Normal save is not working</li>
                        <li>You suspect frontend/backend are out of sync</li>
                        <li>You need emergency recovery</li>
                    </ul>
                    <p><strong>A backup will be created before writing.</strong></p>
                    <div class="affected-files">
                        <strong>Files to be written (${fileCount}):</strong>
                        <ul>
                            ${allFiles.map(f => `<li>${f.relativePath}</li>`).slice(0, 10).join('')}
                            ${fileCount > 10 ? `<li><em>... and ${fileCount - 10} more files</em></li>` : ''}
                        </ul>
                    </div>
                </div>
                <div class="confirmation-actions">
                    <button onclick="cancelForceWrite()" class="btn-cancel">Cancel</button>
                    <button onclick="confirmForceWrite()" class="btn-confirm">Force Write All</button>
                </div>
            </div>
        </div>
    `;

    // Add to DOM
    const confirmElement = document.createElement('div');
    confirmElement.innerHTML = confirmHtml;
    document.body.appendChild(confirmElement.firstElementChild);
}

/**
 * Cancel force write operation
 */
function cancelForceWrite() {
    const confirmDialog = document.getElementById('force-write-confirmation');
    if (confirmDialog) {
        confirmDialog.remove();
    }
}

/**
 * Confirm and execute force write
 */
function confirmForceWrite() {
    // Remove confirmation dialog
    cancelForceWrite();

    // Set pending flag
    pendingForceWrite = true;

    // Send force write message to backend
    window.vscode.postMessage({ type: 'forceWriteAllContent' });

    // Show progress indicator
    alert('Force write in progress... Please wait.');
}

/**
 * Verify content synchronization between frontend and backend
 */
function verifyContentSync(silent = false) {
    if (!window.vscode) {
        if (!silent) {
            alert('Error: vscode API not available');
        }
        return;
    }

    // Send verification request to backend WITH actual frontend board data
    window.vscode.postMessage({
        type: 'verifyContentSync',
        frontendBoard: window.currentBoard  // Send the actual frontend board state
    });

    // Show loading indicator only if not silent
    if (!silent) {
        alert('Verifying content synchronization... Please wait.');
    }
}

/**
 * Show verification results
 */
function showVerificationResults(results) {
    lastVerificationResults = results;

    const resultClass = results.mismatchedFiles > 0 ? 'verification-warning' : 'verification-success';

    const resultsHtml = `
        <div class="verification-results-overlay" id="verification-results">
            <div class="verification-dialog ${resultClass}">
                <div class="verification-header">
                    <h3>🔍 Content Synchronization Verification</h3>
                    <button onclick="closeVerificationResults()" class="close-btn">✕</button>
                </div>
                <div class="verification-content">
                    <div class="verification-summary">
                        <div class="summary-stat">
                            <span class="stat-label">Total Files:</span>
                            <span class="stat-value">${results.totalFiles}</span>
                        </div>
                        <div class="summary-stat status-good">
                            <span class="stat-label">✅ Matching:</span>
                            <span class="stat-value">${results.matchingFiles}</span>
                        </div>
                        <div class="summary-stat ${results.mismatchedFiles > 0 ? 'status-warn' : ''}">
                            <span class="stat-label">⚠️ Mismatched:</span>
                            <span class="stat-value">${results.mismatchedFiles}</span>
                        </div>
                    </div>
                    <div class="verification-details">
                        <strong>File Details:</strong>
                        <div class="file-results-list">
                            ${results.fileResults.map(file => `
                                <div class="file-result-item ${file.matches ? 'match' : 'mismatch'}">
                                    <div class="file-result-name">${file.relativePath}</div>
                                    <div class="file-result-status">
                                        ${file.matches ?
                                            '✅ All Match' :
                                            `⚠️ Differences detected`}
                                    </div>
                                    <div class="file-result-hashes">
                                        <div>Frontend: ${file.frontendHash} (${file.frontendContentLength} chars)</div>
                                        <div>Backend: ${file.backendHash} (${file.backendContentLength} chars)
                                            ${file.frontendBackendMatch ? '✅' : '⚠️ differs by ' + file.frontendBackendDiff}</div>
                                        ${file.savedHash ? `<div>Saved: ${file.savedHash} (${file.savedContentLength} chars)
                                            ${file.backendSavedMatch ? '✅' : '⚠️ differs by ' + file.backendSavedDiff}</div>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="verification-timestamp">
                        Verified: ${new Date(results.timestamp).toLocaleString()}
                    </div>
                </div>
                <div class="verification-actions">
                    ${results.mismatchedFiles > 0 ?
                        '<button onclick="forceWriteAllContent()" class="btn-force-write">Force Write All</button>' : ''}
                    <button onclick="closeVerificationResults()" class="btn-close">Close</button>
                </div>
            </div>
        </div>
    `;

    // Add to DOM
    const resultsElement = document.createElement('div');
    resultsElement.innerHTML = resultsHtml;
    document.body.appendChild(resultsElement.firstElementChild);
}

/**
 * Close verification results dialog
 */
function closeVerificationResults() {
    const resultsDialog = document.getElementById('verification-results');
    if (resultsDialog) {
        resultsDialog.remove();
    }
}


/**
 * Enhanced manual refresh with debug overlay toggle
 */
function enhancedManualRefresh(showDebug = false) {
    // Show debug overlay if requested
    if (showDebug) {
        showDebugOverlay();
        return;
    }

    // Call original manual refresh
    if (typeof originalManualRefresh === 'function') {
        originalManualRefresh();
    }
}

// Store original function (will be done after DOM ready)
let originalManualRefresh = null;

// Keyboard shortcut removed - now using hover behavior

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDebugOverlay);
} else {
    initializeDebugOverlay();
}

function initializeDebugOverlay() {

    // Make functions globally available immediately
    window.showDebugOverlay = showDebugOverlay;
    window.hideDebugOverlay = hideDebugOverlay;
    window.updateTrackedFilesData = updateTrackedFilesData;
    window.clearDebugCache = clearDebugCache;
    window.scheduleDebugOverlayShow = scheduleDebugOverlayShow;
    window.cancelDebugOverlayShow = cancelDebugOverlayShow;
    window.hideDebugOverlayDelayed = hideDebugOverlayDelayed;
    window.openFile = openFile;

    // Store original manual refresh function
    if (typeof window.manualRefresh === 'function') {
        originalManualRefresh = window.manualRefresh;
        window.manualRefresh = enhancedManualRefresh;
    } else {
        // Try again after a short delay
        setTimeout(() => {
            if (typeof window.manualRefresh === 'function' && !originalManualRefresh) {
                originalManualRefresh = window.manualRefresh;
                window.manualRefresh = enhancedManualRefresh;
            }
        }, 1000);
    }


    // Listen for document state changes from backend to auto-refresh overlay
    window.addEventListener('message', (event) => {
        const message = event.data;

        if (!message || !message.type) return;


        switch (message.type) {
            case 'documentStateChanged':
                if (debugOverlayVisible) {
                    refreshDebugOverlay();
                }
                break;

            case 'saveCompleted':
                // After save completes, automatically re-verify sync status
                if (debugOverlayVisible) {
                    verifyContentSync(true); // Silent mode
                }
                break;

            case 'individualFileSaved':
                // After individual file save completes, automatically re-verify sync status
                if (debugOverlayVisible && message.success) {
                    verifyContentSync(true); // Silent mode
                }
                break;

            case 'individualFileReloaded':
                // After individual file reload completes, automatically re-verify sync status
                if (debugOverlayVisible && message.success) {
                    verifyContentSync(true); // Silent mode
                }
                break;

            case 'forceWriteAllResult':
                // Clear pending flag
                pendingForceWrite = false;

                // Show result to user
                if (message.success) {
                    const resultMsg = `Force write completed successfully!\n\n` +
                        `Files written: ${message.filesWritten}\n` +
                        `Backup created: ${message.backupCreated ? 'Yes' : 'No'}\n` +
                        `${message.backupPath ? `Backup: ${message.backupPath}` : ''}`;
                    alert(resultMsg);

                    // Refresh overlay
                    refreshDebugOverlay();
                } else {
                    const errorMsg = `Force write failed!\n\n` +
                        `Errors:\n${message.errors.join('\n')}`;
                    alert(errorMsg);
                }
                break;

            case 'verifyContentSyncResult':
                // Store verification results and update display
                lastVerificationResults = message;

                // Update the file states content to show sync status
                if (debugOverlayVisible && debugOverlayElement) {
                    updateFileStatesContent();
                }
                break;
        }
    });
}


