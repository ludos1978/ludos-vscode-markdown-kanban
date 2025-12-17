import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getErrorMessage } from '../../utils/stringUtils';

/**
 * Backend service for rendering PlantUML diagrams using Java + PlantUML JAR
 * This runs in the Node.js extension host (completely offline after bundling)
 */
export class PlantUMLService {
    private graphvizWarningShown = false;

    /**
     * Check if Graphviz is installed on the system
     * Uses configured path or PATH
     * @returns true if Graphviz is available, false otherwise
     */
    private isGraphvizInstalled(): boolean {
        // Check configured path or use PATH
        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const graphvizPath = config.get<string>('graphvizPath', '');
        const dotCmd = graphvizPath || 'dot';

        try {
            execSync(`${dotCmd} -V`, { stdio: 'pipe' });
            return true;
        } catch (error) {
            console.warn(`[PlantUML Service] Graphviz not found. Configure markdown-kanban.graphvizPath in settings.`);
            return false;
        }
    }

    /**
     * Show a warning to the user if Graphviz is not installed
     */
    private showGraphvizWarning(): void {
        if (this.graphvizWarningShown) {
            return; // Only show once per session
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

    /**
     * Render PlantUML code to SVG format
     * @param code PlantUML code (should include @startuml/@enduml wrapper)
     * @returns Promise resolving to SVG string
     */
    async renderSVG(code: string): Promise<string> {
        return new Promise((resolve, reject) => {
            try {

                // Check if Graphviz is installed and warn user if not
                if (!this.isGraphvizInstalled()) {
                    console.warn('[PlantUML Service] Graphviz not found - some diagrams may not render correctly');
                    this.showGraphvizWarning();
                }

                // Bypass node-plantuml and spawn Java directly
                // node-plantuml doesn't work in VS Code extension context
                // After esbuild bundling, __dirname points to dist/, so we need ../node_modules/
                // (was ../../ which is wrong for bundled code)
                const vendorPath = path.join(__dirname, '../node_modules/node-plantuml/vendor');
                const plantumlJar = path.join(vendorPath, 'plantuml-modern.jar');  // Use modern v1.2024.7

                // Debug: log the resolved path
                console.log('[PlantUML Service] JAR path:', plantumlJar);

                // Verify JAR file exists
                if (!fs.existsSync(plantumlJar)) {
                    console.error('[PlantUML Service] JAR file not found at:', plantumlJar);
                    console.error('[PlantUML Service] __dirname is:', __dirname);
                    reject(new Error(`PlantUML JAR not found at: ${plantumlJar}. Make sure node-plantuml is installed.`));
                    return;
                }

                // Use Smetana layout engine (pure Java, no external dependencies)
                // Smetana is a built-in Graphviz replacement that works offline
                const args = [
                    '-Djava.awt.headless=true',
                    '-jar', plantumlJar,
                    '-Playout=smetana',  // Force Smetana layout engine (no VizJS/J2V8 needed)
                    '-tsvg',  // SVG output
                    '-pipe'   // Read from stdin, write to stdout
                ];

                // Use configured java path or PATH
                const config = vscode.workspace.getConfiguration('markdown-kanban');
                const javaPath = config.get<string>('javaPath', '');
                const javaCmd = javaPath || 'java';

                const child = spawn(javaCmd, args, {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                const chunks: Buffer[] = [];
                let stderrData = '';

                // Collect stdout data
                child.stdout.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });

                child.stdout.on('end', () => {
                });

                // Collect stderr for errors
                child.stderr.on('data', (chunk: Buffer) => {
                    stderrData += chunk.toString();
                });

                // Handle process exit
                child.on('close', (exitCode) => {

                    if (exitCode !== 0) {
                        reject(new Error(`PlantUML process failed with exit code ${exitCode}: ${stderrData}`));
                        return;
                    }

                    if (chunks.length === 0) {
                        console.error('[PlantUML Service] Empty SVG output');
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
                    console.error('[PlantUML Service] Process error:', error);
                    reject(new Error(`Failed to spawn Java: ${error.message}`));
                });

                // Write PlantUML code to stdin
                child.stdin.write(code);
                child.stdin.end();

                // Timeout after 30 seconds
                setTimeout(() => {
                    child.kill();
                    reject(new Error('PlantUML rendering timeout'));
                }, 30000);

            } catch (error) {
                console.error('[PlantUML Service] Exception:', error);
                reject(new Error(`PlantUML rendering failed: ${getErrorMessage(error)}`));
            }
        });
    }

    /**
     * Validate that PlantUML (Java) is available on the system
     * @returns Promise resolving to true if PlantUML is available, false otherwise
     */
    async isAvailable(): Promise<boolean> {
        try {
            // Try to render a minimal diagram to verify Java + PlantUML work
            const testCode = '@startuml\nAlice -> Bob: test\n@enduml';
            const svg = await this.renderSVG(testCode);
            return svg.includes('<svg') || svg.includes('<?xml');
        } catch (error) {
            console.error('[PlantUML Service] Availability check failed:', error);
            return false;
        }
    }
}
