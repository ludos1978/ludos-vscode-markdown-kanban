/**
 * Plugin Configuration Service
 *
 * Reads/writes per-plugin JSON config files from `.kanban/{pluginId}.json`
 * at the workspace root. Provides a 3-layer fallback:
 *
 *   1. `.kanban/{pluginId}.json`  (primary — git-committable behavior settings)
 *   2. VS Code settings           (migration fallback via vscodeKeyMap)
 *   3. Schema defaults             (hardcoded in PluginConfigSchema.ts)
 *
 * Machine-specific tool paths (enginePath, pandoc.path, etc.) stay in VS Code
 * settings and are NOT managed by this service.
 *
 * @module services/PluginConfigService
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PLUGIN_CONFIG_SCHEMAS } from './PluginConfigSchema';
import { logger } from '../utils/logger';

const LOG_TAG = '[kanban.PluginConfigService]';

export class PluginConfigService implements vscode.Disposable {
    private static instance: PluginConfigService | undefined;

    /** In-memory cache: pluginId → parsed JSON (or null if file missing/invalid) */
    private cache = new Map<string, Record<string, unknown> | null>();

    /** Active file system watchers */
    private watchers: vscode.Disposable[] = [];

    /** Event emitter for config changes */
    private readonly _onDidChangeConfig = new vscode.EventEmitter<{ pluginId: string }>();
    public readonly onDidChangeConfig: vscode.Event<{ pluginId: string }> = this._onDidChangeConfig.event;

    private constructor() {}

    public static getInstance(): PluginConfigService {
        if (!PluginConfigService.instance) {
            PluginConfigService.instance = new PluginConfigService();
        }
        return PluginConfigService.instance;
    }

    // ============= READ =============

    /**
     * Get a single config value for a plugin, with 3-layer fallback.
     */
    getPluginConfig<T>(pluginId: string, key: string, defaultValue: T): T {
        // Layer 1: JSON file
        const fileConfig = this._getFileConfig(pluginId);
        if (fileConfig && key in fileConfig) {
            return fileConfig[key] as T;
        }

        // Layer 2: VS Code settings (migration fallback)
        const vscodeValue = this._getVSCodeValue(pluginId, key);
        if (vscodeValue !== undefined) {
            return vscodeValue as T;
        }

        // Layer 3: Schema default
        const schema = PLUGIN_CONFIG_SCHEMAS[pluginId];
        if (schema && key in schema.defaults) {
            return schema.defaults[key] as T;
        }

        return defaultValue;
    }

    /**
     * Get all config values for a plugin, merging all layers.
     * Returns a merged object: schema defaults ← VS Code settings ← JSON file.
     */
    getPluginConfigAll(pluginId: string): Record<string, unknown> {
        const schema = PLUGIN_CONFIG_SCHEMAS[pluginId];
        const result: Record<string, unknown> = {};

        // Start with schema defaults (layer 3)
        if (schema) {
            Object.assign(result, schema.defaults);
        }

        // Overlay VS Code settings (layer 2)
        if (schema) {
            for (const [key, vscodePath] of Object.entries(schema.vscodeKeyMap)) {
                const val = this._readVSCodeSetting(vscodePath);
                if (val !== undefined) {
                    result[key] = val;
                }
            }
        }

        // Overlay JSON file values (layer 1)
        const fileConfig = this._getFileConfig(pluginId);
        if (fileConfig) {
            Object.assign(result, fileConfig);
        }

        return result;
    }

    /**
     * Check if a `.kanban/{pluginId}.json` file exists in the workspace.
     */
    hasPluginConfigFile(pluginId: string): boolean {
        const filePath = this._getConfigFilePath(pluginId);
        return filePath !== undefined && fs.existsSync(filePath);
    }

    /**
     * Get the absolute path to a plugin's config file (may not exist).
     */
    getConfigFilePath(pluginId: string): string | undefined {
        return this._getConfigFilePath(pluginId);
    }

    // ============= WRITE =============

    /**
     * Set a single key in a plugin's JSON config file.
     * Creates `.kanban/` directory and the file if they don't exist.
     */
    async setPluginConfig(pluginId: string, key: string, value: unknown): Promise<void> {
        const current = this._readFileConfigFromDisk(pluginId) || {};
        current[key] = value;
        await this._writeFileConfig(pluginId, current);
    }

    /**
     * Replace an entire plugin's JSON config file.
     */
    async setPluginConfigAll(pluginId: string, config: Record<string, unknown>): Promise<void> {
        await this._writeFileConfig(pluginId, config);
    }

    // ============= LIFECYCLE =============

    /**
     * Set up file system watchers for the given plugin IDs.
     * Should be called after plugins are loaded.
     */
    initializeWatchers(pluginIds: string[]): void {
        const workspaceRoot = this._getWorkspaceRoot();
        if (!workspaceRoot) {
            return;
        }

        for (const pluginId of pluginIds) {
            const pattern = new vscode.RelativePattern(workspaceRoot, `.kanban/${pluginId}.json`);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            const handleChange = () => {
                this.cache.delete(pluginId);
                this._onDidChangeConfig.fire({ pluginId });
            };

            watcher.onDidChange(handleChange);
            watcher.onDidCreate(handleChange);
            watcher.onDidDelete(handleChange);

            this.watchers.push(watcher);
        }
    }

    dispose(): void {
        for (const w of this.watchers) {
            w.dispose();
        }
        this.watchers = [];
        this.cache.clear();
        this._onDidChangeConfig.dispose();
    }

    // ============= INTERNAL =============

    /**
     * Get cached or freshly-parsed file config for a plugin.
     */
    private _getFileConfig(pluginId: string): Record<string, unknown> | null {
        if (this.cache.has(pluginId)) {
            return this.cache.get(pluginId)!;
        }
        const config = this._readFileConfigFromDisk(pluginId);
        this.cache.set(pluginId, config);
        return config;
    }

    /**
     * Read and parse `.kanban/{pluginId}.json` from disk.
     * Returns null if file doesn't exist or contains invalid JSON.
     */
    private _readFileConfigFromDisk(pluginId: string): Record<string, unknown> | null {
        const filePath = this._getConfigFilePath(pluginId);
        if (!filePath || !fs.existsSync(filePath)) {
            return null;
        }

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
            logger.warn(`${LOG_TAG} ${pluginId}.json is not a JSON object, ignoring`);
            return null;
        } catch (err) {
            logger.warn(`${LOG_TAG} Failed to parse .kanban/${pluginId}.json, falling through to VS Code settings`, err);
            return null;
        }
    }

    /**
     * Write config object to `.kanban/{pluginId}.json`.
     */
    private async _writeFileConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
        const filePath = this._getConfigFilePath(pluginId);
        if (!filePath) {
            logger.warn(`${LOG_TAG} No workspace open, cannot write ${pluginId}.json`);
            return;
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        // Update cache immediately (watcher will also fire, but this avoids a race)
        this.cache.set(pluginId, { ...config });
    }

    /**
     * Get the absolute path to `.kanban/{pluginId}.json`.
     */
    private _getConfigFilePath(pluginId: string): string | undefined {
        const root = this._getWorkspaceRoot();
        if (!root) {
            return undefined;
        }
        return path.join(root, '.kanban', `${pluginId}.json`);
    }

    /**
     * Read a VS Code setting value for a plugin config key (layer 2).
     */
    private _getVSCodeValue(pluginId: string, key: string): unknown {
        const schema = PLUGIN_CONFIG_SCHEMAS[pluginId];
        if (!schema) {
            return undefined;
        }
        const vscodePath = schema.vscodeKeyMap[key];
        if (!vscodePath) {
            return undefined;
        }
        return this._readVSCodeSetting(vscodePath);
    }

    /**
     * Read a nested VS Code setting (e.g. 'marp.browser' → markdown-kanban.marp.browser).
     */
    private _readVSCodeSetting(settingPath: string): unknown {
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const parts = settingPath.split('.');
        let current: any = config;
        for (const part of parts) {
            if (current === undefined || current === null) {
                return undefined;
            }
            // vscode.WorkspaceConfiguration.get works with dotted paths
            if (current === config) {
                // For the first level, use get() which supports inspection
                current = config.get(settingPath);
                // If we got a value, return it; if undefined, the setting wasn't explicitly set
                // We need to check if it was explicitly set vs just returning the declared default
                const inspection = config.inspect(settingPath);
                if (inspection) {
                    // Return only if explicitly set somewhere (not just the declared default)
                    if (inspection.workspaceFolderValue !== undefined) return inspection.workspaceFolderValue;
                    if (inspection.workspaceValue !== undefined) return inspection.workspaceValue;
                    if (inspection.globalValue !== undefined) return inspection.globalValue;
                }
                return undefined;
            }
        }
        return undefined;
    }

    /**
     * Get the workspace root path.
     */
    private _getWorkspaceRoot(): string | undefined {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return undefined;
        }
        return folders[0].uri.fsPath;
    }
}

/** Singleton accessor */
export const pluginConfigService = PluginConfigService.getInstance();
