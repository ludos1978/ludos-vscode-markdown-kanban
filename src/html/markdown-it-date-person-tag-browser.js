(function() { 'use strict';

/**
 * Date and Person Tag Plugin for markdown-it (browser version)
 * Handles @person, @2025-01-28, @YYYY-WNN syntax.
 * Extracted from markdownRenderer.js — Phase 5.
 */
window.markdownitDatePersonTag = function(md, options) {
    options = options || {};

    function parseDatePersonTag(state, silent) {
        var pos = state.pos;

        // Check for @ at word boundary
        if (state.src.charCodeAt(pos) !== 0x40 /* @ */) {return false;}
        if (pos > 0 && state.src.charCodeAt(pos - 1) !== 0x20 /* space */ &&
            state.src.charCodeAt(pos - 1) !== 0x0A /* newline */ &&
            pos !== 0) {return false;}

        pos++;
        if (pos >= state.posMax) {return false;}

        var tagStart = pos;
        var tagContent = '';
        var tagType = '';

        // Check if it's a week date pattern (@YYYY-WNN, @YYYYWNN, @WNN)
        var remaining = state.src.slice(pos);
        var weekMatch = remaining.match(/^(\d{4}-?W\d{1,2}|W\d{1,2})/i);

        if (weekMatch) {
            tagContent = weekMatch[1];
            tagType = 'week';
            pos += tagContent.length;
        }
        // Check if it's a date pattern (YYYY-MM-DD or DD-MM-YYYY)
        else {
            var dateMatch = remaining.match(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/);

            if (dateMatch) {
                tagContent = dateMatch[1];
                tagType = 'date';
                pos += tagContent.length;
            } else {
                // Parse as person name (letters, numbers, underscore, hyphen)
                while (pos < state.posMax) {
                    var char = state.src.charCodeAt(pos);
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
        var token = state.push('date_person_tag', 'span', 0);
        token.content = tagContent;
        token.markup = '@';
        token.meta = { type: tagType };

        return true;
    }

    md.inline.ruler.before('emphasis', 'date_person_tag', parseDatePersonTag);

    md.renderer.rules.date_person_tag = function(tokens, idx) {
        var token = tokens[idx];
        var tagContent = token.content;
        var tagType = token.meta.type;
        var fullTag = '@' + token.content;

        // Week tags get their own class (no icon)
        if (tagType === 'week') {
            return '<span class="kanban-week-tag" data-week="' + escapeHtml(tagContent) + '">' + escapeHtml(fullTag) + '</span>';
        }

        var className = tagType === 'date' ? 'kanban-date-tag' : 'kanban-person-tag';
        var dataAttr = tagType === 'date' ? 'data-date' : 'data-person';

        return '<span class="' + className + '" ' + dataAttr + '="' + escapeHtml(tagContent) + '">' + escapeHtml(fullTag) + '</span>';
    };
};

})();
