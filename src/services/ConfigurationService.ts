/**
 * Centralized Configuration Service for Markdown Kanban
 * Provides unified access to VS Code configuration with caching and type safety
 */

import * as vscode from 'vscode';

export interface KanbanConfiguration {
    enableBackups: boolean;
    backupInterval: number;
    backupLocation: string;
    openLinksInNewTab: boolean;
    pathGeneration: 'relative' | 'absolute';
    whitespace: string;
    maxRowHeight: number;
    tagColors: { [key: string]: string };
    taskMinHeight: string;
    sectionHeight: string;
    taskSectionHeight: string;
    fontSize: string;
    fontFamily: string;
    columnWidth: string;
    columnBorder: string;
    taskBorder: string;
    layoutRows: number;
    rowHeight: string;
    layoutPreset: string;
    layoutPresets: { [key: string]: any };
    tagVisibility: string;
    exportTagVisibility: boolean;
    htmlCommentRenderMode: string;
    htmlContentRenderMode: string;
    arrowKeyFocusScroll: string;
    marp: {
        enginePath: string;
        defaultTheme: string;
        allowLocalFiles: boolean;
        browser: 'auto' | 'chrome' | 'edge' | 'firefox';
        themeFolders: string[];
        keepTempFiles: boolean;
        availableClasses: string[];
        globalClasses: string[];
        localClasses: string[];
    };
    sidebar: {
        autoScan: boolean;
    };
}

export interface ConfigurationDefaults {
    enableBackups: boolean;
    backupInterval: number;
    backupLocation: string;
    openLinksInNewTab: boolean;
    pathGeneration: 'relative' | 'absolute';
    whitespace: string;
    maxRowHeight: number;
    taskMinHeight: string;
    sectionHeight: string;
    taskSectionHeight: string;
    fontSize: string;
    fontFamily: string;
    columnWidth: string;
    columnBorder: string;
    taskBorder: string;
    layoutRows: number;
    rowHeight: string;
    layoutPreset: string;
    tagVisibility: string;
    exportTagVisibility: boolean;
    htmlCommentRenderMode: string;
    htmlContentRenderMode: string;
    arrowKeyFocusScroll: string;
    marp: {
        enginePath: string;
        defaultTheme: string;
        allowLocalFiles: boolean;
        browser: 'auto' | 'chrome' | 'edge' | 'firefox';
        themeFolders: string[];
        keepTempFiles: boolean;
        availableClasses: string[];
        globalClasses: string[];
        localClasses: string[];
    };
    sidebar: {
        autoScan: boolean;
    };
}

export class ConfigurationService {
    private static instance: ConfigurationService | undefined;
    private cache: Map<string, any> = new Map();
    private readonly CONFIGURATION_SECTION = 'markdown-kanban';

    private readonly defaults: ConfigurationDefaults = {
        enableBackups: true,
        backupInterval: 15,
        backupLocation: 'same-folder',
        openLinksInNewTab: false,
        pathGeneration: 'absolute' as 'relative' | 'absolute',
        whitespace: '4px',
        maxRowHeight: 0,
        taskMinHeight: 'auto',
        sectionHeight: 'auto',
        taskSectionHeight: 'auto',
        fontSize: 'small',
        fontFamily: 'system',
        columnWidth: 'medium',
        columnBorder: '1px solid var(--vscode-panel-border)',
        taskBorder: '1px solid var(--vscode-panel-border)',
        layoutRows: 1,
        rowHeight: 'auto',
        layoutPreset: 'normal',
        tagVisibility: 'allexcludinglayout',
        exportTagVisibility: true,
        htmlCommentRenderMode: 'hidden',
        htmlContentRenderMode: 'html',
        arrowKeyFocusScroll: 'center',
        marp: {
            enginePath: './marp-engine/engine.js',
            defaultTheme: 'default',
            allowLocalFiles: true,
            browser: 'chrome' as 'auto' | 'chrome' | 'edge' | 'firefox',
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
        },
        sidebar: {
            autoScan: true
        }
    };

    private constructor() {
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(this.CONFIGURATION_SECTION)) {
                this.clearCache();
            }
        });
    }

    public static getInstance(): ConfigurationService {
        if (!ConfigurationService.instance) {
            ConfigurationService.instance = new ConfigurationService();
        }
        return ConfigurationService.instance;
    }

    public getConfig<K extends keyof KanbanConfiguration>(
        key: K,
        defaultValue?: KanbanConfiguration[K]
    ): KanbanConfiguration[K] {
        const cacheKey = `${this.CONFIGURATION_SECTION}.${key}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const config = vscode.workspace.getConfiguration(this.CONFIGURATION_SECTION);
        const value = config.get<KanbanConfiguration[K]>(
            key as string,
            (defaultValue ?? this.defaults[key as keyof ConfigurationDefaults]) as KanbanConfiguration[K]
        );

        this.cache.set(cacheKey, value);
        return value;
    }

    public getNestedConfig(path: string, defaultValue?: any): any {
        const cacheKey = `${this.CONFIGURATION_SECTION}.${path}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const config = vscode.workspace.getConfiguration(this.CONFIGURATION_SECTION);
        const value = this.getNestedProperty(config, path) ?? defaultValue;

        this.cache.set(cacheKey, value);
        return value;
    }

    public async updateConfig<K extends keyof KanbanConfiguration>(
        key: K,
        value: KanbanConfiguration[K],
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIGURATION_SECTION);
        await config.update(key as string, value, target);

        const cacheKey = `${this.CONFIGURATION_SECTION}.${key}`;
        this.cache.delete(cacheKey);
    }

    public getAllConfig(): Partial<KanbanConfiguration> {
        const config = vscode.workspace.getConfiguration(this.CONFIGURATION_SECTION);
        const result: Partial<KanbanConfiguration> = {};

        for (const key of Object.keys(this.defaults) as Array<keyof ConfigurationDefaults>) {
            result[key as keyof KanbanConfiguration] = config.get(
                key,
                this.defaults[key]
            ) as any;
        }

        return result;
    }

    public clearCache(): void {
        this.cache.clear();
    }

    public getEnabledTagCategoriesColumn(): { [key: string]: boolean } {
        const config = vscode.workspace.getConfiguration(this.CONFIGURATION_SECTION);
        const enabledArray = config.get<string[]>('enabledTagCategoriesColumn', []);

        const result: { [key: string]: boolean } = {};
        enabledArray.forEach(category => {
            const camelCase = category.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            result[camelCase] = true;
        });
        return result;
    }

    public getEnabledTagCategoriesTask(): { [key: string]: boolean } {
        const config = vscode.workspace.getConfiguration(this.CONFIGURATION_SECTION);
        const enabledArray = config.get<string[]>('enabledTagCategoriesTask', []);

        const result: { [key: string]: boolean } = {};
        enabledArray.forEach(category => {
            const camelCase = category.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            result[camelCase] = true;
        });
        return result;
    }

    public getCustomTagCategories(): { [key: string]: any } {
        const config = vscode.workspace.getConfiguration(this.CONFIGURATION_SECTION);
        return config.get('customTagCategories', {});
    }

    public getPathGenerationMode(): 'relative' | 'absolute' {
        return this.getConfig('pathGeneration');
    }

    public getBoardViewConfig(layoutPresets: Record<string, any>): Record<string, any> {
        return {
            columnWidth: this.getConfig('columnWidth'),
            columnBorder: this.getConfig('columnBorder'),
            taskBorder: this.getConfig('taskBorder'),
            layoutRows: this.getConfig('layoutRows'),
            rowHeight: this.getConfig('rowHeight'),
            layoutPreset: this.getConfig('layoutPreset'),
            layoutPresets: layoutPresets,
            maxRowHeight: this.getConfig('maxRowHeight'),
            taskMinHeight: this.getConfig('taskMinHeight'),
            sectionHeight: this.getConfig('sectionHeight'),
            taskSectionHeight: this.getConfig('taskSectionHeight'),
            fontSize: this.getConfig('fontSize'),
            fontFamily: this.getConfig('fontFamily'),
            whitespace: this.getConfig('whitespace'),
            htmlCommentRenderMode: this.getConfig('htmlCommentRenderMode'),
            htmlContentRenderMode: this.getConfig('htmlContentRenderMode'),
            tagColors: this.getConfig('tagColors'),
            enabledTagCategoriesColumn: this.getEnabledTagCategoriesColumn(),
            enabledTagCategoriesTask: this.getEnabledTagCategoriesTask(),
            customTagCategories: this.getCustomTagCategories(),
            tagVisibility: this.getConfig('tagVisibility'),
            exportTagVisibility: this.getConfig('exportTagVisibility'),
            arrowKeyFocusScroll: this.getConfig('arrowKeyFocusScroll'),
            openLinksInNewTab: this.getConfig('openLinksInNewTab'),
            pathGeneration: this.getConfig('pathGeneration')
        };
    }

    private getNestedProperty(obj: any, path: string): any {
        return path.split('.').reduce((current, prop) => {
            return current && current[prop] !== undefined ? current[prop] : undefined;
        }, obj);
    }
}

// Export singleton instance
export const configService = ConfigurationService.getInstance();
