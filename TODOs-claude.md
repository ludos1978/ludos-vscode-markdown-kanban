# Plan C: Comprehensive Cleanup - Deep Analysis

## Overview
This plan addresses 8 major architectural issues to create a cleaner, simpler codebase.
Estimated complexity: High | Risk: Medium-High | Benefit: Very High

---

## Phase 1: Foundation Cleanup (Low Risk)

### 1.1 Remove HandlerRegistry (PRIORITY: HIGH)
**Files affected:**
- `src/panel/HandlerRegistry.ts` (DELETE)
- `src/panel/index.ts` (remove export)
- `src/kanbanWebviewPanel.ts` (inline handlers)

**Problem:** HandlerRegistry is a thin wrapper (~160 lines) that just stores 7 nullable handler references with getters/setters. It adds complexity without meaningful benefit.

**Solution:** Inline handler fields directly into KanbanWebviewPanel.

**Changes:**
- [ ] Move handler fields to KanbanWebviewPanel as private fields
- [ ] Move dispose logic to KanbanWebviewPanel.dispose()
- [ ] Remove HandlerRegistry class and file
- [ ] Update panel/index.ts exports

---

### 1.2 Create PathUtils Module (PRIORITY: HIGH)
**Files affected:**
- `src/utils/pathUtils.ts` (CREATE)
- `src/files/MarkdownFile.ts` (use PathUtils)
- `src/files/MarkdownFileRegistry.ts` (use PathUtils)
- `src/files/IncludeFile.ts` (use PathUtils)

**Problem:** Path normalization logic is scattered across multiple files.

**Solution:** Create centralized `PathUtils` module.

**Changes:**
- [ ] Create `src/utils/pathUtils.ts` with all path functions
- [ ] Update MarkdownFile to use PathUtils
- [ ] Update MarkdownFileRegistry to use PathUtils
- [ ] Update IncludeFile to use PathUtils

---

### 1.3 Simplify PanelContext Flags (PRIORITY: MEDIUM)
**Files affected:**
- `src/panel/PanelContext.ts`

**Problem:** 9 boolean flags are hard to reason about.

**Solution:** Group related flags and use operation state enum.

**Changes:**
- [ ] Create `PanelLifecycle` enum: `INITIALIZING | READY | DISPOSED`
- [ ] Create `OperationState` enum: `IDLE | LOADING | SAVING | INCLUDE_SWITCH | UNDO_REDO`
- [ ] Replace boolean flags with enums where appropriate

---

## Phase 2: Callback Pattern Elimination (Medium Risk)

### 2.1 Simplify KanbanFileServiceCallbacks (PRIORITY: HIGH)
**Files affected:**
- `src/kanbanFileService.ts`
- `src/kanbanWebviewPanel.ts`

**Problem:** 9 callbacks create callback hell.

**Solution:** Pass minimal dependencies + panel reference.

**Changes:**
- [ ] Create simplified deps interface
- [ ] Replace callback pattern with direct panel access
- [ ] Update all usages

---

### 2.2 Simplify MessageHandler Callbacks (PRIORITY: HIGH)
**Files affected:**
- `src/messageHandler.ts`
- `src/kanbanWebviewPanel.ts`

**Problem:** 10 callbacks in constructor.

**Solution:** Same pattern - minimal deps + panel reference.

**Changes:**
- [ ] Create MessageHandlerDeps interface
- [ ] Replace callback pattern
- [ ] Update initialization

---

## Phase 3: Service Consolidation (Medium Risk)

### 3.1 Merge WebviewManager + WebviewUpdateService (PRIORITY: MEDIUM)
**Files affected:**
- `src/panel/WebviewManager.ts` (DELETE)
- `src/services/WebviewUpdateService.ts` (DELETE)
- `src/panel/WebviewService.ts` (CREATE - merged)

**Problem:** Both deal with webview, responsibilities overlap.

**Solution:** Merge into single `WebviewService`.

**Changes:**
- [ ] Create WebviewService combining both
- [ ] Delete original files
- [ ] Update imports

---

### 3.2 Consolidate Board Access (PRIORITY: MEDIUM)
**Files affected:**
- `src/kanbanWebviewPanel.ts`
- `src/files/MarkdownFileRegistry.ts`
- `src/core/stores/BoardStore.ts`

**Problem:** Multiple ways to get board.

**Solution:** BoardStore as single source of truth.

**Changes:**
- [ ] Make generateBoard() private
- [ ] Add BoardStore.regenerateFromRegistry()
- [ ] Update getBoard() to only use BoardStore

---

## Phase 4: Architecture Cleanup (Higher Risk - DEFER)

### 4.1 Commit to EventBus Pattern (DEFER)
**Reason:** Lower priority, can be done incrementally later.

### 4.2 Simplify ChangeStateMachine (DEFER)
**Reason:** High risk, complex. Better as separate focused PR.

---

## Execution Order

1. **Phase 1.1** - Remove HandlerRegistry (safest, biggest impact)
2. **Phase 1.2** - Create PathUtils (independent, easy)
3. **Phase 2.1** - Simplify KanbanFileServiceCallbacks
4. **Phase 2.2** - Simplify MessageHandler callbacks
5. **Phase 3.2** - Consolidate board access
6. **Phase 3.1** - Merge WebviewManager + WebviewUpdateService
7. **Phase 1.3** - Simplify PanelContext flags

---

## Current Status (Completed 2025-12-23)

- [x] Phase 1.1 - Remove HandlerRegistry (~160 lines removed)
- [x] Phase 1.2 - Create PathUtils Module (isSamePath added to stringUtils)
- [x] Phase 2.1 - Simplify KanbanFileServiceCallbacks (10 -> 6 callbacks)
- [x] Phase 2.2 - Simplify MessageHandler Callbacks (9 -> 6 callbacks)
- [x] Phase 3.1 - SKIPPED: WebviewManager/UpdateService have good separation of concerns
- [x] Phase 3.2 - SKIPPED: Current layered board access design is reasonable
- [x] Phase 1.3 - SKIPPED: Current PanelContext flags are flexible and appropriate

---

## Summary of Changes

### Completed Improvements:
1. **HandlerRegistry Removed**: Inlined 7 handler fields directly into KanbanWebviewPanel, removed ~160 lines of boilerplate wrapper code
2. **Path Utilities Centralized**: Added `isSamePath()` to stringUtils.ts, updated MarkdownFile to delegate to centralized functions
3. **KanbanFileService Simplified**: New `KanbanFileServiceDeps` interface with 6 direct dependencies instead of 10 callbacks
4. **MessageHandler Simplified**: New `MessageHandlerDeps` interface with 6 callbacks instead of 9

### Skipped (After Analysis):
- **WebviewManager/UpdateService Merge**: These have different responsibilities (setup vs runtime), good separation of concerns
- **Board Access Consolidation**: Current layered architecture (BoardStore cache + MarkdownFileRegistry generation) is appropriate
- **PanelContext Flag Enums**: Boolean flags provide flexibility for edge cases where operations might overlap

### Files Modified:
- `src/kanbanWebviewPanel.ts` - Inlined handlers, updated deps
- `src/panel/index.ts` - Removed HandlerRegistry export
- `src/panel/HandlerRegistry.ts` - DELETED
- `src/kanbanFileService.ts` - Simplified to KanbanFileServiceDeps
- `src/messageHandler.ts` - Simplified to MessageHandlerDeps
- `src/utils/stringUtils.ts` - Added isSamePath()
- `src/utils/index.ts` - Exported isSamePath
- `src/files/MarkdownFile.ts` - Delegates to stringUtils
