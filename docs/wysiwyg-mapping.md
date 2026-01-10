# WYSIWYG Markdown Mapping Spec (Draft)

## Goal
Provide a true WYSIWYG editor while preserving 100% markdown-it feature parity and exact Markdown round-trip.

## Non-Negotiables
- Preserve existing markdown-it plugins and custom syntax.
- Preserve exact Markdown output (including custom delimiters).
- No loss of metadata for includes, tags, media, and diagrams.
- All features must be editable in the WYSIWYG surface.

## Proposed Editor Core
- ProseMirror (or TipTap as a wrapper) with a custom schema.
- Markdown <-> ProseMirror round-trip using:
  - A markdown-it token parser (tokens -> PM doc)
  - A serializer (PM doc -> Markdown)

## Feature Inventory (Current Renderer)
Source: src/html/markdownRenderer.js + browser plugins

Core:
- Paragraphs, headings, lists, blockquotes, code fences, inline code, hr, links, images

Plugins:
- Emoji
- Footnotes
- Mark (==mark==)
- Subscript (H~2~O)
- Superscript (29^th^)
- Insert (++inserted++)
- Strikethrough alt (--text--)
- Underline (_underline_)
- Abbreviation (*[HTML]: ...)
- Containers (::: note, comment, highlight, mark-* colors, center, right, caption, etc.)
- Includes (!!!include(path)!!!) inline + block
- Image figures (figure + figcaption from title)
- Media (audio/video with <source> handling)
- Wiki links ([[file|title]])
- Tags (#tag, #gather_*, #++/#--/#ø)
- Date/person tags (@2025-01-28, @W12, @name)
- Temporal tags (.2025.12.05, .w49, .mon, .15:30, .09:00-17:00)
- Speaker notes (;; lines)
- HTML comments + HTML blocks (configurable show/hide)
- Diagram fences (```plantuml, ```mermaid)
- Diagram/image special handling via image tokens (.drawio, .excalidraw, .pdf, file.pdf#12)
- Multicolumn blocks (---:, :--:, :---)

## Schema Mapping (Draft)

Block nodes:
- paragraph
- heading { level }
- blockquote
- bullet_list / ordered_list / list_item
- code_block { params }
- horizontal_rule
- table / table_row / table_cell { align }
- multicolumn { growths: number[] } with children multicolumn_column { growth }
- container { kind }
- include_block { path, includeType }
- speaker_note { raw }
- html_block { raw, mode }
- diagram_fence { lang, code }

Inline nodes:
- text
- include_inline { path, includeType }
- wiki_link { document, title }
- tag { value, flavor }
- date_tag { value, kind }
- person_tag { value }
- temporal_tag { value, kind }
- media_inline { src, mediaType, alt, title } (optional if needed)

Marks:
- em
- strong
- code
- strike { style } (~~ or --)
- underline
- mark
- sub
- sup
- ins
- link { href, title }
- abbr { title }

## Token -> Node/Mark Mapping (Draft)
This table ties current markdown-it token names to editor nodes/marks and the required attrs.

| Token(s) | Node/Mark | Notes |
| --- | --- | --- |
| paragraph_open/close | paragraph | Standard block |
| heading_open/close | heading { level } | level from token.tag |
| blockquote_open/close | blockquote | Standard block |
| bullet_list_open/close | bullet_list | Standard block |
| ordered_list_open/close | ordered_list | order/start attrs |
| list_item_open/close | list_item | Standard block |
| fence | diagram_fence or code_block | lang decides (plantuml/mermaid -> diagram_fence) |
| code_block | code_block | Standard block |
| hr | horizontal_rule | Standard block |
| table_* | table/table_row/table_cell | align from token.attrs |
| multicolumn_open/close | multicolumn | container block |
| multicolumn_block_open/close | multicolumn_column | growth from token.meta |
| container_* | container { kind } | kind from token.info |
| include_block | include_block | path from token.filePath |
| include_content | include_inline | path from token.attr data-include-file |
| include_placeholder | include_inline | keep path + missing flag |
| html_block | html_block | raw content |
| html_inline | html_inline | inline node or mark with raw html |
| html_comment | html_comment | inline node or mark |
| speaker_note | speaker_note | raw content |
| wiki_link_open/close + text | wiki_link | document from data-document, title from text |
| tag | tag | value from token.content |
| date_person_tag | date_tag/person_tag | type from token.meta.type |
| temporal_tag | temporal_tag | type from token.meta.type |
| em_open/close | em | Standard mark |
| strong_open/close | strong | Standard mark |
| s_open/close | strike | must track style (~~ vs --) |
| em_open/close | underline | when markup is `_` (markdown-it-underline reuses em tokens) |
| mark_open/mark_close | mark | markdown-it-mark |
| sub_open/sub_close | sub | markdown-it-sub |
| sup_open/sup_close | sup | markdown-it-sup |
| ins_open/ins_close | ins | markdown-it-ins |
| code_inline | code | inline code token |
| link_open/close | link | href/title attrs |
| image | image/media_inline | handles pdf/diagram special cases |
| audio/video | media_inline | children contain <source> tokens |
| footnote_* | footnote nodes | doc-level footnote store |
| abbr_open/abbr_close | abbr mark | title from token.attrs |

## Serializer Mapping (Draft)
High-level rules for converting editor nodes/marks back to Markdown.

- diagram_fence: serialize as ```lang\\ncode\\n```\n
- multicolumn: emit ---: <growth> blocks, :--: separators, :--- end marker.\n
- include_block: !!!include(path)!!! on its own line.\n
- include_inline: !!!include(path)!!! in text.\n
- html_block/html_inline/html_comment: preserve raw content.\n
- speaker_note: prefix each line with ;;.\n
- wiki_link: [[doc|title]] or [[doc]] if title equals doc.\n
- tag/date/person/temporal: serialize with #, @, . prefixes and original content.\n
- strike: preserve delimiter style (~~ or --).\n
- underline: serialize with _underline_ (not emphasis).\n
- mark/sub/sup/ins: use ==, ~, ^, ++.\n
- media_inline: emit original markdown-it-media syntax where available.\n
- image figures: keep title attribute as figcaption source.\n
- footnotes: preserve ids and order with doc-level definitions.\n

## Plugin Round-Trip Rules

- Emoji:
  - Parse emoji codes to text tokens with metadata.
  - Serialize as original :code: where possible.

- Footnotes:
  - Store doc-level footnote definitions; preserve reference ids.

- Mark / Sub / Sup / Ins / Underline:
  - Always serialize with their dedicated delimiters (==, ~, ^, ++, _underline_).
  - Avoid conflict with emphasis by explicit mark priority.

- Strikethrough:
  - Preserve --text-- when used (not just ~~).

- Abbr:
  - Store definitions as doc metadata; keep usage as plain text with abbr mark.

- Containers:
  - Serialize as ::: kind ... :::

- Includes:
  - Block form: !!!include(path)!!! on its own line
  - Inline form: same syntax inside text

- Image figures:
  - Map image title -> figcaption; preserve title attribute.

- Media (audio/video):
  - Keep original markdown-it-media syntax when serializing.

- Wiki links:
  - Serialize as [[doc|title]] or [[doc]]

- Tags / Dates / Temporal:
  - Serialize with exact prefix (#, @, .) and original content

- Speaker notes:
  - Serialize with ;; prefix per line

- HTML:
  - Preserve raw HTML; respect show/hide configuration without altering content.

- Diagrams:
  - Serialize as fenced code blocks with lang (plantuml/mermaid)

- Special image/diagram links:
  - Preserve original src, including pdf page anchors (#12)

- Multicolumn:
  - Serialize to ---: <growth>, :--:, :--- markers

## Gaps / Risks
- Abbr and Footnotes require doc-level metadata preservation.
- Underline vs emphasis conflicts require strict tokenizer precedence.
- HTML visibility is a rendering concern; must not alter source.
- Media plugin syntax must be retained for round-trip fidelity.

## Next Steps
1) Build markdown-it token to ProseMirror parser covering all token types.
2) Build Markdown serializer with exact delimiter control.
3) Implement NodeViews for includes, diagrams, media, and tags.
4) Add test fixtures for every plugin syntax to validate round-trip.
5) Draft spec artifacts in src/wysiwyg/spec.ts to anchor schema and mapping.
6) Add initial parser/serializer stubs in src/wysiwyg to validate mapping coverage.
