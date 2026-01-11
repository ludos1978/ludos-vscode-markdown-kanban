import { WysiwygDoc, WysiwygMark, WysiwygNode } from './types';

export type WysiwygSerializerOptions = {
    temporalPrefix?: string;
};

const inlineNodeTypes = new Set([
    'text',
    'include_inline',
    'wiki_link',
    'tag',
    'date_tag',
    'person_tag',
    'temporal_tag',
    'media_inline',
    'html_block',
    'footnote'
]);

const markOrder = new Map<string, number>([
    ['code', 0],
    ['sub', 1],
    ['sup', 2],
    ['ins', 3],
    ['mark', 4],
    ['strike', 5],
    ['underline', 6],
    ['em', 7],
    ['strong', 8],
    ['abbr', 9],
    ['link', 10]
]);

export function serializeWysiwygDoc(doc: WysiwygDoc, options: WysiwygSerializerOptions = {}): string {
    if (!doc || !doc.content || doc.content.length === 0) {
        return '';
    }

    const config = {
        temporalPrefix: options.temporalPrefix ?? '!'
    };

    const blocks = doc.content
        .map(node => serializeBlock(node, config))
        .filter(Boolean);

    return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n');
}

function serializeBlock(node: WysiwygNode, config: Required<WysiwygSerializerOptions>): string {
    switch (node.type) {
        case 'paragraph':
            return serializeInlineContent(node.content, config);
        case 'media_block':
            return serializeMediaInline(node);
        case 'heading': {
            const level = clampNumber(node.attrs?.level, 1, 6, 1);
            return `${'#'.repeat(level)} ${serializeInlineContent(node.content, config)}`.trimEnd();
        }
        case 'blockquote': {
            const content = serializeBlocks(node.content, config);
            return prefixLines(content, '> ');
        }
        case 'bullet_list':
            return serializeList(node, false, config);
        case 'ordered_list':
            return serializeList(node, true, config);
        case 'code_block':
            return serializeCodeBlock(node);
        case 'diagram_fence':
            return serializeDiagramFence(node);
        case 'horizontal_rule':
            return '---';
        case 'table':
            return serializeTable(node, config);
        case 'multicolumn':
            return serializeMulticolumn(node, config);
        case 'container':
            return serializeContainer(node, config);
        case 'include_block':
            return serializeIncludeBlock(node);
        case 'speaker_note':
            return serializeSpeakerNote(node);
        case 'html_block':
            return serializeHtmlNode(node);
        case 'list_item':
            return serializeBlocks(node.content, config);
        default:
            if (inlineNodeTypes.has(node.type)) {
                return serializeInlineNode(node, config);
            }
            if (node.content && node.content.length > 0) {
                return serializeBlocks(node.content, config);
            }
            return node.text || '';
    }
}

function serializeBlocks(nodes: WysiwygNode[] | undefined, config: Required<WysiwygSerializerOptions>): string {
    if (!nodes || nodes.length === 0) {
        return '';
    }

    return nodes
        .map(child => serializeBlock(child, config))
        .filter(Boolean)
        .join('\n\n');
}

function serializeInlineContent(nodes: WysiwygNode[] | undefined, config: Required<WysiwygSerializerOptions>): string {
    if (!nodes || nodes.length === 0) {
        return '';
    }

    return nodes.map(node => serializeInlineNode(node, config)).join('');
}

function serializeInlineNode(node: WysiwygNode, config: Required<WysiwygSerializerOptions>): string {
    const raw = (() => {
        switch (node.type) {
            case 'text':
                return node.text || '';
            case 'include_inline':
                return serializeIncludeInline(node);
            case 'wiki_link':
                return serializeWikiLink(node);
            case 'tag':
                return `#${node.attrs?.value ?? ''}`;
            case 'date_tag':
                return `@${node.attrs?.value ?? ''}`;
            case 'person_tag':
                return `@${node.attrs?.value ?? ''}`;
            case 'temporal_tag':
                return `${config.temporalPrefix}${node.attrs?.value ?? ''}`;
            case 'media_inline':
                return serializeMediaInline(node);
            case 'html_block':
                return serializeHtmlNode(node);
            case 'footnote':
                return serializeFootnote(node);
            default:
                if (node.content && node.content.length > 0) {
                    return serializeInlineContent(node.content, config);
                }
                return node.text || '';
        }
    })();

    if (node.marks && node.marks.length > 0) {
        return applyMarks(raw, node.marks);
    }

    return raw;
}

function serializeList(node: WysiwygNode, ordered: boolean, config: Required<WysiwygSerializerOptions>): string {
    const items = (node.content || []).filter(child => child.type === 'list_item');
    const start = ordered ? clampNumber(node.attrs?.order, 1, 1000000, 1) : 1;

    return items
        .map((item, index) => {
            const prefix = ordered ? `${start + index}. ` : '- ';
            const content = serializeListItem(item, config);
            const indented = indentLines(content, '  ');
            return `${prefix}${indented}`.trimEnd();
        })
        .join('\n');
}

function serializeListItem(node: WysiwygNode, config: Required<WysiwygSerializerOptions>): string {
    if (!node.content || node.content.length === 0) {
        return '';
    }

    const content = serializeBlocks(node.content, config).trimEnd();
    return content || '';
}

function serializeCodeBlock(node: WysiwygNode): string {
    const info = typeof node.attrs?.params === 'string' ? node.attrs.params : '';
    const code = extractText(node);
    return ['```' + info, code, '```'].join('\n').trimEnd();
}

function serializeDiagramFence(node: WysiwygNode): string {
    const lang = typeof node.attrs?.lang === 'string' ? node.attrs.lang : '';
    const codeFromContent = extractText(node);
    const code = codeFromContent || (typeof node.attrs?.code === 'string' ? node.attrs.code : '');
    return ['```' + lang, code, '```'].join('\n').trimEnd();
}

function serializeIncludeBlock(node: WysiwygNode): string {
    const path = typeof node.attrs?.path === 'string' ? node.attrs.path : '';
    return `!!!include(${path})!!!`;
}

function serializeIncludeInline(node: WysiwygNode): string {
    const path = typeof node.attrs?.path === 'string' ? node.attrs.path : '';
    return `!!!include(${path})!!!`;
}

function serializeWikiLink(node: WysiwygNode): string {
    const document = typeof node.attrs?.document === 'string' ? node.attrs.document : '';
    const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
    if (!title || title === document) {
        return `[[${document}]]`;
    }
    return `[[${document}|${title}]]`;
}

function serializeMediaInline(node: WysiwygNode): string {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
    const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
    const titlePart = title ? ` "${escapeAttribute(title)}"` : '';
    return `![${alt}](${src}${titlePart})`;
}

function serializeContainer(node: WysiwygNode, config: Required<WysiwygSerializerOptions>): string {
    const kind = typeof node.attrs?.kind === 'string' ? node.attrs.kind : 'note';
    const content = serializeBlocks(node.content, config);
    return [`::: ${kind}`, content, ':::'].join('\n').trimEnd();
}

function serializeSpeakerNote(node: WysiwygNode): string {
    const raw = typeof node.attrs?.raw === 'string' ? node.attrs.raw : extractText(node);
    if (!raw) {
        return ';;';
    }
    return raw
        .split(/\r?\n/)
        .map(line => `;;${line}`)
        .join('\n');
}

function serializeHtmlNode(node: WysiwygNode): string {
    const raw = typeof node.attrs?.raw === 'string' ? node.attrs.raw : extractText(node);
    const mode = typeof node.attrs?.mode === 'string' ? node.attrs.mode : '';

    if (mode === 'comment') {
        return `<!--${raw}-->`;
    }

    return raw;
}

function serializeTable(node: WysiwygNode, config: Required<WysiwygSerializerOptions>): string {
    const rows = (node.content || []).filter(child => child.type === 'table_row');
    if (rows.length === 0) {
        return '';
    }

    const cellTexts = rows.map(row => (row.content || []).filter(cell => cell.type === 'table_cell'));
    const headerCells = cellTexts[0] || [];
    const headerRow = `| ${headerCells.map(cell => serializeTableCell(cell, config)).join(' | ')} |`;
    const alignRow = `| ${headerCells.map(cell => serializeAlignment(cell)).join(' | ')} |`;
    const bodyRows = cellTexts.slice(1).map(cells => `| ${cells.map(cell => serializeTableCell(cell, config)).join(' | ')} |`);

    return [headerRow, alignRow, ...bodyRows].join('\n');
}

function serializeTableCell(node: WysiwygNode, config: Required<WysiwygSerializerOptions>): string {
    const content = serializeBlocks(node.content, config).replace(/\n+/g, '<br>');
    return content.trim();
}

function serializeAlignment(node: WysiwygNode): string {
    const align = typeof node.attrs?.align === 'string' ? node.attrs.align : null;
    switch (align) {
        case 'left':
            return ':---';
        case 'center':
            return ':---:';
        case 'right':
            return '---:';
        default:
            return '---';
    }
}

function serializeMulticolumn(node: WysiwygNode, config: Required<WysiwygSerializerOptions>): string {
    const columns = (node.content || []).filter(child => child.type === 'multicolumn_column');
    if (columns.length === 0) {
        return '';
    }

    const lines: string[] = [];
    columns.forEach((column, index) => {
        const growth = clampNumber(column.attrs?.growth, 1, 100, 1);
        const marker = index === 0 ? '---:' : ':--:';
        lines.push(`${marker} ${growth}`.trimEnd());
        const content = serializeBlocks(column.content, config);
        if (content) {
            lines.push(content);
        }
    });
    lines.push(':---');

    return lines.join('\n').trimEnd();
}

function serializeFootnote(node: WysiwygNode): string {
    const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
    if (!id) {
        return '';
    }
    return `[^${id}]`;
}

function applyMarks(text: string, marks: WysiwygMark[]): string {
    if (!text) {
        return text;
    }

    const ordered = [...marks].sort((a, b) => (markOrder.get(a.type) ?? 50) - (markOrder.get(b.type) ?? 50));
    let output = text;

    for (const mark of ordered) {
        output = wrapMark(output, mark);
    }

    return output;
}

function wrapMark(text: string, mark: WysiwygMark): string {
    switch (mark.type) {
        case 'em':
            return wrapWithDelimiter(text, '*');
        case 'strong':
            return wrapWithDelimiter(text, '**');
        case 'code':
            return wrapWithBackticks(text);
        case 'strike': {
            const style = typeof mark.attrs?.style === 'string' ? mark.attrs.style : 'tilde';
            return wrapWithDelimiter(text, style === 'dash' ? '--' : '~~');
        }
        case 'underline':
            return wrapWithDelimiter(text, '_');
        case 'mark':
            return wrapWithDelimiter(text, '==');
        case 'sub':
            return wrapWithDelimiter(text, '~');
        case 'sup':
            return wrapWithDelimiter(text, '^');
        case 'ins':
            return wrapWithDelimiter(text, '++');
        case 'link': {
            const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
            const title = typeof mark.attrs?.title === 'string' ? mark.attrs.title : '';
            const titlePart = title ? ` "${escapeAttribute(title)}"` : '';
            return `[${text}](${href}${titlePart})`;
        }
        case 'abbr': {
            const title = typeof mark.attrs?.title === 'string' ? mark.attrs.title : '';
            if (!title) {
                return text;
            }
            return `<abbr title="${escapeAttribute(title)}">${text}</abbr>`;
        }
        default:
            return text;
    }
}

function wrapWithDelimiter(text: string, delimiter: string): string {
    if (!text) {
        return text;
    }
    return `${delimiter}${text}${delimiter}`;
}

function wrapWithBackticks(text: string): string {
    if (!text) {
        return text;
    }
    const longestRun = Math.max(...text.split(/[^`]+/).map(run => run.length), 0);
    const fence = '`'.repeat(longestRun + 1);
    return `${fence}${text}${fence}`;
}

function prefixLines(text: string, prefix: string): string {
    if (!text) {
        return prefix.trimEnd();
    }
    return text
        .split('\n')
        .map(line => line.length > 0 ? `${prefix}${line}` : prefix.trimEnd())
        .join('\n');
}

function indentLines(text: string, indent: string): string {
    if (!text) {
        return '';
    }
    const lines = text.split('\n');
    return lines
        .map((line, index) => (index === 0 ? line : `${indent}${line}`))
        .join('\n');
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
}

function escapeAttribute(value: string): string {
    return value.replace(/"/g, '&quot;');
}

function extractText(node: WysiwygNode): string {
    if (node.text) {
        return node.text;
    }

    if (!node.content || node.content.length === 0) {
        return '';
    }

    return node.content.map(child => extractText(child)).join('');
}
