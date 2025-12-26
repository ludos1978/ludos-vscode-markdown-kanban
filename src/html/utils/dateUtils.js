/**
 * Date/Timestamp Utilities for Webview
 *
 * Provides consistent timestamp formatting across the webview.
 * Mirror of src/constants/FileNaming.ts timestamp functions.
 */

/**
 * Extract date/time components from a Date object (local time)
 */
function getDateComponents(date = new Date()) {
    return {
        year: date.getFullYear(),
        month: String(date.getMonth() + 1).padStart(2, '0'),
        day: String(date.getDate()).padStart(2, '0'),
        hours: String(date.getHours()).padStart(2, '0'),
        minutes: String(date.getMinutes()).padStart(2, '0'),
        seconds: String(date.getSeconds()).padStart(2, '0')
    };
}

/**
 * Generate a compact timestamp for backup/conflict files
 * Format: YYYYMMDDTHHmmss (e.g., 20231215T143022)
 */
function generateTimestamp(date = new Date()) {
    const { year, month, day, hours, minutes, seconds } = getDateComponents(date);
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Generate a timestamp for export folders (without seconds)
 * Format: YYYYMMDD-HHmm (e.g., 20231215-1430)
 */
function generateTimestampExport(date = new Date()) {
    const { year, month, day, hours, minutes } = getDateComponents(date);
    return `${year}${month}${day}-${hours}${minutes}`;
}

/**
 * Generate a filename-safe ISO-like timestamp
 * Format: YYYY-MM-DDTHH-mm-ss (e.g., 2023-12-15T14-30-22)
 */
function generateTimestampFilenameSafe(date = new Date()) {
    const { year, month, day, hours, minutes, seconds } = getDateComponents(date);
    return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`;
}

/**
 * Generate date-only string
 * Format: YYYY-MM-DD (e.g., 2023-12-15)
 */
function generateDateOnly(date = new Date()) {
    const { year, month, day } = getDateComponents(date);
    return `${year}-${month}-${day}`;
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.DateUtils = {
        generateTimestamp,
        generateTimestampExport,
        generateTimestampFilenameSafe,
        generateDateOnly
    };
}
