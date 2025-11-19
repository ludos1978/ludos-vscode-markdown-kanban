/**
 * TASK INITIALIZER - MUTATION OBSERVER SAFETY NET
 *
 * This module provides automatic task initialization through DOM mutation observation.
 * It works as a SAFETY NET in conjunction with explicit initializeTaskElement() calls.
 *
 * HYBRID APPROACH:
 * 1. SYNCHRONOUS: Explicit initializeTaskElement() calls in known code paths (fast, immediate)
 * 2. ASYNCHRONOUS: MutationObserver catches any tasks that were missed (safety net)
 *
 * This ensures tasks are ALWAYS initialized, even if new code paths are added that forget
 * to call initializeTaskElement().
 *
 * The observer looks for tasks that don't have the data-task-initialized="true" attribute
 * and automatically initializes them.
 */

class TaskInitializer {
    constructor() {
        this.observer = null;
        this.isObserving = false;
    }

    /**
     * Start observing the kanban board for task element additions
     */
    startObserving() {
        if (this.isObserving) {
            console.log('[TaskInit Observer] Already observing');
            return;
        }

        const boardElement = document.getElementById('kanban-board');
        if (!boardElement) {
            console.warn('[TaskInit Observer] Board element not found, will retry...');
            // Retry after a short delay
            setTimeout(() => this.startObserving(), 500);
            return;
        }

        console.log('[TaskInit Observer] Starting observation');

        this.observer = new MutationObserver((mutations) => {
            // Collect all task elements that were added
            const tasksToInitialize = new Set();

            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Is it a task element itself?
                        if (node.classList && node.classList.contains('task-item')) {
                            if (node.dataset.taskInitialized !== 'true') {
                                tasksToInitialize.add(node);
                            }
                        }
                        // Or does it contain task elements?
                        if (node.querySelectorAll) {
                            node.querySelectorAll('.task-item').forEach(task => {
                                if (task.dataset.taskInitialized !== 'true') {
                                    tasksToInitialize.add(task);
                                }
                            });
                        }
                    }
                });
            });

            // Initialize all collected tasks
            if (tasksToInitialize.size > 0) {
                console.warn(`[TaskInit Observer] Safety net caught ${tasksToInitialize.size} uninitialized task(s)`);
                tasksToInitialize.forEach(task => {
                    console.warn(`[TaskInit Observer]  - Initializing task: ${task.dataset.taskId}`);
                    if (typeof window.initializeTaskElement === 'function') {
                        window.initializeTaskElement(task);
                    } else {
                        console.error('[TaskInit Observer] initializeTaskElement function not available!');
                    }
                });
            }
        });

        this.observer.observe(boardElement, {
            childList: true,
            subtree: true
        });

        this.isObserving = true;
        console.log('[TaskInit Observer] Observation started successfully');

        // Initialize any existing tasks that weren't initialized
        this.initializeAllExisting();
    }

    /**
     * Initialize all existing tasks on the board
     * Called when the observer first starts
     */
    initializeAllExisting() {
        const tasks = document.querySelectorAll('.task-item');
        const uninitializedTasks = Array.from(tasks).filter(
            task => task.dataset.taskInitialized !== 'true'
        );

        if (uninitializedTasks.length > 0) {
            console.log(`[TaskInit Observer] Initializing ${uninitializedTasks.length} existing task(s)`);
            uninitializedTasks.forEach(task => {
                if (typeof window.initializeTaskElement === 'function') {
                    window.initializeTaskElement(task);
                }
            });
        } else {
            console.log(`[TaskInit Observer] All ${tasks.length} existing tasks already initialized`);
        }
    }

    /**
     * Stop observing (for cleanup or debugging)
     */
    stopObserving() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
            this.isObserving = false;
            console.log('[TaskInit Observer] Observation stopped');
        }
    }

    /**
     * Verify all tasks on the board are initialized
     * Useful for debugging and testing
     * @returns {boolean} - True if all tasks are initialized
     */
    verifyAllInitialized() {
        const allTasks = document.querySelectorAll('.task-item');
        const uninitialized = Array.from(allTasks).filter(
            task => task.dataset.taskInitialized !== 'true'
        );

        if (uninitialized.length > 0) {
            console.error(`[TaskInit Observer] VERIFICATION FAILED: Found ${uninitialized.length} uninitialized task(s):`);
            uninitialized.forEach(task => {
                console.error(`  - Task ID: ${task.dataset.taskId}`);
            });
            return false;
        } else {
            console.log(`[TaskInit Observer] VERIFICATION PASSED: All ${allTasks.length} tasks initialized`);
            return true;
        }
    }
}

// Create global instance
window.taskInitializer = new TaskInitializer();

// Auto-start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.taskInitializer.startObserving();
    });
} else {
    // DOM already loaded, start immediately
    window.taskInitializer.startObserving();
}

// Expose verification function for debugging
window.verifyAllTasksInitialized = () => window.taskInitializer.verifyAllInitialized();

console.log('[TaskInit Observer] Module loaded, observer will start when DOM is ready');
