/**
 * TextMatcher - Shared text matching utility for search services
 *
 * Provides three matching modes:
 * - substring: case-insensitive substring match (default)
 * - tag: exact tag boundary match (#tag must not match #tag2)
 * - regex: user-provided regular expression
 *
 * Also provides canonical tag extraction and internal tag reference stripping.
 *
 * @module utils/textMatcher
 */

export type MatchMode = 'substring' | 'tag' | 'regex';

export interface TextMatcherOptions {
    mode?: MatchMode;
    caseSensitive?: boolean;
    useRegex?: boolean;
}

export class TextMatcher {
    private _query: string;
    private _mode: MatchMode;
    private _caseSensitive: boolean;
    private _lowerQuery: string;
    private _tagRegex: RegExp | null = null;
    private _userRegex: RegExp | null = null;
    private _regexError: string | null = null;

    /**
     * @param query - The search string
     * @param options - Matching options. If `useRegex` is true, forces regex mode.
     *   Otherwise, tag mode is auto-detected when query starts with `#`, `@`, or `!`.
     */
    constructor(query: string, options?: TextMatcherOptions) {
        this._query = query;
        this._caseSensitive = options?.caseSensitive ?? false;
        this._lowerQuery = query.toLowerCase();

        // Determine mode
        if (options?.useRegex) {
            this._mode = 'regex';
        } else if (options?.mode) {
            this._mode = options.mode;
        } else {
            // Auto-detect: tag mode for queries starting with #, @, or !
            this._mode = /^[#@!]/.test(query) ? 'tag' : 'substring';
        }

        // Pre-compile regex for the chosen mode
        if (this._mode === 'tag') {
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            this._tagRegex = new RegExp(escaped + '(?=\\s|$)', this._caseSensitive ? 'm' : 'im');
        } else if (this._mode === 'regex') {
            try {
                this._userRegex = new RegExp(query, this._caseSensitive ? '' : 'i');
            } catch (e) {
                this._userRegex = null;
                this._regexError = e instanceof Error ? e.message : 'Invalid regular expression';
            }
        }
    }

    get mode(): MatchMode {
        return this._mode;
    }

    get query(): string {
        return this._query;
    }

    get isTagMode(): boolean {
        return this._mode === 'tag';
    }

    /** Non-null when regex mode failed to compile the pattern. */
    get regexError(): string | null {
        return this._regexError;
    }

    /**
     * Find the index and length of the first match in `text`.
     * Returns `{ index, length }` or `null` if no match.
     * Useful for building context snippets around the match.
     */
    findMatchIndex(text: string): { index: number; length: number } | null {
        if (!text) {
            return null;
        }

        switch (this._mode) {
            case 'tag': {
                const m = this._tagRegex!.exec(text);
                return m ? { index: m.index, length: m[0].length } : null;
            }
            case 'regex': {
                if (!this._userRegex) { return null; }
                const m = this._userRegex.exec(text);
                return m ? { index: m.index, length: m[0].length } : null;
            }
            case 'substring':
            default: {
                const haystack = this._caseSensitive ? text : text.toLowerCase();
                const needle = this._caseSensitive ? this._query : this._lowerQuery;
                const idx = haystack.indexOf(needle);
                return idx >= 0 ? { index: idx, length: needle.length } : null;
            }
        }
    }

    /**
     * Test whether `text` matches the query according to the configured mode.
     */
    matches(text: string): boolean {
        if (!text) {
            return false;
        }

        switch (this._mode) {
            case 'tag':
                return this._tagRegex!.test(text);

            case 'regex':
                return this._userRegex ? this._userRegex.test(text) : false;

            case 'substring':
            default:
                if (this._caseSensitive) {
                    return text.includes(this._query);
                }
                return text.toLowerCase().includes(this._lowerQuery);
        }
    }

    /**
     * Strip internal tag references from content so that wiki-link references
     * like [[#tag]] and markdown link references like [text](#tag) don't
     * produce false-positive search matches when searching for a tag.
     */
    static stripInternalTagRefs(content: string, tag: string): string {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Remove [[#tag]] wiki-link references (case-insensitive)
        let stripped = content.replace(new RegExp(`\\[\\[${escaped}\\]\\]`, 'gi'), '');
        // Remove [text](#tag) markdown link references -- remove the (#tag) part
        stripped = stripped.replace(new RegExp(`\\]\\(${escaped}\\)`, 'gi'), ']()');
        return stripped;
    }

    /**
     * Canonical tag extraction matching the frontend tagUtils.js patterns.
     *
     * Extracts #tags, @mentions, and !temporal tags from text.
     * Layout tags are excluded by default (row, span, stack, sticky, fold, archive, hidden, include:).
     */
    static extractTags(text: string): { name: string; type: 'hash' | 'person' | 'temporal' }[] {
        const tags: { name: string; type: 'hash' | 'person' | 'temporal' }[] = [];

        // Hash tags: #tag (everything after # until whitespace) - matches frontend basicTags pattern
        const hashMatches = text.matchAll(/#([^\s]+)/g);
        for (const match of hashMatches) {
            const tag = match[1].toLowerCase();
            // Skip layout tags
            if (/^(row\d*|span\d*|stack|sticky|fold|archive|hidden|include:)/i.test(tag)) {
                continue;
            }
            tags.push({ name: '#' + tag, type: 'hash' });
        }

        // Person tags: @person
        const personMatches = text.matchAll(/@([^\s]+)/g);
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
     * Strict equality check for tag matching.
     * Compares lowercased tag names for exact equality.
     *
     * Use this instead of `.includes()` to prevent `#1` from matching `#10`.
     */
    static tagExactMatch(tagName: string, searchTag: string): boolean {
        return tagName.toLowerCase() === searchTag.toLowerCase();
    }
}
