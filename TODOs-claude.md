# Cleanup Tasks - Round 2

## Completed

### Frontend JavaScript
- [x] Remove duplicate `toggleFileBarMenu` and `positionFileBarDropdown` from menuOperations.js (dead code - webview.js loads after)
- [x] Improved `positionFileBarDropdown` in webview.js to use dynamic measurement (was using hardcoded dimensions)
- [x] Consolidated task movement functions (4x: moveTaskToTop/Up/Down/Bottom) into single `moveTaskInDirection()` with wrapper functions

### Commands (TypeScript)
- [x] Extracted `_extractBase64Data()` helper in ClipboardCommands.ts (replaced 3 duplicates)
- [x] Consolidated path replacement logic in PathCommands.ts into `_replacePathInFiles()` helper (~80 lines saved)

### Backend (TypeScript) - Round 1
- [x] Removed unused `deepCloneBoard` from BoardStore.ts
- [x] Removed unused `_emitEvent` parameter from BoardStore.setBoard()

## Skipped (with rationale)

### Include mode column/task operations
- Skipped: Functions already use shared utilities (`window.menuUtils`), differences are meaningful (column vs task types, different message types). Consolidating would add type-checking complexity without benefit.

### Move createDiagramFile to DiagramCommands
- Skipped: Function shares helper methods (`_getCurrentFilePaths`, `_getMediaFolderPath`) with other ClipboardCommands. Moving would require duplicating helpers or extracting to shared module.

### Remove scrollToElementIfNeeded
- Skipped: Analysis was incorrect - function IS used in multiple places (menuOperations.js, dragDrop.js)

### Merge filename generation methods
- Skipped: Methods use fundamentally different algorithms (hash-based vs counter-based). Merging would make code less clear.

### Clean up folding state functions in boardRenderer.js
- Deferred: Would require deeper analysis to understand relationships between functions

### Clean up diagnostic logging in dragDrop.js
- Deferred: Low priority, would need verification of which logs are still needed
