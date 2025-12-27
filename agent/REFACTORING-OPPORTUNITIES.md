# Refactoring Opportunities Analysis

This document consolidates code quality analysis across HTML, CSS, JavaScript, and TypeScript files in the markdown-kanban-obsidian codebase.

---

## Completed Refactorings

| Date | Item | Status | Lines Saved |
|------|------|--------|-------------|
| 2025-12-27 | `saveCurrentField()` split into 20 focused methods | ✅ DONE | ~70 (better structure) |
| 2025-12-27 | `getTextColorsForBackground()` helper in colorUtils.js | ✅ DONE | ~15 |
| 2025-12-27 | Updated tagStyleManager.js to use new color helper | ✅ DONE | ~14 |
| 2025-12-27 | Unified dropdown positioning in menuUtils.js | ✅ DONE | ~50 |
| 2025-12-27 | NotificationService.ts for centralized notifications | ✅ DONE | ~200 (when fully adopted) |
| 2025-12-27 | SwitchBasedCommand base class for command handlers | ✅ DONE | ~220 (when fully adopted) |
| 2025-12-27 | Migrated UICommands.ts to SwitchBasedCommand | ✅ DONE | ~20 |
| 2025-12-27 | Migrated DiagramCommands.ts to SwitchBasedCommand | ✅ DONE | ~15 |
| 2025-12-27 | Migrated ClipboardCommands.ts to SwitchBasedCommand | ✅ DONE | ~15 |
| 2025-12-27 | CSS button base classes (.btn-base, variants) | ✅ DONE | ~100 (when fully adopted) |
| 2025-12-27 | CSS utility classes (flex, gap, text, transitions) | ✅ DONE | ~50 (when fully adopted) |
| 2025-12-27 | Decomposed handleBoardUpdate in messageHandler.ts | ✅ DONE | ~30 (better structure) |
| 2025-12-27 | Menu item template factory in menuUtils.js | ✅ DONE | ~50 (when fully adopted) |
| 2025-12-27 | Migrated TaskCommands.ts to SwitchBasedCommand | ✅ DONE | ~25 |
| 2025-12-27 | Migrated ColumnCommands.ts to SwitchBasedCommand | ✅ DONE | ~20 |
| 2025-12-27 | Migrated FileCommands.ts to SwitchBasedCommand | ✅ DONE | ~20 |
| 2025-12-27 | Migrated ExportCommands.ts to SwitchBasedCommand | ✅ DONE | ~20 |
| 2025-12-27 | Migrated TemplateCommands.ts to SwitchBasedCommand | ✅ DONE | ~15 |
| 2025-12-27 | Migrated DebugCommands.ts to SwitchBasedCommand | ✅ DONE | ~15 |
| 2025-12-27 | Migrated PathCommands.ts to SwitchBasedCommand | ✅ DONE | ~20 |
| 2025-12-27 | Migrated IncludeCommands.ts to SwitchBasedCommand | ✅ DONE | ~20 |
| 2025-12-27 | Migrated EditModeCommands.ts to SwitchBasedCommand | ✅ DONE | ~25 (+ extracted 18 methods) |
| 2025-12-27 | Decomposed startEdit() in taskEditor.js into 10 helper methods | ✅ DONE | ~40 (better structure) |
| 2025-12-27 | Created MenuManager class in menuUtils.js | ✅ DONE | ~100 (when fully adopted) |

---

## Executive Summary

| Domain | Issues Found | Est. Lines Reducible | Priority Areas |
|--------|-------------|---------------------|----------------|
| CSS | 912 selectors, 202 !important | 635+ lines (8.6%) | Button consolidation, menu patterns, temporal highlighting |
| JavaScript | 20+ duplicate patterns | 300+ lines | Dropdown positioning, menu handlers, escapeHtml |
| TypeScript | 123 scattered dialogs | 200+ lines | NotificationService, complex function decomposition |
| HTML | 4 menu types duplicated | 150+ lines | Menu templates, modal structure, data attributes |

**Total Estimated Reduction: 1,285+ lines across codebase**

---

## Table of Contents

1. [CSS Refactoring](#1-css-refactoring)
2. [JavaScript Refactoring](#2-javascript-refactoring)
3. [TypeScript Refactoring](#3-typescript-refactoring)
4. [HTML Structure Refactoring](#4-html-structure-refactoring)
5. [Cross-Cutting Concerns](#5-cross-cutting-concerns)
6. [Implementation Roadmap](#6-implementation-roadmap)

---

## 1. CSS Refactoring

**File:** `src/html/webview.css` (7,399 lines)

### 1.1 HIGH PRIORITY: Button Consolidation

**Problem:** 5 distinct button types with 80% overlapping properties.

**Current State (Lines 456-477, 510-535, 1584-1629, 1717-1753):**
```css
/* Type 1: File Info Buttons */
.file-info-right .global-fold-btn,
.file-info-right .sort-btn,
.file-info-right .global-sticky-btn { /* 15 properties */ }

/* Type 2: Toolbar Buttons */
.refresh-btn, .auto-export-btn { /* 12 properties */ }

/* Type 3: Icon Buttons */
.fold-all-btn, .pin-btn { /* 14 properties */ }

/* Type 4: Menu Buttons */
.donut-menu-btn, .file-bar-menu-btn { /* 13 properties */ }
```

**Proposed Solution:**
```css
/* Base button - shared properties */
.btn-base {
  background: var(--button-background);
  color: var(--button-foreground);
  border: var(--button-border);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}

.btn-base:hover {
  background: var(--button-background-hover);
}

/* Size variants */
.btn-sm { height: 16px; width: 16px; font-size: 8px; }
.btn-md { height: 22px; min-width: 22px; padding: 2px 4px; font-size: 12px; }
.btn-lg { height: 28px; padding: 4px 8px; font-size: 14px; }
```

**Impact:** Reduces ~120 lines, improves consistency

---

### 1.2 HIGH PRIORITY: Menu Pattern Consolidation

**Problem:** 3 menu implementations with nearly identical dropdown/item styles.

**Current Patterns:**
| Component | Lines | Shared Properties |
|-----------|-------|------------------|
| `.donut-menu-*` | 1700-1825 | 85% |
| `.file-bar-menu-*` | 1706-1825 | 85% |
| `.layout-presets-*` | 573-620 | 75% |

**Proposed Solution:**
```css
/* Base menu dropdown */
.menu-dropdown {
  position: fixed;
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  z-index: 1000;
  min-width: 150px;
  max-height: 80vh;
  overflow-y: auto;
}

/* Base menu item */
.menu-item {
  padding: 4px 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--vscode-dropdown-foreground);
  display: block;
  width: 100%;
  text-align: left;
  transition: background-color 0.2s;
}

.menu-item:hover {
  background: var(--vscode-list-hoverBackground);
}

/* Type modifiers */
.menu-dropdown--donut { /* donut-specific */ }
.menu-dropdown--file-bar { /* file-bar-specific */ }
```

**Impact:** Reduces ~100 lines, single source of truth

---

### 1.3 MEDIUM PRIORITY: Temporal Highlighting Consolidation

**Problem:** 5 identical selector patterns for week/day/weekday/hour/time (Lines 3880-3943).

**Current State:**
```css
/* Repeated 5 times with different data-attribute names */
.kanban-full-height-column[data-current-week="true"] .column-header,
.kanban-full-height-column[data-current-week="true"] .column-title,
.kanban-full-height-column[data-current-week="true"] .column-inner,
.kanban-full-height-column[data-current-week="true"] .column-footer {
  border-right: var(--current-week-border-width) var(--current-week-border-style) var(--current-week-highlight-color) !important;
}
/* ... same pattern for day, weekday, hour, time */
```

**Proposed Solution:** Use CSS classes instead of data attributes:
```css
/* Single rule for all temporal highlighting */
.is-current-week .column-header,
.is-current-week .column-title,
.is-current-week .column-inner,
.is-current-week .column-footer,
.is-current-day .column-header,
/* ... */
.task-item.is-current-time {
  border-right: var(--current-week-border-width) var(--current-week-border-style) var(--current-week-highlight-color);
}
```

**Impact:** Reduces ~60 lines, removes !important usage

---

### 1.4 MEDIUM PRIORITY: !important Reduction

**Current:** 202 instances of !important

**Top Offenders:**
| Category | Count | Lines |
|----------|-------|-------|
| `position: relative !important` | 26 | 2179-2206 |
| `display: none !important` | 12 | 84, 183, 258, 2262 |
| `z-index: * !important` | 15 | 3009, 3840 |
| Tag-based overrides | 50+ | scattered |

**Root Cause:** Specificity wars from deep nesting and data-attribute selectors.

**Solution Strategy:**
1. Flatten sticky positioning selectors using `.column-unsticky` class
2. Replace `[data-column-sticky="false"]` with `.is-not-sticky` class
3. Use CSS layers (@layer) for better cascade control

---

### 1.5 LOW PRIORITY: Utility Classes

**Create reusable utilities:**
```css
/* Transitions */
.transition-smooth { transition: all 0.2s ease; }
.transition-fast { transition: all 0.1s ease; }

/* Border radius */
.rounded-sm { border-radius: 2px; }
.rounded { border-radius: 4px; }
.rounded-lg { border-radius: 6px; }

/* Flexbox */
.flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Impact:** Reduces 150+ lines of repeated properties

---

## 2. JavaScript Refactoring

**Files:** `src/html/*.js` (40+ files)

### 2.1 HIGH PRIORITY: Dropdown Positioning Unification

**Problem:** Two nearly identical functions for positioning dropdowns.

**Current:**
- `positionDropdown()` in `menuOperations.js` (lines 908-966)
- `positionFileBarDropdown()` in `webview.js` (lines 544-589)

**Both do:**
1. Get trigger button `getBoundingClientRect()`
2. Calculate viewport dimensions
3. Measure dropdown dimensions
4. Apply fixed positioning with z-index 2147483640
5. Use identical boundary logic (10px margins)

**Proposed Solution:** Create unified function in `menuUtils.js`:
```javascript
// In utils/menuUtils.js
function positionDropdownMenu(triggerButton, dropdown, options = {}) {
    const {
        offsetX = 0,
        offsetY = 5,
        preferDirection = 'down',
        margin = 10
    } = options;

    const rect = triggerButton.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    dropdown.style.position = 'fixed';
    dropdown.style.zIndex = '2147483640';

    // Calculate best position
    let top = rect.bottom + offsetY;
    let left = rect.left + offsetX;

    // Viewport boundary checks
    const dropdownRect = dropdown.getBoundingClientRect();
    if (left + dropdownRect.width > viewportWidth - margin) {
        left = viewportWidth - dropdownRect.width - margin;
    }
    if (top + dropdownRect.height > viewportHeight - margin) {
        top = rect.top - dropdownRect.height - offsetY;
    }

    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;
}

window.positionDropdownMenu = positionDropdownMenu;
```

**Impact:** Reduces 60 lines, prevents future divergence

---

### 2.2 HIGH PRIORITY: Complex Function Decomposition

#### 2.2.1 `saveCurrentField()` in taskEditor.js ✅ COMPLETED

**Status:** REFACTORED on 2025-12-27

**Original:** 543 lines monolithic function (lines 808-1350)

**After Refactoring:** Split into 20 focused methods:
- `saveCurrentField()` - Main dispatcher (16 lines)
- `_saveColumnTitle()` - Column title entry point (35 lines)
- `_computeNewColumnTitle()` - Title reconstruction helper (16 lines)
- `_saveColumnTitleWithIncludes()` - Include handling (49 lines)
- `_renderIncludeBadges()` - Badge rendering (14 lines)
- `_saveRegularColumnTitle()` - Regular save (20 lines)
- `_handleLayoutChanges()` - Layout tag handling (24 lines)
- `_updateColumnDisplay()` - Display update (13 lines)
- `_updateColumnSpanClasses()` - Span CSS (15 lines)
- `_updateColumnTagStyling()` - Tag styling (23 lines)
- `_updateColumnTemporalAttributes()` - Temporal attrs (16 lines)
- `_trackPendingColumnChange()` - Change tracking (11 lines)
- `_saveTaskField()` - Task field entry (48 lines)
- `_findTask()` - Task finder (16 lines)
- `_saveTaskTitle()` - Task title (27 lines)
- `_saveTaskTitleWithIncludes()` - Include title (28 lines)
- `_saveTaskDescription()` - Description (7 lines)
- `_updateTaskDisplay()` - Task display (48 lines)
- `_updateTaskTagStyling()` - Task tags (23 lines)
- `_updateTaskTemporalAttributes()` - Task temporal (23 lines)

**Impact:** Each method now has single responsibility, improved testability

#### 2.2.2 `startEdit()` in taskEditor.js (237 lines)

**Location:** Lines 505-741

**Proposed Split:**
- `setupEditElement()` - element setup, display toggling
- `positionCursor()` - cursor positioning logic
- `setupEditHandlers()` - event handlers for blur/focus
- `configureStackLayoutRecalculation()` - stack layout logic

---

### 2.3 MEDIUM PRIORITY: Menu Handler Consolidation

**Problem:** Identical menu toggle patterns in multiple files.

**Current:**
- `toggleDonutMenu()` in menuOperations.js (lines 817-848)
- `toggleFileBarMenu()` in webview.js (lines 592-650)

**Both do:**
1. Close all menus
2. Open specific menu
3. Position dropdown
4. Set up event handlers

**Proposed Solution:** Create `MenuManager` class:
```javascript
// In utils/menuUtils.js
class MenuManager {
    static activeMenu = null;

    static open(menu, triggerButton, config = {}) {
        this.closeAll();

        menu.classList.add('active');
        const dropdown = menu.querySelector('[class*="-dropdown"]');

        if (config.moveToBody) {
            document.body.appendChild(dropdown);
            dropdown.classList.add('moved-to-body');
        }

        positionDropdownMenu(triggerButton, dropdown, config);
        this.setupCloseHandlers(menu, dropdown);
        this.activeMenu = menu;
    }

    static closeAll() {
        document.querySelectorAll('.donut-menu.active, .file-bar-menu.active')
            .forEach(m => m.classList.remove('active'));

        document.querySelectorAll('.moved-to-body')
            .forEach(d => this.cleanupDropdown(d));

        this.activeMenu = null;
    }

    static setupCloseHandlers(menu, dropdown) {
        // Unified hover/click handlers
    }
}

window.MenuManager = MenuManager;
```

**Impact:** Reduces 100+ lines across files

---

### 2.4 LOW PRIORITY: escapeHtml Consolidation

**Problem:** 3 implementations of HTML escaping.

**Current Locations:**
- `utils/validationUtils.js` (lines 12-20) - canonical
- `fileSearchModal` (inline, lines 453-457) - uses DOM trick
- `exportMarpUI.js` (lines 1762-1766) - includes quote escaping

**Solution:** Use `window.escapeHtml` everywhere, add `escapeHtmlAttribute()` for quotes.

---

## 3. TypeScript Refactoring

**Files:** `src/*.ts` (143 files, ~37,355 lines)

### 3.1 HIGH PRIORITY: Notification Service

**Problem:** 123 scattered `vscode.window.show*Message` calls across 27 files.

**Example Locations:**
- `extension.ts` (15 instances)
- `services/LinkHandler.ts` (20 instances)
- `commands/PathCommands.ts` (8 instances)
- `commands/IncludeCommands.ts` (7 instances)

**Proposed Solution:**
```typescript
// src/services/NotificationService.ts
export class NotificationService {
    static showError(message: string): Thenable<string | undefined> {
        return vscode.window.showErrorMessage(message);
    }

    static showWarning(message: string): Thenable<string | undefined> {
        return vscode.window.showWarningMessage(message);
    }

    static showInfo(message: string): Thenable<string | undefined> {
        return vscode.window.showInformationMessage(message);
    }

    static async confirm(
        message: string,
        options: string[]
    ): Promise<string | undefined> {
        return vscode.window.showWarningMessage(message, { modal: true }, ...options);
    }

    static async confirmUnsavedChanges(
        fileName: string
    ): Promise<'save' | 'discard' | 'cancel'> {
        const choice = await vscode.window.showWarningMessage(
            `The file "${fileName}" has unsaved changes.`,
            { modal: true },
            'Save and Continue',
            'Discard and Continue',
            'Cancel'
        );

        switch (choice) {
            case 'Save and Continue': return 'save';
            case 'Discard and Continue': return 'discard';
            default: return 'cancel';
        }
    }
}
```

**Impact:** Centralizes UI, enables future i18n, reduces 200+ lines

---

### 3.2 HIGH PRIORITY: Complex Function Decomposition

#### 3.2.1 `handleBoardUpdate()` in messageHandler.ts (96 lines)

**Location:** Lines 230-325

**Current Concerns:**
1. Include file unsaved changes checking (lines 244-312)
2. Board state updates (lines 316-320)
3. Change emission (lines 320-321)

**Proposed Split:**
```typescript
async handleBoardUpdate(message: BoardUpdateMessage, context: CommandContext) {
    // Check unsaved includes first
    const continueUpdate = await this.checkUnsavedIncludeFiles(message, context);
    if (!continueUpdate) return;

    // Update board state
    await this.updateBoardState(message, context);

    // Emit changes
    this.emitBoardChanges(message, context);
}

private async checkUnsavedIncludeFiles(
    message: BoardUpdateMessage,
    context: CommandContext
): Promise<boolean> {
    // Extract lines 244-312
}
```

---

### 3.3 MEDIUM PRIORITY: Type Safety Improvements

**Problem:** Uses of `any` in critical paths.

**Locations:**
- `messageHandler.ts` line 26: `getWebviewPanel: () => any`
- `messageHandler.ts` line 27: `getWebviewBridge?: () => any`
- `core/bridge/MessageTypes.ts` line 63: `layoutPresets?: Record<string, unknown>`

**Proposed Types:**
```typescript
// src/types/providers.ts
export type WebviewPanelProvider = () => vscode.WebviewPanel | undefined;
export type WebviewBridgeProvider = () => WebviewBridge | undefined;

// src/core/bridge/MessageTypes.ts
export interface BoardViewConfig {
    columnBorder: string;
    taskBorder: string;
    columnWidth: number;
    // ... properly typed
}

export interface BoardUpdateMessage {
    config: BoardViewConfig;
    // instead of scattered optional properties
}
```

---

### 3.4 MEDIUM PRIORITY: Command Handler Boilerplate

**Problem:** 11 command files repeat identical try-catch patterns.

**Current Pattern (repeated 11 times):**
```typescript
async execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
    try {
        switch (message.type) {
            case 'case1': return await this.handleCase1(message, context);
            // ... many cases
            default: return this.failure(`Unknown command: ${message.type}`);
        }
    } catch (error) {
        console.error(`[CommandName] Error:`, error);
        return this.failure(getErrorMessage(error));
    }
}
```

**Proposed Solution:**
```typescript
// In commands/BaseMessageCommand.ts
export abstract class SwitchBasedCommand extends BaseMessageCommand {
    protected abstract handlers: Record<
        string,
        (msg: IncomingMessage, ctx: CommandContext) => Promise<CommandResult>
    >;

    async execute(
        message: IncomingMessage,
        context: CommandContext
    ): Promise<CommandResult> {
        try {
            const handler = this.handlers[message.type];
            return handler
                ? await handler.call(this, message, context)
                : this.failure(`Unknown ${this.metadata.id}: ${message.type}`);
        } catch (error) {
            console.error(`[${this.metadata.id}] Error:`, error);
            return this.failure(getErrorMessage(error));
        }
    }
}

// Usage in TaskCommands.ts
export class TaskCommands extends SwitchBasedCommand {
    protected handlers = {
        'insertTaskBefore': this.handleInsertTaskBefore,
        'insertTaskAfter': this.handleInsertTaskAfter,
        'deleteTask': this.handleDeleteTask,
        // ...
    };
}
```

**Impact:** Reduces boilerplate in 11 files, ~200 lines total

---

### 3.5 LOW PRIORITY: Event Bus Unification

**Problem:** Two similar event bus implementations.

**Files:**
- `core/events/EventBus.ts` (singleton, global)
- `core/events/ScopedEventBus.ts` (per-panel)

**Proposed Solution:**
```typescript
abstract class BaseEventBus<TEvent = any> {
    protected handlers: Map<string, Set<EventHandler<TEvent>>> = new Map();

    on<T extends TEvent>(event: string, handler: EventHandler<T>): () => void {
        // Shared implementation
    }

    emit<T extends TEvent>(event: string, data: T): void {
        // Shared implementation
    }

    off(event: string, handler: EventHandler<TEvent>): void {
        // Shared implementation
    }
}

export class EventBus extends BaseEventBus<AppEvent> {
    private static instance: EventBus;
    static getInstance(): EventBus { /* singleton */ }
}

export class ScopedEventBus extends BaseEventBus<any> {
    constructor(private panelId: string) { super(); }
}
```

---

## 4. HTML Structure Refactoring

**Files:** `src/html/webview.html`, `src/html/boardRenderer.js`

### 4.1 HIGH PRIORITY: Menu Item Template

**Problem:** 4 menu types with nearly identical item structures.

**Current:**
```html
<!-- Drag Menu Item -->
<div class="drag-menu-item">
    <span class="drag-menu-item-icon">📝</span>
    <span class="drag-menu-item-text">Empty Card</span>
</div>

<!-- Donut Menu Item -->
<button class="donut-menu-item" onclick="...">
    Insert column before
</button>

<!-- File Bar Menu Item -->
<button class="file-bar-menu-item" onclick="...">
    <span class="menu-icon">↶</span> Undo
</button>
```

**Proposed Solution:** Create template factory:
```javascript
// In utils/menuTemplates.js
const MenuItemTemplate = {
    button(config) {
        const { icon, text, onclick, className = '', attrs = '' } = config;
        return `
            <button class="menu-item ${className}" onclick="${onclick}" ${attrs}>
                ${icon ? `<span class="menu-icon">${icon}</span>` : ''}
                ${text}
            </button>
        `;
    },

    draggable(config) {
        const { icon, text, id } = config;
        return `
            <div class="menu-item menu-item--draggable" id="${id}" draggable="true">
                ${icon ? `<span class="menu-icon">${icon}</span>` : ''}
                ${text}
            </div>
        `;
    },

    submenu(config) {
        const { label, submenuType, elementId } = config;
        return `
            <div class="menu-item has-submenu"
                 data-submenu="${submenuType}"
                 data-element-id="${elementId}">
                ${label}
            </div>
        `;
    },

    divider() {
        return '<div class="menu-divider"></div>';
    }
};

window.MenuItemTemplate = MenuItemTemplate;
```

**Impact:** Single source of truth for menu items, easier styling

---

### 4.2 HIGH PRIORITY: Data Attribute Cleanup

**Problem:** Redundant and inconsistent data attributes.

**Current (boardRenderer.js lines 1537-1562):**
```javascript
columnDiv.setAttribute('data-column-id', column.id);
columnDiv.setAttribute('data-column-index', columnIndex);
columnDiv.setAttribute('data-column-sticky', hasStickyTag ? 'true' : 'false');
columnDiv.setAttribute('data-column-border-tag', columnBorderTag);
columnDiv.setAttribute('data-column-bg-tag', columnBgTag);
columnDiv.setAttribute('data-current-day', 'true');
columnDiv.setAttribute('data-current-week', 'true');
// ... 5 more temporal attributes
```

**Issues:**
1. `data-column-` prefix is redundant (element is already a column)
2. Boolean values as strings instead of CSS classes
3. 5 temporal attributes could be CSS classes

**Proposed Solution:**
```javascript
// Simplify naming
columnDiv.dataset.id = column.id;
columnDiv.dataset.index = columnIndex;
columnDiv.dataset.borderTag = columnBorderTag;
columnDiv.dataset.bgTag = columnBgTag;

// Use CSS classes for boolean states
if (hasStickyTag) columnDiv.classList.add('is-sticky');

// Use CSS classes for temporal states
const temporalClasses = [];
if (window.tagUtils.isCurrentDate(colText)) temporalClasses.push('is-current-day');
if (window.tagUtils.isCurrentWeek(colText)) temporalClasses.push('is-current-week');
if (window.tagUtils.isCurrentWeekday(colText)) temporalClasses.push('is-current-weekday');
if (window.tagUtils.isCurrentHour(colText)) temporalClasses.push('is-current-hour');
if (window.tagUtils.isCurrentTimeSlot(colText)) temporalClasses.push('is-current-time');
columnDiv.classList.add(...temporalClasses);
```

**Impact:**
- Simpler CSS selectors (`.is-sticky` vs `[data-column-sticky="true"]`)
- Better performance (class operations faster than attribute)
- More semantic HTML

---

### 4.3 MEDIUM PRIORITY: Modal Structure Unification

**Problem:** 3 modal patterns with similar but inconsistent structure.

**Current:**
- `#input-modal` - `.modal > .modal-content > .modal-header + .modal-body + .modal-actions`
- `#export-modal` - `.modal > .modal-content.export-modal-content > .modal-header + .modal-body`
- `#file-search-overlay` - `.file-search-overlay > .file-search-dialog > .file-search-header + .file-search-footer`

**Proposed Unified Structure:**
```html
<div class="modal" id="input-modal" data-modal-type="input">
    <div class="modal__content">
        <header class="modal__header">
            <h3 class="modal__title">Title</h3>
            <div class="modal__actions">
                <button class="modal__close">&times;</button>
            </div>
        </header>
        <div class="modal__body">
            <!-- Content -->
        </div>
        <footer class="modal__footer">
            <button class="btn btn--secondary">Cancel</button>
            <button class="btn btn--primary">OK</button>
        </footer>
    </div>
</div>
```

**Impact:** Consistent styling, easier JavaScript handling

---

### 4.4 LOW PRIORITY: Reduce Wrapper Nesting

**Problem:** Unnecessary wrapper divs in menus and forms.

**Example - Menu Item with Icon (before):**
```html
<div class="drag-menu-item">
    <span class="drag-menu-item-icon">📝</span>
    <span class="drag-menu-item-text">Empty Card</span>
</div>
```

**After (using CSS ::before):**
```html
<button class="menu-item" data-icon="📝">Empty Card</button>
```

```css
.menu-item[data-icon]::before {
    content: attr(data-icon);
    margin-right: 6px;
}
```

**Impact:** Simpler DOM, fewer elements to style

---

## 5. Cross-Cutting Concerns

### 5.1 Naming Convention Standardization

**Current Inconsistencies:**
| Pattern | Examples |
|---------|----------|
| BEM-ish | `.donut-menu-item`, `.file-bar-menu-btn` |
| Flat | `.collapsed`, `.active`, `.hidden` |
| Data-prefixed | `data-column-id`, `data-task-bg-tag` |
| Camel in data | `data-submenu-type` vs `data-column-sticky` |

**Proposed Standard:**
```
Components: .component-name (lowercase, hyphenated)
Elements: .component-name__element
Modifiers: .component-name--modifier
States: .is-active, .has-submenu
Data: data-element-id (no type prefix, lowercase-hyphenated)
```

### 5.2 Consolidation Priority Matrix

| Item | Impact | Effort | Priority |
|------|--------|--------|----------|
| Button CSS consolidation | High | Low | P0 |
| Menu template factory | High | Medium | P0 |
| Dropdown positioning unification | High | Low | P0 |
| NotificationService | High | Low | P0 |
| Temporal CSS to classes | Medium | Low | P1 |
| saveCurrentField() split | Medium | Medium | P1 |
| Command handler base class | Medium | Medium | P1 |
| Modal structure unification | Medium | Medium | P2 |
| Data attribute cleanup | Medium | Medium | P2 |
| Event bus unification | Low | Medium | P3 |

---

## 6. Implementation Roadmap

### Phase 1: Quick Wins (No Breaking Changes)

**Week 1:**
1. Create `utils/menuUtils.js` with `positionDropdownMenu()` and `MenuManager`
2. Create `NotificationService.ts` and migrate 5 highest-usage files
3. Add CSS utility classes (`.transition-smooth`, `.rounded`, `.flex-center`)

**Week 2:**
1. Create `.btn-base` and size variants in CSS
2. Create `MenuItemTemplate` for consistent menu item generation
3. Convert temporal data attributes to CSS classes

**Estimated LOC Reduction: 400+ lines**

### Phase 2: Medium Refactors

**Week 3-4:**
1. Split `saveCurrentField()` into 3 focused methods
2. Create `SwitchBasedCommand` base class
3. Consolidate menu CSS (`.menu-dropdown`, `.menu-item`)

**Week 5-6:**
1. Unify modal HTML structure
2. Clean up data attribute naming
3. Decompose `handleBoardUpdate()` in messageHandler.ts

**Estimated LOC Reduction: 500+ lines**

### Phase 3: Optional Deep Refactors

1. Convert dynamic HTML to template elements
2. Create Web Components for complex menus
3. Implement CSS layers for specificity management
4. Service container pattern for TypeScript services

---

---

## 7. Utility File Consolidation

**Files:** `src/html/utils/*.js` (15+ utility files)

### 7.1 HIGH PRIORITY: Color Contrast Calculation Duplication ✅ COMPLETED

**Status:** REFACTORED on 2025-12-27

**Original Problem:** `tagStyleManager.js` duplicated color contrast calculations ~15 times.

**Solution Implemented:**
1. Added `getTextColorsForBackground()` method to `colorUtils.js` (lines 197-208)
2. Updated 7 instances in `tagStyleManager.js` to use the new helper:
   - Lines 132-133: defaultColumnTextColor/Shadow
   - Lines 168-169: defaultCollapsedTextColor/Shadow
   - Lines 252-253: tagTextColor/Shadow
   - Lines 282-283: columnTextColor/Shadow
   - Lines 319-320: collapsedTextColor/Shadow
   - Lines 421-422: headerTextColor/Shadow
   - Lines 469-470: footerTextColor/Shadow

**New Pattern:**
```javascript
const { textColor: columnTextColor, textShadow: columnTextShadow } =
    colorUtils ? colorUtils.getTextColorsForBackground(columnBg) : { textColor: '#000000', textShadow: '' };
```

**Impact:** Cleaner code, single call instead of two, easier maintenance

---

### 7.2 MEDIUM PRIORITY: Filter Functions Consolidation

**Problem:** Two nearly identical tag filter functions in `tagUtils.js`.

**Current:**
- `filterTagsFromText()` (line 1197) - for display
- `filterTagsForExport()` (line 1253) - for export

**Both have:** Same switch statement structure, same tag patterns, slight variations.

**Proposed Solution:**
```javascript
// Merge into single parameterized function
filterTags(text, setting = 'standard', context = 'display') {
    // Single implementation
    // context: 'display' | 'export'
    // When context === 'export', handle export-specific logic
}
```

**Impact:** Reduces ~100 lines of duplication

---

### 7.3 MEDIUM PRIORITY: File Path Truncation Abstraction

**Problem:** File path truncation logic duplicated 4 times in `tagUtils.js`.

**Locations:** Lines 1309-1330, 1357-1382, 1416-1442, 1461-1483

**Pattern:**
```javascript
// Duplicated ~4 times with slight variations
if (baseFileName.length > 20) {
    const lastDotIndex = baseFileName.lastIndexOf('.');
    const ext = lastDotIndex !== -1 ? baseFileName.substring(lastDotIndex) : '';
    const nameWithoutExt = ...
    const maxFirstChars = Math.max(1, 20 - 3 - ext.length);
    ...
}
```

**Proposed Solution:**
```javascript
// In tagUtils.js or new fileUtils.js
function truncateFileName(fileName, maxLength = 20) {
    if (fileName.length <= maxLength) return fileName;

    const lastDotIndex = fileName.lastIndexOf('.');
    const ext = lastDotIndex !== -1 ? fileName.substring(lastDotIndex) : '';
    const nameWithoutExt = lastDotIndex !== -1
        ? fileName.substring(0, lastDotIndex)
        : fileName;

    const availableChars = maxLength - 3 - ext.length; // 3 for "..."
    const truncatedName = nameWithoutExt.substring(0, Math.max(1, availableChars));

    return `${truncatedName}...${ext}`;
}
```

**Impact:** Reduces ~80 lines

---

### 7.4 LOW PRIORITY: Temporal Attribute Delegation

**Problem:** `menuUtils.js` has its own temporal attribute logic instead of using `tagUtils.js`.

**Current:** `menuUtils.updateTemporalAttributes()` (lines 178-203) - simple sequential checks

**Better:** Use `tagUtils.getActiveTemporalAttributes()` (lines 736-765) - handles hierarchical gating

**Impact:** Removes ~25 lines, improves consistency

---

### 7.5 Utility Files Summary

| File | Lines | Status |
|------|-------|--------|
| `tagUtils.js` | 1,554 | Needs filter merge, path truncation extraction |
| `tagStyleManager.js` | 883 | Needs color helper usage |
| `colorUtils.js` | 204 | Add getTextColorsForBackground() |
| `menuUtils.js` | 373 | Use tagUtils for temporal |
| `menuConfig.js` | 340 | Well-organized, no changes |
| `stackLayoutManager.js` | 777 | Well-organized, no changes |
| `columnFoldingManager.js` | 735 | Well-organized, no changes |
| `styleManager.js` | ~200 | Well-organized, no changes |
| `dateUtils.js` | ~100 | Well-organized, no changes |

---

## 8. Test Coverage Analysis

**Current State:** Only ~1.7% code coverage (4 test files, ~640 lines of tests)

### 8.1 CRITICAL: Untested Core Files

| Category | Files | Priority |
|----------|-------|----------|
| **Core Infrastructure** | `kanbanWebviewPanel.ts`, `extension.ts`, `fileManager.ts`, `messageHandler.ts` | P0 |
| **Event System** | `EventBus.ts`, `ScopedEventBus.ts`, 6 handler files | P0 |
| **State Management** | `BoardStore.ts`, `ChangeStateMachine.ts`, `FileSaveService.ts` | P0 |
| **File Management** | `MarkdownFile.ts` (partial), `MainKanbanFile.ts`, `SaveTransactionManager.ts` | P1 |
| **Commands** | 14 command files, all untested | P1 |
| **Services** | 15+ service files, all untested | P2 |
| **Frontend** | All `src/html/*.js` files | P3 |

### 8.2 Existing Test Patterns (Good)

**Pattern 1: State-based Testing (BoardCrudOperations)**
```typescript
const board = createTestBoard();
const result = operations.addTask(board, 'col-3', taskData);
expect(result).toBe(true);
expect(board.columns[2].tasks.length).toBe(1);
```

**Pattern 2: Action-based Testing (ColumnActions)**
```typescript
const action = ColumnActions.moveWithRowUpdate('col-1', 3, 2);
const result = action.execute(board);
expect(result).toBe(true);
expect(action.targets).toEqual([]);
```

### 8.3 VS Code API Mocking (Partial)

**Mocked in `src/test/setup.js`:**
- `Uri.file()`, `Uri.parse()`
- `workspace.getConfiguration()`, `workspace.fs`
- `window.showErrorMessage()`, etc.
- `commands.registerCommand()`, `executeCommand()`
- `EventEmitter`, `Disposable`

**Missing Mocks Needed:**
- File system watchers
- Webview panels
- Text editors and document changes
- Extension context persistence

### 8.4 Test Priority Recommendations

**Phase 1: Core Logic (No VS Code dependencies)**
1. `BoardStore.ts` - State management
2. `ChangeStateMachine.ts` - State transitions
3. Action classes in `src/board/actions/`

**Phase 2: File Operations (Needs watcher mocks)**
1. `MarkdownFile.ts` - Expand existing tests
2. `SaveTransactionManager.ts`
3. `WatcherCoordinator.ts`

**Phase 3: Integration (Needs webview mocks)**
1. `messageHandler.ts`
2. Command implementations
3. `kanbanWebviewPanel.ts`

---

## Appendix: File Reference

| File | Lines | Key Issues |
|------|-------|------------|
| `src/html/webview.css` | 7,399 | Button/menu duplication, !important overuse |
| `src/html/boardRenderer.js` | 2,200+ | Complex functions, template strings |
| `src/html/taskEditor.js` | 1,700+ | 543-line function, complex state |
| `src/html/menuOperations.js` | 2,100+ | Duplicate positioning, menu handlers |
| `src/html/webview.js` | 1,300+ | Duplicate dropdown logic |
| `src/html/utils/tagUtils.js` | 1,554 | Filter duplication, path truncation |
| `src/html/utils/tagStyleManager.js` | 883 | Color calculation duplication |
| `src/messageHandler.ts` | 500+ | Complex handleBoardUpdate, any types |
| `src/commands/*.ts` | 11 files | Repeated try-catch boilerplate |
| `src/test/` | 4 files | Only 1.7% coverage |
