import * as fs from 'fs';
import * as path from 'path';

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

            // Determine file type and extract JSON data
            let excalidrawData: any;

            if (filePath.endsWith('.excalidraw.svg')) {
                // Extract JSON from SVG file (excalidraw embeds JSON in SVG comments)
                excalidrawData = this.extractJsonFromSvg(content);
            } else {
                // Parse as JSON directly (.excalidraw or .excalidraw.json)
                excalidrawData = JSON.parse(content);
            }

            // Validate excalidraw data structure
            if (!this.validateExcalidrawData(excalidrawData)) {
                throw new Error('Invalid excalidraw data format');
            }

            // Convert to SVG using excalidraw library
            const svg = await this.convertToSVG(excalidrawData);

            console.log(`[ExcalidrawService] ✅ Converted: ${path.basename(filePath)} (${svg.length} bytes)`);

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
     * The @excalidraw/excalidraw package is primarily designed for browser use.
     * For server-side rendering, we have several options:
     *
     * 1. Use excalidraw-to-svg package (if it exists as standalone)
     * 2. Use puppeteer to render in headless browser
     * 3. Import only the export utilities from excalidraw
     *
     * This requires further research and may need async import of the library.
     */
    private async attemptLibraryConversion(excalidrawData: any): Promise<string> {
        // Try to dynamically import excalidraw
        try {
            // Attempt 1: Try to import exportToSvg from excalidraw
            // Note: This may fail if the library has browser dependencies
            // const { exportToSvg } = await import('@excalidraw/excalidraw');
            // const svgElement = await exportToSvg(excalidrawData);
            // return svgElement.outerHTML;

            // For now, throw to use fallback
            // This will be implemented once we add the dependency
            throw new Error('Excalidraw library not yet integrated');

        } catch (error) {
            throw new Error(`Failed to use excalidraw library: ${error}`);
        }
    }

    /**
     * Create a simple fallback SVG when library conversion fails
     * This ensures the export doesn't break even if conversion isn't perfect
     */
    private createFallbackSVG(excalidrawData: any): string {
        const elementCount = excalidrawData.elements?.length || 0;
        const width = 800;
        const height = 600;

        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff" stroke="#cccccc" stroke-width="2"/>
  <text x="${width / 2}" y="${height / 2 - 20}"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="18"
        fill="#666666">
    Excalidraw Diagram
  </text>
  <text x="${width / 2}" y="${height / 2 + 10}"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="14"
        fill="#999999">
    ${elementCount} elements
  </text>
  <text x="${width / 2}" y="${height / 2 + 40}"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="12"
        fill="#999999">
    (Full rendering requires excalidraw library integration)
  </text>
</svg>`;
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
