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
import { DiagramPlugin } from '../plugins/interfaces/DiagramPlugin';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

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
            'requestXlsxRender',
            'getMermaidCache',
            'cacheMermaidSvg'
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
            mermaidPlugin?.handleRenderSuccess?.(m.requestId, m.svg);
            return Promise.resolve(this.success());
        },
        'mermaidExportError': (msg) => {
            const m = msg as { requestId: string; error: string };
            const mermaidPlugin = this._getMermaidPlugin();
            mermaidPlugin?.handleRenderError?.(m.requestId, m.error);
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
        },
        'getMermaidCache': async (msg, ctx) => {
            await this.handleGetMermaidCache(msg as unknown as { requestId: string; codeHash: string }, ctx);
            return this.success();
        },
        'cacheMermaidSvg': async (msg, ctx) => {
            await this.handleCacheMermaidSvg(msg as unknown as { codeHash: string; svg: string }, ctx);
            return this.success();
        }
    };

    // ============= PLUGIN ACCESS =============

    private _getRegistry(): PluginRegistry {
        return PluginRegistry.getInstance();
    }

    private _getMermaidPlugin(): DiagramPlugin | null {
        return this._getRegistry().getDiagramPluginById('mermaid') ?? null;
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
            // Check filesystem cache (keyed by code hash)
            const codeHash = this.hashInlineCode(code);
            const cacheDir = this.getInlineDiagramCacheDir(context, 'plantuml-cache');
            const cachePath = path.join(cacheDir, `${codeHash}.svg`);

            let svg: string;

            if (fs.existsSync(cachePath)) {
                svg = await fs.promises.readFile(cachePath, 'utf8');
            } else {
                const plugin = this._getRegistry().findDiagramPluginForCodeBlock('plantuml');
                if (!plugin || !plugin.renderCodeBlock) {
                    throw new Error('PlantUML plugin not available');
                }

                const result = await plugin.renderCodeBlock(code);
                if (!result.success) {
                    throw new Error(result.error || 'PlantUML rendering failed');
                }

                svg = result.data as string;

                await fs.promises.mkdir(cacheDir, { recursive: true });
                await fs.promises.writeFile(cachePath, svg, 'utf8');
            }

            this.postMessage({
                type: 'plantUMLRenderSuccess',
                requestId,
                svg
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
        if (!context.getWebviewPanel()?.webview) { return; }

        try {
            const { absolutePath, fileMtime } = await this.resolveTrackedFile(filePath, includeDir, context, 'draw.io', 'diagram');

            const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
            if (this.isEmptyDrawIOFile(fileContent)) {
                const placeholderSvg = this.createEmptyDrawIOPlaceholder();
                this.postMessage({
                    type: 'drawioRenderSuccess', requestId,
                    svgDataUrl: `data:image/svg+xml;base64,${Buffer.from(placeholderSvg).toString('base64')}`,
                    fileMtime
                });
                return;
            }

            const dataUrl = await this.renderWithFileCache(absolutePath, fileMtime, context, {
                cacheFolderName: 'drawio-cache', extension: 'png', logPrefix: 'DrawIO Backend'
            }, async () => {
                const plugin = this._getRegistry().findDiagramPluginById('drawio');
                if (!plugin || !plugin.renderFile) { throw new Error('Draw.io plugin not available'); }
                if (!await plugin.isAvailable()) { throw new Error('draw.io CLI not installed'); }
                const result = await plugin.renderFile(absolutePath, { outputFormat: 'png' });
                if (!result.success) { throw new Error(result.error || 'Draw.io rendering failed'); }
                return result.data as Buffer;
            });

            this.postMessage({ type: 'drawioRenderSuccess', requestId, svgDataUrl: dataUrl, fileMtime });
        } catch (error) {
            console.error('[DrawIO Backend] Render error:', error);
            this.postMessage({ type: 'drawioRenderError', requestId, error: getErrorMessage(error) });
        }
    }

    /**
     * Unified file-based cache: check for cached render, or render + store + cleanup.
     * Shared by all file-based render handlers (drawio, excalidraw, pdf, epub, xlsx).
     *
     * @returns data URL of the rendered content (e.g. data:image/png;base64,...)
     */
    private async renderWithFileCache(
        absolutePath: string,
        fileMtime: number,
        context: CommandContext,
        config: {
            cacheFolderName: string;
            extension: string;
            suffix?: string;
            logPrefix: string;
        },
        renderFn: () => Promise<Buffer | string>
    ): Promise<string> {
        const cacheDir = this.getDiagramCacheDir(absolutePath, context, config.cacheFolderName);
        const cacheFileName = this.getDiagramCacheFileName(absolutePath, fileMtime, config.extension, config.suffix);
        const cachePath = path.join(cacheDir, cacheFileName);

        const mimeType = config.extension === 'svg' ? 'image/svg+xml' : 'image/png';

        if (fs.existsSync(cachePath)) {
            const cached = await fs.promises.readFile(cachePath);
            return `data:${mimeType};base64,${cached.toString('base64')}`;
        }

        const data = await renderFn();

        await fs.promises.mkdir(cacheDir, { recursive: true });
        if (typeof data === 'string') {
            await fs.promises.writeFile(cachePath, data, 'utf8');
        } else {
            await fs.promises.writeFile(cachePath, data);
        }
        await this.cleanOldDiagramCache(cacheDir, absolutePath, cacheFileName, config.extension, config.logPrefix);

        return `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`;
    }

    /**
     * Get cache directory for rendered diagram images/SVGs
     */
    private getDiagramCacheDir(diagramPath: string, context: CommandContext, cacheFolderName: string): string {
        const diagramDir = path.dirname(diagramPath);
        const kanbanPath = context.fileManager.getFilePath() || context.fileManager.getDocument()?.uri.fsPath;
        if (!kanbanPath) {
            return path.join(diagramDir, cacheFolderName);
        }
        const kanbanDir = path.dirname(kanbanPath);
        const kanbanBaseName = path.basename(kanbanPath, path.extname(kanbanPath));

        if (diagramDir !== kanbanDir) {
            const diagramBaseName = path.basename(diagramDir);
            return path.join(diagramDir, `${diagramBaseName}-Media`, cacheFolderName);
        }

        return path.join(kanbanDir, `${kanbanBaseName}-Media`, cacheFolderName);
    }

    /**
     * Build a stable prefix for cache file names: `basename-pathHash-`
     */
    private getDiagramCachePrefix(sourcePath: string): string {
        const basename = path.basename(sourcePath, path.extname(sourcePath));
        const pathHash = Buffer.from(sourcePath).toString('base64').replace(/[/+=]/g, '').substring(0, 8);
        return `${basename}-${pathHash}-`;
    }

    /**
     * Generate cache file name based on source file path, mtime, and output extension.
     * Optional suffix for paged content (e.g., '-p3' for page 3).
     */
    private getDiagramCacheFileName(sourcePath: string, mtime: number, extension: string, suffix?: string): string {
        return `${this.getDiagramCachePrefix(sourcePath)}${Math.floor(mtime)}${suffix || ''}.${extension}`;
    }

    /**
     * Clean up old cache files for a diagram, keeping only the current version
     */
    private async cleanOldDiagramCache(cacheDir: string, sourcePath: string, currentCacheFile: string, extension: string, logPrefix: string): Promise<void> {
        try {
            const prefix = this.getDiagramCachePrefix(sourcePath);
            const files = await fs.promises.readdir(cacheDir);
            for (const file of files) {
                if (file.startsWith(prefix) && file !== currentCacheFile && file.endsWith(`.${extension}`)) {
                    await fs.promises.unlink(path.join(cacheDir, file));
                }
            }
        } catch (error) {
            console.warn(`[${logPrefix}] Cache cleanup warning:`, error);
        }
    }

    /**
     * Get cache directory for inline diagrams (PlantUML, Mermaid) that don't have a source file path.
     * Stored in the kanban board's media folder.
     */
    private getInlineDiagramCacheDir(context: CommandContext, cacheFolderName: string): string {
        const kanbanPath = context.fileManager.getFilePath() || context.fileManager.getDocument()?.uri.fsPath;
        if (!kanbanPath) {
            return path.join(process.cwd(), cacheFolderName);
        }
        const kanbanDir = path.dirname(kanbanPath);
        const kanbanBaseName = path.basename(kanbanPath, path.extname(kanbanPath));
        return path.join(kanbanDir, `${kanbanBaseName}-Media`, cacheFolderName);
    }

    /**
     * Hash inline diagram code to a short, filesystem-safe string for cache keying.
     */
    private hashInlineCode(code: string): string {
        return crypto.createHash('md5').update(code).digest('hex').substring(0, 12);
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
        if (!context.getWebviewPanel()?.webview) { return; }

        try {
            const { absolutePath, fileMtime } = await this.resolveTrackedFile(filePath, includeDir, context, 'Excalidraw', 'diagram');

            const fileContent = await fs.promises.readFile(absolutePath, 'utf8');
            if (this.isEmptyExcalidrawFile(fileContent, absolutePath)) {
                const placeholderSvg = this.createEmptyExcalidrawPlaceholder();
                this.postMessage({
                    type: 'excalidrawRenderSuccess', requestId,
                    svgDataUrl: `data:image/svg+xml;base64,${Buffer.from(placeholderSvg).toString('base64')}`,
                    fileMtime
                });
                return;
            }

            const dataUrl = await this.renderWithFileCache(absolutePath, fileMtime, context, {
                cacheFolderName: 'excalidraw-cache', extension: 'svg', logPrefix: 'Excalidraw Backend'
            }, async () => {
                const plugin = this._getRegistry().findDiagramPluginById('excalidraw');
                if (!plugin || !plugin.renderFile) { throw new Error('Excalidraw plugin not available'); }
                const result = await plugin.renderFile(absolutePath);
                if (!result.success) { throw new Error(result.error || 'Excalidraw rendering failed'); }
                return result.data as string;
            });

            this.postMessage({ type: 'excalidrawRenderSuccess', requestId, svgDataUrl: dataUrl, fileMtime });
        } catch (error) {
            console.error('[Excalidraw Backend] Render error:', error);
            this.postMessage({ type: 'excalidrawRenderError', requestId, error: getErrorMessage(error) });
        }
    }

    // ============= FILE RESOLUTION HELPERS =============

    /**
     * Resolve a file path, stat it, and register with MediaTracker for change detection.
     * Shared by all file-based handlers (diagram, document, etc.).
     */
    private async resolveTrackedFile(
        filePath: string,
        includeDir: string | undefined,
        context: CommandContext,
        fileType: string,
        trackerType: 'diagram' | 'image' | 'audio' | 'video' | 'document' = 'document'
    ): Promise<{ absolutePath: string; fileMtime: number }> {
        const includeContext = includeDir ? { includeDir } : undefined;
        const resolution = await context.fileManager.resolveFilePath(filePath, includeContext);
        if (!resolution || !resolution.exists) {
            throw new Error(`${fileType} file not found: ${filePath}`);
        }
        const absolutePath = resolution.resolvedPath;
        const stats = await fs.promises.stat(absolutePath);
        const fileMtime = stats.mtimeMs;

        const mediaTracker = context.getMediaTracker?.();
        if (mediaTracker) {
            mediaTracker.ensureFileWatched(filePath, absolutePath, trackerType, fileMtime);
        }

        return { absolutePath, fileMtime };
    }

    // ============= PDF HANDLERS =============

    /**
     * Handle PDF page rendering request from webview
     */
    private async handleRenderPDFPage(message: RequestPDFPageRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, pageNumber, includeDir } = message;
        if (!context.getWebviewPanel()?.webview) { return; }

        try {
            const { absolutePath, fileMtime } = await this.resolveTrackedFile(filePath, includeDir, context, 'PDF');

            const dataUrl = await this.renderWithFileCache(absolutePath, fileMtime, context, {
                cacheFolderName: 'pdf-cache', extension: 'png', suffix: `-p${pageNumber}`, logPrefix: 'PDF Backend'
            }, async () => {
                const plugin = this._getRegistry().findDiagramPluginById('pdf');
                if (!plugin || !plugin.renderFile) { throw new Error('PDF plugin not available'); }
                const result = await plugin.renderFile(absolutePath, { pageNumber, dpi: 150 });
                if (!result.success) { throw new Error(result.error || 'PDF rendering failed'); }
                return result.data as Buffer;
            });

            this.postMessage({ type: 'pdfPageRenderSuccess', requestId, pngDataUrl: dataUrl, fileMtime });
        } catch (error) {
            console.error('[PDF Backend] Render error:', error);
            this.postMessage({ type: 'pdfPageRenderError', requestId, error: getErrorMessage(error) });
        }
    }

    /**
     * Handle file info request (page count) for paged document types (PDF, EPUB).
     */
    private async handleFileInfo(
        requestId: string,
        filePath: string,
        includeDir: string | undefined,
        context: CommandContext,
        pluginId: string,
        fileType: string,
        successType: string,
        errorType: string
    ): Promise<void> {
        if (!context.getWebviewPanel()?.webview) { return; }

        try {
            const plugin = this._getRegistry().findDiagramPluginById(pluginId);
            if (!plugin || !plugin.getFileInfo) {
                throw new Error(`${fileType} plugin not available`);
            }

            const { absolutePath, fileMtime } = await this.resolveTrackedFile(filePath, includeDir, context, fileType);
            const info = await plugin.getFileInfo(absolutePath);

            this.postMessage({ type: successType, requestId, pageCount: info.pageCount, fileMtime });
        } catch (error) {
            console.error(`[${fileType} Info] Error:`, error);
            this.postMessage({ type: errorType, requestId, error: getErrorMessage(error) });
        }
    }

    private async handleGetPDFInfo(message: RequestPDFInfoMessage, context: CommandContext): Promise<void> {
        await this.handleFileInfo(message.requestId, message.filePath, message.includeDir, context, 'pdf', 'PDF', 'pdfInfoSuccess', 'pdfInfoError');
    }

    // ============= EPUB HANDLERS =============

    /**
     * Handle EPUB page rendering request from webview
     */
    private async handleRenderEPUBPage(message: RequestEPUBPageRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, pageNumber, includeDir } = message;
        if (!context.getWebviewPanel()?.webview) { return; }

        try {
            const { absolutePath, fileMtime } = await this.resolveTrackedFile(filePath, includeDir, context, 'EPUB');

            const dataUrl = await this.renderWithFileCache(absolutePath, fileMtime, context, {
                cacheFolderName: 'epub-cache', extension: 'png', suffix: `-p${pageNumber}`, logPrefix: 'EPUB Backend'
            }, async () => {
                const plugin = this._getRegistry().findDiagramPluginById('epub');
                if (!plugin || !plugin.renderFile) { throw new Error('EPUB plugin not available'); }
                const result = await plugin.renderFile(absolutePath, { pageNumber, dpi: 150 });
                if (!result.success) { throw new Error(result.error || 'EPUB rendering failed'); }
                return result.data as Buffer;
            });

            this.postMessage({ type: 'epubPageRenderSuccess', requestId, pngDataUrl: dataUrl, fileMtime });
        } catch (error) {
            console.error('[EPUB Backend] Render error:', error);
            this.postMessage({ type: 'epubPageRenderError', requestId, error: getErrorMessage(error) });
        }
    }

    private async handleGetEPUBInfo(message: RequestEPUBInfoMessage, context: CommandContext): Promise<void> {
        await this.handleFileInfo(message.requestId, message.filePath, message.includeDir, context, 'epub', 'EPUB', 'epubInfoSuccess', 'epubInfoError');
    }

    // ============= XLSX HANDLERS =============

    /**
     * Handle Excel spreadsheet rendering request from webview
     */
    private async handleRenderXlsx(message: RequestXlsxRenderMessage, context: CommandContext): Promise<void> {
        const { requestId, filePath, sheetNumber, includeDir } = message;
        if (!context.getWebviewPanel()?.webview) { return; }

        try {
            const { absolutePath, fileMtime } = await this.resolveTrackedFile(filePath, includeDir, context, 'Excel');

            const dataUrl = await this.renderWithFileCache(absolutePath, fileMtime, context, {
                cacheFolderName: 'xlsx-cache', extension: 'png', suffix: `-s${sheetNumber}`, logPrefix: 'XLSX Backend'
            }, async () => {
                const plugin = this._getRegistry().findDiagramPluginById('xlsx');
                if (!plugin || !plugin.renderFile) { throw new Error('XLSX plugin not available'); }
                if (!await plugin.isAvailable()) { throw new Error('LibreOffice CLI not installed'); }
                const result = await plugin.renderFile(absolutePath, { sheetNumber });
                if (!result.success) { throw new Error(result.error || 'Excel rendering failed'); }
                return result.data as Buffer;
            });

            this.postMessage({ type: 'xlsxRenderSuccess', requestId, pngDataUrl: dataUrl, fileMtime });
        } catch (error) {
            console.error('[XLSX Backend] Render error:', error);
            this.postMessage({ type: 'xlsxRenderError', requestId, error: getErrorMessage(error) });
        }
    }

    // ============= MERMAID CACHE HANDLERS =============

    /**
     * Handle mermaid cache lookup request from webview.
     * Returns cached SVG if available, otherwise signals cache miss.
     */
    private async handleGetMermaidCache(message: { requestId: string; codeHash: string }, context: CommandContext): Promise<void> {
        const { requestId, codeHash } = message;
        try {
            const cacheDir = this.getInlineDiagramCacheDir(context, 'mermaid-cache');
            const cachePath = path.join(cacheDir, `${codeHash}.svg`);

            if (fs.existsSync(cachePath)) {
                const svg = await fs.promises.readFile(cachePath, 'utf8');
                this.postMessage({ type: 'mermaidCacheHit', requestId, svg });
            } else {
                this.postMessage({ type: 'mermaidCacheMiss', requestId });
            }
        } catch {
            this.postMessage({ type: 'mermaidCacheMiss', requestId });
        }
    }

    /**
     * Handle mermaid cache store request from webview (fire-and-forget).
     * Stores rendered SVG to filesystem for persistent caching across board reopens.
     */
    private async handleCacheMermaidSvg(message: { codeHash: string; svg: string }, context: CommandContext): Promise<void> {
        const { codeHash, svg } = message;
        try {
            const cacheDir = this.getInlineDiagramCacheDir(context, 'mermaid-cache');
            await fs.promises.mkdir(cacheDir, { recursive: true });
            await fs.promises.writeFile(path.join(cacheDir, `${codeHash}.svg`), svg, 'utf8');
        } catch (error) {
            console.warn('[Mermaid Backend] Cache write warning:', error);
        }
    }
}
