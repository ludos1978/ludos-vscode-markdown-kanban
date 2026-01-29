/**
 * Mermaid Diagram Plugin
 *
 * Renders Mermaid code blocks to SVG using the webview's browser-based Mermaid.js.
 * Migrated from src/services/export/MermaidExportService.ts
 */

import * as vscode from 'vscode';
import {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramPluginContext,
    DiagramRenderOptions,
    DiagramRenderResult
} from '../interfaces/DiagramPlugin';

interface MermaidRenderRequest {
    requestId: string;
    code: string;
    resolve: (svg: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

export class MermaidPlugin implements DiagramPlugin {
    readonly metadata: DiagramPluginMetadata = {
        id: 'mermaid',
        name: 'Mermaid Diagram Renderer',
        version: '1.0.0',
        supportedCodeBlocks: ['mermaid'],
        supportedFileExtensions: [],
        renderOutput: 'svg',
        requiresExternalTool: false
    };

    private _webviewPanel: vscode.WebviewPanel | undefined;
    private _pendingRequests: Map<string, MermaidRenderRequest> = new Map();
    private _requestQueue: Array<() => Promise<void>> = [];
    private _isProcessingQueue: boolean = false;

    async activate(context: DiagramPluginContext): Promise<void> {
        this._webviewPanel = context.webviewPanel;
    }

    async deactivate(): Promise<void> {
        this.cleanup();
        this._webviewPanel = undefined;
    }

    /**
     * Update the webview panel reference (called when panel is re-created)
     */
    setWebviewPanel(panel: vscode.WebviewPanel): void {
        this._webviewPanel = panel;
    }

    /**
     * Check if service is ready (has webview panel)
     */
    isReady(): boolean {
        return this._webviewPanel !== undefined;
    }

    canRenderCodeBlock(language: string): boolean {
        return this.metadata.supportedCodeBlocks.includes(language.toLowerCase());
    }

    canRenderFile(_filePath: string): boolean {
        return false;
    }

    async isAvailable(): Promise<boolean> {
        return this._webviewPanel !== undefined;
    }

    async renderCodeBlock(code: string, _options?: DiagramRenderOptions): Promise<DiagramRenderResult> {
        if (!this._webviewPanel) {
            return {
                success: false,
                data: '',
                format: 'svg',
                error: 'No webview panel available for Mermaid rendering'
            };
        }

        try {
            const svg = await this._renderToSVG(code);
            return { success: true, data: svg, format: 'svg' };
        } catch (error) {
            return {
                success: false,
                data: '',
                format: 'svg',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Render multiple Mermaid diagrams sequentially
     */
    async renderBatch(codes: string[]): Promise<Array<string | null>> {
        const results: Array<string | null> = [];

        for (let i = 0; i < codes.length; i++) {
            try {
                const svg = await this._renderToSVG(codes[i]);
                results.push(svg);
            } catch (error) {
                console.error(`[MermaidPlugin] Diagram ${i + 1} failed:`, error);
                results.push(null);
            }
        }

        return results;
    }

    /**
     * Handle render success response from webview
     */
    handleRenderSuccess(requestId: string, svg: string): void {
        const request = this._pendingRequests.get(requestId);

        if (request) {
            clearTimeout(request.timeout);
            request.resolve(svg);
            this._pendingRequests.delete(requestId);
        } else {
            console.warn(`[MermaidPlugin] Unknown requestId: ${requestId}`);
        }
    }

    /**
     * Handle render error response from webview
     */
    handleRenderError(requestId: string, error: string): void {
        const request = this._pendingRequests.get(requestId);

        if (request) {
            clearTimeout(request.timeout);
            request.reject(new Error(error));
            this._pendingRequests.delete(requestId);
        }
    }

    /**
     * Cleanup all pending requests
     */
    cleanup(): void {
        for (const [_requestId, request] of this._pendingRequests.entries()) {
            clearTimeout(request.timeout);
            request.reject(new Error('Service cleanup'));
        }

        this._pendingRequests.clear();
        this._requestQueue = [];
        this._isProcessingQueue = false;
    }

    // ============= INTERNAL RENDERING =============

    private async _renderToSVG(code: string): Promise<string> {
        if (!this._webviewPanel) {
            throw new Error('No webview panel available for Mermaid rendering');
        }

        return new Promise((resolve, reject) => {
            this._requestQueue.push(async () => {
                try {
                    const svg = await this._renderSingleDiagram(code);
                    resolve(svg);
                } catch (error) {
                    reject(error);
                }
            });

            this._processQueue();
        });
    }

    private async _processQueue(): Promise<void> {
        if (this._isProcessingQueue || this._requestQueue.length === 0) {
            return;
        }

        this._isProcessingQueue = true;

        while (this._requestQueue.length > 0) {
            const request = this._requestQueue.shift();
            if (request) {
                try {
                    await request();
                } catch (error) {
                    console.error('[MermaidPlugin] Queue processing error:', error);
                }
            }
        }

        this._isProcessingQueue = false;
    }

    private async _renderSingleDiagram(code: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const requestId = `mermaid-export-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const timeout = setTimeout(() => {
                const request = this._pendingRequests.get(requestId);
                if (request) {
                    this._pendingRequests.delete(requestId);
                    reject(new Error('Mermaid rendering timeout (30s)'));
                }
            }, 30000);

            this._pendingRequests.set(requestId, {
                requestId,
                code,
                resolve,
                reject,
                timeout
            });

            this._webviewPanel!.webview.postMessage({
                type: 'renderMermaidForExport',
                requestId,
                code
            });
        });
    }
}
