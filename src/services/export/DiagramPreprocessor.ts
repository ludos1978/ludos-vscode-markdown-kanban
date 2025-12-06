import { PlantUMLService } from '../../plantUMLService';
import { getMermaidExportService, MermaidExportService } from './MermaidExportService';
import { DrawIOService } from './DrawIOService';
import { ExcalidrawService } from './ExcalidrawService';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

interface DiagramBlock {
    type: 'plantuml' | 'mermaid' | 'drawio' | 'excalidraw';
    code: string;
    fullMatch: string;
    id: string;
    filePath?: string;  // For file-based diagrams (draw.io, excalidraw)
}

interface RenderedDiagram {
    id: string;
    fileName: string;
    originalBlock: string;
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

    constructor(webviewPanel?: vscode.WebviewPanel) {
        this.plantUMLService = new PlantUMLService();
        this.mermaidService = getMermaidExportService();
        this.drawioService = new DrawIOService();
        this.excalidrawService = new ExcalidrawService();

        if (webviewPanel) {
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

        // Log diagram breakdown
        const plantUMLCount = diagrams.filter(d => d.type === 'plantuml').length;
        const mermaidCount = diagrams.filter(d => d.type === 'mermaid').length;
        const drawioCount = diagrams.filter(d => d.type === 'drawio').length;
        const excalidrawCount = diagrams.filter(d => d.type === 'excalidraw').length;

        // Render all diagrams
        const rendered = await this.renderAllDiagrams(
            diagrams,
            outputFolder,
            baseFileName
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
        const plantUMLRegex = /```plantuml\s*\n([\s\S]*?)\n```/g;
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
        const mermaidRegex = /```mermaid\s*\n([\s\S]*?)\n```/g;

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
        // Pattern: ![alt](path/to/file.drawio) or ![alt](file.dio)
        const drawioRegex = /!\[[^\]]*\]\(([^\)]+\.(?:drawio|dio))\)/g;

        while ((match = drawioRegex.exec(markdown)) !== null) {
            drawioCounter++;
            diagrams.push({
                type: 'drawio',
                code: '',  // File-based, no inline code
                fullMatch: match[0],
                id: `drawio-${drawioCounter}`,
                filePath: match[1]
            });
        }

        // Extract excalidraw diagram file references
        // Pattern: ![alt](path/to/file.excalidraw) or ![alt](file.excalidraw.json) or ![alt](file.excalidraw.svg)
        const excalidrawRegex = /!\[[^\]]*\]\(([^\)]+\.excalidraw(?:\.json|\.svg)?)\)/g;

        while ((match = excalidrawRegex.exec(markdown)) !== null) {
            excalidrawCounter++;
            diagrams.push({
                type: 'excalidraw',
                code: '',  // File-based, no inline code
                fullMatch: match[0],
                id: `excalidraw-${excalidrawCounter}`,
                filePath: match[1]
            });
        }

        return diagrams;
    }

    /**
     * Render all diagrams (PlantUML in parallel, Mermaid via service, draw.io/excalidraw in parallel)
     */
    private async renderAllDiagrams(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string
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
                baseFileName
            );
            rendered.push(...drawioResults);
        }

        // Render excalidraw diagrams in parallel (library-based)
        if (excalidrawDiagrams.length > 0) {
            const excalidrawResults = await this.renderExcalidrawBatch(
                excalidrawDiagrams,
                outputFolder,
                baseFileName
            );
            rendered.push(...excalidrawResults);
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
            vscode.window.showErrorMessage(
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
     * Render draw.io diagrams in parallel
     * Similar to PlantUML batch rendering (CLI-based)
     */
    private async renderDrawIOBatch(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string
    ): Promise<RenderedDiagram[]> {

        const renderPromises = diagrams.map(async (diagram) => {
            try {
                if (!diagram.filePath) {
                    console.error(`[DiagramPreprocessor] ❌ No file path for ${diagram.id}`);
                    return null;
                }

                // Resolve path relative to the markdown file's directory (outputFolder)
                const absolutePath = path.isAbsolute(diagram.filePath)
                    ? diagram.filePath
                    : path.resolve(outputFolder, diagram.filePath);

                // Check if file exists
                if (!fs.existsSync(absolutePath)) {
                    console.error(`[DiagramPreprocessor] ❌ File not found: ${absolutePath}`);
                    return null;
                }

                // Render using draw.io service
                const svg = await this.drawioService.renderSVG(absolutePath);

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
                console.error(`[DiagramPreprocessor] Failed to render ${diagram.id}:`, error);
                return null;
            }
        });

        const results = await Promise.all(renderPromises);

        // Filter out failures
        return results.filter((r): r is RenderedDiagram => r !== null);
    }

    /**
     * Render excalidraw diagrams in parallel
     * Similar to PlantUML batch rendering (library-based)
     */
    private async renderExcalidrawBatch(
        diagrams: DiagramBlock[],
        outputFolder: string,
        baseFileName: string
    ): Promise<RenderedDiagram[]> {

        const renderPromises = diagrams.map(async (diagram) => {
            try {
                if (!diagram.filePath) {
                    console.error(`[DiagramPreprocessor] ❌ No file path for ${diagram.id}`);
                    return null;
                }

                // Resolve path relative to the markdown file's directory (outputFolder)
                const absolutePath = path.isAbsolute(diagram.filePath)
                    ? diagram.filePath
                    : path.resolve(outputFolder, diagram.filePath);

                // Check if file exists
                if (!fs.existsSync(absolutePath)) {
                    console.error(`[DiagramPreprocessor] ❌ File not found: ${absolutePath}`);
                    return null;
                }

                // Render using excalidraw service
                const svg = await this.excalidrawService.renderSVG(absolutePath);

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
        for (const diagram of rendered) {
            const imageRef = `![${diagram.id}](${diagram.fileName})`;
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

        // Replace unconverted diagrams with a note
        for (const diagram of unconverted) {
            const note = `> ⚠️ ${diagram.type.toUpperCase()} diagram could not be converted for export\n> To include this diagram, please open the Kanban board view before exporting`;
            result = result.replace(diagram.fullMatch, note);
        }

        return result;
    }
}
