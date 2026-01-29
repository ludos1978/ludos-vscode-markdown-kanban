/**
 * Draw.io Diagram Plugin
 *
 * Renders .drawio/.dio files to SVG/PNG using the draw.io CLI.
 * Migrated from src/services/export/DrawIOService.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { AbstractCLIService } from '../../services/export/AbstractCLIService';
import {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramRenderOptions,
    DiagramRenderResult
} from '../interfaces/DiagramPlugin';

/**
 * Internal CLI service for draw.io operations
 */
class DrawIOCLI extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'drawioPath';
    }

    protected getDefaultCliName(): string {
        return 'drawio';
    }

    protected getServiceName(): string {
        return 'DrawIOPlugin';
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

    protected getCommonPaths(): string[] {
        const basePaths = super.getCommonPaths();

        if (process.platform === 'darwin') {
            return [
                ...basePaths,
                '/Applications/draw.io.app/Contents/MacOS/draw.io',
            ];
        }

        return basePaths;
    }

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

    async renderSVG(filePath: string): Promise<string> {
        return this._renderDiagram(filePath, 'svg') as Promise<string>;
    }

    async renderPNG(filePath: string): Promise<Buffer> {
        return this._renderDiagram(filePath, 'png') as Promise<Buffer>;
    }

    private async _renderDiagram(filePath: string, format: 'svg' | 'png'): Promise<string | Buffer> {
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

export class DrawIOPlugin implements DiagramPlugin {
    readonly metadata: DiagramPluginMetadata = {
        id: 'drawio',
        name: 'Draw.io Diagram Renderer',
        version: '1.0.0',
        supportedCodeBlocks: [],
        supportedFileExtensions: ['.drawio', '.dio'],
        renderOutput: 'png',
        requiresExternalTool: true,
        externalToolName: 'draw.io Desktop',
        configKeys: ['drawioPath']
    };

    private _cli = new DrawIOCLI();

    canRenderCodeBlock(_language: string): boolean {
        return false;
    }

    canRenderFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.metadata.supportedFileExtensions.includes(ext);
    }

    async isAvailable(): Promise<boolean> {
        return this._cli.isAvailable();
    }

    async renderFile(filePath: string, options?: DiagramRenderOptions): Promise<DiagramRenderResult> {
        try {
            const format = options?.outputFormat || this.metadata.renderOutput;

            if (format === 'svg') {
                const svg = await this._cli.renderSVG(filePath);
                return { success: true, data: svg, format: 'svg' };
            } else {
                const png = await this._cli.renderPNG(filePath);
                return { success: true, data: png, format: 'png' };
            }
        } catch (error) {
            return {
                success: false,
                data: '',
                format: options?.outputFormat || 'png',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
}
