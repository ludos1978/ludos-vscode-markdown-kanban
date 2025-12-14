/**
 * WebviewBridge - Unified Webview Communication Layer
 *
 * Provides a typed, promise-based interface for webview communication.
 * Features:
 * - Type-safe message sending
 * - Request/response pattern with timeout
 * - Message batching for performance
 * - Ready state handling
 * - Event-based message reception
 *
 * This wrapper coexists with existing postMessage calls to allow
 * incremental migration without breaking changes.
 */

import * as vscode from 'vscode';
import { PanelEventBus } from '../events';
import {
    OutgoingMessage
} from './MessageTypes';

// ============= TYPES =============

export interface WebviewBridgeOptions {
    /** Maximum batch size before auto-flush (default: 10) */
    maxBatchSize?: number;
    /** Batch flush delay in milliseconds (default: 16 - one frame) */
    batchFlushDelay?: number;
    /** Enable debug logging */
    debug?: boolean;
}

// ============= MAIN CLASS =============

export class WebviewBridge implements vscode.Disposable {
    private _webview: vscode.Webview | null = null;
    private _eventBus: PanelEventBus;
    private _isReady = false;
    private _isDisposed = false;

    // Message batching
    private _batchedMessages: OutgoingMessage[] = [];
    private _batchFlushTimer: NodeJS.Timeout | null = null;

    // Options
    private readonly _maxBatchSize: number;
    private readonly _batchFlushDelay: number;
    private readonly _debug: boolean;

    constructor(eventBus: PanelEventBus, options: WebviewBridgeOptions = {}) {
        this._eventBus = eventBus;
        this._maxBatchSize = options.maxBatchSize ?? 10;
        this._batchFlushDelay = options.batchFlushDelay ?? 16;
        this._debug = options.debug ?? false;
    }

    // ============= WEBVIEW MANAGEMENT =============

    /**
     * Set the webview instance
     */
    setWebview(webview: vscode.Webview): void {
        this._webview = webview;
        this._isReady = true;

        // Emit ready event
        this._eventBus.emit('bridge:ready', { bridge: this }).catch(() => {});

        this._log('Webview connected');
    }

    /**
     * Check if bridge is ready to send messages
     */
    get isReady(): boolean {
        return this._isReady && this._webview !== null && !this._isDisposed;
    }

    // ============= MESSAGE SENDING =============

    /**
     * Send a message to the webview immediately
     */
    send<T extends OutgoingMessage>(message: T): boolean {
        if (!this._webview) {
            console.warn(`[WebviewBridge] Cannot send message: no webview (type: ${message.type})`);
            return false;
        }

        if (this._isDisposed) {
            console.warn(`[WebviewBridge] Cannot send message: bridge disposed (type: ${message.type})`);
            return false;
        }

        try {
            this._webview.postMessage(message);
            return true;
        } catch (error) {
            console.error(`[WebviewBridge] Error sending message:`, error);
            return false;
        }
    }

    /**
     * Send a message to the webview with batching
     * Messages are collected and sent together for performance
     */
    sendBatched<T extends OutgoingMessage>(message: T): void {
        if (!this._webview || this._isDisposed) {
            console.warn(`[WebviewBridge] Cannot batch message: bridge not ready (type: ${message.type})`);
            return;
        }

        this._batchedMessages.push(message);

        // Flush immediately if batch is full
        if (this._batchedMessages.length >= this._maxBatchSize) {
            this.flushBatch();
            return;
        }

        // Schedule flush
        if (!this._batchFlushTimer) {
            this._batchFlushTimer = setTimeout(() => {
                this.flushBatch();
            }, this._batchFlushDelay);
        }
    }

    /**
     * Flush all batched messages immediately
     */
    flushBatch(): void {
        if (this._batchFlushTimer) {
            clearTimeout(this._batchFlushTimer);
            this._batchFlushTimer = null;
        }

        if (this._batchedMessages.length === 0) {
            return;
        }

        const messages = this._batchedMessages;
        this._batchedMessages = [];

        // Send as batch message
        if (this._webview) {
            this._webview.postMessage({
                type: 'batch',
                messages
            });
            this._log(`Flushed batch of ${messages.length} messages`);
        }
    }

    // ============= PRIVATE HELPERS =============

    private _log(message: string): void {
        if (this._debug) {
            console.log(`[WebviewBridge] ${message}`);
        }
    }

    // ============= LIFECYCLE =============

    /**
     * Dispose the bridge and cleanup resources
     */
    dispose(): void {
        this._isDisposed = true;

        if (this._batchFlushTimer) {
            clearTimeout(this._batchFlushTimer);
            this._batchFlushTimer = null;
        }

        this._batchedMessages = [];
        this._webview = null;
    }
}
