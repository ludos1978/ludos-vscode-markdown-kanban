# Plugin Architecture Conversion Plan

Goal: simpler core, features as plugins that expand rendering, embedding and export.

---

## Progress

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | DONE | Plugin Infrastructure (Core Changes) |
| Phase 2 | DONE | Diagram Plugins (7 plugins migrated, 7 service files deleted) |
| Phase 3a | DONE | Export Plugins — pragmatic routing (Marp, Pandoc through PluginRegistry) |
| Phase 3b | DONE | Export Plugins — full migration (Marp/Pandoc services absorbed into plugins, service files deleted) |
| Phase 4 | DONE | Embed Plugin (unified EmbedPlugin, config sync, export transform) |
| Phase 4b | DONE | Plugin API Decoupling Audit (zero concrete imports in core, interface-only access) |
| Phase 5 | DONE | Markdown-it Processor Plugins (8 custom plugins extracted, manifest + registry + per-plugin disable) |

### Plugin enable/disable

All built-in plugins can be toggled via VS Code setting:
```json
"markdown-kanban.plugins.disabled": ["plantuml", "mermaid"]
```

Plugins check `isPluginDisabled(pluginId)` in `PluginLoader.ts` during registration.

---

## Phase 1: Plugin Infrastructure (Core Changes) -- DONE

### 1.1 Create DiagramPlugin interface -- DONE

File: `src/plugins/interfaces/DiagramPlugin.ts`

Defines the contract every diagram/rendering plugin must implement:

```
DiagramPlugin {
  metadata: {
    id: string                      // e.g. 'plantuml'
    name: string                    // e.g. 'PlantUML Diagram Renderer'
    version: string
    supportedCodeBlocks: string[]   // e.g. ['plantuml', 'puml'] -- for code fence matching
    supportedFileExtensions: string[] // e.g. ['.drawio', '.dio']
    renderOutput: 'svg' | 'png'    // what the render produces
    requiresExternalTool: boolean
    externalToolName?: string       // e.g. 'Java + PlantUML JAR'
    configKeys?: string[]           // e.g. ['javaPath', 'graphvizPath']
  }

  // lifecycle
  activate?(context: DiagramPluginContext): Promise<void>
  deactivate?(): Promise<void>

  // capabilities
  isAvailable(): Promise<boolean>
  canRenderCodeBlock(language: string): boolean
  canRenderFile(filePath: string): boolean

  // rendering -- at least one must be implemented
  renderCodeBlock?(code: string, options?: DiagramRenderOptions): Promise<DiagramRenderResult>
  renderFile?(filePath: string, options?: DiagramRenderOptions): Promise<DiagramRenderResult>

  // info (optional, for paginated types like PDF/EPUB)
  getFileInfo?(filePath: string): Promise<DiagramFileInfo>
}
```

Supporting types: `DiagramRenderOptions`, `DiagramRenderResult`, `DiagramFileInfo`, `DiagramPluginContext`

### 1.2 Extend PluginRegistry for diagram plugins -- DONE

File: `src/plugins/registry/PluginRegistry.ts`

Added:
- `private _diagramPlugins: Map<string, DiagramPlugin>`
- `registerDiagramPlugin(plugin)` -- validates metadata, checks for ID/code-block/extension conflicts
- `getAllDiagramPlugins()`
- `findDiagramPluginById(id)`
- `findDiagramPluginForCodeBlock(language)`
- `findDiagramPluginForFile(filePath)`
- `activateDiagramPlugins(context: DiagramPluginContext)`

### 1.3 Extend PluginLoader to register diagram plugins -- DONE

File: `src/plugins/PluginLoader.ts`

Each diagram plugin is registered with enable/disable check:
```typescript
if (!isPluginDisabled('plantuml')) {
    registry.registerDiagramPlugin(new PlantUMLPlugin());
}
```

Added `initializeDiagramPlugins(context: DiagramPluginContext)` for webview-dependent activation.

### 1.4 Refactor DiagramCommands to use PluginRegistry -- DONE

File: `src/commands/DiagramCommands.ts`

- All handlers use `PluginRegistry.getInstance().findDiagramPluginById(id)` or `findDiagramPluginForCodeBlock(lang)`
- Mermaid response messages route to `MermaidPlugin.handleRenderSuccess/Error()`
- Removed all direct imports of diagram service classes
- Removed `plantUMLService` from `CommandContext`

### 1.5 Refactor DiagramPreprocessor to use PluginRegistry -- DONE

File: `src/services/export/DiagramPreprocessor.ts`

- Constructor takes optional `webviewPanel` (for Mermaid rendering via plugin)
- All render methods use `PluginRegistry` lookups instead of direct service instantiation
- Removed all service instance variables and direct imports
- Caching logic (`isOutputUpToDate`) stays in DiagramPreprocessor (export-pipeline logic)

### 1.6 Handle MermaidPlugin webview dependency -- DONE

- `DiagramPluginContext` provides optional `webviewPanel`
- `MermaidPlugin.activate(context)` stores the panel reference
- `MermaidPlugin.setWebviewPanel(panel)` allows updating the panel later
- `DiagramCommands` forwards `mermaidExportSuccess`/`mermaidExportError` to `MermaidPlugin.handleRenderSuccess/Error()`

### 1.7 Remove old service dependencies from core -- DONE

- `ServiceContext` (MessageCommand.ts): removed `plantUMLService` and `getMermaidExportService`
- `MessageHandler.ts`: removed `PlantUMLService` instantiation
- `PanelContext.ts`: removed `MermaidExportService` instance and getter
- `ExportService.ts`: removed `mermaidService` parameter from entire export chain
- `ExportCommands.ts` / `IncludeCommands.ts`: removed `getMermaidExportService()` calls

---

## Phase 2: Diagram Plugins -- DONE

All 7 diagram services migrated to standalone plugins. Original service files deleted.

### 2.1 PlantUML Plugin -- DONE

File: `src/plugins/diagram/PlantUMLPlugin.ts`

Migrated from: `src/services/export/PlantUMLService.ts` (deleted)

- metadata.id = `'plantuml'`, supportedCodeBlocks = `['plantuml', 'puml']`
- Renders via Java + PlantUML JAR (`renderCodeBlock`)
- Static resolved path caching for Java and Graphviz
- Does NOT extend AbstractCLIService (own Java spawning logic)

### 2.2 Mermaid Plugin -- DONE

File: `src/plugins/diagram/MermaidPlugin.ts`

Migrated from: `src/services/export/MermaidExportService.ts` (deleted)

- metadata.id = `'mermaid'`, supportedCodeBlocks = `['mermaid']`
- Renders via webview's browser-based Mermaid.js (`renderCodeBlock`)
- Queue-based sequential rendering with 30s timeout
- Exposes `handleRenderSuccess()` / `handleRenderError()` for message routing
- Exposes `renderBatch()` for DiagramPreprocessor
- `cleanup()` clears pending requests on panel dispose

### 2.3 Draw.io Plugin -- DONE

File: `src/plugins/diagram/DrawIOPlugin.ts`

Migrated from: `src/services/export/DrawIOService.ts` (deleted)

- metadata.id = `'drawio'`, supportedFileExtensions = `['.drawio', '.dio']`
- Contains internal `DrawIOCLI extends AbstractCLIService`
- Supports both SVG and PNG output via `renderFile(path, { outputFormat })`

### 2.4 Excalidraw Plugin -- DONE

File: `src/plugins/diagram/ExcalidrawPlugin.ts`

Migrated from: `src/services/export/ExcalidrawService.ts` (deleted)

- metadata.id = `'excalidraw'`, supportedFileExtensions = `['.excalidraw', '.excalidraw.json', '.excalidraw.svg']`
- .excalidraw.svg returned directly; JSON files converted via excalidraw-worker.js
- Uses BrowserService for Playwright path
- Does NOT extend AbstractCLIService

### 2.5 PDF Plugin -- DONE

File: `src/plugins/diagram/PDFPlugin.ts`

Migrated from: `src/services/export/PDFService.ts` (deleted)

- metadata.id = `'pdf'`, supportedFileExtensions = `['.pdf']`
- Contains internal `PDFCLI extends AbstractCLIService` (pdftoppm)
- `renderFile(path, { pageNumber, dpi })` renders pages to PNG
- `getFileInfo(path)` returns page count via `pdfinfo` command

### 2.6 EPUB Plugin -- DONE

File: `src/plugins/diagram/EPUBPlugin.ts`

Migrated from: `src/services/export/EPUBService.ts` (deleted)

- metadata.id = `'epub'`, supportedFileExtensions = `['.epub']`
- Contains internal `EPUBCLI extends AbstractCLIService` (mutool)
- `renderFile(path, { pageNumber, dpi })` renders pages to PNG
- `getFileInfo(path)` parses EPUB ZIP structure for page count (no CLI needed)

### 2.7 XLSX Plugin -- DONE

File: `src/plugins/diagram/XlsxPlugin.ts`

Migrated from: `src/services/export/XlsxService.ts` (deleted)

- metadata.id = `'xlsx'`, supportedFileExtensions = `['.xlsx', '.xls', '.ods']`
- Contains internal `XlsxCLI extends AbstractCLIService` (LibreOffice soffice)
- `renderFile(path, { sheetNumber })` renders sheets to PNG
- Handles LibreOffice multi-file output naming patterns

---

## Phase 3a: Export Plugins — Pragmatic Routing -- DONE

Completed: Routing ExportService and ExportCommands through PluginRegistry.

What was done:
- Created `PandocExportPlugin.ts` — thin wrapper around PandocExportService
- Added `stopAllWatches`, `stopAllWatchesExcept`, `engineFileExists`, `getEnginePath` to MarpExportPlugin
- Registered PandocExportPlugin in PluginLoader (gated by `isPluginDisabled('pandoc')`)
- Added `'pandoc'` to `plugins.disabled` enum in package.json
- Extracted `preprocessDiagrams()` helper in ExportService (eliminated ~70 LOC duplication)
- ExportService.outputContent() checks plugin availability via PluginRegistry before conversion
- ExportCommands routes all Marp/Pandoc calls through plugin lookups (removed direct service imports)

What was NOT done (deferred to Phase 3b):
- Moving MarpExportService/PandocExportService code INTO the plugins
- Moving PresentationGenerator/PresentationParser into MarpExportPlugin
- Creating MarkdownExportPlugin
- Deleting the service files

---

## Phase 3b: Export Plugins — Full Migration (optional) -- DONE

### 3.1 Enhance ExportPlugin interface

File: `src/plugins/interfaces/ExportPlugin.ts` (modify)

Current interface already covers most needs. Add:

```
ExportPlugin {
  // existing methods stay unchanged

  // new: preprocessing hook -- called before the external tool runs
  preprocess?(inputPath: string, outputDir: string, context: ExportPreprocessContext): Promise<PreprocessResult>

  // new: does this plugin need diagram preprocessing?
  requiresDiagramPreprocessing?(): boolean

  // new: stop watching (for Marp watch mode)
  stopWatching?(filePath: string): Promise<void>
}

ExportPreprocessContext {
  diagramPlugins: DiagramPlugin[]   // available diagram renderers
  webviewPanel?: vscode.WebviewPanel
}

PreprocessResult {
  processedInputPath: string  // may be a .preprocessed.md file
  tempFiles: string[]         // files to clean up after export
}
```

Also add to `ExportOptions`:
```
  handout?: boolean
  handoutLayout?: 'portrait' | 'landscape'
  handoutSlidesPerPage?: 1 | 2 | 4
  handoutDirection?: 'horizontal' | 'vertical'
```

### 3.2 Complete Marp Export Plugin

File: `src/plugins/export/MarpExportPlugin.ts` (modify -- currently 187 LOC thin wrapper)

Migrate from: `src/services/export/MarpExportService.ts` (655 LOC)

What moves into the plugin:
- `export()` -- full Marp CLI spawning logic (format, theme, engine, browser, watch mode, pptx-editable)
- `buildMarpCliArgs()` -- Marp-specific argument construction
- `isMarpCliAvailable()` -> `isAvailable()`
- `getAvailableThemes()` -- theme discovery
- `isWatching()` / `stopWatching()` -- process lifecycle for watch mode
- Handout generation (slides-per-page layout)

What moves from `MarpExtensionService.ts` (208 LOC):
- VS Code Marp extension interaction and theme loading

What moves from `PresentationGenerator.ts` (373 LOC):
- `fromBoard()` -- KanbanBoard -> slide markdown

What moves from `PresentationParser.ts` (281 LOC):
- Parsing presentation format back to tasks (re-import)

Preprocessing:
- `requiresDiagramPreprocessing()` -> `true`
- `preprocess()` calls DiagramPreprocessor (which uses diagram plugins from registry)

After migration, delete:
- `src/services/export/MarpExportService.ts` (655 LOC)
- `src/services/export/MarpExtensionService.ts` (208 LOC)
- `src/services/export/PresentationGenerator.ts` (373 LOC)
- `src/services/export/PresentationParser.ts` (281 LOC)

Total: ~1500 LOC moves from 4 files into the plugin.

### 3.3 Create Pandoc Export Plugin

File: `src/plugins/export/PandocExportPlugin.ts` (new)

Migrates from: `src/services/export/PandocExportService.ts` (381 LOC)

- metadata.id = `'pandoc'`
- metadata.formats = `[{id: 'pandoc-docx', ...}, {id: 'pandoc-odt', ...}, {id: 'pandoc-epub', ...}]`
- `isAvailable()` -- platform-specific pandoc path resolution
- `export(board, options)` -- spawn pandoc CLI
- `requiresDiagramPreprocessing()` -> `true`

After migration, delete:
- `src/services/export/PandocExportService.ts` (381 LOC)

### ~~3.4 Extract built-in Markdown Export Plugin~~ — REJECTED

Markdown export is core pipeline logic, not a plugin. The export orchestration
(extract -> transform -> output) stays in ExportService. Plugins may influence
the markdown export via hooks (e.g., format-specific media post-processing for
PDF vs HTML), but the export itself is not a plugin.

### 3.5 Refactor ExportService to use export plugins — DONE (partial)

File: `src/services/export/ExportService.ts`

- ~~Remove direct imports of MarpExportService, PandocExportService~~ — DONE
- `runMarpConversion()` and `runPandocConversion()` now use plugins via PluginRegistry — DONE
- `outputContent()` already checks plugin availability via PluginRegistry — DONE (Phase 3a)

### 3.6 Refactor ExportCommands to use plugin discovery — DONE (Phase 3a)

All Marp/Pandoc calls route through plugin lookups.

### 3.7 DiagramPreprocessor — no changes needed

DiagramPreprocessor already uses diagram plugins via PluginRegistry (done in Phase 1).
It stays in `src/services/export/` as shared infrastructure.

---

## Phase 4: Embed Plugin -- DONE

Single `EmbedPlugin` class owns all embed/iframe logic.

### 4.1 Create EmbedPlugin class -- DONE

File: `src/plugins/embed/EmbedPlugin.ts` (new)

- metadata.id = `'embed'`
- `getConfig()` — delegates to pluginConfigService for embed config
- `getKnownDomains()` / `getDefaultIframeAttributes()` / `getExportHandling()` — config accessors
- `getWebviewConfig()` — returns `{ knownDomains, defaultIframeAttributes }` for frontend sync
- `transformForExport(content, mode)` — moved from ExportService.applyEmbedTransform()
- `isImagePath(str)` — (static) moved from ExportService.isImagePath()

### 4.2 Register in PluginRegistry -- DONE

- `registerEmbedPlugin(plugin)` / `getEmbedPlugin()` added to PluginRegistry
- Registered in PluginLoader (gated by `isPluginDisabled('embed')`)

### 4.3 ExportService updated -- DONE

- `applyEmbedTransform()` and `isImagePath()` deleted from ExportService
- `applyContentTransformations()` delegates to EmbedPlugin via PluginRegistry
- Unused imports (`isEmbedUrl`, `parseAttributeBlock`) removed

### 4.4 Frontend config sync wired up -- DONE

- `WebviewUpdateService.refreshAllConfiguration()` injects embed config
- `webview.js` `configurationUpdate` handler calls `window.updateEmbedConfig()`
- Frontend `markdownRenderer.js` domain list synced with schema (25 domains)

### 4.5 Unified domain list -- DONE

- Schema updated: added 3 missing domains (prezi x2, particify) + `referrerpolicy`
- Frontend and schema now have identical 25-domain list
- `'embed'` added to `plugins.disabled` enum in package.json

---

## Phase 4b: Plugin API Decoupling Audit -- DONE

Audited and fixed all coupling between core code and concrete plugin classes.

### Findings (Before)
6 concrete plugin imports in core code:
- `ExportCommands.ts` → `MarpExportPlugin`, `PandocExportPlugin`
- `DiagramCommands.ts` → `MermaidPlugin`
- `DiagramPreprocessor.ts` → `MermaidPlugin`
- `ExportService.ts` → `MarpOutputFormat` (type), `PandocOutputFormat` (type)
- `PluginRegistry.ts` → `EmbedPlugin` (concrete class)

### Fixes Applied
1. **Extended ExportPlugin interface** with optional methods: `stopAllWatches`, `stopAllWatchesExcept`, `stopWatching`, `engineFileExists`, `getEnginePath`, `isCliAvailable`, `getVersion`, `cliExport`
2. **Extended DiagramPlugin interface** with optional methods: `isReady`, `setWebviewPanel`, `renderBatch`, `handleRenderSuccess`, `handleRenderError`
3. **Created EmbedPluginInterface** in `src/plugins/interfaces/EmbedPlugin.ts`
4. **Moved type aliases** `MarpOutputFormat` and `PandocOutputFormat` to `ExportPlugin.ts` interface file
5. **Added registry helpers** `getExportPluginById(id)` and `getDiagramPluginById(id)`
6. **Updated all consumers** to use interfaces + optional chaining instead of concrete casts

### Result (After)
- **0 concrete `from '...plugins/(export|diagram|embed)/'` imports** in core code
- 2 inline type-only casts remain in `ExportService.runMarpConversion/runPandocConversion` for plugin-specific option types (compile-time only, acceptable)
- `npx tsc --noEmit` passes with zero errors

---

## Phase 5: Markdown-it Processor Plugins (optional, lower priority) -- TODO

### 5.1 Create MarkdownProcessorPlugin interface

File: `src/plugins/interfaces/MarkdownProcessorPlugin.ts` (new)

```
MarkdownProcessorPlugin {
  metadata: {
    id: string
    name: string
    version: string
    priority: number              // load order (lower = earlier)
    scope: 'frontend' | 'export' | 'both'
  }

  getMarkdownItPlugin(): (md: MarkdownIt, options?: any) => void
  getOptions?(): Record<string, any>
  activate?(context: PluginContext): Promise<void>
  deactivate?(): Promise<void>
}
```

### 5.2 Extend PluginRegistry for markdown processor plugins

Add `registerMarkdownProcessorPlugin()`, `getMarkdownProcessorPlugins(scope)`

### 5.3 Refactor frontend markdown-it loading

Backend sends registered plugins to frontend. Frontend iterates and calls `.use()` for each.

### 5.4 Convert existing markdown-it plugins (~20)

WikiLinks, Tags, TaskCheckbox, DatePersonTag, TemporalTag, SpeakerNote, HtmlComment, Emoji, Footnote, Multicolumn, Mark, Sub, Sup, Ins, StrikethroughAlt, Abbr, Container, Include, ImageFigures, ImageAttrs, MediaCustom

---

## Architecture Summary

```
src/plugins/
  interfaces/
    ImportPlugin.ts       -- include file handling
    ExportPlugin.ts       -- export format handling
    DiagramPlugin.ts      -- DONE -- diagram/document rendering
    EmbedPlugin.ts        -- DONE -- embed URL handling
    MarkdownProcessorPlugin.ts -- TODO -- markdown-it plugins
    index.ts              -- central exports

  registry/
    PluginRegistry.ts     -- singleton registry for all plugin types

  PluginLoader.ts         -- loads and registers all built-in plugins

  import/                 -- include file plugins (existing)
    ColumnIncludePlugin.ts
    TaskIncludePlugin.ts
    RegularIncludePlugin.ts

  export/                 -- export format plugins
    MarpExportPlugin.ts   -- DONE (full implementation, absorbed MarpExportService)
    PandocExportPlugin.ts -- DONE (full implementation, absorbed PandocExportService)

  diagram/                -- DONE -- diagram rendering plugins
    PlantUMLPlugin.ts
    MermaidPlugin.ts
    DrawIOPlugin.ts
    ExcalidrawPlugin.ts
    PDFPlugin.ts
    EPUBPlugin.ts
    XlsxPlugin.ts

  embed/                  -- DONE
    EmbedPlugin.ts
  markdown/               -- TODO
```

## Files Deleted (completed)

Phase 2 deletions (7 files, ~1431 LOC):
- ~~`src/services/export/PlantUMLService.ts`~~ (deleted)
- ~~`src/services/export/MermaidExportService.ts`~~ (deleted)
- ~~`src/services/export/DrawIOService.ts`~~ (deleted)
- ~~`src/services/export/ExcalidrawService.ts`~~ (deleted)
- ~~`src/services/export/PDFService.ts`~~ (deleted)
- ~~`src/services/export/EPUBService.ts`~~ (deleted)
- ~~`src/services/export/XlsxService.ts`~~ (deleted)

## Files To Delete (Phase 3b, optional)

Only if full migration is done (moving service code into plugins):
- ~~`src/services/export/MarpExportService.ts`~~ (655 LOC) — DELETED, absorbed into MarpExportPlugin
- `src/services/export/MarpExtensionService.ts` (208 LOC) — stays as shared utility
- `src/services/export/PresentationGenerator.ts` (373 LOC) — stays as shared utility
- `src/services/export/PresentationParser.ts` (281 LOC) — stays as shared utility
- ~~`src/services/export/PandocExportService.ts`~~ (381 LOC) — DELETED, absorbed into PandocExportPlugin

## Files That Stay (shared infrastructure)

- `src/services/export/AbstractCLIService.ts` -- base class for CLI-based diagram plugins
- `src/services/export/DiagramPreprocessor.ts` -- shared export utility (uses diagram plugins via PluginRegistry)
- `src/services/export/ExportService.ts` -- export orchestrator (will delegate to export plugins)
- `src/services/BrowserService.ts` -- shared browser utility (used by Excalidraw plugin)
- `src/services/export/SvgReplacementService.ts` -- SVG manipulation utility
