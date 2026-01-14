import { escapeRegExp } from './stringUtils';

/**
 * Types of link patterns that can be matched
 */
type LinkMatchType = 'image' | 'link' | 'wiki' | 'auto' | 'include';

/**
 * Information about a matched link in the text
 */
interface LinkMatchInfo {
    match: RegExpExecArray;
    start: number;
    end: number;
    type: LinkMatchType;
    fullMatch: string;
}

/**
 * LinkOperations - Pure utility functions for link replacement operations
 *
 * This class provides static methods for replacing links in markdown text,
 * handling various link formats including regular links, wiki links, images,
 * and include statements.
 *
 * Replacements are done in-place (old link is replaced with new link).
 * Undo is handled by VS Code's document undo system.
 */
export class LinkOperations {
    /**
     * Check if content in angle brackets is an actual link (not HTML tag)
     * A link must have:
     * - A file extension (e.g., .md, .txt, .png)
     * - A path separator (/ or \)
     * - Start with http/https
     *
     * @param content - The content between angle brackets
     * @returns true if it's a link, false if it's likely an HTML tag
     */
    private static isActualLink(content: string): boolean {
        if (!content) { return false; }

        const trimmed = content.trim();

        // Has file extension (e.g., file.md, image.png)
        if (/\.[a-zA-Z0-9]+$/.test(trimmed)) {
            return true;
        }

        // Has path separator (/ or \)
        if (trimmed.includes('/') || trimmed.includes('\\')) {
            return true;
        }

        // Starts with http:// or https://
        if (/^https?:\/\//i.test(trimmed)) {
            return true;
        }

        // Otherwise, it's likely an HTML tag like <hr>, <br>, etc.
        return false;
    }

    /**
     * Replace only the specific occurrence (by index) of a specific link in text
     * Simply replaces the old path with the new path (no strikethrough).
     *
     * @param text - The text containing links to replace
     * @param originalPath - The original path to search for
     * @param encodedNewPath - The new path to replace with
     * @param targetIndex - The index of the occurrence to replace (default: 0)
     * @returns The text with the specified link occurrence replaced
     */
    public static replaceSingleLink(text: string, originalPath: string, encodedNewPath: string, targetIndex: number = 0): string {
        if (!text) { return text; }
        if (!originalPath || !originalPath.trim()) {
            return this.replaceEmptyLink(text, encodedNewPath, targetIndex);
        }

        // Escape special regex characters in the original path
        const escapedPath = escapeRegExp(originalPath);

        // Define all patterns we need to check
        const patterns: { regex: RegExp; type: LinkMatchType }[] = [
            // Image: ![alt](path)
            { regex: new RegExp(`(!\\[[^\\]]*\\]\\(${escapedPath}\\))`, 'g'), type: 'image' },
            // Regular link: [text](path) - but not images (negative lookbehind for !)
            { regex: new RegExp(`(^|[^!])(\\[[^\\]]+\\]\\(${escapedPath}\\))`, 'gm'), type: 'link' },
            // Wiki link: [[path]] or [[path|alias]]
            { regex: new RegExp(`(\\[\\[\\s*${escapedPath}(?:\\|[^\\]]*)?\\]\\])`, 'g'), type: 'wiki' },
            // Auto link: <path>
            { regex: new RegExp(`(<${escapedPath}>)`, 'g'), type: 'auto' },
            // Include: !!!include(path)!!!
            { regex: new RegExp(`(!!!include\\(${escapedPath}\\)!!!)`, 'g'), type: 'include' }
        ];

        // Find all matches with their positions
        const allMatches: LinkMatchInfo[] = [];
        for (const pattern of patterns) {
            let match;
            const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
            while ((match = regex.exec(text)) !== null) {
                // For angle bracket links, validate that they're actual links (not HTML tags)
                if (pattern.type === 'auto') {
                    const content = originalPath;
                    if (!this.isActualLink(content)) {
                        if (match.index === regex.lastIndex) {
                            regex.lastIndex++;
                        }
                        continue;
                    }
                }

                allMatches.push({
                    match: match,
                    start: match.index,
                    end: match.index + match[0].length,
                    type: pattern.type,
                    fullMatch: match[0]
                });
                // Prevent infinite loops on zero-width matches
                if (match.index === regex.lastIndex) {
                    regex.lastIndex++;
                }
            }
        }

        // Sort matches by position
        allMatches.sort((a, b) => a.start - b.start);

        // Check if targetIndex is valid
        if (targetIndex >= 0 && targetIndex < allMatches.length) {
            const targetMatch = allMatches[targetIndex];
            return this.replaceMatchAtPosition(text, targetMatch, originalPath, encodedNewPath);
        } else if (allMatches.length > 0) {
            // Fallback: replace first match
            const targetMatch = allMatches[0];
            return this.replaceMatchAtPosition(text, targetMatch, originalPath, encodedNewPath);
        }

        // No matches found
        return text;
    }

    /**
     * Replace an empty-path link occurrence (e.g., ![]()) with the new path.
     * This avoids zero-length regex replacements when originalPath is empty.
     */
    private static replaceEmptyLink(text: string, encodedNewPath: string, targetIndex: number = 0): string {
        if (!text) { return text; }

        const patterns: { regex: RegExp; type: LinkMatchType }[] = [
            // Image: ![alt]()
            { regex: /(!\[[^\]]*\]\(\s*\))/g, type: 'image' },
            // Regular link: [text]() - but not images (negative lookbehind for !)
            { regex: /(^|[^!])(\[[^\]]+\]\(\s*\))/gm, type: 'link' },
            // Wiki link: [[ ]] or [[|alias]]
            { regex: /(\[\[[^\]]*\]\])/g, type: 'wiki' },
            // Auto link: < >
            { regex: /(<\s*>)/g, type: 'auto' },
            // Include: !!!include()!!!
            { regex: /(!!!include\(\s*\)!!!)/g, type: 'include' }
        ];

        const allMatches: LinkMatchInfo[] = [];

        for (const pattern of patterns) {
            let match;
            const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
            while ((match = regex.exec(text)) !== null) {
                if (pattern.type === 'wiki') {
                    const wikiLink = match[1];
                    const inner = wikiLink.slice(2, -2);
                    const pipeIndex = inner.indexOf('|');
                    const pathPart = pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
                    if (pathPart.trim().length > 0) {
                        if (match.index === regex.lastIndex) {
                            regex.lastIndex++;
                        }
                        continue;
                    }
                }
                if (pattern.type === 'auto') {
                    const autoLink = match[1];
                    const inner = autoLink.slice(1, -1);
                    if (inner.trim().length > 0) {
                        if (match.index === regex.lastIndex) {
                            regex.lastIndex++;
                        }
                        continue;
                    }
                }

                allMatches.push({
                    match: match,
                    start: match.index,
                    end: match.index + match[0].length,
                    type: pattern.type,
                    fullMatch: match[0]
                });

                if (match.index === regex.lastIndex) {
                    regex.lastIndex++;
                }
            }
        }

        allMatches.sort((a, b) => a.start - b.start);

        if (targetIndex >= 0 && targetIndex < allMatches.length) {
            return this.replaceEmptyMatchAtPosition(text, allMatches[targetIndex], encodedNewPath);
        } else if (allMatches.length > 0) {
            return this.replaceEmptyMatchAtPosition(text, allMatches[0], encodedNewPath);
        }

        return text;
    }

    /**
     * Replace a specific empty-path match at its exact position with the new path.
     */
    private static replaceEmptyMatchAtPosition(text: string, matchInfo: LinkMatchInfo, encodedNewPath: string): string {
        const { match, type, start, end } = matchInfo;
        let replacement = '';

        switch (type) {
            case 'image': {
                const imageLink = match[1];
                replacement = imageLink.replace(/\(\s*\)/, `(${encodedNewPath})`);
                break;
            }
            case 'link': {
                const before = match[1];
                const regularLink = match[2];
                const newLink = regularLink.replace(/\(\s*\)/, `(${encodedNewPath})`);
                replacement = `${before}${newLink}`;
                break;
            }
            case 'wiki': {
                const wikiLink = match[1];
                const inner = wikiLink.slice(2, -2);
                const pipeIndex = inner.indexOf('|');
                const alias = pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : '';
                replacement = alias.length > 0
                    ? `[[${encodedNewPath}|${alias}]]`
                    : `[[${encodedNewPath}]]`;
                break;
            }
            case 'auto': {
                replacement = `<${encodedNewPath}>`;
                break;
            }
            case 'include': {
                replacement = `!!!include(${encodedNewPath})!!!`;
                break;
            }
            default:
                return text;
        }

        return text.slice(0, start) + replacement + text.slice(end);
    }

    /**
     * Replace a specific match at its exact position with the new path
     * Simply replaces the old link with the new link (no strikethrough).
     *
     * @param text - The text containing the link to replace
     * @param matchInfo - Information about the match including position and type
     * @param originalPath - The original path being replaced
     * @param encodedNewPath - The new path to replace with
     * @returns The text with the link replaced at the specific position
     */
    public static replaceMatchAtPosition(text: string, matchInfo: LinkMatchInfo, originalPath: string, encodedNewPath: string): string {
        const { match, type, start, end } = matchInfo;
        const escapedPath = escapeRegExp(originalPath);

        let replacement = '';

        switch (type) {
            case 'image': {
                // ![alt](oldPath) → ![alt](newPath)
                const imageLink = match[1];
                replacement = imageLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                break;
            }
            case 'link': {
                // [text](oldPath) → [text](newPath)
                // match[1] is the preceding character (or empty), match[2] is the link
                const before = match[1];
                const regularLink = match[2];
                const newLink = regularLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                replacement = `${before}${newLink}`;
                break;
            }
            case 'wiki': {
                // [[oldPath|alias]] → [[newPath|alias]]
                const wikiLink = match[1];
                replacement = wikiLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                break;
            }
            case 'auto': {
                // <oldPath> → <newPath>
                replacement = `<${encodedNewPath}>`;
                break;
            }
            case 'include': {
                // !!!include(oldPath)!!! → !!!include(newPath)!!!
                replacement = `!!!include(${encodedNewPath})!!!`;
                break;
            }
            default:
                return text;
        }

        // Use position-based replacement: slice before + replacement + slice after
        const result = text.slice(0, start) + replacement + text.slice(end);
        return result;
    }
}
