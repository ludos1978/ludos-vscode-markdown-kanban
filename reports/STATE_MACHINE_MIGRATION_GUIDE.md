# State Machine Migration Guide

This guide explains how to migrate existing code to use the unified state machine architecture.

---

## Overview

**Goal**: Replace scattered entry points with single unified state machine entry point.

**Before:**
```typescript
// ❌ Multiple entry points
handleFileSystemChange()
handleUserEdit()
handleSaveEvent()
handleIncludeSwitch()
```

**After:**
```typescript
// ✅ Single entry point
stateMachine.processChange(event)
```

---

## Migration Checklist

### Phase 1: Preparation
- [x] Create state machine design document
- [x] Implement state machine skeleton
- [ ] Review all current entry points
- [ ] Map current logic to state handlers
- [ ] Create migration plan for each entry point

### Phase 2: State Handler Implementation
- [ ] Implement `_handleAnalyzingImpact()`
- [ ] Implement `_handleCheckingEditState()`
- [ ] Implement `_handleCapturingEdit()`
- [ ] Implement `_handleCheckingUnsaved()`
- [ ] Implement `_handlePromptingUser()`
- [ ] Implement `_handleSavingUnsaved()`
- [ ] Implement `_handleClearingCache()`
- [ ] Implement `_handleLoadingNew()`
- [ ] Implement `_handleUpdatingBackend()`
- [ ] Implement `_handleSyncingFrontend()`

### Phase 3: Entry Point Migration
- [ ] Migrate file system watcher
- [ ] Migrate message handler (user edits)
- [ ] Migrate save coordinator
- [ ] Migrate include switch operations
- [ ] Update tests

### Phase 4: Cleanup
- [ ] Remove old handler methods
- [ ] Remove duplicate logic
- [ ] Update documentation
- [ ] Verify all tests pass

---

## Entry Point 1: File System Watcher

### Current Implementation

**Location**: [src/kanbanWebviewPanel.ts](src/kanbanWebviewPanel.ts)

```typescript
// File system watcher callback
private _onFileSystemChange(uri: vscode.Uri): void {
    const file = this._fileRegistry.getByPath(uri.fsPath);
    if (!file) return;

    // Check skip flag for legitimate saves
    if (file._skipNextReloadDetection) {
        file._skipNextReloadDetection = false;
        return;
    }

    // Determine change type
    const changeType = await this._determineChangeType(file);

    // Handle via UnifiedChangeHandler
    const handler = UnifiedChangeHandler.getInstance();
    await handler.handleExternalChange(file, changeType);
}
```

### Migrated Implementation

```typescript
// File system watcher callback
private _onFileSystemChange(uri: vscode.Uri): void {
    const file = this._fileRegistry.getByPath(uri.fsPath);
    if (!file) return;

    // Check skip flag for legitimate saves
    if (file._skipNextReloadDetection) {
        file._skipNextReloadDetection = false;
        return;
    }

    // Determine change type
    const changeType = await this._determineChangeType(file);

    // ✅ Route through state machine
    const stateMachine = ChangeStateMachine.getInstance();
    await stateMachine.processChange({
        type: 'file_system_change',
        file: file,
        changeType: changeType,
        timestamp: Date.now()
    });
}
```

### Changes Required
1. Import `ChangeStateMachine`
2. Replace `UnifiedChangeHandler.handleExternalChange()` call
3. Create `FileSystemChangeEvent` object
4. Call `stateMachine.processChange()`

---

## Entry Point 2: Message Handler (User Edits)

### Current Implementation

**Location**: [src/messageHandler.ts](src/messageHandler.ts)

```typescript
case 'editTaskTitle':
    const panel = this._getWebviewPanel();
    const oldIncludeFiles = task.includeFiles || [];
    const newIncludeFiles = extractIncludeFiles(message.title);

    if (!arraysEqual(oldIncludeFiles, newIncludeFiles)) {
        // Include switch detected
        await this.requestStopEditing();

        await (panel as any)._handleContentChange({
            source: 'user_edit',
            switchedIncludes: [{
                taskId: message.taskId,
                columnIdForTask: message.columnId,
                oldFiles: oldIncludeFiles,
                newFiles: newIncludeFiles,
                newTitle: message.title
            }]
        });
    }

    // Update task title
    await this.performBoardAction(() =>
        this._boardOperations.editTask(board, message.taskId, message.columnId, {
            title: message.title
        }),
        { sendUpdate: false }
    );
    break;
```

### Migrated Implementation

```typescript
case 'editTaskTitle':
    const panel = this._getWebviewPanel();
    const oldIncludeFiles = task.includeFiles || [];
    const newIncludeFiles = extractIncludeFiles(message.title);

    // Determine if this is an include switch
    const isIncludeSwitch = !arraysEqual(oldIncludeFiles, newIncludeFiles);

    if (isIncludeSwitch) {
        // ✅ Route through state machine as include switch
        const stateMachine = ChangeStateMachine.getInstance();
        await stateMachine.processChange({
            type: 'include_switch',
            target: 'task',
            targetId: message.taskId,
            columnIdForTask: message.columnId,
            oldFiles: oldIncludeFiles,
            newFiles: newIncludeFiles,
            newTitle: message.title
        });
    } else {
        // ✅ Route through state machine as regular edit
        const stateMachine = ChangeStateMachine.getInstance();
        await stateMachine.processChange({
            type: 'user_edit',
            editType: 'task_title',
            params: {
                taskId: message.taskId,
                columnId: message.columnId,
                value: message.title
            }
        });
    }
    break;
```

### Changes Required
1. Import `ChangeStateMachine`
2. Determine if include switch or regular edit
3. Create appropriate event type
4. Call `stateMachine.processChange()`
5. Remove direct calls to `_handleContentChange()`

---

## Entry Point 3: Save Coordinator

### Current Implementation

**Location**: [src/core/SaveCoordinator.ts](src/core/SaveCoordinator.ts)

```typescript
public async saveFile(file: MarkdownFile): Promise<void> {
    console.log(`[SaveCoordinator] Saving file: ${file.getPath()}`);

    // Set skip flag to prevent reload detection
    file._skipNextReloadDetection = true;

    // Write to disk
    await file.save();

    // Update baseline
    file._baseline = file._content;

    console.log(`[SaveCoordinator] Save complete`);
}
```

### Migrated Implementation

```typescript
public async saveFile(file: MarkdownFile): Promise<void> {
    console.log(`[SaveCoordinator] Saving file: ${file.getPath()}`);

    // ✅ Route through state machine
    const stateMachine = ChangeStateMachine.getInstance();
    await stateMachine.processChange({
        type: 'save',
        file: file,
        source: 'user_command'
    });
}
```

### Changes Required
1. Import `ChangeStateMachine`
2. Create `SaveEvent` object
3. Call `stateMachine.processChange()`
4. Move save logic to state handler (`_handleSavingUnsaved`)

---

## Entry Point 4: Include Switch Operations

### Current Implementation

**Location**: Various locations trigger include switches directly

```typescript
// Example: Column include switch
if (newIncludeFiles.length > 0) {
    await panel._handleContentChange({
        source: 'user_edit',
        switchedIncludes: [{
            columnId: column.id,
            oldFiles: oldIncludeFiles,
            newFiles: newIncludeFiles
        }]
    });
}
```

### Migrated Implementation

```typescript
// ✅ Route through state machine
const stateMachine = ChangeStateMachine.getInstance();
await stateMachine.processChange({
    type: 'include_switch',
    target: 'column',
    targetId: column.id,
    oldFiles: oldIncludeFiles,
    newFiles: newIncludeFiles
});
```

### Changes Required
1. Find all locations that trigger include switches
2. Replace with `stateMachine.processChange()` calls
3. Use `IncludeSwitchEvent` type

---

## State Handler Implementation Guide

### Template for State Handlers

Each state handler follows this pattern:

```typescript
private async _handleStateName(context: ChangeContext): Promise<ChangeState> {
    console.log(`[State:STATE_NAME] Description of what this state does`);

    // 1. Access context data
    const event = context.event;
    const impact = context.impact;

    // 2. Perform state-specific logic
    // ... your logic here ...

    // 3. Update context with results
    context.result.updatedFiles.push(...);

    // 4. Return next state
    return ChangeState.NEXT_STATE;
}
```

### Example: Implementing `_handleAnalyzingImpact`

```typescript
private async _handleAnalyzingImpact(context: ChangeContext): Promise<ChangeState> {
    console.log(`[State:ANALYZING_IMPACT] Analyzing change impact`);

    const event = context.event;

    // Determine impact based on event type
    if (event.type === 'file_system_change') {
        const file = event.file;
        const fileType = file.getFileType();

        context.impact.mainFileChanged = fileType === 'main';
        context.impact.includeFilesChanged = fileType !== 'main';
        context.impact.includesSwitched = false;
        context.impact.affectedFiles = [file];

    } else if (event.type === 'include_switch') {
        context.impact.mainFileChanged = false;
        context.impact.includeFilesChanged = false;
        context.impact.includesSwitched = true;

        // Calculate affected files
        const oldFiles = event.oldFiles.map(path =>
            this._fileRegistry.getByRelativePath(path)
        ).filter(f => f !== undefined);

        context.impact.affectedFiles = oldFiles;

        // Store switch info
        context.switches.oldFiles = event.oldFiles;
        context.switches.newFiles = event.newFiles;
        context.switches.unloadingFiles = event.oldFiles.filter(
            old => !event.newFiles.includes(old)
        );
        context.switches.loadingFiles = event.newFiles.filter(
            nf => !event.oldFiles.includes(nf)
        );

    } else if (event.type === 'user_edit') {
        context.impact.mainFileChanged = true;
        context.impact.includeFilesChanged = false;
        context.impact.includesSwitched = !!event.params.includeSwitch;

        const mainFile = this._fileRegistry.getMainFile();
        context.impact.affectedFiles = mainFile ? [mainFile] : [];
    }

    console.log(`[State:ANALYZING_IMPACT] Impact analysis:`, {
        mainChanged: context.impact.mainFileChanged,
        includesChanged: context.impact.includeFilesChanged,
        switched: context.impact.includesSwitched,
        affectedCount: context.impact.affectedFiles.length
    });

    return ChangeState.CHECKING_EDIT_STATE;
}
```

### Example: Implementing `_handleCheckingUnsaved`

```typescript
private async _handleCheckingUnsaved(context: ChangeContext): Promise<ChangeState> {
    console.log(`[State:CHECKING_UNSAVED] Checking for unsaved files being unloaded`);

    // Only check if includes are being switched
    if (!context.impact.includesSwitched) {
        console.log(`[State:CHECKING_UNSAVED] No switches, skipping check`);
        return ChangeState.CLEARING_CACHE;
    }

    // Get files being unloaded
    const unloadingFiles = context.switches.unloadingFiles;

    if (unloadingFiles.length === 0) {
        console.log(`[State:CHECKING_UNSAVED] No files being unloaded`);
        return ChangeState.CLEARING_CACHE;
    }

    // Check for unsaved changes
    const unsavedFiles: MarkdownFile[] = [];

    for (const relativePath of unloadingFiles) {
        const file = this._fileRegistry.getByRelativePath(relativePath);
        if (file && file.hasUnsavedChanges()) {
            unsavedFiles.push(file);
        }
    }

    if (unsavedFiles.length === 0) {
        console.log(`[State:CHECKING_UNSAVED] No unsaved changes found`);
        return ChangeState.CLEARING_CACHE;
    }

    console.log(`[State:CHECKING_UNSAVED] Found ${unsavedFiles.length} files with unsaved changes`);
    context.unsaved.files = unsavedFiles;

    return ChangeState.PROMPTING_USER;
}
```

---

## Testing Strategy

### Unit Tests for State Machine

```typescript
describe('ChangeStateMachine', () => {
    let stateMachine: ChangeStateMachine;
    let mockFileRegistry: any;
    let mockWebviewPanel: any;

    beforeEach(() => {
        stateMachine = ChangeStateMachine.getInstance();
        mockFileRegistry = createMockFileRegistry();
        mockWebviewPanel = createMockWebviewPanel();
        stateMachine.initialize(mockFileRegistry, mockWebviewPanel);
    });

    describe('State Transitions', () => {
        it('should transition from IDLE to RECEIVING_CHANGE on event', async () => {
            const event: FileSystemChangeEvent = {
                type: 'file_system_change',
                file: mockFile,
                changeType: 'modified',
                timestamp: Date.now()
            };

            const result = await stateMachine.processChange(event);

            expect(result.success).toBe(true);
            expect(result.context.stateHistory).toContain(ChangeState.RECEIVING_CHANGE);
        });

        it('should always execute CHECKING_UNSAVED for include switches', async () => {
            const event: IncludeSwitchEvent = {
                type: 'include_switch',
                target: 'column',
                targetId: 'col-1',
                oldFiles: ['old.md'],
                newFiles: ['new.md']
            };

            const result = await stateMachine.processChange(event);

            expect(result.context.stateHistory).toContain(ChangeState.CHECKING_UNSAVED);
        });
    });

    describe('Unsaved Changes Detection', () => {
        it('should prompt user when unsaved file is being unloaded', async () => {
            const unsavedFile = createMockFile('include.md', true); // has unsaved changes
            mockFileRegistry.getByRelativePath.mockReturnValue(unsavedFile);

            const event: IncludeSwitchEvent = {
                type: 'include_switch',
                target: 'column',
                targetId: 'col-1',
                oldFiles: ['include.md'],
                newFiles: []
            };

            const result = await stateMachine.processChange(event);

            expect(result.context.stateHistory).toContain(ChangeState.PROMPTING_USER);
        });
    });
});
```

### Integration Tests

```typescript
describe('State Machine Integration', () => {
    it('should handle complete file system change flow', async () => {
        // Setup
        const file = await createTestFile('test.md', 'content');
        const stateMachine = ChangeStateMachine.getInstance();

        // External change
        await fs.writeFile(file.path, 'new content');

        // Process through state machine
        const result = await stateMachine.processChange({
            type: 'file_system_change',
            file: file,
            changeType: 'modified',
            timestamp: Date.now()
        });

        // Verify
        expect(result.success).toBe(true);
        expect(file.getContent()).toBe('new content');
        expect(result.context.stateHistory).toEqual([
            ChangeState.RECEIVING_CHANGE,
            ChangeState.ANALYZING_IMPACT,
            ChangeState.CHECKING_EDIT_STATE,
            ChangeState.CHECKING_UNSAVED,
            ChangeState.CLEARING_CACHE,
            ChangeState.LOADING_NEW,
            ChangeState.UPDATING_BACKEND,
            ChangeState.SYNCING_FRONTEND,
            ChangeState.COMPLETE
        ]);
    });
});
```

---

## Common Pitfalls

### 1. Forgetting to Update Context

❌ **Wrong:**
```typescript
private async _handleSomeState(context: ChangeContext): Promise<ChangeState> {
    const files = [...]; // Calculate something
    // Forgot to update context!
    return NextState;
}
```

✅ **Correct:**
```typescript
private async _handleSomeState(context: ChangeContext): Promise<ChangeState> {
    const files = [...]; // Calculate something
    context.result.updatedFiles = files; // ✓ Update context
    return NextState;
}
```

### 2. Direct Handler Calls

❌ **Wrong:**
```typescript
// Still calling old handler directly
await panel._handleContentChange({ ... });
```

✅ **Correct:**
```typescript
// Use state machine
await stateMachine.processChange({ ... });
```

### 3. Skipping States

❌ **Wrong:**
```typescript
// Jumping directly to CLEARING_CACHE without CHECKING_UNSAVED
if (shouldClearCache) {
    return ChangeState.CLEARING_CACHE; // ❌ Skips unsaved check!
}
```

✅ **Correct:**
```typescript
// Always go through CHECKING_UNSAVED first
return ChangeState.CHECKING_UNSAVED; // ✓ Follows flow
```

### 4. Not Handling User Cancellation

❌ **Wrong:**
```typescript
private async _handlePromptingUser(context: ChangeContext): Promise<ChangeState> {
    const choice = await showDialog(...);
    // What if user cancels?
    return ChangeState.CLEARING_CACHE;
}
```

✅ **Correct:**
```typescript
private async _handlePromptingUser(context: ChangeContext): Promise<ChangeState> {
    const choice = await showDialog(...);

    if (choice === 'cancel') {
        return ChangeState.CANCELLED; // ✓ Handle cancellation
    }

    return ChangeState.CLEARING_CACHE;
}
```

---

## Rollout Plan

### Stage 1: Parallel Operation (Current)
- State machine exists alongside old handlers
- Old handlers still active
- Test state machine with logs only

### Stage 2: Gradual Migration
- Migrate one entry point at a time
- Keep old handler as fallback
- Monitor logs for issues

### Stage 3: Complete Migration
- All entry points use state machine
- Remove old handlers
- Clean up duplicate logic

### Stage 4: Optimization
- Performance tuning
- Reduce logging
- Polish error handling

---

## Success Criteria

Migration is complete when:

✅ All entry points route through `stateMachine.processChange()`
✅ No direct calls to old handler methods
✅ `CHECKING_UNSAVED` state is reached for all switches
✅ All tests pass
✅ No duplicate logic between handlers
✅ Documentation updated
✅ Performance is equal or better than before

---

## Questions?

If you encounter issues during migration:

1. Check [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) for design details
2. Review [ARCHITECTURE.md](ARCHITECTURE.md) for overall architecture
3. Look at example implementations in this guide
4. Add logs to track state transitions
5. Write tests to verify behavior

---

## Related Documentation

- [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) - Complete state machine design
- [ARCHITECTURE.md](ARCHITECTURE.md) - Overall architecture documentation
- [src/core/ChangeStateMachine.ts](src/core/ChangeStateMachine.ts) - Implementation
