/**
 * OutputChannelService - Global output channel for extension logging
 *
 * Extracted from extension.ts to break circular dependency with kanbanWebviewPanel.ts
 */

import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Initialize the output channel
 * Called once during extension activation
 */
export function initializeOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
    outputChannel = vscode.window.createOutputChannel('Markdown Kanban');
    context.subscriptions.push(outputChannel);
    return outputChannel;
}

/**
 * Get the global output channel
 * Returns undefined if not yet initialized
 */
export function getOutputChannel(): vscode.OutputChannel | undefined {
    return outputChannel;
}
