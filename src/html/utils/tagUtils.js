/**
 * Tag Processing Utility Module
 * Centralizes all tag extraction, parsing, and processing functionality
 */

// ============================================================================
// TAG PREFIX CONFIGURATION - Change these to modify tag prefixes globally
// ============================================================================
const TAG_PREFIXES = {
    HASH: '#',      // Regular tags: #todo, #urgent, #row2
    PERSON: '@',    // Person/mention tags: @john, @team-alpha
    TEMPORAL: '!',  // Temporal tags: !2025.01.28, !w15, !mon, !15:30
    QUERY: '$'      // Query tags: $#tag, $@person, $!today (queries cards with matching tags)
};

// Helper to escape special regex characters in prefixes
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pre-escaped prefixes for regex patterns
const P = {
    H: escapeRegex(TAG_PREFIXES.HASH),
    P: escapeRegex(TAG_PREFIXES.PERSON),
    T: escapeRegex(TAG_PREFIXES.TEMPORAL),
    Q: escapeRegex(TAG_PREFIXES.QUERY)
};

class TagUtils {
    constructor() {
        // Store prefixes for external access
        this.prefixes = TAG_PREFIXES;

        // Centralized regex patterns for tag matching
        // All tags capture everything after their prefix until whitespace (space, tab, newline)
        this.patterns = {
            // HASH TAGS - regular tags, everything until whitespace
            // Supports: #tag, #1, #1.5, #++, etc.
            basicTags: new RegExp(`${P.H}([^\\s]+)`, 'g'),

            // PERSON/MENTION TAGS - everything until whitespace
            // @johnson, @Johnson&johnson, @team-alpha, etc.
            personTags: new RegExp(`${P.P}([^\\s]+)`, 'g'),

            // Special positivity tags (#++, #+, #ø, #-, #--)
            positivityTags: new RegExp(`${P.H}(\\+\\+|--|\\+|ø|Ø|-(?!-))`, 'g'),

            // Numeric index tags (#1, #13, #013, #1.1, #0.1, #0.13, #0.01, #3.1.3, #1.2.3.4)
            numericTag: new RegExp(`${P.H}(\\d+(?:\\.\\d+)*)(?=\\s|$)`, 'g'),

            // Layout-specific tags
            rowTag: new RegExp(`${P.H}row(\\d+)(?=\\s|$)`, 'gi'),
            spanTag: new RegExp(`${P.H}span(\\d+)(?=\\s|$)`, 'gi'),
            stackTag: new RegExp(`${P.H}stack(?=\\s|$)`, 'gi'),
            stickyTag: new RegExp(`${P.H}sticky(?=\\s|$)`, 'gi'),
            includeTag: new RegExp(`${P.H}include:([^\\s]+)`, 'i'),

            // QUERY TAGS - start with ? followed by tag type prefix (#, @, !)
            // Examples: ?#tag, ?@person, ?!today, ?#tag1&tag2, ?@reto|bruno
            // Captures: type prefix and the query content
            queryTags: new RegExp(`${P.Q}([${P.H}${P.P}${P.T}])([^\\s]+)`, 'g'),

            // TEMPORAL TAGS - all start with . and capture everything until whitespace
            // Date patterns (.2025.01.28, .2025-01-05, .2025/01/05)
            dateTags: new RegExp(`${P.T}(\\d{4}[-./]\\d{1,2}[-./]\\d{1,2})(?=\\s|$)`, 'g'),

            // Week patterns (.w15, .W15, .2025.w15, .2025-w15)
            weekTags: new RegExp(`${P.T}(?:(\\d{4})[-.]?)?[wW](\\d{1,2})(?=\\s|$)`, 'g'),

            // Weekday patterns (.mon, .monday, .tue, .tuesday, etc.)
            weekdayTags: new RegExp(`${P.T}(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(?=\\s|$)`, 'gi'),

            // Time patterns (.15:30, .9am, .10pm, .22:00)
            timeTags: new RegExp(`${P.T}(\\d{1,2}(?::\\d{2})?(?:am|pm)?)(?=\\s|$)`, 'gi'),

            // Time slot patterns (.15:30-17:00, .9am-5pm)
            timeSlotTags: new RegExp(`${P.T}(\\d{1,2}(?::\\d{2})?(?:am|pm)?)-(\\d{1,2}(?::\\d{2})?(?:am|pm)?)(?=\\s|$)`, 'gi'),

            // Minute slot patterns (!:15-:30, !:00-:15) - inherit hour from parent time slot
            minuteSlotTags: new RegExp(`${P.T}:(\\d{1,2})-:(\\d{1,2})(?=\\s|$)`, 'gi'),

            // Generic temporal tag - captures everything after . until whitespace (for future extensions)
            temporalTag: new RegExp(`${P.T}([^\\s]+)`, 'g'),

            // Priority/state tags
            priorityTag: new RegExp(`${P.H}(high|medium|low|urgent)(?=\\s|$)`, 'i'),
            stateTag: new RegExp(`${P.H}(todo|doing|done|blocked|waiting)(?=\\s|$)`, 'i'),

            // Card/column state tags
            foldTag: new RegExp(`${P.H}fold(?=\\s|$)`, 'i'),
            archiveTag: new RegExp(`${P.H}archive(?=\\s|$)`, 'i'),
            hiddenTag: new RegExp(`${P.H}hidden(?=\\s|$)`, 'i')
        };

        // Dynamic regex for stripping any tag prefix
        this.prefixStripRegex = new RegExp(`^[${escapeRegex(TAG_PREFIXES.HASH + TAG_PREFIXES.PERSON + TAG_PREFIXES.TEMPORAL + TAG_PREFIXES.QUERY)}]`);

        // Layout tags that should not be displayed
        this.layoutTags = ['row', 'span', 'stack', 'sticky', 'fold', 'archive', 'hidden', 'include'];

        // Tags that should be excluded from menus
        this.excludedTags = ['ungathered', 'fold', 'archive', 'hidden'];
    }

    /**
     * Extract all tags from text
     * @param {string} text - Text to extract tags from
     * @param {Object} options - Extraction options
     * @returns {Array} Array of extracted tags
     */
    extractTags(text, options = {}) {
        const {
            includeHash = false,      // # tags (regular tags)
            includePerson = false,    // @ tags (person/mention tags)
            includeTemporal = false,  // . tags (temporal tags)
            includeQuery = false,     // ? tags (query tags)
            excludeLayout = true,
            unique = true
        } = options;

        if (!text || typeof text !== 'string') {
            return [];
        }

        const { HASH: H, PERSON: P, TEMPORAL: T, QUERY: Q } = this.prefixes;
        const tags = [];

        // Extract hash tags
        if (includeHash !== false) {
            const hashMatches = text.matchAll(this.patterns.basicTags);
            for (const match of hashMatches) {
                const tag = includeHash === 'withSymbol' ? `${H}${match[1]}` : match[1];
                tags.push(tag);
            }
        }

        // Extract person tags
        if (includePerson) {
            const personMatches = text.matchAll(this.patterns.personTags);
            for (const match of personMatches) {
                const tag = includePerson === 'withSymbol' ? `${P}${match[1]}` : match[1];
                tags.push(tag);
            }
        }

        // Extract temporal tags
        if (includeTemporal) {
            const temporalMatches = text.matchAll(this.patterns.temporalTag);
            for (const match of temporalMatches) {
                const tag = includeTemporal === 'withSymbol' ? `${T}${match[1]}` : match[1];
                tags.push(tag);
            }
        }

        // Extract query tags
        if (includeQuery) {
            const queryMatches = text.matchAll(this.patterns.queryTags);
            for (const match of queryMatches) {
                const tag = includeQuery === 'withSymbol' ? `${Q}${match[1]}${match[2]}` : `${match[1]}${match[2]}`;
                tags.push(tag);
            }
        }

        // Filter out layout tags if requested
        let filteredTags = tags;
        if (excludeLayout) {
            filteredTags = tags.filter(tag => {
                const cleanTag = tag.replace(this.prefixStripRegex, '').toLowerCase();
                return !this.isLayoutTag(cleanTag);
            });
        }

        // Return unique tags if requested
        return unique ? [...new Set(filteredTags)] : filteredTags;
    }

    /**
     * Extract the first tag from text (boardRenderer.js compatible)
     * @param {string} text - Text to extract tag from
     * @param {boolean} excludeLayout - Whether to exclude layout tags
     * @returns {string|null} First tag or null
     */
    extractFirstTag(text, excludeLayout = true) {
        if (!text) return null;

        // First check for special positivity tags at the beginning
        // Use negative lookahead to ensure - doesn't match when it's part of --
        // Order matters: match longer patterns first
        const positivityMatch = text.match(/#(\+\+|--|\+|ø|Ø|-(?!-))/);
        if (positivityMatch) {
            return positivityMatch[1].toLowerCase();
        }

        // Use boardRenderer.js compatible regex with exclusions (includes dots for numeric tags like #1.5)
        const re = /#(?!row\d+\b)(?!span\d+\b)([a-zA-Z0-9_.-]+(?:[=|><][a-zA-Z0-9_.-]+)*)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const raw = m[1];
            const baseMatch = raw.match(/^([a-zA-Z0-9_.-]+)/);
            const base = (baseMatch ? baseMatch[1] : raw).toLowerCase();

            // Skip numeric tags for styling (they're for indexing, not styling)
            // Check if the tag is purely numeric (with optional decimal point)
            if (/^\d+(?:\.\d+)?$/.test(base)) continue;

            // Skip stack tag for styling
            if (base === 'stack') continue;

            return base;
        }
        return null;
    }

    /**
     * Extract the first tag from text (simple version for markdownRenderer.js)
     * @param {string} text - Text to extract tag from
     * @returns {string|null} First tag or null
     */
    extractFirstTagSimple(text) {
        if (!text) return null;

        // First check for special positivity tags
        // Use negative lookahead to ensure - doesn't match when it's part of --
        // Order matters: match longer patterns first
        const positivityMatch = text.match(/#(\+\+|--|\+|ø|Ø|-(?!-))/);
        if (positivityMatch) {
            return positivityMatch[1].toLowerCase();
        }

        const tagMatch = text.match(/#([a-zA-Z0-9_.-]+)/);
        return tagMatch ? tagMatch[1].toLowerCase() : null;
    }

    /**
     * Extract numeric index tag from text
     * @param {string} text - Text to extract numeric tag from
     * @returns {number|null} Numeric value or null if not found
     */
    extractNumericTag(text) {
        if (!text) return null;

        // Extract ALL numeric tags and return as array
        const pattern = /#(\d+(?:\.\d+)?)\b/g;
        const tags = [];
        let match;
        while ((match = pattern.exec(text)) !== null) {
            tags.push(parseFloat(match[1]));
        }

        // Return array of all numeric tags, or null if none found
        return tags.length > 0 ? tags : null;
    }

    /**
     * Extract date tag from text
     * @param {string} text - Text to extract date tag from
     * @returns {Object|null} Object with {year, month, day} or null if not found
     */
    extractDateTag(text) {
        if (!text) return null;

        this.patterns.dateTags.lastIndex = 0;
        const match = this.patterns.dateTags.exec(text);
        if (!match) return null;

        // Parse date string (supports -, ., / separators)
        const parts = match[1].split(/[-./]/);
        if (parts.length !== 3) return null;

        return {
            year: parseInt(parts[0], 10),
            month: parseInt(parts[1], 10),
            day: parseInt(parts[2], 10)
        };
    }

    /**
     * Check if a date tag matches the current date
     * @param {string} text - Text containing date tag
     * @returns {boolean} True if text contains current date tag
     */
    isCurrentDate(text) {
        const dateTag = this.extractDateTag(text);
        if (!dateTag) return false;

        const now = new Date();
        return dateTag.year === now.getFullYear() &&
               dateTag.month === (now.getMonth() + 1) &&
               dateTag.day === now.getDate();
    }

    /**
     * Check if text contains a date tag
     * @param {string} text - Text to check
     * @returns {boolean} True if contains date tag
     */
    hasDateTag(text) {
        if (!text) return false;
        this.patterns.dateTags.lastIndex = 0;
        return this.patterns.dateTags.test(text);
    }

    /**
     * Extract week tag from text
     * @param {string} text - Text to extract week tag from
     * @returns {Object|null} Object with {year, week} or null if not found
     */
    extractWeekTag(text) {
        if (!text) return null;

        // Reset regex lastIndex to ensure consistent matching
        this.patterns.weekTags.lastIndex = 0;
        const match = this.patterns.weekTags.exec(text);

        if (!match) return null;

        // Format: :2025-w15 or :2025w15 (groups 1 and 2)
        if (match[1] && match[2]) {
            return {
                year: parseInt(match[1], 10),
                week: parseInt(match[2], 10)
            };
        }

        // Format: :w15 (only group 2) - use current year
        if (match[2]) {
            const currentYear = new Date().getFullYear();
            return {
                year: currentYear,
                week: parseInt(match[2], 10)
            };
        }

        return null;
    }

    /**
     * Get current week number and year (ISO 8601 week date)
     * @returns {Object} Object with {year, week}
     */
    getCurrentWeek() {
        const now = new Date();

        // ISO 8601 week date calculation
        const target = new Date(now.valueOf());
        const dayNumber = (now.getDay() + 6) % 7; // Monday = 0
        target.setDate(target.getDate() - dayNumber + 3); // Thursday of this week
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000); // 604800000 = 7 * 24 * 3600 * 1000

        // Get the year for the week (might differ from calendar year for first/last week)
        const jan4 = new Date(now.getFullYear(), 0, 4);
        const weekYear = target.getFullYear();

        return {
            year: weekYear,
            week: weekNumber
        };
    }

    /**
     * Check if a week tag matches the current week
     * @param {string} text - Text containing week tag
     * @returns {boolean} True if text contains current week tag
     */
    isCurrentWeek(text) {
        const weekTag = this.extractWeekTag(text);
        if (!weekTag) return false;

        const currentWeek = this.getCurrentWeek();
        return weekTag.year === currentWeek.year && weekTag.week === currentWeek.week;
    }

    /**
     * Check if text contains a week tag
     * @param {string} text - Text to check
     * @returns {boolean} True if contains week tag
     */
    hasWeekTag(text) {
        if (!text) return false;
        this.patterns.weekTags.lastIndex = 0;
        return this.patterns.weekTags.test(text);
    }

    /**
     * Extract weekday tag from text
     * @param {string} text - Text to extract weekday tag from
     * @returns {number|null} Day of week (0=Sunday, 1=Monday, ..., 6=Saturday) or null
     */
    extractWeekdayTag(text) {
        if (!text) return null;

        this.patterns.weekdayTags.lastIndex = 0;
        const match = this.patterns.weekdayTags.exec(text);
        if (!match) return null;

        const dayMap = {
            'sun': 0, 'sunday': 0,
            'mon': 1, 'monday': 1,
            'tue': 2, 'tuesday': 2,
            'wed': 3, 'wednesday': 3,
            'thu': 4, 'thursday': 4,
            'fri': 5, 'friday': 5,
            'sat': 6, 'saturday': 6
        };

        return dayMap[match[1].toLowerCase()] ?? null;
    }

    /**
     * Check if a weekday tag matches the current day
     * @param {string} text - Text containing weekday tag
     * @returns {boolean} True if text contains current weekday tag
     */
    isCurrentWeekday(text) {
        const weekdayTag = this.extractWeekdayTag(text);
        if (weekdayTag === null) return false;

        const currentDay = new Date().getDay();
        return weekdayTag === currentDay;
    }

    /**
     * Check if text contains a weekday tag
     * @param {string} text - Text to check
     * @returns {boolean} True if contains weekday tag
     */
    hasWeekdayTag(text) {
        if (!text) return false;
        this.patterns.weekdayTags.lastIndex = 0;
        return this.patterns.weekdayTags.test(text);
    }

    /**
     * Parse time string to minutes since midnight
     * @param {string} timeStr - Time string like "10:30", "10pm", "22:00"
     * @returns {number|null} Minutes since midnight or null if invalid
     */
    parseTimeToMinutes(timeStr) {
        if (!timeStr) return null;

        const lower = timeStr.toLowerCase();

        // Check for am/pm format
        const ampmMatch = lower.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
        if (ampmMatch) {
            let hours = parseInt(ampmMatch[1], 10);
            const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
            const isPM = ampmMatch[3] === 'pm';

            // Handle 12-hour format
            if (hours === 12) {
                hours = isPM ? 12 : 0;
            } else if (isPM) {
                hours += 12;
            }

            return hours * 60 + minutes;
        }

        // Check for 24-hour format
        const hourMatch = lower.match(/^(\d{1,2})(?::(\d{2}))?$/);
        if (hourMatch) {
            const hours = parseInt(hourMatch[1], 10);
            const minutes = hourMatch[2] ? parseInt(hourMatch[2], 10) : 0;

            // Special case: 24:00 means midnight (00:00)
            if (hours === 24 && minutes === 0) {
                return 0;
            }

            if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                return hours * 60 + minutes;
            }
        }

        return null;
    }

    /**
     * Extract time tag from text
     * @param {string} text - Text to extract time tag from
     * @returns {number|null} Minutes since midnight or null
     */
    extractTimeTag(text) {
        if (!text) return null;

        this.patterns.timeTags.lastIndex = 0;
        const match = this.patterns.timeTags.exec(text);
        if (!match) return null;

        return this.parseTimeToMinutes(match[1]);
    }

    /**
     * Check if a time tag matches the current hour
     * @param {string} text - Text containing time tag
     * @returns {boolean} True if text contains current hour time tag
     */
    isCurrentTime(text) {
        const timeTag = this.extractTimeTag(text);
        if (timeTag === null) return false;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // Match if within the same hour (±30 minutes from tag time)
        return Math.abs(currentMinutes - timeTag) <= 30;
    }

    /**
     * Check if text contains a time tag
     * @param {string} text - Text to check
     * @returns {boolean} True if contains time tag
     */
    hasTimeTag(text) {
        if (!text) return false;
        this.patterns.timeTags.lastIndex = 0;
        return this.patterns.timeTags.test(text);
    }

    /**
     * Extract time slot tag from text
     * @param {string} text - Text to extract time slot from
     * @returns {Object|null} Object with {start, end} in minutes since midnight or null
     */
    extractTimeSlotTag(text) {
        if (!text) return null;

        this.patterns.timeSlotTags.lastIndex = 0;
        const match = this.patterns.timeSlotTags.exec(text);
        if (!match) return null;

        const start = this.parseTimeToMinutes(match[1]);
        const end = this.parseTimeToMinutes(match[2]);

        if (start === null || end === null) return null;

        return { start, end };
    }

    /**
     * Check if current time falls within a time slot tag
     * @param {string} text - Text containing time slot tag
     * @returns {boolean} True if current time is within the time slot
     */
    isCurrentTimeSlot(text) {
        const timeSlot = this.extractTimeSlotTag(text);
        if (!timeSlot) return false;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // Handle slots that cross midnight (e.g., @10pm-2am)
        if (timeSlot.end < timeSlot.start) {
            return currentMinutes >= timeSlot.start || currentMinutes <= timeSlot.end;
        }

        return currentMinutes >= timeSlot.start && currentMinutes <= timeSlot.end;
    }

    /**
     * Check if text contains a time slot tag
     * @param {string} text - Text to check
     * @returns {boolean} True if contains time slot tag
     */
    hasTimeSlotTag(text) {
        if (!text) return false;
        this.patterns.timeSlotTags.lastIndex = 0;
        return this.patterns.timeSlotTags.test(text);
    }

    /**
     * Check if text contains a minute slot tag (!:15-:30)
     * @param {string} text - Text to check
     * @returns {boolean} True if contains minute slot tag
     */
    hasMinuteSlotTag(text) {
        if (!text) return false;
        this.patterns.minuteSlotTags.lastIndex = 0;
        return this.patterns.minuteSlotTags.test(text);
    }

    /**
     * Extract minute slot from text
     * @param {string} text - Text to extract minute slot from
     * @returns {Object|null} Object with {startMinute, endMinute} or null
     */
    extractMinuteSlotTag(text) {
        if (!text) return null;

        this.patterns.minuteSlotTags.lastIndex = 0;
        const match = this.patterns.minuteSlotTags.exec(text);
        if (!match) return null;

        const startMinute = parseInt(match[1], 10);
        const endMinute = parseInt(match[2], 10);

        if (isNaN(startMinute) || isNaN(endMinute)) return null;
        if (startMinute < 0 || startMinute > 59) return null;
        if (endMinute < 0 || endMinute > 59) return null;

        return { startMinute, endMinute };
    }

    /**
     * Check if current time falls within a minute slot, given a parent hour context.
     * The minute slot inherits the hour from the parent time slot.
     *
     * Example: Parent has !15:00-16:00, line has !:15-:30
     * If current time is 15:20 → highlighted (within 15:15-15:30)
     * If current time is 15:40 → not highlighted (outside 15:15-15:30)
     *
     * @param {string} text - Text containing minute slot tag
     * @param {Object} parentTimeSlot - Parent time slot context {start, end} in minutes since midnight
     * @returns {boolean} True if current time is within the inherited minute slot
     */
    isCurrentMinuteSlot(text, parentTimeSlot) {
        const minuteSlot = this.extractMinuteSlotTag(text);
        if (!minuteSlot || !parentTimeSlot) return false;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // Check if we're currently within the parent time slot
        let inParentSlot = false;
        if (parentTimeSlot.end < parentTimeSlot.start) {
            // Parent crosses midnight
            inParentSlot = currentMinutes >= parentTimeSlot.start || currentMinutes <= parentTimeSlot.end;
        } else {
            inParentSlot = currentMinutes >= parentTimeSlot.start && currentMinutes <= parentTimeSlot.end;
        }

        if (!inParentSlot) return false;

        // Get the current hour (the hour we're in within the parent slot)
        const currentHour = now.getHours();

        // Calculate the absolute minute range for this minute slot
        // The minute slot applies to the current hour within the parent slot
        const slotStart = currentHour * 60 + minuteSlot.startMinute;
        const slotEnd = currentHour * 60 + minuteSlot.endMinute;

        // Check if current time is within this minute slot
        if (slotEnd < slotStart) {
            // Minute slot crosses hour boundary (e.g., :45-:15 means 45 to 15 of next hour)
            // This is a rare case but handle it
            return currentMinutes >= slotStart || (currentMinutes % 60) <= minuteSlot.endMinute;
        }

        return currentMinutes >= slotStart && currentMinutes <= slotEnd;
    }

    /**
     * Check if any temporal tag (date, week, weekday, time, time slot) is currently active
     * @param {string} text - Text to check
     * @returns {boolean} True if any temporal tag matches current time
     */
    isTemporallyActive(text) {
        return this.isCurrentDate(text) ||
               this.isCurrentWeek(text) ||
               this.isCurrentWeekday(text) ||
               this.isCurrentTime(text) ||
               this.isCurrentTimeSlot(text);
    }

    /**
     * Evaluate temporal tags at a single structural level with gate control.
     *
     * Temporal hierarchy (higher to lower): date > week > weekday > hour > timeSlot
     * A closed gate means higher-order temporals are not active, so lower-order ones shouldn't highlight.
     *
     * @param {string} text - Text to evaluate
     * @param {Object} incomingGate - Gate state from higher structural level
     * @param {boolean} incomingGate.open - Whether the gate is open
     * @param {string|null} incomingGate.closedBy - What closed the gate (for debugging)
     * @param {string} levelName - Name of this level (for debugging)
     * @returns {Object} { attrs: {attr: boolean}, gate: {open, closedBy} }
     */
    evaluateTemporalsAtLevel(text, incomingGate, levelName) {
        // If no text or gate already closed, return empty
        if (!text || !incomingGate.open) {
            return { attrs: {}, gate: incomingGate };
        }

        const attrs = {};
        let gate = { ...incomingGate };

        // Temporal checks ordered by hierarchy (higher order first)
        // Higher-order temporals gate lower-order ones
        const checks = [
            { has: this.hasDateTag,     check: this.isCurrentDate,     attr: 'data-current-day',     name: 'date' },
            { has: this.hasWeekTag,     check: this.isCurrentWeek,     attr: 'data-current-week',    name: 'week' },
            { has: this.hasWeekdayTag,  check: this.isCurrentWeekday,  attr: 'data-current-weekday', name: 'weekday' },
            { has: this.hasTimeTag,     check: this.isCurrentTime,     attr: 'data-current-hour',    name: 'hour' },
            { has: this.hasTimeSlotTag, check: this.isCurrentTimeSlot, attr: 'data-current-time',    name: 'timeSlot' }
        ];

        for (const { has, check, attr, name } of checks) {
            if (has.call(this, text)) {
                // Only check if gate is still open
                const isActive = gate.open && check.call(this, text);
                attrs[attr] = isActive;

                // If this temporal exists but isn't active, close the gate for lower levels
                if (!isActive && gate.open) {
                    gate = { open: false, closedBy: `${levelName}:${name}` };
                }
            }
        }

        return { attrs, gate };
    }

    /**
     * Get active temporal attributes for a task considering hierarchical gating.
     *
     * Structural hierarchy: Column > Task Title > Task Content
     * Temporal hierarchy: date > week > weekday > hour > timeSlot
     *
     * A temporal tag at a lower structural level is only highlighted if ALL temporal tags
     * at higher structural levels are currently active.
     *
     * Example: Column has !W49, Task has !09:00-12:00
     * - If current week is 49 AND current time is in 09:00-12:00 → task highlights
     * - If current week is NOT 49 → task does NOT highlight (gate closed by column)
     * - If column has NO week tag → task highlights whenever time matches
     *
     * @param {string} columnTitle - Column title text
     * @param {string} taskTitle - Task title text
     * @param {string} taskContent - Task description/content text
     * @returns {Object} Object with data attributes as keys and boolean values
     */
    getActiveTemporalAttributes(columnTitle, taskTitle, taskContent) {
        let gate = { open: true, closedBy: null };
        const result = {};

        // Evaluate column level (no gating from above)
        const columnResult = this.evaluateTemporalsAtLevel(columnTitle || '', gate, 'column');
        Object.assign(result, columnResult.attrs);
        gate = columnResult.gate;

        // Evaluate task title level (gated by column)
        const titleResult = this.evaluateTemporalsAtLevel(taskTitle || '', gate, 'taskTitle');
        // Only add attrs that aren't already set by column
        for (const [attr, value] of Object.entries(titleResult.attrs)) {
            if (result[attr] === undefined) {
                result[attr] = value;
            }
        }
        gate = titleResult.gate;

        // Evaluate task content level (gated by column + title)
        const contentResult = this.evaluateTemporalsAtLevel(taskContent || '', gate, 'taskContent');
        // Only add attrs that aren't already set by higher levels
        for (const [attr, value] of Object.entries(contentResult.attrs)) {
            if (result[attr] === undefined) {
                result[attr] = value;
            }
        }

        return result;
    }

    /**
     * Check if a tag is a numeric index tag
     * @param {string} tag - Tag to check (with or without # symbol)
     * @returns {boolean} True if numeric tag
     */
    isNumericTag(tag) {
        if (!tag) return false;
        const withHash = tag.startsWith('#') ? tag : `#${tag}`;
        return this.patterns.numericTag.test(withHash);
    }

    /**
     * Check if a tag is a layout tag
     * @param {string} tag - Tag to check (without # symbol)
     * @returns {boolean} True if layout tag
     */
    isLayoutTag(tag) {
        if (!tag) return false;

        const cleanTag = tag.replace(this.prefixStripRegex, '').toLowerCase();

        // Check static layout tags
        if (this.layoutTags.includes(cleanTag)) {
            return true;
        }

        // Check pattern-based layout tags
        const H = this.prefixes.HASH;
        if (this.patterns.rowTag.test(`${H}${cleanTag}`)) return true;
        if (this.patterns.spanTag.test(`${H}${cleanTag}`)) return true;
        if (this.patterns.stackTag.test(`${H}${cleanTag}`)) return true;
        if (this.patterns.includeTag.test(`${H}${cleanTag}`)) return true;

        return false;
    }

    /**
     * Check if a tag is a query tag
     * @param {string} tag - Tag to check
     * @returns {boolean} True if query tag
     */
    isQueryTag(tag) {
        if (!tag) return false;
        return tag.startsWith(this.prefixes.QUERY);
    }

    /**
     * Extract query tags from text
     * @param {string} text - Text to extract query tags from
     * @returns {Array} Array of query tag objects {type, query, full}
     */
    extractQueryTags(text) {
        if (!text) return [];

        const { HASH: H, PERSON: P, TEMPORAL: T, QUERY: Q } = this.prefixes;
        const queries = [];

        this.patterns.queryTags.lastIndex = 0;
        let match;
        while ((match = this.patterns.queryTags.exec(text)) !== null) {
            const typePrefix = match[1];
            const queryContent = match[2];

            let type;
            if (typePrefix === H) type = 'hash';
            else if (typePrefix === P) type = 'person';
            else if (typePrefix === T) type = 'temporal';
            else type = 'unknown';

            queries.push({
                type,
                typePrefix,
                query: queryContent,
                full: `${Q}${typePrefix}${queryContent}`
            });
        }

        return queries;
    }

    /**
     * Parse query tag conditions (supports &, |, ! operators)
     * @param {string} queryContent - Query content (without ?# prefix)
     * @returns {Object} Parsed conditions {include, exclude, operator}
     */
    parseQueryConditions(queryContent) {
        if (!queryContent) return null;

        const conditions = {
            include: [],
            exclude: [],
            operator: 'AND'
        };

        // Parse OR conditions (|)
        if (queryContent.includes('|')) {
            conditions.operator = 'OR';
            conditions.include = queryContent.split('|').map(t => t.trim()).filter(t => t);
        }
        // Parse AND conditions (&)
        else if (queryContent.includes('&')) {
            conditions.operator = 'AND';
            conditions.include = queryContent.split('&').map(t => t.trim()).filter(t => t);
        }
        // Parse NOT conditions (!)
        else if (queryContent.includes('!')) {
            const parts = queryContent.split('!');
            conditions.include = parts[0] ? [parts[0].trim()] : [];
            conditions.exclude = parts.slice(1).map(t => t.trim()).filter(t => t);
        }
        // Single condition
        else {
            conditions.include = [queryContent.trim()];
        }

        return conditions;
    }

    /**
     * Extract layout configuration from tags
     * @param {string} text - Text containing tags
     * @returns {Object} Layout configuration
     */
    extractLayoutConfig(text) {
        const config = {
            row: null,
            span: null,
            stack: false,
            fold: false,
            archive: false,
            hidden: false,
            include: null
        };

        if (!text) return config;

        // Extract row number
        const rowMatch = text.match(this.patterns.rowTag);
        if (rowMatch) {
            config.row = parseInt(rowMatch[1]);
        }

        // Extract span number
        const spanMatch = text.match(this.patterns.spanTag);
        if (spanMatch) {
            config.span = parseInt(spanMatch[1]);
        }

        // Check for stack tag
        config.stack = this.patterns.stackTag.test(text);

        // Check for fold tag
        config.fold = this.patterns.foldTag.test(text);

        // Check for archive tag
        config.archive = this.patterns.archiveTag.test(text);

        // Check for hidden tag
        config.hidden = this.patterns.hiddenTag.test(text);

        // Extract include path
        const includeMatch = text.match(this.patterns.includeTag);
        if (includeMatch) {
            config.include = includeMatch[1];
        }

        return config;
    }

    /**
     * Filter tags for display (exclude layout and special tags)
     * @param {Array} tags - Array of tags to filter
     * @returns {Array} Filtered tags
     */
    filterDisplayTags(tags) {
        if (!Array.isArray(tags)) return [];

        return tags.filter(tag => {
            const cleanTag = tag.replace(this.prefixStripRegex, '').toLowerCase();

            // Skip layout tags
            if (this.isLayoutTag(cleanTag)) return false;

            // Skip excluded tags
            if (this.excludedTags.some(excluded => cleanTag.startsWith(excluded))) {
                return false;
            }

            return true;
        });
    }

    /**
     * Group tags by type
     * @param {Array} tags - Array of tags
     * @returns {Object} Grouped tags
     */
    groupTagsByType(tags) {
        const { HASH: H, PERSON: P, TEMPORAL: T, QUERY: Q } = this.prefixes;
        const groups = {
            priority: [],
            state: [],
            temporal: [],   // . tags (dates, times, weeks, weekdays)
            person: [],     // @ tags
            query: [],      // ? tags (queries)
            layout: [],
            regular: []     // # tags
        };

        tags.forEach(tag => {
            const cleanTag = tag.replace(this.prefixStripRegex, '');

            if (tag.startsWith(Q)) {
                groups.query.push(tag);
            } else if (this.patterns.priorityTag.test(`${H}${cleanTag}`)) {
                groups.priority.push(tag);
            } else if (this.patterns.stateTag.test(`${H}${cleanTag}`)) {
                groups.state.push(tag);
            } else if (tag.startsWith(T)) {
                groups.temporal.push(tag);
            } else if (tag.startsWith(P)) {
                groups.person.push(tag);
            } else if (this.isLayoutTag(cleanTag)) {
                groups.layout.push(tag);
            } else {
                groups.regular.push(tag);
            }
        });

        return groups;
    }

    /**
     * Generate CSS class names from tags
     * @param {Array|string} tags - Tags or text containing tags
     * @returns {string} Space-separated CSS classes
     */
    generateTagClasses(tags) {
        let tagArray = tags;

        if (typeof tags === 'string') {
            tagArray = this.extractTags(tags, {
                includeHash: true,
                includePerson: true,
                includeTemporal: true,
                excludeLayout: false
            });
        }

        if (!Array.isArray(tagArray)) return '';

        return tagArray
            .map(tag => {
                const cleanTag = tag.replace(this.prefixStripRegex, '').replace(/[^a-zA-Z0-9_-]/g, '-');
                return `tag-${cleanTag}`;
            })
            .join(' ');
    }

    /**
     * Clean tags from text (remove all tag patterns)
     * @param {string} text - Text to clean
     * @param {Object} options - Cleaning options
     * @returns {string} Cleaned text
     */
    removeTagsFromText(text, options = {}) {
        const {
            removeHash = true,      // # tags
            removePerson = false,   // $ tags
            removeTemporal = false, // @ tags
            keepLayout = false
        } = options;

        if (!text) return '';

        let cleanedText = text;

        // Remove hash tags (#)
        if (removeHash) {
            if (keepLayout) {
                // Remove only non-layout tags
                cleanedText = cleanedText.replace(this.patterns.basicTags, (match, tag) => {
                    return this.isLayoutTag(tag) ? match : '';
                });
            } else {
                cleanedText = cleanedText.replace(this.patterns.basicTags, '');
            }
        }

        // Remove person tags ($)
        if (removePerson) {
            cleanedText = cleanedText.replace(this.patterns.personTags, '');
        }

        // Remove temporal tags (@)
        if (removeTemporal) {
            cleanedText = cleanedText.replace(this.patterns.temporalTag, '');
        }

        // Clean up extra spaces
        cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

        return cleanedText;
    }

    /**
     * Sort columns by numeric index tag
     * @param {Array} columns - Array of columns with title property
     * @returns {Array} Sorted columns
     */
    sortColumnsByNumericTag(columns) {
        if (!Array.isArray(columns)) return [];

        return [...columns].sort((a, b) => {
            const tagsA = this.extractNumericTag(a.title);
            const tagsB = this.extractNumericTag(b.title);

            // Use first numeric tag for sorting
            const numA = tagsA ? tagsA[0] : null;
            const numB = tagsB ? tagsB[0] : null;

            // Columns without numeric tags go to the end
            if (numA === null && numB === null) return 0;
            if (numA === null) return 1;
            if (numB === null) return -1;

            return numA - numB;
        });
    }

    /**
     * Sort tasks by numeric index tag
     * @param {Array} tasks - Array of tasks with title property
     * @returns {Array} Sorted tasks
     */
    sortTasksByNumericTag(tasks) {
        if (!Array.isArray(tasks)) return [];

        return [...tasks].sort((a, b) => {
            const tagsA = this.extractNumericTag(a.title);
            const tagsB = this.extractNumericTag(b.title);

            // Use first numeric tag for sorting
            const numA = tagsA ? tagsA[0] : null;
            const numB = tagsB ? tagsB[0] : null;

            // Tasks without numeric tags go to the end
            if (numA === null && numB === null) return 0;
            if (numA === null) return 1;
            if (numB === null) return -1;

            return numA - numB;
        });
    }

    /**
     * Sort tags by priority/importance
     * @param {Array} tags - Tags to sort
     * @returns {Array} Sorted tags
     */
    sortTags(tags) {
        if (!Array.isArray(tags)) return [];

        const priority = {
            urgent: 0,
            high: 1,
            blocked: 2,
            todo: 3,
            doing: 4,
            medium: 5,
            waiting: 6,
            low: 7,
            done: 8
        };

        return tags.sort((a, b) => {
            const cleanA = a.replace(this.prefixStripRegex, '').toLowerCase();
            const cleanB = b.replace(this.prefixStripRegex, '').toLowerCase();

            const priorityA = priority[cleanA] ?? 999;
            const priorityB = priority[cleanB] ?? 999;

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            // Alphabetical for same priority
            return cleanA.localeCompare(cleanB);
        });
    }

    /**
     * Validate tag format
     * @param {string} tag - Tag to validate
     * @returns {boolean} True if valid
     */
    isValidTag(tag) {
        if (!tag || typeof tag !== 'string') return false;

        // Remove symbol if present
        const cleanTag = tag.replace(this.prefixStripRegex, '');

        // Check if empty after cleaning
        if (!cleanTag) return false;

        // Check valid characters (alphanumeric, underscore, hyphen)
        if (!/^[a-zA-Z0-9_-]+$/.test(cleanTag)) return false;

        // Check length (reasonable limits)
        if (cleanTag.length < 1 || cleanTag.length > 50) return false;

        return true;
    }

    /**
     * Get tag color configuration key
     * @param {string} tag - Tag to get color for
     * @returns {string} Configuration key for tag color
     */
    getTagColorKey(tag) {
        const cleanTag = tag.replace(this.prefixStripRegex, '');
        return `tag-${cleanTag}`;
    }

    /**
     * Remove tags from text for display based on visibility setting
     * @param {string} text - Text to process
     * @param {string} setting - Visibility setting ('all', 'standard', 'custom', 'mentions', 'none')
     * @returns {string} Text with tags removed per setting
     */
    removeTagsForDisplay(text, setting = 'standard') {
        if (!text) return text;

        switch (setting) {
            case 'all':
                // Show all tags - don't remove anything
                return text;
            case 'standard':
            case 'allexcludinglayout':
                // Remove layout tags only (#span, #row, #stack, #sticky)
                return text
                    .replace(this.patterns.rowTag, '')
                    .replace(this.patterns.spanTag, '')
                    .replace(this.patterns.stackTag, '')
                    .replace(this.patterns.stickyTag, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            case 'custom':
            case 'customonly':
                // Remove layout tags only (configured tag filtering happens in CSS)
                return text
                    .replace(this.patterns.rowTag, '')
                    .replace(this.patterns.spanTag, '')
                    .replace(this.patterns.stackTag, '')
                    .replace(this.patterns.stickyTag, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            case 'mentions':
            case 'mentionsonly':
                // Remove all # and ! tags, keep @ person tags
                return this.removeTagsFromText(text, {
                    removeHash: true,
                    removePerson: false,
                    removeTemporal: true,
                    keepLayout: false
                });
            case 'none':
                // Remove all tags
                return this.removeTagsFromText(text, {
                    removeHash: true,
                    removePerson: true,
                    removeTemporal: true,
                    keepLayout: false
                });
            default:
                // Default to standard behavior
                return this.removeTagsForDisplay(text, 'standard');
        }
    }

    /**
     * Filter tags from text for export based on export setting
     * @param {string} text - Text to filter
     * @param {string} setting - Export setting ('all', 'allexcludinglayout', 'customonly', 'mentionsonly', 'none')
     * @returns {string} Filtered text for export
     */
    filterTagsForExport(text, setting = 'allexcludinglayout') {
        if (!text) return text;

        switch (setting) {
            case 'all':
                // Export all tags - don't filter anything
                return text;
            case 'allexcludinglayout':
                // Export all except layout tags (#span, #row, #stack, #sticky)
                return text
                    .replace(this.patterns.rowTag, '')
                    .replace(this.patterns.spanTag, '')
                    .replace(this.patterns.stackTag, '')
                    .replace(this.patterns.stickyTag, '')
                    .trim();
            case 'customonly':
                // Export only custom tags and $ person tags (remove standard layout tags)
                return text
                    .replace(this.patterns.rowTag, '')
                    .replace(this.patterns.spanTag, '')
                    .replace(this.patterns.stackTag, '')
                    .replace(this.patterns.stickyTag, '')
                    .trim();
            case 'mentionsonly':
                // Export only $ person tags - remove all # and @ tags
                return this.removeTagsFromText(text, {
                    removeHash: true,
                    removePerson: false,
                    removeTemporal: true,
                    keepLayout: false
                });
            case 'none':
                // Export no tags - remove all tags
                return this.removeTagsFromText(text, {
                    removeHash: true,
                    removePerson: true,
                    removeTemporal: true,
                    keepLayout: false
                });
            default:
                // Default to allexcludinglayout behavior
                return this.filterTagsForExport(text, 'allexcludinglayout');
        }
    }

    /**
     * Get display title for a column, handling columninclude specially
     * @param {Object} column - Column object with title, includeMode, includeFiles, displayTitle
     * @param {Function} filterFn - Tag removal function (e.g., window.removeTagsForDisplay)
     * @returns {string} HTML string for display
     */
    getColumnDisplayTitle(column, filterFn) {
        if (column.includeMode && column.includeFiles && column.includeFiles.length > 0) {
            // For columninclude, show as inline badge "!(...path/filename.ext)!" format
            const fileName = column.includeFiles[0];
            const parts = fileName.split('/').length > 1 ? fileName.split('/') : fileName.split('\\');
            const baseFileName = parts[parts.length - 1];

            // Truncate filename if longer than 20 characters
            let displayFileName = baseFileName;
            if (baseFileName.length > 20) {
                const lastDotIndex = baseFileName.lastIndexOf('.');
                const ext = lastDotIndex !== -1 ? baseFileName.substring(lastDotIndex) : '';
                const nameWithoutExt = lastDotIndex !== -1 ? baseFileName.substring(0, lastDotIndex) : baseFileName;

                // Calculate max length for first part: 20 total - 3 (for ...) - ext.length
                const maxFirstChars = Math.max(1, 20 - 3 - ext.length);
                const truncated = nameWithoutExt.substring(0, maxFirstChars);
                displayFileName = `${truncated}...${ext}`;
            }

            // Get path (everything except filename), limit to 4 characters
            let pathPart = '';
            if (parts.length > 1) {
                const fullPath = parts.slice(0, -1).join('/');
                if (fullPath.length > 4) {
                    // Show last 4 characters with ... prefix
                    pathPart = '...' + fullPath.slice(-4);
                } else {
                    pathPart = fullPath;
                }
            }

            // Format: "!(...path/filename.ext)!" or "!(filename.ext)!" if no path
            const displayText = pathPart ? `!(${pathPart}/${displayFileName})!` : `!(${displayFileName})!`;

            const linkHtml = generateIncludeLinkWithMenu(fileName, displayText, 'column');

            const fileNameWithoutExt = baseFileName.replace(/\.[^/.]+$/, '');
            const additionalTitle = (column.displayTitle && column.displayTitle !== fileNameWithoutExt) ? column.displayTitle : '';

            if (additionalTitle) {
                // Backend has already inserted %INCLUDE_BADGE:filepath% placeholder in displayTitle
                // We just need to replace it with the badge HTML

                // Render markdown first (with the placeholder still in place)
                const renderFn = window.renderMarkdown || (typeof renderMarkdown !== 'undefined' ? renderMarkdown : null);
                const renderedTitle = renderFn ? renderFn(additionalTitle) : additionalTitle;

                // Replace ALL %INCLUDE_BADGE:filepath% placeholders with badge HTML using regex
                // This handles cases where backend path != frontend path (e.g., ../relative/paths)
                const placeholderRegex = /%INCLUDE_BADGE:([^%]+)%/g;
                const result = renderedTitle.replace(placeholderRegex, (match, filePath) => {
                    // Generate badge for this file path (may be different from fileName if path normalized)
                    const parts = filePath.split('/').length > 1 ? filePath.split('/') : filePath.split('\\');
                    const baseFileName = parts[parts.length - 1];

                    // Truncate filename if longer than 20 characters
                    let displayFileName = baseFileName;
                    if (baseFileName.length > 20) {
                        const lastDotIndex = baseFileName.lastIndexOf('.');
                        const ext = lastDotIndex !== -1 ? baseFileName.substring(lastDotIndex) : '';
                        const nameWithoutExt = lastDotIndex !== -1 ? baseFileName.substring(0, lastDotIndex) : baseFileName;

                        // Calculate max length for first part: 20 total - 3 (for ...) - ext.length
                        const maxFirstChars = Math.max(1, 20 - 3 - ext.length);
                        const truncated = nameWithoutExt.substring(0, maxFirstChars);
                        displayFileName = `${truncated}...${ext}`;
                    }

                    // Get path (everything except filename), limit to 4 characters
                    let pathPart = '';
                    if (parts.length > 1) {
                        const fullPath = parts.slice(0, -1).join('/');
                        if (fullPath.length > 4) {
                            pathPart = '...' + fullPath.slice(-4);
                        } else {
                            pathPart = fullPath;
                        }
                    }

                    const displayText = pathPart ? `!(${pathPart}/${displayFileName})!` : `!(${displayFileName})!`;

                    return generateIncludeLinkWithMenu(filePath, displayText, 'column');
                });

                return result;
            } else {
                return linkHtml;
            }
        } else {
            // Normal column - filter tags and render
            const displayTitle = filterFn ? filterFn(column.title) : column.title;
            const renderFn = window.renderMarkdown || (typeof renderMarkdown !== 'undefined' ? renderMarkdown : null);
            return renderFn ? renderFn(displayTitle) : displayTitle;
        }
    }

    /**
     * Get display title for a task, handling taskinclude specially to make filepaths clickable
     * Uses same format as column includes: "!(...path/filename.ext)!"
     * @param {Object} task - Task object with displayTitle, includeMode, includeFiles
     * @returns {string} HTML string for display
     */
    getTaskDisplayTitle(task) {
        // Debug: log task include properties
        if (task.includeFiles || task.includeMode) {
            console.log(`[getTaskDisplayTitle] Task "${task.id}": includeMode=${task.includeMode}, includeFiles=${JSON.stringify(task.includeFiles)}, title="${task.title?.substring(0, 50)}"`);
        }
        if (task.includeMode && task.includeFiles && task.includeFiles.length > 0) {
            console.log(`[getTaskDisplayTitle] Task "${task.id}" meets all conditions - generating menu`);
            // For taskinclude, show as inline badge "!(...path/filename.ext)!" format - same as column includes
            const fileName = task.includeFiles[0];
            const parts = fileName.split('/').length > 1 ? fileName.split('/') : fileName.split('\\');
            const baseFileName = parts[parts.length - 1];

            // Truncate filename if longer than 20 characters
            let displayFileName = baseFileName;
            if (baseFileName.length > 20) {
                const lastDotIndex = baseFileName.lastIndexOf('.');
                const ext = lastDotIndex !== -1 ? baseFileName.substring(lastDotIndex) : '';
                const nameWithoutExt = lastDotIndex !== -1 ? baseFileName.substring(0, lastDotIndex) : baseFileName;

                // Calculate max length for first part: 20 total - 3 (for ...) - ext.length
                const maxFirstChars = Math.max(1, 20 - 3 - ext.length);
                const truncated = nameWithoutExt.substring(0, maxFirstChars);
                displayFileName = `${truncated}...${ext}`;
            }

            // Get path (everything except filename), limit to 4 characters
            let pathPart = '';
            if (parts.length > 1) {
                const fullPath = parts.slice(0, -1).join('/');
                if (fullPath.length > 4) {
                    // Show last 4 characters with ... prefix
                    pathPart = '...' + fullPath.slice(-4);
                } else {
                    pathPart = fullPath;
                }
            }

            // Format: "!(...path/filename.ext)!" or "!(filename.ext)!" if no path
            const displayText = pathPart ? `!(${pathPart}/${displayFileName})!` : `!(${displayFileName})!`;

            // Just return the include link - displayTitle is not shown because it's the file content, not metadata
            return generateIncludeLinkWithMenu(fileName, displayText, 'task');
        } else {
            // Normal task - render displayTitle which may contain %INCLUDE_BADGE:filepath% placeholder
            const displayTitle = task.displayTitle || (task.title ? (window.removeTagsForDisplay ? window.removeTagsForDisplay(task.title) : task.title) : '');

            // Render markdown first (placeholder will be preserved in the output)
            const renderFn = window.renderMarkdown || (typeof renderMarkdown !== 'undefined' ? renderMarkdown : null);
            let rendered = renderFn ? renderFn(displayTitle) : displayTitle;

            // Replace any %INCLUDE_BADGE:filepath% placeholders with badge HTML
            // This handles cases where tasks have includes with additional text
            const placeholderRegex = /%INCLUDE_BADGE:([^%]+)%/g;
            rendered = rendered.replace(placeholderRegex, (match, filePath) => {
                // Generate badge for this file path
                const parts = filePath.split('/').length > 1 ? filePath.split('/') : filePath.split('\\');
                const baseFileName = parts[parts.length - 1];

                let displayFileName = baseFileName;
                if (baseFileName.length > 12) {
                    const lastDotIndex = baseFileName.lastIndexOf('.');
                    const ext = lastDotIndex !== -1 ? baseFileName.substring(lastDotIndex) : '';
                    const nameWithoutExt = lastDotIndex !== -1 ? baseFileName.substring(0, lastDotIndex) : baseFileName;
                    const first12 = nameWithoutExt.substring(0, 12);
                    const last4 = nameWithoutExt.length > 16 ? nameWithoutExt.substring(nameWithoutExt.length - 4) : '';
                    displayFileName = last4 ? `${first12}...${last4}${ext}` : `${first12}${ext}`;
                }

                let pathPart = '';
                if (parts.length > 1) {
                    const fullPath = parts.slice(0, -1).join('/');
                    if (fullPath.length > 4) {
                        pathPart = '...' + fullPath.slice(-4);
                    } else {
                        pathPart = fullPath;
                    }
                }

                const displayText = pathPart ? `!(${pathPart}/${displayFileName})!` : `!(${displayFileName})!`;

                return generateIncludeLinkWithMenu(filePath, displayText, 'task');
            });

            return rendered;
        }
    }
}

/**
 * Generate include link HTML with path conversion overlay menu
 * @param {string} filePath - The file path for the include
 * @param {string} displayText - The text to display in the link
 * @param {string} clickHandler - 'column' or 'task' to determine which click handler to use
 * @returns {string} HTML string with include link wrapped in overlay container
 */
function generateIncludeLinkWithMenu(filePath, displayText, clickHandler) {
    const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    const handlerFn = clickHandler === 'task' ? 'handleTaskIncludeClick' : 'handleColumnIncludeClick';

    // Determine if path is absolute (Unix: starts with /, Windows: starts with drive letter like C:\)
    const isAbsolutePath = filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);

    // Disable "Convert to Relative" if already relative, disable "Convert to Absolute" if already absolute
    // isColumnTitle is set based on clickHandler type
    const isColumnTitle = clickHandler === 'column' ? 'true' : 'false';

    return `<span class="include-path-overlay-container" data-include-path="${escapeHtml(filePath)}" data-include-type="${clickHandler}">
        <span class="columninclude-link" data-file-path="${escapeHtml(filePath)}" onclick="${handlerFn}(event, '${escapeHtml(filePath)}')" title="Alt+click to open file: ${escapeHtml(filePath)}">${escapeHtml(displayText)}</span>
        <button class="include-menu-btn" onclick="event.stopPropagation(); toggleIncludePathMenu(this.parentElement, '${escapedPath}')" title="Path options">☰</button>
        <div class="include-path-menu">
            <button class="include-path-menu-item" onclick="event.stopPropagation(); openPath('${escapedPath}')">📄 Open</button>
            <button class="include-path-menu-item" onclick="event.stopPropagation(); revealPathInExplorer('${escapedPath}')">🔍 Reveal in File Explorer</button>
            <button class="include-path-menu-item" onclick="event.stopPropagation(); searchForIncludeFile(this, '${escapedPath}', '${isColumnTitle}')">🔎 Search for File</button>
            <div class="include-path-menu-divider"></div>
            <button class="include-path-menu-item${isAbsolutePath ? '' : ' disabled'}" ${isAbsolutePath ? `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'relative', true)"` : 'disabled'}>📁 Convert to Relative</button>
            <button class="include-path-menu-item${isAbsolutePath ? ' disabled' : ''}" ${isAbsolutePath ? 'disabled' : `onclick="event.stopPropagation(); convertSinglePath('${escapedPath}', 'absolute', true)"`}>📂 Convert to Absolute</button>
            <div class="include-path-menu-divider"></div>
            <button class="include-path-menu-item" onclick="event.stopPropagation(); deleteFromMarkdown('${escapedPath}')">🗑️ Delete</button>
        </div>
    </span>`;
}

// Create singleton instance
const tagUtils = new TagUtils();

// Global window exposure
if (typeof window !== 'undefined') {
    window.tagUtils = tagUtils;

    // Expose tag prefixes for external use
    window.TAG_PREFIXES = TAG_PREFIXES;

    // Backward compatibility functions
    window.extractFirstTag = (text) => tagUtils.extractFirstTag(text);
    window.extractAllTags = (text) => tagUtils.extractTags(text, { includeHash: false });

    // Temporal tag functions
    window.isCurrentDate = (text) => tagUtils.isCurrentDate(text);
    window.isCurrentWeek = (text) => tagUtils.isCurrentWeek(text);
    window.isCurrentWeekday = (text) => tagUtils.isCurrentWeekday(text);
    window.isCurrentTime = (text) => tagUtils.isCurrentTime(text);
    window.isCurrentTimeSlot = (text) => tagUtils.isCurrentTimeSlot(text);
    window.isCurrentMinuteSlot = (text, parentTimeSlot) => tagUtils.isCurrentMinuteSlot(text, parentTimeSlot);
    window.hasMinuteSlotTag = (text) => tagUtils.hasMinuteSlotTag(text);
    window.extractTimeSlotTag = (text) => tagUtils.extractTimeSlotTag(text);
    window.extractMinuteSlotTag = (text) => tagUtils.extractMinuteSlotTag(text);
    window.isTemporallyActive = (text) => tagUtils.isTemporallyActive(text);
    window.getActiveTemporalAttributes = (colTitle, taskTitle, taskContent) =>
        tagUtils.getActiveTemporalAttributes(colTitle, taskTitle, taskContent);
}