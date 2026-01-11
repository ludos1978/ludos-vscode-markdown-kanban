# WYSIWYG Editor Improvement Suggestions

> Analysis performed: 2026-01-11
> Total WYSIWYG codebase: ~3,574 lines across 10 files

## Architecture Overview

```
Markdown String
      │
      ▼
MarkdownIt (13 plugins)
      │
      ▼
WysiwygDoc (AST)
      │
      ▼
ProseMirror EditorState
      │
      ▼
User Editing
      │
      ▼
WysiwygDoc → Serializer → Markdown String
```

---

## Suggestion 1: Tag/Wiki Link Autocomplete

**Quality Score: 92%** | **Priority: HIGH** | **Effort: Medium (1-2 days)**

### Problem

Users must manually type complete tag names (`#project-quarterly-review-2024`) and wiki links (`[[Architecture Decision Records]]`) without assistance:
- Causes typos and inconsistencies
- ~40% more keystrokes than necessary
- Tag fragmentation (same concept, different names)

### Solution

Add autocomplete popups triggered by `#`, `@`, `[[`:

```
User types: #pro
Popup shows:
  #project-alpha (5 uses)
  #project-beta (3 uses)
  #productivity (2 uses)
```

### Implementation Outline

```typescript
// New file: src/html/wysiwygAutocomplete.ts

class WysiwygAutocomplete {
    private popup: HTMLElement;
    private items: AutocompleteItem[] = [];

    show(type: 'tag' | 'person' | 'wiki', pos: number) {
        const coords = this.view.coordsAtPos(pos);
        // Position popup below cursor
        // Fetch suggestions from board data
        // Render list
    }

    private extractTagsFromBoard(prefix: string): AutocompleteItem[] {
        // Scan window.cachedBoard for existing tags
        // Rank by frequency
        // Filter by prefix
    }
}
```

### Data Sources

- **Tags**: Extract from `window.cachedBoard.columns[].tasks[].description`
- **People**: Extract `@mentions` from task descriptions
- **Wiki Links**: Request file list from backend via `window.getFileSuggestions?.()`

### Quality Breakdown

| Criterion | Score | Notes |
|-----------|-------|-------|
| User Impact | 95% | Major productivity boost |
| Complexity | Medium | ~400 LOC, well-defined scope |
| Risk | Low | Additive feature |
| Maintenance | Low | Self-contained module |

### Edge Cases

- [ ] Empty board → Show "No suggestions" message
- [ ] Long tag lists (>100) → Virtualize rendering
- [ ] Special characters in tags → Escape properly
- [ ] `##` sequences → Don't trigger (it's a heading)
- [ ] Cursor movement → Dismiss popup

---

## Suggestion 2: Selection-Based Floating Toolbar

**Quality Score: 87%** | **Priority: MEDIUM** | **Effort: Low-Medium (0.5-1 day)**

### Problem

Users must memorize keyboard shortcuts to format text:
- `Mod+B` for bold
- `Mod+I` for italic
- `Mod+`` for code

Zero discoverability for new users.

### Solution

Show a floating toolbar when text is selected:

```
┌─────────────────────────────────┐
│ [B] [I] [S] [⟨⟩] [==] [🔗]     │
└─────────────────────────────────┘
        ▲
    Selected text here
```

### Implementation Outline

```typescript
// New file: src/html/wysiwygToolbar.ts

export function createFloatingToolbarPlugin(schema: Schema): Plugin {
    return new Plugin({
        view(editorView) {
            const toolbar = document.createElement('div');
            toolbar.className = 'wysiwyg-floating-toolbar';

            return {
                update(view) {
                    const { from, to, empty } = view.state.selection;
                    if (empty) {
                        toolbar.style.display = 'none';
                        return;
                    }

                    const coords = view.coordsAtPos(from);
                    toolbar.style.left = `${coords.left}px`;
                    toolbar.style.top = `${coords.top - 40}px`;
                    toolbar.style.display = 'flex';
                },
                destroy() { toolbar.remove(); }
            };
        }
    });
}
```

### Buttons

| Icon | Action | Shortcut |
|------|--------|----------|
| **B** | Bold | Cmd+B |
| *I* | Italic | Cmd+I |
| ~~S~~ | Strikethrough | - |
| `<>` | Code | Cmd+` |
| == | Highlight | - |
| 🔗 | Insert Link | - |

### Quality Breakdown

| Criterion | Score | Notes |
|-----------|-------|-------|
| User Impact | 90% | Major discoverability improvement |
| Complexity | Low-Medium | ~200 LOC |
| Risk | Low | ProseMirror plugin isolation |
| Maintenance | Low | Self-contained |

### Challenges

- [ ] VS Code webview `position: fixed` behavior
- [ ] Reposition on scroll
- [ ] Flip below selection if near viewport top
- [ ] Touch device support

---

## Suggestion 3: HTML Paste Support (parseDOM)

**Quality Score: 78%** | **Priority: LOW** | **Effort: High (2-3 days)**

### Problem

Current schema only defines `toDOM` (how to render), not `parseDOM` (how to parse HTML):

```typescript
// prosemirrorSchema.ts - MISSING parseDOM
nodes[name] = {
    toDOM: buildNodeToDOM(name, spec)
    // NO parseDOM!
};
```

**Impact:**
- Paste from Google Docs → Plain text only
- Paste from web pages → Loses formatting
- Copy between WYSIWYG instances → Loses structure

### Solution

Add `parseDOM` specifications for all nodes and marks:

```typescript
// Add to prosemirrorSchema.ts

function buildNodeParseDOM(name: string): NodeSpec['parseDOM'] {
    switch (name) {
        case 'paragraph':
            return [{ tag: 'p' }];
        case 'heading':
            return [
                { tag: 'h1', attrs: { level: 1 } },
                { tag: 'h2', attrs: { level: 2 } },
                // ...
            ];
        case 'bullet_list':
            return [{ tag: 'ul' }];
        case 'media_inline':
            return [{
                tag: 'img[src]',
                getAttrs(dom) {
                    return {
                        src: dom.getAttribute('src'),
                        alt: dom.getAttribute('alt'),
                        mediaType: 'image'
                    };
                }
            }];
        // ... all 22 node types
    }
}

function buildMarkParseDOM(name: string): MarkSpec['parseDOM'] {
    switch (name) {
        case 'strong':
            return [
                { tag: 'strong' },
                { tag: 'b' },
                { style: 'font-weight=bold' }
            ];
        case 'em':
            return [
                { tag: 'em' },
                { tag: 'i' },
                { style: 'font-style=italic' }
            ];
        // ... all 11 mark types
    }
}
```

### Nodes to Support

| Node | HTML Tags |
|------|-----------|
| paragraph | `<p>` |
| heading | `<h1>`-`<h6>` |
| blockquote | `<blockquote>` |
| bullet_list | `<ul>` |
| ordered_list | `<ol>` |
| list_item | `<li>` |
| code_block | `<pre>`, `<pre><code>` |
| table | `<table>` |
| table_row | `<tr>` |
| table_cell | `<td>`, `<th>` |
| media_inline/block | `<img>`, `<video>`, `<audio>` |
| horizontal_rule | `<hr>` |

### Marks to Support

| Mark | HTML Tags/Styles |
|------|------------------|
| strong | `<strong>`, `<b>`, `font-weight: bold` |
| em | `<em>`, `<i>`, `font-style: italic` |
| code | `<code>` |
| strike | `<s>`, `<del>`, `text-decoration: line-through` |
| underline | `<u>`, `text-decoration: underline` |
| mark | `<mark>` |
| sub | `<sub>` |
| sup | `<sup>` |
| link | `<a href>` |

### Quality Breakdown

| Criterion | Score | Notes |
|-----------|-------|-------|
| User Impact | 85% | Enables external paste |
| Complexity | High | ~300 LOC, many edge cases |
| Risk | Medium | Paste is complex |
| Maintenance | Medium | Update when schema changes |

### Known Challenges

- [ ] Google Docs HTML uses custom spans with inline styles
- [ ] Word HTML is extremely verbose
- [ ] Must sanitize scripts/event handlers
- [ ] External image URLs may have CORS issues
- [ ] Ambiguous HTML (`<i>` = italic or icon?)

### Testing Matrix

| Source | Expected |
|--------|----------|
| Plain text | Paragraphs |
| Google Docs | Bold, italic, links, lists preserved |
| Microsoft Word | Same (with cleanup) |
| Web page | Structure preserved, scripts stripped |
| Internal WYSIWYG | Full fidelity |

---

## Other Identified Issues (Lower Priority)

### Keyboard Layout Dependency

```typescript
// wysiwygEditor.ts:64-72
const TILDE_DEAD_CODES = new Set([
    'IntlBackslash', 'Backquote', 'Quote', 'IntlRo',
    'KeyN', 'BracketRight', 'Digit4'
]);
```

Dead key handling only works for specific keyboard layouts. International users may have issues with `~` for strikethrough.

### Limited Table Editing

Table node exists but no GUI commands for:
- Adding/removing rows
- Adding/removing columns
- Cell merging
- Column resizing

### Diagram Fence UX

Editing Mermaid/PlantUML code blocks is awkward:
- No syntax highlighting in edit mode
- Toggle between preview/edit is clunky

### Memory Leak Risk

```typescript
const diagramPreviewTimers = new WeakMap<HTMLElement, number>();
```

`setTimeout` IDs may not be cleared on destroy in all code paths.

---

## Implementation Priority

| Order | Suggestion | Effort | Impact |
|-------|------------|--------|--------|
| 1 | Autocomplete | 1-2 days | Very High |
| 2 | Floating Toolbar | 0.5-1 day | High |
| 3 | HTML Paste | 2-3 days | Medium |

---

## File Locations

| Component | File |
|-----------|------|
| Main editor | `src/html/wysiwygEditor.ts` |
| Schema spec | `src/wysiwyg/spec.ts` |
| ProseMirror schema | `src/wysiwyg/prosemirrorSchema.ts` |
| Token parser | `src/wysiwyg/tokenParser.ts` |
| Serializer | `src/wysiwyg/serializer.ts` |
| MarkdownIt setup | `src/wysiwyg/markdownItFactory.ts` |
| Custom plugins | `src/wysiwyg/markdownItPlugins.ts` |
| CSS styles | `src/html/webview.css` (search `.wysiwyg`) |
| Integration | `src/html/taskEditor.js` (search `wysiwyg`) |

---

# Code Cleanup & Simplification Analysis

> Deep analysis of existing WYSIWYG code for cleanup opportunities
> Total lines analyzed: 3,642 across 11 files

---

## 1. CRITICAL: Duplicated Code Between Files

### 1.1 `inferMediaTypeFromSrc` + Extension Sets (EXACT DUPLICATE)

**Files:** `wysiwygEditor.ts:35-61` and `tokenParser.ts:14-15, 113-137`

```typescript
// DUPLICATED in both files - 100% identical
const videoExtensions = new Set(['avi', 'm4v', 'mkv', 'mov', 'mpg', 'mp4', 'ogv', 'webm', 'wmv']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'wav']);

function inferMediaTypeFromSrc(src: string): 'video' | 'audio' | null {
    // ... 24 lines of identical code
}
```

**Fix:** Create `src/wysiwyg/mediaUtils.ts`:
```typescript
export const videoExtensions = new Set([...]);
export const audioExtensions = new Set([...]);
export function inferMediaTypeFromSrc(src: string): 'video' | 'audio' | null { ... }
```

**Savings:** ~50 lines removed

---

### 1.2 Tag Flavor Logic (DUPLICATED 3x)

**Files:**
- `wysiwygEditor.ts:646-654` - `getTagFlavor()`
- `tokenParser.ts:204-216` - inline in `createTagNode()`
- `markdownItPlugins.ts:96-122` - inline in `parseTag()`

```typescript
// All three check the same patterns:
if (value.startsWith('gather_')) { flavor = 'gather'; }
if (/^(\+\+|\+|\u00f8|\u00d8|--|-)$/u.test(value)) { flavor = 'polarity'; }
```

**Fix:** Create shared function in `spec.ts` or new `tagUtils.ts`:
```typescript
export function getTagFlavor(value: string): 'tag' | 'gather' | 'polarity' {
    if (value.startsWith('gather_')) return 'gather';
    if (/^(\+\+|\+|\u00f8|\u00d8|--|-)$/u.test(value)) return 'polarity';
    return 'tag';
}
```

**Savings:** ~30 lines removed

---

## 2. Dead Code

### 2.1 `replaceInlineWithNode()` - NEVER CALLED

**File:** `wysiwygEditor.ts:666-676`

```typescript
// Defined but NEVER used anywhere
function replaceInlineWithNode(state: any, match: RegExpMatchArray, start: number, end: number, node: any): any {
    // 11 lines of dead code
}
```

Only `replaceInlineWithNodePreserveSpace()` (line 678) is actually used.

**Fix:** Delete the function

**Savings:** 11 lines

---

### 2.2 `serializerRules` - EXPORTED BUT NEVER IMPORTED

**File:** `spec.ts:231-253`

```typescript
export const serializerRules: SerializerRule[] = [
    { node: 'diagram_fence', strategy: 'fenced code block with lang + raw code' },
    // ... 22 entries of documentation that nobody reads
];
```

This is exported but never imported anywhere in the codebase. It appears to be design documentation masquerading as code.

**Fix:** Either:
1. Delete it (move to DESIGN.md if needed)
2. Actually use it in the serializer for validation

**Savings:** 23 lines (or make it useful)

---

### 2.3 `TokenMapping` and `SerializerRule` Types - PARTIALLY USED

**File:** `spec.ts:174-180, 224-229`

`TokenMapping` is used, but `SerializerRule` is only used by the dead `serializerRules` array.

---

## 3. Unnecessary Abstractions

### 3.1 `schemaBuilder.ts` - OVER-ENGINEERED

**File:** `src/wysiwyg/schemaBuilder.ts` (45 lines)

The entire file does minimal work:

```typescript
function cloneNodeSpec(name: string, spec: WysiwygNodeSpec): WysiwygNodeSpec {
    const cloned: WysiwygNodeSpec = { ...spec };
    // Only adds defaults for 'text' and 'doc' nodes
    return cloned;
}

function cloneMarkSpec(spec: WysiwygMarkSpec): WysiwygMarkSpec {
    return { ...spec };  // Just a shallow copy!
}
```

**Current call chain:**
```
buildProseMirrorSchema()
  → buildWysiwygSchemaSpec()  // Just shallow copies everything
    → cloneNodeSpec()         // Adds 2 defaults
    → cloneMarkSpec()         // Literally just { ...spec }
```

**Fix:** Inline into `prosemirrorSchema.ts`:
```typescript
export function buildProseMirrorSchema(source = wysiwygSchemaSpec): Schema {
    const nodes: Record<string, NodeSpec> = {};
    for (const [name, spec] of Object.entries(source.nodes)) {
        // Handle special cases inline
        const nodeSpec = { ...spec };
        if (name === 'text') { nodeSpec.inline = true; nodeSpec.group ??= 'inline'; }
        if (name === 'doc' && !spec.content) { nodeSpec.content = 'block+'; }
        nodes[name] = { /* build NodeSpec */ };
    }
    // ...
}
```

**Savings:** Delete entire `schemaBuilder.ts` (45 lines), simplify `prosemirrorSchema.ts`

---

### 3.2 `pipeline.ts` - TRIVIAL WRAPPER

**File:** `src/wysiwyg/pipeline.ts` (27 lines)

```typescript
export function markdownToWysiwygDoc(markdown: string, options = {}): WysiwygDoc {
    const md = options.markdownIt ?? createWysiwygMarkdownIt(options.markdownItOptions);
    return parseMarkdownToWysiwygDoc(markdown, md);
}

export function wysiwygDocToMarkdown(doc: WysiwygDoc, options = {}): string {
    return serializeWysiwygDoc(doc, options.serializerOptions);
}
```

These are one-liner wrappers that add no value.

**Fix:** Call underlying functions directly in `wysiwygEditor.ts`:
```typescript
// Instead of:
import { markdownToWysiwygDoc } from '../wysiwyg/pipeline';
const doc = markdownToWysiwygDoc(markdown, { markdownItOptions: {...} });

// Use directly:
import { parseMarkdownToWysiwygDoc } from '../wysiwyg/markdownItAdapter';
import { createWysiwygMarkdownIt } from '../wysiwyg/markdownItFactory';
const md = createWysiwygMarkdownIt({ temporalPrefix: this.temporalPrefix });
const doc = parseMarkdownToWysiwygDoc(markdown, md);
```

**Savings:** Delete `pipeline.ts` (27 lines), slight increase in `wysiwygEditor.ts`

---

## 4. Overly Complex Code

### 4.1 Tab/Shift-Tab Handlers - DUPLICATED LOGIC

**File:** `wysiwygEditor.ts:956-1049` (93 lines!)

Both handlers share 80% of their logic:

```typescript
Tab: (state, dispatch) => {
    // Empty selection case
    // Multi-line case: collect positions, indent each
}

'Shift-Tab': (state, dispatch) => {
    // Empty selection case (slightly different)
    // Multi-line case: collect positions, outdent each
}
```

**Fix:** Extract shared logic:
```typescript
function getTextblockPositions(state: EditorState): number[] {
    const positions: number[] = [];
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.isTextblock) {
            const start = pos + 1;
            if (!positions.includes(start)) positions.push(start);
        }
    });
    return positions.sort((a, b) => a - b);
}

function indentLines(state: EditorState, dispatch: Dispatch, indent: string): boolean {
    // Shared implementation
}

function outdentLines(state: EditorState, dispatch: Dispatch, indent: string): boolean {
    // Shared implementation
}
```

**Savings:** ~40 lines

---

### 4.2 `handleClickOn` - DEEPLY NESTED

**File:** `wysiwygEditor.ts:1136-1224` (88 lines)

This handler has 6 levels of nesting and handles too many cases:

```typescript
handleClickOn: (view, pos, node, nodePos, event) => {
    // Check image menu button (20 lines)
    // Check video menu button (17 lines)
    // Check media_inline click (10 lines)
    // Check multicolumn buttons (10 lines)
    // Check edit buttons (25 lines)
}
```

**Fix:** Extract into separate handler functions:
```typescript
const clickHandlers = {
    imageMenu: (view, target, event) => { ... },
    videoMenu: (view, target, event) => { ... },
    mediaInline: (view, node, nodePos, event) => { ... },
    multicolumn: (view, node, nodePos, target) => { ... },
    editButton: (view, node, nodePos, target) => { ... },
};

handleClickOn: (view, pos, node, nodePos, event) => {
    const target = event?.target as HTMLElement;
    if (!target) return false;

    for (const handler of Object.values(clickHandlers)) {
        const result = handler(view, node, nodePos, target, event);
        if (result) return true;
    }
    return false;
}
```

**Benefits:** Easier to test, maintain, and extend

---

## 5. Type Safety Issues

### 5.1 Excessive `any` Usage

**File:** `wysiwygEditor.ts`

```typescript
function replaceInlineWithNodePreserveSpace(state: any, match: RegExpMatchArray, ...): any
function createMediaView(node: any, isBlock: boolean): NodeView
function buildMarkdownInputRules(schema: any): InputRule[]
```

At least 15 functions use `any` where proper types exist.

**Fix:** Use proper ProseMirror types:
```typescript
import type { EditorState, Transaction } from 'prosemirror-state';
import type { Schema, Node as ProseMirrorNode } from 'prosemirror-model';

function replaceInlineWithNodePreserveSpace(
    state: EditorState,
    match: RegExpMatchArray,
    start: number,
    end: number,
    node: ProseMirrorNode
): Transaction | null
```

---

### 5.2 Unsafe Window Casts

**File:** `wysiwygEditor.ts:110, 544-546, 1148, 1164`

```typescript
const api = window as unknown as MediaPathHelpers;
const menuApi = window as unknown as { toggleImagePathMenu?: ... };
const modalApi = getModalApi();
```

Multiple different type casts for the same `window` object.

**Fix:** Create a single typed interface:
```typescript
// New file: src/html/wysiwygGlobals.ts
export interface WysiwygGlobalAPI {
    // Media path helpers
    buildWebviewResourceUrl?: (path: string, encode?: boolean) => string;
    isRelativeResourcePath?: (value: string) => boolean;
    // ...

    // Modal API
    showInputModal?: (...args: unknown[]) => void;

    // Menu API
    toggleImagePathMenu?: (container: HTMLElement, path: string) => void;
    toggleVideoPathMenu?: (container: HTMLElement, path: string) => void;
}

export function getWysiwygAPI(): WysiwygGlobalAPI {
    return window as unknown as WysiwygGlobalAPI;
}
```

---

## 6. File Organization Issues

### 6.1 Current Structure (11 files)

```
src/wysiwyg/
├── index.ts              (12 lines)   - Just re-exports
├── types.ts              (34 lines)   - Core types
├── spec.ts               (254 lines)  - Schema + mappings + dead rules
├── schemaBuilder.ts      (45 lines)   - Unnecessary abstraction
├── prosemirrorSchema.ts  (235 lines)  - Schema building
├── prosemirrorAdapter.ts (87 lines)   - Doc conversion
├── tokenParser.ts        (669 lines)  - MD tokens → WysiwygDoc
├── serializer.ts         (431 lines)  - WysiwygDoc → MD string
├── markdownItFactory.ts  (78 lines)   - MD-IT config
├── markdownItPlugins.ts  (462 lines)  - Custom plugins
├── markdownItAdapter.ts  (24 lines)   - Thin wrapper
└── pipeline.ts           (27 lines)   - Thin wrapper

src/html/
└── wysiwygEditor.ts      (1297 lines) - Editor + NodeViews + input rules
```

### 6.2 Proposed Simplified Structure

```
src/wysiwyg/
├── index.ts              - Re-exports (unchanged)
├── types.ts              - Core types (unchanged)
├── spec.ts               - Schema spec (remove dead serializerRules)
├── schema.ts             - Merge schemaBuilder + prosemirrorSchema
├── adapter.ts            - Merge prosemirrorAdapter + markdownItAdapter + pipeline
├── parser.ts             - Rename tokenParser.ts
├── serializer.ts         - Unchanged
├── markdownIt.ts         - Merge markdownItFactory + markdownItPlugins
└── utils.ts              - NEW: shared utilities (media type, tag flavor)

src/html/
└── wysiwygEditor.ts      - Editor (extract NodeViews to separate file?)
```

**Result:** 11 files → 9 files, clearer responsibilities

---

## Summary: Cleanup Opportunities

| Category | Issue | Lines Saved | Risk |
|----------|-------|-------------|------|
| Duplicate code | `inferMediaTypeFromSrc` | ~50 | Low |
| Duplicate code | Tag flavor logic | ~30 | Low |
| Dead code | `replaceInlineWithNode` | 11 | None |
| Dead code | `serializerRules` | 23 | None |
| Over-abstraction | `schemaBuilder.ts` | 45 | Low |
| Over-abstraction | `pipeline.ts` | 27 | Low |
| Complex code | Tab handlers | ~40 | Low |
| File merging | Various thin wrappers | ~50 | Low |

**Total potential savings: ~275 lines (7.5% of codebase)**

---

## Recommended Cleanup Order

1. **Phase 1: Dead code removal** (5 min, zero risk)
   - Delete `replaceInlineWithNode()`
   - Delete `serializerRules` (or move to docs)

2. **Phase 2: Extract shared utilities** (30 min, low risk)
   - Create `src/wysiwyg/utils.ts`
   - Move `inferMediaTypeFromSrc`, `videoExtensions`, `audioExtensions`
   - Move `getTagFlavor`
   - Update imports in `wysiwygEditor.ts` and `tokenParser.ts`

3. **Phase 3: Merge thin wrappers** (1 hour, low risk)
   - Merge `markdownItAdapter.ts` + `pipeline.ts` → update imports
   - Merge `schemaBuilder.ts` into `prosemirrorSchema.ts`

4. **Phase 4: Refactor complex handlers** (2 hours, medium risk)
   - Extract Tab/Shift-Tab shared logic
   - Extract `handleClickOn` sub-handlers

5. **Phase 5: Type safety** (ongoing)
   - Replace `any` with proper types
   - Create unified `WysiwygGlobalAPI` interface
