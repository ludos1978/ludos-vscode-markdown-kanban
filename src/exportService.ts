import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { TagUtils, TagVisibility } from './utils/tagUtils';
import { MarkdownKanbanParser } from './markdownParser';
import { PresentationParser } from './presentationParser';
import { ContentPipelineService } from './services/content/ContentPipelineService';
import { OperationOptionsBuilder, OperationOptions, FormatStrategy } from './services/OperationOptions';
import { PathResolver } from './services/PathResolver';
import { MarpExportService, MarpOutputFormat } from './services/export/MarpExportService';
import { DiagramPreprocessor } from './services/export/DiagramPreprocessor';
import { getMermaidExportService } from './services/export/MermaidExportService';

export type ExportScope = 'full' | 'row' | 'stack' | 'column' | 'task';
export type ExportFormat = 'keep' | 'kanban' | 'presentation' | 'marp-markdown' | 'marp-pdf' | 'marp-pptx' | 'marp-html';

/**
 * Export options - SINGLE unified system for ALL exports
 */
export interface NewExportOptions {
    // SELECTION: Column indexes to export (empty or undefined = full board)
    columnIndexes?: number[];

    // SCOPE: What to export
    // scope?: 'board' | 'column' | 'task';

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

export interface AssetInfo {
    originalPath: string;
    resolvedPath: string;
    relativePath: string;
    type: 'image' | 'video' | 'audio' | 'document' | 'file' | 'markdown';
    size: number;
    exists: boolean;
    md5?: string;
}

interface ProcessedAsset {
    original: AssetInfo;
    exportedPath: string;
    exportedRelativePath: string;
}

export class ExportService {
    private static readonly IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];
    private static readonly VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
    private static readonly AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'];
    private static readonly DOCUMENT_EXTENSIONS = ['.pdf', '.epub', '.doc', '.docx', '.txt'];

    // Include patterns for different include types
    // UNIFIED SYNTAX: All includes use !!!include()!!! - position determines behavior
    private static readonly INCLUDE_PATTERN = /!!!include\s*\(([^)]+)\)\s*!!!/g;
    // For task includes, match the entire task line including the checkbox prefix
    // This prevents checkbox duplication when replacing with converted content
    // USES UNIFIED SYNTAX: !!!include()!!! in task title (position-based)
    private static readonly TASK_INCLUDE_PATTERN = /^(\s*)-\s*\[\s*\]\s*!!!include\s*\(([^)]+)\)\s*!!!/gm;
    // For column includes (position-based: !!!include()!!! in column header), match the entire column header line
    // Captures: prefix title, file path, and suffix (tags/other content)
    private static readonly COLUMN_INCLUDE_PATTERN = /^##\s+(.*?)!!!include\s*\(([^)]+)\)\s*!!!(.*?)$/gm;

    // Track MD5 hashes to detect duplicates
    private static fileHashMap = new Map<string, string>();
    private static exportedFiles = new Map<string, string>(); // MD5 -> exported path
    
    // Track Marp watch processes to avoid multiple instances
    private static marpWatchProcesses = new Map<string, boolean>(); // markdownPath -> isWatching
    private static marpProcessPids = new Map<string, number>(); // markdownPath -> process PID

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
     * Ensure YAML frontmatter exists in kanban content
     * Adds standard kanban YAML header if not present
     */
    private static ensureYamlFrontmatter(content: string): string {
        // Check if content already has YAML frontmatter
        const hasYaml = content.trim().startsWith('---');

        if (hasYaml) {
            // Already has YAML, return as-is
            return content;
        }

        // Add standard kanban YAML frontmatter
        const yamlHeader = '---\n\nkanban-plugin: board\n\n---\n\n';
        return yamlHeader + content;
    }

    /**
     * Process a markdown file and its assets
     * uses obsolete data structures: ExportOptions
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
        notIncludedAssets: AssetInfo[];
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
        const filteredContent = this.applyTagFiltering(modifiedContent, options.tagVisibility);

        return {
            exportedContent: filteredContent,
            notIncludedAssets,
            stats
        };
    }

    /**
     * Process included markdown files
     * uses obsolete data structures: ExportOptions
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
                pattern: this.INCLUDE_PATTERN,
                replacement: (filename: string, prefixTitle: string = '', suffix: string = '') => `!!!include(${filename})!!!`,
                shouldWriteSeparateFile: !mergeIncludes,
                includeType: 'include'
            },
            {
                pattern: this.TASK_INCLUDE_PATTERN,
                // UNIFIED SYNTAX: Use !!!include()!!! (position determines it's a task include)
                replacement: (filename: string, prefixTitle: string = '', suffix: string = '') => `${prefixTitle}- [ ] !!!include(${filename})!!!`,
                shouldWriteSeparateFile: !mergeIncludes,
                includeType: 'taskinclude'
            },
            {
                pattern: this.COLUMN_INCLUDE_PATTERN,
                replacement: (filename: string, prefixTitle: string = '', suffix: string = '') => `## ${prefixTitle}!!!include(${filename})!!!${suffix}`,
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
     */
    private static async calculateMD5(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath);
            const stats = fs.statSync(filePath);

            let bytesRead = 0;
            const maxBytes = stats.size > 1024 * 1024 ? 1024 * 1024 : stats.size; // 1MB for files > 1MB

            stream.on('data', (chunk) => {
                bytesRead += chunk.length;
                if (bytesRead <= maxBytes) {
                    hash.update(chunk);
                } else {
                    const remaining = maxBytes - (bytesRead - chunk.length);
                    if (remaining > 0) {
                        hash.update(Buffer.isBuffer(chunk) ? chunk.subarray(0, remaining) : chunk.slice(0, remaining));
                    }
                    // Resolve immediately when we've read enough data
                    stream.destroy();
                    resolve(hash.digest('hex'));
                    return;
                }
            });

            stream.on('end', () => {
                resolve(hash.digest('hex'));
            });

            stream.on('error', reject);
        });
    }

    /**
     * Find all assets referenced in the markdown content
     */
    private static findAssets(content: string, sourceDir: string): AssetInfo[] {
        const assets: AssetInfo[] = [];

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
     */
    private static getAssetType(filePath: string): AssetInfo['type'] {
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.md') { return 'markdown'; }
        if (this.IMAGE_EXTENSIONS.includes(ext)) { return 'image'; }
        if (this.VIDEO_EXTENSIONS.includes(ext)) { return 'video'; }
        if (this.AUDIO_EXTENSIONS.includes(ext)) { return 'audio'; }
        if (this.DOCUMENT_EXTENSIONS.includes(ext)) { return 'document'; }

        return 'file';
    }

    /**
     * Filter assets based on export options
     * uses obsolete data structures: ExportOptions
     */
    private static filterAssets(assets: AssetInfo[], options: NewExportOptions): AssetInfo[] {
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
        assetsToInclude: AssetInfo[],
        allAssets: AssetInfo[],
        mediaFolder: string,
        fileBasename: string
    ): Promise<{ modifiedContent: string; notIncludedAssets: AssetInfo[] }> {
        let modifiedContent = content;
        const notIncludedAssets: AssetInfo[] = [];
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
        const escapedOldPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
        // 5. Angle bracket links: <path>
        const linkPattern = /(!\[[^\]]*\]\([^)]+\))|((?<!!)\[[^\]]*\]\([^)]+\))|(<(?:img|video|audio)[^>]+src=["'][^"']+["'][^>]*>)|(\[\[[^\]]+\]\])|(<[^>]+>)/g;

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
        } else if (link.startsWith('<') && link.endsWith('>')) {
            // Angle bracket link: <path>
            // Validate that it's an actual link, not an HTML tag like <hr> or <br>
            const content = link.slice(1, -1);

            // Check if it's an actual link (has file extension, path separator, or starts with http)
            const hasExtension = /\.[a-zA-Z0-9]+$/.test(content);
            const hasPathSeparator = content.includes('/') || content.includes('\\');
            const isUrl = /^https?:\/\//i.test(content);

            if (hasExtension || hasPathSeparator || isUrl) {
                filePath = content;
                linkStart = '<';
                linkEnd = '>';
            } else {
                // It's an HTML tag like <hr>, <br>, etc. - don't treat as link
                return link;
            }
        }

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
     * Create _not_included.md file with excluded assets
     */
    private static async createNotIncludedFile(notIncludedAssets: AssetInfo[], targetFolder: string): Promise<void> {
        // Ensure target folder exists
        if (!fs.existsSync(targetFolder)) {
            fs.mkdirSync(targetFolder, { recursive: true });
        }

        const content = [
            '# Assets Not Included in Export',
            '',
            'The following assets were not included in this export:',
            ''
        ];

        // Group by reason for exclusion
        const missingAssets = notIncludedAssets.filter(a => !a.exists);
        const oversizedAssets = notIncludedAssets.filter(a => a.exists && a.size > 100 * 1024 * 1024);
        const excludedByType = notIncludedAssets.filter(a => a.exists && a.size <= 100 * 1024 * 1024);

        if (missingAssets.length > 0) {
            content.push('## Missing Files');
            content.push('');
            missingAssets.forEach(asset => {
                content.push(`- [${path.basename(asset.originalPath)}](${asset.originalPath}) - File not found`);
            });
            content.push('');
        }

        if (oversizedAssets.length > 0) {
            content.push('## Files Too Large');
            content.push('');
            oversizedAssets.forEach(asset => {
                const sizeMB = Math.round(asset.size / (1024 * 1024) * 100) / 100;
                content.push(`- [${path.basename(asset.originalPath)}](${asset.originalPath}) - ${sizeMB} MB`);
            });
            content.push('');
        }

        if (excludedByType.length > 0) {
            content.push('## Excluded by Type');
            content.push('');
            excludedByType.forEach(asset => {
                content.push(`- [${path.basename(asset.originalPath)}](${asset.originalPath}) - ${asset.type}`);
            });
            content.push('');
        }

        const notIncludedPath = path.join(targetFolder, '_not_included.md');
        fs.writeFileSync(notIncludedPath, content.join('\n'), 'utf8');
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
        notIncludedAssets: AssetInfo[];
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

        // Convert to presentation format if requested
        if (convertToPresentation) {
            const { PresentationGenerator } = require('./services/export/PresentationGenerator');
            filteredContent = PresentationGenerator.fromMarkdown(filteredContent, {
                includeMarpDirectives: true,  // Export always includes Marp directives
                marp: { theme: (options as any).marpTheme || 'default' }
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
     * Sanitize column name for use in filename
     */
    private static sanitizeColumnName(columnTitle: string | undefined, columnIndex: number): string {
        if (columnTitle) {
            // Remove special characters and spaces, replace with underscores
            return columnTitle
                .replace(/[^a-zA-Z0-9]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')
                .toLowerCase();
        } else {
            return `Row${columnIndex}`;
        }
    }

    /**
     * Get row number from column title (defaults to 1)
     */
    private static getColumnRow(title: string): number {
        if (!title) { return 1; }
        const rowMatches = title.match(/#row(\d+)\b/gi);
        if (rowMatches && rowMatches.length > 0) {
            const lastMatch = rowMatches[rowMatches.length - 1];
            const num = parseInt(lastMatch.replace(/#row/i, ''), 10);
            return isNaN(num) ? 1 : num;
        }
        return 1;
    }

    /**
     * Check if column has #stack tag
     */
    private static isColumnStacked(title: string): boolean {
        return /#stack\b/i.test(title);
    }

    /**
     * Extract all columns content from a specific row
     */
    private static extractRowContent(markdownContent: string, rowNumber: number): string | null {
        const isKanban = markdownContent.includes('kanban-plugin: board');
        if (!isKanban) { return null; }

        const lines = markdownContent.split('\n');
        const rowColumns: string[] = [];
        let currentColumn: { content: string[]; row: number } | null = null;

        for (const line of lines) {
            if (line.startsWith('## ')) {
                // Save previous column if it's in the target row
                if (currentColumn && currentColumn.row === rowNumber) {
                    rowColumns.push(currentColumn.content.join('\n'));
                }
                // Start new column
                const columnRow = this.getColumnRow(line);
                currentColumn = { content: [line], row: columnRow };
            } else if (currentColumn) {
                currentColumn.content.push(line);
            }
        }

        // Don't forget the last column
        if (currentColumn && currentColumn.row === rowNumber) {
            rowColumns.push(currentColumn.content.join('\n'));
        }

        return rowColumns.length > 0 ? rowColumns.join('\n\n') : null;
    }

    /**
     * Extract stack content (consecutive stacked columns in same row)
     * A stack includes: base column (without #stack) + all consecutive #stack columns after it
     */
    private static extractStackContent(markdownContent: string, rowNumber: number, stackIndex: number): string | null {

        const isKanban = markdownContent.includes('kanban-plugin: board');
        if (!isKanban) { return null; }

        const lines = markdownContent.split('\n');

        // First, collect all columns in the target row
        const rowColumns: { content: string; stacked: boolean; title: string }[] = [];
        let currentColumn: { content: string[]; row: number; stacked: boolean } | null = null;

        for (const line of lines) {
            if (line.startsWith('## ')) {
                // Save previous column if it's in the target row
                if (currentColumn && currentColumn.row === rowNumber) {
                    rowColumns.push({
                        content: currentColumn.content.join('\n'),
                        stacked: currentColumn.stacked,
                        title: currentColumn.content[0]
                    });
                }

                // Start new column
                const columnRow = this.getColumnRow(line);
                const isStacked = this.isColumnStacked(line);
                currentColumn = { content: [line], row: columnRow, stacked: isStacked };
            } else if (currentColumn) {
                currentColumn.content.push(line);
            }
        }

        // Don't forget the last column
        if (currentColumn && currentColumn.row === rowNumber) {
            rowColumns.push({
                content: currentColumn.content.join('\n'),
                stacked: currentColumn.stacked,
                title: currentColumn.content[0]
            });
        }

        // Now group columns into stacks (matching frontend logic)
        // A stack is: base column + all consecutive #stack columns
        const stacks: string[][] = [];
        let i = 0;

        while (i < rowColumns.length) {
            const currentStack = [rowColumns[i].content]; // Start with base column
            i++;

            // Add all consecutive #stack columns to this stack
            while (i < rowColumns.length && rowColumns[i].stacked) {
                currentStack.push(rowColumns[i].content);
                i++;
            }

            stacks.push(currentStack);
        }

        if (stackIndex >= stacks.length) {
            return null;
        }

        const result = stacks[stackIndex].join('\n\n');
        return result;
    }

    /**
     * Extract single task content from a column
     */
    private static extractTaskContent(columnContent: string, taskId?: string): string | null {
        const lines = columnContent.split('\n');
        const tasks: string[] = [];
        let currentTask: string[] = [];
        let inTask = false;

        for (const line of lines) {
            if (line.trim().startsWith('---')) {
                // Task separator
                if (currentTask.length > 0) {
                    tasks.push(currentTask.join('\n'));
                    currentTask = [];
                }
                inTask = true;
            } else if (inTask) {
                currentTask.push(line);
            }
        }

        // Don't forget the last task
        if (currentTask.length > 0) {
            tasks.push(currentTask.join('\n'));
        }

        // If taskId provided, find specific task; otherwise return first
        return tasks.length > 0 ? tasks[0] : null;
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
    private static filterBoard(board: any, options: NewExportOptions): any {
        // Check for columnIndexes (new export dialog system)
        if (options.columnIndexes && options.columnIndexes.length > 0) {
            console.log(`[kanban.exportService.filterBoard] Filtering board: ${board.columns.length} total columns, selecting indexes ${options.columnIndexes.join(', ')}`);
            const selectedColumns = options.columnIndexes
                .filter(index => index >= 0 && index < board.columns.length)
                .map(index => board.columns[index]);

            console.log(`[kanban.exportService.filterBoard] Filtered to ${selectedColumns.length} columns`);
            return {
                columns: selectedColumns
            };
        }

        // Fallback to old scope-based system
        // if (!options.scope || options.scope === 'board') {
        //     return board;
        // }

        // if (options.scope === 'column' && options.selection?.columnIndex !== undefined) {
        //     const columnIndex = options.selection.columnIndex;
        //     if (columnIndex >= 0 && columnIndex < board.columns.length) {
        //         return {
        //             columns: [board.columns[columnIndex]]
        //         };
        //     }
        // }

        // if (options.scope === 'task' && options.selection?.columnIndex !== undefined && options.selection?.taskId) {
        //     const columnIndex = options.selection.columnIndex;
        //     const taskId = options.selection.taskId;

        //     if (columnIndex >= 0 && columnIndex < board.columns.length) {
        //         const column = board.columns[columnIndex];
        //         const task = column.tasks?.find((t: any) => t.id === taskId);

        //         if (task) {
        //             return {
        //                 columns: [{
        //                     id: column.id,
        //                     title: '',
        //                     tasks: [task]
        //                 }]
        //             };
        //         }
        //     }
        // }

        return board;
    }




    /**
     * Add Marp process PID for tracking
     * @param markdownPath Path to the markdown file being watched
     * @param pid Process ID of the Marp process
     */
    public static addMarpProcessPid(markdownPath: string, pid: number): void {
        this.marpProcessPids.set(markdownPath, pid);
    }

    /**
     * Stop Marp watch process for a specific file
     * @param markdownPath Path to the markdown file being watched
     */
    public static stopMarpWatch(markdownPath: string): void {
        const pid = this.marpProcessPids.get(markdownPath);
        if (pid) {
            try {
                // Kill the Marp process
                process.kill(pid, 'SIGTERM');
            } catch (error) {
                console.error(`[kanban.exportService.stopMarpWatch] Failed to kill process ${pid}:`, error);
            }
            this.marpProcessPids.delete(markdownPath);
        }

        if (this.marpWatchProcesses.has(markdownPath)) {
            this.marpWatchProcesses.delete(markdownPath);
        }
    }

    /**
     * Stop all Marp watch processes except for generated files from a specific kanban file
     * @param kanbanFilePath Path to the kanban file whose generated files should NOT be stopped
     */
    public static stopAllMarpWatchesExceptKanbanFile(kanbanFilePath: string): void {
        // Get the base name of the kanban file without extension
        const kanbanBaseName = path.basename(kanbanFilePath, '.md');
        const kanbanDir = path.dirname(kanbanFilePath);

        // Kill all tracked Marp processes except those generated from the current kanban file
        for (const [markdownPath, pid] of this.marpProcessPids.entries()) {
            const markdownBaseName = path.basename(markdownPath, '.md');
            const markdownDir = path.dirname(markdownPath);

            // Check if this markdown file is a generated file from the current kanban
            const isGeneratedFromCurrentKanban =
                markdownDir.startsWith(kanbanDir) &&
                (markdownBaseName.startsWith(kanbanBaseName) ||
                 markdownBaseName.includes(kanbanBaseName));

            if (!isGeneratedFromCurrentKanban) {
                try {
                    process.kill(pid, 'SIGTERM');
                } catch (error) {
                    console.error(`[kanban.exportService.stopAllMarpWatchesExceptKanbanFile] Failed to kill process ${pid}:`, error);
                }
                this.marpProcessPids.delete(markdownPath);
                this.marpWatchProcesses.delete(markdownPath);
            }
        }
    }

    /**
     * Stop all Marp watch processes except for a specific file
     * @param excludeFilePath Path to the file whose Marp process should NOT be stopped
     */
    public static stopAllMarpWatchesExcept(excludeFilePath?: string): void {
        // Kill all tracked Marp processes except the excluded one
        for (const [markdownPath, pid] of this.marpProcessPids.entries()) {
            if (markdownPath !== excludeFilePath) {
                try {
                    process.kill(pid, 'SIGTERM');
                } catch (error) {
                    console.error(`[kanban.exportService.stopAllMarpWatchesExcept] Failed to kill process ${pid}:`, error);
                }
                this.marpProcessPids.delete(markdownPath);
                this.marpWatchProcesses.delete(markdownPath);
            }
        }
    }

    /**
     * Stop all Marp watch processes
     */
    public static stopAllMarpWatches(): void {
        // Kill all tracked Marp processes
        for (const [, pid] of this.marpProcessPids.entries()) {
            try {
                process.kill(pid, 'SIGTERM');
            } catch (error) {
                console.error(`[kanban.exportService.stopAllMarpWatches] Failed to kill process ${pid}:`, error);
            }
        }

        this.marpProcessPids.clear();
        this.marpWatchProcesses.clear();
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
    ): Promise<{ content: string; notIncludedAssets: AssetInfo[] }> {

        const sourcePath = sourceDocument.uri.fsPath;
        const sourceDir = path.dirname(sourcePath);
        const sourceBasename = path.basename(sourcePath, '.md');

        let result = content;
        let notIncludedAssets: AssetInfo[] = [];

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
        const hasIncludes = result.includes('!!!include(');
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
            console.log('[ExportService.transformContent] Taking BOARD-BASED path');
            // Filter board based on scope and selection
            const filteredBoard = this.filterBoard(board, options);

            // Use unified presentation generator
            const { PresentationGenerator } = require('./services/export/PresentationGenerator');

            result = PresentationGenerator.fromBoard(filteredBoard, {
                includeMarpDirectives: true,  // Export always includes Marp directives
                stripIncludes: true,  // Strip include syntax (content already inlined in board)
                marp: { theme: (options as any).marpTheme || 'default' }
            });

            // Rewrite links if requested
            if (options.linkHandlingMode !== 'no-modify') {
                result = this.rewriteLinksForExport(
                    result,
                    sourceDir,
                    options.targetFolder || path.join(os.tmpdir(), 'kanban-export'),
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
            console.log('[ExportService.transformContent] Taking FILE-BASED path');
            console.log('[ExportService.transformContent] Input content length:', result.length);

            // Use existing processMarkdownContent (it does everything)
            const processed = await this.processMarkdownContent(
                result,
                sourceDir,
                sourceBasename,
                options.targetFolder || path.join(os.tmpdir(), 'kanban-export'),
                options,
                new Set<string>(),
                convertToPresentation,
                mergeIncludes
            );

            result = processed.exportedContent;
            notIncludedAssets = processed.notIncludedAssets;
            console.log('[ExportService.transformContent] Output content length:', result.length);

        } else {
            console.log('[ExportService.transformContent] Taking SIMPLE path (no conversion)');
            // Simple path: tag filtering and link rewriting (no asset packing)
            result = this.applyTagFiltering(result, options.tagVisibility);

            // Rewrite links if requested
            if (options.linkHandlingMode !== 'no-modify') {
                result = this.rewriteLinksForExport(
                    result,
                    sourceDir,
                    options.targetFolder || path.join(os.tmpdir(), 'kanban-export'),
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
        transformed: { content: string; notIncludedAssets: AssetInfo[] },
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
        let outputBasename = sourceBasename;

        // Add suffix for partial exports (when specific columns selected)
        if (options.columnIndexes && options.columnIndexes.length > 0) {
            outputBasename = `${sourceBasename}-partial`;
        }

        // Write markdown file
        const markdownPath = path.join(options.targetFolder, `${outputBasename}.md`);
        fs.writeFileSync(markdownPath, transformed.content, 'utf8');

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
            console.log('[ExportService] Looking for webview panel for SOURCE file:', sourceFilePath);
            console.log('[ExportService] Source URI:', docUri);

            const { KanbanWebviewPanel } = await import('./kanbanWebviewPanel');
            const webviewPanel = KanbanWebviewPanel.getPanelForDocument(docUri);

            console.log('[ExportService] Webview panel found:', webviewPanel ? 'YES' : 'NO');

            if (webviewPanel) {
                console.log('[ExportService] Setting webview panel on MermaidExportService');
                // Set up Mermaid export service with webview
                const mermaidService = getMermaidExportService();
                mermaidService.setWebviewPanel(webviewPanel.getPanel());
                console.log('[ExportService] MermaidExportService ready:', mermaidService.isReady());
            } else {
                console.warn('[ExportService] ⚠️ No webview panel found for document. Mermaid diagrams will not be converted.');
                console.warn('[ExportService] Document URI:', docUri);
                console.warn('[ExportService] Available panels:', KanbanWebviewPanel.getAllPanels().length);
            }

            // Create diagram preprocessor
            const preprocessor = new DiagramPreprocessor(webviewPanel ? webviewPanel.getPanel() : undefined);

            // Preprocess diagrams
            console.log('[ExportService] Preprocessing diagrams for Marp export...');
            const preprocessResult = await preprocessor.preprocess(
                markdownPath,
                dir,
                baseName
            );

            // If diagrams were processed, write to temp file
            if (preprocessResult.diagramFiles.length > 0) {
                console.log(`[ExportService] Processed ${preprocessResult.diagramFiles.length} diagrams`);

                // Write processed markdown to temp file
                const tempFile = path.join(dir, `${baseName}.preprocessed.md`);
                await fs.promises.writeFile(tempFile, preprocessResult.processedMarkdown, 'utf8');

                processedMarkdownPath = tempFile;

                // Setup cleanup function
                preprocessCleanup = async () => {
                    try {
                        await fs.promises.unlink(tempFile);
                        console.log('[ExportService] Cleaned up preprocessed markdown file');
                    } catch (error) {
                        // Ignore cleanup errors
                    }
                };
            } else {
                console.log('[ExportService] No diagrams found, using original markdown');
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
                console.log(`[ExportService] Marp already watching ${processedMarkdownPath}, file updated automatically`);
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
                    enginePath: options.marpEnginePath,
                    theme: options.marpTheme
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
                    enginePath: options.marpEnginePath,
                    theme: options.marpTheme
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
        try {
            // Clear tracking maps for new export
            this.fileHashMap.clear();
            this.exportedFiles.clear();

            // PHASE 1: EXTRACTION
            // Determine if we need to extract content from file
            // Skip extraction only when using board-based conversion (mergeIncludes: true)
            const mergeIncludes = options.mergeIncludes ?? false;
            let extracted: string;

            // Extract content from file (needed for file-based pipeline)
            extracted = await this.extractContent(
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