# Cleanup Tasks - Rounds 1-5

## Completed

### Round 5 - Dead Code Removal (Board Caching)
- [x] Removed `KanbanFileService._cachedBoardFromWebview` field (was never set, always null)
- [x] Simplified `KanbanFileService.getState()` return type (removed dead field)
- [x] Removed dead if-branch in `KanbanFileService.ensureBoardAndSendUpdate()`
- [x] Removed `_cachedBoardFromWebview` from `PanelCommandAccess` interface (orphaned type)
- [x] Removed no-op assignment in `DebugCommands.ts:334`
- [x] Simplified `KanbanWebviewPanel._restoreStateFromFileService()`

### Round 4 - Regex Pattern Unification
- [x] Created `src/shared/regexPatterns.ts` with centralized patterns as factory functions
- [x] Added `MarkdownPatterns` (image, link, include), `HtmlPatterns` (img, media), `DiagramPatterns` (plantuml, mermaid, drawio, excalidraw), `PathPatterns` (url, windowsDrive)
- [x] Updated `ExportService.ts` to use shared `MarkdownPatterns`, `HtmlPatterns`, `isUrl()`
- [x] Updated `MediaTracker.ts` to use shared `MarkdownPatterns`, `HtmlPatterns`
- [x] Updated `DiagramPreprocessor.ts` to use shared `DiagramPatterns`
- [x] Exported patterns from `src/shared/index.ts`

### Round 3 - Files Directory
- [x] Fixed IncludeFile to use base class `isDocumentDirtyInVSCode()` (was duplicating 4 lines)
- [x] Extracted `_setupWatcherSubscriptions()` helper in MarkdownFile.ts (eliminated ~15 lines duplication)
- [x] Added `_toRelativePath()` and `_normalizedLookup()` helpers in MarkdownFileRegistry.ts
- [x] Simplified `getByRelativePath()`, `hasByRelativePath()`, `ensureIncludeFileRegistered()` using new helpers

### Round 2 - Frontend JavaScript
- [x] Removed duplicate `toggleFileBarMenu` and `positionFileBarDropdown` from menuOperations.js (dead code)
- [x] Improved `positionFileBarDropdown` in webview.js to use dynamic measurement
- [x] Consolidated task movement functions into single `moveTaskInDirection()` with wrapper functions

### Round 2 - Commands (TypeScript)
- [x] Extracted `_extractBase64Data()` helper in ClipboardCommands.ts (replaced 3 duplicates)
- [x] Consolidated path replacement logic in PathCommands.ts into `_replacePathInFiles()` helper (~80 lines saved)

### Round 1 - Backend (TypeScript)
- [x] Removed unused `deepCloneBoard` from BoardStore.ts
- [x] Removed unused `_emitEvent` parameter from BoardStore.setBoard()

---

## Future Refactoring (Critical Issues Identified)

### CRITICAL: ExportService God Object (1,795 lines)
**Location:** `src/services/export/ExportService.ts`

The ExportService has >12 distinct responsibilities:
1. Export coordination (extractContent, transformContent, outputContent)
2. Content transformations (speaker notes, HTML comments)
3. Include file processing (processIncludedFiles - 203 lines)
4. Asset detection and packing
5. Path rewriting (rewriteLinksForExport - 53 lines)
6. Diagram preprocessing coordination
7. Marp conversion pipeline (runMarpConversion - 169 lines)
8. Tag filtering
9. Presentation conversion (convertPresentationToKanban - 69 lines)
10. Board filtering (filterBoard - 67 lines)
11. Marp class extraction (extractMarpClassesFromMarkdown - 59 lines)
12. Column extraction (extractColumnContent - 51 lines)

**Recommendation:** Split into:
- `ExportCoordinator` (orchestration)
- `ContentTransformer` (speech notes, HTML transforms, tag filtering)
- `IncludeProcessor` (include file handling)
- `AssetPacker` (asset detection, filtering, packing)
- `LinkRewriter` (all link rewriting logic)
- `PresentationConverter` (board ↔ presentation conversion)

### ~~HIGH: Duplicate Regex Patterns Across 4 Services~~ ✅ RESOLVED
**Status:** Fixed in Round 4 - patterns consolidated into `src/shared/regexPatterns.ts`
- ExportService, MediaTracker, DiagramPreprocessor now use shared patterns
- PathConversionService has its own specialized patterns (different capture groups for path conversion)

### ~~MEDIUM: Path Extraction Logic Duplicated in 3 Services~~ ✅ ANALYZED - INTENTIONAL
**Status:** Analyzed - each serves different purpose, all use shared regex patterns now
- `ExportService.findAssets()` - returns file existence/size for asset packing
- `MediaTracker.extractMediaReferences()` - returns paths filtered by media type
- `PathConversionService.extractPaths()` - returns position info for in-place replacement

All are internal helper methods (6 total calls, all within own class). With shared regex patterns in place, remaining "duplication" is just each adding its specific data.

### ~~MEDIUM: MainKanbanFile Dual Board Caching~~ ✅ RESOLVED
**Status:** Fixed in Round 5 - removed dead code, documented intentional design

**Finding:** There were actually FOUR board locations, not two:
1. `BoardStore.board` - undo/redo, rendering (working)
2. `MainKanbanFile._board` - parsed board cache (working)
3. `MainKanbanFile._cachedBoardFromWebview` - UI edit buffer (working, intentional)
4. `KanbanFileService._cachedBoardFromWebview` - **DEAD CODE** (removed)

The MainKanbanFile dual caching is intentional and correct:
- `_board` = "last parsed from disk" (file truth)
- `_cachedBoardFromWebview` = "current UI state" (UI truth, set by BoardSyncHandler)

---

## Skipped (with rationale)

### Include mode column/task operations
Already uses shared utilities (`window.menuUtils`), differences are meaningful.

### Move createDiagramFile to DiagramCommands
Would require duplicating helper methods or extracting to shared module.

### Remove scrollToElementIfNeeded
Analysis was incorrect - function IS used in multiple places.

### Merge filename generation methods
Methods use fundamentally different algorithms (hash-based vs counter-based).

### ensureIncludeRegistered absolute path handling
Uses `mainFile` parameter directly (not `this.getMainFile()`), intentionally different pattern.
