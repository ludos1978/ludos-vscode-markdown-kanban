# Kanban Extension JavaScript Data Instance Reference

This document lists all data instances (global variables, module-level state, singleton instances) in the JavaScript codebase.

**Last Updated:** 2025-10-26

## Format
Each entry follows: `path_to_filename-instancename` with a brief description

---

## Edit Mode Detection

### Critical Instance: `window.taskEditor.currentEditor`
**Location**: Global window object
**Type**: `null | object` (editor instance)
**Purpose**: Indicates whether user is actively editing a task/column

**Usage in Content Updates**:
```javascript
const isEditing = window.taskEditor && window.taskEditor.currentEditor;
if (isEditing) {
    // Skip DOM re-rendering to preserve active editor
}
```

**Why Important**: DOM re-rendering during edit mode destroys the active editor, causing editing failures. This guard prevents that issue.

---

## src/html/webview.js - Global Instances

### State Variables
- src_html_webview-currentFileInfo - Current file information (null | object)
- src_html_webview-currentImageMappings - Image path mappings for webview (object)
- src_html_webview-canUndo - Undo availability flag (boolean)
- src_html_webview-canRedo - Redo availability flag (boolean)
- src_html_webview-currentFocusedCard - Currently focused card element (null | HTMLElement)
- src_html_webview-allCards - Array of all card elements (array)

### Document State
- src_html_webview-documentFoldingStates - Map of folding states per document (Map)
- src_html_webview-currentDocumentUri - Current document URI (null | string)

### Layout Preferences
- src_html_webview-currentColumnWidth - Current column width setting ('350px')
- src_html_webview-currentWhitespace - Current whitespace setting ('8px')
- src_html_webview-currentTaskMinHeight - Current task min height ('auto')
- src_html_webview-currentLayoutRows - Current layout rows (1)

### Constants
- src_html_webview-CLIPBOARD_CHECK_THROTTLE - Clipboard check throttle time (1000ms)
- src_html_webview-fontSizeMultipliers - Array of font size multipliers
- src_html_webview-baseOptions - Base configuration options object
- src_html_webview-menuConfig - Menu configuration object

### VS Code API
- src_html_webview-vscode - VS Code API instance (global, set by webview.html)

---

## src/html/boardRenderer.js - Rendering Instances

### State Variables
- src_html_boardRenderer-currentBoard - Current board data (null | object)
- src_html_boardRenderer-renderInProgress - Render operation flag (boolean)
- src_html_boardRenderer-defaultFoldingState - Default folding state object
- src_html_boardRenderer-globalColumnFoldState - Global column fold state ('expanded' | 'collapsed')
- src_html_boardRenderer-tagStyleCache - Map for caching tag styles (Map)

### Debounce Timers
- src_html_boardRenderer-renderDebounceTimer - Debounce timer for rendering (number)

---

## src/html/dragDrop.js - Drag Drop Instances

### Drag State
- src_html_dragDrop-dragState - Current drag state object
- src_html_dragDrop-dragOverElement - Element being dragged over (null | HTMLElement)
- src_html_dragDrop-dragPlaceholder - Placeholder element during drag (null | HTMLElement)
- src_html_dragDrop-dragStartX - Drag start X coordinate (number)
- src_html_dragDrop-dragStartY - Drag start Y coordinate (number)

---

## src/html/dragStateManager.js - State Manager Instances

- src_html_dragStateManager-currentDragState - Current drag state instance (null | DragState)
- src_html_dragStateManager-dragHistory - Array of previous drag states (array)

---

## src/html/search.js - Search Instances

### Search State
- src_html_search-searchState - Current search state object
- src_html_search-searchInput - Search input element (null | HTMLElement)
- src_html_search-searchResults - Search results container (null | HTMLElement)
- src_html_search-currentHighlight - Currently highlighted result (null | HTMLElement)

---

## src/html/configManager.js - Configuration Instances

- src_html_configManager-currentConfig - Current configuration object
- src_html_configManager-defaultConfig - Default configuration object
- src_html_configManager-configDirty - Configuration dirty flag (boolean)

---

## src/html_menuOperations.js - Menu Operation Instances

### Context Menu State
- src_html_menuOperations-activeContextMenu - Active context menu element (null | HTMLElement)
- src_html_menuOperations-contextMenuTarget - Context menu target element (null | HTMLElement)
- src_html_menuOperations-contextMenuType - Context menu type ('task' | 'column' | 'board')

---

## src/html/taskEditor.js - Task Editor Instances

### Editor State
- src_html_taskEditor-currentEditor - Currently active editor (null | object)
- src_html_taskEditor-editMode - Current edit mode ('title' | 'description' | 'column')
- src_html_taskEditor-originalContent - Original content before edit (string)
- src_html_taskEditor-editTarget - Element being edited (null | HTMLElement)

---

## src/html/markdownRenderer.js - Markdown Renderer Instances

### Markdown-it Instance
- src_html_markdownRenderer-md - Markdown-it parser instance (null | MarkdownIt)
- src_html_markdownRenderer-renderCache - Map for caching rendered content (Map)

---

## src/html/submenuGenerator.js - Submenu Instances

- src_html_submenuGenerator-activeSubmenu - Active submenu element (null | HTMLElement)
- src_html_submenuGenerator-submenuStack - Stack of open submenus (array)

---

## src/html/debugOverlay.js - Debug Overlay Instances

- src_html_debugOverlay-overlayElement - Debug overlay DOM element (null | HTMLElement)
- src_html_debugOverlay-isVisible - Overlay visibility flag (boolean)
- src_html_debugOverlay-logMessages - Array of log messages (array)

---

## src/html/menuManager.js - Menu Manager Instances

- src_html_menuManager-registeredMenus - Map of registered menus (Map)
- src_html_menuManager-activeMenu - Currently active menu (null | Menu)
- src_html_menuManager-menuStack - Stack of open menus (array)

---

## src/html/styleManager.js - Style Manager Instances

- src_html_styleManager-currentTheme - Current theme object (null | Theme)
- src_html_styleManager-dynamicStyles - Dynamic style element (null | HTMLStyleElement)
- src_html_styleManager-themeCache - Map of cached themes (Map)

---

## src/html/smartLogger.js - Logger Instances

- src_html_smartLogger-logLevel - Current log level ('info' | 'warn' | 'error' | 'debug')
- src_html_smartLogger-logHistory - Array of log entries (array)
- src_html_smartLogger-maxHistorySize - Maximum history size (1000)

---

## src/html/exportTreeBuilder.js - Export Tree Instances

- src_html_exportTreeBuilder-currentTree - Current export tree (null | ExportNode)
- src_html_exportTreeBuilder-treeCache - Map of cached trees (Map)

---

## src/html/exportTreeUI.js - Export Tree UI Instances

- src_html_exportTreeUI-treeContainer - Tree container element (null | HTMLElement)
- src_html_exportTreeUI-selectedNodes - Set of selected node IDs (Set)

---

## src/html/activityIndicator.js - Activity Indicator Instances

- src_html_activityIndicator-indicatorElement - Activity indicator DOM element (null | HTMLElement)
- src_html_activityIndicator-activityState - Current activity state object
- src_html_activityIndicator-activityQueue - Queue of pending activities (array)

---

## src/html/modalUtils.js - Modal Instances

- src_html_modalUtils-activeModal - Active modal element (null | HTMLElement)
- src_html_modalUtils-modalStack - Stack of open modals (array)
- src_html_modalUtils-modalOverlay - Modal overlay element (null | HTMLElement)

---

## src/html/validationUtils.js - Validation Instances

- src_html_validationUtils-validationRules - Map of validation rules by field name (Map)
- src_html_validationUtils-validationErrors - Array of current validation errors (array)

---

## src/html/colorUtils.js - Color Utility Instances

- src_html_colorUtils-colorCache - Map for caching color conversions (Map)

---

## src/html/tagUtils.js - Tag Utility Instances

- src_html_tagUtils-tagCache - Map for caching parsed tags (Map)
- src_html_tagUtils-layoutTags - Set of layout tag names (Set: 'row1', 'row2', etc.)

---

## Summary

**Total JavaScript Data Instances**: 70+

### Instance Categories:
1. **Global State** (15 instances) - Document state, file info, board data
2. **UI State** (12 instances) - Focused elements, active menus, modals
3. **Configuration** (8 instances) - Layout preferences, theme settings, config objects
4. **Caches** (8 instances) - Render cache, tag cache, color cache, tree cache
5. **Editor State** (6 instances) - Current editor, edit mode, original content
6. **Drag/Drop State** (7 instances) - Drag state, placeholder, coordinates
7. **Search State** (4 instances) - Search query, results, highlights
8. **Debug/Logging** (4 instances) - Debug overlay, log history, log level
9. **Timers/Flags** (6 instances) - Debounce timers, dirty flags, visibility flags

### Initialization Patterns:
- **Null-initialized**: Most DOM element references (initialized on DOM ready)
- **Default values**: Configuration and state objects
- **Empty collections**: Arrays, Maps, Sets for caching and tracking
- **Constants**: Throttle times, multipliers, base configurations

### Lifecycle:
- **Created on load**: vscode API, base configurations
- **Created on first use**: Markdown-it instance, theme objects
- **Created on demand**: Modal stack, menu stack, drag state
- **Persisted across documents**: documentFoldingStates Map
- **Reset on document change**: currentDocumentUri, currentFileInfo
