/**
 * Excalidraw Diagram Plugin
 *
 * Renders .excalidraw/.excalidraw.json/.excalidraw.svg files to SVG.
 * Migrated from src/services/export/ExcalidrawService.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { BrowserService } from '../../services/BrowserService';
import {
    DiagramPlugin,
    DiagramPluginMetadata,
    DiagramRenderOptions,
    DiagramRenderResult
} from '../interfaces/DiagramPlugin';

interface ExcalidrawElement {
    type: string;
    isDeleted?: boolean;
    [key: string]: unknown;
}

interface ExcalidrawFile {
    mimeType: string;
    dataURL: string;
}

interface ExcalidrawData {
    type?: 'excalidraw';
    elements: ExcalidrawElement[];
    appState?: Record<string, unknown>;
    files?: Record<string, ExcalidrawFile>;
}

export class ExcalidrawPlugin implements DiagramPlugin {
    readonly metadata: DiagramPluginMetadata = {
        id: 'excalidraw',
        name: 'Excalidraw Diagram Renderer',
        version: '1.0.0',
        supportedCodeBlocks: [],
        supportedFileExtensions: ['.excalidraw', '.excalidraw.json', '.excalidraw.svg'],
        renderOutput: 'svg',
        requiresExternalTool: false
    };

    canRenderCodeBlock(_language: string): boolean {
        return false;
    }

    canRenderFile(filePath: string): boolean {
        const lower = filePath.toLowerCase();
        return this.metadata.supportedFileExtensions.some(ext => lower.endsWith(ext));
    }

    async isAvailable(): Promise<boolean> {
        return true;
    }

    async renderFile(filePath: string, _options?: DiagramRenderOptions): Promise<DiagramRenderResult> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');

            // For .excalidraw.svg files, return the SVG directly
            if (filePath.endsWith('.excalidraw.svg')) {
                return { success: true, data: content, format: 'svg' };
            }

            // For .excalidraw and .excalidraw.json files, convert
            let excalidrawData: ExcalidrawData;
            try {
                excalidrawData = JSON.parse(content);
            } catch {
                return { success: false, data: '', format: 'svg', error: 'Failed to parse Excalidraw JSON file' };
            }

            if (!this._validateExcalidrawData(excalidrawData)) {
                return { success: false, data: '', format: 'svg', error: 'Invalid excalidraw data format' };
            }

            const svg = await this._convertToSVG(excalidrawData);
            return { success: true, data: svg, format: 'svg' };

        } catch (error) {
            return {
                success: false,
                data: '',
                format: 'svg',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private _validateExcalidrawData(data: ExcalidrawData): boolean {
        if (!data || typeof data !== 'object') {
            return false;
        }
        return Array.isArray(data.elements);
    }

    private async _convertToSVG(excalidrawData: ExcalidrawData): Promise<string> {
        const elements = excalidrawData.elements || [];
        const appState = excalidrawData.appState || {};
        const files = excalidrawData.files || {};

        const browserPath = await BrowserService.ensureBrowser();
        const workerPath = path.join(__dirname, '../../excalidraw-worker.js');

        return new Promise<string>((resolve, reject) => {
            const extensionRoot = path.join(__dirname, '../..');
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

            child.stdin.write(JSON.stringify({ elements, appState, files, browserPath }));
            child.stdin.end();
        });
    }
}
