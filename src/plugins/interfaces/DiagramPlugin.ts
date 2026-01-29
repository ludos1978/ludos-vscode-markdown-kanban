/**
 * Diagram Plugin Interface
 *
 * Defines the contract for plugins that handle diagram/document rendering.
 * This includes converting code blocks (PlantUML, Mermaid) and files
 * (Draw.io, Excalidraw, PDF, EPUB, XLSX) to SVG or PNG output.
 *
 * @module plugins/interfaces/DiagramPlugin
 */

import * as vscode from 'vscode';

/**
 * Options for rendering a diagram
 */
export interface DiagramRenderOptions {
    /** Desired output format (overrides plugin default) */
    outputFormat?: 'svg' | 'png';
    /** Page number for paginated types (PDF, EPUB) — 1-indexed */
    pageNumber?: number;
    /** Sheet number for spreadsheet types (XLSX) — 1-indexed */
    sheetNumber?: number;
    /** Resolution in DPI for raster output */
    dpi?: number;
    /** Source directory for resolving relative paths in file-based diagrams */
    sourceDir?: string;
}

/**
 * Result of a diagram render operation
 */
export interface DiagramRenderResult {
    /** Whether rendering succeeded */
    success: boolean;
    /** Rendered output — SVG string or PNG Buffer */
    data: string | Buffer;
    /** Format of the rendered output */
    format: 'svg' | 'png';
    /** Error message if rendering failed */
    error?: string;
    /** Source file modification time (for cache invalidation) */
    fileMtime?: number;
}

/**
 * File information for paginated diagram types (PDF, EPUB)
 */
export interface DiagramFileInfo {
    /** Total page count (PDF, EPUB) */
    pageCount?: number;
    /** Source file modification time */
    fileMtime?: number;
}

/**
 * Metadata describing a diagram plugin's capabilities
 */
export interface DiagramPluginMetadata {
    /** Unique identifier for this plugin (e.g., 'plantuml', 'drawio') */
    id: string;
    /** Human-readable name for display */
    name: string;
    /** Plugin version */
    version: string;
    /** Code fence languages this plugin handles (e.g., ['plantuml', 'puml']) */
    supportedCodeBlocks: string[];
    /** File extensions this plugin handles (e.g., ['.drawio', '.dio']) */
    supportedFileExtensions: string[];
    /** Default render output format */
    renderOutput: 'svg' | 'png';
    /** Whether this plugin requires an external CLI tool */
    requiresExternalTool: boolean;
    /** Name of the required external tool (for error messages) */
    externalToolName?: string;
    /** VS Code config keys this plugin reads (e.g., ['javaPath']) */
    configKeys?: string[];
}

/**
 * Diagram Plugin Interface
 *
 * Plugins implementing this interface can render diagrams from:
 * - Code blocks (PlantUML, Mermaid) via renderCodeBlock()
 * - Files (Draw.io, Excalidraw, PDF, EPUB, XLSX) via renderFile()
 *
 * At least one of renderCodeBlock or renderFile must be implemented.
 */
export interface DiagramPlugin {
    /** Plugin metadata describing capabilities */
    readonly metadata: DiagramPluginMetadata;

    /**
     * Called when the plugin is activated (optional)
     * Use for initialization that requires the webview panel (e.g., Mermaid)
     */
    activate?(context: DiagramPluginContext): Promise<void>;

    /**
     * Called when the plugin is deactivated (optional)
     * Use for cleanup operations
     */
    deactivate?(): Promise<void>;

    /**
     * Check if this plugin's external dependencies are available
     * (e.g., Java + PlantUML JAR, draw.io CLI, pdftoppm CLI)
     */
    isAvailable(): Promise<boolean>;

    /**
     * Check if this plugin can render a code block with the given language tag
     */
    canRenderCodeBlock(language: string): boolean;

    /**
     * Check if this plugin can render a file at the given path (by extension)
     */
    canRenderFile(filePath: string): boolean;

    /**
     * Render a code block to SVG/PNG (for PlantUML, Mermaid)
     */
    renderCodeBlock?(code: string, options?: DiagramRenderOptions): Promise<DiagramRenderResult>;

    /**
     * Render a file to SVG/PNG (for Draw.io, Excalidraw, PDF, EPUB, XLSX)
     */
    renderFile?(filePath: string, options?: DiagramRenderOptions): Promise<DiagramRenderResult>;

    /**
     * Get file info for paginated types (PDF page count, EPUB page count)
     */
    getFileInfo?(filePath: string): Promise<DiagramFileInfo>;
}

/**
 * Context provided to diagram plugins during activation
 */
export interface DiagramPluginContext {
    /** Webview panel for browser-based rendering (Mermaid) */
    webviewPanel?: vscode.WebviewPanel;
}
