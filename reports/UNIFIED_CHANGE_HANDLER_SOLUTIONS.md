# Unified Change Handler - 5 Solutions Analysis

## Problem Restatement

**Current Issues**:
- Multiple entry points for changes (no single coordinated flow)
- Shows unwanted conflict/save dialogues
- Doesn't consistently load newly imported include files
- No proper cache invalidation when switching includes
- Auto-saves when it shouldn't

**Required Behavior**:
1. **Single entry point** for ALL changes (external + internal)
2. **Ordered execution**:
   - Detect change type (main file, include file content, include file switch)
   - Check unsaved changes in files being unloaded → ask user
   - Clear cache for switched files
   - Load new include files
   - Update frontend only for modified content
3. **Never auto-save** (only when user explicitly saves)

## Solution 1: State Machine with Change Coordinator (90% probability)

### Architecture
```typescript
class ChangeCoordinator {
    private state: 'idle' | 'processing' | 'waiting_user';
    private changeQueue: Change[] = [];
    
    // SINGLE ENTRY POINT
    async handleChange(change: Change) {
        if (this.state === 'processing') {
            this.changeQueue.push(change);
            return;
        }
        
        this.state = 'processing';
        await this._processChange(change);
        this.state = 'idle';
        
        // Process queued changes
        while (this.changeQueue.length > 0) {
            const next = this.changeQueue.shift();
            await this._processChange(next);
        }
    }
    
    private async _processChange(change: Change) {
        // 1. Classify change type
        const type = this._classifyChange(change);
        
        // 2. Check for unsaved in files being switched
        if (type === 'include_switch') {
            const unsaved = this._getUnsavedFilesBeingUnloaded(change);
            if (unsaved.length > 0) {
                const response = await this._askUserToSave(unsaved);
                if (response === 'save') {
                    await this._saveFiles(unsaved);
                } else if (response === 'cancel') {
                    return; // Abort the switch
                }
                // 'discard' falls through
            }
        }
        
        // 3. Clear cache for switched files
        await this._clearCacheForSwitchedFiles(change);
        
        // 4. Set new include files and load
        await this._loadNewIncludeFiles(change);
        
        // 5. Update frontend only for modified content
        await this._updateModifiedContentInFrontend(change);
    }
}
```

### Pros
- ✅ Single entry point enforced
- ✅ Sequential processing prevents race conditions
- ✅ Clear state management
- ✅ Queue handles concurrent changes

### Cons
- ❌ Complex state management
- ❌ Need to refactor all existing entry points

### Probability: 90%
Will solve the problem if implemented correctly. High complexity but comprehensive.

---

## Solution 2: Event Bus with Change Pipeline (85% probability)

### Architecture
```typescript
class ChangeEventBus {
    private pipeline: ChangeHandler[] = [
        new ChangeClassifier(),
        new UnsavedChangeChecker(),
        new CacheClearer(),
        new IncludeFileLoader(),
        new FrontendUpdater()
    ];
    
    // SINGLE ENTRY POINT
    async processChange(event: ChangeEvent) {
        let context = new ChangeContext(event);
        
        // Execute pipeline in order
        for (const handler of this.pipeline) {
            context = await handler.handle(context);
            
            // Allow cancellation at any stage
            if (context.cancelled) {
                return;
            }
        }
    }
}

class UnsavedChangeChecker implements ChangeHandler {
    async handle(context: ChangeContext): Promise<ChangeContext> {
        if (context.type === 'include_switch') {
            const unsaved = context.getFilesBeingUnloaded()
                .filter(f => f.hasUnsavedChanges());
            
            if (unsaved.length > 0) {
                const response = await this.askUser(unsaved);
                if (response === 'cancel') {
                    context.cancelled = true;
                } else if (response === 'save') {
                    await this.saveFiles(unsaved);
                }
            }
        }
        return context;
    }
}
```

### Pros
- ✅ Clear separation of concerns
- ✅ Easy to add new handlers
- ✅ Testable pipeline stages
- ✅ Ordered execution guaranteed

### Cons
- ❌ Medium complexity
- ❌ Need to refactor existing code

### Probability: 85%
Clean architecture, slightly easier to implement than Solution 1.

---

## Solution 3: Command Pattern with Validators (75% probability)

### Architecture
```typescript
abstract class ChangeCommand {
    async execute() {
        // 1. Validate (includes unsaved check)
        const valid = await this.validate();
        if (!valid) return;
        
        // 2. Clear cache
        await this.clearCache();
        
        // 3. Apply changes
        await this.apply();
        
        // 4. Update frontend
        await this.updateFrontend();
    }
    
    abstract validate(): Promise<boolean>;
    abstract clearCache(): Promise<void>;
    abstract apply(): Promise<void>;
    abstract updateFrontend(): Promise<void>;
}

class SwitchIncludeFileCommand extends ChangeCommand {
    async validate(): Promise<boolean> {
        const unsaved = this.getUnsavedFiles();
        if (unsaved.length > 0) {
            const response = await askUser(unsaved);
            if (response === 'cancel') return false;
            if (response === 'save') await this.saveFiles(unsaved);
        }
        return true;
    }
    
    async clearCache(): Promise<void> {
        this.cache.clearForFiles(this.oldFiles);
    }
    
    async apply(): Promise<void> {
        this.registry.unregister(this.oldFiles);
        this.registry.register(this.newFiles);
        await this.loadNewFiles();
    }
    
    async updateFrontend(): Promise<void> {
        this.webview.updateIncludes(this.modifiedFiles);
    }
}

// Single entry point
class ChangeCommandExecutor {
    async execute(command: ChangeCommand) {
        await command.execute();
    }
}
```

### Pros
- ✅ Encapsulates all change logic
- ✅ Easy to test
- ✅ Clear validation step

### Cons
- ❌ Need separate command for each change type
- ❌ May be overkill for simple changes

### Probability: 75%
Good pattern but may over-engineer simple cases.

---

## Solution 4: Interceptor Chain (70% probability)

### Architecture
```typescript
class ChangeInterceptorChain {
    private interceptors: ChangeInterceptor[] = [
        new UnsavedChangeInterceptor(),
        new CacheInvalidationInterceptor(),
        new LoadIncludeInterceptor(),
        new FrontendUpdateInterceptor()
    ];
    
    async intercept(change: Change): Promise<void> {
        let context = { change, continue: true };
        
        for (const interceptor of this.interceptors) {
            context = await interceptor.intercept(context);
            if (!context.continue) break;
        }
    }
}

class UnsavedChangeInterceptor {
    async intercept(context): Promise<Context> {
        if (context.change.type === 'switch_include') {
            // Check unsaved, ask user
            const shouldContinue = await this.checkUnsaved();
            context.continue = shouldContinue;
        }
        return context;
    }
}
```

### Pros
- ✅ Flexible interception points
- ✅ Can abort at any stage
- ✅ Similar to middleware pattern

### Cons
- ❌ Can be hard to debug
- ❌ Order dependencies between interceptors

### Probability: 70%
Flexible but potentially confusing.

---

## Solution 5: Centralized Change Manager with Locks (80% probability)

### Architecture
```typescript
class CentralizedChangeManager {
    private _lock: boolean = false;
    private _pendingChanges: Change[] = [];
    
    // SINGLE ENTRY POINT - enforces sequential processing
    async processChange(change: Change): Promise<void> {
        // Wait for lock
        while (this._lock) {
            await this._sleep(10);
        }
        
        this._lock = true;
        
        try {
            await this._processChangeInternal(change);
        } finally {
            this._lock = false;
        }
    }
    
    private async _processChangeInternal(change: Change): Promise<void> {
        // Step 1: Classify
        const classification = this._classifyChange(change);
        
        // Step 2: Check unsaved if switching files
        if (classification.isSwitchingIncludes) {
            const proceed = await this._handleUnsavedFiles(
                classification.filesBeingUnloaded
            );
            if (!proceed) return;
        }
        
        // Step 3: Unload old files & clear cache
        if (classification.filesBeingUnloaded.length > 0) {
            await this._unloadFiles(classification.filesBeingUnloaded);
            this.cache.clearForFiles(classification.filesBeingUnloaded);
        }
        
        // Step 4: Load new files & update cache
        if (classification.filesBeingLoaded.length > 0) {
            await this._loadFiles(classification.filesBeingLoaded);
            await this.cache.updateForFiles(classification.filesBeingLoaded);
        }
        
        // Step 5: Update frontend for modified content only
        await this._updateFrontend(classification.modifiedContent);
    }
    
    private async _handleUnsavedFiles(files: IncludeFile[]): Promise<boolean> {
        const unsaved = files.filter(f => f.hasUnsavedChanges());
        if (unsaved.length === 0) return true;
        
        const response = await this._showDialog({
            message: `${unsaved.length} files have unsaved changes`,
            options: ['Save', 'Discard', 'Cancel']
        });
        
        if (response === 'Cancel') return false;
        if (response === 'Save') {
            await this._saveFiles(unsaved);
        }
        return true;
    }
}
```

### Pros
- ✅ Simple lock mechanism prevents concurrent changes
- ✅ All steps clearly defined
- ✅ Easier to implement than state machine
- ✅ Clear entry point

### Cons
- ❌ Lock-based approach may have performance impact
- ❌ Need careful error handling to release lock

### Probability: 80%
Good balance of simplicity and effectiveness.

---

## Comparison Matrix

| Solution | Complexity | Maintainability | Performance | Extensibility | Probability |
|----------|-----------|-----------------|-------------|---------------|-------------|
| 1. State Machine | High | Medium | Good | Good | 90% |
| 2. Event Bus Pipeline | Medium | High | Good | Excellent | 85% |
| 3. Command Pattern | Medium | High | Good | Good | 75% |
| 4. Interceptor Chain | Medium | Medium | Good | Good | 70% |
| 5. Centralized Manager | Low | High | Fair | Medium | 80% |

## Recommendation

**Start with Solution 5 (Centralized Change Manager)** because:
1. Lowest complexity to implement
2. Clear sequential processing
3. Easy to understand and maintain
4. Can evolve into Solution 2 (Event Bus) later if needed

**Then evolve to Solution 2 (Event Bus Pipeline)** for:
1. Better extensibility
2. Cleaner separation of concerns
3. Easier testing of individual pipeline stages

## Critical Requirements All Solutions Must Meet

1. ✅ Single entry point for ALL changes
2. ✅ Check unsaved before unloading files
3. ✅ Clear cache when switching files
4. ✅ Load new includes properly
5. ✅ Update only modified frontend content
6. ✅ NEVER auto-save (only on user command)
7. ✅ No unwanted conflict/save dialogs
