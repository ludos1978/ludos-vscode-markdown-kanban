# Open Cleanup Tasks

Last updated: 2025-12-23

---

## COMPLETED (2025-12-23)

### ✅ 1. Duplicate Board Operations - Unified to Actions

**Migration completed (Plan 2 - Moderate approach):**

**New Actions created:**
- `ColumnActions.moveWithRowUpdate(columnId, newPosition, newRow)` - Move column with row tag update
- `ColumnActions.reorderWithRowTags(newOrder, movedColumnId, targetRow)` - Reorder columns with row tags

**Actions removed (dead code cleanup):**
- `ColumnActions.sortTasks()` - Removed because 'unsorted' requires `_originalTaskOrder` state
- `ColumnActions.cleanupRowTags()` - Removed because it's called from kanbanFileService, not commands

**Helpers consolidated to `src/actions/helpers.ts`:**
- `getColumnRow(column)` - Extract row number from column title
- `cleanRowTag(title)` - Remove row tag from title
- `extractNumericTag(title)` - Extract numeric tag from task title
- `findTaskById(board, taskId)` - Find task by ID with column/index
- `findColumnContainingTask(board, taskId)` - Find column containing task

**Call sites updated:**
- `ColumnCommands.ts` - Now uses `executeAction()` with new Actions
- Removed import of `BoardCrudOperations`, uses `findColumn` from helpers

**BoardOperations facade slimmed down:**
- Removed all delegated CRUD methods (now handled by Actions)
- Kept only: `setOriginalTaskOrder()`, `cleanupRowTags()`, `sortColumn()`, `performAutomaticSort()`

**BoardCrudOperations updated:**
- Static helpers now delegate to `actions/helpers.ts`
- Task/Column instance methods marked `@deprecated` with guidance to use Actions
- Kept for: test compatibility, state management (`_originalTaskOrder`), and `sortColumn('unsorted')`

**Bug fix: 'Unsorted' sorting now works:**
- `ColumnCommands.handleSortColumn` now uses `boardOperations.sortColumn()` for all sort types
- This ensures 'unsorted' has access to `_originalTaskOrder` state
- Added `sortColumn()` back to BoardOperations facade

---

## REMAINING TECHNICAL DEBT (Lower Priority)

### P2: Add tests for new row-tag actions
- `moveWithRowUpdate`, `reorderWithRowTags` have no unit tests

### P3: Move `_originalTaskOrder` to BoardStore
- State currently lives in BoardCrudOperations
- Should be in BoardStore for proper state management

### P4: Remove static method indirection
- 15+ files still use `BoardCrudOperations.findColumnById()` etc.
- Should update to use `findColumn` from `actions/helpers.ts` directly

---

### ✅ 9. Excessive MediaTracker Logging
- Removed 20+ debug console.log statements from `src/services/MediaTracker.ts`
- Kept console.warn and console.error for actual issues

### ✅ 10. Unused `_webview` Parameter in LinkHandler
- Removed unused `_webview` parameter from constructor in `src/services/LinkHandler.ts`
- Updated call site in `src/kanbanWebviewPanel.ts`

### ✅ 11. UnsavedChangesService Informational Logs
- Removed 2 informational console.log statements from `src/services/UnsavedChangesService.ts`
- Kept console.error for actual errors

---

## COMPLETED (2025-12-22)

### ✅ 2. Duplicate `extractIncludeFiles` Method
- Moved to `src/constants/IncludeConstants.ts`
- Both `ColumnCommands.ts` and `TaskCommands.ts` now import from shared utility

### ✅ 3. Excessive Console Logging
- Removed debug logging from `src/core/events/FileSyncHandler.ts`
- Kept only error logging (`console.error`)

### ✅ 4. Unused `_stage` Parameter
- Removed from `_checkReloadCancelled()` in `src/files/MarkdownFile.ts`
- Updated call sites to remove string parameter

### ✅ 5. Duplicate `_createEmptyContext` Method
- Removed from `src/core/ChangeStateMachine.ts`
- Replaced calls with `_createInitialContext()`

### ✅ 6. Variable Shadowing
- Fixed in `src/commands/ColumnCommands.ts` - removed `currentBoard` redeclaration

### ✅ 7. Unused `SaveState.RECOVERING`
- Removed from `src/kanbanFileService.ts`

### ✅ 8. Commented-out Validation Code
- Removed from `src/files/MarkdownFile.ts`

---

## Post-Cleanup

- [x] Update `agent/FUNCTIONS.md` after cleanup (2025-12-22)
  - Added `extractIncludeFiles()` function documentation
  - Updated IncludeConstants.ts section with new function and usage
