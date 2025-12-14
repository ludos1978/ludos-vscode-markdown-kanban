# Cleanup Tasks - Codebase Simplification

## COMPLETED: Priority 1 & 2 - Extract Export + Marp UI from webview.js
- [x] Created `src/html/exportMarpUI.js` combining export and Marp functions (they are tightly coupled)
- [x] Moved 50+ functions including: showExportDialog, executeUnifiedExport, handleMarpStatus, toggleMarpClass, etc.
- [x] Updated webview.html to include new script
- [x] webview.js reduced from 7,740 lines to 5,388 lines (-2,352 lines)
- [x] exportMarpUI.js: 1,918 lines
- [x] Build compiles successfully

## COMPLETED: Priority 3 - Extract Clipboard Handler from webview.js
- [x] Created `src/html/clipboardHandler.js` with clipboard/drag functions
- [x] Moved functions: handleClipboardMouseDown, handleClipboardDragStart, handleClipboardDragEnd, showClipboardPreview, hideClipboardPreview, handleEmptyCardDragStart, handleEmptyCardDragEnd, handleEmptyColumnDragStart, handleEmptyColumnDragEnd, handleTemplateMenuDragStart, handleTemplateMenuDragEnd
- [x] Updated webview.html to include new script
- [x] clipboardHandler.js: 612 lines

## COMPLETED: Priority 4a - Consolidate showOpenDialog helper (9 locations)
- [x] Created `src/utils/fileDialogUtils.ts` with selectMarkdownFile() helper
- [x] Exported from `src/utils/index.ts`
- [x] Replaced duplicates in extension.ts (4 locations)
- [x] Replaced duplicates in IncludeCommands.ts (4 locations)
- [x] Replaced duplicate in fileManager.ts (1 location)

## SKIPPED: Priority 4b - DEBUG pattern consolidation
- Skipped because SmartLogger is browser-side only (window.createSmartLogger)
- 3 of 4 target files (ExportCommands.ts, TemplateCommands.ts, DiagramPreprocessor.ts) are TypeScript backend files
- Current DEBUG pattern is clean, efficient, and has zero runtime cost when disabled

## COMPLETED: Priority 5 - Extract Navigation Functions from webview.js
- [x] Created `src/html/navigationHandler.js` with navigation functions
- [x] Moved functions: updateCardList, focusCard, focusSection, getVisibleTaskCards, getCurrentCardPosition, getCardClosestToTopLeft, navigateToCard, handleTaskNavigation, handleSectionNavigation
- [x] Moved state: currentFocusedCard, allCards
- [x] Updated webview.html to include new script
- [x] navigationHandler.js: 388 lines

## COMPLETED: Priority 6 - Extract Template Dialog from webview.js
- [x] Created `src/html/templateDialog.js` with template functions
- [x] Moved functions: showTemplateVariableDialog, closeTemplateVariableDialog, submitTemplateVariablesFromForm, submitTemplateVariables
- [x] Updated webview.html to include new script
- [x] templateDialog.js: 189 lines

## COMPLETED: Priority 7 - Extract Folding State Manager from webview.js
- [x] Created `src/html/foldingStateManager.js` with folding functions
- [x] Moved functions: getCurrentDocumentFoldingState, saveCurrentFoldingState, restoreFoldingState, applyDefaultFoldingToNewDocument, updateDocumentUri
- [x] Moved state: documentFoldingStates, currentDocumentUri
- [x] Updated webview.html to include new script
- [x] foldingStateManager.js: 131 lines

## Final Metrics (Round 1)
- **webview.js**: 7,740 → 4,176 lines (**46% reduction** - 3,564 lines removed!)
- **New focused modules**: 5 created
  - exportMarpUI.js: 1,918 lines
  - clipboardHandler.js: 612 lines
  - navigationHandler.js: 388 lines
  - templateDialog.js: 189 lines
  - foldingStateManager.js: 131 lines
- **Total extracted**: 3,238 lines
- **Backend consolidation**: selectMarkdownFile() helper created, 9 duplicates removed

---

## COMPLETED: Round 2 - menuOperations.js Consolidation

### Priority 8 - Create Shared Menu Utilities (menuUtils.js)
- [x] Created `src/html/utils/menuUtils.js` with shared utilities
- [x] Updated webview.html to include new script
- [x] menuUtils.js: 367 lines

### Key utilities created:
**Element Lookup:**
- `findColumnInBoard(columnId)` - Find column in cachedBoard or currentBoard
- `findTaskInBoard(taskId, columnId)` - Find task with fallback search

**Tag Operations:**
- `shouldExecute(key, throttleMs)` - Throttle duplicate calls
- `buildTagPattern(tagName)` - Build regex for tag matching
- `toggleTagInTitle(title, tagName, preserveRowTag)` - Toggle tag in title
- `syncTitleToBoards(elementType, elementId, columnId, newTitle)` - Sync across board references

**Display Updates:**
- `updateTemporalAttributes(element, text, elementType, context)` - Update temporal attributes
- `updateTagDataAttributes(element, newTitle, elementType)` - Update tag data attributes
- `updateTagChipButton(elementId, tagName, isActive)` - Update tag chip state
- `applyTagFlash(element, isActive)` - Apply visual flash effect

**Include Mode:**
- `addIncludeSyntax(title, fileName)` - Add include syntax to title
- `removeIncludeSyntax(title)` - Remove include syntax from title
- `updateIncludeInTitle(title, newFileName)` - Update include file in title
- `hasIncludeMode(element)` - Check if element has include mode
- `getIncludeFile(element)` - Get current include file
- `postEditMessage(elementType, elementId, columnId, newTitle)` - Post edit to VS Code

### Functions Refactored:

**Tag Toggle Functions (using menuUtils):**
- `toggleColumnTag()` - ~150 → ~60 lines (60% reduction)
- `toggleTaskTag()` - ~180 → ~55 lines (69% reduction)

**Display Update Functions (using menuUtils):**
- `updateColumnDisplayImmediate()` - ~100 → ~45 lines (55% reduction)
- `updateTaskDisplayImmediate()` - ~110 → ~42 lines (62% reduction)

**Include Mode Functions (using menuUtils):**
- `toggleColumnIncludeMode()` - ~32 → ~18 lines (44% reduction)
- `enableColumnIncludeMode()` - ~27 → ~11 lines (59% reduction)
- `editColumnIncludeFile()` - ~35 → ~17 lines (51% reduction)
- `updateColumnIncludeFile()` - ~34 → ~13 lines (62% reduction)
- `disableColumnIncludeMode()` - ~38 → ~18 lines (53% reduction)
- `enableTaskIncludeMode()` - ~34 → ~11 lines (68% reduction)
- `editTaskIncludeFile()` - ~40 → ~17 lines (58% reduction)
- `updateTaskIncludeFile()` - ~41 → ~13 lines (68% reduction)
- `disableTaskIncludeMode()` - ~40 → ~14 lines (65% reduction)
- `toggleTaskIncludeMode()` - ~30 → ~13 lines (57% reduction)

### Round 2 Metrics
- **menuOperations.js**: 4,682 → 4,144 lines (**538 lines removed**)
- **New utility module**: menuUtils.js (367 lines)
- **Net reduction**: 171 lines removed with much better code organization
- **14 functions refactored** to use shared utilities
- **Duplicate patterns eliminated**: element lookup, tag toggle, display update, include mode operations

---

## Round 3 Analysis - No Major Issues Remaining

### Current File Sizes
| File | Lines |
|------|-------|
| boardRenderer.js | 5,327 |
| webview.js | 4,176 |
| menuOperations.js | 4,144 |
| dragDrop.js | 4,005 |

### Minor Patterns Identified (Not Worth Consolidating)
Remaining patterns are small and fragmented:
- Tag extraction pipeline: ~25-30 lines in boardRenderer.js
- Header/footer bar classes: ~12-14 lines
- Drop indicator factory: ~24 lines in dragDrop.js
- JSON parse fallback: ~15-20 lines scattered

**Total potential savings**: ~120-160 lines across 13,500+ lines (~1% improvement)
**Verdict**: Diminishing returns - not worth additional refactoring complexity

### Cleanup Summary
| Round | Target | Lines Removed | Key Changes |
|-------|--------|---------------|-------------|
| 1 | webview.js | 3,564 | 5 new modules extracted |
| 2 | menuOperations.js | 538 | menuUtils.js created, 14 functions refactored |
| 3 | Analysis | 0 | No major patterns found |

**Total lines reduced**: ~4,100 lines
**New utility modules**: 6 (exportMarpUI.js, clipboardHandler.js, navigationHandler.js, templateDialog.js, foldingStateManager.js, menuUtils.js)
**Code quality**: Significantly improved with shared utilities and better separation of concerns
