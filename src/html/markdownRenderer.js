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
        
        state.pos = pos + 2; // Skip closing ]]
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
        
        if (silent) {return true;}
        
        // Create token
        const token = state.push('tag', 'span', 0);
        token.content = tagContent;
        token.markup = '#';
        
        state.pos = pos;
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
        
        if (silent) {return true;}
        
        // Create token
        const token = state.push('date_person_tag', 'span', 0);
        token.content = tagContent;
        token.markup = '@';
        token.meta = { type: tagType };
        
        state.pos = pos;
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
        return `</del>` +
               `<button class="delete-strike-btn" onclick="deleteStrikethrough(event)" title="Remove strikethrough text">×</button>` +
               `</span>`;
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

        if (silent) {return true;}

        // Create token
        const token = state.push('html_comment', 'span', 0);
        token.content = content.trim();
        token.markup = '<!--';

        state.pos = pos + 3; // Skip closing -->
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

// PlantUML is now rendered in the extension backend (Node.js)
// No initialization needed in webview
window.plantumlReady = true; // Always ready - backend handles rendering

// Queue for pending PlantUML diagrams
const pendingPlantUMLQueue = [];
let plantumlQueueProcessing = false;

// Cache for rendered PlantUML diagrams (code → svg)
const plantumlRenderCache = new Map();
window.plantumlRenderCache = plantumlRenderCache; // Make globally accessible

/**
 * Queue a PlantUML diagram for rendering
 * @param {string} id - Unique placeholder ID
 * @param {string} code - PlantUML source code
 */
function queuePlantUMLRender(id, code) {
    pendingPlantUMLQueue.push({ id, code, timestamp: Date.now() });
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

// Handle PlantUML render responses from backend
window.addEventListener('message', event => {
    const message = event.data;

    if (message.type === 'plantUMLRenderSuccess') {
        const { requestId, svg } = message;
        const request = plantUMLRenderRequests.get(requestId);

        if (request) {

            // Cache the result
            plantumlRenderCache.set(request.code, svg);

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


    while (pendingPlantUMLQueue.length > 0) {
        const item = pendingPlantUMLQueue.shift();
        const element = document.getElementById(item.id);

        if (!element) {
            console.warn(`[PlantUML] Placeholder not found: ${item.id}`);
            continue;
        }

        try {
            const svg = await renderPlantUML(item.code);

            // Replace placeholder with diagram container
            const container = document.createElement('div');
            container.className = 'plantuml-diagram';
            container.innerHTML = svg;

            // Add convert button
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'plantuml-actions';
            buttonContainer.innerHTML = `
                <button class="plantuml-convert-btn"
                        data-code="${escapeHtml(item.code)}"
                        title="Convert to SVG file">
                    💾 Convert to SVG
                </button>
            `;
            container.appendChild(buttonContainer);

            element.replaceWith(container);
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
}

// ============================================================================
// Mermaid Rendering System
// ============================================================================

// Initialize Mermaid (browser-based, pure JavaScript)
let mermaidReady = false;
let mermaidInitialized = false;

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
    } catch (error) {
        console.error('[Mermaid] Initialization error:', error);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMermaid);
} else {
    initializeMermaid();
}

// Queue for pending Mermaid diagrams
const pendingMermaidQueue = [];
let mermaidQueueProcessing = false;

// Cache for rendered Mermaid diagrams (code → svg)
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

    if (!mermaidReady) {
        throw new Error('Mermaid not initialized');
    }

    try {
        const diagramId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Use mermaid.render() to generate SVG
        const { svg } = await mermaid.render(diagramId, code);


        // Cache the result
        mermaidRenderCache.set(code, svg);

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


    while (pendingMermaidQueue.length > 0) {
        const item = pendingMermaidQueue.shift();

        const element = document.getElementById(item.id);
        if (!element) {
            console.warn(`[Mermaid] Placeholder not found: ${item.id}`);
            continue;
        }

        try {
            const svg = await renderMermaid(item.code);

            // Replace placeholder with diagram container
            const container = document.createElement('div');
            container.className = 'mermaid-diagram';
            container.innerHTML = svg;

            // Add convert button
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'mermaid-actions';
            buttonContainer.innerHTML = `
                <button class="mermaid-convert-btn"
                        data-code="${escapeHtml(item.code)}"
                        title="Convert to SVG file">
                    💾 Convert to SVG
                </button>
            `;
            container.appendChild(buttonContainer);

            element.replaceWith(container);
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
}

/**
 * Add PlantUML and Mermaid fence renderer to markdown-it instance
 */
function addPlantUMLRenderer(md) {
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
            const diagramId = `plantuml-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Queue for async processing
            queuePlantUMLRender(diagramId, code);

            // Return placeholder immediately (synchronous)
            return `<div id="${diagramId}" class="plantuml-placeholder">
                <div class="placeholder-spinner"></div>
                <div class="placeholder-text">Rendering PlantUML diagram...</div>
            </div>`;
        }

        // Check if this is a Mermaid block
        if (langName.toLowerCase() === 'mermaid') {
            const code = token.content;
            const diagramId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Queue for async processing
            queueMermaidRender(diagramId, code);

            // Return placeholder immediately (synchronous)
            return `<div id="${diagramId}" class="mermaid-placeholder">
                <div class="placeholder-spinner"></div>
                <div class="placeholder-text">Rendering Mermaid diagram...</div>
            </div>`;
        }

        // Use original renderer for other languages
        return originalFence(tokens, idx, options, env, self);
    };
}

function renderMarkdown(text, includeContext) {
    if (!text) {return '';}

    // Store includeContext for use by image renderer
    window.currentTaskIncludeContext = includeContext;

    // Debug logging to trace include rendering
    const hasInclude = text.includes('!!!include(');
    if (hasInclude) {
    }

    try {
        // Get HTML rendering settings
        const htmlCommentRenderMode = window.configManager?.getConfig('htmlCommentRenderMode', 'hidden') ?? 'hidden';
        const htmlContentRenderMode = window.configManager?.getConfig('htmlContentRenderMode', 'html') ?? 'html';

        // Initialize markdown-it with enhanced wiki links and tags plugins
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
        .use(datePersonTagPlugin) // Add this line
        .use(enhancedStrikethroughPlugin) // Add enhanced strikethrough with delete buttons
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
        
        // Add custom renderer for video and audio to handle dynamic path resolution
        const originalVideoRenderer = md.renderer.rules.video;
        const originalAudioRenderer = md.renderer.rules.audio;

        // Helper function to resolve media paths dynamically
        function resolveMediaPath(originalSrc) {
            const includeContext = window.currentTaskIncludeContext;
            const isRelativePath = originalSrc &&
                                   !originalSrc.startsWith('/') &&
                                   !originalSrc.startsWith('http://') &&
                                   !originalSrc.startsWith('https://') &&
                                   !originalSrc.startsWith('vscode-webview://');

            if (includeContext && isRelativePath) {
                const dirSegments = includeContext.includeDir.split('/').filter(s => s);
                const relSegments = originalSrc.split('/').filter(s => s);

                for (const segment of relSegments) {
                    if (segment === '..') {
                        dirSegments.pop();
                    } else if (segment === '.') {
                        // Stay in current directory
                    } else {
                        dirSegments.push(segment);
                    }
                }

                const resolvedPath = '/' + dirSegments.join('/');
                const encodedPath = encodeURI(resolvedPath);
                return `https://file%2B.vscode-resource.vscode-cdn.net${encodedPath}`;
            }
            return originalSrc;
        }

        md.renderer.rules.video = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];

            // Process source children to dynamically resolve paths
            if (token.children) {
                token.children.forEach(child => {
                    if (child.type === 'source' && child.attrGet) {
                        const originalSrc = child.attrGet('src');
                        if (originalSrc) {
                            const displaySrc = resolveMediaPath(originalSrc);
                            child.attrSet('src', displaySrc);
                        }
                    }
                });
            }

            return originalVideoRenderer ? originalVideoRenderer(tokens, idx, options, env, renderer) : renderer.renderToken(tokens, idx);
        };

        md.renderer.rules.audio = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];

            // Process source children to dynamically resolve paths
            if (token.children) {
                token.children.forEach(child => {
                    if (child.type === 'source' && child.attrGet) {
                        const originalSrc = child.attrGet('src');
                        if (originalSrc) {
                            const displaySrc = resolveMediaPath(originalSrc);
                            child.attrSet('src', displaySrc);
                        }
                    }
                });
            }

            return originalAudioRenderer ? originalAudioRenderer(tokens, idx, options, env, renderer) : renderer.renderToken(tokens, idx);
        };

        // Rest of the function remains the same...
        // Enhanced image renderer - dynamically resolves relative paths using includeContext
        md.renderer.rules.image = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];
            const originalSrc = token.attrGet('src') || '';
            const title = token.attrGet('title') || '';
            const alt = token.content || '';

            let displaySrc = originalSrc;

            // Check if we have includeContext and the path is relative
            const includeContext = window.currentTaskIncludeContext;
            const isRelativePath = originalSrc &&
                                   !originalSrc.startsWith('/') &&
                                   !originalSrc.startsWith('http://') &&
                                   !originalSrc.startsWith('https://') &&
                                   !originalSrc.startsWith('vscode-webview://');

            if (includeContext && isRelativePath) {
                // Dynamically resolve the relative path from the include file's directory
                // Properly handle ../ and ./ in paths

                // Split the include directory path into segments
                const dirSegments = includeContext.includeDir.split('/').filter(s => s);

                // Split the relative path into segments
                const relSegments = originalSrc.split('/').filter(s => s);

                // Process each segment
                for (const segment of relSegments) {
                    if (segment === '..') {
                        // Go up one directory
                        dirSegments.pop();
                    } else if (segment === '.') {
                        // Stay in current directory (do nothing)
                    } else {
                        // Add the segment
                        dirSegments.push(segment);
                    }
                }

                // Reconstruct the absolute path
                let resolvedPath = '/' + dirSegments.join('/');

                // Convert to webview URL format
                // Format: https://file%2B.vscode-resource.vscode-cdn.net/absolute/path
                const encodedPath = encodeURI(resolvedPath);
                displaySrc = `https://file%2B.vscode-resource.vscode-cdn.net${encodedPath}`;
            }

            // Store original src for click handling
            const originalSrcAttr = ` data-original-src="${escapeHtml(originalSrc)}"`;
            const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

            return `<img src="${displaySrc}" alt="${escapeHtml(alt)}"${titleAttr}${originalSrcAttr} class="markdown-image" />`;
        };
        
        // Enhanced link renderer
        md.renderer.rules.link_open = function(tokens, idx, options, env, renderer) {
            const token = tokens[idx];
            const href = token.attrGet('href') || '';
            const title = token.attrGet('title') || '';
            
            // Don't make webview URIs clickable (they're for display only)
            if (href.startsWith('vscode-webview://')) {
                return '<span class="webview-uri-text">';
            }
            
            const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
            const targetAttr = (href.startsWith('http://') || href.startsWith('https://')) ? ` target="_blank"` : '';
            
            return `<a href="#" data-original-href="${escapeHtml(href)}"${titleAttr}${targetAttr} class="markdown-link">`;
        };
        
        md.renderer.rules.link_close = function(tokens, idx, options, env, renderer) {
            const openToken = tokens[idx - 2]; // link_open token
            if (openToken && openToken.attrGet && openToken.attrGet('href') && 
                openToken.attrGet('href').startsWith('vscode-webview://')) {
                return '</span>';
            }
            return '</a>';
        };

        // Add PlantUML renderer
        addPlantUMLRenderer(md);

        const rendered = md.render(text);

        // Trigger PlantUML queue processing after render completes
        if (pendingPlantUMLQueue.length > 0) {
            // Use microtask to ensure DOM is updated first
            Promise.resolve().then(() => processPlantUMLQueue());
        }

        // Remove paragraph wrapping for single line content
        if (!text.includes('\n') && rendered.startsWith('<p>') && rendered.endsWith('</p>\n')) {
            return rendered.slice(3, -5);
        }

        return rendered;
    } catch (error) {
        console.error('Error rendering markdown:', error);
        return escapeHtml(text);
    }
}

// escapeHtml function moved to utils/validationUtils.js