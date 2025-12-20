/**
 * Date and time utilities for Kanban board operations
 * Handles date extraction, comparison, and property calculations
 */

/**
 * Extract a date from text in various formats
 * @param text - Text to search for dates
 * @param dateType - Type of date to extract ('due' for shorthand format)
 * @returns Date string in YYYY-MM-DD format, or null if not found
 */
export function extractDate(text: string, dateType: string = 'due'): string | null {
    if (!text) { return null; }

    // Match shorthand format @YYYY-MM-DD or @DD-MM-YYYY (assumes it's a due date)
    if (dateType === 'due') {
        const shortMatch = text.match(/@(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})(?:\s|$)/);
        if (shortMatch) {
            const dateStr = shortMatch[1];
            // Convert DD-MM-YYYY to YYYY-MM-DD for comparison
            if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
                const parts = dateStr.split('-');
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            return dateStr;
        }
    }

    // Match typed format @type:date (e.g., @due:2025-03-27, @done:2025-03-27)
    const typedRegex = new RegExp(`@${dateType}:(\\d{4}-\\d{2}-\\d{2}|\\d{2}-\\d{2}-\\d{4})(?:\\s|$)`);
    const typedMatch = text.match(typedRegex);
    if (typedMatch) {
        const dateStr = typedMatch[1];
        // Convert DD-MM-YYYY to YYYY-MM-DD for comparison
        if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
            const parts = dateStr.split('-');
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        return dateStr;
    }

    return null;
}

/**
 * Check if text contains a #sticky tag
 */
export function hasSticky(text: string): boolean {
    if (!text) { return false; }
    return /#sticky(?:\s|$)/.test(text);
}

/**
 * Extract person names from text (@ prefix, everything until whitespace)
 */
export function extractPersonNames(text: string): string[] {
    if (!text) { return []; }
    const matches = text.match(/@([^\s]+)/g) || [];
    return matches.map(m => m.substring(1));
}

/**
 * Get a specific property value from a date
 * @param property - The property to extract (day, weekday, month, etc.)
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns The property value (number or string), or null if invalid
 */
export function getDatePropertyValue(property: string, dateStr: string | null): number | string | null {
    if (!dateStr) { return null; }

    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);

    switch (property) {
        case 'dayoffset':
        case 'day':
            // Calculate days difference from today (can be negative for past dates)
            const diffTime = date.getTime() - today.getTime();
            return Math.round(diffTime / (1000 * 60 * 60 * 24));

        case 'weekday':
            // Return day name (sun, mon, tue, wed, etc.)
            const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            return days[date.getDay()];

        case 'weekdaynum':
            // Return 1-7 where Monday = 1, Sunday = 7
            const dayNum = date.getDay(); // 0 = Sunday
            return dayNum === 0 ? 7 : dayNum;

        case 'month':
            // Return month name (jan, feb, mar, etc.)
            const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            return months[date.getMonth()];

        case 'monthnum':
            // Return month number 1-12
            return date.getMonth() + 1;

        case 'week':
        case 'weeknum': {
            // Return ISO week number (1-53)
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            // Set to Thursday of current week to get correct ISO week number
            d.setDate(d.getDate() + 4 - (d.getDay() || 7));
            const yearStart = new Date(d.getFullYear(), 0, 1);
            const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
            return weekNo;
        }

        default:
            return null;
    }
}
