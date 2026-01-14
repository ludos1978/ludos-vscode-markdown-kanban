import type MarkdownIt from 'markdown-it';
import { parseMarkdownToWysiwygDoc } from './markdownItAdapter';
import { createWysiwygMarkdownIt, WysiwygMarkdownItOptions } from './markdownItFactory';
import { WysiwygDoc, WysiwygNode } from './types';
import { serializeWysiwygDoc, WysiwygSerializerOptions } from './serializer';

export type WysiwygPipelineOptions = {
    markdownIt?: MarkdownIt;
    markdownItOptions?: WysiwygMarkdownItOptions;
    serializerOptions?: WysiwygSerializerOptions;
};

export function markdownToWysiwygDoc(markdown: string, options: WysiwygPipelineOptions = {}): WysiwygDoc {
    const md = options.markdownIt ?? createWysiwygMarkdownIt(options.markdownItOptions);
    const doc = parseMarkdownToWysiwygDoc(markdown, md);
    return applyTaskCheckboxes(doc);
}

export function wysiwygDocToMarkdown(doc: WysiwygDoc, options: WysiwygPipelineOptions = {}): string {
    return serializeWysiwygDoc(doc, options.serializerOptions);
}

export function roundTripMarkdown(markdown: string, options: WysiwygPipelineOptions = {}): { doc: WysiwygDoc; markdown: string } {
    const doc = markdownToWysiwygDoc(markdown, options);
    const serialized = wysiwygDocToMarkdown(doc, options);
    return { doc, markdown: serialized };
}

function applyTaskCheckboxes(doc: WysiwygDoc): WysiwygDoc {
    if (!doc || !doc.content) {
        return doc;
    }

    doc.content.forEach(node => applyTaskCheckboxesToNode(node));
    return doc;
}

function applyTaskCheckboxesToNode(node: WysiwygNode): void {
    if (!node || !node.content) {
        return;
    }

    if (node.type === 'list_item') {
        applyTaskCheckboxToListItem(node);
    }

    node.content.forEach(child => applyTaskCheckboxesToNode(child));
}

function applyTaskCheckboxToListItem(node: WysiwygNode): void {
    const content = node.content || [];
    const paragraph = content.find(child => child.type === 'paragraph');
    if (!paragraph || !paragraph.content || paragraph.content.length === 0) {
        return;
    }

    const inline = paragraph.content;
    for (let i = 0; i < inline.length; i += 1) {
        const child = inline[i];
        if (child.type === 'task_checkbox') {
            return;
        }
        if (child.type === 'text') {
            const text = child.text || '';
            if (!text.trim()) {
                continue;
            }
            const match = text.match(/^\[( |x|X)\]\s+/);
            if (!match) {
                return;
            }
            const checked = match[1].toLowerCase() === 'x';
            const rest = text.slice(match[0].length);
            const replacement: typeof inline = [
                { type: 'task_checkbox', attrs: { checked } }
            ];
            if (rest) {
                replacement.push({ ...child, text: rest });
            }
            inline.splice(i, 1, ...replacement);
            return;
        }
        return;
    }
}
