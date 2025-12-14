/**
 * Folding State Manager
 * Manages folding state persistence across document switches in the kanban board
 */

// Document-specific folding state storage
let documentFoldingStates = new Map(); // Map<documentUri, {collapsedColumns: Set, collapsedTasks: Set, columnFoldStates: Map}>
let currentDocumentUri = null;

// Function to get current document folding state
function getCurrentDocumentFoldingState() {
    if (!currentDocumentUri) {return null;}

    if (!documentFoldingStates.has(currentDocumentUri)) {
        // Initialize empty state for new document
        documentFoldingStates.set(currentDocumentUri, {
            collapsedColumns: new Set(),
            collapsedTasks: new Set(),
            columnFoldStates: new Map(),
            globalColumnFoldState: 'fold-mixed',
            isInitialized: false
        });
    }

    return documentFoldingStates.get(currentDocumentUri);
}

// Function to save current folding state to document storage
/**
 * Saves current folding state for document persistence
 * Purpose: Preserve fold states across document switches
 * Used by: Before document changes, refreshes
 * Side effects: Updates documentFoldingStates map
 */
function saveCurrentFoldingState() {
    if (!currentDocumentUri || !window.collapsedColumns) {return;}

    const state = getCurrentDocumentFoldingState();
    if (!state) {return;}

    // Copy current state
    state.collapsedColumns = new Set(window.collapsedColumns);
    state.collapsedTasks = new Set(window.collapsedTasks);
    state.columnFoldStates = new Map(window.columnFoldStates);
    state.globalColumnFoldState = window.globalColumnFoldState;
    state.isInitialized = true;

}

// Function to restore folding state from document storage
function restoreFoldingState() {
    if (!currentDocumentUri) {return false;}

    const state = getCurrentDocumentFoldingState();
    if (!state) {return false;}

    // Initialize global folding variables if they don't exist
    if (!window.collapsedColumns) {window.collapsedColumns = new Set();}
    if (!window.collapsedTasks) {window.collapsedTasks = new Set();}
    if (!window.columnFoldStates) {window.columnFoldStates = new Map();}
    if (!window.globalColumnFoldState) {window.globalColumnFoldState = 'fold-mixed';}

    if (state.isInitialized) {
        // Restore saved state
        window.collapsedColumns = new Set(state.collapsedColumns);
        window.collapsedTasks = new Set(state.collapsedTasks);
        window.columnFoldStates = new Map(state.columnFoldStates);
        window.globalColumnFoldState = state.globalColumnFoldState;

        return true;
    }

    return false; // Don't apply default folding here
}

// Function to apply default folding (empty columns folded) - only for truly new documents
function applyDefaultFoldingToNewDocument() {
    if (!window.currentBoard || !window.currentBoard.columns) {return;}

    // Don't reset existing state, just add empty columns to collapsed set
    window.currentBoard.columns.forEach(column => {
        if (!column.tasks || column.tasks.length === 0) {
            window.collapsedColumns.add(column.id);
        }
    });

    // Mark this document as initialized so we don't apply defaults again
    const state = getCurrentDocumentFoldingState();
    if (state) {
        state.isInitialized = true;
    }
}

// Function to update document URI and manage state
function updateDocumentUri(newUri) {
    if (currentDocumentUri !== newUri) {
        // Save current state before switching
        if (currentDocumentUri) {
            saveCurrentFoldingState();
        }

        currentDocumentUri = newUri;

        // Save state for VSCode webview panel serialization
        // This ensures each panel remembers which file it's displaying when VSCode restarts
        if (typeof vscode !== 'undefined' && vscode.setState && currentDocumentUri) {
            vscode.setState({ documentUri: currentDocumentUri });
        }

        // Try to restore state for the new document
        const hadSavedState = restoreFoldingState();

        // If no saved state exists and board is ready, apply defaults for new document
        if (!hadSavedState && window.cachedBoard && window.cachedBoard.columns) {
            applyDefaultFoldingToNewDocument();
        }
    }
}

// Getter for currentDocumentUri (needed by other modules)
function getCurrentDocumentUri() {
    return currentDocumentUri;
}

// Export functions to window for use by other modules
window.getCurrentDocumentFoldingState = getCurrentDocumentFoldingState;
window.saveCurrentFoldingState = saveCurrentFoldingState;
window.restoreFoldingState = restoreFoldingState;
window.applyDefaultFoldingToNewDocument = applyDefaultFoldingToNewDocument;
window.updateDocumentUri = updateDocumentUri;
window.getCurrentDocumentUri = getCurrentDocumentUri;
