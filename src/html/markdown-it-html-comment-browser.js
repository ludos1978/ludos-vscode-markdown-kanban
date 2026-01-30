(function() { 'use strict';

/**
 * HTML Comment and Content Rendering Plugin for markdown-it (browser version)
 * Handles HTML comments and HTML content based on user settings.
 * Extracted from markdownRenderer.js — Phase 5.
 */
window.markdownitHtmlComment = function(md, options) {
    options = options || {};
    var commentMode = options.commentMode || 'hidden'; // 'hidden' or 'text'
    var contentMode = options.contentMode || 'html'; // 'html' or 'text'

    // Parse HTML comments as inline tokens
    function parseHtmlComment(state, silent) {
        var pos = state.pos;

        // Check for opening <!--
        if (pos + 3 >= state.posMax) {return false;}
        if (state.src.charCodeAt(pos) !== 0x3C /* < */) {return false;}
        if (state.src.charCodeAt(pos + 1) !== 0x21 /* ! */) {return false;}
        if (state.src.charCodeAt(pos + 2) !== 0x2D /* - */) {return false;}
        if (state.src.charCodeAt(pos + 3) !== 0x2D /* - */) {return false;}

        pos += 4;

        // Find closing -->
        var found = false;
        var content = '';
        var contentStart = pos;

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
        var token = state.push('html_comment', 'span', 0);
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
        var token = tokens[idx];
        var content = token.content;

        if (commentMode === 'hidden') {
            // Hide comment completely
            return '';
        }

        // Return visible comment marker (escaped so it shows as text)
        return '<span class="html-comment-marker" title="HTML Comment">&lt;!--' + escapeHtml(content) + '--&gt;</span>';
    };

    // Override default html_block renderer to handle comments and content
    var originalHtmlBlock = md.renderer.rules.html_block;
    md.renderer.rules.html_block = function(tokens, idx, options, env, self) {
        var token = tokens[idx];
        var content = token.content;

        // Check if this is an HTML comment
        if (content.trim().startsWith('<!--') && content.trim().endsWith('-->')) {
            var commentContent = content.trim().slice(4, -3).trim();

            if (commentMode === 'hidden') {
                return '';
            }

            return '<div class="html-comment-marker" title="HTML Comment">&lt;!--' + escapeHtml(commentContent) + '--&gt;</div>';
        }

        // Check if this is HTML content (not a comment, not a URL)
        var trimmedContent = content.trim();
        var isHtmlContent = trimmedContent.startsWith('<') &&
                            !trimmedContent.match(/^<https?:\/\//i);

        if (isHtmlContent && contentMode === 'text') {
            // Render HTML tags as visible text
            return '<pre class="html-content-text">' + escapeHtml(content) + '</pre>';
        }

        // Not a comment or should render as HTML, use original renderer
        return originalHtmlBlock ? originalHtmlBlock(tokens, idx, options, env, self) : content;
    };

    // Override default html_inline renderer for inline HTML content
    var originalHtmlInline = md.renderer.rules.html_inline;
    md.renderer.rules.html_inline = function(tokens, idx, options, env, self) {
        var token = tokens[idx];
        var content = token.content;

        // Check if this is inline HTML content (not a URL)
        var trimmedContent = content.trim();
        var isHtmlContent = trimmedContent.startsWith('<') &&
                            !trimmedContent.match(/^<https?:\/\//i);

        if (isHtmlContent && contentMode === 'text') {
            // Render HTML tags as visible text
            return '<code class="html-content-text">' + escapeHtml(content) + '</code>';
        }

        // Should render as HTML, use original renderer
        return originalHtmlInline ? originalHtmlInline(tokens, idx, options, env, self) : content;
    };
};

})();
