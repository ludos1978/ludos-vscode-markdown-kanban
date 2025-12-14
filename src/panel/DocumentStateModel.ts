/**
 * DocumentStateModel - Single source of truth for document-tracking state
 *
 * Consolidates state that was previously duplicated between
 * KanbanWebviewPanel and KanbanFileService.
 *
 * This model tracks:
 * - Document version for change detection
 * - Document URIs for panel management
 * - Pending updates for webview synchronization
 *
 * @module panel/DocumentStateModel
 */

/**
 * Pending board update structure
 */
export interface PendingBoardUpdate {
    applyDefaultFolding: boolean;
    isFullRefresh: boolean;
}

/**
 * Serializable state for panel restoration
 */
export interface DocumentStateSnapshot {
    lastDocumentVersion: number;
    lastDocumentUri?: string;
    trackedDocumentUri?: string;
    panelId: string;
}

/**
 * DocumentStateModel - Centralized document state management
 *
 * Benefits:
 * - Single source of truth (no sync needed between panel and service)
 * - Supports serialization for panel restoration
 * - Clear ownership of document-tracking concerns
 */
export class DocumentStateModel {
    private _lastDocumentVersion: number = -1;
    private _lastDocumentUri?: string;
    private _trackedDocumentUri?: string;
    private _pendingBoardUpdate: PendingBoardUpdate | null = null;
    private _panelId: string;
    private _debugMode: boolean;

    constructor(panelId?: string, debugMode: boolean = false) {
        this._panelId = panelId || Math.random().toString(36).substr(2, 9);
        this._debugMode = debugMode;
    }

    // ============= GETTERS =============

    get lastDocumentVersion(): number {
        return this._lastDocumentVersion;
    }

    get lastDocumentUri(): string | undefined {
        return this._lastDocumentUri;
    }

    get trackedDocumentUri(): string | undefined {
        return this._trackedDocumentUri;
    }

    get pendingBoardUpdate(): PendingBoardUpdate | null {
        return this._pendingBoardUpdate;
    }

    get panelId(): string {
        return this._panelId;
    }

    // ============= SETTERS =============

    setLastDocumentVersion(version: number): void {
        if (this._debugMode && this._lastDocumentVersion !== version) {
            console.log(`[DocumentState] lastDocumentVersion: ${this._lastDocumentVersion} → ${version}`);
        }
        this._lastDocumentVersion = version;
    }

    setLastDocumentUri(uri: string | undefined): void {
        if (this._debugMode && this._lastDocumentUri !== uri) {
            console.log(`[DocumentState] lastDocumentUri: ${this._lastDocumentUri} → ${uri}`);
        }
        this._lastDocumentUri = uri;
    }

    setTrackedDocumentUri(uri: string | undefined): void {
        if (this._debugMode && this._trackedDocumentUri !== uri) {
            console.log(`[DocumentState] trackedDocumentUri: ${this._trackedDocumentUri} → ${uri}`);
        }
        this._trackedDocumentUri = uri;
    }

    setPendingBoardUpdate(update: PendingBoardUpdate | null): void {
        if (this._debugMode) {
            console.log(`[DocumentState] pendingBoardUpdate: ${JSON.stringify(this._pendingBoardUpdate)} → ${JSON.stringify(update)}`);
        }
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

    // ============= SERIALIZATION =============

    /**
     * Create snapshot for panel serialization/restoration
     */
    toSnapshot(): DocumentStateSnapshot {
        return {
            lastDocumentVersion: this._lastDocumentVersion,
            lastDocumentUri: this._lastDocumentUri,
            trackedDocumentUri: this._trackedDocumentUri,
            panelId: this._panelId
        };
    }

    /**
     * Restore state from snapshot
     */
    fromSnapshot(snapshot: DocumentStateSnapshot): void {
        this._lastDocumentVersion = snapshot.lastDocumentVersion;
        this._lastDocumentUri = snapshot.lastDocumentUri;
        this._trackedDocumentUri = snapshot.trackedDocumentUri;
        this._panelId = snapshot.panelId;
    }

    /**
     * Create new instance from snapshot
     */
    static fromSnapshot(snapshot: DocumentStateSnapshot, debugMode: boolean = false): DocumentStateModel {
        const model = new DocumentStateModel(snapshot.panelId, debugMode);
        model._lastDocumentVersion = snapshot.lastDocumentVersion;
        model._lastDocumentUri = snapshot.lastDocumentUri;
        model._trackedDocumentUri = snapshot.trackedDocumentUri;
        return model;
    }
}
