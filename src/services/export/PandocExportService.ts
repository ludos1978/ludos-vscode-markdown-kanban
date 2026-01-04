import * as path from 'path';
import { spawn } from 'child_process';
import { ConfigurationService } from '../ConfigurationService';

export type PandocOutputFormat = 'docx' | 'odt' | 'epub';

export interface PandocExportOptions {
    /** Input markdown file path */
    inputFilePath: string;
    /** Output format */
    format: PandocOutputFormat;
    /** Output file path */
    outputPath: string;
    /** Custom path to pandoc binary */
    customPath?: string;
    /** Additional Pandoc CLI arguments */
    additionalArgs?: string[];
}

/**
 * Service to export markdown content using Pandoc CLI
 * Supports document formats: DOCX, ODT, EPUB
 */
export class PandocExportService {
    private static cachedVersion: string | null = null;
    private static availabilityChecked = false;
    private static isAvailable = false;

    /**
     * Check if Pandoc is installed and available
     * @returns Promise that resolves to true if Pandoc is available
     */
    static async isPandocAvailable(): Promise<boolean> {
        // Use cached result if available
        if (this.availabilityChecked) {
            return this.isAvailable;
        }

        try {
            const pandocPath = this.getPandocPath();

            return new Promise<boolean>((resolve) => {
                const checkProcess = spawn(pandocPath, ['--version'], {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let resolved = false;

                checkProcess.on('error', () => {
                    if (!resolved) {
                        resolved = true;
                        this.availabilityChecked = true;
                        this.isAvailable = false;
                        resolve(false);
                    }
                });

                checkProcess.on('exit', (code) => {
                    if (!resolved) {
                        resolved = true;
                        this.availabilityChecked = true;
                        this.isAvailable = code === 0;
                        resolve(code === 0);
                    }
                });

                // Timeout after 5 seconds
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        checkProcess.kill();
                        this.availabilityChecked = true;
                        this.isAvailable = false;
                        resolve(false);
                    }
                }, 5000);
            });
        } catch {
            this.availabilityChecked = true;
            this.isAvailable = false;
            return false;
        }
    }

    /**
     * Get Pandoc version string
     * @returns Promise that resolves to version string or null if not available
     */
    static async getPandocVersion(): Promise<string | null> {
        // Return cached version if available
        if (this.cachedVersion) {
            return this.cachedVersion;
        }

        const isAvailable = await this.isPandocAvailable();
        if (!isAvailable) {
            return null;
        }

        try {
            const pandocPath = this.getPandocPath();

            return new Promise<string | null>((resolve) => {
                const versionProcess = spawn(pandocPath, ['--version'], {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let stdout = '';

                if (versionProcess.stdout) {
                    versionProcess.stdout.on('data', (data) => {
                        stdout += data.toString();
                    });
                }

                versionProcess.on('exit', (code) => {
                    if (code === 0 && stdout) {
                        // Parse version from "pandoc 3.1.2" or similar
                        const match = stdout.match(/pandoc\s+([\d.]+)/i);
                        if (match) {
                            this.cachedVersion = match[1];
                            resolve(match[1]);
                        } else {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                });

                versionProcess.on('error', () => {
                    resolve(null);
                });
            });
        } catch {
            return null;
        }
    }

    /**
     * Reset cached availability and version (useful for testing or after config changes)
     */
    static resetCache(): void {
        this.availabilityChecked = false;
        this.isAvailable = false;
        this.cachedVersion = null;
    }

    /**
     * Export markdown file to document format using Pandoc
     * @param options - Export options
     * @returns Promise that resolves when export is complete
     */
    static async export(options: PandocExportOptions): Promise<void> {
        // Validate Pandoc availability
        const isAvailable = await this.isPandocAvailable();
        if (!isAvailable) {
            throw new Error(
                'Pandoc is not installed. Please install from https://pandoc.org/installing.html'
            );
        }

        try {
            const pandocPath = options.customPath || this.getPandocPath();
            const args = this.buildCliArgs(options);

            console.log(`[PandocExportService] Exporting to ${options.format}: pandoc ${args.join(' ')}`);

            // Use the directory of the input file as CWD for relative path resolution
            const inputFileDir = path.dirname(options.inputFilePath);

            await new Promise<void>((resolve, reject) => {
                const pandocProcess = spawn(pandocPath, args, {
                    cwd: inputFileDir,
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let stderrOutput = '';

                if (pandocProcess.stderr) {
                    pandocProcess.stderr.on('data', (data) => {
                        stderrOutput += data.toString();
                    });
                }

                pandocProcess.on('error', (error) => {
                    console.error(`[PandocExportService] Process error:`, error);
                    reject(new Error(`Failed to start Pandoc: ${error.message}`));
                });

                pandocProcess.on('exit', (code) => {
                    if (code === 0) {
                        console.log(`[PandocExportService] Export successful: ${options.outputPath}`);
                        resolve();
                    } else {
                        const errorMessage = stderrOutput.trim() || `Exit code ${code}`;
                        console.error(`[PandocExportService] Export failed:`, errorMessage);
                        reject(new Error(`Pandoc export failed: ${errorMessage}`));
                    }
                });
            });
        } catch (error) {
            console.error('[PandocExportService] Export failed:', error);
            throw error;
        }
    }

    /**
     * Build Pandoc CLI arguments from options
     * @param options - Export options
     * @returns Array of CLI arguments
     */
    private static buildCliArgs(options: PandocExportOptions): string[] {
        const args: string[] = [];

        // Input file
        args.push(options.inputFilePath);

        // Output file
        args.push('-o', options.outputPath);

        // Output format (explicit, though Pandoc infers from extension)
        switch (options.format) {
            case 'docx':
                args.push('-t', 'docx');
                break;
            case 'odt':
                args.push('-t', 'odt');
                break;
            case 'epub':
                args.push('-t', 'epub');
                break;
        }

        // Input format with smart typography (quotes, dashes, ellipses)
        // Note: --smart was removed in Pandoc 2.0, use +smart extension instead
        args.push('-f', 'markdown+smart');

        // Standalone document (includes proper headers/metadata)
        args.push('--standalone');

        // Additional user-provided arguments
        if (options.additionalArgs && options.additionalArgs.length > 0) {
            args.push(...options.additionalArgs);
        }

        return args;
    }

    /**
     * Get the configured or default Pandoc binary path
     * @returns Path to Pandoc binary
     */
    private static getPandocPath(): string {
        try {
            const configService = ConfigurationService.getInstance();
            const configuredPath = configService.getNestedConfig('pandoc.path', '') as string;

            if (configuredPath && configuredPath.trim()) {
                return configuredPath.trim();
            }
        } catch {
            // ConfigurationService may not be available in all contexts
        }

        // Default to 'pandoc' which relies on system PATH
        return 'pandoc';
    }

    /**
     * Get file extension for a format
     * @param format - Pandoc output format
     * @returns File extension including dot
     */
    static getExtensionForFormat(format: PandocOutputFormat): string {
        switch (format) {
            case 'docx':
                return '.docx';
            case 'odt':
                return '.odt';
            case 'epub':
                return '.epub';
            default:
                return '.docx';
        }
    }

    /**
     * Get human-readable format name
     * @param format - Pandoc output format
     * @returns Human-readable format name
     */
    static getFormatDisplayName(format: PandocOutputFormat): string {
        switch (format) {
            case 'docx':
                return 'Word Document (.docx)';
            case 'odt':
                return 'OpenDocument (.odt)';
            case 'epub':
                return 'EPUB (.epub)';
            default:
                return format;
        }
    }
}
