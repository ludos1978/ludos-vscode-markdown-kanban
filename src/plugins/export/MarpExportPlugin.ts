/**
 * Marp Export Plugin
 *
 * Handles exporting kanban boards to presentation formats using Marp CLI.
 * Supports PDF, PPTX, and HTML output formats.
 *
 * Features:
 * - Export to PDF, PPTX, HTML formats
 * - Watch mode with auto-rebuild
 * - Custom theme support
 * - Custom engine support
 * - PID management for watch processes
 * - Theme discovery from configured and common directories
 *
 * @module plugins/export/MarpExportPlugin
 */

import {
    ExportPlugin,
    ExportPluginMetadata,
    ExportFormat,
    ExportOptions,
    ExportResult
} from '../interfaces';
import { MarpExportService, MarpExportOptions } from '../../services/export/MarpExportService';
import { getErrorMessage } from '../../utils/stringUtils';
import { KanbanBoard } from '../../board/KanbanTypes';

/**
 * Marp Export Plugin
 *
 * Wraps MarpExportService to provide plugin interface.
 * All functionality delegates to the existing static service.
 */
export class MarpExportPlugin implements ExportPlugin {
    readonly metadata: ExportPluginMetadata = {
        id: 'marp',
        name: 'Marp Presentation Export',
        version: '1.0.0',
        formats: [
            {
                id: 'marp-pdf',
                name: 'PDF (Marp)',
                extension: '.pdf',
                mimeType: 'application/pdf',
                description: 'Export as PDF using Marp CLI'
            },
            {
                id: 'marp-pptx',
                name: 'PowerPoint (Marp)',
                extension: '.pptx',
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                description: 'Export as PowerPoint presentation'
            },
            {
                id: 'marp-html',
                name: 'HTML (Marp)',
                extension: '.html',
                mimeType: 'text/html',
                description: 'Export as HTML presentation'
            }
        ],
        requiresExternalTool: true,
        externalToolName: 'Marp CLI (@marp-team/marp-cli)'
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
        // Check if format is supported
        const formatSupported = this.metadata.formats.some(f => f.id === formatId);
        if (!formatSupported) {
            return false;
        }

        // Board must have at least one column
        return board.columns && board.columns.length > 0;
    }

    /**
     * Check if Marp CLI is available
     */
    async isAvailable(): Promise<boolean> {
        return MarpExportService.isMarpCliAvailable();
    }

    /**
     * Export board to specified format
     *
     * Delegates to MarpExportService.export()
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

            // Map format ID to Marp format
            const marpFormat = this._mapFormatId(options.formatId);
            if (!marpFormat) {
                return {
                    success: false,
                    error: `Unsupported format: ${options.formatId}`
                };
            }

            // Build MarpExportOptions
            const marpOptions: MarpExportOptions = {
                inputFilePath: options.inputPath,
                format: marpFormat,
                outputPath: options.outputPath,
                enginePath: options.enginePath,
                theme: options.theme,
                watchMode: options.watchMode,
                pptxEditable: options.pptxEditable,
                additionalArgs: options.additionalArgs
            };

            // Execute export
            await MarpExportService.export(marpOptions);

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

    /**
     * Check if a file is being watched
     */
    isWatching(filePath: string): boolean {
        return MarpExportService.isWatching(filePath);
    }

    /**
     * Get available themes
     */
    async getAvailableThemes(): Promise<string[]> {
        return MarpExportService.getAvailableThemes();
    }

    // ============= PRIVATE HELPERS =============

    /**
     * Map plugin format ID to Marp format
     */
    private _mapFormatId(formatId: string): 'pdf' | 'pptx' | 'html' | null {
        switch (formatId) {
            case 'marp-pdf':
                return 'pdf';
            case 'marp-pptx':
                return 'pptx';
            case 'marp-html':
                return 'html';
            default:
                return null;
        }
    }
}
