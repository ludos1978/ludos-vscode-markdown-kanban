# Cleanup Tasks - Rounds 2 & 3

## Completed

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

### HIGH: Duplicate Regex Patterns Across 4 Services
**Problem:** Image/link regex patterns are defined independently in:
- ExportService.ts (lines 539-548)
- MediaTracker.ts (lines 216-248)
- PathConversionService.ts (lines 61-84) - already centralized
- DiagramPreprocessor.ts (lines 104-158)

**Issue:** Inconsistent pattern variations (title attribute handling differs, causing bugs)

**Recommendation:** Consolidate all patterns into `src/shared/regexPatterns.ts` or extend PathConversionService.PATTERNS

### MEDIUM: Path Extraction Logic Duplicated in 3 Services
Three independent implementations:
- ExportService.findAssets() (52 lines)
- MediaTracker.extractMediaReferences() (46 lines)
- PathConversionService.extractPaths() (108 lines)

**Recommendation:** Create unified `ContentPathExtractor` interface

### MEDIUM: MainKanbanFile Dual Board Caching
**Location:** `src/files/MainKanbanFile.ts`

Two board caching mechanisms:
- `_board` field (persistent cache)
- `_cachedBoardFromWebview` field (temporary for pending edits)

Creates potential sync issues. Consider single source of truth with event-based updates.

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
