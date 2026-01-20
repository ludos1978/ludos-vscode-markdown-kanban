import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { AbstractCLIService } from './AbstractCLIService';

/**
 * Service for rendering individual PDF pages to images
 * Uses pdftoppm CLI tool from poppler-utils for conversion
 *
 * Supports:
 * - Rendering specific pages from PDF files
 * - PNG output with configurable DPI
 */
export class PDFService extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'popplerPath';
    }

    protected getDefaultCliName(): string {
        return 'pdftoppm';
    }

    protected getServiceName(): string {
        return 'PDFService';
    }

    protected getCliNotFoundWarning(): string {
        return 'pdftoppm CLI is not installed. PDF page rendering will not work.';
    }

    protected getInstallationUrl(): string {
        return 'https://poppler.freedesktop.org/';
    }

    /**
     * Render a specific page from a PDF file to PNG
     * @param filePath Absolute path to .pdf file
     * @param pageNumber Page number to render (1-indexed)
     * @param dpi Resolution in DPI (default: 150)
     * @returns PNG data as Buffer
     */
    async renderPage(filePath: string, pageNumber: number = 1, dpi: number = 150): Promise<Buffer> {
        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error('pdftoppm CLI not available');
        }

        const tempDir = this.ensureTempDir();
        const tempPrefix = path.join(tempDir, `pdf-${Date.now()}`);

        // pdftoppm -png -f PAGE -l PAGE -r DPI input.pdf output-prefix
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
            console.error('[PDFService] Conversion failed:', stderr);
            throw new Error(`pdftoppm exited with code ${code}`);
        }

        // pdftoppm creates files like: prefix-N.png where N is the page number
        const outputPath = await this.findOutputFile(tempDir, tempPrefix, pageNumber);

        if (!outputPath) {
            const errorMsg = 'pdftoppm exited successfully but did not create output file';
            console.error('[PDFService]', errorMsg);
            if (stderr) {
                console.error('[PDFService] stderr output:', stderr);
            }
            throw new Error(errorMsg);
        }

        const png = await fs.promises.readFile(outputPath);
        await fs.promises.unlink(outputPath);
        return png;
    }

    /**
     * Find the output file created by pdftoppm (handles various naming patterns)
     */
    private async findOutputFile(tempDir: string, tempPrefix: string, pageNumber: number): Promise<string | null> {
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

        // Try to find any file starting with tempPrefix
        const files = fs.readdirSync(tempDir).filter(f => f.startsWith(path.basename(tempPrefix)));
        if (files.length > 0) {
            return path.join(tempDir, files[0]);
        }

        return null;
    }

    /**
     * Get the total page count from a PDF file
     * Uses pdfinfo command from poppler-utils
     * @param filePath Absolute path to .pdf file
     * @returns Total number of pages
     */
    async getPageCount(filePath: string): Promise<number> {
        // Determine pdfinfo path - derive from cliPath or use config/PATH
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

            child.on('error', (error) => {
                console.error('[PDFService] pdfinfo error:', error);
                reject(new Error('pdfinfo command not found'));
            });

            child.on('exit', (code) => {
                if (code !== 0) {
                    console.error('[PDFService] pdfinfo failed:', stderr);
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

    /**
     * Get supported file extensions
     */
    getSupportedExtensions(): string[] {
        return ['.pdf'];
    }
}
