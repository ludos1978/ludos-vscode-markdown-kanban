/**
 * Diagram Commands
 *
 * Handles diagram rendering message operations:
 * - renderPlantUML, convertPlantUMLToSVG
 * - convertMermaidToSVG, mermaidExportSuccess, mermaidExportError
 * - requestDrawIORender, requestExcalidrawRender
 * - requestPDFPageRender, requestPDFInfo
 *
 * @module commands/DiagramCommands
 */

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage } from './interfaces';
import { getMermaidExportService } from '../services/export/MermaidExportService';
import { replaceCodeBlockWithSVG } from '../services/diagram/SvgReplacementService';
import { getErrorMessage } from '../utils/stringUtils';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Diagram Commands Handler
 *
 * Processes diagram rendering messages from the webview.
 */
export class DiagramCommands extends BaseMessageCommand {
    readonly metadata: CommandMetadata = {
        id: 'diagram-commands',
        name: 'Diagram Commands',
        description: 'Handles PlantUML, Mermaid, Draw.io, Excalidraw, and PDF rendering',
        messageTypes: [
            'renderPlantUML',
            'convertPlantUMLToSVG',
            'convertMermaidToSVG',
            'mermaidExportSuccess',
            'mermaidExportError',
            'requestDrawIORender',
            'requestExcalidrawRender',
            'requestPDFPageRender',
            'requestPDFInfo'
        ],
        priority: 100
    };

    async execute(message: IncomingMessage, context: CommandContext): Promise<CommandResult> {
        try {
            switch (message.type) {
                case 'renderPlantUML':
                    await this.handleRenderPlantUML(message, context);
                    return this.success();

                case 'convertPlantUMLToSVG':
                    await this.handleConvertPlantUMLToSVG(message, context);
                    return this.success();

                case 'convertMermaidToSVG':
                    await this.handleConvertMermaidToSVG(message, context);
                    return this.success();

                case 'mermaidExportSuccess':
                    getMermaidExportService().handleRenderSuccess(message.requestId, message.svg);
                    return this.success();

                case 'mermaidExportError':
                    getMermaidExportService().handleRenderError(message.requestId, message.error);
                    return this.success();

                case 'requestDrawIORender':
                    await this.handleRenderDrawIO(message, context);
                    return this.success();

                case 'requestExcalidrawRender':
                    await this.handleRenderExcalidraw(message, context);
                    return this.success();

                case 'requestPDFPageRender':
                    await this.handleRenderPDFPage(message, context);
                    return this.success();

                case 'requestPDFInfo':
                    await this.handleGetPDFInfo(message, context);
                    return this.success();

                default:
                    return this.failure(`Unknown diagram command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`[DiagramCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }

    // ============= PLANTUML HANDLERS =============

    /**
     * Handle PlantUML rendering request from webview
     */
    private async handleRenderPlantUML(message: any, context: CommandContext): Promise<void> {
        const { requestId, code } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderPlantUML] No panel or webview available');
            return;
        }

        try {
            // Render using backend service (Java + PlantUML JAR)
            const svg = await context.plantUMLService.renderSVG(code);

            // Send success response to webview
            panel.webview.postMessage({
                type: 'plantUMLRenderSuccess',
                requestId,
                svg
            });

        } catch (error) {
            console.error('[PlantUML Backend] Render error:', error);

            // Send error response to webview
            panel.webview.postMessage({
                type: 'plantUMLRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    /**
     * Handle PlantUML to SVG conversion
     */
    private async handleConvertPlantUMLToSVG(message: any, context: CommandContext): Promise<void> {
        await this.convertDiagramToSVG(
            message.filePath,
            message.plantUMLCode,
            message.svgContent,
            'plantuml',
            'PlantUML Diagram',
            context
        );
    }

    // ============= MERMAID HANDLERS =============

    /**
     * Handle Mermaid to SVG conversion
     */
    private async handleConvertMermaidToSVG(message: any, context: CommandContext): Promise<void> {
        await this.convertDiagramToSVG(
            message.filePath,
            message.mermaidCode,
            message.svgContent,
            'mermaid',
            'Mermaid Diagram',
            context
        );
    }

    /**
     * Unified diagram to SVG conversion for PlantUML and Mermaid
     * Saves the SVG file and replaces the code block in the source markdown
     */
    private async convertDiagramToSVG(
        filePath: string,
        diagramCode: string,
        svgContent: string,
        diagramType: 'plantuml' | 'mermaid',
        altText: string,
        context: CommandContext
    ): Promise<void> {
        const capitalizedType = diagramType === 'plantuml' ? 'PlantUML' : 'Mermaid';

        try {
            // Get file info
            const fileDir = path.dirname(filePath);
            const fileName = path.basename(filePath, path.extname(filePath));

            // Create Media folder
            const mediaFolder = path.join(fileDir, `Media-${fileName}`);
            await fs.promises.mkdir(mediaFolder, { recursive: true });

            // Generate unique SVG filename
            const timestamp = Date.now();
            const svgFileName = `${diagramType}-${timestamp}.svg`;
            const svgFilePath = path.join(mediaFolder, svgFileName);

            // Save SVG file
            await fs.promises.writeFile(svgFilePath, svgContent, 'utf8');

            // Calculate relative path for markdown
            const relativePath = path.join(`Media-${fileName}`, svgFileName);

            // Read current file content
            const currentContent = await fs.promises.readFile(filePath, 'utf8');

            // Find and replace code block with disabled version + image
            const updatedContent = replaceCodeBlockWithSVG(
                currentContent,
                diagramCode,
                relativePath,
                { blockType: diagramType, altText }
            );

            // Write updated content
            await fs.promises.writeFile(filePath, updatedContent, 'utf8');

            // Notify success
            const panel = context.getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: `${diagramType}ConvertSuccess`,
                    svgPath: relativePath
                });
            }

        } catch (error) {
            console.error(`[${capitalizedType}] Conversion failed:`, error);
            const panel = context.getWebviewPanel();
            if (panel && panel.webview) {
                panel.webview.postMessage({
                    type: `${diagramType}ConvertError`,
                    error: getErrorMessage(error)
                });
            }
        }
    }

    // ============= DRAW.IO HANDLERS =============

    /**
     * Handle draw.io diagram rendering request from webview
     * Uses backend DrawIOService with CLI for conversion
     * Implements file-based caching to avoid re-rendering unchanged diagrams
     */
    private async handleRenderDrawIO(message: any, context: CommandContext): Promise<void> {
        const { requestId, filePath } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderDrawIO] No panel or webview available');
            return;
        }

        try {
            // Resolve file path (handles both document-relative and workspace-relative paths)
            const resolution = await context.fileManager.resolveFilePath(filePath);

            if (!resolution || !resolution.exists) {
                throw new Error(`draw.io file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Determine cache location based on file context
            const cacheDir = this.getDrawIOCacheDir(absolutePath, context);
            const cacheFileName = this.getDrawIOCacheFileName(absolutePath, fileMtime);
            const cachePath = path.join(cacheDir, cacheFileName);

            let pngDataUrl: string;

            // Check if cached version exists and is valid
            if (fs.existsSync(cachePath)) {
                const cachedPng = await fs.promises.readFile(cachePath);
                pngDataUrl = `data:image/png;base64,${cachedPng.toString('base64')}`;
            } else {
                // Import draw.io service
                const { DrawIOService } = await import('../services/export/DrawIOService');
                const service = new DrawIOService();

                // Check if CLI is available
                if (!await service.isAvailable()) {
                    throw new Error('draw.io CLI not installed');
                }

                // Render to PNG (better rendering than SVG in webview)
                const pngBuffer = await service.renderPNG(absolutePath);

                // Ensure cache directory exists
                await fs.promises.mkdir(cacheDir, { recursive: true });

                // Save to cache
                await fs.promises.writeFile(cachePath, pngBuffer);

                // Clean up old cache files for this diagram (different mtimes)
                await this.cleanOldDrawIOCache(cacheDir, absolutePath, cacheFileName);

                // Convert PNG to data URL
                pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            }

            // Send success response to webview with mtime for cache invalidation
            panel.webview.postMessage({
                type: 'drawioRenderSuccess',
                requestId,
                svgDataUrl: pngDataUrl,  // Keep property name for compatibility
                fileMtime
            });

        } catch (error) {
            console.error('[DrawIO Backend] Render error:', error);

            // Send error response to webview
            panel.webview.postMessage({
                type: 'drawioRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    /**
     * Get cache directory for draw.io rendered images
     * Uses {filename}-Media/drawio-cache/ structure
     */
    private getDrawIOCacheDir(diagramPath: string, context: CommandContext): string {
        // Determine which file the diagram belongs to (main kanban or include file)
        const diagramDir = path.dirname(diagramPath);
        // Get kanban path from fileManager
        const kanbanPath = context.fileManager.getFilePath() || context.fileManager.getDocument()?.uri.fsPath;
        if (!kanbanPath) {
            // Fallback: use diagram directory if no kanban path available
            return path.join(diagramDir, 'drawio-cache');
        }
        const kanbanDir = path.dirname(kanbanPath);
        const kanbanBaseName = path.basename(kanbanPath, path.extname(kanbanPath));

        // Check if diagram is in a different directory (likely from an include file)
        if (diagramDir !== kanbanDir) {
            // Find the include file this diagram likely belongs to
            // Use the diagram's directory to create a local cache
            const diagramBaseName = path.basename(diagramDir);
            return path.join(diagramDir, `${diagramBaseName}-Media`, 'drawio-cache');
        }

        // Default: use main kanban's media folder
        return path.join(kanbanDir, `${kanbanBaseName}-Media`, 'drawio-cache');
    }

    /**
     * Generate cache file name based on source file path and mtime
     * Format: {basename}-{hash}-{mtime}.png
     */
    private getDrawIOCacheFileName(sourcePath: string, mtime: number): string {
        const basename = path.basename(sourcePath, path.extname(sourcePath));
        // Create a simple hash from the full path to handle files with same name in different dirs
        const pathHash = Buffer.from(sourcePath).toString('base64').replace(/[/+=]/g, '').substring(0, 8);
        return `${basename}-${pathHash}-${Math.floor(mtime)}.png`;
    }

    /**
     * Clean up old cache files for a diagram (different mtimes = outdated)
     */
    private async cleanOldDrawIOCache(cacheDir: string, sourcePath: string, currentCacheFile: string): Promise<void> {
        try {
            const basename = path.basename(sourcePath, path.extname(sourcePath));
            const pathHash = Buffer.from(sourcePath).toString('base64').replace(/[/+=]/g, '').substring(0, 8);
            const prefix = `${basename}-${pathHash}-`;

            const files = await fs.promises.readdir(cacheDir);
            for (const file of files) {
                if (file.startsWith(prefix) && file !== currentCacheFile && file.endsWith('.png')) {
                    const oldPath = path.join(cacheDir, file);
                    await fs.promises.unlink(oldPath);
                }
            }
        } catch (error) {
            // Ignore cleanup errors
            console.warn('[DrawIO Backend] Cache cleanup warning:', error);
        }
    }

    // ============= EXCALIDRAW HANDLERS =============

    /**
     * Handle excalidraw diagram rendering request from webview
     * Uses backend ExcalidrawService with library for conversion
     */
    private async handleRenderExcalidraw(message: any, context: CommandContext): Promise<void> {
        const { requestId, filePath } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderExcalidraw] No panel or webview available');
            return;
        }

        try {
            // Import excalidraw service
            const { ExcalidrawService } = await import('../services/export/ExcalidrawService');
            const service = new ExcalidrawService();

            // Resolve file path (handles both document-relative and workspace-relative paths)
            const resolution = await context.fileManager.resolveFilePath(filePath);

            if (!resolution || !resolution.exists) {
                throw new Error(`Excalidraw file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Try PNG conversion first (better rendering), fallback to SVG if it fails
            let dataUrl: string;
            try {
                const pngBuffer = await service.renderPNG(absolutePath);
                dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            } catch (pngError) {
                // Fallback to SVG if PNG conversion fails
                const svg = await service.renderSVG(absolutePath);
                dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
            }

            // Send success response to webview with mtime for cache invalidation
            panel.webview.postMessage({
                type: 'excalidrawRenderSuccess',
                requestId,
                svgDataUrl: dataUrl,  // Keep property name for compatibility
                fileMtime
            });

        } catch (error) {
            console.error('[Excalidraw Backend] Render error:', error);

            // Send error response to webview
            panel.webview.postMessage({
                type: 'excalidrawRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    // ============= PDF HANDLERS =============

    /**
     * Handle PDF page rendering request from webview
     * Renders a specific page from a PDF file to PNG
     * Uses backend PDFService with pdftoppm CLI for conversion
     */
    private async handleRenderPDFPage(message: any, context: CommandContext): Promise<void> {
        const { requestId, filePath, pageNumber } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderPDFPage] No panel or webview available');
            return;
        }

        try {
            // Import PDFService dynamically
            const { PDFService } = await import('../services/export/PDFService');
            const service = new PDFService();

            // Resolve file path (handles both workspace-relative and document-relative paths)
            const resolution = await context.fileManager.resolveFilePath(filePath);
            if (!resolution || !resolution.exists) {
                throw new Error(`PDF file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Render PDF page to PNG
            const pngBuffer = await service.renderPage(absolutePath, pageNumber, 150);

            // Convert PNG to data URL
            const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

            // Send success response to webview with mtime for cache invalidation
            panel.webview.postMessage({
                type: 'pdfPageRenderSuccess',
                requestId,
                pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[PDF Backend] Render error:', error);

            // Send error response to webview
            panel.webview.postMessage({
                type: 'pdfPageRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    /**
     * Handle PDF info request (get page count)
     */
    private async handleGetPDFInfo(message: any, context: CommandContext): Promise<void> {
        const { requestId, filePath } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleGetPDFInfo] No panel or webview available');
            return;
        }

        try {
            // Import PDFService dynamically
            const { PDFService } = await import('../services/export/PDFService');
            const service = new PDFService();

            // Resolve file path
            const resolution = await context.fileManager.resolveFilePath(filePath);
            if (!resolution || !resolution.exists) {
                throw new Error(`PDF file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Get page count
            const pageCount = await service.getPageCount(absolutePath);

            // Send success response
            panel.webview.postMessage({
                type: 'pdfInfoSuccess',
                requestId,
                pageCount,
                fileMtime
            });

        } catch (error) {
            console.error('[PDF Info] Error:', error);

            // Send error response
            panel.webview.postMessage({
                type: 'pdfInfoError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }
}
