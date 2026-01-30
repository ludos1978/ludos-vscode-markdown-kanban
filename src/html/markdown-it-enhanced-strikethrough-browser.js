(function() { 'use strict';

/**
 * Enhanced Strikethrough Plugin for markdown-it (browser version)
 * Adds delete buttons to strikethrough text.
 * Extracted from markdownRenderer.js — Phase 5.
 */
window.markdownitEnhancedStrikethrough = function(md) {
    // Override the default strikethrough renderer
    md.renderer.rules.s_open = function(tokens, idx, options, env, renderer) {
        // Generate unique ID for this strikethrough element
        var uniqueId = 'strike-' + Math.random().toString(36).substr(2, 9);
        return '<span class="strikethrough-container" data-strike-id="' + uniqueId + '">' +
               '<del class="strikethrough-content">';
    };

    md.renderer.rules.s_close = function(tokens, idx, options, env, renderer) {
        return '</del></span>';
    };
};

})();
