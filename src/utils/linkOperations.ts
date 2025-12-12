import { escapeRegExp } from './stringUtils';

/**
 * LinkOperations - Pure utility functions for link replacement operations
 *
 * This class provides static methods for replacing links in markdown text,
 * handling various link formats including regular links, wiki links, images,
 * and strikethrough links.
 *
 * State: manually verified.
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
     * Handles both already strikethrough and regular links properly
     *
     * @param text - The text containing links to replace
     * @param originalPath - The original path to search for
     * @param encodedNewPath - The new path to replace with
     * @param targetIndex - The index of the occurrence to replace (default: 0)
     * @returns The text with the specified link occurrence replaced
     */
    public static replaceSingleLink(text: string, originalPath: string, encodedNewPath: string, targetIndex: number = 0): string {
        if (!text) { return text; }

        // Escape special regex characters in the original path
        const escapedPath = escapeRegExp(originalPath);

        // Define all patterns we need to check
        const patterns = [
            // Already strikethrough patterns
            { regex: new RegExp(`~~(!\\[[^\\]]*\\]\\(${escapedPath}\\))~~`, 'g'), type: 'strikeImage' },
            { regex: new RegExp(`~~(\\[[^\\]]+\\]\\(${escapedPath}\\))~~`, 'g'), type: 'strikeLink' },
            { regex: new RegExp(`~~(\\[\\[\\s*${escapedPath}(?:\\|[^\\]]*)?\\]\\])~~`, 'g'), type: 'strikeWiki' },
            { regex: new RegExp(`~~(<${escapedPath}>)~~`, 'g'), type: 'strikeAuto' },
            // Regular patterns
            { regex: new RegExp(`(!\\[[^\\]]*\\]\\(${escapedPath}\\))`, 'g'), type: 'image' },
            { regex: new RegExp(`(^|[^!])(\\[[^\\]]+\\]\\(${escapedPath}\\))`, 'gm'), type: 'link' },
            { regex: new RegExp(`(\\[\\[\\s*${escapedPath}(?:\\|[^\\]]*)?\\]\\])`, 'g'), type: 'wiki' },
            { regex: new RegExp(`(<${escapedPath}>)`, 'g'), type: 'auto' }
        ];

        // Find all matches with their positions
        const allMatches = [];
        for (const pattern of patterns) {
            let match;
            const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
            while ((match = regex.exec(text)) !== null) {
                // For angle bracket links, validate that they're actual links (not HTML tags)
                if (pattern.type === 'auto' || pattern.type === 'strikeAuto') {
                    // Extract content between angle brackets
                    const content = originalPath; // The path we're searching for
                    if (!this.isActualLink(content)) {
                        // Skip this match - it's likely an HTML tag like <hr> or <br>
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

        // Remove nested matches - if we have both ~~![image]~~ and ![image], remove the inner one
        const filteredMatches = [];
        for (const match of allMatches) {
            // Check if this match is contained within any other match
            const isNested = allMatches.some(other =>
                other !== match &&
                other.start < match.start &&
                other.end > match.end &&
                (other.type.startsWith('strike') && !match.type.startsWith('strike'))
            );

            if (!isNested) {
                filteredMatches.push(match);
            }
        }

        filteredMatches.forEach((match, i) => {
        });

        // Check if targetIndex is valid (using filtered matches)
        if (targetIndex >= 0 && targetIndex < filteredMatches.length) {
            const targetMatch = filteredMatches[targetIndex];
            return this.replaceMatchAtPosition(text, targetMatch, originalPath, encodedNewPath);
        } else if (filteredMatches.length > 0) {
            // Fallback: replace first match
            const targetMatch = filteredMatches[0];
            return this.replaceMatchAtPosition(text, targetMatch, originalPath, encodedNewPath);
        }

        // No matches found
        return text;
    }

    /**
     * Replace a specific match at its exact position with the new path
     * Uses position-based slicing instead of pattern-based replacement to avoid replacing wrong occurrences
     *
     * @param text - The text containing the link to replace
     * @param matchInfo - Information about the match including position and type
     * @param originalPath - The original path being replaced
     * @param encodedNewPath - The new path to replace with
     * @returns The text with the link replaced at the specific position
     */
    public static replaceMatchAtPosition(text: string, matchInfo: any, originalPath: string, encodedNewPath: string): string {
        const { match, type, start, end } = matchInfo;
        const escapedPath = escapeRegExp(originalPath);

        let replacement = '';

        switch (type) {
            case 'strikeImage': {
                const imageLink = match[1];
                const newImageLink = imageLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                replacement = `~~${imageLink}~~ ${newImageLink}`;
                break;
            }
            case 'strikeLink': {
                const regularLink = match[1];
                const newRegularLink = regularLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                replacement = `~~${regularLink}~~ ${newRegularLink}`;
                break;
            }
            case 'strikeWiki': {
                const wikiLink = match[1];
                const newWikiLink = wikiLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                replacement = `~~${wikiLink}~~ ${newWikiLink}`;
                break;
            }
            case 'strikeAuto': {
                const autoLink = match[1];
                const newAutoLink = `<${encodedNewPath}>`;
                replacement = `~~${autoLink}~~ ${newAutoLink}`;
                break;
            }
            case 'image': {
                const imageLink = match[1];
                const newImageLink = imageLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                replacement = `~~${imageLink}~~ ${newImageLink}`;
                break;
            }
            case 'link': {
                const before = match[1];
                const regularLink = match[2];
                const newRegularLink = regularLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                replacement = `${before}~~${regularLink}~~ ${newRegularLink}`;
                break;
            }
            case 'wiki': {
                const wikiLink = match[1];
                const newWikiLink = wikiLink.replace(new RegExp(escapedPath, 'g'), encodedNewPath);
                replacement = `~~${wikiLink}~~ ${newWikiLink}`;
                break;
            }
            case 'auto': {
                const autoLink = match[1];
                const newAutoLink = `<${encodedNewPath}>`;
                replacement = `~~${autoLink}~~ ${newAutoLink}`;
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
