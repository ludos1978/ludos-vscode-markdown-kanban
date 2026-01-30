/**
 * WebImageSearchService - Interactive web image search with Playwright
 *
 * Opens a headed browser to an image search engine, injects an overlay
 * that lets the user visually select an image. The selected image is
 * downloaded and saved locally.
 *
 * @module services/WebImageSearchService
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BrowserService } from './BrowserService';
import { pluginConfigService } from './PluginConfigService';
import { logger } from '../utils/logger';

/** Browser profile directory — per-user, shared across workspaces */
const BROWSER_PROFILE_DIR = path.join(os.homedir(), '.kanban', 'browser-profile');

/**
 * Result of a successful image search and selection
 */
export interface WebImageSearchResult {
    /** Absolute path to the downloaded image file */
    filePath: string;
    /** Original URL the image was fetched from */
    sourceUrl: string;
}

/**
 * Search engine URL templates
 */
const SEARCH_ENGINE_URLS: Record<string, string> = {
    google: 'https://www.google.com/search?q=${query}&tbm=isch',
    kagi: 'https://kagi.com/images?q=${query}',
    bing: 'https://www.bing.com/images/search?q=${query}',
    duckduckgo: 'https://duckduckgo.com/?q=${query}&iax=images&ia=images'
};

/**
 * Content-type to file extension mapping
 */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/ico': '.ico',
    'image/x-icon': '.ico',
    'image/tiff': '.tiff',
    'image/avif': '.avif'
};

/**
 * Overlay injection script - adds hover overlays with "Select" button on images.
 * Injected via page.addInitScript() so it runs before page scripts.
 */
/**
 * Floating overlay approach: a single fixed-position overlay that tracks
 * the hovered image via getBoundingClientRect(). No DOM wrapping — avoids
 * breaking search engine layouts and click/hover handlers.
 */
const OVERLAY_SCRIPT = `
(function() {
    'use strict';
    var STYLE_ID = '_kanban_image_select_style';
    var MIN_SIZE = 50;
    var overlay = null;
    var currentImg = null;

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '#_kanban_overlay {',
            '  position: fixed;',
            '  background: rgba(59,130,246,0.3);',
            '  display: flex;',
            '  align-items: center;',
            '  justify-content: center;',
            '  z-index: 2147483647;',
            '  pointer-events: none;',
            '  opacity: 0;',
            '  transition: opacity 0.15s;',
            '}',
            '#_kanban_overlay.visible {',
            '  opacity: 1;',
            '  pointer-events: auto;',
            '}',
            '#_kanban_overlay button {',
            '  background: #2563eb;',
            '  color: white;',
            '  border: 2px solid white;',
            '  border-radius: 6px;',
            '  padding: 6px 16px;',
            '  font-size: 14px;',
            '  font-weight: bold;',
            '  cursor: pointer;',
            '  box-shadow: 0 2px 8px rgba(0,0,0,0.3);',
            '  pointer-events: auto;',
            '}',
            '#_kanban_overlay button:hover {',
            '  background: #1d4ed8;',
            '}'
        ].join('\\n');
        document.head.appendChild(style);
    }

    function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = '_kanban_overlay';

        var btn = document.createElement('button');
        btn.textContent = 'Select this image';

        btn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }, true);

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (!currentImg) return;
            var src = currentImg.src || currentImg.currentSrc;
            if (src && window._kanbanSelectImage) {
                window._kanbanSelectImage(JSON.stringify({
                    imageUrl: src,
                    pageUrl: window.location.href
                }));
            }
        }, true);

        overlay.appendChild(btn);

        overlay.addEventListener('mouseleave', function() {
            overlay.classList.remove('visible');
            currentImg = null;
        });

        document.body.appendChild(overlay);
    }

    function positionOverlay(img) {
        var rect = img.getBoundingClientRect();
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
    }

    function trackImage(img) {
        if (img._kanbanTracked) return;
        img._kanbanTracked = true;

        img.addEventListener('mouseenter', function() {
            var rect = img.getBoundingClientRect();
            if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return;
            if (!(img.src || img.currentSrc)) return;

            currentImg = img;
            ensureOverlay();
            positionOverlay(img);
            overlay.classList.add('visible');
        });

        img.addEventListener('mouseleave', function(e) {
            if (overlay && overlay.contains(e.relatedTarget)) return;
            if (overlay) overlay.classList.remove('visible');
            currentImg = null;
        });
    }

    function scanImages() {
        document.querySelectorAll('img').forEach(function(img) {
            if (img.complete && img.naturalWidth >= MIN_SIZE && img.naturalHeight >= MIN_SIZE) {
                trackImage(img);
            } else if (!img.complete) {
                img.addEventListener('load', function() {
                    if (img.naturalWidth >= MIN_SIZE && img.naturalHeight >= MIN_SIZE) {
                        trackImage(img);
                    }
                }, { once: true });
            }
        });
    }

    function observeNewImages() {
        var observer = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var nodes = mutations[i].addedNodes;
                for (var j = 0; j < nodes.length; j++) {
                    var node = nodes[j];
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'IMG') {
                        if (node.complete) { trackImage(node); }
                        else { node.addEventListener('load', function() { trackImage(this); }, { once: true }); }
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll('img').forEach(function(img) {
                            if (img.complete) { trackImage(img); }
                            else { img.addEventListener('load', function() { trackImage(this); }, { once: true }); }
                        });
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addStyles(); scanImages(); observeNewImages();
        });
    } else {
        addStyles(); scanImages(); observeNewImages();
    }

})();
`;

export class WebImageSearchService {
    /**
     * Build the search URL for the given query based on configuration
     */
    private static _buildSearchUrl(query: string): string {
        const engine = pluginConfigService.getPluginConfig<string>('imagesearch', 'engine', 'google');
        const encodedQuery = encodeURIComponent(query);

        if (engine === 'custom') {
            const customUrl = pluginConfigService.getPluginConfig<string>('imagesearch', 'customUrl', '');
            if (!customUrl) {
                logger.warn('[WebImageSearchService] Custom engine selected but no customUrl configured, falling back to Google');
                return SEARCH_ENGINE_URLS.google.replace('${query}', encodedQuery);
            }
            return customUrl.replace('${query}', encodedQuery);
        }

        const template = SEARCH_ENGINE_URLS[engine] || SEARCH_ENGINE_URLS.google;
        return template.replace('${query}', encodedQuery);
    }

    /**
     * Sanitize text into a filename-safe string
     */
    private static _sanitizeFilename(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 80) || 'image';
    }

    /**
     * Get file extension from content-type header
     */
    private static _getExtensionFromContentType(contentType: string): string {
        const type = contentType.split(';')[0].trim().toLowerCase();
        return CONTENT_TYPE_EXTENSIONS[type] || '.jpg';
    }

    /**
     * Get file extension from URL path
     */
    private static _getExtensionFromUrl(url: string): string {
        try {
            const pathname = new URL(url).pathname;
            const ext = path.extname(pathname).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.avif'].includes(ext)) {
                return ext === '.jpeg' ? '.jpg' : ext;
            }
        } catch {
            // invalid URL
        }
        return '';
    }

    /**
     * Find a unique filename in the target directory
     */
    private static _uniqueFilePath(basePath: string, baseName: string, ext: string): string {
        let candidate = path.join(basePath, baseName + ext);
        if (!fs.existsSync(candidate)) return candidate;

        for (let i = 1; i < 1000; i++) {
            candidate = path.join(basePath, `${baseName}-${i}${ext}`);
            if (!fs.existsSync(candidate)) return candidate;
        }
        return candidate;
    }

    /**
     * Search for an image on the web and let the user select one interactively.
     *
     * Opens a headed browser to the configured image search engine with the
     * given altText as the query. Injects an overlay on all images that lets
     * the user click "Select" to choose an image. The chosen image is downloaded
     * and saved to basePath.
     *
     * @param altText - The search query (typically the image alt text)
     * @param basePath - Directory to save the downloaded image
     * @returns The downloaded file path and source URL, or null if cancelled
     */
    static async searchAndSelect(altText: string, basePath: string): Promise<WebImageSearchResult | null> {
        const searchUrl = WebImageSearchService._buildSearchUrl(altText);
        logger.debug('[WebImageSearchService.searchAndSelect] Opening search', { altText, searchUrl, basePath });

        let context: any = null;

        try {
            // Remove stale lock/crash markers left by a previous crash or improper shutdown.
            // Chrome refuses to open a persistent profile if these exist.
            // SingletonLock is a symlink on POSIX (target: "hostname-pid") — use lstat
            // because existsSync follows symlinks and returns false for dangling ones.
            const staleFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
            for (const name of staleFiles) {
                try { fs.unlinkSync(path.join(BROWSER_PROFILE_DIR, name)); } catch { /* not present */ }
            }

            // Use persistent context so cookies/sessions survive across launches
            context = await BrowserService.launchPersistentHeaded(BROWSER_PROFILE_DIR);
            // Persistent context opens a default page — reuse it instead of creating a second tab
            const pages = context.pages();
            const page = pages.length > 0 ? pages[0] : await context.newPage();

            // Set up the selection callback
            let resolveSelection: ((url: string | null) => void) | null = null;

            const selectionPromise = new Promise<string | null>((resolve) => {
                resolveSelection = resolve;
            });

            // Expose the selection function and inject overlay on the CONTEXT level
            // so they apply to ALL pages/tabs opened in this browser session
            await context.exposeFunction('_kanbanSelectImage', (imageUrl: string) => {
                if (resolveSelection) {
                    resolveSelection(imageUrl);
                }
            });
            await context.addInitScript(OVERLAY_SCRIPT);

            // Navigate to the search page
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Wait for user selection or browser close (from any page/tab)
            const closePromise = new Promise<string | null>((resolve) => {
                // Persistent context: listen for context close and browser disconnect
                context.on('close', () => resolve(null));
                const browser = context.browser();
                if (browser) {
                    browser.on('disconnected', () => resolve(null));
                }
            });

            const rawResult = await Promise.race([selectionPromise, closePromise]);

            if (!rawResult) {
                logger.debug('[WebImageSearchService.searchAndSelect] Cancelled (browser closed without selection)');
                return null;
            }

            // Parse the JSON payload: { imageUrl, pageUrl }
            let imageUrl: string;
            let pageUrl: string = '';
            try {
                const parsed = JSON.parse(rawResult);
                imageUrl = parsed.imageUrl || '';
                pageUrl = parsed.pageUrl || '';
            } catch {
                // Fallback: raw string is the image URL (backward compat)
                imageUrl = rawResult;
            }

            if (!imageUrl) {
                logger.warn('[WebImageSearchService] No image URL in selection');
                return null;
            }

            logger.debug('[WebImageSearchService.searchAndSelect] Image selected', { imageUrl: imageUrl.substring(0, 100), pageUrl });

            // Download the image
            let imageBytes: Buffer;
            let contentType = '';

            // Handle data: URLs (base64-encoded images from browser UI)
            const dataUrlMatch = imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (dataUrlMatch) {
                contentType = dataUrlMatch[1];
                imageBytes = Buffer.from(dataUrlMatch[2], 'base64');
                logger.debug('[WebImageSearchService] Decoded data URL', { contentType, size: imageBytes.length });
            } else {
                // HTTP(S) URL — use the browser's network stack (bypasses CORS/hotlink issues)
                const downloadPage = await context.newPage();
                try {
                    const response = await downloadPage.goto(imageUrl, { waitUntil: 'load', timeout: 30000 });
                    if (!response || !response.ok()) {
                        logger.warn('[WebImageSearchService] Failed to download image', { status: response?.status() });
                        return null;
                    }
                    imageBytes = await response.body();
                    contentType = response.headers()['content-type'] || '';
                } finally {
                    await downloadPage.close().catch(() => {});
                }
            }

            // Determine file extension: prefer content-type, fall back to URL extension
            const ctExt = CONTENT_TYPE_EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()];
            let ext: string;
            if (ctExt) {
                ext = ctExt;
            } else {
                // Content-type unknown or missing, try URL-based extension
                const urlExt = imageUrl.startsWith('data:') ? '' : WebImageSearchService._getExtensionFromUrl(imageUrl);
                ext = urlExt || '.jpg';
            }

            // Build filename from alt text
            const baseName = WebImageSearchService._sanitizeFilename(altText);
            const filePath = WebImageSearchService._uniqueFilePath(basePath, baseName, ext);

            // Save the image
            fs.writeFileSync(filePath, imageBytes);
            logger.debug('[WebImageSearchService.searchAndSelect] Image saved', { filePath, size: imageBytes.length });

            return {
                filePath,
                // Use the page URL where the image was found (not the image data URL)
                sourceUrl: pageUrl
            };
        } catch (error) {
            logger.error('[WebImageSearchService.searchAndSelect] Error', error);
            throw error;
        } finally {
            if (context) {
                await context.close().catch(() => {});
            }
        }
    }
}
