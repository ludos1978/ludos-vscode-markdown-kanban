import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
	isUnsavedChangesFile,
	isAutosaveFile,
	isBackupFile,
	isConflictFile
} from './constants/FileNaming';
import { showWarning, showInfo, notificationService } from './services/NotificationService';

/**
 * File type categories for filtering
 */
export enum FileCategory {
	All = 'all',
	Regular = 'regular',
	Backups = 'backups',
	Conflicts = 'conflicts',
	Autosaves = 'autosaves',
	UnsavedChanges = 'unsaved'
}

/**
 * File type detector utility
 */
class FileTypeDetector {
	/**
	 * Detect file category from filename
	 */
	static detectCategory(filePath: string): FileCategory {
		const fileName = path.basename(filePath);

		// Check for autosave: .{basename}-autosave.md
		if (isAutosaveFile(fileName)) {
			return FileCategory.Autosaves;
		}

		// Check for backup: .{basename}-backup-{timestamp}.md
		if (isBackupFile(fileName)) {
			return FileCategory.Backups;
		}

		// Check for conflict: .{basename}-conflict-{timestamp}.md or {basename}-conflict-{timestamp}.md
		if (isConflictFile(fileName)) {
			return FileCategory.Conflicts;
		}

		// Check for unsaved changes: .{basename}-unsavedchanges.md (hidden files with dot prefix)
		if (isUnsavedChangesFile(fileName)) {
			return FileCategory.UnsavedChanges;
		}

		// Regular kanban file
		return FileCategory.Regular;
	}

	/**
	 * Get display label for category
	 */
	static getCategoryLabel(category: FileCategory): string {
		switch (category) {
			case FileCategory.All: return 'All Files';
			case FileCategory.Regular: return 'Regular Kanbans';
			case FileCategory.Backups: return 'Backups';
			case FileCategory.Conflicts: return 'Conflicts';
			case FileCategory.Autosaves: return 'Autosaves';
			case FileCategory.UnsavedChanges: return 'Unsaved Changes';
		}
	}

	/**
	 * Get icon for category
	 */
	static getCategoryIcon(category: FileCategory): string {
		switch (category) {
			case FileCategory.All: return 'filter';
			case FileCategory.Regular: return 'notebook';
			case FileCategory.Backups: return 'archive';
			case FileCategory.Conflicts: return 'warning';
			case FileCategory.Autosaves: return 'history';
			case FileCategory.UnsavedChanges: return 'save';
		}
	}
}

/**
 * Kanban board entry in the sidebar
 */
export class KanbanBoardItem extends vscode.TreeItem {
	constructor(
		public readonly uri: vscode.Uri,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public isValid: boolean = true
	) {
		super(label, collapsibleState);
		this.resourceUri = uri;
		this.command = {
			command: 'markdown-kanban.openKanban',
			title: 'Open Kanban Board',
			arguments: [uri]
		};

		// Set icon based on validity
		this.iconPath = isValid
			? new vscode.ThemeIcon('notebook')
			: new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));

		this.tooltip = uri.fsPath;
		this.contextValue = 'kanbanBoard';
	}
}

/**
 * Drag and drop controller for kanban sidebar
 */
class KanbanDragAndDropController implements vscode.TreeDragAndDropController<KanbanBoardItem> {
	dropMimeTypes = ['text/uri-list', 'application/vnd.code.tree.kanbanBoardsSidebar'];
	dragMimeTypes = ['application/vnd.code.tree.kanbanBoardsSidebar'];

	constructor(private provider: KanbanSidebarProvider) {}

	async handleDrag(
		source: readonly KanbanBoardItem[],
		dataTransfer: vscode.DataTransfer,
		_token: vscode.CancellationToken
	): Promise<void> {
		if (source.length === 0) {
			return;
		}

		// Store the dragged item's file path
		const filePaths = source.map(item => item.uri.fsPath);
		dataTransfer.set(
			'application/vnd.code.tree.kanbanBoardsSidebar',
			new vscode.DataTransferItem(JSON.stringify(filePaths))
		);
	}

	async handleDrop(
		target: KanbanBoardItem | undefined,
		dataTransfer: vscode.DataTransfer,
		token: vscode.CancellationToken
	): Promise<void> {
		// Check for internal reordering first
		const reorderItem = dataTransfer.get('application/vnd.code.tree.kanbanBoardsSidebar');
		if (reorderItem) {
			const draggedPaths = JSON.parse(await reorderItem.asString()) as string[];
			await this.provider.reorderFiles(draggedPaths, target);
			return;
		}

		// Handle external file drops
		const uriListItem = dataTransfer.get('text/uri-list');
		if (!uriListItem) {
			return;
		}

		const uriList = await uriListItem.asString();
		const uris = uriList.split('\n').filter(u => u.trim().length > 0);

		for (const uriString of uris) {
			if (token.isCancellationRequested) {
				break;
			}

			try {
				const uri = vscode.Uri.parse(uriString.trim());

				// Only accept .md files
				if (uri.fsPath.endsWith('.md')) {
					await this.provider.addFile(uri);
				} else {
					showWarning(`${path.basename(uri.fsPath)} is not a markdown file`);
				}
			} catch (error) {
				console.error('[Kanban Sidebar] Failed to parse dropped URI:', error);
			}
		}
	}
}

/**
 * TreeDataProvider for kanban boards sidebar
 */
export class KanbanSidebarProvider implements vscode.TreeDataProvider<KanbanBoardItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<KanbanBoardItem | undefined | null | void> = new vscode.EventEmitter<KanbanBoardItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<KanbanBoardItem | undefined | null | void> = this._onDidChangeTreeData.event;

	readonly dragAndDropController: KanbanDragAndDropController;

	private kanbanFiles: Set<string> = new Set();
	private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();
	private validationCache: Map<string, { isValid: boolean; timestamp: number }> = new Map();
	private static readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

	// Filter state
	private activeFilter: FileCategory = FileCategory.Regular;
	private categoryCounts: Map<FileCategory, number> = new Map();

	// Custom order state
	private customOrder: string[] = []; // Array of file paths in custom order

	constructor(
		private context: vscode.ExtensionContext,
		private autoScan: boolean = true
	) {
		this.dragAndDropController = new KanbanDragAndDropController(this);
		this.loadFromWorkspaceState();

		// Auto-scan on first activation (if enabled and first-time per workspace)
		if (this.autoScan && !this.hasScannedBefore()) {
			this.scanWorkspace().catch(err => {
				console.error('[Kanban Sidebar] Auto-scan failed:', err);
			});
		}

		// Listen to workspace folder changes
		context.subscriptions.push(
			vscode.workspace.onDidChangeWorkspaceFolders(e => {
				this.handleWorkspaceFolderChanges(e);
			})
		);
	}

	/**
	 * Check if workspace has been scanned before
	 */
	private hasScannedBefore(): boolean {
		return this.context.workspaceState.get('kanbanSidebar.hasScanned', false);
	}

	/**
	 * Mark workspace as scanned
	 */
	private markAsScanned(): void {
		this.context.workspaceState.update('kanbanSidebar.hasScanned', true);
	}

	/**
	 * Load kanban files from workspace state
	 */
	private loadFromWorkspaceState(): void {
		const stored = this.context.workspaceState.get<string[]>('kanbanSidebar.files', []);
		this.kanbanFiles = new Set(stored);

		// Load custom order
		const storedOrder = this.context.workspaceState.get<string[]>('kanbanSidebar.order', []);
		this.customOrder = storedOrder.filter(path => this.kanbanFiles.has(path)); // Only keep valid paths

		// Start watching loaded files
		for (const filePath of this.kanbanFiles) {
			this.watchFile(filePath);
		}
	}

	/**
	 * Save kanban files to workspace state
	 */
	private async saveToWorkspaceState(): Promise<void> {
		await this.context.workspaceState.update('kanbanSidebar.files', Array.from(this.kanbanFiles));
		await this.context.workspaceState.update('kanbanSidebar.order', this.customOrder);
	}

	/**
	 * Get TreeItem for display
	 */
	getTreeItem(element: KanbanBoardItem): vscode.TreeItem {
		return element;
	}

	/**
	 * Get children (kanban files list)
	 */
	async getChildren(element?: KanbanBoardItem): Promise<KanbanBoardItem[]> {
		if (element) {
			return []; // No nested items
		}

		const items: KanbanBoardItem[] = [];
		this.categoryCounts.clear();

		for (const filePath of this.kanbanFiles) {
			const uri = vscode.Uri.file(filePath);
			const fileName = path.basename(filePath, '.md');

			// Detect file category
			const category = FileTypeDetector.detectCategory(filePath);

			// Update category counts
			const count = this.categoryCounts.get(category) || 0;
			this.categoryCounts.set(category, count + 1);

			// Apply filter
			if (this.activeFilter !== FileCategory.All && category !== this.activeFilter) {
				continue; // Skip files not matching active filter
			}

			// Validate file (with caching)
			const isValid = await this.isKanbanFile(filePath);

			items.push(new KanbanBoardItem(
				uri,
				fileName,
				vscode.TreeItemCollapsibleState.None,
				isValid
			));
		}

		// Sort by custom order if available, otherwise alphabetically
		if (this.customOrder.length > 0) {
			items.sort((a, b) => {
				const indexA = this.customOrder.indexOf(a.uri.fsPath);
				const indexB = this.customOrder.indexOf(b.uri.fsPath);

				// If both items are in custom order, use that order
				if (indexA !== -1 && indexB !== -1) {
					return indexA - indexB;
				}
				// If only A is in custom order, it comes first
				if (indexA !== -1) {
					return -1;
				}
				// If only B is in custom order, it comes first
				if (indexB !== -1) {
					return 1;
				}
				// Neither in custom order, sort alphabetically
				return a.label.localeCompare(b.label);
			});
		} else {
			// No custom order, sort alphabetically
			items.sort((a, b) => a.label.localeCompare(b.label));
		}

		return items;
	}

	/**
	 * Refresh tree view
	 */
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Scan workspace for kanban files using ripgrep for fast text search
	 * This searches for "kanban-plugin: board" directly instead of reading all .md files
	 */
	async scanWorkspace(_maxFiles: number = 500): Promise<void> {
		if (!vscode.workspace.workspaceFolders) {
			showWarning('No workspace folder opened');
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Scanning workspace for kanban boards...',
			cancellable: true
		}, async (progress, token) => {
			const foundFiles: string[] = [];
			const candidateFiles = new Set<string>();

			progress.report({ message: 'Searching for kanban markers...' });

			// Search across all workspace folders using ripgrep
			const workspaceFolders = vscode.workspace.workspaceFolders || [];
			for (const folder of workspaceFolders) {
				if (token.isCancellationRequested) break;

				try {
					const files = await this.searchWithRipgrep(folder.uri.fsPath, token);
					files.forEach(f => candidateFiles.add(f));
				} catch (error) {
					console.error(`[Kanban Sidebar] Error searching in ${folder.name}:`, error);
					// Fallback to traditional search for this folder
					const fallbackFiles = await this.traditionalSearch(folder.uri.fsPath, token);
					fallbackFiles.forEach(f => candidateFiles.add(f));
				}
			}

			if (token.isCancellationRequested) {
				return;
			}

			progress.report({ message: `Validating ${candidateFiles.size} candidates...` });

			// Validate candidate files (check for YAML header)
			// This is fast because we only read files that definitely have the marker
			let processed = 0;
			let skippedSpecial = 0;
			const totalCandidates = candidateFiles.size;

			for (const filePath of candidateFiles) {
				if (token.isCancellationRequested) break;

				processed++;
				if (processed % 10 === 0) {
					progress.report({
						message: `Validating ${processed}/${totalCandidates}...`,
						increment: (10 / totalCandidates) * 100
					});
				}

				// Skip backup, conflict, autosave, and unsavedchanges files
				// These are internal files that should not appear in the sidebar
				if (isBackupFile(filePath) || isConflictFile(filePath) ||
					isAutosaveFile(filePath) || isUnsavedChangesFile(filePath)) {
					skippedSpecial++;
					continue;
				}

				// Quick validation - just check for YAML header since we know marker exists
				if (await this.hasYamlHeader(filePath)) {
					// Skip if already registered
					if (!this.kanbanFiles.has(filePath)) {
						foundFiles.push(filePath);
						this.kanbanFiles.add(filePath);
						this.watchFile(filePath);
					}

					// Update cache
					this.validationCache.set(filePath, {
						isValid: true,
						timestamp: Date.now()
					});
				}
			}

			await this.saveToWorkspaceState();
			this.markAsScanned();
			this.refresh();

			if (!token.isCancellationRequested) {
				const newCount = foundFiles.length;
				const totalCount = this.kanbanFiles.size;
				const skippedMsg = skippedSpecial > 0 ? ` (skipped ${skippedSpecial} backup/special files)` : '';
				if (newCount > 0) {
					showInfo(`Found ${newCount} new kanban board(s). Total: ${totalCount}${skippedMsg}`);
				} else {
					showInfo(`No new boards found. Total: ${totalCount}${skippedMsg}`);
				}
			}
		});
	}

	/**
	 * Search for kanban files using ripgrep (fast text search)
	 */
	private async searchWithRipgrep(folderPath: string, token: vscode.CancellationToken): Promise<string[]> {
		const { spawn } = await import('child_process');

		return new Promise((resolve, reject) => {
			const files: string[] = [];

			// Use ripgrep to find files containing "kanban-plugin: board"
			// -l: only print file names
			// -g: glob pattern for .md files
			// --no-ignore-vcs: don't use .gitignore (optional, can be removed)
			const rg = spawn('rg', [
				'-l',                          // Only print file names
				'-g', '*.md',                  // Only search .md files
				'--hidden',                    // Include hidden files (for backups etc)
				'--no-heading',                // No file name headers
				'kanban-plugin: board',        // Search pattern
				folderPath                     // Search directory
			], {
				cwd: folderPath,
				shell: process.platform === 'win32'
			});

			let stdout = '';
			let stderr = '';

			rg.stdout.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			rg.stderr.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			// Handle cancellation
			const cancelHandler = token.onCancellationRequested(() => {
				rg.kill();
				resolve([]);
			});

			rg.on('close', (code: number | null) => {
				cancelHandler.dispose();

				if (code === 0 || code === 1) {
					// code 0 = matches found, code 1 = no matches (both are OK)
					const lines = stdout.trim().split('\n').filter(line => line.length > 0);
					lines.forEach(line => {
						// Ensure absolute path
						const filePath = path.isAbsolute(line) ? line : path.join(folderPath, line);
						if (filePath.endsWith('.md')) {
							files.push(filePath);
						}
					});
					resolve(files);
				} else {
					// ripgrep failed, reject to trigger fallback
					reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
				}
			});

			rg.on('error', (err: Error) => {
				cancelHandler.dispose();
				reject(err);
			});
		});
	}

	/**
	 * Traditional search fallback (find all .md files and check each one)
	 */
	private async traditionalSearch(folderPath: string, token: vscode.CancellationToken): Promise<string[]> {
		const files: string[] = [];
		const pattern = new vscode.RelativePattern(folderPath, '**/*.md');
		const mdFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1000);

		for (const file of mdFiles) {
			if (token.isCancellationRequested) break;

			if (await this.isKanbanFile(file.fsPath)) {
				files.push(file.fsPath);
			}
		}

		return files;
	}

	/**
	 * Quick check for YAML header (first few bytes)
	 */
	private async hasYamlHeader(filePath: string): Promise<boolean> {
		try {
			// Only read the first 100 bytes to check for YAML header start
			const fd = await fs.promises.open(filePath, 'r');
			try {
				const buffer = Buffer.alloc(100);
				await fd.read(buffer, 0, 100, 0);
				const start = buffer.toString('utf8');
				return start.trimStart().startsWith('---');
			} finally {
				await fd.close();
			}
		} catch {
			return false;
		}
	}

	/**
	 * Check if file is a kanban board (with caching)
	 */
	private async isKanbanFile(filePath: string): Promise<boolean> {
		// Check cache first
		const cached = this.validationCache.get(filePath);
		if (cached) {
			const age = Date.now() - cached.timestamp;
			if (age < KanbanSidebarProvider.CACHE_TTL) {
				return cached.isValid;
			}
		}

		// Validate by reading file
		try {
			const stats = await fs.promises.stat(filePath);
			if (!stats.isFile()) {
				return false;
			}

			const content = await fs.promises.readFile(filePath, 'utf8');

			// Check for YAML header with kanban-plugin: board
			const hasYamlHeader = content.includes('---');
			const hasKanbanMarker = content.includes('kanban-plugin: board');
			const isValid = hasYamlHeader && hasKanbanMarker;

			// Cache result
			this.validationCache.set(filePath, {
				isValid,
				timestamp: Date.now()
			});

			return isValid;
		} catch (error) {
			console.error(`[Kanban Sidebar] Failed to validate ${filePath}:`, error);
			return false;
		}
	}

	/**
	 * Remove kanban file
	 */
	async removeFile(item: KanbanBoardItem): Promise<void> {
		const filePath = item.uri.fsPath;

		this.kanbanFiles.delete(filePath);
		this.unwatchFile(filePath);
		this.validationCache.delete(filePath);

		// Remove from custom order
		this.customOrder = this.customOrder.filter(path => path !== filePath);

		await this.saveToWorkspaceState();
		this.refresh();

		showInfo(`Removed ${item.label} from kanban list`);
	}

	/**
	 * Watch file for changes
	 */
	private watchFile(filePath: string): void {
		if (this.fileWatchers.has(filePath)) {
			return; // Already watching
		}

		const watcher = vscode.workspace.createFileSystemWatcher(filePath);

		watcher.onDidChange(() => {
			// Invalidate cache
			this.validationCache.delete(filePath);
			this.refresh();
		});

		watcher.onDidDelete(() => {
			// Remove from list
			this.kanbanFiles.delete(filePath);
			this.unwatchFile(filePath);
			this.saveToWorkspaceState();
			this.refresh();
		});

		this.fileWatchers.set(filePath, watcher);
		this.context.subscriptions.push(watcher);
	}

	/**
	 * Stop watching file
	 */
	private unwatchFile(filePath: string): void {
		const watcher = this.fileWatchers.get(filePath);
		if (watcher) {
			watcher.dispose();
			this.fileWatchers.delete(filePath);
		}
	}

	/**
	 * Handle workspace folder changes
	 */
	private handleWorkspaceFolderChanges(e: vscode.WorkspaceFoldersChangeEvent): void {
		// Remove files from deleted folders
		for (const removed of e.removed) {
			const removedPath = removed.uri.fsPath;
			const filesToRemove: string[] = [];

			for (const filePath of this.kanbanFiles) {
				if (filePath.startsWith(removedPath)) {
					filesToRemove.push(filePath);
				}
			}

			for (const filePath of filesToRemove) {
				this.kanbanFiles.delete(filePath);
				this.unwatchFile(filePath);
				this.validationCache.delete(filePath);
			}
		}

		// Auto-scan new folders (if auto-scan enabled)
		if (this.autoScan && e.added.length > 0) {
			this.scanWorkspace().catch(err => {
				console.error('[Kanban Sidebar] Auto-scan of new folders failed:', err);
			});
		}

		this.saveToWorkspaceState();
		this.refresh();
	}

	/**
	 * Clear all kanban files
	 */
	async clear(): Promise<void> {
		const result = await notificationService.confirm(
			'Remove all kanban boards from sidebar?',
			'Yes'
		);

		if (result !== 'confirm') {
			return;
		}

		// Unwatch all files
		for (const filePath of this.kanbanFiles) {
			this.unwatchFile(filePath);
		}

		this.kanbanFiles.clear();
		this.validationCache.clear();

		await this.saveToWorkspaceState();
		this.refresh();

		showInfo('Kanban sidebar cleared');
	}

	/**
	 * Set active filter
	 */
	async setFilter(category: FileCategory): Promise<void> {
		this.activeFilter = category;
		this.refresh();

		// Show feedback message
		const label = FileTypeDetector.getCategoryLabel(category);
		const count = this.categoryCounts.get(category) || this.kanbanFiles.size;
		showInfo(`Filter: ${label} (${count} file(s))`);
	}

	/**
	 * Show filter quick pick menu
	 */
	async showFilterMenu(): Promise<void> {
		// Build quick pick items with counts
		const items: vscode.QuickPickItem[] = [
			{
				label: `$(${FileTypeDetector.getCategoryIcon(FileCategory.Regular)}) Regular Kanbans`,
				description: `${this.categoryCounts.get(FileCategory.Regular) || 0} file(s)`,
				detail: 'Show only regular kanban boards (default)',
				picked: this.activeFilter === FileCategory.Regular
			},
			{
				label: `$(${FileTypeDetector.getCategoryIcon(FileCategory.All)}) All Files`,
				description: `${this.kanbanFiles.size} file(s)`,
				detail: 'Show all kanban boards (including backups, conflicts, etc.)',
				picked: this.activeFilter === FileCategory.All
			},
			{
				label: `$(${FileTypeDetector.getCategoryIcon(FileCategory.Backups)}) Backups`,
				description: `${this.categoryCounts.get(FileCategory.Backups) || 0} file(s)`,
				detail: 'Show backup files (.{name}-backup-{timestamp}.md)',
				picked: this.activeFilter === FileCategory.Backups
			},
			{
				label: `$(${FileTypeDetector.getCategoryIcon(FileCategory.Conflicts)}) Conflicts`,
				description: `${this.categoryCounts.get(FileCategory.Conflicts) || 0} file(s)`,
				detail: 'Show conflict files ({name}-conflict-{timestamp}.md)',
				picked: this.activeFilter === FileCategory.Conflicts
			},
			{
				label: `$(${FileTypeDetector.getCategoryIcon(FileCategory.Autosaves)}) Autosaves`,
				description: `${this.categoryCounts.get(FileCategory.Autosaves) || 0} file(s)`,
				detail: 'Show autosave files (.{name}-autosave.md)',
				picked: this.activeFilter === FileCategory.Autosaves
			},
			{
				label: `$(${FileTypeDetector.getCategoryIcon(FileCategory.UnsavedChanges)}) Unsaved Changes`,
				description: `${this.categoryCounts.get(FileCategory.UnsavedChanges) || 0} file(s)`,
				detail: 'Show unsaved changes files (.{name}-unsavedchanges.md)',
				picked: this.activeFilter === FileCategory.UnsavedChanges
			}
		];

		const selected = await vscode.window.showQuickPick(items, {
			title: 'Filter Kanban Boards',
			placeHolder: 'Select a category to filter'
		});

		if (selected) {
			// Extract category from label
			const categoryMap: { [key: string]: FileCategory } = {
				'Regular Kanbans': FileCategory.Regular,
				'All Files': FileCategory.All,
				'Backups': FileCategory.Backups,
				'Conflicts': FileCategory.Conflicts,
				'Autosaves': FileCategory.Autosaves,
				'Unsaved Changes': FileCategory.UnsavedChanges
			};

			const labelWithoutIcon = selected.label.replace(/^\$\(.*?\)\s*/, '');
			const category = categoryMap[labelWithoutIcon];

			if (category) {
				await this.setFilter(category);
			}
		}
	}

	/**
	 * Get current filter
	 */
	getActiveFilter(): FileCategory {
		return this.activeFilter;
	}

	/**
	 * Get category counts
	 */
	getCategoryCounts(): Map<FileCategory, number> {
		return new Map(this.categoryCounts);
	}

	/**
	 * Reorder files via drag & drop
	 */
	async reorderFiles(draggedPaths: string[], target: KanbanBoardItem | undefined): Promise<void> {
		// Get all current file paths in display order
		const currentItems = await this.getChildren();
		const currentOrder = currentItems.map(item => item.uri.fsPath);

		// Remove dragged items from current order
		const withoutDragged = currentOrder.filter(path => !draggedPaths.includes(path));

		let newOrder: string[];

		if (target) {
			// Insert before target
			const targetIndex = withoutDragged.indexOf(target.uri.fsPath);
			if (targetIndex !== -1) {
				newOrder = [
					...withoutDragged.slice(0, targetIndex),
					...draggedPaths,
					...withoutDragged.slice(targetIndex)
				];
			} else {
				// Target not found, append at end
				newOrder = [...withoutDragged, ...draggedPaths];
			}
		} else {
			// No target, append at end
			newOrder = [...withoutDragged, ...draggedPaths];
		}

		// Update custom order
		this.customOrder = newOrder;

		// Save and refresh
		await this.saveToWorkspaceState();
		this.refresh();
	}

	/**
	 * Add file to sidebar and update custom order
	 */
	async addFile(uri: vscode.Uri): Promise<void> {
		const filePath = uri.fsPath;

		// Check if already exists
		if (this.kanbanFiles.has(filePath)) {
			showWarning('File already in kanban list');
			return;
		}

		// Validate it's a kanban file
		const isValid = await this.isKanbanFile(filePath);
		if (!isValid) {
			const result = await notificationService.confirm(
				'This file does not appear to be a kanban board (missing "kanban-plugin: board" in YAML header). Add anyway?',
				'Yes'
			);
			if (result !== 'confirm') {
				return;
			}
		}

		// Add to list
		this.kanbanFiles.add(filePath);
		this.watchFile(filePath);

		// Add to custom order (at end)
		if (!this.customOrder.includes(filePath)) {
			this.customOrder.push(filePath);
		}

		await this.saveToWorkspaceState();
		this.refresh();

		showInfo(`Added ${path.basename(filePath)} to kanban list`);
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		for (const watcher of this.fileWatchers.values()) {
			watcher.dispose();
		}
		this.fileWatchers.clear();
	}
}
