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

## Final Metrics
- **webview.js**: 7,740 → 4,176 lines (**46% reduction** - 3,564 lines removed!)
- **New focused modules**: 5 created
  - exportMarpUI.js: 1,918 lines
  - clipboardHandler.js: 612 lines
  - navigationHandler.js: 388 lines
  - templateDialog.js: 189 lines
  - foldingStateManager.js: 131 lines
- **Total extracted**: 3,238 lines
- **Backend consolidation**: selectMarkdownFile() helper created, 9 duplicates removed
