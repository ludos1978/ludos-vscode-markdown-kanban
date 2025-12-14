# Cleanup Tasks - Codebase Simplification

## COMPLETED: Priority 1 & 2 - Extract Export + Marp UI from webview.js
- [x] Created `src/html/exportMarpUI.js` combining export and Marp functions (they are tightly coupled)
- [x] Moved 50+ functions including: showExportDialog, executeUnifiedExport, handleMarpStatus, toggleMarpClass, etc.
- [x] Updated webview.html to include new script
- [x] webview.js reduced from 7,740 lines to 5,388 lines (-2,352 lines)
- [x] exportMarpUI.js: 1,918 lines
- [x] Build compiles successfully

## Priority 3: Extract Clipboard Handler from webview.js
- [ ] Create `src/html/clipboardHandler.js` with clipboard/drag functions
- [ ] Move functions: handleClipboardMouseDown, handleClipboardDragStart, handleClipboardDragEnd, showClipboardPreview, hideClipboardPreview, handleEmptyCardDragStart, handleEmptyCardDragEnd, handleEmptyColumnDragStart, handleEmptyColumnDragEnd, handleTemplateMenuDragStart, handleTemplateMenuDragEnd
- [ ] Update webview.html to include new script
- [ ] Verify clipboard and drag operations work correctly

## Priority 4: Consolidate Duplicate Patterns

### 4a: showOpenDialog helper (10 locations)
- [ ] Create selectMarkdownFile() helper in extension.ts
- [ ] Replace duplicate in openKanbanCommand (line 98)
- [ ] Replace duplicate in openKanbanFromPanelCommand (line 198)
- [ ] Replace duplicate in switchFileCommand (line 228)
- [ ] Replace duplicate in addFileToSidebarCommand (line 270)
- [ ] Check and replace in IncludeCommands.ts (4 locations)
- [ ] Check and replace in ExportCommands.ts (1 location)
- [ ] Check and replace in fileManager.ts (1 location)

### 4b: DEBUG pattern (4 files -> SmartLogger)
- [ ] Replace DEBUG pattern in ExportCommands.ts with SmartLogger
- [ ] Replace DEBUG pattern in TemplateCommands.ts with SmartLogger
- [ ] Replace DEBUG pattern in DiagramPreprocessor.ts with SmartLogger
- [ ] Replace DEBUG pattern in markdown-it-include-browser.js with SmartLogger

## Priority 5: Extract Navigation Functions from webview.js
- [ ] Create `src/html/navigationHandler.js` with navigation functions
- [ ] Move functions: updateCardList, focusCard, focusSection, getVisibleTaskCards, getCurrentCardPosition, getCardClosestToTopLeft, navigateToCard, handleTaskNavigation, handleSectionNavigation
- [ ] Update webview.html to include new script
- [ ] Verify keyboard navigation works correctly

## Priority 6: Extract Template Dialog from webview.js
- [ ] Create `src/html/templateDialog.js` with template functions
- [ ] Move functions: showTemplateVariableDialog, closeTemplateVariableDialog, submitTemplateVariablesFromForm, submitTemplateVariables
- [ ] Update webview.html to include new script
- [ ] Verify template variable dialogs work correctly

## Priority 7: Extract Folding State Manager from webview.js
- [ ] Create `src/html/foldingStateManager.js` with folding functions
- [ ] Move functions: getCurrentDocumentFoldingState, saveCurrentFoldingState, restoreFoldingState, applyDefaultFoldingToNewDocument, updateDocumentUri
- [ ] Move related state: documentFoldingStates, currentDocumentUri
- [ ] Update webview.html to include new script
- [ ] Verify folding state persistence works correctly

## Metrics Progress
- webview.js: 7,740 -> 5,388 lines (target ~3,500)
- New focused modules: 1 of 6 created
- Lines extracted: 2,352 (+ 29 filterTagsForExport)
