import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { TagUtils, TagVisibility } from './utils/tagUtils';
import { PresentationParser } from './presentationParser';
import { PathResolver } from './services/PathResolver';
import { MarpExportService, MarpOutputFormat } from './services/export/MarpExportService';
import { DiagramPreprocessor } from './services/export/DiagramPreprocessor';
import { getMermaidExportService } from './services/export/MermaidExportService';
import { ConfigurationService } from './configurationService';
import { INCLUDE_SYNTAX } from './constants/IncludeConstants';
import { DOTTED_EXTENSIONS } from './shared/fileTypeDefinitions';
import { AssetHandler } from './services/assets/AssetHandler';
import { escapeRegExp } from './utils/stringUtils';

export type ExportFormat = 'keep' | 'kanban' | 'presentation' | 'marp-markdown' | 'marp-pdf' | 'marp-pptx' | 'marp-html';

/**
 * Export options - SINGLE unified system for ALL exports
 */
export interface NewExportOptions {
    // SELECTION: Column indexes to export (empty or undefined = full board)
    columnIndexes?: number[];

    // SCOPE: What to export
    scope?: 'board' | 'column' | 'task';

    // SELECTION: Specific item to export (for column/task scope)
    selection?: {
        columnIndex?: number;
        taskId?: string;
    };

    // MODE: Operation mode
    mode: 'copy' | 'save' | 'auto' | 'preview';
    // - copy: Return content only (for clipboard operations)
    // - save: Write to disk
    // - auto: Auto-export on save (registers save handler)
    // - preview: Open in Marp preview (realtime watch)

    // FORMAT: Output format
    format: 'kanban' | 'presentation' | 'marp';
    marpFormat?: 'markdown' | 'html' | 'pdf' | 'pptx';

    // TRANSFORMATIONS
    mergeIncludes?: boolean;
    tagVisibility: TagVisibility;

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
}

/**
 * Result of export operation
 */
export interface ExportResult {
    success: boolean;
    message: string;
    content?: string;                   // For mode: 'copy'
    exportedPath?: string;              // For mode: 'save'
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

export class ExportService {
    // Use centralized extension constants from fileTypeDefinitions.ts
    // This ensures consistency across all asset detection code

    // Include patterns for different include types
    // UNIFIED SYNTAX: All includes use !!!include()!!! - position determines behavior
    // Base pattern uses INCLUDE_SYNTAX.REGEX from centralized constants
    // For task includes, match the entire task line including the checkbox prefix
    // This prevents checkbox duplication when replacing with converted content
    // USES UNIFIED SYNTAX: !!!include()!!! in task title (position-based)
    private static readonly TASK_INCLUDE_PATTERN = /^(\s*)-\s*\[\s*\]\s*!!!include\(([^)]+)\)!!!/gm;
    // For column includes (position-based: !!!include()!!! in column header), match the entire column header line
    // Captures: prefix title, file path, and suffix (tags/other content)
    private static readonly COLUMN_INCLUDE_PATTERN = /^##\s+(.*?)!!!include\(([^)]+)\)!!!(.*?)$/gm;

    // Track MD5 hashes to detect duplicates
    private static fileHashMap = new Map<string, string>();
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
        protectedContent = protectedContent.replace(new RegExp(`${placeholder}(\\d+)${placeholder}`, 'g'), (match, index) => {
            return codeBlocks[parseInt(index)];
        });

        return protectedContent;
    }

    /**
     * Apply all content transformations in correct order
     * Order matters: speaker notes → HTML comments → HTML content
     * Only applies for presentation format exports
     */
    private static applyContentTransformations(content: string, options: NewExportOptions): string {
        // Only apply transformations for presentation format
        const isPresentationFormat = options.format === 'presentation' || options.format === 'marp';
        if (!isPresentationFormat) {
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

        return result;
    }

    /**
     * Process a markdown file and its assets
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
            convertToPresentation
        );

        // Rewrite links based on linkHandlingMode (BEFORE processing assets)
        // processAssets will ALSO rewrite paths for files it packs, but this handles unpacked links
        const shouldRewriteLinks = options.linkHandlingMode !== 'no-modify';
        const rewrittenContent = shouldRewriteLinks ? this.rewriteLinksForExport(
            processedContent,
            sourceDir,
            exportFolder,
            fileBasename,
            true
        ) : processedContent;

        // Filter assets based on options
        const assetsToInclude = this.filterAssets(assets, options);

        // Process assets and update content (this also rewrites paths for packed assets)
        const { modifiedContent, notIncludedAssets } = await this.processAssets(
            rewrittenContent,
            assetsToInclude,
            assets,
            mediaFolder,
            fileBasename
        );

        const stats = {
            includedCount: assetsToInclude.length,
            excludedCount: notIncludedAssets.length,
            includeFiles: includeStats
        };

        // Apply tag filtering to the content if specified
        // This ensures all markdown files (main and included) get tag filtering
        let filteredContent = this.applyTagFiltering(modifiedContent, options.tagVisibility);

        // Apply content transformations (speaker notes, HTML comments, HTML content)
        filteredContent = this.applyContentTransformations(filteredContent, options);

        return {
            exportedContent: filteredContent,
            notIncludedAssets,
            stats
        };
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
        const includePatterns = [
            {
                pattern: INCLUDE_SYNTAX.REGEX,
                replacement: (filename: string, prefixTitle: string = '', suffix: string = '') => `${INCLUDE_SYNTAX.PREFIX}${filename}${INCLUDE_SYNTAX.SUFFIX}`,
                shouldWriteSeparateFile: !mergeIncludes,
                includeType: 'include'
            },
            {
                pattern: this.TASK_INCLUDE_PATTERN,
                // UNIFIED SYNTAX: Use !!!include()!!! (position determines it's a task include)
                replacement: (filename: string, prefixTitle: string = '', suffix: string = '') => `${prefixTitle}- [ ] ${INCLUDE_SYNTAX.PREFIX}${filename}${INCLUDE_SYNTAX.SUFFIX}`,
                shouldWriteSeparateFile: !mergeIncludes,
                includeType: 'taskinclude'
            },
            {
                pattern: this.COLUMN_INCLUDE_PATTERN,
                replacement: (filename: string, prefixTitle: string = '', suffix: string = '') => `## ${prefixTitle}${INCLUDE_SYNTAX.PREFIX}${filename}${INCLUDE_SYNTAX.SUFFIX}${suffix}`,
                shouldWriteSeparateFile: !mergeIncludes,
                includeType: 'columninclude' // Internal type identifier (position-based detection)
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
                            exportedRelativePath = path.relative(exportFolder, existingPath).replace(/\\/g, '/');
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

        // Match markdown images: ![alt](path) and ![alt](path "title")
        const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;

        // Match markdown links: [text](path) and [text](path "title")
        const linkRegex = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;

        // Match HTML img tags: <img src="path">
        const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

        // Match HTML video/audio tags: <video src="path">, <audio src="path">
        const htmlMediaRegex = /<(?:video|audio)[^>]+src=["']([^"']+)["'][^>]*>/gi;

        // Process all matches
        const patterns = [
            imageRegex,
            linkRegex,
            htmlImgRegex,
            htmlMediaRegex
        ];

        patterns.forEach((regex) => {
            let match;
            while ((match = regex.exec(content)) !== null) {
                const rawPath = match[1].split(' ')[0].replace(/["']/g, ''); // Remove quotes and titles

                // Skip URLs
                if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
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

                    const relativePath = path.relative(markdownLocation, existingPath).replace(/\\/g, '/');
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
                const relativePath = path.join(`${fileBasename}-Media`, exportedFileName).replace(/\\/g, '/');
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
        const normalizedNewPath = newPath.replace(/\\/g, '/');

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
        // 1. Markdown images: ![alt](path)
        // 2. Markdown links: [text](path)
        // 3. HTML img/video/audio tags with src attribute
        // 4. Wiki-style links: [[path]] or [[path|text]]
        // NOTE: Angle brackets <...> are NOT included because they are ONLY for:
        //       - URL autolinks: <http://example.com>
        //       - Email autolinks: <user@example.com>
        //       - HTML tags: <br>, <hr>, etc.
        //       They are NEVER used for file paths in markdown!
        const linkPattern = /(!\[[^\]]*\]\([^)]+\))|((?<!!)\[[^\]]*\]\([^)]+\))|(<(?:img|video|audio)[^>]+src=["'][^"']+["'][^>]*>)|(\[\[[^\]]+\]\])/g;

        modifiedContent = modifiedContent.replace(linkPattern, (match) => {
            return this.processLink(match, sourceDir, exportFolder, fileBasename);
        });

        // Restore code blocks
        modifiedContent = modifiedContent.replace(new RegExp(`${codeBlockPlaceholder}(\\d+)${codeBlockPlaceholder}`, 'g'), (match, index) => {
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
            // Markdown image: ![alt](path)
            const match = link.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
            if (match) {
                const altText = match[1];
                filePath = match[2];
                linkStart = `![${altText}](`;
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

        // Clean the path (remove title attributes, etc.)
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
        const relativePath = path.relative(exportedFileDir, absoluteTargetPath).replace(/\\/g, '/');

        // Rebuild the link with the new path
        if (link.match(/^<(?:img|video|audio)/i)) {
            // Already handled above
            return link;
        } else {
            return `${linkStart}${relativePath}${linkEnd}`;
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
        fileBasename: string
    ): string {
        const absoluteSourcePath = path.resolve(sourceDir, oldPath);
        const relativePath = path.relative(exportFolder, absoluteSourcePath).replace(/\\/g, '/');
        
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
        const now = new Date();

        // Use local time instead of UTC (toISOString uses UTC/GMT)
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const timestamp = `${year}${month}${day}-${hours}${minutes}`;  // YYYYMMDD-HHmm

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

        // Rewrite links based on linkHandlingMode (BEFORE processing assets)
        // processAssets will ALSO rewrite paths for files it packs, but this handles unpacked links
        const shouldRewriteLinks = options.linkHandlingMode !== 'no-modify';
        const rewrittenContent = shouldRewriteLinks ? this.rewriteLinksForExport(
            processedContent,
            sourceDir,
            exportFolder,
            fileBasename,
            true
        ) : processedContent;

        // Filter assets based on options
        const assetsToInclude = this.filterAssets(assets, options);

        // Process assets and update content (this also rewrites paths for packed assets)
        const { modifiedContent, notIncludedAssets } = await this.processAssets(
            rewrittenContent,
            assetsToInclude,
            assets,
            mediaFolder,
            fileBasename
        );

        const stats = {
            includedCount: assetsToInclude.length,
            excludedCount: notIncludedAssets.length,
            includeFiles: includeStats
        };

        // Apply tag filtering to the content if specified
        // This ensures all markdown files (main and included) get tag filtering
        let filteredContent = this.applyTagFiltering(modifiedContent, options.tagVisibility);

        // Apply content transformations (speaker notes, HTML comments, HTML content)
        filteredContent = this.applyContentTransformations(filteredContent, options);

        // Convert to presentation format if requested
        if (convertToPresentation) {
            const { PresentationGenerator } = require('./services/export/PresentationGenerator');
            const config = ConfigurationService.getInstance();
            const marpConfig = config.getConfig('marp');

            filteredContent = PresentationGenerator.fromMarkdown(filteredContent, {
                includeMarpDirectives: true,  // Export always includes Marp directives
                marp: {
                    theme: (options as any).marpTheme || marpConfig.defaultTheme || 'default',
                    globalClasses: (options as any).marpGlobalClasses || marpConfig.globalClasses || [],
                    localClasses: (options as any).marpLocalClasses || marpConfig.localClasses || []
                }
            });
        }

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
    private static extractMarpClassesFromMarkdown(markdown: string, board: any): { global: string[], local: string[], perSlide: Map<number, string[]> } {
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

    private static filterBoard(board: any, options: NewExportOptions): any {
        // Check for columnIndexes (new export dialog system)
        if (options.columnIndexes && options.columnIndexes.length > 0) {
            const selectedColumns = options.columnIndexes
                .filter(index => index >= 0 && index < board.columns.length)
                .map(index => board.columns[index]);

            return {
                columns: selectedColumns
            };
        }

        // Fallback to old scope-based system
        if (!options.scope || options.scope === 'board') {
            return board;
        }

        if (options.scope === 'column' && options.selection?.columnIndex !== undefined) {
            const columnIndex = options.selection.columnIndex;
            if (columnIndex >= 0 && columnIndex < board.columns.length) {
                return {
                    columns: [board.columns[columnIndex]]
                };
            }
        }

        if (options.scope === 'task' && options.selection?.columnIndex !== undefined && options.selection?.taskId) {
            const columnIndex = options.selection.columnIndex;
            const taskId = options.selection.taskId;

            if (columnIndex >= 0 && columnIndex < board.columns.length) {
                const column = board.columns[columnIndex];
                const task = column.tasks?.find((t: any) => t.id === taskId);

                if (task) {
                    return {
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
        board?: any
    ): Promise<{ content: string; notIncludedAssets: ExportAssetInfo[] }> {

        const sourcePath = sourceDocument.uri.fsPath;
        const sourceDir = path.dirname(sourcePath);
        const sourceBasename = path.basename(sourcePath, '.md');
        const targetFolder = options.targetFolder || path.join(os.tmpdir(), 'kanban-export');

        let result = content;
        let notIncludedAssets: ExportAssetInfo[] = [];

        // ROUTING LOGIC:
        // - Converting format (presentation/marp) WITH includes → Use file-based pipeline
        // - Converting format (presentation/marp) WITHOUT includes → Use board-based (faster)
        // - Keeping original format (kanban) → Use file (kanban-markdown) to preserve formatting
        // - Asset packing → Use file to process includes correctly
        const convertToPresentation = (options.format === 'presentation' || options.format === 'marp');

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

        if (useBoardBasedConversion) {
            // BOARD-BASED PATH: Use in-memory board (includes already resolved)
            // Filter board based on scope and selection
            const filteredBoard = this.filterBoard(board, options);

            // Use unified presentation generator
            const { PresentationGenerator } = require('./services/export/PresentationGenerator');
            const config = ConfigurationService.getInstance();
            const marpConfig = config.getConfig('marp');

            // Extract marp classes from HTML comment directives in markdown
            // Global: from directive after YAML frontmatter
            // Per-slide: from directives before column/task lines
            const markdownContent = sourceDocument.getText();
            const marpClasses = this.extractMarpClassesFromMarkdown(markdownContent, filteredBoard);

            result = PresentationGenerator.fromBoard(filteredBoard, {
                includeMarpDirectives: true,  // Export always includes Marp directives
                stripIncludes: true,  // Strip include syntax (content already inlined in board)
                marp: {
                    theme: (options as any).marpTheme || marpConfig.defaultTheme || 'default',
                    globalClasses: marpClasses.global.length > 0 ? marpClasses.global : (marpConfig.globalClasses || []),
                    localClasses: marpClasses.local.length > 0 ? marpClasses.local : (marpConfig.localClasses || []),
                    perSlideClasses: marpClasses.perSlide
                }
            });

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

            // Don't return early - continue to outputContent phase for Marp CLI execution
        }
        // Use file-based pipeline when:
        // - Packing assets OR
        // - Converting format OR
        // - Need to process includes (mergeIncludes is false)
        else if (options.packAssets || options.format !== 'kanban' || needsIncludeProcessing) {
            // FILE-BASED PATH: Process raw markdown to handle includes correctly

            // Use existing processMarkdownContent (it does everything)
            const processed = await this.processMarkdownContent(
                result,
                sourceDir,
                sourceBasename,
                targetFolder,
                options,
                new Set<string>(),
                convertToPresentation,
                mergeIncludes
            );

            result = processed.exportedContent;
            notIncludedAssets = processed.notIncludedAssets;

        } else {
            // Simple path: tag filtering and link rewriting (no asset packing)
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
        options: NewExportOptions
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
        console.log('[ExportService] Writing markdown to:', markdownPath);
        console.log('[ExportService] Content length:', transformed.content.length);
        fs.writeFileSync(markdownPath, transformed.content, 'utf8');
        console.log('[ExportService] Markdown written successfully');

        // Handle Marp conversion
        if (options.format === 'marp') {
            return await this.runMarpConversion(markdownPath, sourcePath, options);
        }

        // Regular save succeeded
        return {
            success: true,
            message: `Exported to ${markdownPath}`,
            exportedPath: markdownPath
        };
    }

    /**
     * Run Marp conversion
     * Helper for outputContentNew
     * @param markdownPath - Path to the exported markdown file (in _Export folder)
     * @param sourceFilePath - Path to the original source Kanban file (for webview lookup)
     */
    private static async runMarpConversion(
        markdownPath: string,
        sourceFilePath: string,
        options: NewExportOptions
    ): Promise<ExportResult> {

        const marpFormat: MarpOutputFormat = (options.marpFormat as MarpOutputFormat) || 'html';

        // Build output path
        const dir = path.dirname(markdownPath);
        const baseName = path.basename(markdownPath, '.md');

        // DIAGRAM PREPROCESSING: Convert diagrams to SVG files before Marp processing
        // This ensures diagrams work in PDF exports
        let processedMarkdownPath = markdownPath;
        let preprocessCleanup: (() => Promise<void>) | undefined;

        try {
            // Get the webview panel for the SOURCE document (needed for Mermaid rendering)
            // NOTE: Use sourceFilePath, not markdownPath (which is the exported file)
            const docUri = vscode.Uri.file(sourceFilePath).toString();

            const { KanbanWebviewPanel } = await import('./kanbanWebviewPanel');
            const webviewPanel = KanbanWebviewPanel.getPanelForDocument(docUri);


            if (webviewPanel) {
                // Set up Mermaid export service with webview
                const mermaidService = getMermaidExportService();
                mermaidService.setWebviewPanel(webviewPanel.getPanel());
            } else {
                console.warn('[ExportService] ⚠️ No webview panel found for document. Mermaid diagrams will not be converted.');
                console.warn('[ExportService] Document URI:', docUri);
                console.warn('[ExportService] Available panels:', KanbanWebviewPanel.getAllPanels().length);
            }

            // Create diagram preprocessor
            const preprocessor = new DiagramPreprocessor(webviewPanel ? webviewPanel.getPanel() : undefined);

            // Preprocess diagrams
            const preprocessResult = await preprocessor.preprocess(
                markdownPath,
                dir,
                baseName
            );

            // If diagrams were processed, write to temp file
            if (preprocessResult.diagramFiles.length > 0) {
                // Write processed markdown to temp file
                const tempFile = path.join(dir, `${baseName}.preprocessed.md`);
                await fs.promises.writeFile(tempFile, preprocessResult.processedMarkdown, 'utf8');

                processedMarkdownPath = tempFile;

                // Setup cleanup function
                preprocessCleanup = async () => {
                    try {
                        await fs.promises.unlink(tempFile);
                    } catch (error) {
                        // Ignore cleanup errors
                    }
                };
            }
        } catch (error) {
            console.error('[ExportService] Diagram preprocessing failed:', error);
            // Continue with original file if preprocessing fails
            vscode.window.showWarningMessage(
                'Diagram preprocessing failed. Exporting without diagram conversion.'
            );
        }
        let ext = '.html';
        switch (marpFormat) {
            case 'pdf': ext = '.pdf'; break;
            case 'pptx': ext = '.pptx'; break;
            case 'markdown': ext = '.md'; break;
            default: ext = '.html'; break;
        }
        const outputPath = path.join(dir, `${baseName}${ext}`);

        // MODE: PREVIEW (watch mode) - run Marp in watch mode
        if (options.marpWatch) {
            // Check if Marp is already watching this file (check PREPROCESSED path, not original)
            if (MarpExportService.isWatching(processedMarkdownPath)) {
                // DON'T cleanup - Marp is still watching the preprocessed file
                return {
                    success: true,
                    message: 'Markdown updated, Marp watch active',
                    exportedPath: outputPath
                };
            }

            try {
                await MarpExportService.export({
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
                    exportedPath: outputPath
                };
            } catch (error) {
                console.error(`[kanban.exportService.runMarpConversionNew] Realtime export failed:`, error);

                // Cleanup on error since Marp didn't start
                if (preprocessCleanup) {
                    await preprocessCleanup();
                }

                return {
                    success: false,
                    message: `Marp preview failed: ${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
        else {
            // MODE: SAVE (single conversion)
            try {
                await MarpExportService.export({
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
                    message: `Marp conversion failed: ${error instanceof Error ? error.message : String(error)}`
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
     * NEW UNIFIED EXPORT ENTRY POINT
     * Replaces: exportWithAssets(), exportColumn(), exportUnified()
     *
     * This is the single entry point for ALL export operations.
     * Handles all scopes (full, column, task), all formats (kanban, presentation, marp),
     * and all modes (copy, save, auto, preview).
     *
     * @param board - Optional in-memory board object for presentation exports (avoids file parsing)
     */
    public static async export(
        sourceDocument: vscode.TextDocument,
        options: NewExportOptions,
        board?: any
    ): Promise<ExportResult> {
        console.log('[ExportService.export] Called with:');
        console.log('  - sourceDocument:', sourceDocument.uri.fsPath);
        console.log('  - options.mode:', options.mode);
        console.log('  - options.format:', options.format);
        console.log('  - options.marpWatch:', options.marpWatch);
        console.log('  - options.targetFolder:', options.targetFolder);
        console.log('  - board provided:', !!board);

        try {
            // Clear tracking maps for new export
            this.fileHashMap.clear();
            this.exportedFiles.clear();

            // PHASE 1: EXTRACTION
            // Extract content from file
            const extracted = await this.extractContent(
                sourceDocument,
                options.columnIndexes
            );

            // PHASE 2: TRANSFORMATION
            const transformed = await this.transformContent(
                extracted,
                sourceDocument,
                options,
                board
            );

            // PHASE 3: OUTPUT
            const result = await this.outputContent(
                transformed,
                sourceDocument,
                options
            );

            return result;

        } catch (error) {
            console.error('[kanban.exportService.export] Export failed:', error);
            return {
                success: false,
                message: `Export failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

}