# Plugin Architecture Conversion Plan

Goal: simpler core, features as plugins that expand rendering, embedding and export.

---

## Phase 1: Plugin Infrastructure (Core Changes)

These changes prepare the core to support diagram and export plugins.

### 1.1 Create DiagramPlugin interface

File: `src/plugins/interfaces/DiagramPlugin.ts` (new)

Define the contract every diagram/rendering plugin must implement:

```
DiagramPlugin {
  metadata: {
    id: string                      // e.g. 'plantuml'
    name: string                    // e.g. 'PlantUML Diagram Renderer'
    version: string
    supportedCodeBlocks: string[]   // e.g. ['plantuml', 'puml'] — for code fence matching
    supportedFileExtensions: string[] // e.g. ['.plantuml'] or ['.drawio', '.dio']
    renderOutput: 'svg' | 'png'    // what the render produces
    requiresExternalTool: boolean
    externalToolName?: string       // e.g. 'Java + PlantUML JAR'
    configKeys?: string[]           // e.g. ['javaPath', 'graphvizPath']
  }

  // lifecycle
  activate?(context: PluginContext): Promise<void>
  deactivate?(): Promise<void>

  // capabilities
  isAvailable(): Promise<boolean>
  canRenderCodeBlock(language: string): boolean
  canRenderFile(filePath: string): boolean

  // rendering — at least one must be implemented
  renderCodeBlock?(code: string, options?: DiagramRenderOptions): Promise<DiagramRenderResult>
  renderFile?(filePath: string, options?: DiagramRenderOptions): Promise<DiagramRenderResult>

  // info (optional, for paginated types like PDF/EPUB)
  getFileInfo?(filePath: string): Promise<DiagramFileInfo>
}
```

Supporting types:

```
DiagramRenderOptions {
  outputFormat?: 'svg' | 'png'
  pageNumber?: number       // for PDF/EPUB
  sheetNumber?: number      // for XLSX
  dpi?: number              // for raster output
  sourceDir?: string        // for resolving relative paths
}

DiagramRenderResult {
  success: boolean
  data: string | Buffer     // SVG string or PNG buffer
  format: 'svg' | 'png'
  error?: string
  fileMtime?: number        // for cache invalidation
}

DiagramFileInfo {
  pageCount?: number
  sheetCount?: number
  fileMtime?: number
}
```

Constraints:
- Code-block renderers (PlantUML, Mermaid) implement `renderCodeBlock`
- File renderers (DrawIO, Excalidraw, PDF, EPUB, XLSX) implement `renderFile`
- Paginated renderers (PDF, EPUB) also implement `getFileInfo`
- Interface must cover all current message types in DiagramCommands without loss

### 1.2 Extend PluginRegistry for diagram plugins

File: `src/plugins/registry/PluginRegistry.ts` (modify)

Add:
- `private diagramPlugins: Map<string, DiagramPlugin>`
- `registerDiagramPlugin(plugin: DiagramPlugin): void` — validate metadata, check for ID conflicts
- `getAllDiagramPlugins(): DiagramPlugin[]`
- `findDiagramPluginForCodeBlock(language: string): DiagramPlugin | null` — iterate plugins, call `canRenderCodeBlock`
- `findDiagramPluginForFile(filePath: string): DiagramPlugin | null` — iterate plugins, call `canRenderFile`
- `findDiagramPluginById(id: string): DiagramPlugin | null`

Validation rules (same pattern as import/export plugins):
- metadata.id must be unique
- metadata.supportedCodeBlocks and supportedFileExtensions must not overlap with existing plugins
- At least one of renderCodeBlock or renderFile must be a function

### 1.3 Extend PluginLoader to register diagram plugins

File: `src/plugins/PluginLoader.ts` (modify)

In `loadBuiltinPlugins()`, after existing import/export registrations, add:
- `registry.registerDiagramPlugin(new PlantUMLPlugin())`
- `registry.registerDiagramPlugin(new MermaidPlugin())`
- `registry.registerDiagramPlugin(new DrawIOPlugin())`
- `registry.registerDiagramPlugin(new ExcalidrawPlugin())`
- `registry.registerDiagramPlugin(new PDFPlugin())`
- `registry.registerDiagramPlugin(new EPUBPlugin())`
- `registry.registerDiagramPlugin(new XlsxPlugin())`

### 1.4 Refactor DiagramCommands to use PluginRegistry

File: `src/commands/DiagramCommands.ts` (modify — currently 850 LOC)

Currently each handler directly instantiates or references a specific service:
- `handleRenderPlantUML` → `context.plantUMLService.renderSVG(code)`
- `handleConvertMermaidToSVG` → `ctx.getMermaidExportService()`
- `handleRenderDrawIO` → `new DrawIOService()`
- `handleRenderExcalidraw` → `new ExcalidrawService()`
- `handleRenderPDFPage` → `new PDFService()`
- `handleRenderEPUBPage` → `new EPUBService()`
- `handleRenderXlsx` → `new XlsxService()`

Change to:
- Each handler calls `PluginRegistry.getInstance().findDiagramPluginById(id)` or `findDiagramPluginForCodeBlock(lang)` / `findDiagramPluginForFile(path)`
- Then calls `plugin.renderCodeBlock(code, options)` or `plugin.renderFile(path, options)`
- The handler still owns the message response (postMessage back to frontend) — that stays in DiagramCommands
- Remove all direct imports of diagram service classes
- Remove `plantUMLService` from `CommandContext` (it becomes a plugin)

This means DiagramCommands becomes a thin message router (~200 LOC):
```
message type → find plugin → call plugin.render → postMessage result
```

Impact on CommandContext:
- Remove `plantUMLService` property
- Remove `getMermaidExportService()` method
- These were the only two context-injected diagram services; the rest were per-call instantiated

### 1.5 Refactor DiagramPreprocessor to use PluginRegistry

File: `src/services/export/DiagramPreprocessor.ts` (modify — currently 636 LOC)

Currently the constructor instantiates all services directly:
```
this.plantUMLService = new PlantUMLService()
this.mermaidService = mermaidService || new MermaidExportService()
this.drawioService = new DrawIOService()
this.excalidrawService = new ExcalidrawService()
this.xlsxService = new XlsxService()
```

Change to:
- Constructor takes no service params (or just `webviewPanel` for Mermaid)
- `extractAllDiagrams()` — keep as-is for regex extraction (the patterns are content-parsing, not service-specific)
- `renderAllDiagrams()` — instead of calling hardcoded render methods:
  - For each diagram type, get plugin via `PluginRegistry.getInstance().findDiagramPluginById(type)`
  - Call `plugin.renderCodeBlock()` or `plugin.renderFile()`
  - The generic `renderFileBasedDiagramBatch()` helper stays but delegates to plugin
- Remove all service instance variables and direct imports

The caching logic (`isOutputUpToDate`) stays in DiagramPreprocessor — it's export-pipeline logic, not diagram-specific.

### 1.6 Handle MermaidPlugin webview dependency

Mermaid is unique: it renders via the webview (browser-side mermaid.js), not a CLI tool. The current flow:
1. Backend sends `renderMermaidForExport` message to webview
2. Webview renders SVG using mermaid.js
3. Webview sends `mermaidExportSuccess` back

The MermaidPlugin must receive a reference to the webview panel. Options:
- Pass `webviewPanel` via `PluginContext` during `activate(context)` — the context already exists for import plugins
- Add `webviewPanel` to `PluginContext` interface (it currently has `extensionUri` and `workspaceUri`)

Decision: extend `PluginContext` with optional `webviewPanel`:
```
PluginContext {
  extensionUri: vscode.Uri
  workspaceUri?: vscode.Uri
  webviewPanel?: vscode.WebviewPanel  // new — only needed by Mermaid
}
```

MermaidPlugin.activate() stores the reference. When webview changes (panel re-created), call `PluginRegistry.getInstance().initialize(newContext)` to re-activate.

Also: the `mermaidExportSuccess` / `mermaidExportError` message types currently handled in DiagramCommands must route to the MermaidPlugin's response handlers. Either:
- DiagramCommands forwards these messages to the plugin
- Or the plugin registers its own message handler

Simplest: DiagramCommands detects these response messages and calls `mermaidPlugin.handleRenderSuccess(requestId, svg)` / `handleRenderError(requestId, error)`. This keeps the message routing centralized.

---

## Phase 2: Diagram Plugins (one per service)

Each plugin wraps an existing service. After all plugins work, the original service files are deleted (no wrappers — the plugin IS the implementation).

### 2.1 PlantUML Plugin

File: `src/plugins/diagram/PlantUMLPlugin.ts` (new)

Migrates from: `src/services/export/PlantUMLService.ts` (290 LOC)

Implementation:
- metadata.id = `'plantuml'`
- metadata.supportedCodeBlocks = `['plantuml', 'puml']`
- metadata.supportedFileExtensions = `[]` (code-block only)
- metadata.renderOutput = `'svg'`
- metadata.requiresExternalTool = `true`
- metadata.externalToolName = `'Java + PlantUML'`
- metadata.configKeys = `['javaPath', 'graphvizPath']`

Methods to migrate:
- `isAvailable()` — from PlantUMLService.isAvailable() (spawns java with test diagram)
- `canRenderCodeBlock('plantuml')` → true
- `renderCodeBlock(code)` — from PlantUMLService.renderSVG(code):
  - Wraps code in @startuml/@enduml
  - Spawns java process: `java -Djava.awt.headless=true -jar plantuml.jar -Playout=smetana -tsvg -pipe`
  - Reads SVG from stdout
  - Returns `{ success, data: svgString, format: 'svg' }`

Internal state to carry over:
- JAR path resolution: `path.join(__dirname, '../node_modules/node-plantuml/vendor/plantuml.jar')`
- Java path resolution from config
- Graphviz path (optional, for non-Smetana modes)
- 30-second timeout

Does NOT extend AbstractCLIService (PlantUMLService never did — it has its own Java spawning logic).

Delete after migration: `src/services/export/PlantUMLService.ts`

### 2.2 Mermaid Plugin

File: `src/plugins/diagram/MermaidPlugin.ts` (new)

Migrates from: `src/services/export/MermaidExportService.ts` (191 LOC)

Implementation:
- metadata.id = `'mermaid'`
- metadata.supportedCodeBlocks = `['mermaid']`
- metadata.supportedFileExtensions = `[]` (code-block only)
- metadata.renderOutput = `'svg'`
- metadata.requiresExternalTool = `false` (uses webview mermaid.js)

Methods to migrate:
- `activate(context)` — stores `context.webviewPanel` reference
- `isAvailable()` — returns true if webviewPanel is set
- `canRenderCodeBlock('mermaid')` → true
- `renderCodeBlock(code)` — from MermaidExportService.renderToSVG(code):
  - Posts `renderMermaidForExport` message to webview
  - Waits for response via Promise with requestId correlation
  - Returns `{ success, data: svgString, format: 'svg' }`

Internal state to carry over:
- Request queue (sequential processing)
- Pending requests map (requestId → Promise resolve/reject)
- 30-second timeout per request
- `handleRenderSuccess(requestId, svg)` / `handleRenderError(requestId, error)` — called by DiagramCommands when response arrives

Additional methods (not in DiagramPlugin interface, plugin-specific):
- `handleRenderSuccess(requestId: string, svg: string): void`
- `handleRenderError(requestId: string, error: string): void`
- `renderBatch(codes: string[]): Promise<Array<string | null>>` — used by DiagramPreprocessor

The batch rendering method is used only by DiagramPreprocessor. Two options:
- Add optional `renderBatch` to DiagramPlugin interface
- DiagramPreprocessor calls `renderCodeBlock` in a loop (Mermaid already processes sequentially internally)

Decision: DiagramPreprocessor calls `renderCodeBlock` in a sequential loop. The queue logic stays internal to MermaidPlugin.

Delete after migration: `src/services/export/MermaidExportService.ts`

Also update: `PanelContext.ts` — currently holds MermaidExportService reference. Remove it; the plugin lives in PluginRegistry.

### 2.3 Draw.io Plugin

File: `src/plugins/diagram/DrawIOPlugin.ts` (new)

Migrates from: `src/services/export/DrawIOService.ts` (196 LOC)

Implementation:
- metadata.id = `'drawio'`
- metadata.supportedCodeBlocks = `[]` (file-based only)
- metadata.supportedFileExtensions = `['.drawio', '.dio']`
- metadata.renderOutput = `'png'` (returns PNG despite SVG support — current behavior sends base64 PNG as dataUrl)
- metadata.requiresExternalTool = `true`
- metadata.externalToolName = `'draw.io Desktop'`
- metadata.configKeys = `['drawioPath']`

Methods to migrate:
- `isAvailable()` — inherited from AbstractCLIService pattern (check drawio CLI)
- `canRenderFile(path)` — check extension against supportedFileExtensions
- `renderFile(filePath, options)` — from DrawIOService.renderPNG(filePath):
  - CLI: `drawio --export --format png --output <temp> --transparent <filePath>`
  - Read temp file → Buffer
  - Returns `{ success, data: pngBuffer, format: 'png', fileMtime }`
- Also supports SVG output: `renderFile(filePath, { outputFormat: 'svg' })` → uses `--format svg`

Extends AbstractCLIService or carries over its pattern:
- `getConfigKey()` = `'drawioPath'`
- `getDefaultCliName()` = `'drawio'`
- Platform-specific path: `/Applications/draw.io.app/Contents/MacOS/draw.io` (macOS)
- Temp file management: ensureTempDir, getTempFilePath

Decision: the plugin can extend AbstractCLIService directly. AbstractCLIService stays as a utility base class in `src/services/export/` — it's shared infrastructure, not a plugin itself.

Delete after migration: `src/services/export/DrawIOService.ts`

### 2.4 Excalidraw Plugin

File: `src/plugins/diagram/ExcalidrawPlugin.ts` (new)

Migrates from: `src/services/export/ExcalidrawService.ts` (178 LOC)

Implementation:
- metadata.id = `'excalidraw'`
- metadata.supportedCodeBlocks = `[]` (file-based only)
- metadata.supportedFileExtensions = `['.excalidraw', '.excalidraw.json', '.excalidraw.svg']`
- metadata.renderOutput = `'svg'`
- metadata.requiresExternalTool = `false` (uses bundled @excalidraw/utils via worker)

Methods to migrate:
- `isAvailable()` — always true (worker is bundled)
- `canRenderFile(path)` — check extensions
- `renderFile(filePath)` — from ExcalidrawService.renderSVG(filePath):
  - If `.excalidraw.svg`: read file directly, return SVG string
  - Else: read JSON, spawn `excalidraw-worker.js` child process
  - Worker receives JSON via stdin, returns SVG via stdout
  - Uses BrowserService.findBrowserExecutable() for Playwright path
  - Returns `{ success, data: svgString, format: 'svg', fileMtime }`

Does NOT extend AbstractCLIService (not CLI-based).

Dependency: `excalidraw-worker.js` remains at its current location. Plugin references it via `path.join(__dirname, ...)`.

Delete after migration: `src/services/export/ExcalidrawService.ts`

### 2.5 PDF Plugin

File: `src/plugins/diagram/PDFPlugin.ts` (new)

Migrates from: `src/services/export/PDFService.ts` (204 LOC)

Implementation:
- metadata.id = `'pdf'`
- metadata.supportedCodeBlocks = `[]`
- metadata.supportedFileExtensions = `['.pdf']`
- metadata.renderOutput = `'png'`
- metadata.requiresExternalTool = `true`
- metadata.externalToolName = `'pdftoppm (poppler-utils)'`
- metadata.configKeys = `['popplerPath']`

Methods to migrate:
- `isAvailable()` — from AbstractCLIService (check pdftoppm)
- `canRenderFile(path)` — check .pdf extension
- `renderFile(filePath, { pageNumber, dpi })` — from PDFService.renderPage():
  - CLI: `pdftoppm -png -f N -l N -r DPI <file> <prefix>`
  - Searches for output with multiple naming patterns (prefix-N.png, prefix-NN.png, etc.)
  - Returns `{ success, data: pngBuffer, format: 'png', fileMtime }`
- `getFileInfo(filePath)` — from PDFService.getPageCount():
  - CLI: `pdfinfo <file>` → parse "Pages: N" from output
  - Returns `{ pageCount, fileMtime }`

Extends AbstractCLIService:
- `getConfigKey()` = `'popplerPath'`
- `getDefaultCliName()` = `'pdftoppm'`
- macOS paths: `/opt/homebrew/bin/pdftoppm`, `/usr/local/bin/pdftoppm`

Delete after migration: `src/services/export/PDFService.ts`

### 2.6 EPUB Plugin

File: `src/plugins/diagram/EPUBPlugin.ts` (new)

Migrates from: `src/services/export/EPUBService.ts` (147 LOC)

Implementation:
- metadata.id = `'epub'`
- metadata.supportedCodeBlocks = `[]`
- metadata.supportedFileExtensions = `['.epub']`
- metadata.renderOutput = `'png'`
- metadata.requiresExternalTool = `true`
- metadata.externalToolName = `'mutool (MuPDF)'`
- metadata.configKeys = `['mutoolPath']`

Methods to migrate:
- `isAvailable()` — from AbstractCLIService (check mutool)
- `canRenderFile(path)` — check .epub extension
- `renderFile(filePath, { pageNumber, dpi })` — from EPUBService.renderPage():
  - CLI: `mutool draw -r DPI -o <temp.png> <file> <pageNumber>`
  - Returns `{ success, data: pngBuffer, format: 'png', fileMtime }`
- `getFileInfo(filePath)` — from EPUBService.getPageCount():
  - Reads EPUB ZIP → META-INF/container.xml → OPF file → count spine itemrefs
  - No CLI needed for page count
  - Returns `{ pageCount, fileMtime }`

Extends AbstractCLIService:
- `getConfigKey()` = `'mutoolPath'`
- `getDefaultCliName()` = `'mutool'`

Delete after migration: `src/services/export/EPUBService.ts`

### 2.7 XLSX Plugin

File: `src/plugins/diagram/XlsxPlugin.ts` (new)

Migrates from: `src/services/export/XlsxService.ts` (225 LOC)

Implementation:
- metadata.id = `'xlsx'`
- metadata.supportedCodeBlocks = `[]`
- metadata.supportedFileExtensions = `['.xlsx', '.xls', '.ods']`
- metadata.renderOutput = `'png'`
- metadata.requiresExternalTool = `true`
- metadata.externalToolName = `'LibreOffice'`
- metadata.configKeys = `['libreOfficePath']`

Methods to migrate:
- `isAvailable()` — from AbstractCLIService (check soffice)
- `canRenderFile(path)` — check extensions
- `renderFile(filePath, { sheetNumber })` — from XlsxService.renderPNG():
  - CLI: `soffice --headless --convert-to png --outdir <tempDir> <file>`
  - LibreOffice creates one PNG per sheet with varying naming patterns
  - Search for correct sheet file (filename.png, filename-Sheet1.png, filename-1.png, etc.)
  - Read requested sheet, delete all temp PNGs
  - Returns `{ success, data: pngBuffer, format: 'png', fileMtime }`

Extends AbstractCLIService:
- `getConfigKey()` = `'libreOfficePath'`
- `getDefaultCliName()` = `'soffice'`
- macOS path: `/Applications/LibreOffice.app/Contents/MacOS/soffice`

Delete after migration: `src/services/export/XlsxService.ts`

---

## Phase 3: Export Plugins

### 3.1 Enhance ExportPlugin interface

File: `src/plugins/interfaces/ExportPlugin.ts` (modify — currently 175 LOC)

Current interface already covers most needs. Add:

```
ExportPlugin {
  // existing methods stay unchanged

  // new: preprocessing hook — called before the external tool runs
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

These are Marp-specific but the interface should allow plugin-specific options through the existing `pluginOptions` field.

### 3.2 Complete Marp Export Plugin

File: `src/plugins/export/MarpExportPlugin.ts` (modify — currently 187 LOC)

Currently the plugin is a thin wrapper calling MarpExportService. Convert it to contain the full implementation:

Migrate from: `src/services/export/MarpExportService.ts` (655 LOC)

What moves into the plugin:
- `export()` — full Marp CLI spawning logic:
  - Build CLI args (format, theme, engine, browser path, watch mode, pptx-editable)
  - Spawn `npx @marp-team/marp-cli` with args
  - Watch mode: detached process with PID tracking
  - Non-watch: wait for completion, return result
- `buildMarpCliArgs()` — Marp-specific argument construction
- `isMarpCliAvailable()` → maps to `isAvailable()`
- `getAvailableThemes()` — theme discovery
- `isWatching()` / `stopWatching()` — process lifecycle for watch mode
- Watch PID tracking and process management
- Handout generation (slides-per-page layout)

What moves into the plugin from `MarpExtensionService.ts` (208 LOC):
- VS Code Marp extension interaction
- Theme loading from extension

What moves into the plugin from `PresentationGenerator.ts` (373 LOC):
- `fromBoard()` — KanbanBoard → slide markdown
- Tag filtering, include filtering within generation

What moves into the plugin from `PresentationParser.ts` (281 LOC):
- Parsing presentation format back to tasks (used for re-import)

Preprocessing:
- `requiresDiagramPreprocessing()` → `true`
- `preprocess()` — calls DiagramPreprocessor (which now uses diagram plugins from registry)

After migration, delete:
- `src/services/export/MarpExportService.ts` (655 LOC)
- `src/services/export/MarpExtensionService.ts` (208 LOC)
- `src/services/export/PresentationGenerator.ts` (373 LOC)
- `src/services/export/PresentationParser.ts` (281 LOC)

Total: ~1500 LOC moves from 4 files into the plugin.

### 3.3 Create Pandoc Export Plugin

File: `src/plugins/export/PandocExportPlugin.ts` (new)

Migrates from: `src/services/export/PandocExportService.ts` (381 LOC)

Implementation:
- metadata.id = `'pandoc'`
- metadata.formats = `[{id: 'pandoc-docx', ...}, {id: 'pandoc-odt', ...}, {id: 'pandoc-epub', ...}]`
- metadata.requiresExternalTool = `true`
- metadata.externalToolName = `'Pandoc'`

Methods to migrate:
- `isAvailable()` — from PandocExportService.isPandocAvailable()
  - Platform-specific path resolution
  - Caches result
- `export(board, options)`:
  - Build CLI args: `pandoc -f markdown+smart -t <format> --standalone -o <output> <input>`
  - CWD = input directory (for relative paths)
  - Spawn pandoc, wait for completion
- `requiresDiagramPreprocessing()` → `true` (diagrams should be SVG/PNG for docx)

After migration, delete:
- `src/services/export/PandocExportService.ts` (381 LOC)

### 3.4 Extract built-in Markdown Export Plugin

File: `src/plugins/export/MarkdownExportPlugin.ts` (new)

Migrates from: embedded logic in `src/services/export/ExportService.ts`

This is the most complex extraction. ExportService.transformContent() contains ~500 LOC of format conversion and content transformation that belongs in a markdown export plugin.

What moves into the plugin:
- Format conversion: kanban → presentation format (slide separators)
- Format conversion: kanban → document format (H1 headers, content blocks)
- Content transformations applied during export:
  - Speaker notes handling (;; → comments, or remove)
  - HTML comment handling (remove or keep)
  - HTML content handling (keep or strip tags)
  - Media caption preservation
  - Embed handling (url/fallback/remove/iframe)
- The `applyContentTransformations()` method
- The `extractMarpClassesFromMarkdown()` method (Marp-specific, but used for format: presentation)

What stays in ExportService (core):
- Export orchestration (extract → transform → output pipeline)
- Include file handling (merge or copy)
- Asset packing and link rewriting
- Tag filtering (excludeTags, tagVisibility)
- File I/O (write to disk, copy to clipboard)
- Scope handling (board/column/task selection)

This extraction reduces ExportService from ~2482 LOC to ~1500 LOC. The plugin handles content format conversion.

Plugin metadata:
- metadata.id = `'markdown-export'`
- metadata.formats = `[{id: 'markdown', name: 'Markdown', extension: '.md'}]`

### 3.5 Refactor ExportService to use export plugins

File: `src/services/export/ExportService.ts` (modify)

After export plugins exist, change:
- `outputContent()` — instead of directly calling MarpExportService/PandocExportService:
  - `const plugin = PluginRegistry.getInstance().findExportPlugin(formatId)`
  - `await plugin.export(board, options)`
- Remove direct imports of MarpExportService, PandocExportService
- Remove `runMarpConversion()` and `runPandocConversion()` private methods
- Format conversion delegated to MarkdownExportPlugin or handled by export plugin's `preprocess()`

### 3.6 Refactor ExportCommands to use plugin discovery

File: `src/commands/ExportCommands.ts` (modify — currently 655 LOC)

- Replace hardcoded Marp/Pandoc references with plugin lookups
- Use `PluginRegistry.getSupportedExportFormats()` (already exists!) to discover available formats
- Watch mode start/stop goes through plugin interface

### 3.7 Move DiagramPreprocessor into export plugin infrastructure

File: `src/services/export/DiagramPreprocessor.ts` (modify)

After Phase 2, DiagramPreprocessor already uses diagram plugins. In Phase 3:
- DiagramPreprocessor becomes a shared utility that export plugins call via `preprocess()` hook
- Export plugins that need diagram preprocessing (Marp, Pandoc) call it during their `preprocess()` step
- DiagramPreprocessor stays in `src/services/export/` as shared infrastructure

---

## Phase 4: Embed Plugins (optional, lower priority)

### 4.1 Create EmbedPlugin interface

File: `src/plugins/interfaces/EmbedPlugin.ts` (new)

```
EmbedPlugin {
  metadata: {
    id: string                       // e.g. 'youtube'
    name: string
    version: string
    urlPatterns: string[]            // domain patterns, e.g. ['youtube.com/embed', 'youtu.be']
  }

  canHandle(url: string): boolean
  getEmbedHtml(url: string, attributes: Record<string, string>): string
  getExportFallback(url: string, mode: 'url' | 'fallback' | 'remove'): string
  getIframeAttributes?(): Record<string, string>   // override defaults per domain
}
```

### 4.2 Extend PluginRegistry for embed plugins

File: `src/plugins/registry/PluginRegistry.ts` (modify)

Add:
- `registerEmbedPlugin(plugin: EmbedPlugin): void`
- `findEmbedPlugin(url: string): EmbedPlugin | null`
- `getAllEmbedPlugins(): EmbedPlugin[]`

### 4.3 Extract embed domain handlers from ConfigurationService

Currently `ConfigurationService.ts` has a hardcoded domain whitelist (`embedKnownDomains`) with ~20 domains. Each domain would become an embed plugin (or grouped by provider):

Planned plugins:
- `YouTubeEmbedPlugin` — youtube.com/embed, youtube-nocookie.com, youtu.be
- `MiroEmbedPlugin` — miro.com/app/live-embed, miro.com/app/embed
- `FigmaEmbedPlugin` — figma.com/embed
- `CodeEmbedPlugin` — codepen.io, codesandbox.io, jsfiddle.net (grouped)
- `GenericEmbedPlugin` — fallback for any URL with `.embed` class

### 4.4 Update frontend embed detection

File: `src/html/markdownRenderer.js` (modify)

Currently `detectEmbed()` and `isKnownEmbedUrl()` use a static domain list sent from backend. Change to:
- Backend sends registered embed plugin metadata to frontend during init
- Frontend `detectEmbed()` checks against plugin-provided URL patterns
- `renderEmbed()` uses plugin-provided iframe attributes

This requires a new message type: `embedPluginsRegistered` sent from backend to frontend with plugin metadata.

### 4.5 Update export embed handling

File: `src/services/export/ExportService.ts` (modify)

Currently `applyEmbedTransform()` has hardcoded behavior. Change to:
- For each embed URL, find embed plugin
- Call `plugin.getExportFallback(url, mode)` to get export representation

---

## Phase 5: Markdown-it Processor Plugins (optional, lower priority)

### 5.1 Create MarkdownProcessorPlugin interface

File: `src/plugins/interfaces/MarkdownProcessorPlugin.ts` (new)

```
MarkdownProcessorPlugin {
  metadata: {
    id: string                    // e.g. 'markdown-it-mark'
    name: string
    version: string
    priority: number              // load order (lower = earlier)
    scope: 'frontend' | 'export' | 'both'  // where it's used
  }

  getMarkdownItPlugin(): (md: MarkdownIt, options?: any) => void
  getOptions?(): Record<string, any>
  activate?(context: PluginContext): Promise<void>
  deactivate?(): Promise<void>
}
```

### 5.2 Extend PluginRegistry for markdown processor plugins

File: `src/plugins/registry/PluginRegistry.ts` (modify)

Add:
- `registerMarkdownProcessorPlugin(plugin: MarkdownProcessorPlugin): void`
- `getMarkdownProcessorPlugins(scope: 'frontend' | 'export' | 'both'): MarkdownProcessorPlugin[]`

### 5.3 Refactor frontend markdown-it loading

File: `src/html/markdownRenderer.js` (modify)

Currently `createMarkdownItInstance()` has a hardcoded list of `.use()` calls for 13+ plugins. Change to:
- Backend sends registered markdown processor plugin list to frontend during init
- Frontend iterates plugins, calls `.use(plugin.getMarkdownItPlugin(), plugin.getOptions())`
- Custom bundled plugins (wikiLinks, tags, taskCheckbox, etc.) become MarkdownProcessorPlugins registered in PluginLoader
- CDN-loaded plugins (markdownitEmoji, markdownitFootnote, etc.) become lazy-loaded MarkdownProcessorPlugins

### 5.4 Convert existing markdown-it plugins to MarkdownProcessorPlugin format

Each existing markdown-it plugin gets wrapped:
- `WikiLinksPlugin` — `markdown-it-wikilinks-browser.js`
- `TagPlugin` — `markdown-it-tag-browser.js`
- `TaskCheckboxPlugin` — `markdown-it-task-checkbox-browser.js`
- `DatePersonTagPlugin` — custom
- `TemporalTagPlugin` — custom
- `SpeakerNotePlugin` — custom
- `HtmlCommentPlugin` — custom
- `EmojiPlugin` — CDN: `markdown-it-emoji`
- `FootnotePlugin` — CDN: `markdown-it-footnote`
- `MulticolumnPlugin` — CDN: `markdown-it-multicolumn`
- `MarkPlugin` — CDN: `markdown-it-mark`
- `SubPlugin` / `SupPlugin` — CDN
- `InsPlugin` — CDN: `markdown-it-ins`
- `StrikethroughAltPlugin` — CDN
- `AbbrPlugin` — CDN: `markdown-it-abbr`
- `ContainerPlugin` — CDN: `markdown-it-container`
- `IncludePlugin` — CDN: `markdown-it-include`
- `ImageFiguresPlugin` — CDN: `markdown-it-image-figures`
- `ImageAttrsPlugin` — CDN: `markdown-it-image-attrs`
- `MediaCustomPlugin` — CDN: `markdown-it-media-custom`

This is ~20 plugins. Each conversion is small (metadata + wrapper) but there are many.

---

## Execution Order Summary

```
Phase 1: Foundation
  1.1  Create DiagramPlugin interface
  1.2  Extend PluginRegistry (diagram methods)
  1.3  Extend PluginLoader (diagram registration)
  1.4  Refactor DiagramCommands → plugin lookup
  1.5  Refactor DiagramPreprocessor → plugin lookup
  1.6  Handle Mermaid webview dependency in PluginContext

Phase 2: Diagram Plugins (can be done in parallel after Phase 1)
  2.1  PlantUML Plugin     — migrate PlantUMLService
  2.2  Mermaid Plugin       — migrate MermaidExportService
  2.3  Draw.io Plugin       — migrate DrawIOService
  2.4  Excalidraw Plugin    — migrate ExcalidrawService
  2.5  PDF Plugin           — migrate PDFService
  2.6  EPUB Plugin          — migrate EPUBService
  2.7  XLSX Plugin          — migrate XlsxService

Phase 3: Export Plugins (after Phase 2, since export needs diagram plugins)
  3.1  Enhance ExportPlugin interface
  3.2  Complete Marp Export Plugin  — migrate MarpExportService + PresentationGenerator + PresentationParser + MarpExtensionService
  3.3  Create Pandoc Export Plugin  — migrate PandocExportService
  3.4  Extract Markdown Export Plugin — extract from ExportService
  3.5  Refactor ExportService → plugin delegation
  3.6  Refactor ExportCommands → plugin discovery
  3.7  DiagramPreprocessor becomes shared utility for export plugins

Phase 4: Embed Plugins (independent, can start after Phase 1)
  4.1  Create EmbedPlugin interface
  4.2  Extend PluginRegistry (embed methods)
  4.3  Extract embed domain handlers
  4.4  Update frontend embed detection
  4.5  Update export embed handling

Phase 5: Markdown-it Processor Plugins (independent, can start after Phase 1)
  5.1  Create MarkdownProcessorPlugin interface
  5.2  Extend PluginRegistry (markdown processor methods)
  5.3  Refactor frontend markdown-it loading
  5.4  Convert ~20 existing markdown-it plugins
```

---

## Files Deleted After Full Migration

Phase 2 deletions (7 files):
- `src/services/export/PlantUMLService.ts` (290 LOC)
- `src/services/export/MermaidExportService.ts` (191 LOC)
- `src/services/export/DrawIOService.ts` (196 LOC)
- `src/services/export/ExcalidrawService.ts` (178 LOC)
- `src/services/export/PDFService.ts` (204 LOC)
- `src/services/export/EPUBService.ts` (147 LOC)
- `src/services/export/XlsxService.ts` (225 LOC)

Phase 3 deletions (4 files):
- `src/services/export/MarpExportService.ts` (655 LOC)
- `src/services/export/MarpExtensionService.ts` (208 LOC)
- `src/services/export/PresentationGenerator.ts` (373 LOC)
- `src/services/export/PresentationParser.ts` (281 LOC)
- `src/services/export/PandocExportService.ts` (381 LOC)

Total: 12 files, ~3329 LOC removed from services, moved into plugins.

## Files That Stay (shared infrastructure)

- `src/services/export/AbstractCLIService.ts` — base class for CLI-based diagram plugins
- `src/services/export/DiagramPreprocessor.ts` — shared export utility (uses diagram plugins)
- `src/services/export/ExportService.ts` — orchestrator (uses export plugins)
- `src/services/BrowserService.ts` — shared browser utility (used by Excalidraw plugin)
- `src/services/export/SvgReplacementService.ts` — SVG manipulation utility
