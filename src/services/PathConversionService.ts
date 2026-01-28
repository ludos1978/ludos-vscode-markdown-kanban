/**
 * PathConversionService
 *
 * Converts paths between absolute and relative formats in markdown content.
 * Handles:
 * - Markdown images: ![alt](path)
 * - Markdown links: [text](path)
 * - HTML img tags: <img src="path">
 * - Include syntax: !!!include(path)!!!
 *
 * Excludes URLs (http://, https://, data:, blob:)
 */

import * as path from 'path';
import { toForwardSlashes, safeDecodeURIComponent } from '../utils/stringUtils';

/**
 * Information about a detected path in content
 */
export interface PathInfo {
    /** Original path string as found in content */
    original: string;
    /** Type of markdown element containing the path */
    type: 'image' | 'link' | 'html-img' | 'include';
    /** Start index of the path in the full match */
    matchStart: number;
    /** End index of the path in the full match */
    matchEnd: number;
    /** Start index of just the path portion */
    pathStart: number;
    /** End index of just the path portion */
    pathEnd: number;
    /** Whether this is an absolute path */
    isAbsolute: boolean;
    /** Whether this is a URL (should be skipped) */
    isUrl: boolean;
}

/**
 * Result of a path conversion operation
 */
export interface ConversionResult {
    /** Updated content with converted paths */
    content: string;
    /** Number of paths converted */
    converted: number;
    /** Number of paths skipped (already in target format or URLs) */
    skipped: number;
    /** Warning messages for potentially broken paths */
    warnings: string[];
}

/**
 * Singleton service for path conversion operations
 */
export class PathConversionService {
    private static _instance: PathConversionService | undefined;

    // Regex patterns for path detection
    // Note: These capture the full match and the path separately
    private static readonly PATTERNS = {
        // Markdown image: ![alt](path "optional title")
        // Captures: full match, path
        IMAGE: /!\[[^\]]*\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g,

        // Markdown link: [text](path "optional title")
        // Uses negative lookbehind to exclude images (which start with !)
        // Captures: full match, path
        LINK: /(?<!!)\[[^\]]*\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g,

        // HTML img: <img src="path"> or <img src='path'>
        // Captures: full match, path
        HTML_IMG: /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,

        // Include syntax: !!!include(path)!!!
        // Captures: full match, path
        INCLUDE: /!!!include\(([^)]+)\)!!!/g,

        // URL pattern to identify paths that should be skipped
        URL: /^(https?:|data:|blob:|file:)/i,

        // Windows drive letter pattern
        WINDOWS_DRIVE: /^[a-zA-Z]:/
    };

    private constructor() {
        // Private constructor for singleton
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): PathConversionService {
        if (!PathConversionService._instance) {
            PathConversionService._instance = new PathConversionService();
        }
        return PathConversionService._instance;
    }

    /**
     * Check if a path is a URL (should be skipped during conversion)
     */
    public isUrl(pathStr: string): boolean {
        return PathConversionService.PATTERNS.URL.test(pathStr);
    }

    /**
     * Check if a path is absolute
     */
    public isAbsolutePath(filePath: string): boolean {
        if (!filePath) return false;

        // Decode URL-encoded paths first
        const decoded = safeDecodeURIComponent(filePath);

        // Check for URLs (not file paths)
        if (this.isUrl(decoded)) return false;

        // Check for various absolute path formats
        return (
            path.isAbsolute(decoded) ||
            PathConversionService.PATTERNS.WINDOWS_DRIVE.test(decoded) ||
            decoded.startsWith('/')
        );
    }

    /**
     * Extract paths from content using a pattern and add them via callback.
     * Common helper for path extraction loops.
     */
    private extractPathsWithPattern(
        content: string,
        pattern: RegExp,
        type: PathInfo['type'],
        addPath: (info: Omit<PathInfo, 'isAbsolute' | 'isUrl'> & { isAbsolute: boolean; isUrl: boolean }) => void
    ): void {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            const pathStr = match[1];
            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;
            const pathStart = match.index + match[0].indexOf(pathStr);
            const pathEnd = pathStart + pathStr.length;

            addPath({
                original: pathStr,
                type,
                matchStart,
                matchEnd,
                pathStart,
                pathEnd,
                isAbsolute: this.isAbsolutePath(pathStr),
                isUrl: this.isUrl(pathStr)
            });
        }
    }

    /**
     * Convert an absolute path to relative
     */
    public toRelativePath(absolutePath: string, basePath: string): string {
        if (!absolutePath || !basePath) return absolutePath;

        // Decode URL-encoded paths
        const decoded = safeDecodeURIComponent(absolutePath);

        // Skip URLs
        if (this.isUrl(decoded)) return absolutePath;

        // Skip already relative paths - they're already in the target format
        if (!this.isAbsolutePath(decoded)) {
            return absolutePath;
        }

        // Calculate relative path
        const relative = path.relative(basePath, decoded);

        // Normalize to forward slashes
        let normalized = toForwardSlashes(relative);

        // Add ./ prefix for same-directory or child paths that don't start with . or /
        if (!normalized.startsWith('.') && !normalized.startsWith('/')) {
            normalized = './' + normalized;
        }

        return normalized;
    }

    /**
     * Convert a relative path to absolute
     */
    public toAbsolutePath(relativePath: string, basePath: string): string {
        if (!relativePath || !basePath) return relativePath;

        // Decode URL-encoded paths
        const decoded = safeDecodeURIComponent(relativePath);

        // If already absolute, return as-is
        if (this.isAbsolutePath(decoded)) {
            return decoded;
        }

        // Resolve relative to base path
        return path.resolve(basePath, decoded);
    }

    /**
     * Extract all paths from content
     */
    public extractPaths(content: string): PathInfo[] {
        const paths: PathInfo[] = [];
        const processedRanges: Array<{ start: number; end: number }> = [];

        // Helper to check if a range overlaps with already processed ranges
        const overlapsProcessed = (start: number, end: number): boolean => {
            return processedRanges.some(
                range => !(end <= range.start || start >= range.end)
            );
        };

        // Helper to add a path and track its range
        const addPath = (pathInfo: PathInfo): void => {
            if (!overlapsProcessed(pathInfo.matchStart, pathInfo.matchEnd)) {
                paths.push(pathInfo);
                processedRanges.push({ start: pathInfo.matchStart, end: pathInfo.matchEnd });
            }
        };

        // Process images first (they take precedence over links due to ! prefix)
        this.extractPathsWithPattern(content, new RegExp(PathConversionService.PATTERNS.IMAGE.source, 'g'), 'image', addPath);

        // Process HTML images
        this.extractPathsWithPattern(content, new RegExp(PathConversionService.PATTERNS.HTML_IMG.source, 'gi'), 'html-img', addPath);

        // Process includes
        this.extractPathsWithPattern(content, new RegExp(PathConversionService.PATTERNS.INCLUDE.source, 'g'), 'include', addPath);

        // Process regular links (after images to avoid duplicates)
        this.extractPathsWithPattern(content, new RegExp(PathConversionService.PATTERNS.LINK.source, 'g'), 'link', addPath);

        // Sort by position for consistent processing
        paths.sort((a, b) => a.pathStart - b.pathStart);

        return paths;
    }

    /**
     * Convert all absolute paths in content to relative paths
     */
    public convertToRelative(content: string, basePath: string): ConversionResult {
        const paths = this.extractPaths(content);
        let result = content;
        let offset = 0;
        let converted = 0;
        let skipped = 0;
        const warnings: string[] = [];

        for (const pathInfo of paths) {
            // Skip URLs
            if (pathInfo.isUrl) {
                skipped++;
                continue;
            }

            // Skip already relative paths
            if (!pathInfo.isAbsolute) {
                skipped++;
                continue;
            }

            // Skip empty paths
            if (!pathInfo.original.trim()) {
                skipped++;
                continue;
            }

            try {
                const relativePath = this.toRelativePath(pathInfo.original, basePath);

                // Perform replacement
                const adjustedStart = pathInfo.pathStart + offset;
                const adjustedEnd = pathInfo.pathEnd + offset;
                result = result.slice(0, adjustedStart) + relativePath + result.slice(adjustedEnd);

                // Update offset for subsequent replacements
                offset += relativePath.length - pathInfo.original.length;
                converted++;

                // Warn if the path contains parent traversal that might break
                if (relativePath.includes('../../../')) {
                    warnings.push(`Deep path traversal: ${relativePath}`);
                }
            } catch (error) {
                warnings.push(`Failed to convert: ${pathInfo.original}`);
                skipped++;
            }
        }

        return { content: result, converted, skipped, warnings };
    }

    /**
     * Convert all relative paths in content to absolute paths
     */
    public convertToAbsolute(content: string, basePath: string): ConversionResult {
        const paths = this.extractPaths(content);
        let result = content;
        let offset = 0;
        let converted = 0;
        let skipped = 0;
        const warnings: string[] = [];

        for (const pathInfo of paths) {
            // Skip URLs
            if (pathInfo.isUrl) {
                skipped++;
                continue;
            }

            // Skip already absolute paths
            if (pathInfo.isAbsolute) {
                skipped++;
                continue;
            }

            // Skip empty paths
            if (!pathInfo.original.trim()) {
                skipped++;
                continue;
            }

            try {
                const absolutePath = this.toAbsolutePath(pathInfo.original, basePath);

                // Perform replacement
                const adjustedStart = pathInfo.pathStart + offset;
                const adjustedEnd = pathInfo.pathEnd + offset;
                result = result.slice(0, adjustedStart) + absolutePath + result.slice(adjustedEnd);

                // Update offset for subsequent replacements
                offset += absolutePath.length - pathInfo.original.length;
                converted++;
            } catch (error) {
                warnings.push(`Failed to convert: ${pathInfo.original}`);
                skipped++;
            }
        }

        return { content: result, converted, skipped, warnings };
    }

    /**
     * Analyze content and return statistics about paths
     */
    public analyzeContent(content: string): {
        total: number;
        absolute: number;
        relative: number;
        urls: number;
        byType: Record<string, number>;
    } {
        const paths = this.extractPaths(content);

        const byType: Record<string, number> = {
            image: 0,
            link: 0,
            'html-img': 0,
            include: 0
        };

        let absolute = 0;
        let relative = 0;
        let urls = 0;

        for (const p of paths) {
            byType[p.type]++;
            if (p.isUrl) {
                urls++;
            } else if (p.isAbsolute) {
                absolute++;
            } else {
                relative++;
            }
        }

        return {
            total: paths.length,
            absolute,
            relative,
            urls,
            byType
        };
    }
}
