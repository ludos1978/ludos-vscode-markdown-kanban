(function() { 'use strict';

/**
 * Wiki Links Plugin for markdown-it (browser version)
 * Handles [[document]] and [[document|title]] syntax.
 * Extracted from markdownRenderer.js — Phase 5.
 */
window.markdownitWikiLinks = function(md, options) {
    options = options || {};
    var className = options.className || 'wiki-link';

    function parseWikiLink(state, silent) {
        var pos = state.pos;

        // Check for opening [[
        if (pos + 1 >= state.posMax) {return false;}
        if (state.src.charCodeAt(pos) !== 0x5B /* [ */) {return false;}
        if (state.src.charCodeAt(pos + 1) !== 0x5B /* [ */) {return false;}

        pos += 2;

        // Find closing ]]
        var found = false;
        var content = '';
        var contentStart = pos;

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
        var parts = content.split('|');
        var document = parts[0].trim();
        var title = parts[1] ? parts[1].trim() : document;

        if (!document) {return false;}

        // IMPORTANT: When returning true, state.pos MUST always be advanced
        state.pos = pos + 2; // Skip closing ]]

        // Don't process if we're in silent mode
        if (silent) {return true;}

        // Create token
        var token_open = state.push('wiki_link_open', 'a', 1);
        token_open.attrSet('href', '#'); // Use # as placeholder
        if (className) {token_open.attrSet('class', className);}
        token_open.attrSet('data-document', document);
        token_open.attrSet('title', 'Wiki link: ' + document);

        var token_text = state.push('text', '', 0);
        token_text.content = title;

        state.push('wiki_link_close', 'a', -1);

        return true;
    }

    // Register the inline rule
    md.inline.ruler.before('emphasis', 'wiki_link', parseWikiLink);

    // Add render rules
    md.renderer.rules.wiki_link_open = function(tokens, idx) {
        var token = tokens[idx];
        var doc = token.attrGet('data-document') || '';
        var attrs = '';

        if (token.attrIndex('href') >= 0) {
            attrs += ' href="' + token.attrGet('href') + '"';
        }
        if (token.attrIndex('class') >= 0) {
            attrs += ' class="' + token.attrGet('class') + '"';
        }
        if (token.attrIndex('title') >= 0) {
            attrs += ' title="' + token.attrGet('title') + '"';
        }
        if (doc) {
            attrs += ' data-document="' + escapeHtml(doc) + '"';
        }

        // Wrap wiki link in a container for the menu button
        return '<span class="wiki-link-container" data-document="' + escapeHtml(doc) + '"><a' + attrs + '>';
    };

    md.renderer.rules.wiki_link_close = function() {
        // Add menu button after the link
        return '</a><button class="wiki-menu-btn" data-action="wiki-menu" title="Wiki link options">☰</button></span>';
    };
};

})();
