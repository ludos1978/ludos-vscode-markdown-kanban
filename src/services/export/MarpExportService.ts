import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ConfigurationService } from '../ConfigurationService';
import { logger } from '../../utils/logger';

export type MarpOutputFormat = 'pdf' | 'pptx' | 'html' | 'markdown';

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
 * Service to export content using Marp CLI
 */
export class MarpExportService {
    private static readonly DEFAULT_ENGINE_PATH = './marp-engine/engine.js';

    // PID storage for Marp watch processes
    private static marpProcessPids = new Map<string, number>();

    /**
     * Store Marp process PID
     */
    private static storeMarpPid(filePath: string, pid: number): void {
        this.marpProcessPids.set(filePath, pid);
    }

    /**
     * Get Marp process PID for a file
     */
    private static getMarpPid(filePath: string): number | undefined {
        return this.marpProcessPids.get(filePath);
    }

    /**
     * Kill a process by PID with error handling
     */
    private static killProcess(pid: number): void {
        try {
            process.kill(pid);
        } catch (error) {
            console.error(`[kanban.MarpExportService] Failed to kill process ${pid}:`, error);
        }
    }

    /**
     * Cleanup preprocessed markdown file if it exists
     */
    private static cleanupPreprocessedFile(filePath: string): void {
        if (filePath.endsWith('.preprocessed.md')) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                console.warn(`[kanban.MarpExportService] Failed to cleanup preprocessed file:`, error);
            }
        }
    }

    /**
     * Stop Marp watch process for a file
     */
    public static stopMarpWatch(filePath: string): void {
        const pid = this.marpProcessPids.get(filePath);
        if (pid) {
            this.killProcess(pid);
            this.marpProcessPids.delete(filePath);
            this.cleanupPreprocessedFile(filePath);
        }
    }

    /**
     * Check if a file is being watched by Marp
     */
    public static isWatching(filePath: string): boolean {
        return this.marpProcessPids.has(filePath);
    }

    /**
     * Stop all Marp watch processes
     */
    public static stopAllMarpWatches(): void {
        for (const [filePath, pid] of this.marpProcessPids.entries()) {
            this.killProcess(pid);
            this.cleanupPreprocessedFile(filePath);
        }
        this.marpProcessPids.clear();
    }

    /**
     * Stop all Marp watch processes except for a specific file
     * @param excludeFilePath Path to the file whose Marp process should NOT be stopped
     */
    public static stopAllMarpWatchesExcept(excludeFilePath?: string): void {
        for (const [filePath, pid] of this.marpProcessPids.entries()) {
            if (filePath !== excludeFilePath) {
                this.killProcess(pid);
                this.cleanupPreprocessedFile(filePath);
                this.marpProcessPids.delete(filePath);
            }
        }
    }

    /**
     * Export markdown file using Marp CLI
     * @param options - Export options
     * @returns Promise that resolves when export is complete
     */
    static async export(options: MarpExportOptions): Promise<void> {
        // Check if a Marp process is already running for this file (watch mode only)
        if (options.watchMode) {
            const existingPid = this.getMarpPid(options.inputFilePath);
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
            logger.debug(`[MarpExportService] format: ${options.format}, args:`, args.join(' '));

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
                // Spawn Marp as a detached background process
                const marpProcess = spawn(command, commandArgs, {
                    cwd: inputFileDir,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: env
                });

                // Collect stderr for error reporting
                let stderrOutput = '';

                if (marpProcess.stderr) {
                    marpProcess.stderr.on('data', (data) => {
                        const output = data.toString();
                        stderrOutput += output;
                        // Marp sends all output to stderr - only log errors
                        if (output.includes('[ERROR]') || output.includes('Error:')) {
                            console.error(`[kanban.MarpExportService] ${output}`);
                        }
                    });
                }

                marpProcess.on('error', (error) => {
                    console.error(`[kanban.MarpExportService] Process error:`, error);
                    vscode.window.showErrorMessage(`Marp export failed: ${error.message}`);
                });

                marpProcess.on('exit', (code) => {
                    if (options.inputFilePath) {
                        this.marpProcessPids.delete(options.inputFilePath);
                    }
                    // Show error to user if Marp failed
                    if (code !== 0 && code !== null) {
                        // Extract the actual error message from stderr
                        const errorMatch = stderrOutput.match(/\[ ERROR \](.+?)(?=\[|$)/s);
                        const errorMessage = errorMatch
                            ? errorMatch[1].trim().replace(/\s+/g, ' ')
                            : `Marp exited with code ${code}`;
                        vscode.window.showErrorMessage(`Marp export failed: ${errorMessage}`);
                    }
                });

                // Detach from parent process to allow it to run independently
                marpProcess.unref();

                // Store the PID for later termination
                if (options.inputFilePath && marpProcess.pid) {
                    this.storeMarpPid(options.inputFilePath, marpProcess.pid);
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
                            // Marp sends all output to stderr - only log errors, not INFO/WARN
                            if (output.includes('[ERROR]') || output.includes('Error:')) {
                                console.error(`[kanban.MarpExportService] ${output}`);
                            }
                        });
                    }

                    marpProcess.on('error', (error) => {
                        console.error(`[kanban.MarpExportService] Process error:`, error);
                        reject(error);
                    });

                    marpProcess.on('exit', async (code) => {
                        if (code === 0) {
                            // Post-process for handout mode
                            if (options.handout) {
                                await this.runHandoutPostProcess(options);
                            }
                            resolve();
                        } else {
                            // Check if the error is just a warning (Marp sometimes exits 0 with warnings)
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
            console.error('[kanban.MarpExportService] Export failed:', error);
            throw error;
        }
    }

    /**
     * Build Marp CLI arguments from options
     * @param inputPath - Path to input markdown file
     * @param options - Export options
     * @returns Array of CLI arguments
     */
    private static buildMarpCliArgs(inputPath: string, options: MarpExportOptions): string[] {
        // Build args array - input file will be added at the END (marp [options] <files...>)
        const args: string[] = [];

        // Output format - must be html, pdf, or pptx
        // Format comes from UI dropdown, so should always be valid
        if (options.format === 'pdf') {
            args.push('--pdf');
        } else if (options.format === 'pptx') {
            args.push('--pptx');
            // Add --pptx-editable flag if pptxEditable mode is enabled
            if (options.pptxEditable) {
                args.push('--pptx-editable');
            }
        } else {
            // Default to HTML (covers 'html' and old 'markdown' format setting)
            args.push('--html');
        }

        if (options.watchMode) {
            // For HTML export, add preview to open in browser
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
            console.warn(`[kanban.MarpExportService] Engine file not found: ${enginePath}`);
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

        // Fallback to common theme directories if no configured folders were found/added
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const themePaths = this.getCommonThemePaths(workspaceRoot);

            for (const themePath of themePaths) {
                if (fs.existsSync(themePath)) {
                    args.push('--theme-set', themePath);
                    break; // Only add the first found theme directory
                }
            }
        }

        // Always allow local files (required for images)
        args.push('--allow-local-files');

        // Browser setting - prioritize options.additionalArgs, then config
        let browser: string | undefined;

        // First, extract browser from additionalArgs if present
        if (options.additionalArgs) {
            const browserIndex = options.additionalArgs.findIndex(arg => arg === '--browser');
            if (browserIndex !== -1 && browserIndex + 1 < options.additionalArgs.length) {
                browser = options.additionalArgs[browserIndex + 1];
                // Remove from additionalArgs to avoid duplication
                options.additionalArgs.splice(browserIndex, 2);
            }
        }

        // If no browser in additionalArgs, use from config
        if (!browser) {
            const configService = ConfigurationService.getInstance();
            browser = configService.getNestedConfig('marp.browser', 'chrome');
        }

        if (browser && browser !== 'auto') {
            // Add browser option for all formats that can use it
            // HTML export uses browser for preview, PDF/PPTX for rendering
            args.push('--browser', browser);
        }

        // Additional args
        if (options.additionalArgs) {
            args.push(...options.additionalArgs);
        }

        // Input file MUST come at the end (marp [options] <files...>)
        args.push(inputPath);

        return args;
    }

    /**
     * Get the default engine path from workspace configuration
     * @returns Resolved engine path
     */
    private static getDefaultEnginePath(): string {
        const config = vscode.workspace.getConfiguration('markdown-kanban.marp');
        const configuredPath = config.get<string>('enginePath');

        if (configuredPath) {
            // Resolve relative to workspace root
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                return path.resolve(workspaceFolders[0].uri.fsPath, configuredPath);
            }
            return path.resolve(configuredPath);
        }

        // Default to ./marp-engine/engine.js relative to workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return path.join(workspaceFolders[0].uri.fsPath, this.DEFAULT_ENGINE_PATH);
        }

        return this.DEFAULT_ENGINE_PATH;
    }

    /**
     * Ensure required build files exist in dist directory for Marp CLI
     */
    private static async ensureMarpBuildFiles(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const distDir = path.join(workspaceRoot, 'dist');
        
        // Files that Marp CLI expects
        const requiredFiles = ['esbuild.js', 'watch.js'];
        
        for (const file of requiredFiles) {
            const distFilePath = path.join(distDir, file);
            const srcFilePath = path.join(workspaceRoot, file);
            
            if (!fs.existsSync(distFilePath) && fs.existsSync(srcFilePath)) {
                try {
                    // Copy file from root to dist
                    fs.copyFileSync(srcFilePath, distFilePath);
                } catch (err) {
                    console.warn(`[kanban.MarpExportService] Failed to copy ${file} to dist:`, err);
                }
            }
        }
    }

    /**
     * Run handout post-processor on the generated HTML
     * @param options - Export options containing output path and handout settings
     */
    private static async runHandoutPostProcess(options: MarpExportOptions): Promise<void> {
        // Only process HTML outputs
        if (options.format !== 'html') {
            return;
        }

        // Get engine path and find handout-postprocess.js in the same directory
        const enginePath = options.enginePath || this.getDefaultEnginePath();
        const engineDir = path.dirname(enginePath);
        const postProcessorPath = path.join(engineDir, 'handout-postprocess.js');

        if (!fs.existsSync(postProcessorPath)) {
            console.warn(`[kanban.MarpExportService] Handout post-processor not found: ${postProcessorPath}`);
            return;
        }

        const env: NodeJS.ProcessEnv = { ...process.env };
        env.MARP_HANDOUT_LAYOUT = options.handoutLayout || 'portrait';
        env.MARP_HANDOUT_SLIDES_PER_PAGE = String(options.handoutSlidesPerPage || 1);
        env.MARP_HANDOUT_DIRECTION = options.handoutDirection || 'horizontal';
        env.MARP_HANDOUT_OUTPUT_PDF = 'true';  // Handout always outputs PDF

        // Build command arguments - handout always outputs PDF
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
                    console.error(`[MarpExportService] Handout post-processing failed: ${stderr}`);
                    resolve(); // Don't reject, just log the error
                }
            });

            postProcess.on('error', (error) => {
                console.error('[kanban.MarpExportService] Handout post-processing error:', error);
                resolve(); // Don't reject, just log the error
            });
        });
    }

    /**
     * Check if Marp CLI is available
     * @returns Promise that resolves to true if available
     */
    static async isMarpCliAvailable(): Promise<boolean> {
        try {
            // Try to import marpCli
            const cli = await import('@marp-team/marp-cli');
            return !!cli.marpCli;
        } catch (err) {
            console.error('[kanban.MarpExportService] Marp CLI not available:', err);
            return false;
        }
    }

    /**
     * Check if custom engine file exists
     * @param enginePath - Optional custom path, otherwise uses default
     * @returns True if engine file exists
     */
    static engineFileExists(enginePath?: string): boolean {
        const resolvedPath = enginePath || this.getDefaultEnginePath();
        return fs.existsSync(resolvedPath);
    }

    /**
     * Get the resolved engine path (public accessor)
     * @returns The resolved engine path
     */
    static getEnginePath(): string {
        return this.getDefaultEnginePath();
    }

    /**
     * Resolve a theme folder path against workspace root.
     * @param themeFolder - The configured theme folder (relative or absolute)
     * @param workspaceRoot - The workspace root path
     * @returns Resolved absolute path
     */
    private static resolveThemeFolderPath(themeFolder: string, workspaceRoot: string): string {
        if (path.isAbsolute(themeFolder)) {
            return themeFolder;
        }
        return path.resolve(workspaceRoot, themeFolder);
    }

    /**
     * Get resolved, existing configured theme folder paths.
     * @returns Array of resolved theme folder paths that exist on disk
     */
    private static getResolvedConfiguredThemeFolders(): string[] {
        const configService = ConfigurationService.getInstance();
        const configuredThemeFolders = configService.getNestedConfig('marp.themeFolders', []) as string[];
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
                console.warn(`[kanban.MarpExportService] Configured theme directory not found: ${resolvedPath}`);
            }
        }

        return resolvedPaths;
    }

    /**
     * Get common theme directory paths for a workspace.
     * @param workspaceRoot - The workspace root path
     * @returns Array of common theme directory paths
     */
    private static getCommonThemePaths(workspaceRoot: string): string[] {
        return [
            path.join(workspaceRoot, '.marp/themes'),
            path.join(workspaceRoot, 'themes'),
            path.join(workspaceRoot, '_themes'),
            path.join(workspaceRoot, 'assets/themes')
        ];
    }

    /**
     * Collect theme names from CSS files in a directory.
     * @param dirPath - Directory path to scan
     * @param themes - Array to add theme names to
     */
    private static collectThemesFromDirectory(dirPath: string, themes: string[]): void {
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
     * Get available Marp themes
     * @returns Promise that resolves to an array of available theme names
     */
    static async getAvailableThemes(): Promise<string[]> {
        try {
            // Check if Marp CLI is available first
            const isAvailable = await this.isMarpCliAvailable();
            if (!isAvailable) {
                return ['default']; // Fallback to default theme
            }

            // Start with built-in themes
            const themes = [
                'default',
                'gaia',
                'uncover',
            ];

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

            const sortedThemes = themes.sort();
            return sortedThemes;
        } catch (err) {
            console.error('[kanban.MarpExportService.getAvailableThemes] Failed to get available themes:', err);
            return ['default']; // Fallback to default theme
        }
    }
}
