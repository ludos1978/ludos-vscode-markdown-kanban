# Cleanup Tasks - Codebase Simplification

## Priority 1: Extract Export UI from webview.js
- [ ] Create `src/html/exportUI.js` with 18 export functions
- [ ] Move functions: showExportDialog, showExportDialogWithSelection, closeExportModal, setExportDefaultFolder, selectExportFolder, setSelectedExportFolder, executeExport, initializeExportTree, executeUnifiedExport, handleExportResult, handleFormatChange, applyExportPreset, saveLastExportSettings, resetPresetToCustom, addExportSettingChangeListeners, toggleAutoExport, updateAutoExportButton, executeQuickExport, handleColumnExportResult, filterTagsForExport
- [ ] Update webview.html to include new script
- [ ] Verify all exports work correctly

## Priority 2: Extract Marp UI from webview.js
- [ ] Create `src/html/marpUI.js` with 21 Marp functions
- [ ] Move functions: handleUseMarpChange, handleMarpOutputFormatChange, handleMarpHandoutChange, handleMarpHandoutPresetChange, applyPresetMarpPresentation, applyPresetMarpPdf, checkMarpStatus, getMarpClassesForElement, isMarpDirectiveActive, setMarpDirective, toggleMarpDirective, refreshMarpDirectivesSubmenu, toggleMarpClass, handleMarpStatus, handleMarpAvailableClasses, handleMarpThemesAvailable, loadMarpThemes, toggleMarpGlobalMenu, populateMarpGlobalMenu, createMarpInputField, updateMarpGlobalSetting, updateYamlHeaderString, refreshYamlPreview
- [ ] Update webview.html to include new script
- [ ] Verify all Marp features work correctly

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

### 4b: DEBUG pattern (4 files ’ SmartLogger)
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

## Metrics Target
- webview.js: 7,740 ’ ~3,500 lines
- New focused modules: 7 files
- Functions per file: <30 average
- Duplicate patterns eliminated: 14+
