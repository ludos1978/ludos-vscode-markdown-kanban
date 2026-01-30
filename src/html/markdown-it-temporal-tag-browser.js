(function() { 'use strict';

/**
 * Temporal Tag Plugin for markdown-it (browser version)
 * Handles temporal prefix tags: !2025.01.28, !w49, !mon, !15:30, !09:00-17:00, etc.
 * Extracted from markdownRenderer.js — Phase 5.
 */

// =============================================================================
// TEMPORAL TAG CONFIGURATION - Easy to customize icons and styling
// =============================================================================
var TEMPORAL_TAG_CONFIG = {
    // Icons for different temporal tag types (can be emoji or text)
    icons: {
        date: '\u{1F4C5}',      // Date tags: !2025.01.28
        week: '\u{1F4C6}',      // Week tags: !w49, !2025.w49
        weekday: '\u{1F4C5}',   // Weekday tags: !mon, !friday
        time: '\u{1F550}',      // Time tags: !15:30, !9am
        timeSlot: '\u{23F1}\uFE0F',  // Time slot tags: !09:00-17:00
        minuteSlot: '\u{23F1}\uFE0F', // Minute slot tags: !:15-:30
        generic: '\u{1F550}'    // Generic temporal: fallback
    },
    // Whether to show icons (set to false to hide all icons)
    showIcons: true,
    // Base CSS class for all temporal tags
    baseClass: 'kanban-temporal-tag'
};

window.markdownitTemporalTag = function(md, options) {
    options = options || {};
    var config = {};
    var key;
    for (key in TEMPORAL_TAG_CONFIG) {
        config[key] = TEMPORAL_TAG_CONFIG[key];
    }
    for (key in options) {
        config[key] = options[key];
    }

    // Get temporal prefix from centralized config (defaults to '!' if not available)
    var TEMPORAL_PREFIX = (typeof window !== 'undefined' && window.TAG_PREFIXES)
        ? window.TAG_PREFIXES.TEMPORAL
        : '!';
    var TEMPORAL_CHAR_CODE = TEMPORAL_PREFIX.charCodeAt(0);

    function parseTemporalTag(state, silent) {
        var pos = state.pos;

        // Check for temporal prefix at word boundary
        if (state.src.charCodeAt(pos) !== TEMPORAL_CHAR_CODE) { return false; }

        // Must be at start or after whitespace
        if (pos > 0) {
            var prevChar = state.src.charCodeAt(pos - 1);
            if (prevChar !== 0x20 /* space */ && prevChar !== 0x0A /* newline */ && prevChar !== 0x09 /* tab */) {
                return false;
            }
        }

        pos++;
        if (pos >= state.posMax) { return false; }

        var remaining = state.src.slice(pos);
        var tagContent = '';
        var tagType = '';

        // Try matching patterns in order of specificity

        // 1. Time slot: HH:MM-HH:MM or Ham-Hpm
        var timeSlotMatch = remaining.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)-(\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)/i);
        if (timeSlotMatch) {
            tagContent = timeSlotMatch[0];
            tagType = 'timeSlot';
            pos += tagContent.length;
        }
        // 2. Week with year: YYYY.wNN, YYYY-wNN, YYYY.kwNN, YYYY-kwNN
        else {
            var weekYearMatch = remaining.match(/^(\d{4})[-.]?(?:[wW]|[kK][wW])(\d{1,2})(?=\s|$)/);
            if (weekYearMatch) {
                tagContent = weekYearMatch[0];
                tagType = 'week';
                pos += tagContent.length;
            }
            // 3. Week without year: wNN, WNN, kwNN, KW4 (German Kalenderwoche)
            else {
                var weekMatch = remaining.match(/^(?:[wW]|[kK][wW])(\d{1,2})(?=\s|$)/);
                if (weekMatch) {
                    tagContent = weekMatch[0];
                    tagType = 'week';
                    pos += tagContent.length;
                }
                // 4. Date: YYYY.MM.DD, DD.MM.YYYY, DD.MM.YY, or DD.MM (multiple formats)
                else {
                    var dateMatch = remaining.match(/^(\d{1,4})[-./](\d{1,2})(?:[-./](\d{2,4}))?(?=\s|$)/);
                    if (dateMatch) {
                        tagContent = dateMatch[0];
                        tagType = 'date';
                        pos += tagContent.length;
                    }
                    // 5. Weekday: mon, monday, tue, tuesday, etc.
                    else {
                        var weekdayMatch = remaining.match(/^(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(?=\s|$)/i);
                        if (weekdayMatch) {
                            tagContent = weekdayMatch[0];
                            tagType = 'weekday';
                            pos += tagContent.length;
                        }
                        // 6. Minute slot: :MM-:MM (inherits hour from parent)
                        else {
                            var minuteSlotMatch = remaining.match(/^:(\d{1,2})-:(\d{1,2})(?=\s|$)/i);
                            if (minuteSlotMatch) {
                                tagContent = minuteSlotMatch[0];
                                tagType = 'minuteSlot';
                                pos += tagContent.length;
                            }
                            // 7. Time: HH:MM or Ham/Hpm
                            else {
                                var timeMatch = remaining.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)/i);
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
        var token = state.push('temporal_tag', 'span', 0);
        token.content = tagContent;
        token.markup = '.';
        token.meta = { type: tagType, config: config };

        return true;
    }

    // Register before 'emphasis' - temporal prefix must be a markdown-it terminator char
    md.inline.ruler.before('emphasis', 'temporal_tag', parseTemporalTag);

    md.renderer.rules.temporal_tag = function(tokens, idx) {
        var token = tokens[idx];
        var tagContent = token.content;
        var tagType = token.meta.type;
        var cfg = token.meta.config;
        var fullTag = TEMPORAL_PREFIX + tagContent;

        // Determine CSS class based on type
        var typeClass = 'kanban-temporal-' + tagType;
        var classes = cfg.baseClass + ' ' + typeClass;

        // Get icon for this type
        var icon = cfg.showIcons ? (cfg.icons[tagType] || cfg.icons.generic) : '';

        // Check if currently active (for highlighting)
        var isActive = false;
        if (typeof window !== 'undefined' && window.tagUtils) {
            switch (tagType) {
                case 'date': isActive = window.tagUtils.isCurrentDate(fullTag); break;
                case 'week': isActive = window.tagUtils.isCurrentWeek(fullTag); break;
                case 'weekday': isActive = window.tagUtils.isCurrentWeekday(fullTag); break;
                case 'time': isActive = window.tagUtils.isCurrentTime(fullTag); break;
                case 'timeSlot': isActive = window.tagUtils.isCurrentTimeSlot(fullTag); break;
                case 'minuteSlot':
                    // Minute slots inherit from parent time slot context
                    if (window.currentRenderingTimeSlot) {
                        isActive = window.tagUtils.isCurrentMinuteSlot(fullTag, window.currentRenderingTimeSlot);
                    }
                    break;
            }
        }

        var activeClass = isActive ? ' temporal-active' : '';
        // Use simple HTML escaping inline to avoid dependency issues
        var escMap = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
        var escContent = tagContent.replace(/[&<>"']/g, function(c) { return escMap[c]; });
        var escFull = fullTag.replace(/[&<>"']/g, function(c) { return escMap[c]; });
        var dataAttr = 'data-temporal-type="' + tagType + '" data-temporal="' + escContent + '"';

        // For minute slots, add an extra attribute to help with line-level styling
        var lineActiveAttr = (tagType === 'minuteSlot' && isActive) ? ' data-temporal-line-active="true"' : '';

        return '<span class="' + classes + activeClass + '" ' + dataAttr + lineActiveAttr + '>' +
            (icon ? '<span class="temporal-icon">' + icon + '</span>' : '') +
            escFull + '</span>';
    };
};

})();
