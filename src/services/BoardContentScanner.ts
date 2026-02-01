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
import * as vscode from 'vscode';
import { KanbanBoard, KanbanColumn, KanbanTask } from '../board/KanbanTypes';
import { MarkdownPatterns, HtmlPatterns, DiagramPatterns, isUrl } from '../shared/regexPatterns';
import { safeDecodeURIComponent } from '../utils/stringUtils';

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
    /** Base path for resolving relative paths (e.g., include file directory) */
    resolveBasePath?: string;
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

    private _getColumnTitle(column: KanbanColumn): string {
        return column.displayTitle || column.title;
    }

    private _getTaskTitle(task: KanbanTask): string {
        return task.displayTitle || task.title;
    }

    private _buildColumnLocation(column: KanbanColumn, field: ElementLocation['field']): ElementLocation {
        return {
            columnId: column.id,
            columnTitle: this._getColumnTitle(column),
            field
        };
    }

    private _buildTaskLocation(column: KanbanColumn, task: KanbanTask, field: ElementLocation['field']): ElementLocation {
        return {
            columnId: column.id,
            columnTitle: this._getColumnTitle(column),
            taskId: task.id,
            taskTitle: this._getTaskTitle(task),
            field
        };
    }

    private _pushIncludeElements(elements: ExtractedElement[], includePaths: string[], location: ElementLocation): void {
        for (const includePath of includePaths) {
            elements.push({
                type: 'include',
                path: includePath,
                rawMatch: `!!!include(${includePath})!!!`,
                location
            });
        }
    }

    /**
     * Extract all embedded elements from a board
     */
    extractElements(board: KanbanBoard): ExtractedElement[] {
        const elements: ExtractedElement[] = [];

        for (const column of board.columns) {
            const columnLocation = this._buildColumnLocation(column, 'columnTitle');

            // Determine column include base path if column is from an include file
            let columnIncludeBasePath: string | undefined;
            if (column.includeMode && column.includeFiles && column.includeFiles.length > 0) {
                // Resolve the first include file to get its directory
                const firstInclude = column.includeFiles[0];
                const resolvedInclude = this._resolvePathWithBase(firstInclude, this._basePath);
                columnIncludeBasePath = path.dirname(resolvedInclude);
            }

            // Check column title for elements (use include base path if available)
            this._extractFromContent(column.title, columnLocation, elements, columnIncludeBasePath);

            // Check column-level includes
            if (column.includeFiles && column.includeFiles.length > 0) {
                this._pushIncludeElements(elements, column.includeFiles, columnLocation);
            }

            // Check tasks
            for (const task of column.tasks) {
                const taskTitleLocation = this._buildTaskLocation(column, task, 'taskTitle');

                // Determine task include base path:
                // 1. Use task's own includeContext if available
                // 2. Fall back to column's include base path (for tasks inside include columns)
                const taskIncludeBasePath = task.includeContext?.includeDir || columnIncludeBasePath;

                // Check task title (use include base path if available)
                this._extractFromContent(task.title, taskTitleLocation, elements, taskIncludeBasePath);

                // Check task-level includes
                if (task.includeFiles && task.includeFiles.length > 0) {
                    this._pushIncludeElements(elements, task.includeFiles, taskTitleLocation);
                }

                // Check task description
                if (task.description) {
                    const taskDescriptionLocation = this._buildTaskLocation(column, task, 'description');
                    // Use include context's directory if available (for correct relative path resolution)
                    const includeBasePath = task.includeContext?.includeDir || columnIncludeBasePath;
                    this._extractFromContent(task.description, taskDescriptionLocation, elements, includeBasePath);

                    // Check regular includes in description
                    if (task.regularIncludeFiles && task.regularIncludeFiles.length > 0) {
                        this._pushIncludeElements(elements, task.regularIncludeFiles, taskDescriptionLocation);
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
        const brokenKeys = new Set<string>();

        const buildKey = (element: ExtractedElement): string => {
            const location = element.location;
            return [
                element.type,
                element.path,
                location.columnId,
                location.taskId || '',
                location.field
            ].join('|');
        };

        const pushBroken = (element: ExtractedElement, resolvedPath?: string): void => {
            const key = buildKey(element);
            if (brokenKeys.has(key)) {
                return;
            }
            brokenKeys.add(key);
            broken.push({
                ...element,
                exists: false,
                resolvedPath
            });
        };

        for (const element of elements) {
            // Skip URLs
            if (isUrl(element.path)) {
                continue;
            }

            // Use element's resolveBasePath if available (for include file content),
            // otherwise fall back to the main basePath
            const effectiveBasePath = element.resolveBasePath || this._basePath;
            const resolvedPath = this._resolvePathWithBase(element.path, effectiveBasePath);
            const exists = fs.existsSync(resolvedPath);

            if (!exists) {
                pushBroken(element, resolvedPath);
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
                    const columnLocation = this._buildColumnLocation(column, 'columnTitle');
                    for (const includePath of column.includeFiles) {
                        const resolvedPath = this._resolvePath(includePath);
                        if (!fs.existsSync(resolvedPath)) {
                            pushBroken({
                                type: 'include',
                                path: includePath,
                                rawMatch: `!!!include(${includePath})!!!`,
                                location: columnLocation
                            }, resolvedPath);
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
                        const taskLocation = this._buildTaskLocation(column, task, 'taskTitle');
                        for (const includePath of task.includeFiles) {
                            const resolvedPath = this._resolvePath(includePath);
                            if (!fs.existsSync(resolvedPath)) {
                                pushBroken({
                                    type: 'include',
                                    path: includePath,
                                    rawMatch: `!!!include(${includePath})!!!`,
                                    location: taskLocation
                                }, resolvedPath);
                            }
                        }
                    }
                }
            }
        }

        return broken;
    }

    /**
     * Strip internal tag references from content so that wiki-link references
     * like [[#tag]] and markdown link references like [text](#tag) don't
     * produce false-positive search matches when searching for a tag.
     */
    private _stripInternalTagRefs(content: string, tag: string): string {
        // Escape special regex characters in the tag
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Remove [[#tag]] wiki-link references (case-insensitive)
        let stripped = content.replace(new RegExp(`\\[\\[${escaped}\\]\\]`, 'gi'), '');
        // Remove [text](#tag) markdown link references — remove the (#tag) part
        stripped = stripped.replace(new RegExp(`\\]\\(${escaped}\\)`, 'gi'), ']()');
        return stripped;
    }

    /**
     * Search for text in board content
     */
    searchText(board: KanbanBoard, query: string, includeContentByPath?: Map<string, string>): TextMatch[] {
        if (!query || query.length === 0) {
            return [];
        }

        const matches: TextMatch[] = [];
        const lowerQuery = query.toLowerCase();
        // When the query is an internal tag (starts with #), strip wiki-link
        // references so that [[#tag]] / [text](#tag) don't match themselves,
        // and use whole-word matching so #1 doesn't match inside #10.
        const isTagQuery = query.startsWith('#');
        // Tags are space-delimited: #1 must not match #10, #1.1, #1a, etc.
        // Match only when followed by whitespace or end-of-string.
        const tagRegex = isTagQuery
            ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'im')
            : null;

        const matchesContent = (text: string): boolean => {
            if (tagRegex) {
                return tagRegex.test(text);
            }
            return text.toLowerCase().includes(lowerQuery);
        };

        for (const column of board.columns) {
            // Search column title
            const columnTitle = this._getColumnTitle(column);
            const searchableColumnTitle = isTagQuery ? this._stripInternalTagRefs(columnTitle, query) : columnTitle;
            if (matchesContent(searchableColumnTitle)) {
                matches.push({
                    matchText: query,
                    context: this._buildSearchContext(columnTitle, lowerQuery),
                    location: this._buildColumnLocation(column, 'columnTitle')
                });
            }

            // Search tasks
            for (const task of column.tasks) {
                const taskTitle = this._getTaskTitle(task);

                // Search task title
                const searchableTaskTitle = isTagQuery ? this._stripInternalTagRefs(taskTitle, query) : taskTitle;
                if (matchesContent(searchableTaskTitle)) {
                    matches.push({
                        matchText: query,
                        context: this._buildSearchContext(taskTitle, lowerQuery),
                        location: this._buildTaskLocation(column, task, 'taskTitle')
                    });
                }

                // Search task description
                if (task.description) {
                    const searchableDesc = isTagQuery ? this._stripInternalTagRefs(task.description, query) : task.description;
                    if (matchesContent(searchableDesc)) {
                        matches.push({
                            matchText: query,
                            context: this._buildSearchContext(task.description, lowerQuery),
                            location: this._buildTaskLocation(column, task, 'description')
                        });
                    }
                }

                if (includeContentByPath && task.regularIncludeFiles && task.regularIncludeFiles.length > 0) {
                    for (const includePath of task.regularIncludeFiles) {
                        // _resolvePath already handles URL decoding
                        const resolvedPath = this._resolvePath(includePath);
                        const includeContent = includeContentByPath.get(resolvedPath);

                        if (includeContent) {
                            const searchableInclude = isTagQuery ? this._stripInternalTagRefs(includeContent, query) : includeContent;
                            if (matchesContent(searchableInclude)) {
                                const context = this._buildSearchContext(includeContent, lowerQuery);
                                matches.push({
                                    matchText: query,
                                    context: `include: ${includePath}\n${context}`,
                                    location: this._buildTaskLocation(column, task, 'description')
                                });
                            }
                        }
                    }
                }
            }
        }

        return matches;
    }

    /**
     * Extract elements from a content string
     * @param content - The content to extract from
     * @param location - Location info for the extracted elements
     * @param elements - Array to push extracted elements to
     * @param resolveBasePath - Optional base path for resolving relative paths (e.g., include file directory)
     */
    private _extractFromContent(
        content: string,
        location: ElementLocation,
        elements: ExtractedElement[],
        resolveBasePath?: string
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
                    location,
                    resolveBasePath
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
                    location,
                    resolveBasePath
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
                    location,
                    resolveBasePath
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
                    location,
                    resolveBasePath
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
                location,
                resolveBasePath
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
     * Resolve a relative path to absolute using the scanner's base path
     * Handles URL-encoded paths (e.g., path%20with%20spaces.md)
     */
    private _resolvePath(relativePath: string): string {
        return this._resolvePathWithBase(relativePath, this._basePath);
    }

    /**
     * Resolve a relative path to absolute using a custom base path
     * Handles URL-encoded paths (e.g., path%20with%20spaces.md)
     * Handles markdown escape sequences (e.g., \' -> ', \" -> ")
     * Handles workspace-relative paths (e.g., Sammelsurium/subfolder/file.pdf)
     */
    private _resolvePathWithBase(relativePath: string, basePath: string): string {
        // Decode URL-encoded characters first
        let decodedPath = safeDecodeURIComponent(relativePath);

        // Unescape markdown escape sequences (e.g., \' -> ', \" -> ", \[ -> [, etc.)
        // These characters might be escaped in markdown image/link paths
        decodedPath = decodedPath.replace(/\\(['"()\[\]\\])/g, '$1');

        if (path.isAbsolute(decodedPath)) {
            return decodedPath;
        }

        // Handle ./ prefix
        const cleanPath = decodedPath.startsWith('./')
            ? decodedPath.substring(2)
            : decodedPath;

        // Check if path starts with a workspace folder name (workspace-relative path)
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            for (const folder of workspaceFolders) {
                const folderName = path.basename(folder.uri.fsPath);
                if (cleanPath.startsWith(folderName + '/') || cleanPath.startsWith(folderName + '\\')) {
                    // This is a workspace-relative path - resolve relative to workspace parent
                    const relativePart = cleanPath.substring(folderName.length + 1);
                    return path.resolve(folder.uri.fsPath, relativePart);
                }
            }
        }

        // Standard resolution: relative to base path
        const resolved = path.resolve(basePath, cleanPath);

        // If not found, also try workspace folders as fallback
        if (!fs.existsSync(resolved) && workspaceFolders) {
            for (const folder of workspaceFolders) {
                const candidate = path.resolve(folder.uri.fsPath, cleanPath);
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }

        return resolved;
    }

    /**
     * Build context around a match (for display)
     */
    private _buildSearchContext(content: string, lowerQuery: string): string {
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
