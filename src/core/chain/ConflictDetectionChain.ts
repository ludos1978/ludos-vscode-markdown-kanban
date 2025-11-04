import { ConflictContext, Conflict } from '../types/ConflictTypes';

/**
 * Chain of Responsibility Pattern - Conflict Detection Chain
 *
 * Processes conflict detection through a chain of rules, allowing each rule
 * to handle specific types of conflicts or pass to the next rule.
 */

export interface IConflictDetectionHandler {
    /**
     * Set the next handler in the chain
     */
    setNext(handler: IConflictDetectionHandler): IConflictDetectionHandler;

    /**
     * Handle conflict detection for the given context
     */
    handle(context: ConflictContext): Promise<Conflict[]>;
}

/**
 * Abstract base handler for conflict detection
 */
export abstract class AbstractConflictHandler implements IConflictDetectionHandler {
    private nextHandler?: IConflictDetectionHandler;

    setNext(handler: IConflictDetectionHandler): IConflictDetectionHandler {
        this.nextHandler = handler;
        return handler;
    }

    protected async handleNext(context: ConflictContext): Promise<Conflict[]> {
        if (this.nextHandler) {
            return await this.nextHandler.handle(context);
        }
        return [];
    }

    abstract handle(context: ConflictContext): Promise<Conflict[]>;
}

/**
 * Concurrent Modification Handler
 * Detects when user has unsaved changes and external file was modified
 */
export class ConcurrentModificationHandler extends AbstractConflictHandler {
    async handle(context: ConflictContext): Promise<Conflict[]> {
        console.log(`[ConcurrentHandler] Checking for concurrent modifications`);

        const conflicts: Conflict[] = [];

        // Check if user has unsaved changes
        if (context.hasUnsavedChanges) {
            // Check for external changes
            const hasExternalChanges = await this.checkForExternalChanges(context);

            if (hasExternalChanges) {
                conflicts.push({
                    id: `concurrent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'concurrent-modification',
                    severity: 'high',
                    description: 'File has both local changes and external modifications',
                    details: 'You have unsaved changes and the file was modified externally. Choose how to resolve this conflict.',
                    context,
                    timestamp: new Date(),
                    suggestedResolutions: [
                        {
                            action: 'save',
                            description: 'Save current changes',
                            shouldProceed: true,
                            shouldCreateBackup: false,
                            shouldSave: true,
                            shouldReload: false,
                            shouldIgnore: false
                        },
                        {
                            action: 'backup_and_reload',
                            description: 'Backup current changes and reload external',
                            shouldProceed: true,
                            shouldCreateBackup: true,
                            shouldSave: false,
                            shouldReload: true,
                            shouldIgnore: false
                        }
                    ]
                });

                console.log(`[ConcurrentHandler] Detected concurrent modification conflict`);
                return conflicts; // Stop chain - this is a critical conflict
            }
        }

        // Continue to next handler
        return [...conflicts, ...(await this.handleNext(context))];
    }

    private async checkForExternalChanges(context: ConflictContext): Promise<boolean> {
        // This would check file system for external changes
        // For now, simulate based on context
        return Math.random() > 0.7; // 30% chance for demo
    }
}

/**
 * File Lock Handler
 * Detects when file is locked by another process
 */
export class FileLockHandler extends AbstractConflictHandler {
    async handle(context: ConflictContext): Promise<Conflict[]> {
        console.log(`[FileLockHandler] Checking for file locks`);

        const conflicts: Conflict[] = [];

        const isLocked = await this.checkFileLock(context.filePath);

        if (isLocked) {
            conflicts.push({
                id: `lock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'file-locked',
                severity: 'high',
                description: 'File is locked by another process',
                details: 'The file cannot be accessed because it is locked by another application.',
                context,
                timestamp: new Date(),
                suggestedResolutions: [
                    {
                        action: 'ignore',
                        description: 'Wait and try again later',
                        shouldProceed: false,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: false,
                        shouldIgnore: true
                    }
                ]
            });

            console.log(`[FileLockHandler] Detected file lock conflict`);
            return conflicts; // Stop chain - cannot proceed
        }

        return [...conflicts, ...(await this.handleNext(context))];
    }

    private async checkFileLock(filePath: string): Promise<boolean> {
        // This would check if file is locked by another process
        // For now, simulate based on file path
        return filePath.includes('locked'); // Demo logic
    }
}

/**
 * Permission Handler
 * Detects permission issues
 */
export class PermissionHandler extends AbstractConflictHandler {
    async handle(context: ConflictContext): Promise<Conflict[]> {
        console.log(`[PermissionHandler] Checking file permissions`);

        const conflicts: Conflict[] = [];

        const hasPermission = await this.checkPermissions(context.filePath);

        if (!hasPermission) {
            conflicts.push({
                id: `permission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'permission-denied',
                severity: 'critical',
                description: 'Insufficient permissions to access file',
                details: 'You do not have permission to read or write to this file.',
                context,
                timestamp: new Date(),
                suggestedResolutions: [
                    {
                        action: 'cancel',
                        description: 'Operation cancelled',
                        shouldProceed: false,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: false,
                        shouldIgnore: false
                    }
                ]
            });

            console.log(`[PermissionHandler] Detected permission conflict`);
            return conflicts; // Stop chain - cannot proceed
        }

        return [...conflicts, ...(await this.handleNext(context))];
    }

    private async checkPermissions(filePath: string): Promise<boolean> {
        // This would check file permissions
        // For now, always return true
        return true;
    }
}

/**
 * Disk Space Handler
 * Detects low disk space issues
 */
export class DiskSpaceHandler extends AbstractConflictHandler {
    async handle(context: ConflictContext): Promise<Conflict[]> {
        console.log(`[DiskSpaceHandler] Checking available disk space`);

        const conflicts: Conflict[] = [];

        const hasSpace = await this.checkDiskSpace();

        if (!hasSpace) {
            conflicts.push({
                id: `disk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'network-error', // Reusing existing type
                severity: 'high',
                description: 'Insufficient disk space',
                details: 'There is not enough disk space to complete this operation.',
                context,
                timestamp: new Date(),
                suggestedResolutions: [
                    {
                        action: 'cancel',
                        description: 'Free up disk space and try again',
                        shouldProceed: false,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: false,
                        shouldIgnore: false
                    }
                ]
            });

            console.log(`[DiskSpaceHandler] Detected disk space conflict`);
            return conflicts; // Stop chain - cannot proceed
        }

        return [...conflicts, ...(await this.handleNext(context))];
    }

    private async checkDiskSpace(): Promise<boolean> {
        // This would check available disk space
        // For now, always return true
        return true;
    }
}

/**
 * Network Handler (for remote files)
 * Detects network connectivity issues
 */
export class NetworkHandler extends AbstractConflictHandler {
    async handle(context: ConflictContext): Promise<Conflict[]> {
        console.log(`[NetworkHandler] Checking network connectivity`);

        const conflicts: Conflict[] = [];

        const isNetworkAvailable = await this.checkNetworkConnectivity(context.filePath);

        if (!isNetworkAvailable) {
            conflicts.push({
                id: `network_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'network-error',
                severity: 'high',
                description: 'Network connectivity issue',
                details: 'Cannot access remote file due to network connectivity problems.',
                context,
                timestamp: new Date(),
                suggestedResolutions: [
                    {
                        action: 'ignore',
                        description: 'Retry when network is available',
                        shouldProceed: false,
                        shouldCreateBackup: false,
                        shouldSave: false,
                        shouldReload: false,
                        shouldIgnore: true
                    }
                ]
            });

            console.log(`[NetworkHandler] Detected network conflict`);
            return conflicts; // Stop chain - cannot proceed
        }

        return [...conflicts, ...(await this.handleNext(context))];
    }

    private async checkNetworkConnectivity(filePath: string): Promise<boolean> {
        // This would check network connectivity for remote files
        // For now, always return true
        return true;
    }
}

/**
 * Conflict Detection Chain Builder
 */
export class ConflictDetectionChainBuilder {
    private handlers: IConflictDetectionHandler[] = [];

    /**
     * Add a handler to the chain
     */
    addHandler(handler: IConflictDetectionHandler): ConflictDetectionChainBuilder {
        this.handlers.push(handler);
        return this;
    }

    /**
     * Build the chain by linking handlers
     */
    build(): IConflictDetectionHandler | null {
        if (this.handlers.length === 0) {
            return null;
        }

        // Link handlers in chain
        for (let i = 0; i < this.handlers.length - 1; i++) {
            this.handlers[i].setNext(this.handlers[i + 1]);
        }

        return this.handlers[0];
    }

    /**
     * Create a default conflict detection chain
     */
    static createDefaultChain(): IConflictDetectionHandler {
        return new ConflictDetectionChainBuilder()
            .addHandler(new PermissionHandler())
            .addHandler(new FileLockHandler())
            .addHandler(new DiskSpaceHandler())
            .addHandler(new NetworkHandler())
            .addHandler(new ConcurrentModificationHandler())
            .build()!;
    }
}

/**
 * Conflict Detection Chain Manager
 */
export class ConflictDetectionChainManager {
    private chain: IConflictDetectionHandler;

    constructor() {
        this.chain = ConflictDetectionChainBuilder.createDefaultChain();
    }

    /**
     * Detect conflicts using the chain
     */
    async detectConflicts(context: ConflictContext): Promise<Conflict[]> {
        console.log(`[ChainManager] Starting conflict detection chain for: ${context.filePath}`);

        const conflicts = await this.chain.handle(context);

        console.log(`[ChainManager] Chain completed, found ${conflicts.length} conflicts`);
        return conflicts;
    }

    /**
     * Replace the entire chain
     */
    setChain(chain: IConflictDetectionHandler): void {
        this.chain = chain;
    }

    /**
     * Get the current chain (for inspection/testing)
     */
    getChain(): IConflictDetectionHandler {
        return this.chain;
    }
}
