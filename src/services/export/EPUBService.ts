import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import AdmZip from 'adm-zip';
import { EXTERNAL_SERVICE_TIMEOUT_MS } from '../../constants/TimeoutConstants';

/**
 * Service for rendering individual EPUB pages to images
 * Uses mutool (MuPDF) CLI tool for conversion
 *
 * Supports:
 * - Rendering specific pages from EPUB files
 * - PNG output with configurable DPI
 */
export class EPUBService {
    private cliPath: string | null = null;
    private availabilityChecked: boolean = false;
    private isCliAvailable: boolean = false;

    constructor() {
        // Will auto-detect CLI on first use
    }

    /**
     * Check if mutool CLI is available
     */
    async isAvailable(): Promise<boolean> {
        if (this.availabilityChecked) {
            return this.isCliAvailable;
        }

        // Check user-configured mutool path first
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const mutoolPath = config.get<string>('mutoolPath', '');

        // Use configured path or fall back to PATH
        const cliName = mutoolPath ? path.join(mutoolPath, 'mutool') : 'mutool';

        if (await this.testCliCommand(cliName)) {
            this.cliPath = cliName;
            this.isCliAvailable = true;
            this.availabilityChecked = true;
            return true;
        }

        this.availabilityChecked = true;
        this.isCliAvailable = false;
        console.warn('[EPUBService] mutool CLI not found. Configure markdown-kanban.mutoolPath in settings.');
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

                process.on('exit', (_code) => {
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
     * Render a specific page from an EPUB file to PNG
     * @param filePath Absolute path to .epub file
     * @param pageNumber Page number to render (1-indexed)
     * @param dpi Resolution in DPI (default: 150)
     * @returns PNG data as Buffer
     */
    async renderPage(filePath: string, pageNumber: number = 1, dpi: number = 150): Promise<Buffer> {
        // Check CLI availability
        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error('mutool CLI not available');
        }

        return new Promise((resolve, reject) => {
            const timeout = EXTERNAL_SERVICE_TIMEOUT_MS;

            // Create temp output file path
            const tempDir = path.join(__dirname, '../../../tmp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const tempOutput = path.join(tempDir, `epub-${Date.now()}-${pageNumber}.png`);

            // Build CLI arguments
            // mutool draw -r DPI -o output.png input.epub PAGE
            const args = [
                'draw',
                '-r', dpi.toString(),           // Resolution
                '-o', tempOutput,               // Output file
                filePath,                       // Input EPUB
                pageNumber.toString()           // Page number
            ];

            const child = spawn(this.cliPath!, args);

            let stderr = '';

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            // Set timeout
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`EPUB conversion timed out after ${timeout}ms`));
            }, timeout);

            child.on('error', (error) => {
                clearTimeout(timer);
                console.error('[EPUBService] Process error:', error);
                reject(error);
            });

            child.on('exit', async (code) => {
                clearTimeout(timer);

                try {
                    if (code !== 0) {
                        console.error('[EPUBService] Conversion failed:', stderr);
                        reject(new Error(`mutool exited with code ${code}`));
                        return;
                    }

                    if (!fs.existsSync(tempOutput)) {
                        const errorMsg = `mutool exited successfully but did not create output file: ${tempOutput}`;
                        console.error('[EPUBService]', errorMsg);
                        if (stderr) {
                            console.error('[EPUBService] stderr output:', stderr);
                        }
                        reject(new Error(errorMsg));
                        return;
                    }

                    // Read PNG output
                    const png = await fs.promises.readFile(tempOutput);

                    // Cleanup temp file
                    await fs.promises.unlink(tempOutput);

                    resolve(png);
                } catch (error) {
                    console.error('[EPUBService] Failed to read output:', error);
                    reject(error);
                }
            });
        });
    }

    /**
     * Get the total page count from an EPUB file
     * Parses the EPUB structure directly (EPUB is a ZIP with XML metadata)
     * @param filePath Absolute path to .epub file
     * @returns Total number of pages (spine items)
     */
    async getPageCount(filePath: string): Promise<number> {
        try {
            // EPUB files are ZIP archives
            const zip = new AdmZip(filePath);

            // Step 1: Read META-INF/container.xml to find the OPF file
            const containerEntry = zip.getEntry('META-INF/container.xml');
            if (!containerEntry) {
                throw new Error('Invalid EPUB: Missing META-INF/container.xml');
            }

            const containerXml = containerEntry.getData().toString('utf8');

            // Parse container.xml to find OPF path
            // Looking for: <rootfile full-path="OEBPS/content.opf" .../>
            const rootfileMatch = containerXml.match(/rootfile[^>]+full-path=["']([^"']+)["']/i);
            if (!rootfileMatch) {
                throw new Error('Invalid EPUB: Cannot find rootfile in container.xml');
            }

            const opfPath = rootfileMatch[1];
            console.log('[EPUBService] Found OPF at:', opfPath);

            // Step 2: Read the OPF file
            const opfEntry = zip.getEntry(opfPath);
            if (!opfEntry) {
                throw new Error(`Invalid EPUB: Cannot find OPF file at ${opfPath}`);
            }

            const opfContent = opfEntry.getData().toString('utf8');

            // Step 3: Count spine items
            // The <spine> element contains <itemref> elements, one per "page" in reading order
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

            console.log('[EPUBService] EPUB page count:', pageCount);
            return pageCount;
        } catch (error) {
            console.error('[EPUBService] Failed to get page count:', error);
            throw error;
        }
    }

    /**
     * Show warning notification when CLI is not available
     */
    private showCliWarning(): void {
        const message = 'mutool CLI is not installed. EPUB page rendering will not work.';
        const installAction = 'Installation Instructions';

        vscode.window.showWarningMessage(message, installAction).then(selection => {
            if (selection === installAction) {
                vscode.env.openExternal(vscode.Uri.parse('https://mupdf.com/docs/manual-mutool-draw.html'));
            }
        });
    }

    /**
     * Get supported file extensions
     */
    getSupportedExtensions(): string[] {
        return ['.epub'];
    }
}
