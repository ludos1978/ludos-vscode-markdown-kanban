import { PlantUMLService } from './PlantUMLService';
import { MermaidExportService } from './MermaidExportService';
import { DrawIOService } from './DrawIOService';
import { ExcalidrawService } from './ExcalidrawService';
import { XlsxService } from './XlsxService';
import { DiagramPatterns, parseAttributeBlock } from '../../shared/regexPatterns';
import { showError } from '../NotificationService';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { logger } from '../../utils/logger';

// Debug flag - set to true to enable verbose logging
const DEBUG = false;
const log = DEBUG ? logger.debug.bind(logger, '[DiagramPreprocessor]') : () => {};

interface DiagramBlock {
    type: 'plantuml' | 'mermaid' | 'drawio' | 'excalidraw' | 'xlsx';
    code: string;
    fullMatch: string;
    id: string;
    filePath?: string;  // For file-based diagrams (draw.io, excalidraw, xlsx)
    title?: string;     // Optional title/caption from markdown syntax
    attributes?: { [key: string]: string };  // Optional attributes like {page=1 width=300px}
}

interface RenderedDiagram {
    id: string;
    fileName: string;
    originalBlock: string;
    title?: string;     // Preserved title for caption
}

export interface PreprocessResult {
    processedMarkdown: string;
    diagramFiles: string[];
}

/**
 * Preprocessor that converts diagram fence blocks to SVG image references
 * for export compatibility (especially Marp PDF export)
 */
export class DiagramPreprocessor {
    private plantUMLService: PlantUMLService;
    private mermaidService: MermaidExportService;
    private drawioService: DrawIOService;
    private excalidrawService: ExcalidrawService;
    private xlsxService: XlsxService;

    constructor(mermaidService?: MermaidExportService, webviewPanel?: vscode.WebviewPanel) {
        this.plantUMLService = new PlantUMLService();
        // Create a dummy service if not provided (Mermaid diagrams won't render but won't crash)
        this.mermaidService = mermaidService || new MermaidExportService();
        this.drawioService = new DrawIOService();
        this.excalidrawService = new ExcalidrawService();
        this.xlsxService = new XlsxService();

        if (webviewPanel && mermaidService) {
            this.mermaidService.setWebviewPanel(webviewPanel);
        }
    }

    /**
     * Preprocess markdown file, converting all diagrams to SVG files
     */
    async preprocess(
        sourceFilePath: string,
        outputFolder: string,
        baseFileName: string
    ): Promise<PreprocessResult> {

        // Read source markdown
        const markdown = await fs.promises.readFile(sourceFilePath, 'utf8');

        // Extract all diagrams
        const diagrams = this.extractAllDiagrams(markdown);

        if (diagrams.length === 0) {
            return { processedMarkdown: markdown, diagramFiles: [] };
        }

        // Get source directory for resolving relative paths in diagrams
        const sourceDir = path.dirname(sourceFilePath);

        // Render all diagrams
        const rendered = await this.renderAllDiagrams(
            diagrams,
            outputFolder,
            baseFileName,
            sourceDir
        );


        // Replace successfully rendered diagrams with image references
        let processedMarkdown = this.replaceAllDiagrams(markdown, rendered);

        // Remove unconverted diagrams (replace with warning notes)
        if (rendered.length < diagrams.length) {
            processedMarkdown = this.removeUnconvertedDiagrams(processedMarkdown, diagrams, rendered);
        }

        const diagramFiles = rendered.map(d => d.fileName);

        return { processedMarkdown, diagramFiles };
    }

    /**
     * Extract all diagram blocks from markdown
     */
    private extractAllDiagrams(markdown: string): DiagramBlock[] {
        const diagrams: DiagramBlock[] = [];
        let plantUMLCounter = 0;
        let mermaidCounter = 0;
        let drawioCounter = 0;
        let excalidrawCounter = 0;

        // Extract PlantUML diagrams
        const plantUMLRegex = DiagramPatterns.plantuml();
        let match;

        while ((match = plantUMLRegex.exec(markdown)) !== null) {
            plantUMLCounter++;
            diagrams.push({
                type: 'plantuml',
                code: match[1],
                fullMatch: match[0],
                id: `plantuml-${plantUMLCounter}`
            });
        }

        // Extract Mermaid diagrams
        const mermaidRegex = DiagramPatterns.mermaid();

        while ((match = mermaidRegex.exec(markdown)) !== null) {
            mermaidCounter++;
            diagrams.push({
                type: 'mermaid',
                code: match[1],
                fullMatch: match[0],
                id: `mermaid-${mermaidCounter}`
            });
        }

        // Extract draw.io diagram file references
        // Pattern: ![alt](path/to/file.drawio "title") or ![alt](file.dio)
        const drawioRegex = DiagramPatterns.drawio();

        while ((match = drawioRegex.exec(markdown)) !== null) {
            drawioCounter++;
            diagrams.push({
                type: 'drawio',
                code: '',  // File-based, no inline code
                fullMatch: match[0],
                id: `drawio-${drawioCounter}`,
                filePath: match[1],
                title: match[2]  // Optional title from "..." in markdown
            });
        }

        // Extract excalidraw diagram file references
        // Pattern: ![alt](path/to/file.excalidraw "title") or ![alt](file.excalidraw.json) or ![alt](file.excalidraw.svg)
        const excalidrawRegex = DiagramPatterns.excalidraw();

        while ((match = excalidrawRegex.exec(markdown)) !== null) {
            excalidrawCounter++;
            diagrams.push({
                type: 'excalidraw',
                code: '',  // File-based, no inline code
                fullMatch: match[0],
                id: `excalidraw-${excalidrawCounter}`,
                filePath: match[1],
                title: match[2]  // Optional title from "..." in markdown
            });
        }

        // Extract Excel spreadsheet file references
        // Pattern: ![alt](path/to/file.xlsx "title"){page=1} or ![alt](file.xls) or ![alt](file.ods)
        let xlsxCounter = 0;
        const xlsxRegex = DiagramPatterns.xlsx();

        while ((match = xlsxRegex.exec(markdown)) !== null) {
            xlsxCounter++;
            const attributes = match[3] ? parseAttributeBlock(match[3]) : undefined;
            diagrams.push({
                type: 'xlsx',
                code: '',  // File-based, no inline code
                fullMatch: match[0],
                id: `xlsx-${xlsxCounter}`,
                filePath: match[1],
                title: match[2],  // Optional title from "..." in markdown
                attributes
            });
        }

        return diagrams;
    }

    /**
     * Render all diagrams (PlantUML in parallel, Mermaid via service, draw.io/excalidraw in parallel)
     * @param diagrams - Extracted diagram blocks
     * @param outputFolder - Where to save rendered SVG files
     * @param baseFileName - Base name for output files
     * @param sourceDir - Directory of source markdown file (for resolving relative paths)
     */
    private async renderAllDiagrams(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string,
        sourceDir: string
    ): Promise<RenderedDiagram[]> {
        const rendered: RenderedDiagram[] = [];

        // Separate by type
        const plantUMLDiagrams = diagrams.filter(d => d.type === 'plantuml');
        const mermaidDiagrams = diagrams.filter(d => d.type === 'mermaid');
        const drawioDiagrams = diagrams.filter(d => d.type === 'drawio');
        const excalidrawDiagrams = diagrams.filter(d => d.type === 'excalidraw');

        // Render PlantUML in parallel (backend can handle concurrent requests)
        if (plantUMLDiagrams.length > 0) {
            const plantUMLResults = await this.renderPlantUMLBatch(
                plantUMLDiagrams,
                outputFolder,
                baseFileName
            );
            rendered.push(...plantUMLResults);
        }

        // Render Mermaid via service (sequential, handled by service)
        if (mermaidDiagrams.length > 0) {
            const mermaidResults = await this.renderMermaidBatch(
                mermaidDiagrams,
                outputFolder,
                baseFileName
            );
            rendered.push(...mermaidResults);
        }

        // Render draw.io diagrams in parallel (CLI-based like PlantUML)
        if (drawioDiagrams.length > 0) {
            const drawioResults = await this.renderDrawIOBatch(
                drawioDiagrams,
                outputFolder,
                baseFileName,
                sourceDir
            );
            rendered.push(...drawioResults);
        }

        // Render excalidraw diagrams in parallel (library-based)
        if (excalidrawDiagrams.length > 0) {
            const excalidrawResults = await this.renderExcalidrawBatch(
                excalidrawDiagrams,
                outputFolder,
                baseFileName,
                sourceDir
            );
            rendered.push(...excalidrawResults);
        }

        // Render xlsx spreadsheets in parallel (LibreOffice CLI-based)
        const xlsxDiagrams = diagrams.filter(d => d.type === 'xlsx');
        if (xlsxDiagrams.length > 0) {
            const xlsxResults = await this.renderXlsxBatch(
                xlsxDiagrams,
                outputFolder,
                baseFileName,
                sourceDir
            );
            rendered.push(...xlsxResults);
        }

        return rendered;
    }

    /**
     * Render PlantUML diagrams in parallel
     */
    private async renderPlantUMLBatch(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string
    ): Promise<RenderedDiagram[]> {

        const renderPromises = diagrams.map(async (diagram) => {
            try {

                // Wrap code with PlantUML delimiters
                const wrappedCode = `@startuml\n${diagram.code.trim()}\n@enduml`;

                // Render using backend service
                const svg = await this.plantUMLService.renderSVG(wrappedCode);

                // Save SVG file
                const fileName = `${baseFileName}-${diagram.id}.svg`;
                const filePath = path.join(outputFolder, fileName);
                await fs.promises.writeFile(filePath, svg, 'utf8');


                return {
                    id: diagram.id,
                    fileName,
                    originalBlock: diagram.fullMatch
                };
            } catch (error) {
                console.error(`[DiagramPreprocessor] ❌ Failed to render ${diagram.id}:`, error);
                return null;
            }
        });

        const results = await Promise.all(renderPromises);

        // Filter out failures
        return results.filter((r): r is RenderedDiagram => r !== null);
    }

    /**
     * Render Mermaid diagrams via MermaidExportService
     */
    private async renderMermaidBatch(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string
    ): Promise<RenderedDiagram[]> {

        // Check if service is ready
        if (!this.mermaidService.isReady()) {
            console.error('[DiagramPreprocessor] ❌ MermaidExportService not ready (no webview)');
            showError(
                'Cannot export Mermaid diagrams: Please open the Kanban board view first, then try exporting again.'
            );
            return [];
        }

        // Extract codes
        const codes = diagrams.map(d => d.code);

        // Render via service (handles queuing and responses)
        const svgs = await this.mermaidService.renderBatch(codes);

        // Save results
        const rendered: RenderedDiagram[] = [];

        for (let i = 0; i < diagrams.length; i++) {
            const diagram = diagrams[i];
            const svg = svgs[i];

            if (svg) {
                const fileName = `${baseFileName}-${diagram.id}.svg`;
                const filePath = path.join(outputFolder, fileName);
                await fs.promises.writeFile(filePath, svg, 'utf8');

                rendered.push({
                    id: diagram.id,
                    fileName,
                    originalBlock: diagram.fullMatch
                });

            } else {
                console.error(`[DiagramPreprocessor] ❌ No SVG returned for ${diagram.id}`);
            }
        }

        return rendered;
    }

    /**
     * Check if output SVG is up-to-date with source file
     * Returns true if SVG exists and is newer than source
     */
    private async isOutputUpToDate(sourcePath: string, outputPath: string): Promise<boolean> {
        try {
            if (!fs.existsSync(outputPath)) {
                return false;
            }
            const sourceStat = await fs.promises.stat(sourcePath);
            const outputStat = await fs.promises.stat(outputPath);
            return outputStat.mtime >= sourceStat.mtime;
        } catch {
            return false;
        }
    }

    /**
     * Render file-based diagrams (draw.io, excalidraw) in parallel
     * Skips diagrams whose source files haven't changed
     * @param diagrams - Diagrams with file paths
     * @param outputFolder - Where to save rendered SVG files
     * @param baseFileName - Base name for output files
     * @param sourceDir - Directory of source markdown file (for resolving relative paths)
     * @param renderFn - Function to render the diagram to SVG
     */
    private async renderFileBasedDiagramBatch(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string,
        sourceDir: string,
        renderFn: (absolutePath: string) => Promise<string>
    ): Promise<RenderedDiagram[]> {

        const renderPromises = diagrams.map(async (diagram) => {
            try {
                if (!diagram.filePath) {
                    console.error(`[DiagramPreprocessor] ❌ No file path for ${diagram.id}`);
                    return null;
                }

                // Resolve path relative to the SOURCE markdown file's directory, not output folder
                const absolutePath = path.isAbsolute(diagram.filePath)
                    ? diagram.filePath
                    : path.resolve(sourceDir, diagram.filePath);

                // Check if file exists
                if (!fs.existsSync(absolutePath)) {
                    console.error(`[DiagramPreprocessor] ❌ File not found: ${absolutePath}`);
                    return null;
                }

                const fileName = `${baseFileName}-${diagram.id}.svg`;
                const outputPath = path.join(outputFolder, fileName);

                // Check if output is up-to-date (skip re-rendering unchanged diagrams)
                if (await this.isOutputUpToDate(absolutePath, outputPath)) {
                    log(`✓ Skipping ${diagram.id} (unchanged)`);
                    const result: RenderedDiagram = {
                        id: diagram.id,
                        fileName,
                        originalBlock: diagram.fullMatch
                    };
                    if (diagram.title) result.title = diagram.title;
                    return result;
                }

                // Render using provided service function
                log(`Rendering ${diagram.id}...`);
                const svg = await renderFn(absolutePath);

                // Save SVG file
                await fs.promises.writeFile(outputPath, svg, 'utf8');

                const result: RenderedDiagram = {
                    id: diagram.id,
                    fileName,
                    originalBlock: diagram.fullMatch
                };
                if (diagram.title) result.title = diagram.title;
                return result;
            } catch (error) {
                console.error(`[DiagramPreprocessor] Failed to render ${diagram.id}:`, error);
                return null;
            }
        });

        const results = await Promise.all(renderPromises);

        // Filter out failures
        return results.filter((r): r is RenderedDiagram => r !== null);
    }

    /**
     * Render draw.io diagrams in parallel
     */
    private async renderDrawIOBatch(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string,
        sourceDir: string
    ): Promise<RenderedDiagram[]> {
        return this.renderFileBasedDiagramBatch(
            diagrams,
            outputFolder,
            baseFileName,
            sourceDir,
            (absolutePath) => this.drawioService.renderSVG(absolutePath)
        );
    }

    /**
     * Render excalidraw diagrams in parallel
     */
    private async renderExcalidrawBatch(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string,
        sourceDir: string
    ): Promise<RenderedDiagram[]> {
        return this.renderFileBasedDiagramBatch(
            diagrams,
            outputFolder,
            baseFileName,
            sourceDir,
            (absolutePath) => this.excalidrawService.renderSVG(absolutePath)
        );
    }

    /**
     * Render xlsx spreadsheets in parallel (outputs PNG, not SVG)
     */
    private async renderXlsxBatch(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string,
        sourceDir: string
    ): Promise<RenderedDiagram[]> {

        const renderPromises = diagrams.map(async (diagram) => {
            try {
                if (!diagram.filePath) {
                    console.error(`[DiagramPreprocessor] ❌ No file path for ${diagram.id}`);
                    return null;
                }

                // Resolve path relative to the SOURCE markdown file's directory
                const absolutePath = path.isAbsolute(diagram.filePath)
                    ? diagram.filePath
                    : path.resolve(sourceDir, diagram.filePath);

                // Check if file exists
                if (!fs.existsSync(absolutePath)) {
                    console.error(`[DiagramPreprocessor] ❌ File not found: ${absolutePath}`);
                    return null;
                }

                // PNG output for xlsx (not SVG like other diagram types)
                const fileName = `${baseFileName}-${diagram.id}.png`;
                const outputPath = path.join(outputFolder, fileName);

                // Check if output is up-to-date (skip re-rendering unchanged files)
                if (await this.isOutputUpToDate(absolutePath, outputPath)) {
                    log(`✓ Skipping ${diagram.id} (unchanged)`);
                    const result: RenderedDiagram = {
                        id: diagram.id,
                        fileName,
                        originalBlock: diagram.fullMatch
                    };
                    if (diagram.title) result.title = diagram.title;
                    return result;
                }

                // Get page/sheet number from attributes (default: 1)
                const pageNumber = diagram.attributes?.page
                    ? parseInt(diagram.attributes.page, 10)
                    : 1;

                // Render using LibreOffice
                log(`Rendering ${diagram.id} (sheet ${pageNumber})...`);
                const pngBuffer = await this.xlsxService.renderPNG(absolutePath, pageNumber);

                // Save PNG file
                await fs.promises.writeFile(outputPath, pngBuffer);

                const result: RenderedDiagram = {
                    id: diagram.id,
                    fileName,
                    originalBlock: diagram.fullMatch
                };
                if (diagram.title) result.title = diagram.title;
                return result;
            } catch (error) {
                console.error(`[DiagramPreprocessor] Failed to render ${diagram.id}:`, error);
                return null;
            }
        });

        const results = await Promise.all(renderPromises);

        // Filter out failures
        return results.filter((r): r is RenderedDiagram => r !== null);
    }

    /**
     * Replace all diagram blocks with image references
     */
    private replaceAllDiagrams(
        markdown: string,
        rendered: RenderedDiagram[]
    ): string {
        let result = markdown;

        // Replace each successfully rendered diagram with image reference
        // Preserve title if present for caption support
        for (const diagram of rendered) {
            const titlePart = diagram.title ? ` "${diagram.title}"` : '';
            const imageRef = `![${diagram.id}](${diagram.fileName}${titlePart})`;
            result = result.replace(diagram.originalBlock, imageRef);
        }

        return result;
    }

    /**
     * Remove all unconverted diagram blocks (replace with note about missing conversion)
     */
    private removeUnconvertedDiagrams(markdown: string, allDiagrams: DiagramBlock[], rendered: RenderedDiagram[]): string {
        let result = markdown;

        // Find diagrams that weren't successfully rendered
        const renderedIds = new Set(rendered.map(d => d.id));
        const unconverted = allDiagrams.filter(d => !renderedIds.has(d.id));

        // Replace unconverted diagrams with a type-specific note
        for (const diagram of unconverted) {
            const note = this.getUnconvertedDiagramNote(diagram);
            result = result.replace(diagram.fullMatch, note);
        }

        return result;
    }

    /**
     * Get a helpful error note for an unconverted diagram based on its type
     */
    private getUnconvertedDiagramNote(diagram: DiagramBlock): string {
        const header = `> ⚠️ ${diagram.type.toUpperCase()} diagram could not be converted for export`;

        switch (diagram.type) {
            case 'mermaid':
                return `${header}\n> To include this diagram, please open the Kanban board view before exporting`;

            case 'plantuml':
                return `${header}\n> Ensure Java is installed and accessible in your PATH`;

            case 'drawio':
                return `${header}\n> Ensure draw.io desktop app is installed with CLI support, or check if the file exists: ${diagram.filePath || 'unknown'}`;

            case 'excalidraw':
                return `${header}\n> Check if the file exists and is a valid Excalidraw format: ${diagram.filePath || 'unknown'}`;

            case 'xlsx':
                return `${header}\n> Ensure LibreOffice is installed, or check if the file exists: ${diagram.filePath || 'unknown'}`;

            default:
                return `${header}\n> Check the output console for error details`;
        }
    }
}
