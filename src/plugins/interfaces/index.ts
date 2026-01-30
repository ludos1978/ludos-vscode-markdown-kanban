/**
 * Plugin Interface Exports
 *
 * Central export point for all plugin interfaces and types.
 *
 * @module plugins/interfaces
 */

// Import Plugin types
export {
    ImportPlugin,
    ImportPluginMetadata,
    ImportContext,
    IncludeContextLocation,
    IncludeMatch,
    PluginDependencies,
    ParseOptions,
    ParseResult,
    GenerateOptions,
    PluginContext
} from './ImportPlugin';

// Export Plugin types
export {
    ExportPlugin,
    ExportPluginMetadata,
    ExportFormat,
    ExportOptions,
    ExportResult,
    MarpOutputFormat,
    PandocOutputFormat
} from './ExportPlugin';

// Diagram Plugin types
export {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramPluginContext,
    DiagramRenderOptions,
    DiagramRenderResult,
    DiagramFileInfo
} from './DiagramPlugin';

// Embed Plugin interface
export { EmbedPluginInterface } from './EmbedPlugin';

// Markdown Processor Plugin types
export { MarkdownPluginEntry } from './MarkdownProcessorPlugin';
