/**
 * Pandoc Export Plugin
 *
 * Handles exporting kanban boards to document formats using Pandoc CLI.
 * Supports DOCX, ODT, and EPUB output formats.
 *
 * @module plugins/export/PandocExportPlugin
 */

import {
    ExportPlugin,
    ExportPluginMetadata,
    ExportFormat,
    ExportOptions,
    ExportResult
} from '../interfaces';
import { PandocExportService, PandocExportOptions, PandocOutputFormat } from '../../services/export/PandocExportService';
import { getErrorMessage } from '../../utils/stringUtils';
import { KanbanBoard } from '../../board/KanbanTypes';

/**
 * Pandoc Export Plugin
 *
 * Wraps PandocExportService to provide plugin interface.
 * All functionality delegates to the existing static service.
 */
export class PandocExportPlugin implements ExportPlugin {
    readonly metadata: ExportPluginMetadata = {
        id: 'pandoc',
        name: 'Pandoc Document Export',
        version: '1.0.0',
        formats: [
            {
                id: 'pandoc-docx',
                name: 'Word Document (Pandoc)',
                extension: '.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                description: 'Export as Word document using Pandoc'
            },
            {
                id: 'pandoc-odt',
                name: 'OpenDocument (Pandoc)',
                extension: '.odt',
                mimeType: 'application/vnd.oasis.opendocument.text',
                description: 'Export as OpenDocument text using Pandoc'
            },
            {
                id: 'pandoc-epub',
                name: 'EPUB (Pandoc)',
                extension: '.epub',
                mimeType: 'application/epub+zip',
                description: 'Export as EPUB ebook using Pandoc'
            }
        ],
        requiresExternalTool: true,
        externalToolName: 'Pandoc (pandoc.org)'
    };

    /**
     * Get list of supported export formats
     */
    getSupportedFormats(): ExportFormat[] {
        return this.metadata.formats;
    }

    /**
     * Check if this plugin can export the board to the specified format
     */
    canExport(board: KanbanBoard, formatId: string): boolean {
        const formatSupported = this.metadata.formats.some(f => f.id === formatId);
        if (!formatSupported) {
            return false;
        }

        // Board must have at least one column
        return board.columns && board.columns.length > 0;
    }

    /**
     * Check if Pandoc is available
     */
    async isAvailable(): Promise<boolean> {
        return PandocExportService.isPandocAvailable();
    }

    /**
     * Get Pandoc version string
     */
    async getVersion(): Promise<string | null> {
        return PandocExportService.getPandocVersion();
    }

    /**
     * Export board to specified format
     *
     * Delegates to PandocExportService.export()
     */
    async export(_board: KanbanBoard, options: ExportOptions): Promise<ExportResult> {
        const startTime = Date.now();

        try {
            // Validate availability
            const available = await this.isAvailable();
            if (!available) {
                return {
                    success: false,
                    error: `${this.metadata.externalToolName} is not available. Please ensure it is installed.`
                };
            }

            // Map format ID to Pandoc format
            const pandocFormat = this._mapFormatId(options.formatId);
            if (!pandocFormat) {
                return {
                    success: false,
                    error: `Unsupported format: ${options.formatId}`
                };
            }

            // Build PandocExportOptions
            const pandocOptions: PandocExportOptions = {
                inputFilePath: options.inputPath,
                format: pandocFormat,
                outputPath: options.outputPath,
                additionalArgs: options.additionalArgs
            };

            // Execute export
            await PandocExportService.export(pandocOptions);

            return {
                success: true,
                outputPath: options.outputPath,
                metadata: {
                    duration: Date.now() - startTime
                }
            };
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            return {
                success: false,
                error: `Export failed: ${errorMessage}`,
                metadata: {
                    duration: Date.now() - startTime
                }
            };
        }
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Map plugin format ID to Pandoc format
     */
    private _mapFormatId(formatId: string): PandocOutputFormat | null {
        switch (formatId) {
            case 'pandoc-docx':
                return 'docx';
            case 'pandoc-odt':
                return 'odt';
            case 'pandoc-epub':
                return 'epub';
            default:
                return null;
        }
    }
}
