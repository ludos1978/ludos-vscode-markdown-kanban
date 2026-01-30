/**
 * Markdown Processor Plugin Interface
 *
 * Defines the metadata structure for markdown-it plugins used across
 * the three rendering runtimes (frontend webview, WYSIWYG backend, Marp export).
 *
 * The actual plugin code remains runtime-specific:
 * - Frontend: window.* globals from <script> tags (CSP constraint)
 * - WYSIWYG: TypeScript imports from markdownItPlugins.ts
 * - Marp engine: Node.js require() calls
 *
 * This interface provides the shared metadata and plugin manifest
 * (single source of truth for IDs, priorities, scope, window globals).
 *
 * @module plugins/interfaces/MarkdownProcessorPlugin
 */

/**
 * A single entry in the markdown-it plugin manifest.
 *
 * Describes one markdown-it plugin with enough metadata for the
 * PluginRegistry to manage it and for each runtime to load it.
 */
export interface MarkdownPluginEntry {
    /** Unique plugin identifier (e.g. 'wiki-links', 'emoji') */
    id: string;

    /** Human-readable name (e.g. 'Wiki Links Plugin') */
    name: string;

    /** Load order priority — lower numbers load earlier */
    priority: number;

    /** Which rendering context uses this plugin */
    scope: 'frontend' | 'export' | 'both';

    /** Whether this is a custom (inline) or npm/CDN plugin */
    type: 'custom' | 'npm';

    /** Browser window.X global name (for frontend runtime) */
    windowGlobal?: string;

    /** npm package name (for WYSIWYG/Marp runtimes) */
    npmPackage?: string;

    /** Container type names when this is markdown-it-container */
    containerTypes?: string[];

    /** Plugin-specific options passed during .use() */
    options?: Record<string, unknown>;
}
