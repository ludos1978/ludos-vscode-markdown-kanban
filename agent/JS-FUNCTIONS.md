# Kanban Extension JavaScript Function Reference

This document lists all functions in the JavaScript codebase for the Markdown Kanban extension (webview/frontend code).

**Last Updated:** 2025-10-26

## Format
Each entry follows: `path_to_filename-functionname` with a brief description

---

## Recent Critical Fixes

### Edit Mode Protection (2025-10-26)
**Files:** [src/html/webview.js:2650-2677](src/html/webview.js#L2650-L2677), [src/html/webview.js:2732-2759](src/html/webview.js#L2732-L2759)

**Problem**: During edit mode, backend sends content updates that trigger DOM re-rendering, destroying the active editor and causing editing failures.

**Solution**: Added `isEditing` guard to content update handlers:
```javascript
const isEditing = window.taskEditor && window.taskEditor.currentEditor;
if (!isEditing) {
    // Re-render column/task
} else {
    console.log('Skipping render - user is editing');
}
```

**Affected Functions**:
- `updateColumnContent` - Skips rendering when user is editing
- `updateTaskContent` - Skips rendering when user is editing

**Key Check**: `window.taskEditor.currentEditor` - active editor instance

---

## src/html/webview.js - Main Webview Controller

- src_html_webview-generateMD5Hash - Generate MD5 hash using Web Crypto API
- src_html_webview-generateFontSizeCSS - Generate CSS for font size multipliers
- src_html_webview-injectFontSizeCSS - Inject dynamic font size CSS into document
- src_html_webview-getCSS - Get CSS value for option type and value
- src_html_webview-getValue - Get value from CSS string for option type
- src_html_webview-getCurrentSettingValue - Get current setting value for config key
- src_html_webview-updateAllMenuIndicators - Update all menu indicators with current values
- src_html_webview-generateMenuHTML - Generate HTML for dynamic menu
- src_html_webview-populateDynamicMenus - Populate all dynamic menus
- src_html_webview-readClipboardContent - Read and process clipboard content
- src_html_webview-createFileMarkdownLink - Create markdown link from file path
- src_html_webview-processClipboardText - Process clipboard text and create markdown link
- src_html_webview-extractDomainFromUrl - Extract domain from URL
- src_html_webview-fetchUrlTitle - Fetch page title from URL
- src_html_webview-updateClipboardCardSource - Update clipboard card with URL metadata
- src_html_webview-positionFileBarDropdown - Position file bar dropdown menu
- src_html_webview-toggleFileBarMenu - Toggle file bar menu visibility
- src_html_webview-applyAndSaveSetting - Apply setting and save to backend
- src_html_webview-applyColumnWidth - Apply column width setting
- src_html_webview-setColumnWidth - Set column width
- src_html_webview-applyLayoutRows - Apply layout rows setting
- src_html_webview-setLayoutRows - Set layout rows
- src_html_webview-applyRowHeight - Apply row height setting
- src_html_webview-applyRowHeightSetting - Apply row height from setting
- src_html_webview-setRowHeight - Set row height
- src_html_webview-applyStickyStackMode - Apply sticky stack mode
- src_html_webview-setStickyStackMode - Set sticky stack mode
- src_html_webview-filterTagsFromText - Filter tags from text based on visibility
- src_html_webview-applyTagVisibility - Apply tag visibility setting
- src_html_webview-setTagVisibility - Set tag visibility
- src_html_webview-applyHtmlCommentRenderMode - Apply HTML comment render mode
- src_html_webview-setHtmlCommentRenderMode - Set HTML comment render mode
- src_html_webview-applyHtmlContentRenderMode - Apply HTML content render mode
- src_html_webview-setHtmlContentRenderMode - Set HTML content render mode
- src_html_webview-filterTagsForExport - Filter tags for export with visibility setting
- src_html_webview-applyWhitespace - Apply whitespace setting
- src_html_webview-setWhitespace - Set whitespace
- src_html_webview-applyTaskMinHeight - Apply task minimum height
- src_html_webview-setTaskMinHeight - Set task minimum height
- src_html_webview-applySectionHeight - Apply section height
- src_html_webview-setSectionHeight - Set section height
- src_html_webview-applyTaskSectionHeight - Apply task section height
- src_html_webview-setTaskSectionHeight - Set task section height
- src_html_webview-detectRowsFromBoard - Detect number of rows from board data
- src_html_webview-getColumnRow - Get row number from column title
- src_html_webview-updateColumnRowTag - Update column row tag
- src_html_webview-cleanupRowTags - Cleanup row tags in board
- src_html_webview-getCurrentDocumentFoldingState - Get current document folding state
- src_html_webview-saveCurrentFoldingState - Save current folding state
- src_html_webview-restoreFoldingState - Restore folding state for document
- src_html_webview-applyDefaultFoldingToNewDocument - Apply default folding to new document
- src_html_webview-loadBoard - Load board data from backend
- src_html_webview-handleBoardUpdate - Handle board update message
- src_html_webview-sendMessageToExtension - Send message to extension backend
- src_html_webview-setupMessageListener - Setup message listener for backend communication
- src_html_webview-initializeWebview - Initialize webview on load

---

## src/html/boardRenderer.js - Board Rendering

- src_html_boardRenderer-getBoardElement - Get board container element
- src_html_boardRenderer-getEditorBackground - Get editor background color
- src_html_boardRenderer-getColumnIdFromElement - Get column ID from DOM element
- src_html_boardRenderer-getTaskIdFromElement - Get task ID from DOM element
- src_html_boardRenderer-interpolateColor - Interpolate color between two colors
- src_html_boardRenderer-wrapTaskSections - Wrap task sections with containers
- src_html_boardRenderer-applyTagStyles - Apply CSS styles for tags
- src_html_boardRenderer-ensureTagStyleExists - Ensure tag style element exists
- src_html_boardRenderer-extractFirstTag - Extract first tag from text
- src_html_boardRenderer-debouncedRenderBoard - Debounced board render function
- src_html_boardRenderer-applyDefaultFoldingState - Apply default folding state
- src_html_boardRenderer-setDefaultFoldingState - Set default folding state
- src_html_boardRenderer-getGlobalColumnFoldState - Get global column fold state
- src_html_boardRenderer-toggleAllColumns - Toggle all columns fold state
- src_html_boardRenderer-updateGlobalColumnFoldButton - Update global fold button
- src_html_boardRenderer-applyFoldingStates - Apply folding states to elements
- src_html_boardRenderer-getActiveTagsInTitle - Get active tags in title
- src_html_boardRenderer-getFullTagContent - Get full tag content
- src_html_boardRenderer-getAllTagsInUse - Get all tags in use
- src_html_boardRenderer-getUserAddedTags - Get user-added tags
- src_html_boardRenderer-generateTagMenuItems - Generate tag menu items
- src_html_boardRenderer-generateGroupTagItems - Generate grouped tag menu items
- src_html_boardRenderer-generateFlatTagItems - Generate flat tag menu items
- src_html_boardRenderer-renderSingleColumn - Render single column
- src_html_boardRenderer-renderBoard - Render entire board
- src_html_boardRenderer-getFoldAllButtonState - Get fold all button state
- src_html_boardRenderer-toggleAllTasksInColumn - Toggle all tasks in column
- src_html_boardRenderer-updateFoldAllButton - Update fold all button state
- src_html_boardRenderer-createColumnElement - Create column DOM element
- src_html_boardRenderer-getTaskEditContent - Get task edit content
- src_html_boardRenderer-renderTask - Render single task element
- src_html_boardRenderer-createTaskElement - Create task DOM element

---

## src/html/taskEditor.js - Task Editing

- src_html_taskEditor-editTitle - Edit task title inline
- src_html_taskEditor-editDescription - Edit task description inline
- src_html_taskEditor-editColumnTitle - Edit column title inline
- src_html_taskEditor-saveTaskEdit - Save task edit changes
- src_html_taskEditor-cancelTaskEdit - Cancel task edit
- src_html_taskEditor-setupTaskEditHandlers - Setup task edit event handlers
- src_html_taskEditor-handleTaskClick - Handle task click event
- src_html_taskEditor-handleDescriptionClick - Handle description click event

---

## src/html/menuOperations.js - Menu Operations

- src_html_menuOperations-openContextMenu - Open context menu at position
- src_html_menuOperations-closeContextMenu - Close context menu
- src_html_menuOperations-handleColumnMenu - Handle column context menu
- src_html_menuOperations-handleTaskMenu - Handle task context menu
- src_html_menuOperations-handleBoardMenu - Handle board context menu
- src_html_menuOperations-addColumn - Add new column
- src_html_menuOperations-deleteColumn - Delete column
- src_html_menuOperations-duplicateColumn - Duplicate column
- src_html_menuOperations-addTask - Add new task
- src_html_menuOperations-deleteTask - Delete task
- src_html_menuOperations-duplicateTask - Duplicate task
- src_html_menuOperations-toggleTaskComplete - Toggle task completion
- src_html_menuOperations-openColumnIncludeDialog - Open column include file dialog
- src_html_menuOperations-openTaskIncludeDialog - Open task include file dialog
- src_html_menuOperations-saveColumnInclude - Save column include file
- src_html_menuOperations-saveTaskInclude - Save task include file
- src_html_menuOperations-loadColumnInclude - Load column include file
- src_html_menuOperations-loadTaskInclude - Load task include file

---

## src/html/dragDrop.js - Drag and Drop

- src_html_dragDrop-setupDragAndDrop - Setup drag and drop event handlers
- src_html_dragDrop-handleDragStart - Handle drag start event
- src_html_dragDrop-handleDragOver - Handle drag over event
- src_html_dragDrop-handleDragEnd - Handle drag end event
- src_html_dragDrop-handleDrop - Handle drop event
- src_html_dragDrop-getDropTarget - Get drop target element
- src_html_dragDrop-calculateDropPosition - Calculate drop position
- src_html_dragDrop-moveTask - Move task to new position
- src_html_dragDrop-moveColumn - Move column to new position

---

## src/html/markdownRenderer.js - Markdown Rendering

- src_html_markdownRenderer-initializeMarkdownIt - Initialize markdown-it parser
- src_html_markdownRenderer-renderMarkdown - Render markdown to HTML
- src_html_markdownRenderer-renderTaskDescription - Render task description markdown
- src_html_markdownRenderer-renderColumnTitle - Render column title markdown
- src_html_markdownRenderer-processLinks - Process links in rendered HTML
- src_html_markdownRenderer-processImages - Process images in rendered HTML
- src_html_markdownRenderer-processIncludes - Process include directives
- src_html_markdownRenderer-sanitizeHtml - Sanitize HTML output

---

## src/html/search.js - Search Functionality

- src_html_search-initializeSearch - Initialize search functionality
- src_html_search-handleSearchInput - Handle search input event
- src_html_search-performSearch - Perform search on board
- src_html_search-highlightSearchResults - Highlight search results
- src_html_search-clearSearchResults - Clear search results
- src_html_search-navigateSearchResults - Navigate through search results

---

## src/html/submenuGenerator.js - Submenu Generation

- src_html_submenuGenerator-generateSubmenu - Generate submenu HTML
- src_html_submenuGenerator-generateColumnSubmenu - Generate column submenu
- src_html_submenuGenerator-generateTaskSubmenu - Generate task submenu
- src_html_submenuGenerator-generateBoardSubmenu - Generate board submenu
- src_html_submenuGenerator-generateExportSubmenu - Generate export submenu

---

## src/html/debugOverlay.js - Debug Overlay

- src_html_debugOverlay-initializeDebugOverlay - Initialize debug overlay
- src_html_debugOverlay-updateDebugInfo - Update debug information display
- src_html_debugOverlay-toggleDebugOverlay - Toggle debug overlay visibility
- src_html_debugOverlay-logDebugMessage - Log debug message to overlay

---

## src/html/configManager.js - Configuration Management

- src_html_configManager-loadConfig - Load configuration from backend
- src_html_configManager-saveConfig - Save configuration to backend
- src_html_configManager-getConfigValue - Get configuration value
- src_html_configManager-setConfigValue - Set configuration value
- src_html_configManager-resetConfig - Reset configuration to defaults

---

## src/html/dragStateManager.js - Drag State Management

- src_html_dragStateManager-initializeDragState - Initialize drag state
- src_html_dragStateManager-updateDragState - Update drag state
- src_html_dragStateManager-clearDragState - Clear drag state
- src_html_dragStateManager-getDragState - Get current drag state
- src_html_dragStateManager-isDragging - Check if currently dragging

---

## src/html/exportTreeBuilder.js - Export Tree Building

- src_html_exportTreeBuilder-buildExportTree - Build export tree structure
- src_html_exportTreeBuilder-traverseBoard - Traverse board for export
- src_html_exportTreeBuilder-buildColumnNode - Build column export node
- src_html_exportTreeBuilder-buildTaskNode - Build task export node
- src_html_exportTreeBuilder-getExportData - Get export data from tree

---

## src/html/exportTreeUI.js - Export Tree UI

- src_html_exportTreeUI-renderExportTree - Render export tree UI
- src_html_exportTreeUI-updateExportSelection - Update export selection
- src_html_exportTreeUI-getSelectedColumns - Get selected columns for export
- src_html_exportTreeUI-getSelectedTasks - Get selected tasks for export
- src_html_exportTreeUI-toggleColumnSelection - Toggle column selection
- src_html_exportTreeUI-toggleTaskSelection - Toggle task selection

---

## src/html/activityIndicator.js - Activity Indicator

- src_html_activityIndicator-showActivityIndicator - Show activity indicator
- src_html_activityIndicator-hideActivityIndicator - Hide activity indicator
- src_html_activityIndicator-updateActivityMessage - Update activity message

---

## src/html/modalUtils.js - Modal Utilities

- src_html_modalUtils-showModal - Show modal dialog
- src_html_modalUtils-hideModal - Hide modal dialog
- src_html_modalUtils-createModal - Create modal element
- src_html_modalUtils-destroyModal - Destroy modal element

---

## src/html/menuManager.js - Menu Manager

- src_html_menuManager-initializeMenus - Initialize all menus
- src_html_menuManager-registerMenu - Register menu handler
- src_html_menuManager-openMenu - Open menu at position
- src_html_menuManager-closeMenu - Close active menu
- src_html_menuManager-closeAllMenus - Close all open menus

---

## src/html/styleManager.js - Style Manager

- src_html_styleManager-applyTheme - Apply theme to webview
- src_html_styleManager-updateStyles - Update dynamic styles
- src_html_styleManager-loadTheme - Load theme configuration
- src_html_styleManager-injectStyles - Inject custom styles

---

## src/html/smartLogger.js - Smart Logger

- src_html_smartLogger-log - Log message with level
- src_html_smartLogger-error - Log error message
- src_html_smartLogger-warn - Log warning message
- src_html_smartLogger-debug - Log debug message
- src_html_smartLogger-setLogLevel - Set logging level

---

## src/html/validationUtils.js - Validation Utilities

- src_html_validationUtils-validateTaskData - Validate task data
- src_html_validationUtils-validateColumnData - Validate column data
- src_html_validationUtils-validateBoardData - Validate board data
- src_html_validationUtils-sanitizeInput - Sanitize user input

---

## src/html/colorUtils.js - Color Utilities

- src_html_colorUtils-hexToRgb - Convert hex color to RGB
- src_html_colorUtils-rgbToHex - Convert RGB color to hex
- src_html_colorUtils-lightenColor - Lighten color by percentage
- src_html_colorUtils-darkenColor - Darken color by percentage

---

## src/html/tagUtils.js - Tag Utilities

- src_html_tagUtils-parseTag - Parse tag from text
- src_html_tagUtils-extractTags - Extract all tags from text
- src_html_tagUtils-formatTag - Format tag for display
- src_html_tagUtils-isLayoutTag - Check if tag is layout tag

---

## src/html/utils/fileTypeUtils.js - File Type Utilities

- src_html_fileTypeUtils-isFilePath - Check if text is a file path (Unix or Windows: /, \, C:\, \\server)
- src_html_fileTypeUtils-normalizePath - Convert backslashes to forward slashes (call after isFilePath)
- src_html_fileTypeUtils-getFileName - Extract filename from path (handles both separators)
- src_html_fileTypeUtils-isImageFile - Check if file is image
- src_html_fileTypeUtils-isVideoFile - Check if file is video
- src_html_fileTypeUtils-isAudioFile - Check if file is audio
- src_html_fileTypeUtils-isMediaFile - Check if file is any media type
- src_html_fileTypeUtils-isMarkdownFile - Check if file is markdown
- src_html_fileTypeUtils-isTextFile - Check if file is text

---

## Markdown-it Plugins

### src/html/markdown-it-abbr-browser.js
- src_html_markdown-it-abbr-browser-markdownItAbbr - Markdown-it abbreviation plugin

### src/html/markdown-it-container-browser.js
- src_html_markdown-it-container-browser-markdownItContainer - Markdown-it container plugin

### src/html/markdown-it-image-figures-browser.js
- src_html_markdown-it-image-figures-browser-markdownItImageFigures - Markdown-it image figures plugin

### src/html/markdown-it-include-browser.js
- src_html_markdown-it-include-browser-markdownItInclude - Markdown-it include plugin

### src/html/markdown-it-ins-browser.js
- src_html_markdown-it-ins-browser-markdownItIns - Markdown-it insert plugin

### src/html/markdown-it-mark-browser.js
- src_html_markdown-it-mark-browser-markdownItMark - Markdown-it mark plugin

### src/html/markdown-it-multicolumn-browser.js
- src_html_markdown-it-multicolumn-browser-markdownItMulticolumn - Markdown-it multicolumn plugin

### src/html/markdown-it-strikethrough-alt-browser.js
- src_html_markdown-it-strikethrough-alt-browser-markdownItStrikethroughAlt - Markdown-it strikethrough plugin

### src/html/markdown-it-sub-browser.js
- src_html_markdown-it-sub-browser-markdownItSub - Markdown-it subscript plugin

### src/html/markdown-it-sup-browser.js
- src_html_markdown-it-sup-browser-markdownItSup - Markdown-it superscript plugin

### src/html/markdown-it-underline-browser.js
- src_html_markdown-it-underline-browser-markdownItUnderline - Markdown-it underline plugin

---

## Summary

**Total JavaScript Files**: 33
**Approximate Total Functions**: 200+

### Key JavaScript Modules:
1. webview.js - 60+ functions - Main webview controller
2. boardRenderer.js - 35+ functions - Board rendering engine
3. taskEditor.js - 8 functions - Task editing
4. menuOperations.js - 20+ functions - Context menu operations
5. dragDrop.js - 9 functions - Drag and drop functionality
6. markdownRenderer.js - 8 functions - Markdown rendering
7. search.js - 6 functions - Search functionality
8. submenuGenerator.js - 5 functions - Submenu generation
9. debugOverlay.js - 4 functions - Debug overlay
10. configManager.js - 5 functions - Configuration management
11. Additional utility modules - 40+ functions

### Markdown-it Plugins:
- 11 browser-compatible markdown-it plugins for extended markdown syntax
