import { marpCli } from '@marp-team/marp-cli';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ConfigurationService } from '../configurationService';

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
    /** Additional Marp CLI arguments */
    additionalArgs?: string[];
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
     * Stop Marp watch process for a file
     */
    public static stopMarpWatch(filePath: string): void {
        const pid = this.marpProcessPids.get(filePath);
        if (pid) {
            try {
                process.kill(pid);
                console.log(`[kanban.MarpExportService] Killed Marp process ${pid} for ${filePath}`);
            } catch (error) {
                console.error(`[kanban.MarpExportService] Failed to kill process ${pid}:`, error);
            }
            this.marpProcessPids.delete(filePath);
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
        console.log(`[kanban.MarpExportService] Stopping all Marp watch processes (${this.marpProcessPids.size} processes)`);
        for (const [filePath, pid] of this.marpProcessPids.entries()) {
            try {
                process.kill(pid);
                console.log(`[kanban.MarpExportService] Killed Marp process ${pid} for ${filePath}`);
            } catch (error) {
                console.error(`[kanban.MarpExportService] Failed to kill process ${pid}:`, error);
            }
        }
        this.marpProcessPids.clear();
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
                console.log(`[kanban.MarpExportService] Marp process already running for ${options.inputFilePath} (PID: ${existingPid}), skipping new process`);
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

            // Log for debugging
            console.log(`[kanban.MarpExportService] Exporting with Marp CLI: ${args.join(' ')}`);
            console.log(`[kanban.MarpExportService] Full args array:`, args);
            console.log(`[kanban.MarpExportService] Export options:`, JSON.stringify(options, null, 2));
            console.log(`[kanban.MarpExportService] Marp CLI command: npx @marp-team/marp-cli ${args.join(' ')}`);

            // Execute Marp CLI with proper working directory
            const workspaceFolders = vscode.workspace.workspaceFolders;

            // if (options.watchMode) {
            // WATCH MODE: Run Marp as detached background process
            console.log(`[kanban.MarpExportService] Starting Marp in watch mode (detached process)`);

            const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
                ? workspaceFolders[0].uri.fsPath
                : process.cwd();

            const command = 'npx';
            const commandArgs = ['@marp-team/marp-cli', ...args];

            // Spawn Marp as a detached background process
            const marpProcess = spawn(command, commandArgs, {
                cwd: workspaceRoot,
                detached: true,
                stdio: 'ignore'
            });

            // Detach from parent process to allow it to run independently
            marpProcess.unref();

            console.log(`[kanban.MarpExportService] Marp watch process started with PID: ${marpProcess.pid}`);

            // Store the PID in MarpExportService for later termination
            if (options.inputFilePath && marpProcess.pid) {
                console.log(`[kanban.MarpExportService] Storing PID ${marpProcess.pid} for file ${options.inputFilePath}`);
                this.storeMarpPid(options.inputFilePath, marpProcess.pid);
            } else {
                console.warn(`[kanban.MarpExportService] Could not store PID - inputFilePath: ${options.inputFilePath}, pid: ${marpProcess.pid}`);
            }
            // } 
            // else {
            //     // NORMAL MODE: Run Marp synchronously and wait for completion
            //     console.log(`[kanban.MarpExportService] Starting Marp in normal mode (synchronous)`);

            //     let exitCode: number;

            //     if (workspaceFolders && workspaceFolders.length > 0) {
            //         const originalCwd = process.cwd();
            //         const workspaceRoot = workspaceFolders[0].uri.fsPath;

            //         try {
            //             process.chdir(workspaceRoot);
            //             exitCode = await marpCli(args);
            //         } finally {
            //             process.chdir(originalCwd);
            //         }
            //     } else {
            //         exitCode = await marpCli(args);
            //     }

            //     if (exitCode !== 0) {
            //         throw new Error(`Marp export failed with exit code ${exitCode}`);
            //     }

            //     console.log(`[kanban.MarpExportService] Marp conversion completed successfully`);
            // }

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
        const args: string[] = [inputPath];

        // Output format
        if (options.format === 'pdf') {
            args.push('--pdf');
        } else if (options.format === 'pptx') {
            args.push('--pptx');
        } else if (options.format === 'html') {
            args.push('--html');
        }

        if (options.watchMode) {
            // For HTML export, add preview to open in browser
            args.push('--preview');
            args.push('--watch');
        }

        // Output path (only for non-markdown formats, but not for HTML with preview)
        if (options.format !== 'markdown' && !(options.format === 'html' && args.includes('--preview'))) {
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
        const configService = ConfigurationService.getInstance();
        const configuredThemeFolders = configService.getNestedConfig('marp.themeFolders', []) as string[];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        // Add configured theme folders first
        if (configuredThemeFolders.length > 0 && workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            
            for (const themeFolder of configuredThemeFolders) {
                let resolvedPath: string;
                
                // Resolve relative paths against workspace root, keep absolute paths as-is
                if (path.isAbsolute(themeFolder)) {
                    resolvedPath = themeFolder;
                } else {
                    resolvedPath = path.resolve(workspaceRoot, themeFolder);
                }
                
                if (fs.existsSync(resolvedPath)) {
                    console.log(`[kanban.MarpExportService] Adding configured theme set directory: ${resolvedPath}`);
                    args.push('--theme-set', resolvedPath);
                } else {
                    console.warn(`[kanban.MarpExportService] Configured theme directory not found: ${resolvedPath}`);
                }
            }
        }
        
        // Fallback to common theme directories if no configured folders were found/added
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            
            // Check for custom theme directories in common locations
            const themePaths = [
                path.join(workspaceRoot, '.marp/themes'),
                path.join(workspaceRoot, 'themes'),
                path.join(workspaceRoot, '_themes'),
                path.join(workspaceRoot, 'assets/themes')
            ];

            for (const themePath of themePaths) {
                if (fs.existsSync(themePath)) {
                    console.log(`[kanban.MarpExportService] Adding fallback theme set directory: ${themePath}`);
                    args.push('--theme-set', themePath);
                    break; // Only add the first found theme directory
                }
            }
        }

        // Always allow local files (required for images)
        args.push('--allow-local-files');

        // Watch mode: add --watch flag
        // if (options.watchMode) {
        //     args.push('--watch');
        //     console.log(`[kanban.MarpExportService] Adding --watch flag for watch mode`);
        // }

        // Browser setting - prioritize options.additionalArgs, then config
        let browser: string | undefined;

        // First, extract browser from additionalArgs if present
        if (options.additionalArgs) {
            const browserIndex = options.additionalArgs.findIndex(arg => arg === '--browser');
            if (browserIndex !== -1 && browserIndex + 1 < options.additionalArgs.length) {
                browser = options.additionalArgs[browserIndex + 1];
                // Remove from additionalArgs to avoid duplication
                options.additionalArgs.splice(browserIndex, 2);
                console.log(`[kanban.MarpExportService] Using browser from additionalArgs: ${browser}`);
            }
        }

        // If no browser in additionalArgs, use from config
        if (!browser) {
            const configService = ConfigurationService.getInstance();
            browser = configService.getNestedConfig('marp.browser', 'chrome');
            console.log(`[kanban.MarpExportService] Using browser from config: ${browser}`);
            console.log(`[kanban.MarpExportService] Config service instance:`, !!configService);
        }

        if (browser && browser !== 'auto') {
            // Add browser option for all formats that can use it
            // HTML export uses browser for preview, PDF/PPTX for rendering
            args.push('--browser', browser);
            console.log(`[kanban.MarpExportService] Using browser for ${options.format}: ${browser}`);
        }

        // Additional args
        if (options.additionalArgs) {
            args.push(...options.additionalArgs);
        }

        // Final log of all arguments
        console.log(`[kanban.MarpExportService.buildMarpCliArgs] Final arguments:`, args);
        console.log(`[kanban.MarpExportService.buildMarpCliArgs] Arguments count: ${args.length}`);

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
     * Export to PDF using Marp
     * @param markdownContent - Markdown content
     * @param outputPath - Output PDF path
     * @param enginePath - Optional custom engine path
     * @returns Promise that resolves when export is complete
     */
    static async testPdfExport(inputFilePath: string, outputPath: string, enginePath?: string): Promise<void> {
        try {
            await this.export({
                inputFilePath,
                format: 'pdf',
                outputPath,
                enginePath
            });
            console.log('[kanban.MarpExportService] PDF test export successful');
        } catch (error) {
            console.error('[kanban.MarpExportService] PDF test export failed:', error);
            throw error;
        }
    }

    /**
     * Export to PPTX using Marp
     * @param inputFilePath - Input markdown file path
     * @param outputPath - Output PPTX path
     * @param enginePath - Optional custom engine path
     * @returns Promise that resolves when export is complete
     */
    static async exportToPptx(
        inputFilePath: string,
        outputPath: string,
        enginePath?: string
    ): Promise<void> {
        await this.export({
            inputFilePath,
            format: 'pptx',
            outputPath,
            enginePath
        });
    }

    /**
     * Export to HTML using Marp
     * @param inputFilePath - Input markdown file path
     * @param outputPath - Output HTML path
     * @param enginePath - Optional custom engine path
     * @returns Promise that resolves when export is complete
     */
    static async exportToHtml(
        inputFilePath: string,
        outputPath: string,
        enginePath?: string
    ): Promise<void> {
        await this.export({
            inputFilePath,
            format: 'html',
            outputPath,
            enginePath
        });
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
                    console.log(`[kanban.MarpExportService] Copied ${file} to dist directory`);
                } catch (err) {
                    console.warn(`[kanban.MarpExportService] Failed to copy ${file} to dist:`, err);
                }
            }
        }
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
     * Get Marp CLI version
     * @returns Version string or null if not available
     */
    static async getMarpVersion(): Promise<string | null> {
        try {
            // Try to read package.json from node_modules
            const fs = await import('fs');
            const path = await import('path');
            const pkgPath = path.join(__dirname, '../../node_modules/@marp-team/marp-cli/package.json');
            if (fs.existsSync(pkgPath)) {
                const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
                const pkg = JSON.parse(pkgContent);
                return pkg.version;
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    /**
     * Get available Marp themes
     * @returns Promise that resolves to an array of available theme names
     */
    static async getAvailableThemes(): Promise<string[]> {
        console.log('[kanban.MarpExportService.getAvailableThemes] Starting to get available themes...');
        try {
            // Check if Marp CLI is available first
            const isAvailable = await this.isMarpCliAvailable();
            console.log('[kanban.MarpExportService.getAvailableThemes] Marp CLI available:', isAvailable);
            if (!isAvailable) {
                console.log('[kanban.MarpExportService.getAvailableThemes] Using fallback themes');
                return ['default']; // Fallback to default theme
            }

            // Start with built-in themes
            const themes = [
                'default',
                'gaia', 
                'uncover',
            ];

            // Get configured theme folders
            const configService = ConfigurationService.getInstance();
            const configuredThemeFolders = configService.getNestedConfig('marp.themeFolders', []) as string[];
            const workspaceFolders = vscode.workspace.workspaceFolders;
            console.log('[kanban.MarpExportService.getAvailableThemes] Workspace folders:', workspaceFolders);
            console.log('[kanban.MarpExportService.getAvailableThemes] Configured theme folders:', configuredThemeFolders);
            
            // Check configured theme folders first
            if (configuredThemeFolders.length > 0 && workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                
                for (const themeFolder of configuredThemeFolders) {
                    let resolvedPath: string;
                    
                    // Resolve relative paths against workspace root, keep absolute paths as-is
                    if (path.isAbsolute(themeFolder)) {
                        resolvedPath = themeFolder;
                    } else {
                        resolvedPath = path.resolve(workspaceRoot, themeFolder);
                    }
                    
                    if (fs.existsSync(resolvedPath)) {
                        console.log('[kanban.MarpExportService.getAvailableThemes] Found configured theme directory:', resolvedPath);
                        const files = fs.readdirSync(resolvedPath);
                        const cssFiles = files.filter((file: string) => file.endsWith('.css') || file.endsWith('.marp.css'));
                        cssFiles.forEach((file: string) => {
                            const themeName = file.replace(/\.(css|marp\.css)$/, '');
                            if (!themes.includes(themeName)) {
                                themes.push(themeName);
                                console.log('[kanban.MarpExportService.getAvailableThemes] Found custom theme:', themeName);
                            }
                        });
                    } else {
                        console.warn('[kanban.MarpExportService.getAvailableThemes] Configured theme directory not found:', resolvedPath);
                    }
                }
            }
            
            // Fallback to common theme directories
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                
                // Check for custom theme files in common locations
                const themePaths = [
                    path.join(workspaceRoot, '.marp/themes'),
                    path.join(workspaceRoot, 'themes'),
                    path.join(workspaceRoot, '_themes'),
                    path.join(workspaceRoot, 'assets/themes')
                ];

                for (const themePath of themePaths) {
                    if (fs.existsSync(themePath)) {
                        console.log('[kanban.MarpExportService.getAvailableThemes] Found fallback theme directory:', themePath);
                        const files = fs.readdirSync(themePath);
                        const cssFiles = files.filter((file: string) => file.endsWith('.css') || file.endsWith('.marp.css'));
                        cssFiles.forEach((file: string) => {
                            const themeName = file.replace(/\.(css|marp\.css)$/, '');
                            if (!themes.includes(themeName)) {
                                themes.push(themeName);
                                console.log('[kanban.MarpExportService.getAvailableThemes] Found fallback custom theme:', themeName);
                            }
                        });
                    }
                }
            }

            const sortedThemes = themes.sort();
            console.log('[kanban.MarpExportService.getAvailableThemes] Final themes list:', sortedThemes);
            return sortedThemes;
        } catch (err) {
            console.error('[kanban.MarpExportService.getAvailableThemes] Failed to get available themes:', err);
            return ['default']; // Fallback to default theme
        }
    }
}
