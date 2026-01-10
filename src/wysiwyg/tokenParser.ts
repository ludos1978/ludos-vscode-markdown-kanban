import { MarkdownItToken, WysiwygDoc, WysiwygMark, WysiwygNode } from './types';
import { tokenMappings } from './spec';

const mappingByToken = new Map<string, { node?: string; mark?: string }>();
for (const mapping of tokenMappings) {
    for (const token of mapping.tokens) {
        if (!mappingByToken.has(token)) {
            mappingByToken.set(token, { node: mapping.node, mark: mapping.mark });
        }
    }
}

const diagramLangs = new Set(['mermaid', 'plantuml']);
const inlineTextTokens = new Set(['text', 'emoji']);
const transparentBlockTokens = new Set(['thead_open', 'thead_close', 'tbody_open', 'tbody_close']);

function appendNode(parent: WysiwygNode, node: WysiwygNode): void {
    if (!parent.content) {
        parent.content = [];
    }
    parent.content.push(node);
}

function getTokenAttr(token: MarkdownItToken, name: string): string | undefined {
    const tokenWithAttrGet = token as MarkdownItToken & { attrGet?: (attrName: string) => string | null };
    if (typeof tokenWithAttrGet.attrGet === 'function') {
        const value = tokenWithAttrGet.attrGet(name);
        return value === null ? undefined : value;
    }

    if (!token.attrs) {
        return undefined;
    }

    const match = token.attrs.find(attr => attr[0] === name);
    return match ? match[1] : undefined;
}

function getChildAttr(token: MarkdownItToken, name: string): string | undefined {
    if (!token.children) {
        return undefined;
    }

    for (const child of token.children) {
        const value = getTokenAttr(child, name);
        if (value) {
            return value;
        }
    }

    return undefined;
}

function parseNumber(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseHeadingLevel(token: MarkdownItToken): number {
    if (token.tag && /^h[1-6]$/i.test(token.tag)) {
        return parseNumber(token.tag.slice(1), 1);
    }
    return 1;
}

function parseListOrder(token: MarkdownItToken): number {
    return parseNumber(getTokenAttr(token, 'start'), 1);
}

function parseCellAlign(token: MarkdownItToken): string | null {
    const alignAttr = getTokenAttr(token, 'align');
    if (alignAttr) {
        return alignAttr;
    }

    const style = getTokenAttr(token, 'style');
    if (!style) {
        return null;
    }

    const match = style.match(/text-align\s*:\s*(left|right|center)/i);
    return match ? match[1].toLowerCase() : null;
}

function parseContainerKind(token: MarkdownItToken): string {
    if (token.info) {
        const info = token.info.trim();
        if (info) {
            return info.split(/\s+/)[0];
        }
    }

    const match = token.type.match(/^container_(.+?)_(open|close)$/);
    if (match) {
        return match[1];
    }

    return 'note';
}

function parseColumnGrowth(token: MarkdownItToken): number {
    const meta = token.meta ?? {};
    const growth = typeof meta.growth === 'number' ? meta.growth : parseNumber(String(meta.growth ?? ''), 1);
    return Number.isFinite(growth) && growth > 0 ? growth : 1;
}

function createTextNode(text: string, marks: WysiwygMark[]): WysiwygNode {
    const node: WysiwygNode = { type: 'text', text };
    if (marks.length > 0) {
        node.marks = marks.map(mark => ({ type: mark.type, attrs: mark.attrs ? { ...mark.attrs } : undefined }));
    }
    return node;
}

function createMediaInlineNode(token: MarkdownItToken): WysiwygNode {
    const mediaType = token.type === 'video' ? 'video' : token.type === 'audio' ? 'audio' : 'image';
    const src = getTokenAttr(token, 'src') ?? getChildAttr(token, 'src') ?? '';
    const attrs: Record<string, unknown> = { src, mediaType };

    if (mediaType === 'image') {
        const title = getTokenAttr(token, 'title');
        if (title) {
            attrs.title = title;
        }
        if (token.content) {
            attrs.alt = token.content;
        }
    }

    return { type: 'media_inline', attrs };
}

function createIncludeInlineNode(token: MarkdownItToken): WysiwygNode {
    const path = getTokenAttr(token, 'data-include-file') || token.content || '';
    const isMissing = token.type === 'include_placeholder';

    return {
        type: 'include_inline',
        attrs: {
            path,
            includeType: 'regular',
            missing: isMissing
        }
    };
}

function createIncludeBlockNode(token: MarkdownItToken): WysiwygNode {
    const filePath = (token as MarkdownItToken & { filePath?: string }).filePath || getTokenAttr(token, 'data-include-file') || '';
    return {
        type: 'include_block',
        attrs: {
            path: filePath,
            includeType: 'regular'
        }
    };
}

function createTagNode(token: MarkdownItToken): WysiwygNode {
    const value = token.content || '';
    let flavor = 'tag';
    if (value.startsWith('gather_')) {
        flavor = 'gather';
    } else if (/^(\+\+|\+|\u00f8|\u00d8|--|-)$/u.test(value)) {
        flavor = 'polarity';
    }

    return {
        type: 'tag',
        attrs: { value, flavor }
    };
}

function createDatePersonNode(token: MarkdownItToken): WysiwygNode {
    const value = token.content || '';
    const metaType = typeof token.meta?.type === 'string' ? token.meta.type : '';

    if (metaType === 'person') {
        return {
            type: 'person_tag',
            attrs: { value }
        };
    }

    return {
        type: 'date_tag',
        attrs: { value, kind: metaType || 'date' }
    };
}

function createTemporalNode(token: MarkdownItToken): WysiwygNode {
    const value = token.content || '';
    const kind = typeof token.meta?.type === 'string' ? token.meta.type : 'generic';

    return {
        type: 'temporal_tag',
        attrs: { value, kind }
    };
}

function createHtmlNode(token: MarkdownItToken, mode: string): WysiwygNode {
    const raw = token.content || '';
    return {
        type: 'html_block',
        attrs: {
            raw,
            mode
        },
        content: raw ? [{ type: 'text', text: raw }] : []
    };
}

function getMarkType(token: MarkdownItToken): string | null {
    if (token.type === 'em_open' || token.type === 'em_close') {
        return token.markup === '_' ? 'underline' : 'em';
    }
    if (token.type === 'strong_open' || token.type === 'strong_close') {
        return 'strong';
    }
    if (token.type === 's_open' || token.type === 's_close') {
        return 'strike';
    }
    if (token.type === 'link_open' || token.type === 'link_close') {
        return 'link';
    }
    if (token.type === 'mark_open' || token.type === 'mark_close') {
        return 'mark';
    }
    if (token.type === 'sub_open' || token.type === 'sub_close') {
        return 'sub';
    }
    if (token.type === 'sup_open' || token.type === 'sup_close') {
        return 'sup';
    }
    if (token.type === 'ins_open' || token.type === 'ins_close') {
        return 'ins';
    }
    if (token.type === 'abbr_open' || token.type === 'abbr_close') {
        return 'abbr';
    }
    if (token.type === 'underline_open' || token.type === 'underline_close') {
        return 'underline';
    }

    const mapping = mappingByToken.get(token.type);
    return mapping?.mark || null;
}

function buildMark(token: MarkdownItToken, type: string): WysiwygMark {
    const mark: WysiwygMark = { type };

    if (type === 'link') {
        mark.attrs = {
            href: getTokenAttr(token, 'href') || '',
            title: getTokenAttr(token, 'title') || ''
        };
    }

    if (type === 'abbr') {
        mark.attrs = { title: getTokenAttr(token, 'title') || '' };
    }

    if (type === 'strike') {
        const style = token.markup === '--' ? 'dash' : 'tilde';
        mark.attrs = { style };
    }

    return mark;
}

function popMark(stack: WysiwygMark[], type: string): void {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].type === type) {
            stack.splice(i, 1);
            return;
        }
    }
}

function parseWikiLink(tokens: MarkdownItToken[], startIndex: number): { node: WysiwygNode; nextIndex: number } {
    const openToken = tokens[startIndex];
    const document = getTokenAttr(openToken, 'data-document') || '';
    const textParts: string[] = [];
    let index = startIndex + 1;

    for (; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type === 'wiki_link_close') {
            break;
        }
        if (inlineTextTokens.has(token.type)) {
            textParts.push(token.content || '');
            continue;
        }
        if (token.type === 'code_inline') {
            textParts.push(token.content || '');
            continue;
        }
        if (token.type === 'softbreak' || token.type === 'hardbreak') {
            textParts.push('\n');
            continue;
        }
        if (token.content) {
            textParts.push(token.content);
        }
    }

    const title = textParts.join('') || document;
    const node: WysiwygNode = {
        type: 'wiki_link',
        attrs: {
            document,
            title
        }
    };

    return { node, nextIndex: index };
}

function parseInlineTokens(tokens: MarkdownItToken[], activeMarks: WysiwygMark[] = []): WysiwygNode[] {
    const nodes: WysiwygNode[] = [];
    const markStack = [...activeMarks];

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];

        if (token.type === 'inline' && token.children) {
            nodes.push(...parseInlineTokens(token.children, markStack));
            continue;
        }

        if (token.type === 'wiki_link_open') {
            const { node, nextIndex } = parseWikiLink(tokens, i);
            nodes.push(node);
            i = nextIndex;
            continue;
        }

        const markType = getMarkType(token);
        if (markType && token.type.endsWith('_open')) {
            markStack.push(buildMark(token, markType));
            continue;
        }
        if (markType && token.type.endsWith('_close')) {
            popMark(markStack, markType);
            continue;
        }

        if (token.type === 'code_inline') {
            const codeMark: WysiwygMark = { type: 'code' };
            nodes.push(createTextNode(token.content || '', [...markStack, codeMark]));
            continue;
        }

        if (inlineTextTokens.has(token.type)) {
            const content = token.content || token.markup || '';
            if (content) {
                nodes.push(createTextNode(content, markStack));
            }
            continue;
        }

        if (token.type === 'softbreak' || token.type === 'hardbreak') {
            nodes.push(createTextNode('\n', markStack));
            continue;
        }

        if (token.type === 'image' || token.type === 'audio' || token.type === 'video') {
            nodes.push(createMediaInlineNode(token));
            continue;
        }

        if (token.type === 'include_content' || token.type === 'include_placeholder') {
            nodes.push(createIncludeInlineNode(token));
            continue;
        }

        if (token.type === 'tag') {
            nodes.push(createTagNode(token));
            continue;
        }

        if (token.type === 'date_person_tag') {
            nodes.push(createDatePersonNode(token));
            continue;
        }

        if (token.type === 'temporal_tag') {
            nodes.push(createTemporalNode(token));
            continue;
        }

        if (token.type === 'html_inline') {
            nodes.push(createHtmlNode(token, 'inline'));
            continue;
        }

        if (token.type === 'html_comment') {
            nodes.push(createHtmlNode(token, 'comment'));
            continue;
        }

        if (token.type === 'footnote_ref') {
            nodes.push({
                type: 'footnote',
                attrs: { id: token.meta?.id ?? token.meta?.label ?? '' }
            });
            continue;
        }

        if (token.content) {
            nodes.push(createTextNode(token.content, markStack));
        }
    }

    return nodes;
}

function resolveBlockNodeType(token: MarkdownItToken): string | null {
    if (token.type.startsWith('container_')) {
        return 'container';
    }

    const mapping = mappingByToken.get(token.type);
    if (mapping?.node) {
        return mapping.node;
    }

    return null;
}

function createBlockNode(token: MarkdownItToken, nodeType: string): WysiwygNode {
    switch (nodeType) {
        case 'heading':
            return { type: 'heading', attrs: { level: parseHeadingLevel(token) }, content: [] };
        case 'ordered_list':
            return { type: 'ordered_list', attrs: { order: parseListOrder(token) }, content: [] };
        case 'table_cell':
            return { type: 'table_cell', attrs: { align: parseCellAlign(token) }, content: [] };
        case 'multicolumn_column':
            return { type: 'multicolumn_column', attrs: { growth: parseColumnGrowth(token) }, content: [] };
        case 'container':
            return { type: 'container', attrs: { kind: parseContainerKind(token) }, content: [] };
        default:
            return { type: nodeType, content: [] };
    }
}

function createBlockLeafNode(token: MarkdownItToken): WysiwygNode | null {
    switch (token.type) {
        case 'fence': {
            const info = token.info ? token.info.trim() : '';
            const lang = info.split(/\s+/)[0] || '';
            const code = token.content || '';
            if (lang && diagramLangs.has(lang.toLowerCase())) {
                return {
                    type: 'diagram_fence',
                    attrs: { lang },
                    content: code ? [{ type: 'text', text: code }] : []
                };
            }
            return {
                type: 'code_block',
                attrs: { params: info },
                content: code ? [{ type: 'text', text: code }] : []
            };
        }
        case 'code_block': {
            const params = token.info ? token.info.trim() : '';
            const code = token.content || '';
            return {
                type: 'code_block',
                attrs: { params },
                content: code ? [{ type: 'text', text: code }] : []
            };
        }
        case 'hr':
            return { type: 'horizontal_rule' };
        case 'include_block':
            return createIncludeBlockNode(token);
        case 'html_block':
            return createHtmlNode(token, 'block');
        case 'speaker_note':
            return {
                type: 'speaker_note',
                attrs: { raw: token.content || '' },
                content: token.content ? [{ type: 'text', text: token.content }] : []
            };
        case 'include_content':
        case 'include_placeholder':
            return createIncludeInlineNode(token);
        case 'tag':
            return createTagNode(token);
        case 'date_person_tag':
            return createDatePersonNode(token);
        case 'temporal_tag':
            return createTemporalNode(token);
        case 'html_comment':
            return createHtmlNode(token, 'comment');
        case 'html_inline':
            return createHtmlNode(token, 'inline');
        case 'image':
        case 'audio':
        case 'video':
            return createMediaInlineNode(token);
        case 'footnote_block':
            return { type: 'footnote', attrs: { block: true } };
        default:
            return null;
    }
}

function isOpenToken(token: MarkdownItToken): boolean {
    return token.type.endsWith('_open');
}

function isCloseToken(token: MarkdownItToken): boolean {
    return token.type.endsWith('_close');
}

function closeNodeForToken(token: MarkdownItToken, stack: WysiwygNode[]): void {
    const nodeType = resolveBlockNodeType(token);
    if (!nodeType) {
        return;
    }

    for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].type === nodeType) {
            const node = stack.splice(i, 1)[0];
            appendNode(stack[stack.length - 1], node);
            return;
        }
    }
}

export function parseMarkdownItTokens(tokens: MarkdownItToken[]): WysiwygDoc {
    const doc: WysiwygDoc = { type: 'doc', content: [] };

    if (!tokens || tokens.length === 0) {
        return doc;
    }

    const stack: WysiwygNode[] = [doc];

    for (const token of tokens) {
        if (transparentBlockTokens.has(token.type)) {
            continue;
        }

        if (token.type === 'inline' && token.children) {
            const inlineNodes = parseInlineTokens(token.children);
            inlineNodes.forEach(node => appendNode(stack[stack.length - 1], node));
            continue;
        }

        if (isOpenToken(token)) {
            const mapping = mappingByToken.get(token.type);
            if (mapping?.mark) {
                continue;
            }

            const nodeType = resolveBlockNodeType(token);
            if (!nodeType) {
                continue;
            }

            const node = createBlockNode(token, nodeType);
            stack.push(node);
            continue;
        }

        if (isCloseToken(token)) {
            closeNodeForToken(token, stack);
            continue;
        }

        const leaf = createBlockLeafNode(token);
        if (leaf) {
            appendNode(stack[stack.length - 1], leaf);
        }
    }

    while (stack.length > 1) {
        const node = stack.pop();
        if (node) {
            appendNode(stack[stack.length - 1], node);
        }
    }

    return doc;
}
