/**
 * Process Commands
 *
 * Handles background process status and control:
 * - getProcessesStatus
 * - requestMediaIndexScan
 * - cancelMediaIndexScan
 *
 * @module commands/ProcessCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import { WorkspaceMediaIndex } from '../services/WorkspaceMediaIndex';

/**
 * Process Commands Handler
 *
 * Processes background process control messages from the webview.
 * Uses SwitchBasedCommand for automatic dispatch and error handling.
 */
export class ProcessCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'process-commands',
        name: 'Process Commands',
        description: 'Handles background process status and control',
        messageTypes: [
            'getProcessesStatus',
            'requestMediaIndexScan',
            'cancelMediaIndexScan'
        ],
        priority: 100
    };

    /**
     * Handler mapping for message dispatch
     */
    protected handlers: Record<string, MessageHandler> = {
        'getProcessesStatus': async (_msg, _ctx) => {
            await this.handleGetProcessesStatus();
            return this.success();
        },
        'requestMediaIndexScan': async (_msg, _ctx) => {
            await this.handleRequestMediaIndexScan();
            return this.success();
        },
        'cancelMediaIndexScan': async (_msg, _ctx) => {
            await this.handleCancelMediaIndexScan();
            return this.success();
        }
    };

    // ============= PROCESS STATUS HANDLERS =============

    /**
     * Handle get processes status request
     * Returns current status of all background processes
     */
    private async handleGetProcessesStatus(): Promise<void> {
        const mediaIndex = WorkspaceMediaIndex.getInstance();

        // Initialize if needed to load existing database from disk
        if (mediaIndex && !mediaIndex.isInitialized()) {
            await mediaIndex.initialize();
        }

        const status = mediaIndex ? mediaIndex.getStatus() : {
            isInitialized: false,
            isScanning: false,
            hasScanned: false,
            totalFiles: 0,
            byType: {}
        };

        this.postMessage({
            type: 'processesStatus',
            mediaIndex: status
        });
    }

    /**
     * Handle request to start media index scan
     * Starts scan with progress notification
     */
    private async handleRequestMediaIndexScan(): Promise<void> {
        const mediaIndex = WorkspaceMediaIndex.getInstance();
        if (!mediaIndex) {
            console.warn('[ProcessCommands] MediaIndex not available');
            return;
        }

        // Notify frontend scan is starting
        this.postMessage({ type: 'mediaIndexScanStarted' });

        try {
            // Initialize if needed
            if (!mediaIndex.isInitialized()) {
                await mediaIndex.initialize();
            }

            // Start scan with progress
            const filesIndexed = await mediaIndex.scanWithProgress();
            const stats = mediaIndex.getStats();

            this.postMessage({
                type: 'mediaIndexScanCompleted',
                filesIndexed,
                totalFiles: stats.totalFiles
            });
        } catch (error) {
            console.error('[ProcessCommands] Scan failed:', error);
            // Scan was cancelled or failed
            this.postMessage({ type: 'mediaIndexScanCancelled' });
        }
    }

    /**
     * Handle request to cancel media index scan
     */
    private async handleCancelMediaIndexScan(): Promise<void> {
        const mediaIndex = WorkspaceMediaIndex.getInstance();
        if (mediaIndex) {
            mediaIndex.cancelScan();
        }

        this.postMessage({ type: 'mediaIndexScanCancelled' });
    }
}
