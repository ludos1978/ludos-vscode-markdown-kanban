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
    BaseMessage,
    RequestMessage,
    ResponseMessage,
    OutgoingMessage,
    IncomingMessage,
    isResponseMessage
} from './MessageTypes';

// ============= TYPES =============

export interface PendingRequest<T = any> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    type: string;
}

export interface WebviewBridgeOptions {
    /** Default timeout for requests in milliseconds (default: 5000) */
    defaultTimeout?: number;
    /** Maximum batch size before auto-flush (default: 10) */
    maxBatchSize?: number;
    /** Batch flush delay in milliseconds (default: 16 - one frame) */
    batchFlushDelay?: number;
    /** Enable debug logging */
    debug?: boolean;
}

export interface WebviewBridgeState {
    isReady: boolean;
    isDisposed: boolean;
    pendingRequestCount: number;
    batchedMessageCount: number;
}

// ============= MAIN CLASS =============

export class WebviewBridge implements vscode.Disposable {
    private _webview: vscode.Webview | null = null;
    private _eventBus: PanelEventBus;
    private _isReady = false;
    private _isDisposed = false;

    // Request tracking
    private _pendingRequests = new Map<string, PendingRequest>();
    private _requestCounter = 0;

    // Message batching
    private _batchedMessages: OutgoingMessage[] = [];
    private _batchFlushTimer: NodeJS.Timeout | null = null;

    // Options
    private readonly _defaultTimeout: number;
    private readonly _maxBatchSize: number;
    private readonly _batchFlushDelay: number;
    private readonly _debug: boolean;

    // Message handler
    private _messageHandler: ((message: IncomingMessage) => void) | null = null;

    constructor(eventBus: PanelEventBus, options: WebviewBridgeOptions = {}) {
        this._eventBus = eventBus;
        this._defaultTimeout = options.defaultTimeout ?? 5000;
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
     * Clear the webview reference
     */
    clearWebview(): void {
        this._webview = null;
        this._isReady = false;

        // Cancel all pending requests
        this._cancelAllPendingRequests('Webview disconnected');

        // Flush any remaining batched messages (they will fail)
        this._batchedMessages = [];
        if (this._batchFlushTimer) {
            clearTimeout(this._batchFlushTimer);
            this._batchFlushTimer = null;
        }

        this._log('Webview disconnected');
    }

    /**
     * Check if bridge is ready to send messages
     */
    get isReady(): boolean {
        return this._isReady && this._webview !== null && !this._isDisposed;
    }

    /**
     * Get current state
     */
    get state(): WebviewBridgeState {
        return {
            isReady: this.isReady,
            isDisposed: this._isDisposed,
            pendingRequestCount: this._pendingRequests.size,
            batchedMessageCount: this._batchedMessages.length
        };
    }

    // ============= MESSAGE SENDING =============

    /**
     * Send a message to the webview immediately
     */
    send<T extends OutgoingMessage>(message: T): boolean {
        if (!this.isReady || !this._webview) {
            this._log(`Cannot send message: bridge not ready (type: ${message.type})`);
            return false;
        }

        try {
            this._webview.postMessage(message);
            this._log(`Sent message: ${message.type}`);
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
        if (!this.isReady) {
            this._log(`Cannot batch message: bridge not ready (type: ${message.type})`);
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

    // ============= REQUEST/RESPONSE PATTERN =============

    /**
     * Send a request and wait for response
     * @param message The request message (must have requestId)
     * @param timeoutMs Timeout in milliseconds (default: 5000)
     * @returns Promise that resolves with the response
     */
    async request<TRequest extends RequestMessage, TResponse extends ResponseMessage>(
        messageWithoutId: Omit<TRequest, 'requestId'>,
        timeoutMs?: number
    ): Promise<TResponse> {
        if (!this.isReady || !this._webview) {
            throw new Error('WebviewBridge not ready');
        }

        const requestId = this._generateRequestId();
        const message = {
            ...messageWithoutId,
            requestId
        } as TRequest;

        const timeout = timeoutMs ?? this._defaultTimeout;

        return new Promise<TResponse>((resolve, reject) => {
            // Set timeout
            const timeoutHandle = setTimeout(() => {
                const pending = this._pendingRequests.get(requestId);
                if (pending) {
                    this._pendingRequests.delete(requestId);
                    reject(new Error(`Request timeout: ${message.type} (${requestId})`));
                }
            }, timeout);

            // Store pending request
            this._pendingRequests.set(requestId, {
                resolve,
                reject,
                timeout: timeoutHandle,
                type: message.type
            });

            // Send message
            if (!this.send(message as unknown as OutgoingMessage)) {
                this._pendingRequests.delete(requestId);
                clearTimeout(timeoutHandle);
                reject(new Error(`Failed to send request: ${message.type}`));
            }
        });
    }

    /**
     * Handle incoming response message
     * Call this when a response message is received
     */
    handleResponse(message: ResponseMessage): boolean {
        if (!isResponseMessage(message)) {
            return false;
        }

        const pending = this._pendingRequests.get(message.requestId);
        if (!pending) {
            this._log(`No pending request for: ${message.requestId}`);
            return false;
        }

        // Clean up
        clearTimeout(pending.timeout);
        this._pendingRequests.delete(message.requestId);

        // Resolve
        pending.resolve(message);
        this._log(`Response received for: ${message.requestId} (${pending.type})`);

        return true;
    }

    // ============= MESSAGE HANDLING =============

    /**
     * Set the message handler for incoming messages
     */
    onMessage(handler: (message: IncomingMessage) => void): void {
        this._messageHandler = handler;
    }

    /**
     * Process an incoming message from the webview
     * Routes responses to pending requests, other messages to handler
     */
    processIncomingMessage(message: IncomingMessage): void {
        // Check if it's a response to a pending request
        if (isResponseMessage(message as any)) {
            if (this.handleResponse(message as unknown as ResponseMessage)) {
                return; // Handled as response
            }
        }

        // Route to message handler
        if (this._messageHandler) {
            this._messageHandler(message);
        }
    }

    // ============= PRIVATE HELPERS =============

    private _generateRequestId(): string {
        return `req-${++this._requestCounter}-${Date.now()}`;
    }

    private _cancelAllPendingRequests(reason: string): void {
        const error = new Error(reason);
        this._pendingRequests.forEach((pending, requestId) => {
            clearTimeout(pending.timeout);
            pending.reject(error);
        });
        this._pendingRequests.clear();
    }

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
        this._cancelAllPendingRequests('Bridge disposed');

        if (this._batchFlushTimer) {
            clearTimeout(this._batchFlushTimer);
            this._batchFlushTimer = null;
        }

        this._batchedMessages = [];
        this._webview = null;
        this._messageHandler = null;
    }
}
