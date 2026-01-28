import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AbstractCLIService } from './AbstractCLIService';

/**
 * Service for converting Excel spreadsheets (.xlsx, .xls) to PNG images using LibreOffice CLI
 *
 * Each sheet in the spreadsheet becomes a separate PNG file.
 * Use the page parameter to select which sheet to render (1-indexed).
 */
export class XlsxService extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'libreOfficePath';
    }

    protected getDefaultCliName(): string {
        return 'soffice';
    }

    protected getServiceName(): string {
        return 'XlsxService';
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

    /**
     * Override to add LibreOffice-specific paths
     */
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
     * Render Excel spreadsheet to PNG
     * @param filePath Absolute path to .xlsx or .xls file
     * @param sheetNumber Sheet number to render (1-indexed, default: 1)
     * @returns PNG data as Buffer
     */
    async renderPNG(filePath: string, sheetNumber: number = 1): Promise<Buffer> {
        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error('LibreOffice CLI not available');
        }

        const tempDir = this.ensureTempDir();
        const inputFileName = path.basename(filePath, path.extname(filePath));

        // LibreOffice converts each sheet to a separate PNG
        // soffice --headless --convert-to png --outdir [dir] [file]
        const args = [
            '--headless',
            '--convert-to', 'png',
            '--outdir', tempDir,
            filePath
        ];

        const { code, stderr } = await this.executeCliCommand(args);

        if (code !== 0) {
            console.error('[XlsxService] Conversion failed:', stderr);
            throw new Error(`LibreOffice exited with code ${code}`);
        }

        // Find the output file(s) - LibreOffice creates files with various naming patterns
        const outputPath = await this.findSheetOutputFile(tempDir, inputFileName, sheetNumber);

        if (!outputPath) {
            const errorMsg = `LibreOffice conversion completed but could not find output for sheet ${sheetNumber}`;
            console.error('[XlsxService]', errorMsg);
            if (stderr) {
                console.error('[XlsxService] stderr output:', stderr);
            }
            throw new Error(errorMsg);
        }

        const png = await fs.promises.readFile(outputPath);

        // Cleanup all generated PNG files
        await this.cleanupGeneratedFiles(tempDir, inputFileName);

        return png;
    }

    /**
     * Find the output file for a specific sheet
     * LibreOffice may create files with different naming patterns:
     * - filename.png (single sheet)
     * - filename-Sheet1.png, filename-Sheet2.png (multiple sheets)
     * - filename-1.png, filename-2.png (numbered)
     */
    private async findSheetOutputFile(tempDir: string, baseName: string, sheetNumber: number): Promise<string | null> {
        const files = await fs.promises.readdir(tempDir);
        const pngFiles = files.filter(f =>
            f.toLowerCase().startsWith(baseName.toLowerCase()) &&
            f.toLowerCase().endsWith('.png')
        ).sort();

        if (pngFiles.length === 0) {
            return null;
        }

        // Single file case - return it regardless of sheet number requested
        if (pngFiles.length === 1) {
            if (sheetNumber > 1) {
                console.warn(`[XlsxService] Requested sheet ${sheetNumber} but only 1 sheet exists`);
            }
            return path.join(tempDir, pngFiles[0]);
        }

        // Multiple files - try to find the right one
        const sheetIndex = sheetNumber - 1; // Convert to 0-indexed

        // Try exact match patterns
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

        // Fall back to index-based selection
        if (sheetIndex < pngFiles.length) {
            return path.join(tempDir, pngFiles[sheetIndex]);
        }

        // Return first file if requested sheet doesn't exist
        console.warn(`[XlsxService] Requested sheet ${sheetNumber} not found, returning first sheet`);
        return path.join(tempDir, pngFiles[0]);
    }

    /**
     * Cleanup generated PNG files
     */
    private async cleanupGeneratedFiles(tempDir: string, baseName: string): Promise<void> {
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
            console.warn('[XlsxService] Failed to cleanup temp files:', error);
        }
    }

    /**
     * Get supported file extensions
     */
    getSupportedExtensions(): string[] {
        return ['.xlsx', '.xls', '.ods'];
    }
}
