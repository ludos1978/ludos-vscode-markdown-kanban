/**
 * Centralized Tag Pattern Definitions
 *
 * SINGLE SOURCE OF TRUTH for all Kanban layout tag patterns.
 * Import from here instead of defining local regex patterns.
 *
 * Note: These are factory functions that return NEW RegExp instances.
 * This is necessary because regex objects with the 'g' flag maintain state
 * (lastIndex), and sharing a single instance across multiple uses would
 * cause bugs. Always call the function to get a fresh regex.
 *
 * @module constants/TagPatterns
 */

// =============================================================================
// TAG NAMES (without hash)
// =============================================================================

/** Row tag prefix */
export const ROW_TAG = 'row';

/** Span tag prefix */
export const SPAN_TAG = 'span';

/** Stack tag */
export const STACK_TAG = 'stack';

/** Sticky tag */
export const STICKY_TAG = 'sticky';

/** All layout tags (for filtering) */
export const LAYOUT_TAGS = [ROW_TAG, SPAN_TAG, STACK_TAG, STICKY_TAG] as const;

// =============================================================================
// REGEX PATTERN FACTORIES
// =============================================================================

/**
 * Match #rowN where N is a number (case insensitive)
 * Example: #row2, #Row3, #ROW1
 */
export const rowTagPattern = () => /#row(\d+)\b/gi;

/**
 * Match #rowN for extraction (case insensitive, non-global for single match)
 */
export const rowTagPatternSingle = () => /#row(\d+)\b/i;

/**
 * Match #spanN where N is a number (case insensitive)
 * Example: #span2, #Span3
 */
export const spanTagPattern = () => /#span(\d+)\b/gi;

/**
 * Match #spanN for extraction (case insensitive, non-global for single match)
 */
export const spanTagPatternSingle = () => /#span(\d+)\b/i;

/**
 * Match #stack tag (case insensitive)
 */
export const stackTagPattern = () => /#stack\b/gi;

/**
 * Match #stack tag for testing (case insensitive, non-global)
 */
export const stackTagPatternSingle = () => /#stack\b/i;

/**
 * Match #sticky tag (case insensitive)
 */
export const stickyTagPattern = () => /#sticky\b/gi;

/**
 * Match #sticky tag for testing (case insensitive, non-global)
 */
export const stickyTagPatternSingle = () => /#sticky\b/i;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract row number from text (default: 1 if no tag found)
 */
export function extractRowNumber(text: string): number {
    const match = text.match(rowTagPatternSingle());
    if (match) {
        const num = parseInt(match[1], 10);
        return num > 0 ? num : 1;
    }
    return 1;
}

/**
 * Extract span value from text (default: 1 if no tag found)
 */
export function extractSpanValue(text: string): number {
    const match = text.match(spanTagPatternSingle());
    if (match) {
        return parseInt(match[1], 10);
    }
    return 1;
}

/**
 * Check if text has #stack tag
 */
export function hasStackTag(text: string): boolean {
    return stackTagPatternSingle().test(text);
}

/**
 * Check if text has #sticky tag
 */
export function hasStickyTag(text: string): boolean {
    return stickyTagPatternSingle().test(text);
}

/**
 * Remove #row tag from text
 */
export function removeRowTag(text: string): string {
    return text
        .replace(rowTagPattern(), '')
        .replace(/\s+#row\d+/gi, '')
        .replace(/#row\d+\s+/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Remove #span tag from text
 */
export function removeSpanTag(text: string): string {
    return text
        .replace(spanTagPattern(), '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Remove #stack tag from text
 */
export function removeStackTag(text: string): string {
    return text
        .replace(stackTagPattern(), '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Remove #sticky tag from text
 */
export function removeStickyTag(text: string): string {
    return text
        .replace(stickyTagPattern(), '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Remove all layout tags from text (#row, #span, #stack, #sticky)
 */
export function removeAllLayoutTags(text: string): string {
    return text
        .replace(rowTagPattern(), '')
        .replace(spanTagPattern(), '')
        .replace(stackTagPattern(), '')
        .replace(stickyTagPattern(), '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Add #row tag to text (replaces existing if present)
 */
export function setRowTag(text: string, rowNumber: number): string {
    const cleanText = removeRowTag(text);
    if (rowNumber > 1) {
        return cleanText ? `${cleanText} #row${rowNumber}` : `#row${rowNumber}`;
    }
    return cleanText;
}

/**
 * Add #span tag to text (replaces existing if present)
 */
export function setSpanTag(text: string, spanValue: number): string {
    const cleanText = removeSpanTag(text);
    if (spanValue > 1) {
        return cleanText ? `${cleanText} #span${spanValue}` : `#span${spanValue}`;
    }
    return cleanText;
}

/**
 * Add #stack tag to text if not present
 */
export function addStackTag(text: string): string {
    if (hasStackTag(text)) {
        return text;
    }
    const trimmed = text.trim();
    return trimmed ? `${trimmed} #stack` : '#stack';
}

/**
 * Add #sticky tag to text if not present
 */
export function addStickyTag(text: string): string {
    if (hasStickyTag(text)) {
        return text;
    }
    const trimmed = text.trim();
    return trimmed ? `${trimmed} #sticky` : '#sticky';
}

/**
 * Toggle #stack tag on text
 */
export function toggleStackTag(text: string): string {
    if (hasStackTag(text)) {
        return removeStackTag(text);
    }
    return addStackTag(text);
}

/**
 * Toggle #sticky tag on text
 */
export function toggleStickyTag(text: string): string {
    if (hasStickyTag(text)) {
        return removeStickyTag(text);
    }
    return addStickyTag(text);
}
