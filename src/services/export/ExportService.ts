import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { showWarning } from '../NotificationService';
import { TagUtils, TagVisibility } from '../../utils/tagUtils';
import { PresentationParser } from './PresentationParser';
import { PresentationGenerator, PresentationOptions } from './PresentationGenerator';
import { PathResolver } from '../PathResolver';
import { MarpOutputFormat, PandocOutputFormat } from '../../plugins/interfaces/ExportPlugin';
import { DiagramPreprocessor } from './DiagramPreprocessor';
import { PluginRegistry } from '../../plugins/registry/PluginRegistry';
// MermaidExportService replaced by MermaidPlugin via PluginRegistry
import { ConfigurationService } from '../ConfigurationService';
import { pluginConfigService } from '../PluginConfigService';
import { INCLUDE_SYNTAX } from '../../constants/IncludeConstants';
import { generateTimestamp } from '../../constants/FileNaming';
import { DOTTED_EXTENSIONS } from '../../shared/fileTypeDefinitions';
import { MarkdownPatterns, HtmlPatterns, isUrl } from '../../shared/regexPatterns';
import { AssetHandler } from '../assets/AssetHandler';
import { escapeRegExp, getErrorMessage, toForwardSlashes } from '../../utils/stringUtils';
import { KanbanBoard, KanbanColumn, KanbanTask } from '../../board/KanbanTypes';
import { MarkdownKanbanParser } from '../../markdownParser';
import { logger } from '../../utils/logger';

/**
 * Export options - SINGLE unified system for ALL exports
 */
export interface NewExportOptions {
    // SELECTION: Column indexes to export (empty or undefined = full board)
    columnIndexes?: number[];

    // SCOPE: What to export
    scope?: 'board' | 'column' | 'task';

    // SELECTION: Specific item to export (for column/task scope)
    // columnId is preferred over columnIndex for reliable lookup (avoids sync issues)
    selection?: {
        columnId?: string;
        columnIndex?: number;
        taskId?: string;
    };

    // MODE: Operation mode
    mode: 'copy' | 'save' | 'auto' | 'preview';
    // - copy: Return content only (for clipboard operations)
    // - save: Write to disk
    // - auto: Auto-export on save (registers save handler)
    // - preview: Open in Marp preview (realtime watch)

    // FORMAT: Output format (defined by export dialog)
    // 'keep' = keep original, 'kanban' = ## Headers + tasks, 'presentation' = slides with ---, 'document' = for Pandoc
    format: 'keep' | 'kanban' | 'presentation' | 'document';

    // MARP: Use Marp checkbox and output format
    runMarp?: boolean;  // Use Marp checkbox
    marpFormat?: 'markdown' | 'html' | 'pdf' | 'pptx';  // Marp CLI output format

    // TRANSFORMATIONS
    mergeIncludes?: boolean;
    tagVisibility: TagVisibility;
    excludeTags?: string[];  // Tags that exclude content from export (e.g., ['#export-exclude', '#private'])

    // PACKING & LINK HANDLING
    linkHandlingMode?: 'rewrite-only' | 'pack-linked' | 'pack-all' | 'no-modify';
    packAssets: boolean;
    packOptions?: {
        includeFiles?: boolean;
        includeImages?: boolean;
        includeVideos?: boolean;
        includeOtherMedia?: boolean;
        includeDocuments?: boolean;
        fileSizeLimitMB?: number;
    };

    // OUTPUT
    targetFolder?: string;              // Required for save/auto/preview modes
    openAfterExport?: boolean;

    // MARP SPECIFIC
    marpTheme?: string;
    marpGlobalClasses?: string[];   // Global CSS classes for all slides
    marpLocalClasses?: string[];    // Local CSS classes for specific slides
    marpBrowser?: string;
    marpEnginePath?: string;
    marpWatch?: boolean;            // Run Marp in watch mode
    marpPptxEditable?: boolean;     // Use --pptx-editable flag for PowerPoint exports
    marpHandout?: boolean;          // Generate handout PDF (slides + notes)
    marpHandoutLayout?: 'portrait' | 'landscape';  // Handout page layout
    marpHandoutSlidesPerPage?: 1 | 2 | 4;  // Slides per page in handout (1=portrait, 2=landscape, 4=portrait)
    marpHandoutDirection?: 'horizontal' | 'vertical';  // Direction for 2-slide layout (horizontal=left-right, vertical=top-bottom)
    marpHandoutPdf?: boolean;  // Always true when handout is enabled

    // CONTENT TRANSFORMATIONS
    speakerNoteMode?: 'comment' | 'keep' | 'remove';  // How to handle ;; speaker notes
    htmlCommentMode?: 'remove' | 'keep';              // How to handle <!-- --> comments
    htmlContentMode?: 'keep' | 'remove';              // How to handle <tag> content
    embedHandling?: 'url' | 'fallback' | 'remove' | 'iframe';  // How to handle embeds (iframe auto-used for HTML)

    // PANDOC: Document export options
    runPandoc?: boolean;                              // Use Pandoc for document export
    pandocFormat?: 'docx' | 'odt' | 'epub';           // Pandoc output format
    documentPageBreaks?: 'continuous' | 'per-task' | 'per-column';  // Page breaks in document format
}

/**
 * Result of export operation
 */
export interface ExportResult {
    success: boolean;
    message: string;
    content?: string;                   // For mode: 'copy'
    exportedPath?: string;              // For mode: 'save'
    marpWatchPath?: string;             // Path that Marp is watching (for process protection)
}

/**
 * Asset information for export operations.
 * Note: This is different from AssetHandler.DetectedAsset which is used for asset detection.
 * This interface includes export-specific fields like relativePath, exists, and md5.
 */
export interface ExportAssetInfo {
    originalPath: string;
    resolvedPath: string;
    relativePath: string;
    type: 'image' | 'video' | 'audio' | 'document' | 'file' | 'markdown' | 'diagram';
    size: number;
    exists: boolean;
    md5?: string;
}

/**
 * ExportService - Unified export system for Kanban boards
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXPORT FORMAT SYSTEM (defined by export dialog dropdown)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Three format options (ONLY these, nothing else):
 *
 * 1. 'keep' - Keep Original Format
 *    - Preserves the source format as-is
 *
 * 2. 'kanban' - Convert to Kanban Format
 *    - ## column headers and - [ ] task items
 *
 * 3. 'presentation' - Convert to Presentation Format
 *    - Slides separated by ---
 *    - Each column becomes a title slide, each task becomes a content slide
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * MARP PROCESSING (separate from format)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Marp CLI is triggered ONLY when `runMarp` is true (Use Marp checkbox).
 * The `marpFormat` (html/pdf/pptx) is the Marp CLI output parameter.
 *
 * Flow when Marp enabled:
 *   Kanban → Presentation Markdown → Marp CLI → HTML/PDF/PPTX
 *            (format: 'presentation')   (marpFormat: 'html'|'pdf'|'pptx')
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export class ExportService {
    // Use centralized extension constants from fileTypeDefinitions.ts
    // This ensures consistency across all asset detection code

    // Include patterns for different include types
    // These patterns embed the core INCLUDE_SYNTAX pattern (!!!include(path)!!!) with additional
    // context capture. The core pattern is defined in constants/IncludeConstants.ts.
    //
    // TASK_INCLUDE_PATTERN: Matches task lines with includes
    //   Pattern: ^(\s*)-\s*\[\s*\]\s* + INCLUDE_SYNTAX (!!!include(path)!!!)
    //   Captures: [1] leading whitespace, [2] file path
    private static readonly TASK_INCLUDE_PATTERN = /^(\s*)-\s*\[\s*\]\s*!!!include\(([^)]+)\)!!!/gm;
    //
    // COLUMN_INCLUDE_PATTERN: Matches column headers with includes
    //   Pattern: ^##\s+ + prefix + INCLUDE_SYNTAX (!!!include(path)!!!) + suffix
    //   Captures: [1] prefix title, [2] file path, [3] suffix (tags/other content)
    private static readonly COLUMN_INCLUDE_PATTERN = /^##\s+(.*?)!!!include\(([^)]+)\)!!!(.*?)$/gm;

    // Track MD5 hashes to detect duplicates
    private static exportedFiles = new Map<string, string>(); // MD5 -> exported path

    /**
     * Apply tag filtering to content based on export options
     * DRY method to avoid duplication
     */
    private static applyTagFiltering(content: string, tagVisibility: TagVisibility): string {
        if (tagVisibility && tagVisibility !== 'all') {
            return TagUtils.processMarkdownContent(content, tagVisibility);
        }
        return content;
    }

    /**
     * Check if text contains any of the exclude tags
     * Uses word boundary matching to avoid partial matches (e.g., #export won't match #export-exclude)
     */
    private static hasExcludeTag(text: string, excludeTags: string[]): boolean {
        if (!text || !excludeTags || excludeTags.length === 0) {
            return false;
        }
        for (const tag of excludeTags) {
            // Use word boundary to match exact tag (e.g., #export-exclude won't match #export)
            const tagPattern = new RegExp(`${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (tagPattern.test(text)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Filter excluded content from a board object based on exclude tags
     * - Removes columns where column.title contains any exclude tag
     * - Removes tasks where task.title contains any exclude tag
     * - Filters lines in task.content that contain exclude tags
     */
    private static filterExcludedFromBoard(board: KanbanBoard, excludeTags: string[]): KanbanBoard {
        if (!excludeTags || excludeTags.length === 0) {
            return board;
        }

        logger.info(`[ExportService.filterExcludedFromBoard] Filtering board with tags: ${JSON.stringify(excludeTags)}, columns: ${board.columns.length}`);
        const filteredColumns: KanbanColumn[] = [];

        for (const column of board.columns) {
            // Skip column if its title contains an exclude tag
            if (this.hasExcludeTag(column.title, excludeTags)) {
                continue;
            }

            // Filter tasks in this column
            const filteredTasks: KanbanTask[] = [];
            for (const task of column.tasks || []) {
                // Skip task if its title contains an exclude tag
                if (this.hasExcludeTag(task.title, excludeTags)) {
                    continue;
                }

                // Filter lines in task description
                if (task.description) {
                    const filteredLines = task.description
                        .split('\n')
                        .filter((line: string) => !this.hasExcludeTag(line, excludeTags));
                    filteredTasks.push({
                        ...task,
                        description: filteredLines.join('\n')
                    });
                } else {
                    filteredTasks.push(task);
                }
            }

            filteredColumns.push({
                ...column,
                tasks: filteredTasks
            });
        }

        return {
            ...board,
            columns: filteredColumns
        };
    }

    /**
     * Filter excluded content from raw markdown based on exclude tags
     * - Removes ## column header lines if they contain exclude tags
     * - Removes task blocks (- [ ] task and its content) if title contains exclude tags
     * - Removes individual lines within task content if they contain exclude tags
     */
    private static filterExcludedFromMarkdown(content: string, excludeTags: string[]): string {
        if (!excludeTags || excludeTags.length === 0) {
            return content;
        }

        // Detect if content is in presentation format (has slide separators)
        const isPresentationFormat = content.includes('\n---\n') || content.startsWith('---\n');

        if (isPresentationFormat) {
            return this.filterExcludedFromPresentation(content, excludeTags);
        } else {
            return this.filterExcludedFromKanban(content, excludeTags);
        }
    }

    /**
     * Filter excluded content from presentation format (slides separated by ---)
     * - Removes entire slides if the slide title/first line contains an exclude tag
     * - Removes individual lines within slides if they contain exclude tags
     */
    private static filterExcludedFromPresentation(content: string, excludeTags: string[]): string {
        // Split content into slides (separated by ---)
        const slides = content.split(/\n---\n/);
        logger.info(`[ExportService.filterExcludedFromPresentation] Filtering ${slides.length} slides with tags: ${JSON.stringify(excludeTags)}`);

        const filteredSlides: string[] = [];
        let excludedSlides = 0;
        let excludedLines = 0;

        for (const slide of slides) {
            const lines = slide.split('\n');
            // Check if the slide title (first non-empty, non-directive line) has an exclude tag
            const titleLine = lines.find(line => {
                const trimmed = line.trim();
                return trimmed && !trimmed.startsWith('<!--') && !trimmed.startsWith('---');
            });

            if (titleLine && this.hasExcludeTag(titleLine, excludeTags)) {
                // Exclude entire slide
                logger.info(`[ExportService.filterExcludedFromPresentation] EXCLUDING slide: ${titleLine.substring(0, 80)}`);
                excludedSlides++;
                continue;
            }

            // Filter individual lines within the slide
            const filteredLines = lines.filter(line => {
                if (this.hasExcludeTag(line, excludeTags)) {
                    logger.info(`[ExportService.filterExcludedFromPresentation] EXCLUDING line: ${line.substring(0, 80)}`);
                    excludedLines++;
                    return false;
                }
                return true;
            });

            filteredSlides.push(filteredLines.join('\n'));
        }

        logger.info(`[ExportService.filterExcludedFromPresentation] Result: ${slides.length} slides -> ${filteredSlides.length} slides (excluded ${excludedSlides} slides, ${excludedLines} lines)`);
        return filteredSlides.join('\n---\n');
    }

    /**
     * Filter excluded content from kanban format (## headers and - [ ] tasks)
     * - Removes ## column header lines if they contain exclude tags
     * - Removes task blocks (- [ ] task and its content) if title contains exclude tags
     * - Removes individual lines within task content if they contain exclude tags
     */
    private static filterExcludedFromKanban(content: string, excludeTags: string[]): string {
        const lines = content.split('\n');
        logger.info(`[ExportService.filterExcludedFromKanban] Filtering ${lines.length} lines with tags: ${JSON.stringify(excludeTags)}`);
        logger.info(`[ExportService.filterExcludedFromKanban] First 3 lines: ${JSON.stringify(lines.slice(0, 3))}`);

        const result: string[] = [];
        let skipUntilNextSection = false;
        let inExcludedTask = false;
        let taskIndentLevel = 0;
        let excludedCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Check for column header (## Title)
            if (trimmedLine.startsWith('## ')) {
                skipUntilNextSection = this.hasExcludeTag(line, excludeTags);
                inExcludedTask = false;
                if (skipUntilNextSection) {
                    logger.info(`[ExportService.filterExcludedFromKanban] EXCLUDING column: ${line.substring(0, 80)}`);
                    excludedCount++;
                } else {
                    result.push(line);
                }
                continue;
            }

            // Skip all content in excluded column
            if (skipUntilNextSection) {
                excludedCount++;
                continue;
            }

            // Check for task line (- [ ] or - [x])
            const taskMatch = line.match(/^(\s*)-\s*\[[x\s]\]/i);
            if (taskMatch) {
                taskIndentLevel = taskMatch[1].length;
                inExcludedTask = this.hasExcludeTag(line, excludeTags);
                if (inExcludedTask) {
                    logger.info(`[ExportService.filterExcludedFromKanban] EXCLUDING task: ${line.substring(0, 80)}`);
                    excludedCount++;
                } else {
                    result.push(line);
                }
                continue;
            }

            // Check if we're in indented task content (continuation of task)
            const lineIndent = line.match(/^(\s*)/)?.[1].length || 0;
            if (inExcludedTask && lineIndent > taskIndentLevel && trimmedLine !== '') {
                // Skip indented content of excluded task
                excludedCount++;
                continue;
            }

            // Reset excluded task flag when we reach a non-indented line
            if (lineIndent <= taskIndentLevel && trimmedLine !== '') {
                inExcludedTask = false;
            }

            // For regular lines, check if they contain exclude tags
            if (this.hasExcludeTag(line, excludeTags)) {
                logger.info(`[ExportService.filterExcludedFromKanban] EXCLUDING line: ${line.substring(0, 80)}`);
                excludedCount++;
                continue;
            }

            result.push(line);
        }

        logger.info(`[ExportService.filterExcludedFromKanban] Result: ${lines.length} lines -> ${result.length} lines (excluded ${excludedCount})`);
        return result.join('\n');
    }

    /**
     * Apply speaker note transformation based on export mode
     * Transforms lines starting with ;; according to speakerNoteMode setting
     * Consecutive ;; lines are grouped together
     */
    private static applySpeakerNoteTransform(content: string, mode: 'comment' | 'keep' | 'remove'): string {
        if (!mode || mode === 'keep') {
            return content;
        }

        const lines = content.split('\n');
        const result: string[] = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith(';;')) {
                // Collect all consecutive ;; lines
                const noteLines: string[] = [];
                const indent = line.match(/^(\s*)/)?.[1] || '';

                while (i < lines.length && lines[i].trim().startsWith(';;')) {
                    const noteContent = lines[i].trim().substring(2).trim();
                    noteLines.push(noteContent);
                    i++;
                }

                // Process the grouped notes based on mode
                switch (mode) {
                    case 'comment':
                        // Combine all notes into a single comment
                        const combinedContent = noteLines.join('\n');
                        result.push(`${indent}<!-- ${combinedContent} -->`);
                        break;
                    case 'remove':
                        // Don't add anything (removes all the lines)
                        break;
                }
            } else {
                result.push(line);
                i++;
            }
        }

        return result.join('\n');
    }

    /**
     * Apply HTML comment transformation based on export mode
     * Handles <!-- --> comments, but preserves speaker-note-generated comments
     */
    private static applyHtmlCommentTransform(content: string, mode: 'remove' | 'keep'): string {
        if (!mode || mode === 'keep') {
            return content;
        }

        // Remove HTML comments but preserve those generated from speaker notes
        // (they won't have this pattern since they were just created)
        return content.replace(/<!--(?!\s*SPEAKER-NOTE:)(.*?)-->/gs, '');
    }

    /**
     * Apply HTML content transformation based on export mode
     * Handles <tag> HTML content (not comments, not URLs)
     */
    private static applyHtmlContentTransform(content: string, mode: 'keep' | 'remove'): string {
        if (!mode || mode === 'keep') {
            return content;
        }

        // Remove HTML tags but NOT comments or URL angle brackets
        // Protect code blocks first
        const codeBlockPattern = /```[\s\S]*?```|`[^`]+`/g;
        const codeBlocks: string[] = [];
        const placeholder = '___CODE_BLOCK_PLACEHOLDER___';

        // Extract code blocks
        let protectedContent = content.replace(codeBlockPattern, (match) => {
            codeBlocks.push(match);
            return `${placeholder}${codeBlocks.length - 1}${placeholder}`;
        });

        // Remove HTML tags (but not <!-- comments --> or <http:// URLs)
        protectedContent = protectedContent.replace(/<(?!\!--|\/?https?:\/\/)(.*?)>/g, '');

        // Restore code blocks
        protectedContent = protectedContent.replace(new RegExp(`${placeholder}(\\d+)${placeholder}`, 'g'), (_match, index) => {
            return codeBlocks[parseInt(index)];
        });

        return protectedContent;
    }

    /**
     * Apply media caption transformation
     * Converts ![alt](media "caption") to show caption below the media
     *
     * Handles ALL media types: images, videos, audio, and any other files with titles
     * We handle this here because markdown-it-image-figures doesn't work
     * reliably inside multicolumn blocks and other nested contexts
     *
     * @param content - Markdown content
     * @returns Transformed content with visible captions
     */
    private static applyMediaCaptionTransform(content: string): string {
        // Do NOT modify the content - captions should be handled by markdown-it-image-figures
        // plugin in the Marp engine, not by extracting them here
        // The ![alt](path "caption") syntax should remain intact for proper rendering
        return content;
    }

    /**
     * Apply all content transformations in correct order
     * Order matters: speaker notes → HTML comments → HTML content → media captions → embeds
     * Only applies for presentation format exports
     */
    private static applyContentTransformations(content: string, options: NewExportOptions): string {
        // Only apply transformations for presentation format
        if (options.format !== 'presentation') {
            return content;
        }

        let result = content;

        // 1. Speaker notes (;; → <!-- --> or remove)
        if (options.speakerNoteMode) {
            result = this.applySpeakerNoteTransform(result, options.speakerNoteMode);
        }

        // 2. HTML comments (remove or keep)
        if (options.htmlCommentMode) {
            result = this.applyHtmlCommentTransform(result, options.htmlCommentMode);
        }

        // 3. HTML content (remove or keep)
        if (options.htmlContentMode) {
            result = this.applyHtmlContentTransform(result, options.htmlContentMode);
        }

        // 4. Media captions - convert ![alt](url "caption") to show caption below media
        result = this.applyMediaCaptionTransform(result);

        // 5. Embed handling - different behavior based on output format
        const embedPlugin = PluginRegistry.getInstance().getEmbedPlugin();
        if (embedPlugin) {
            const marpFormat = options.marpFormat || 'html';
            if (marpFormat === 'html') {
                // HTML output: Convert embeds to actual iframe tags
                result = embedPlugin.transformForExport(result, 'iframe');
            } else if (marpFormat === 'pdf' || marpFormat === 'pptx') {
                // PDF/PPTX output: Use configured embed handling (url/fallback/remove)
                const mode = options.embedHandling || 'url';
                result = embedPlugin.transformForExport(result, mode);
            }
        }

        return result;
    }

    /**
     * Process a markdown file and its assets
     * Delegates to processMarkdownContent after reading file from disk
     */
    private static async processMarkdownFile(
        markdownPath: string,
        exportFolder: string,
        fileBasename: string,
        options: NewExportOptions,
        processedIncludes: Set<string>,
        convertToPresentation: boolean = false
    ): Promise<{
        exportedContent: string;
        notIncludedAssets: ExportAssetInfo[];
        stats: { includedCount: number; excludedCount: number; includeFiles: number };
    }> {
        const content = fs.readFileSync(markdownPath, 'utf8');
        const sourceDir = path.dirname(markdownPath);

        return this.processMarkdownContent(
            content,
            sourceDir,
            fileBasename,
            exportFolder,
            options,
            processedIncludes,
            convertToPresentation,
            false  // mergeIncludes defaults to false for file-based processing
        );
    }

    /**
     * Process included markdown files
     */
    private static async processIncludedFiles(
        content: string,
        sourceDir: string,
        exportFolder: string,
        options: NewExportOptions,
        processedIncludes: Set<string>,
        convertToPresentation: boolean = false,
        mergeIncludes: boolean = false
    ): Promise<{ processedContent: string; includeStats: number }> {
        // IMPORTANT: Always process includes - they must be either:
        // 1. Merged (inlined) into the document, OR
        // 2. Copied to export folder with rewritten paths
        // The packOptions.includeFiles setting is for OTHER markdown files, not includes

        let processedContent = content;
        let includeCount = 0;

        // Define include patterns and their replacement formats
        // If mergeIncludes is true, don't write separate files for ANY includes
        // Otherwise, write separate files for all include types
        //
        // IMPORTANT: Order matters! More specific patterns (column, task) MUST be processed
        // BEFORE the generic pattern, otherwise the generic pattern will match all includes
        // and the specific patterns will never run.
        const includePatterns = [
            {
                // COLUMN includes: ## Title !!!include(file.md)!!! tags
                // Must be processed FIRST to preserve column header structure
                pattern: this.COLUMN_INCLUDE_PATTERN,
                replacement: (filename: string, prefixTitle: string = '', suffix: string = '') => `## ${prefixTitle}${prefixTitle ? ' ' : ''}${INCLUDE_SYNTAX.PREFIX}${filename}${INCLUDE_SYNTAX.SUFFIX}${suffix ? ' ' + suffix : ''}`,
                shouldWriteSeparateFile: !mergeIncludes,
                includeType: 'columninclude'
            },
            {
                // TASK includes: - [ ] !!!include(file.md)!!!
                // Must be processed BEFORE generic to preserve task structure
                pattern: this.TASK_INCLUDE_PATTERN,
                replacement: (filename: string, prefixTitle: string = '', _suffix: string = '') => `${prefixTitle}- [ ] ${INCLUDE_SYNTAX.PREFIX}${filename}${INCLUDE_SYNTAX.SUFFIX}`,
                shouldWriteSeparateFile: !mergeIncludes,
                includeType: 'taskinclude'
            },
            {
                // GENERIC includes: !!!include(file.md)!!!
                // Processed LAST to catch any remaining includes not matched by specific patterns
                pattern: INCLUDE_SYNTAX.REGEX,
                replacement: (filename: string, _prefixTitle: string = '', _suffix: string = '') => `${INCLUDE_SYNTAX.PREFIX}${filename}${INCLUDE_SYNTAX.SUFFIX}`,
                shouldWriteSeparateFile: !mergeIncludes,
                includeType: 'include'
            }
        ];

        // Process each include pattern
        for (const { pattern, replacement, shouldWriteSeparateFile, includeType } of includePatterns) {
            const regex = new RegExp(pattern.source, pattern.flags);

            // Collect all matches first before modifying content
            const matches: RegExpExecArray[] = [];
            let match;
            while ((match = regex.exec(processedContent)) !== null) {
                matches.push(match);
            }

            // Process matches in reverse order to maintain correct string positions
            for (let i = matches.length - 1; i >= 0; i--) {
                match = matches[i];

                // Extract data based on include type
                // taskinclude: match[1]=indentation, match[2]=path
                // columninclude: match[1]=prefixTitle, match[2]=path, match[3]=suffix
                // include: match[1]=path
                let prefixTitle = '';
                let suffix = '';
                let includePath = '';

                if (includeType === 'taskinclude') {
                    prefixTitle = match[1]; // indentation
                    includePath = match[2].trim();
                } else if (includeType === 'columninclude') {
                    prefixTitle = match[1].trim();
                    includePath = match[2].trim();
                    suffix = match[3].trim();
                } else {
                    includePath = match[1].trim();
                }

                // PathResolver.resolve() handles URL decoding
                const resolvedPath = PathResolver.resolve(sourceDir, includePath);

                // Avoid circular references
                if (processedIncludes.has(resolvedPath)) {
                    continue;
                }

                if (fs.existsSync(resolvedPath) && path.extname(resolvedPath) === '.md') {
                    processedIncludes.add(resolvedPath);
                    includeCount++;

                    const includeBasename = path.basename(resolvedPath, '.md');

                    // Detect if the included file is already in presentation format
                    const includeContent = fs.readFileSync(resolvedPath, 'utf8');
                    const isKanbanFormat = includeContent.includes('kanban-plugin: board');

                    // Determine if we need to convert the include file
                    let shouldConvertInclude = false;
                    if (convertToPresentation) {
                        // Exporting to presentation: convert if include is kanban format
                        shouldConvertInclude = isKanbanFormat;
                    }

                    // Process the included file recursively
                    // IMPORTANT: When merging into presentation, don't convert - keep raw format
                    const shouldProcessInclude = !mergeIncludes || shouldConvertInclude;
                    let exportedContent: string;

                    if (shouldProcessInclude) {
                        const result = await this.processMarkdownFile(
                            resolvedPath,
                            exportFolder,
                            includeBasename,
                            options,
                            processedIncludes,
                            shouldConvertInclude
                        );
                        exportedContent = result.exportedContent;
                    } else {
                        // When merging, use raw content without processing
                        // This preserves ## headers and slide structure
                        exportedContent = includeContent;

                        // IMPORTANT: Rewrite paths in merged content
                        // Paths in the include file are relative to the include file's directory
                        // They need to be adjusted relative to the export folder or main file's directory
                        const includeDir = path.dirname(resolvedPath);
                        exportedContent = this.rewriteLinksForExport(
                            exportedContent,
                            includeDir,      // Source: include file's directory
                            exportFolder,    // Target: export folder
                            includeBasename, // Base name for asset subfolder
                            true             // Use relative paths
                        );
                    }

                    // If merging into kanban format and include is presentation format,
                    // convert presentation slides to kanban tasks
                    if (mergeIncludes && !convertToPresentation && !isKanbanFormat) {
                        exportedContent = this.convertPresentationToKanban(exportedContent, includeType);
                    }

                    if (shouldWriteSeparateFile) {
                        // Mode: Keep separate files
                        // Calculate MD5 for duplicate detection
                        const includeBuffer = Buffer.from(exportedContent, 'utf8');
                        const md5Hash = crypto.createHash('md5').update(includeBuffer).digest('hex');

                        // Ensure export folder exists
                        if (!fs.existsSync(exportFolder)) {
                            fs.mkdirSync(exportFolder, { recursive: true });
                        }

                        // Check if we already exported this exact content
                        let exportedRelativePath: string;
                        if (this.exportedFiles.has(md5Hash)) {
                            // Use existing exported file
                            const existingPath = this.exportedFiles.get(md5Hash)!;
                            exportedRelativePath = toForwardSlashes(path.relative(exportFolder, existingPath));
                        } else {
                            // Generate unique filename if needed
                            const fileName = path.basename(resolvedPath);
                            const ext = path.extname(fileName);
                            const nameWithoutExt = path.basename(fileName, ext);

                            let targetIncludePath = path.join(exportFolder, fileName);
                            let exportedFileName = fileName;
                            let index = 1;

                            // Check for filename conflicts
                            while (fs.existsSync(targetIncludePath)) {
                                const existingContent = fs.readFileSync(targetIncludePath, 'utf8');
                                const existingHash = crypto.createHash('md5').update(existingContent, 'utf8').digest('hex');
                                if (existingHash === md5Hash) {
                                    // Same content, use existing file
                                    break;
                                }
                                // Different content with same name, create alternative name
                                exportedFileName = `${nameWithoutExt}-${index}${ext}`;
                                targetIncludePath = path.join(exportFolder, exportedFileName);
                                index++;
                            }

                            // Write the file if not already there
                            if (!fs.existsSync(targetIncludePath)) {
                                fs.writeFileSync(targetIncludePath, exportedContent, 'utf8');
                                this.exportedFiles.set(md5Hash, targetIncludePath);
                            }

                            exportedRelativePath = exportedFileName;
                        }

                        // Update the marker to reference the exported file
                        processedContent = processedContent.replace(
                            match[0],
                            replacement(exportedRelativePath, prefixTitle, suffix)
                        );
                    } else {
                        // Mode: Merge includes into main file
                        // Replace the marker with the actual content
                        let contentToInsert = exportedContent;

                        // Handle different include types
                        if (includeType === 'taskinclude' && prefixTitle) {
                            // For taskinclude, apply indentation to each line of merged content
                            contentToInsert = exportedContent.split('\n')
                                .map(line => line ? prefixTitle + line : line)
                                .join('\n');
                        } else if (includeType === 'columninclude') {
                            // For columninclude, reconstruct the column header
                            // Get filename from path
                            const filename = path.basename(includePath);
                            const reconstructedHeader = `## ${prefixTitle}${prefixTitle ? ' ' : ''}${filename}${suffix ? ' ' + suffix : ''}`;
                            // Content should be tasks only (no ## header), so just prepend the header
                            contentToInsert = `${reconstructedHeader}\n${exportedContent}`;
                        }

                        processedContent = processedContent.replace(
                            match[0],
                            contentToInsert
                        );
                    }
                }
            }
        }

        return { processedContent, includeStats: includeCount };
    }

    /**
     * Calculate MD5 hash for file (first 1MB for large files)
     * Uses centralized AssetHandler.calculateMD5 implementation
     */
    private static async calculateMD5(filePath: string): Promise<string> {
        // Use 1MB limit for export (larger files for duplicate detection)
        return AssetHandler.calculateMD5(filePath, 1024 * 1024);
    }

    /**
     * Find all assets referenced in the markdown content
     */
    private static findAssets(content: string, sourceDir: string): ExportAssetInfo[] {
        const assets: ExportAssetInfo[] = [];

        // Use shared patterns (properly handle titles in regex)
        const patterns = [
            MarkdownPatterns.image(),
            MarkdownPatterns.link(),
            HtmlPatterns.img(),
            HtmlPatterns.media()
        ];

        patterns.forEach((regex) => {
            let match;
            while ((match = regex.exec(content)) !== null) {
                const rawPath = match[1];

                // Skip URLs
                if (isUrl(rawPath)) {
                    continue;
                }

                // PathResolver.resolve() handles URL decoding
                const resolvedPath = PathResolver.resolve(sourceDir, rawPath);

                const exists = fs.existsSync(resolvedPath);
                const stats = exists ? fs.statSync(resolvedPath) : null;
                const size = stats ? stats.size : 0;

                assets.push({
                    originalPath: rawPath, // Keep original encoded path for replacement
                    resolvedPath,
                    relativePath: path.relative(sourceDir, resolvedPath),
                    type: this.getAssetType(resolvedPath),
                    size,
                    exists
                });
            }
        });

        return assets;
    }

    /**
     * Determine asset type based on file extension
     * Uses centralized DOTTED_EXTENSIONS from fileTypeDefinitions.ts
     */
    private static getAssetType(filePath: string): ExportAssetInfo['type'] {
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.md') { return 'markdown'; }
        if (['.drawio', '.dio'].includes(ext)) { return 'diagram'; }
        if (ext === '.excalidraw' || filePath.endsWith('.excalidraw.json') || filePath.endsWith('.excalidraw.svg')) { return 'diagram'; }
        if (DOTTED_EXTENSIONS.image.includes(ext)) { return 'image'; }
        if (DOTTED_EXTENSIONS.video.includes(ext)) { return 'video'; }
        if (DOTTED_EXTENSIONS.audio.includes(ext)) { return 'audio'; }
        if (DOTTED_EXTENSIONS.document.includes(ext)) { return 'document'; }

        return 'file';
    }

    /**
     * Filter assets based on export options
     */
    private static filterAssets(assets: ExportAssetInfo[], options: NewExportOptions): ExportAssetInfo[] {
        // If packing is disabled or no pack options, return empty array
        if (!options.packAssets || !options.packOptions) {
            return [];
        }
        const packOptions = options.packOptions;
        const linkHandlingMode = options.linkHandlingMode || 'rewrite-only';

        return assets.filter(asset => {
            // Check if asset exists
            if (!asset.exists) { return false; }

            // Check file size limit
            const sizeMB = asset.size / (1024 * 1024);
            const fileSizeLimitMB = packOptions.fileSizeLimitMB ?? 100;
            if (sizeMB > fileSizeLimitMB) { return false; }

            // For pack-linked mode: include ALL assets (regardless of type)
            if (linkHandlingMode === 'pack-linked') {
                return true;
            }

            // For pack-all mode: check type-specific inclusion
            switch (asset.type) {
                case 'markdown': return packOptions.includeFiles ?? false;
                case 'image': return packOptions.includeImages ?? false;
                case 'video': return packOptions.includeVideos ?? false;
                case 'audio': return packOptions.includeOtherMedia ?? false;
                case 'document': return packOptions.includeDocuments ?? false;
                case 'diagram': return packOptions.includeImages ?? false;  // Treat diagrams like images
                case 'file': return packOptions.includeFiles ?? false;
                default: return false;
            }
        });
    }

    /**
     * Process assets: copy included ones and track excluded ones
     */
    private static async processAssets(
        content: string,
        assetsToInclude: ExportAssetInfo[],
        allAssets: ExportAssetInfo[],
        mediaFolder: string,
        fileBasename: string
    ): Promise<{ modifiedContent: string; notIncludedAssets: ExportAssetInfo[] }> {
        let modifiedContent = content;
        const notIncludedAssets: ExportAssetInfo[] = [];
        const includedPaths = new Set(assetsToInclude.map(a => a.originalPath));

        // Ensure media folder exists if we have assets to include
        if (assetsToInclude.length > 0 && !fs.existsSync(mediaFolder)) {
            fs.mkdirSync(mediaFolder, { recursive: true });
        }

        // Copy included assets and modify paths
        for (const asset of assetsToInclude) {
            try {
                // Calculate MD5 for duplicate detection
                const md5 = await this.calculateMD5(asset.resolvedPath);

                // Check if we already exported this exact file
                if (this.exportedFiles.has(md5)) {
                    // Use existing exported file path
                    const existingPath = this.exportedFiles.get(md5)!;
                    // Calculate relative path from the markdown location (export folder root) to the existing asset
                    const markdownLocation = path.dirname(mediaFolder); // This is the export folder

                    if (!existingPath) {
                        throw new Error(`Existing path is undefined for MD5: ${md5}`);
                    }

                    const relativePath = toForwardSlashes(path.relative(markdownLocation, existingPath));
                    modifiedContent = this.replaceAssetPath(modifiedContent, asset.originalPath, relativePath);
                    continue;
                }

                // Generate unique filename if needed
                const fileName = path.basename(asset.resolvedPath);
                const ext = path.extname(fileName);
                const nameWithoutExt = path.basename(fileName, ext);

                let targetPath = path.join(mediaFolder, fileName);
                let exportedFileName = fileName;
                let index = 1;

                // Check for filename conflicts
                while (fs.existsSync(targetPath)) {
                    const existingMd5 = await this.calculateMD5(targetPath);
                    if (existingMd5 === md5) {
                        // Same file, use it
                        break;
                    }
                    // Different file with same name, create alternative name
                    exportedFileName = `${nameWithoutExt}-${index}${ext}`;
                    targetPath = path.join(mediaFolder, exportedFileName);
                    index++;
                }

                // Copy the file if not already there
                if (!fs.existsSync(targetPath)) {
                    fs.copyFileSync(asset.resolvedPath, targetPath);
                    this.exportedFiles.set(md5, targetPath);
                }

                // Update path in content - calculate relative path from exported markdown file to packed asset
                // mediaFolder is at exportFolder/fileBasename-Media
                // Exported markdown is at exportFolder/fileBasename.md
                // So relative path from markdown to media is just the folder name
                const relativePath = toForwardSlashes(path.join(`${fileBasename}-Media`, exportedFileName));
                modifiedContent = this.replaceAssetPath(modifiedContent, asset.originalPath, relativePath);

            } catch (error) {
                console.error(`Failed to copy asset ${asset.originalPath}:`, error);
                notIncludedAssets.push(asset);
            }
        }

        // Collect assets that weren't included
        for (const asset of allAssets) {
            if (!includedPaths.has(asset.originalPath) && asset.type !== 'markdown') {
                notIncludedAssets.push(asset);
            }
        }

        return { modifiedContent, notIncludedAssets };
    }

    /**
     * Replace asset path in content
     */
    private static replaceAssetPath(content: string, oldPath: string, newPath: string): string {
        // Escape special regex characters in the old path
        const escapedOldPath = escapeRegExp(oldPath);

        // Normalize path separators for cross-platform compatibility
        const normalizedNewPath = toForwardSlashes(newPath);

        // Replace in markdown images: ![alt](oldPath) -> ![alt](newPath)
        content = content.replace(
            new RegExp(`(!\\[[^\\]]*\\]\\()${escapedOldPath}((?:\\s+[^)]*)?\\))`, 'g'),
            `$1${normalizedNewPath}$2`
        );

        // Replace in markdown links: [text](oldPath) -> [text](newPath)
        content = content.replace(
            new RegExp(`((?<!!)\\[[^\\]]*\\]\\()${escapedOldPath}((?:\\s+[^)]*)?\\))`, 'g'),
            `$1${normalizedNewPath}$2`
        );

        // Replace in HTML img tags: src="oldPath" -> src="newPath"
        content = content.replace(
            new RegExp(`(<img[^>]+src=["'])${escapedOldPath}(["'][^>]*>)`, 'gi'),
            `$1${normalizedNewPath}$2`
        );

        // Replace in HTML media tags: src="oldPath" -> src="newPath"
        content = content.replace(
            new RegExp(`(<(?:video|audio)[^>]+src=["'])${escapedOldPath}(["'][^>]*>)`, 'gi'),
            `$1${normalizedNewPath}$2`
        );

        return content;
    }

    /**
     * Rewrite all links in content to be correct for the exported file location
     * @param content The markdown content
     * @param sourceDir Original source directory
     * @param exportFolder Export folder directory
     * @param fileBasename Base name of the exported file
     * @param rewriteLinks Whether to rewrite links or keep them as-is
     * @returns Modified content with rewritten links
     */
    private static rewriteLinksForExport(
        content: string,
        sourceDir: string,
        exportFolder: string,
        fileBasename: string,
        rewriteLinks: boolean
    ): string {
        if (!rewriteLinks) {
            return content;
        }

        // Extract code blocks to protect them from link rewriting
        const codeBlocks: string[] = [];
        const codeBlockPlaceholder = '___CODE_BLOCK_PLACEHOLDER___';

        // Match both fence blocks (```) and inline code (`...`)
        const fenceBlockPattern = /```[\s\S]*?```/g;
        const inlineCodePattern = /`[^`]+`/g;

        // Replace fence blocks with placeholders
        let modifiedContent = content.replace(fenceBlockPattern, (match) => {
            codeBlocks.push(match);
            return `${codeBlockPlaceholder}${codeBlocks.length - 1}${codeBlockPlaceholder}`;
        });

        // Replace inline code with placeholders
        modifiedContent = modifiedContent.replace(inlineCodePattern, (match) => {
            codeBlocks.push(match);
            return `${codeBlockPlaceholder}${codeBlocks.length - 1}${codeBlockPlaceholder}`;
        });

        // Pattern to match all types of links
        // 1. Markdown images: ![alt](path) optionally followed by {attrs}
        // 2. Markdown links: [text](path)
        // 3. HTML img/video/audio tags with src attribute
        // 4. Wiki-style links: [[path]] or [[path|text]]
        // NOTE: Angle brackets <...> are NOT included because they are ONLY for:
        //       - URL autolinks: <http://example.com>
        //       - Email autolinks: <user@example.com>
        //       - HTML tags: <br>, <hr>, etc.
        //       They are NEVER used for file paths in markdown!
        const linkPattern = /(!\[[^\]]*\]\([^)]+\)(?:\{[^}]+\})?)|((?<!!)\[[^\]]*\]\([^)]+\))|(<(?:img|video|audio)[^>]+src=["'][^"']+["'][^>]*>)|(\[\[[^\]]+\]\])/g;

        modifiedContent = modifiedContent.replace(linkPattern, (match) => {
            return this.processLink(match, sourceDir, exportFolder, fileBasename);
        });

        // Restore code blocks
        modifiedContent = modifiedContent.replace(new RegExp(`${codeBlockPlaceholder}(\\d+)${codeBlockPlaceholder}`, 'g'), (_match, index) => {
            return codeBlocks[parseInt(index)];
        });

        return modifiedContent;
    }

    /**
     * Process a single link and rewrite it if necessary
     */
    private static processLink(
        link: string,
        sourceDir: string,
        exportFolder: string,
        fileBasename: string
    ): string {
        let filePath: string | null = null;
        let linkStart = '';
        let linkEnd = '';

        // Extract path from different link types
        if (link.startsWith('![')) {
            // Markdown image: ![alt](path) optionally followed by {attrs}
            const match = link.match(/^!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/);
            if (match) {
                const altText = match[1];
                filePath = match[2];
                const attrBlock = match[3] || '';

                // Convert {width=X height=Y} to Marp directives (w:X h:Y in alt text)
                let marpDirectives = '';
                if (attrBlock) {
                    const widthMatch = attrBlock.match(/width=["']?([^"'\s}]+)["']?/);
                    const heightMatch = attrBlock.match(/height=["']?([^"'\s}]+)["']?/);
                    if (widthMatch) marpDirectives += ` w:${widthMatch[1]}`;
                    if (heightMatch) marpDirectives += ` h:${heightMatch[1]}`;
                }

                // Add Marp directives to alt text for Marp compatibility
                const newAltText = altText + marpDirectives;
                linkStart = `![${newAltText}](`;
                linkEnd = ')';
            }
        } else if (link.startsWith('[') && !link.startsWith('[[')) {
            // Markdown link: [text](path)
            const match = link.match(/^\[([^\]]*)\]\(([^)]+)\)/);
            if (match) {
                const linkText = match[1];
                filePath = match[2];
                linkStart = `[${linkText}](`;
                linkEnd = ')';
            }
        } else if (link.match(/^<(?:img|video|audio)/i)) {
            // HTML tag: <tag src="path">
            const match = link.match(/src=["']([^"']+)["']/i);
            if (match) {
                filePath = match[1];
                // For HTML tags, we need to rebuild the tag
                return this.rewriteHtmlTag(link, filePath, sourceDir, exportFolder, fileBasename);
            }
        } else if (link.startsWith('[[')) {
            // Wiki link: [[path]] or [[path|text]]
            const match = link.match(/^\[\[([^\]]+)\]\]/);
            if (match) {
                filePath = match[1].split('|')[0]; // Get path before | if present
                linkStart = '[[';
                linkEnd = ']]';
            }
        }
        // NOTE: Angle bracket links <...> are intentionally NOT processed here
        // They are only for URL/email autolinks or HTML tags, never file paths

        if (!filePath) {
            return link; // No path found, return original
        }

        // Extract title attribute if present (e.g., 'path "title"' or "path 'title'")
        const titleMatch = filePath.match(/\s+("[^"]*"|'[^']*')$/);
        const titleAttr = titleMatch ? titleMatch[0] : ''; // Preserve the space + quotes

        // Clean the path (remove title attributes)
        const cleanPath = filePath.replace(/\s+"[^"]*"$/, '').replace(/\s+'[^']*'$/, '');

        // Check if it's an absolute path or URL
        if (this.isAbsolutePath(cleanPath) || this.isUrl(cleanPath)) {
            return link; // Don't modify absolute paths or URLs
        }

        // Step 1: Convert the original relative path to absolute (relative to source directory)
        const absoluteTargetPath = path.resolve(sourceDir, cleanPath);

        // Step 2: Define the absolute path of the exported markdown file
        const exportedFilePath = path.join(exportFolder, fileBasename + '.md');

        // Step 3: Calculate relative path from exported file to target
        const exportedFileDir = path.dirname(exportedFilePath);
        const relativePath = toForwardSlashes(path.relative(exportedFileDir, absoluteTargetPath));

        // Rebuild the link with the new path, preserving the title attribute
        if (link.match(/^<(?:img|video|audio)/i)) {
            // Already handled above
            return link;
        } else {
            return `${linkStart}${relativePath}${titleAttr}${linkEnd}`;
        }
    }

    /**
     * Rewrite HTML tag with new src path
     */
    private static rewriteHtmlTag(
        tag: string,
        oldPath: string,
        sourceDir: string,
        exportFolder: string,
        _fileBasename: string
    ): string {
        const absoluteSourcePath = path.resolve(sourceDir, oldPath);
        const relativePath = toForwardSlashes(path.relative(exportFolder, absoluteSourcePath));

        return tag.replace(/src=["'][^"']+["']/i, `src="${relativePath}"`);
    }

    /**
     * Check if a path is absolute
     */
    private static isAbsolutePath(filePath: string): boolean {
        return path.isAbsolute(filePath) || filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath);
    }

    /**
     * Check if a path is a URL
     */
    private static isUrl(filePath: string): boolean {
        return /^https?:\/\//i.test(filePath) || /^ftp:\/\//i.test(filePath) || /^mailto:/i.test(filePath);
    }

    /**
     * Generate default export folder name based on source filename and timestamp
     * Format: {filename}-YYYYMMDD-HHmm (using local time)
     */
    public static generateDefaultExportFolder(sourceDocumentPath: string): string {
        // Ensure we have an absolute path
        const absoluteSourcePath = path.resolve(sourceDocumentPath);
        const sourceDir = path.dirname(absoluteSourcePath);
        const sourceBasename = path.basename(absoluteSourcePath, '.md');
        const timestamp = generateTimestamp();

        const exportFolder = path.join(sourceDir, `${sourceBasename}-${timestamp}`);
        return exportFolder;
    }

    /**
     * Process markdown content directly (for column export)
     */
    private static async processMarkdownContent(
        content: string,
        sourceDir: string,
        fileBasename: string,
        exportFolder: string,
        options: NewExportOptions,
        processedIncludes: Set<string>,
        convertToPresentation: boolean = false,
        mergeIncludes: boolean = false
    ): Promise<{
        exportedContent: string;
        notIncludedAssets: ExportAssetInfo[];
        stats: { includedCount: number; excludedCount: number; includeFiles: number };
    }> {
        const mediaFolder = path.join(exportFolder, `${fileBasename}-Media`);

        // Find all assets in the markdown
        const assets = this.findAssets(content, sourceDir);

        // Find and process included markdown files
        const { processedContent, includeStats } = await this.processIncludedFiles(
            content,
            sourceDir,
            exportFolder,
            options,
            processedIncludes,
            convertToPresentation,
            mergeIncludes
        );

        // Filter assets based on options
        const assetsToInclude = this.filterAssets(assets, options);

        // Process assets FIRST (copies files and updates their paths in content)
        // This must happen before rewriteLinksForExport because:
        // - findAssets captured originalPath from content (e.g., "Media/video.mp4")
        // - processAssets looks for originalPath to replace with packed path
        // - If rewriteLinksForExport runs first, it changes "Media/video.mp4" to "../Media/video.mp4"
        // - Then processAssets can't find "Media/video.mp4" to replace!
        const { modifiedContent: assetProcessedContent, notIncludedAssets } = await this.processAssets(
            processedContent,
            assetsToInclude,
            assets,
            mediaFolder,
            fileBasename
        );

        // Rewrite links based on linkHandlingMode (AFTER processing assets)
        // This handles unpacked links - calculates correct relative paths from export location
        const shouldRewriteLinks = options.linkHandlingMode !== 'no-modify';
        const modifiedContent = shouldRewriteLinks ? this.rewriteLinksForExport(
            assetProcessedContent,
            sourceDir,
            exportFolder,
            fileBasename,
            true
        ) : assetProcessedContent;

        const stats = {
            includedCount: assetsToInclude.length,
            excludedCount: notIncludedAssets.length,
            includeFiles: includeStats
        };

        // TAG PROCESSING ORDER IS CRITICAL:
        // 1. Exclude filtering (removes content WITH tags) - must run while tags are still present
        // 2. Tag visibility filtering (removes/modifies tags themselves) - runs after exclusion
        // If reversed, tags would be stripped before exclude filter can match them!

        // Step 1: Apply exclude tag filtering FIRST (before tags are stripped by visibility filter)
        let filteredContent = modifiedContent;
        if (options.excludeTags && options.excludeTags.length > 0) {
            filteredContent = this.filterExcludedFromMarkdown(filteredContent, options.excludeTags);
        }

        // Step 2: Apply tag visibility filtering (may remove tags from display)
        // This ensures all markdown files (main and included) get tag filtering
        filteredContent = this.applyTagFiltering(filteredContent, options.tagVisibility);

        // Apply content transformations (speaker notes, HTML comments, HTML content)
        filteredContent = this.applyContentTransformations(filteredContent, options);

        // Convert based on format option AND convertToPresentation flag
        // Formats: 'kanban', 'presentation', or 'document'
        // IMPORTANT: Only convert if convertToPresentation is true
        // This prevents double-conversion of files that are already in presentation format
        // (e.g., included files that don't have 'kanban-plugin: board' in their YAML)
        if (options.format === 'presentation' && convertToPresentation) {
            const marpConfig = pluginConfigService.getPluginConfigAll('marp');

            // When mergeIncludes=false, don't resolve includes during parsing
            // This prevents duplicate content (includes will be processed by Marp engine)
            const resolveIncludes = mergeIncludes;
            const { board } = MarkdownKanbanParser.parseMarkdown(filteredContent, sourceDir, undefined, undefined, resolveIncludes);

            // NOTE: excludeTags NOT passed here - already applied at text level above (line 1455)
            filteredContent = PresentationGenerator.fromBoard(board, {
                includeMarpDirectives: true,
                marp: {
                    theme: options.marpTheme || (marpConfig.defaultTheme as string) || 'default',
                    globalClasses: options.marpGlobalClasses || (marpConfig.globalClasses as string[]) || [],
                    localClasses: options.marpLocalClasses || (marpConfig.localClasses as string[]) || []
                }
            });
        } else if (options.format === 'document' && convertToPresentation) {
            // Document format for Pandoc export (DOCX, ODT, EPUB)
            // When mergeIncludes=false, don't resolve includes during parsing
            const resolveIncludes = mergeIncludes;
            const { board } = MarkdownKanbanParser.parseMarkdown(filteredContent, sourceDir, undefined, undefined, resolveIncludes);

            // NOTE: excludeTags and tagVisibility NOT passed here - already applied at text level above
            const pageBreaks = options.documentPageBreaks || 'continuous';
            filteredContent = PresentationGenerator.toDocument(board, pageBreaks, {});
        }
        // format === 'kanban' or 'keep' → keep as-is

        return {
            exportedContent: filteredContent,
            notIncludedAssets,
            stats
        };
    }

    /**
     * Extract content from a specific column
     */
    private static extractColumnContent(markdownContent: string, columnIndex: number): string | null {
        // Kanban columns are defined by ## headers
        // First, check if this is a kanban board
        const isKanban = markdownContent.includes('kanban-plugin: board');

        if (!isKanban) {
            return null;
        }

        // Split content by lines and find all column headers
        const lines = markdownContent.split('\n');
        const columns: { startIndex: number; endIndex: number; content: string[] }[] = [];
        let currentColumn: { startIndex: number; endIndex: number; content: string[] } | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check if this is a column header (starts with ##)
            if (line.startsWith('## ')) {
                // Save previous column if exists
                if (currentColumn) {
                    currentColumn.endIndex = i - 1;
                    columns.push(currentColumn);
                }

                // Start new column
                currentColumn = {
                    startIndex: i,
                    endIndex: lines.length - 1,
                    content: [line]
                };
            } else if (currentColumn) {
                // Add content to current column
                currentColumn.content.push(line);
            }
        }

        // Don't forget the last column
        if (currentColumn) {
            columns.push(currentColumn);
        }

        // Check if the requested column index exists
        if (columnIndex >= columns.length) {
            console.error(`Column index ${columnIndex} out of range. Found ${columns.length} columns.`);
            return null;
        }

        // Return the content of the requested column
        const selectedColumn = columns[columnIndex];
        return selectedColumn.content.join('\n');
    }

    /**
     * Convert presentation format to kanban format
     * For column includes and task includes that are in presentation format
     */
    private static convertPresentationToKanban(presentationContent: string, includeType: string): string {

        // Determine the include type (position-based: 'columninclude', 'taskinclude', or 'include')
        const isColumnInclude = includeType === 'columninclude';
        const isTaskInclude = includeType === 'taskinclude';

        // Parse presentation content into slides
        const slides = PresentationParser.parsePresentation(presentationContent);

        if (isColumnInclude) {
            // Convert slides to tasks ONLY (no column header)
            // The column header is reconstructed in processIncludedFiles using the prefix title, filename, and suffix
            // All slides become tasks (including the first one)
            if (slides.length === 0) {
            return '';
        }

            let kanbanContent = '';
            const tasks = PresentationParser.slidesToTasks(slides);
            for (const task of tasks) {
                kanbanContent += `- [ ] ${task.title}\n`;
                if (task.description) {
                    // Indent description lines
                    const descLines = task.description.split('\n');
                    for (const line of descLines) {
                        kanbanContent += `  ${line}\n`;
                    }
                }
            }

            return kanbanContent;

        } else if (isTaskInclude) {
            // For taskinclude, use raw presentation content as single task
            // First non-empty line becomes task title, rest becomes description
            // This preserves all formatting including --- separators
            const lines = presentationContent.split('\n');
            let title = '';
            let description = '';
            let titleIndex = -1;

            // Find first non-empty line for title
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim()) {
                    title = lines[i].trim();
                    titleIndex = i;
                    break;
                }
            }

            // Everything after title becomes description (preserving --- and all content)
            if (titleIndex >= 0 && titleIndex < lines.length - 1) {
                description = lines.slice(titleIndex + 1).join('\n').trim();
            }

            let kanbanContent = `- [ ] ${title || 'Untitled'}\n`;
            if (description) {
                const descLines = description.split('\n');
                for (const line of descLines) {
                    kanbanContent += `  ${line}\n`;
                }
            }

            return kanbanContent;

        } else {
            // Regular include - just return as-is or wrapped in a column
            return presentationContent;
        }
    }

    /**
     * Filter board based on scope and selection
     * Returns a filtered board object containing only the requested content
     */
    /**
     * Extract Marp classes from HTML comment directives in markdown
     * Format: <!-- _class: font24 center -->
     */
    private static extractMarpClassesFromMarkdown(markdown: string, board: KanbanBoard | undefined): { global: string[], local: string[], perSlide: Map<number, string[]> } {
        const result = {
            global: [] as string[],
            local: [] as string[],
            perSlide: new Map<number, string[]>()
        };

        if (!markdown || !board) {
            return result;
        }

        let slideIndex = 0;

        // Extract global classes (directive after YAML frontmatter, before first column)
        const yamlMatch = markdown.match(/^---\n[\s\S]*?\n---\n/);
        const afterYaml = yamlMatch ? yamlMatch[0].length : 0;
        const beforeFirstColumn = markdown.indexOf('\n## ', afterYaml);
        const globalSection = beforeFirstColumn > 0
            ? markdown.slice(afterYaml, beforeFirstColumn)
            : markdown.slice(afterYaml, Math.min(afterYaml + 500, markdown.length));

        const globalDirectiveMatch = globalSection.match(/<!-- _class: ([^>]+) -->/);
        if (globalDirectiveMatch) {
            result.global = globalDirectiveMatch[1].split(/\s+/).filter(c => c.length > 0);
        }

        // Extract per-slide classes from columns and tasks
        if (board.columns) {
            for (const column of board.columns) {
                // Find directive before column header
                const titleClean = escapeRegExp(column.title);
                const columnRegex = new RegExp(`<!-- _class: ([^>]+) -->\\s*## ${titleClean}`, 'm');
                const columnMatch = markdown.match(columnRegex);

                if (columnMatch) {
                    const classes = columnMatch[1].split(/\s+/).filter(c => c.length > 0);
                    result.perSlide.set(slideIndex, classes);
                }
                slideIndex++;

                // Extract from tasks
                if (column.tasks) {
                    for (const task of column.tasks) {
                        const taskTitleClean = escapeRegExp(task.title);
                        const taskRegex = new RegExp(`<!-- _class: ([^>]+) -->\\s*- \\[[ x]\\] ${taskTitleClean}`, 'm');
                        const taskMatch = markdown.match(taskRegex);

                        if (taskMatch) {
                            const classes = taskMatch[1].split(/\s+/).filter(c => c.length > 0);
                            result.perSlide.set(slideIndex, classes);
                        }
                        slideIndex++;
                    }
                }
            }
        }

        return result;
    }

    private static filterBoard(board: KanbanBoard, options: NewExportOptions): KanbanBoard {
        // Check for columnIndexes (new export dialog system)
        if (options.columnIndexes && options.columnIndexes.length > 0) {
            const selectedColumns = options.columnIndexes
                .filter(index => index >= 0 && index < board.columns.length)
                .map(index => board.columns[index]);

            return {
                ...board,
                columns: selectedColumns
            };
        }

        // Fallback to old scope-based system
        if (!options.scope || options.scope === 'board') {
            return board;
        }

        if (options.scope === 'column') {
            // Prefer columnId for reliable lookup (avoids frontend/backend sync issues)
            let column: KanbanColumn | undefined;
            if (options.selection?.columnId) {
                column = board.columns.find((c: KanbanColumn) => c.id === options.selection!.columnId);
            } else if (options.selection?.columnIndex !== undefined) {
                const columnIndex = options.selection.columnIndex;
                if (columnIndex >= 0 && columnIndex < board.columns.length) {
                    column = board.columns[columnIndex];
                }
            }
            if (column) {
                return {
                    ...board,
                    columns: [column]
                };
            }
        }

        if (options.scope === 'task' && options.selection?.taskId) {
            // Prefer columnId for reliable lookup (avoids frontend/backend sync issues)
            let column: KanbanColumn | undefined;
            if (options.selection?.columnId) {
                column = board.columns.find((c: KanbanColumn) => c.id === options.selection!.columnId);
            } else if (options.selection?.columnIndex !== undefined) {
                const columnIndex = options.selection.columnIndex;
                if (columnIndex >= 0 && columnIndex < board.columns.length) {
                    column = board.columns[columnIndex];
                }
            }

            if (column) {
                const taskId = options.selection.taskId;
                const task = column.tasks?.find((t: KanbanTask) => t.id === taskId);

                if (task) {
                    return {
                        ...board,
                        columns: [{
                            id: column.id,
                            title: '',
                            tasks: [task]
                        }]
                    };
                }
            }
        }

        return board;
    }

    /**
     * Extract content based on scope
     * Phase 1 of export pipeline: EXTRACTION
     */
    private static async extractContent(
        sourceDocument: vscode.TextDocument,
        columnIndexes?: number[]
    ): Promise<string> {
        // This function ONLY reads from files (kanban-markdown)
        // For board-based exports, skip this phase entirely

        const sourcePath = sourceDocument.uri.fsPath;
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Source file not found: ${sourcePath}`);
        }

        const fullContent = fs.readFileSync(sourcePath, 'utf8');

        // If no column indexes specified, export full board
        if (!columnIndexes || columnIndexes.length === 0) {
            return fullContent;
        }

        // Extract selected columns and combine them
        const extractedColumns: string[] = [];

        for (const columnIndex of columnIndexes) {
            const columnContent = this.extractColumnContent(fullContent, columnIndex);
            if (columnContent) {
                extractedColumns.push(columnContent);
            }
        }

        if (extractedColumns.length === 0) {
            throw new Error('Failed to extract any column content');
        }

        // Combine columns with the kanban header
        const headerMatch = fullContent.match(/^---\n[\s\S]*?\n---\n/);
        const header = headerMatch ? headerMatch[0] : '';

        return header + '\n' + extractedColumns.join('\n\n');
    }

    /**
     * Transform content through the processing pipeline
     * Phase 2 of export pipeline: TRANSFORMATION
     */
    private static async transformContent(
        content: string,
        sourceDocument: vscode.TextDocument,
        options: NewExportOptions,
        board?: KanbanBoard
    ): Promise<{ content: string; notIncludedAssets: ExportAssetInfo[] }> {

        const sourcePath = sourceDocument.uri.fsPath;
        const sourceDir = path.dirname(sourcePath);
        const sourceBasename = path.basename(sourcePath, '.md');
        const targetFolder = options.targetFolder || path.join(os.tmpdir(), 'kanban-export');

        let result = content;
        let notIncludedAssets: ExportAssetInfo[] = [];

        // ROUTING LOGIC:
        // - Converting format (presentation/document) WITH includes → Use file-based pipeline
        // - Converting format (presentation/document) WITHOUT includes → Use board-based (faster)
        // - Keeping original format (kanban/keep) → Use file to preserve formatting
        // - Asset packing → Use file to process includes correctly
        const needsFormatConversion = options.format === 'presentation' || options.format === 'document';

        // Determine settings
        // Default: Don't merge includes (keep them separate with rewritten paths)
        const mergeIncludes = options.mergeIncludes ?? false;

        // Check if we need to process includes
        // When mergeIncludes is false, we need file-based pipeline to copy include files
        const hasIncludes = result.includes(INCLUDE_SYNTAX.PREFIX);
        const needsIncludeProcessing = hasIncludes && !mergeIncludes;

        // Use board-based conversion ONLY when:
        // - Converting format AND
        // - NOT packing assets AND
        // - mergeIncludes is true (content already inlined in board, no separate files needed)
        const useBoardBasedConversion = board &&
                                        options.format !== 'kanban' &&
                                        !options.packAssets &&
                                        mergeIncludes;

        logger.info(`[ExportService.transformContent] Path selection: useBoardBasedConversion=${useBoardBasedConversion}, format=${options.format}, mergeIncludes=${mergeIncludes}, packAssets=${options.packAssets}, excludeTags=${JSON.stringify(options.excludeTags)}`);

        if (useBoardBasedConversion) {
            // BOARD-BASED PATH: Use in-memory board (includes already resolved)
            logger.info('[ExportService.transformContent] Using BOARD-BASED path');
            // Filter board based on scope and selection
            const filteredBoard = this.filterBoard(board, options);

            // NOTE: Exclude tag filtering is handled by PresentationGenerator
            // This keeps it consistent with how tagVisibility filtering works

            // Use unified presentation generator
            const marpConfig = pluginConfigService.getPluginConfigAll('marp');

            // Extract marp classes from HTML comment directives in markdown
            // Global: from directive after YAML frontmatter
            // Per-slide: from directives before column/task lines
            const markdownContent = sourceDocument.getText();
            const marpClasses = this.extractMarpClassesFromMarkdown(markdownContent, filteredBoard);

            // For copy mode: no YAML header, no column title slides - just raw content
            const isCopyMode = options.mode === 'copy';
            const generatorOptions: PresentationOptions = {
                includeMarpDirectives: !isCopyMode,  // Only include Marp directives for export, not copy
                stripIncludes: true,  // Strip include syntax (content already inlined in board)
                tagVisibility: options.tagVisibility,
                excludeTags: options.excludeTags,
                marp: {
                    theme: options.marpTheme || (marpConfig.defaultTheme as string) || 'default',
                    globalClasses: marpClasses.global.length > 0 ? marpClasses.global : ((marpConfig.globalClasses as string[]) || []),
                    localClasses: marpClasses.local.length > 0 ? marpClasses.local : ((marpConfig.localClasses as string[]) || []),
                    perSlideClasses: marpClasses.perSlide
                }
            };

            // For task scope copy: use fromTasks to avoid column header slide
            // For column/board scope: use fromBoard (includes column titles)
            // For document format: use toDocument (for Pandoc export)
            if (options.format === 'document') {
                const pageBreaks = options.documentPageBreaks || 'continuous';
                result = PresentationGenerator.toDocument(filteredBoard, pageBreaks, {
                    stripIncludes: true,
                    tagVisibility: options.tagVisibility,
                    excludeTags: options.excludeTags
                });
            } else if (isCopyMode && options.scope === 'task') {
                const allTasks = filteredBoard.columns.flatMap(col => col.tasks);
                result = PresentationGenerator.fromTasks(allTasks, generatorOptions);
            } else {
                result = PresentationGenerator.fromBoard(filteredBoard, generatorOptions);
            }

            // Rewrite links if requested
            if (options.linkHandlingMode !== 'no-modify') {
                result = this.rewriteLinksForExport(
                    result,
                    sourceDir,
                    targetFolder,
                    sourceBasename,
                    true
                );
            }

            // Apply content transformations (speaker notes, HTML comments, media captions, embeds)
            result = this.applyContentTransformations(result, options);

            // Don't return early - continue to outputContent phase for Marp CLI execution
        }
        // Use file-based pipeline when:
        // - Packing assets OR
        // - Converting format OR
        // - Need to process includes (mergeIncludes is false)
        else if (options.packAssets || options.format !== 'kanban' || needsIncludeProcessing) {
            // FILE-BASED PATH: Process raw markdown to handle includes correctly
            logger.info('[ExportService.transformContent] Using FILE-BASED path');

            // Use existing processMarkdownContent (it does everything)
            const processed = await this.processMarkdownContent(
                result,
                sourceDir,
                sourceBasename,
                targetFolder,
                options,
                new Set<string>(),
                needsFormatConversion,
                mergeIncludes
            );

            result = processed.exportedContent;
            notIncludedAssets = processed.notIncludedAssets;
            // NOTE: Exclude tag filtering is already applied inside processMarkdownContent
            // Tag processing order: 1) exclude filtering, 2) tag visibility filtering

        } else {
            // Simple path: tag filtering and link rewriting (no asset packing)
            logger.info('[ExportService.transformContent] Using SIMPLE path');
            // TAG PROCESSING ORDER IS CRITICAL:
            // 1. Exclude filtering (removes content WITH tags) - must run while tags are still present
            // 2. Tag visibility filtering (removes/modifies tags themselves) - runs after exclusion

            // Step 1: Apply exclude tag filtering FIRST (before tags are stripped)
            if (options.excludeTags && options.excludeTags.length > 0) {
                result = this.filterExcludedFromMarkdown(result, options.excludeTags);
            }

            // Step 2: Apply tag visibility filtering (may remove tags from display)
            result = this.applyTagFiltering(result, options.tagVisibility);

            // Apply content transformations (speaker notes, HTML comments, HTML content)
            result = this.applyContentTransformations(result, options);

            // Rewrite links if requested
            if (options.linkHandlingMode !== 'no-modify') {
                result = this.rewriteLinksForExport(
                    result,
                    sourceDir,
                    targetFolder,
                    sourceBasename,
                    true
                );
            }
        }

        return { content: result, notIncludedAssets };
    }

    /**
     * Output content based on mode
     * Phase 3 of export pipeline: OUTPUT
     */
    private static async outputContent(
        transformed: { content: string; notIncludedAssets: ExportAssetInfo[] },
        sourceDocument: vscode.TextDocument,
        options: NewExportOptions,
        webviewPanel?: vscode.WebviewPanel | { getPanel(): vscode.WebviewPanel }
    ): Promise<ExportResult> {

        // MODE: COPY (return content for clipboard)
        if (options.mode === 'copy') {
            return {
                success: true,
                message: 'Content generated successfully',
                content: transformed.content
            };
        }

        // MODE: SAVE / AUTO / PREVIEW (write to disk)
        if (!options.targetFolder) {
            throw new Error('Target folder required for save/auto/preview modes');
        }

        // Ensure target folder exists
        if (!fs.existsSync(options.targetFolder)) {
            fs.mkdirSync(options.targetFolder, { recursive: true });
        }

        // Build output filename
        const sourcePath = sourceDocument.uri.fsPath;
        const sourceBasename = path.basename(sourcePath, '.md');

        // Write markdown file
        const markdownPath = path.join(options.targetFolder, `${sourceBasename}.md`);
        fs.writeFileSync(markdownPath, transformed.content, 'utf8');

        // Handle Marp conversion (only if runMarp = Use Marp checkbox checked)
        if (options.runMarp) {
            // Check plugin availability via registry
            const registry = PluginRegistry.getInstance();
            const marpPlugin = registry.getAllExportPlugins().find(p => p.metadata.id === 'marp');
            if (!marpPlugin) {
                return {
                    success: false,
                    message: 'Marp export plugin is not available. Check plugins.disabled setting.'
                };
            }
            return await this.runMarpConversion(markdownPath, sourcePath, options, webviewPanel);
        }

        // Handle Pandoc conversion (only if runPandoc = Use Pandoc checkbox checked)
        if (options.runPandoc && options.pandocFormat) {
            // Check plugin availability via registry
            const registry = PluginRegistry.getInstance();
            const pandocPlugin = registry.getAllExportPlugins().find(p => p.metadata.id === 'pandoc');
            if (!pandocPlugin) {
                return {
                    success: false,
                    message: 'Pandoc export plugin is not available. Check plugins.disabled setting.'
                };
            }
            return await this.runPandocConversion(markdownPath, options, webviewPanel);
        }

        // Regular save succeeded
        return {
            success: true,
            message: `Exported to ${markdownPath}`,
            exportedPath: markdownPath
        };
    }

    /**
     * Preprocess diagrams in markdown files before export conversion.
     * Converts code block diagrams (Mermaid, PlantUML, etc.) and file diagrams
     * (Excalidraw, Draw.io) to SVG/PNG files for export compatibility.
     *
     * Processes ALL markdown files in the export folder (main + includes).
     *
     * @param markdownPath - Path to the main markdown file
     * @param webviewPanel - Optional webview panel for Mermaid rendering
     * @returns Processed path and optional cleanup function
     */
    private static async preprocessDiagrams(
        markdownPath: string,
        webviewPanel?: vscode.WebviewPanel | { getPanel(): vscode.WebviewPanel }
    ): Promise<{ processedPath: string; cleanup?: () => Promise<void> }> {
        const dir = path.dirname(markdownPath);
        const baseName = path.basename(markdownPath, '.md');

        try {
            // Resolve webview panel for Mermaid rendering
            const panel = webviewPanel ? ('getPanel' in webviewPanel ? webviewPanel.getPanel() : webviewPanel) : undefined;

            // Create diagram preprocessor (uses PluginRegistry; panel enables Mermaid rendering)
            const preprocessor = new DiagramPreprocessor(panel);

            // STEP 1: Preprocess ALL include files in the export folder
            // This ensures diagrams inside included files are also converted to SVG
            const allFiles = fs.readdirSync(dir);
            const includeFiles = allFiles.filter(f =>
                f.endsWith('.md') &&
                f !== `${baseName}.md` &&
                !f.endsWith('.preprocessed.md')
            );

            for (const includeFile of includeFiles) {
                const includeFilePath = path.join(dir, includeFile);
                const includeBaseName = path.basename(includeFile, '.md');

                try {
                    const includeResult = await preprocessor.preprocess(
                        includeFilePath,
                        dir,
                        includeBaseName
                    );

                    // If diagrams were processed, overwrite the include file
                    if (includeResult.diagramFiles.length > 0) {
                        await fs.promises.writeFile(includeFilePath, includeResult.processedMarkdown, 'utf8');
                        logger.debug(`[ExportService] Preprocessed diagrams in include file: ${includeFile}`);
                    }
                } catch (includeError) {
                    console.error(`[ExportService] Failed to preprocess include file ${includeFile}:`, includeError);
                    // Continue with other files
                }
            }

            // STEP 2: Preprocess the main file
            const preprocessResult = await preprocessor.preprocess(
                markdownPath,
                dir,
                baseName
            );

            // If diagrams were processed, write to temp file
            if (preprocessResult.diagramFiles.length > 0) {
                const tempFile = path.join(dir, `${baseName}.preprocessed.md`);
                await fs.promises.writeFile(tempFile, preprocessResult.processedMarkdown, 'utf8');

                return {
                    processedPath: tempFile,
                    cleanup: async () => {
                        try {
                            await fs.promises.unlink(tempFile);
                        } catch {
                            // Ignore cleanup errors
                        }
                    }
                };
            }
        } catch (error) {
            console.error('[ExportService] Diagram preprocessing failed:', error);
            showWarning(
                'Diagram preprocessing failed. Exporting without diagram conversion.'
            );
        }

        // No preprocessing needed or preprocessing failed — use original path
        return { processedPath: markdownPath };
    }

    /**
     * Run Marp conversion
     * Helper for outputContentNew
     * @param markdownPath - Path to the exported markdown file (in _Export folder)
     * @param sourceFilePath - Path to the original source Kanban file (for webview lookup)
     * @param webviewPanel - Optional webview panel for Mermaid diagram rendering (injected to avoid circular dependency)
     */
    private static async runMarpConversion(
        markdownPath: string,
        _sourceFilePath: string,  // Reserved for future path normalization
        options: NewExportOptions,
        webviewPanel?: vscode.WebviewPanel | { getPanel(): vscode.WebviewPanel }
    ): Promise<ExportResult> {
        const marpFormat: MarpOutputFormat = (options.marpFormat as MarpOutputFormat) || 'html';
        logger.debug(`[ExportService] runMarpConversion - marpFormat: ${marpFormat}, options.marpFormat: ${options.marpFormat}`);

        // Build output path
        const dir = path.dirname(markdownPath);
        const baseName = path.basename(markdownPath, '.md');

        // Preprocess diagrams (converts code block / file diagrams to SVG/PNG)
        const { processedPath: processedMarkdownPath, cleanup: preprocessCleanup } =
            await this.preprocessDiagrams(markdownPath, webviewPanel);

        let ext = '.html';
        switch (marpFormat) {
            case 'pdf': ext = '.pdf'; break;
            case 'pptx': ext = '.pptx'; break;
            case 'markdown': ext = '.md'; break;
            default: ext = '.html'; break;
        }
        const outputPath = path.join(dir, `${baseName}${ext}`);

        // Get MarpExportPlugin from registry
        const registry = PluginRegistry.getInstance();
        // Type-only cast: MarpExportPlugin extends ExportPlugin with marpExport()/isWatching()
        const marpPlugin = registry.getExportPluginById('marp') as (import('../../plugins/export/MarpExportPlugin').MarpExportPlugin) | undefined;
        if (!marpPlugin) {
            return {
                success: false,
                message: 'Marp export plugin is not available. Check plugins.disabled setting.'
            };
        }

        // MODE: PREVIEW (watch mode) - run Marp in watch mode
        if (options.marpWatch) {
            // Check if Marp is already watching this file (check PREPROCESSED path, not original)
            const isAlreadyWatching = marpPlugin.isWatching(processedMarkdownPath);
            if (isAlreadyWatching) {
                // DON'T cleanup - Marp is still watching the preprocessed file
                return {
                    success: true,
                    message: 'Markdown updated, Marp watch active',
                    exportedPath: outputPath,
                    // CRITICAL: Must return marpWatchPath to protect the Marp process
                    marpWatchPath: processedMarkdownPath
                };
            }

            try {
                await marpPlugin.marpExport({
                    inputFilePath: processedMarkdownPath, // Use preprocessed markdown
                    format: marpFormat,
                    outputPath: outputPath,
                    watchMode: true,
                    pptxEditable: options.marpPptxEditable,
                    enginePath: options.marpEnginePath,
                    theme: options.marpTheme,
                    handout: options.marpHandout,
                    handoutLayout: options.marpHandoutLayout,
                    handoutSlidesPerPage: options.marpHandoutSlidesPerPage,
                    handoutDirection: options.marpHandoutDirection,
                    handoutPdf: options.marpHandoutPdf
                });

                // DON'T cleanup in watch mode - Marp needs the preprocessed file to continue watching
                // The file will be cleaned up when watch mode is stopped

                return {
                    success: true,
                    message: 'Marp preview started',
                    exportedPath: outputPath,
                    // Return the path that Marp is actually watching (for stopAllMarpWatchesExcept protection)
                    marpWatchPath: processedMarkdownPath
                };
            } catch (error) {
                console.error(`[kanban.exportService.runMarpConversionNew] Realtime export failed:`, error);

                // Cleanup on error since Marp didn't start
                if (preprocessCleanup) {
                    await preprocessCleanup();
                }

                return {
                    success: false,
                    message: `Marp preview failed: ${getErrorMessage(error)}`
                };
            }
        }
        else {
            // MODE: SAVE (single conversion)
            try {
                await marpPlugin.marpExport({
                    inputFilePath: processedMarkdownPath, // Use preprocessed markdown
                    format: marpFormat,
                    outputPath: outputPath,
                    pptxEditable: options.marpPptxEditable,
                    enginePath: options.marpEnginePath,
                    theme: options.marpTheme,
                    handout: options.marpHandout,
                    handoutLayout: options.marpHandoutLayout,
                    handoutSlidesPerPage: options.marpHandoutSlidesPerPage,
                    handoutDirection: options.marpHandoutDirection,
                    handoutPdf: options.marpHandoutPdf
                });
                return {
                    success: true,
                    message: `Exported to ${outputPath}`,
                    exportedPath: outputPath
                };
            } catch (error) {
                console.error(`[kanban.exportService.runMarpConversion] Conversion failed:`, error);
                return {
                    success: false,
                    message: `Marp conversion failed: ${getErrorMessage(error)}`
                };
            } finally {
                // Cleanup preprocessed file
                if (preprocessCleanup) {
                    await preprocessCleanup();
                }
            }
        }
    }

    /**
     * Run Pandoc conversion for document export (DOCX, ODT, EPUB)
     * @param markdownPath - Path to the exported markdown file
     * @param options - Export options including pandocFormat
     * @param webviewPanel - Optional webview panel for Mermaid diagram rendering
     */
    private static async runPandocConversion(
        markdownPath: string,
        options: NewExportOptions,
        webviewPanel?: vscode.WebviewPanel | { getPanel(): vscode.WebviewPanel }
    ): Promise<ExportResult> {
        const pandocFormat: PandocOutputFormat = options.pandocFormat || 'docx';
        logger.debug(`[ExportService] runPandocConversion - pandocFormat: ${pandocFormat}`);

        // Get PandocExportPlugin from registry
        const registry = PluginRegistry.getInstance();
        // Type-only cast: PandocExportPlugin extends ExportPlugin with pandocExport()/isPandocAvailable()
        const pandocPlugin = registry.getExportPluginById('pandoc') as (import('../../plugins/export/PandocExportPlugin').PandocExportPlugin) | undefined;
        if (!pandocPlugin) {
            return {
                success: false,
                message: 'Pandoc export plugin is not available. Check plugins.disabled setting.'
            };
        }

        // Check availability
        const isAvailable = await pandocPlugin.isPandocAvailable();
        if (!isAvailable) {
            return {
                success: false,
                message: 'Pandoc is not installed. Please install from https://pandoc.org/installing.html'
            };
        }

        // Build output path
        const dir = path.dirname(markdownPath);
        const baseName = path.basename(markdownPath, '.md');
        const ext = pandocPlugin.getExtensionForFormat(pandocFormat);
        const outputPath = path.join(dir, `${baseName}${ext}`);

        // Preprocess diagrams (converts code block / file diagrams to SVG/PNG)
        const { processedPath: processedMarkdownPath, cleanup: preprocessCleanup } =
            await this.preprocessDiagrams(markdownPath, webviewPanel);

        try {
            await pandocPlugin.pandocExport({
                inputFilePath: processedMarkdownPath,
                format: pandocFormat,
                outputPath: outputPath
            });

            // Cleanup preprocessed file after export
            if (preprocessCleanup) {
                await preprocessCleanup();
            }

            // Open file after export if requested
            if (options.openAfterExport) {
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
            }

            return {
                success: true,
                message: `Exported to ${outputPath}`,
                exportedPath: outputPath
            };
        } catch (error) {
            // Cleanup on error too
            if (preprocessCleanup) {
                await preprocessCleanup();
            }
            console.error(`[ExportService.runPandocConversion] Conversion failed:`, error);
            return {
                success: false,
                message: `Pandoc conversion failed: ${getErrorMessage(error)}`
            };
        }
    }

    /**
     * NEW UNIFIED EXPORT ENTRY POINT
     * Replaces: exportWithAssets(), exportColumn(), exportUnified()
     *
     * This is the single entry point for ALL export operations.
     * Handles all scopes (full, column, task), all formats (kanban, presentation, marp),
     * and all modes (copy, save, auto, preview).
     *
     * @param board - Optional in-memory board object for presentation exports (avoids file parsing)
     * @param webviewPanel - Optional webview panel for Mermaid diagram rendering (injected to avoid circular dependency)
     * @param cancellationToken - Optional cancellation token to abort the export
     */
    public static async export(
        sourceDocument: vscode.TextDocument,
        options: NewExportOptions,
        board?: KanbanBoard,
        webviewPanel?: vscode.WebviewPanel | { getPanel(): vscode.WebviewPanel },
        cancellationToken?: vscode.CancellationToken
    ): Promise<ExportResult> {
        try {
            // Clear tracking map for new export
            this.exportedFiles.clear();

            // Check for cancellation
            if (cancellationToken?.isCancellationRequested) {
                return { success: false, message: 'Export cancelled.' };
            }

            // PHASE 1: EXTRACTION
            // Extract content from file
            const extracted = await this.extractContent(
                sourceDocument,
                options.columnIndexes
            );

            // Check for cancellation
            if (cancellationToken?.isCancellationRequested) {
                return { success: false, message: 'Export cancelled.' };
            }

            // PHASE 2: TRANSFORMATION
            const transformed = await this.transformContent(
                extracted,
                sourceDocument,
                options,
                board
            );

            // Check for cancellation
            if (cancellationToken?.isCancellationRequested) {
                return { success: false, message: 'Export cancelled.' };
            }

            // PHASE 3: OUTPUT
            const result = await this.outputContent(
                transformed,
                sourceDocument,
                options,
                webviewPanel
            );

            return result;

        } catch (error) {
            console.error('[kanban.exportService.export] Export failed:', error);
            return {
                success: false,
                message: `Export failed: ${getErrorMessage(error)}`
            };
        }
    }

}
