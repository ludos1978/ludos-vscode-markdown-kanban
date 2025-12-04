import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Service for converting draw.io diagrams to SVG using draw.io CLI
 * Similar architecture to PlantUMLService - uses external CLI tool
 */
export class DrawIOService {
    private availabilityChecked: boolean = false;
    private isCliAvailable: boolean = false;
    private cliPath: string | null = null;

    /**
     * Check if draw.io CLI is installed on the system
     */
    async isAvailable(): Promise<boolean> {
        if (this.availabilityChecked) {
            return this.isCliAvailable;
        }

        // Check configured path or use PATH
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const customPath = config.get<string>('drawioPath', '');

        // Use configured path or fall back to PATH
        const cliName = customPath || 'drawio';

        if (await this.testCliCommand(cliName)) {
            this.cliPath = cliName;
            this.isCliAvailable = true;
            this.availabilityChecked = true;
            console.log(`[DrawIOService] Found draw.io CLI: ${cliName}`);
            return true;
        }

        this.availabilityChecked = true;
        this.isCliAvailable = false;
        console.warn('[DrawIOService] draw.io CLI not found. Configure markdown-kanban.drawioPath in settings.');
        return false;
    }

    /**
     * Test if a CLI command is available by running version check
     */
    private async testCliCommand(command: string): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const process = spawn(command, ['--version']);

                process.on('error', () => {
                    resolve(false);
                });

                process.on('exit', (code) => {
                    resolve(code === 0);
                });

                // Timeout after 2 seconds
                setTimeout(() => {
                    process.kill();
                    resolve(false);
                }, 2000);
            } catch (error) {
                resolve(false);
            }
        });
    }

    /**
     * Render draw.io diagram file to specified format
     * @param filePath Absolute path to .drawio or .dio file
     * @param format Output format: 'svg' or 'png'
     * @returns Image data as string (SVG) or Buffer (PNG)
     */
    private async renderDiagram(filePath: string, format: 'svg' | 'png'): Promise<string | Buffer> {
        // Check CLI availability
        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error('draw.io CLI not available');
        }

        return new Promise((resolve, reject) => {
            const timeout = 30000; // 30 seconds

            // Create temp output file path
            const tempDir = path.join(__dirname, '../../../tmp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const ext = format === 'png' ? 'png' : 'svg';
            const tempOutputPath = path.join(tempDir, `drawio-${Date.now()}.${ext}`);

            // Build CLI arguments
            const args = [
                '--export',
                '--format', format,
                '--output', tempOutputPath,
                filePath
            ];

            // Add transparent background for PNG
            if (format === 'png') {
                args.push('--transparent');
            }

            console.log(`[DrawIOService] Converting: ${path.basename(filePath)}`);
            console.log(`[DrawIOService] Command: ${this.cliPath} ${args.join(' ')}`);

            const child = spawn(this.cliPath!, args);

            let stderr = '';

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            // Set timeout
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`draw.io conversion timed out after ${timeout}ms`));
            }, timeout);

            child.on('error', (error) => {
                clearTimeout(timer);
                console.error('[DrawIOService] Process error:', error);
                reject(error);
            });

            child.on('exit', async (code) => {
                clearTimeout(timer);

                // Log stderr even on success for debugging
                if (stderr) {
                    console.log('[DrawIOService] stderr:', stderr);
                }

                if (code !== 0) {
                    console.error('[DrawIOService] Conversion failed:', stderr);
                    // Cleanup temp file if exists
                    if (fs.existsSync(tempOutputPath)) {
                        fs.unlinkSync(tempOutputPath);
                    }
                    reject(new Error(`draw.io CLI exited with code ${code}: ${stderr}`));
                    return;
                }

                try {
                    // Check if output file was actually created
                    if (!fs.existsSync(tempOutputPath)) {
                        const errorMsg = `draw.io CLI exited successfully but did not create output file. ` +
                            `This usually means the draw.io GUI app was detected instead of the CLI tool. ` +
                            `Please install the draw.io CLI: https://github.com/jgraph/drawio-desktop/releases ` +
                            `(look for drawio-*-x64.dmg or use 'brew install --cask drawio')`;
                        console.error('[DrawIOService]', errorMsg);
                        if (stderr) {
                            console.error('[DrawIOService] stderr output:', stderr);
                        }
                        reject(new Error(errorMsg));
                        return;
                    }

                    // Read output file (text for SVG, binary for PNG)
                    const data = format === 'svg'
                        ? await fs.promises.readFile(tempOutputPath, 'utf8')
                        : await fs.promises.readFile(tempOutputPath);

                    console.log(`[DrawIOService] ✅ Converted to ${format.toUpperCase()}: ${path.basename(filePath)} (${data.length} bytes)`);

                    // Cleanup temp file
                    await fs.promises.unlink(tempOutputPath);

                    resolve(data);
                } catch (error) {
                    console.error('[DrawIOService] Failed to read output:', error);
                    reject(error);
                }
            });
        });
    }

    /**
     * Render draw.io diagram file to SVG
     * @param filePath Absolute path to .drawio or .dio file
     * @returns SVG string
     */
    async renderSVG(filePath: string): Promise<string> {
        return this.renderDiagram(filePath, 'svg') as Promise<string>;
    }

    /**
     * Render draw.io diagram file to PNG
     * @param filePath Absolute path to .drawio or .dio file
     * @returns PNG data as Buffer
     */
    async renderPNG(filePath: string): Promise<Buffer> {
        return this.renderDiagram(filePath, 'png') as Promise<Buffer>;
    }

    /**
     * Show warning notification when CLI is not available
     * Similar to PlantUML's Graphviz warning
     */
    private showCliWarning(): void {
        const message = 'draw.io CLI is not installed. Draw.io diagrams will not be converted during export.';
        const installAction = 'Installation Instructions';

        vscode.window.showWarningMessage(message, installAction).then(selection => {
            if (selection === installAction) {
                // Show installation instructions based on platform
                const platform = process.platform;
                let instructions = '';

                if (platform === 'darwin') {
                    instructions = `Install draw.io desktop app with CLI support:\n\nbrew install --cask drawio\n\nOr download from: https://github.com/jgraph/drawio-desktop/releases\n\nNote: The GUI app may not work properly for CLI operations. Make sure the 'drawio' command is in your PATH.`;
                } else if (platform === 'win32') {
                    instructions = `Install draw.io desktop app:\n\nDownload from: https://github.com/jgraph/drawio-desktop/releases\n\nOr use chocolatey:\nchoco install drawio\n\nMake sure the CLI is in your PATH.`;
                } else {
                    instructions = `Install draw.io desktop app:\n\nDownload from: https://github.com/jgraph/drawio-desktop/releases\n\nOr use your package manager (e.g., apt, yum)\n\nMake sure the 'drawio' command is in your PATH.`;
                }

                vscode.window.showInformationMessage(instructions, { modal: true });
            }
        });
    }

    /**
     * Get recommended CLI installation command for current platform
     */
    getInstallationInstructions(): string {
        const platform = process.platform;

        switch (platform) {
            case 'darwin':
                return 'Install via Homebrew: brew install --cask drawio';
            case 'win32':
                return 'Download from: https://github.com/jgraph/drawio-desktop/releases';
            case 'linux':
                return 'Install via package manager or download from: https://github.com/jgraph/drawio-desktop/releases';
            default:
                return 'Download from: https://github.com/jgraph/drawio-desktop/releases';
        }
    }
}
