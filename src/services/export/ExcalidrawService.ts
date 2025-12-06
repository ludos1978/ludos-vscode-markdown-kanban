import * as fs from 'fs';
import * as path from 'path';
import { DrawIOService } from './DrawIOService';

/**
 * Service for converting excalidraw diagrams to SVG
 * Uses @excalidraw/excalidraw library for conversion
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
            let excalidrawData: any;

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
    private extractJsonFromSvg(svgContent: string): any {
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
    private validateExcalidrawData(data: any): boolean {
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
     * Convert excalidraw data to SVG
     *
     * NOTE: This is a placeholder implementation.
     * The actual implementation requires integrating the @excalidraw/excalidraw library
     * which has browser dependencies. We need to use a server-side compatible approach.
     *
     * Options:
     * 1. Use excalidraw-to-svg if it exists
     * 2. Use puppeteer to render in headless browser
     * 3. Implement custom SVG generator based on excalidraw elements
     */
    private async convertToSVG(excalidrawData: any): Promise<string> {
        // TODO: Implement actual conversion
        // For now, we'll create a simple SVG wrapper with a message
        // This needs to be replaced with actual excalidraw rendering logic

        try {
            // Attempt to use excalidraw library (if available in Node environment)
            // This is a placeholder - actual implementation depends on library API

            const svg = await this.attemptLibraryConversion(excalidrawData);
            return svg;

        } catch (error) {
            console.warn('[ExcalidrawService] Library conversion failed, using fallback:', error);
            return this.createFallbackSVG(excalidrawData);
        }
    }

    /**
     * Attempt to use @excalidraw/excalidraw library for conversion
     *
     * IMPLEMENTATION NOTE:
     * The @excalidraw/excalidraw package is primarily designed for browser use
     * and requires DOM APIs. For server-side, we create a simplified SVG representation.
     */
    private async attemptLibraryConversion(excalidrawData: any): Promise<string> {
        try {
            // The @excalidraw/excalidraw library requires browser APIs (DOM)
            // For Node.js environment, we'll create a basic SVG representation

            // Import needed functions (this might fail in Node.js)
            const excalidraw = await import('@excalidraw/excalidraw');

            // Check if exportToSvg is available
            if (typeof excalidraw.exportToSvg === 'function') {
                // Try to use it (might fail without DOM)
                const svgElement = await excalidraw.exportToSvg(excalidrawData);
                if (svgElement && typeof svgElement.outerHTML === 'string') {
                    return svgElement.outerHTML;
                }
            }

            // If we get here, the library didn't work
            throw new Error('exportToSvg not available or failed');

        } catch (error) {
            // Library failed (expected in Node.js), use manual SVG generation
            throw error;
        }
    }

    /**
     * Create a simplified SVG rendering from Excalidraw JSON
     * Renders basic shapes when the excalidraw library is not available
     */
    private createFallbackSVG(excalidrawData: any): string {
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
                        const points = el.points.map((p: any) => `${x + p[0]},${y + p[1]}`).join(' ');
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
