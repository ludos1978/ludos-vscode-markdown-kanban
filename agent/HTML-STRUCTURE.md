# HTML Structure Documentation

This document provides a comprehensive hierarchy of the HTML structure used in the Kanban webview. It serves as a reference for CSS analysis and simplification.

## Table of Contents
1. [Document Structure Overview](#document-structure-overview)
2. [Static Elements](#static-elements)
3. [Dynamic Board Structure](#dynamic-board-structure)
4. [Component Details](#component-details)
5. [CSS Class Reference](#css-class-reference)
6. [Data Attributes Reference](#data-attributes-reference)
7. [CSS Variables Reference](#css-variables-reference)
8. [Z-Index Hierarchy](#z-index-hierarchy)
9. [CSS Selector Patterns](#css-selector-patterns)
10. [Stack Layout System](#stack-layout-system)
11. [CSS Simplification Opportunities](#css-simplification-opportunities)

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

### Key Layout Modes

| Mode | Class | Description |
|------|-------|-------------|
| Single Row | `.kanban-board` (default) | Horizontal flex, columns side-by-side |
| Multi Row | `.kanban-board.multi-row` | Vertical flex with `.kanban-row` children |
| Column Stack | `.kanban-column-stack` | Grid overlay for stacked columns |

---

## Static Elements

### 1. File Info Bar (`#file-info-bar`)

The top navigation bar with file info and controls. Uses CSS container queries for responsive behavior.

```
.file-info-bar
└── .file-info-content                          # Grid: 3 columns
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

#### File Info Bar Responsive Breakpoints

```css
/* Container Query Support */
container-type: inline-size;
container-name: file-info-bar;

@container file-info-bar (max-width: 1000px) { /* Hide text labels */ }
@container file-info-bar (max-width: 700px)  { /* Compact mode */ }
@container file-info-bar (max-width: 500px)  { /* Hide marp menu */ }
@container file-info-bar (max-width: 350px)  { /* Hide center section */ }
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
    ├── [SINGLE-ROW LAYOUT - default]
    │   ├── .column-drop-zone-stack
    │   │   └── .column-drop-zone
    │   ├── .kanban-column-stack (or .kanban-full-height-column)
    │   └── ...
    │
    └── [MULTI-ROW LAYOUT - with rows]
        └── .kanban-row [data-row-number="1"]
            ├── .kanban-row-header              # Sticky left label
            ├── .column-drop-zone-stack (left edge)
            │   └── .column-drop-zone.column-drop-zone-left
            ├── .kanban-column-stack
            │   ├── .kanban-full-height-column [data-column-id="..."]
            │   └── .kanban-full-height-column (stacked columns)
            ├── .column-drop-zone-stack (between)
            │   └── .column-drop-zone.column-drop-zone-right
            ├── .add-column-btn.multi-row-add-btn
            └── .row-drop-zone-spacer
```

### Board CSS Properties

```css
.kanban-board {
  display: flex;
  flex-wrap: nowrap;
  width: max-content;
  align-items: flex-start;
}

.kanban-board:not(:has(.kanban-row)) {
  gap: var(--whitespace);
  padding-left: var(--whitespace);
  padding-right: var(--whitespace);
}

.kanban-board.multi-row {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: auto;
}
```

### Column Structure

```
.kanban-full-height-column [data-column-id="..."]
│   Classes: .collapsed, .collapsed-vertical, .collapsed-horizontal,
│            .column-span-2/3/4, .has-header-bar, .has-footer-bar, etc.
│
├── .column-offset                              [STICKY OFFSET - margin-top set by JS]
├── .column-margin                              [STICKY MARGIN TOP - drop zone in stacks]
├── .column-header                              [STICKY HEADER - header bars container]
│   └── [header bars - dynamic]                 .header-bar-{tagname}
├── .column-title                               [STICKY TITLE]
│   ├── [corner badges - dynamic]               .corner-badge-{position}
│   └── .column-title-section
│       ├── .drag-handle.column-drag-handle    # ⋮⋮ grip
│       ├── .collapse-toggle [data-column-id]   # ▶ expand/collapse
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
│               └── .donut-menu-item.stack-control
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
│   └── [footer bars - dynamic]                 .footer-bar-{tagname}
└── .column-margin.column-margin-bottom         [STICKY MARGIN BOTTOM]
```

#### Column CSS Key Properties

```css
.kanban-full-height-column {
  width: var(--column-width);         /* Default: 350px */
  min-height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  flex-shrink: 0;
}

.kanban-full-height-column.collapsed-vertical {
  width: 32px;
}

/* Sticky positioning for stacks */
.kanban-column-stack .kanban-full-height-column .column-title {
  position: sticky;
  z-index: 100;
}
```

### Task Structure

```
.task-item [data-task-id="..."]
│   Classes: .collapsed, .has-header-bar, .has-footer-bar, .task-loading
│
├── .loading-overlay (when loading)
│   ├── .loading-spinner
│   └── .loading-text
│
├── [header bars - dynamic]                     .header-bars-container
├── [corner badges - dynamic]                   .corner-badge-{position}
│
├── .task-header
│   ├── .task-drag-handle                       # ⋮⋮ grip
│   ├── .task-collapse-toggle (.rotated when collapsed)
│   ├── .task-title-container
│   │   ├── .task-title-display.markdown-content
│   │   └── .task-title-edit (<textarea>)
│   └── .task-menu-container
│       └── .donut-menu
│           ├── .donut-menu-btn
│           └── .donut-menu-dropdown
│
├── .task-description-container
│   ├── .task-description-display.markdown-content
│   │   └── .task-section (multiple - keyboard navigable)
│   └── .task-description-edit (<textarea>)
│
└── [footer bars - dynamic]                     .footer-bars-container
```

#### Task CSS Key Properties

```css
.task-item {
  border-radius: 4px;
  gap: var(--whitespace-div2);
  margin-bottom: var(--whitespace-div2);
  min-height: var(--task-height);
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: visible;
}

.task-item.collapsed .task-description-container {
  display: none;
}

/* Separator line between tasks */
.task-item:not(:last-child)::after {
  content: '';
  position: absolute;
  bottom: 0px;
  left: 0;
  width: 100%;
  height: 1px;
  background: var(--vscode-panel-border);
}
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
│   ├── .plantuml-placeholder / .mermaid-placeholder
│   │   ├── .placeholder-spinner
│   │   └── .placeholder-text
│   ├── .plantuml-diagram / .mermaid-diagram
│   │   ├── <svg>
│   │   └── .plantuml-actions / .mermaid-actions
│   │       └── .plantuml-convert-btn / .mermaid-convert-btn
│   └── .plantuml-error / .mermaid-error
│
├── [INCLUDES]
│   └── .include-container [data-include-file="..."]
│       ├── .include-title-bar
│       │   └── .include-path-overlay-container
│       │       ├── .include-filename-link
│       │       ├── .include-menu-btn
│       │       └── .include-path-menu
│       └── .include-content-area
│
├── [MULTICOLUMN]
│   └── .multicolumn-container
│       └── .multicolumn-column (multiple)
│
├── [TAGS]
│   └── .kanban-tag [data-tag="..."]
│
└── [FIGURES]
    └── figure.media-figure
        └── img / video / iframe
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
            ├── .donut-menu-tags-grid           [TAG CHIP GRID]
            │   └── .donut-menu-tag-chip.kanban-tag
            │       ├── .tag-chip-check
            │       └── .tag-chip-name
            └── .donut-menu-item
```

### Drag Menu (Cards/Columns Source)

```
.drag-menu
├── .drag-menu-trigger
│   ├── .drag-menu-icon
│   └── .drag-menu-label
└── .drag-menu-dropdown                         [Appears on hover]
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
| `.kanban-board.multi-row` | Multi-row layout mode | `#kanban-board` |
| `.kanban-row` | Row container for columns | Dynamic |
| `.kanban-column-stack` | Stack container (groups columns) | Dynamic |
| `.kanban-full-height-column` | Column container | Dynamic |
| `.tasks-container` | Task list container | Inside column |
| `.task-item` | Task card | Dynamic |
| `.task-section` | Navigable markdown section | Inside task description |

### Column State Classes

| Class | Effect |
|-------|--------|
| `.collapsed` | Generic collapsed state |
| `.collapsed-vertical` | Vertical fold (rotated text, narrow) |
| `.collapsed-horizontal` | Horizontal fold (header only) |
| `.column-span-2` | Double width |
| `.column-span-3` | Triple width |
| `.column-span-4` | Quadruple width |
| `.dragging` | Being dragged |
| `.drag-over` | Drop target active |
| `.drag-over-append` | Append drop target |
| `.external-drag-over` | External file drag |
| `.drag-source` | Source of drag operation |
| `.column-loading` | Loading state |
| `.has-header-bar` | Has header bar decoration |
| `.has-header-label` | Header bar has text |
| `.has-footer-bar` | Has footer bar decoration |
| `.has-footer-label` | Footer bar has text |

### Task State Classes

| Class | Effect |
|-------|--------|
| `.collapsed` | Description hidden |
| `.dragging` | Being dragged |
| `.drag-source` | Source of drag |
| `.task-loading` | Loading content |
| `.has-header-bar` | Has header decoration |
| `.has-footer-bar` | Has footer decoration |

### Stack Classes

| Class | Effect |
|-------|--------|
| `.kanban-column-stack` | Stacked column container |
| `.all-vertical-folded` | All columns in stack folded vertically |

### Row Classes

| Class | Effect |
|-------|--------|
| `.kanban-row` | Row container |
| `.drag-over` | Row is drop target |

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
| `.task-collapse-toggle` | Task collapse toggle |
| `.pin-btn` | Pin toggle button |
| `.fold-all-btn` | Fold all tasks button |
| `.drag-handle` | Drag grip handle |
| `.task-drag-handle` | Task drag handle |
| `.column-drag-handle` | Column drag handle |

### Button State Classes

| Class | Effect |
|-------|--------|
| `.active` | Toggle on |
| `.pending` | Unsaved changes |
| `.saved` | Recently saved |
| `.pinned` | Sticky enabled |
| `.unpinned` | Sticky disabled |
| `.fold-collapsed` | Fold button - all collapsed |
| `.fold-expanded` | Fold button - all expanded |
| `.fold-mixed` | Fold button - mixed state |
| `.rotated` | Collapse toggle rotated (90deg) |
| `.danger` | Destructive action (red) |

### Utility Classes

| Class | Effect |
|-------|--------|
| `.hidden` | `display: none !important` |
| `.faded` | `opacity: 0.5` |
| `.disabled-section` | Grayed out section, `pointer-events: none` |
| `.markdown-content` | Rendered markdown container |

### Global Body Classes

| Class | Effect |
|-------|--------|
| `.week-highlight-background` | Week background highlighting mode |
| `.week-highlight-glow` | Week glow effect mode |
| `.sticky-stack-mode-titleonly` | Only title sticky in stacks |
| `.small-card-fonts` | Reduced font size mode |
| `.task-height-limited` | Fixed task heights mode |

---

## Data Attributes Reference

### Column Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-column-id` | Unique identifier | `col-d72067ad-e32f-469a-9b6d-0ba6dd9e0771` |
| `data-column-index` | Position in board | `0`, `1`, `2` |
| `data-row` | Row number | `1` |
| `data-column-sticky` | Sticky state | `true`, `false` |
| `data-column-bg-tag` | Background color tag | `green`, `blue`, `red` |
| `data-column-border-tag` | Border style tag | Tag name |
| `data-all-tags` | All tags (space-separated) | `green blue important` |
| `data-current-day` | Current date match | `true` |
| `data-current-week` | Current week match | `true` |
| `data-current-weekday` | Current weekday match | `true` |
| `data-current-hour` | Current hour match | `true` |
| `data-current-time` | Current time slot match | `true` |

### Task Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-task-id` | Unique identifier | `task-72bedfc8-7d9b-43ef-bd1c-82d621924454` |
| `data-task-index` | Position in column | `0`, `1`, `2` |
| `data-task-bg-tag` | Background color tag | `blue`, `yellow` |
| `data-task-border-tag` | Border style tag | Tag name |
| `data-all-tags` | All tags (space-separated) | `blue important` |
| `data-task-initialized` | JS handlers attached | `true` |
| `data-current-*` | Temporal highlights | `true` |

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
| `data-drag-setup` | Drag handlers attached |
| `data-task-initialized` | Task element fully initialized |
| `data-task-drag-setup` | Task container ready |

---

## CSS Variables Reference

### Spacing Variables

```css
:root {
  --whitespace: 4px;
  --whitespace-mul2: calc(var(--whitespace) * 2);
  --whitespace-div2: calc(var(--whitespace) / 2);
  --whitespace-div4: calc(var(--whitespace) / 4);
}
```

### Dimension Variables

```css
:root {
  --task-height: auto;
  --task-section-min-height: auto;
  --task-section-max-height: auto;
  --column-width: 350px;
  --collapsed-column-width: 40px;
}
```

### Color Variables

```css
:root {
  --board-background: var(--vscode-editor-background);
  --column-background: var(--vscode-editor-background);
  --task-background: var(--vscode-editor-background);
  --task-focus-color: gray;
  --section-focus-color: gray;
}
```

### Temporal Highlighting Variables

```css
:root {
  --current-week-highlight-color: #ff0000;
  --current-week-border-width: 3px;
  --current-week-border-style: solid;
  --current-week-glow-size: 0 0 10px;
}
```

### Button Variables

```css
:root {
  /* Primary */
  --button-background: var(--vscode-button-background);
  --button-foreground: var(--vscode-button-foreground);
  --button-border: 1px solid var(--vscode-button-border, transparent);
  --button-background-hover: var(--vscode-button-hoverBackground);
  --button-foreground-hover: var(--vscode-button-foreground);
  --button-background-active: var(--vscode-button-background);
  --button-foreground-active: var(--vscode-button-foreground);
  --button-border-active: 1px solid var(--vscode-inputValidation-infoBorder, transparent);

  /* Secondary */
  --button-secondary-background: var(--vscode-button-secondaryBackground);
  --button-secondary-foreground: var(--vscode-button-secondaryForeground);
  --button-secondary-border: 1px solid var(--vscode-button-border, transparent);
  --button-secondary-background-hover: var(--vscode-button-secondaryHoverBackground);

  /* Alternative (drag handles, card sources) */
  --button-alternative-background: var(--vscode-button-secondaryBackground);
  --button-alternative-foreground: var(--vscode-button-secondaryForeground);
  --button-alternative-border: 1px solid var(--vscode-button-border, transparent);
  --button-alternative-background-hover: var(--vscode-button-secondaryHoverBackground);
  --button-alternative-foreground-hover: var(--vscode-button-secondaryForeground);
}
```

---

## Z-Index Hierarchy

| Layer | Z-Index | Elements |
|-------|---------|----------|
| Base content | 0-1 | Board, columns, tasks |
| Header bars container | 9 | `.header-bars-container` |
| Row header | 10 | `.kanban-row-header` (sticky left) |
| Column title text | 10 | `.column-title` base |
| Column header | 11 | `.column-header` |
| Drop indicators | 50 | Drag feedback elements |
| Sticky elements in stacks | 100 | `.column-margin`, `.column-header`, `.column-title`, `.column-footer` |
| File info bar | 100 | `#file-info-bar` |
| Dropdown menus | 200-300 | Donut menus when moved to body |
| File search modal | 1000 | `.file-search-overlay` |
| Modals | 1000+ | All `.modal` elements |
| Context menus | 1100 | `#path-context-menu` |
| Tooltips | 10000-10001 | Tooltip content and arrows |

---

## CSS Selector Patterns

### Tag-Based Styling

Dynamic styles are injected via `#dynamic-tag-styles`:

```css
/* Background by tag */
.kanban-full-height-column[data-column-bg-tag="tagname"] .column-header { }
.kanban-full-height-column[data-column-bg-tag="tagname"] .column-title { }
.kanban-full-height-column[data-column-bg-tag="tagname"] .column-content { }
.kanban-full-height-column[data-column-bg-tag="tagname"] .column-footer { }

/* Collapsed variant */
.kanban-full-height-column.collapsed[data-column-bg-tag="tagname"] .column-header { }

/* Border by tag */
.kanban-full-height-column[data-column-border-tag="tagname"] .column-header { }
.kanban-full-height-column[data-column-border-tag="tagname"] .column-title { }
.kanban-full-height-column[data-column-border-tag="tagname"] .column-inner { }
.kanban-full-height-column[data-column-border-tag="tagname"] .column-footer { }

/* Task styling by tag */
.task-item[data-task-bg-tag="tagname"] { }
.task-item[data-task-bg-tag="tagname"]:hover { }
.task-item[data-task-border-tag="tagname"] { }

/* Tag badge styling */
.kanban-tag[data-tag="tagname"] { }

/* Description line highlighting */
.task-description-display p:has(.kanban-tag[data-tag="tagname"]),
.task-description-display li:has(.kanban-tag[data-tag="tagname"]) { }

/* Header/footer bars */
.header-bar-tagname { }
.footer-bar-tagname { }
```

### Stack Context

```css
/* Within stacks */
.kanban-column-stack .kanban-full-height-column { }
.kanban-column-stack .kanban-full-height-column .column-title { }
.kanban-column-stack .kanban-full-height-column:not(:first-child) .column-margin { }

/* All folded in stack */
.kanban-column-stack.all-vertical-folded .kanban-full-height-column { }

/* Collapsed columns in stacks - hide content */
.kanban-column-stack .kanban-full-height-column.collapsed-vertical .column-inner,
.kanban-column-stack .kanban-full-height-column.collapsed-horizontal .column-inner {
  display: none !important;
}
```

### Multi-Row Context

```css
.kanban-board.multi-row .kanban-row { }
.kanban-board.multi-row .kanban-full-height-column { }
.kanban-row:has(.kanban-full-height-column.dragging) { }
.kanban-row:not(:has(.kanban-full-height-column)) { }
.kanban-row:not(:has(.kanban-full-height-column))::after {
  content: "Drop columns here";
}
```

### Temporal Highlighting

```css
.kanban-full-height-column[data-current-week="true"] .column-header,
.kanban-full-height-column[data-current-week="true"] .column-title,
.kanban-full-height-column[data-current-week="true"] .column-inner,
.kanban-full-height-column[data-current-week="true"] .column-footer { }

.kanban-full-height-column[data-current-day="true"] .column-title { }

.task-item[data-current-time="true"] { }

/* Highlight modes (body classes) */
body.week-highlight-background .kanban-full-height-column[data-current-week="true"] { }
body.week-highlight-glow .kanban-full-height-column[data-current-week="true"] { }
```

### Sticky Stack Mode

```css
/* Per-column sticky control */
.kanban-column-stack .kanban-full-height-column[data-column-sticky="false"] .column-header {
  position: relative !important;
}
.kanban-column-stack .kanban-full-height-column[data-column-sticky="false"] .column-title {
  position: relative !important;
}

/* Title-only sticky mode */
body.sticky-stack-mode-titleonly .kanban-column-stack .kanban-full-height-column[data-column-sticky="true"] .column-header {
  position: relative !important;
}
```

---

## Stack Layout System

The stack layout is managed by `stackLayoutManager.js` and involves both CSS and JavaScript.

### Column Structure in Stacks

```
.kanban-column-stack (CSS: display: grid; grid-template: 1fr / 1fr)
│
├── .kanban-full-height-column[1]
│   ├── .column-offset          ← margin-top: 0px (first column)
│   ├── .column-margin          ← top: 0px (sticky)
│   ├── .column-header          ← top: Xpx (sticky, calculated)
│   ├── .column-title           ← top: Ypx (sticky, calculated)
│   ├── .column-inner           ← z-index: calculated, HIDDEN when folded
│   └── .column-footer          ← bottom: Zpx (sticky from bottom)
│
├── .kanban-full-height-column[2]
│   ├── .column-offset          ← margin-top: (col1.totalHeight + margin)px
│   ├── .column-margin          ← top: calculated
│   ├── .column-header          ← top: calculated
│   ├── .column-title           ← top: calculated
│   ├── .column-inner           ← HIDDEN when folded
│   └── .column-footer          ← bottom: calculated
│
└── ... more columns
```

### Stack CSS

```css
.kanban-column-stack {
  display: grid;
  grid-template: 1fr / 1fr;
  position: relative;
  height: 100%;
}

/* All columns in same grid cell */
.kanban-column-stack .kanban-full-height-column {
  grid-row: 1;
  grid-column: 1;
  align-self: start;
  pointer-events: none;  /* Disabled on wrapper */
}

/* Re-enable pointer events on interactive elements */
.kanban-column-stack .kanban-full-height-column .column-header,
.kanban-column-stack .kanban-full-height-column .column-title,
.kanban-column-stack .kanban-full-height-column .column-footer,
.kanban-column-stack .kanban-full-height-column .column-inner {
  pointer-events: auto;
}

/* Sticky positioning */
.kanban-column-stack .kanban-full-height-column .column-margin,
.kanban-column-stack .kanban-full-height-column .column-header,
.kanban-column-stack .kanban-full-height-column .column-title,
.kanban-column-stack .kanban-full-height-column .column-footer {
  position: sticky;
  background: var(--column-background);
  z-index: 100;
}

/* 3D layering for proper overlap */
.kanban-column-stack .kanban-full-height-column .column-inner {
  transform: translateZ(-0.08px);
}
.kanban-column-stack .kanban-full-height-column .column-margin {
  transform: translateZ(-0.11px);
}
.kanban-column-stack .kanban-full-height-column .column-header {
  transform: translateZ(-0.133px);
}
```

### Height Calculation (JavaScript)

For each column, `updateStackLayoutCore()` measures:

| Measurement | Source Element | When Folded |
|-------------|----------------|-------------|
| `columnHeaderHeight` | `.column-header.offsetHeight` | Measured normally |
| `headerHeight` | `.column-title.offsetHeight` | Measured normally |
| `footerHeight` | `.column-footer.offsetHeight` | Measured normally |
| `contentHeight` | `.column-content.scrollHeight` | **Set to 0** |
| `marginHeight` | `.column-margin.offsetHeight` | Default: 4px |

```javascript
totalHeight = columnHeaderHeight + headerHeight + footerHeight + contentHeight;
// For folded columns: contentHeight = 0 but headers/footers still counted
```

### JavaScript-Set Inline Styles

These are set by `updateStackLayoutCore()`:

| Element | Property | Purpose |
|---------|----------|---------|
| `.column-offset` | `margin-top` | Vertical position in stack |
| `.column-margin` | `top` | Sticky position for margin |
| `.column-header` | `top` | Sticky position for header bars |
| `.column-title` | `top` | Sticky position for title |
| `.column-footer` | `bottom` | Sticky position from bottom |
| `.column-inner` | `z-index` | Layer behind sticky elements |

### Stack State Classes

| Class | Applied To | Description |
|-------|------------|-------------|
| `.all-vertical-folded` | `.kanban-column-stack` | All columns vertically folded |
| `.collapsed-vertical` | `.kanban-full-height-column` | Column folded vertically (narrow) |
| `.collapsed-horizontal` | `.kanban-full-height-column` | Column folded horizontally (header only) |

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

### 4. Diagram Patterns
PlantUML and Mermaid use parallel structures:
- `.plantuml-placeholder` / `.mermaid-placeholder`
- `.plantuml-diagram` / `.mermaid-diagram`
- `.plantuml-error` / `.mermaid-error`

**Opportunity**: Create `.diagram-placeholder`, `.diagram-container`, `.diagram-error` base classes.

### 5. Button Classes
Multiple button patterns with similar styling:
- `.add-task-btn`, `.add-column-btn`, `.collapsed-add-task-btn`
- `.donut-menu-btn`, `.file-bar-menu-btn`, `.include-menu-btn`
- `.span-width-btn`, `.stack-toggle-btn`

**Opportunity**: Use `.btn` base with modifier classes.

### 6. Nesting Depth
Deep selector chains observed:
```css
.donut-menu .donut-menu-dropdown .donut-menu-item.has-submenu .donut-menu-submenu
```
**Opportunity**: Flatten selectors using BEM or direct class targeting.

### 7. Tag Color Duplication
20+ tag colors with identical property patterns, each duplicated for column/task contexts.
**Opportunity**: Generate with CSS custom properties or SCSS.

### 8. `!important` Overuse
Many tag-based styles use `!important` to override defaults.
**Opportunity**: Restructure specificity hierarchy.

---

## File References

| File | Purpose |
|------|---------|
| `webview.html` | Main HTML structure |
| `webview.css` | Core styles (~4500 lines) |
| `boardRenderer.js` | Column/task HTML generation |
| `taskEditor.js` | Task editing UI |
| `menuOperations.js` | Menu handling |
| `utils/tagStyleManager.js` | Dynamic tag styles |
| `utils/stackLayoutManager.js` | Stack layout calculations |
| `utils/styleManager.js` | CSS variable management |
| `utils/columnFoldingManager.js` | Column fold state |
| `utils/rowLayoutManager.js` | Multi-row layout |

---

## Dynamic Style Injection

Styles are injected at runtime:

| Element ID | Purpose |
|------------|---------|
| `#dynamic-tag-styles` | Tag color/border/background styles |
| `#layout-styles` | Layout preset styles |
| Inline `style` attributes | Stack positions (`top`, `bottom`, `margin-top`) |
