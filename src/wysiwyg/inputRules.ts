import { EditorState, TextSelection, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode, Schema } from 'prosemirror-model';
import { InputRule, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules';
import { inferMediaTypeFromSrc, getTagFlavor, isDateLike } from './utils';

function replaceInlineWithNodePreserveSpace(state: EditorState, match: RegExpMatchArray, start: number, end: number, node: ProseMirrorNode): Transaction | null {
    const full = match[0] || '';
    const leadingSpace = full.length > 0 && /\s/.test(full[0]) ? full[0] : '';
    const trailingSpace = full.length > 0 && /\s/.test(full[full.length - 1]) ? full[full.length - 1] : '';
    const replaceStart = start + (leadingSpace ? 1 : 0);
    const replaceEnd = end;
    if (replaceEnd <= replaceStart) {
        return null;
    }
    let tr = state.tr.replaceWith(replaceStart, replaceEnd, node);
    if (trailingSpace) {
        const insertPos = tr.mapping.map(replaceStart) + node.nodeSize;
        tr = tr.insertText(trailingSpace, insertPos, insertPos);
    }
    return tr;
}

function isInsideMulticolumn(state: EditorState): boolean {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'multicolumn') {
            return true;
        }
    }
    return false;
}

function findMulticolumnAncestor(state: EditorState): { node: ProseMirrorNode; pos: number; depth: number } | null {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === 'multicolumn') {
            return { node, pos: $from.before(d), depth: d };
        }
    }
    return null;
}

export function createMulticolumnTransaction(
    state: EditorState,
    schema: Schema,
    growth: number,
    _start: number,
    _end: number
): Transaction | null {
    if (!schema.nodes.multicolumn || !schema.nodes.multicolumn_column || !schema.nodes.paragraph) {
        return null;
    }

    const { $from } = state.selection;
    let paragraphDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'paragraph') {
            paragraphDepth = d;
            break;
        }
    }

    if (paragraphDepth === -1) {
        return null;
    }

    const paragraphStart = $from.before(paragraphDepth);
    const paragraphEnd = $from.after(paragraphDepth);

    const sourceParagraph = $from.node(paragraphDepth);
    const beforeParagraph = schema.nodes.paragraph.create(null, sourceParagraph.content);
    const afterParagraph = schema.nodes.paragraph.create();

    const columnParagraph = schema.nodes.paragraph.create();
    const column = schema.nodes.multicolumn_column.create({ growth }, columnParagraph);
    const multicolumn = schema.nodes.multicolumn.create(null, column);

    const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, [
        beforeParagraph,
        multicolumn,
        afterParagraph
    ]);

    const multicolumnPos = paragraphStart + beforeParagraph.nodeSize;
    const selectionPos = multicolumnPos + 3;
    return tr.setSelection(TextSelection.create(tr.doc, selectionPos));
}

function addColumnTransaction(
    state: EditorState,
    schema: Schema,
    growth: number,
    start: number,
    end: number
): Transaction | null {
    const ancestor = findMulticolumnAncestor(state);
    if (!ancestor || !schema.nodes.multicolumn_column || !schema.nodes.paragraph) {
        return null;
    }

    const { $from } = state.selection;
    let columnDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'multicolumn_column') {
            columnDepth = d;
            break;
        }
    }

    if (columnDepth === -1) {
        return null;
    }

    const columnEnd = $from.after(columnDepth);
    const paragraph = schema.nodes.paragraph.create();
    const newColumn = schema.nodes.multicolumn_column.create({ growth }, paragraph);

    const tr = state.tr.delete(start, end);
    const adjustedPos = columnEnd - (end - start);
    return tr.insert(adjustedPos, newColumn);
}

function closeMulticolumnTransaction(
    state: EditorState,
    schema: Schema,
    start: number,
    end: number
): Transaction | null {
    const ancestor = findMulticolumnAncestor(state);
    if (!ancestor || !schema.nodes.paragraph) {
        return null;
    }

    const multicolumnEnd = ancestor.pos + ancestor.node.nodeSize;
    const paragraph = schema.nodes.paragraph.create();

    const tr = state.tr.delete(start, end);
    const adjustedPos = multicolumnEnd - (end - start);
    return tr.insert(adjustedPos, paragraph);
}

export function buildMarkdownInputRules(schema: Schema): InputRule[] {
    const rules: InputRule[] = [];

    if (schema.nodes.bullet_list) {
        rules.push(wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));
    }

    if (schema.nodes.ordered_list) {
        rules.push(wrappingInputRule(/^\s*(\d+)\.\s$/, schema.nodes.ordered_list, (match: RegExpMatchArray) => ({ order: Number.parseInt(match[1], 10) }), (match, node) => node.childCount + node.attrs.order === Number.parseInt(match[1], 10)));
    }

    if (schema.nodes.blockquote) {
        rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
    }

    if (schema.nodes.heading) {
        rules.push(textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match: RegExpMatchArray) => ({ level: match[1].length })));
    }

    if (schema.nodes.media_inline) {
        rules.push(new InputRule(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/, (state, match, start, end) => {
            const alt = match[1] || '';
            const src = match[2] || '';
            const title = match[3] || '';
            if (!src) {
                return null;
            }
            const inferred = inferMediaTypeFromSrc(src);
            const attrs: Record<string, unknown> = { src, mediaType: inferred || 'image' };
            if (alt) {
                attrs.alt = alt;
            }
            if (title) {
                attrs.title = title;
            }
            return state.tr.replaceWith(start, end, schema.nodes.media_inline.create(attrs));
        }));

        rules.push(new InputRule(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)\s$/, (state, match, start, end) => {
            const alt = match[1] || '';
            const src = match[2] || '';
            const title = match[3] || '';
            if (!src) {
                return null;
            }
            const inferred = inferMediaTypeFromSrc(src);
            const attrs: Record<string, unknown> = { src, mediaType: inferred || 'image' };
            if (alt) {
                attrs.alt = alt;
            }
            if (title) {
                attrs.title = title;
            }
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.media_inline.create(attrs));
        }));
    }

    if (schema.marks.link) {
        rules.push(new InputRule(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/, (state, match, start, end) => {
            const text = match[1] || '';
            const href = match[2] || '';
            const title = match[3] || '';
            if (!text || !href) {
                return null;
            }
            const mark = schema.marks.link.create({ href, title });
            const textNode = schema.text(text, [mark]);
            return state.tr.replaceWith(start, end, textNode);
        }));

        rules.push(new InputRule(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)\s$/, (state, match, start, end) => {
            const text = match[1] || '';
            const href = match[2] || '';
            const title = match[3] || '';
            if (!text || !href) {
                return null;
            }
            const mark = schema.marks.link.create({ href, title });
            const textNode = schema.text(text, [mark]);
            return replaceInlineWithNodePreserveSpace(state, match, start, end, textNode);
        }));
    }

    if (schema.nodes.include_inline) {
        rules.push(new InputRule(/!!!include\(([^)]+)\)!!!$/, (state, match, start, end) => {
            const path = match[1]?.trim() || '';
            if (!path) {
                return null;
            }
            return state.tr.replaceWith(start, end, schema.nodes.include_inline.create({ path, includeType: 'regular', missing: false }));
        }));

        rules.push(new InputRule(/!!!include\(([^)]+)\)!!!\s$/, (state, match, start, end) => {
            const path = match[1]?.trim() || '';
            if (!path) {
                return null;
            }
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.include_inline.create({ path, includeType: 'regular', missing: false }));
        }));
    }

    if (schema.nodes.wiki_link) {
        rules.push(new InputRule(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/, (state, match, start, end) => {
            const document = match[1]?.trim() || '';
            const title = match[2]?.trim() || '';
            if (!document) {
                return null;
            }
            return state.tr.replaceWith(start, end, schema.nodes.wiki_link.create({ document, title: title || document }));
        }));

        rules.push(new InputRule(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]\s$/, (state, match, start, end) => {
            const document = match[1]?.trim() || '';
            const title = match[2]?.trim() || '';
            if (!document) {
                return null;
            }
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.wiki_link.create({ document, title: title || document }));
        }));
    }

    if (schema.nodes.tag) {
        rules.push(new InputRule(/(?:^|\s)(#([^\s#]+|(\+\+|\+|--|-|\u00f8|\u00d8)))\s$/, (state, match, start, end) => {
            const raw = match[1] || '';
            const value = raw.startsWith('#') ? raw.slice(1) : raw;
            if (!value) {
                return null;
            }
            const flavor = getTagFlavor(value);
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.tag.create({ value, flavor }));
        }));
    }

    if (schema.nodes.person_tag || schema.nodes.date_tag) {
        rules.push(new InputRule(/(?:^|\s)(@([^\s@]+))\s$/, (state, match, start, end) => {
            const raw = match[1] || '';
            const value = raw.startsWith('@') ? raw.slice(1) : raw;
            if (!value) {
                return null;
            }
            const dateLike = isDateLike(value);
            if (dateLike && schema.nodes.date_tag) {
                return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.date_tag.create({ value, kind: 'date' }));
            }
            if (schema.nodes.person_tag) {
                return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.person_tag.create({ value }));
            }
            if (schema.nodes.date_tag) {
                return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.date_tag.create({ value, kind: 'date' }));
            }
            return null;
        }));
    }

    if (schema.nodes.temporal_tag) {
        rules.push(new InputRule(/(?:^|\s)(!([^\s!]+))\s$/, (state, match, start, end) => {
            const raw = match[1] || '';
            const value = raw.startsWith('!') ? raw.slice(1) : raw;
            if (!value) {
                return null;
            }
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.temporal_tag.create({ value, kind: 'generic' }));
        }));
    }

    if (schema.nodes.multicolumn) {
        rules.push(new InputRule(/^---:\s*(\d*)\s$/, (state, match, start, end) => {
            if (isInsideMulticolumn(state)) {
                return null;
            }
            const growth = parseInt(match[1]) || 1;
            return createMulticolumnTransaction(state, schema, growth, start, end);
        }));

        rules.push(new InputRule(/^:--:\s*(\d*)\s$/, (state, match, start, end) => {
            if (!isInsideMulticolumn(state)) {
                return null;
            }
            const growth = parseInt(match[1]) || 1;
            return addColumnTransaction(state, schema, growth, start, end);
        }));

        rules.push(new InputRule(/^:---\s$/, (state, match, start, end) => {
            if (!isInsideMulticolumn(state)) {
                return null;
            }
            return closeMulticolumnTransaction(state, schema, start, end);
        }));
    }

    return rules;
}
