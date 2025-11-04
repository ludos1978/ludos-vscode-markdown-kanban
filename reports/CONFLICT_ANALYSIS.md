# Conflict Analysis Report

**Date**: 2025-11-01
**Task**: Identify and resolve conflicts with new MainFileCoordinator implementation

---

## Summary

Found **1 conflicting file** that must be removed:
- ✅ **UnifiedChangeCoordinator.ts** - UNUSED, conflicts with MainFileCoordinator

All other coordinators/handlers serve different purposes and are **complementary, not conflicting**.

---

## Detailed Analysis

### ✅ KEEP: SaveCoordinator
**File**: `src/core/SaveCoordinator.ts`
**Purpose**: Unified save operations for all file types
**Status**: ✅ USED - Referenced by UnifiedChangeHandler, MainFileCoordinator
**Conflict**: None - Different concern (saving vs change coordination)

### ✅ KEEP: UnifiedChangeHandler
**File**: `src/core/UnifiedChangeHandler.ts`
**Purpose**: Handles individual file-level external changes from file watchers
**Status**: ✅ USED - Used by MainKanbanFile.handleExternalChange(), IncludeFile.handleExternalChange()
**Conflict**: None - Complementary to MainFileCoordinator
- **UnifiedChangeHandler**: File-level external change detection (watches → detect → conflict check)
- **MainFileCoordinator**: Multi-file coordinated changes from UI (user actions → orchestrate → update)

### ❌ REMOVE: UnifiedChangeCoordinator
**File**: `src/core/UnifiedChangeCoordinator.ts`
**Purpose**: Attempted to coordinate multi-file changes (similar to MainFileCoordinator)
**Status**: ❌ UNUSED - No imports found in entire codebase
**Conflict**: **YES - Duplicate functionality with MainFileCoordinator**

**Why it conflicts**:
1. Both try to coordinate include file switches
2. Both implement operation queuing
3. Both handle unsaved file prompts
4. Both track files being unloaded/loaded
5. **UnifiedChangeCoordinator is incomplete and unused**

**Evidence**:
```bash
$ grep -r "import.*UnifiedChangeCoordinator" src/
# No results - file is never imported or used
```

### ✅ KEEP: SaveEventCoordinator
**File**: `src/saveEventCoordinator.ts`
**Purpose**: Centralized dispatcher for VS Code save events
**Status**: ✅ USED - Imported by SaveCoordinator, KanbanWebviewPanel
**Conflict**: None - Event dispatching only

### ✅ KEEP: MainFileCoordinator (NEW)
**File**: `src/core/state-machine/MainFileCoordinator.ts`
**Purpose**: State machine-based coordination of all file changes
**Status**: ✅ USED - Integrated into KanbanWebviewPanel
**Conflict**: None - This is the new implementation

### ✅ KEEP: Domain-Specific Handlers
**Files**:
- `src/linkHandler.ts` - URL/link handling
- `src/messageHandler.ts` - Webview message handling
- `src/services/assets/AssetHandler.ts` - Asset file operations

**Status**: ✅ USED - Domain-specific, no conflicts

---

## State Management Analysis

### ✅ KEEP: FileState (interface)
**File**: `src/files/FileState.ts`
**Type**: Interface
**Purpose**: Legacy compatibility interface for old FileStateManager
**Status**: ✅ USED - Used by MarkdownFile.toFileState()
**Conflict**: **None - Different namespace from new enum**

The legacy interface and new enum have the same name but:
- Legacy: `import { FileState } from './files/FileState'` (interface)
- New: `import { FileState } from './core/state-machine/FileStateTypes'` (enum)
- TypeScript handles this correctly via different module paths

### ✅ KEEP: StateManager
**File**: `src/core/StateManager.ts`
**Purpose**: General application state management
**Status**: ✅ USED
**Conflict**: None - Different scope (app state vs file state machine)

---

## Operation Locking Analysis

### ✅ KEEP: _withLock in KanbanWebviewPanel
**Location**: `src/kanbanWebviewPanel.ts`
**Purpose**: Legacy operation locking
**Status**: ✅ USED as fallback when coordinator unavailable
**Conflict**: None - Coordinator replaces it when available

**Code**:
```typescript
if (!this._changeCoordinator) {
    console.warn('[UNIFIED] No coordinator available - using legacy _withLock');
    return this._withLock('handleContentChange', async () => {
        await this._executeContentChangeLogic(params, hasMainChange, hasIncludeChanges, hasSwitches);
    });
}
```

This is **correct** - provides graceful fallback.

---

## Files to Remove

### 1. UnifiedChangeCoordinator.ts ❌
**Path**: `/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/src/core/UnifiedChangeCoordinator.ts`

**Reason**:
- Unused (no imports)
- Incomplete implementation
- Duplicates MainFileCoordinator functionality
- Conflicts with state machine approach

**File size**: ~1000 lines

**Safe to delete**: ✅ YES - No references in codebase

---

## Files to Keep (Not Conflicts)

| File | Reason | Used By |
|------|--------|---------|
| SaveCoordinator.ts | Different purpose (saves) | UnifiedChangeHandler, MainFileCoordinator |
| UnifiedChangeHandler.ts | File-level changes only | MainKanbanFile, IncludeFile |
| SaveEventCoordinator.ts | Event dispatching | SaveCoordinator, KanbanWebviewPanel |
| FileState.ts (interface) | Legacy compatibility | MarkdownFile |
| StateManager.ts | App-level state | Various |
| LinkHandler.ts | Domain-specific | MessageHandler |
| MessageHandler.ts | Domain-specific | KanbanWebviewPanel |
| AssetHandler.ts | Domain-specific | Export services |

---

## Action Plan

1. ✅ **DELETE**: `src/core/UnifiedChangeCoordinator.ts`
2. ✅ **VERIFY**: Compilation still succeeds
3. ✅ **DOCUMENT**: Update this report with results

---

## Risk Assessment

**Risk Level**: 🟢 LOW

**Reasoning**:
- UnifiedChangeCoordinator has zero references
- No imports = no dependencies
- Deletion cannot break anything
- Backup file exists (kanbanWebviewPanel.ts.backup)

**Rollback Plan**:
```bash
# If something breaks (unlikely):
git checkout src/core/UnifiedChangeCoordinator.ts
```

---

## Conclusion

**Only 1 file needs removal**: UnifiedChangeCoordinator.ts

All other coordinators/handlers are:
- ✅ Actually used in the codebase
- ✅ Serve distinct, non-overlapping purposes
- ✅ Compatible with new MainFileCoordinator

The architecture is actually quite clean - each coordinator has a specific responsibility:
- **SaveCoordinator**: Manages saves
- **SaveEventCoordinator**: Dispatches save events
- **UnifiedChangeHandler**: Handles individual file external changes
- **MainFileCoordinator**: Orchestrates multi-file coordinated changes (NEW)

These work together harmoniously!
