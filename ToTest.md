# ToTest

## Build & Release
- [ ] Run `./build.sh` and confirm it completes (production build + vsce package).
- [ ] Confirm the extension version shows 0.100.5 after the build.

## Docs & Reviews
- [ ] Review `TODOs-codex.md` (markdown-it feature list, design pattern + plan integration, final implementation steps).
- [ ] Review `FEATURES.md` for accuracy after the latest updates.
- [ ] Review docs/wysiwyg-mapping.md mapping tables + spec files for completeness.

## Board, Scroll & Save
- [ ] Scroll stability in multi-row/stacked boards during edit enter/exit (no jump, no forced reflow warnings, height lock holds, tall descriptions stable).
- [ ] Debug logs identify the moving element when scroll issues are reproduced.
- [ ] With debug enabled, verify PERF-DEBUG logs show stack layout timings >50ms (scope, columns) to help pinpoint reflow sources.
- [ ] Focus restore after re-render completes (no early focus steal).
- [ ] Cmd+S issues a single save; empty board saves without repeated errors.
- [ ] If main file context is missing, show the file context error overlay and block saving until file is reselected.
- [ ] Registry clear/unregister triggers the file context error overlay immediately.
- [ ] Returning to VS Code after being in the background refreshes file info (no stale filename).
- [ ] Debug overlay shows the same current filename as the file info bar after long background time.
- [ ] Debug overlay uses registry hashes as canonical baseline and compares to saved file only.
- [ ] Debug overlay shows a frontend snapshot vs registry indicator (non-canonical) in Verify Sync results.
- [ ] Main file frontend snapshot matches registry after initial load when only formatting/order differs.
- [ ] Sync details section shows the frontend snapshot hash line after running Verify Sync.
- [ ] Expanding sync details with no prior verification auto-runs Verify Sync.
- [ ] File states summary shows the frontend snapshot hash after Verify Sync.
- [ ] File states table shows per-file frontend hash (non-canonical) after Verify Sync.
- [ ] Verify Sync shows frontend hashes for column/task includes without using the markdown-it include cache.
- [ ] File states table shows icon-only frontend/saved status; hover reveals hashes.
- [ ] Main file frontend status reflects raw/normalized match in tooltip.
- [ ] Main file saved-file status reflects normalized hash when available (tooltip).
- [ ] File States Overview updates after backend boardUpdate without reopening.
- [ ] Editing a task/column triggers a File States hash refresh without manual Verify Sync.
- [ ] Verify Sync uses the latest cached board after Cmd/Ctrl+S (no stale currentBoard mismatch).
- [ ] File States Overview action buttons use text labels and all-file actions appear in table header row.
- [ ] File States Overview table shows separate columns for Save/Reload/Relative/Absolute/Image with aligned header actions.
- [ ] Verify Sync lives in the File States header row and action buttons align left with equal sizes.
- [ ] File States Overview columns have visible spacing between them without truncating filenames.
- [ ] File States Overview header labels show Cache/File and an "All Files" marker on the action row.
- [ ] File States Overview header shows Verify Sync + Updated timestamp next to the title.
- [ ] File States Overview no longer shows Total/Clean/Internal/External/Both stats line.
- [ ] File States Overview top stats show Cache/File sync counts with icons; reload images button appears in header row.
- [ ] Include files update frontend cache immediately after board edits (no stale include content on quick edit/save/edit).
- [ ] Cache/File sync summary shows in the All Files header row and fits without wrapping.
- [ ] Cmd/Ctrl+S saves include-backed files updated via board edits (no stale include content after save).
- [ ] Cmd/Ctrl+S and individual file saves both persist include changes using the unified save pipeline.
- [ ] Individual include save works after a recent Cmd/Ctrl+S (no skipped save due to in-flight lock).
- [ ] Verify Sync (debug enabled) logs first-diff snippets for main file raw/normalized/front-end mismatches.
- [ ] Verify Sync logs include line numbers + trailing blank-line counts for main file diffs.
- [ ] Save/load is idempotent for trailing blank lines in descriptions (indented and unindented cases).
- [ ] Blank separator lines between tasks/columns do not get folded into task descriptions after reload.
- [ ] File States Overview updates frontend/non-raw hashes live while editing (no manual Verify Sync needed).
- [ ] Missing include rows in File States are highlighted with warning background.
- [ ] Task title/description clicks still enter edit mode.

## Menus & UI
- [ ] Debug toggle works; task menu actions still execute.
- [ ] Burger menu min width and submenu positioning stay on-screen with no clipped arrows.
- [ ] Search panel and export options toggle visibility correctly.
- [ ] Tag menus list active tags correctly (including custom groups and overrides).
- [ ] Font size and Marp settings toggles persist without `setPreference` errors.
- [ ] Show special characters toggle only affects the active editor and preserves caret alignment.
- [ ] With show-special-characters disabled, typing does not trigger special-char overlay rendering (no forced reflow spikes).

## Drag & Drop
- [ ] Drag cancel + cleanup (Esc snaps back, indicators clear, no stuck states). Note: re-enter drop indicators should recover (currently failing).
- [ ] Internal vs external drag indicators remain isolated (no external indicators during internal drag).
- [ ] Drop sources (clipboard/empty/diagram/tasks/columns/templates) create items and clean up highlights.
- [ ] Multi-file external drops show the dialog per file and create one task per file.
- [ ] File drop dialog shows filename + media folder and offers “apply to all remaining files” when multiple are queued.
- [ ] Apply-all repeats when available; if action is unavailable for a file, the dialog prompts for an alternative.
- [ ] Multi-file drops preserve the intended file order (first selected is handled first).
- [ ] Debug mode logs incoming file/URI drop order and metadata to the console.
- [ ] Sticky column titles render above column content in stacked columns.
- [ ] Column stack headers stay above lower column content with translateZ layering.
- [ ] File search modal logs a warning instead of throwing if the overlay is missing.
- [ ] Column drag drop zones appear before/between/after and accept drops.
- [ ] Column move/insert updates #row/#stack tags correctly.
- [ ] Column headers render via markdown-it (no raw markdown).
- [ ] Diagram filename prompt is centered, wide enough, validates input.

## File Search & Path Replacement
- [ ] File search modal opens/closes cleanly and handles special characters safely.
- [ ] Broken file menus update paths in all editors (inline markdown, inline WYSIWYG, overlay preview/markdown/WYSIWYG).
- [ ] Include paths with URL-encoded spaces resolve on disk (no false “broken include” badges).
- [ ] Column/task includes with ./ or absolute paths register as COLINC/TASKINC and show cache hashes after load (no false missing warnings in Verify Sync).
- [ ] Search-for-file replaces image/link paths that include a quoted title or bracketed destination (e.g. `![alt](path "title")`, `![alt](<path>)`).
- [ ] Search-for-file works while an inline/overlay editor is open (edits are captured before replacement).
- [ ] Path replacement only updates actual link/include targets (no substring replacements).
- [ ] Empty image/link targets (e.g. `![]()` / `[]()`) are replaced correctly in inline, overlay, and dual preview editors.
- [ ] Overlay dual preview: search-for-file replaces the markdown draft + preview.
- [ ] Burger menu Open + Alt+click open in VS Code first, fallback to system editor when needed.
- [ ] External file drops onto include-backed tasks (including with overlay open) copy into the include file’s media folder and link correctly.

## File Import & Media Index
- [ ] File import dialog shows consistent options and updates the hash DB after copy.
- [ ] Hash lookups skip deleted files (stale hash entries removed when detected).
- [ ] MediaIndex scan scopes work: `mediaFolders`, `contentFolders`, `allWorkspaces`.

## WYSIWYG Core
- [ ] Editor renders, saves back to markdown, and respects arrow/Enter/Tab behaviors.
- [ ] Selection wrapping (* _ ~ [ ( {) works; dead-key tilde behaves correctly.
- [ ] Marks are not sticky after applying (typing continues unstyled).
- [ ] Display vs WYSIWYG spacing/line-height/paragraph margins match, including small-card-fonts.
- [ ] Task list checkboxes render/toggle in WYSIWYG and save back to markdown (raw [ ] stays only in markdown mode).

## WYSIWYG Nodes & Media
- [ ] Images/videos/audio/PDF/diagram previews render with path menus and resolve relative/include paths.
- [ ] Shift+Cmd/Ctrl+V image paste in include-backed tasks saves into the include media folder and renders.
- [ ] Inline vs block media behaves correctly; typing before/after images keeps them rendered.
- [ ] Diagram fences show preview + editable code block; debounce works; Edit toggles correctly.
- [ ] Draw.io/Excalidraw previews render and update without stuck placeholders.
- [ ] Multicolumn blocks render correctly with +/- overlays, image sizing matches display mode.
- [ ] Tags/person/date/temporal chips convert on typing and stay stable after edits.
- [ ] Include/wiki/link nodes render and can be edited in-place.

## Overlay Editor
- [ ] Entry opens without errors; mode toggles (Markdown/Dual/WYSIWYG) preserve exact draft.
- [ ] Save/close behavior works via Save, Escape, Alt+Enter, backdrop click (no data loss).
- [ ] Layout constraints: 80% size, 10px pane gap, tools bar full width.
- [ ] Task title is editable in the overlay header and saves with the task.
- [ ] Overlay title input spans ~50% of the header width without crowding actions.
- [ ] Overlay WYSIWYG: file drops insert links; large images stay within 80% height; clicking below last line moves caret to end; text before/after start/end images works.
- [ ] Overlay dual preview: task list checkboxes toggle and update the markdown draft.
- [ ] Overlay settings menu updates font scale and preferences persist; overlay enable + default mode stick across reloads.

## Keybindings & Undo
- [ ] VS Code keybindings/snippets work in inline/overlay/WYSIWYG (Meta+1, snippet name/content, capture phase).
- [ ] Undo/redo works via commands and native stack; cursor restores after snippet insertions.
- [ ] With debug enabled, Meta+Shift+V logs resolved task/column IDs for inline image paste.
