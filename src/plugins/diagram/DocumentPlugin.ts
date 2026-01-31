/**
 * Document Plugin
 *
 * Renders LibreOffice-compatible documents (DOCX, DOC, ODT, PPTX, PPT, ODP)
 * to PNG pages via a two-step pipeline: Source Doc -> PDF (LibreOffice) -> PNG (pdftoppm).
 *
 * Reuses PDFCLI from PDFPlugin for PDF-to-PNG rendering and page counting.
 * Caches the intermediate PDF to avoid re-converting unchanged documents.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AbstractCLIService } from '../../services/export/AbstractCLIService';
import {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramRenderOptions,
    DiagramRenderResult,
    DiagramFileInfo
} from '../interfaces/DiagramPlugin';
import { PDFCLI } from './PDFPlugin';

/**
 * CLI service for converting documents to PDF via LibreOffice.
 * Shares the same soffice binary as XlsxPlugin.
 */
class DocumentCLI extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'libreOfficePath';
    }

    protected getDefaultCliName(): string {
        return 'soffice';
    }

    protected getServiceName(): string {
        return 'DocumentPlugin';
    }

    protected getVersionCheckArgs(): string[] {
        return ['--version'];
    }

    protected isVersionCheckSuccess(code: number | null): boolean {
        return code === 0;
    }

    protected getCliNotFoundWarning(): string {
        return 'LibreOffice CLI is not installed. Document rendering (DOCX, PPTX, etc.) will not work.';
    }

    protected getInstallationUrl(): string {
        return 'https://www.libreoffice.org/download/download/';
    }

    protected getCommonPaths(): string[] {
        const platform = process.platform;

        if (platform === 'darwin') {
            return [
                '/Applications/LibreOffice.app/Contents/MacOS/soffice',
                '/opt/homebrew/bin/soffice',
                '/usr/local/bin/soffice',
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
                '/usr/bin/soffice',
                '/usr/local/bin/soffice',
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

    /**
     * Convert a document to PDF using LibreOffice headless mode.
     * Caches the intermediate PDF based on source file mtime.
     *
     * @param filePath - Absolute path to source document
     * @returns Absolute path to the cached PDF file
     */
    async convertToPDF(filePath: string): Promise<string> {
        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error('LibreOffice CLI not available');
        }

        const stats = await fs.promises.stat(filePath);
        const mtime = Math.floor(stats.mtimeMs);
        const basename = path.basename(filePath, path.extname(filePath));

        // Use a cache directory alongside the source file
        const cacheDir = path.join(path.dirname(filePath), '.document-pdf-cache');
        await fs.promises.mkdir(cacheDir, { recursive: true });

        const cachedPdfName = `${basename}-${mtime}.pdf`;
        const cachedPdfPath = path.join(cacheDir, cachedPdfName);

        // Return cached PDF if it exists
        if (fs.existsSync(cachedPdfPath)) {
            return cachedPdfPath;
        }

        // Clean up old cached PDFs for this document
        try {
            const files = await fs.promises.readdir(cacheDir);
            for (const file of files) {
                if (file.startsWith(`${basename}-`) && file.endsWith('.pdf')) {
                    await fs.promises.unlink(path.join(cacheDir, file));
                }
            }
        } catch {
            // Ignore cleanup errors
        }

        // Convert to PDF via LibreOffice
        const tempDir = this.ensureTempDir();
        const args = [
            '--headless',
            '--convert-to', 'pdf',
            '--outdir', tempDir,
            filePath
        ];

        const { code } = await this.executeCliCommand(args);

        if (code !== 0) {
            throw new Error(`LibreOffice PDF conversion exited with code ${code}`);
        }

        // Find the output PDF in tempDir
        const outputPdfPath = path.join(tempDir, `${basename}.pdf`);
        if (!fs.existsSync(outputPdfPath)) {
            throw new Error('LibreOffice conversion completed but PDF output not found');
        }

        // Move the PDF to cache directory
        await fs.promises.copyFile(outputPdfPath, cachedPdfPath);
        await fs.promises.unlink(outputPdfPath);

        return cachedPdfPath;
    }
}

export class DocumentPlugin implements DiagramPlugin {
    readonly metadata: DiagramPluginMetadata = {
        id: 'document',
        name: 'Document Renderer',
        version: '1.0.0',
        supportedCodeBlocks: [],
        supportedFileExtensions: ['.docx', '.doc', '.odt', '.pptx', '.ppt', '.odp'],
        renderOutput: 'png',
        requiresExternalTool: true,
        externalToolName: 'LibreOffice + pdftoppm (poppler-utils)',
        configKeys: ['libreOfficePath', 'popplerPath']
    };

    private _docCli = new DocumentCLI();
    private _pdfCli = new PDFCLI();

    canRenderCodeBlock(_language: string): boolean {
        return false;
    }

    canRenderFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.metadata.supportedFileExtensions.includes(ext);
    }

    async isAvailable(): Promise<boolean> {
        const [libreOfficeAvailable, pdftoppmAvailable] = await Promise.all([
            this._docCli.isAvailable(),
            this._pdfCli.isAvailable()
        ]);
        return libreOfficeAvailable && pdftoppmAvailable;
    }

    async renderFile(filePath: string, options?: DiagramRenderOptions): Promise<DiagramRenderResult> {
        try {
            const pageNumber = options?.pageNumber ?? 1;
            const dpi = options?.dpi ?? 150;

            // Step 1: Convert source doc to PDF (cached)
            const pdfPath = await this._docCli.convertToPDF(filePath);

            // Step 2: Render requested page from PDF via pdftoppm
            const png = await this._pdfCli.renderPage(pdfPath, pageNumber, dpi);
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
        // Step 1: Convert source doc to PDF (cached)
        const pdfPath = await this._docCli.convertToPDF(filePath);

        // Step 2: Get page count from the converted PDF
        const pageCount = await this._pdfCli.getPageCount(pdfPath);
        const stats = await fs.promises.stat(filePath);
        return { pageCount, fileMtime: stats.mtimeMs };
    }
}
