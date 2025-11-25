/**
 * Plugin Registry
 *
 * Central registry for managing import and export plugins.
 * Handles registration, discovery, and conflict resolution.
 *
 * @module plugins/registry/PluginRegistry
 */

import {
    ImportPlugin,
    ImportContext,
    IncludeMatch,
    ExportPlugin,
    ExportFormat,
    PluginContext
} from '../interfaces';

/**
 * Validation result for plugin registration
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Plugin Registry - Singleton
 *
 * Central registry for all import and export plugins.
 * Provides discovery, validation, and conflict resolution.
 */
export class PluginRegistry {
    private static _instance: PluginRegistry;

    private _importPlugins: Map<string, ImportPlugin> = new Map();
    private _exportPlugins: Map<string, ExportPlugin> = new Map();
    private _initialized: boolean = false;
    private _context: PluginContext = {};

    private constructor() {
        // Singleton - use getInstance()
    }

    /**
     * Get singleton instance
     */
    static getInstance(): PluginRegistry {
        if (!PluginRegistry._instance) {
            PluginRegistry._instance = new PluginRegistry();
        }
        return PluginRegistry._instance;
    }

    /**
     * Reset the singleton (for testing)
     */
    static resetInstance(): void {
        if (PluginRegistry._instance) {
            PluginRegistry._instance._importPlugins.clear();
            PluginRegistry._instance._exportPlugins.clear();
            PluginRegistry._instance._initialized = false;
        }
        PluginRegistry._instance = undefined as any;
    }

    // ============= INITIALIZATION =============

    /**
     * Initialize the registry with context
     */
    async initialize(context: PluginContext): Promise<void> {
        this._context = context;
        this._initialized = true;

        // Activate all registered plugins
        for (const plugin of this._importPlugins.values()) {
            if (plugin.activate) {
                try {
                    await plugin.activate(context);
                } catch (error) {
                    console.error(`[PluginRegistry] Failed to activate import plugin ${plugin.metadata.id}:`, error);
                }
            }
        }

        for (const plugin of this._exportPlugins.values()) {
            // Export plugins don't have activate in current interface, but may in future
        }

        console.log('[PluginRegistry] Initialized');
    }

    /**
     * Check if registry is initialized
     */
    isInitialized(): boolean {
        return this._initialized;
    }

    // ============= IMPORT PLUGIN REGISTRATION =============

    /**
     * Register an import plugin
     *
     * @param plugin - Plugin to register
     * @throws Error if plugin is invalid
     */
    registerImportPlugin(plugin: ImportPlugin): void {
        const validation = this._validateImportPlugin(plugin);

        if (!validation.valid) {
            throw new Error(`Invalid import plugin '${plugin.metadata.id}': ${validation.errors.join(', ')}`);
        }

        if (validation.warnings.length > 0) {
            console.warn(`[PluginRegistry] Import plugin '${plugin.metadata.id}' warnings:`, validation.warnings);
        }

        // Check for existing plugin with same ID
        if (this._importPlugins.has(plugin.metadata.id)) {
            console.warn(`[PluginRegistry] Replacing existing import plugin: ${plugin.metadata.id}`);
        }

        this._importPlugins.set(plugin.metadata.id, plugin);
        console.log(`[PluginRegistry] Registered import plugin: ${plugin.metadata.id} (priority: ${plugin.metadata.priority})`);
    }

    /**
     * Unregister an import plugin
     */
    unregisterImportPlugin(pluginId: string): boolean {
        const plugin = this._importPlugins.get(pluginId);
        if (plugin) {
            if (plugin.deactivate) {
                plugin.deactivate().catch(err =>
                    console.error(`[PluginRegistry] Error deactivating plugin ${pluginId}:`, err)
                );
            }
            this._importPlugins.delete(pluginId);
            console.log(`[PluginRegistry] Unregistered import plugin: ${pluginId}`);
            return true;
        }
        return false;
    }

    /**
     * Get an import plugin by ID
     */
    getImportPlugin(pluginId: string): ImportPlugin | undefined {
        return this._importPlugins.get(pluginId);
    }

    /**
     * Get all registered import plugins
     */
    getAllImportPlugins(): ImportPlugin[] {
        return Array.from(this._importPlugins.values());
    }

    /**
     * Get import plugins sorted by priority (highest first)
     */
    getImportPluginsByPriority(): ImportPlugin[] {
        return this.getAllImportPlugins().sort((a, b) => b.metadata.priority - a.metadata.priority);
    }

    // ============= EXPORT PLUGIN REGISTRATION =============

    /**
     * Register an export plugin
     */
    registerExportPlugin(plugin: ExportPlugin): void {
        const validation = this._validateExportPlugin(plugin);

        if (!validation.valid) {
            throw new Error(`Invalid export plugin '${plugin.metadata.id}': ${validation.errors.join(', ')}`);
        }

        if (this._exportPlugins.has(plugin.metadata.id)) {
            console.warn(`[PluginRegistry] Replacing existing export plugin: ${plugin.metadata.id}`);
        }

        this._exportPlugins.set(plugin.metadata.id, plugin);
        console.log(`[PluginRegistry] Registered export plugin: ${plugin.metadata.id}`);
    }

    /**
     * Unregister an export plugin
     */
    unregisterExportPlugin(pluginId: string): boolean {
        if (this._exportPlugins.delete(pluginId)) {
            console.log(`[PluginRegistry] Unregistered export plugin: ${pluginId}`);
            return true;
        }
        return false;
    }

    /**
     * Get an export plugin by ID
     */
    getExportPlugin(pluginId: string): ExportPlugin | undefined {
        return this._exportPlugins.get(pluginId);
    }

    /**
     * Get all registered export plugins
     */
    getAllExportPlugins(): ExportPlugin[] {
        return Array.from(this._exportPlugins.values());
    }

    // ============= IMPORT PLUGIN DISCOVERY =============

    /**
     * Find the best import plugin for a given path and context
     *
     * @param path - File path to handle
     * @param context - Import context
     * @returns Best matching plugin or null
     */
    findImportPlugin(path: string, context: ImportContext): ImportPlugin | null {
        const sortedPlugins = this.getImportPluginsByPriority();

        for (const plugin of sortedPlugins) {
            if (plugin.canHandle(path, context)) {
                return plugin;
            }
        }

        return null;
    }

    /**
     * Find import plugin by file type
     */
    findImportPluginByFileType(fileType: string): ImportPlugin | null {
        for (const plugin of this._importPlugins.values()) {
            if (plugin.metadata.fileType === fileType) {
                return plugin;
            }
        }
        return null;
    }

    /**
     * Detect all includes in content using registered plugins
     *
     * This is the main entry point for include detection, replacing
     * direct INCLUDE_SYNTAX.REGEX usage in markdownParser.
     *
     * @param content - Content to search
     * @param context - Context about where the content comes from
     * @returns All detected includes, deduplicated by position
     */
    detectIncludes(content: string, context: ImportContext): IncludeMatch[] {
        const allMatches: IncludeMatch[] = [];
        const sortedPlugins = this.getImportPluginsByPriority();

        for (const plugin of sortedPlugins) {
            // Only use plugins that match the context location
            if (plugin.metadata.contextLocation !== context.location &&
                plugin.metadata.contextLocation !== 'any') {
                continue;
            }

            const matches = plugin.detectIncludes(content, context);
            allMatches.push(...matches);
        }

        // Deduplicate by position (first match wins due to priority sorting)
        return this._deduplicateMatches(allMatches);
    }

    // ============= EXPORT PLUGIN DISCOVERY =============

    /**
     * Find export plugin that supports a format
     */
    findExportPlugin(formatId: string): ExportPlugin | null {
        for (const plugin of this._exportPlugins.values()) {
            const formats = plugin.getSupportedFormats();
            if (formats.some(f => f.id === formatId)) {
                return plugin;
            }
        }
        return null;
    }

    /**
     * Get all supported export formats across all plugins
     */
    getSupportedExportFormats(): ExportFormat[] {
        const formats: ExportFormat[] = [];

        for (const plugin of this._exportPlugins.values()) {
            formats.push(...plugin.getSupportedFormats());
        }

        return formats;
    }

    // ============= VALIDATION =============

    /**
     * Validate an import plugin before registration
     */
    private _validateImportPlugin(plugin: ImportPlugin): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Required metadata
        if (!plugin.metadata) {
            errors.push('Missing metadata');
            return { valid: false, errors, warnings };
        }

        if (!plugin.metadata.id || plugin.metadata.id.trim() === '') {
            errors.push('Missing or empty plugin ID');
        }

        if (!plugin.metadata.includePattern) {
            errors.push('Missing include pattern');
        }

        if (typeof plugin.metadata.priority !== 'number') {
            errors.push('Missing or invalid priority (must be a number)');
        }

        // Required methods
        if (typeof plugin.canHandle !== 'function') {
            errors.push('Missing canHandle method');
        }

        if (typeof plugin.detectIncludes !== 'function') {
            errors.push('Missing detectIncludes method');
        }

        if (typeof plugin.createFile !== 'function') {
            errors.push('Missing createFile method');
        }

        // Check for pattern conflicts with existing plugins
        if (plugin.metadata.includePattern) {
            for (const existing of this._importPlugins.values()) {
                if (existing.metadata.id !== plugin.metadata.id &&
                    existing.metadata.includePattern.source === plugin.metadata.includePattern.source &&
                    existing.metadata.contextLocation === plugin.metadata.contextLocation) {
                    warnings.push(`Pattern conflict with existing plugin: ${existing.metadata.id}`);
                }
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate an export plugin before registration
     */
    private _validateExportPlugin(plugin: ExportPlugin): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!plugin.metadata) {
            errors.push('Missing metadata');
            return { valid: false, errors, warnings };
        }

        if (!plugin.metadata.id || plugin.metadata.id.trim() === '') {
            errors.push('Missing or empty plugin ID');
        }

        if (!plugin.metadata.formats || plugin.metadata.formats.length === 0) {
            errors.push('Missing or empty formats array');
        }

        if (typeof plugin.getSupportedFormats !== 'function') {
            errors.push('Missing getSupportedFormats method');
        }

        if (typeof plugin.canExport !== 'function') {
            errors.push('Missing canExport method');
        }

        if (typeof plugin.export !== 'function') {
            errors.push('Missing export method');
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    // ============= UTILITIES =============

    /**
     * Deduplicate matches by position (higher priority plugin wins)
     */
    private _deduplicateMatches(matches: IncludeMatch[]): IncludeMatch[] {
        const result: IncludeMatch[] = [];

        for (const match of matches) {
            // Check if this position overlaps with any existing match
            const overlapping = result.find(m =>
                (match.startIndex >= m.startIndex && match.startIndex < m.endIndex) ||
                (match.endIndex > m.startIndex && match.endIndex <= m.endIndex) ||
                (match.startIndex <= m.startIndex && match.endIndex >= m.endIndex)
            );

            if (!overlapping) {
                result.push(match);
            }
            // If overlapping, the earlier match (higher priority) wins
        }

        return result;
    }

    /**
     * Get debug info about registered plugins
     */
    getDebugInfo(): { import: any[]; export: any[] } {
        return {
            import: this.getAllImportPlugins().map(p => ({
                id: p.metadata.id,
                name: p.metadata.name,
                priority: p.metadata.priority,
                fileType: p.metadata.fileType,
                contextLocation: p.metadata.contextLocation,
                pattern: p.metadata.includePattern.source
            })),
            export: this.getAllExportPlugins().map(p => ({
                id: p.metadata.id,
                name: p.metadata.name,
                formats: p.metadata.formats.map(f => f.id)
            }))
        };
    }
}
