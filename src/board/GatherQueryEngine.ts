/**
 * Gather Query Engine for Kanban board
 * Handles automatic task sorting based on gather rules and query tags
 */

import { KanbanBoard, KanbanColumn, KanbanTask } from '../markdownParser';
import {
    extractDate,
    extractPersonNames,
    hasSticky,
    getTodayString,
    isWithinDays,
    isOverdue,
    getDatePropertyValue
} from './DateTimeUtils';

type TaskEvaluator = (taskText: string, taskDate: string | null, personNames: string[]) => boolean;

interface GatherRule {
    column: KanbanColumn;
    expression: string;
}

interface UngatheredRule {
    column: KanbanColumn;
}

/**
 * Engine for processing gather rules and sorting tasks automatically
 */
export class GatherQueryEngine {

    /**
     * Perform automatic sorting of tasks based on gather rules
     * @param board - The kanban board to sort
     * @returns true if sorting was performed
     */
    public performAutomaticSort(board: KanbanBoard): boolean {
        if (!board || !board.columns) { return false; }

        // Track sticky tasks that shouldn't move
        const stickyTasks = new Set<string>();

        // First, identify all sticky tasks
        board.columns.forEach(column => {
            column.tasks.forEach(task => {
                const taskText = `${task.title || ''} ${task.description || ''}`;
                if (hasSticky(taskText)) {
                    stickyTasks.add(task.id);
                }
            });
        });

        // Collect gather rules separated by type
        const gatherRules: GatherRule[] = [];
        const ungatheredRules: UngatheredRule[] = [];

        // Collect all rules from columns in order
        board.columns.forEach(column => {
            if (!column.title) { return; }

            // Extract legacy gather and ungathered tags (#gather_...)
            const legacyMatches = column.title.match(/#(gather_[a-zA-Z0-9_&|=><!\-]+|ungathered)/g) || [];
            legacyMatches.forEach(match => {
                const tag = match.substring(1);
                if (tag === 'ungathered') {
                    ungatheredRules.push({ column: column });
                } else if (tag.startsWith('gather_')) {
                    gatherRules.push({
                        column: column,
                        expression: tag.substring(7)
                    });
                }
            });

            // Extract new query tags (?. for temporal, ?@ for person, ?# for hash)
            const queryMatches = column.title.match(/\?([.@#])([^\s]+)/g) || [];
            queryMatches.forEach(match => {
                const typePrefix = match[1]; // . @ or #
                const queryContent = match.substring(2);

                if (typePrefix === '.') {
                    // Temporal query
                    this._processTemporalQuery(queryContent, column, gatherRules);
                } else if (typePrefix === '@') {
                    // Person query
                    gatherRules.push({ column, expression: queryContent });
                } else if (typePrefix === '#') {
                    // Hash tag query
                    gatherRules.push({ column, expression: `tag_${queryContent}` });
                }
            });
        });

        // Track where each card will go
        const cardDestinations = new Map<string, KanbanColumn>();
        const matchedCards = new Set<string>();

        // FIRST PASS: Process each card against all regular gather rules
        board.columns.forEach(sourceColumn => {
            sourceColumn.tasks.forEach(task => {
                if (stickyTasks.has(task.id)) { return; }

                const taskText = `${task.title || ''} ${task.description || ''}`;
                const taskDate = extractDate(taskText);
                const personNames = extractPersonNames(taskText);

                // Check against each gather rule in order (first match wins)
                for (const rule of gatherRules) {
                    const evaluator = this._parseGatherExpression(rule.expression);
                    if (evaluator(taskText, taskDate, personNames)) {
                        cardDestinations.set(task.id, rule.column);
                        matchedCards.add(task.id);
                        break;
                    }
                }
            });
        });

        // SECOND PASS: Process ungathered rules
        if (ungatheredRules.length > 0) {
            board.columns.forEach(sourceColumn => {
                sourceColumn.tasks.forEach(task => {
                    if (stickyTasks.has(task.id) || matchedCards.has(task.id)) { return; }

                    const taskText = `${task.title || ''} ${task.description || ''}`;
                    const taskDate = extractDate(taskText);
                    const personNames = extractPersonNames(taskText);
                    const hasAnyAtTag = taskDate !== null || personNames.length > 0;

                    if (hasAnyAtTag) {
                        cardDestinations.set(task.id, ungatheredRules[0].column);
                    }
                });
            });
        }

        // Move all cards to their destinations
        cardDestinations.forEach((targetColumn, taskId) => {
            let sourceColumn: KanbanColumn | null = null;
            let task: KanbanTask | null = null;
            let taskIndex = -1;

            for (const column of board.columns) {
                const index = column.tasks.findIndex(t => t.id === taskId);
                if (index !== -1) {
                    sourceColumn = column;
                    task = column.tasks[index];
                    taskIndex = index;
                    break;
                }
            }

            if (sourceColumn && task && sourceColumn.id !== targetColumn.id) {
                sourceColumn.tasks.splice(taskIndex, 1);
                targetColumn.tasks.push(task);
            }
        });

        // THIRD PASS: Apply sorting to columns with sort tags
        board.columns.forEach(column => {
            if (!column.title) { return; }

            const sortMatches = column.title.match(/#sort-([a-zA-Z]+)/g) || [];
            sortMatches.forEach(match => {
                const sortType = match.substring(6);
                if (sortType === 'bydate') {
                    this._sortColumnByDate(column);
                } else if (sortType === 'byname') {
                    this._sortColumnByName(column);
                }
            });
        });

        return true;
    }

    /**
     * Process temporal query and add to gather rules
     */
    private _processTemporalQuery(queryContent: string, column: KanbanColumn, gatherRules: GatherRule[]): void {
        if (queryContent === 'today') {
            gatherRules.push({ column, expression: 'day=0' });
        } else if (queryContent.match(/^day[<>=!]/)) {
            gatherRules.push({ column, expression: queryContent });
        } else if (queryContent.match(/^-?\d+[<>]day$/)) {
            gatherRules.push({ column, expression: queryContent });
        } else if (queryContent.match(/^w\d+$/i)) {
            const weekNum = parseInt(queryContent.substring(1));
            gatherRules.push({ column, expression: `week=${weekNum}` });
        } else if (queryContent.match(/^(mon|tue|wed|thu|fri|sat|sun)/i)) {
            gatherRules.push({ column, expression: `weekday=${queryContent.substring(0, 3).toLowerCase()}` });
        } else {
            gatherRules.push({ column, expression: queryContent });
        }
    }

    /**
     * Parse gather expression into an evaluator function
     */
    private _parseGatherExpression(expr: string): TaskEvaluator {
        expr = expr.trim();

        // Handle OR expressions (lowest precedence)
        if (expr.includes('|')) {
            const parts = this._splitByOperator(expr, '|');
            const subEvaluators = parts.map(part => this._parseGatherExpression(part));
            return (taskText, taskDate, personNames) => {
                return subEvaluators.some(evaluator => evaluator(taskText, taskDate, personNames));
            };
        }

        // Handle AND expressions (higher precedence)
        if (expr.includes('&')) {
            const parts = this._splitByOperator(expr, '&');
            const subEvaluators = parts.map(part => this._parseGatherExpression(part));
            return (taskText, taskDate, personNames) => {
                return subEvaluators.every(evaluator => evaluator(taskText, taskDate, personNames));
            };
        }

        // Handle NOT operator
        if (expr.startsWith('!')) {
            const subEvaluator = this._parseGatherExpression(expr.substring(1));
            return (taskText, taskDate, personNames) => !subEvaluator(taskText, taskDate, personNames);
        }

        // Handle inequality operators (!=)
        if (expr.includes('!=')) {
            const parts = expr.split('!=');
            if (parts.length === 2) {
                const [property, value] = parts.map(p => p.trim());
                return this._createComparisonEvaluator(property, '!=', value);
            }
        }

        // Handle comparison expressions
        const comparisonMatch = expr.match(/^([a-zA-Z0-9_-]+)([<>=])(.+)$/);
        if (comparisonMatch) {
            const [, property, operator, value] = comparisonMatch;
            return this._createComparisonEvaluator(property.trim(), operator, value.trim());
        }

        // Handle range expressions like 0<day, day<3
        const rangeMatch = expr.match(/^(-?\d+)([<>])([a-zA-Z]+)$/);
        if (rangeMatch) {
            const [, value, operator, property] = rangeMatch;
            const flippedOp = operator === '<' ? '>' : '<';
            return this._createComparisonEvaluator(property.trim(), flippedOp, value.trim());
        }

        // Handle hash tag queries (tag_X from ?#X)
        if (expr.startsWith('tag_')) {
            const tagName = expr.substring(4).toLowerCase();
            return (taskText) => {
                const tagPattern = new RegExp(`#${tagName}(?=\\s|$)`, 'i');
                return tagPattern.test(taskText);
            };
        }

        // Default: treat as person name
        return (taskText, taskDate, personNames) => {
            return personNames.map(p => p.toLowerCase()).includes(expr.toLowerCase());
        };
    }

    /**
     * Split expression by operator respecting nesting
     */
    private _splitByOperator(expr: string, operator: string): string[] {
        const parts: string[] = [];
        let current = '';
        let depth = 0;

        for (let i = 0; i < expr.length; i++) {
            const char = expr[i];

            if (char === '(') { depth++; }
            else if (char === ')') { depth--; }
            else if (char === operator && depth === 0) {
                if (current.trim()) {
                    parts.push(current.trim());
                    current = '';
                    continue;
                }
            }
            current += char;
        }

        if (current.trim()) {
            parts.push(current.trim());
        }

        return parts;
    }

    /**
     * Create a comparison evaluator for date properties
     */
    private _createComparisonEvaluator(property: string, operator: string, value: string): TaskEvaluator {
        const dateProperties = ['dayoffset', 'day', 'weekday', 'weekdaynum', 'month', 'monthnum', 'week', 'weeknum'];
        const isDateProperty = dateProperties.includes(property.toLowerCase());

        if (isDateProperty) {
            return (taskText: string, taskDate: string | null) => {
                if (!taskDate) { return false; }

                const propValue = getDatePropertyValue(property.toLowerCase(), taskDate);
                if (propValue === null) { return false; }

                // For weekday string comparison
                if (property.toLowerCase() === 'weekday') {
                    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                    if (weekdays.includes(value.toLowerCase())) {
                        if (operator === '=') { return propValue === value.toLowerCase(); }
                        if (operator === '!=') { return propValue !== value.toLowerCase(); }
                        return false;
                    }
                    const weekdayNum = weekdays.indexOf(propValue as string);
                    const numValue = parseInt(value);
                    if (!isNaN(numValue)) {
                        switch (operator) {
                            case '=': return weekdayNum === numValue;
                            case '!=': return weekdayNum !== numValue;
                            case '<': return weekdayNum < numValue;
                            case '>': return weekdayNum > numValue;
                            default: return false;
                        }
                    }
                }

                // For month string comparison
                if (property.toLowerCase() === 'month') {
                    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                    if (months.includes(value.toLowerCase())) {
                        const targetMonth = months.indexOf(value.toLowerCase()) + 1;
                        switch (operator) {
                            case '=': return (propValue as number) === targetMonth;
                            case '!=': return (propValue as number) !== targetMonth;
                            case '<': return (propValue as number) < targetMonth;
                            case '>': return (propValue as number) > targetMonth;
                            default: return false;
                        }
                    }
                }

                // For numeric comparisons
                const numValue = parseInt(value);
                const numPropValue = typeof propValue === 'number' ? propValue : parseInt(propValue as string);

                switch (operator) {
                    case '=': return numPropValue === numValue;
                    case '!=': return numPropValue !== numValue;
                    case '<': return numPropValue < numValue;
                    case '>': return numPropValue > numValue;
                    default: return false;
                }
            };
        } else {
            // Treat property as a person name check
            return (taskText: string, taskDate: string | null, personNames: string[]) => {
                const hasPersonName = personNames.map(p => p.toLowerCase()).includes(property.toLowerCase());

                switch (operator) {
                    case '=':
                        return value === '1' || value === 'true' ? hasPersonName : !hasPersonName;
                    case '!=':
                        return value === '1' || value === 'true' ? !hasPersonName : hasPersonName;
                    default:
                        return hasPersonName;
                }
            };
        }
    }

    /**
     * Sort column tasks by date
     */
    private _sortColumnByDate(column: KanbanColumn): void {
        column.tasks.sort((a, b) => {
            const dateA = extractDate(`${a.title || ''} ${a.description || ''}`);
            const dateB = extractDate(`${b.title || ''} ${b.description || ''}`);

            if (!dateA && !dateB) { return 0; }
            if (!dateA) { return 1; }
            if (!dateB) { return -1; }

            return dateA.localeCompare(dateB);
        });
    }

    /**
     * Sort column tasks by name
     */
    private _sortColumnByName(column: KanbanColumn): void {
        column.tasks.sort((a, b) => {
            const titleA = a.title || '';
            const titleB = b.title || '';
            return titleA.localeCompare(titleB);
        });
    }

    /**
     * Check if a task matches a gather tag (legacy support)
     */
    public taskMatchesGatherTag(task: KanbanTask, tag: string): boolean {
        const taskText = `${task.title || ''} ${task.description || ''}`;
        const taskDate = extractDate(taskText);
        const personNames = extractPersonNames(taskText);

        const { baseTag, conditions } = this._parseGatherTag(tag);

        if (baseTag === 'gather_today' && taskDate === getTodayString()) {
            return true;
        } else if (baseTag === 'gather_next3days' && taskDate && isWithinDays(taskDate, 3)) {
            return true;
        } else if (baseTag === 'gather_next7days' && taskDate && isWithinDays(taskDate, 7)) {
            return true;
        } else if (baseTag === 'gather_overdue' && taskDate && isOverdue(taskDate)) {
            return true;
        } else if (baseTag === 'gather_dayoffset') {
            if (!taskDate) { return false; }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const date = new Date(taskDate);
            date.setHours(0, 0, 0, 0);

            const dayOffset = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            for (const condition of conditions) {
                let matches = false;
                const value = parseInt(condition.value);

                if (condition.operator === '=') {
                    matches = dayOffset === value;
                } else if (condition.operator === '>') {
                    matches = dayOffset > value;
                } else if (condition.operator === '<') {
                    matches = dayOffset < value;
                } else if (condition.operator === '|') {
                    matches = dayOffset === value;
                }

                if (matches) { return true; }
            }

            return false;
        } else if (baseTag.startsWith('gather_') &&
            !baseTag.match(/^gather_(today|next3days|next7days|overdue|dayoffset)$/)) {
            const targetPerson = baseTag.substring(7);
            return personNames.includes(targetPerson);
        }

        return false;
    }

    /**
     * Parse a gather tag into base tag and conditions
     */
    private _parseGatherTag(tag: string): {
        baseTag: string;
        conditions: Array<{ operator: string; value: string }>
    } {
        const parts = tag.split(/([=|><])/);
        const baseTag = parts[0];
        const conditions: Array<{ operator: string; value: string }> = [];

        for (let i = 1; i < parts.length; i += 2) {
            if (i + 1 < parts.length) {
                conditions.push({
                    operator: parts[i],
                    value: parts[i + 1]
                });
            }
        }

        return { baseTag, conditions };
    }
}

// Export singleton instance for convenience
export const gatherQueryEngine = new GatherQueryEngine();
