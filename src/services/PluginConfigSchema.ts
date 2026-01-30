/**
 * Plugin Configuration Schemas
 *
 * Defines the shape, defaults, and VS Code settings key mappings for
 * per-plugin JSON configuration files stored in `.kanban/{pluginId}.json`.
 *
 * Each schema entry contains:
 * - defaults: hardcoded fallback values (layer 3)
 * - vscodeKeyMap: maps plugin config keys → VS Code setting paths (layer 2 fallback)
 *
 * @module services/PluginConfigSchema
 */

// ============= Per-plugin config interfaces =============

export interface MarpPluginConfig {
    defaultTheme: string;
    allowLocalFiles: boolean;
    browser: 'auto' | 'chrome' | 'edge' | 'firefox';
    themeFolders: string[];
    keepTempFiles: boolean;
    availableClasses: string[];
    globalClasses: string[];
    localClasses: string[];
}

export interface EmbedPluginConfig {
    knownDomains: string[];
    defaultIframeAttributes: Record<string, string | boolean | number>;
    exportHandling: 'url' | 'fallback' | 'remove';
}

export interface ImageSearchPluginConfig {
    engine: 'google' | 'kagi' | 'bing' | 'duckduckgo' | 'custom';
    customUrl: string;
}

// ============= Schema registry type =============

export interface PluginConfigSchemaEntry {
    defaults: Record<string, unknown>;
    /** Maps plugin config key → VS Code setting path (under markdown-kanban.) */
    vscodeKeyMap: Record<string, string>;
}

// ============= Schema definitions =============

export const PLUGIN_CONFIG_SCHEMAS: Record<string, PluginConfigSchemaEntry> = {
    marp: {
        defaults: {
            defaultTheme: 'default',
            allowLocalFiles: true,
            browser: 'chrome',
            themeFolders: [],
            keepTempFiles: false,
            availableClasses: [
                'invert', 'center', 'center100', 'no_wordbreak', 'highlight',
                'column_spacing', 'column_border', 'fontbg',
                'font8', 'font10', 'font12', 'font13', 'font14', 'font15', 'font16',
                'font20', 'font22', 'font24', 'font26', 'font28', 'font29', 'font30',
                'font31', 'font32', 'font36', 'font50', 'font60', 'font80'
            ],
            globalClasses: [],
            localClasses: []
        } satisfies MarpPluginConfig as Record<string, unknown>,
        vscodeKeyMap: {
            defaultTheme: 'marp.defaultTheme',
            allowLocalFiles: 'marp.allowLocalFiles',
            browser: 'marp.browser',
            themeFolders: 'marp.themeFolders',
            keepTempFiles: 'marp.keepTempFiles',
            availableClasses: 'marp.availableClasses',
            globalClasses: 'marp.globalClasses',
            localClasses: 'marp.localClasses'
        }
    },
    embed: {
        defaults: {
            knownDomains: [
                'miro.com/app/live-embed',
                'miro.com/app/embed',
                'figma.com/embed',
                'figma.com/file',
                'figma.com/proto',
                'youtube.com/embed',
                'youtube-nocookie.com/embed',
                'youtu.be',
                'vimeo.com/video',
                'player.vimeo.com',
                'codepen.io/*/embed',
                'codesandbox.io/embed',
                'codesandbox.io/s',
                'stackblitz.com/edit',
                'jsfiddle.net/*/embedded',
                'docs.google.com/presentation',
                'docs.google.com/document',
                'docs.google.com/spreadsheets',
                'notion.so',
                'airtable.com/embed',
                'loom.com/embed',
                'loom.com/share',
                'prezi.com/p/embed',
                'prezi.com/v/embed',
                'ars.particify.de/present'
            ],
            defaultIframeAttributes: {
                width: '100%',
                height: '500px',
                frameborder: '0',
                allowfullscreen: true,
                loading: 'lazy',
                allow: 'fullscreen; clipboard-read; clipboard-write; autoplay; encrypted-media; picture-in-picture',
                referrerpolicy: 'strict-origin-when-cross-origin'
            },
            exportHandling: 'url'
        } satisfies EmbedPluginConfig as Record<string, unknown>,
        vscodeKeyMap: {
            knownDomains: 'embed.knownDomains',
            defaultIframeAttributes: 'embed.defaultIframeAttributes',
            exportHandling: 'embed.exportHandling'
        }
    },
    imagesearch: {
        defaults: {
            engine: 'google',
            customUrl: ''
        } satisfies ImageSearchPluginConfig as Record<string, unknown>,
        vscodeKeyMap: {
            engine: 'imageSearch.engine',
            customUrl: 'imageSearch.customUrl'
        }
    }
};
