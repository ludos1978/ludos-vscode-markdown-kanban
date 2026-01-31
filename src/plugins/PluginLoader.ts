/**
 * Plugin Loader
 *
 * Responsible for loading and initializing all built-in plugins.
 * Called during extension activation to set up the plugin system.
 *
 * Supports enable/disable via VS Code settings:
 *   markdown-kanban.plugins.disabled: string[]
 *
 * @module plugins/PluginLoader
 */

import * as vscode from 'vscode';
import { PluginRegistry } from './registry/PluginRegistry';
import { PluginContext, DiagramPluginContext } from './interfaces';
import { PluginConfigService } from '../services/PluginConfigService';
import { PLUGIN_CONFIG_SCHEMAS } from '../services/PluginConfigSchema';

// Import plugins
import { ColumnIncludePlugin } from './import/ColumnIncludePlugin';
import { TaskIncludePlugin } from './import/TaskIncludePlugin';
import { RegularIncludePlugin } from './import/RegularIncludePlugin';
import { MarpExportPlugin } from './export/MarpExportPlugin';
import { PandocExportPlugin } from './export/PandocExportPlugin';
import { EmbedPlugin } from './embed/EmbedPlugin';

// Diagram plugins
import { PlantUMLPlugin } from './diagram/PlantUMLPlugin';
import { MermaidPlugin } from './diagram/MermaidPlugin';
import { DrawIOPlugin } from './diagram/DrawIOPlugin';
import { ExcalidrawPlugin } from './diagram/ExcalidrawPlugin';
import { PDFPlugin } from './diagram/PDFPlugin';
import { EPUBPlugin } from './diagram/EPUBPlugin';
import { XlsxPlugin } from './diagram/XlsxPlugin';
import { DocumentPlugin } from './diagram/DocumentPlugin';

// Markdown-it plugin manifest
import { MARKDOWN_PLUGIN_MANIFEST } from './markdown/markdownPluginManifest';

/**
 * Check if a plugin is disabled via VS Code settings
 */
function isPluginDisabled(pluginId: string): boolean {
    const config = vscode.workspace.getConfiguration('markdown-kanban');
    const disabledPlugins = config.get<string[]>('plugins.disabled', []);
    return disabledPlugins.includes(pluginId);
}

/**
 * Plugin Loader
 *
 * Static class that loads and initializes all built-in plugins.
 * Can be extended to support loading external plugins in the future.
 */
export class PluginLoader {
    private static _loaded: boolean = false;

    /**
     * Load all built-in plugins into the registry
     *
     * This should be called once during extension activation.
     * Safe to call multiple times (idempotent).
     */
    static loadBuiltinPlugins(): void {
        if (this._loaded) {
            return;
        }

        const registry = PluginRegistry.getInstance();

        // ============= IMPORT PLUGINS =============
        // Order matters: higher priority plugins are checked first

        // Column Include Plugin (priority: 100)
        // Handles !!!include()!!! in column headers
        try {
            registry.registerImportPlugin(new ColumnIncludePlugin());
        } catch (error) {
            console.error('[PluginLoader] Failed to register ColumnIncludePlugin:', error);
        }

        // Task Include Plugin (priority: 90)
        // Handles !!!include()!!! in task titles
        try {
            registry.registerImportPlugin(new TaskIncludePlugin());
        } catch (error) {
            console.error('[PluginLoader] Failed to register TaskIncludePlugin:', error);
        }

        // Regular Include Plugin (priority: 80)
        // Handles !!!include()!!! in task descriptions
        try {
            registry.registerImportPlugin(new RegularIncludePlugin());
        } catch (error) {
            console.error('[PluginLoader] Failed to register RegularIncludePlugin:', error);
        }

        // ============= EXPORT PLUGINS =============

        // Marp Export Plugin
        // Handles PDF, PPTX, HTML exports via Marp CLI
        if (!isPluginDisabled('marp')) {
            try {
                registry.registerExportPlugin(new MarpExportPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register MarpExportPlugin:', error);
            }
        }

        // Pandoc Export Plugin
        // Handles DOCX, ODT, EPUB exports via Pandoc
        if (!isPluginDisabled('pandoc')) {
            try {
                registry.registerExportPlugin(new PandocExportPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register PandocExportPlugin:', error);
            }
        }

        // ============= EMBED PLUGIN =============

        // Embed Plugin — owns embed/iframe config, export transform, webview sync
        if (!isPluginDisabled('embed')) {
            try {
                registry.registerEmbedPlugin(new EmbedPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register EmbedPlugin:', error);
            }
        }

        // ============= DIAGRAM PLUGINS =============

        // PlantUML Plugin — renders ```plantuml code blocks to SVG
        if (!isPluginDisabled('plantuml')) {
            try {
                registry.registerDiagramPlugin(new PlantUMLPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register PlantUMLPlugin:', error);
            }
        }

        // Mermaid Plugin — renders ```mermaid code blocks to SVG via webview
        if (!isPluginDisabled('mermaid')) {
            try {
                registry.registerDiagramPlugin(new MermaidPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register MermaidPlugin:', error);
            }
        }

        // Draw.io Plugin — renders .drawio/.dio files to PNG
        if (!isPluginDisabled('drawio')) {
            try {
                registry.registerDiagramPlugin(new DrawIOPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register DrawIOPlugin:', error);
            }
        }

        // Excalidraw Plugin — renders .excalidraw files to SVG
        if (!isPluginDisabled('excalidraw')) {
            try {
                registry.registerDiagramPlugin(new ExcalidrawPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register ExcalidrawPlugin:', error);
            }
        }

        // PDF Plugin — renders PDF pages to PNG
        if (!isPluginDisabled('pdf')) {
            try {
                registry.registerDiagramPlugin(new PDFPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register PDFPlugin:', error);
            }
        }

        // EPUB Plugin — renders EPUB pages to PNG
        if (!isPluginDisabled('epub')) {
            try {
                registry.registerDiagramPlugin(new EPUBPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register EPUBPlugin:', error);
            }
        }

        // XLSX Plugin — renders spreadsheet sheets to PNG
        if (!isPluginDisabled('xlsx')) {
            try {
                registry.registerDiagramPlugin(new XlsxPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register XlsxPlugin:', error);
            }
        }

        // Document Plugin — renders DOCX, DOC, ODT, PPTX, PPT, ODP via LibreOffice + pdftoppm
        if (!isPluginDisabled('document')) {
            try {
                registry.registerDiagramPlugin(new DocumentPlugin());
            } catch (error) {
                console.error('[PluginLoader] Failed to register DocumentPlugin:', error);
            }
        }

        // ============= MARKDOWN-IT PLUGINS =============
        // Register metadata entries from the shared manifest (Phase 5).
        // Actual plugin code is loaded at runtime by each rendering context.
        for (const entry of MARKDOWN_PLUGIN_MANIFEST) {
            if (!isPluginDisabled(entry.id)) {
                registry.registerMarkdownPlugin(entry);
            }
        }

        this._loaded = true;
    }

    /**
     * Initialize the plugin registry with context
     *
     * Call after loadBuiltinPlugins() to activate plugins.
     */
    static async initializePlugins(context: PluginContext): Promise<void> {
        const registry = PluginRegistry.getInstance();

        if (!this._loaded) {
            console.warn('[PluginLoader] Plugins not loaded yet, loading now...');
            this.loadBuiltinPlugins();
        }

        await registry.initialize(context);
    }

    /**
     * Initialize diagram plugins with webview context
     *
     * Called when a webview panel is created/available,
     * so diagram plugins that need the webview (Mermaid) can activate.
     */
    static async initializeDiagramPlugins(context: DiagramPluginContext): Promise<void> {
        const registry = PluginRegistry.getInstance();
        await registry.activateDiagramPlugins(context);
    }

    /**
     * Initialize file system watchers for per-plugin config files.
     * Sets up watchers for all plugin IDs that have a schema defined
     * in PluginConfigSchema.
     */
    static initializePluginConfigWatchers(configService: PluginConfigService): void {
        const pluginIds = Object.keys(PLUGIN_CONFIG_SCHEMAS);
        configService.initializeWatchers(pluginIds);
    }
}
