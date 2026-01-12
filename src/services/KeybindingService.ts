/**
 * KeybindingService
 *
 * Handles VS Code keybinding discovery and management.
 * Extracts keybinding logic from MessageHandler for better separation of concerns.
 *
 * @module services/KeybindingService
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * VS Code keybinding entry structure from keybindings.json
 */
interface VSCodeKeybinding {
    key: string;
    command: string;
    when?: string;
    args?: unknown;
}

interface ShortcutEntry {
    command: string;
    args?: unknown;
}

/**
 * KeybindingService - Singleton service for keybinding management
 */
export class KeybindingService {
    private static instance: KeybindingService | undefined;

    /** Cache TTL for VS Code commands list */
    private static readonly COMMANDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private static readonly SNIPPETS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    /** Cached list of available VS Code commands */
    private _cachedCommands: string[] | null = null;
    private _cachedCommandsTimestamp: number = 0;
    private _cachedSnippets: Map<string, string> | null = null;
    private _cachedSnippetsTimestamp: number = 0;

    private constructor() {}

    public static getInstance(): KeybindingService {
        if (!KeybindingService.instance) {
            KeybindingService.instance = new KeybindingService();
        }
        return KeybindingService.instance;
    }

    public async resolveSnippetByName(name: string): Promise<string | null> {
        if (!name) {
            return null;
        }
        const now = Date.now();
        if (!this._cachedSnippets || (now - this._cachedSnippetsTimestamp) > KeybindingService.SNIPPETS_CACHE_TTL) {
            this._cachedSnippets = await this._loadVSCodeSnippets();
            this._cachedSnippetsTimestamp = now;
        }
        return this._cachedSnippets.get(name) || null;
    }

    /**
     * Get all available shortcuts as a map (shortcut -> command)
     * This is called when the webview gains focus to refresh shortcuts
     */
    async getAllShortcuts(): Promise<Record<string, ShortcutEntry>> {
        const shortcutMap: Record<string, ShortcutEntry> = {};

        try {
            // 1. Load user keybindings first (lowest priority)
            const keybindings = await this.loadVSCodeKeybindings();

            // Build shortcut map from user keybindings
            // Include ALL commands (including snippets - they're handled by handleVSCodeSnippet)
            for (const binding of keybindings) {
                if (binding.key && binding.command && !binding.command.startsWith('-')) {
                    // Normalize the key format
                    const normalizedKey = this._normalizeKeybinding(binding.key);
                    shortcutMap[normalizedKey] = {
                        command: binding.command,
                        args: binding.args
                    };
                }
            }

            // 2. Add VSCode default shortcuts (highest priority - overrides user keybindings)
            const extensionShortcuts = await this.getExtensionShortcuts();
            Object.assign(shortcutMap, extensionShortcuts);

        } catch (error) {
            console.error('[KeybindingService] Failed to load shortcuts:', error);
        }

        return shortcutMap;
    }

    private async getExtensionShortcuts(): Promise<Record<string, ShortcutEntry>> {
        const isMac = process.platform === 'darwin';
        const mod = isMac ? 'meta' : 'ctrl';

        // VSCode commands that need backend processing
        // Since VSCode doesn't expose a keybindings API, we maintain this list
        //
        // IMPORTANT: Only include commands that actually need VSCode backend processing.
        // Clipboard, selection, and basic editing should be handled by the browser.
        const extensionShortcuts: Record<string, string> = {
            // Text transformation commands (these need VSCode backend)
            [`${mod}+/`]: 'editor.action.commentLine',
            [`${mod}+[`]: 'editor.action.outdentLines',
            [`${mod}+]`]: 'editor.action.indentLines',

            // Text formatting (markdown extensions)
            [`${mod}+b`]: 'editor.action.fontBold',
            [`${mod}+i`]: 'editor.action.fontItalic',

            // Line manipulation (these modify text in complex ways)
            'alt+up': 'editor.action.moveLinesUpAction',
            'alt+down': 'editor.action.moveLinesDownAction',
            [`${mod}+shift+d`]: 'editor.action.copyLinesDownAction',
            [`${mod}+shift+k`]: 'editor.action.deleteLines',

            // Translation extensions (need backend to call extension)
            'alt+t': 'deepl.translate',
            'shift+alt+t': 'deepl.translateTo',

            // NOTE: The following are NOT included because they should work natively:
            // - Clipboard (Cmd+V, Cmd+C, Cmd+X) - browser handles these
            // - Select All (Cmd+A) - browser selection works fine
            // - Undo/Redo (Cmd+Z, Cmd+Y) - Kanban has its own undo system
            // - Cursor/word navigation - browser handles these
            // - Multi-cursor - doesn't work well in single-line inputs
        };

        // Verify commands actually exist (use cached commands list for performance)
        const now = Date.now();
        if (!this._cachedCommands || (now - this._cachedCommandsTimestamp) > KeybindingService.COMMANDS_CACHE_TTL) {
            this._cachedCommands = await vscode.commands.getCommands();
            this._cachedCommandsTimestamp = now;
        }
        const allCommands = this._cachedCommands;
        const validShortcuts: Record<string, ShortcutEntry> = {};

        for (const [shortcut, command] of Object.entries(extensionShortcuts)) {
            if (allCommands.includes(command)) {
                const normalizedKey = this._normalizeKeybinding(shortcut);
                validShortcuts[normalizedKey] = { command };
            }
        }

        return validShortcuts;
    }

    private _normalizeKeybinding(key: string): string {
        if (!key) {
            return '';
        }
        const normalized = key
            .toLowerCase()
            .replace(/cmd/g, 'meta')
            .replace(/\s+/g, '');
        const parts = normalized.split('+').filter(Boolean);
        const modifiers = new Set<string>();
        let mainKey = '';

        for (const part of parts) {
            if (part === 'ctrl' || part === 'meta' || part === 'alt' || part === 'shift') {
                modifiers.add(part);
            } else {
                mainKey = part;
            }
        }

        const orderedModifiers = ['ctrl', 'meta', 'alt', 'shift'].filter((mod) => modifiers.has(mod));
        if (!mainKey) {
            return orderedModifiers.join('+');
        }
        const prefix = orderedModifiers.length > 0 ? `${orderedModifiers.join('+')}+` : '';
        return `${prefix}${mainKey}`;
    }

    private async loadVSCodeKeybindings(): Promise<VSCodeKeybinding[]> {
        try {
            // Load user keybindings
            const userKeybindingsPath = this.getUserKeybindingsPath();
            let keybindings: VSCodeKeybinding[] = [];

            if (userKeybindingsPath && fs.existsSync(userKeybindingsPath)) {
                const content = fs.readFileSync(userKeybindingsPath, 'utf8');
                // Handle JSON with comments
                const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                const userKeybindings = JSON.parse(jsonContent);
                if (Array.isArray(userKeybindings)) {
                    keybindings = keybindings.concat(userKeybindings);
                }
            }

            // Also load workspace keybindings if they exist
            const workspaceKeybindingsPath = this.getWorkspaceKeybindingsPath();
            if (workspaceKeybindingsPath && fs.existsSync(workspaceKeybindingsPath)) {
                const content = fs.readFileSync(workspaceKeybindingsPath, 'utf8');
                const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                const workspaceKeybindings = JSON.parse(jsonContent);
                if (Array.isArray(workspaceKeybindings)) {
                    keybindings = keybindings.concat(workspaceKeybindings);
                }
            }

            return keybindings;

        } catch (error) {
            console.error('[KeybindingService] Failed to load VS Code keybindings:', error);
            return [];
        }
    }

    private async _loadVSCodeSnippets(): Promise<Map<string, string>> {
        const snippets = new Map<string, string>();
        try {
            const userSnippetDir = this.getUserSnippetDir();
            if (userSnippetDir && fs.existsSync(userSnippetDir)) {
                this._loadSnippetFilesFromDir(userSnippetDir, snippets);
            }
            const workspaceSnippetDir = this.getWorkspaceSnippetDir();
            if (workspaceSnippetDir && fs.existsSync(workspaceSnippetDir)) {
                this._loadSnippetFilesFromDir(workspaceSnippetDir, snippets);
            }
        } catch (error) {
            console.error('[KeybindingService] Failed to load snippets:', error);
        }
        return snippets;
    }

    private _loadSnippetFilesFromDir(dir: string, snippets: Map<string, string>): void {
        const files = fs.readdirSync(dir);
        const snippetFiles = files.filter((file) => file.endsWith('.json') || file.endsWith('.code-snippets'));
        for (const file of snippetFiles) {
            const filePath = path.join(dir, file);
            if (!fs.existsSync(filePath)) {
                continue;
            }
            const snippetData = this._readSnippetFile(filePath);
            if (!snippetData || typeof snippetData !== 'object') {
                continue;
            }
            for (const [name, value] of Object.entries(snippetData)) {
                const snippet = value as { body?: string | string[] };
                if (!snippet || snippet.body === undefined || snippet.body === null) {
                    continue;
                }
                if (typeof snippet.body === 'string') {
                    snippets.set(name, snippet.body);
                } else if (Array.isArray(snippet.body)) {
                    snippets.set(name, snippet.body.join('\n'));
                }
            }
        }
    }

    private _readSnippetFile(filePath: string): Record<string, unknown> | null {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const jsonContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
            const parsed = JSON.parse(jsonContent);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
        } catch (error) {
            console.error('[KeybindingService] Failed to read snippet file:', filePath, error);
            return null;
        }
    }

    private getUserKeybindingsPath(): string | null {
        try {
            const userDataDir = this.getVSCodeUserDataDir();
            if (userDataDir) {
                return path.join(userDataDir, 'User', 'keybindings.json');
            }
            return null;
        } catch (error) {
            console.error('[KeybindingService] Failed to get user keybindings path:', error);
            return null;
        }
    }

    private getWorkspaceKeybindingsPath(): string | null {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                return path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'keybindings.json');
            }
            return null;
        } catch (error) {
            console.error('[KeybindingService] Failed to get workspace keybindings path:', error);
            return null;
        }
    }

    private getUserSnippetDir(): string | null {
        const userDataDir = this.getVSCodeUserDataDir();
        if (!userDataDir) {
            return null;
        }
        return path.join(userDataDir, 'User', 'snippets');
    }

    private getWorkspaceSnippetDir(): string | null {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                return path.join(workspaceFolders[0].uri.fsPath, '.vscode');
            }
            return null;
        } catch (error) {
            console.error('[KeybindingService] Failed to get workspace snippet dir:', error);
            return null;
        }
    }

    private getVSCodeUserDataDir(): string | null {
        const platform = os.platform();
        const homeDir = os.homedir();

        switch (platform) {
            case 'win32':
                return path.join(process.env.APPDATA || '', 'Code');
            case 'darwin':
                return path.join(homeDir, 'Library', 'Application Support', 'Code');
            case 'linux':
                return path.join(homeDir, '.config', 'Code');
            default:
                return null;
        }
    }
}
