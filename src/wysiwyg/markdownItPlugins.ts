import type MarkdownIt from 'markdown-it';

export type WikiLinksOptions = {
    className?: string;
};

export function wikiLinksPlugin(md: MarkdownIt, options: WikiLinksOptions = {}): void {
    const { className = 'wiki-link' } = options;

    function parseWikiLink(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (pos + 1 >= state.posMax) { return false; }
        if (state.src.charCodeAt(pos) !== 0x5B /* [ */) { return false; }
        if (state.src.charCodeAt(pos + 1) !== 0x5B /* [ */) { return false; }

        pos += 2;

        let found = false;
        let content = '';
        const contentStart = pos;

        while (pos < state.posMax) {
            if (state.src.charCodeAt(pos) === 0x5D /* ] */ &&
                pos + 1 < state.posMax &&
                state.src.charCodeAt(pos + 1) === 0x5D /* ] */) {
                found = true;
                content = state.src.slice(contentStart, pos);
                break;
            }
            pos += 1;
        }

        if (!found) { return false; }

        const parts = content.split('|');
        const document = parts[0].trim();
        const title = parts[1] ? parts[1].trim() : document;

        if (!document) { return false; }

        state.pos = pos + 2;

        if (silent) { return true; }

        const tokenOpen = state.push('wiki_link_open', 'a', 1);
        tokenOpen.attrSet('href', '#');
        if (className) { tokenOpen.attrSet('class', className); }
        tokenOpen.attrSet('data-document', document);
        tokenOpen.attrSet('title', `Wiki link: ${document}`);

        const tokenText = state.push('text', '', 0);
        tokenText.content = title;

        state.push('wiki_link_close', 'a', -1);

        return true;
    }

    md.inline.ruler.before('link', 'wiki_link', parseWikiLink);
}

export type TagPluginOptions = {
    prefix?: string;
};

export function tagPlugin(md: MarkdownIt, options: TagPluginOptions = {}): void {
    const prefix = options.prefix ?? '#';
    const prefixCode = prefix.charCodeAt(0);

    function parseTag(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (state.src.charCodeAt(pos) !== prefixCode) { return false; }
        if (pos > 0 && state.src.charCodeAt(pos - 1) !== 0x20 /* space */ &&
            state.src.charCodeAt(pos - 1) !== 0x0A /* newline */ &&
            state.src.charCodeAt(pos - 1) !== 0x09 /* tab */ &&
            pos !== 0) {
            return false;
        }

        if (pos === 0 || state.src.charCodeAt(pos - 1) === 0x0A /* newline */) {
            const nextChar = state.src.charCodeAt(pos + 1);
            if (nextChar === 0x20 /* space */ || nextChar === prefixCode) {
                return false;
            }
        }

        pos += 1;
        if (pos >= state.posMax) { return false; }

        const tagStart = pos;
        let tagContent = '';

        const remaining = state.src.slice(pos);
        const positivityMatch = remaining.match(/^(\+\+|\+|\u00f8|\u00d8|--|-(?!-))/);
        if (positivityMatch) {
            tagContent = positivityMatch[1];
            pos += tagContent.length;
        } else if (state.src.substr(pos, 7) === 'gather_') {
            while (pos < state.posMax) {
                const char = state.src.charCodeAt(pos);
                if (char === 0x20 || char === 0x0A || char === 0x09) { break; }
                pos += 1;
            }
            tagContent = state.src.slice(tagStart, pos);
        } else {
            while (pos < state.posMax) {
                const char = state.src.charCodeAt(pos);
                if ((char >= 0x30 && char <= 0x39) ||
                    (char >= 0x41 && char <= 0x5A) ||
                    (char >= 0x61 && char <= 0x7A) ||
                    char === 0x5F ||
                    char === 0x2D ||
                    char === 0x2E) {
                    pos += 1;
                } else {
                    break;
                }
            }
            tagContent = state.src.slice(tagStart, pos);
        }

        if (tagContent.length === 0) { return false; }

        state.pos = pos;

        if (silent) { return true; }

        const token = state.push('tag', 'span', 0);
        token.content = tagContent;
        token.markup = prefix;

        return true;
    }

    md.inline.ruler.before('emphasis', 'tag', parseTag);
}

export type DatePersonTagOptions = {
    prefix?: string;
};

export function datePersonTagPlugin(md: MarkdownIt, options: DatePersonTagOptions = {}): void {
    const prefix = options.prefix ?? '@';
    const prefixCode = prefix.charCodeAt(0);

    function parseDatePersonTag(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (state.src.charCodeAt(pos) !== prefixCode) { return false; }
        if (pos > 0 && state.src.charCodeAt(pos - 1) !== 0x20 /* space */ &&
            state.src.charCodeAt(pos - 1) !== 0x0A /* newline */ &&
            state.src.charCodeAt(pos - 1) !== 0x09 /* tab */ &&
            pos !== 0) { return false; }

        pos += 1;
        if (pos >= state.posMax) { return false; }

        const tagStart = pos;
        let tagContent = '';
        let tagType = '';

        const remaining = state.src.slice(pos);
        const weekMatch = remaining.match(/^(\d{4}-?W\d{1,2}|W\d{1,2})/i);

        if (weekMatch) {
            tagContent = weekMatch[1];
            tagType = 'week';
            pos += tagContent.length;
        } else {
            const dateMatch = remaining.match(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/);
            if (dateMatch) {
                tagContent = dateMatch[1];
                tagType = 'date';
                pos += tagContent.length;
            } else {
                while (pos < state.posMax) {
                    const char = state.src.charCodeAt(pos);
                    if ((char >= 0x30 && char <= 0x39) ||
                        (char >= 0x41 && char <= 0x5A) ||
                        (char >= 0x61 && char <= 0x7A) ||
                        char === 0x5F ||
                        char === 0x2D) {
                        pos += 1;
                    } else {
                        break;
                    }
                }

                if (pos === tagStart) { return false; }

                tagContent = state.src.slice(tagStart, pos);
                tagType = 'person';
            }
        }

        state.pos = pos;

        if (silent) { return true; }

        const token = state.push('date_person_tag', 'span', 0);
        token.content = tagContent;
        token.markup = prefix;
        token.meta = { type: tagType };

        return true;
    }

    md.inline.ruler.before('emphasis', 'date_person_tag', parseDatePersonTag);
}

export type TemporalTagOptions = {
    prefix?: string;
};

export function temporalTagPlugin(md: MarkdownIt, options: TemporalTagOptions = {}): void {
    const prefix = options.prefix ?? '!';
    const prefixCode = prefix.charCodeAt(0);

    function parseTemporalTag(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (state.src.charCodeAt(pos) !== prefixCode) { return false; }

        if (pos > 0) {
            const prevChar = state.src.charCodeAt(pos - 1);
            if (prevChar !== 0x20 /* space */ && prevChar !== 0x0A /* newline */ && prevChar !== 0x09 /* tab */) {
                return false;
            }
        }

        pos += 1;
        if (pos >= state.posMax) { return false; }

        const remaining = state.src.slice(pos);
        let tagContent = '';
        let tagType = '';

        const timeSlotMatch = remaining.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)-(\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)/i);
        if (timeSlotMatch) {
            tagContent = timeSlotMatch[0];
            tagType = 'timeSlot';
            pos += tagContent.length;
        } else {
            const weekYearMatch = remaining.match(/^(\d{4})[-.]?[wW](\d{1,2})(?=\s|$)/);
            if (weekYearMatch) {
                tagContent = weekYearMatch[0];
                tagType = 'week';
                pos += tagContent.length;
            } else {
                const weekMatch = remaining.match(/^[wW](\d{1,2})(?=\s|$)/);
                if (weekMatch) {
                    tagContent = weekMatch[0];
                    tagType = 'week';
                    pos += tagContent.length;
                } else {
                    const dateMatch = remaining.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?=\s|$)/);
                    if (dateMatch) {
                        tagContent = dateMatch[0];
                        tagType = 'date';
                        pos += tagContent.length;
                    } else {
                        const weekdayMatch = remaining.match(/^(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(?=\s|$)/i);
                        if (weekdayMatch) {
                            tagContent = weekdayMatch[0];
                            tagType = 'weekday';
                            pos += tagContent.length;
                        } else {
                            const minuteSlotMatch = remaining.match(/^:(\d{1,2})-:(\d{1,2})(?=\s|$)/i);
                            if (minuteSlotMatch) {
                                tagContent = minuteSlotMatch[0];
                                tagType = 'minuteSlot';
                                pos += tagContent.length;
                            } else {
                                const timeMatch = remaining.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)/i);
                                if (timeMatch) {
                                    tagContent = timeMatch[0];
                                    tagType = 'time';
                                    pos += tagContent.length;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!tagContent) { return false; }

        state.pos = pos;

        if (silent) { return true; }

        const token = state.push('temporal_tag', 'span', 0);
        token.content = tagContent;
        token.markup = prefix;
        token.meta = { type: tagType };

        return true;
    }

    md.inline.ruler.before('emphasis', 'temporal_tag', parseTemporalTag);
}

export function speakerNotePlugin(md: MarkdownIt): void {
    function parseSpeakerNote(state: any, startLine: number, endLine: number, silent: boolean): boolean {
        let pos = state.bMarks[startLine] + state.tShift[startLine];
        let max = state.eMarks[startLine];

        if (pos + 1 >= max) { return false; }
        if (state.src.charCodeAt(pos) !== 0x3B /* ; */) { return false; }
        if (state.src.charCodeAt(pos + 1) !== 0x3B /* ; */) { return false; }

        if (silent) { return true; }

        const lines: string[] = [];
        let nextLine = startLine;

        while (nextLine < endLine) {
            const linePos = state.bMarks[nextLine] + state.tShift[nextLine];
            const lineMax = state.eMarks[nextLine];

            if (linePos + 1 < lineMax &&
                state.src.charCodeAt(linePos) === 0x3B /* ; */ &&
                state.src.charCodeAt(linePos + 1) === 0x3B /* ; */) {
                const content = state.src.slice(linePos + 2, lineMax).trim();
                lines.push(content);
                nextLine += 1;
            } else {
                break;
            }
        }

        const token = state.push('speaker_note', 'div', 0);
        token.content = lines.join('\n');
        token.markup = ';;';

        state.line = nextLine;
        return true;
    }

    md.block.ruler.before('paragraph', 'speaker_note', parseSpeakerNote);
}

export function htmlCommentPlugin(md: MarkdownIt): void {
    function parseHtmlComment(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (pos + 3 >= state.posMax) { return false; }
        if (state.src.charCodeAt(pos) !== 0x3C /* < */) { return false; }
        if (state.src.charCodeAt(pos + 1) !== 0x21 /* ! */) { return false; }
        if (state.src.charCodeAt(pos + 2) !== 0x2D /* - */) { return false; }
        if (state.src.charCodeAt(pos + 3) !== 0x2D /* - */) { return false; }

        pos += 4;

        let found = false;
        let content = '';
        const contentStart = pos;

        while (pos < state.posMax - 2) {
            if (state.src.charCodeAt(pos) === 0x2D /* - */ &&
                state.src.charCodeAt(pos + 1) === 0x2D /* - */ &&
                state.src.charCodeAt(pos + 2) === 0x3E /* > */) {
                found = true;
                content = state.src.slice(contentStart, pos);
                break;
            }
            pos += 1;
        }

        if (!found) { return false; }

        state.pos = pos + 3;

        if (silent) { return true; }

        const token = state.push('html_comment', 'span', 0);
        token.content = content.trim();
        token.markup = '<!--';

        return true;
    }

    function parseHtmlCommentBlock(state: any, startLine: number, _endLine: number, silent: boolean): boolean {
        const pos = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        const savedPos = state.pos;
        const savedPosMax = state.posMax;

        state.pos = pos;
        state.posMax = max;

        const matched = parseHtmlComment(state, silent);
        if (matched) {
            state.line = startLine + 1;
        }

        state.pos = savedPos;
        state.posMax = savedPosMax;

        return matched;
    }

    md.inline.ruler.before('html_inline', 'html_comment', parseHtmlComment);
    md.block.ruler.before('html_block', 'html_comment_block', parseHtmlCommentBlock);
}

export type IncludePluginOptions = {
    includeRe?: RegExp;
};

export function includePlugin(md: MarkdownIt, options: IncludePluginOptions = {}): void {
    const includeRe = options.includeRe ?? /!!!include\(([^)]+)\)!!!/;

    md.block.ruler.before('paragraph', 'include_block', function includeBlock(state: any, startLine: number, endLine: number, silent: boolean) {
        const pos = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        const lineText = state.src.slice(pos, max).trim();

        const match = lineText.match(includeRe);
        if (!match || match.index !== 0 || match[0] !== lineText) {
            return false;
        }

        if (silent) { return true; }

        const filePath = match[1].trim();
        const token = state.push('include_block', 'div', 0);
        token.content = '';
        token.filePath = filePath;
        token.map = [startLine, startLine + 1];

        state.line = startLine + 1;
        return true;
    });

    md.inline.ruler.before('text', 'include_inline', function includeInline(state: any, silent: boolean) {
        const start = state.pos;
        const srcSlice = state.src.slice(start);
        const match = srcSlice.match(includeRe);
        if (!match || match.index !== 0) {
            return false;
        }

        state.pos = start + match[0].length;

        if (silent) {
            return true;
        }

        const filePath = match[1].trim();
        const token = state.push('include_content', 'span', 0);
        token.content = '';
        token.attrSet('class', 'included-content-inline');
        token.attrSet('data-include-file', filePath);

        return true;
    });
}
