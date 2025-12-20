import * as vscode from 'vscode';

interface MermaidRenderRequest {
    requestId: string;
    code: string;
    resolve: (svg: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

/**
 * Service for rendering Mermaid diagrams via webview during export
 * Uses the browser-based Mermaid.js already loaded in the webview
 */
export class MermaidExportService {
    private webviewPanel: vscode.WebviewPanel | undefined;
    private pendingRequests: Map<string, MermaidRenderRequest>;
    private requestQueue: Array<() => Promise<void>>;
    private isProcessingQueue: boolean;

    constructor(webviewPanel?: vscode.WebviewPanel) {
        this.webviewPanel = webviewPanel;
        this.pendingRequests = new Map();
        this.requestQueue = [];
        this.isProcessingQueue = false;
    }

    /**
     * Set or update the webview panel
     */
    setWebviewPanel(panel: vscode.WebviewPanel): void {
        this.webviewPanel = panel;
    }

    /**
     * Check if service is ready (has webview panel)
     */
    isReady(): boolean {
        const ready = this.webviewPanel !== undefined;
        return ready;
    }

    /**
     * Render a single Mermaid diagram to SVG
     */
    async renderToSVG(code: string): Promise<string> {
        if (!this.webviewPanel) {
            throw new Error('No webview panel available for Mermaid rendering');
        }

        // Queue the request to ensure sequential processing
        return new Promise((resolve, reject) => {
            this.requestQueue.push(async () => {
                try {
                    const svg = await this.renderSingleDiagram(code);
                    resolve(svg);
                } catch (error) {
                    reject(error);
                }
            });

            // Start processing queue
            this.processQueue();
        });
    }

    /**
     * Render multiple Mermaid diagrams sequentially
     */
    async renderBatch(codes: string[]): Promise<Array<string | null>> {
        const results: Array<string | null> = [];

        for (let i = 0; i < codes.length; i++) {
            try {
                const svg = await this.renderToSVG(codes[i]);
                results.push(svg);
            } catch (error) {
                console.error(`[MermaidExportService] ❌ Diagram ${i + 1} failed:`, error);
                results.push(null);
            }
        }

        return results;
    }

    /**
     * Process queued render requests
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift();
            if (request) {
                try {
                    await request();
                } catch (error) {
                    console.error('[MermaidExportService] Queue processing error:', error);
                }
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Render a single diagram
     */
    private async renderSingleDiagram(code: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const requestId = `mermaid-export-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;


            // Create timeout (30 seconds)
            const timeout = setTimeout(() => {
                const request = this.pendingRequests.get(requestId);
                if (request) {
                    this.pendingRequests.delete(requestId);
                    console.error(`[MermaidExportService] Timeout: ${requestId}`);
                    reject(new Error('Mermaid rendering timeout (30s)'));
                }
            }, 30000);

            // Store request
            this.pendingRequests.set(requestId, {
                requestId,
                code,
                resolve,
                reject,
                timeout
            });

            // Send to webview
            this.webviewPanel!.webview.postMessage({
                type: 'renderMermaidForExport',
                requestId,
                code
            });
        });
    }

    /**
     * Handle render success response from webview
     */
    handleRenderSuccess(requestId: string, svg: string): void {
        const request = this.pendingRequests.get(requestId);

        if (request) {
            clearTimeout(request.timeout);
            request.resolve(svg);
            this.pendingRequests.delete(requestId);
        } else {
            console.warn(`[MermaidExportService] Unknown requestId: ${requestId}`);
        }
    }

    /**
     * Handle render error response from webview
     */
    handleRenderError(requestId: string, error: string): void {
        const request = this.pendingRequests.get(requestId);

        if (request) {
            console.error(`[MermaidExportService] ❌ Error response: ${requestId}`, error);
            clearTimeout(request.timeout);
            request.reject(new Error(error));
            this.pendingRequests.delete(requestId);
        }
    }

    /**
     * Cleanup all pending requests
     */
    cleanup(): void {

        // Reject all pending requests
        for (const [_requestId, request] of this.pendingRequests.entries()) {
            clearTimeout(request.timeout);
            request.reject(new Error('Service cleanup'));
        }

        this.pendingRequests.clear();
        this.requestQueue = [];
        this.isProcessingQueue = false;
    }

}

// Singleton instance for easy access across the application
let mermaidExportServiceInstance: MermaidExportService | undefined;

/**
 * Get the singleton MermaidExportService instance
 */
export function getMermaidExportService(): MermaidExportService {
    if (!mermaidExportServiceInstance) {
        mermaidExportServiceInstance = new MermaidExportService();
    }
    return mermaidExportServiceInstance;
}
