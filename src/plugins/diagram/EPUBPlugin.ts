/**
 * EPUB Document Plugin
 *
 * Renders EPUB pages to PNG using mutool (MuPDF) CLI.
 * Migrated from src/services/export/EPUBService.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { AbstractCLIService } from '../../services/export/AbstractCLIService';
import {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramRenderOptions,
    DiagramRenderResult,
    DiagramFileInfo
} from '../interfaces/DiagramPlugin';

/**
 * Internal CLI service for EPUB operations
 */
class EPUBCLI extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'mutoolPath';
    }

    protected getDefaultCliName(): string {
        return 'mutool';
    }

    protected getServiceName(): string {
        return 'EPUBPlugin';
    }

    protected getCliNotFoundWarning(): string {
        return 'mutool CLI is not installed. EPUB page rendering will not work.';
    }

    protected getInstallationUrl(): string {
        return 'https://mupdf.com/docs/manual-mutool-draw.html';
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
                `${programFiles}\\mupdf\\${cliName}.exe`,
                `${programFiles}\\MuPDF\\${cliName}.exe`,
            ];
        } else {
            return [
                `/usr/bin/${cliName}`,
                `/usr/local/bin/${cliName}`,
            ];
        }
    }

    async renderPage(filePath: string, pageNumber: number = 1, dpi: number = 150): Promise<Buffer> {
        const tempOutput = this.getTempFilePath(`epub-${pageNumber}`, 'png');

        const args = [
            'draw',
            '-r', dpi.toString(),
            '-o', tempOutput,
            filePath,
            pageNumber.toString()
        ];

        const result = await this.executeAndReadOutput(args, tempOutput, { binary: true });
        return result as Buffer;
    }
}

export class EPUBPlugin implements DiagramPlugin {
    readonly metadata: DiagramPluginMetadata = {
        id: 'epub',
        name: 'EPUB Page Renderer',
        version: '1.0.0',
        supportedCodeBlocks: [],
        supportedFileExtensions: ['.epub'],
        renderOutput: 'png',
        requiresExternalTool: true,
        externalToolName: 'mutool (MuPDF)',
        configKeys: ['mutoolPath']
    };

    private _cli = new EPUBCLI();

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
        const pageCount = await this._getPageCount(filePath);
        const stats = await fs.promises.stat(filePath);
        return { pageCount, fileMtime: stats.mtimeMs };
    }

    private async _getPageCount(filePath: string): Promise<number> {
        try {
            const zip = new AdmZip(filePath);

            const containerEntry = zip.getEntry('META-INF/container.xml');
            if (!containerEntry) {
                throw new Error('Invalid EPUB: Missing META-INF/container.xml');
            }

            const containerXml = containerEntry.getData().toString('utf8');

            const rootfileMatch = containerXml.match(/rootfile[^>]+full-path=["']([^"']+)["']/i);
            if (!rootfileMatch) {
                throw new Error('Invalid EPUB: Cannot find rootfile in container.xml');
            }

            const opfPath = rootfileMatch[1];
            const opfEntry = zip.getEntry(opfPath);
            if (!opfEntry) {
                throw new Error(`Invalid EPUB: Cannot find OPF file at ${opfPath}`);
            }

            const opfContent = opfEntry.getData().toString('utf8');

            const spineMatch = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
            if (!spineMatch) {
                throw new Error('Invalid EPUB: Cannot find spine in OPF');
            }

            const spineContent = spineMatch[1];
            const itemrefMatches = spineContent.match(/<itemref[^>]*>/gi);
            const pageCount = itemrefMatches ? itemrefMatches.length : 0;

            if (pageCount === 0) {
                throw new Error('Invalid EPUB: No spine items found');
            }

            return pageCount;
        } catch (error) {
            console.error('[EPUBPlugin] Failed to get page count:', error);
            throw error;
        }
    }
}
