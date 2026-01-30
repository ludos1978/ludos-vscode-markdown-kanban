/**
 * Marp Export Plugin
 *
 * Handles exporting kanban boards to presentation formats using Marp CLI.
 * Supports PDF, PPTX, and HTML output formats.
 *
 * Features:
 * - Export to PDF, PPTX, HTML formats
 * - Watch mode with auto-rebuild
 * - Custom theme support
 * - Custom engine support
 * - PID management for watch processes
 * - Theme discovery from configured and common directories
 *
 * @module plugins/export/MarpExportPlugin
 */

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import {
    ExportPlugin,
    ExportPluginMetadata,
    ExportFormat,
    ExportOptions,
    ExportResult,
    MarpOutputFormat
} from '../interfaces';
import { pluginConfigService } from '../../services/PluginConfigService';
import { getErrorMessage } from '../../utils/stringUtils';
import { logger } from '../../utils/logger';
import { KanbanBoard } from '../../board/KanbanTypes';

// Re-export so existing imports don't break
export type { MarpOutputFormat } from '../interfaces';

export interface MarpExportOptions {
    /** Input markdown file path */
    inputFilePath: string;
    /** Output format */
    format: MarpOutputFormat;
    /** Output file path */
    outputPath: string;
    /** Path to custom engine.js */
    enginePath?: string;
    /** Marp theme */
    theme?: string;
    /** Watch mode: runs Marp with --watch and --preview, stores PID */
    watchMode?: boolean;
    /** Editable mode: adds --pptx-editable flag for PowerPoint exports */
    pptxEditable?: boolean;
    /** Additional Marp CLI arguments */
    additionalArgs?: string[];
    /** Handout mode: generates slides + notes layout as PDF */
    handout?: boolean;
    /** Handout layout: portrait or landscape */
    handoutLayout?: 'portrait' | 'landscape';
    /** Handout slides per page: 1 (portrait), 2 (landscape), or 4 (portrait) */
    handoutSlidesPerPage?: 1 | 2 | 4;
    /** Handout direction for 2-slide layout: horizontal (left-right) or vertical (top-bottom) */
    handoutDirection?: 'horizontal' | 'vertical';
    /** Handout PDF: always true when handout is enabled */
    handoutPdf?: boolean;
}

/**
 * Marp Export Plugin
 *
 * Full implementation of Marp CLI export functionality.
 * Owns all Marp-specific logic: CLI spawning, theme discovery,
 * watch mode process management, and handout generation.
 */
export class MarpExportPlugin implements ExportPlugin {
    private static readonly DEFAULT_ENGINE_PATH = './marp-engine/engine.js';

    // PID storage for Marp watch processes
    private marpProcessPids = new Map<string, number>();

    readonly metadata: ExportPluginMetadata = {
        id: 'marp',
        name: 'Marp Presentation Export',
        version: '1.0.0',
        formats: [
            {
                id: 'marp-pdf',
                name: 'PDF (Marp)',
                extension: '.pdf',
                mimeType: 'application/pdf',
                description: 'Export as PDF using Marp CLI'
            },
            {
                id: 'marp-pptx',
                name: 'PowerPoint (Marp)',
                extension: '.pptx',
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                description: 'Export as PowerPoint presentation'
            },
            {
                id: 'marp-html',
                name: 'HTML (Marp)',
                extension: '.html',
                mimeType: 'text/html',
                description: 'Export as HTML presentation'
            }
        ],
        requiresExternalTool: true,
        externalToolName: 'Marp CLI (@marp-team/marp-cli)'
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
     * Check if Marp CLI is available
     */
    async isAvailable(): Promise<boolean> {
        return this.isMarpCliAvailable();
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

            const marpFormat = this._mapFormatId(options.formatId);
            if (!marpFormat) {
                return {
                    success: false,
                    error: `Unsupported format: ${options.formatId}`
                };
            }

            const marpOptions: MarpExportOptions = {
                inputFilePath: options.inputPath,
                format: marpFormat,
                outputPath: options.outputPath,
                enginePath: options.enginePath,
                theme: options.theme,
                watchMode: options.watchMode,
                pptxEditable: options.pptxEditable,
                additionalArgs: options.additionalArgs
            };

            await this.marpExport(marpOptions);

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
     * Check if a file is being watched by Marp
     */
    isWatching(filePath: string): boolean {
        return this.marpProcessPids.has(filePath);
    }

    /**
     * Get available Marp themes
     */
    async getAvailableThemes(): Promise<string[]> {
        try {
            const isAvailable = await this.isMarpCliAvailable();
            if (!isAvailable) {
                return ['default'];
            }

            const themes = ['default', 'gaia', 'uncover'];

            // Check configured theme folders first
            const resolvedFolders = this.getResolvedConfiguredThemeFolders();
            for (const resolvedPath of resolvedFolders) {
                this.collectThemesFromDirectory(resolvedPath, themes);
            }

            // Fallback to common theme directories
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                const themePaths = this.getCommonThemePaths(workspaceRoot);

                for (const themePath of themePaths) {
                    if (fs.existsSync(themePath)) {
                        this.collectThemesFromDirectory(themePath, themes);
                    }
                }
            }

            return themes.sort();
        } catch (err) {
            console.error('[kanban.MarpExportPlugin.getAvailableThemes] Failed to get available themes:', err);
            return ['default'];
        }
    }

    /**
     * Stop all Marp watch processes
     */
    stopAllWatches(): void {
        for (const [filePath, pid] of this.marpProcessPids.entries()) {
            this.killProcess(pid);
            this.cleanupPreprocessedFile(filePath);
        }
        this.marpProcessPids.clear();
    }

    /**
     * Stop all Marp watch processes except for a specific file
     */
    stopAllWatchesExcept(excludeFilePath?: string): void {
        for (const [filePath, pid] of this.marpProcessPids.entries()) {
            if (filePath !== excludeFilePath) {
                this.killProcess(pid);
                this.cleanupPreprocessedFile(filePath);
                this.marpProcessPids.delete(filePath);
            }
        }
    }

    /**
     * Stop Marp watch process for a file
     */
    stopMarpWatch(filePath: string): void {
        const pid = this.marpProcessPids.get(filePath);
        if (pid) {
            this.killProcess(pid);
            this.marpProcessPids.delete(filePath);
            this.cleanupPreprocessedFile(filePath);
        }
    }

    /**
     * Check if the Marp engine file exists
     */
    engineFileExists(enginePath?: string): boolean {
        const resolvedPath = enginePath || this.getDefaultEnginePath();
        return fs.existsSync(resolvedPath);
    }

    /**
     * Get the Marp engine path
     */
    getEnginePath(): string {
        return this.getDefaultEnginePath();
    }

    /**
     * Check if Marp CLI is available
     */
    async isMarpCliAvailable(): Promise<boolean> {
        try {
            const cli = await import('@marp-team/marp-cli');
            return !!cli.marpCli;
        } catch (err) {
            console.error('[kanban.MarpExportPlugin] Marp CLI not available:', err);
            return false;
        }
    }

    /**
     * Export markdown file using Marp CLI
     */
    async marpExport(options: MarpExportOptions): Promise<void> {
        // Check if a Marp process is already running for this file (watch mode only)
        if (options.watchMode) {
            const existingPid = this.marpProcessPids.get(options.inputFilePath);
            if (existingPid) {
                return;
            }
        }

        // Validate Marp CLI availability
        const isAvailable = await this.isMarpCliAvailable();
        if (!isAvailable) {
            throw new Error('Marp CLI is not available. Please ensure @marp-team/marp-cli is installed.');
        }

        // Ensure required build files exist in dist directory
        await this.ensureMarpBuildFiles();

        try {
            // Build Marp CLI arguments using input file path
            const args = this.buildMarpCliArgs(options.inputFilePath, options);
            logger.debug(`[MarpExportPlugin] format: ${options.format}, args:`, args.join(' '));

            // IMPORTANT: Use the directory of the input file as CWD
            // This ensures markdown-it-include resolves paths relative to the markdown file location
            const inputFileDir = path.dirname(options.inputFilePath);

            const command = 'npx';
            const commandArgs = ['@marp-team/marp-cli', ...args];

            // Build environment with handout settings if enabled
            // Handout mode only applies to PDF output - for HTML, generate normal presentation
            const env: NodeJS.ProcessEnv = { ...process.env };
            if (options.handout && options.format === 'pdf') {
                env.MARP_HANDOUT = 'true';
                env.MARP_HANDOUT_LAYOUT = options.handoutLayout || 'portrait';
                env.MARP_HANDOUT_SLIDES_PER_PAGE = String(options.handoutSlidesPerPage || 1);
                env.MARP_HANDOUT_DIRECTION = options.handoutDirection || 'horizontal';
            }

            // WATCH MODE: Spawn detached background process and return immediately
            // NON-WATCH MODE: Wait for process to complete before returning
            if (options.watchMode) {
                const marpProcess = spawn(command, commandArgs, {
                    cwd: inputFileDir,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: env
                });

                let stderrOutput = '';

                if (marpProcess.stderr) {
                    marpProcess.stderr.on('data', (data) => {
                        const output = data.toString();
                        stderrOutput += output;
                        if (output.includes('[ERROR]') || output.includes('Error:')) {
                            console.error(`[kanban.MarpExportPlugin] ${output}`);
                        }
                    });
                }

                marpProcess.on('error', (error) => {
                    console.error(`[kanban.MarpExportPlugin] Process error:`, error);
                    vscode.window.showErrorMessage(`Marp export failed: ${error.message}`);
                });

                marpProcess.on('exit', (code) => {
                    if (options.inputFilePath) {
                        this.marpProcessPids.delete(options.inputFilePath);
                    }
                    if (code !== 0 && code !== null) {
                        const errorMatch = stderrOutput.match(/\[ ERROR \](.+?)(?=\[|$)/s);
                        const errorMessage = errorMatch
                            ? errorMatch[1].trim().replace(/\s+/g, ' ')
                            : `Marp exited with code ${code}`;
                        vscode.window.showErrorMessage(`Marp export failed: ${errorMessage}`);
                    }
                });

                marpProcess.unref();

                if (options.inputFilePath && marpProcess.pid) {
                    this.marpProcessPids.set(options.inputFilePath, marpProcess.pid);
                }
            } else {
                // NON-WATCH MODE: Wait for Marp to complete (PDF, PPTX, HTML save)
                await new Promise<void>((resolve, reject) => {
                    const marpProcess = spawn(command, commandArgs, {
                        cwd: inputFileDir,
                        stdio: ['ignore', 'pipe', 'pipe'],
                        env: env
                    });

                    let stderrOutput = '';

                    if (marpProcess.stderr) {
                        marpProcess.stderr.on('data', (data) => {
                            const output = data.toString();
                            stderrOutput += output;
                            if (output.includes('[ERROR]') || output.includes('Error:')) {
                                console.error(`[kanban.MarpExportPlugin] ${output}`);
                            }
                        });
                    }

                    marpProcess.on('error', (error) => {
                        console.error(`[kanban.MarpExportPlugin] Process error:`, error);
                        reject(error);
                    });

                    marpProcess.on('exit', async (code) => {
                        if (code === 0) {
                            if (options.handout) {
                                await this.runHandoutPostProcess(options);
                            }
                            resolve();
                        } else {
                            if (stderrOutput.includes('Not found processable Markdown')) {
                                reject(new Error('Marp could not find processable Markdown file'));
                            } else {
                                const errorDetails = stderrOutput.trim() ? `: ${stderrOutput.trim()}` : '';
                                reject(new Error(`Marp export failed with exit code ${code}${errorDetails}`));
                            }
                        }
                    });
                });
            }

        } catch (error) {
            console.error('[kanban.MarpExportPlugin] Export failed:', error);
            throw error;
        }
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Kill a process and its children by PID.
     * Since watch-mode processes are spawned with detached: true,
     * the PID is a process group leader. Using -pid kills the entire group
     * (Marp CLI + browser/preview server children).
     */
    private killProcess(pid: number): void {
        try {
            // Kill the entire process group (negative PID) on Unix/macOS.
            // This ensures child processes (browser, preview server) are also terminated.
            process.kill(-pid, 'SIGTERM');
        } catch {
            // Fallback: kill just the parent process (required on Windows where
            // negative PID is not supported, or if the group kill fails)
            try {
                process.kill(pid, 'SIGTERM');
            } catch (error) {
                console.error(`[kanban.MarpExportPlugin] Failed to kill process ${pid}:`, error);
            }
        }
    }

    /**
     * Cleanup preprocessed markdown file if it exists
     */
    private cleanupPreprocessedFile(filePath: string): void {
        if (filePath.endsWith('.preprocessed.md')) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                console.warn(`[kanban.MarpExportPlugin] Failed to cleanup preprocessed file:`, error);
            }
        }
    }

    /**
     * Build Marp CLI arguments from options
     */
    private buildMarpCliArgs(inputPath: string, options: MarpExportOptions): string[] {
        const args: string[] = [];

        // Output format
        if (options.format === 'pdf') {
            args.push('--pdf');
        } else if (options.format === 'pptx') {
            args.push('--pptx');
            if (options.pptxEditable) {
                args.push('--pptx-editable');
            }
        } else {
            args.push('--html');
        }

        if (options.watchMode) {
            args.push('--preview');
            args.push('--watch');
        }

        // Output path (only for non-markdown formats, but not for HTML with preview)
        if (options.format !== 'markdown' && !(options.format === 'html' && options.watchMode)) {
            args.push('--output', options.outputPath);
        }

        // Engine path
        const enginePath = options.enginePath || this.getDefaultEnginePath();
        if (enginePath && fs.existsSync(enginePath)) {
            args.push('--engine', enginePath);
        } else {
            console.warn(`[kanban.MarpExportPlugin] Engine file not found: ${enginePath}`);
        }

        // Theme
        if (options.theme) {
            args.push('--theme', options.theme);
        }

        // Theme set - add configured theme directories
        const resolvedFolders = this.getResolvedConfiguredThemeFolders();
        for (const resolvedPath of resolvedFolders) {
            args.push('--theme-set', resolvedPath);
        }

        // Fallback to common theme directories
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const themePaths = this.getCommonThemePaths(workspaceRoot);

            for (const themePath of themePaths) {
                if (fs.existsSync(themePath)) {
                    args.push('--theme-set', themePath);
                    break;
                }
            }
        }

        // Always allow local files (required for images)
        args.push('--allow-local-files');

        // Browser setting - prioritize options.additionalArgs, then config
        let browser: string | undefined;

        if (options.additionalArgs) {
            const browserIndex = options.additionalArgs.findIndex(arg => arg === '--browser');
            if (browserIndex !== -1 && browserIndex + 1 < options.additionalArgs.length) {
                browser = options.additionalArgs[browserIndex + 1];
                options.additionalArgs.splice(browserIndex, 2);
            }
        }

        if (!browser) {
            browser = pluginConfigService.getPluginConfig('marp', 'browser', 'chrome');
        }

        if (browser && browser !== 'auto') {
            args.push('--browser', browser);
        }

        // Additional args
        if (options.additionalArgs) {
            args.push(...options.additionalArgs);
        }

        // Input file MUST come at the end
        args.push(inputPath);

        return args;
    }

    /**
     * Get the default engine path from workspace configuration
     */
    private getDefaultEnginePath(): string {
        const config = vscode.workspace.getConfiguration('markdown-kanban.marp');
        const configuredPath = config.get<string>('enginePath');

        if (configuredPath) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                return path.resolve(workspaceFolders[0].uri.fsPath, configuredPath);
            }
            return path.resolve(configuredPath);
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return path.join(workspaceFolders[0].uri.fsPath, MarpExportPlugin.DEFAULT_ENGINE_PATH);
        }

        return MarpExportPlugin.DEFAULT_ENGINE_PATH;
    }

    /**
     * Ensure required build files exist in dist directory for Marp CLI
     */
    private async ensureMarpBuildFiles(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const distDir = path.join(workspaceRoot, 'dist');

        const requiredFiles = ['esbuild.js', 'watch.js'];

        for (const file of requiredFiles) {
            const distFilePath = path.join(distDir, file);
            const srcFilePath = path.join(workspaceRoot, file);

            if (!fs.existsSync(distFilePath) && fs.existsSync(srcFilePath)) {
                try {
                    fs.copyFileSync(srcFilePath, distFilePath);
                } catch (err) {
                    console.warn(`[kanban.MarpExportPlugin] Failed to copy ${file} to dist:`, err);
                }
            }
        }
    }

    /**
     * Run handout post-processor on the generated HTML
     */
    private async runHandoutPostProcess(options: MarpExportOptions): Promise<void> {
        if (options.format !== 'html') {
            return;
        }

        const enginePath = options.enginePath || this.getDefaultEnginePath();
        const engineDir = path.dirname(enginePath);
        const postProcessorPath = path.join(engineDir, 'handout-postprocess.js');

        if (!fs.existsSync(postProcessorPath)) {
            console.warn(`[kanban.MarpExportPlugin] Handout post-processor not found: ${postProcessorPath}`);
            return;
        }

        const env: NodeJS.ProcessEnv = { ...process.env };
        env.MARP_HANDOUT_LAYOUT = options.handoutLayout || 'portrait';
        env.MARP_HANDOUT_SLIDES_PER_PAGE = String(options.handoutSlidesPerPage || 1);
        env.MARP_HANDOUT_DIRECTION = options.handoutDirection || 'horizontal';
        env.MARP_HANDOUT_OUTPUT_PDF = 'true';

        const pdfOutputPath = options.outputPath.replace(/\.html?$/i, '-handout.pdf');
        const args = [postProcessorPath, options.outputPath, pdfOutputPath, '--pdf'];

        return new Promise((resolve, _reject) => {
            const postProcess = spawn('node', args, {
                env: env,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stderr = '';

            if (postProcess.stderr) {
                postProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
            }

            postProcess.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    console.error(`[MarpExportPlugin] Handout post-processing failed: ${stderr}`);
                    resolve();
                }
            });

            postProcess.on('error', (error) => {
                console.error('[kanban.MarpExportPlugin] Handout post-processing error:', error);
                resolve();
            });
        });
    }

    /**
     * Resolve a theme folder path against workspace root
     */
    private resolveThemeFolderPath(themeFolder: string, workspaceRoot: string): string {
        if (path.isAbsolute(themeFolder)) {
            return themeFolder;
        }
        return path.resolve(workspaceRoot, themeFolder);
    }

    /**
     * Get resolved, existing configured theme folder paths
     */
    private getResolvedConfiguredThemeFolders(): string[] {
        const configuredThemeFolders = pluginConfigService.getPluginConfig<string[]>('marp', 'themeFolders', []);
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (configuredThemeFolders.length === 0 || !workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const resolvedPaths: string[] = [];

        for (const themeFolder of configuredThemeFolders) {
            const resolvedPath = this.resolveThemeFolderPath(themeFolder, workspaceRoot);
            if (fs.existsSync(resolvedPath)) {
                resolvedPaths.push(resolvedPath);
            } else {
                console.warn(`[kanban.MarpExportPlugin] Configured theme directory not found: ${resolvedPath}`);
            }
        }

        return resolvedPaths;
    }

    /**
     * Get common theme directory paths for a workspace
     */
    private getCommonThemePaths(workspaceRoot: string): string[] {
        return [
            path.join(workspaceRoot, '.marp/themes'),
            path.join(workspaceRoot, 'themes'),
            path.join(workspaceRoot, '_themes'),
            path.join(workspaceRoot, 'assets/themes')
        ];
    }

    /**
     * Collect theme names from CSS files in a directory
     */
    private collectThemesFromDirectory(dirPath: string, themes: string[]): void {
        const files = fs.readdirSync(dirPath);
        const cssFiles = files.filter((file: string) => file.endsWith('.css') || file.endsWith('.marp.css'));
        cssFiles.forEach((file: string) => {
            const themeName = file.replace(/\.(css|marp\.css)$/, '');
            if (!themes.includes(themeName)) {
                themes.push(themeName);
            }
        });
    }

    /**
     * Map plugin format ID to Marp format
     */
    private _mapFormatId(formatId: string): 'pdf' | 'pptx' | 'html' | null {
        switch (formatId) {
            case 'marp-pdf':
                return 'pdf';
            case 'marp-pptx':
                return 'pptx';
            case 'marp-html':
                return 'html';
            default:
                return null;
        }
    }
}
