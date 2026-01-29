/**
 * PlantUML Diagram Plugin
 *
 * Renders PlantUML code blocks to SVG using Java + PlantUML JAR.
 * Migrated from src/services/export/PlantUMLService.ts
 */

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getErrorMessage } from '../../utils/stringUtils';
import { logger } from '../../utils/logger';
import {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramRenderOptions,
    DiagramRenderResult
} from '../interfaces/DiagramPlugin';

export class PlantUMLPlugin implements DiagramPlugin {
    readonly metadata: DiagramPluginMetadata = {
        id: 'plantuml',
        name: 'PlantUML Diagram Renderer',
        version: '1.0.0',
        supportedCodeBlocks: ['plantuml', 'puml'],
        supportedFileExtensions: [],
        renderOutput: 'svg',
        requiresExternalTool: true,
        externalToolName: 'Java + PlantUML',
        configKeys: ['javaPath', 'graphvizPath']
    };

    private graphvizWarningShown = false;
    private static resolvedJavaPath: string | null = null;
    private static resolvedDotPath: string | null = null;

    canRenderCodeBlock(language: string): boolean {
        return this.metadata.supportedCodeBlocks.includes(language.toLowerCase());
    }

    canRenderFile(_filePath: string): boolean {
        return false;
    }

    async isAvailable(): Promise<boolean> {
        try {
            const testCode = '@startuml\nAlice -> Bob: test\n@enduml';
            const result = await this.renderCodeBlock(testCode);
            return result.success && (result.data as string).includes('<svg');
        } catch {
            return false;
        }
    }

    async renderCodeBlock(code: string, _options?: DiagramRenderOptions): Promise<DiagramRenderResult> {
        try {
            const svg = await this._renderSVG(code);
            return { success: true, data: svg, format: 'svg' };
        } catch (error) {
            return { success: false, data: '', format: 'svg', error: getErrorMessage(error) };
        }
    }

    // ============= INTERNAL RENDERING =============

    private async _renderSVG(code: string): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                if (!this._isGraphvizInstalled()) {
                    console.warn('[PlantUMLPlugin] Graphviz not found - some diagrams may not render correctly');
                    this._showGraphvizWarning();
                }

                // After esbuild bundling, __dirname points to dist/
                const vendorPath = path.join(__dirname, '../node_modules/node-plantuml/vendor');
                const plantumlJar = path.join(vendorPath, 'plantuml.jar');

                logger.debug('[PlantUMLPlugin] JAR path:', plantumlJar);

                if (!fs.existsSync(plantumlJar)) {
                    reject(new Error(`PlantUML JAR not found at: ${plantumlJar}. Make sure node-plantuml is installed.`));
                    return;
                }

                const args = [
                    '-Djava.awt.headless=true',
                    '-jar', plantumlJar,
                    '-Playout=smetana',
                    '-tsvg',
                    '-pipe'
                ];

                const javaCmd = this._getJavaPath();

                const child = spawn(javaCmd, args, {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                const chunks: Buffer[] = [];
                let stderrData = '';

                child.stdout.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });

                child.stderr.on('data', (chunk: Buffer) => {
                    stderrData += chunk.toString();
                });

                child.on('close', (exitCode) => {
                    if (exitCode !== 0) {
                        reject(new Error(`PlantUML process failed with exit code ${exitCode}: ${stderrData}`));
                        return;
                    }

                    if (chunks.length === 0) {
                        if (stderrData) {
                            reject(new Error(`PlantUML error: ${stderrData}`));
                        } else {
                            reject(new Error('PlantUML generated empty output'));
                        }
                        return;
                    }

                    const svg = Buffer.concat(chunks).toString('utf8');
                    resolve(svg);
                });

                child.on('error', (error) => {
                    reject(new Error(`Failed to spawn Java: ${error.message}`));
                });

                child.stdin.write(code);
                child.stdin.end();

                setTimeout(() => {
                    child.kill();
                    reject(new Error('PlantUML rendering timeout'));
                }, 30000);

            } catch (error) {
                reject(new Error(`PlantUML rendering failed: ${getErrorMessage(error)}`));
            }
        });
    }

    // ============= CLI PATH RESOLUTION =============

    private static _getCommonPaths(cliName: string): string[] {
        const platform = process.platform;
        if (platform === 'darwin') {
            return [
                `/opt/homebrew/bin/${cliName}`,
                `/usr/local/bin/${cliName}`,
                `/opt/local/bin/${cliName}`,
            ];
        } else if (platform === 'win32') {
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
            if (cliName === 'java') {
                return [
                    `${programFiles}\\Java\\jdk-*\\bin\\java.exe`,
                    `${programFiles}\\Eclipse Adoptium\\*\\bin\\java.exe`,
                    `${programFiles}\\Zulu\\*\\bin\\java.exe`,
                ];
            } else if (cliName === 'dot') {
                return [
                    `${programFiles}\\Graphviz\\bin\\dot.exe`,
                ];
            }
            return [];
        } else {
            return [
                `/usr/bin/${cliName}`,
                `/usr/local/bin/${cliName}`,
            ];
        }
    }

    private static _testCommandSync(command: string, args: string[] = ['-V']): boolean {
        try {
            execSync(`"${command}" ${args.join(' ')}`, { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }

    private static _resolveCliPath(cliName: string, configKey: string, cachedPath: string | null): string {
        if (cachedPath) {
            return cachedPath;
        }

        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const configuredPath = config.get<string>(configKey, '');
        if (configuredPath && this._testCommandSync(configuredPath)) {
            return configuredPath;
        }

        if (this._testCommandSync(cliName)) {
            return cliName;
        }

        for (const commonPath of this._getCommonPaths(cliName)) {
            if (this._testCommandSync(commonPath)) {
                return commonPath;
            }
        }

        return cliName;
    }

    private _getJavaPath(): string {
        if (!PlantUMLPlugin.resolvedJavaPath) {
            PlantUMLPlugin.resolvedJavaPath = PlantUMLPlugin._resolveCliPath(
                'java', 'javaPath', PlantUMLPlugin.resolvedJavaPath
            );
        }
        return PlantUMLPlugin.resolvedJavaPath;
    }

    private _getDotPath(): string {
        if (!PlantUMLPlugin.resolvedDotPath) {
            PlantUMLPlugin.resolvedDotPath = PlantUMLPlugin._resolveCliPath(
                'dot', 'graphvizPath', PlantUMLPlugin.resolvedDotPath
            );
        }
        return PlantUMLPlugin.resolvedDotPath;
    }

    private _isGraphvizInstalled(): boolean {
        const dotCmd = this._getDotPath();
        try {
            execSync(`"${dotCmd}" -V`, { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }

    private _showGraphvizWarning(): void {
        if (this.graphvizWarningShown) {
            return;
        }
        this.graphvizWarningShown = true;

        const message = 'Graphviz is not installed. Some PlantUML diagrams (class, activity, state, component) may not render correctly. Install Graphviz for full diagram support.';
        const installButton = 'How to Install';

        vscode.window.showWarningMessage(message, installButton).then(selection => {
            if (selection === installButton) {
                vscode.env.openExternal(vscode.Uri.parse('https://graphviz.org/download/'));
            }
        });
    }
}
