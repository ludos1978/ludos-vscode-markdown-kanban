/**
 * Embed Plugin
 *
 * Owns all embed/iframe logic: domain detection, export transforms,
 * and webview config sync. Replaces scattered embed handling in
 * ExportService and frontend markdownRenderer.
 *
 * Config is read from PluginConfigService ('embed' schema).
 *
 * @module plugins/embed/EmbedPlugin
 */

import { pluginConfigService } from '../../services/PluginConfigService';
import { isEmbedUrl, parseAttributeBlock } from '../../shared/regexPatterns';
import { EmbedPluginConfig } from '../../services/PluginConfigSchema';
import { EmbedPluginInterface } from '../interfaces/EmbedPlugin';

export class EmbedPlugin implements EmbedPluginInterface {
    readonly metadata = {
        id: 'embed',
        name: 'Embed Plugin',
        version: '1.0.0'
    };

    /**
     * Get full embed config merged across all layers
     */
    getConfig(): EmbedPluginConfig {
        return pluginConfigService.getPluginConfigAll('embed') as unknown as EmbedPluginConfig;
    }

    /**
     * Get known embed domains from config
     */
    getKnownDomains(): string[] {
        const config = this.getConfig();
        return config?.knownDomains ?? [];
    }

    /**
     * Get default iframe attributes from config
     */
    getDefaultIframeAttributes(): Record<string, string | boolean | number> {
        const config = this.getConfig();
        return config?.defaultIframeAttributes ?? {};
    }

    /**
     * Get export handling mode from config
     */
    getExportHandling(): 'url' | 'fallback' | 'remove' {
        const config = this.getConfig();
        return config?.exportHandling ?? 'url';
    }

    /**
     * Get config subset for frontend webview sync
     */
    getWebviewConfig(): { knownDomains: string[]; defaultIframeAttributes: Record<string, string | boolean | number> } {
        return {
            knownDomains: this.getKnownDomains(),
            defaultIframeAttributes: this.getDefaultIframeAttributes()
        };
    }

    /**
     * Apply embed transformation based on export mode.
     * Handles ![alt](embed-url){.embed} and auto-detected embed URLs.
     *
     * Moved from ExportService.applyEmbedTransform().
     *
     * @param content - Markdown content
     * @param mode - 'url' (show link), 'fallback' (use alt image), 'remove' (strip embeds), 'iframe' (HTML iframe)
     * @returns Transformed content
     */
    transformForExport(content: string, mode: 'url' | 'fallback' | 'remove' | 'iframe'): string {
        const knownDomains = this.getKnownDomains();
        const defaultAttrs = this.getDefaultIframeAttributes();

        // Pattern to match markdown images with optional attributes
        // ![alt](url){attrs} or ![alt](url "title"){attrs}
        const imagePattern = /!\[([^\]]*)\]\(([^)\s"]+)(?:\s+"([^"]*)")?\)(\{[^}]+\})?/g;

        return content.replace(imagePattern, (match, alt, url, title, attrsBlock) => {
            // Parse attributes if present
            const attrs = attrsBlock ? parseAttributeBlock(attrsBlock) : {};

            // Check if this is an embed
            const hasEmbedClass = attrs.class && attrs.class.includes('embed');
            const hasEmbedAttr = 'embed' in attrs;
            const isKnownEmbed = isEmbedUrl(url, knownDomains);

            // If not an embed, return unchanged
            if (!hasEmbedClass && !hasEmbedAttr && !isKnownEmbed) {
                return match;
            }

            // Handle based on mode
            if (mode === 'remove') {
                return '';
            }

            // Get fallback image path
            const fallbackPath = attrs.fallback || (EmbedPlugin.isImagePath(alt) ? alt : null);

            // Get readable title if available
            const displayTitle = title || attrs.title || (alt && !EmbedPlugin.isImagePath(alt) ? alt : null);

            if (mode === 'iframe') {
                // HTML mode: Generate actual iframe tag
                const width = attrs.width || defaultAttrs.width;
                const height = attrs.height || defaultAttrs.height;
                const frameborder = attrs.frameborder ?? defaultAttrs.frameborder ?? '0';
                const allowfullscreen = attrs.allowfullscreen ?? defaultAttrs.allowfullscreen;

                let iframeAttrs = `src="${url}" width="${width}" height="${height}" frameborder="${frameborder}"`;
                if (allowfullscreen) {
                    iframeAttrs += ' allowfullscreen';
                }

                const titleHtml = displayTitle ? `<p><em>${displayTitle}</em></p>\n` : '';
                return `${titleHtml}<iframe ${iframeAttrs}></iframe>`;
            }

            if (mode === 'fallback' && fallbackPath) {
                // Replace with fallback image plus full URL below
                const titleLine = displayTitle ? `*${displayTitle}*\n>\n> ` : '';
                return `![](${fallbackPath})\n\n> ${titleLine}🔗 [${url}](${url})`;
            }

            // Default mode ('url'): Show full URL as visible clickable text
            const titleLine = displayTitle ? `**${displayTitle}**\n>\n> ` : '';

            // Return as a blockquote with the full URL visible and clickable
            return `> 🔗 ${titleLine}[${url}](${url})`;
        });
    }

    /**
     * Check if a string looks like an image path.
     * Moved from ExportService.isImagePath().
     */
    static isImagePath(str: string): boolean {
        if (!str) return false;
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'];
        const lower = str.toLowerCase();
        return imageExtensions.some(ext => lower.endsWith(ext));
    }
}
