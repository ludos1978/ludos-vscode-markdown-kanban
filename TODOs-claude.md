# Open Cleanup Tasks

Last updated: 2025-12-22

---

## HIGH PRIORITY (Deferred - Needs Further Analysis)

### 1. Duplicate Board Operations (Two Systems)
**Status:** Analyzed - Partial migration possible, full migration complex
**Effort:** 4-8 hours | **Impact:** Medium - some duplication is intentional

**Analysis Results:**

Two systems exist with overlapping functionality:
- `src/board/BoardCrudOperations.ts` - Instance methods
- `src/actions/task.ts`, `src/actions/column.ts` - Action factories

**Methods that have direct Action equivalents (could migrate):**
| BoardCrudOperations | Action Equivalent |
|---------------------|-------------------|
| `moveTask()` | `TaskActions.move()` |
| `addTask()` | `TaskActions.add()` |
| `deleteTask()` | `TaskActions.remove()` |
| `duplicateTask()` | `TaskActions.duplicate()` |
| `insertTaskBefore/After()` | `TaskActions.insertBefore/After()` |
| `moveTaskToTop/Up/Down/Bottom()` | `TaskActions.moveToTop/Up/Down/Bottom()` |
| `moveColumn()` | `ColumnActions.move()` |
| `deleteColumn()` | `ColumnActions.remove()` |
| `insertColumnBefore/After()` | `ColumnActions.insertBefore/After()` |

**Specialized methods (NO Action equivalent - must keep):**
- `setOriginalTaskOrder()` - State tracking helper
- `moveColumnWithRowUpdate()` - Move with row tag update
- `reorderColumns()` - Reorder with row tag update
- `getColumnRow()` - Row tag extraction helper
- `cleanupRowTags()` - Row tag cleanup helper
- `performAutomaticSort()` - Automatic sorting

**Static helper methods (keep):**
- `findColumnById()`, `findTaskById()`, `findColumnContainingTask()`

**Recommendation:**
The migration is more complex than initially thought:
1. Specialized row-tag methods have no Action equivalent
2. Some instance methods are used by `performBoardAction()` which needs the callback pattern
3. Full migration would require:
   - Creating new Actions for row-tag operations
   - Updating all callers of `performBoardAction()` to use `executeAction()`
   - Ensuring undo/redo still works correctly

**Decision:** Defer until a larger refactoring sprint or when row-tag logic needs changes anyway.

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
