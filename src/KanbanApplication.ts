import * as vscode from 'vscode';
import { KanbanBoard } from './domain/models/KanbanBoard';
import { ICacheManager } from './core/interfaces/ICacheManager';
import { ISaveManager } from './core/interfaces/ISaveManager';
import { IConflictManager } from './core/interfaces/IConflictManager';
import { IEventBus } from './core/interfaces/IEventBus';
import { ICommandBus } from './core/interfaces/ICommandBus';
import { CacheManager } from './application/coordination/CacheManager';
import { SaveManager } from './application/coordination/SaveManager';
import { ConflictManager } from './application/coordination/ConflictManager';
import { EventBus } from './infrastructure/events/EventBus';
import { CommandBus } from './application/coordination/CommandBus';
import { BoardChangedEvent, FileModifiedEvent, SaveRequestEvent, ConflictDetectedEvent } from './core/events/DomainEvents';
import { ConflictContext, Conflict } from './core/types/ConflictTypes';

/**
 * Main Application Coordinator
 *
 * Central hub that coordinates all components of the Kanban application.
 * Replaces the scattered state management and broken coordination of the legacy system.
 */
export class KanbanApplication {
    private cacheManager: ICacheManager;
    private saveManager: ISaveManager;
    private conflictManager: IConflictManager;
    private eventBus: IEventBus;
    private commandBus: ICommandBus;

    private isInitialized: boolean = false;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Initialize core services
        this.eventBus = new EventBus();
        this.cacheManager = new CacheManager(this.eventBus);
        this.saveManager = new SaveManager(this.eventBus);
        this.conflictManager = new ConflictManager(this.eventBus);
        this.commandBus = new CommandBus(this.eventBus);

        this.setupEventHandlers();
        this.setupCommandHandlers();
    }

    /**
     * Initialize the application with VSCode integration
     */
    async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        console.log('[KanbanApplication] Initializing new architecture...');

        // Setup VSCode event listeners
        this.setupVSCodeListeners();

        // Load initial state if available
        await this.loadInitialState();

        this.isInitialized = true;
        console.log('[KanbanApplication] Initialization complete');
    }

    /**
     * Setup event handlers for domain events
     */
    private setupEventHandlers(): void {
        // Board changes
        this.eventBus.subscribe('BoardChangedEvent', async (event: BoardChangedEvent) => {
            console.log('[KanbanApplication] Board changed event received');
            await this.handleBoardChanged(event);
        });

        // File modifications
        this.eventBus.subscribe('FileModifiedEvent', async (event: FileModifiedEvent) => {
            console.log('[KanbanApplication] File modified event received');
            await this.handleFileModified(event);
        });

        // Save requests
        this.eventBus.subscribe('SaveRequestEvent', async (event: SaveRequestEvent) => {
            console.log('[KanbanApplication] Save request event received');
            await this.handleSaveRequest(event);
        });

        // Conflict detection
        this.eventBus.subscribe('ConflictDetectedEvent', async (event: ConflictDetectedEvent) => {
            console.log('[KanbanApplication] Conflict detected event received');
            await this.handleConflictDetected(event);
        });
    }

    /**
     * Setup command handlers
     */
    private setupCommandHandlers(): void {
        // Register command handlers with the command bus
        // This will be expanded as we implement more commands
    }

    /**
     * Setup VSCode event listeners
     */
    private setupVSCodeListeners(): void {
        // Document save events
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                if (this.isKanbanFile(document)) {
                    await this.eventBus.publish(new FileModifiedEvent({
                        filePath: document.uri.fsPath,
                        timestamp: new Date(),
                        source: 'vscode-save'
                    }));
                }
            })
        );

        // Document change events (external modifications)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(async (event) => {
                if (this.isKanbanFile(event.document) && !event.contentChanges.length) {
                    // Only react to external changes, not our own edits
                    await this.eventBus.publish(new FileModifiedEvent({
                        filePath: event.document.uri.fsPath,
                        timestamp: new Date(),
                        source: 'external-change'
                    }));
                }
            })
        );

        // File system events
        this.disposables.push(
            vscode.workspace.onDidDeleteFiles(async (event) => {
                for (const uri of event.files) {
                    if (this.isKanbanFileUri(uri)) {
                        await this.handleFileDeleted(uri.fsPath);
                    }
                }
            })
        );
    }

    /**
     * Handle board changed events
     */
    private async handleBoardChanged(event: BoardChangedEvent): Promise<void> {
        try {
            // Update cache
            this.cacheManager.setBoard(event.data.board);

            // Check for conflicts before proceeding
            const context: ConflictContext = {
                filePath: this.getCurrentFilePath(),
                hasUnsavedChanges: true,
                isEditing: false,
                timestamp: new Date()
            };

            const conflicts = await this.conflictManager.detectConflicts(context);
            if (conflicts.length > 0) {
                await this.eventBus.publish(new ConflictDetectedEvent({
                    conflicts,
                    context,
                    timestamp: new Date()
                }));
            }

        } catch (error) {
            console.error('[KanbanApplication] Error handling board change:', error);
        }
    }

    /**
     * Handle file modified events
     */
    private async handleFileModified(event: FileModifiedEvent): Promise<void> {
        try {
            const context: ConflictContext = {
                filePath: event.data.filePath,
                hasUnsavedChanges: this.hasUnsavedChanges(),
                isEditing: this.isEditing(),
                timestamp: new Date()
            };

            const conflicts = await this.conflictManager.detectConflicts(context);

            if (conflicts.length > 0) {
                await this.eventBus.publish(new ConflictDetectedEvent({
                    conflicts,
                    context,
                    timestamp: new Date()
                }));
            } else {
                // No conflicts, auto-reload
                await this.autoReloadFile(event.data.filePath);
            }

        } catch (error) {
            console.error('[KanbanApplication] Error handling file modification:', error);
        }
    }

    /**
     * Handle save request events
     */
    private async handleSaveRequest(event: SaveRequestEvent): Promise<void> {
        try {
            const board = event.data.board;
            const options = event.data.options || {};

            await this.saveManager.saveBoard(board, options);

        } catch (error) {
            console.error('[KanbanApplication] Error handling save request:', error);
        }
    }

    /**
     * Handle conflict detected events
     */
    private async handleConflictDetected(event: ConflictDetectedEvent): Promise<void> {
        try {
            // Get user resolution
            const resolution = await this.conflictManager.resolveConflict(event.data.conflicts[0]);

            // Apply resolution
            await this.applyConflictResolution(resolution, event.data.context);

        } catch (error) {
            console.error('[KanbanApplication] Error handling conflict:', error);
        }
    }

    /**
     * Public API: Save current board
     */
    async saveBoard(board: KanbanBoard, options?: any): Promise<void> {
        await this.eventBus.publish(new SaveRequestEvent({
            board,
            options: options || {},
            timestamp: new Date()
        }));
    }

    /**
     * Public API: Update board
     */
    async updateBoard(board: KanbanBoard): Promise<void> {
        await this.eventBus.publish(new BoardChangedEvent({
            board,
            timestamp: new Date()
        }));
    }

    /**
     * Public API: Get current board
     */
    getBoard(): KanbanBoard | null {
        return this.cacheManager.getBoard();
    }

    /**
     * Public API: Check if there are unsaved changes
     */
    hasUnsavedChanges(): boolean {
        const board = this.cacheManager.getBoard();
        return board !== null; // Simplified - in real implementation would compare with saved state
    }

    /**
     * Public API: Check if user is currently editing
     */
    isEditing(): boolean {
        // This would integrate with the frontend to check if user is actively editing
        return false; // Placeholder
    }

    /**
     * Load initial state from current document
     */
    private async loadInitialState(): Promise<void> {
        const document = vscode.window.activeTextEditor?.document;
        if (document && this.isKanbanFile(document)) {
            try {
                const board = await this.parseDocumentToBoard(document);
                if (board) {
                    this.cacheManager.setBoard(board);
                }
            } catch (error) {
                console.error('[KanbanApplication] Error loading initial state:', error);
            }
        }
    }

    /**
     * Auto-reload file when no conflicts
     */
    private async autoReloadFile(filePath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const board = await this.parseDocumentToBoard(document);

            if (board) {
                this.cacheManager.setBoard(board);
            }
        } catch (error) {
            console.error('[KanbanApplication] Error auto-reloading file:', error);
        }
    }

    /**
     * Apply conflict resolution
     */
    private async applyConflictResolution(resolution: any, context: ConflictContext): Promise<void> {
        switch (resolution.action) {
            case 'save':
                const board = this.cacheManager.getBoard();
                if (board) {
                    await this.saveManager.saveBoard(board);
                }
                break;

            case 'discard_local':
                await this.autoReloadFile(context.filePath);
                break;

            case 'backup_and_reload':
                // Create backup and reload
                await this.createBackup(context.filePath);
                await this.autoReloadFile(context.filePath);
                break;

            case 'ignore':
                // Do nothing
                break;
        }
    }

    /**
     * Handle file deletion
     */
    private async handleFileDeleted(filePath: string): Promise<void> {
        // Clear cache if current file was deleted
        if (this.getCurrentFilePath() === filePath) {
            this.cacheManager.invalidateBoard();
        }
    }

    /**
     * Create backup of file
     */
    private async createBackup(filePath: string): Promise<void> {
        // Implementation would create backup file
        console.log(`[KanbanApplication] Creating backup for: ${filePath}`);
    }

    /**
     * Parse document to board
     */
    private async parseDocumentToBoard(document: vscode.TextDocument): Promise<KanbanBoard | null> {
        try {
            // This would use the MarkdownParser service
            const content = document.getText();
            // Placeholder - actual parsing logic would go here
            return null; // Placeholder
        } catch (error) {
            console.error('[KanbanApplication] Error parsing document:', error);
            return null;
        }
    }

    /**
     * Get current file path
     */
    private getCurrentFilePath(): string {
        return vscode.window.activeTextEditor?.document.uri.fsPath || '';
    }

    /**
     * Check if document is a kanban file
     */
    private isKanbanFile(document: vscode.TextDocument): boolean {
        return document.languageId === 'markdown' &&
               document.getText().includes('kanban-plugin: board');
    }

    /**
     * Check if URI is a kanban file
     */
    private isKanbanFileUri(uri: vscode.Uri): boolean {
        return uri.fsPath.endsWith('.md'); // Simplified check
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}