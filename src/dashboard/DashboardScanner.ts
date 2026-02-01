/**
 * DashboardScanner - Scans kanban boards for upcoming items and tags
 *
 * Extracts:
 * - Tasks with temporal tags within a specified timeframe
 * - All unique tags used in the board
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';
import {
    UpcomingItem,
    BoardTagSummary,
    TagInfo,
    TagSearchResult
} from './DashboardTypes';
import { TextMatcher } from '../utils/textMatcher';
import { logger } from '../utils/logger';

// Date locale configuration - matches frontend tagUtils.js
let dateLocale: string = 'de-DE';

/**
 * Check if locale uses day-first format (DD.MM.YYYY)
 */
function isLocaleDayFirst(): boolean {
    const dayFirstLocales = ['de-DE', 'de-AT', 'de-CH', 'en-GB', 'fr-FR'];
    return dayFirstLocales.includes(dateLocale);
}

/**
 * Parse a date tag string into a Date object
 * Supports: DD.MM.YYYY, DD.MM.YY, DD.MM, YYYY-MM-DD, YYYY.MM.DD
 */
function parseDateTag(tagContent: string): Date | null {
    // Remove the ! prefix if present
    const content = tagContent.startsWith('!') ? tagContent.slice(1) : tagContent;

    // Try to match date patterns
    const dateMatch = content.match(/^(\d{1,4})[-./](\d{1,2})(?:[-./](\d{2,4}))?$/);
    if (!dateMatch) return null;

    const [, part1, part2, part3] = dateMatch;
    let year: number, month: number, day: number;

    const p1 = parseInt(part1, 10);
    const p2 = parseInt(part2, 10);
    const p3 = part3 ? parseInt(part3, 10) : undefined;

    // Determine format based on first number and locale
    if (p1 > 31) {
        // First number > 31, must be year: YYYY-MM-DD
        year = p1;
        month = p2;
        day = p3 || 1;
    } else if (isLocaleDayFirst()) {
        // European format: DD.MM.YYYY or DD.MM.YY or DD.MM
        day = p1;
        month = p2;
        if (p3 !== undefined) {
            year = p3 < 100 ? 2000 + p3 : p3;
        } else {
            year = new Date().getFullYear();
        }
    } else {
        // US format: MM/DD/YYYY
        month = p1;
        day = p2;
        if (p3 !== undefined) {
            year = p3 < 100 ? 2000 + p3 : p3;
        } else {
            year = new Date().getFullYear();
        }
    }

    // Validate
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (year < 1900 || year > 2100) return null;

    return new Date(year, month - 1, day);
}

/**
 * Parse a week tag and return the Monday of that week
 * Supports: !W4, !KW4, !w4, !kw4, !2025-W4, !2025.W4
 */
function parseWeekTag(tagContent: string): Date | null {
    const content = tagContent.startsWith('!') ? tagContent.slice(1) : tagContent;

    // Try week with year: 2025-W4, 2025.W4, 2025-KW4
    const weekYearMatch = content.match(/^(\d{4})[-.]?(?:[wW]|[kK][wW])(\d{1,2})$/);
    if (weekYearMatch) {
        const year = parseInt(weekYearMatch[1], 10);
        const week = parseInt(weekYearMatch[2], 10);
        return getDateOfISOWeek(week, year);
    }

    // Try week without year: W4, w4, KW4, kw4
    const weekMatch = content.match(/^(?:[wW]|[kK][wW])(\d{1,2})$/);
    if (weekMatch) {
        const week = parseInt(weekMatch[1], 10);
        const year = new Date().getFullYear();
        return getDateOfISOWeek(week, year);
    }

    return null;
}

/**
 * Get the Monday of a given ISO week
 */
function getDateOfISOWeek(week: number, year: number): Date {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7; // Sunday = 7
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    return monday;
}

/**
 * Check if a date is within the specified timeframe from today
 * @param date - The date to check
 * @param timeframeDays - Number of days in the future to include
 * @param isWeekDate - If true, checks if any day of that week overlaps with timeframe
 */
function isWithinTimeframe(date: Date, timeframeDays: number, isWeekDate: boolean = false): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureLimit = new Date(today);
    futureLimit.setDate(futureLimit.getDate() + timeframeDays);

    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    if (isWeekDate) {
        // For week dates (Monday), check if any day of that week overlaps with [today, futureLimit]
        // Week spans Monday (checkDate) to Sunday (checkDate + 6 days)
        const weekEnd = new Date(checkDate);
        weekEnd.setDate(weekEnd.getDate() + 6);

        // Overlap exists if: weekStart <= futureLimit AND weekEnd >= today
        return checkDate <= futureLimit && weekEnd >= today;
    }

    return checkDate >= today && checkDate <= futureLimit;
}

export class DashboardScanner {
    /**
     * Set the date locale for parsing
     */
    static setDateLocale(locale: string): void {
        dateLocale = locale;
    }

    /**
     * Scan a board for upcoming items and tags
     */
    static scanBoard(
        board: KanbanBoard,
        boardUri: string,
        boardName: string,
        timeframeDays: number
    ): { upcomingItems: UpcomingItem[]; summary: BoardTagSummary } {
        const upcomingItems: UpcomingItem[] = [];
        const tagCounts = new Map<string, { count: number; type: 'hash' | 'person' | 'temporal' }>();
        let totalTasks = 0;
        let temporalTasks = 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        logger.debug('[DashboardScanner] START scan', { today: today.toISOString(), timeframeDays });

        // Scan all columns and tasks with hierarchical temporal gating
        let columnIndex = 0;
        for (const column of board.columns || []) {
            // Check column's temporal tag first (hierarchical gating)
            const columnTitle = column.title || '';
            const columnTemporal = this._extractTemporalInfo(columnTitle);

            // If column has a date/week tag outside timeframe, skip all tasks in this column
            let columnWithinTimeframe = true;
            let columnDate: Date | undefined;

            if (columnTemporal) {
                if (columnTemporal.date) {
                    // For week tags, check if any day of the week overlaps with timeframe
                    const isWeekBased = columnTemporal.week !== undefined;
                    columnWithinTimeframe = isWithinTimeframe(columnTemporal.date, timeframeDays, isWeekBased);
                    columnDate = columnTemporal.date;
                }
            }

            let taskIndex = 0;
            for (const task of column.tasks || []) {
                totalTasks++;
                const taskText = (task.title || '') + ' ' + (task.description || '');

                // Extract all tags from task (for tag summary)
                const tags = TextMatcher.extractTags(taskText);
                for (const tag of tags) {
                    const existing = tagCounts.get(tag.name);
                    if (existing) {
                        existing.count++;
                    } else {
                        tagCounts.set(tag.name, { count: 1, type: tag.type });
                    }
                }

                // Check task's temporal tags (title + description)
                const taskTemporal = this._extractTemporalInfo(taskText);

                if (taskTemporal) {
                    temporalTasks++;

                    // Determine effective date for this task
                    let effectiveDate = taskTemporal.date;
                    let effectiveDateIsWeekBased = taskTemporal.week !== undefined;

                    // For time slots WITHOUT explicit date/week - can inherit from column
                    if (taskTemporal.timeSlot && !taskTemporal.hasExplicitDate) {
                        if (columnTemporal && columnDate) {
                            // Column has temporal tag - time slot inherits from column
                            if (!columnWithinTimeframe) {
                                // Column is outside timeframe - gates this time slot
                                taskIndex++;
                                continue;
                            }
                            effectiveDate = columnDate;
                            effectiveDateIsWeekBased = columnTemporal.week !== undefined;
                        }
                        // If no column temporal tag, time slot uses "today" (already set)
                    } else if (taskTemporal.hasExplicitDate && columnTemporal && columnTemporal.date && !columnWithinTimeframe) {
                        // Task has explicit date/week tag, but column has temporal tag outside timeframe
                        // Column gates the task (hierarchical gating)
                        taskIndex++;
                        continue;
                    }

                    const withinTimeframe = effectiveDate ? isWithinTimeframe(effectiveDate, timeframeDays, effectiveDateIsWeekBased) : false;

                    if (effectiveDate && withinTimeframe) {
                        upcomingItems.push({
                            boardUri,
                            boardName,
                            columnIndex,
                            columnTitle: columnTitle,
                            taskIndex,
                            taskTitle: task.title || '',
                            temporalTag: taskTemporal.tag,
                            date: effectiveDate,
                            week: taskTemporal.week || columnTemporal?.week,
                            year: taskTemporal.year || columnTemporal?.year,
                            timeSlot: taskTemporal.timeSlot,
                            rawTitle: task.title || ''
                        });
                    }
                }
                taskIndex++;
            }
            columnIndex++;
        }

        logger.debug('[DashboardScanner] END scan', { upcomingItems: upcomingItems.length });

        // Convert tag counts to sorted array
        const tags: TagInfo[] = Array.from(tagCounts.entries())
            .map(([name, info]) => ({
                name,
                count: info.count,
                type: info.type
            }))
            .sort((a, b) => b.count - a.count);

        const summary: BoardTagSummary = {
            boardUri,
            boardName,
            tags,
            totalTasks,
            temporalTasks
        };

        return { upcomingItems, summary };
    }

    /**
     * Extract temporal information from text
     * Now captures time slots alongside dates/weeks
     */
    private static _extractTemporalInfo(text: string): {
        tag: string;
        date?: Date;
        week?: number;
        year?: number;
        timeSlot?: string;
        hasExplicitDate?: boolean;  // true if date came from explicit date/week tag
    } | null {
        let result: {
            tag: string;
            date?: Date;
            week?: number;
            year?: number;
            timeSlot?: string;
            hasExplicitDate?: boolean;
        } | null = null;

        // Check for time slot first (can be combined with date/week)
        // Supports: !HH:MM-HH:MM, !HHMM-HHMM, !HHMM, !HHam/pm
        let timeSlot: string | undefined;

        // Time range with colons: !09:00-17:00
        const timeRangeColonMatch = text.match(/!(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
        if (timeRangeColonMatch) {
            timeSlot = timeRangeColonMatch[0];
        }

        // Time range without colons: !1200-1400
        if (!timeSlot) {
            const timeRangeNoColonMatch = text.match(/!(\d{4})-(\d{4})/);
            if (timeRangeNoColonMatch) {
                const start = timeRangeNoColonMatch[1];
                const end = timeRangeNoColonMatch[2];
                const startHours = parseInt(start.substring(0, 2), 10);
                const startMins = parseInt(start.substring(2, 4), 10);
                const endHours = parseInt(end.substring(0, 2), 10);
                const endMins = parseInt(end.substring(2, 4), 10);
                // Validate both times
                if (startHours < 24 && startMins < 60 && endHours < 24 && endMins < 60) {
                    timeSlot = timeRangeNoColonMatch[0];
                }
            }
        }

        // 4-digit time: !1230 (not matching years like !2026 which are handled separately)
        if (!timeSlot) {
            const time4DigitMatch = text.match(/!(\d{4})(?![-./\d])/);
            if (time4DigitMatch) {
                const digits = time4DigitMatch[1];
                const hours = parseInt(digits.substring(0, 2), 10);
                const mins = parseInt(digits.substring(2, 4), 10);
                // Only treat as time if hours < 24 and mins < 60 (exclude years like 2026)
                if (hours < 24 && mins < 60) {
                    timeSlot = time4DigitMatch[0];
                }
            }
        }

        // AM/PM time: !12pm, !9am (US locale)
        if (!timeSlot && !isLocaleDayFirst()) {
            const ampmMatch = text.match(/!(\d{1,2})(am|pm)/i);
            if (ampmMatch) {
                timeSlot = ampmMatch[0];
            }
        }

        // Try to find year tag: !Y2026 or !J2026 (German "Jahr")
        const yearTagMatch = text.match(/![YyJj](\d{4})/);
        if (yearTagMatch) {
            const year = parseInt(yearTagMatch[1], 10);
            // Year tag represents Jan 1 of that year
            const date = new Date(year, 0, 1);
            result = { tag: yearTagMatch[0], date, year, timeSlot, hasExplicitDate: true };
        }

        // Try to find date tag (most specific)
        if (!result) {
            const dateMatch = text.match(/!(\d{1,4}[-./]\d{1,2}(?:[-./]\d{2,4})?)/);
            if (dateMatch) {
                const date = parseDateTag(dateMatch[0]);
                if (date) {
                    result = { tag: dateMatch[0], date, timeSlot, hasExplicitDate: true };
                }
            }
        }

        // If no date, try to find week tag
        if (!result) {
            const weekMatch = text.match(/!(?:(\d{4})[-.]?)?(?:[wW]|[kK][wW])(\d{1,2})/);
            if (weekMatch) {
                const year = weekMatch[1] ? parseInt(weekMatch[1], 10) : new Date().getFullYear();
                const week = parseInt(weekMatch[2], 10);
                const date = getDateOfISOWeek(week, year);
                result = { tag: weekMatch[0], date, week, year, timeSlot, hasExplicitDate: true };
            }
        }

        // If no date or week but has time slot, treat as "today" (can inherit from column)
        if (!result && timeSlot) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            result = { tag: timeSlot, date: today, timeSlot, hasExplicitDate: false };
        }

        return result;
    }

    /**
     * Search a board for all tasks containing a specific tag
     * @param board - The parsed kanban board
     * @param boardUri - URI of the board file
     * @param boardName - Display name of the board
     * @param searchTag - The tag to search for (e.g., "#project", "@person", "!date")
     * @returns Array of matching tasks
     */
    static searchByTag(
        board: KanbanBoard,
        boardUri: string,
        boardName: string,
        searchTag: string
    ): TagSearchResult[] {
        const results: TagSearchResult[] = [];

        let columnIndex = 0;
        for (const column of board.columns || []) {
            const columnTitle = column.title || '';

            // Check if column title contains the search tag (exact match)
            const columnTags = TextMatcher.extractTags(columnTitle);
            const columnMatchingTag = columnTags.find(t => TextMatcher.tagExactMatch(t.name, searchTag));
            const columnHasTag = !!columnMatchingTag;

            // Track if any task in this column matched directly
            let anyTaskMatchedDirectly = false;

            let taskIndex = 0;
            for (const task of column.tasks || []) {
                const taskText = (task.title || '') + ' ' + (task.description || '');
                const tags = TextMatcher.extractTags(taskText);

                // Check if any tag in task matches the search (exact match)
                for (const tag of tags) {
                    if (TextMatcher.tagExactMatch(tag.name, searchTag)) {
                        results.push({
                            boardUri,
                            boardName,
                            columnIndex,
                            columnTitle,
                            taskIndex,
                            taskTitle: task.title || '',
                            matchedTag: tag.name
                        });
                        anyTaskMatchedDirectly = true;
                        break; // Only add task once even if multiple tags match
                    }
                }
                taskIndex++;
            }

            // If column has the tag but no tasks matched directly, add a column-level result
            // Use taskIndex = -1 to indicate this is a column match, not a task match
            if (columnHasTag && !anyTaskMatchedDirectly) {
                results.push({
                    boardUri,
                    boardName,
                    columnIndex,
                    columnTitle,
                    taskIndex: -1,  // -1 indicates column-level match
                    taskTitle: '',  // No specific task
                    matchedTag: columnMatchingTag?.name || searchTag
                });
            }

            columnIndex++;
        }

        return results;
    }
}
