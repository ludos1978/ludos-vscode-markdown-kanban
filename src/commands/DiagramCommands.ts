/**
 * Diagram Commands
 *
 * Handles diagram rendering message operations:
 * - renderPlantUML, convertPlantUMLToSVG
 * - convertMermaidToSVG, mermaidExportSuccess, mermaidExportError
 * - requestDrawIORender, requestExcalidrawRender
 * - requestPDFPageRender, requestPDFInfo
 * - requestEPUBPageRender, requestEPUBInfo
 * - requestXlsxRender
 *
 * Uses PluginRegistry to discover and invoke diagram plugins.
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
import { PluginRegistry } from '../plugins/registry/PluginRegistry';
import { MermaidPlugin } from '../plugins/diagram/MermaidPlugin';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Diagram Commands Handler
 *
 * Processes diagram rendering messages from the webview.
 * Delegates rendering to diagram plugins via PluginRegistry.
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
        'mermaidExportSuccess': (msg) => {
            const m = msg as { requestId: string; svg: string };
            const mermaidPlugin = this._getMermaidPlugin();
            if (mermaidPlugin) {
                mermaidPlugin.handleRenderSuccess(m.requestId, m.svg);
            }
            return Promise.resolve(this.success());
        },
        'mermaidExportError': (msg) => {
            const m = msg as { requestId: string; error: string };
            const mermaidPlugin = this._getMermaidPlugin();
            if (mermaidPlugin) {
                mermaidPlugin.handleRenderError(m.requestId, m.error);
            }
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

    // ============= PLUGIN ACCESS =============

    private _getRegistry(): PluginRegistry {
        return PluginRegistry.getInstance();
    }

    private _getMermaidPlugin(): MermaidPlugin | null {
        const plugin = this._getRegistry().findDiagramPluginById('mermaid');
        return plugin as MermaidPlugin | null;
    }

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
            const plugin = this._getRegistry().findDiagramPluginForCodeBlock('plantuml');
            if (!plugin || !plugin.renderCodeBlock) {
                throw new Error('PlantUML plugin not available');
            }

            const result = await plugin.renderCodeBlock(code);
            if (!result.success) {
                throw new Error(result.error || 'PlantUML rendering failed');
            }

            this.postMessage({
                type: 'plantUMLRenderSuccess',
                requestId,
                svg: result.data
            });

        } catch (error) {
            console.error('[PlantUML Backend] Render error:', error);

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
            const fileDir = path.dirname(filePath);
            const fileName = path.basename(filePath, path.extname(filePath));

            const mediaFolder = path.join(fileDir, `Media-${fileName}`);
            await fs.promises.mkdir(mediaFolder, { recursive: true });

            const timestamp = Date.now();
            const svgFileName = `${diagramType}-${timestamp}.svg`;
            const svgFilePath = path.join(mediaFolder, svgFileName);

            await fs.promises.writeFile(svgFilePath, svgContent, 'utf8');

            const relativePath = path.join(`Media-${fileName}`, svgFileName);

            const currentContent = await fs.promises.readFile(filePath, 'utf8');

            const updatedContent = replaceCodeBlockWithSVG(
                currentContent,
                diagramCode,
                relativePath,
                { blockType: diagramType, altText }
            );

            await fs.promises.writeFile(filePath, updatedContent, 'utf8');

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
     * Uses DrawIO diagram plugin via PluginRegistry
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
            const includeContext = includeDir ? { includeDir } : undefined;
            const resolution = await context.fileManager.resolveFilePath(filePath, includeContext);

            if (!resolution || !resolution.exists) {
                throw new Error(`draw.io file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            const mediaTracker = context.getMediaTracker?.();
            if (mediaTracker) {
                mediaTracker.ensureFileWatched(filePath, absolutePath, 'diagram', fileMtime);
            }

            const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
            const isEmptyDiagram = this.isEmptyDrawIOFile(fileContent);

            if (isEmptyDiagram) {
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

            const cacheDir = this.getDrawIOCacheDir(absolutePath, context);
            const cacheFileName = this.getDrawIOCacheFileName(absolutePath, fileMtime);
            const cachePath = path.join(cacheDir, cacheFileName);

            let pngDataUrl: string;

            if (fs.existsSync(cachePath)) {
                const cachedPng = await fs.promises.readFile(cachePath);
                pngDataUrl = `data:image/png;base64,${cachedPng.toString('base64')}`;
            } else {
                const plugin = this._getRegistry().findDiagramPluginById('drawio');
                if (!plugin || !plugin.renderFile) {
                    throw new Error('Draw.io plugin not available');
                }

                if (!await plugin.isAvailable()) {
                    throw new Error('draw.io CLI not installed');
                }

                const result = await plugin.renderFile(absolutePath, { outputFormat: 'png' });
                if (!result.success) {
                    throw new Error(result.error || 'Draw.io rendering failed');
                }

                const pngBuffer = result.data as Buffer;

                await fs.promises.mkdir(cacheDir, { recursive: true });
                await fs.promises.writeFile(cachePath, pngBuffer);
                await this.cleanOldDrawIOCache(cacheDir, absolutePath, cacheFileName);

                pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            }

            this.postMessage({
                type: 'drawioRenderSuccess',
                requestId,
                svgDataUrl: pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[DrawIO Backend] Render error:', error);

            this.postMessage({
                type: 'drawioRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }

    /**
     * Get cache directory for draw.io rendered images
     */
    private getDrawIOCacheDir(diagramPath: string, context: CommandContext): string {
        const diagramDir = path.dirname(diagramPath);
        const kanbanPath = context.fileManager.getFilePath() || context.fileManager.getDocument()?.uri.fsPath;
        if (!kanbanPath) {
            return path.join(diagramDir, 'drawio-cache');
        }
        const kanbanDir = path.dirname(kanbanPath);
        const kanbanBaseName = path.basename(kanbanPath, path.extname(kanbanPath));

        if (diagramDir !== kanbanDir) {
            const diagramBaseName = path.basename(diagramDir);
            return path.join(diagramDir, `${diagramBaseName}-Media`, 'drawio-cache');
        }

        return path.join(kanbanDir, `${kanbanBaseName}-Media`, 'drawio-cache');
    }

    /**
     * Generate cache file name based on source file path and mtime
     */
    private getDrawIOCacheFileName(sourcePath: string, mtime: number): string {
        const basename = path.basename(sourcePath, path.extname(sourcePath));
        const pathHash = Buffer.from(sourcePath).toString('base64').replace(/[/+=]/g, '').substring(0, 8);
        return `${basename}-${pathHash}-${Math.floor(mtime)}.png`;
    }

    /**
     * Clean up old cache files for a diagram
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
            console.warn('[DrawIO Backend] Cache cleanup warning:', error);
        }
    }

    /**
     * Check if a DrawIO file is empty
     */
    private isEmptyDrawIOFile(content: string): boolean {
        try {
            const mxCellMatches = content.match(/<mxCell\s+id="[^"]*"/g);
            if (!mxCellMatches) {
                return true;
            }
            return mxCellMatches.length <= 2;
        } catch {
            return false;
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
     * Check if an Excalidraw file is empty
     */
    private isEmptyExcalidrawFile(content: string, filePath: string): boolean {
        try {
            if (filePath.endsWith('.excalidraw.svg')) {
                const hasDrawingContent = content.includes('<path') ||
                    content.includes('<rect') ||
                    content.includes('<circle') ||
                    content.includes('<ellipse') ||
                    content.includes('<text');
                return !hasDrawingContent;
            }

            const data = JSON.parse(content);
            if (!data.elements || !Array.isArray(data.elements)) {
                return true;
            }
            const activeElements = data.elements.filter((el: { isDeleted?: boolean }) => !el.isDeleted);
            return activeElements.length === 0;
        } catch {
            return false;
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
     */
    private async handleRenderExcalidraw(message: RequestExcalidrawRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            console.error('[DiagramCommands.handleRenderExcalidraw] No panel or webview available');
            return;
        }

        try {
            const includeContext = includeDir ? { includeDir } : undefined;
            const resolution = await context.fileManager.resolveFilePath(filePath, includeContext);

            if (!resolution || !resolution.exists) {
                throw new Error(`Excalidraw file not found: ${filePath}`);
            }

            const absolutePath = resolution.resolvedPath;
            const stats = await fs.promises.stat(absolutePath);
            const fileMtime = stats.mtimeMs;

            const mediaTracker = context.getMediaTracker?.();
            if (mediaTracker) {
                mediaTracker.ensureFileWatched(filePath, absolutePath, 'diagram', fileMtime);
            }

            const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
            const isEmptyDiagram = this.isEmptyExcalidrawFile(fileContent, absolutePath);

            if (isEmptyDiagram) {
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

            const plugin = this._getRegistry().findDiagramPluginById('excalidraw');
            if (!plugin || !plugin.renderFile) {
                throw new Error('Excalidraw plugin not available');
            }

            const result = await plugin.renderFile(absolutePath);
            if (!result.success) {
                throw new Error(result.error || 'Excalidraw rendering failed');
            }

            const svg = result.data as string;
            const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

            this.postMessage({
                type: 'excalidrawRenderSuccess',
                requestId,
                svgDataUrl: dataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[Excalidraw Backend] Render error:', error);

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
     */
    private async handleRenderPDFPage(message: RequestPDFPageRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, pageNumber, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            return;
        }

        try {
            const plugin = this._getRegistry().findDiagramPluginById('pdf');
            if (!plugin || !plugin.renderFile) {
                throw new Error('PDF plugin not available');
            }

            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'PDF');

            const result = await plugin.renderFile(absolutePath, { pageNumber, dpi: 150 });
            if (!result.success) {
                throw new Error(result.error || 'PDF rendering failed');
            }

            const pngDataUrl = `data:image/png;base64,${(result.data as Buffer).toString('base64')}`;

            this.postMessage({
                type: 'pdfPageRenderSuccess',
                requestId,
                pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[PDF Backend] Render error:', error);

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
            return;
        }

        try {
            const plugin = this._getRegistry().findDiagramPluginById('pdf');
            if (!plugin || !plugin.getFileInfo) {
                throw new Error('PDF plugin not available');
            }

            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'PDF');

            const info = await plugin.getFileInfo(absolutePath);

            this.postMessage({
                type: 'pdfInfoSuccess',
                requestId,
                pageCount: info.pageCount,
                fileMtime
            });

        } catch (error) {
            console.error('[PDF Info] Error:', error);

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
     */
    private async handleRenderEPUBPage(message: RequestEPUBPageRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, pageNumber, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            return;
        }

        try {
            const plugin = this._getRegistry().findDiagramPluginById('epub');
            if (!plugin || !plugin.renderFile) {
                throw new Error('EPUB plugin not available');
            }

            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'EPUB');

            const result = await plugin.renderFile(absolutePath, { pageNumber, dpi: 150 });
            if (!result.success) {
                throw new Error(result.error || 'EPUB rendering failed');
            }

            const pngDataUrl = `data:image/png;base64,${(result.data as Buffer).toString('base64')}`;

            this.postMessage({
                type: 'epubPageRenderSuccess',
                requestId,
                pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[EPUB Backend] Render error:', error);

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
            return;
        }

        try {
            const plugin = this._getRegistry().findDiagramPluginById('epub');
            if (!plugin || !plugin.getFileInfo) {
                throw new Error('EPUB plugin not available');
            }

            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'EPUB');

            const info = await plugin.getFileInfo(absolutePath);

            this.postMessage({
                type: 'epubInfoSuccess',
                requestId,
                pageCount: info.pageCount,
                fileMtime
            });

        } catch (error) {
            console.error('[EPUB Info] Error:', error);

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
     */
    private async handleRenderXlsx(message: RequestXlsxRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, sheetNumber, includeDir } = message;
        const panel = context.getWebviewPanel();

        if (!panel || !panel.webview) {
            return;
        }

        try {
            const plugin = this._getRegistry().findDiagramPluginById('xlsx');
            if (!plugin || !plugin.renderFile) {
                throw new Error('XLSX plugin not available');
            }

            const { absolutePath, fileMtime } = await this.resolveDocumentFile(filePath, includeDir, context, 'Excel');

            if (!await plugin.isAvailable()) {
                throw new Error('LibreOffice CLI not installed');
            }

            const result = await plugin.renderFile(absolutePath, { sheetNumber });
            if (!result.success) {
                throw new Error(result.error || 'Excel rendering failed');
            }

            const pngDataUrl = `data:image/png;base64,${(result.data as Buffer).toString('base64')}`;

            this.postMessage({
                type: 'xlsxRenderSuccess',
                requestId,
                pngDataUrl,
                fileMtime
            });

        } catch (error) {
            console.error('[XLSX Backend] Render error:', error);

            this.postMessage({
                type: 'xlsxRenderError',
                requestId,
                error: getErrorMessage(error)
            });
        }
    }
}
