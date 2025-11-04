# Solution: Include File Content Loss Bug

## Problem Analysis

### Critical Bug Chain
1. Main file saves successfully
2. Main file re-parses its content
3. **Parser cannot find include files in registry** ← ROOT CAUSE
4. Task descriptions become empty
5. `trackIncludeFileUnsavedChanges()` sees empty descriptions
6. File content gets wiped to empty string
7. Save fails with "No content to save"
8. Infinite loop of regeneration

### Evidence from Logs
```
[Parser] Task include file not found: root/root-include-2.md
[Parser] Column include file not found: root/root-include-3.md
```

Then later:
```
task.description length: 0  ← CONTENT LOST
file.getContent() length: 108  ← File still has content
Content changed: true  ← Will wipe file!
```

## Root Causes

### 1. Include Files Not Found During Parse
- Main file re-parses after save
- Parser tries to load include content
- Include files not in registry (timing issue)
- Parser creates tasks with empty descriptions

### 2. Excessive File Watcher Triggers
- Multiple saves trigger multiple file watcher events
- Each event causes full board regeneration
- IDs change on every regeneration
- Infinite loop of reloads

### 3. No Protection Against Empty Content
- `trackIncludeFileUnsavedChanges()` blindly updates content
- Doesn't check if description is suspiciously empty
- Doesn't verify content before wiping

## Solutions

### Solution 1: Never Wipe Content to Empty
```typescript
// In trackIncludeFileUnsavedChanges()
const fullContent = task.description || '';
const currentContent = file.getContent();

// PROTECT: Never replace existing content with empty
if (!fullContent.trim() && currentContent.trim()) {
    console.warn(`  ⚠️  PROTECTED: Refusing to wipe content to empty`);
    console.warn(`  → Keeping existing content (${currentContent.length} chars)`);
    // Keep existing content - don't wipe it
    continue;
}

if (fullContent !== currentContent) {
    console.log(`  → Updating content (marking as unsaved)`);
    file.setTaskDescription(fullContent);
}
```

### Solution 2: Ensure Include Files Load Before Parse
```typescript
// In MainKanbanFile.reload() - BEFORE parsing
private async reload(): Promise<void> {
    // ... read content ...
    
    // CRITICAL: Ensure all include files are registered BEFORE parsing
    await this._ensureIncludeFilesRegistered(content);
    
    // Now parse (includes will be found)
    const board = this._parseToBoard(content);
    
    // ... rest of reload ...
}

private async _ensureIncludeFilesRegistered(content: string): Promise<void> {
    // Quick scan for !!!include() markers
    const includeRegex = /!!!include\(([^)]+)\)!!!/g;
    let match;
    
    while ((match = includeRegex.exec(content)) !== null) {
        const includePath = match[1].trim();
        
        // Ensure this include file exists in registry
        if (!this._registry.hasByRelativePath(includePath)) {
            console.log(`[MainKanbanFile] Pre-registering include: ${includePath}`);
            // Create appropriate include file type
            // (detect type from context or default to regular)
            // ... registration ...
        }
    }
}
```

### Solution 3: Debounce File Watcher Events
```typescript
// In MarkdownFile - debounce file system events
private _fileWatcherDebounce: NodeJS.Timeout | undefined;

protected _onFileSystemChange(event: FileChangeEvent): void {
    // Debounce rapid-fire events
    if (this._fileWatcherDebounce) {
        clearTimeout(this._fileWatcherDebounce);
    }
    
    this._fileWatcherDebounce = setTimeout(() => {
        this._fileWatcherDebounce = undefined;
        this._handleFileSystemChange(event);
    }, 100); // 100ms debounce
}
```

### Solution 4: Skip Parse If Content Unchanged
```typescript
// In MainKanbanFile.reload()
const newContent = await this._readContent();

// Skip parse if content exactly the same
if (newContent === this._content) {
    console.log(`[MainKanbanFile] Content unchanged - skipping parse`);
    return;
}

// Content changed - proceed with parse
this._content = newContent;
const board = this._parseToBoard(newContent);
```

## Implementation Priority

1. **CRITICAL (Fix Now)**: Solution 1 - Never wipe to empty
2. **CRITICAL (Fix Now)**: Solution 4 - Skip parse if unchanged  
3. **HIGH**: Solution 3 - Debounce watchers
4. **MEDIUM**: Solution 2 - Pre-register includes

## Testing Plan

1. Edit task include content
2. Save board
3. Verify content NOT lost
4. Verify file saves successfully
5. Verify no infinite reload loops
6. Verify no conflict dialogs

## Success Criteria

- ✅ No "No content to save" errors
- ✅ Include file content preserved through save
- ✅ No infinite regeneration loops
- ✅ No unwanted conflict dialogs
- ✅ Single entry point for all changes
