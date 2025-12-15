import * as fs from 'fs';
import * as path from 'path';
import { DrawIOService } from './DrawIOService';
import { JSDOM } from 'jsdom';

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
}

/**
 * Excalidraw file data structure
 */
interface ExcalidrawData {
    type?: 'excalidraw';
    elements: ExcalidrawElement[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
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

    /**
     * Extract excalidraw JSON data from SVG file
     * Excalidraw embeds JSON in HTML comments within SVG
     */
    private extractJsonFromSvg(svgContent: string): ExcalidrawData {
        // Look for excalidraw JSON in HTML comments
        // Pattern: <!-- payload-start -->{"type":"excalidraw",...}<!-- payload-end -->
        const payloadMatch = svgContent.match(/<!-- payload-start -->(.*?)<!-- payload-end -->/s);

        if (payloadMatch && payloadMatch[1]) {
            try {
                return JSON.parse(payloadMatch[1]);
            } catch (error) {
                throw new Error('Failed to parse embedded JSON from SVG');
            }
        }

        throw new Error('No excalidraw JSON data found in SVG file');
    }

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
     * Convert excalidraw data to SVG using @excalidraw/utils with jsdom
     * This provides full-fidelity rendering including hand-drawn styles, fonts, etc.
     */
    private async convertToSVG(excalidrawData: ExcalidrawData): Promise<string> {
        try {
            const svg = await this.convertWithJsdom(excalidrawData);
            return svg;
        } catch (error) {
            console.warn('[ExcalidrawService] jsdom conversion failed, using fallback:', error);
            return this.createFallbackSVG(excalidrawData);
        }
    }

    /**
     * Convert Excalidraw data to SVG using jsdom + @excalidraw/utils
     * This simulates a browser environment to run Excalidraw's export code
     * Based on the approach from excalidraw-to-svg library
     */
    private async convertWithJsdom(excalidrawData: ExcalidrawData): Promise<string> {
        // Paths to required library files (using UMD build from @excalidraw/utils@0.1.2)
        const canvasPolyfillPath = path.join(__dirname, '../../../node_modules/canvas-5-polyfill/canvas.js');
        const excalidrawUtilsPath = path.join(__dirname, '../../../node_modules/@excalidraw/utils/dist/excalidraw-utils.min.js');

        // Read library files
        const canvasPolyfillCode = await fs.promises.readFile(canvasPolyfillPath, 'utf8');
        const excalidrawUtilsCode = await fs.promises.readFile(excalidrawUtilsPath, 'utf8');

        // Prepare the data for export
        const elements = excalidrawData.elements || [];
        const appState = excalidrawData.appState || {};
        const files = excalidrawData.files || {};

        // Create the export script that will run inside jsdom
        const exportScript = `
            <!DOCTYPE html>
            <html>
            <head>
                <script>
                    // Mock CanvasRenderingContext2D to prevent canvas polyfill errors
                    class CanvasRenderingContext2D {}
                    window.devicePixelRatio = 1;
                </script>
                <script>${canvasPolyfillCode}</script>
                <script>${excalidrawUtilsCode}</script>
                <script>
                    (async function() {
                        try {
                            const elements = ${JSON.stringify(elements)};
                            const appState = ${JSON.stringify({
                                ...appState,
                                exportWithDarkMode: false,
                                exportBackground: true,
                            })};
                            const files = ${JSON.stringify(files)};

                            // Use the excalidraw utils to export to SVG
                            const svg = await ExcalidrawUtils.exportToSvg({
                                elements,
                                appState,
                                files,
                            });

                            // Append to body for retrieval
                            document.body.appendChild(svg);
                        } catch (error) {
                            console.error('Excalidraw export error:', error);
                            const errorDiv = document.createElement('div');
                            errorDiv.id = 'excalidraw-error';
                            errorDiv.textContent = error.message || 'Unknown error';
                            document.body.appendChild(errorDiv);
                        }
                    })();
                </script>
            </head>
            <body></body>
            </html>
        `;

        // Create jsdom instance with the export script
        const dom = new JSDOM(exportScript, {
            runScripts: 'dangerously',
            resources: 'usable',
        });

        // Wait for SVG to be created (polling approach)
        const svgPromise = new Promise<string>(async (resolve, reject) => {
            let checks = 50; // 50 checks * 20ms = 1 second max wait
            const sleepTime = 20;

            while (checks > 0) {
                checks--;

                // Check for error first
                const errorDiv = dom.window.document.body.querySelector('#excalidraw-error');
                if (errorDiv) {
                    reject(new Error(`Excalidraw export failed: ${errorDiv.textContent}`));
                    return;
                }

                // Check for SVG
                const excalidrawSvg = dom.window.document.body.querySelector('svg');
                if (excalidrawSvg) {
                    resolve(excalidrawSvg.outerHTML);
                    return;
                }

                await new Promise(r => setTimeout(r, sleepTime));
            }

            reject(new Error('SVG was not created after expected period'));
        });

        try {
            const svg = await svgPromise;
            return svg;
        } finally {
            dom.window.close();
        }
    }

    /**
     * Create a simplified SVG rendering from Excalidraw JSON
     * Renders basic shapes when the excalidraw library is not available
     */
    private createFallbackSVG(excalidrawData: ExcalidrawData): string {
        const elements = excalidrawData.elements || [];

        if (elements.length === 0) {
            const width = 800;
            const height = 600;
            return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff" stroke="#cccccc" stroke-width="2"/>
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Arial" font-size="18" fill="#666">
    Empty Excalidraw Diagram
  </text>
</svg>`;
        }

        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const el of elements) {
            if (el.x !== undefined && el.y !== undefined && el.width !== undefined && el.height !== undefined) {
                minX = Math.min(minX, el.x);
                minY = Math.min(minY, el.y);
                maxX = Math.max(maxX, el.x + el.width);
                maxY = Math.max(maxY, el.y + el.height);
            }
        }

        // Add padding
        const padding = 20;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const width = maxX - minX;
        const height = maxY - minY;

        // Generate SVG elements
        let svgElements = '';

        for (const el of elements) {
            const x = (el.x || 0) - minX;
            const y = (el.y || 0) - minY;
            const w = el.width || 0;
            const h = el.height || 0;
            const stroke = el.strokeColor || '#000000';
            const fill = el.backgroundColor || 'transparent';
            const strokeWidth = el.strokeWidth || 1;

            switch (el.type) {
                case 'rectangle':
                    svgElements += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />\n`;
                    break;
                case 'ellipse':
                    svgElements += `<ellipse cx="${x + w/2}" cy="${y + h/2}" rx="${w/2}" ry="${h/2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />\n`;
                    break;
                case 'diamond':
                    const cx = x + w/2, cy = y + h/2;
                    svgElements += `<path d="M ${cx} ${y} L ${x+w} ${cy} L ${cx} ${y+h} L ${x} ${cy} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />\n`;
                    break;
                case 'line':
                case 'arrow':
                    if (el.points && el.points.length >= 2) {
                        const points = el.points.map((p: number[]) => `${x + p[0]},${y + p[1]}`).join(' ');
                        svgElements += `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" />\n`;
                        if (el.type === 'arrow' && el.points.length >= 2) {
                            // Add simple arrowhead
                            const lastIdx = el.points.length - 1;
                            const lastPoint = el.points[lastIdx];
                            const prevPoint = el.points[lastIdx - 1];
                            const angle = Math.atan2(lastPoint[1] - prevPoint[1], lastPoint[0] - prevPoint[0]);
                            const arrowSize = 10;
                            const x1 = x + lastPoint[0] - arrowSize * Math.cos(angle - Math.PI / 6);
                            const y1 = y + lastPoint[1] - arrowSize * Math.sin(angle - Math.PI / 6);
                            const x2 = x + lastPoint[0] - arrowSize * Math.cos(angle + Math.PI / 6);
                            const y2 = y + lastPoint[1] - arrowSize * Math.sin(angle + Math.PI / 6);
                            svgElements += `<path d="M ${x1} ${y1} L ${x + lastPoint[0]} ${y + lastPoint[1]} L ${x2} ${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="none" />\n`;
                        }
                    }
                    break;
                case 'text':
                    const text = (el.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    const fontSize = el.fontSize || 20;
                    svgElements += `<text x="${x}" y="${y + fontSize}" font-family="Arial" font-size="${fontSize}" fill="${stroke}">${text}</text>\n`;
                    break;
            }
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
${svgElements}</svg>`;
    }

    /**
     * Render excalidraw diagram file to PNG
     * Converts to SVG first, then uses draw.io CLI to convert SVG→PNG
     * @param filePath Absolute path to excalidraw file
     * @returns PNG data as Buffer
     */
    async renderPNG(filePath: string): Promise<Buffer> {
        try {
            // First render to SVG
            const svg = await this.renderSVG(filePath);

            // Create temp SVG file for draw.io CLI conversion
            const tempDir = path.join(__dirname, '../../../tmp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const tempSvgPath = path.join(tempDir, `excalidraw-${Date.now()}.svg`);

            // Write SVG to temp file
            await fs.promises.writeFile(tempSvgPath, svg, 'utf8');

            try {
                // Use draw.io CLI to convert SVG → PNG
                const drawioService = new DrawIOService();
                const pngBuffer = await drawioService.renderPNG(tempSvgPath);

                // Cleanup temp SVG file
                await fs.promises.unlink(tempSvgPath);

                return pngBuffer;
            } catch (error) {
                // Cleanup temp file on error
                await fs.promises.unlink(tempSvgPath).catch(() => {});
                throw error;
            }
        } catch (error) {
            console.error(`[ExcalidrawService] PNG conversion failed for ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Check if excalidraw conversion is available
     * Returns true if library is properly integrated
     */
    async isAvailable(): Promise<boolean> {
        // Excalidraw is a bundled dependency, so it's always "available"
        // But conversion quality depends on library integration status
        return true;
    }

    /**
     * Get supported file extensions
     */
    getSupportedExtensions(): string[] {
        return ['.excalidraw', '.excalidraw.json', '.excalidraw.svg'];
    }
}
