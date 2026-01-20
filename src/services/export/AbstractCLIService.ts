import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { EXTERNAL_SERVICE_TIMEOUT_MS } from '../../constants/TimeoutConstants';

/**
 * Abstract base class for CLI-based export services
 * Provides common patterns for:
 * - CLI availability checking with caching
 * - Temp file management
 * - Process spawning with timeout
 * - Warning notifications
 */
export abstract class AbstractCLIService {
    protected cliPath: string | null = null;
    protected availabilityChecked: boolean = false;
    protected isCliAvailable: boolean = false;

    /**
     * Get the configuration key for the custom CLI path setting
     * e.g., 'popplerPath', 'mutoolPath', 'drawioPath'
     */
    protected abstract getConfigKey(): string;

    /**
     * Get the default CLI command name when no custom path is configured
     * e.g., 'pdftoppm', 'mutool', 'drawio'
     */
    protected abstract getDefaultCliName(): string;

    /**
     * Get the service name for logging
     * e.g., 'PDFService', 'EPUBService'
     */
    protected abstract getServiceName(): string;

    /**
     * Get CLI arguments to test if the command is available
     * Default is ['-v'], override if needed (e.g., ['--version'])
     */
    protected getVersionCheckArgs(): string[] {
        return ['-v'];
    }

    /**
     * Determine if the CLI command succeeded based on exit code
     * Default accepts any non-error exit (some CLI tools return non-zero for -v)
     */
    protected isVersionCheckSuccess(_code: number | null): boolean {
        // By default, if the process ran without error event, consider it available
        return true;
    }

    /**
     * Get the warning message when CLI is not available
     */
    protected abstract getCliNotFoundWarning(): string;

    /**
     * Get the URL for installation instructions
     */
    protected abstract getInstallationUrl(): string;

    /**
     * Check if CLI is available (with caching)
     */
    async isAvailable(): Promise<boolean> {
        if (this.availabilityChecked) {
            return this.isCliAvailable;
        }

        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const customPath = config.get<string>(this.getConfigKey(), '');

        // Build the CLI path
        const cliName = customPath
            ? path.join(customPath, this.getDefaultCliName())
            : this.getDefaultCliName();

        if (await this.testCliCommand(cliName)) {
            this.cliPath = cliName;
            this.isCliAvailable = true;
            this.availabilityChecked = true;
            return true;
        }

        this.availabilityChecked = true;
        this.isCliAvailable = false;
        console.warn(`[${this.getServiceName()}] ${this.getDefaultCliName()} CLI not found. Configure markdown-kanban.${this.getConfigKey()} in settings.`);
        return false;
    }

    /**
     * Test if a CLI command is available
     */
    protected async testCliCommand(command: string): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const proc = spawn(command, this.getVersionCheckArgs());

                proc.on('error', () => {
                    resolve(false);
                });

                proc.on('exit', (code) => {
                    resolve(this.isVersionCheckSuccess(code));
                });

                // Timeout after 2 seconds
                setTimeout(() => {
                    proc.kill();
                    resolve(false);
                }, 2000);
            } catch {
                resolve(false);
            }
        });
    }

    /**
     * Show warning notification when CLI is not available
     */
    protected showCliWarning(): void {
        const message = this.getCliNotFoundWarning();
        const installAction = 'Installation Instructions';

        vscode.window.showWarningMessage(message, installAction).then(selection => {
            if (selection === installAction) {
                vscode.env.openExternal(vscode.Uri.parse(this.getInstallationUrl()));
            }
        });
    }

    /**
     * Create a temp directory and return the path
     */
    protected ensureTempDir(): string {
        const tempDir = path.join(__dirname, '../../../tmp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        return tempDir;
    }

    /**
     * Generate a unique temp file path
     */
    protected getTempFilePath(prefix: string, extension: string): string {
        const tempDir = this.ensureTempDir();
        return path.join(tempDir, `${prefix}-${Date.now()}.${extension}`);
    }

    /**
     * Execute CLI command with timeout and return result
     * @param args CLI arguments
     * @param outputPath Path where the CLI will write output (if applicable)
     * @param options Execution options
     */
    protected async executeCliCommand(
        args: string[],
        outputPath?: string,
        options: {
            timeout?: number;
            binary?: boolean;
        } = {}
    ): Promise<{ stdout: string; stderr: string; code: number }> {
        const timeout = options.timeout ?? EXTERNAL_SERVICE_TIMEOUT_MS;

        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error(`${this.getDefaultCliName()} CLI not available`);
        }

        return new Promise((resolve, reject) => {
            const child = spawn(this.cliPath!, args);

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`${this.getServiceName()} conversion timed out after ${timeout}ms`));
            }, timeout);

            child.on('error', (error) => {
                clearTimeout(timer);
                console.error(`[${this.getServiceName()}] Process error:`, error);
                reject(error);
            });

            child.on('exit', (code) => {
                clearTimeout(timer);
                resolve({ stdout, stderr, code: code ?? -1 });
            });
        });
    }

    /**
     * Execute CLI command and read the output file
     * Common pattern for services that write to a temp file
     */
    protected async executeAndReadOutput(
        args: string[],
        outputPath: string,
        options: {
            timeout?: number;
            binary?: boolean;
            cleanupOnError?: boolean;
        } = {}
    ): Promise<Buffer | string> {
        const timeout = options.timeout ?? EXTERNAL_SERVICE_TIMEOUT_MS;
        const binary = options.binary ?? true;
        const cleanupOnError = options.cleanupOnError ?? true;

        if (!await this.isAvailable()) {
            this.showCliWarning();
            throw new Error(`${this.getDefaultCliName()} CLI not available`);
        }

        return new Promise((resolve, reject) => {
            const child = spawn(this.cliPath!, args);

            let stderr = '';

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`${this.getServiceName()} conversion timed out after ${timeout}ms`));
            }, timeout);

            child.on('error', (error) => {
                clearTimeout(timer);
                console.error(`[${this.getServiceName()}] Process error:`, error);
                reject(error);
            });

            child.on('exit', async (code) => {
                clearTimeout(timer);

                try {
                    if (code !== 0) {
                        console.error(`[${this.getServiceName()}] Conversion failed:`, stderr);
                        if (cleanupOnError && fs.existsSync(outputPath)) {
                            fs.unlinkSync(outputPath);
                        }
                        reject(new Error(`${this.getDefaultCliName()} exited with code ${code}`));
                        return;
                    }

                    if (!fs.existsSync(outputPath)) {
                        const errorMsg = `${this.getDefaultCliName()} exited successfully but did not create output file: ${outputPath}`;
                        console.error(`[${this.getServiceName()}]`, errorMsg);
                        if (stderr) {
                            console.error(`[${this.getServiceName()}] stderr output:`, stderr);
                        }
                        reject(new Error(errorMsg));
                        return;
                    }

                    // Read output file
                    const data = binary
                        ? await fs.promises.readFile(outputPath)
                        : await fs.promises.readFile(outputPath, 'utf8');

                    // Cleanup temp file
                    await fs.promises.unlink(outputPath);

                    resolve(data);
                } catch (error) {
                    console.error(`[${this.getServiceName()}] Failed to read output:`, error);
                    reject(error);
                }
            });
        });
    }

    /**
     * Reset the availability cache (useful for testing or after config changes)
     */
    resetAvailabilityCache(): void {
        this.availabilityChecked = false;
        this.isCliAvailable = false;
        this.cliPath = null;
    }
}
