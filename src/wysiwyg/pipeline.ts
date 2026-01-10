import type MarkdownIt from 'markdown-it';
import { parseMarkdownToWysiwygDoc } from './markdownItAdapter';
import { createWysiwygMarkdownIt, WysiwygMarkdownItOptions } from './markdownItFactory';
import { WysiwygDoc } from './types';
import { serializeWysiwygDoc, WysiwygSerializerOptions } from './serializer';

export type WysiwygPipelineOptions = {
    markdownIt?: MarkdownIt;
    markdownItOptions?: WysiwygMarkdownItOptions;
    serializerOptions?: WysiwygSerializerOptions;
};

export function markdownToWysiwygDoc(markdown: string, options: WysiwygPipelineOptions = {}): WysiwygDoc {
    const md = options.markdownIt ?? createWysiwygMarkdownIt(options.markdownItOptions);
    return parseMarkdownToWysiwygDoc(markdown, md);
}

export function wysiwygDocToMarkdown(doc: WysiwygDoc, options: WysiwygPipelineOptions = {}): string {
    return serializeWysiwygDoc(doc, options.serializerOptions);
}

export function roundTripMarkdown(markdown: string, options: WysiwygPipelineOptions = {}): { doc: WysiwygDoc; markdown: string } {
    const doc = markdownToWysiwygDoc(markdown, options);
    const serialized = wysiwygDocToMarkdown(doc, options);
    return { doc, markdown: serialized };
}
