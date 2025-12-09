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

import { BaseMessageCommand, CommandContext, CommandMetadata, CommandResult } from './interfaces';
import { getMermaidExportService } from '../services/export/MermaidExportService';

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

    async execute(message: any, context: CommandContext): Promise<CommandResult> {
        try {
            const panel = context.getWebviewPanel();
            const messageHandler = (panel as any)?._messageHandler;

            switch (message.type) {
                case 'renderPlantUML':
                    if (messageHandler) {
                        await messageHandler.handleRenderPlantUML(message);
                    }
                    return this.success();

                case 'convertPlantUMLToSVG':
                    if (messageHandler) {
                        await messageHandler.handleConvertPlantUMLToSVG(message);
                    }
                    return this.success();

                case 'convertMermaidToSVG':
                    if (messageHandler) {
                        await messageHandler.handleConvertMermaidToSVG(message);
                    }
                    return this.success();

                case 'mermaidExportSuccess':
                    getMermaidExportService().handleRenderSuccess(message.requestId, message.svg);
                    return this.success();

                case 'mermaidExportError':
                    getMermaidExportService().handleRenderError(message.requestId, message.error);
                    return this.success();

                case 'requestDrawIORender':
                    if (messageHandler) {
                        await messageHandler.handleRenderDrawIO(message);
                    }
                    return this.success();

                case 'requestExcalidrawRender':
                    if (messageHandler) {
                        await messageHandler.handleRenderExcalidraw(message);
                    }
                    return this.success();

                case 'requestPDFPageRender':
                    if (messageHandler) {
                        await messageHandler.handleRenderPDFPage(message);
                    }
                    return this.success();

                case 'requestPDFInfo':
                    if (messageHandler) {
                        await messageHandler.handleGetPDFInfo(message);
                    }
                    return this.success();

                default:
                    return this.failure(`Unknown diagram command: ${message.type}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[DiagramCommands] Error handling ${message.type}:`, error);
            return this.failure(errorMessage);
        }
    }
}
