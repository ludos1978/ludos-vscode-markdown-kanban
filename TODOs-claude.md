# Code Cleanup Tasks

## Completed

### 1. Consolidate Panel State Models
- [x] Merged `PanelStateModel` and `DocumentStateModel` into single `PanelContext`
- [x] Updated all references in `KanbanWebviewPanel.ts`
- [x] Updated references in `KanbanFileService.ts`
- [x] Updated `IncludeFileCoordinator.ts`
- [x] Deleted old `PanelStateModel.ts` and `DocumentStateModel.ts` files
- **Impact:** Reduced 320 lines to ~200 lines, eliminated coordination bugs

### 2. Remove Custom PanelEventBus
- [x] Analyzed usage - no subscribers to any events (all `.emit().catch(() => {})`)
- [x] Removed `_eventBus` field from `KanbanWebviewPanel`
- [x] Updated `BoardStore` constructor - removed eventBus parameter
- [x] Updated `WebviewBridge` constructor - removed eventBus parameter
- [x] Removed all `.emit()` calls
- [x] Deleted `src/core/events/` directory entirely
- [x] Updated `src/core/index.ts` exports
- **Impact:** -400+ lines, simpler architecture

### 3. Simplify ChangeStateMachine
- [x] Extracted `_sendColumnUpdate` helper method
- [x] Extracted `_sendTaskUpdate` helper method
- [x] Extracted `_sendIncludeSwitchUpdate` helper method
- [x] Extracted `_performRollback` helper method
- [x] Refactored `_handleSyncingFrontend` from ~140 lines to ~40 lines
- [x] Refactored `_handleError` to use shared helpers
- **Impact:** -24 lines, much improved readability, DRY principles

### 4. Analyze Singleton Usage
- [x] Reviewed all `getInstance()` patterns
- [x] Singletons are appropriate: ConfigurationService (global config), PluginRegistry (global registry), ChangeStateMachine (with initialize()), coordinators
- **Decision:** Keep as-is - singletons are used correctly for truly global services

### 5. Analyze Include Processing
- [x] Analyzed `IncludeLoadingProcessor` and `IncludeFileCoordinator`
- [x] Found they serve different orchestrators (state machine vs panel)
- [x] Coordinator initiates via `stateMachine.processChange()`
- [x] Processor executes during LOADING_NEW state
- **Decision:** Keep separate - reasonable separation of concerns

### 6. Analyze MarkdownFile Base Class
- [x] Reviewed 865-line class structure
- [x] Well-organized with clear sections
- [x] Static utilities are minimal and tightly coupled
- **Decision:** Keep as-is - complexity justified by responsibilities

## Skipped (User Decision)

### ClipboardCommands Hash System
- User requested to keep the hash-based system

## Analyzed - Not Worth Changing

### Extract KanbanWebviewPanel Lifecycle
- [x] Analyzed `createOrShow` (~67 lines) and `revive` (~80 lines)
- [x] Static methods tightly coupled to private constructor
- [x] Would require exposing internal methods or creating factory pattern
- [x] Circular dependencies already exist in codebase (13 cycles found by madge)
- **Decision:** Keep as-is - extraction would add complexity without significant benefit

## Summary

**Lines Removed:** ~500+ lines
**Files Deleted:** 4 files (PanelStateModel.ts, DocumentStateModel.ts, PanelEventBus.ts, EventDefinitions.ts, loggingMiddleware.ts, events/index.ts)
**Files Modified:** KanbanWebviewPanel.ts, KanbanFileService.ts, IncludeFileCoordinator.ts, BoardStore.ts, WebviewBridge.ts, ChangeStateMachine.ts, panel/index.ts, core/index.ts
**Files Created:** PanelContext.ts

**Key Improvements:**
1. Single source of truth for panel state (PanelContext)
2. Removed dead event infrastructure
3. Cleaner message handling in state machine
4. Better helper method organization

## Additional Analysis (No Changes Needed)

### Final Codebase Check
- [x] TypeScript compiles without errors
- [x] No TODO/FIXME/HACK markers in code (except UI label "XXXL")
- [x] ts-prune false positives - exports used in JS files
- [x] Console.log statements appropriately gated by debug flags
- [x] Command files well-organized (Command Pattern)
- [x] Services properly structured
- [x] 13 circular dependencies exist (legacy, separate concern)

**Codebase Status:** Clean, well-structured, ~30k lines TypeScript
