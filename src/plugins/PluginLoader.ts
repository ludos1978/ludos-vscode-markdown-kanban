/**
 * Plugin Loader
 *
 * Responsible for loading and initializing all built-in plugins.
 * Called during extension activation to set up the plugin system.
 *
 * @module plugins/PluginLoader
 */

import { PluginRegistry } from './registry/PluginRegistry';
import { PluginContext } from './interfaces';

// Import plugins
import { ColumnIncludePlugin } from './import/ColumnIncludePlugin';
import { TaskIncludePlugin } from './import/TaskIncludePlugin';
import { RegularIncludePlugin } from './import/RegularIncludePlugin';
import { MarpExportPlugin } from './export/MarpExportPlugin';

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
            console.log('[PluginLoader] Built-in plugins already loaded, skipping');
            return;
        }

        const registry = PluginRegistry.getInstance();

        console.log('[PluginLoader] Loading built-in plugins...');

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
        try {
            registry.registerExportPlugin(new MarpExportPlugin());
        } catch (error) {
            console.error('[PluginLoader] Failed to register MarpExportPlugin:', error);
        }

        this._loaded = true;

        // Log summary
        const debugInfo = registry.getDebugInfo();
        console.log(`[PluginLoader] Loaded ${debugInfo.import.length} import plugins, ${debugInfo.export.length} export plugins`);
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
     * Check if plugins have been loaded
     */
    static isLoaded(): boolean {
        return this._loaded;
    }

    /**
     * Reset loader state (for testing)
     */
    static reset(): void {
        this._loaded = false;
        PluginRegistry.resetInstance();
    }

    /**
     * Get debug information about loaded plugins
     */
    static getDebugInfo(): { import: any[]; export: any[] } {
        const registry = PluginRegistry.getInstance();
        return registry.getDebugInfo();
    }
}
