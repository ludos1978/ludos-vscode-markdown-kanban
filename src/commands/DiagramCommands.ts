/**
 * Diagram Commands
 *
 * Handles diagram rendering message operations:
 * - renderPlantUML, convertPlantUMLToSVG
 * - convertMermaidToSVG, mermaidExportSuccess, mermaidExportError
 * - requestDrawIORender, requestExcalidrawRender
 * - requestPDFPageRender, requestPDFInfo
 * - requestEPUBPageRender, requestEPUBInfo
 *
 * @module commands/DiagramCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage, MessageHandler } from './interfaces';
import {
    RenderPlantUMLMessage,
    ConvertPlantUMLToSVGMessage,
    ConvertMermaidToSVGMessage,
    RequestDrawIORenderMessage,
    RequestExcalidrawRenderMessage,
    RequestPDFPageRenderMessage,
    RequestPDFInfoMessage,
    RequestEPUBPageRenderMessage,
    RequestEPUBInfoMessage,
    RequestXlsxRenderMessage
} from '../core/bridge/MessageTypes';
import { replaceCodeBlockWithSVG } from '../services/diagram/SvgReplacementService';
import { getErrorMessage } from '../utils/stringUtils';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Diagram Commands Handler
 *
 * Processes diagram rendering messages from the webview.
 * Uses SwitchBasedCommand for automatic dispatch and error handling.
 */
export class DiagramCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'diagram-commands',
        name: 'Diagram Commands',
        description: 'Handles PlantUML, Mermaid, Draw.io, Excalidraw, PDF, EPUB, and Excel rendering',
        messageTypes: [
            'renderPlantUML',
            'convertPlantUMLToSVG',
            'convertMermaidToSVG',
            'mermaidExportSuccess',
            'mermaidExportError',
            'requestDrawIORender',
            'requestExcalidrawRender',
            'requestPDFPageRender',
            'requestPDFInfo',
            'requestEPUBPageRender',
            'requestEPUBInfo',
            'requestXlsxRender'
        ],
        priority: 100
    };

    /**
     * Handler mapping for message dispatch
     */
    protected handlers: Record<string, MessageHandler> = {
        'renderPlantUML': async (msg, ctx) => {
            await this.handleRenderPlantUML(msg as RenderPlantUMLMessage, ctx);
            return this.success();
        },
        'convertPlantUMLToSVG': async (msg, ctx) => {
            await this.handleConvertPlantUMLToSVG(msg as ConvertPlantUMLToSVGMessage, ctx);
            return this.success();
        },
        'convertMermaidToSVG': async (msg, ctx) => {
            await this.handleConvertMermaidToSVG(msg as ConvertMermaidToSVGMessage, ctx);
            return this.success();
        },
        'mermaidExportSuccess': (msg, ctx) => {
            const m = msg as { requestId: string; svg: string };
            ctx.getMermaidExportService().handleRenderSuccess(m.requestId, m.svg);
            return Promise.resolve(this.success());
        },
        'mermaidExportError': (msg, ctx) => {
            const m = msg as { requestId: string; error: string };
            ctx.getMermaidExportService().handleRenderError(m.requestId, m.error);
            return Promise.resolve(this.success());
        },
        'requestDrawIORender': async (msg, ctx) => {
            await this.handleRenderDrawIO(msg as RequestDrawIORenderMessage, ctx);
            return this.success();
        },
        'requestExcalidrawRender': async (msg, ctx) => {
            await this.handleRenderExcalidraw(msg as RequestExcalidrawRenderMessage, ctx);
            return this.success();
        },
        'requestPDFPageRender': async (msg, ctx) => {
            await this.handleRenderPDFPage(msg as RequestPDFPageRenderMessage, ctx);
            return this.success();
        },
        'requestPDFInfo': async (msg, ctx) => {
            await this.handleGetPDFInfo(msg as RequestPDFInfoMessage, ctx);
            return this.success();
        },
        'requestEPUBPageRender': async (msg, ctx) => {
            await this.handleRenderEPUBPage(msg as RequestEPUBPageRenderMessage, ctx);
            return this.success();
        },
        'requestEPUBInfo': async (msg, ctx) => {
            await this.handleGetEPUBInfo(msg as RequestEPUBInfoMessage, ctx);
            return this.success();
        },
        'requestXlsxRender': async (msg, ctx) => {
            await this.handleRenderXlsx(msg as RequestXlsxRenderMessage, ctx);
            return this.success();
        }
    };

    // ============= PLANTUML HANDLERS =============

    /**
     * Handle PlantUML rendering request from webview
     */
    private async handleRenderPlantUML(message: RenderPlantUMLMessage, context: CommandContext): Promise<void> {
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
            this.postMessage({
                type: 'plantUMLRenderSuccess',
                requestId,
                svg
            });

        } catch (error) {
            console.error('[PlantUML Backend] Render error:', error);

            // Send error response to webview
            this.postMessage({
                type: 'plantUMLRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    /**
     * Handle PlantUML to SVG conversion
     */
    private async handleConvertPlantUMLToSVG(message: ConvertPlantUMLToSVGMessage, context: CommandContext): Promise<void> {
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
    private async handleConvertMermaidToSVG(message: ConvertMermaidToSVGMessage, context: CommandContext): Promise<void> {
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
                this.postMessage({
                    type: `${diagramType}ConvertSuccess`,
                    svgPath: relativePath
                });
            }

        } catch (error) {
            console.error(`[${capitalizedType}] Conversion failed:`, error);
            const panel = context.getWebviewPanel();
            if (panel && panel.webview) {
                this.postMessage({
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
    private async handleRenderDrawIO(message: RequestDrawIORenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderDrawIO] No panel or webview available');
            return;
        }

        try {
            // Build include context if provided (for diagrams inside include files)
            const includeContext = includeDir ? { includeDir } : undefined;

            // Resolve file path (handles both document-relative and workspace-relative paths)
            const resolution = await context.fileManager.resolveFilePath(filePath, includeContext);

            if (!resolution || !resolution.exists) {
                throw new Error(`draw.io file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Ensure this file is being watched for changes (fixes first-change detection)
            const mediaTracker = context.getMediaTracker?.();
            if (mediaTracker) {
                mediaTracker.ensureFileWatched(filePath, absolutePath, 'diagram', fileMtime);
            }

            // Check if the DrawIO file is empty (only has default root cells)
            const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
            const isEmptyDiagram = this.isEmptyDrawIOFile(fileContent);

            if (isEmptyDiagram) {
                // Return a placeholder SVG for empty diagrams
                const placeholderSvg = this.createEmptyDrawIOPlaceholder();
                const pngDataUrl = `data:image/svg+xml;base64,${Buffer.from(placeholderSvg).toString('base64')}`;

                this.postMessage({
                    type: 'drawioRenderSuccess',
                    requestId,
                    svgDataUrl: pngDataUrl,
                    fileMtime
                });
                return;
            }

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
            this.postMessage({
                type: 'drawioRenderSuccess',
                requestId,
                svgDataUrl: pngDataUrl,  // Keep property name for compatibility
                fileMtime
            });

        } catch (error) {
            console.error('[DrawIO Backend] Render error:', error);

            // Send error response to webview
            this.postMessage({
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

    /**
     * Check if a DrawIO file is empty (only contains default root cells)
     * Empty DrawIO files have mxCell elements with id="0" and id="1" only
     */
    private isEmptyDrawIOFile(content: string): boolean {
        try {
            // Count mxCell elements - empty diagrams only have 2 (id=0 and id=1)
            const mxCellMatches = content.match(/<mxCell\s+id="[^"]*"/g);
            if (!mxCellMatches) {
                return true; // No cells at all = empty
            }
            // Default cells are id="0" (root) and id="1" (default layer)
            // Any additional cells mean the diagram has content
            return mxCellMatches.length <= 2;
        } catch {
            return false; // If we can't parse, assume not empty
        }
    }

    /**
     * Create a placeholder SVG for empty DrawIO diagrams
     */
    private createEmptyDrawIOPlaceholder(): string {
        const width = 400;
        const height = 300;
        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8f9fa" stroke="#dee2e6" stroke-width="2" rx="8"/>
  <text x="${width / 2}" y="${height / 2 - 10}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#6c757d">Empty Draw.io Diagram</text>
  <text x="${width / 2}" y="${height / 2 + 15}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#adb5bd">Click to edit</text>
</svg>`;
    }

    /**
     * Check if an Excalidraw file is empty (no elements or only deleted elements)
     */
    private isEmptyExcalidrawFile(content: string, filePath: string): boolean {
        try {
            // For .excalidraw.svg files, check if the SVG has meaningful content
            if (filePath.endsWith('.excalidraw.svg')) {
                // Check for actual drawing elements in the SVG
                // Empty excalidraw SVGs typically only have basic structure
                const hasDrawingContent = content.includes('<path') ||
                    content.includes('<rect') ||
                    content.includes('<circle') ||
                    content.includes('<ellipse') ||
                    content.includes('<text');
                return !hasDrawingContent;
            }

            // For JSON files (.excalidraw, .excalidraw.json)
            const data = JSON.parse(content);
            if (!data.elements || !Array.isArray(data.elements)) {
                return true;
            }
            // Filter out deleted elements
            const activeElements = data.elements.filter((el: { isDeleted?: boolean }) => !el.isDeleted);
            return activeElements.length === 0;
        } catch {
            return false; // If we can't parse, assume not empty
        }
    }

    /**
     * Create a placeholder SVG for empty Excalidraw diagrams
     */
    private createEmptyExcalidrawPlaceholder(): string {
        const width = 400;
        const height = 300;
        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fef9f0" stroke="#e8d5b5" stroke-width="2" rx="8"/>
  <text x="${width / 2}" y="${height / 2 - 10}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#8b7355">Empty Excalidraw</text>
  <text x="${width / 2}" y="${height / 2 + 15}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#b09070">Click to edit</text>
</svg>`;
    }

    // ============= EXCALIDRAW HANDLERS =============

    /**
     * Handle excalidraw diagram rendering request from webview
     * Uses backend ExcalidrawService with library for conversion
     */
    private async handleRenderExcalidraw(message: RequestExcalidrawRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderExcalidraw] No panel or webview available');
            return;
        }

        try {
            // Import excalidraw service
            const { ExcalidrawService } = await import('../services/export/ExcalidrawService');
            const service = new ExcalidrawService();

            // Build include context if provided (for diagrams inside include files)
            const includeContext = includeDir ? { includeDir } : undefined;

            // Resolve file path (handles both document-relative and workspace-relative paths)
            const resolution = await context.fileManager.resolveFilePath(filePath, includeContext);

            if (!resolution || !resolution.exists) {
                throw new Error(`Excalidraw file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;

            // Get file modification time for cache invalidation
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            // Ensure this file is being watched for changes (fixes first-change detection)
            const mediaTracker = context.getMediaTracker?.();
            if (mediaTracker) {
                mediaTracker.ensureFileWatched(filePath, absolutePath, 'diagram', fileMtime);
            }

            // Check if the Excalidraw file is empty
            const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
            const isEmptyDiagram = this.isEmptyExcalidrawFile(fileContent, absolutePath);

            if (isEmptyDiagram) {
                // Return a placeholder SVG for empty diagrams
                const placeholderSvg = this.createEmptyExcalidrawPlaceholder();
                const dataUrl = `data:image/svg+xml;base64,${Buffer.from(placeholderSvg).toString('base64')}`;

                this.postMessage({
                    type: 'excalidrawRenderSuccess',
                    requestId,
                    svgDataUrl: dataUrl,
                    fileMtime
                });
                return;
            }

            // Render as SVG
            const svg = await service.renderSVG(absolutePath);
            const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

            // Send success response to webview with mtime for cache invalidation
            this.postMessage({
                type: 'excalidrawRenderSuccess',
                requestId,
                svgDataUrl: dataUrl,  // Keep property name for compatibility
                fileMtime
            });

        } catch (error) {
            console.error('[Excalidraw Backend] Render error:', error);

            // Send error response to webview
            this.postMessage({
                type: 'excalidrawRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    // ============= DOCUMENT FILE HELPERS =============

    /**
     * Resolve a document file path and get its modification time.
     * Common helper for PDF and EPUB handlers.
     * @throws Error if file not found
     */
    private async resolveDocumentFile(
        filePath: string,
        includeDir: string | undefined,
        context: CommandContext,
        fileType: string
    ): Promise<{ absolutePath: string; fileMtime: number }> {
        const includeContext = includeDir ? { includeDir } : undefined;
        const resolution = await context.fileManager.resolveFilePath(filePath, includeContext);
        if (!resolution || !resolution.exists) {
            throw new Error(`${fileType} file not found: ${filePath}`);
        }
        const absolutePath = resolution.resolvedPath;
        const stats = await fs.promises.stat(absolutePath);
        return { absolutePath, fileMtime: stats.mtimeMs };
    }

    // ============= PDF HANDLERS =============

    /**
     * Handle PDF page rendering request from webview
     * Renders a specific page from a PDF file to PNG
     * Uses backend PDFService with pdftoppm CLI for conversion
     */
    private async handleRenderPDFPage(message: RequestPDFPageRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, pageNumber, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderPDFPage] No panel or webview available');
            return;
        }

        try {
            const { PDFService } = await import('../services/export/PDFService');
            const service = new PDFService();
            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'PDF');

            // Render PDF page to PNG
            const pngBuffer = await service.renderPage(absolutePath, pageNumber, 150);

            // Convert PNG to data URL
            const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

            // Send success response to webview with mtime for cache invalidation
            this.postMessage({
                type: 'pdfPageRenderSuccess',
                requestId,
                pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[PDF Backend] Render error:', error);

            // Send error response to webview
            this.postMessage({
                type: 'pdfPageRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    /**
     * Handle PDF info request (get page count)
     */
    private async handleGetPDFInfo(message: RequestPDFInfoMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleGetPDFInfo] No panel or webview available');
            return;
        }

        try {
            const { PDFService } = await import('../services/export/PDFService');
            const service = new PDFService();
            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'PDF');

            // Get page count
            const pageCount = await service.getPageCount(absolutePath);

            // Send success response
            this.postMessage({
                type: 'pdfInfoSuccess',
                requestId,
                pageCount,
                fileMtime
            });

        } catch (error) {
            console.error('[PDF Info] Error:', error);

            // Send error response
            this.postMessage({
                type: 'pdfInfoError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    // ============= EPUB HANDLERS =============

    /**
     * Handle EPUB page rendering request from webview
     * Renders a specific page from an EPUB file to PNG
     * Uses backend EPUBService with mutool CLI for conversion
     */
    private async handleRenderEPUBPage(message: RequestEPUBPageRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, pageNumber, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderEPUBPage] No panel or webview available');
            return;
        }

        try {
            const { EPUBService } = await import('../services/export/EPUBService');
            const service = new EPUBService();
            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'EPUB');

            // Render EPUB page to PNG
            const pngBuffer = await service.renderPage(absolutePath, pageNumber, 150);

            // Convert PNG to data URL
            const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

            // Send success response to webview with mtime for cache invalidation
            this.postMessage({
                type: 'epubPageRenderSuccess',
                requestId,
                pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[EPUB Backend] Render error:', error);

            // Send error response to webview
            this.postMessage({
                type: 'epubPageRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    /**
     * Handle EPUB info request (get page count)
     */
    private async handleGetEPUBInfo(message: RequestEPUBInfoMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleGetEPUBInfo] No panel or webview available');
            return;
        }

        try {
            const { EPUBService } = await import('../services/export/EPUBService');
            const service = new EPUBService();
            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'EPUB');

            // Get page count
            const pageCount = await service.getPageCount(absolutePath);

            // Send success response
            this.postMessage({
                type: 'epubInfoSuccess',
                requestId,
                pageCount,
                fileMtime
            });

        } catch (error) {
            console.error('[EPUB Info] Error:', error);

            // Send error response
            this.postMessage({
                type: 'epubInfoError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    // ============= XLSX HANDLERS =============

    /**
     * Handle Excel spreadsheet rendering request from webview
     * Renders a specific sheet to PNG using LibreOffice
     */
    private async handleRenderXlsx(message: RequestXlsxRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, sheetNumber, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderXlsx] No panel or webview available');
            return;
        }

        try {
            const { XlsxService } = await import('../services/export/XlsxService');
            const service = new XlsxService();
            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'Excel');

            // Check if LibreOffice CLI is available
            if (!await service.isAvailable()) {
                throw new Error('LibreOffice CLI not installed');
            }

            // Render Excel sheet to PNG
            const pngBuffer = await service.renderPNG(absolutePath, sheetNumber);

            // Convert PNG to data URL
            const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

            // Send success response to webview with mtime for cache invalidation
            this.postMessage({
                type: 'xlsxRenderSuccess',
                requestId,
                pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[XLSX Backend] Render error:', error);

            // Send error response to webview
            this.postMessage({
                type: 'xlsxRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }
}
