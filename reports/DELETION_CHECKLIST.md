# Complete Code Deletion Checklist

## Philosophy: Clean Slate Approach

**NO FALLBACK CODE** - This is a complete replacement. Old code will be deleted as soon as the new transaction-based system is implemented.

## Pre-Deletion Backup

```bash
# Create backup branch before any deletion
git checkout -b backup/pre-transaction-manager
git push origin backup/pre-transaction-manager

# Create working branch
git checkout -b feature/transaction-manager-clean-slate
```

## Phase 1: Files to DELETE Completely

### ❌ src/core/UnifiedChangeHandler.ts
**Why**: Replaced entirely by transaction-based change handling
- **Functionality replaced by**: `IncludeFileTransactionManager` handles all changes through transactions
- **Line count**: ~200 lines
- **Delete when**: After transaction manager is fully implemented

```bash
# Delete command
rm src/core/UnifiedChangeHandler.ts
```

**Update imports in these files:**
- `src/files/MarkdownFile.ts` - Remove import, update to use transaction manager
- `src/files/MainKanbanFile.ts` - Remove import
- `src/files/IncludeFile.ts` - Remove import

---

## Phase 2: Methods to DELETE from Existing Files

### 📝 src/includeFileManager.ts

**DELETE these methods completely:**

#### ❌ trackIncludeFileUnsavedChanges()
```typescript
// Lines ~50-150 (approximate)
public async trackIncludeFileUnsavedChanges(
    board: KanbanBoard, 
    documentGetter: any, 
    filePathGetter: any
): Promise<boolean>
```
**Why**: Replaced by transaction manager's snapshot mechanism
**Replaced by**: Transaction snapshots handle state tracking

#### ❌ _handleUnsavedIncludeFileChanges()
```typescript
// Lines ~400+ (approximate)
public _handleUnsavedIncludeFileChanges(): Promise<void>
```
**Why**: Replaced by transaction prompting system
**Replaced by**: `Transaction.buildSwitchIncludeFilesSteps()` step: PROMPT_SAVE_IF_NEEDED

#### ❌ _initializeUnifiedIncludeContents()
```typescript
// Lines ~450+ (approximate)  
public _initializeUnifiedIncludeContents(documentGetter: any): Promise<void>
```
**Why**: Initialization handled by transaction manager
**Replaced by**: `Transaction` LOAD step

#### ❌ handleExternalFileChange()
```typescript
// Lines ~250+ (approximate)
public async handleExternalFileChange(
    event: any, 
    onInlineChange: (path: string, changeType: string) => Promise<void>
): Promise<void>
```
**Why**: External changes handled through transactions
**Replaced by**: Transaction manager coordinates all changes

#### ❌ _recheckIncludeFileChanges()
```typescript
public _recheckIncludeFileChanges(): void
```
**Why**: No longer needed with transactional approach
**Replaced by**: Transaction validation steps

#### ❌ _updateUnifiedIncludeSystem()
```typescript
public _updateUnifiedIncludeSystem(
    board: KanbanBoard, 
    documentGetter: any
): Promise<void>
```
**Why**: Updates coordinated by transaction manager
**Replaced by**: Transaction UPDATE_CACHES step

#### ❌ _removeTrackedFiles()
```typescript
public _removeTrackedFiles(): void
```
**Why**: File lifecycle managed by transaction manager
**Replaced by**: Transaction UNLOAD step

**Keep these methods** (refactor to use transactions):
- ✅ `getOrCreateIncludeFile()` - Still needed
- ✅ `getIncludeFilesByType()` - Still needed  
- ✅ `saveColumnIncludeChanges()` - Refactor to use transactions
- ✅ `saveTaskIncludeChanges()` - Refactor to use transactions
- ✅ `hasUnsavedIncludeFileChanges()` - Delegate to transaction manager
- ✅ `ensureIncludeFileRegistered()` - Keep for compatibility

**ADD these new methods:**
```typescript
// NEW: Transaction-based entry point
public async switchIncludeFilesTransactional(
    oldPaths: string[],
    newPaths: string[],
    columnId?: string,
    taskId?: string
): Promise<void>

// NEW: Set transaction manager
public setTransactionManager(manager: IncludeFileTransactionManager): void
```

---

### 📝 src/saveEventCoordinator.ts

**This file can STAY** - it's already centralized and works well.
- No deletions needed
- Will be used by transaction manager for legitimate save tracking

---

### 📝 src/conflictResolver.ts

**This file can STAY** - it provides the dialog UI.
- No deletions needed
- Will be called by transaction manager for user prompts

---

## Phase 3: Update Entry Points

### 📝 src/messageHandler.ts (or wherever messages are handled)

**REPLACE old include file handling:**

```typescript
// ❌ DELETE OLD CODE
case 'switchIncludeFile':
    await includeFileManager.someOldMethod();
    break;

// ✅ NEW CODE
case 'switchIncludeFile':
    await includeFileManager.switchIncludeFilesTransactional(
        message.oldPaths,
        message.newPaths,
        message.columnId,
        message.taskId
    );
    break;
```

---

### 📝 src/kanbanWebviewPanel.ts

**REPLACE old initialization:**

```typescript
// ❌ DELETE OLD CODE
this.includeFileManager = new IncludeFileManager(
    fileRegistry,
    fileFactory,
    conflictResolver,
    backupManager,
    // ... old params
);

// ✅ NEW CODE
this.includeFileManager = new IncludeFileManager(
    fileRegistry,
    fileFactory,
    conflictResolver,
    backupManager,
    // ... old params
);

// Initialize transaction manager
const transactionManager = IncludeFileTransactionManager.getInstance(
    fileRegistry,
    conflictResolver
);
this.includeFileManager.setTransactionManager(transactionManager);
```

---

## Phase 4: Clean Up File Watchers

### 📝 src/files/MarkdownFile.ts

**UPDATE handleExternalChange() delegation:**

```typescript
// ❌ DELETE OLD CODE
public async handleExternalChange(
    changeType: 'modified' | 'deleted' | 'created'
): Promise<void> {
    const handler = UnifiedChangeHandler.getInstance();
    await handler.handleExternalChange(this, changeType);
}

// ✅ NEW CODE
public async handleExternalChange(
    changeType: 'modified' | 'deleted' | 'created'
): Promise<void> {
    // Route through transaction manager if available
    // Otherwise handle directly (for non-include files)
    if (this.getFileType() !== 'main') {
        // Include files use transaction manager
        // Transaction manager will be notified via event system
        return;
    }
    
    // Main file handles directly (for now)
    // Future: also route through transaction manager
    await this.handleMainFileExternalChange(changeType);
}
```

---

## Deletion Execution Order

### Step 1: Create Backup (Week 0)
```bash
git checkout -b backup/pre-transaction-manager
git push origin backup/pre-transaction-manager
git checkout -b feature/transaction-manager-clean-slate
```

### Step 2: Implement New System (Week 1-2)
- ✅ Create all transaction infrastructure
- ✅ Create cache coordinator
- ✅ Write unit tests
- **DON'T DELETE ANYTHING YET**

### Step 3: Integration (Week 3)
- ✅ Add new methods to includeFileManager
- ✅ Wire up message handlers to use transactions
- ✅ Test thoroughly

### Step 4: DELETE OLD CODE (Week 3, Day 4-5)

**Order of deletion:**

1. **Delete UnifiedChangeHandler.ts first**
   ```bash
   git rm src/core/UnifiedChangeHandler.ts
   ```

2. **Delete methods from includeFileManager.ts**
   - Delete all marked methods in one commit
   - Update any callers

3. **Update MarkdownFile.ts**
   - Remove UnifiedChangeHandler import
   - Update handleExternalChange()

4. **Commit the deletions**
   ```bash
   git add -A
   git commit -m "feat: Remove old include file handling code - replaced by transaction manager"
   ```

### Step 5: Verify No Old Code Remains (Week 4)

```bash
# Search for old method calls
grep -r "trackIncludeFileUnsavedChanges" src/
grep -r "_handleUnsavedIncludeFileChanges" src/
grep -r "UnifiedChangeHandler" src/
grep -r "_updateUnifiedIncludeSystem" src/

# Should return NO results
```

---

## Verification Checklist

After all deletions, verify:

- [ ] `src/core/UnifiedChangeHandler.ts` does not exist
- [ ] No references to `UnifiedChangeHandler` in codebase
- [ ] No references to deleted methods in `includeFileManager.ts`
- [ ] All include file operations go through transaction manager
- [ ] All tests pass
- [ ] No compilation errors
- [ ] Manual testing shows no unwanted dialogs
- [ ] Include file switching works correctly
- [ ] Cache updates work correctly

---

## Total Lines Deleted

**Estimated deletion:**
- `UnifiedChangeHandler.ts`: ~200 lines
- `includeFileManager.ts` methods: ~300 lines
- Old message handler code: ~50 lines
- **Total: ~550 lines deleted**

**Net change:**
- Added: ~1,150 lines (new transaction system)
- Deleted: ~550 lines (old code)
- Modified: ~100 lines (integration)
- **Net: +600 lines** (but much cleaner architecture)

---

## Emergency Rollback (Only if Absolutely Necessary)

If the new system has critical issues:

```bash
# Restore from backup branch
git checkout backup/pre-transaction-manager
git checkout -b hotfix/restore-old-system

# OR cherry-pick specific fixes back
git checkout feature/transaction-manager-clean-slate
git revert <commit-hash-of-deletions>
```

**But this should be LAST RESORT** - prefer fixing the transaction system.

---

## Timeline

- **Week 1-2**: Build new system (no deletions)
- **Week 3 Day 1-3**: Integration & testing
- **Week 3 Day 4**: DELETE old code
- **Week 3 Day 5**: Verification
- **Week 4**: Final testing & refinement

**Total time**: 4 weeks to complete replacement
