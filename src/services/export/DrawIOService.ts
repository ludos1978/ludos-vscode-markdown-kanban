import * as vscode from 'vscode';
import { AbstractCLIService } from './AbstractCLIService';

/**
 * Service for converting draw.io diagrams to SVG/PNG using draw.io CLI
 */
export class DrawIOService extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'drawioPath';
    }

    protected getDefaultCliName(): string {
        return 'drawio';
    }

    protected getServiceName(): string {
        return 'DrawIOService';
    }

    protected getVersionCheckArgs(): string[] {
        return ['--version'];
    }

    protected isVersionCheckSuccess(code: number | null): boolean {
        return code === 0;
    }

    protected getCliNotFoundWarning(): string {
        return 'draw.io CLI is not installed. Draw.io diagrams will not be converted during export.';
    }

    protected getInstallationUrl(): string {
        return 'https://github.com/jgraph/drawio-desktop/releases';
    }

    /**
     * Override to show platform-specific installation instructions
     */
    protected showCliWarning(): void {
        const message = this.getCliNotFoundWarning();
        const installAction = 'Installation Instructions';

        vscode.window.showWarningMessage(message, installAction).then(selection => {
            if (selection === installAction) {
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
     * Render draw.io diagram file to specified format
     */
    private async renderDiagram(filePath: string, format: 'svg' | 'png'): Promise<string | Buffer> {
        const tempOutput = this.getTempFilePath('drawio', format);
        const isPng = format === 'png';

        const args = [
            '--export',
            '--format', format,
            '--output', tempOutput,
            filePath
        ];

        if (isPng) {
            args.push('--transparent');
        }

        return this.executeAndReadOutput(args, tempOutput, { binary: isPng });
    }
}
