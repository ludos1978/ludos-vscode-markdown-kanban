/**
 * BoardContentScanner - Service to extract and scan embedded elements from kanban boards
 *
 * Scans board content for:
 * - Images (markdown and HTML)
 * - Include files (column, task, and regular includes)
 * - Links (markdown links to local files)
 * - Media (video/audio elements)
 * - Diagrams (drawio, excalidraw references)
 *
 * @module services/BoardContentScanner
 */

import * as fs from 'fs';
import * as path from 'path';
import { KanbanBoard, KanbanColumn, KanbanTask } from '../board/KanbanTypes';
import { MarkdownPatterns, HtmlPatterns, DiagramPatterns, isUrl } from '../shared/regexPatterns';

/**
 * Types of embedded elements that can be scanned
 */
export type ElementType = 'image' | 'include' | 'link' | 'media' | 'diagram';

/**
 * Location within the board where an element was found
 */
export interface ElementLocation {
    columnId: string;
    columnTitle: string;
    taskId?: string;
    taskTitle?: string;
    field: 'columnTitle' | 'taskTitle' | 'description';
}

/**
 * An extracted element from board content
 */
export interface ExtractedElement {
    type: ElementType;
    path: string;
    rawMatch: string;
    location: ElementLocation;
}

/**
 * A broken element (file doesn't exist)
 */
export interface BrokenElement extends ExtractedElement {
    exists: false;
    resolvedPath?: string;
}

/**
 * A text search match
 */
export interface TextMatch {
    matchText: string;
    context: string;
    location: ElementLocation;
}

/**
 * Search result for UI display
 */
export interface SearchResult {
    type: ElementType | 'text';
    path?: string;
    matchText?: string;
    context?: string;
    location: ElementLocation;
    exists: boolean;
}

/**
 * BoardContentScanner - Extracts and validates embedded elements from kanban boards
 */
export class BoardContentScanner {
    private _basePath: string;

    constructor(basePath: string) {
        this._basePath = basePath;
    }

    /**
     * Extract all embedded elements from a board
     */
    extractElements(board: KanbanBoard): ExtractedElement[] {
        const elements: ExtractedElement[] = [];

        for (const column of board.columns) {
            // Check column title for elements
            this._extractFromContent(column.title, {
                columnId: column.id,
                columnTitle: column.displayTitle || column.title,
                field: 'columnTitle'
            }, elements);

            // Check column-level includes
            if (column.includeFiles && column.includeFiles.length > 0) {
                for (const includePath of column.includeFiles) {
                    elements.push({
                        type: 'include',
                        path: includePath,
                        rawMatch: `!!!include(${includePath})!!!`,
                        location: {
                            columnId: column.id,
                            columnTitle: column.displayTitle || column.title,
                            field: 'columnTitle'
                        }
                    });
                }
            }

            // Check tasks
            for (const task of column.tasks) {
                // Check task title
                this._extractFromContent(task.title, {
                    columnId: column.id,
                    columnTitle: column.displayTitle || column.title,
                    taskId: task.id,
                    taskTitle: task.displayTitle || task.title,
                    field: 'taskTitle'
                }, elements);

                // Check task-level includes
                if (task.includeFiles && task.includeFiles.length > 0) {
                    for (const includePath of task.includeFiles) {
                        elements.push({
                            type: 'include',
                            path: includePath,
                            rawMatch: `!!!include(${includePath})!!!`,
                            location: {
                                columnId: column.id,
                                columnTitle: column.displayTitle || column.title,
                                taskId: task.id,
                                taskTitle: task.displayTitle || task.title,
                                field: 'taskTitle'
                            }
                        });
                    }
                }

                // Check task description
                if (task.description) {
                    this._extractFromContent(task.description, {
                        columnId: column.id,
                        columnTitle: column.displayTitle || column.title,
                        taskId: task.id,
                        taskTitle: task.displayTitle || task.title,
                        field: 'description'
                    }, elements);

                    // Check regular includes in description
                    if (task.regularIncludeFiles && task.regularIncludeFiles.length > 0) {
                        for (const includePath of task.regularIncludeFiles) {
                            elements.push({
                                type: 'include',
                                path: includePath,
                                rawMatch: `!!!include(${includePath})!!!`,
                                location: {
                                    columnId: column.id,
                                    columnTitle: column.displayTitle || column.title,
                                    taskId: task.id,
                                    taskTitle: task.displayTitle || task.title,
                                    field: 'description'
                                }
                            });
                        }
                    }
                }
            }
        }

        return elements;
    }

    /**
     * Find broken elements (files that don't exist)
     */
    findBrokenElements(board: KanbanBoard): BrokenElement[] {
        const elements = this.extractElements(board);
        const broken: BrokenElement[] = [];

        for (const element of elements) {
            // Skip URLs
            if (isUrl(element.path)) {
                continue;
            }

            const resolvedPath = this._resolvePath(element.path);
            const exists = fs.existsSync(resolvedPath);

            if (!exists) {
                broken.push({
                    ...element,
                    exists: false,
                    resolvedPath
                });
            }
        }

        // Also check for columns/tasks with includeError flag
        for (const column of board.columns) {
            if (column.includeError && column.includeFiles) {
                // Check if we already have this include in broken list
                const alreadyTracked = broken.some(b =>
                    b.type === 'include' &&
                    column.includeFiles!.some(f => b.path === f)
                );

                if (!alreadyTracked && column.includeFiles.length > 0) {
                    for (const includePath of column.includeFiles) {
                        const resolvedPath = this._resolvePath(includePath);
                        if (!fs.existsSync(resolvedPath)) {
                            broken.push({
                                type: 'include',
                                path: includePath,
                                rawMatch: `!!!include(${includePath})!!!`,
                                location: {
                                    columnId: column.id,
                                    columnTitle: column.displayTitle || column.title,
                                    field: 'columnTitle'
                                },
                                exists: false,
                                resolvedPath
                            });
                        }
                    }
                }
            }

            for (const task of column.tasks) {
                if (task.includeError && task.includeFiles) {
                    const alreadyTracked = broken.some(b =>
                        b.type === 'include' &&
                        task.includeFiles!.some(f => b.path === f)
                    );

                    if (!alreadyTracked && task.includeFiles.length > 0) {
                        for (const includePath of task.includeFiles) {
                            const resolvedPath = this._resolvePath(includePath);
                            if (!fs.existsSync(resolvedPath)) {
                                broken.push({
                                    type: 'include',
                                    path: includePath,
                                    rawMatch: `!!!include(${includePath})!!!`,
                                    location: {
                                        columnId: column.id,
                                        columnTitle: column.displayTitle || column.title,
                                        taskId: task.id,
                                        taskTitle: task.displayTitle || task.title,
                                        field: 'taskTitle'
                                    },
                                    exists: false,
                                    resolvedPath
                                });
                            }
                        }
                    }
                }
            }
        }

        return broken;
    }

    /**
     * Search for text in board content
     */
    searchText(board: KanbanBoard, query: string): TextMatch[] {
        if (!query || query.length === 0) {
            return [];
        }

        const matches: TextMatch[] = [];
        const lowerQuery = query.toLowerCase();

        for (const column of board.columns) {
            // Search column title
            const columnTitle = column.displayTitle || column.title;
            if (columnTitle.toLowerCase().includes(lowerQuery)) {
                matches.push({
                    matchText: query,
                    context: this._getContext(columnTitle, lowerQuery),
                    location: {
                        columnId: column.id,
                        columnTitle: columnTitle,
                        field: 'columnTitle'
                    }
                });
            }

            // Search tasks
            for (const task of column.tasks) {
                const taskTitle = task.displayTitle || task.title;

                // Search task title
                if (taskTitle.toLowerCase().includes(lowerQuery)) {
                    matches.push({
                        matchText: query,
                        context: this._getContext(taskTitle, lowerQuery),
                        location: {
                            columnId: column.id,
                            columnTitle: columnTitle,
                            taskId: task.id,
                            taskTitle: taskTitle,
                            field: 'taskTitle'
                        }
                    });
                }

                // Search task description
                if (task.description && task.description.toLowerCase().includes(lowerQuery)) {
                    matches.push({
                        matchText: query,
                        context: this._getContext(task.description, lowerQuery),
                        location: {
                            columnId: column.id,
                            columnTitle: columnTitle,
                            taskId: task.id,
                            taskTitle: taskTitle,
                            field: 'description'
                        }
                    });
                }
            }
        }

        return matches;
    }

    /**
     * Extract elements from a content string
     */
    private _extractFromContent(
        content: string,
        location: ElementLocation,
        elements: ExtractedElement[]
    ): void {
        if (!content) return;

        // Images (markdown)
        const imageRegex = MarkdownPatterns.image();
        let match;
        while ((match = imageRegex.exec(content)) !== null) {
            const filePath = match[1];
            if (!isUrl(filePath)) {
                // Check if it's a diagram
                const type = this._getDiagramType(filePath) || 'image';
                elements.push({
                    type,
                    path: filePath,
                    rawMatch: match[0],
                    location
                });
            }
        }

        // Links (markdown) - only local file links
        const linkRegex = MarkdownPatterns.link();
        while ((match = linkRegex.exec(content)) !== null) {
            const filePath = match[1];
            if (!isUrl(filePath) && !filePath.startsWith('#')) {
                elements.push({
                    type: 'link',
                    path: filePath,
                    rawMatch: match[0],
                    location
                });
            }
        }

        // HTML img tags
        const imgRegex = HtmlPatterns.img();
        while ((match = imgRegex.exec(content)) !== null) {
            const filePath = match[1];
            if (!isUrl(filePath)) {
                elements.push({
                    type: 'image',
                    path: filePath,
                    rawMatch: match[0],
                    location
                });
            }
        }

        // HTML media tags (video/audio)
        const mediaRegex = HtmlPatterns.media();
        while ((match = mediaRegex.exec(content)) !== null) {
            const filePath = match[1];
            if (!isUrl(filePath)) {
                elements.push({
                    type: 'media',
                    path: filePath,
                    rawMatch: match[0],
                    location
                });
            }
        }

        // Includes in content (regular includes)
        const includeRegex = MarkdownPatterns.include();
        while ((match = includeRegex.exec(content)) !== null) {
            elements.push({
                type: 'include',
                path: match[1],
                rawMatch: match[0],
                location
            });
        }
    }

    /**
     * Get diagram type from file extension
     */
    private _getDiagramType(filePath: string): 'diagram' | null {
        const ext = path.extname(filePath).toLowerCase();
        if (['.drawio', '.dio'].includes(ext)) {
            return 'diagram';
        }
        if (filePath.includes('.excalidraw')) {
            return 'diagram';
        }
        return null;
    }

    /**
     * Resolve a relative path to absolute
     */
    private _resolvePath(relativePath: string): string {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }
        // Handle ./ prefix
        const cleanPath = relativePath.startsWith('./')
            ? relativePath.substring(2)
            : relativePath;
        return path.resolve(this._basePath, cleanPath);
    }

    /**
     * Get context around a match (for display)
     */
    private _getContext(content: string, lowerQuery: string): string {
        const lowerContent = content.toLowerCase();
        const index = lowerContent.indexOf(lowerQuery);

        if (index === -1) return content.substring(0, 100);

        const start = Math.max(0, index - 30);
        const end = Math.min(content.length, index + lowerQuery.length + 30);

        let context = content.substring(start, end);

        if (start > 0) context = '...' + context;
        if (end < content.length) context = context + '...';

        return context;
    }

    /**
     * Convert broken elements and text matches to unified SearchResult format
     */
    static toSearchResults(items: (BrokenElement | TextMatch)[], searchType: 'broken' | 'text'): SearchResult[] {
        return items.map(item => {
            if ('path' in item) {
                // BrokenElement
                return {
                    type: item.type,
                    path: item.path,
                    location: item.location,
                    exists: false
                };
            } else {
                // TextMatch
                return {
                    type: 'text' as const,
                    matchText: item.matchText,
                    context: item.context,
                    location: item.location,
                    exists: true
                };
            }
        });
    }
}
