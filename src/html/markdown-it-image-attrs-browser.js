/*! markdown-it-image-attrs - Custom plugin for image attributes @license MIT */
/**
 * Markdown-it plugin that adds attribute support to images
 * Syntax: ![alt](url){.class key="value" key=value}
 *
 * Supports:
 * - .className for adding CSS classes
 * - #id for adding element ID
 * - key="value" or key=value for arbitrary attributes
 *
 * Special attributes for embeds:
 * - .embed - marks the image as an embed (renders as iframe)
 * - fallback="path" - fallback image path for PDF export
 * - width, height - iframe dimensions
 */
(function(global, factory) {
    typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() :
    typeof define === "function" && define.amd ? define(factory) :
    (global = typeof globalThis !== "undefined" ? globalThis : global || self,
    global.markdownItImageAttrs = factory());
})(this, (function() {
    "use strict";

    /**
     * Parse attribute block string into key-value pairs
     * @param {string} attrString - Attribute string like "{.embed fallback=img.png width=100%}"
     * @returns {Object} Object with parsed attributes
     */
    function parseAttributes(attrString) {
        const attrs = {};
        if (!attrString) return attrs;

        // Remove surrounding braces if present
        const content = attrString.replace(/^\{|\}$/g, '').trim();

        // Match .class patterns
        const classMatches = content.match(/\.(\w[\w-]*)/g);
        if (classMatches) {
            attrs.class = classMatches.map(m => m.slice(1)).join(' ');
        }

        // Match #id pattern
        const idMatch = content.match(/#(\w[\w-]*)/);
        if (idMatch) {
            attrs.id = idMatch[1];
        }

        // Match key=value or key="value" or key='value' patterns
        const kvPattern = /(\w[\w-]*)=["']?([^"'\s}]+)["']?/g;
        let match;
        while ((match = kvPattern.exec(content)) !== null) {
            attrs[match[1]] = match[2];
        }

        return attrs;
    }

    /**
     * Process inline tokens to find images followed by {attrs} text
     * Handles cases where attrs are split across multiple text tokens
     * @param {Array} children - Array of inline tokens (children of inline token)
     */
    function processInlineChildren(children) {
        for (let i = 0; i < children.length; i++) {
            const token = children[i];

            // Skip non-image tokens
            if (token.type !== 'image') continue;

            // Collect text from following tokens to find complete {attrs} block
            // The attrs might be split across multiple text tokens
            let attrText = '';
            let tokensInfo = []; // Track which tokens contribute to the attr text
            let foundClosingBrace = false;
            let depth = 0;

            for (let t = i + 1; t < children.length && !foundClosingBrace; t++) {
                const tok = children[t];
                if (tok.type === 'text') {
                    const content = tok.content || '';
                    tokensInfo.push({ index: t, content: content });
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
                    tokensInfo.push({ index: t, content: '\n', isSoftbreak: true });
                    attrText += '\n';
                } else {
                    // Stop at non-text/non-softbreak tokens
                    break;
                }
            }

            // Check if we found a valid attribute block
            const trimmedAttrText = attrText.trimStart();
            if (!trimmedAttrText.startsWith('{') || !foundClosingBrace) continue;

            // Find the end position in the trimmed text
            let endPos = -1;
            depth = 0;
            for (let j = 0; j < trimmedAttrText.length; j++) {
                if (trimmedAttrText[j] === '{') depth++;
                else if (trimmedAttrText[j] === '}') {
                    depth--;
                    if (depth === 0) { endPos = j; break; }
                }
            }

            if (endPos === -1) continue;

            // Extract and parse attribute block
            const attrBlock = trimmedAttrText.substring(0, endPos + 1);
            const attrs = parseAttributes(attrBlock);

            // Store parsed attributes on the image token
            token._imageAttrs = attrs;

            // Apply class attribute
            if (attrs.class) {
                const existingClass = token.attrGet('class') || '';
                token.attrSet('class', (existingClass + ' ' + attrs.class).trim());
            }

            // Apply id attribute
            if (attrs.id) {
                token.attrSet('id', attrs.id);
            }

            // Apply other attributes as data-* attributes
            Object.keys(attrs).forEach(key => {
                if (!['class', 'id'].includes(key)) {
                    token.attrSet('data-' + key, attrs[key]);
                }
            });

            // Remove the consumed text from tokens
            // Calculate total characters to consume (including leading whitespace)
            const leadingWhitespace = attrText.length - trimmedAttrText.length;
            const totalToConsume = leadingWhitespace + endPos + 1;
            let consumed = 0;
            let tokensToRemove = [];

            for (const info of tokensInfo) {
                const tokContent = info.content;
                if (consumed + tokContent.length <= totalToConsume) {
                    // Entire token is consumed - mark for removal
                    tokensToRemove.push(info.index);
                    consumed += tokContent.length;
                } else if (consumed < totalToConsume) {
                    // Partial token - keep the remainder
                    const consumeFromThis = totalToConsume - consumed;
                    children[info.index].content = tokContent.substring(consumeFromThis);
                    consumed = totalToConsume;
                    break;
                }
            }

            // Remove fully consumed tokens (in reverse order to maintain indices)
            tokensToRemove.sort((a, b) => b - a);
            for (const idx of tokensToRemove) {
                children.splice(idx, 1);
            }
        }
    }

    /**
     * Core rule that processes all tokens after inline parsing
     * This runs after all inline content is parsed, so we can safely modify tokens
     */
    function imageAttrsRule(state) {
        const tokens = state.tokens;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            // Process inline tokens (paragraphs, headings, etc.)
            if (token.type === 'inline' && token.children) {
                processInlineChildren(token.children);
            }
        }
    }

    /**
     * The markdown-it plugin
     * @param {Object} md - markdown-it instance
     */
    function imageAttrsPlugin(md) {
        // Add core rule to process image attributes after inline parsing
        // This runs after 'inline' rule which parses all inline content
        md.core.ruler.push('image_attrs', imageAttrsRule);
    }

    // Expose parseAttributes for external use
    imageAttrsPlugin.parseAttributes = parseAttributes;

    return imageAttrsPlugin;
}));
