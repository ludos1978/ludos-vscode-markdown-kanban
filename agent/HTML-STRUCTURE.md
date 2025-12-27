# HTML Structure Documentation

This document provides a comprehensive hierarchy of the HTML structure used in the Kanban webview. It serves as a reference for CSS analysis and simplification.

## Table of Contents
1. [Document Structure Overview](#document-structure-overview)
2. [Static Elements](#static-elements)
3. [Dynamic Board Structure](#dynamic-board-structure)
4. [Component Details](#component-details)
5. [CSS Class Reference](#css-class-reference)
6. [Data Attributes Reference](#data-attributes-reference)

---

## Document Structure Overview

```
<html>
├── <head>
│   ├── CSS: webview.css
│   ├── Scripts: markdown-it plugins
│   └── <style> (inline diagram styles)
│
└── <body>
    ├── #file-info-bar (.file-info-bar)          [FIXED HEADER]
    ├── #search-panel (.search-panel)             [OVERLAY - hidden by default]
    ├── #kanban-container
    │   └── #kanban-board (.kanban-board)         [DYNAMIC CONTENT]
    ├── #input-modal (.modal)                     [MODAL]
    ├── #export-modal (.modal)                    [MODAL]
    ├── #file-search-overlay                      [MODAL]
    ├── <script> modules (40+ files)
    └── #path-context-menu (.context-menu)        [CONTEXT MENU]
```

---

## Static Elements

### 1. File Info Bar (`#file-info-bar`)

The top navigation bar with file info and controls.

```
.file-info-bar
└── .file-info-content
    ├── .file-info-left
    │   ├── .file-icon
    │   ├── #file-name (.file-name)
    │   └── .marp-global-menu
    │       ├── .marp-global-menu-btn
    │       └── .marp-global-menu-dropdown
    │           └── #marp-global-settings-content
    │
    ├── .file-info-center
    │   ├── .drag-menu.cards-menu                 [HOVER MENU]
    │   │   ├── .drag-menu-trigger
    │   │   │   ├── .drag-menu-icon
    │   │   │   └── .drag-menu-label
    │   │   └── .drag-menu-dropdown
    │   │       ├── #empty-card-source (.drag-menu-item)
    │   │       ├── #clipboard-card-source (.drag-menu-item)
    │   │       ├── #excalidraw-card-source (.drag-menu-item)
    │   │       └── #drawio-card-source (.drag-menu-item)
    │   │
    │   ├── .drag-menu.columns-menu               [HOVER MENU]
    │   │   ├── .drag-menu-trigger
    │   │   └── #columns-menu-dropdown (.drag-menu-dropdown)
    │   │       ├── #empty-column-source (.drag-menu-item)
    │   │       ├── #clipboard-column-source (.drag-menu-item)
    │   │       └── .template-item (dynamic)
    │   │
    │   └── #template-source (.template-source) [HIDDEN]
    │
    └── .file-info-right
        ├── #global-fold-btn (.global-fold-btn)
        ├── #sort-btn (.sort-btn)
        ├── #global-sticky-btn (.global-sticky-btn)
        ├── #auto-export-btn (.auto-export-btn)
        ├── #refresh-btn (.refresh-btn)
        ├── .layout-presets-menu-container
        │   ├── #layout-presets-btn (.layout-presets-btn)
        │   └── #layout-presets-dropdown (.layout-presets-dropdown)
        └── .file-bar-menu
            ├── .file-bar-menu-btn
            └── .file-bar-menu-dropdown
                ├── .file-bar-menu-item
                ├── .file-bar-menu-divider
                └── .file-bar-menu-item.has-submenu
                    └── .file-bar-menu-submenu [data-menu="..."]
```

### 2. Search Panel (`#search-panel`)

```
.search-panel
└── .search-panel-content
    ├── #search-input (.search-input)
    └── .search-controls
        ├── #search-case-btn (.search-toggle-btn)
        ├── #search-word-btn (.search-toggle-btn)
        ├── #search-regex-btn (.search-toggle-btn)
        ├── #search-counter (.search-counter)
        ├── .search-nav-btn (previous)
        ├── .search-nav-btn (next)
        └── .search-close-btn
```

### 3. Modals

#### Input Modal (`#input-modal`)
```
.modal
└── .modal-content
    ├── .modal-header
    │   ├── .modal-title
    │   └── .close-btn
    ├── .modal-body
    │   ├── <p>
    │   └── #input-modal-field (.form-input)
    └── .modal-actions
        ├── .btn.btn-secondary
        └── .btn.btn-primary
```

#### Export Modal (`#export-modal`)
```
.modal
└── .modal-content.export-modal-content
    ├── .modal-header
    │   ├── .modal-title
    │   └── .modal-header-actions
    │       ├── .btn.btn-primary.btn-export-header
    │       └── .close-btn
    └── .modal-body
        ├── .export-field (multiple)
        │   ├── <label>
        │   ├── <select> / <input> (.form-input)
        │   └── .help-text / <small>
        ├── .export-field-row
        │   ├── .export-field-half
        │   └── .export-field-third
        ├── .export-checkbox
        ├── #content-transformations
        ├── #use-marp-container
        ├── #marp-options (.disabled-section when inactive)
        ├── #export-tree-container (.export-tree-container)
        └── .link-handling-options
```

#### File Search Modal (`#file-search-overlay`)
```
.file-search-overlay
└── .file-search-dialog
    ├── .file-search-header
    │   ├── .file-search-title
    │   ├── .file-search-subtitle
    │   └── .file-search-broken-info
    │       └── .file-search-badge
    ├── .file-search-input-container
    │   ├── .file-search-input
    │   └── .file-search-toggle-btn (x3)
    ├── .file-search-results
    │   └── .file-search-table (dynamic)
    ├── .file-search-batch-panel
    │   ├── .file-search-batch-title
    │   └── .file-search-batch-list
    ├── .file-search-options-row
    │   ├── .file-search-batch-option
    │   └── .file-search-path-format
    ├── .file-search-path-preview
    └── .file-search-footer
        ├── .file-search-keyboard-hint
        ├── .file-search-preview-toggle
        └── .file-search-btn (x2)
```

---

## Dynamic Board Structure

The board content is generated dynamically by `boardRenderer.js`.

### Board Layout Hierarchy

```
#kanban-container
└── #kanban-board (.kanban-board)
    │
    ├── [EMPTY STATE - when no columns]
    │   └── .empty-board
    │       └── .initialize-container
    │           ├── .initialize-message
    │           └── .initialise-btn
    │
    └── [MULTI-ROW LAYOUT - when columns exist]
        ├── .kanban-row [data-row-number="1"]
        │   ├── .kanban-column-stack.column-drop-zone-stack (left edge)
        │   │   └── .column-drop-zone.column-drop-zone-left
        │   ├── .kanban-column-stack
        │   │   ├── .kanban-full-height-column [data-column-id="..."]
        │   │   └── .kanban-full-height-column (stacked columns)
        │   ├── .kanban-column-stack.column-drop-zone-stack (between)
        │   │   └── .column-drop-zone.column-drop-zone-right
        │   ├── .kanban-column-stack
        │   │   └── .kanban-full-height-column
        │   ├── .add-column-btn.multi-row-add-btn
        │   └── .row-drop-zone-spacer
        │
        └── .kanban-row [data-row-number="2"]
            └── ... (same structure)
```

### Column Structure

```
.kanban-full-height-column [data-column-id="..."]
│   Classes: .collapsed, .has-marp-header-*, .has-marp-footer-*, .span-*
│
├── .column-offset                              [STICKY OFFSET]
├── .column-margin                              [STICKY MARGIN TOP]
├── .column-header                              [STICKY HEADER]
├── .column-title                               [STICKY TITLE]
│   └── .column-title-section
│       ├── .drag-handle.column-drag-handle
│       ├── .collapse-toggle [data-column-id]
│       ├── .pin-btn (.pinned | .unpinned)
│       │   └── .pin-icon
│       ├── .column-title-container
│       │   ├── .column-title-text.markdown-content
│       │   └── .column-title-edit (<textarea>)
│       ├── .task-count
│       │   └── .fold-all-btn (.fold-collapsed | .fold-expanded | .fold-mixed)
│       │       └── .fold-icon
│       ├── .collapsed-add-task-btn
│       └── .donut-menu
│           ├── .donut-menu-btn
│           └── .donut-menu-dropdown
│               ├── .donut-menu-item
│               ├── .donut-menu-divider
│               ├── .donut-menu-item.has-submenu [data-submenu-type]
│               ├── .donut-menu-item.span-width-control
│               │   ├── .span-width-label
│               │   └── .span-width-controls
│               │       ├── .span-width-btn
│               │       ├── .span-width-value
│               │       └── .span-width-btn
│               └── .donut-menu-item.stack-control
│                   ├── .stack-label
│                   └── .stack-toggle-btn
│
├── .column-inner (.column-loading when loading)
│   └── .column-content
│       └── .tasks-container [id="tasks-{columnId}"]
│           ├── .column-loading-placeholder (when loading)
│           │   ├── .loading-spinner
│           │   └── .loading-text
│           ├── .task-item (multiple)
│           └── .add-task-btn
│
├── .column-footer                              [STICKY FOOTER]
└── .column-margin.column-margin-bottom         [STICKY MARGIN BOTTOM]
```

### Task Structure

```
.task-item [data-task-id="..."]
│   Classes: .collapsed, .has-marp-header-*, .has-marp-footer-*, .loading
│
├── .loading-overlay (when loading)
│   ├── .loading-spinner
│   └── .loading-text
│
├── .task-header
│   ├── .task-drag-handle
│   ├── .task-collapse-toggle (.rotated when collapsed)
│   ├── .task-title-container
│   │   ├── .task-title-display.markdown-content
│   │   └── .task-title-edit (<textarea>)
│   └── .task-menu-container
│       └── .donut-menu
│           ├── .donut-menu-btn
│           └── .donut-menu-dropdown
│               ├── .donut-menu-item
│               ├── .donut-menu-divider
│               └── .donut-menu-item.has-submenu [data-submenu-type]
│
└── .task-description-container
    ├── .task-description-display.markdown-content
    │   └── .task-section (multiple - rendered markdown sections)
    └── .task-description-edit (<textarea>)
```

### Task Section Content (Markdown Rendered)

```
.task-section [tabindex="0"]
│
├── [TEXT CONTENT]
│   └── <p>, <h1>-<h6>, <ul>, <ol>, <blockquote>, etc.
│
├── [IMAGES]
│   ├── <img> (standard)
│   ├── .image-container
│   │   └── .image-path-btn-container
│   │       └── .image-path-menu
│   └── .image-not-found-container
│       └── .image-not-found-menu
│
├── [CODE BLOCKS]
│   └── <pre><code>
│
├── [DIAGRAMS]
│   ├── .plantuml-placeholder
│   │   ├── .placeholder-spinner
│   │   └── .placeholder-text
│   ├── .plantuml-diagram
│   │   ├── <svg>
│   │   └── .plantuml-actions
│   │       └── .plantuml-convert-btn
│   ├── .mermaid-placeholder
│   ├── .mermaid-diagram
│   └── .plantuml-error / .mermaid-error
│
├── [INCLUDES]
│   └── .include-container
│       ├── .include-header
│       └── .include-content
│
├── [MULTICOLUMN]
│   └── .multicolumn-container
│       └── .multicolumn-column (multiple)
│
└── [HEADER/FOOTER BARS]
    ├── .header-bars-container
    │   └── .header-bar.header-bar-{tag}
    └── .footer-bars-container
        └── .footer-bar.footer-bar-{tag}
```

---

## Component Details

### Donut Menu (Context Menu)

Used for both columns and tasks.

```
.donut-menu
├── .donut-menu-btn                             [TRIGGER]
└── .donut-menu-dropdown                        [MENU CONTAINER]
    ├── .donut-menu-item                        [BASIC ITEM]
    ├── .donut-menu-item.danger                 [DELETE ITEMS - red]
    ├── .donut-menu-divider                     [SEPARATOR]
    └── .donut-menu-item.has-submenu            [SUBMENU TRIGGER]
        │   [data-submenu-type="tags|move|marp-classes|marp-colors|marp-header-footer|sort|move-to-list"]
        │   [data-id="..."]
        │   [data-type="column|task"]
        │   [data-column-id="..."]
        │
        └── .donut-menu-submenu                 [SUBMENU CONTENT]
            ├── .donut-menu-tag-chip.kanban-tag
            │   ├── .tag-chip-check
            │   └── .tag-chip-name
            └── .donut-menu-item
```

### Drag Menu (Cards/Columns Source)

```
.drag-menu
├── .drag-menu-trigger
│   ├── .drag-menu-icon
│   └── .drag-menu-label
└── .drag-menu-dropdown
    └── .drag-menu-item [draggable="true"]
        ├── .drag-menu-item-icon
        └── .drag-menu-item-text
```

### File Bar Menu

```
.file-bar-menu
├── .file-bar-menu-btn
└── .file-bar-menu-dropdown
    ├── .file-bar-menu-item
    ├── .file-bar-menu-divider
    └── .file-bar-menu-item.has-submenu
        └── .file-bar-menu-submenu [data-menu="columnWidth|cardHeight|..."]
            ├── .file-bar-menu-item (.selected when active)
            │   └── .menu-checkmark
            └── .file-bar-menu-divider
```

---

## CSS Class Reference

### Layout Classes

| Class | Purpose | Used On |
|-------|---------|---------|
| `.kanban-board` | Main board container | `#kanban-board` |
| `.kanban-row` | Row container for columns | Dynamic |
| `.kanban-column-stack` | Stack container (groups columns) | Dynamic |
| `.kanban-full-height-column` | Column container | Dynamic |
| `.tasks-container` | Task list container | Inside column |
| `.task-item` | Task card | Dynamic |

### State Classes

| Class | Purpose | Used On |
|-------|---------|---------|
| `.collapsed` | Collapsed state | Column, Task |
| `.rotated` | Rotation for chevron | Collapse toggle |
| `.loading` | Loading state | Task |
| `.column-loading` | Column loading state | `.column-inner` |
| `.visible` | Visible state | Menus, modals |
| `.active` | Active/selected state | Menu items, toggles |
| `.selected` | Selected item | Menu items, search results |
| `.pinned` / `.unpinned` | Pin state | Pin button |
| `.fold-collapsed` / `.fold-expanded` / `.fold-mixed` | Fold state | Fold button |
| `.danger` | Destructive action style | Delete buttons |
| `.faded` | Reduced opacity | Disabled items |
| `.hidden` | Display none | Various |
| `.disabled-section` | Grayed out section | Marp options |

### Span/Width Classes

| Class | Purpose |
|-------|---------|
| `.span-1` through `.span-6` | Column width multiplier |

### Marp Header/Footer Classes

| Class Pattern | Purpose |
|---------------|---------|
| `.has-marp-header-{tag}` | Column/task has header bar |
| `.has-marp-footer-{tag}` | Column/task has footer bar |
| `.header-bar-{tag}` | Header bar for specific tag |
| `.footer-bar-{tag}` | Footer bar for specific tag |

### Typography Classes

| Class | Purpose |
|-------|---------|
| `.markdown-content` | Container for rendered markdown |
| `.task-title-display` | Task title text |
| `.task-title-edit` | Task title textarea |
| `.task-description-display` | Task description content |
| `.task-description-edit` | Task description textarea |
| `.column-title-text` | Column title text |
| `.column-title-edit` | Column title textarea |

### Button Classes

| Class | Purpose |
|-------|---------|
| `.btn` | Base button |
| `.btn-primary` | Primary action button |
| `.btn-secondary` | Secondary action button |
| `.add-task-btn` | Add task button |
| `.add-column-btn` | Add column button |
| `.donut-menu-btn` | Menu trigger button |
| `.collapse-toggle` | Collapse/expand chevron |
| `.pin-btn` | Pin toggle button |
| `.fold-all-btn` | Fold all tasks button |

### Container Classes

| Class | Purpose |
|-------|---------|
| `.modal` | Modal overlay |
| `.modal-content` | Modal dialog |
| `.modal-header` | Modal header section |
| `.modal-body` | Modal content section |
| `.modal-actions` | Modal button row |
| `.export-field` | Export form field |
| `.export-field-row` | Horizontal field group |
| `.export-field-half` | 50% width field |
| `.export-field-third` | 33% width field |

---

## Data Attributes Reference

### Column Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-column-id` | Column identifier | `data-column-id="col-123"` |
| `data-row-number` | Row position | `data-row-number="1"` |

### Task Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-task-id` | Task identifier | `data-task-id="task-456"` |

### Menu Attributes

| Attribute | Purpose | Values |
|-----------|---------|--------|
| `data-menu` | Menu type for submenus | `columnWidth`, `cardHeight`, `sectionHeight`, `taskSectionHeight`, `whitespace`, `fontSize`, `fontFamily`, `layoutRows`, `rowHeight`, `stickyStackMode`, `tagVisibility`, `htmlCommentRenderMode`, `htmlContentRenderMode` |
| `data-submenu-type` | Submenu content type | `tags`, `move`, `move-to-list`, `marp-classes`, `marp-colors`, `marp-header-footer`, `sort` |
| `data-scope` | Scope for marp settings | `column`, `task` |
| `data-id` | Element ID for actions | Column/task ID |
| `data-type` | Element type | `column`, `task` |
| `data-group` | Tag group identifier | Group key or `custom`, `none` |

### Drag Attributes

| Attribute | Purpose |
|-----------|---------|
| `draggable="true"` | Element can be dragged |
| `data-drag-setup` | Indicates drag handlers attached |
| `data-task-initialized` | Task element fully initialized |

---

## Z-Index Hierarchy

| Layer | Z-Index | Elements |
|-------|---------|----------|
| Base content | 0 | Board, columns, tasks |
| Column sticky elements | 10-20 | Headers, footers, margins |
| Drop indicators | 50 | Drag feedback |
| File info bar | 100 | `#file-info-bar` |
| Menus/dropdowns | 200-300 | Donut menus, file bar menus |
| Modals | 1000+ | All `.modal` elements |
| Context menus | 1100 | `#path-context-menu` |

---

## CSS Variable Dependencies

The HTML structure relies on these CSS variables (defined in `:root`):

### Spacing
- `--whitespace` - Base spacing unit
- `--whitespace-mul2`, `--whitespace-div2`, `--whitespace-div4` - Derived spacing

### Sizing
- `--column-width` - Column width
- `--collapsed-column-width` - Collapsed column width
- `--task-height` - Task height limit
- `--task-section-min-height`, `--task-section-max-height` - Section heights

### Colors
- `--board-background` - Board background color
- `--column-background` - Column background color
- `--task-background` - Task background color
- `--task-focus-color`, `--task-hover-color` - Task interaction colors
- `--current-week-highlight-color` - Week tag highlight

### VS Code Theme Variables
All `--vscode-*` variables are inherited from the VS Code theme.

---

## Real World Example

This section documents actual class combinations and patterns observed in a real board (`tmp/full-board.html` - 961KB, 17,451 lines, 3 columns, 11 tasks).

### Actual Column Attributes

```html
<div class="kanban-full-height-column"
     data-column-id="col-d72067ad-e32f-469a-9b6d-0ba6dd9e0771"
     data-column-index="0"
     data-row="1"
     data-column-sticky="false"
     data-column-bg-tag="green"
     data-all-tags="green">
```

### Actual Task Attributes

```html
<div class="task-item"
     data-task-id="task-72bedfc8-7d9b-43ef-bd1c-82d621924454"
     data-task-index="0"
     data-task-bg-tag="blue"
     data-all-tags="blue"
     style=" "
     data-task-initialized="true">
```

### Tag Rendering

Tags are rendered inline within markdown content:
```html
<h1>Heading 1 in Columntitle <span class="kanban-tag" data-tag="green">#green</span></h1>
<h2>Heading 2 in Tasktitle <span class="kanban-tag" data-tag="blue">#blue</span></h2>
```

### Include Container Structure

```html
<div class="include-container" data-include-file="/path/to/file.md">
    <div class="include-title-bar">
        <span class="include-path-overlay-container">
            <span class="include-filename-link"
                  data-file-path="/path/to/file.md"
                  onclick="handleRegularIncludeClick(...)">include(file.md)</span>
            <button class="include-menu-btn" onclick="toggleIncludePathMenu(...)">☰</button>
            <div class="include-path-menu">
                <button class="include-path-menu-item">📄 Open</button>
                <button class="include-path-menu-item">🔍 Reveal in File Explorer</button>
                <button class="include-path-menu-item disabled" disabled="">🔎 Search for File</button>
                <div class="include-path-menu-divider"></div>
                <button class="include-path-menu-item">📁 Convert to Relative</button>
                <button class="include-path-menu-item disabled" disabled="">📂 Convert to Absolute</button>
                <div class="include-path-menu-divider"></div>
                <button class="include-path-menu-item">🗑️ Delete</button>
            </div>
        </span>
    </div>
    <div class="include-content-area">
        <!-- rendered markdown content -->
    </div>
</div>
```

### File Bar Menu Structure

```html
<div class="file-bar-menu">
    <button class="file-bar-menu-btn" onclick="toggleFileBarMenu(event, this)">☰</button>
    <div class="file-bar-menu-dropdown">
        <button class="file-bar-menu-item" onclick="undo()">↶ Undo</button>
        <button class="file-bar-menu-item" onclick="redo()">↷ Redo</button>
        <div class="file-bar-menu-divider"></div>
        <button class="file-bar-menu-item" onclick="selectFile()">📂 Open...</button>
        <button class="file-bar-menu-item" onclick="showExportDialog()">📤 Export...</button>
        <div class="file-bar-menu-divider"></div>
        <div class="file-bar-menu-item has-submenu">
            Column Width →
            <div class="file-bar-menu-submenu" data-menu="columnWidth">...</div>
        </div>
    </div>
</div>
```

### Task Section with Description

```html
<div class="task-description-container">
    <div class="task-description-display markdown-content" onclick="handleDescriptionClick(...)">
        <div class="task-section" tabindex="0">
            <p>Some text content...</p>
        </div>
    </div>
    <textarea class="task-description-edit" data-field="description" style="display: none;">
        Raw markdown content
    </textarea>
</div>
```

---

## Updated Data Attributes Reference

### Column Attributes (Complete)

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-column-id` | Unique column identifier | `col-d72067ad-e32f-469a-9b6d-0ba6dd9e0771` |
| `data-column-index` | Column position in board | `0`, `1`, `2` |
| `data-row` | Row number containing column | `1` |
| `data-column-sticky` | Whether header is sticky | `true`, `false` |
| `data-column-bg-tag` | Background color tag | `green`, `blue`, `red` |
| `data-all-tags` | All tags on column (space-separated) | `green blue` |

### Task Attributes (Complete)

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-task-id` | Unique task identifier | `task-72bedfc8-7d9b-43ef-bd1c-82d621924454` |
| `data-task-index` | Task position in column | `0`, `1`, `2` |
| `data-task-bg-tag` | Background color tag | `blue`, `yellow`, `cyan` |
| `data-all-tags` | All tags on task (space-separated) | `blue important` |
| `data-task-initialized` | Whether JS handlers attached | `true` |
| `data-field` | Field type for textareas | `title`, `description` |

### Drag/Drop Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `draggable` | Element is draggable | `true` |
| `data-drag-setup` | Drag handlers attached | `true` |
| `data-task-drag-setup` | Task container ready | `true` |

---

## CSS Simplification Opportunities

### 1. Tag-Based Color System
Currently colors are applied via `data-task-bg-tag`/`data-column-bg-tag` attributes.
CSS uses attribute selectors like `[data-task-bg-tag="blue"]`.
**Opportunity**: Consolidate tag color definitions into CSS variables per tag.

### 2. Menu Pattern Consolidation
Three similar menu patterns exist:
- `.donut-menu` / `.donut-menu-dropdown` / `.donut-menu-item`
- `.file-bar-menu` / `.file-bar-menu-dropdown` / `.file-bar-menu-item`
- `.include-path-menu` / `.include-path-menu-item`

**Opportunity**: Create a base `.menu` class with modifiers.

### 3. Path Menu Duplication
Both `.image-path-menu` and `.include-path-menu` share nearly identical structure.
**Opportunity**: Unify into a single `.resource-path-menu` pattern.

### 4. Empty Template Items
Donut menus contain many empty whitespace lines from template rendering:
```html
<!-- Lines 14143-14313 are mostly empty template placeholders -->
```
**Not a CSS issue** - This is a rendering optimization opportunity.

### 5. Diagram Patterns
PlantUML and Mermaid use parallel structures:
- `.plantuml-placeholder` / `.mermaid-placeholder`
- `.plantuml-diagram` / `.mermaid-diagram`
- `.plantuml-error` / `.mermaid-error`

**Opportunity**: Create `.diagram-placeholder`, `.diagram-container`, `.diagram-error` base classes.

### 6. Button Classes
Multiple button patterns with similar styling:
- `.add-task-btn`, `.add-column-btn`, `.collapsed-add-task-btn`
- `.donut-menu-btn`, `.file-bar-menu-btn`, `.include-menu-btn`
- `.span-width-btn`, `.stack-toggle-btn`

**Opportunity**: Use `.btn` base with modifier classes.

### 7. Nesting Depth
Deep selector chains observed:
```css
.donut-menu .donut-menu-dropdown .donut-menu-item.has-submenu .donut-menu-submenu
```
**Opportunity**: Flatten selectors using BEM or direct class targeting.

---

## Notes for CSS Simplification

1. **Nested selectors** - Many classes have deep nesting (e.g., `.donut-menu .donut-menu-dropdown .donut-menu-item`)

2. **Duplicate patterns** - Header/footer bars use similar styling with tag-specific variations

3. **State combinations** - Elements can have multiple state classes (`.collapsed.has-marp-header-x`)

4. **Responsive considerations** - `container-type: inline-size` on file info bar

5. **Sticky elements** - Complex sticky positioning for column headers/footers

6. **Dynamic class generation** - Marp header/footer classes are generated from tag names

7. **Diagram styles** - PlantUML and Mermaid have nearly identical CSS patterns (potential consolidation)

8. **Tag colors** - 20+ tag colors with identical property patterns, each duplicated for column/task contexts
