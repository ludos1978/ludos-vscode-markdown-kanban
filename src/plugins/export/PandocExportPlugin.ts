/**
 * Pandoc Export Plugin
 *
 * Handles exporting kanban boards to document formats using Pandoc CLI.
 * Supports DOCX, ODT, and EPUB output formats.
 *
 * @module plugins/export/PandocExportPlugin
 */

import * as path from 'path';
import { spawn } from 'child_process';
import {
    ExportPlugin,
    ExportPluginMetadata,
    ExportFormat,
    ExportOptions,
    ExportResult,
    PandocOutputFormat
} from '../interfaces';
import { ConfigurationService } from '../../services/ConfigurationService';
import { getErrorMessage } from '../../utils/stringUtils';
import { logger } from '../../utils/logger';
import { KanbanBoard } from '../../board/KanbanTypes';

// Re-export so existing imports don't break
export type { PandocOutputFormat } from '../interfaces';

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
 * Pandoc Export Plugin
 *
 * Full implementation of Pandoc CLI export functionality.
 * Owns all Pandoc-specific logic: binary resolution, CLI spawning,
 * availability detection, and version caching.
 */
export class PandocExportPlugin implements ExportPlugin {
    private cachedVersion: string | null = null;
    private availabilityChecked = false;
    private _isAvailable = false;
    private resolvedPandocPath: string | null = null;

    readonly metadata: ExportPluginMetadata = {
        id: 'pandoc',
        name: 'Pandoc Document Export',
        version: '1.0.0',
        formats: [
            {
                id: 'pandoc-docx',
                name: 'Word Document (Pandoc)',
                extension: '.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                description: 'Export as Word document using Pandoc'
            },
            {
                id: 'pandoc-odt',
                name: 'OpenDocument (Pandoc)',
                extension: '.odt',
                mimeType: 'application/vnd.oasis.opendocument.text',
                description: 'Export as OpenDocument text using Pandoc'
            },
            {
                id: 'pandoc-epub',
                name: 'EPUB (Pandoc)',
                extension: '.epub',
                mimeType: 'application/epub+zip',
                description: 'Export as EPUB ebook using Pandoc'
            }
        ],
        requiresExternalTool: true,
        externalToolName: 'Pandoc (pandoc.org)'
    };

    // ============= PLUGIN INTERFACE =============

    /**
     * Get list of supported export formats
     */
    getSupportedFormats(): ExportFormat[] {
        return this.metadata.formats;
    }

    /**
     * Check if this plugin can export the board to the specified format
     */
    canExport(board: KanbanBoard, formatId: string): boolean {
        const formatSupported = this.metadata.formats.some(f => f.id === formatId);
        if (!formatSupported) {
            return false;
        }
        return board.columns && board.columns.length > 0;
    }

    /**
     * Check if Pandoc is available
     */
    async isAvailable(): Promise<boolean> {
        return this.isPandocAvailable();
    }

    /**
     * Get Pandoc version string
     */
    async getVersion(): Promise<string | null> {
        return this.getPandocVersion();
    }

    /**
     * Export board to specified format via plugin interface
     */
    async export(_board: KanbanBoard, options: ExportOptions): Promise<ExportResult> {
        const startTime = Date.now();

        try {
            const available = await this.isAvailable();
            if (!available) {
                return {
                    success: false,
                    error: `${this.metadata.externalToolName} is not available. Please ensure it is installed.`
                };
            }

            const pandocFormat = this._mapFormatId(options.formatId);
            if (!pandocFormat) {
                return {
                    success: false,
                    error: `Unsupported format: ${options.formatId}`
                };
            }

            const pandocOptions: PandocExportOptions = {
                inputFilePath: options.inputPath,
                format: pandocFormat,
                outputPath: options.outputPath,
                additionalArgs: options.additionalArgs
            };

            await this.pandocExport(pandocOptions);

            return {
                success: true,
                outputPath: options.outputPath,
                metadata: {
                    duration: Date.now() - startTime
                }
            };
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            return {
                success: false,
                error: `Export failed: ${errorMessage}`,
                metadata: {
                    duration: Date.now() - startTime
                }
            };
        }
    }

    // ============= PUBLIC METHODS (used by ExportService) =============

    /**
     * Check if Pandoc is installed and available
     * Tries common installation paths as fallbacks
     */
    async isPandocAvailable(): Promise<boolean> {
        if (this.availabilityChecked) {
            return this._isAvailable;
        }

        try {
            const pandocPath = await this.resolvePandocPath();
            const available = await this.testCommand(pandocPath);

            this.availabilityChecked = true;
            this._isAvailable = available;

            if (!available) {
                logger.warn('[PandocExportPlugin] Pandoc not found. Tried common installation paths.');
            }

            return available;
        } catch {
            this.availabilityChecked = true;
            this._isAvailable = false;
            return false;
        }
    }

    /**
     * Get Pandoc version string
     */
    async getPandocVersion(): Promise<string | null> {
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
     * Reset cached availability and version
     */
    resetCache(): void {
        this.availabilityChecked = false;
        this._isAvailable = false;
        this.cachedVersion = null;
    }

    /**
     * Get file extension for a format
     */
    getExtensionForFormat(format: PandocOutputFormat): string {
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
     */
    getFormatDisplayName(format: PandocOutputFormat): string {
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

    /**
     * Export markdown file to document format using Pandoc
     */
    async pandocExport(options: PandocExportOptions): Promise<void> {
        const isAvailable = await this.isPandocAvailable();
        if (!isAvailable) {
            throw new Error(
                'Pandoc is not installed. Please install from https://pandoc.org/installing.html'
            );
        }

        try {
            const pandocPath = options.customPath || this.getPandocPath();
            const args = this.buildCliArgs(options);

            logger.debug(`[PandocExportPlugin] Exporting to ${options.format}: pandoc ${args.join(' ')}`);

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
                    console.error(`[PandocExportPlugin] Process error:`, error);
                    reject(new Error(`Failed to start Pandoc: ${error.message}`));
                });

                pandocProcess.on('exit', (code) => {
                    if (code === 0) {
                        logger.debug(`[PandocExportPlugin] Export successful: ${options.outputPath}`);
                        resolve();
                    } else {
                        const errorMessage = stderrOutput.trim() || `Exit code ${code}`;
                        console.error(`[PandocExportPlugin] Export failed:`, errorMessage);
                        reject(new Error(`Pandoc export failed: ${errorMessage}`));
                    }
                });
            });
        } catch (error) {
            console.error('[PandocExportPlugin] Export failed:', error);
            throw error;
        }
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Build Pandoc CLI arguments from options
     */
    private buildCliArgs(options: PandocExportOptions): string[] {
        const args: string[] = [];

        // Input file
        args.push(options.inputFilePath);

        // Output file
        args.push('-o', options.outputPath);

        // Output format
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

        // Input format with smart typography
        args.push('-f', 'markdown+smart');

        // Standalone document
        args.push('--standalone');

        // Additional user-provided arguments
        if (options.additionalArgs && options.additionalArgs.length > 0) {
            args.push(...options.additionalArgs);
        }

        return args;
    }

    /**
     * Get common installation paths for Pandoc
     */
    private getCommonPandocPaths(): string[] {
        const platform = process.platform;

        if (platform === 'darwin') {
            return [
                '/opt/homebrew/bin/pandoc',
                '/usr/local/bin/pandoc',
                '/opt/local/bin/pandoc',
            ];
        } else if (platform === 'win32') {
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            const localAppData = process.env.LOCALAPPDATA || '';
            return [
                `${programFiles}\\Pandoc\\pandoc.exe`,
                `${localAppData}\\Pandoc\\pandoc.exe`,
            ];
        } else {
            return [
                '/usr/bin/pandoc',
                '/usr/local/bin/pandoc',
            ];
        }
    }

    /**
     * Test if a command is available
     */
    private async testCommand(command: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const proc = spawn(command, ['--version'], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            proc.on('error', () => resolve(false));
            proc.on('exit', (code) => resolve(code === 0));

            setTimeout(() => {
                proc.kill();
                resolve(false);
            }, 2000);
        });
    }

    /**
     * Resolve Pandoc binary path, trying common installation paths
     */
    private async resolvePandocPath(): Promise<string> {
        if (this.resolvedPandocPath) {
            return this.resolvedPandocPath;
        }

        const pathsToTry: string[] = [];

        // First, try configured path
        try {
            const configService = ConfigurationService.getInstance();
            const configuredPath = configService.getNestedConfig('pandoc.path', '') as string;
            if (configuredPath && configuredPath.trim()) {
                pathsToTry.push(configuredPath.trim());
            }
        } catch {
            // ConfigurationService may not be available in all contexts
        }

        // Then try default command (relies on PATH)
        pathsToTry.push('pandoc');

        // Finally, try common installation paths
        pathsToTry.push(...this.getCommonPandocPaths());

        // Test each path
        for (const pandocPath of pathsToTry) {
            if (await this.testCommand(pandocPath)) {
                this.resolvedPandocPath = pandocPath;
                logger.debug(`[PandocExportPlugin] Found Pandoc at: ${pandocPath}`);
                return pandocPath;
            }
        }

        // Fall back to 'pandoc' even if not found
        return 'pandoc';
    }

    /**
     * Get the configured or default Pandoc binary path (sync)
     */
    private getPandocPath(): string {
        if (this.resolvedPandocPath) {
            return this.resolvedPandocPath;
        }

        try {
            const configService = ConfigurationService.getInstance();
            const configuredPath = configService.getNestedConfig('pandoc.path', '') as string;
            if (configuredPath && configuredPath.trim()) {
                return configuredPath.trim();
            }
        } catch {
            // ConfigurationService may not be available in all contexts
        }

        return 'pandoc';
    }

    /**
     * Map plugin format ID to Pandoc format
     */
    private _mapFormatId(formatId: string): PandocOutputFormat | null {
        switch (formatId) {
            case 'pandoc-docx':
                return 'docx';
            case 'pandoc-odt':
                return 'odt';
            case 'pandoc-epub':
                return 'epub';
            default:
                return null;
        }
    }
}
