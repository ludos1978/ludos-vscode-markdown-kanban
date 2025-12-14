# Cleanup TODOs - Code Simplification

## Priority Order (Quick Wins First)

### 1. [x] Remove unnecessary `_sendToWebview` wrapper in ClipboardCommands
- File: `src/commands/ClipboardCommands.ts`
- Issue: `_sendToWebview` is a trivial wrapper that just calls `this.postMessage()`
- Action: Replace all `_sendToWebview` calls with direct `this.postMessage()` calls
- Risk: None
- **COMPLETED**: Removed method and replaced 15 call sites

### 2. [x] Extract common SVG conversion logic in DiagramCommands
- File: `src/commands/DiagramCommands.ts`
- Issue: `handleConvertPlantUMLToSVG` and `handleConvertMermaidToSVG` are 95% identical
- Action: Create unified `convertDiagramToSVG` method
- Risk: Low
- **COMPLETED**: Created unified method, reduced ~50 lines of duplication

### 3. [x] Use `_getCurrentFilePaths` consistently in ClipboardCommands
- File: `src/commands/ClipboardCommands.ts`
- Issue: Path construction logic duplicated in multiple methods instead of using existing helper
- Action: Refactor `handleSaveClipboardImageWithPath` and `handlePasteImageIntoField` to use `_getCurrentFilePaths()`
- Risk: Low
- **COMPLETED**: Refactored both methods to use the helper + `_getMediaFolderPath()`

### 4. [x] Extend CommandContext interface to eliminate `(panel as any)` patterns
- File: `src/commands/interfaces/MessageCommand.ts`
- Issue: 32+ occurrences of `(panel as any)` bypassing TypeScript type safety
- Action: Add proper typed methods to CommandContext interface
- Affected files: TaskCommands.ts, ColumnCommands.ts, EditModeCommands.ts, UICommands.ts
- Risk: Low (interface extension is additive)
- **COMPLETED**: Added 9 new methods to CommandContext:
  - `setEditingInProgress`, `markTaskDirty`, `clearTaskDirty`, `markColumnDirty`, `clearColumnDirty`
  - `handleIncludeSwitch`, `requestStopEditing`, `refreshConfiguration`
- Reduced `(panel as any)` from 32+ to 1 (remaining: EditModeCommands accessing messageHandler for legacy methods)

### 5. [x] Consolidate duplicate include handling in TaskCommands
- File: `src/commands/TaskCommands.ts`
- Issue: `handleEditTask` and `handleEditTaskTitle` have duplicate include detection logic
- Action: Extract common logic into helper methods
- Risk: Low
- **COMPLETED**: Created two helper methods:
  - `extractIncludeFiles(title)` - extracts file paths from include syntax
  - `handleTaskIncludeSwitch(taskId, newTitle, oldIncludeFiles, context)` - handles include switch logic
- Both `handleEditTask` and `handleEditTaskTitle` now use these helpers

### 6. [x] Remove obsolete methods from MessageHandler
- File: `src/messageHandler.ts`
- Issue: After Command Pattern introduction, some methods are duplicated or unused
- Methods evaluated:
  - `performBoardAction` - REMOVED (moved to ColumnCommands via BaseMessageCommand pattern)
  - `handleUpdateTaskFromStrikethroughDeletion` - REMOVED (now handled by TaskCommands)
- Risk: Medium
- **COMPLETED**: Removed both obsolete methods (~70 lines)

### 7. [x] Move `handleEditColumnTitleUnified` to ColumnCommands (Architectural)
- Files: `src/messageHandler.ts`, `src/commands/ColumnCommands.ts`
- Issue: Commands called back into MessageHandler, breaking clean architecture
- Action: Move the 200+ line method to ColumnCommands
- Risk: Medium (complex logic, needs careful testing)
- **COMPLETED**:
  - Moved `handleEditColumnTitleUnified` (~110 lines) to ColumnCommands
  - Moved `generateAppendTasksContent` helper (~50 lines) to ColumnCommands
  - Added `extractIncludeFiles` helper method to ColumnCommands
  - Removed `handleEditColumnTitleUnified` from CommandContext interface
  - Removed 3 methods + ~250 lines from MessageHandler
  - Removed 4 unused imports from MessageHandler (`PresentationGenerator`, `INCLUDE_SYNTAX`, `safeFileUri`, `path`)

---

## Progress Log

- Started: 2024-12-14
- Tasks 1-7: ALL COMPLETED

## Summary of Changes

### Files Modified:
1. `src/commands/ClipboardCommands.ts` - Removed wrapper, consolidated path logic
2. `src/commands/DiagramCommands.ts` - Created unified SVG conversion method
3. `src/commands/TaskCommands.ts` - Created helper methods, use context methods
4. `src/commands/ColumnCommands.ts` - Added full column include handling logic, use context methods
5. `src/commands/EditModeCommands.ts` - Use context methods
6. `src/commands/UICommands.ts` - Use context methods
7. `src/commands/interfaces/MessageCommand.ts` - Extended CommandContext interface (8 new methods)
8. `src/messageHandler.ts` - Added context methods, removed 3 obsolete methods (~280 lines), cleaned up imports

### Lines Changed:
- MessageHandler reduced by ~280 lines (from ~580 to ~300 lines)
- ColumnCommands increased by ~185 lines (proper location for column logic)
- Net reduction: ~95 lines
- Code is now more type-safe, maintainable, and follows clean architecture principles

### Architectural Improvements:
- Commands no longer call back into MessageHandler
- Column include handling is properly encapsulated in ColumnCommands
- `(panel as any)` patterns reduced from 32+ to 1
- MessageHandler is now primarily responsible for:
  - Context creation and command registry initialization
  - Message routing to commands
  - Board update handling
  - Edit mode lifecycle
