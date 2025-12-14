/**
 * Save Transaction Manager
 *
 * Handles transaction-based save operations for markdown files.
 * Ensures atomic save operations with rollback capability.
 *
 * @module files/SaveTransactionManager
 */

import { normalizePathForLookup } from '../utils/stringUtils';

/**
 * State captured at the start of a save transaction
 */
export interface TransactionState {
    content: string;
    baseline: string;
    hasFileSystemChanges: boolean;
    lastModified: Date | null;
}

/**
 * Active transaction data
 */
interface ActiveTransaction {
    transactionId: string;
    startTime: Date;
    originalState: TransactionState;
    timeout: NodeJS.Timeout;
}

/**
 * Transaction-based save manager.
 * Ensures save operations are atomic with timeout-based rollback.
 */
export class SaveTransactionManager {
    private static _instance: SaveTransactionManager;
    private readonly TRANSACTION_TIMEOUT_MS = 30000;

    // Track active save transactions
    private activeTransactions = new Map<string, ActiveTransaction>();

    private constructor() {}

    static getInstance(): SaveTransactionManager {
        if (!SaveTransactionManager._instance) {
            SaveTransactionManager._instance = new SaveTransactionManager();
        }
        return SaveTransactionManager._instance;
    }

    /**
     * Start a save transaction
     * @returns Transaction ID for commit/rollback
     */
    beginTransaction(filePath: string, originalState: TransactionState): string {
        const normalizedPath = normalizePathForLookup(filePath);
        const transactionId = `save_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Set timeout for transaction
        const timeout = setTimeout(() => {
            console.error(`[SaveTransaction] Transaction ${transactionId} timed out for ${normalizedPath}`);
            this.rollbackTransaction(filePath, transactionId);
        }, this.TRANSACTION_TIMEOUT_MS);

        this.activeTransactions.set(normalizedPath, {
            transactionId,
            startTime: new Date(),
            originalState,
            timeout
        });

        return transactionId;
    }

    /**
     * Commit a save transaction (success)
     */
    commitTransaction(filePath: string, transactionId: string): boolean {
        const normalizedPath = normalizePathForLookup(filePath);
        const transaction = this.activeTransactions.get(normalizedPath);

        if (!transaction || transaction.transactionId !== transactionId) {
            console.error(`[SaveTransaction] Cannot commit - transaction ${transactionId} not found for ${normalizedPath}`);
            return false;
        }

        clearTimeout(transaction.timeout);
        this.activeTransactions.delete(normalizedPath);
        return true;
    }

    /**
     * Rollback a save transaction (failure)
     */
    rollbackTransaction(filePath: string, transactionId: string): boolean {
        const normalizedPath = normalizePathForLookup(filePath);
        const transaction = this.activeTransactions.get(normalizedPath);

        if (!transaction || transaction.transactionId !== transactionId) {
            console.error(`[SaveTransaction] Cannot rollback - transaction ${transactionId} not found for ${normalizedPath}`);
            return false;
        }

        clearTimeout(transaction.timeout);
        this.activeTransactions.delete(normalizedPath);
        return true;
    }

    /**
     * Get active transaction for debugging
     */
    getActiveTransaction(filePath: string): ActiveTransaction | undefined {
        const normalizedPath = normalizePathForLookup(filePath);
        return this.activeTransactions.get(normalizedPath);
    }

    /**
     * Check if a transaction is active for a file
     */
    hasActiveTransaction(filePath: string): boolean {
        const normalizedPath = normalizePathForLookup(filePath);
        return this.activeTransactions.has(normalizedPath);
    }
}
