(function() { 'use strict';

/**
 * Speaker Note Plugin for markdown-it (browser version)
 * Handles lines starting with ;; as speaker notes.
 * Consecutive ;; lines are grouped into a single div.
 * Extracted from markdownRenderer.js — Phase 5.
 */
window.markdownitSpeakerNote = function(md) {
    // Parse speaker note lines (starting with ;;)
    function parseSpeakerNote(state, startLine, endLine, silent) {
        var pos = state.bMarks[startLine] + state.tShift[startLine];
        var max = state.eMarks[startLine];

        // Check if line starts with ;;
        if (pos + 1 >= max) { return false; }
        if (state.src.charCodeAt(pos) !== 0x3B /* ; */) { return false; }
        if (state.src.charCodeAt(pos + 1) !== 0x3B /* ; */) { return false; }

        // Don't process if we're in silent mode
        if (silent) { return true; }

        // Collect all consecutive ;; lines
        var lines = [];
        var nextLine = startLine;

        while (nextLine < endLine) {
            var linePos = state.bMarks[nextLine] + state.tShift[nextLine];
            var lineMax = state.eMarks[nextLine];

            // Check if this line starts with ;;
            if (linePos + 1 < lineMax &&
                state.src.charCodeAt(linePos) === 0x3B /* ; */ &&
                state.src.charCodeAt(linePos + 1) === 0x3B /* ; */) {

                // Get content after ;;
                var content = state.src.slice(linePos + 2, lineMax).trim();
                lines.push(content);
                nextLine++;
            } else {
                // Stop when we hit a non-;; line
                break;
            }
        }

        // Create token with combined content
        var token = state.push('speaker_note', 'div', 0);
        token.content = lines.join('\n');
        token.markup = ';;';

        state.line = nextLine;
        return true;
    }

    // Register the block rule
    md.block.ruler.before('paragraph', 'speaker_note', parseSpeakerNote);

    // Render rule for speaker notes (supports multiline with <br>)
    md.renderer.rules.speaker_note = function(tokens, idx) {
        var token = tokens[idx];
        // Replace newlines with <br> for multiline notes
        var content = escapeHtml(token.content).replace(/\n/g, '<br>');
        return '<div class="speaker-note">' + content + '</div>\n';
    };
};

})();
