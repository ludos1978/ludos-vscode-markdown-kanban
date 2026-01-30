(function() { 'use strict';

/**
 * Tag Detection and Rendering Plugin for markdown-it (browser version)
 * Handles #tag syntax for kanban board tags.
 * Extracted from markdownRenderer.js — Phase 5.
 */
window.markdownitTag = function(md, options) {
    options = options || {};
    var tagColors = options.tagColors || {};

    function parseTag(state, silent) {
        var pos = state.pos;

        // Check for # at word boundary
        if (state.src.charCodeAt(pos) !== 0x23 /* # */) {return false;}
        if (pos > 0 && state.src.charCodeAt(pos - 1) !== 0x20 /* space */ &&
            state.src.charCodeAt(pos - 1) !== 0x0A /* newline */ &&
            pos !== 0) {return false;}

        // Exclude ATX headers: # followed by space or more # characters (##, ###, etc.)
        // This prevents treating "# Header" as a tag
        if (pos === 0 || state.src.charCodeAt(pos - 1) === 0x0A /* newline */) {
            var headerCheckPos = pos + 1;
            // Check if followed by space (single #) or more # chars (##, ###, etc.)
            if (headerCheckPos < state.posMax) {
                var nextChar = state.src.charCodeAt(headerCheckPos);
                if (nextChar === 0x20 /* space */ || nextChar === 0x23 /* # */) {
                    return false; // This is a header, not a tag
                }
            }
        }

        pos++;
        if (pos >= state.posMax) {return false;}

        // Parse tag content - for gather tags, include full expression
        var tagStart = pos;
        var tagContent = '';

        // Check for special positivity tags: ++, +, ø, Ø, --, -
        var remaining = state.src.slice(pos);
        var positivityMatch = remaining.match(/^(\+\+|\+|ø|Ø|--|-(?!-))/);
        if (positivityMatch) {
            tagContent = positivityMatch[1];
            pos += tagContent.length;
        }
        // Check if it's a gather tag
        else if (state.src.substr(pos, 7) === 'gather_') {
            // For gather tags, capture everything until next space or end
            while (pos < state.posMax) {
                var char = state.src.charCodeAt(pos);
                // Stop at space or newline
                if (char === 0x20 || char === 0x0A) {break;}
                pos++;
            }
            tagContent = state.src.slice(tagStart, pos);
        } else {
            // For regular tags, use existing logic
            while (pos < state.posMax) {
                var ch = state.src.charCodeAt(pos);
                // Allow alphanumeric, underscore, hyphen, dot
                if ((ch >= 0x30 && ch <= 0x39) || // 0-9
                    (ch >= 0x41 && ch <= 0x5A) || // A-Z
                    (ch >= 0x61 && ch <= 0x7A) || // a-z
                    ch === 0x5F || // _
                    ch === 0x2D || // -
                    ch === 0x2E) { // .
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
        var token = state.push('tag', 'span', 0);
        token.content = tagContent;
        token.markup = '#';

        return true;
    }

    md.inline.ruler.before('emphasis', 'tag', parseTag);

    md.renderer.rules.tag = function(tokens, idx) {
        var token = tokens[idx];
        var tagContent = token.content;
        var fullTag = '#' + token.content;

        // Extract base tag name for styling (before any operators)
        var baseTagName = tagContent;
        if (tagContent.startsWith('gather_')) {
            baseTagName = 'gather'; // Use 'gather' as base for all gather tags
        } else if (/^(\+\+|\+|ø|Ø|--|-(?!-))$/.test(tagContent)) {
            // Positivity tags - use as-is but lowercase
            baseTagName = tagContent.toLowerCase();
        } else {
            var baseMatch = tagContent.match(/^([a-zA-Z0-9_.\-]+)/);
            baseTagName = baseMatch ? baseMatch[1].toLowerCase() : tagContent.toLowerCase();
        }

        return '<span class="kanban-tag" data-tag="' + escapeHtml(baseTagName) + '">' + escapeHtml(fullTag) + '</span>';
    };
};

})();
