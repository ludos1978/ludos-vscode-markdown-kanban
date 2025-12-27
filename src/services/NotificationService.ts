/**
 * NotificationService - Centralized service for VS Code notifications
 *
 * Consolidates scattered vscode.window.show*Message calls into a single service.
 * Benefits:
 * - Consistent notification behavior across the extension
 * - Easy to add logging, analytics, or i18n in the future
 * - Simplifies testing with mockable interface
 * - Common patterns (confirm dialogs, unsaved changes) standardized
 */

import * as vscode from 'vscode';

/**
 * Result types for confirmation dialogs
 */
export type ConfirmResult = 'confirm' | 'cancel';
export type SaveDiscardResult = 'save' | 'discard' | 'cancel';

/**
 * NotificationService provides methods for showing VS Code notifications
 */
export class NotificationService {
    private static instance: NotificationService;

    private constructor() {}

    /**
     * Get singleton instance
     */
    static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService();
        }
        return NotificationService.instance;
    }

    /**
     * Show an error message
     * @param message - The error message to display
     * @param items - Optional action items
     * @returns Promise resolving to selected item or undefined
     */
    showError(message: string, ...items: string[]): Thenable<string | undefined> {
        return vscode.window.showErrorMessage(message, ...items);
    }

    /**
     * Show a warning message
     * @param message - The warning message to display
     * @param items - Optional action items
     * @returns Promise resolving to selected item or undefined
     */
    showWarning(message: string, ...items: string[]): Thenable<string | undefined> {
        return vscode.window.showWarningMessage(message, ...items);
    }

    /**
     * Show an information message
     * @param message - The info message to display
     * @param items - Optional action items
     * @returns Promise resolving to selected item or undefined
     */
    showInfo(message: string, ...items: string[]): Thenable<string | undefined> {
        return vscode.window.showInformationMessage(message, ...items);
    }

    /**
     * Show a modal confirmation dialog
     * @param message - The message to display
     * @param confirmLabel - Label for confirm button (default: 'OK')
     * @returns Promise resolving to 'confirm' or 'cancel'
     */
    async confirm(message: string, confirmLabel: string = 'OK'): Promise<ConfirmResult> {
        const result = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            confirmLabel
        );
        return result === confirmLabel ? 'confirm' : 'cancel';
    }

    /**
     * Show a modal confirmation with custom options
     * @param message - The message to display
     * @param options - Array of button labels
     * @returns Promise resolving to selected option or undefined
     */
    async confirmWithOptions(message: string, ...options: string[]): Promise<string | undefined> {
        return vscode.window.showWarningMessage(
            message,
            { modal: true },
            ...options
        );
    }

    /**
     * Show unsaved changes confirmation dialog
     * Common pattern used across multiple files
     * @param fileName - Name of the file with unsaved changes
     * @returns Promise resolving to 'save', 'discard', or 'cancel'
     */
    async confirmUnsavedChanges(fileName: string): Promise<SaveDiscardResult> {
        const result = await vscode.window.showWarningMessage(
            `The file "${fileName}" has unsaved changes.`,
            { modal: true },
            'Save and Continue',
            'Discard and Continue',
            'Cancel'
        );

        switch (result) {
            case 'Save and Continue':
                return 'save';
            case 'Discard and Continue':
                return 'discard';
            default:
                return 'cancel';
        }
    }

    /**
     * Show delete confirmation dialog
     * @param itemType - Type of item being deleted (e.g., 'column', 'task')
     * @param itemName - Name/title of the item
     * @returns Promise resolving to 'confirm' or 'cancel'
     */
    async confirmDelete(itemType: string, itemName?: string): Promise<ConfirmResult> {
        const message = itemName
            ? `Are you sure you want to delete the ${itemType} "${itemName}"?`
            : `Are you sure you want to delete this ${itemType}?`;

        return this.confirm(message, 'Delete');
    }

    /**
     * Show overwrite confirmation dialog
     * @param fileName - Name of the file to overwrite
     * @returns Promise resolving to 'confirm' or 'cancel'
     */
    async confirmOverwrite(fileName: string): Promise<ConfirmResult> {
        return this.confirm(
            `File "${fileName}" already exists. Do you want to overwrite it?`,
            'Overwrite'
        );
    }

    /**
     * Show a progress notification with cancellation support
     * @param title - Title of the progress notification
     * @param task - Async function to run with progress reporting
     * @returns Promise resolving to task result
     */
    async withProgress<T>(
        title: string,
        task: (
            progress: vscode.Progress<{ message?: string; increment?: number }>,
            token: vscode.CancellationToken
        ) => Thenable<T>
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: true
            },
            task
        );
    }
}

// Export singleton for easy access
export const notificationService = NotificationService.getInstance();

// Export convenience functions for direct usage
export const showError = (message: string, ...items: string[]) =>
    notificationService.showError(message, ...items);

export const showWarning = (message: string, ...items: string[]) =>
    notificationService.showWarning(message, ...items);

export const showInfo = (message: string, ...items: string[]) =>
    notificationService.showInfo(message, ...items);

export const confirm = (message: string, confirmLabel?: string) =>
    notificationService.confirm(message, confirmLabel);

export const confirmUnsavedChanges = (fileName: string) =>
    notificationService.confirmUnsavedChanges(fileName);
