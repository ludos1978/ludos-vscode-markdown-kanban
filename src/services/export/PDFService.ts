import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

/**
 * Service for rendering individual PDF pages to images
 * Uses pdftoppm CLI tool for conversion
 *
 * Supports:
 * - Rendering specific pages from PDF files
 * - PNG output with configurable DPI
 */
export class PDFService {
    private cliPath: string | null = null;
    private availabilityChecked: boolean = false;
    private isCliAvailable: boolean = false;

    constructor() {
        // Will auto-detect CLI on first use
    }

    /**
     * Check if pdftoppm CLI is available
     */
    async isAvailable(): Promise<boolean> {
        if (this.availabilityChecked) {
            return this.isCliAvailable;
        }

        // Try to find pdftoppm in common locations
        const candidates = [
            'pdftoppm',                           // In PATH
            '/usr/local/bin/pdftoppm',           // Homebrew (Intel Mac)
            '/opt/homebrew/bin/pdftoppm',        // Homebrew (Apple Silicon)
            '/usr/bin/pdftoppm',                 // Linux
        ];

        for (const cliName of candidates) {
            if (await this.testCliCommand(cliName)) {
                this.cliPath = cliName;
                this.isCliAvailable = true;
                console.log(`[PDFService] Found pdftoppm CLI: ${cliName}`);
                this.availabilityChecked = true;
                return true;
            }
        }

        this.availabilityChecked = true;
        this.isCliAvailable = false;
        console.warn('[PDFService] pdftoppm CLI not found');
        return false;
    }

    /**
     * Test if a CLI command is available by running version check
     */
    private async testCliCommand(command: string): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const process = spawn(command, ['-v']);

                process.on('error', () => {
                    resolve(false);
                });

                process.on('exit', (code) => {
                    // pdftoppm returns 0 for -v, or 99 for --version, or 1 for -v (depends on version)
                    // Any response means it exists
                    resolve(true);
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
     * Render a specific page from a PDF file to PNG
     * @param filePath Absolute path to .pdf file
     * @param pageNumber Page number to render (1-indexed)
     * @param dpi Resolution in DPI (default: 150)
     * @returns PNG data as Buffer
     */
    async renderPage(filePath: string, pageNumber: number = 1, dpi: number = 150): Promise<Buffer> {
        // Check CLI availability
        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error('pdftoppm CLI not available');
        }

        return new Promise((resolve, reject) => {
            const timeout = 30000; // 30 seconds

            // Create temp output file path
            const tempDir = path.join(__dirname, '../../../tmp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const tempPrefix = path.join(tempDir, `pdf-${Date.now()}`);

            // Build CLI arguments
            // pdftoppm -png -f PAGE -l PAGE -r DPI input.pdf output-prefix
            const args = [
                '-png',                    // Output as PNG
                '-f', pageNumber.toString(), // First page
                '-l', pageNumber.toString(), // Last page (same as first for single page)
                '-r', dpi.toString(),        // Resolution
                filePath,                   // Input PDF
                tempPrefix                  // Output prefix
            ];

            console.log(`[PDFService] Rendering page ${pageNumber} of: ${path.basename(filePath)}`);
            console.log(`[PDFService] Command: ${this.cliPath} ${args.join(' ')}`);

            const child = spawn(this.cliPath!, args);

            let stderr = '';

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            // Set timeout
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`PDF conversion timed out after ${timeout}ms`));
            }, timeout);

            child.on('error', (error) => {
                clearTimeout(timer);
                console.error('[PDFService] Process error:', error);
                reject(error);
            });

            child.on('exit', async (code) => {
                clearTimeout(timer);

                try {
                    if (stderr) {
                        console.log('[PDFService] stderr:', stderr);
                    }

                    if (code !== 0) {
                        console.error('[PDFService] Conversion failed:', stderr);
                        reject(new Error(`pdftoppm exited with code ${code}`));
                        return;
                    }

                    // pdftoppm creates files like: prefix-N.png where N is the page number
                    // The page number is zero-padded based on total pages, but for single page it's usually -1, -01, etc.
                    // We need to find the generated file
                    const possibleFiles = [
                        `${tempPrefix}-${pageNumber}.png`,
                        `${tempPrefix}-${pageNumber.toString().padStart(2, '0')}.png`,
                        `${tempPrefix}-${pageNumber.toString().padStart(3, '0')}.png`,
                        `${tempPrefix}-1.png`,  // Sometimes it just outputs -1.png for single page
                    ];

                    let outputPath: string | null = null;
                    for (const candidate of possibleFiles) {
                        if (fs.existsSync(candidate)) {
                            outputPath = candidate;
                            break;
                        }
                    }

                    if (!outputPath) {
                        // Try to find any file starting with tempPrefix
                        const files = fs.readdirSync(tempDir).filter(f => f.startsWith(path.basename(tempPrefix)));
                        if (files.length > 0) {
                            outputPath = path.join(tempDir, files[0]);
                        }
                    }

                    if (!outputPath || !fs.existsSync(outputPath)) {
                        const errorMsg = `pdftoppm exited successfully but did not create output file. Expected one of: ${possibleFiles.join(', ')}`;
                        console.error('[PDFService]', errorMsg);
                        if (stderr) {
                            console.error('[PDFService] stderr output:', stderr);
                        }
                        reject(new Error(errorMsg));
                        return;
                    }

                    // Read PNG output
                    const png = await fs.promises.readFile(outputPath);
                    console.log(`[PDFService] ✅ Converted page ${pageNumber} to PNG: ${path.basename(filePath)} (${png.length} bytes)`);

                    // Cleanup temp file
                    await fs.promises.unlink(outputPath);

                    resolve(png);
                } catch (error) {
                    console.error('[PDFService] Failed to read output:', error);
                    reject(error);
                }
            });
        });
    }

    /**
     * Get the total page count from a PDF file
     * Uses pdfinfo command from poppler-utils
     * @param filePath Absolute path to .pdf file
     * @returns Total number of pages
     */
    async getPageCount(filePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            // Try to use pdfinfo to get page count
            const pdfinfoPath = this.cliPath?.replace('pdftoppm', 'pdfinfo') || 'pdfinfo';

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

                // Parse output to find "Pages: N"
                const match = stdout.match(/Pages:\s+(\d+)/);
                if (match) {
                    const pageCount = parseInt(match[1], 10);
                    console.log(`[PDFService] PDF has ${pageCount} pages`);
                    resolve(pageCount);
                } else {
                    reject(new Error('Could not determine page count from pdfinfo output'));
                }
            });

            // Timeout after 5 seconds
            setTimeout(() => {
                child.kill();
                reject(new Error('pdfinfo timed out'));
            }, 5000);
        });
    }

    /**
     * Show warning notification when CLI is not available
     */
    private showCliWarning(): void {
        const message = 'pdftoppm CLI is not installed. PDF page rendering will not work.';
        const installAction = 'Installation Instructions';

        vscode.window.showWarningMessage(message, installAction).then(selection => {
            if (selection === installAction) {
                vscode.env.openExternal(vscode.Uri.parse('https://poppler.freedesktop.org/'));
            }
        });
    }

    /**
     * Get supported file extensions
     */
    getSupportedExtensions(): string[] {
        return ['.pdf'];
    }
}
