import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { BrowserService } from '../BrowserService';

/**
 * Excalidraw element structure (subset of properties used)
 */
interface ExcalidrawElement {
    type: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strokeColor?: string;
    backgroundColor?: string;
    strokeWidth?: number;
    points?: number[][];
    text?: string;
    fontSize?: number;
    fileId?: string;  // For image elements
    isDeleted?: boolean;
}

/**
 * Excalidraw embedded file structure
 */
interface ExcalidrawFile {
    mimeType: string;
    dataURL: string;
}

/**
 * Excalidraw file data structure
 */
interface ExcalidrawData {
    type?: 'excalidraw';
    elements: ExcalidrawElement[];
    appState?: Record<string, unknown>;
    files?: Record<string, ExcalidrawFile>;
}

/**
 * Service for converting excalidraw diagrams to SVG
 * Uses @excalidraw/utils with jsdom for server-side conversion
 *
 * Supports:
 * - .excalidraw files (standard JSON format)
 * - .excalidraw.json files (explicit JSON extension)
 * - .excalidraw.svg files (SVG with embedded JSON data)
 */
export class ExcalidrawService {

    /**
     * Render excalidraw diagram file to SVG
     * @param filePath Absolute path to excalidraw file
     * @returns SVG string
     */
    async renderSVG(filePath: string): Promise<string> {
        try {
            // Read file content
            const content = await fs.promises.readFile(filePath, 'utf8');

            // For .excalidraw.svg files, return the SVG directly!
            // Excalidraw already exported these to SVG, no conversion needed
            if (filePath.endsWith('.excalidraw.svg')) {
                return content;
            }

            // For .excalidraw and .excalidraw.json files, we need to convert
            let excalidrawData: ExcalidrawData;

            try {
                excalidrawData = JSON.parse(content);
            } catch (error) {
                throw new Error('Failed to parse Excalidraw JSON file');
            }

            // Validate excalidraw data structure
            if (!this.validateExcalidrawData(excalidrawData)) {
                throw new Error('Invalid excalidraw data format');
            }

            // Convert to SVG using excalidraw library
            const svg = await this.convertToSVG(excalidrawData);

            return svg;

        } catch (error) {
            console.error(`[ExcalidrawService] Conversion failed for ${filePath}:`, error);
            throw error;
        }
    }

    // Note: For .excalidraw.svg files, the SVG is returned directly (no JSON extraction needed)
    // JSON extraction from embedded SVG comments reserved for future use if needed

    /**
     * Validate excalidraw data structure
     */
    private validateExcalidrawData(data: ExcalidrawData): boolean {
        if (!data || typeof data !== 'object') {
            return false;
        }

        // Check for required fields
        // Excalidraw format has either:
        // 1. {type: "excalidraw", elements: [...], appState: {...}}
        // 2. {elements: [...], appState: {...}} (older format)

        if (data.type === 'excalidraw') {
            return Array.isArray(data.elements);
        }

        // Older format without type field
        return Array.isArray(data.elements);
    }

    /**
     * Convert excalidraw data to SVG using child process with jsdom
     * Uses a separate Node process to avoid jsdom bundling issues
     */
    private async convertToSVG(excalidrawData: ExcalidrawData): Promise<string> {
        const elements = excalidrawData.elements || [];
        const appState = excalidrawData.appState || {};
        const files = excalidrawData.files || {};

        // Resolve browser executable path via BrowserService
        const browserPath = await BrowserService.ensureBrowser();

        // Find the worker script - it's in the same directory as the compiled output
        const workerPath = path.join(__dirname, 'excalidraw-worker.js');

        return new Promise<string>((resolve, reject) => {
            // cwd should be extension root (one level up from dist/)
            const extensionRoot = path.join(__dirname, '..');
            const child = spawn('node', [workerPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: extensionRoot,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0 && stdout) {
                    resolve(stdout);
                } else {
                    let errorMsg = 'Excalidraw conversion failed';
                    try {
                        const parsed = JSON.parse(stderr);
                        errorMsg = parsed.error || errorMsg;
                    } catch {
                        errorMsg = stderr || `Process exited with code ${code}`;
                    }
                    reject(new Error(errorMsg));
                }
            });

            child.on('error', (err) => {
                reject(err);
            });

            // Send the data to the child process (including browser path for Playwright)
            child.stdin.write(JSON.stringify({ elements, appState, files, browserPath }));
            child.stdin.end();
        });
    }

}
