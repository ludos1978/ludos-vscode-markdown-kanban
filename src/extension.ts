import * as vscode from 'vscode';
import { KanbanWebviewPanel } from './kanbanWebviewPanel';
import { configService } from './services/ConfigurationService';
import { KanbanSidebarProvider } from './kanbanSidebarProvider';
import { PluginLoader } from './plugins';
import { selectMarkdownFile } from './utils';
import { initializeOutputChannel } from './services/OutputChannelService';
import { SaveEventDispatcher } from './SaveEventDispatcher';

// Re-export for backwards compatibility
export { getOutputChannel } from './services/OutputChannelService';

export function activate(context: vscode.ExtensionContext) {
	// Create output channel for debugging
	const outputChannel = initializeOutputChannel(context);

	outputChannel.appendLine('[Extension] Activating ludos-kanban extension');

	// Initialize plugin system
	// This loads all built-in import/export plugins
	try {
		PluginLoader.loadBuiltinPlugins();
		outputChannel.appendLine('[Extension] Plugin system initialized');
	} catch (error) {
		outputChannel.appendLine(`[Extension] Warning: Plugin system initialization failed: ${error}`);
		console.error('[Extension] Plugin system initialization failed:', error);
	}

	// Initialize kanban sidebar
	const config = configService.getAllConfig();
	const autoScanEnabled = config.sidebar?.autoScan ?? true;
	const sidebarProvider = new KanbanSidebarProvider(context, autoScanEnabled);
	const treeView = vscode.window.createTreeView('kanbanBoardsSidebar', {
		treeDataProvider: sidebarProvider,
		dragAndDropController: sidebarProvider.dragAndDropController,
		showCollapseAll: false
	});
	context.subscriptions.push(treeView);
	context.subscriptions.push(sidebarProvider);

	let fileListenerEnabled = true;


	// Register webview panel serializer (for restoring panel state)
	if (vscode.window.registerWebviewPanelSerializer) {
		vscode.window.registerWebviewPanelSerializer(KanbanWebviewPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
				KanbanWebviewPanel.revive(webviewPanel, context.extensionUri, context, state);
			}
		});
	}

	// Force refresh all existing panels to ensure new compiled code is loaded (dev mode)
	const isDevelopment = !context.extensionMode || context.extensionMode === vscode.ExtensionMode.Development;
	if (isDevelopment) {
		const allPanels = KanbanWebviewPanel.getAllPanels();
		Promise.all(allPanels.map(async (panel) => {
			await panel.refreshWebviewContent();
		})).catch(err => console.error('[Kanban Extension] Error refreshing panels:', err));
	}

	// Register command to open kanban panel
	const openKanbanCommand = vscode.commands.registerCommand('markdown-kanban.openKanban', async (uri?: vscode.Uri) => {
		let targetUri = uri;

		// If no URI provided, try to get from active editor
		if (!targetUri && vscode.window.activeTextEditor) {
			targetUri = vscode.window.activeTextEditor.document.uri;
		}

		// If still no URI but we have an active editor, prioritize the active editor's document
		if (!targetUri && vscode.window.activeTextEditor?.document) {
			targetUri = vscode.window.activeTextEditor.document.uri;
		}

		// If still no URI, let user select file
		if (!targetUri) {
			const fileUris = await selectMarkdownFile();
			if (fileUris && fileUris.length > 0) {
				targetUri = fileUris[0];
			} else {
				return;
			}
		}

		// Check if file is markdown
		if (!targetUri.fsPath.endsWith('.md')) {
			vscode.window.showErrorMessage('Please select a markdown file.');
			return;
		}
		

		try {
			// Open document
			const document = await vscode.workspace.openTextDocument(targetUri);


			// Create or show kanban panel in center area
			KanbanWebviewPanel.createOrShow(context.extensionUri, context, document);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open kanban: ${error}`);
		}
	});

	const disableFileListenerCommand = vscode.commands.registerCommand('markdown-kanban.disableFileListener', async () => {
		fileListenerEnabled = !fileListenerEnabled;
		const status = fileListenerEnabled ? 'enabled' : 'disabled';
		vscode.window.showInformationMessage(`Kanban auto-switching ${status}`);
	});

	// Command to toggle file opening behavior
	const toggleFileOpeningCommand = vscode.commands.registerCommand('markdown-kanban.toggleFileOpening', async () => {
		const currentSetting = configService.getConfig('openLinksInNewTab');

		await configService.updateConfig('openLinksInNewTab', !currentSetting, vscode.ConfigurationTarget.Global);
		
		const newBehavior = !currentSetting ? 'new tabs' : 'current tab';
		vscode.window.showInformationMessage(`Kanban file links will now open in ${newBehavior}`);
	});

	// Command to toggle file lock
	const toggleFileLockCommand = vscode.commands.registerCommand('markdown-kanban.toggleFileLock', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && activeEditor.document.languageId === 'markdown') {
			const panel = KanbanWebviewPanel.getPanelForDocument(activeEditor.document.uri.toString());
			if (panel) {
				panel.toggleFileLock();
			} else {
				vscode.window.showWarningMessage('No kanban panel is open for this document.');
			}
		} else {
			// Try to find any active panel (for backward compatibility)
			const panels = KanbanWebviewPanel.getAllPanels();
			if (panels.length === 1) {
				panels[0].toggleFileLock();
			} else if (panels.length > 1) {
				vscode.window.showWarningMessage('Multiple kanban panels open. Please focus on the markdown document you want to lock/unlock.');
			} else {
				vscode.window.showWarningMessage('No kanban panel is currently open.');
			}
		}
	});

	// Command to open file from kanban panel (for title bar button)
	const openKanbanFromPanelCommand = vscode.commands.registerCommand('markdown-kanban.openKanbanFromPanel', async () => {
		const panels = KanbanWebviewPanel.getAllPanels();
		if (panels.length === 0) {
			vscode.window.showWarningMessage('No kanban panel is currently open.');
			return;
		}

		const fileUris = await selectMarkdownFile();
		if (fileUris && fileUris.length > 0) {
			const targetUri = fileUris[0];
			try {
				const document = await vscode.workspace.openTextDocument(targetUri);
				// This will create a new panel or reuse existing one for this document
				KanbanWebviewPanel.createOrShow(context.extensionUri, context, document);
				vscode.window.showInformationMessage(`Kanban opened for: ${document.fileName}`);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to open file: ${error}`);
			}
		}
	});

	// Command to manually switch file
	const switchFileCommand = vscode.commands.registerCommand('markdown-kanban.switchFile', async () => {
		const panels = KanbanWebviewPanel.getAllPanels();
		if (panels.length === 0) {
			vscode.window.showWarningMessage('No kanban panel is currently open.');
			return;
		}

		const fileUris = await selectMarkdownFile();

		if (fileUris && fileUris.length > 0) {
			const targetUri = fileUris[0];
			try {
				const document = await vscode.workspace.openTextDocument(targetUri);
				// This will create a new panel or reuse existing one
				KanbanWebviewPanel.createOrShow(context.extensionUri, context, document);
				vscode.window.showInformationMessage(`Kanban opened for: ${document.fileName}`);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to open file: ${error}`);
			}
		}
	});

	const insertSnippetCommand = vscode.commands.registerCommand('markdown-kanban.insertSnippet', async () => {
		const panels = KanbanWebviewPanel.getAllPanels();
		if (panels.length === 0) {
			vscode.window.showWarningMessage('No kanban panel is currently open.');
			return;
		}

		// Get the active panel (assuming first panel for now, could be improved)
		const activePanel = panels[0];

		// Trigger snippet insertion in the webview
		activePanel.triggerSnippetInsertion();
	});

	// Sidebar commands
	const scanWorkspaceCommand = vscode.commands.registerCommand('markdown-kanban.sidebar.scanWorkspace', async () => {
		await sidebarProvider.scanWorkspace();
	});

	const addFileToSidebarCommand = vscode.commands.registerCommand('markdown-kanban.sidebar.addFile', async () => {
		const fileUris = await selectMarkdownFile({ canSelectMany: true });

		if (fileUris && fileUris.length > 0) {
			for (const uri of fileUris) {
				await sidebarProvider.addFile(uri);
			}
		}
	});

	const removeFileFromSidebarCommand = vscode.commands.registerCommand('markdown-kanban.sidebar.removeFile', async (item) => {
		if (item) {
			await sidebarProvider.removeFile(item);
		}
	});

	const clearSidebarCommand = vscode.commands.registerCommand('markdown-kanban.sidebar.clear', async () => {
		await sidebarProvider.clear();
	});

	const refreshSidebarCommand = vscode.commands.registerCommand('markdown-kanban.sidebar.refresh', () => {
		sidebarProvider.refresh();
	});

	const filterSidebarCommand = vscode.commands.registerCommand('markdown-kanban.sidebar.filter', async () => {
		await sidebarProvider.showFilterMenu();
	});

	// Note: External file change detection is handled by MarkdownFile instances via their built-in watchers

	// Listen for active editor changes - sets context for VS Code UI (menus, keybindings)
	// NOTE: External file change detection is handled by file watchers and focus:gained event
	const activeEditorChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor && editor.document.languageId === 'markdown' && fileListenerEnabled) {
			vscode.commands.executeCommand('setContext', 'markdownKanbanActive', true);
		} else {
			vscode.commands.executeCommand('setContext', 'markdownKanbanActive', false);
		}
	});

	// Add to subscriptions
	context.subscriptions.push(
		openKanbanCommand,
		disableFileListenerCommand,
		toggleFileOpeningCommand,
		toggleFileLockCommand,
		openKanbanFromPanelCommand,
		switchFileCommand,
		insertSnippetCommand,
		scanWorkspaceCommand,
		addFileToSidebarCommand,
		removeFileFromSidebarCommand,
		clearSidebarCommand,
		refreshSidebarCommand,
		filterSidebarCommand,
		activeEditorChangeListener,
	);

	// React to configuration changes (e.g., tag colors, whitespace, etc.)
	const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
		if (e.affectsConfiguration('markdown-kanban')) {
			// Only trigger full refresh for configuration changes that affect board rendering
			// UI preference changes (fontSize, columnWidth, etc.) are handled by the webview itself
			const needsFullRefresh = 
				e.affectsConfiguration('markdown-kanban.tagColors') ||
				e.affectsConfiguration('markdown-kanban.enableBackups') ||
				e.affectsConfiguration('markdown-kanban.backupInterval') ||
				e.affectsConfiguration('markdown-kanban.backupLocation') ||
				e.affectsConfiguration('markdown-kanban.maxBackupsPerFile') ||
				e.affectsConfiguration('markdown-kanban.openLinksInNewTab') ||
				e.affectsConfiguration('markdown-kanban.maxRowHeight');
			
			if (needsFullRefresh) {
				const panels = KanbanWebviewPanel.getAllPanels();
				for (const panel of panels) {
					const uri = panel.getCurrentDocumentUri?.();
					if (uri) {
						try {
							const doc = await vscode.workspace.openTextDocument(uri);
							await panel.loadMarkdownFile(doc);
						} catch {
							// best-effort refresh; ignore failures
						}
					}
				}
			}
		}
	});

	context.subscriptions.push(configChangeListener);

	// If current active editor is markdown, auto-activate kanban
	if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'markdown') {
		vscode.commands.executeCommand('setContext', 'markdownKanbanActive', true);
	}
}

/**
 * Called when VSCode is closing or extension is being deactivated
 * ⚠️ CRITICAL: This must check for unsaved changes and prompt user BEFORE allowing close!
 */
export async function deactivate(): Promise<void> {
	// Get all open Kanban panels
	const panels = KanbanWebviewPanel.getAllPanels();

	// Check each panel for unsaved changes and save if needed
	for (const panel of panels) {
		const hasUnsaved = await panel.checkUnsavedChanges();

		if (hasUnsaved) {
			// First, save a backup file with ".{name}-unsavedchanges" prefix (hidden)
			// This ensures we don't lose data regardless of user's choice
			await panel.saveUnsavedChangesBackup();

			// Show prompt directly here (webview will be disposed soon, can't use panel's method)
			const saveAndClose = 'Save and close';
			const closeWithoutSaving = 'Close without saving';
			const cancel = 'Cancel (Esc)';

			const choice = await vscode.window.showWarningMessage(
				'You have unsaved changes in your Kanban board. Do you want to save before closing?',
				{ modal: true },
				saveAndClose,
				closeWithoutSaving,
				cancel
			);

			if (!choice || choice === cancel) {
				// User cancelled - we can't actually prevent VSCode from closing here
				// Note: VSCode doesn't support preventing close from deactivate()
				return;
			}

			if (choice === saveAndClose) {
				// Save changes before closing
				try {
					await panel.saveToMarkdown(true, true);
				} catch (error) {
					console.error('[Extension] Save failed during deactivation:', error);
					// Continue anyway - VSCode is closing
				}
			}
		}
	}

	// Clean up context
	await vscode.commands.executeCommand('setContext', 'markdownKanbanActive', false);

	// Dispose singleton services to prevent resource leaks
	SaveEventDispatcher.getInstance().dispose();
}
