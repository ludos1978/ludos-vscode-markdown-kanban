/**
 * PDF Document Plugin
 *
 * Renders PDF pages to PNG using pdftoppm CLI (poppler-utils).
 * Migrated from src/services/export/PDFService.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { AbstractCLIService } from '../../services/export/AbstractCLIService';
import {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramRenderOptions,
    DiagramRenderResult,
    DiagramFileInfo
} from '../interfaces/DiagramPlugin';

/**
 * Internal CLI service for PDF operations
 */
export class PDFCLI extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'popplerPath';
    }

    protected getDefaultCliName(): string {
        return 'pdftoppm';
    }

    protected getServiceName(): string {
        return 'PDFPlugin';
    }

    protected getCliNotFoundWarning(): string {
        return 'pdftoppm CLI is not installed. PDF page rendering will not work.';
    }

    protected getInstallationUrl(): string {
        return 'https://poppler.freedesktop.org/';
    }

    protected getCommonPaths(): string[] {
        const cliName = this.getDefaultCliName();
        const platform = process.platform;

        if (platform === 'darwin') {
            return [
                `/opt/homebrew/bin/${cliName}`,
                `/usr/local/bin/${cliName}`,
                `/opt/local/bin/${cliName}`,
            ];
        } else if (platform === 'win32') {
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            return [
                `${programFiles}\\poppler\\bin\\${cliName}.exe`,
                `${programFiles}\\poppler-utils\\${cliName}.exe`,
            ];
        } else {
            return [
                `/usr/bin/${cliName}`,
                `/usr/local/bin/${cliName}`,
            ];
        }
    }

    async renderPage(filePath: string, pageNumber: number = 1, dpi: number = 150): Promise<Buffer> {
        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error('pdftoppm CLI not available');
        }

        const tempDir = this.ensureTempDir();
        const tempPrefix = path.join(tempDir, `pdf-${Date.now()}`);

        const args = [
            '-png',
            '-f', pageNumber.toString(),
            '-l', pageNumber.toString(),
            '-r', dpi.toString(),
            filePath,
            tempPrefix
        ];

        const { code, stderr } = await this.executeCliCommand(args);

        if (code !== 0) {
            throw new Error(`pdftoppm exited with code ${code}`);
        }

        const outputPath = await this._findOutputFile(tempDir, tempPrefix, pageNumber);

        if (!outputPath) {
            throw new Error('pdftoppm exited successfully but did not create output file');
        }

        const png = await fs.promises.readFile(outputPath);
        await fs.promises.unlink(outputPath);
        return png;
    }

    private async _findOutputFile(tempDir: string, tempPrefix: string, pageNumber: number): Promise<string | null> {
        const possibleFiles = [
            `${tempPrefix}-${pageNumber}.png`,
            `${tempPrefix}-${pageNumber.toString().padStart(2, '0')}.png`,
            `${tempPrefix}-${pageNumber.toString().padStart(3, '0')}.png`,
            `${tempPrefix}-1.png`,
        ];

        for (const candidate of possibleFiles) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        const files = fs.readdirSync(tempDir).filter(f => f.startsWith(path.basename(tempPrefix)));
        if (files.length > 0) {
            return path.join(tempDir, files[0]);
        }

        return null;
    }

    async getPageCount(filePath: string): Promise<number> {
        let pdfinfoPath: string;

        if (this.cliPath) {
            pdfinfoPath = this.cliPath.replace('pdftoppm', 'pdfinfo');
        } else {
            const config = vscode.workspace.getConfiguration('markdown-kanban');
            const popplerPath = config.get<string>('popplerPath', '');
            pdfinfoPath = popplerPath ? path.join(popplerPath, 'pdfinfo') : 'pdfinfo';
        }

        return new Promise((resolve, reject) => {
            const child = spawn(pdfinfoPath, [filePath]);

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', () => {
                reject(new Error('pdfinfo command not found'));
            });

            child.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`pdfinfo exited with code ${code}`));
                    return;
                }

                const match = stdout.match(/Pages:\s+(\d+)/);
                if (match) {
                    resolve(parseInt(match[1], 10));
                } else {
                    reject(new Error('Could not determine page count from pdfinfo output'));
                }
            });

            setTimeout(() => {
                child.kill();
                reject(new Error('pdfinfo timed out'));
            }, 5000);
        });
    }
}

export class PDFPlugin implements DiagramPlugin {
    readonly metadata: DiagramPluginMetadata = {
        id: 'pdf',
        name: 'PDF Page Renderer',
        version: '1.0.0',
        supportedCodeBlocks: [],
        supportedFileExtensions: ['.pdf'],
        renderOutput: 'png',
        requiresExternalTool: true,
        externalToolName: 'pdftoppm (poppler-utils)',
        configKeys: ['popplerPath']
    };

    private _cli = new PDFCLI();

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
            const pageNumber = options?.pageNumber ?? 1;
            const dpi = options?.dpi ?? 150;
            const png = await this._cli.renderPage(filePath, pageNumber, dpi);
            return { success: true, data: png, format: 'png' };
        } catch (error) {
            return {
                success: false,
                data: Buffer.alloc(0),
                format: 'png',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    async getFileInfo(filePath: string): Promise<DiagramFileInfo> {
        const pageCount = await this._cli.getPageCount(filePath);
        const stats = await fs.promises.stat(filePath);
        return { pageCount, fileMtime: stats.mtimeMs };
    }
}
