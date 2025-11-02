# Implementation Plan: State Machine with Transaction Manager

## Overview

This document provides a detailed implementation plan for Solution 1 - State Machine with Transaction Manager. This solution creates a single coordinated entry point for all include file operations using atomic transactions.

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                  IncludeFileTransactionManager              │
│  - Manages all file operations as atomic transactions       │
│  - Coordinates cache updates                                │
│  - Prevents race conditions                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ├─────────────┬──────────────┬─────────────┐
                            │             │              │             │
                            ▼             ▼              ▼             ▼
                    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
                    │  File    │  │  Cache   │  │  State   │  │  Event   │
                    │  Locks   │  │  Manager │  │  Machine │  │  Queue   │
                    └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### State Machine States

```typescript
enum FileOperationState {
    IDLE = 'idle',                      // No operation in progress
    CHECKING = 'checking',              // Checking for unsaved changes
    PROMPTING = 'prompting',            // Showing save dialog to user
    SAVING = 'saving',                  // Saving changes
    UNLOADING = 'unloading',           // Unloading old files
    CLEARING_CACHE = 'clearing_cache', // Clearing caches
    LOADING = 'loading',               // Loading new files
    UPDATING_CACHE = 'updating_cache', // Updating caches
    REFRESHING_UI = 'refreshing_ui',   // Refreshing UI
    COMMITTING = 'committing',         // Committing transaction
    ROLLING_BACK = 'rolling_back',     // Rolling back on error
    COMPLETED = 'completed',           // Operation completed
    FAILED = 'failed'                  // Operation failed
}
```

## File Structure

```
src/
├── core/
│   ├── transactions/
│   │   ├── IncludeFileTransactionManager.ts     # Main transaction manager
│   │   ├── Transaction.ts                       # Transaction class
│   │   ├── TransactionOperation.ts              # Operation definitions
│   │   ├── TransactionState.ts                  # State machine
│   │   ├── TransactionLock.ts                   # File locking mechanism
│   │   └── TransactionLog.ts                    # Logging for debugging
│   ├── cache/
│   │   ├── CacheCoordinator.ts                  # Coordinates all caches
│   │   └── CacheSnapshot.ts                     # Cache snapshots
│   └── StateManager.ts (existing - will integrate)
```

## Implementation

### Phase 1: Core Transaction Infrastructure

#### 1.1 Transaction Class

```typescript
// src/core/transactions/Transaction.ts

export interface TransactionSnapshot {
    timestamp: Date;
    fileStates: Map<string, FileSnapshot>;
    cacheStates: Map<string, any>;
    registryState: RegistrySnapshot;
}

export interface FileSnapshot {
    path: string;
    relativePath: string;
    content: string;
    baseline: string;
    hasUnsavedChanges: boolean;
    hasExternalChanges: boolean;
}

export interface TransactionStep {
    name: string;
    execute: () => Promise<void>;
    rollback: () => Promise<void>;
    validate?: () => Promise<boolean>;
}

export class Transaction {
    public readonly id: string;
    public readonly type: TransactionType;
    public readonly affectedFiles: string[];
    
    private state: FileOperationState = FileOperationState.IDLE;
    private steps: TransactionStep[] = [];
    private completedSteps: string[] = [];
    private snapshot: TransactionSnapshot | null = null;
    private startTime: Date;
    private endTime: Date | null = null;
    
    constructor(type: TransactionType, affectedFiles: string[]) {
        this.id = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.type = type;
        this.affectedFiles = affectedFiles;
        this.startTime = new Date();
    }
    
    public addStep(step: TransactionStep): void {
        this.steps.push(step);
    }
    
    public async execute(): Promise<TransactionResult> {
        console.log(`[Transaction ${this.id}] Starting execution`);
        
        try {
            // Take snapshot BEFORE executing
            this.snapshot = await this.takeSnapshot();
            
            // Execute each step
            for (const step of this.steps) {
                await this.executeStep(step);
            }
            
            this.state = FileOperationState.COMPLETED;
            this.endTime = new Date();
            
            return {
                success: true,
                transactionId: this.id,
                duration: this.endTime.getTime() - this.startTime.getTime()
            };
        } catch (error) {
            console.error(`[Transaction ${this.id}] Execution failed:`, error);
            await this.rollback();
            
            return {
                success: false,
                transactionId: this.id,
                error: error as Error,
                duration: new Date().getTime() - this.startTime.getTime()
            };
        }
    }
    
    private async executeStep(step: TransactionStep): Promise<void> {
        console.log(`[Transaction ${this.id}] Executing step: ${step.name}`);
        
        // Validate before executing
        if (step.validate) {
            const valid = await step.validate();
            if (!valid) {
                throw new Error(`Step validation failed: ${step.name}`);
            }
        }
        
        // Execute the step
        await step.execute();
        this.completedSteps.push(step.name);
        
        console.log(`[Transaction ${this.id}] Step completed: ${step.name}`);
    }
    
    public async rollback(): Promise<void> {
        console.log(`[Transaction ${this.id}] Rolling back transaction`);
        this.state = FileOperationState.ROLLING_BACK;
        
        if (!this.snapshot) {
            console.warn(`[Transaction ${this.id}] No snapshot available for rollback`);
            return;
        }
        
        // Rollback steps in reverse order
        const stepsToRollback = [...this.steps].reverse();
        
        for (const step of stepsToRollback) {
            if (this.completedSteps.includes(step.name)) {
                try {
                    console.log(`[Transaction ${this.id}] Rolling back step: ${step.name}`);
                    await step.rollback();
                } catch (error) {
                    console.error(`[Transaction ${this.id}] Rollback failed for step ${step.name}:`, error);
                    // Continue rolling back other steps
                }
            }
        }
        
        // Restore snapshot
        await this.restoreSnapshot(this.snapshot);
        
        this.state = FileOperationState.FAILED;
        this.endTime = new Date();
    }
    
    private async takeSnapshot(): Promise<TransactionSnapshot> {
        // Implementation to capture current state
        // This will be implemented in Phase 2
        return {
            timestamp: new Date(),
            fileStates: new Map(),
            cacheStates: new Map(),
            registryState: {} as RegistrySnapshot
        };
    }
    
    private async restoreSnapshot(snapshot: TransactionSnapshot): Promise<void> {
        // Implementation to restore from snapshot
        // This will be implemented in Phase 2
    }
    
    public getState(): FileOperationState {
        return this.state;
    }
    
    public getDuration(): number | null {
        if (!this.endTime) return null;
        return this.endTime.getTime() - this.startTime.getTime();
    }
}
```

#### 1.2 Transaction Lock Manager

```typescript
// src/core/transactions/TransactionLock.ts

export interface FileLock {
    path: string;
    transactionId: string;
    acquiredAt: Date;
    expiresAt: Date;
}

export class TransactionLockManager {
    private locks: Map<string, FileLock> = new Map();
    private readonly DEFAULT_LOCK_TIMEOUT_MS = 30000; // 30 seconds
    
    /**
     * Acquire locks for multiple files
     * Waits if files are currently locked
     */
    public async acquireLocks(
        paths: string[], 
        transactionId: string
    ): Promise<void> {
        console.log(`[LockManager] Attempting to acquire locks for transaction ${transactionId}`);
        console.log(`[LockManager] Files: ${paths.join(', ')}`);
        
        // Normalize paths
        const normalizedPaths = paths.map(p => this.normalizePath(p));
        
        // Wait for all locks to be available
        await this.waitForLocks(normalizedPaths);
        
        // Acquire all locks atomically
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.DEFAULT_LOCK_TIMEOUT_MS);
        
        for (const path of normalizedPaths) {
            this.locks.set(path, {
                path,
                transactionId,
                acquiredAt: now,
                expiresAt
            });
        }
        
        console.log(`[LockManager] Locks acquired for transaction ${transactionId}`);
    }
    
    /**
     * Release locks for a transaction
     */
    public releaseLocks(transactionId: string): void {
        console.log(`[LockManager] Releasing locks for transaction ${transactionId}`);
        
        const pathsToRelease: string[] = [];
        
        for (const [path, lock] of this.locks.entries()) {
            if (lock.transactionId === transactionId) {
                pathsToRelease.push(path);
            }
        }
        
        for (const path of pathsToRelease) {
            this.locks.delete(path);
        }
        
        console.log(`[LockManager] Released ${pathsToRelease.length} locks`);
    }
    
    /**
     * Wait for locks to become available
     */
    private async waitForLocks(paths: string[]): Promise<void> {
        const maxWaitTime = 60000; // 60 seconds max wait
        const checkInterval = 100; // Check every 100ms
        const startTime = Date.now();
        
        while (true) {
            // Check if any locks are held
            const blockedPaths = paths.filter(p => this.isLocked(p));
            
            if (blockedPaths.length === 0) {
                // All locks available
                return;
            }
            
            // Check timeout
            if (Date.now() - startTime > maxWaitTime) {
                throw new Error(`Lock timeout: waiting for ${blockedPaths.join(', ')}`);
            }
            
            // Clean expired locks
            this.cleanExpiredLocks();
            
            // Wait and retry
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
    }
    
    /**
     * Check if a file is currently locked
     */
    private isLocked(path: string): boolean {
        const normalizedPath = this.normalizePath(path);
        const lock = this.locks.get(normalizedPath);
        
        if (!lock) return false;
        
        // Check if lock expired
        if (new Date() > lock.expiresAt) {
            this.locks.delete(normalizedPath);
            return false;
        }
        
        return true;
    }
    
    /**
     * Clean up expired locks
     */
    private cleanExpiredLocks(): void {
        const now = new Date();
        const pathsToDelete: string[] = [];
        
        for (const [path, lock] of this.locks.entries()) {
            if (now > lock.expiresAt) {
                pathsToDelete.push(path);
                console.warn(`[LockManager] Cleaning expired lock for ${path} from transaction ${lock.transactionId}`);
            }
        }
        
        for (const path of pathsToDelete) {
            this.locks.delete(path);
        }
    }
    
    private normalizePath(path: string): string {
        return path.trim().toLowerCase().replace(/\\/g, '/');
    }
    
    /**
     * Get lock info for debugging
     */
    public getLockInfo(): Map<string, FileLock> {
        return new Map(this.locks);
    }
}
```

#### 1.3 Transaction Manager

```typescript
// src/core/transactions/IncludeFileTransactionManager.ts

import { Transaction, TransactionSnapshot } from './Transaction';
import { TransactionLockManager } from './TransactionLock';
import { MarkdownFileRegistry } from '../../files/MarkdownFileRegistry';
import { ConflictResolver } from '../../conflictResolver';

export enum TransactionType {
    SWITCH_INCLUDE_FILES = 'switch_include_files',
    LOAD_INCLUDE_FILES = 'load_include_files',
    UNLOAD_INCLUDE_FILES = 'unload_include_files',
    SAVE_INCLUDE_FILES = 'save_include_files',
    RELOAD_INCLUDE_FILES = 'reload_include_files',
    UPDATE_CONTENT = 'update_content'
}

export interface SwitchIncludeFilesOptions {
    columnId?: string;
    taskId?: string;
    oldPaths: string[];
    newPaths: string[];
    skipSavePrompt?: boolean;
}

export class IncludeFileTransactionManager {
    private static instance: IncludeFileTransactionManager | undefined;
    
    private lockManager: TransactionLockManager;
    private activeTransactions: Map<string, Transaction> = new Map();
    private transactionQueue: Transaction[] = [];
    
    private constructor(
        private fileRegistry: MarkdownFileRegistry,
        private conflictResolver: ConflictResolver
    ) {
        this.lockManager = new TransactionLockManager();
    }
    
    public static getInstance(
        fileRegistry: MarkdownFileRegistry,
        conflictResolver: ConflictResolver
    ): IncludeFileTransactionManager {
        if (!IncludeFileTransactionManager.instance) {
            IncludeFileTransactionManager.instance = new IncludeFileTransactionManager(
                fileRegistry,
                conflictResolver
            );
        }
        return IncludeFileTransactionManager.instance;
    }
    
    /**
     * MAIN ENTRY POINT: Switch include files
     */
    public async switchIncludeFiles(options: SwitchIncludeFilesOptions): Promise<void> {
        console.log(`[TransactionManager] switchIncludeFiles called`);
        console.log(`  Old paths: ${options.oldPaths.join(', ')}`);
        console.log(`  New paths: ${options.newPaths.join(', ')}`);
        
        const affectedFiles = [...options.oldPaths, ...options.newPaths];
        const transaction = new Transaction(
            TransactionType.SWITCH_INCLUDE_FILES,
            affectedFiles
        );
        
        // Build transaction steps
        this.buildSwitchIncludeFilesSteps(transaction, options);
        
        // Execute transaction
        await this.executeTransaction(transaction);
    }
    
    /**
     * Build steps for switching include files
     */
    private buildSwitchIncludeFilesSteps(
        transaction: Transaction,
        options: SwitchIncludeFilesOptions
    ): void {
        const { oldPaths, newPaths, skipSavePrompt } = options;
        
        // Step 1: Check for unsaved changes
        transaction.addStep({
            name: 'CHECK_UNSAVED_CHANGES',
            execute: async () => {
                const unsavedFiles = oldPaths.filter(path => {
                    const file = this.fileRegistry.getByRelativePath(path);
                    return file?.hasUnsavedChanges() || false;
                });
                
                // Store in transaction context for next step
                (transaction as any)._unsavedFiles = unsavedFiles;
            },
            rollback: async () => {
                // No rollback needed for check
            }
        });
        
        // Step 2: Prompt user to save if needed
        if (!skipSavePrompt) {
            transaction.addStep({
                name: 'PROMPT_SAVE_IF_NEEDED',
                execute: async () => {
                    const unsavedFiles = (transaction as any)._unsavedFiles || [];
                    
                    if (unsavedFiles.length > 0) {
                        const shouldSave = await this.promptSaveChanges(unsavedFiles);
                        
                        if (shouldSave === 'save') {
                            // Save files
                            await this.saveFiles(unsavedFiles);
                        } else if (shouldSave === 'cancel') {
                            throw new Error('User cancelled operation');
                        }
                        // 'discard' - continue without saving
                    }
                },
                rollback: async () => {
                    // No rollback needed
                }
            });
        }
        
        // Step 3: Unload old files
        transaction.addStep({
            name: 'UNLOAD_OLD_FILES',
            execute: async () => {
                console.log(`[Transaction] Unloading old files: ${oldPaths.join(', ')}`);
                
                for (const path of oldPaths) {
                    const file = this.fileRegistry.getByRelativePath(path);
                    if (file) {
                        // Stop watching
                        file.stopWatching();
                        
                        // Unregister from registry
                        this.fileRegistry.unregister(file.getPath());
                    }
                }
            },
            rollback: async () => {
                console.log(`[Transaction] Rollback: Re-loading old files`);
                // Re-register and start watching old files
                // Implementation depends on file factory
            }
        });
        
        // Step 4: Clear caches
        transaction.addStep({
            name: 'CLEAR_CACHES',
            execute: async () => {
                console.log(`[Transaction] Clearing caches`);
                // Clear frontend cache
                // Clear backend cache
                // This will be implemented with CacheCoordinator
            },
            rollback: async () => {
                // Restore caches from snapshot
            }
        });
        
        // Step 5: Load new files
        transaction.addStep({
            name: 'LOAD_NEW_FILES',
            execute: async () => {
                console.log(`[Transaction] Loading new files: ${newPaths.join(', ')}`);
                
                for (const path of newPaths) {
                    // Create file object (using FileFactory)
                    // Register in registry
                    // Start watching
                    // Load content from disk
                }
            },
            rollback: async () => {
                console.log(`[Transaction] Rollback: Unloading new files`);
                // Unregister new files
            }
        });
        
        // Step 6: Update caches
        transaction.addStep({
            name: 'UPDATE_CACHES',
            execute: async () => {
                console.log(`[Transaction] Updating caches`);
                // Update backend cache with new file contents
                // Prepare data for frontend
            },
            rollback: async () => {
                // Restore previous cache state
            }
        });
        
        // Step 7: Refresh UI
        transaction.addStep({
            name: 'REFRESH_UI',
            execute: async () => {
                console.log(`[Transaction] Refreshing UI`);
                // Send update to webview
                // This will be implemented with message passing
            },
            rollback: async () => {
                // Restore previous UI state
            }
        });
    }
    
    /**
     * Execute a transaction with lock management
     */
    private async executeTransaction(transaction: Transaction): Promise<void> {
        try {
            // Add to active transactions
            this.activeTransactions.set(transaction.id, transaction);
            
            // Acquire locks
            await this.lockManager.acquireLocks(
                transaction.affectedFiles,
                transaction.id
            );
            
            // Execute transaction
            const result = await transaction.execute();
            
            if (!result.success) {
                console.error(`[TransactionManager] Transaction ${transaction.id} failed:`, result.error);
                throw result.error;
            }
            
            console.log(`[TransactionManager] Transaction ${transaction.id} completed in ${result.duration}ms`);
        } finally {
            // Release locks
            this.lockManager.releaseLocks(transaction.id);
            
            // Remove from active transactions
            this.activeTransactions.delete(transaction.id);
        }
    }
    
    /**
     * Prompt user to save changes
     */
    private async promptSaveChanges(unsavedFiles: string[]): Promise<'save' | 'discard' | 'cancel'> {
        // Use ConflictResolver to show dialog
        const context = {
            type: 'panel_close' as const,
            fileType: 'include' as const,
            filePath: unsavedFiles[0],
            fileName: unsavedFiles[0],
            hasMainUnsavedChanges: false,
            hasIncludeUnsavedChanges: true,
            changedIncludeFiles: unsavedFiles
        };
        
        const resolution = await this.conflictResolver.resolveConflict(context);
        
        if (resolution.shouldSave) return 'save';
        if (resolution.shouldReload) return 'discard';
        return 'cancel';
    }
    
    /**
     * Save multiple files
     */
    private async saveFiles(paths: string[]): Promise<void> {
        for (const path of paths) {
            const file = this.fileRegistry.getByRelativePath(path);
            if (file && file.hasUnsavedChanges()) {
                await file.save();
            }
        }
    }
}
```

### Phase 2: Cache Coordination

```typescript
// src/core/cache/CacheCoordinator.ts

export interface CacheEntry {
    key: string;
    value: any;
    timestamp: Date;
}

export interface CacheSnapshot {
    timestamp: Date;
    entries: Map<string, CacheEntry>;
}

/**
 * Coordinates all caches (frontend and backend)
 */
export class CacheCoordinator {
    private backendCache: Map<string, CacheEntry> = new Map();
    private snapshots: Map<string, CacheSnapshot> = new Map();
    
    /**
     * Take a snapshot of current cache state
     */
    public async takeSnapshot(snapshotId: string): Promise<void> {
        console.log(`[CacheCoordinator] Taking snapshot: ${snapshotId}`);
        
        const snapshot: CacheSnapshot = {
            timestamp: new Date(),
            entries: new Map(this.backendCache)
        };
        
        this.snapshots.set(snapshotId, snapshot);
    }
    
    /**
     * Restore cache from snapshot
     */
    public async restoreSnapshot(snapshotId: string): Promise<void> {
        console.log(`[CacheCoordinator] Restoring snapshot: ${snapshotId}`);
        
        const snapshot = this.snapshots.get(snapshotId);
        if (!snapshot) {
            throw new Error(`Snapshot not found: ${snapshotId}`);
        }
        
        this.backendCache = new Map(snapshot.entries);
    }
    
    /**
     * Clear all caches
     */
    public async clearAll(): Promise<void> {
        console.log(`[CacheCoordinator] Clearing all caches`);
        this.backendCache.clear();
        
        // Also clear frontend cache via message
        // (will be implemented with webview communication)
    }
    
    /**
     * Update cache entry
     */
    public set(key: string, value: any): void {
        this.backendCache.set(key, {
            key,
            value,
            timestamp: new Date()
        });
    }
    
    /**
     * Get cache entry
     */
    public get(key: string): any {
        return this.backendCache.get(key)?.value;
    }
    
    /**
     * Delete cache entry
     */
    public delete(key: string): void {
        this.backendCache.delete(key);
    }
}
```

### Phase 3: Integration Points

#### 3.1 Update IncludeFileManager

```typescript
// src/includeFileManager.ts - NEW METHOD

export class IncludeFileManager {
    private transactionManager?: IncludeFileTransactionManager;
    
    public setTransactionManager(manager: IncludeFileTransactionManager): void {
        this.transactionManager = manager;
    }
    
    /**
     * NEW ENTRY POINT: Use transaction manager for switching
     */
    public async switchIncludeFilesTransactional(
        oldPaths: string[],
        newPaths: string[],
        columnId?: string,
        taskId?: string
    ): Promise<void> {
        if (!this.transactionManager) {
            throw new Error('Transaction manager not initialized');
        }
        
        await this.transactionManager.switchIncludeFiles({
            oldPaths,
            newPaths,
            columnId,
            taskId
        });
    }
}
```

#### 3.2 Update Message Handler

```typescript
// src/messageHandler.ts or wherever include file switching is triggered

async function handleIncludeFileSwitch(message: any): Promise<void> {
    const { oldPaths, newPaths, columnId, taskId } = message;
    
    // Use transaction manager instead of direct calls
    await includeFileManager.switchIncludeFilesTransactional(
        oldPaths,
        newPaths,
        columnId,
        taskId
    );
}
```

## Migration Strategy (Complete Replacement - No Fallback)

### Week 1: Core Infrastructure + Deletion of Old Code
- [ ] **DELETE old include file switching logic** from includeFileManager.ts
- [ ] **DELETE** all non-transactional change handling methods
- [ ] Implement Transaction class
- [ ] Implement TransactionLockManager
- [ ] Write unit tests for locking
- [ ] Implement basic IncludeFileTransactionManager

### Week 2: Cache Coordination + More Deletions
- [ ] **DELETE** old cache handling code
- [ ] **DELETE** duplicate entry points for file operations
- [ ] Implement CacheCoordinator
- [ ] Add snapshot/restore functionality
- [ ] Integrate with MarkdownFileRegistry
- [ ] Test cache operations

### Week 3: Complete Integration (Replace Everything)
- [ ] **REPLACE** all includeFileManager methods with transactional versions
- [ ] **REPLACE** message handlers to use ONLY transactions
- [ ] **DELETE** UnifiedChangeHandler (replace with transaction-based handling)
- [ ] Add transaction logging
- [ ] Add error recovery
- [ ] **NO OLD CODE REMAINS**

### Week 4: Testing & Refinement
- [ ] Integration tests
- [ ] Test rollback scenarios
- [ ] Performance testing
- [ ] Handle edge cases
- [ ] **VERIFY no old code paths exist**

## Testing Strategy

### Unit Tests

```typescript
describe('TransactionLockManager', () => {
    it('should acquire locks for multiple files', async () => {
        const lockManager = new TransactionLockManager();
        await lockManager.acquireLocks(['file1.md', 'file2.md'], 'txn1');
        // Assert locks acquired
    });
    
    it('should wait for locks to be released', async () => {
        const lockManager = new TransactionLockManager();
        await lockManager.acquireLocks(['file1.md'], 'txn1');
        
        // Try to acquire same lock from different transaction
        const promise = lockManager.acquireLocks(['file1.md'], 'txn2');
        
        // Release first lock
        lockManager.releaseLocks('txn1');
        
        // Second acquisition should succeed
        await promise;
    });
});
```

### Integration Tests

```typescript
describe('IncludeFileTransactionManager', () => {
    it('should switch include files atomically', async () => {
        const manager = IncludeFileTransactionManager.getInstance(
            fileRegistry,
            conflictResolver
        );
        
        await manager.switchIncludeFiles({
            oldPaths: ['old1.md', 'old2.md'],
            newPaths: ['new1.md', 'new2.md']
        });
        
        // Assert old files unloaded
        // Assert new files loaded
        // Assert caches updated
    });
    
    it('should rollback on error', async () => {
        // Test rollback behavior
    });
});
```

## Monitoring & Debugging

### Transaction Logging

```typescript
// src/core/transactions/TransactionLog.ts

export class TransactionLog {
    private logs: TransactionLogEntry[] = [];
    
    public log(transaction: Transaction, event: string, details?: any): void {
        this.logs.push({
            transactionId: transaction.id,
            timestamp: new Date(),
            event,
            state: transaction.getState(),
            details
        });
    }
    
    public getLogsForTransaction(transactionId: string): TransactionLogEntry[] {
        return this.logs.filter(l => l.transactionId === transactionId);
    }
    
    public exportLogs(): string {
        return JSON.stringify(this.logs, null, 2);
    }
}
```

## Benefits of This Implementation

1. **Single Entry Point**: All include file operations go through TransactionManager
2. **Atomic Operations**: Either all steps succeed or all rollback
3. **No Race Conditions**: File locks prevent concurrent modifications
4. **Debuggable**: Transaction logs show exactly what happened
5. **Testable**: Each component can be tested independently
6. **Extensible**: Easy to add new transaction types

## Next Steps

1. Review this implementation plan
2. Create feature branch `feature/transaction-manager`
3. Start with Phase 1 (Core Infrastructure)
4. Add tests as you go
5. Integrate gradually, keeping old code as fallback
6. Delete old code once fully tested
