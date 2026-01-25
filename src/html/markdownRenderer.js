// Debug flag - set to true to enable verbose logging
const DEBUG_MERMAID = false;
const logMermaid = DEBUG_MERMAID ? console.log.bind(console, '[Mermaid]') : () => {};

// Cached markdown-it instance for performance
// Creating a new markdown-it instance with all plugins is expensive (~3-5ms per call)
// With 400+ tasks, this adds up to 2+ seconds of rendering time
let cachedMarkdownIt = null;
let cachedHtmlCommentMode = null;
let cachedHtmlContentMode = null;

function createUniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createLoadingPlaceholder(id, className, message) {
    return `<div id="${id}" class="${className}">
        <div class="placeholder-spinner"></div>
        <div class="placeholder-text">${message}</div>
    </div>`;
}

function safeDecodePath(value) {
    if (!value) {
        return value;
    }
    try {
        return decodeURIComponent(value);
    } catch (error) {
        return value;
    }
}

function isWindowsAbsolutePath(value) {
    return Boolean(value && /^[A-Za-z]:[\/\\]/.test(value));
}

function isRelativeResourcePath(value) {
    if (!value) {
        return false;
    }
    return !value.startsWith('/') &&
        !isWindowsAbsolutePath(value) &&
        !value.startsWith('http://') &&
        !value.startsWith('https://') &&
        !value.startsWith('vscode-webview://');
}

function resolveRelativePath(baseDir, relativePath) {
    const dirSegments = baseDir.split('/').filter(s => s);
    const relSegments = relativePath.split('/').filter(s => s);

    for (const segment of relSegments) {
        if (segment === '..') {
            dirSegments.pop();
        } else if (segment !== '.') {
            dirSegments.push(segment);
        }
    }

    return '/' + dirSegments.join('/');
}

function encodePathSegments(pathValue) {
    return pathValue.split('/').map(s => s ? encodeURIComponent(s) : '').join('/');
}

function buildWebviewResourceUrl(pathValue, encodeSegments = true) {
    const normalizedPath = pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
    const encodedPath = encodeSegments ? encodePathSegments(normalizedPath) : encodeURI(normalizedPath);
    return `https://file%2B.vscode-resource.vscode-cdn.net${encodedPath}`;
}

function normalizeWindowsAbsolutePath(pathValue, shouldDecode) {
    const resolvedPath = shouldDecode ? safeDecodePath(pathValue) : pathValue;
    return '/' + resolvedPath.replace(/\\/g, '/');
}

function renderTokenWithChildren(token, renderer, options, env) {
    const attrs = renderer.renderAttrs(token);
    const open = `<${token.tag}${attrs}>`;
    const close = `</${token.tag}>`;
    const content = token.children ? renderer.renderInline(token.children, options, env) : '';
    return `${open}${content}${close}`;
}

function updateSourceChildren(token, resolveSourcePath) {
    let firstSource = '';
    if (!token.children) {
        return { firstSource };
    }

    token.children.forEach(child => {
        if (child.type !== 'source' || !child.attrGet) {
            return;
        }
        const src = child.attrGet('src');
        if (!src) {
            return;
        }
        if (!firstSource) {
            firstSource = src;
        }
        child.attrSet('src', resolveSourcePath(src));
    });

    return { firstSource };
}

// ============================================================================
// Embed Detection and Rendering
// ============================================================================

// Default known embed domains (can be overridden via configuration)
let embedKnownDomains = [
    'miro.com/app/live-embed',
    'miro.com/app/embed',
    'figma.com/embed',
    'figma.com/file',
    'figma.com/proto',
    'youtube.com/embed',
    'youtube-nocookie.com/embed',
    'youtu.be',
    'vimeo.com/video',
    'player.vimeo.com',
    'codepen.io/*/embed',
    'codesandbox.io/embed',
    'codesandbox.io/s',
    'stackblitz.com/edit',
    'jsfiddle.net/*/embedded',
    'docs.google.com/presentation',
    'docs.google.com/document',
    'docs.google.com/spreadsheets',
    'notion.so',
    'airtable.com/embed',
    'loom.com/embed',
    'loom.com/share',
    'prezi.com/p/embed',
    'prezi.com/v/embed',
    'ars.particify.de/present'
];

// Default iframe attributes (can be overridden via configuration)
let embedDefaultIframeAttributes = {
    width: '100%',
    height: '500px',
    frameborder: '0',
    allowfullscreen: true,
    loading: 'lazy',
    allow: 'fullscreen; clipboard-read; clipboard-write; autoplay; encrypted-media; picture-in-picture',
    referrerpolicy: 'strict-origin-when-cross-origin'
};

/**
 * Update embed configuration from settings
 * Called when configuration is received from the extension
 */
function updateEmbedConfig(config) {
    if (config && config.knownDomains && Array.isArray(config.knownDomains)) {
        embedKnownDomains = config.knownDomains;
    }
    if (config && config.defaultIframeAttributes && typeof config.defaultIframeAttributes === 'object') {
        embedDefaultIframeAttributes = { ...embedDefaultIframeAttributes, ...config.defaultIframeAttributes };
    }
}

// Expose the config update function globally for the webview to call
window.updateEmbedConfig = updateEmbedConfig;

/**
 * Convert a domain pattern (with wildcards) to a regex
 * @param {string} pattern - Domain pattern like "miro.com/app/embed" or "codepen.io/wildcard/embed"
 * @returns {RegExp} Regex that matches URLs containing this domain pattern
 */
function domainPatternToRegex(pattern) {
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Convert * to regex wildcard
    const regexPattern = escaped.replace(/\*/g, '[^/]*');
    // Match anywhere in URL (after protocol)
    return new RegExp(`^https?://(?:www\\.)?${regexPattern}`, 'i');
}

/**
 * Check if a URL matches any of the known embed domain patterns
 * @param {string} url - The URL to check
 * @returns {boolean} True if URL matches any pattern
 */
function isKnownEmbedUrl(url) {
    if (!url || !url.startsWith('http')) {
        return false;
    }
    return embedKnownDomains.some(pattern => domainPatternToRegex(pattern).test(url));
}

/**
 * Detect if an image should be rendered as an embed
 * Priority:
 * 1. Explicit {.embed} class attribute
 * 2. data-embed attribute from {embed} syntax
 * 3. Known embed domain patterns
 *
 * @param {string} src - Image source URL
 * @param {string} alt - Alt text (may contain fallback image path)
 * @param {string} title - Title attribute
 * @param {Object} token - Markdown-it token with potential _imageAttrs
 * @returns {Object|null} Embed info or null if not an embed
 */
function detectEmbed(src, alt, title, token) {
    // Skip non-URLs (local files should not be embeds)
    if (!src || !src.startsWith('http')) {
        return null;
    }

    // Get attributes from token (set by markdown-it-image-attrs plugin)
    const imageAttrs = token._imageAttrs || {};
    const tokenClass = token.attrGet('class') || '';
    const dataEmbed = token.attrGet('data-embed');

    // Priority 1: Explicit .embed class
    const hasEmbedClass = tokenClass.includes('embed') || (imageAttrs.class && imageAttrs.class.includes('embed'));

    // Priority 2: data-embed attribute
    const hasDataEmbed = dataEmbed !== null && dataEmbed !== undefined;

    // Priority 3: Known embed domain
    const isKnownDomain = isKnownEmbedUrl(src);

    if (!hasEmbedClass && !hasDataEmbed && !isKnownDomain) {
        return null;
    }

    // Build embed info
    const embedInfo = {
        isEmbed: true,
        url: src,
        // Fallback: from attribute, or alt text if it looks like an image path
        fallback: imageAttrs.fallback || token.attrGet('data-fallback') || (isImagePath(alt) ? alt : null),
        // Dimensions: from attributes or defaults
        width: imageAttrs.width || token.attrGet('data-width') || embedDefaultIframeAttributes.width,
        height: imageAttrs.height || token.attrGet('data-height') || embedDefaultIframeAttributes.height,
        // Other iframe attributes from token or defaults
        frameborder: imageAttrs.frameborder || embedDefaultIframeAttributes.frameborder,
        allowfullscreen: imageAttrs.allowfullscreen !== undefined ? imageAttrs.allowfullscreen : embedDefaultIframeAttributes.allowfullscreen,
        loading: imageAttrs.loading || embedDefaultIframeAttributes.loading,
        allow: imageAttrs.allow || embedDefaultIframeAttributes.allow,
        referrerpolicy: imageAttrs.referrerpolicy || embedDefaultIframeAttributes.referrerpolicy,
        // Any other custom attributes
        customAttrs: {}
    };

    // Collect any other custom attributes from imageAttrs
    const reservedKeys = ['class', 'id', 'fallback', 'width', 'height', 'frameborder', 'allowfullscreen', 'loading', 'allow', 'referrerpolicy', 'embed'];
    Object.keys(imageAttrs).forEach(key => {
        if (!reservedKeys.includes(key)) {
            embedInfo.customAttrs[key] = imageAttrs[key];
        }
    });

    return embedInfo;
}

/**
 * Check if a string looks like an image path
 * @param {string} str - String to check
 * @returns {boolean} True if it looks like an image path
 */
function isImagePath(str) {
    if (!str) return false;
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'];
    const lower = str.toLowerCase();
    return imageExtensions.some(ext => lower.endsWith(ext));
}

/**
 * Render an embed as an iframe with container
 * @param {Object} embedInfo - Embed information from detectEmbed
 * @param {string} originalSrc - Original source URL
 * @param {string} alt - Alt text
 * @param {string} title - Title attribute
 * @returns {string} HTML for the embed container
 */
function renderEmbed(embedInfo, originalSrc, alt, title) {
    const { url, fallback, width, height, frameborder, allowfullscreen, loading, allow, referrerpolicy, customAttrs } = embedInfo;

    // Build iframe attributes
    let iframeAttrs = `src="${escapeHtml(url)}"`;
    iframeAttrs += ` width="${escapeHtml(width)}"`;
    iframeAttrs += ` height="${escapeHtml(height)}"`;
    iframeAttrs += ` frameborder="${escapeHtml(String(frameborder))}"`;
    if (allowfullscreen) {
        iframeAttrs += ' allowfullscreen';
    }
    iframeAttrs += ` loading="${escapeHtml(loading)}"`;
    if (allow) {
        iframeAttrs += ` allow="${escapeHtml(allow)}"`;
    }
    if (referrerpolicy) {
        iframeAttrs += ` referrerpolicy="${escapeHtml(referrerpolicy)}"`;
    }

    // Add custom attributes
    Object.keys(customAttrs).forEach(key => {
        iframeAttrs += ` ${escapeHtml(key)}="${escapeHtml(customAttrs[key])}"`;
    });

    // Build data attributes for export handling
    const dataAttrs = [
        `data-embed-url="${escapeHtml(url)}"`,
        fallback ? `data-embed-fallback="${escapeHtml(fallback)}"` : '',
        alt && !isImagePath(alt) ? `data-embed-caption="${escapeHtml(alt)}"` : ''
    ].filter(Boolean).join(' ');

    // Extract domain for display
    let domain = '';
    try {
        domain = new URL(url).hostname.replace('www.', '');
    } catch (e) {
        domain = 'embed';
    }

    // Build the header label (use domain, not title - title goes in caption)
    const headerLabel = domain;

    // Build caption if title is provided
    const captionHtml = title ? `<div class="embed-caption media-caption">${escapeHtml(title)}</div>` : '';

    return `<div class="embed-container" ${dataAttrs}>
        <div class="embed-header">
            <span class="embed-icon">🔗</span>
            <span class="embed-title">${escapeHtml(headerLabel)}</span>
            <button class="embed-menu-btn" data-action="embed-menu" title="Embed options">☰</button>
        </div>
        <div class="embed-frame-wrapper">
            <iframe ${iframeAttrs}></iframe>
        </div>
        ${captionHtml}
    </div>`;
}

// Factory function to create markdown-it instance with all plugins
// This is called once per configuration change, not per render
function createMarkdownItInstance(htmlCommentRenderMode, htmlContentRenderMode) {
    const md = window.markdownit({
        html: true,
        linkify: false,
        typographer: true,
        breaks: true
    })
    .use(wikiLinksPlugin, {
        className: 'wiki-link'
    })
    .use(tagPlugin, {
        tagColors: window.tagColors || {}
    })
    .use(taskCheckboxPlugin) // Task list checkboxes (- [ ] / - [x])
    .use(datePersonTagPlugin) // @ prefix: @person, @2025-01-28
    .use(temporalTagPlugin)  // . prefix: .w49, .2025.12.05, .mon, .15:30, .09:00-17:00
    .use(enhancedStrikethroughPlugin) // Add enhanced strikethrough with delete buttons
    .use(speakerNotePlugin) // Speaker notes (;; syntax)
    .use(htmlCommentPlugin, {
        commentMode: htmlCommentRenderMode,
        contentMode: htmlContentRenderMode
    }); // HTML comment and content rendering

    // Add plugins that are available from CDN (CSP-compliant)
    if (typeof window.markdownitEmoji !== 'undefined') {
        md.use(window.markdownitEmoji); // :smile: => 😊
    }
    if (typeof window.markdownitFootnote !== 'undefined') {
        md.use(window.markdownitFootnote); // [^1]: footnote
    }
    if (typeof window.markdownItMulticolumn !== 'undefined') {
        md.use(window.markdownItMulticolumn); // Multi-column layout support
    }
    if (typeof window.markdownitMark !== 'undefined') {
        md.use(window.markdownitMark); // ==mark== syntax support
    }
    if (typeof window.markdownitSub !== 'undefined') {
        md.use(window.markdownitSub); // H~2~O subscript support
    }
    if (typeof window.markdownitSup !== 'undefined') {
        md.use(window.markdownitSup); // 29^th^ superscript support
    }
    if (typeof window.markdownitIns !== 'undefined') {
        md.use(window.markdownitIns); // ++inserted++ text support
    }
    if (typeof window.markdownitStrikethroughAlt !== 'undefined') {
        md.use(window.markdownitStrikethroughAlt); // --strikethrough-- support
    }
    if (typeof window.markdownitUnderline !== 'undefined') {
        md.use(window.markdownitUnderline); // _underline_ support
    }
    if (typeof window.markdownitAbbr !== 'undefined') {
        md.use(window.markdownitAbbr); // *[HTML]: Hyper Text Markup Language
    }
    if (typeof window.markdownitContainer !== 'undefined') {
        // Add common container types from engine.js
        md.use(window.markdownitContainer, 'note');
        md.use(window.markdownitContainer, 'comment');
        md.use(window.markdownitContainer, 'highlight');
        md.use(window.markdownitContainer, 'mark-red');
        md.use(window.markdownitContainer, 'mark-green');
        md.use(window.markdownitContainer, 'mark-blue');
        md.use(window.markdownitContainer, 'mark-cyan');
        md.use(window.markdownitContainer, 'mark-magenta');
        md.use(window.markdownitContainer, 'mark-yellow');
        md.use(window.markdownitContainer, 'center');
        md.use(window.markdownitContainer, 'center100');
        md.use(window.markdownitContainer, 'right');
        md.use(window.markdownitContainer, 'caption');
    }
    if (typeof window.markdownItInclude !== 'undefined') {
        md.use(window.markdownItInclude); // !!!include()!!! file inclusion support
    }
    if (typeof window.markdownItImageFigures !== 'undefined') {
        md.use(window.markdownItImageFigures, {
            figcaption: 'title'
        }); // Image figures with captions from title attribute
    }
    if (typeof window.markdownItImageAttrs !== 'undefined') {
        md.use(window.markdownItImageAttrs); // ![alt](url){.class key=value} attribute support
    }

    // Note: Most other plugins can't be loaded via CDN due to CSP restrictions
    // Advanced plugin functionality would need to be bundled or implemented differently
    if (typeof window.markdownItMediaCustom !== 'undefined') {
        md.use(window.markdownItMediaCustom, {
            controls: true,
            attrs: {
                image: {},
                audio: {},
                video: {}
            }
        }); // Custom media plugin for video/audio
    }

    return md;
}

// Wiki Links Plugin for markdown-it
function wikiLinksPlugin(md, options = {}) {
    const {
        baseUrl = '',
        generatePath = (filename) => filename + '.md',
        target = '',
        className = 'wiki-link'
    } = options;

    function parseWikiLink(state, silent) {
        let pos = state.pos;
        
        // Check for opening [[
        if (pos + 1 >= state.posMax) {return false;}
        if (state.src.charCodeAt(pos) !== 0x5B /* [ */) {return false;}
        if (state.src.charCodeAt(pos + 1) !== 0x5B /* [ */) {return false;}
        
        pos += 2;
        
        // Find closing ]]
        let found = false;
        let content = '';
        let contentStart = pos;
        
        while (pos < state.posMax) {
            if (state.src.charCodeAt(pos) === 0x5D /* ] */ && 
                pos + 1 < state.posMax && 
                state.src.charCodeAt(pos + 1) === 0x5D /* ] */) {
                found = true;
                content = state.src.slice(contentStart, pos);
                break;
            }
            pos++;
        }
        
        if (!found) {return false;}
        
        // Parse content: [[document|title]] or [[document]]
        const parts = content.split('|');
        const document = parts[0].trim();
        const title = parts[1] ? parts[1].trim() : document;
        
        if (!document) {return false;}

        // IMPORTANT: When returning true, state.pos MUST always be advanced
        state.pos = pos + 2; // Skip closing ]]

        // Don't process if we're in silent mode
        if (silent) {return true;}

        // Create token
        const token_open = state.push('wiki_link_open', 'a', 1);
        token_open.attrSet('href', '#'); // Use # as placeholder
        if (className) {token_open.attrSet('class', className);}
        token_open.attrSet('data-document', document);
        token_open.attrSet('title', `Wiki link: ${document}`);

        const token_text = state.push('text', '', 0);
        token_text.content = title;

        const token_close = state.push('wiki_link_close', 'a', -1);

        return true;
    }

    // Register the inline rule
    md.inline.ruler.before('emphasis', 'wiki_link', parseWikiLink);
    
    // Add render rules
    md.renderer.rules.wiki_link_open = function(tokens, idx) {
        const token = tokens[idx];
        let attrs = '';
        
        if (token.attrIndex('href') >= 0) {
            attrs += ` href="${token.attrGet('href')}"`;
        }
        if (token.attrIndex('class') >= 0) {
            attrs += ` class="${token.attrGet('class')}"`;
        }
        if (token.attrIndex('title') >= 0) {
            attrs += ` title="${token.attrGet('title')}"`;
        }
        if (token.attrIndex('data-document') >= 0) {
            attrs += ` data-document="${escapeHtml(token.attrGet('data-document'))}"`;
        }
        
        return `<a${attrs}>`;
    };
    
    md.renderer.rules.wiki_link_close = function() {
        return '</a>';
    };
}

// Task checkbox plugin for markdown-it
function taskCheckboxPlugin(md) {
    md.core.ruler.after('inline', 'task-checkbox', function(state) {
        const env = state.env || {};
        let checkboxIndex = Number.isFinite(env.taskCheckboxIndex) ? env.taskCheckboxIndex : 0;

        for (let i = 0; i < state.tokens.length; i++) {
            const token = state.tokens[i];
            if (token.type !== 'inline' || !token.children || token.children.length === 0) {
                continue;
            }

            const prev = state.tokens[i - 1];
            const prevPrev = state.tokens[i - 2];
            if (!prev || !prevPrev || prev.type !== 'paragraph_open' || prevPrev.type !== 'list_item_open') {
                continue;
            }

            const firstChild = token.children[0];
            if (!firstChild || firstChild.type !== 'text') {
                continue;
            }

            const match = firstChild.content.match(/^\[( |x|X)\]\s+/);
            if (!match) {
                continue;
            }

            const checked = match[1].toLowerCase() === 'x';
            const checkboxToken = new state.Token('task_checkbox', 'span', 0);
            checkboxToken.meta = {
                checked,
                index: checkboxIndex
            };
            checkboxIndex += 1;

            firstChild.content = firstChild.content.slice(match[0].length);
            token.children.unshift(checkboxToken);
        }

        env.taskCheckboxIndex = checkboxIndex;
        state.env = env;
    });

    md.renderer.rules.task_checkbox = function(tokens, idx) {
        const meta = tokens[idx]?.meta || {};
        const checked = !!meta.checked;
        const index = Number.isFinite(meta.index) ? meta.index : 0;
        const classes = `md-task-checkbox${checked ? ' checked' : ''}`;
        const aria = checked ? 'true' : 'false';
        return `<span class="${classes}" data-checkbox-index="${index}" data-checked="${checked ? 'true' : 'false'}" role="checkbox" aria-checked="${aria}" tabindex="0"></span>`;
    };
}

// Tag detection and rendering plugin for markdown-it
function tagPlugin(md, options = {}) {
    const tagColors = options.tagColors || {};
    
    function parseTag(state, silent) {
        let pos = state.pos;

        // Check for # at word boundary
        if (state.src.charCodeAt(pos) !== 0x23 /* # */) {return false;}
        if (pos > 0 && state.src.charCodeAt(pos - 1) !== 0x20 /* space */ &&
            state.src.charCodeAt(pos - 1) !== 0x0A /* newline */ &&
            pos !== 0) {return false;}

        // Exclude ATX headers: # followed by space or more # characters (##, ###, etc.)
        // This prevents treating "# Header" as a tag
        if (pos === 0 || state.src.charCodeAt(pos - 1) === 0x0A /* newline */) {
            let headerCheckPos = pos + 1;
            // Check if followed by space (single #) or more # chars (##, ###, etc.)
            if (headerCheckPos < state.posMax) {
                const nextChar = state.src.charCodeAt(headerCheckPos);
                if (nextChar === 0x20 /* space */ || nextChar === 0x23 /* # */) {
                    return false; // This is a header, not a tag
                }
            }
        }
        
        pos++;
        if (pos >= state.posMax) {return false;}
        
        // Parse tag content - for gather tags, include full expression
        let tagStart = pos;
        let tagContent = '';

        // Check for special positivity tags: ++, +, ø, Ø, --, -
        const remaining = state.src.slice(pos);
        const positivityMatch = remaining.match(/^(\+\+|\+|ø|Ø|--|-(?!-))/);
        if (positivityMatch) {
            tagContent = positivityMatch[1];
            pos += tagContent.length;
        }
        // Check if it's a gather tag
        else if (state.src.substr(pos, 7) === 'gather_') {
            // For gather tags, capture everything until next space or end
            while (pos < state.posMax) {
                const char = state.src.charCodeAt(pos);
                // Stop at space or newline
                if (char === 0x20 || char === 0x0A) {break;}
                pos++;
            }
            tagContent = state.src.slice(tagStart, pos);
        } else {
            // For regular tags, use existing logic
            while (pos < state.posMax) {
                const char = state.src.charCodeAt(pos);
                // Allow alphanumeric, underscore, hyphen, dot
                if ((char >= 0x30 && char <= 0x39) || // 0-9
                    (char >= 0x41 && char <= 0x5A) || // A-Z
                    (char >= 0x61 && char <= 0x7A) || // a-z
                    char === 0x5F || // _
                    char === 0x2D || // -
                    char === 0x2E) { // .
                    pos++;
                } else {
                    break;
                }
            }
            tagContent = state.src.slice(tagStart, pos);
        }
        
        if (tagContent.length === 0) {return false;}

        // IMPORTANT: When returning true, state.pos MUST always be advanced
        state.pos = pos;

        if (silent) {return true;}

        // Create token
        const token = state.push('tag', 'span', 0);
        token.content = tagContent;
        token.markup = '#';

        return true;
    }
    
    md.inline.ruler.before('emphasis', 'tag', parseTag);
    
    md.renderer.rules.tag = function(tokens, idx) {
        const token = tokens[idx];
        const tagContent = token.content;
        const fullTag = '#' + token.content;

        // Extract base tag name for styling (before any operators)
        let baseTagName = tagContent;
        if (tagContent.startsWith('gather_')) {
            baseTagName = 'gather'; // Use 'gather' as base for all gather tags
        } else if (/^(\+\+|\+|ø|Ø|--|-(?!-))$/.test(tagContent)) {
            // Positivity tags - use as-is but lowercase
            baseTagName = tagContent.toLowerCase();
        } else {
            const baseMatch = tagContent.match(/^([a-zA-Z0-9_.-]+)/);
            baseTagName = baseMatch ? baseMatch[1].toLowerCase() : tagContent.toLowerCase();
        }

        return `<span class="kanban-tag" data-tag="${escapeHtml(baseTagName)}">${escapeHtml(fullTag)}</span>`;
    };
}

// Date and person tag plugin for markdown-it
function datePersonTagPlugin(md, options = {}) {
    function parseDatePersonTag(state, silent) {
        let pos = state.pos;
        
        // Check for @ at word boundary
        if (state.src.charCodeAt(pos) !== 0x40 /* @ */) {return false;}
        if (pos > 0 && state.src.charCodeAt(pos - 1) !== 0x20 /* space */ && 
            state.src.charCodeAt(pos - 1) !== 0x0A /* newline */ &&
            pos !== 0) {return false;}
        
        pos++;
        if (pos >= state.posMax) {return false;}
        
        let tagStart = pos;
        let tagContent = '';
        let tagType = '';
        
        // Check if it's a week date pattern (@YYYY-WNN, @YYYYWNN, @WNN)
        const remaining = state.src.slice(pos);
        const weekMatch = remaining.match(/^(\d{4}-?W\d{1,2}|W\d{1,2})/i);

        if (weekMatch) {
            tagContent = weekMatch[1];
            tagType = 'week';
            pos += tagContent.length;
        }
        // Check if it's a date pattern (YYYY-MM-DD or DD-MM-YYYY)
        else {
            const dateMatch = remaining.match(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/);

            if (dateMatch) {
                tagContent = dateMatch[1];
                tagType = 'date';
                pos += tagContent.length;
            } else {
            // Parse as person name (letters, numbers, underscore, hyphen)
            while (pos < state.posMax) {
                const char = state.src.charCodeAt(pos);
                if ((char >= 0x30 && char <= 0x39) || // 0-9
                    (char >= 0x41 && char <= 0x5A) || // A-Z
                    (char >= 0x61 && char <= 0x7A) || // a-z
                    char === 0x5F || // _
                    char === 0x2D) { // -
                    pos++;
                } else {
                    break;
                }
            }
            
                if (pos === tagStart) {return false;} // No content

                tagContent = state.src.slice(tagStart, pos);
                tagType = 'person';
            }
        }

        // IMPORTANT: When returning true, state.pos MUST always be advanced
        state.pos = pos;

        if (silent) {return true;}

        // Create token
        const token = state.push('date_person_tag', 'span', 0);
        token.content = tagContent;
        token.markup = '@';
        token.meta = { type: tagType };

        return true;
    }
    
    md.inline.ruler.before('emphasis', 'date_person_tag', parseDatePersonTag);
    
    md.renderer.rules.date_person_tag = function(tokens, idx) {
        const token = tokens[idx];
        const tagContent = token.content;
        const tagType = token.meta.type;
        const fullTag = '@' + token.content;

        // Week tags get their own class (no icon)
        if (tagType === 'week') {
            return `<span class="kanban-week-tag" data-week="${escapeHtml(tagContent)}">${escapeHtml(fullTag)}</span>`;
        }

        const className = tagType === 'date' ? 'kanban-date-tag' : 'kanban-person-tag';
        const dataAttr = tagType === 'date' ? 'data-date' : 'data-person';

        return `<span class="${className}" ${dataAttr}="${escapeHtml(tagContent)}">${escapeHtml(fullTag)}</span>`;
    };
}

// =============================================================================
// TEMPORAL TAG CONFIGURATION - Easy to customize icons and styling
// =============================================================================
const TEMPORAL_TAG_CONFIG = {
    // Icons for different temporal tag types (can be emoji or text)
    icons: {
        date: '📅',      // Date tags: !2025.01.28
        week: '📆',      // Week tags: !w49, !2025.w49
        weekday: '📅',   // Weekday tags: !mon, !friday
        time: '🕐',      // Time tags: !15:30, !9am
        timeSlot: '⏱️',  // Time slot tags: !09:00-17:00
        minuteSlot: '⏱️', // Minute slot tags: !:15-:30
        generic: '🕐'    // Generic temporal: fallback
    },
    // Whether to show icons (set to false to hide all icons)
    showIcons: true,
    // Base CSS class for all temporal tags
    baseClass: 'kanban-temporal-tag'
};

// Temporal tag plugin for markdown-it (handles temporal prefix from TAG_PREFIXES)
function temporalTagPlugin(md, options = {}) {
    const config = { ...TEMPORAL_TAG_CONFIG, ...options };
    // Get temporal prefix from centralized config (defaults to '!' if not available)
    const TEMPORAL_PREFIX = (typeof window !== 'undefined' && window.TAG_PREFIXES)
        ? window.TAG_PREFIXES.TEMPORAL
        : '!';
    const TEMPORAL_CHAR_CODE = TEMPORAL_PREFIX.charCodeAt(0);

    function parseTemporalTag(state, silent) {
        let pos = state.pos;

        // Check for temporal prefix at word boundary
        if (state.src.charCodeAt(pos) !== TEMPORAL_CHAR_CODE) { return false; }

        // Must be at start or after whitespace
        if (pos > 0) {
            const prevChar = state.src.charCodeAt(pos - 1);
            if (prevChar !== 0x20 /* space */ && prevChar !== 0x0A /* newline */ && prevChar !== 0x09 /* tab */) {
                return false;
            }
        }

        pos++;
        if (pos >= state.posMax) { return false; }

        const remaining = state.src.slice(pos);
        let tagContent = '';
        let tagType = '';

        // Try matching patterns in order of specificity

        // 1. Time slot: HH:MM-HH:MM or Ham-Hpm
        const timeSlotMatch = remaining.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)-(\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)/i);
        if (timeSlotMatch) {
            tagContent = timeSlotMatch[0];
            tagType = 'timeSlot';
            pos += tagContent.length;
        }
        // 2. Week with year: YYYY.wNN, YYYY-wNN, YYYY.kwNN, YYYY-kwNN
        else {
            const weekYearMatch = remaining.match(/^(\d{4})[-.]?(?:[wW]|[kK][wW])(\d{1,2})(?=\s|$)/);
            if (weekYearMatch) {
                tagContent = weekYearMatch[0];
                tagType = 'week';
                pos += tagContent.length;
            }
            // 3. Week without year: wNN, WNN, kwNN, KW4 (German Kalenderwoche)
            else {
                const weekMatch = remaining.match(/^(?:[wW]|[kK][wW])(\d{1,2})(?=\s|$)/);
                if (weekMatch) {
                    tagContent = weekMatch[0];
                    tagType = 'week';
                    pos += tagContent.length;
                }
                // 4. Date: YYYY.MM.DD, DD.MM.YYYY, DD.MM.YY, or DD.MM (multiple formats)
                else {
                    const dateMatch = remaining.match(/^(\d{1,4})[-./](\d{1,2})(?:[-./](\d{2,4}))?(?=\s|$)/);
                    if (dateMatch) {
                        tagContent = dateMatch[0];
                        tagType = 'date';
                        pos += tagContent.length;
                    }
                    // 5. Weekday: mon, monday, tue, tuesday, etc.
                    else {
                        const weekdayMatch = remaining.match(/^(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(?=\s|$)/i);
                        if (weekdayMatch) {
                            tagContent = weekdayMatch[0];
                            tagType = 'weekday';
                            pos += tagContent.length;
                        }
                        // 6. Minute slot: :MM-:MM (inherits hour from parent)
                        else {
                            const minuteSlotMatch = remaining.match(/^:(\d{1,2})-:(\d{1,2})(?=\s|$)/i);
                            if (minuteSlotMatch) {
                                tagContent = minuteSlotMatch[0];
                                tagType = 'minuteSlot';
                                pos += tagContent.length;
                            }
                            // 7. Time: HH:MM or Ham/Hpm
                            else {
                                const timeMatch = remaining.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)/i);
                                if (timeMatch) {
                                    tagContent = timeMatch[0];
                                    tagType = 'time';
                                    pos += tagContent.length;
                                }
                            }
                        }
                    }
                }
            }
        }

        // No match found
        if (!tagContent) { return false; }

        // IMPORTANT: When returning true, state.pos MUST always be advanced
        state.pos = pos;

        if (silent) { return true; }

        // Create token
        const token = state.push('temporal_tag', 'span', 0);
        token.content = tagContent;
        token.markup = '.';
        token.meta = { type: tagType, config };

        return true;
    }

    // Register before 'emphasis' - temporal prefix must be a markdown-it terminator char
    md.inline.ruler.before('emphasis', 'temporal_tag', parseTemporalTag);

    md.renderer.rules.temporal_tag = function(tokens, idx) {
        const token = tokens[idx];
        const tagContent = token.content;
        const tagType = token.meta.type;
        const cfg = token.meta.config;
        const fullTag = TEMPORAL_PREFIX + tagContent;

        // Determine CSS class based on type
        const typeClass = `kanban-temporal-${tagType}`;
        const classes = [cfg.baseClass, typeClass].join(' ');

        // Get icon for this type
        const icon = cfg.showIcons ? (cfg.icons[tagType] || cfg.icons.generic) : '';

        // Check if currently active (for highlighting)
        let isActive = false;
        if (typeof window !== 'undefined' && window.tagUtils) {
            switch (tagType) {
                case 'date': isActive = window.tagUtils.isCurrentDate(fullTag); break;
                case 'week': isActive = window.tagUtils.isCurrentWeek(fullTag); break;
                case 'weekday': isActive = window.tagUtils.isCurrentWeekday(fullTag); break;
                case 'time': isActive = window.tagUtils.isCurrentTime(fullTag); break;
                case 'timeSlot': isActive = window.tagUtils.isCurrentTimeSlot(fullTag); break;
                case 'minuteSlot':
                    // Minute slots inherit from parent time slot context
                    // The parent time slot is set before rendering via window.currentRenderingTimeSlot
                    if (window.currentRenderingTimeSlot) {
                        isActive = window.tagUtils.isCurrentMinuteSlot(fullTag, window.currentRenderingTimeSlot);
                    }
                    break;
            }
        }

        const activeClass = isActive ? ' temporal-active' : '';
        // Use simple HTML escaping inline to avoid dependency issues
        const escContent = tagContent.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const escFull = fullTag.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const dataAttr = `data-temporal-type="${tagType}" data-temporal="${escContent}"`;

        // For minute slots, add an extra attribute to help with line-level styling
        const lineActiveAttr = (tagType === 'minuteSlot' && isActive) ? ' data-temporal-line-active="true"' : '';

        return `<span class="${classes}${activeClass}" ${dataAttr}${lineActiveAttr}>${icon ? `<span class="temporal-icon">${icon}</span>` : ''}${escFull}</span>`;
    };
}

// Tag extraction functions now in utils/tagUtils.js

// Enhanced strikethrough plugin with delete buttons
function enhancedStrikethroughPlugin(md) {
    // Override the default strikethrough renderer
    md.renderer.rules.s_open = function(tokens, idx, options, env, renderer) {
        const token = tokens[idx];
        // Generate unique ID for this strikethrough element
        const uniqueId = 'strike-' + Math.random().toString(36).substr(2, 9);
        return `<span class="strikethrough-container" data-strike-id="${uniqueId}">` +
               `<del class="strikethrough-content">`;
    };

    md.renderer.rules.s_close = function(tokens, idx, options, env, renderer) {
        return `</del></span>`;
    };
}

// Speaker Notes Plugin
// Handles lines starting with ;; as speaker notes
// Consecutive ;; lines are grouped into a single div
function speakerNotePlugin(md) {
    // Parse speaker note lines (starting with ;;)
    function parseSpeakerNote(state, startLine, endLine, silent) {
        let pos = state.bMarks[startLine] + state.tShift[startLine];
        let max = state.eMarks[startLine];

        // Check if line starts with ;;
        if (pos + 1 >= max) { return false; }
        if (state.src.charCodeAt(pos) !== 0x3B /* ; */) { return false; }
        if (state.src.charCodeAt(pos + 1) !== 0x3B /* ; */) { return false; }

        // Don't process if we're in silent mode
        if (silent) { return true; }

        // Collect all consecutive ;; lines
        const lines = [];
        let nextLine = startLine;

        while (nextLine < endLine) {
            let linePos = state.bMarks[nextLine] + state.tShift[nextLine];
            let lineMax = state.eMarks[nextLine];

            // Check if this line starts with ;;
            if (linePos + 1 < lineMax &&
                state.src.charCodeAt(linePos) === 0x3B /* ; */ &&
                state.src.charCodeAt(linePos + 1) === 0x3B /* ; */) {

                // Get content after ;;
                const content = state.src.slice(linePos + 2, lineMax).trim();
                lines.push(content);
                nextLine++;
            } else {
                // Stop when we hit a non-;; line
                break;
            }
        }

        // Create token with combined content
        const token = state.push('speaker_note', 'div', 0);
        token.content = lines.join('\n');
        token.markup = ';;';

        state.line = nextLine;
        return true;
    }

    // Register the block rule
    md.block.ruler.before('paragraph', 'speaker_note', parseSpeakerNote);

    // Render rule for speaker notes (supports multiline with <br>)
    md.renderer.rules.speaker_note = function(tokens, idx) {
        const token = tokens[idx];
        // Replace newlines with <br> for multiline notes
        const content = escapeHtml(token.content).replace(/\n/g, '<br>');
        return `<div class="speaker-note">${content}</div>\n`;
    };
}

// HTML Comment and Content Rendering Plugin
// Handles HTML comments and HTML content based on user settings
function htmlCommentPlugin(md, options = {}) {
    const commentMode = options.commentMode || 'hidden'; // 'hidden' or 'text'
    const contentMode = options.contentMode || 'html'; // 'html' or 'text'

    // Parse HTML comments as inline tokens
    function parseHtmlComment(state, silent) {
        let pos = state.pos;

        // Check for opening <!--
        if (pos + 3 >= state.posMax) {return false;}
        if (state.src.charCodeAt(pos) !== 0x3C /* < */) {return false;}
        if (state.src.charCodeAt(pos + 1) !== 0x21 /* ! */) {return false;}
        if (state.src.charCodeAt(pos + 2) !== 0x2D /* - */) {return false;}
        if (state.src.charCodeAt(pos + 3) !== 0x2D /* - */) {return false;}

        pos += 4;

        // Find closing -->
        let found = false;
        let content = '';
        let contentStart = pos;

        while (pos < state.posMax - 2) {
            if (state.src.charCodeAt(pos) === 0x2D /* - */ &&
                state.src.charCodeAt(pos + 1) === 0x2D /* - */ &&
                state.src.charCodeAt(pos + 2) === 0x3E /* > */) {
                found = true;
                content = state.src.slice(contentStart, pos);
                break;
            }
            pos++;
        }

        if (!found) {return false;}

        // IMPORTANT: When returning true, state.pos MUST always be advanced
        state.pos = pos + 3; // Skip closing -->

        if (silent) {return true;}

        // Create token
        const token = state.push('html_comment', 'span', 0);
        token.content = content.trim();
        token.markup = '<!--';

        return true;
    }

    // Register the inline rule - before 'html_inline' to capture comments first
    md.inline.ruler.before('html_inline', 'html_comment', parseHtmlComment);

    // Also register as block rule to catch block-level comments
    md.block.ruler.before('html_block', 'html_comment_block', parseHtmlComment);

    // Render rule for HTML comments
    md.renderer.rules.html_comment = function(tokens, idx) {
        const token = tokens[idx];
        const content = token.content;

        if (commentMode === 'hidden') {
            // Hide comment completely
            return '';
        }

        // Return visible comment marker (escaped so it shows as text)
        return `<span class="html-comment-marker" title="HTML Comment">&lt;!--${escapeHtml(content)}--&gt;</span>`;
    };

    // Override default html_block renderer to handle comments and content
    const originalHtmlBlock = md.renderer.rules.html_block;
    md.renderer.rules.html_block = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const content = token.content;

        // Check if this is an HTML comment
        if (content.trim().startsWith('<!--') && content.trim().endsWith('-->')) {
            const commentContent = content.trim().slice(4, -3).trim();

            if (commentMode === 'hidden') {
                return '';
            }

            return `<div class="html-comment-marker" title="HTML Comment">&lt;!--${escapeHtml(commentContent)}--&gt;</div>`;
        }

        // Check if this is HTML content (not a comment, not a URL)
        // HTML content starts with < but not <http or <https
        const trimmedContent = content.trim();
        const isHtmlContent = trimmedContent.startsWith('<') &&
                              !trimmedContent.match(/^<https?:\/\//i);

        if (isHtmlContent && contentMode === 'text') {
            // Render HTML tags as visible text
            return `<pre class="html-content-text">${escapeHtml(content)}</pre>`;
        }

        // Not a comment or should render as HTML, use original renderer
        return originalHtmlBlock ? originalHtmlBlock(tokens, idx, options, env, self) : content;
    };

    // Override default html_inline renderer for inline HTML content
    const originalHtmlInline = md.renderer.rules.html_inline;
    md.renderer.rules.html_inline = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const content = token.content;

        // Check if this is inline HTML content (not a URL)
        const trimmedContent = content.trim();
        const isHtmlContent = trimmedContent.startsWith('<') &&
                              !trimmedContent.match(/^<https?:\/\//i);

        if (isHtmlContent && contentMode === 'text') {
            // Render HTML tags as visible text
            return `<code class="html-content-text">${escapeHtml(content)}</code>`;
        }

        // Should render as HTML, use original renderer
        return originalHtmlInline ? originalHtmlInline(tokens, idx, options, env, self) : content;
    };
}

// ============================================================================
// PlantUML Rendering System
// ============================================================================

// MEMORY SAFETY: Cache size limits to prevent unbounded growth
const DIAGRAM_CACHE_MAX_SIZE = 100;

/**
 * Set a value in a cache with size limit (FIFO eviction)
 * @param {Map} cache - The cache Map
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} maxSize - Maximum cache size
 */
function setCacheWithLimit(cache, key, value, maxSize = DIAGRAM_CACHE_MAX_SIZE) {
    // If key already exists, delete it first so it becomes "newest"
    if (cache.has(key)) {
        cache.delete(key);
    }
    // Evict oldest entries if at capacity
    while (cache.size >= maxSize) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
    }
    cache.set(key, value);
}

// PlantUML is now rendered in the extension backend (Node.js)
// No initialization needed in webview
window.plantumlReady = true; // Always ready - backend handles rendering

// Queue for pending PlantUML diagrams
const pendingPlantUMLQueue = [];
let plantumlQueueProcessing = false;

// Cache for rendered PlantUML diagrams (code → svg)
// MEMORY SAFETY: Limited to DIAGRAM_CACHE_MAX_SIZE entries
const plantumlRenderCache = new Map();
window.plantumlRenderCache = plantumlRenderCache; // Make globally accessible

/**
 * Queue a PlantUML diagram for rendering
 * @param {string} id - Unique placeholder ID
 * @param {string} code - PlantUML source code
 */
function queuePlantUMLRender(id, code) {
    pendingPlantUMLQueue.push({ id, code, timestamp: Date.now() });
    setTimeout(() => processPlantUMLQueue(), 10);
}

// Map to store pending render requests
const plantUMLRenderRequests = new Map();
let plantUMLRequestId = 0;

/**
 * Render PlantUML code to SVG using backend (Node.js + Java)
 * @param {string} code - PlantUML source code (without @startuml/@enduml)
 * @returns {Promise<string>} SVG content
 */
async function renderPlantUML(code) {
    // Check cache first
    if (plantumlRenderCache.has(code)) {
        return plantumlRenderCache.get(code);
    }

    // Wrap content with required delimiters
    const wrappedCode = `@startuml\n${code.trim()}\n@enduml`;

    return new Promise((resolve, reject) => {
        const requestId = `plantuml-${++plantUMLRequestId}`;


        // Store promise callbacks
        plantUMLRenderRequests.set(requestId, { resolve, reject, code });

        // Send request to extension backend
        vscode.postMessage({
            type: 'renderPlantUML',
            requestId: requestId,
            code: wrappedCode
        });

        // Timeout after 30 seconds
        setTimeout(() => {
            if (plantUMLRenderRequests.has(requestId)) {
                plantUMLRenderRequests.delete(requestId);
                reject(new Error('PlantUML rendering timeout'));
            }
        }, 30000);
    });
}

// Make renderPlantUML globally accessible for conversion handler
window.renderPlantUML = renderPlantUML;

// Diagram rendering (draw.io, excalidraw)
// MEMORY SAFETY: Limited to DIAGRAM_CACHE_MAX_SIZE entries
const diagramRenderCache = new Map();  // Cache key: `${type}:${path}:${mtime}` → svgDataUrl
const diagramRenderRequests = new Map();
let diagramRequestId = 0;
const pendingDiagramQueue = [];
let diagramQueueProcessing = false;

// Track rendered diagram files with their mtimes for change detection
// Key: `${diagramType}:${filePath}:${includeDir || ''}`, Value: { mtime, imageDataUrl }
const renderedMediaTracker = new Map();

function getRenderedDiagramKey(filePath, diagramType, includeDir) {
    return `${diagramType}:${filePath}:${includeDir || ''}`;
}

function getRenderedDiagramCache(filePath, diagramType, includeDir) {
    const key = getRenderedDiagramKey(filePath, diagramType, includeDir);
    return renderedMediaTracker.get(key);
}

function setRenderedDiagramCache(filePath, diagramType, includeDir, mtime, imageDataUrl) {
    const key = getRenderedDiagramKey(filePath, diagramType, includeDir);
    renderedMediaTracker.set(key, { mtime, imageDataUrl });
}

/**
 * Invalidate cached diagram renders for a specific file path
 * Removes all cache entries for the file (regardless of mtime)
 */
function invalidateDiagramCache(filePath, diagramType) {
    const prefix = `${diagramType}:${filePath}:`;
    for (const key of diagramRenderCache.keys()) {
        if (key.startsWith(prefix)) {
            diagramRenderCache.delete(key);
        }
    }
    for (const key of renderedMediaTracker.keys()) {
        if (key.startsWith(prefix)) {
            renderedMediaTracker.delete(key);
        }
    }
}

/**
 * Clear all diagram render cache (called on webview focus)
 */
function clearDiagramCache() {
    diagramRenderCache.clear();
    renderedMediaTracker.clear();
}

// Expose diagram cache functions for external calls (e.g., from webview.js)
window.clearDiagramCache = clearDiagramCache;
window.invalidateDiagramCache = invalidateDiagramCache;
// Expose diagram rendering functions for re-rendering on file changes
window.queueDiagramRender = queueDiagramRender;
window.processDiagramQueue = processDiagramQueue;

/**
 * Render diagram file (draw.io or excalidraw) to SVG using backend
 * @param {string} filePath - Path to diagram file
 * @param {string} diagramType - Type of diagram ('drawio' or 'excalidraw')
 * @param {string} [includeDir] - Directory of include file for relative path resolution
 * @returns {Promise<{svgDataUrl: string, fileMtime: number}>} SVG data URL and file mtime
 */
async function renderDiagram(filePath, diagramType, includeDir) {
    return new Promise((resolve, reject) => {
        const requestId = `diagram-${++diagramRequestId}`;

        // Store promise callbacks
        diagramRenderRequests.set(requestId, { resolve, reject, filePath, diagramType });

        // Send request to extension backend
        const messageType = diagramType === 'drawio' ? 'requestDrawIORender' : 'requestExcalidrawRender';
        const message = {
            type: messageType,
            requestId: requestId,
            filePath: filePath
        };
        // Add include context if available (for resolving relative paths in include files)
        if (includeDir) {
            message.includeDir = includeDir;
        }
        vscode.postMessage(message);

        // Timeout after 30 seconds
        setTimeout(() => {
            if (diagramRenderRequests.has(requestId)) {
                diagramRenderRequests.delete(requestId);
                reject(new Error(`${diagramType} rendering timeout`));
            }
        }, 30000);
    });
}

/**
 * Queue a diagram for async rendering
 * @param {string} id - Unique ID for the diagram placeholder
 * @param {string} filePath - Path to diagram file
 * @param {string} diagramType - Type of diagram ('drawio' or 'excalidraw')
 * @param {string} [includeDir] - Directory of include file for relative path resolution
 */
function queueDiagramRender(id, filePath, diagramType, includeDir) {
    pendingDiagramQueue.push({ id, filePath, diagramType, includeDir, timestamp: Date.now() });
}

/**
 * Render a specific PDF page to PNG using backend
 * @param {string} filePath - Path to PDF file
 * @param {number} pageNumber - Page number to render (1-indexed)
 * @param {string} [includeDir] - Directory of include file for relative path resolution
 * @returns {Promise<{pngDataUrl: string, fileMtime: number}>} PNG data URL and file mtime
 */
async function renderPDFPage(filePath, pageNumber, includeDir) {
    return new Promise((resolve, reject) => {
        const requestId = `pdf-${++diagramRequestId}`;

        // Store promise callbacks
        diagramRenderRequests.set(requestId, { resolve, reject, filePath, pageNumber });

        // Send request to extension backend
        const message = {
            type: 'requestPDFPageRender',
            requestId: requestId,
            filePath: filePath,
            pageNumber: pageNumber
        };
        if (includeDir) {
            message.includeDir = includeDir;
        }
        vscode.postMessage(message);

        // Timeout after 30 seconds
        setTimeout(() => {
            if (diagramRenderRequests.has(requestId)) {
                diagramRenderRequests.delete(requestId);
                reject(new Error(`PDF page ${pageNumber} rendering timeout`));
            }
        }, 30000);
    });
}

function queuePDFPageRender(id, filePath, pageNumber, includeDir) {
    pendingDiagramQueue.push({ id, filePath, pageNumber, diagramType: 'pdf', includeDir, timestamp: Date.now() });
}

/**
 * Request PDF info (page count) from backend
 * @param {string} filePath - Path to PDF file
 * @param {string} [includeDir] - Directory of include file for relative path resolution
 * @returns {Promise<{pageCount: number, fileMtime: number}>}
 */
async function getPDFInfo(filePath, includeDir) {
    return new Promise((resolve, reject) => {
        const requestId = `pdfinfo-${++diagramRequestId}`;

        // Store promise callbacks
        diagramRenderRequests.set(requestId, { resolve, reject, filePath });

        // Send request to extension backend
        const message = {
            type: 'requestPDFInfo',
            requestId: requestId,
            filePath: filePath
        };
        if (includeDir) {
            message.includeDir = includeDir;
        }
        vscode.postMessage(message);

        // Timeout after 10 seconds
        setTimeout(() => {
            if (diagramRenderRequests.has(requestId)) {
                diagramRenderRequests.delete(requestId);
                reject(new Error(`PDF info request timeout`));
            }
        }, 10000);
    });
}

function queuePDFSlideshow(id, filePath, includeDir, initialPage = 1, alt = '', title = '') {
    pendingDiagramQueue.push({
        id,
        filePath,
        diagramType: 'pdf-slideshow',
        includeDir,
        initialPage,
        alt,
        title,
        timestamp: Date.now()
    });
}

// ============= EPUB RENDERING FUNCTIONS =============

/**
 * Request EPUB page rendering from backend
 * @param {string} filePath - Path to EPUB file
 * @param {number} pageNumber - Page number to render (1-indexed)
 * @param {string} [includeDir] - Directory of include file for relative path resolution
 * @returns {Promise<{pngDataUrl: string, fileMtime: number}>} PNG data URL and file mtime
 */
async function renderEPUBPage(filePath, pageNumber, includeDir) {
    return new Promise((resolve, reject) => {
        const requestId = `epub-${++diagramRequestId}`;

        // Store promise callbacks
        diagramRenderRequests.set(requestId, { resolve, reject, filePath, pageNumber });

        // Send request to extension backend
        const message = {
            type: 'requestEPUBPageRender',
            requestId: requestId,
            filePath: filePath,
            pageNumber: pageNumber
        };
        if (includeDir) {
            message.includeDir = includeDir;
        }
        vscode.postMessage(message);

        // Timeout after 30 seconds
        setTimeout(() => {
            if (diagramRenderRequests.has(requestId)) {
                diagramRenderRequests.delete(requestId);
                reject(new Error(`EPUB page ${pageNumber} rendering timeout`));
            }
        }, 30000);
    });
}

/**
 * Request EPUB info (page count) from backend
 * @param {string} filePath - Path to EPUB file
 * @param {string} [includeDir] - Directory of include file for relative path resolution
 * @returns {Promise<{pageCount: number, fileMtime: number}>}
 */
async function getEPUBInfo(filePath, includeDir) {
    return new Promise((resolve, reject) => {
        const requestId = `epubinfo-${++diagramRequestId}`;

        // Store promise callbacks
        diagramRenderRequests.set(requestId, { resolve, reject, filePath });

        // Send request to extension backend
        const message = {
            type: 'requestEPUBInfo',
            requestId: requestId,
            filePath: filePath
        };
        if (includeDir) {
            message.includeDir = includeDir;
        }
        vscode.postMessage(message);

        // Timeout after 10 seconds
        setTimeout(() => {
            if (diagramRenderRequests.has(requestId)) {
                diagramRenderRequests.delete(requestId);
                reject(new Error(`EPUB info request timeout`));
            }
        }, 10000);
    });
}

function queueEPUBSlideshow(id, filePath, includeDir) {
    pendingDiagramQueue.push({ id, filePath, diagramType: 'epub-slideshow', includeDir, timestamp: Date.now() });
}

/**
 * Create interactive EPUB slideshow with navigation controls
 * @param {HTMLElement} element - Container element
 * @param {string} filePath - Path to EPUB file
 * @param {number} pageCount - Total number of pages
 * @param {number} fileMtime - File modification time for caching
 * @param {string} [includeDir] - Directory of include file for relative path resolution
 */
async function createEPUBSlideshow(element, filePath, pageCount, fileMtime, includeDir) {
    // Create unique ID for this slideshow
    const slideshowId = `epub-slideshow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Initial state: page 1
    let currentPage = 1;

    // Create slideshow container with overlay wrapper for burger menu
    const wrapper = document.createElement('span');
    wrapper.className = 'image-path-overlay-container pdf-slideshow-wrapper';
    wrapper.dataset.filePath = filePath;

    const container = document.createElement('div');
    container.className = 'pdf-slideshow';  // Reuse PDF slideshow CSS
    container.id = slideshowId;
    container.setAttribute('data-epub-path', filePath);
    container.setAttribute('data-page-count', pageCount);
    container.setAttribute('data-current-page', currentPage);

    // Burger menu button for path operations
    const menuBtn = document.createElement('button');
    menuBtn.className = 'image-menu-btn';
    menuBtn.title = 'Path options';
    menuBtn.textContent = '☰';
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof toggleImagePathMenu === 'function') {
            toggleImagePathMenu(wrapper, filePath);
        }
    };

    // Image container
    const imageContainer = document.createElement('div');
    imageContainer.className = 'pdf-slideshow-image';  // Reuse PDF slideshow CSS

    // Controls container
    const controls = document.createElement('div');
    controls.className = 'pdf-slideshow-controls';  // Reuse PDF slideshow CSS

    const prevBtn = document.createElement('button');
    prevBtn.className = 'pdf-slideshow-btn pdf-slideshow-prev';
    prevBtn.innerHTML = '◀ Prev';
    prevBtn.disabled = (currentPage === 1);

    const pageInfo = document.createElement('span');
    pageInfo.className = 'pdf-slideshow-page-info';
    pageInfo.textContent = `Page ${currentPage} of ${pageCount}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'pdf-slideshow-btn pdf-slideshow-next';
    nextBtn.innerHTML = 'Next ▶';
    nextBtn.disabled = (currentPage === pageCount);

    controls.appendChild(prevBtn);
    controls.appendChild(pageInfo);
    controls.appendChild(nextBtn);

    container.appendChild(imageContainer);
    container.appendChild(controls);

    // Assemble the wrapper with burger menu
    wrapper.appendChild(container);
    wrapper.appendChild(menuBtn);

    // Replace placeholder with slideshow
    element.innerHTML = '';
    element.appendChild(wrapper);

    // Function to load and display a specific page
    const loadPage = async (pageNumber) => {
        try {
            imageContainer.innerHTML = '<div class="pdf-slideshow-loading">Loading page...</div>';

            // Request page rendering (pass includeDir for correct relative path resolution)
            const result = await renderEPUBPage(filePath, pageNumber, includeDir);
            const { pngDataUrl } = result;

            // Update image
            imageContainer.innerHTML = `<img src="${pngDataUrl}" alt="EPUB page ${pageNumber}" class="diagram-rendered" />`;

            // Trigger height recalculation after image loads
            const img = imageContainer.querySelector('img');
            if (img) {
                const triggerRecalc = () => {
                    const columnElement = imageContainer.closest('.kanban-full-height-column');
                    const columnId = columnElement?.getAttribute('data-column-id');
                    if (typeof window.applyStackedColumnStyles === 'function') {
                        window.applyStackedColumnStyles(columnId);
                    }
                };
                if (img.complete) {
                    requestAnimationFrame(triggerRecalc);
                } else {
                    img.onload = triggerRecalc;
                }
            }

            // Update state
            currentPage = pageNumber;
            container.setAttribute('data-current-page', currentPage);

            // Update controls
            prevBtn.disabled = (currentPage === 1);
            nextBtn.disabled = (currentPage === pageCount);
            pageInfo.textContent = `Page ${currentPage} of ${pageCount}`;

        } catch (error) {
            console.error('[EPUB Slideshow] Failed to load page:', error);
            // Use unified .image-not-found structure for consistent error styling
            const shortPath = typeof getShortDisplayPath === 'function' ? getShortDisplayPath(filePath) : filePath.split('/').pop() || filePath;
            const escapedPath = filePath.replace(/"/g, '&quot;');
            const escapedShortPath = shortPath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            imageContainer.innerHTML = `<span class="image-path-overlay-container image-broken" data-file-path="${escapedPath}">
                <span class="image-not-found" data-original-src="${escapedPath}" title="Failed to load EPUB page ${pageNumber}: ${filePath}">
                    <span class="image-not-found-text">📚 ${escapedShortPath} (page ${pageNumber})</span>
                    <button class="image-menu-btn" data-action="toggle-menu" title="Path options">☰</button>
                </span>
            </span>`;
        }
    };

    // Button event handlers
    prevBtn.onclick = (e) => {
        e.stopPropagation();
        if (currentPage > 1) {
            loadPage(currentPage - 1);
        }
    };

    nextBtn.onclick = (e) => {
        e.stopPropagation();
        if (currentPage < pageCount) {
            loadPage(currentPage + 1);
        }
    };

    // Load first page
    await loadPage(1);
}

/**
 * Create interactive PDF slideshow with navigation controls
 * @param {HTMLElement} element - Container element
 * @param {string} filePath - Path to PDF file
 * @param {number} pageCount - Total number of pages
 * @param {number} fileMtime - File modification time for caching
 * @param {string} [includeDir] - Directory of include file for relative path resolution
 * @param {number} [initialPage=1] - Starting page number (1-indexed)
 * @param {string} [alt=''] - Alt text from markdown (displayed as title)
 * @param {string} [title=''] - Title/description from markdown (displayed as tooltip)
 */
async function createPDFSlideshow(element, filePath, pageCount, fileMtime, includeDir, initialPage = 1, alt = '', title = '') {
    // Create unique ID for this slideshow
    const slideshowId = `pdf-slideshow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Initial state: clamp initial page to valid range
    const startPage = Math.max(1, Math.min(initialPage, pageCount));
    let currentPage = startPage;

    // Create slideshow container with overlay wrapper for burger menu
    const wrapper = document.createElement('span');
    wrapper.className = 'image-path-overlay-container pdf-slideshow-wrapper';
    wrapper.dataset.filePath = filePath;
    // Add tooltip from title/description if provided
    if (title) {
        wrapper.title = title;
    }

    const container = document.createElement('div');
    container.className = 'pdf-slideshow';
    container.id = slideshowId;
    container.setAttribute('data-pdf-path', filePath);
    container.setAttribute('data-page-count', pageCount);
    container.setAttribute('data-current-page', currentPage);
    container.setAttribute('data-initial-page', startPage);

    // Burger menu button for path operations
    const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    const menuBtn = document.createElement('button');
    menuBtn.className = 'image-menu-btn';
    menuBtn.title = 'Path options';
    menuBtn.textContent = '☰';
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof toggleImagePathMenu === 'function') {
            toggleImagePathMenu(wrapper, filePath);
        }
    };

    // Image container
    const imageContainer = document.createElement('div');
    imageContainer.className = 'pdf-slideshow-image';

    // Controls container
    const controls = document.createElement('div');
    controls.className = 'pdf-slideshow-controls';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'pdf-slideshow-btn pdf-slideshow-prev';
    prevBtn.innerHTML = '◀ Prev';
    prevBtn.disabled = (currentPage === 1);

    const pageInfo = document.createElement('span');
    pageInfo.className = 'pdf-slideshow-page-info';
    pageInfo.textContent = `Page ${currentPage} of ${pageCount}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'pdf-slideshow-btn pdf-slideshow-next';
    nextBtn.innerHTML = 'Next ▶';
    nextBtn.disabled = (currentPage === pageCount);

    controls.appendChild(prevBtn);
    controls.appendChild(pageInfo);
    controls.appendChild(nextBtn);

    // Add alt text as title header if provided
    if (alt) {
        const titleHeader = document.createElement('div');
        titleHeader.className = 'pdf-slideshow-title';
        titleHeader.textContent = alt;
        container.appendChild(titleHeader);
    }

    container.appendChild(imageContainer);
    container.appendChild(controls);

    // Assemble the wrapper with burger menu
    wrapper.appendChild(container);
    wrapper.appendChild(menuBtn);

    // Replace placeholder with slideshow
    element.innerHTML = '';
    element.appendChild(wrapper);

    // Function to load and display a specific page
    const loadPage = async (pageNumber) => {
        try {
            imageContainer.innerHTML = '<div class="pdf-slideshow-loading">Loading page...</div>';

            // Request page rendering (pass includeDir for correct relative path resolution)
            const result = await renderPDFPage(filePath, pageNumber, includeDir);
            const { pngDataUrl } = result;

            // Update image
            imageContainer.innerHTML = `<img src="${pngDataUrl}" alt="PDF page ${pageNumber}" class="diagram-rendered" />`;

            // Trigger height recalculation after image loads
            const img = imageContainer.querySelector('img');
            if (img) {
                const triggerRecalc = () => {
                    const columnElement = imageContainer.closest('.kanban-full-height-column');
                    const columnId = columnElement?.getAttribute('data-column-id');
                    if (typeof window.applyStackedColumnStyles === 'function') {
                        window.applyStackedColumnStyles(columnId);
                    }
                };
                if (img.complete) {
                    requestAnimationFrame(triggerRecalc);
                } else {
                    img.onload = triggerRecalc;
                }
            }

            // Update state
            currentPage = pageNumber;
            container.setAttribute('data-current-page', currentPage);

            // Update controls
            pageInfo.textContent = `Page ${currentPage} of ${pageCount}`;
            prevBtn.disabled = (currentPage === 1);
            nextBtn.disabled = (currentPage === pageCount);

        } catch (error) {
            console.error(`[PDF Slideshow] Failed to load page ${pageNumber}:`, error);
            // Use unified .image-not-found structure for consistent error styling
            const shortPath = typeof getShortDisplayPath === 'function' ? getShortDisplayPath(filePath) : filePath.split('/').pop() || filePath;
            const escapedPath = filePath.replace(/"/g, '&quot;');
            const escapedShortPath = shortPath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            imageContainer.innerHTML = `<span class="image-path-overlay-container image-broken" data-file-path="${escapedPath}">
                <span class="image-not-found" data-original-src="${escapedPath}" title="Failed to load PDF page ${pageNumber}: ${filePath}">
                    <span class="image-not-found-text">📄 ${escapedShortPath} (page ${pageNumber})</span>
                    <button class="image-menu-btn" data-action="toggle-menu" title="Path options">☰</button>
                </span>
            </span>`;
        }
    };

    // Event listeners for navigation (stopPropagation prevents opening editor)
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentPage > 1) {
            loadPage(currentPage - 1);
        }
    });

    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentPage < pageCount) {
            loadPage(currentPage + 1);
        }
    });

    // Load initial page (defaults to 1, can be specified via ?p=N query param)
    await loadPage(startPage);
}

/**
 * Process all pending diagram renders in the queue
 * Height recalculation is handled automatically by the column ResizeObserver
 */
async function processDiagramQueue() {
    if (diagramQueueProcessing || pendingDiagramQueue.length === 0) {
        return;
    }

    diagramQueueProcessing = true;

    while (pendingDiagramQueue.length > 0) {
        const item = pendingDiagramQueue.shift();
        const element = document.getElementById(item.id);

        if (!element) {
            console.warn(`[Diagram] Placeholder not found: ${item.id}`);
            continue;
        }

        try {
            // Handle PDF slideshow separately
            if (item.diagramType === 'pdf-slideshow') {
                // Get PDF info (page count)
                const pdfInfo = await getPDFInfo(item.filePath, item.includeDir);
                const { pageCount, fileMtime } = pdfInfo;

                // Create slideshow UI with optional initial page, alt text, and title
                await createPDFSlideshow(
                    element,
                    item.filePath,
                    pageCount,
                    fileMtime,
                    item.includeDir,
                    item.initialPage || 1,
                    item.alt || '',
                    item.title || ''
                );
                continue;
            }

            // Handle EPUB slideshow separately
            if (item.diagramType === 'epub-slideshow') {
                // Get EPUB info (page count)
                const epubInfo = await getEPUBInfo(item.filePath, item.includeDir);
                const { pageCount, fileMtime } = epubInfo;

                // Create slideshow UI
                await createEPUBSlideshow(element, item.filePath, pageCount, fileMtime, item.includeDir);
                continue;
            }

            let imageDataUrl, fileMtime, displayLabel;

            // Render based on type
            if (item.diagramType === 'pdf') {
                // Render PDF page
                const result = await renderPDFPage(item.filePath, item.pageNumber, item.includeDir);
                imageDataUrl = result.pngDataUrl;
                fileMtime = result.fileMtime;
                displayLabel = `PDF page ${item.pageNumber}`;
            } else {
                // Render diagram (draw.io or excalidraw) with cache reuse when unchanged
                const cachedDiagram = getRenderedDiagramCache(item.filePath, item.diagramType, item.includeDir);
                if (cachedDiagram) {
                    imageDataUrl = cachedDiagram.imageDataUrl;
                    fileMtime = cachedDiagram.mtime;
                } else {
                    const result = await renderDiagram(item.filePath, item.diagramType, item.includeDir);
                    imageDataUrl = result.svgDataUrl;
                    fileMtime = result.fileMtime;
                    setRenderedDiagramCache(item.filePath, item.diagramType, item.includeDir, fileMtime, imageDataUrl);
                }
                displayLabel = `${item.diagramType} diagram`;
            }

            // Cache with mtime for invalidation on file changes
            const cacheKey = item.diagramType === 'pdf'
                ? `pdf:${item.filePath}:${item.pageNumber}:${fileMtime}`
                : `${item.diagramType}:${item.filePath}:${item.includeDir || ''}:${fileMtime}`;

            // Invalidate old cache entries for this file first
            invalidateDiagramCache(item.filePath, item.diagramType);
            // Add current version (with size limit)
            setCacheWithLimit(diagramRenderCache, cacheKey, imageDataUrl);
            if (item.diagramType !== 'pdf' && item.diagramType !== 'pdf-slideshow' && item.diagramType !== 'epub-slideshow') {
                setRenderedDiagramCache(item.filePath, item.diagramType, item.includeDir, fileMtime, imageDataUrl);
            }

            // Replace placeholder with rendered image wrapped in overlay container with menu
            // Include data-original-src for alt-click to open in editor
            // Height recalculation is handled automatically by the column ResizeObserver
            // Decode URL-encoded paths (e.g., %20 -> space) before escaping for JS string
            let decodedPath = item.filePath;
            try {
                decodedPath = decodeURIComponent(item.filePath);
            } catch (e) {
                // If decoding fails, use original path
            }
            const escapedPath = decodedPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
            if (element.dataset && element.dataset.wysiwygHost === 'true') {
                element.classList.remove('diagram-placeholder');
                // Add image-path-overlay-container class and data-file-path for unified handling
                element.classList.add('image-path-overlay-container');
                element.dataset.filePath = decodedPath;

                const img = document.createElement('img');
                img.src = imageDataUrl;
                img.alt = displayLabel;
                img.className = 'diagram-rendered';
                img.dataset.originalSrc = decodedPath;
                img.setAttribute('data-original-src', decodedPath);
                img.setAttribute('contenteditable', 'false');

                const menuBtn = document.createElement('button');
                menuBtn.className = 'image-menu-btn';
                menuBtn.title = 'Path options';
                menuBtn.textContent = '☰';
                menuBtn.setAttribute('data-action', 'image-menu');
                menuBtn.setAttribute('contenteditable', 'false');
                menuBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleImagePathMenu(element, decodedPath);
                };

                element.innerHTML = '';
                element.appendChild(img);
                element.appendChild(menuBtn);
            } else {
                // Use data-file-path for unified path handling across all media types
                // Use data-action for event delegation instead of inline onclick
                element.innerHTML = `<span class="image-path-overlay-container" data-file-path="${decodedPath.replace(/"/g, '&quot;')}">
                    <img src="${imageDataUrl}" alt="${displayLabel}" class="diagram-rendered" data-original-src="${decodedPath.replace(/"/g, '&quot;')}" />
                    <button class="image-menu-btn" data-action="image-menu" title="Path options">☰</button>
                </span>`;
            }

            // Trigger height recalculation after image loads
            // Data URLs load synchronously but we still need to trigger recalc
            const img = element.querySelector('img');
            if (img) {
                const triggerRecalc = () => {
                    const columnElement = element.closest('.kanban-full-height-column');
                    const columnId = columnElement?.getAttribute('data-column-id');
                    if (typeof window.applyStackedColumnStyles === 'function') {
                        window.applyStackedColumnStyles(columnId);
                    }
                };
                if (img.complete) {
                    // Already loaded (data URLs), trigger on next frame
                    requestAnimationFrame(triggerRecalc);
                } else {
                    img.onload = triggerRecalc;
                }
            }

        } catch (error) {
            console.error(`[Diagram] Rendering failed for ${item.filePath}:`, error);
            // Determine error label and emoji based on diagram type
            const typeInfo = {
                'pdf': { label: `PDF page ${item.pageNumber}`, emoji: '📄' },
                'pdf-slideshow': { label: 'PDF', emoji: '📄' },
                'epub-slideshow': { label: 'EPUB', emoji: '📚' },
                'drawio': { label: 'DrawIO diagram', emoji: '📊' },
                'excalidraw': { label: 'Excalidraw diagram', emoji: '🎨' }
            }[item.diagramType] || { label: `${item.diagramType} diagram`, emoji: '📷' };
            // Wrap error in overlay container with burger menu for path operations
            let decodedPath = item.filePath;
            try {
                decodedPath = decodeURIComponent(item.filePath);
            } catch (e) {
                // If decoding fails, use original path
            }
            const escapedPath = decodedPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
            // Use unified .image-not-found structure for consistent error styling
            const shortPath = typeof getShortDisplayPath === 'function' ? getShortDisplayPath(decodedPath) : decodedPath.split('/').pop() || decodedPath;
            element.innerHTML = `<span class="image-path-overlay-container image-broken" data-file-path="${decodedPath.replace(/"/g, '&quot;')}">
                <span class="image-not-found" data-original-src="${decodedPath.replace(/"/g, '&quot;')}" title="Failed to load ${typeInfo.label}: ${decodedPath}">
                    <span class="image-not-found-text">${typeInfo.emoji} ${shortPath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                    <button class="image-menu-btn" data-action="toggle-menu" title="Path options">☰</button>
                </span>
            </span>`;
        }
    }

    diagramQueueProcessing = false;
    // Height recalculation is handled automatically by the MutationObserver in boardRenderer.js
}

// Handle PlantUML render responses from backend
window.addEventListener('message', event => {
    const message = event.data;

    if (message.type === 'plantUMLRenderSuccess') {
        const { requestId, svg } = message;
        const request = plantUMLRenderRequests.get(requestId);

        if (request) {

            // Cache the result (with size limit)
            setCacheWithLimit(plantumlRenderCache, request.code, svg);

            // Resolve promise
            request.resolve(svg);
            plantUMLRenderRequests.delete(requestId);
        }
    } else if (message.type === 'plantUMLRenderError') {
        const { requestId, error } = message;
        const request = plantUMLRenderRequests.get(requestId);

        if (request) {
            console.error('[PlantUML] Rendering failed:', error);
            request.reject(new Error(error));
            plantUMLRenderRequests.delete(requestId);
        }
    } else if (message.type === 'drawioRenderSuccess' || message.type === 'excalidrawRenderSuccess') {
        const { requestId, svgDataUrl, fileMtime } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            // Resolve with both svgDataUrl and fileMtime for cache invalidation
            request.resolve({ svgDataUrl, fileMtime });
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'drawioRenderError' || message.type === 'excalidrawRenderError') {
        const { requestId, error } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            console.error(`[Diagram] Rendering failed:`, error);
            request.reject(new Error(error));
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'pdfPageRenderSuccess') {
        const { requestId, pngDataUrl, fileMtime } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            // Resolve with both pngDataUrl and fileMtime for cache invalidation
            request.resolve({ pngDataUrl, fileMtime });
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'pdfPageRenderError') {
        const { requestId, error } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            console.error(`[PDF] Page rendering failed:`, error);
            request.reject(new Error(error));
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'pdfInfoSuccess') {
        const { requestId, pageCount, fileMtime } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            request.resolve({ pageCount, fileMtime });
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'pdfInfoError') {
        const { requestId, error } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            console.error(`[PDF] Info request failed:`, error);
            request.reject(new Error(error));
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'epubPageRenderSuccess') {
        const { requestId, pngDataUrl, fileMtime } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            // Resolve with both pngDataUrl and fileMtime for cache invalidation
            request.resolve({ pngDataUrl, fileMtime });
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'epubPageRenderError') {
        const { requestId, error } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            console.error(`[EPUB] Page rendering failed:`, error);
            request.reject(new Error(error));
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'epubInfoSuccess') {
        const { requestId, pageCount, fileMtime } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            request.resolve({ pageCount, fileMtime });
            diagramRenderRequests.delete(requestId);
        }
    } else if (message.type === 'epubInfoError') {
        const { requestId, error } = message;
        const request = diagramRenderRequests.get(requestId);

        if (request) {
            console.error(`[EPUB] Info request failed:`, error);
            request.reject(new Error(error));
            diagramRenderRequests.delete(requestId);
        }
    }
});

// Clear diagram cache when webview gains focus
// The actual re-rendering of changed files will be triggered by backend after mtime check
window.addEventListener('focus', () => {
    clearDiagramCache();
});

// Also listen for visibility change (when tab becomes visible)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        clearDiagramCache();
    }
});

/**
 * Process all pending PlantUML diagrams in the queue
 */
async function processPlantUMLQueue() {
    if (plantumlQueueProcessing || pendingPlantUMLQueue.length === 0) {
        return;
    }

    plantumlQueueProcessing = true;

    // Track affected stacks for targeted height recalculation
    const affectedStacks = new Set();

    while (pendingPlantUMLQueue.length > 0) {
        const item = pendingPlantUMLQueue.shift();
        const element = document.getElementById(item.id);

        if (!element) {
            console.warn(`[PlantUML] Placeholder not found: ${item.id}`);
            continue;
        }

        // Track the stack this element is in (before replacement)
        const stack = element.closest('.kanban-column-stack');
        if (stack) {
            affectedStacks.add(stack);
        }

        try {
            const svg = await renderPlantUML(item.code);
            const escapedCode = escapeHtml(item.code).replace(/'/g, "\\'").replace(/"/g, '\\"');

            // Create wrapper with burger menu
            const wrapper = document.createElement('div');
            wrapper.className = 'diagram-overlay-container plantuml-wrapper';
            wrapper.dataset.diagramType = 'plantuml';
            wrapper.dataset.diagramCode = item.code;

            // Replace placeholder with diagram container
            const container = document.createElement('div');
            container.className = 'plantuml-diagram';
            container.innerHTML = svg;

            // Add burger menu button
            const menuBtn = document.createElement('button');
            menuBtn.className = 'diagram-menu-btn';
            menuBtn.title = 'Diagram options';
            menuBtn.textContent = '☰';
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                toggleDiagramMenu(wrapper, 'plantuml');
            };

            wrapper.appendChild(container);
            wrapper.appendChild(menuBtn);

            element.replaceWith(wrapper);
        } catch (error) {
            console.error('[PlantUML] Rendering error:', error);

            // Replace placeholder with error
            const errorDiv = document.createElement('div');
            errorDiv.className = 'plantuml-error';
            errorDiv.innerHTML = `
                <strong>PlantUML Error:</strong><br>
                <pre>${escapeHtml(error.message)}</pre>
            `;
            element.replaceWith(errorDiv);
        }
    }

    plantumlQueueProcessing = false;

    // Recalculate only affected stacks after diagrams have rendered
    if (affectedStacks.size > 0 && typeof window.updateStackLayout === 'function') {
        affectedStacks.forEach(stack => {
            window.updateStackLayout(stack);
        });
    }
}

// ============================================================================
// Mermaid Rendering System
// ============================================================================

// Initialize Mermaid (browser-based, pure JavaScript)
// Mermaid is lazy-loaded only when a mermaid block is first encountered
let mermaidReady = false;
let mermaidInitialized = false;
let mermaidLoading = false;
let mermaidLoadCallbacks = [];

const MERMAID_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

/**
 * Lazy-load Mermaid library from CDN
 * @returns {Promise<void>} Resolves when Mermaid is loaded and initialized
 */
function loadMermaidLibrary() {
    return new Promise((resolve, reject) => {
        // Already loaded and ready
        if (mermaidReady) {
            resolve();
            return;
        }

        // Already loading - queue the callback
        if (mermaidLoading) {
            mermaidLoadCallbacks.push({ resolve, reject });
            return;
        }

        // Check if already loaded via script tag
        if (typeof mermaid !== 'undefined') {
            initializeMermaid();
            resolve();
            return;
        }

        // Start loading
        mermaidLoading = true;
        logMermaid('Lazy-loading library from CDN...');
        const startTime = performance.now();

        const script = document.createElement('script');
        script.src = MERMAID_CDN_URL;
        script.async = true;

        script.onload = () => {
            logMermaid(`Library loaded in ${(performance.now() - startTime).toFixed(0)}ms`);
            initializeMermaid();
            mermaidLoading = false;
            resolve();
            // Resolve all queued callbacks
            mermaidLoadCallbacks.forEach(cb => cb.resolve());
            mermaidLoadCallbacks = [];
        };

        script.onerror = (error) => {
            console.error('[Mermaid] Failed to load library:', error);
            mermaidLoading = false;
            reject(new Error('Failed to load Mermaid library'));
            // Reject all queued callbacks
            mermaidLoadCallbacks.forEach(cb => cb.reject(error));
            mermaidLoadCallbacks = [];
        };

        document.head.appendChild(script);
    });
}

function initializeMermaid() {
    if (mermaidInitialized) {
        return;
    }

    if (typeof mermaid === 'undefined') {
        console.warn('[Mermaid] Library not loaded yet');
        return;
    }

    try {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose',
            fontFamily: 'inherit'
        });
        mermaidReady = true;
        mermaidInitialized = true;
        logMermaid('Initialized successfully');
    } catch (error) {
        console.error('[Mermaid] Initialization error:', error);
    }
}

// Don't initialize on load - wait for first mermaid block to be encountered

// Queue for pending Mermaid diagrams
const pendingMermaidQueue = [];
let mermaidQueueProcessing = false;

// Cache for rendered Mermaid diagrams (code → svg)
// MEMORY SAFETY: Limited to DIAGRAM_CACHE_MAX_SIZE entries
const mermaidRenderCache = new Map();
window.mermaidRenderCache = mermaidRenderCache; // Make globally accessible

/**
 * Queue a Mermaid diagram for rendering
 * @param {string} id - Unique placeholder ID
 * @param {string} code - Mermaid source code
 */
function queueMermaidRender(id, code) {
    pendingMermaidQueue.push({ id, code });

    // Process queue after a short delay (allows multiple diagrams to queue)
    setTimeout(() => processMermaidQueue(), 10);
}

/**
 * Render Mermaid code to SVG (browser-based, pure JavaScript)
 * @param {string} code - Mermaid source code
 * @returns {Promise<string>} SVG content
 */
async function renderMermaid(code) {
    // Check cache first
    if (mermaidRenderCache.has(code)) {
        return mermaidRenderCache.get(code);
    }

    // Lazy-load Mermaid if not ready
    if (!mermaidReady) {
        await loadMermaidLibrary();
    }

    if (!mermaidReady) {
        throw new Error('Mermaid not initialized');
    }

    try {
        const diagramId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Use mermaid.render() to generate SVG
        const { svg } = await mermaid.render(diagramId, code);

        // Cache the result (with size limit)
        setCacheWithLimit(mermaidRenderCache, code, svg);

        return svg;
    } catch (error) {
        console.error('[Mermaid] Rendering error:', error);
        throw error;
    }
}

// Make renderMermaid globally accessible for conversion handler
window.renderMermaid = renderMermaid;

/**
 * Process all pending Mermaid diagrams in the queue
 */
async function processMermaidQueue() {
    if (mermaidQueueProcessing || pendingMermaidQueue.length === 0) {
        return;
    }

    mermaidQueueProcessing = true;

    // Track affected stacks for targeted height recalculation
    const affectedStacks = new Set();

    while (pendingMermaidQueue.length > 0) {
        const item = pendingMermaidQueue.shift();

        const element = document.getElementById(item.id);
        if (!element) {
            console.warn(`[Mermaid] Placeholder not found: ${item.id}`);
            continue;
        }

        // Track the stack this element is in (before replacement)
        const stack = element.closest('.kanban-column-stack');
        if (stack) {
            affectedStacks.add(stack);
        }

        try {
            const svg = await renderMermaid(item.code);
            const escapedCode = escapeHtml(item.code).replace(/'/g, "\\'").replace(/"/g, '\\"');

            // Create wrapper with burger menu
            const wrapper = document.createElement('div');
            wrapper.className = 'diagram-overlay-container mermaid-wrapper';
            wrapper.dataset.diagramType = 'mermaid';
            wrapper.dataset.diagramCode = item.code;

            // Replace placeholder with diagram container
            const container = document.createElement('div');
            container.className = 'mermaid-diagram';
            container.innerHTML = svg;

            // Add burger menu button
            const menuBtn = document.createElement('button');
            menuBtn.className = 'diagram-menu-btn';
            menuBtn.title = 'Diagram options';
            menuBtn.textContent = '☰';
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                toggleDiagramMenu(wrapper, 'mermaid');
            };

            wrapper.appendChild(container);
            wrapper.appendChild(menuBtn);

            element.replaceWith(wrapper);
        } catch (error) {
            console.error('[Mermaid] Rendering error:', error);

            // Replace placeholder with error
            const errorDiv = document.createElement('div');
            errorDiv.className = 'mermaid-error';
            errorDiv.innerHTML = `
                <strong>Mermaid Error:</strong><br>
                <pre>${escapeHtml(error.message)}</pre>
            `;
            element.replaceWith(errorDiv);
        }
    }

    mermaidQueueProcessing = false;

    // Recalculate only affected stacks after diagrams have rendered
    if (affectedStacks.size > 0 && typeof window.updateStackLayout === 'function') {
        affectedStacks.forEach(stack => {
            window.updateStackLayout(stack);
        });
    }
}

/**
 * Add diagram (PlantUML/Mermaid) fence renderer to markdown-it instance
 */
function addDiagramFenceRenderer(md) {
    // Store original fence renderer
    const originalFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    // Override fence renderer (SYNCHRONOUS)
    md.renderer.rules.fence = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const info = token.info ? token.info.trim() : '';
        const langName = info.split(/\s+/g)[0];

        // Check if this is a PlantUML block
        if (langName.toLowerCase() === 'plantuml') {
            const code = token.content;
            const diagramId = createUniqueId('plantuml');

            // Queue for async processing
            queuePlantUMLRender(diagramId, code);

            // Return placeholder immediately (synchronous)
            return createLoadingPlaceholder(diagramId, 'plantuml-placeholder', 'Rendering PlantUML diagram...');
        }

        // Check if this is a Mermaid block
        if (langName.toLowerCase() === 'mermaid') {
            const code = token.content;
            const diagramId = createUniqueId('mermaid');

            // Queue for async processing
            queueMermaidRender(diagramId, code);

            // Return placeholder immediately (synchronous)
            return createLoadingPlaceholder(diagramId, 'mermaid-placeholder', 'Rendering Mermaid diagram...');
        }

        // Use original renderer for other languages
        return originalFence(tokens, idx, options, env, self);
    };
}

function renderMarkdown(text, includeContext) {
    if (!text) {return '';}

    // DEBUG: Log includeContext received
    if (includeContext) {
        console.log('[renderMarkdown] includeContext received:', JSON.stringify(includeContext, null, 2));
    }

    // Store includeContext for use by image renderer
    window.currentTaskIncludeContext = includeContext;

    try {
        // Get HTML rendering settings
        const htmlCommentRenderMode = window.configManager?.getConfig('htmlCommentRenderMode', 'hidden') ?? 'hidden';
        const htmlContentRenderMode = window.configManager?.getConfig('htmlContentRenderMode', 'html') ?? 'html';

        // Use cached markdown-it instance for performance
        // Only recreate if settings changed or first call
        const needsRecreate = !cachedMarkdownIt ||
                              cachedHtmlCommentMode !== htmlCommentRenderMode ||
                              cachedHtmlContentMode !== htmlContentRenderMode;

        if (needsRecreate) {
            cachedMarkdownIt = createMarkdownItInstance(htmlCommentRenderMode, htmlContentRenderMode);
            cachedHtmlCommentMode = htmlCommentRenderMode;
            cachedHtmlContentMode = htmlContentRenderMode;
        }

        const md = cachedMarkdownIt;

        // Skip re-registering custom renderers if already done
        // The renderers use window.currentTaskIncludeContext which is set per-render
        if (md._customRenderersRegistered) {
            // Renderers already registered, proceed to render directly
            const env = { taskCheckboxIndex: 0 };
            let rendered = md.render(text, env);

            // Trigger PlantUML queue processing after render completes
            if (pendingPlantUMLQueue.length > 0) {
                Promise.resolve().then(() => processPlantUMLQueue());
            }

            // Trigger diagram queue processing after render completes
            if (pendingDiagramQueue.length > 0) {
                Promise.resolve().then(() => processDiagramQueue());
            }

            // Remove paragraph wrapping for single line content
            if (!text.includes('\n') && rendered.startsWith('<p>') && rendered.endsWith('</p>\n')) {
                rendered = rendered.slice(3, -5);
            }

            return rendered;
        }

        // Helper function to resolve media paths dynamically
        function resolveMediaSourcePath(originalSrc) {
            const includeContext = window.currentTaskIncludeContext;
            const isWindowsAbsolute = isWindowsAbsolutePath(originalSrc);
            const isRelativePath = isRelativeResourcePath(originalSrc);

            // DEBUG: Log path resolution
            console.log('[resolveMediaSourcePath] originalSrc:', originalSrc, 'isRelativePath:', isRelativePath, 'includeContext:', includeContext ? { includeDir: includeContext.includeDir } : null);

            if (includeContext && isRelativePath) {
                const resolvedPath = resolveRelativePath(includeContext.includeDir, safeDecodePath(originalSrc));
                console.log('[resolveMediaSourcePath] Resolved relative path with includeContext:', resolvedPath);
                return buildWebviewResourceUrl(resolvedPath, false);
            } else if (isRelativePath && window.currentFilePath) {
                // Relative path in main file - resolve against document directory
                const decodedSrc = safeDecodePath(originalSrc);

                // Get document directory from currentFilePath
                const docPath = window.currentFilePath.replace(/\\/g, '/');
                const lastSlash = docPath.lastIndexOf('/');
                const docDir = lastSlash > 0 ? docPath.substring(0, lastSlash) : '';

                const resolvedPath = resolveRelativePath(docDir, decodedSrc);
                return buildWebviewResourceUrl(resolvedPath, true);
            } else if (isWindowsAbsolute) {
                // Windows absolute path (C:/Users/...) - convert to webview URI
                const normalizedPath = normalizeWindowsAbsolutePath(originalSrc, false);
                return buildWebviewResourceUrl(normalizedPath, false);
            } else if (originalSrc && originalSrc.startsWith('/')) {
                // Unix absolute path (/Users/...) - convert to webview URI
                return buildWebviewResourceUrl(safeDecodePath(originalSrc), true);
            }
            return originalSrc;
        }

        // Capture original renderers before overriding
        const originalVideoRenderer = md.renderer.rules.video;
        const originalAudioRenderer = md.renderer.rules.audio;

        md.renderer.rules.video = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];

            // Get original source path before processing
            const { firstSource: originalSrc } = updateSourceChildren(token, resolveMediaSourcePath);

            // Get title for caption
            const title = token.attrGet('title') || '';

            // Generate the base video HTML
            // Use plugin renderer if available, otherwise use fallback that properly handles children
            let videoHtml;
            if (originalVideoRenderer) {
                videoHtml = originalVideoRenderer(tokens, idx, options, env, renderer);
            } else {
                // Fallback: manually render video element with children (source tags)
                videoHtml = renderTokenWithChildren(token, renderer, options, env);
            }

            // Build caption if title is provided
            const captionHtml = title ? `<figcaption class="media-caption">${escapeHtml(title)}</figcaption>` : '';

            // Skip wrapping for data URLs and blob URLs
            if (!originalSrc || originalSrc.startsWith('data:') || originalSrc.startsWith('blob:')) {
                if (title) {
                    return `<figure class="media-figure">${videoHtml}${captionHtml}</figure>`;
                }
                return videoHtml;
            }

            // Escape the path for use in onclick handlers and error handler
            const escapedPath = originalSrc.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
            const escapedOriginalSrc = escapeHtml(originalSrc).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/`/g, '\\`');

            // Determine if path is absolute
            const isAbsolutePath = originalSrc.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(originalSrc);

            // Inject error handler into video element and source children
            // IMPORTANT: For <video> with <source> children, error events fire on <source>, not <video>!
            // So we need to add onerror to both the video (for direct src) and source elements
            let videoWithError = videoHtml.replace(
                /<video([^>]*)>/,
                `<video$1 data-original-src="${escapeHtml(originalSrc)}" onerror="if(typeof handleMediaNotFound==='function'){handleMediaNotFound(this,'${escapedOriginalSrc}','video');}">`
            );
            // Also add error handler to <source> elements - this is where errors actually fire for <video><source></video>
            videoWithError = videoWithError.replace(
                /<source([^>]*)>/g,
                `<source$1 onerror="if(typeof handleMediaNotFound==='function'){handleMediaNotFound(this.parentElement,'${escapedOriginalSrc}','video');}">`
            );

            // Wrap with overlay container for path conversion menu (similar to images)
            // Use data-file-path for unified path handling across all media types
            if (title) {
                return `<figure class="media-figure">
                    <div class="video-path-overlay-container" data-file-path="${escapeHtml(originalSrc)}">
                        ${videoWithError}
                        <button class="video-menu-btn" data-action="video-menu" title="Path options">☰</button>
                    </div>
                    ${captionHtml}
                </figure>`;
            }
            return `<div class="video-path-overlay-container" data-file-path="${escapeHtml(originalSrc)}">
                ${videoWithError}
                <button class="video-menu-btn" data-action="video-menu" title="Path options">☰</button>
            </div>`;
        };

        md.renderer.rules.audio = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];

            // Get original source path before processing
            const { firstSource: originalSrc } = updateSourceChildren(token, resolveMediaSourcePath);

            // Get title for caption
            const title = token.attrGet('title') || '';

            // Use plugin renderer if available, otherwise use fallback that properly handles children
            let audioHtml;
            if (originalAudioRenderer) {
                audioHtml = originalAudioRenderer(tokens, idx, options, env, renderer);
            } else {
                // Fallback: manually render audio element with children (source tags)
                audioHtml = renderTokenWithChildren(token, renderer, options, env);
            }

            // Build caption if title is provided
            const captionHtml = title ? `<figcaption class="media-caption">${escapeHtml(title)}</figcaption>` : '';

            // Skip wrapping for data URLs and blob URLs
            if (!originalSrc || originalSrc.startsWith('data:') || originalSrc.startsWith('blob:')) {
                if (title) {
                    return `<figure class="media-figure">${audioHtml}${captionHtml}</figure>`;
                }
                return audioHtml;
            }

            // Escape the path for use in onclick handlers and error handler
            const escapedPath = originalSrc.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
            const escapedOriginalSrc = escapeHtml(originalSrc).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/`/g, '\\`');

            // Inject error handler into audio element and source children
            // IMPORTANT: For <audio> with <source> children, error events fire on <source>, not <audio>!
            let audioWithError = audioHtml.replace(
                /<audio([^>]*)>/,
                `<audio$1 data-original-src="${escapeHtml(originalSrc)}" onerror="if(typeof handleMediaNotFound==='function'){handleMediaNotFound(this,'${escapedOriginalSrc}','video');}">`
            );
            // Also add error handler to <source> elements
            audioWithError = audioWithError.replace(
                /<source([^>]*)>/g,
                `<source$1 onerror="if(typeof handleMediaNotFound==='function'){handleMediaNotFound(this.parentElement,'${escapedOriginalSrc}','video');}">`
            );

            // Wrap with overlay container for path conversion menu (same as video)
            // Use data-file-path for unified path handling across all media types
            if (title) {
                return `<figure class="media-figure">
                    <div class="video-path-overlay-container" data-file-path="${escapeHtml(originalSrc)}">
                        ${audioWithError}
                        <button class="video-menu-btn" data-action="video-menu" title="Path options">☰</button>
                    </div>
                    ${captionHtml}
                </figure>`;
            }
            return `<div class="video-path-overlay-container" data-file-path="${escapeHtml(originalSrc)}">
                ${audioWithError}
                <button class="video-menu-btn" data-action="video-menu" title="Path options">☰</button>
            </div>`;
        };

        // Rest of the function remains the same...
        // Enhanced image renderer - dynamically resolves relative paths using includeContext
        md.renderer.rules.image = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];

            // Check for and consume {attrs} in the following tokens
            // The attrs might be split across multiple text tokens (e.g., due to line breaks)
            // We need to collect text from multiple tokens to find the complete {attrs} block
            let attrText = '';
            let tokensToConsume = [];
            let foundClosingBrace = false;
            let depth = 0;

            for (let t = idx + 1; t < tokens.length && !foundClosingBrace; t++) {
                const tok = tokens[t];
                // Only process text tokens and softbreaks
                if (tok.type === 'text') {
                    const content = tok.content || '';
                    tokensToConsume.push({ index: t, token: tok, originalContent: content });
                    for (let c = 0; c < content.length; c++) {
                        attrText += content[c];
                        if (content[c] === '{') depth++;
                        else if (content[c] === '}') {
                            depth--;
                            if (depth === 0) {
                                foundClosingBrace = true;
                                break;
                            }
                        }
                    }
                } else if (tok.type === 'softbreak') {
                    tokensToConsume.push({ index: t, token: tok, originalContent: '\n' });
                    attrText += '\n';
                } else {
                    // Stop at non-text tokens
                    break;
                }
            }

            // Check if we found an attribute block
            const trimmedAttrText = attrText.trimStart();
            if (trimmedAttrText.startsWith('{') && foundClosingBrace) {
                // Find the end of the attr block in the trimmed text
                let endPos = -1;
                depth = 0;
                for (let j = 0; j < trimmedAttrText.length; j++) {
                    if (trimmedAttrText[j] === '{') depth++;
                    else if (trimmedAttrText[j] === '}') {
                        depth--;
                        if (depth === 0) { endPos = j; break; }
                    }
                }

                if (endPos !== -1) {
                    const attrBlock = trimmedAttrText.substring(0, endPos + 1);

                    // Parse attributes
                    const attrs = {};
                    const content = attrBlock.replace(/^\{|\}$/g, '').trim();
                    // Match .class patterns
                    const classMatches = content.match(/\.(\w[\w-]*)/g);
                    if (classMatches) attrs.class = classMatches.map(m => m.slice(1)).join(' ');
                    // Match #id pattern
                    const idMatch = content.match(/#(\w[\w-]*)/);
                    if (idMatch) attrs.id = idMatch[1];
                    // Match key=value patterns
                    const kvPattern = /(\w[\w-]*)=["']?([^"'\s}]+)["']?/g;
                    let match;
                    while ((match = kvPattern.exec(content)) !== null) {
                        attrs[match[1]] = match[2];
                    }

                    // Store on token for detectEmbed to use
                    token._imageAttrs = attrs;
                    // Apply attributes
                    if (attrs.class) token.attrJoin('class', attrs.class);
                    if (attrs.id) token.attrSet('id', attrs.id);
                    Object.keys(attrs).forEach(key => {
                        if (!['class', 'id'].includes(key)) {
                            token.attrSet('data-' + key, attrs[key]);
                        }
                    });

                    // Clear the content of all consumed tokens
                    // Calculate how much of the attr block we've consumed
                    let consumed = 0;
                    const leadingWhitespace = attrText.length - trimmedAttrText.length;
                    const totalToConsume = leadingWhitespace + endPos + 1;

                    for (const item of tokensToConsume) {
                        const tokContent = item.originalContent;
                        if (consumed + tokContent.length <= totalToConsume) {
                            // Entire token is consumed
                            item.token.content = '';
                            consumed += tokContent.length;
                        } else if (consumed < totalToConsume) {
                            // Partial token - keep the remainder
                            const consumeFromThis = totalToConsume - consumed;
                            item.token.content = tokContent.substring(consumeFromThis);
                            consumed = totalToConsume;
                        }
                        // Mark as consumed for text renderer
                        item.token._attrsConsumed = true;
                    }

                }
            }

            const originalSrc = token.attrGet('src') || '';
            const title = token.attrGet('title') || '';
            const alt = token.content || '';

            // Parse PDF path with optional page number
            // Hash fragment (#12) = single page view
            // Query param (?p=12 or ?page=12) = slideshow starting at that page
            // Examples:
            //   file.pdf        → slideshow starting at page 1
            //   file.pdf#12     → single page view of page 12
            //   file.pdf?p=12   → slideshow starting at page 12
            //   file.pdf?page=5 → slideshow starting at page 5
            const parsePDFPath = (src) => {
                if (!src) return null;

                // Check for hash fragment: file.pdf#12 → single page mode
                const hashMatch = src.match(/^(.+\.pdf)#(\d+)$/i);
                if (hashMatch) {
                    return { pdfPath: hashMatch[1], pageNumber: parseInt(hashMatch[2], 10), mode: 'single' };
                }

                // Check for query parameter: file.pdf?p=12 → slideshow starting at page 12
                const queryMatch = src.match(/^(.+\.pdf)\?(?:p|page)=(\d+)$/i);
                if (queryMatch) {
                    return { pdfPath: queryMatch[1], pageNumber: parseInt(queryMatch[2], 10), mode: 'slideshow' };
                }

                // Check if it's just a PDF file → slideshow starting at page 1
                if (src.match(/\.pdf$/i)) {
                    return { pdfPath: src, pageNumber: 1, mode: 'slideshow' };
                }

                return null;
            };

            const pdfInfo = parsePDFPath(originalSrc);

            // Single page mode: file.pdf#12
            if (pdfInfo && pdfInfo.mode === 'single') {
                const { pdfPath, pageNumber } = pdfInfo;

                // Create unique ID for this PDF page
                const pdfId = createUniqueId('pdf-page');

                // Queue for async rendering
                queuePDFPageRender(pdfId, pdfPath, pageNumber);

                // Return placeholder immediately (synchronous)
                const displayLabel = alt || `PDF page ${pageNumber}`;
                return createLoadingPlaceholder(pdfId, 'diagram-placeholder', `Loading ${displayLabel}...`);
            }

            // Get include context for relative path resolution (needed for diagrams/PDFs in include files)
            const includeContext = window.currentTaskIncludeContext;
            const includeDir = includeContext?.includeDir;

            // Slideshow mode: file.pdf or file.pdf?p=N
            if (pdfInfo && pdfInfo.mode === 'slideshow') {
                // Create unique ID for this PDF slideshow
                const pdfId = createUniqueId('pdf-slideshow');

                // Queue for async slideshow creation (pass includeDir, initial page, alt, and title)
                queuePDFSlideshow(pdfId, pdfInfo.pdfPath, includeDir, pdfInfo.pageNumber, alt, title);

                // Return placeholder immediately (synchronous)
                const displayLabel = alt || 'PDF slideshow';
                return createLoadingPlaceholder(pdfId, 'diagram-placeholder', `Loading ${displayLabel}...`);
            }

            // Check if this is an EPUB file reference (slideshow mode)
            const isEpubFile = originalSrc && originalSrc.match(/\.epub$/i);
            if (isEpubFile) {
                // Create unique ID for this EPUB slideshow
                const epubId = createUniqueId('epub-slideshow');

                // Queue for async slideshow creation (pass includeDir for relative path resolution)
                queueEPUBSlideshow(epubId, originalSrc, includeDir);

                // Return placeholder immediately (synchronous)
                return createLoadingPlaceholder(epubId, 'diagram-placeholder', 'Loading EPUB slideshow...');
            }

            // Check if this is a diagram file that needs special rendering
            const isDiagramFile = originalSrc && (
                originalSrc.endsWith('.drawio') ||
                originalSrc.endsWith('.dio') ||
                originalSrc.endsWith('.excalidraw') ||
                originalSrc.endsWith('.excalidraw.json') ||
                originalSrc.endsWith('.excalidraw.svg')
            );

            if (isDiagramFile) {
                // Determine diagram type
                let diagramType;
                if (originalSrc.endsWith('.drawio') || originalSrc.endsWith('.dio')) {
                    diagramType = 'drawio';
                } else {
                    diagramType = 'excalidraw';
                }

                // Create unique ID for this diagram
                const diagramId = createUniqueId('diagram');

                // Queue for async rendering (pass includeDir for relative path resolution)
                queueDiagramRender(diagramId, originalSrc, diagramType, includeDir);

                // Return placeholder immediately (synchronous)
                return createLoadingPlaceholder(diagramId, 'diagram-placeholder', `Loading ${diagramType} diagram...`);
            }

            // Check if this is an embed URL (external iframe content)
            const embedInfo = detectEmbed(originalSrc, alt, title, token);
            if (embedInfo) {
                return renderEmbed(embedInfo, originalSrc, alt, title);
            }

            let displaySrc = originalSrc;

            // Check if we have includeContext and the path is relative
            // (includeContext was already declared above for diagram/PDF handling)
            const isWindowsAbsolute = isWindowsAbsolutePath(originalSrc);
            const isRelativePath = isRelativeResourcePath(originalSrc);

            if (includeContext && isRelativePath) {
                const decodedSrc = safeDecodePath(originalSrc);
                const decodedIncludeDir = safeDecodePath(includeContext.includeDir);
                const resolvedPath = resolveRelativePath(decodedIncludeDir, decodedSrc);
                displaySrc = buildWebviewResourceUrl(resolvedPath, true);
            } else if (isRelativePath && window.currentFilePath) {
                // Relative path in main file - resolve against document directory
                const decodedSrc = safeDecodePath(originalSrc);

                // Get document directory from currentFilePath
                const docPath = window.currentFilePath.replace(/\\/g, '/');
                const lastSlash = docPath.lastIndexOf('/');
                const docDir = lastSlash > 0 ? docPath.substring(0, lastSlash) : '';

                const resolvedPath = resolveRelativePath(docDir, decodedSrc);
                displaySrc = buildWebviewResourceUrl(resolvedPath, true);
            } else if (isWindowsAbsolute) {
                // Windows absolute path (C:/Users/...) - convert to webview URI
                // Decode first to handle already-encoded paths, then re-encode for URL
                const normalizedPath = normalizeWindowsAbsolutePath(originalSrc, true);
                displaySrc = buildWebviewResourceUrl(normalizedPath, true);
            } else if (originalSrc && originalSrc.startsWith('/')) {
                // Unix absolute path (/Users/...) - convert to webview URI
                // Decode first to handle already-encoded paths, then re-encode for URL
                displaySrc = buildWebviewResourceUrl(safeDecodePath(originalSrc), true);
            }

            // Store original src for click handling
            const originalSrcAttr = ` data-original-src="${escapeHtml(originalSrc)}"`;
            const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

            // Skip onerror for data URLs (they don't fail to load)
            const isDataUrl = displaySrc && displaySrc.startsWith('data:');

            // Add onerror handler to replace broken image with searchable placeholder with burger menu
            // The placeholder includes data-original-src so Alt+click search still works
            let onerrorHandler = '';
            if (!isDataUrl) {
                const escapedOriginalSrc = escapeHtml(originalSrc).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/`/g, '\\`');
                // Extract filename for display (inline since getShortDisplayPath may not be available in fallback)
                onerrorHandler = ` onerror="if(typeof handleMediaNotFound==='function'){handleMediaNotFound(this,'${escapedOriginalSrc}','image');}else{var p=document.createElement('span');p.className='image-not-found';p.setAttribute('data-original-src','${escapedOriginalSrc}');p.title='Image not found: ${escapedOriginalSrc}';var fn=(typeof getShortDisplayPath==='function')?getShortDisplayPath('${escapedOriginalSrc}'):'${escapedOriginalSrc}'.split('/').pop()||'unknown';p.innerHTML='<span class=image-not-found-text>📷 '+fn+'</span>';if(this.parentElement){this.parentElement.insertBefore(p,this);}this.style.display='none';}"`;
            }

            // Build the img tag
            const imgTag = `<img src="${displaySrc}" alt="${escapeHtml(alt)}"${titleAttr}${originalSrcAttr} class="markdown-image" loading="lazy"${onerrorHandler} />`;

            // Build caption if title is provided
            const captionHtml = title ? `<figcaption class="media-caption">${escapeHtml(title)}</figcaption>` : '';

            // Skip overlay for data URLs and blob URLs (they don't need path conversion)
            const isDataOrBlob = displaySrc && (displaySrc.startsWith('data:') || displaySrc.startsWith('blob:'));
            if (isDataOrBlob) {
                if (title) {
                    return `<figure class="media-figure">${imgTag}${captionHtml}</figure>`;
                }
                return imgTag;
            }

            // Escape the path for use in onclick handlers
            const escapedPath = originalSrc.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

            // Determine if path is absolute (Unix: starts with /, Windows: starts with drive letter like C:\)
            const isAbsolutePath = originalSrc.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(originalSrc);

            // Wrap with overlay container for path conversion menu
            // Menu is dynamically generated by toggleImagePathMenu to avoid stacking context issues
            // Use data-file-path for unified path handling across all media types
            if (title) {
                return `<figure class="media-figure">
                    <span class="image-path-overlay-container" data-file-path="${escapeHtml(originalSrc)}">
                        ${imgTag}
                        <button class="image-menu-btn" data-action="image-menu" title="Path options">☰</button>
                    </span>
                    ${captionHtml}
                </figure>`;
            }
            return `<span class="image-path-overlay-container" data-file-path="${escapeHtml(originalSrc)}">
                ${imgTag}
                <button class="image-menu-btn" data-action="image-menu" title="Path options">☰</button>
            </span>`;
        };
        
        // Custom text renderer to handle consumed attribute blocks
        md.renderer.rules.text = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];
            // Return the current content (which may have been cleared by image renderer)
            return token.content || '';
        };

        // Custom softbreak renderer to skip consumed softbreaks
        const originalSoftbreakRenderer = md.renderer.rules.softbreak;
        md.renderer.rules.softbreak = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];
            // Skip if consumed by image attrs parsing
            if (token._attrsConsumed) {
                return '';
            }
            // Otherwise use default behavior
            return originalSoftbreakRenderer ? originalSoftbreakRenderer(tokens, idx, options, env, renderer) : '<br>\n';
        };

        // Enhanced link renderer
        // NOTE: Angle bracket autolinks <...> are NOT processed for path resolution because:
        //       - They are ONLY for URL autolinks (<http://...>) or email (<user@example.com>)
        //       - They are NEVER used for file paths in markdown
        //       - File paths use [text](path) or ![alt](path) syntax
        md.renderer.rules.link_open = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];
            const href = token.attrGet('href') || '';
            const title = token.attrGet('title') || '';

            console.log('[LINK-RENDER] link_open called:', { href, title, tokenType: token.type });

            // Don't make webview URIs clickable (they're for display only)
            if (href.startsWith('vscode-webview://')) {
                return '<span class="webview-uri-text">';
            }

            const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
            const isExternalLink = href.startsWith('http://') || href.startsWith('https://');
            const isAnchorLink = href.startsWith('#');
            const isMailtoLink = href.startsWith('mailto:');
            const targetAttr = isExternalLink ? ` target="_blank"` : '';

            // Check if this is a local file link (not URL, not anchor, not mailto)
            const isLocalFileLink = !isExternalLink && !isAnchorLink && !isMailtoLink && href.length > 0;

            console.log('[LINK-RENDER] link_open analysis:', { isExternalLink, isAnchorLink, isMailtoLink, isLocalFileLink });

            if (isLocalFileLink) {
                // Escape the path for use in onclick handlers
                const escapedPath = href.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
                // Mark token so link_close knows to add the burger button
                token._isLocalFileLink = true;
                token._escapedPath = escapedPath;
                console.log('[LINK-RENDER] Wrapping local file link with overlay container:', href);
                // Wrap in overlay container for path menu
                return `<span class="link-path-overlay-container" data-file-path="${escapeHtml(href)}"><a href="#" data-original-href="${escapeHtml(href)}"${titleAttr} class="markdown-link markdown-file-link">`;
            }

            return `<a href="#" data-original-href="${escapeHtml(href)}"${titleAttr}${targetAttr} class="markdown-link">`;
        };

        md.renderer.rules.link_close = function(tokens, idx, options, env, renderer) {
            // Search backwards for the matching link_open token
            // Can't assume it's at idx-2 because link text may contain multiple tokens (emphasis, etc.)
            let openToken = null;
            for (let i = idx - 1; i >= 0; i--) {
                if (tokens[i].type === 'link_open') {
                    openToken = tokens[i];
                    break;
                }
            }

            console.log('[LINK-RENDER] link_close called:', {
                idx,
                foundOpenToken: !!openToken,
                openTokenType: openToken?.type,
                isLocalFileLink: openToken?._isLocalFileLink,
                href: openToken?.attrGet?.('href')
            });

            if (openToken && openToken.attrGet && openToken.attrGet('href') &&
                openToken.attrGet('href').startsWith('vscode-webview://')) {
                return '</span>';
            }
            // Check if this was a local file link that needs the burger menu
            if (openToken && openToken._isLocalFileLink) {
                return `</a><button class="link-menu-btn" data-action="link-menu" title="Path options">☰</button></span>`;
            }
            return '</a>';
        };

        // Add PlantUML renderer
        addDiagramFenceRenderer(md);

        // Mark that custom renderers have been registered
        md._customRenderersRegistered = true;

        const env = { taskCheckboxIndex: 0 };
        let rendered = md.render(text, env);

        // Trigger PlantUML queue processing after render completes
        if (pendingPlantUMLQueue.length > 0) {
            // Use microtask to ensure DOM is updated first
            Promise.resolve().then(() => processPlantUMLQueue());
        }

        // Trigger diagram queue processing after render completes
        if (pendingDiagramQueue.length > 0) {
            // Use microtask to ensure DOM is updated first
            Promise.resolve().then(() => processDiagramQueue());
        }

        // Remove paragraph wrapping for single line content
        if (!text.includes('\n') && rendered.startsWith('<p>') && rendered.endsWith('</p>\n')) {
            rendered = rendered.slice(3, -5);
        }

        return rendered;
    } catch (error) {
        console.error('Error rendering markdown:', error?.message || error, error?.stack);
        return escapeHtml(text);
    }
}

// Expose renderMarkdown globally for include placeholder updates
window.renderMarkdown = renderMarkdown;

// escapeHtml function moved to utils/validationUtils.js
