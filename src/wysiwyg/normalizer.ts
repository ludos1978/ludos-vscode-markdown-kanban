import { EditorState, Transaction } from 'prosemirror-state';
import type { Node as ProseMirrorNode, Schema } from 'prosemirror-model';

export function normalizeMediaBlocks(state: EditorState): Transaction | null {
    const mediaInline = state.schema.nodes.media_inline;
    const mediaBlock = state.schema.nodes.media_block;
    if (!mediaInline || !mediaBlock) {
        return null;
    }

    const targets: Array<{ pos: number; size: number; nodes: ProseMirrorNode[] }> = [];
    const selectionFrom = state.selection.from;
    const selectionTo = state.selection.to;
    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name !== 'paragraph') {
            return;
        }
        const paragraphStart = pos;
        const paragraphEnd = pos + node.nodeSize;
        const selectionInside = selectionFrom > paragraphStart && selectionTo < paragraphEnd;
        const mediaNodes: ProseMirrorNode[] = [];
        let hasOther = false;
        node.forEach((child) => {
            if (child.type === mediaInline) {
                mediaNodes.push(child);
                return;
            }
            if (child.isText && (child.text || '').trim() === '') {
                return;
            }
            hasOther = true;
        });
        if (hasOther || mediaNodes.length === 0 || selectionInside) {
            return;
        }
        const blockNodes = mediaNodes.map(child => mediaBlock.create({ ...child.attrs }));
        targets.push({ pos, size: node.nodeSize, nodes: blockNodes });
    });

    if (targets.length === 0) {
        return null;
    }

    let tr = state.tr;
    for (let i = targets.length - 1; i >= 0; i -= 1) {
        const target = targets[i];
        tr = tr.replaceWith(target.pos, target.pos + target.size, target.nodes);
    }

    const firstChild = tr.doc.content.firstChild;
    const lastChild = tr.doc.content.lastChild;
    if (firstChild && firstChild.isAtom) {
        tr = tr.insert(0, state.schema.nodes.paragraph.create());
    }
    if (lastChild && lastChild.isAtom) {
        tr = tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create());
    }

    return tr;
}

export function normalizeBlockBoundaries(state: EditorState): Transaction | null {
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) {
        return null;
    }

    const insertions = new Set<number>();

    const inspectContainer = (node: ProseMirrorNode, pos: number) => {
        if (!(node.isBlock || node.type.name === 'doc')) {
            return;
        }
        const contentSpec = node.type?.spec?.content || '';
        if (!contentSpec.includes('block')) {
            return;
        }
        if (node.childCount === 0) {
            return;
        }

        const children: Array<{ node: ProseMirrorNode; offset: number }> = [];
        node.forEach((child, offset) => {
            children.push({ node: child, offset });
        });

        children.forEach((entry, index) => {
            const child = entry.node;
            const needsBoundary = child.isTextblock && child.type.name === 'diagram_fence';
            if (child.isTextblock && !needsBoundary) {
                return;
            }
            const prev = index > 0 ? children[index - 1].node : null;
            const next = index < children.length - 1 ? children[index + 1].node : null;
            const childPos = (node.type.name === 'doc' ? pos : pos + 1) + entry.offset;
            if (!prev || !prev.isTextblock) {
                insertions.add(childPos);
            }
            if (!next || !next.isTextblock) {
                insertions.add(childPos + child.nodeSize);
            }
        });
    };

    inspectContainer(state.doc, 0);
    state.doc.descendants((node, pos) => {
        inspectContainer(node, pos);
    });

    if (insertions.size === 0) {
        return null;
    }

    const positions = Array.from(insertions).sort((a, b) => b - a);
    let tr = state.tr;
    positions.forEach((insertPos) => {
        tr = tr.insert(insertPos, paragraph.create());
    });
    return tr;
}

export function normalizeTaskCheckboxes(state: EditorState): Transaction | null {
    const checkboxNode = state.schema.nodes.task_checkbox;
    const paragraph = state.schema.nodes.paragraph;
    const listItem = state.schema.nodes.list_item;
    if (!checkboxNode || !paragraph || !listItem) {
        return null;
    }

    const targets: Array<{ from: number; to: number; nodes: ProseMirrorNode[] }> = [];

    state.doc.descendants((node, pos) => {
        if (node.type !== listItem) {
            return;
        }
        let paragraphNode: ProseMirrorNode | null = null;
        let paragraphPos = 0;
        node.forEach((child: ProseMirrorNode, offset: number) => {
            if (!paragraphNode && child.type === paragraph) {
                paragraphNode = child;
                paragraphPos = pos + 1 + offset;
            }
        });
        if (!paragraphNode) {
            return;
        }
        const para = paragraphNode as ProseMirrorNode;

        let firstInline: { node: ProseMirrorNode; pos: number } | null = null;
        let inlineOffset = 0;
        for (let i = 0; i < para.childCount; i += 1) {
            const child = para.child(i);
            if (child.type === checkboxNode) {
                firstInline = { node: child, pos: paragraphPos + 1 + inlineOffset };
                break;
            }
            if (child.isText && (child.text || '').trim() === '') {
                inlineOffset += child.nodeSize;
                continue;
            }
            firstInline = { node: child, pos: paragraphPos + 1 + inlineOffset };
            break;
        }

        if (!firstInline || firstInline.node.type === checkboxNode || !firstInline.node.isText) {
            return;
        }

        const text = firstInline.node.text || '';
        const match = text.match(/^\[( |x|X)\]\s+/);
        if (!match) {
            return;
        }

        const checked = match[1].toLowerCase() === 'x';
        const rest = text.slice(match[0].length);
        const replacement: ProseMirrorNode[] = [checkboxNode.create({ checked })];
        if (rest) {
            replacement.push(state.schema.text(rest, firstInline.node.marks));
        }
        targets.push({ from: firstInline.pos, to: firstInline.pos + firstInline.node.nodeSize, nodes: replacement });
    });

    if (targets.length === 0) {
        return null;
    }

    let tr = state.tr;
    for (let i = targets.length - 1; i >= 0; i -= 1) {
        const target = targets[i];
        tr = tr.replaceWith(target.from, target.to, target.nodes);
    }
    return tr;
}

export function normalizeEditableDoc(schema: Schema, doc: ProseMirrorNode): ProseMirrorNode {
    let state = EditorState.create({ schema, doc });
    for (const normalize of [normalizeMediaBlocks, normalizeBlockBoundaries, normalizeTaskCheckboxes]) {
        const tr = normalize(state);
        if (tr) {
            state = state.apply(tr);
        }
    }
    return state.doc;
}
