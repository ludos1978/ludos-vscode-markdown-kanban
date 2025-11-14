/**
 * Tag Processing Utility Module
 * Centralizes all tag extraction, parsing, and processing functionality
 */

class TagUtils {
    constructor() {
        // Centralized regex patterns for tag matching
        this.patterns = {
            // Basic tag patterns
            // Must start with alphanumeric or underscore to exclude pure symbol tags like ++, --, etc.
            basicTags: /#([a-zA-Z0-9_][a-zA-Z0-9_-]*)/g,
            atTags: /@([a-zA-Z0-9_&-]+)/g,

            // Special positivity tags (#++, #+, #ø, #-, #--)
            // Use negative lookahead to ensure - doesn't match when it's part of --
            positivityTags: /#(\+\+|--|\+|ø|Ø|-(?!-))/g,

            // Numeric index tags (#1, #13, #013, #1.1, #0.1, #0.13, #0.01)
            numericTag: /#(\d+(?:\.\d+)?)\b/g,

            // Layout-specific tags
            rowTag: /#row(\d+)\b/gi,
            spanTag: /#span(\d+)\b/gi,
            stackTag: /#stack\b/gi,
            stickyTag: /#sticky\b/gi,
            includeTag: /#include:([^\s]+)/i,

            // Special gather tags
            gatherTags: /#(gather_[a-zA-Z0-9_&|=><!\-]+|ungathered)/g,

            // Date patterns
            dateTags: /@(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})(?:\s|$)/,

            // Week date patterns (@2001-W1, @2001W1, @W1, @W01)
            weekTags: /(?:@(\d{4})-?W(\d{1,2})|@W(\d{1,2}))\b/gi,

            // Priority/state tags
            priorityTag: /#(high|medium|low|urgent)\b/i,
            stateTag: /#(todo|doing|done|blocked|waiting)\b/i,

            // Card/column state tags
            foldTag: /#fold\b/i,
            archiveTag: /#archive\b/i,
            hiddenTag: /#hidden\b/i
        };

        // Layout tags that should not be displayed
        this.layoutTags = ['row', 'span', 'stack', 'sticky', 'fold', 'archive', 'hidden', 'include'];

        // Tags that should be excluded from menus
        this.excludedTags = ['gather_', 'ungathered', 'fold', 'archive', 'hidden'];
    }

    /**
     * Extract all tags from text
     * @param {string} text - Text to extract tags from
     * @param {Object} options - Extraction options
     * @returns {Array} Array of extracted tags
     */
    extractTags(text, options = {}) {
        const {
            includeHash = false,
            includeAt = false,
            excludeLayout = true,
            unique = true
        } = options;

        if (!text || typeof text !== 'string') {
            return [];
        }

        const tags = [];

        // Extract hash tags
        if (includeHash !== false) {
            const hashMatches = text.matchAll(this.patterns.basicTags);
            for (const match of hashMatches) {
                const tag = includeHash === 'withSymbol' ? `#${match[1]}` : match[1];
                tags.push(tag);
            }

            // Extract special positivity tags
            const positivityMatches = text.matchAll(this.patterns.positivityTags);
            for (const match of positivityMatches) {
                const tag = includeHash === 'withSymbol' ? `#${match[1]}` : match[1];
                tags.push(tag);
            }
        }

        // Extract @ tags
        if (includeAt) {
            const atMatches = text.matchAll(this.patterns.atTags);
            for (const match of atMatches) {
                const tag = includeAt === 'withSymbol' ? `@${match[1]}` : match[1];
                tags.push(tag);
            }
        }

        // Filter out layout tags if requested
        let filteredTags = tags;
        if (excludeLayout) {
            filteredTags = tags.filter(tag => {
                const cleanTag = tag.replace(/^[#@]/, '').toLowerCase();
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

            // Skip gather tags for styling
            if (base.startsWith('gather_')) continue;

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

        // Use a non-global version of the pattern to get capture groups
        const match = text.match(/#(\d+(?:\.\d+)?)\b/);
        if (match && match[1]) {
            return parseFloat(match[1]);
        }
        return null;
    }

    /**
     * Extract week date tag from text
     * @param {string} text - Text to extract week tag from
     * @returns {Object|null} Object with {year, week} or null if not found
     */
    extractWeekTag(text) {
        if (!text) return null;

        // Reset regex lastIndex to ensure consistent matching
        this.patterns.weekTags.lastIndex = 0;
        const match = this.patterns.weekTags.exec(text);

        if (!match) return null;

        // Format: @2001-W1 or @2001W1 (groups 1 and 2)
        if (match[1] && match[2]) {
            return {
                year: parseInt(match[1], 10),
                week: parseInt(match[2], 10)
            };
        }

        // Format: @W1 (group 3) - use current year
        if (match[3]) {
            const currentYear = new Date().getFullYear();
            return {
                year: currentYear,
                week: parseInt(match[3], 10)
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

        const cleanTag = tag.replace(/^[#@]/, '').toLowerCase();

        // Check static layout tags
        if (this.layoutTags.includes(cleanTag)) {
            return true;
        }

        // Check pattern-based layout tags
        if (this.patterns.rowTag.test(`#${cleanTag}`)) return true;
        if (this.patterns.spanTag.test(`#${cleanTag}`)) return true;
        if (this.patterns.stackTag.test(`#${cleanTag}`)) return true;
        if (this.patterns.includeTag.test(`#${cleanTag}`)) return true;

        return false;
    }

    /**
     * Check if a tag is a gather tag
     * @param {string} tag - Tag to check
     * @returns {boolean} True if gather tag
     */
    isGatherTag(tag) {
        if (!tag) return false;
        const cleanTag = tag.replace(/^[#@]/, '');
        return cleanTag.startsWith('gather_') || cleanTag === 'ungathered';
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
            const cleanTag = tag.replace(/^[#@]/, '').toLowerCase();

            // Skip layout tags
            if (this.isLayoutTag(cleanTag)) return false;

            // Skip gather tags
            if (this.isGatherTag(cleanTag)) return false;

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
        const groups = {
            priority: [],
            state: [],
            date: [],
            person: [],
            layout: [],
            gather: [],
            regular: []
        };

        tags.forEach(tag => {
            const cleanTag = tag.replace(/^[#@]/, '');

            if (this.patterns.priorityTag.test(`#${cleanTag}`)) {
                groups.priority.push(tag);
            } else if (this.patterns.stateTag.test(`#${cleanTag}`)) {
                groups.state.push(tag);
            } else if (this.patterns.dateTags.test(`@${cleanTag}`)) {
                groups.date.push(tag);
            } else if (tag.startsWith('@')) {
                groups.person.push(tag);
            } else if (this.isLayoutTag(cleanTag)) {
                groups.layout.push(tag);
            } else if (this.isGatherTag(cleanTag)) {
                groups.gather.push(tag);
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
                includeAt: true,
                excludeLayout: false
            });
        }

        if (!Array.isArray(tagArray)) return '';

        return tagArray
            .map(tag => {
                const cleanTag = tag.replace(/^[#@]/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
                return `tag-${cleanTag}`;
            })
            .join(' ');
    }

    /**
     * Parse gather tag conditions
     * @param {string} gatherTag - Gather tag to parse
     * @returns {Object} Parsed conditions
     */
    parseGatherConditions(gatherTag) {
        if (!gatherTag || !gatherTag.startsWith('gather_')) {
            return null;
        }

        const conditionString = gatherTag.substring(7); // Remove 'gather_'
        const conditions = {
            include: [],
            exclude: [],
            operator: 'AND'
        };

        // Parse OR conditions
        if (conditionString.includes('|')) {
            conditions.operator = 'OR';
            conditions.include = conditionString.split('|').map(t => t.trim());
        }
        // Parse AND conditions
        else if (conditionString.includes('&')) {
            conditions.operator = 'AND';
            conditions.include = conditionString.split('&').map(t => t.trim());
        }
        // Parse NOT conditions
        else if (conditionString.includes('!')) {
            const parts = conditionString.split('!');
            conditions.include = parts[0] ? [parts[0].trim()] : [];
            conditions.exclude = parts.slice(1).map(t => t.trim());
        }
        // Single condition
        else {
            conditions.include = [conditionString.trim()];
        }

        return conditions;
    }

    /**
     * Clean tags from text (remove all tag patterns)
     * @param {string} text - Text to clean
     * @param {Object} options - Cleaning options
     * @returns {string} Cleaned text
     */
    removeTagsFromText(text, options = {}) {
        const {
            removeHash = true,
            removeAt = false,
            keepLayout = false
        } = options;

        if (!text) return '';

        let cleanedText = text;

        // Remove hash tags
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

        // Remove @ tags
        if (removeAt) {
            cleanedText = cleanedText.replace(this.patterns.atTags, '');
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
            const numA = this.extractNumericTag(a.title);
            const numB = this.extractNumericTag(b.title);

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
            const numA = this.extractNumericTag(a.title);
            const numB = this.extractNumericTag(b.title);

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
            const cleanA = a.replace(/^[#@]/, '').toLowerCase();
            const cleanB = b.replace(/^[#@]/, '').toLowerCase();

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
        const cleanTag = tag.replace(/^[#@]/, '');

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
        const cleanTag = tag.replace(/^[#@]/, '');
        return `tag-${cleanTag}`;
    }

    /**
     * Filter tags from text based on visibility setting
     * @param {string} text - Text to filter
     * @param {string} setting - Visibility setting ('all', 'standard', 'custom', 'mentions', 'none')
     * @returns {string} Filtered text
     */
    filterTagsFromText(text, setting = 'standard') {
        if (!text) return text;

        switch (setting) {
            case 'all':
                // Show all tags - don't filter anything
                return text;
            case 'standard':
            case 'allexcludinglayout':
                // Hide layout tags only (#span, #row, #stack, #sticky) - direct replacement
                return text
                    .replace(this.patterns.rowTag, '')
                    .replace(this.patterns.spanTag, '')
                    .replace(this.patterns.stackTag, '')
                    .replace(this.patterns.stickyTag, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            case 'custom':
            case 'customonly':
                // Hide layout tags only (configured tag filtering happens in CSS) - direct replacement
                return text
                    .replace(this.patterns.rowTag, '')
                    .replace(this.patterns.spanTag, '')
                    .replace(this.patterns.stackTag, '')
                    .replace(this.patterns.stickyTag, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            case 'mentions':
            case 'mentionsonly':
                // Hide all # tags, keep @ tags
                return this.removeTagsFromText(text, {
                    removeHash: true,
                    removeAt: false,
                    keepLayout: false
                });
            case 'none':
                // Hide all tags
                return this.removeTagsFromText(text, {
                    removeHash: true,
                    removeAt: true,
                    keepLayout: false
                });
            default:
                // Default to standard behavior
                return this.filterTagsFromText(text, 'standard');
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
                // Export only custom tags and @ tags (remove standard layout tags)
                return text
                    .replace(this.patterns.rowTag, '')
                    .replace(this.patterns.spanTag, '')
                    .replace(this.patterns.stackTag, '')
                    .replace(this.patterns.stickyTag, '')
                    .trim();
            case 'mentionsonly':
                // Export only @ tags - remove all # tags
                return this.removeTagsFromText(text, {
                    removeHash: true,
                    removeAt: false,
                    keepLayout: false
                });
            case 'none':
                // Export no tags - remove all tags
                return this.removeTagsFromText(text, {
                    removeHash: true,
                    removeAt: true,
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
     * @param {Function} filterFn - Tag filtering function (e.g., window.filterTagsFromText)
     * @returns {string} HTML string for display
     */
    getColumnDisplayTitle(column, filterFn) {
        if (column.includeMode && column.includeFiles && column.includeFiles.length > 0) {
            // For columninclude, show as inline badge "!(...path/filename.ext)!" format
            const fileName = column.includeFiles[0];
            const parts = fileName.split('/').length > 1 ? fileName.split('/') : fileName.split('\\');
            const baseFileName = parts[parts.length - 1];

            // Truncate filename if longer than 12 characters
            let displayFileName = baseFileName;
            if (baseFileName.length > 12) {
                // Extract extension
                const lastDotIndex = baseFileName.lastIndexOf('.');
                const ext = lastDotIndex !== -1 ? baseFileName.substring(lastDotIndex) : '';
                const nameWithoutExt = lastDotIndex !== -1 ? baseFileName.substring(0, lastDotIndex) : baseFileName;

                // Create truncated version: first 12 chars...last 4 chars before extension
                const first12 = nameWithoutExt.substring(0, 12);
                const last4 = nameWithoutExt.length > 16 ? nameWithoutExt.substring(nameWithoutExt.length - 4) : '';
                displayFileName = last4 ? `${first12}...${last4}${ext}` : `${first12}${ext}`;
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

            const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
            const linkHtml = `<span class="columninclude-link" data-file-path="${escapeHtml(fileName)}" onclick="handleColumnIncludeClick(event, '${escapeHtml(fileName)}')" title="Alt+click to open file: ${escapeHtml(fileName)}">${escapeHtml(displayText)}</span>`;

            const fileNameWithoutExt = baseFileName.replace(/\.[^/.]+$/, '');
            const additionalTitle = (column.displayTitle && column.displayTitle !== fileNameWithoutExt) ? column.displayTitle : '';

            if (additionalTitle) {
                // Backend has already inserted %INCLUDE_BADGE:filepath% placeholder in displayTitle
                // We just need to replace it with the badge HTML

                // Render markdown first (with the placeholder still in place)
                const renderFn = window.renderMarkdown || (typeof renderMarkdown !== 'undefined' ? renderMarkdown : null);
                const renderedTitle = renderFn ? renderFn(additionalTitle) : additionalTitle;

                // Replace the backend-inserted placeholder with our badge HTML
                // The placeholder format is: %INCLUDE_BADGE:filepath%
                const placeholder = `%INCLUDE_BADGE:${fileName}%`;
                const result = renderedTitle.replace(placeholder, linkHtml);
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
        if (task.includeMode && task.includeFiles && task.includeFiles.length > 0) {
            // For taskinclude, show as inline badge "!(...path/filename.ext)!" format - same as column includes
            const fileName = task.includeFiles[0];
            const parts = fileName.split('/').length > 1 ? fileName.split('/') : fileName.split('\\');
            const baseFileName = parts[parts.length - 1];

            // Truncate filename if longer than 12 characters
            let displayFileName = baseFileName;
            if (baseFileName.length > 12) {
                // Extract extension
                const lastDotIndex = baseFileName.lastIndexOf('.');
                const ext = lastDotIndex !== -1 ? baseFileName.substring(lastDotIndex) : '';
                const nameWithoutExt = lastDotIndex !== -1 ? baseFileName.substring(0, lastDotIndex) : baseFileName;

                // Create truncated version: first 12 chars...last 4 chars before extension
                const first12 = nameWithoutExt.substring(0, 12);
                const last4 = nameWithoutExt.length > 16 ? nameWithoutExt.substring(nameWithoutExt.length - 4) : '';
                displayFileName = last4 ? `${first12}...${last4}${ext}` : `${first12}${ext}`;
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

            const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

            // Just return the include link - displayTitle is not shown because it's the file content, not metadata
            return `<span class="columninclude-link" data-file-path="${escapeHtml(fileName)}" onclick="handleTaskIncludeClick(event, '${escapeHtml(fileName)}')" title="Alt+click to open file: ${escapeHtml(fileName)}">${escapeHtml(displayText)}</span>`;
        } else {
            // Normal task - render displayTitle which may contain %INCLUDE_BADGE:filepath% placeholder
            const displayTitle = task.displayTitle || (task.title ? (window.filterTagsFromText ? window.filterTagsFromText(task.title) : task.title) : '');

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
                const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

                return `<span class="columninclude-link" data-file-path="${escapeHtml(filePath)}" onclick="handleTaskIncludeClick(event, '${escapeHtml(filePath)}')" title="Alt+click to open file: ${escapeHtml(filePath)}">${escapeHtml(displayText)}</span>`;
            });

            return rendered;
        }
    }
}

// Create singleton instance
const tagUtils = new TagUtils();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = tagUtils;
}

// Global window exposure
if (typeof window !== 'undefined') {
    window.tagUtils = tagUtils;

    // Backward compatibility functions
    window.extractFirstTag = (text) => tagUtils.extractFirstTag(text);
    window.extractAllTags = (text) => tagUtils.extractTags(text, { includeHash: false });
}