---
kanban-plugin: board
---

## Column Include System - Major Refactoring

**Reference**: See [COLUMNIMPORT_ANALYSIS.md](COLUMNIMPORT_ANALYSIS.md) for detailed analysis of all issues.

**Goal**: Fix "not correct when changing columnimport multiple times" by unifying code paths, eliminating race conditions, and simplifying architecture.

---

## Phase 1: Foundation Fixes (Required First)

- [x] **FOUNDATION-1: Fix Path Normalization** #critical ✅ COMPLETE
  - ✅ Centralized normalization in MarkdownFile base class (getNormalizedRelativePath)
  - ✅ Updated MarkdownFileRegistry to use normalized keys for lookups
  - ✅ Removed all 20 scattered _normalizeIncludePath() calls across 5 files
  - ✅ Fixed markdownParser.ts line 375 (most critical: was normalizing too early)
  - ✅ Replaced 4 array.includes() with .some() + MarkdownFile.isSameFile()
  - ✅ Verified: TypeScript compilation successful, no errors
  - ✅ Verified: 0 remaining manual normalization calls
  - **Files modified**:
    - src/files/MarkdownFile.ts (added normalized path support)
    - src/files/MarkdownFileRegistry.ts (uses normalized keys)
    - src/markdownParser.ts (removed early normalization)
    - src/includeFileManager.ts (removed _normalizeIncludePath method)
    - src/messageHandler.ts (removed 5 normalizations, added import)
    - src/kanbanWebviewPanel.ts (removed 7 normalizations, fixed array.includes)
    - src/boardOperations.ts (removed early normalization)
  - **Analysis reference**: Issue #6

- [x] **FOUNDATION-2: Add Cancellation System** #critical ✅ COMPLETE
  - ✅ Implemented Strategy A (Simple Sequence Counter) with Pattern 2 (Helper Method)
  - ✅ Added `_currentReloadSequence` field to MarkdownFile base class
  - ✅ Added `_startNewReload()` helper method to start new sequence
  - ✅ Added `_checkReloadCancelled()` helper method to check cancellation
  - ✅ Protected `reload()` method with 2 cancellation points
  - ✅ Updated `dispose()` to cancel in-flight operations
  - ✅ Verified: TypeScript compilation successful, no errors
  - ✅ Automatically protects ColumnIncludeFile, TaskIncludeFile, MainKanbanFile (inheritance)
  - ✅ Rapid A→B→C switching will now show only C (earlier operations cancelled)
  - **Files modified**:
    - src/files/MarkdownFile.ts (added sequence counter system)
  - **Files auto-protected** (via inheritance):
    - src/files/ColumnIncludeFile.ts
    - src/files/TaskIncludeFile.ts
    - src/files/MainKanbanFile.ts
  - **Analysis reference**: Issue #8, Simplification #4
  - **See**: [tmp/FOUNDATION-2-completion-report.md](tmp/FOUNDATION-2-completion-report.md)

- [ ] **FOUNDATION-3: Test Foundation Fixes**
  - Test path normalization with various path formats
  - Test cancellation with rapid switching
  - Verify no duplicate file watchers created
  - Verify correct file loaded after rapid switches
  - Document test results in tmp/foundation-test-results.md

---

## Phase 2: Unify Column Include Switch (Core Fix)

- [ ] **SWITCH-1: Create Single Unified Function** #critical
  - Create new function: updateColumnIncludeFile(columnId, oldFiles, newFiles, newTitle)
  - Implement complete flow in ONE place:
    1. Save undo state
    2. Prompt for unsaved changes in old files
    3. Cleanup old files (stopWatching + unregister)
    4. Update board state (title + includeFiles)
    5. Register new file instances
    6. Load new content (with cancellation)
    7. Send updateColumnContent to frontend
    8. Send full boardUpdate
  - **Files to create**: New method in src/kanbanWebviewPanel.ts
  - **Analysis reference**: Issue #1, Simplification #1

- [ ] **SWITCH-2: Route editColumnTitle Through Unified Function**
  - Modify handleMessage case 'editColumnTitle'
  - Detect include syntax changes
  - Call updateColumnIncludeFile() instead of multiple separate calls
  - Remove calls to performBoardActionSilent, handleIncludeSwitch separately
  - Ensure _isEditingInProgress is set correctly
  - **Files to modify**: src/messageHandler.ts (lines 598-662)
  - **Analysis reference**: Issue #1, Issue #2

- [ ] **SWITCH-3: Remove handleSwitchColumnIncludeFile**
  - Delete handleSwitchColumnIncludeFile function (lines 2328-2446)
  - Delete 'switchColumnIncludeFile' message handler case
  - Verify no callers remain (should only be called from frontend, which we'll update)
  - **Files to modify**: src/messageHandler.ts
  - **Analysis reference**: Issue #1

- [ ] **SWITCH-4: Update Frontend to Use Unified Path**
  - Remove frontend code that sends 'switchColumnIncludeFile' message
  - Ensure column title edits go through 'editColumnTitle' message only
  - **Files to modify**: src/html/webview.js
  - **Analysis reference**: Issue #1

- [ ] **SWITCH-5: Test Unified Switch Path**
  - Test single switch A → B
  - Test rapid switch A → B → C
  - Test switch during edit
  - Test switch with unsaved changes
  - Test undo after switch
  - Verify no orphaned file watchers
  - Verify board state consistent
  - Document test results in tmp/switch-test-results.md

---

## Phase 3: Fix Board State Synchronization

- [ ] **STATE-1: Analyze Board State Usage**
  - Document all places that read this._board
  - Document all places that read this._cachedBoardFromWebview
  - Identify which operations need which state
  - Create state usage map in tmp/board-state-usage.md
  - **Analysis reference**: Issue #4, Issue #5

- [ ] **STATE-2: Eliminate Dual Board State** #major-refactor
  - Option A: Make registry the single source of truth (recommended)
    - Remove this._board and this._cachedBoardFromWebview
    - Create getBoard() that generates from registry on-demand
    - Update all callers to use getBoard()
  - Option B: Keep single cached board, sync from registry
    - Keep this._board only
    - Remove this._cachedBoardFromWebview
    - Regenerate this._board after include changes
  - Choose option and document decision in tmp/state-refactor-decision.md
  - **Files to modify**: src/kanbanWebviewPanel.ts, src/messageHandler.ts
  - **Analysis reference**: Simplification #2

- [ ] **STATE-3: Fix performBoardAction vs performBoardActionSilent** #critical
  - Analyze: When should full board update be sent?
  - Option A: Remove performBoardActionSilent, always send full updates
  - Option B: Rename to clarify intent, ensure correct usage
  - Option C: Merge into single function with parameter sendFullUpdate: boolean
  - Implement chosen option
  - Update all callers
  - **Files to modify**: src/messageHandler.ts (lines 1209-1242)
  - **Analysis reference**: Issue #5

- [ ] **STATE-4: Test Board State Consistency**
  - Test: Backend board matches frontend cachedBoard after operations
  - Test: Column IDs match between frontend and backend
  - Test: Task IDs preserved after include switches
  - Test: Undo/redo maintains consistent state
  - Document test results in tmp/state-test-results.md

---

## Phase 4: Fix Race Conditions and Timing

- [ ] **RACE-1: Fix editingInProgress Flag Timing** #critical
  - Move setEditingInProgress(false) to BEFORE async operations in editColumnTitle
  - Or: Add completion callback after async operations finish
  - Or: Use request-response pattern like stopEditing
  - Ensure flag is cleared when it's safe for board regeneration
  - **Files to modify**: src/messageHandler.ts (line 661), src/kanbanWebviewPanel.ts
  - **Analysis reference**: Issue #2

- [ ] **RACE-2: Fix Frontend Update Skipping During Edit** #critical
  - Implement queue for skipped updateColumnContent messages
  - Add handler for editingStopped that processes queued updates
  - Or: Delay include switches until editing completes
  - Ensure user sees correct content after editing
  - **Files to modify**: src/html/webview.js (lines 2653-2722)
  - **Analysis reference**: Issue #10

- [ ] **RACE-3: Add Coordination for File Registry Events**
  - Review _handleFileRegistryChange event filtering
  - Ensure 'content' and 'saved' events don't cause conflicts
  - Add sequence numbers or timestamps to events
  - Prevent old events from overriding new changes
  - **Files to modify**: src/kanbanWebviewPanel.ts (lines 1961-2101)
  - **Analysis reference**: Issue #7

- [ ] **RACE-4: Test Race Condition Fixes**
  - Test: Edit column title, rapid switch during edit
  - Test: External file change during edit
  - Test: Multiple columns switching simultaneously
  - Test: Switch immediately after save
  - Verify no stale updates
  - Verify UI always shows correct final state
  - Document test results in tmp/race-test-results.md

---

## Phase 5: Simplification and Cleanup

- [ ] **CLEANUP-1: Remove IncludeFileManager Wrapper** #simplification
  - Audit all usages of _includeFileManager
  - Replace with direct _fileRegistry calls
  - Delete IncludeFileManager class (src/includeFileManager.ts - 352 lines)
  - Update KanbanWebviewPanel constructor
  - Remove unused state: _recentlyReloadedFiles, _filesToRemoveAfterSave, _unsavedFilesToPrompt
  - **Files to delete**: src/includeFileManager.ts
  - **Files to modify**: src/kanbanWebviewPanel.ts
  - **Analysis reference**: Issue #9, Simplification #3

- [ ] **CLEANUP-2: Simplify _handleContentChange** #simplification
  - Remove bypass paths - enforce all changes go through it
  - Simplify logic now that paths are unified
  - Add clear documentation of flow
  - Ensure it's truly the single entry point
  - **Files to modify**: src/kanbanWebviewPanel.ts (lines 1599-1819)
  - **Analysis reference**: Issue #7, Simplification #1

- [ ] **CLEANUP-3: Remove Legacy Dead Code**
  - Remove empty methods from old include system
  - Remove commented-out code related to include switching
  - Remove unused message types
  - Clean up imports
  - **Files to audit**: All src/*.ts files

- [ ] **CLEANUP-4: Add Documentation**
  - Document the unified column include switch flow
  - Add sequence diagrams for include operations
  - Document state management architecture
  - Add comments to critical sections
  - Create developer guide: docs/column-include-architecture.md

---

## Phase 6: Comprehensive Testing

- [ ] **TEST-1: Create Automated Test Suite**
  - Write unit tests for CancellationToken
  - Write unit tests for path normalization
  - Write integration tests for column include switching
  - Add tests to CI/CD pipeline
  - **Files to create**: src/test/unit/CancellationToken.test.ts, src/test/integration/columnInclude.test.ts

- [ ] **TEST-2: Manual Test Scenarios**
  - [ ] Rapid switching: A → B → C → D (fast, under 1 second)
  - [ ] Switch during edit: Start editing title, change include, continue editing
  - [ ] Switch with unsaved changes: Modify tasks in A, switch to B, verify prompt
  - [ ] External file change: Switch to B, external editor modifies B, verify reload
  - [ ] Non-existent file: Switch to file.md that doesn't exist, verify error handling
  - [ ] Large file: Switch to file with 1000+ slides, verify loading indicator
  - [ ] Path variations: Test ./file.md, file.md, Folder/file.md, folder/FILE.md
  - [ ] Multiple columns: Switch includes in 3 columns at once
  - [ ] Undo after switch: Switch A → B, press undo, verify returns to A
  - [ ] Save after switch: Switch A → B, save kanban file, verify B content saved

- [ ] **TEST-3: Performance Testing**
  - Measure memory usage before/after multiple switches
  - Verify no memory leaks (file watchers cleaned up)
  - Test with 10 columns with includes
  - Test with 100 switches in rapid succession
  - Profile and optimize if needed

- [ ] **TEST-4: Regression Testing**
  - Verify task includes still work
  - Verify regular includes still work
  - Verify main file editing still works
  - Verify export still works
  - Verify all other kanban features unchanged

---

## Phase 7: Final Verification

- [ ] **VERIFY-1: Code Review**
  - Review all modified files
  - Check for potential edge cases
  - Verify error handling comprehensive
  - Check for any remaining dual-state issues
  - Peer review if possible

- [ ] **VERIFY-2: Documentation Update**
  - Update README if architecture changed
  - Update AGENT.md with new patterns
  - Update FUNCTIONS.md with modified functions
  - Document any breaking changes

- [ ] **VERIFY-3: Performance Verification**
  - Verify switching is fast (under 200ms)
  - Verify no UI freezing
  - Verify memory usage acceptable
  - Verify file watcher count stays constant

- [ ] **VERIFY-4: Final User Testing**
  - Test all 10 scenarios from TEST-2 again
  - Use kanban board for real work for 1 week
  - Monitor for any issues
  - Fix any discovered issues

- [ ] **VERIFY-5: Clean Up Temporary Files**
  - Remove tmp/foundation-test-results.md
  - Remove tmp/switch-test-results.md
  - Remove tmp/state-test-results.md
  - Remove tmp/race-test-results.md
  - Remove tmp/board-state-usage.md
  - Remove tmp/state-refactor-decision.md
  - Keep COLUMNIMPORT_ANALYSIS.md for reference

---

## Success Criteria

The column include system refactoring is complete when:

✅ **Reliability**: Changing columnimport multiple times always shows correct final state
✅ **No Race Conditions**: Rapid switching (A→B→C) always lands on C
✅ **No Memory Leaks**: File watcher count stays constant, no accumulating listeners
✅ **Consistent State**: Frontend and backend board state always match
✅ **Clean Code**: Single code path for switching, no duplicate logic
✅ **Performance**: Switching completes in under 200ms, no UI freezing
✅ **Maintainability**: Code is clear, documented, and easy to modify
✅ **Tests Pass**: All automated and manual tests pass consistently

---

## Notes

- Work through phases sequentially - don't skip ahead
- Each phase builds on previous phases
- Test thoroughly after each phase
- Document decisions and learnings in tmp/ folder
- If issues arise, analyze and update this plan
- Commit after each completed phase

**Estimated effort**: 3-5 days of focused work
**Priority**: High - affects core functionality
**Risk**: Medium - requires careful refactoring but well-analyzed

