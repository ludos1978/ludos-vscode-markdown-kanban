# Open Cleanup Tasks

Last updated: 2025-12-23

---

## COMPLETED (2025-12-23) - Part 2

### ✅ P2: Tests for row-tag actions
- Created `src/test/unit/ColumnActions.test.ts` with tests for:
  - `moveWithRowUpdate` - 5 test cases
  - `reorderWithRowTags` - 5 test cases
- Fixed missing `KanbanBoard` properties in test files (`valid`, `yamlHeader`, `kanbanFooter`)

### ✅ P3: Move `_originalTaskOrder` to BoardStore
- Added state to `BoardStore`:
  - `originalTaskOrder: Map<string, string[]>` in BoardState
  - `setOriginalTaskOrder(board)` - captures original order
  - `getOriginalTaskOrder(columnId)` - retrieves order for a column
  - `initColumnTaskOrder(columnId)` - for new columns
  - `deleteColumnTaskOrder(columnId)` - for deleted columns
- Added `setOriginalTaskOrder` callback to `KanbanFileServiceCallbacks`
- Wired callback in `kanbanWebviewPanel.ts`
- Updated `kanbanFileService.ts` to use callback
- Updated `BoardCrudOperations.sortColumn()` to accept optional `originalOrder` parameter
- Updated `BoardOperations.sortColumn()` to pass through `originalOrder`
- Updated `ColumnCommands.handleSortColumn()` to get order from `context.boardStore`
- Removed `setOriginalTaskOrder` from `BoardOperations` facade
- Added tracking update in `ActionExecutor.execute()` for `column:add` actions

### ✅ P4: Remove static method indirection
- Updated 6 files to use helpers directly from `actions/helpers.ts`:
  - `IncludeLoadingProcessor.ts`
  - `LinkReplacementHandler.ts`
  - `IncludeFileCoordinator.ts`
  - `MainKanbanFile.ts`
  - `TaskCommands.ts`
  - `WebviewUpdateService.ts`
- Added new helper `findTaskInColumn` to `actions/helpers.ts`
- Static methods in `BoardCrudOperations` still delegate to helpers (for test compatibility)

---

## COMPLETED (2025-12-23) - Part 1

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
- `findTaskInColumn(board, columnId, taskId)` - Find task in specific column

**Call sites updated:**
- `ColumnCommands.ts` - Now uses `executeAction()` with new Actions
- Removed import of `BoardCrudOperations`, uses helpers directly

**BoardOperations facade slimmed down:**
- Removed `setOriginalTaskOrder()` (now in BoardStore)
- Kept only: `cleanupRowTags()`, `sortColumn()`, `performAutomaticSort()`

**BoardCrudOperations updated:**
- Static helpers delegate to `actions/helpers.ts`
- Task/Column instance methods marked `@deprecated`
- Internal `_originalTaskOrder` kept for test compatibility
- `sortColumn()` accepts optional `originalOrder` parameter

**Bug fix: 'Unsorted' sorting works correctly:**
- Production code gets order from `BoardStore.getOriginalTaskOrder()`
- Tests use internal `_originalTaskOrder` in BoardCrudOperations
- `ActionExecutor` initializes tracking for new columns

---

## REMAINING TECHNICAL DEBT (Very Low Priority)

### Optional: Slim down BoardCrudOperations further
- Could remove deprecated methods and update tests to use Actions directly
- Current approach works fine - deprecated methods are self-documenting
- Tests serve as integration tests for the legacy CRUD operations

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
