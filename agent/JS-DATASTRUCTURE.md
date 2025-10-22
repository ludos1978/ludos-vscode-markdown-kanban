# Kanban Extension JavaScript Data Structure Reference

This document lists all data structures (classes, object prototypes, configuration objects) in the JavaScript codebase.

## Format
Each entry follows: `path_to_filename-structurename` with a brief description

---

## src/html/webview.js - Configuration Objects

- src_html_webview-fontSizeMultipliers - Array of font size multiplier values (0.5x to 5.0x)
- src_html_webview-baseOptions - Base configuration options for all menu items and CSS values
  - columnWidth options (250px, 350px, 450px, 650px, screen percentages)
  - whitespace options (2px to 32px)
  - taskMinHeight options (auto, 50px to 600px)
  - sectionHeight options (auto, 50px to 600px)
  - taskSectionHeight options (auto, 50px to 400px)
  - stickyStackMode options (none, first-stack, all-stacks)
  - tagVisibility options (all, none, excludelayout, allexcludinglayout)
  - htmlCommentRenderMode options (show, hide)
  - htmlContentRenderMode options (render, escape, hide)
  - layoutRows options (1 to 5 rows)
- src_html_webview-menuConfig - Menu configuration object mapping config keys to options
  - columnWidth menu
  - whitespace menu
  - taskMinHeight menu
  - layoutRows menu
  - stickyStackMode menu
  - tagVisibility menu
  - htmlCommentRenderMode menu
  - htmlContentRenderMode menu

---

## src/html/boardRenderer.js - Rendering Data Structures

- src_html_boardRenderer-defaultFoldingState - Default folding state object
  - columns: Map of column fold states
  - tasks: Map of task fold states
- src_html_boardRenderer-tagStyleCache - Map for caching tag styles
- src_html_boardRenderer-renderContext - Rendering context object
  - board: Board data
  - container: DOM container
  - options: Render options

---

## src/html/dragDrop.js - Drag State

- src_html_dragDrop-dragState - Drag state object
  - dragging: boolean
  - draggedElement: DOM element
  - draggedType: 'task' | 'column'
  - draggedId: string
  - draggedColumnId: string (for tasks)
  - dropTarget: DOM element
  - dropPosition: 'before' | 'after' | 'inside'

---

## src/html/dragStateManager.js - State Management

- src_html_dragStateManager-DragState - Drag state class
  - Properties: isDragging, draggedElement, sourceColumn, targetColumn, position
  - Methods: reset(), update(), validate()

---

## src/html/search.js - Search State

- src_html_search-searchState - Search state object
  - query: string
  - results: array of match objects
  - currentIndex: number
  - isActive: boolean

---

## src/html/configManager.js - Configuration

- src_html_configManager-Config - Configuration object
  - columnWidth: string
  - whitespace: string
  - taskMinHeight: string
  - layoutRows: number
  - stickyStackMode: string
  - tagVisibility: string
  - htmlCommentRenderMode: string
  - htmlContentRenderMode: string
  - defaults: object with default values

---

## src/html/exportTreeBuilder.js - Export Tree

- src_html_exportTreeBuilder-ExportNode - Export tree node
  - type: 'board' | 'column' | 'task'
  - id: string
  - title: string
  - selected: boolean
  - children: array of ExportNode
  - data: associated data object

---

## src/html/modalUtils.js - Modal State

- src_html_modalUtils-ModalConfig - Modal configuration object
  - title: string
  - content: string | DOM element
  - buttons: array of button configs
  - onClose: callback function
  - closeOnOverlayClick: boolean

---

## src/html/menuManager.js - Menu State

- src_html_menuManager-Menu - Menu object
  - id: string
  - element: DOM element
  - isOpen: boolean
  - items: array of menu items
  - position: {x, y}
- src_html_menuManager-MenuItem - Menu item object
  - label: string
  - action: callback function
  - icon: string
  - disabled: boolean
  - submenu: Menu

---

## src/html/styleManager.js - Theme Configuration

- src_html_styleManager-Theme - Theme object
  - name: string
  - colors: object with color definitions
  - fonts: object with font definitions
  - spacing: object with spacing values

---

## src/html/validationUtils.js - Validation Rules

- src_html_validationUtils-ValidationRule - Validation rule object
  - field: string
  - type: string ('required' | 'pattern' | 'custom')
  - pattern: RegExp
  - validator: function
  - message: string

---

## src/html/activityIndicator.js - Activity State

- src_html_activityIndicator-ActivityState - Activity indicator state
  - isVisible: boolean
  - message: string
  - startTime: number

---

## Global Data Structures

### Document State
- src_html_webview-currentFileInfo - Current file information object
  - path: string
  - name: string
  - modified: boolean
- src_html_webview-currentImageMappings - Image path mappings object
  - Maps internal paths to webview-accessible paths
- src_html_webview-documentFoldingStates - Map of folding states per document
  - Key: document URI
  - Value: {collapsedColumns: Set, collapsedTasks: Set, columnFoldStates: Map}
- src_html_webview-currentDocumentUri - Current document URI string

### UI State
- src_html_webview-currentFocusedCard - Currently focused card element
- src_html_webview-allCards - Array of all card elements
- src_html_webview-canUndo - Boolean for undo availability
- src_html_webview-canRedo - Boolean for redo availability

### Layout Preferences
- src_html_webview-currentColumnWidth - Current column width setting
- src_html_webview-currentWhitespace - Current whitespace setting
- src_html_webview-currentTaskMinHeight - Current task minimum height setting
- src_html_webview-currentLayoutRows - Current layout rows setting

---

## Summary

**Total JavaScript Data Structures**: 20+

### Key Structure Categories:
1. **Configuration Objects** (6 structures) - Menu options, base settings, theme config
2. **State Management** (8 structures) - Drag state, search state, modal state, activity state
3. **Rendering** (3 structures) - Folding state, render context, tag cache
4. **Export** (2 structures) - Export tree nodes, export configuration
5. **Validation** (1 structure) - Validation rules
6. **Global State** (10+ variables) - Document state, UI state, layout preferences

### Structure Types:
- **Plain Objects**: Configuration objects, state objects
- **Maps/Sets**: Folding states, tag caches
- **Arrays**: Card lists, menu items, validation rules
- **Classes**: DragState, ExportNode (pseudo-classes via object patterns)
