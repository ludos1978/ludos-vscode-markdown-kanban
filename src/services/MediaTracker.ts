/**
 * MediaTracker Service
 *
 * Tracks modification times of media files referenced in kanban boards.
 * Persists mtimes to a cache file (.{kanban-name}.mediacache.json) for
 * change detection across sessions.
 *
 * Supported media types:
 * - Diagrams: .drawio, .dio, .excalidraw
 * - Images: .png, .jpg, .jpeg, .gif, .svg, .webp, .avif, .bmp, .ico
 * - Audio: .mp3, .wav, .ogg, .m4a, .flac, .aac
 * - Video: .mp4, .webm, .mov, .avi, .mkv
 * - Documents: .pdf
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarkdownPatterns, HtmlPatterns } from '../shared/regexPatterns';
import {
    DRAWIO_EXTENSIONS,
    EXCALIDRAW_EXTENSIONS,
    isDrawioFile,
    isExcalidrawFile,
    DOTTED_EXTENSIONS
} from '../constants/FileExtensions';
import { getMediaCachePath } from '../constants/FileNaming';
import { safeDecodeURIComponent } from '../utils/stringUtils';

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

    // Build MEDIA_EXTENSIONS from centralized constants
    private static readonly MEDIA_EXTENSIONS: Record<string, 'diagram' | 'image' | 'audio' | 'video' | 'document'> = {
        // Diagrams (from centralized extensions)
        ...Object.fromEntries([...DRAWIO_EXTENSIONS, ...EXCALIDRAW_EXTENSIONS].map(ext => [ext, 'diagram' as const])),
        // Images (from centralized DOTTED_EXTENSIONS)
        ...Object.fromEntries(DOTTED_EXTENSIONS.image.map(ext => [ext, 'image' as const])),
        // Audio (from centralized DOTTED_EXTENSIONS)
        ...Object.fromEntries(DOTTED_EXTENSIONS.audio.map(ext => [ext, 'audio' as const])),
        // Video (from centralized DOTTED_EXTENSIONS)
        ...Object.fromEntries(DOTTED_EXTENSIONS.video.map(ext => [ext, 'video' as const])),
        // Documents - only PDF for media tracking
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
        return getMediaCachePath(kanbanPath);
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
            fs.writeFileSync(this._cachePath, cacheContent, 'utf8');
        } catch (error) {
            console.error(`[MediaTracker] Failed to save cache:`, error);
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

    // Note: Using imported isExcalidrawFile and isDrawioFile from FileExtensions

    /**
     * Resolve a relative path to absolute path
     */
    private _resolveMediaPath(relativePath: string): string {
        // Handle various path formats
        let cleanPath = relativePath;

        // Remove URL encoding
        cleanPath = safeDecodeURIComponent(cleanPath);

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

        // Use shared patterns for consistency
        const patterns = [
            MarkdownPatterns.image(),
            MarkdownPatterns.link(),
            HtmlPatterns.img(),
            HtmlPatterns.media()
        ];

        for (const regex of patterns) {
            let match;
            while ((match = regex.exec(content)) !== null) {
                const filePath = match[1];
                if (this._getMediaType(filePath)) {
                    mediaFiles.add(filePath);
                }
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

        // Track which files are no longer referenced (for watcher cleanup)
        const oldFiles = new Set(Object.keys(this._cache.files));

        const trackedFiles: string[] = [];
        const newCache: Record<string, MediaFileEntry> = {};

        for (const relativePath of mediaRefs) {
            const absolutePath = this._resolveMediaPath(relativePath);
            const mediaType = this._getMediaType(relativePath);

            if (!mediaType) {
                continue;
            }

            const mtime = this._getFileMtime(absolutePath);
            if (mtime !== null) {
                const entry: MediaFileEntry = {
                    mtime: mtime,
                    type: mediaType
                };
                newCache[relativePath] = entry;
                trackedFiles.push(relativePath);
                oldFiles.delete(relativePath); // Still referenced, don't cleanup

                // Set up file watcher for diagram files (if not already watching)
                if (mediaType === 'diagram') {
                    const isDrawIO = isDrawioFile(relativePath);
                    const isExcalidraw = isExcalidrawFile(relativePath);
                    if (isDrawIO || isExcalidraw) {
                        this._watchFile(relativePath, entry);
                    }
                }
            }
        }

        // Dispose watchers for files that are no longer tracked
        for (const removedPath of oldFiles) {
            this._disposeWatcher(removedPath);
        }

        this._cache.files = newCache;
        this._saveCache();

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

            if (currentMtime === null) {
                // File no longer exists - skip
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
                    const isDrawIO = isDrawioFile(relativePath);
                    const isExcalidraw = isExcalidrawFile(relativePath);
                    if (isDrawIO || isExcalidraw) {
                        this._watchFile(relativePath, entry);
                    }
                }
            }
        }

        if (addedFiles.length > 0) {
            this._saveCache();
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
        for (const [relativePath, entry] of Object.entries(this._cache.files)) {
            // Only watch diagram files (drawio, excalidraw)
            if (entry.type !== 'diagram') {
                continue;
            }

            const isDrawIO = isDrawioFile(relativePath);
            const isExcalidraw = isExcalidrawFile(relativePath);

            // Check if it's a drawio or excalidraw file using proper detection
            if (!isDrawIO && !isExcalidraw) {
                continue;
            }

            this._watchFile(relativePath, entry);
        }
    }

    /**
     * Watch a single file for changes
     */
    private _watchFile(relativePath: string, entry: MediaFileEntry): void {
        // Skip if already watching
        if (this._fileWatchers.has(relativePath)) {
            return;
        }

        const absolutePath = this._resolveMediaPath(relativePath);

        try {
            const watcher = vscode.workspace.createFileSystemWatcher(absolutePath);

            watcher.onDidChange(async () => {
                await this._handleFileChange(relativePath, entry);
            });

            watcher.onDidDelete(() => {
                // Remove from cache
                delete this._cache.files[relativePath];
                this._saveCache();
                // Remove watcher
                this._disposeWatcher(relativePath);
            });

            this._fileWatchers.set(relativePath, watcher);
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
