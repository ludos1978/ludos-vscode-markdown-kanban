import AdmZip from 'adm-zip';
import { AbstractCLIService } from './AbstractCLIService';

/**
 * Service for rendering individual EPUB pages to images
 * Uses mutool (MuPDF) CLI tool for conversion
 *
 * Supports:
 * - Rendering specific pages from EPUB files
 * - PNG output with configurable DPI
 */
export class EPUBService extends AbstractCLIService {
    protected getConfigKey(): string {
        return 'mutoolPath';
    }

    protected getDefaultCliName(): string {
        return 'mutool';
    }

    protected getServiceName(): string {
        return 'EPUBService';
    }

    protected getCliNotFoundWarning(): string {
        return 'mutool CLI is not installed. EPUB page rendering will not work.';
    }

    protected getInstallationUrl(): string {
        return 'https://mupdf.com/docs/manual-mutool-draw.html';
    }

    /**
     * Render a specific page from an EPUB file to PNG
     * @param filePath Absolute path to .epub file
     * @param pageNumber Page number to render (1-indexed)
     * @param dpi Resolution in DPI (default: 150)
     * @returns PNG data as Buffer
     */
    async renderPage(filePath: string, pageNumber: number = 1, dpi: number = 150): Promise<Buffer> {
        const tempOutput = this.getTempFilePath(`epub-${pageNumber}`, 'png');

        // mutool draw -r DPI -o output.png input.epub PAGE
        const args = [
            'draw',
            '-r', dpi.toString(),
            '-o', tempOutput,
            filePath,
            pageNumber.toString()
        ];

        const result = await this.executeAndReadOutput(args, tempOutput, { binary: true });
        return result as Buffer;
    }

    /**
     * Get the total page count from an EPUB file
     * Parses the EPUB structure directly (EPUB is a ZIP with XML metadata)
     * @param filePath Absolute path to .epub file
     * @returns Total number of pages (spine items)
     */
    async getPageCount(filePath: string): Promise<number> {
        try {
            // EPUB files are ZIP archives
            const zip = new AdmZip(filePath);

            // Step 1: Read META-INF/container.xml to find the OPF file
            const containerEntry = zip.getEntry('META-INF/container.xml');
            if (!containerEntry) {
                throw new Error('Invalid EPUB: Missing META-INF/container.xml');
            }

            const containerXml = containerEntry.getData().toString('utf8');

            // Parse container.xml to find OPF path
            const rootfileMatch = containerXml.match(/rootfile[^>]+full-path=["']([^"']+)["']/i);
            if (!rootfileMatch) {
                throw new Error('Invalid EPUB: Cannot find rootfile in container.xml');
            }

            const opfPath = rootfileMatch[1];
            console.log('[EPUBService] Found OPF at:', opfPath);

            // Step 2: Read the OPF file
            const opfEntry = zip.getEntry(opfPath);
            if (!opfEntry) {
                throw new Error(`Invalid EPUB: Cannot find OPF file at ${opfPath}`);
            }

            const opfContent = opfEntry.getData().toString('utf8');

            // Step 3: Count spine items
            const spineMatch = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
            if (!spineMatch) {
                throw new Error('Invalid EPUB: Cannot find spine in OPF');
            }

            const spineContent = spineMatch[1];
            const itemrefMatches = spineContent.match(/<itemref[^>]*>/gi);
            const pageCount = itemrefMatches ? itemrefMatches.length : 0;

            if (pageCount === 0) {
                throw new Error('Invalid EPUB: No spine items found');
            }

            console.log('[EPUBService] EPUB page count:', pageCount);
            return pageCount;
        } catch (error) {
            console.error('[EPUBService] Failed to get page count:', error);
            throw error;
        }
    }

    /**
     * Get supported file extensions
     */
    getSupportedExtensions(): string[] {
        return ['.epub'];
    }
}
