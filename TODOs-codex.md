# TODOs (Codex)

## Markdown-it features to support in overlay editor

### Core markdown-it + settings
- `markdown-it` core with `html: true`, `breaks: true`, `typographer: true`, `linkify: false`.
- HTML comment/content render modes (`htmlCommentPlugin`) honoring `markdown-kanban.htmlCommentRenderMode` and `markdown-kanban.htmlContentRenderMode`.

### Built-in + bundled plugins (webview)
- Wiki links (`[[file|title]]`) via `wikiLinksPlugin`.
- Tag rendering and colors via `tagPlugin`.
- Date/person tags via `datePersonTagPlugin` (`@person`, `@YYYY-MM-DD`).
- Temporal tags via `temporalTagPlugin` (prefix `.` and `!` temporal prefix from config).
- Enhanced strikethrough via `enhancedStrikethroughPlugin` (delete button behavior).
- Speaker notes via `speakerNotePlugin` (`;;` syntax).
- Emoji via `markdown-it-emoji` (if available in webview).
- Footnotes via `markdown-it-footnote` (if available in webview).
- Multicolumn blocks via `markdown-it-multicolumn` (supports `---: :--: :---` rows).
- Mark via `markdown-it-mark` (`==mark==`).
- Subscript via `markdown-it-sub` (`H~2~O`).
- Superscript via `markdown-it-sup` (`29^th^`).
- Inserted text via `markdown-it-ins` (`++inserted++`).
- Alternate strikethrough via `markdown-it-strikethrough-alt` (`--strike--`).
- Underline via `markdown-it-underline` (`_underline_`).
- Abbreviations via `markdown-it-abbr` (`*[HTML]: ...`).
- Containers via `markdown-it-container` for: `note`, `comment`, `highlight`, `mark-red`, `mark-green`, `mark-blue`, `mark-cyan`, `mark-magenta`, `mark-yellow`, `center`, `center100`, `right`, `caption`.
- Includes via `markdown-it-include` (`!!!include()`).
- Image figures via `markdown-it-image-figures` (figure + figcaption from `title`).
- Media via `markdown-it-media-custom` (image/audio/video tags).

### Diagram + media rendering handled by markdown renderer
- Mermaid fences (` ```mermaid `) + PlantUML fences (` ```plantuml `) with async rendering.
- Diagram images: draw.io (`.drawio`/`.dio`) and Excalidraw (`.excalidraw(.json/.svg)`).
- PDF embeds and slideshows (placeholder + async render).

## TODO: Overlay editor feature parity

- [ ] Ensure overlay preview uses the same markdown-it pipeline and plugins as `markdownRenderer.js`.
- [ ] Ensure overlay WYSIWYG mode covers the same plugin set (see `src/wysiwyg/markdownItFactory.ts` + custom tokens).
- [ ] Add WYSIWYG toolbar controls for multicolumn (`---: :--: :---`) and other plugin-driven syntax (mark, sub/sup, underline, insert, alt-strike, containers, footnotes, emoji, wiki links, include).
- [ ] Validate diagram/media handling in overlay preview (mermaid, plantuml, draw.io, excalidraw, PDF).

## TODO elements (definition)
- A TODO entry must include: scope, entry criteria, exit criteria, and integration point (file/module).
- A TODO entry must state the affected editor surface: markdown preview, WYSIWYG, or both.
- A TODO entry must state whether it changes settings storage (global config only).
- A TODO entry must state whether it requires drag/drop handling or toolbar command updates.

## Design pattern description
- Overlay editor module with a single state model (`mode`, `draft`, `fontScale`, `taskRef`) and a centralized controller that owns lifecycle (open, close, save, mode switch).
- Adapter layer for editor backends: `MarkdownAdapter` (textarea + preview) and `WysiwygAdapter` (ProseMirror) with a shared command API for toolbar actions.
- Command registry for toolbar actions so the same button works in all modes (commands map to adapters).
- Drag/drop implemented as a strategy: `DropHandler` translates drops into markdown/link insertions, then delegates to the active adapter.
- Global settings persisted through the config manager; avoid per-board state.

## Plan integration (where it lands)
- Step 1 (Inventory): map markdown-it plugins + WYSIWYG tokens into adapter capabilities list.
- Step 2 (Design): define the overlay editor state model, adapters, and command registry.
- Step 3 (Implement UI): wire toolbar commands to the adapter registry, add mode switching and persistence.
- Step 4 (Drag/drop): implement drop strategy and route to adapters; verify insertion in markdown + wysiwyg.
