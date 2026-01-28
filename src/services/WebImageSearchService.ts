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
import * as path from 'path';
import { BrowserService } from './BrowserService';
import { configService } from './ConfigurationService';
import { logger } from '../utils/logger';

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
const OVERLAY_SCRIPT = `
(function() {
    const STYLE_ID = '_kanban_image_select_style';
    const MIN_SIZE = 50;

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = \`
            ._kanban_img_overlay {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(59, 130, 246, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.15s;
                pointer-events: none;
                z-index: 999999;
            }
            ._kanban_img_wrapper:hover ._kanban_img_overlay {
                opacity: 1;
                pointer-events: auto;
            }
            ._kanban_img_wrapper {
                position: relative;
                display: inline-block;
            }
            ._kanban_select_btn {
                background: #2563eb;
                color: white;
                border: 2px solid white;
                border-radius: 6px;
                padding: 6px 16px;
                font-size: 14px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                z-index: 1000000;
            }
            ._kanban_select_btn:hover {
                background: #1d4ed8;
            }
        \`;
        document.head.appendChild(style);
    }

    function isLargeEnough(el) {
        const rect = el.getBoundingClientRect();
        return rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
    }

    function getImageSrc(el) {
        if (el.tagName === 'IMG') {
            return el.src || el.currentSrc;
        }
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
            const match = bg.match(/url\\(["']?(.+?)["']?\\)/);
            if (match) return match[1];
        }
        return null;
    }

    function wrapElement(el) {
        if (el.dataset._kanbanWrapped) return;
        if (!isLargeEnough(el)) return;

        const src = getImageSrc(el);
        if (!src) return;

        el.dataset._kanbanWrapped = 'true';

        const wrapper = document.createElement('span');
        wrapper.className = '_kanban_img_wrapper';

        const overlay = document.createElement('div');
        overlay.className = '_kanban_img_overlay';

        const btn = document.createElement('button');
        btn.className = '_kanban_select_btn';
        btn.textContent = 'Select this image';
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            // Re-read src at click time in case it changed (lazy loading)
            const currentSrc = getImageSrc(el) || src;
            if (window._kanbanSelectImage) {
                window._kanbanSelectImage(currentSrc);
            }
        }, true);

        overlay.appendChild(btn);

        el.parentNode.insertBefore(wrapper, el);
        wrapper.appendChild(el);
        wrapper.appendChild(overlay);
    }

    function scanExistingElements() {
        document.querySelectorAll('img').forEach(function(img) {
            if (img.complete && img.naturalWidth >= MIN_SIZE && img.naturalHeight >= MIN_SIZE) {
                wrapElement(img);
            } else if (!img.complete) {
                img.addEventListener('load', function() {
                    if (img.naturalWidth >= MIN_SIZE && img.naturalHeight >= MIN_SIZE) {
                        wrapElement(img);
                    }
                }, { once: true });
            }
        });
    }

    function observeNewElements() {
        const observer = new MutationObserver(function(mutations) {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'IMG') {
                        if (node.complete) {
                            wrapElement(node);
                        } else {
                            node.addEventListener('load', function() { wrapElement(node); }, { once: true });
                        }
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll('img').forEach(function(img) {
                            if (img.complete) {
                                wrapElement(img);
                            } else {
                                img.addEventListener('load', function() { wrapElement(img); }, { once: true });
                            }
                        });
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addStyles();
            scanExistingElements();
            observeNewElements();
        });
    } else {
        addStyles();
        scanExistingElements();
        observeNewElements();
    }

    // Re-scan periodically for lazy-loaded images
    setInterval(scanExistingElements, 2000);
})();
`;

export class WebImageSearchService {
    /**
     * Build the search URL for the given query based on configuration
     */
    private static _buildSearchUrl(query: string): string {
        const engine = configService.getNestedConfig('imageSearch.engine', 'google') as string;
        const encodedQuery = encodeURIComponent(query);

        if (engine === 'custom') {
            const customUrl = configService.getNestedConfig('imageSearch.customUrl', '') as string;
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

        let browser: any = null;

        try {
            browser = await BrowserService.launchHeaded();
            const context = await browser.newContext();
            const page = await context.newPage();

            // Set up the selection callback
            let selectedImageUrl: string | null = null;
            let resolveSelection: ((url: string | null) => void) | null = null;

            const selectionPromise = new Promise<string | null>((resolve) => {
                resolveSelection = resolve;
            });

            // Expose the selection function to the page
            await page.exposeFunction('_kanbanSelectImage', (imageUrl: string) => {
                selectedImageUrl = imageUrl;
                if (resolveSelection) {
                    resolveSelection(imageUrl);
                }
            });

            // Inject the overlay script
            await page.addInitScript(OVERLAY_SCRIPT);

            // Navigate to the search page
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Wait for user selection or browser close
            const closePromise = new Promise<string | null>((resolve) => {
                page.on('close', () => resolve(null));
                browser.on('disconnected', () => resolve(null));
            });

            const result = await Promise.race([selectionPromise, closePromise]);

            if (!result) {
                logger.debug('[WebImageSearchService.searchAndSelect] Cancelled (browser closed without selection)');
                return null;
            }

            logger.debug('[WebImageSearchService.searchAndSelect] Image selected', { url: result });

            // Download the image using the browser's network stack (bypasses CORS/hotlink issues)
            const downloadPage = await context.newPage();
            let imageBytes: Buffer;
            let contentType = '';

            try {
                const response = await downloadPage.goto(result, { waitUntil: 'load', timeout: 30000 });
                if (!response || !response.ok()) {
                    logger.warn('[WebImageSearchService] Failed to download image', { status: response?.status() });
                    return null;
                }
                imageBytes = await response.body();
                contentType = response.headers()['content-type'] || '';
            } finally {
                await downloadPage.close().catch(() => {});
            }

            // Determine file extension: prefer content-type, fall back to URL extension
            const ctExt = CONTENT_TYPE_EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()];
            let ext: string;
            if (ctExt) {
                ext = ctExt;
            } else {
                // Content-type unknown or missing, try URL-based extension
                const urlExt = WebImageSearchService._getExtensionFromUrl(result);
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
                sourceUrl: result
            };
        } catch (error) {
            logger.error('[WebImageSearchService.searchAndSelect] Error', error);
            throw error;
        } finally {
            if (browser) {
                await browser.close().catch(() => {});
            }
        }
    }
}
