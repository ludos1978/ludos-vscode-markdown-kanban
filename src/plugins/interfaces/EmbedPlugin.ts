/**
 * Embed Plugin Interface
 *
 * Defines the contract for the embed plugin so that core code
 * (PluginRegistry, ExportService, WebviewUpdateService) can
 * reference it without importing the concrete EmbedPlugin class.
 *
 * @module plugins/interfaces/EmbedPlugin
 */

export interface EmbedPluginInterface {
    readonly metadata: {
        id: string;
        name: string;
        version: string;
    };

    /** Get known embed domains from config */
    getKnownDomains(): string[];

    /** Get default iframe attributes from config */
    getDefaultIframeAttributes(): Record<string, string | boolean | number>;

    /** Get export handling mode from config */
    getExportHandling(): 'url' | 'fallback' | 'remove';

    /** Get web preview configuration */
    getWebPreviewConfig(): {
        enabled: boolean;
        mode: 'embed' | 'iframe';
        height: string;
        sandbox: string;
    };

    /** Get config subset for frontend webview sync */
    getWebviewConfig(): {
        knownDomains: string[];
        defaultIframeAttributes: Record<string, string | boolean | number>;
        webPreview: { enabled: boolean; mode: string; height: string; sandbox: string };
    };

    /** Apply embed transformation for export */
    transformForExport(content: string, mode: 'url' | 'fallback' | 'remove' | 'iframe'): string;
}
