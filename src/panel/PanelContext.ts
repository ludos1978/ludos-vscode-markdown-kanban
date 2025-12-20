/**
 * PanelContext - Unified state management for KanbanWebviewPanel
 *
 * Consolidates PanelStateModel and DocumentStateModel into a single
 * source of truth for all panel-related state.
 *
 * @module panel/PanelContext
 */

/**
 * Pending board update structure
 */
export interface PendingBoardUpdate {
    applyDefaultFolding: boolean;
    isFullRefresh: boolean;
}


/**
 * PanelContext - Unified panel state management
 *
 * Combines:
 * - Panel lifecycle flags (initialized, disposed, etc.)
 * - Document tracking (version, URIs)
 * - Pending updates for webview sync
 */
export class PanelContext {
    // ============= PANEL FLAGS =============
    private _initialized: boolean = false;
    private _updatingFromPanel: boolean = false;
    private _undoRedoOperation: boolean = false;
    private _closingPrevented: boolean = false;
    private _disposed: boolean = false;
    private _editingInProgress: boolean = false;
    private _initialBoardLoad: boolean = false;
    private _includeSwitchInProgress: boolean = false;
    private _webviewReady: boolean = false;

    // ============= DOCUMENT STATE =============
    private _lastDocumentVersion: number = -1;
    private _lastDocumentUri?: string;
    private _trackedDocumentUri?: string;
    private _pendingBoardUpdate: PendingBoardUpdate | null = null;
    private _panelId: string;

    // ============= CONFIG =============
    private _debugMode: boolean;

    constructor(panelId?: string, debugMode: boolean = false) {
        this._panelId = panelId || Math.random().toString(36).substr(2, 9);
        this._debugMode = debugMode;
    }

    // ============= PANEL FLAG GETTERS =============

    get initialized(): boolean { return this._initialized; }
    get updatingFromPanel(): boolean { return this._updatingFromPanel; }
    get undoRedoOperation(): boolean { return this._undoRedoOperation; }
    get closingPrevented(): boolean { return this._closingPrevented; }
    get disposed(): boolean { return this._disposed; }
    get editingInProgress(): boolean { return this._editingInProgress; }
    get initialBoardLoad(): boolean { return this._initialBoardLoad; }
    get includeSwitchInProgress(): boolean { return this._includeSwitchInProgress; }
    get webviewReady(): boolean { return this._webviewReady; }

    // ============= DOCUMENT STATE GETTERS =============

    get lastDocumentVersion(): number { return this._lastDocumentVersion; }
    get lastDocumentUri(): string | undefined { return this._lastDocumentUri; }
    get trackedDocumentUri(): string | undefined { return this._trackedDocumentUri; }
    get pendingBoardUpdate(): PendingBoardUpdate | null { return this._pendingBoardUpdate; }
    get panelId(): string { return this._panelId; }

    // ============= PANEL FLAG SETTERS =============

    setInitialized(value: boolean): void {
        if (this._disposed) {
            this._logWarning('Cannot set initialized on disposed panel');
            return;
        }
        this._setFlag('initialized', value);
    }

    setUpdatingFromPanel(value: boolean): void {
        if (this._disposed) return;
        this._setFlag('updatingFromPanel', value);
    }

    setUndoRedoOperation(value: boolean): void {
        if (this._disposed) return;
        this._setFlag('undoRedoOperation', value);
    }

    setClosingPrevented(value: boolean): void {
        this._setFlag('closingPrevented', value);
    }

    setDisposed(value: boolean): void {
        if (value && !this._disposed) {
            this._setFlag('disposed', true);
            // Reset all other flags when disposing
            this._initialized = false;
            this._updatingFromPanel = false;
            this._undoRedoOperation = false;
            this._editingInProgress = false;
            this._initialBoardLoad = false;
            this._includeSwitchInProgress = false;
            this._webviewReady = false;
        }
    }

    setEditingInProgress(value: boolean): void {
        if (this._disposed) return;
        this._setFlag('editingInProgress', value);
    }

    setInitialBoardLoad(value: boolean): void {
        if (this._disposed) return;
        this._setFlag('initialBoardLoad', value);
    }

    setIncludeSwitchInProgress(value: boolean): void {
        if (this._disposed) return;
        this._setFlag('includeSwitchInProgress', value);
    }

    setWebviewReady(value: boolean): void {
        if (this._disposed) return;
        this._setFlag('webviewReady', value);
    }

    // ============= DOCUMENT STATE SETTERS =============

    setLastDocumentVersion(version: number): void {
        if (this._lastDocumentVersion !== version) {
            this._log('lastDocumentVersion', this._lastDocumentVersion, version);
            this._lastDocumentVersion = version;
        }
    }

    setLastDocumentUri(uri: string | undefined): void {
        if (this._lastDocumentUri !== uri) {
            this._log('lastDocumentUri', this._lastDocumentUri, uri);
            this._lastDocumentUri = uri;
        }
    }

    setTrackedDocumentUri(uri: string | undefined): void {
        if (this._trackedDocumentUri !== uri) {
            this._log('trackedDocumentUri', this._trackedDocumentUri, uri);
            this._trackedDocumentUri = uri;
        }
    }

    setPendingBoardUpdate(update: PendingBoardUpdate | null): void {
        this._log('pendingBoardUpdate', JSON.stringify(this._pendingBoardUpdate), JSON.stringify(update));
        this._pendingBoardUpdate = update;
    }

    /**
     * Consume pending board update (returns and clears it)
     */
    consumePendingBoardUpdate(): PendingBoardUpdate | null {
        const update = this._pendingBoardUpdate;
        this._pendingBoardUpdate = null;
        return update;
    }

    // ============= PRIVATE HELPERS =============

    private _setFlag(name: string, value: boolean): void {
        const current = (this as any)[`_${name}`];
        if (current !== value) {
            (this as any)[`_${name}`] = value;
            this._log(name, current, value);
        }
    }

    private _log(property: string, oldValue: any, newValue: any): void {
        if (this._debugMode) {
            console.log(`[PanelContext] ${property}: ${oldValue} → ${newValue}`);
        }
    }

    private _logWarning(message: string): void {
        if (this._debugMode) {
            console.warn(`[PanelContext] ${message}`);
        }
    }
}
