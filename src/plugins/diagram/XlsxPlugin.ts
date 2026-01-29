/**
 * XLSX/Spreadsheet Plugin
 *
 * Renders Excel/LibreOffice spreadsheets to PNG using LibreOffice CLI.
 * Migrated from src/services/export/XlsxService.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AbstractCLIService } from '../../services/export/AbstractCLIService';
import {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramRenderOptions,
    DiagramRenderResult
} from '../interfaces/DiagramPlugin';

/**
 * Internal CLI service for spreadsheet operations
 */
class XlsxCLI extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'libreOfficePath';
    }

    protected getDefaultCliName(): string {
        return 'soffice';
    }

    protected getServiceName(): string {
        return 'XlsxPlugin';
    }

    protected getVersionCheckArgs(): string[] {
        return ['--version'];
    }

    protected isVersionCheckSuccess(code: number | null): boolean {
        return code === 0;
    }

    protected getCliNotFoundWarning(): string {
        return 'LibreOffice CLI is not installed. Excel spreadsheet embedding will not work.';
    }

    protected getInstallationUrl(): string {
        return 'https://www.libreoffice.org/download/download/';
    }

    protected getCommonPaths(): string[] {
        const cliName = this.getDefaultCliName();
        const platform = process.platform;

        if (platform === 'darwin') {
            return [
                '/Applications/LibreOffice.app/Contents/MacOS/soffice',
                `/opt/homebrew/bin/${cliName}`,
                `/usr/local/bin/${cliName}`,
            ];
        } else if (platform === 'win32') {
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
            return [
                `${programFiles}\\LibreOffice\\program\\soffice.exe`,
                `${programFilesX86}\\LibreOffice\\program\\soffice.exe`,
            ];
        } else {
            return [
                `/usr/bin/${cliName}`,
                `/usr/local/bin/${cliName}`,
                '/usr/lib/libreoffice/program/soffice',
            ];
        }
    }

    protected showCliWarning(): void {
        const message = this.getCliNotFoundWarning();
        const installAction = 'Installation Instructions';

        vscode.window.showWarningMessage(message, installAction).then(selection => {
            if (selection === installAction) {
                const platform = process.platform;
                let instructions = '';

                if (platform === 'darwin') {
                    instructions = `Install LibreOffice:\n\nbrew install --cask libreoffice\n\nOr download from: https://www.libreoffice.org/download/download/`;
                } else if (platform === 'win32') {
                    instructions = `Install LibreOffice:\n\nDownload from: https://www.libreoffice.org/download/download/\n\nOr use chocolatey:\nchoco install libreoffice`;
                } else {
                    instructions = `Install LibreOffice:\n\nsudo apt install libreoffice\n\nOr download from: https://www.libreoffice.org/download/download/`;
                }

                vscode.window.showInformationMessage(instructions, { modal: true });
            }
        });
    }

    async renderPNG(filePath: string, sheetNumber: number = 1): Promise<Buffer> {
        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error('LibreOffice CLI not available');
        }

        const tempDir = this.ensureTempDir();
        const inputFileName = path.basename(filePath, path.extname(filePath));

        const args = [
            '--headless',
            '--convert-to', 'png',
            '--outdir', tempDir,
            filePath
        ];

        const { code, stderr } = await this.executeCliCommand(args);

        if (code !== 0) {
            throw new Error(`LibreOffice exited with code ${code}`);
        }

        const outputPath = await this._findSheetOutputFile(tempDir, inputFileName, sheetNumber);

        if (!outputPath) {
            throw new Error(`LibreOffice conversion completed but could not find output for sheet ${sheetNumber}`);
        }

        const png = await fs.promises.readFile(outputPath);
        await this._cleanupGeneratedFiles(tempDir, inputFileName);
        return png;
    }

    private async _findSheetOutputFile(tempDir: string, baseName: string, sheetNumber: number): Promise<string | null> {
        const files = await fs.promises.readdir(tempDir);
        const pngFiles = files.filter(f =>
            f.toLowerCase().startsWith(baseName.toLowerCase()) &&
            f.toLowerCase().endsWith('.png')
        ).sort();

        if (pngFiles.length === 0) {
            return null;
        }

        if (pngFiles.length === 1) {
            if (sheetNumber > 1) {
                console.warn(`[XlsxPlugin] Requested sheet ${sheetNumber} but only 1 sheet exists`);
            }
            return path.join(tempDir, pngFiles[0]);
        }

        const sheetIndex = sheetNumber - 1;

        const patterns = [
            `${baseName}-Sheet${sheetNumber}.png`,
            `${baseName}-${sheetNumber}.png`,
            `${baseName}_Sheet${sheetNumber}.png`,
            `${baseName}_${sheetNumber}.png`,
        ];

        for (const pattern of patterns) {
            const match = pngFiles.find(f => f.toLowerCase() === pattern.toLowerCase());
            if (match) {
                return path.join(tempDir, match);
            }
        }

        if (sheetIndex < pngFiles.length) {
            return path.join(tempDir, pngFiles[sheetIndex]);
        }

        console.warn(`[XlsxPlugin] Requested sheet ${sheetNumber} not found, returning first sheet`);
        return path.join(tempDir, pngFiles[0]);
    }

    private async _cleanupGeneratedFiles(tempDir: string, baseName: string): Promise<void> {
        try {
            const files = await fs.promises.readdir(tempDir);
            const pngFiles = files.filter(f =>
                f.toLowerCase().startsWith(baseName.toLowerCase()) &&
                f.toLowerCase().endsWith('.png')
            );

            for (const file of pngFiles) {
                await fs.promises.unlink(path.join(tempDir, file));
            }
        } catch (error) {
            console.warn('[XlsxPlugin] Failed to cleanup temp files:', error);
        }
    }
}

export class XlsxPlugin implements DiagramPlugin {
    readonly metadata: DiagramPluginMetadata = {
        id: 'xlsx',
        name: 'Spreadsheet Renderer',
        version: '1.0.0',
        supportedCodeBlocks: [],
        supportedFileExtensions: ['.xlsx', '.xls', '.ods'],
        renderOutput: 'png',
        requiresExternalTool: true,
        externalToolName: 'LibreOffice',
        configKeys: ['libreOfficePath']
    };

    private _cli = new XlsxCLI();

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
            const sheetNumber = options?.sheetNumber ?? 1;
            const png = await this._cli.renderPNG(filePath, sheetNumber);
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
}
