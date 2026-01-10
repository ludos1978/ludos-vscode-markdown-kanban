import type MarkdownIt from 'markdown-it';
import { parseMarkdownItTokens } from './tokenParser';
import { MarkdownItToken, WysiwygDoc } from './types';
import { createWysiwygMarkdownIt, WysiwygMarkdownItOptions } from './markdownItFactory';

export function parseMarkdownToTokens(markdown: string, md?: MarkdownIt): MarkdownItToken[] {
    const parser = md ?? createWysiwygMarkdownIt();
    return parser.parse(markdown ?? '', {}) as unknown as MarkdownItToken[];
}

export function parseMarkdownToWysiwygDoc(markdown: string, md?: MarkdownIt): WysiwygDoc {
    return parseMarkdownItTokens(parseMarkdownToTokens(markdown, md));
}

export function createWysiwygMarkdownParser(options: WysiwygMarkdownItOptions = {}) {
    const md = createWysiwygMarkdownIt(options);

    return {
        md,
        parseTokens: (markdown: string) => parseMarkdownToTokens(markdown, md),
        parseDoc: (markdown: string) => parseMarkdownToWysiwygDoc(markdown, md)
    };
}
