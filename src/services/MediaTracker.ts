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
import * as vscode from 'vscode';

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
    private _fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();
    private _onMediaChanged?: (files: ChangedMediaFile[]) => void;

    constructor(kanbanPath: string) {
        this._kanbanPath = kanbanPath;
        this._kanbanDir = path.dirname(kanbanPath);
        this._cachePath = this._getCachePath(kanbanPath);
        this._cache = this._loadCache();
    }

    /**
     * Set callback for when media files change
     * This enables real-time detection of changes to diagram files
     */
    public setOnMediaChanged(callback: (files: ChangedMediaFile[]) => void): void {
        this._onMediaChanged = callback;
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
            const cacheContent = JSON.stringify(this._cache, null, 2);
            console.log(`[MediaTracker] Saving cache to ${this._cachePath} with ${Object.keys(this._cache.files).length} files`);
            fs.writeFileSync(this._cachePath, cacheContent, 'utf8');
        } catch (error) {
            console.error(`[MediaTracker] Failed to save cache to ${this._cachePath}:`, error);
        }
    }

    /**
     * Get file type from extension
     * Handles compound extensions like .excalidraw.json and .excalidraw.svg
     */
    private _getMediaType(filePath: string): 'diagram' | 'image' | 'audio' | 'video' | 'document' | null {
        const lowerPath = filePath.toLowerCase();

        // Check for compound excalidraw extensions first
        if (lowerPath.endsWith('.excalidraw.json') ||
            lowerPath.endsWith('.excalidraw.svg') ||
            lowerPath.endsWith('.excalidraw')) {
            return 'diagram';
        }

        const ext = path.extname(filePath).toLowerCase();
        return MediaTracker.MEDIA_EXTENSIONS[ext] || null;
    }

    /**
     * Check if a file is an excalidraw file (handles compound extensions)
     */
    private _isExcalidrawFile(filePath: string): boolean {
        const lowerPath = filePath.toLowerCase();
        return lowerPath.endsWith('.excalidraw') ||
               lowerPath.endsWith('.excalidraw.json') ||
               lowerPath.endsWith('.excalidraw.svg');
    }

    /**
     * Check if a file is a drawio file
     */
    private _isDrawIOFile(filePath: string): boolean {
        const lowerPath = filePath.toLowerCase();
        return lowerPath.endsWith('.drawio') || lowerPath.endsWith('.dio');
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
            const mediaType = this._getMediaType(filePath);
            console.log(`[MediaTracker] extractMediaReferences: found image ref "${filePath}", mediaType=${mediaType}`);
            if (mediaType) {
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
        console.log(`[MediaTracker] updateTrackedFiles called with content length: ${content?.length || 0}`);
        const mediaRefs = this.extractMediaReferences(content);
        console.log(`[MediaTracker] Found ${mediaRefs.length} media reference(s) in content:`, mediaRefs);

        // Track which files are no longer referenced (for watcher cleanup)
        const oldFiles = new Set(Object.keys(this._cache.files));

        const trackedFiles: string[] = [];
        const newCache: Record<string, MediaFileEntry> = {};

        for (const relativePath of mediaRefs) {
            const absolutePath = this._resolveMediaPath(relativePath);
            const mediaType = this._getMediaType(relativePath);

            console.log(`[MediaTracker] Processing: "${relativePath}" -> type=${mediaType}, absolutePath="${absolutePath}"`);

            if (!mediaType) {
                console.log(`[MediaTracker] Skipping "${relativePath}" - unsupported media type`);
                continue;
            }

            const mtime = this._getFileMtime(absolutePath);
            if (mtime !== null) {
                console.log(`[MediaTracker] Tracking "${relativePath}" - mtime=${mtime}`);
                newCache[relativePath] = {
                    mtime: mtime,
                    type: mediaType
                };
                trackedFiles.push(relativePath);
                oldFiles.delete(relativePath); // Still referenced, don't cleanup
            } else {
                console.log(`[MediaTracker] File not found: "${absolutePath}"`);
            }
        }

        // Dispose watchers for files that are no longer tracked
        for (const removedPath of oldFiles) {
            this._disposeWatcher(removedPath);
        }

        this._cache.files = newCache;
        this._saveCache();

        console.log(`[MediaTracker] Updated tracking for ${trackedFiles.length} media file(s)`);
        return trackedFiles;
    }

    /**
     * Check for changed files by comparing current mtimes with cached mtimes.
     * This is the UNIFIED change detection method - both focus-based polling
     * and file watchers ultimately notify through _onMediaChanged callback.
     *
     * @param triggerCallback - If true (default), triggers _onMediaChanged callback when changes found
     * @returns List of files that have changed
     */
    public checkForChanges(triggerCallback: boolean = true): ChangedMediaFile[] {
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

            // UNIFIED: Notify through single callback (same path as file watchers)
            if (triggerCallback && this._onMediaChanged) {
                this._onMediaChanged(changedFiles);
            }
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
                const entry: MediaFileEntry = {
                    mtime: mtime,
                    type: mediaType
                };
                this._cache.files[relativePath] = entry;
                addedFiles.push(relativePath);

                // Set up file watcher for newly added diagram files (real-time change detection)
                if (mediaType === 'diagram') {
                    const isDrawIO = this._isDrawIOFile(relativePath);
                    const isExcalidraw = this._isExcalidrawFile(relativePath);
                    if (isDrawIO || isExcalidraw) {
                        this._watchFile(relativePath, entry);
                    }
                }
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
     * Setup file watchers for diagram files (drawio, excalidraw)
     * This enables real-time detection of changes when editing diagram files
     */
    public setupFileWatchers(): void {
        console.log(`[MediaTracker] Setting up file watchers. Cache has ${Object.keys(this._cache.files).length} files`);

        for (const [relativePath, entry] of Object.entries(this._cache.files)) {
            // Only watch diagram files (drawio, excalidraw)
            if (entry.type !== 'diagram') {
                continue;
            }

            const isDrawIO = this._isDrawIOFile(relativePath);
            const isExcalidraw = this._isExcalidrawFile(relativePath);

            console.log(`[MediaTracker] Checking diagram: ${relativePath}, isDrawIO=${isDrawIO}, isExcalidraw=${isExcalidraw}`);

            // Check if it's a drawio or excalidraw file using proper detection
            if (!isDrawIO && !isExcalidraw) {
                console.log(`[MediaTracker] Skipping non-diagram file: ${relativePath}`);
                continue;
            }

            this._watchFile(relativePath, entry);
        }

        console.log(`[MediaTracker] Setup file watchers for ${this._fileWatchers.size} diagram file(s)`);
    }

    /**
     * Watch a single file for changes
     */
    private _watchFile(relativePath: string, entry: MediaFileEntry): void {
        // Skip if already watching
        if (this._fileWatchers.has(relativePath)) {
            console.log(`[MediaTracker] Already watching: ${relativePath}`);
            return;
        }

        const absolutePath = this._resolveMediaPath(relativePath);
        console.log(`[MediaTracker] Creating watcher for: ${absolutePath}`);

        try {
            const watcher = vscode.workspace.createFileSystemWatcher(absolutePath);

            watcher.onDidChange(async () => {
                console.log(`[MediaTracker] File changed: ${relativePath}`);
                await this._handleFileChange(relativePath, entry);
            });

            watcher.onDidDelete(() => {
                console.log(`[MediaTracker] File deleted: ${relativePath}`);
                // Remove from cache
                delete this._cache.files[relativePath];
                this._saveCache();
                // Remove watcher
                this._disposeWatcher(relativePath);
            });

            this._fileWatchers.set(relativePath, watcher);
            console.log(`[MediaTracker] Watcher created successfully for: ${relativePath}`);
        } catch (error) {
            console.warn(`[MediaTracker] Failed to watch file ${relativePath}:`, error);
        }
    }

    /**
     * Handle file change event
     */
    private async _handleFileChange(relativePath: string, entry: MediaFileEntry): Promise<void> {
        const absolutePath = this._resolveMediaPath(relativePath);
        const newMtime = this._getFileMtime(absolutePath);

        if (newMtime === null) return;

        // Update cache
        const oldMtime = entry.mtime;
        entry.mtime = newMtime;
        this._saveCache();

        // Notify listeners
        if (this._onMediaChanged && newMtime !== oldMtime) {
            const changedFile: ChangedMediaFile = {
                path: relativePath,
                absolutePath: absolutePath,
                type: entry.type,
                oldMtime: oldMtime,
                newMtime: newMtime
            };
            this._onMediaChanged([changedFile]);
        }
    }

    /**
     * Dispose a single file watcher
     */
    private _disposeWatcher(relativePath: string): void {
        const watcher = this._fileWatchers.get(relativePath);
        if (watcher) {
            watcher.dispose();
            this._fileWatchers.delete(relativePath);
        }
    }

    /**
     * Dispose all file watchers
     */
    private _disposeAllWatchers(): void {
        for (const [, watcher] of this._fileWatchers) {
            watcher.dispose();
        }
        this._fileWatchers.clear();
    }

    /**
     * Dispose and save final state
     */
    public dispose(): void {
        this._disposeAllWatchers();
        this._saveCache();
    }
}
