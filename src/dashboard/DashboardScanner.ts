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
    TagInfo
} from './DashboardTypes';

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
 * Extract all tags from text
 */
function extractTags(text: string): { name: string; type: 'hash' | 'person' | 'temporal' }[] {
    const tags: { name: string; type: 'hash' | 'person' | 'temporal' }[] = [];

    // Hash tags: #tag
    const hashMatches = text.matchAll(/#([^\s#@!]+)/g);
    for (const match of hashMatches) {
        const tag = match[1].toLowerCase();
        // Skip layout tags
        if (!tag.match(/^(row\d+|span\d+|stack|sticky|fold|archive|hidden|include:)/)) {
            tags.push({ name: '#' + tag, type: 'hash' });
        }
    }

    // Person tags: @person
    const personMatches = text.matchAll(/@([^\s#@!]+)/g);
    for (const match of personMatches) {
        tags.push({ name: '@' + match[1].toLowerCase(), type: 'person' });
    }

    // Temporal tags: !date, !week, !time
    const temporalMatches = text.matchAll(/!([^\s]+)/g);
    for (const match of temporalMatches) {
        tags.push({ name: '!' + match[1], type: 'temporal' });
    }

    return tags;
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
        console.log('[DashboardScanner] START scan - today:', today.toISOString(), 'timeframeDays:', timeframeDays);

        // Scan all columns and tasks with hierarchical temporal gating
        let columnIndex = 0;
        for (const column of board.columns || []) {
            // Check column's temporal tag first (hierarchical gating)
            const columnTitle = column.title || '';
            const columnTemporal = this._extractTemporalInfo(columnTitle);

            console.log('[DashboardScanner] Column[' + columnIndex + ']:', columnTitle, 'temporal:', columnTemporal);

            // If column has a date/week tag outside timeframe, skip all tasks in this column
            let columnWithinTimeframe = true;
            let columnDate: Date | undefined;

            if (columnTemporal) {
                if (columnTemporal.date) {
                    // For week tags, check if any day of the week overlaps with timeframe
                    const isWeekBased = columnTemporal.week !== undefined;
                    columnWithinTimeframe = isWithinTimeframe(columnTemporal.date, timeframeDays, isWeekBased);
                    columnDate = columnTemporal.date;
                    console.log('[DashboardScanner]   -> columnDate:', columnDate.toISOString(), 'isWeek:', isWeekBased, 'withinTimeframe:', columnWithinTimeframe);
                }
            }

            let taskIndex = 0;
            for (const task of column.tasks || []) {
                totalTasks++;
                const taskText = (task.title || '') + ' ' + (task.description || '');

                // Extract all tags from task (for tag summary)
                const tags = extractTags(taskText);
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
                    console.log('[DashboardScanner]   Task[' + taskIndex + ']:', task.title, 'temporal:', taskTemporal);

                    // Determine effective date for this task
                    let effectiveDate = taskTemporal.date;
                    let effectiveDateIsWeekBased = taskTemporal.week !== undefined;

                    // For time slots WITHOUT explicit date/week - can inherit from column
                    if (taskTemporal.timeSlot && !taskTemporal.hasExplicitDate) {
                        if (columnTemporal && columnDate) {
                            // Column has temporal tag - time slot inherits from column
                            if (!columnWithinTimeframe) {
                                // Column is outside timeframe - gates this time slot
                                console.log('[DashboardScanner]     -> SKIPPED (column gates time slot)');
                                taskIndex++;
                                continue;
                            }
                            effectiveDate = columnDate;
                            effectiveDateIsWeekBased = columnTemporal.week !== undefined;
                            console.log('[DashboardScanner]     -> time slot inherits column date:', effectiveDate.toISOString(), 'isWeek:', effectiveDateIsWeekBased);
                        }
                        // If no column temporal tag, time slot uses "today" (already set)
                    } else if (taskTemporal.hasExplicitDate && columnTemporal && columnTemporal.date && !columnWithinTimeframe) {
                        // Task has explicit date/week tag, but column has temporal tag outside timeframe
                        // Column gates the task (hierarchical gating)
                        console.log('[DashboardScanner]     -> SKIPPED (column gates task with explicit date)');
                        taskIndex++;
                        continue;
                    }

                    const withinTimeframe = effectiveDate ? isWithinTimeframe(effectiveDate, timeframeDays, effectiveDateIsWeekBased) : false;
                    console.log('[DashboardScanner]     -> effectiveDate:', effectiveDate?.toISOString(), 'isWeek:', effectiveDateIsWeekBased, 'withinTimeframe:', withinTimeframe);

                    if (effectiveDate && withinTimeframe) {
                        console.log('[DashboardScanner]     -> ADDED to upcoming (col:' + columnIndex + ', task:' + taskIndex + ')');
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
                    } else {
                        console.log('[DashboardScanner]     -> NOT added (outside timeframe or no date)');
                    }
                }
                taskIndex++;
            }
            columnIndex++;
        }

        console.log('[DashboardScanner] END scan - found', upcomingItems.length, 'upcoming items');

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

        // Always check for time slot first (can be combined with date/week)
        const timeMatch = text.match(/!(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
        const timeSlot = timeMatch ? timeMatch[0] : undefined;

        // Try to find date tag (most specific)
        const dateMatch = text.match(/!(\d{1,4}[-./]\d{1,2}(?:[-./]\d{2,4})?)/);
        if (dateMatch) {
            const date = parseDateTag(dateMatch[0]);
            if (date) {
                result = { tag: dateMatch[0], date, timeSlot, hasExplicitDate: true };
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
}
