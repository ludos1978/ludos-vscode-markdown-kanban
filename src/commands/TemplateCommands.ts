/**
 * Template Commands
 *
 * Handles template-related message operations:
 * - getTemplates: Fetch available templates
 * - applyTemplate: Apply a template to create columns
 * - submitTemplateVariables: Submit variable values for template
 *
 * @module commands/TemplateCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { TemplateService } from '../templates/TemplateService';
import { VariableProcessor } from '../templates/VariableProcessor';
import { FileCopyService } from '../templates/FileCopyService';
import { IdGenerator } from '../utils/idGenerator';
import * as vscode from 'vscode';
import * as path from 'path';

// Debug flag - set to true to enable verbose logging
const DEBUG = false;
const log = DEBUG ? console.log.bind(console, '[TemplateCommands]') : () => {};

/**
 * Template Commands Handler
 *
 * Processes template-related messages from the webview.
 */
export class TemplateCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'template-commands',
        name: 'Template Commands',
        description: 'Handles template listing, application, and variable submission',
        messageTypes: [
            'getTemplates',
            'applyTemplate',
            'submitTemplateVariables'
        ],
        priority: 100
    };

    private _templateService: TemplateService = new TemplateService();

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'getTemplates':
                    return await this.handleGetTemplates(context);
                case 'applyTemplate':
                    return await this.handleApplyTemplate(message, context);
                case 'submitTemplateVariables':
                    return await this.handleSubmitTemplateVariables(message, context);
                default:
                    return this.failure(`Unknown template command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[TemplateCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= TEMPLATE HANDLERS =============

    /**
     * Handle request for available templates
     */
    private async handleGetTemplates(context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.failure('No panel available');
        }

        try {
            const fileRegistry = context.getFileRegistry();
            const mainFile = fileRegistry?.getMainFile();
            const workspaceFolder = mainFile ? path.dirname(mainFile.getPath()) : undefined;

            const templates = await this._templateService.getTemplateList(workspaceFolder);
            const showBar = this._templateService.shouldShowBar();

            panel.webview.postMessage({
                type: 'updateTemplates',
                templates,
                showBar
            });

            return this.success({ templateCount: templates.length });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[TemplateCommands.handleGetTemplates] Error:', error);
            return this.failure(errorMessage);
        }
    }

    /**
     * Handle initial template application request (before variables)
     * This loads the template and sends variable definitions to frontend
     */
    private async handleApplyTemplate(message: any, context: CommandContext): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.failure('No panel available');
        }

        try {
            // Handle empty column creation (special case)
            if (message.isEmptyColumn || message.templatePath === '__empty_column__') {
                return await this.createEmptyColumn(message, context);
            }

            const templatePath = message.templatePath;
            if (!templatePath) {
                vscode.window.showErrorMessage('No template path provided');
                return this.failure('No template path provided');
            }

            // Load template definition
            const template = await this._templateService.loadTemplate(templatePath);

            // If template has variables, send them to frontend for dialog
            if (template.variables && template.variables.length > 0) {
                panel.webview.postMessage({
                    type: 'templateVariables',
                    templatePath: templatePath,
                    templateName: template.name,
                    variables: template.variables,
                    targetRow: message.targetRow,
                    insertAfterColumnId: message.insertAfterColumnId,
                    insertBeforeColumnId: message.insertBeforeColumnId,
                    position: message.position
                });
                return this.success({ hasVariables: true });
            } else {
                // No variables - apply immediately
                return await this.applyTemplateWithVariables(message, {}, context);
            }
        } catch (error: any) {
            console.error('[TemplateCommands.handleApplyTemplate] Error:', error);
            vscode.window.showErrorMessage(`Failed to load template: ${error.message}`);
            return this.failure(error.message);
        }
    }

    /**
     * Handle template variable submission
     */
    private async handleSubmitTemplateVariables(message: any, context: CommandContext): Promise<CommandResult> {
        return await this.applyTemplateWithVariables(message, message.variables || {}, context);
    }

    /**
     * Create an empty column at the specified position
     * Stack tags MUST be set here because renderer groups columns based on #stack tag
     */
    private async createEmptyColumn(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            const insertAfterColumnId = message.insertAfterColumnId;
            const insertBeforeColumnId = message.insertBeforeColumnId;

            // Get current board
            const currentBoard = context.getCurrentBoard();
            if (!currentBoard) {
                console.warn('[TemplateCommands.createEmptyColumn] No current board');
                return this.failure('No current board');
            }

            // Save undo state
            context.boardStore.saveStateForUndo(currentBoard);

            // Helper to get row from column title
            const getColumnRow = (col: any): number => {
                const rowMatch = col.title?.match(/#row(\d+)/i);
                return rowMatch ? parseInt(rowMatch[1], 10) : 1;
            };

            // Helper to check if column has #stack tag
            const hasStackTag = (col: any): boolean => {
                return /#stack\b/i.test(col.title || '');
            };

            // Determine target row and whether we need #stack tag
            let targetRow = message.targetRow || 1;
            let insertIndex = currentBoard.columns.length;
            let needsStackTag = false;

            if (insertAfterColumnId) {
                const afterIdx = currentBoard.columns.findIndex((c: any) => c.id === insertAfterColumnId);
                if (afterIdx >= 0) {
                    insertIndex = afterIdx + 1;
                    targetRow = getColumnRow(currentBoard.columns[afterIdx]);

                    // Check if next column exists in same row - if so, we're inserting into a stack
                    const nextCol = currentBoard.columns[afterIdx + 1];
                    if (nextCol && getColumnRow(nextCol) === targetRow) {
                        needsStackTag = true;
                    }
                }
            } else if (insertBeforeColumnId) {
                const beforeIdx = currentBoard.columns.findIndex((c: any) => c.id === insertBeforeColumnId);
                if (beforeIdx >= 0) {
                    insertIndex = beforeIdx;
                    targetRow = getColumnRow(currentBoard.columns[beforeIdx]);

                    // If beforeCol has #stack, we're inserting into an existing stack
                    if (hasStackTag(currentBoard.columns[beforeIdx])) {
                        needsStackTag = true;
                    }
                }
            } else if (message.position === 'first') {
                const firstInRow = currentBoard.columns.findIndex((c: any) => getColumnRow(c) === targetRow);
                insertIndex = firstInRow >= 0 ? firstInRow : currentBoard.columns.length;
            }

            // Create column title with appropriate tags
            let columnTitle = 'New Column';
            if (targetRow > 1) {
                columnTitle = `New Column #row${targetRow}`;
            }
            if (needsStackTag) {
                columnTitle = columnTitle + ' #stack';
            }

            // Create empty column structure
            const emptyColumn = {
                id: `col-${Date.now()}`,
                title: columnTitle,
                tasks: [],
                settings: {}
            };

            // Insert empty column
            currentBoard.columns.splice(insertIndex, 0, emptyColumn);

            // Mark unsaved and update frontend
            context.markUnsavedChanges(true, currentBoard);
            await context.onBoardUpdate();

            log(`createEmptyColumn: Created empty column "${columnTitle}" at index ${insertIndex}, row ${targetRow}, stack=${needsStackTag}`);

            return this.success({ columnId: emptyColumn.id });

        } catch (error: any) {
            console.error('[TemplateCommands.createEmptyColumn] Error:', error);
            vscode.window.showErrorMessage(`Failed to create empty column: ${error.message}`);
            return this.failure(error.message);
        }
    }

    /**
     * Apply a template with the given variable values
     */
    private async applyTemplateWithVariables(
        message: any,
        variables: Record<string, string | number>,
        context: CommandContext
    ): Promise<CommandResult> {
        const panel = context.getWebviewPanel();
        if (!panel) {
            return this.failure('No panel available');
        }

        try {
            const templatePath = message.templatePath;
            if (!templatePath) {
                vscode.window.showErrorMessage('No template path provided');
                return this.failure('No template path provided');
            }

            // Load template definition
            const template = await this._templateService.loadTemplate(templatePath);

            // Apply default values
            const finalVariables = VariableProcessor.applyDefaults(template.variables, variables);

            // Validate required variables
            const validation = VariableProcessor.validateVariables(template.variables, finalVariables);
            if (!validation.valid) {
                vscode.window.showErrorMessage(`Missing required variables: ${validation.missing.join(', ')}`);
                return this.failure(`Missing required variables: ${validation.missing.join(', ')}`);
            }

            // Get board folder
            const fileRegistry = context.getFileRegistry();
            const mainFile = fileRegistry?.getMainFile();
            if (!mainFile) {
                vscode.window.showErrorMessage('No main file found');
                return this.failure('No main file found');
            }
            const boardFolder = path.dirname(mainFile.getPath());

            // Copy template files to board folder
            const copiedFiles = await FileCopyService.copyTemplateFiles(
                templatePath,
                boardFolder,
                finalVariables,
                template.variables
            );
            log(`applyTemplateWithVariables: Copied ${copiedFiles.length} files`);

            // Process template content (columns and tasks)
            const processedColumns = this.processTemplateColumns(template, finalVariables);

            // Get current board
            const currentBoard = context.getCurrentBoard();
            if (!currentBoard) {
                vscode.window.showErrorMessage('No board available');
                return this.failure('No board available');
            }

            // Find insertion point
            const targetRow = message.targetRow || 1;
            let insertIndex = currentBoard.columns.length;

            if (message.insertAfterColumnId) {
                const afterIndex = currentBoard.columns.findIndex(c => c.id === message.insertAfterColumnId);
                if (afterIndex >= 0) {
                    insertIndex = afterIndex + 1;
                }
            } else if (message.insertBeforeColumnId) {
                const beforeIndex = currentBoard.columns.findIndex(c => c.id === message.insertBeforeColumnId);
                if (beforeIndex >= 0) {
                    insertIndex = beforeIndex;
                }
            } else if (message.position === 'first') {
                const firstInRow = currentBoard.columns.findIndex(c => {
                    const rowMatch = c.title.match(/#row(\d+)/i);
                    const colRow = rowMatch ? parseInt(rowMatch[1], 10) : 1;
                    return colRow === targetRow;
                });
                insertIndex = firstInRow >= 0 ? firstInRow : currentBoard.columns.length;
            }

            // Add row tag to columns if needed
            const columnsWithRow = processedColumns.map(col => {
                if (targetRow > 1 && !/#row\d+/i.test(col.title)) {
                    col.title = `${col.title} #row${targetRow}`;
                }
                return col;
            });

            // Save undo state
            context.boardStore.saveStateForUndo(currentBoard);

            // Insert columns into board
            currentBoard.columns.splice(insertIndex, 0, ...columnsWithRow);

            // Mark unsaved changes and update
            context.markUnsavedChanges(true, currentBoard);
            await context.onBoardUpdate();

            // Send updated board to frontend
            panel.webview.postMessage({
                type: 'templateApplied',
                board: currentBoard
            });

            log(`applyTemplateWithVariables: Applied template with ${columnsWithRow.length} columns`);

            return this.success({ columnsAdded: columnsWithRow.length });

        } catch (error: any) {
            console.error('[TemplateCommands.applyTemplateWithVariables] Error:', error);
            vscode.window.showErrorMessage(`Failed to apply template: ${error.message}`);
            return this.failure(error.message);
        }
    }

    /**
     * Process template columns with variable substitution
     */
    private processTemplateColumns(
        template: any,
        variables: Record<string, string | number>
    ): any[] {
        return template.columns.map((col: any) => {
            // Process title
            const processedTitle = VariableProcessor.substitute(
                col.title,
                variables,
                template.variables
            );

            // Process tasks
            const processedTasks = (col.tasks || []).map((task: any) => {
                const processedTaskTitle = VariableProcessor.substitute(
                    task.title,
                    variables,
                    template.variables
                );

                const processedTask: any = {
                    id: IdGenerator.generateTaskId(),
                    title: processedTaskTitle,
                    completed: task.completed || false
                };

                if (task.description) {
                    processedTask.description = VariableProcessor.substitute(
                        task.description,
                        variables,
                        template.variables
                    );
                }

                // Handle include files in task title
                if (task.includeFiles && task.includeFiles.length > 0) {
                    processedTask.includeFiles = task.includeFiles.map((f: string) =>
                        VariableProcessor.substituteFilename(f, variables, template.variables)
                    );
                    processedTask.includeMode = true;
                }

                return processedTask;
            });

            return {
                id: IdGenerator.generateColumnId(),
                title: processedTitle,
                tasks: processedTasks
            };
        });
    }
}
