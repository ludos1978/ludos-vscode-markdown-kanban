import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Backend service for rendering PlantUML diagrams using Java + PlantUML JAR
 * This runs in the Node.js extension host (completely offline after bundling)
 */
export class PlantUMLService {
    private graphvizWarningShown = false;

    /**
     * Check if Graphviz is installed on the system
     * Checks multiple common installation locations since VS Code extension
     * may not have Homebrew in PATH
     * @returns true if Graphviz is available, false otherwise
     */
    private isGraphvizInstalled(): boolean {
        // Try to execute 'dot -V' with default PATH
        try {
            execSync('dot -V', { stdio: 'pipe' });
            console.log('[PlantUML Service] Graphviz found in PATH');
            return true;
        } catch (error) {
            // Not in PATH, check common installation locations
        }

        // Common Graphviz installation paths
        const commonPaths = [
            '/opt/homebrew/bin/dot',      // Homebrew on Apple Silicon
            '/usr/local/bin/dot',          // Homebrew on Intel Mac
            '/opt/local/bin/dot',          // MacPorts
            '/usr/bin/dot',                // System installation
        ];

        const fs = require('fs');
        for (const dotPath of commonPaths) {
            try {
                if (fs.existsSync(dotPath)) {
                    // Verify it's executable by running it
                    execSync(`${dotPath} -V`, { stdio: 'pipe' });
                    console.log(`[PlantUML Service] Graphviz found at: ${dotPath}`);
                    return true;
                }
            } catch (error) {
                // This path doesn't work, try next
            }
        }

        console.warn('[PlantUML Service] Graphviz not found in PATH or common locations');
        return false;
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
                console.log('[PlantUML Service] Starting SVG render (direct Java spawn)...');
                console.log('[PlantUML Service] Code length:', code.length);

                // Check if Graphviz is installed and warn user if not
                if (!this.isGraphvizInstalled()) {
                    console.warn('[PlantUML Service] Graphviz not found - some diagrams may not render correctly');
                    this.showGraphvizWarning();
                }

                // Bypass node-plantuml and spawn Java directly
                // node-plantuml doesn't work in VS Code extension context
                const vendorPath = path.join(__dirname, '../node_modules/node-plantuml/vendor');
                const plantumlJar = path.join(vendorPath, 'plantuml-modern.jar');  // Use modern v1.2024.7

                console.log('[PlantUML Service] Using PlantUML JAR:', plantumlJar);

                // Use Smetana layout engine (pure Java, no external dependencies)
                // Smetana is a built-in Graphviz replacement that works offline
                const args = [
                    '-Djava.awt.headless=true',
                    '-jar', plantumlJar,
                    '-Playout=smetana',  // Force Smetana layout engine (no VizJS/J2V8 needed)
                    '-tsvg',  // SVG output
                    '-pipe'   // Read from stdin, write to stdout
                ];

                const child = spawn('java', args, {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                const chunks: Buffer[] = [];
                let stderrData = '';

                // Collect stdout data
                child.stdout.on('data', (chunk: Buffer) => {
                    console.log('[PlantUML Service] Received stdout chunk, length:', chunk.length);
                    chunks.push(chunk);
                });

                child.stdout.on('end', () => {
                    console.log('[PlantUML Service] stdout ended. Total chunks:', chunks.length);
                });

                // Collect stderr for errors
                child.stderr.on('data', (chunk: Buffer) => {
                    stderrData += chunk.toString();
                    console.log('[PlantUML Service] stderr:', chunk.toString().trim());
                });

                // Handle process exit
                child.on('close', (exitCode) => {
                    console.log('[PlantUML Service] Process exited with code:', exitCode);

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
                    console.log('[PlantUML Service] ✅ SVG rendered successfully, length:', svg.length);
                    resolve(svg);
                });

                child.on('error', (error) => {
                    console.error('[PlantUML Service] Process error:', error);
                    reject(new Error(`Failed to spawn Java: ${error.message}`));
                });

                // Write PlantUML code to stdin
                console.log('[PlantUML Service] Writing code to stdin...');
                child.stdin.write(code);
                child.stdin.end();
                console.log('[PlantUML Service] stdin closed, waiting for output...');

                // Timeout after 30 seconds
                setTimeout(() => {
                    child.kill();
                    reject(new Error('PlantUML rendering timeout'));
                }, 30000);

            } catch (error) {
                console.error('[PlantUML Service] Exception:', error);
                reject(new Error(`PlantUML rendering failed: ${error instanceof Error ? error.message : String(error)}`));
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
