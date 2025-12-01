import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TemplateParser, TemplateDefinition } from './TemplateParser';

/**
 * Template summary for UI display
 */
export interface TemplateSummary {
    name: string;
    description?: string;
    icon?: string;
    path: string;  // Absolute path to template folder
}

/**
 * Service for managing column templates
 * Handles scanning, loading, and listing templates from the configured path
 */
export class TemplateService {
    private _templates: Map<string, TemplateDefinition> = new Map();
    private _templatePath: string = '';

    constructor() {
        this._loadConfiguration();
    }

    /**
     * Load template path from VS Code configuration
     */
    private _loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        this._templatePath = config.get<string>('templates.path', '');
    }

    /**
     * Refresh configuration (call when settings change)
     */
    public refreshConfiguration(): void {
        this._loadConfiguration();
        this._templates.clear();
    }

    /**
     * Get the configured template path
     */
    public getTemplatePath(): string {
        return this._templatePath;
    }

    /**
     * Check if templates are enabled (path is configured)
     */
    public isEnabled(): boolean {
        return this._templatePath !== '' && this._templatePath !== undefined;
    }

    /**
     * Check if template bar should be shown
     */
    public shouldShowBar(): boolean {
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        return config.get<boolean>('templates.showBar', true) && this.isEnabled();
    }

    /**
     * Resolve the template path (handles relative paths)
     */
    public resolveTemplatePath(workspaceFolder?: string): string {
        if (!this._templatePath) {
            return '';
        }

        // If absolute path, use as-is
        if (path.isAbsolute(this._templatePath)) {
            return this._templatePath;
        }

        // If relative, resolve against workspace folder
        if (workspaceFolder) {
            return path.resolve(workspaceFolder, this._templatePath);
        }

        // Try to get workspace folder from VS Code
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return path.resolve(folders[0].uri.fsPath, this._templatePath);
        }

        return this._templatePath;
    }

    /**
     * Scan the template folder for available templates
     * Each subfolder containing a template.md is considered a template
     */
    public async scanTemplates(workspaceFolder?: string): Promise<TemplateSummary[]> {
        const templatePath = this.resolveTemplatePath(workspaceFolder);

        if (!templatePath) {
            return [];
        }

        try {
            // Check if template folder exists
            const stat = await fs.promises.stat(templatePath);
            if (!stat.isDirectory()) {
                console.warn(`[TemplateService] Template path is not a directory: ${templatePath}`);
                return [];
            }

            // Read all subdirectories
            const entries = await fs.promises.readdir(templatePath, { withFileTypes: true });
            const templates: TemplateSummary[] = [];

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }

                const templateFolder = path.join(templatePath, entry.name);
                const templateFile = path.join(templateFolder, 'template.md');

                // Check if template.md exists
                try {
                    await fs.promises.access(templateFile, fs.constants.R_OK);
                } catch {
                    // No template.md, skip this folder
                    continue;
                }

                // Parse the template to get metadata
                try {
                    const definition = await this.loadTemplate(templateFolder);
                    templates.push({
                        name: definition.name || entry.name,
                        description: definition.description,
                        icon: definition.icon,
                        path: templateFolder
                    });
                } catch (error) {
                    console.error(`[TemplateService] Failed to parse template at ${templateFolder}:`, error);
                    // Still add with folder name as fallback
                    templates.push({
                        name: entry.name,
                        path: templateFolder
                    });
                }
            }

            return templates;

        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(`[TemplateService] Template folder does not exist: ${templatePath}`);
            } else {
                console.error(`[TemplateService] Error scanning templates:`, error);
            }
            return [];
        }
    }

    /**
     * Load a template definition from a folder
     */
    public async loadTemplate(templateFolder: string): Promise<TemplateDefinition> {
        // Check cache first
        const cached = this._templates.get(templateFolder);
        if (cached) {
            return cached;
        }

        const templateFile = path.join(templateFolder, 'template.md');
        const content = await fs.promises.readFile(templateFile, 'utf-8');

        const definition = TemplateParser.parse(content, templateFolder);
        this._templates.set(templateFolder, definition);

        return definition;
    }

    /**
     * Get list of templates for UI
     */
    public async getTemplateList(workspaceFolder?: string): Promise<TemplateSummary[]> {
        return this.scanTemplates(workspaceFolder);
    }

    /**
     * Clear the template cache
     */
    public clearCache(): void {
        this._templates.clear();
    }
}
