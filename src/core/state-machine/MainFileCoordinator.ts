/**
 * Main File Coordinator
 *
 * Orchestrates all file changes through a unified state machine:
 * 1. DETECTING_CHANGES: Identify what changed (main, includes, switches)
 * 2. ANALYZING: Determine proper handling flow
 * 3. COORDINATING_INCLUDES: Handle include switches/updates
 * 4. UPDATING_UI: Refresh frontend
 * 5. STABLE: Ready for next change
 *
 * This is the single entry point for all content changes, ensuring proper ordering
 * and preventing race conditions.
 */

import {
    CoordinatorState,
    ChangeAnalysis,
    ChangeType,
    FileState,
    StateMachineConfig,
    StateTransition
} from './FileStateTypes';
import { FileStateMachine } from './FileStateMachine';
import { IncludeFileStateMachine } from './IncludeFileStateMachine';

export interface CoordinatorContext {
    state: CoordinatorState;
    currentOperation?: string;
    transitionHistory: StateTransition[];
}

export interface IncludeFileRef {
    relativePath: string;
    stateMachine: IncludeFileStateMachine;
    fileType: 'column' | 'task' | 'regular';
}

export class MainFileCoordinator {
    private context: CoordinatorContext;
    private mainFileStateMachine: FileStateMachine;
    private includeFiles: Map<string, IncludeFileRef>;
    private config: StateMachineConfig;
    private operationLock: boolean = false;
    private pendingOperations: Array<() => Promise<void>> = [];

    constructor(
        mainFilePath: string,
        config?: Partial<StateMachineConfig>
    ) {
        this.config = {
            enableLogging: true,
            maxHistorySize: 50,
            enableAutoRollback: true,
            ...config
        };

        this.mainFileStateMachine = new FileStateMachine(mainFilePath, this.config);
        this.includeFiles = new Map();

        this.context = {
            state: CoordinatorState.STABLE,
            transitionHistory: []
        };
    }

    /**
     * Get current coordinator state
     */
    public getState(): CoordinatorState {
        return this.context.state;
    }

    /**
     * Check if coordinator is stable
     */
    public isStable(): boolean {
        return this.context.state === CoordinatorState.STABLE && !this.operationLock;
    }

    /**
     * Register an include file
     */
    public registerIncludeFile(
        relativePath: string,
        fileType: 'column' | 'task' | 'regular',
        absolutePath: string
    ): void {
        if (!this.includeFiles.has(relativePath)) {
            const stateMachine = new IncludeFileStateMachine(absolutePath, this.config);
            this.includeFiles.set(relativePath, {
                relativePath,
                stateMachine,
                fileType
            });

            if (this.config.enableLogging) {
            }
        }
    }

    /**
     * Unregister an include file
     */
    public unregisterIncludeFile(relativePath: string): void {
        const ref = this.includeFiles.get(relativePath);
        if (ref) {
            // Mark as disposed
            if (!ref.stateMachine.isDisposed()) {
                try {
                    // Transition to disposed if possible
                    if (ref.stateMachine.isUnloading()) {
                        ref.stateMachine.completeUnload();
                    }
                } catch (error) {
                    console.warn(`[MainFileCoordinator] Error disposing ${relativePath}:`, error);
                }
            }

            this.includeFiles.delete(relativePath);

            if (this.config.enableLogging) {
            }
        }
    }

    /**
     * Get include file state machine
     */
    public getIncludeFile(relativePath: string): IncludeFileStateMachine | undefined {
        return this.includeFiles.get(relativePath)?.stateMachine;
    }

    /**
     * Get all include files
     */
    public getAllIncludeFiles(): IncludeFileRef[] {
        return Array.from(this.includeFiles.values());
    }

    /**
     * Single entry point for ALL content changes
     * Ensures proper ordering and prevents race conditions
     */
    public async handleChange(params: {
        source: 'file_watcher' | 'ui' | 'external' | 'save';
        hasMainChange: boolean;
        hasIncludeChanges: boolean;
        hasSwitchedIncludes: boolean;
        onAnalyze?: () => Promise<ChangeAnalysis>;
        onCoordinateIncludes?: (analysis: ChangeAnalysis) => Promise<void>;
        onUpdateUI?: () => Promise<void>;
        onConflict?: (analysis: ChangeAnalysis) => Promise<void>;
    }): Promise<void> {
        // Queue if locked
        if (this.operationLock) {
            if (this.config.enableLogging) {
            }

            return new Promise((resolve, reject) => {
                this.pendingOperations.push(async () => {
                    try {
                        await this.handleChange(params);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        }

        // Acquire lock
        this.operationLock = true;

        try {
            await this.executeChangeFlow(params);
        } finally {
            // Release lock
            this.operationLock = false;

            // Process next queued operation
            if (this.pendingOperations.length > 0) {
                const nextOp = this.pendingOperations.shift();
                if (nextOp) {
                    // Don't await - let it run asynchronously
                    nextOp().catch(error => {
                        console.error('[MainFileCoordinator] Error in queued operation:', error);
                    });
                }
            }
        }
    }

    /**
     * Execute the change flow through state machine
     */
    private async executeChangeFlow(params: {
        source: string;
        hasMainChange: boolean;
        hasIncludeChanges: boolean;
        hasSwitchedIncludes: boolean;
        onAnalyze?: () => Promise<ChangeAnalysis>;
        onCoordinateIncludes?: (analysis: ChangeAnalysis) => Promise<void>;
        onUpdateUI?: () => Promise<void>;
        onConflict?: (analysis: ChangeAnalysis) => Promise<void>;
    }): Promise<void> {
        // Step 1: DETECTING_CHANGES
        this.transitionState(
            CoordinatorState.DETECTING_CHANGES,
            `Detecting changes from ${params.source}`
        );

        // Step 2: ANALYZING
        this.transitionState(
            CoordinatorState.ANALYZING,
            'Analyzing changes to determine flow'
        );

        let analysis: ChangeAnalysis | undefined;
        if (params.onAnalyze) {
            analysis = await params.onAnalyze();

            if (this.config.enableLogging) {
            }

            // Check for conflicts
            if (!analysis.isLegitimateSave && analysis.hasMainStructureChange) {
                const hasAnyDirty = this.mainFileStateMachine.isDirty() ||
                                   Array.from(this.includeFiles.values()).some(
                                       ref => ref.stateMachine.isDirty()
                                   );

                if (hasAnyDirty) {
                    // Enter conflict resolution
                    this.transitionState(
                        CoordinatorState.CONFLICT_RESOLUTION,
                        'Conflict detected: external changes + unsaved changes'
                    );

                    if (params.onConflict) {
                        await params.onConflict(analysis);
                    }

                    // Return to stable after conflict resolution
                    this.transitionState(CoordinatorState.STABLE, 'Conflict resolved');
                    return;
                }
            }
        }

        // Step 3: COORDINATING_INCLUDES (if needed)
        if (params.hasSwitchedIncludes || params.hasIncludeChanges) {
            this.transitionState(
                CoordinatorState.COORDINATING_INCLUDES,
                'Coordinating include file operations'
            );

            if (analysis && params.onCoordinateIncludes) {
                await params.onCoordinateIncludes(analysis);
            }
        }

        // Step 4: UPDATING_UI
        this.transitionState(
            CoordinatorState.UPDATING_UI,
            'Updating UI with changes'
        );

        if (params.onUpdateUI) {
            await params.onUpdateUI();
        }

        // Step 5: Return to STABLE
        this.transitionState(CoordinatorState.STABLE, 'Change flow complete');
    }

    /**
     * Transition coordinator state
     */
    private transitionState(newState: CoordinatorState, reason?: string): void {
        const oldState = this.context.state;

        // Validate transition
        if (!this.isValidCoordinatorTransition(oldState, newState)) {
            const error = new Error(
                `Invalid coordinator transition: ${oldState} → ${newState}`
            );
            console.error('[MainFileCoordinator]', error.message);
            throw error;
        }

        // Record transition
        const transition: StateTransition = {
            from: oldState,
            to: newState,
            timestamp: Date.now(),
            reason
        };

        this.context.transitionHistory.push(transition);

        // Trim history
        if (this.context.transitionHistory.length > this.config.maxHistorySize) {
            this.context.transitionHistory.shift();
        }

        // Update state
        this.context.state = newState;

        if (this.config.enableLogging) {
        }
    }

    /**
     * Validate coordinator state transition
     */
    private isValidCoordinatorTransition(
        from: CoordinatorState,
        to: CoordinatorState
    ): boolean {
        const validTransitions: Record<CoordinatorState, CoordinatorState[]> = {
            [CoordinatorState.STABLE]: [
                CoordinatorState.DETECTING_CHANGES,
                CoordinatorState.CONFLICT_RESOLUTION
            ],
            [CoordinatorState.DETECTING_CHANGES]: [
                CoordinatorState.ANALYZING,
                CoordinatorState.STABLE  // If no changes detected
            ],
            [CoordinatorState.ANALYZING]: [
                CoordinatorState.COORDINATING_INCLUDES,
                CoordinatorState.UPDATING_UI,
                CoordinatorState.CONFLICT_RESOLUTION,
                CoordinatorState.STABLE
            ],
            [CoordinatorState.COORDINATING_INCLUDES]: [
                CoordinatorState.UPDATING_UI,
                CoordinatorState.STABLE
            ],
            [CoordinatorState.UPDATING_UI]: [
                CoordinatorState.STABLE
            ],
            [CoordinatorState.CONFLICT_RESOLUTION]: [
                CoordinatorState.STABLE,
                CoordinatorState.DETECTING_CHANGES  // Retry after resolution
            ]
        };

        return validTransitions[from]?.includes(to) ?? false;
    }

    /**
     * Get main file state machine
     */
    public getMainFileStateMachine(): FileStateMachine {
        return this.mainFileStateMachine;
    }

    /**
     * Get coordinator context for debugging
     */
    public getContext(): CoordinatorContext {
        return { ...this.context };
    }

    /**
     * Get transition history
     */
    public getHistory(): StateTransition[] {
        return [...this.context.transitionHistory];
    }

    /**
     * Force reset coordinator (emergency use only)
     */
    public forceReset(): void {
        this.operationLock = false;
        this.pendingOperations = [];
        this.context.state = CoordinatorState.STABLE;
        this.mainFileStateMachine.reset();

        if (this.config.enableLogging) {
            console.warn('[MainFileCoordinator] Force reset performed');
        }
    }
}
