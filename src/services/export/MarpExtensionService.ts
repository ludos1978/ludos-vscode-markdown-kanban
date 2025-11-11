import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Service to interact with the Marp VSCode extension
 */
export class MarpExtensionService {
    private static readonly MARP_EXTENSION_ID = 'marp-team.marp-vscode';
    private static readonly MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=marp-team.marp-vscode';

    /**
     * Check if Marp VSCode extension is installed
     * @returns True if extension is installed
     */
    static isMarpExtensionInstalled(): boolean {
        const extension = vscode.extensions.getExtension(this.MARP_EXTENSION_ID);
        return !!extension;
    }

    /**
     * Check if Marp extension is installed and active
     * @returns Promise that resolves to true if active
     */
    static async isMarpExtensionActive(): Promise<boolean> {
        const extension = vscode.extensions.getExtension(this.MARP_EXTENSION_ID);
        if (!extension) {
            return false;
        }

        if (!extension.isActive) {
            try {
                await extension.activate();
            } catch (err) {
                console.error('[kanban.MarpExtensionService] Failed to activate Marp extension:', err);
                return false;
            }
        }

        return extension.isActive;
    }

    /**
     * Open a markdown file in Marp preview mode
     * @param filePath - Path to the markdown file
     * @returns Promise that resolves when preview is opened
     */
    static async openInMarpPreview(filePath: string): Promise<void> {
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] 🔵 START - filePath: "${filePath}"`);
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] filePath type: ${typeof filePath}`);
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] filePath length: ${filePath?.length}`);

        // Ensure file exists
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] Checking if file exists...`);
        const fileExists = fs.existsSync(filePath);
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] File exists: ${fileExists}`);

        if (!fileExists) {
            console.error(`[kanban.MarpExtensionService.openInMarpPreview] ❌ File not found: ${filePath}`);
            throw new Error(`File not found: ${filePath}`);
        }

        console.log(`[kanban.MarpExtensionService.openInMarpPreview] Creating URI from file path...`);
        const uri = vscode.Uri.file(filePath);
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] URI created: ${uri.toString()}`);

        // Open the document
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] Opening text document...`);
        const doc = await vscode.workspace.openTextDocument(uri);
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] Document opened: ${doc.fileName}`);

        console.log(`[kanban.MarpExtensionService.openInMarpPreview] Showing text document in editor...`);
        await vscode.window.showTextDocument(doc, { preview: false });
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] ✅ Document shown in editor`);

        // Check if extension is installed
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] Checking if Marp extension is installed...`);
        const extensionInstalled = this.isMarpExtensionInstalled();
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] Marp extension installed: ${extensionInstalled}`);

        if (!extensionInstalled) {
            console.log(`[kanban.MarpExtensionService.openInMarpPreview] Extension not installed - prompting user...`);
            // Extension not installed - show install prompt
            const choice = await this.promptInstallMarpExtension();
            console.log(`[kanban.MarpExtensionService.openInMarpPreview] User choice: ${choice}`);

            vscode.window.showInformationMessage(
                'Marp presentation file opened. After installing the Marp extension, click the preview button in the editor toolbar to start the presentation.',
                'OK'
            );
            console.log(`[kanban.MarpExtensionService.openInMarpPreview] 🔵 END (extension not installed)`);
            return;
        }

        // Extension is installed - show helpful message
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] Showing info message to user...`);
        vscode.window.showInformationMessage(
            'Marp presentation file opened. Click the preview button (top-right) or use Cmd+K V to preview.',
            'OK'
        );
        console.log(`[kanban.MarpExtensionService.openInMarpPreview] ✅ 🔵 END (success)`);
    }

    /**
     * Save markdown content to a file and open in Marp preview
     * @param markdownContent - The markdown content
     * @param outputPath - Path where to save the file
     * @returns Promise that resolves when preview is opened
     */
    static async saveAndOpenInMarpPreview(markdownContent: string, outputPath: string): Promise<void> {
        // Ensure output directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write markdown file
        fs.writeFileSync(outputPath, markdownContent, 'utf-8');

        // Open in Marp preview
        await this.openInMarpPreview(outputPath);
    }

    /**
     * Prompt user to install Marp extension
     * @returns Promise that resolves when user responds
     */
    static async promptInstallMarpExtension(): Promise<void> {
        const message = 'Marp VSCode extension is required for presentation mode. Would you like to install it?';
        const install = 'Install Marp Extension';
        const learnMore = 'Learn More';
        const cancel = 'Cancel';

        const choice = await vscode.window.showInformationMessage(message, install, learnMore, cancel);

        if (choice === install) {
            // Open extension marketplace
            await vscode.commands.executeCommand('workbench.extensions.installExtension', this.MARP_EXTENSION_ID);
        } else if (choice === learnMore) {
            // Open marketplace page in browser
            await vscode.env.openExternal(vscode.Uri.parse(this.MARKETPLACE_URL));
        }
    }

    /**
     * Export using Marp extension commands
     * @param filePath - Path to the markdown file
     * @param format - Export format (pdf, pptx, html)
     * @returns Promise that resolves when export completes
     */
    static async exportUsingMarpExtension(filePath: string, format: 'pdf' | 'pptx' | 'html'): Promise<void> {
        // Check if extension is installed
        if (!this.isMarpExtensionInstalled()) {
            await this.promptInstallMarpExtension();
            throw new Error('Marp extension is not installed');
        }

        const uri = vscode.Uri.file(filePath);

        try {
            // Execute Marp export command
            // Note: These commands may vary based on Marp extension version
            const command = `marp.export.${format}`;
            await vscode.commands.executeCommand(command, uri);
        } catch (err) {
            console.error(`[kanban.MarpExtensionService] Failed to export via Marp extension:`, err);

            // Fallback: Show message directing user to export manually
            vscode.window.showInformationMessage(
                `Please open the Marp preview and use the export button to export to ${format.toUpperCase()}.`,
                'Open Preview'
            ).then(choice => {
                if (choice === 'Open Preview') {
                    this.openInMarpPreview(filePath);
                }
            });
        }
    }

    /**
     * Get Marp extension status information
     * @returns Status object
     */
    static getMarpStatus(): {
        installed: boolean;
        version?: string;
    } {
        const extension = vscode.extensions.getExtension(this.MARP_EXTENSION_ID);

        if (!extension) {
            return { installed: false };
        }

        return {
            installed: true,
            version: extension.packageJSON?.version
        };
    }

    /**
     * Show Marp status in status bar (optional enhancement)
     */
    static createMarpStatusBarItem(): vscode.StatusBarItem {
        const statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        const status = this.getMarpStatus();

        if (status.installed) {
            statusBarItem.text = `$(check) Marp`;
            statusBarItem.tooltip = `Marp Extension v${status.version || 'unknown'} installed`;
        } else {
            statusBarItem.text = `$(x) Marp`;
            statusBarItem.tooltip = 'Marp Extension not installed (click to install)';
            statusBarItem.command = {
                title: 'Install Marp Extension',
                command: 'workbench.extensions.installExtension',
                arguments: [this.MARP_EXTENSION_ID]
            };
        }

        return statusBarItem;
    }
}
