/**
 * MediaTracker Service
 *
 * Tracks modification times of media files referenced in kanban boards.
 * Persists mtimes to a cache file (.{kanban-name}.mediacache.json) for
 * change detection across sessions.
 *
 * Supported media types:
 * - Diagrams: .drawio, .dio, .excalidraw
 * - Images: .png, .jpg, .jpeg, .gif, .svg, .webp, .bmp, .ico
 * - Audio: .mp3, .wav, .ogg, .m4a, .flac, .aac
 * - Video: .mp4, .webm, .mov, .avi, .mkv
 * - Documents: .pdf
 */

import * as fs from 'fs';
import * as path from 'path';

interface MediaFileEntry {
    mtime: number;
    type: 'diagram' | 'image' | 'audio' | 'video' | 'document';
}

interface MediaCacheData {
    version: number;
    kanbanPath: string;
    lastUpdated: string;
    files: Record<string, MediaFileEntry>;
}

export interface ChangedMediaFile {
    path: string;
    absolutePath: string;
    type: 'diagram' | 'image' | 'audio' | 'video' | 'document';
    oldMtime: number | null;
    newMtime: number;
}

export class MediaTracker {
    private static readonly CACHE_VERSION = 1;

    // Media file extensions by type
    private static readonly MEDIA_EXTENSIONS: Record<string, 'diagram' | 'image' | 'audio' | 'video' | 'document'> = {
        // Diagrams
        '.drawio': 'diagram',
        '.dio': 'diagram',
        '.excalidraw': 'diagram',
        // Images
        '.png': 'image',
        '.jpg': 'image',
        '.jpeg': 'image',
        '.gif': 'image',
        '.svg': 'image',
        '.webp': 'image',
        '.bmp': 'image',
        '.ico': 'image',
        // Audio
        '.mp3': 'audio',
        '.wav': 'audio',
        '.ogg': 'audio',
        '.m4a': 'audio',
        '.flac': 'audio',
        '.aac': 'audio',
        // Video
        '.mp4': 'video',
        '.webm': 'video',
        '.mov': 'video',
        '.avi': 'video',
        '.mkv': 'video',
        // Documents
        '.pdf': 'document'
    };

    private _kanbanPath: string;
    private _kanbanDir: string;
    private _cachePath: string;
    private _cache: MediaCacheData;

    constructor(kanbanPath: string) {
        this._kanbanPath = kanbanPath;
        this._kanbanDir = path.dirname(kanbanPath);
        this._cachePath = this._getCachePath(kanbanPath);
        this._cache = this._loadCache();
    }

    /**
     * Get cache file path for a kanban file
     * e.g., /path/to/myboard.kanban.md -> /path/to/.myboard.kanban.md.mediacache.json
     */
    private _getCachePath(kanbanPath: string): string {
        const dir = path.dirname(kanbanPath);
        const basename = path.basename(kanbanPath);
        return path.join(dir, `.${basename}.mediacache.json`);
    }

    /**
     * Load cache from disk or create empty cache
     */
    private _loadCache(): MediaCacheData {
        try {
            if (fs.existsSync(this._cachePath)) {
                const data = fs.readFileSync(this._cachePath, 'utf8');
                const cache = JSON.parse(data) as MediaCacheData;

                // Validate cache version and kanban path
                if (cache.version === MediaTracker.CACHE_VERSION &&
                    cache.kanbanPath === this._kanbanPath) {
                    return cache;
                }
            }
        } catch (error) {
            console.warn(`[MediaTracker] Failed to load cache: ${error}`);
        }

        // Return empty cache
        return {
            version: MediaTracker.CACHE_VERSION,
            kanbanPath: this._kanbanPath,
            lastUpdated: new Date().toISOString(),
            files: {}
        };
    }

    /**
     * Save cache to disk
     */
    private _saveCache(): void {
        try {
            this._cache.lastUpdated = new Date().toISOString();
            fs.writeFileSync(this._cachePath, JSON.stringify(this._cache, null, 2), 'utf8');
        } catch (error) {
            console.error(`[MediaTracker] Failed to save cache: ${error}`);
        }
    }

    /**
     * Get file type from extension
     */
    private _getMediaType(filePath: string): 'diagram' | 'image' | 'audio' | 'video' | 'document' | null {
        const ext = path.extname(filePath).toLowerCase();
        return MediaTracker.MEDIA_EXTENSIONS[ext] || null;
    }

    /**
     * Resolve a relative path to absolute path
     */
    private _resolveMediaPath(relativePath: string): string {
        // Handle various path formats
        let cleanPath = relativePath;

        // Remove URL encoding
        cleanPath = decodeURIComponent(cleanPath);

        // Handle paths that start with ./
        if (cleanPath.startsWith('./')) {
            cleanPath = cleanPath.substring(2);
        }

        // Resolve relative to kanban directory
        if (!path.isAbsolute(cleanPath)) {
            return path.resolve(this._kanbanDir, cleanPath);
        }

        return cleanPath;
    }

    /**
     * Extract media file references from kanban content
     * Looks for markdown image/link syntax: ![alt](path) or [text](path)
     */
    public extractMediaReferences(content: string): string[] {
        const mediaFiles: Set<string> = new Set();

        // Match markdown images: ![alt](path)
        const imageRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
        let match;

        while ((match = imageRegex.exec(content)) !== null) {
            const filePath = match[1];
            if (this._getMediaType(filePath)) {
                mediaFiles.add(filePath);
            }
        }

        // Match markdown links that point to media: [text](path)
        const linkRegex = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

        while ((match = linkRegex.exec(content)) !== null) {
            const filePath = match[1];
            if (this._getMediaType(filePath)) {
                mediaFiles.add(filePath);
            }
        }

        // Match HTML img tags: <img src="path">
        const htmlImgRegex = /<img[^>]+src=["']([^"']+)["']/gi;

        while ((match = htmlImgRegex.exec(content)) !== null) {
            const filePath = match[1];
            if (this._getMediaType(filePath)) {
                mediaFiles.add(filePath);
            }
        }

        // Match HTML audio/video tags
        const htmlMediaRegex = /<(?:audio|video)[^>]+src=["']([^"']+)["']/gi;

        while ((match = htmlMediaRegex.exec(content)) !== null) {
            const filePath = match[1];
            if (this._getMediaType(filePath)) {
                mediaFiles.add(filePath);
            }
        }

        return Array.from(mediaFiles);
    }

    /**
     * Get current mtime for a file
     */
    private _getFileMtime(absolutePath: string): number | null {
        try {
            const stats = fs.statSync(absolutePath);
            return stats.mtimeMs;
        } catch {
            return null;
        }
    }

    /**
     * Update cache with current media files from kanban content
     * Returns list of all tracked files
     */
    public updateTrackedFiles(content: string): string[] {
        const mediaRefs = this.extractMediaReferences(content);
        console.log(`[MediaTracker] Found ${mediaRefs.length} media reference(s) in content:`, mediaRefs);

        const trackedFiles: string[] = [];
        const newCache: Record<string, MediaFileEntry> = {};

        for (const relativePath of mediaRefs) {
            const absolutePath = this._resolveMediaPath(relativePath);
            const mediaType = this._getMediaType(relativePath);

            if (!mediaType) continue;

            const mtime = this._getFileMtime(absolutePath);
            if (mtime !== null) {
                newCache[relativePath] = {
                    mtime: mtime,
                    type: mediaType
                };
                trackedFiles.push(relativePath);
            }
        }

        this._cache.files = newCache;
        this._saveCache();

        console.log(`[MediaTracker] Updated tracking for ${trackedFiles.length} media file(s)`);
        return trackedFiles;
    }

    /**
     * Check for changed files by comparing current mtimes with cached mtimes
     * Returns list of files that have changed
     */
    public checkForChanges(): ChangedMediaFile[] {
        const changedFiles: ChangedMediaFile[] = [];

        for (const [relativePath, entry] of Object.entries(this._cache.files)) {
            const absolutePath = this._resolveMediaPath(relativePath);
            const currentMtime = this._getFileMtime(absolutePath);

            console.log(`[MediaTracker] Checking ${relativePath}: cached=${entry.mtime}, current=${currentMtime}, path=${absolutePath}`);

            if (currentMtime === null) {
                // File no longer exists - skip
                console.log(`[MediaTracker] File not found: ${absolutePath}`);
                continue;
            }

            if (currentMtime !== entry.mtime) {
                changedFiles.push({
                    path: relativePath,
                    absolutePath: absolutePath,
                    type: entry.type,
                    oldMtime: entry.mtime,
                    newMtime: currentMtime
                });

                // Update cache with new mtime
                entry.mtime = currentMtime;
            }
        }

        if (changedFiles.length > 0) {
            this._saveCache();
            console.log(`[MediaTracker] Detected ${changedFiles.length} changed media file(s):`,
                changedFiles.map(f => f.path));
        }

        return changedFiles;
    }

    /**
     * Add more media files to tracking from additional content (e.g., include files)
     * Unlike updateTrackedFiles, this APPENDS to existing cache instead of replacing
     * Returns list of newly added files
     */
    public addTrackedFiles(content: string): string[] {
        const mediaRefs = this.extractMediaReferences(content);
        const addedFiles: string[] = [];

        for (const relativePath of mediaRefs) {
            // Skip if already tracked
            if (this._cache.files[relativePath]) {
                continue;
            }

            const absolutePath = this._resolveMediaPath(relativePath);
            const mediaType = this._getMediaType(relativePath);

            if (!mediaType) continue;

            const mtime = this._getFileMtime(absolutePath);
            if (mtime !== null) {
                this._cache.files[relativePath] = {
                    mtime: mtime,
                    type: mediaType
                };
                addedFiles.push(relativePath);
            }
        }

        if (addedFiles.length > 0) {
            this._saveCache();
            console.log(`[MediaTracker] Added ${addedFiles.length} media file(s) from include content`);
        }

        return addedFiles;
    }

    /**
     * Get all currently tracked files
     */
    public getTrackedFiles(): Array<{ path: string; type: string; mtime: number }> {
        return Object.entries(this._cache.files).map(([path, entry]) => ({
            path,
            type: entry.type,
            mtime: entry.mtime
        }));
    }

    /**
     * Clear all tracked files and delete cache
     */
    public clearCache(): void {
        this._cache.files = {};
        try {
            if (fs.existsSync(this._cachePath)) {
                fs.unlinkSync(this._cachePath);
            }
        } catch (error) {
            console.warn(`[MediaTracker] Failed to delete cache file: ${error}`);
        }
    }

    /**
     * Dispose and save final state
     */
    public dispose(): void {
        this._saveCache();
    }
}
