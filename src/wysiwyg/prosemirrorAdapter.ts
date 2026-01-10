import { Mark, Node as ProseMirrorNode, Schema } from 'prosemirror-model';
import { WysiwygDoc, WysiwygMark, WysiwygNode } from './types';

function fragmentToArray(node: ProseMirrorNode): ProseMirrorNode[] {
    const children: ProseMirrorNode[] = [];
    node.content.forEach((child: ProseMirrorNode) => {
        children.push(child);
    });
    return children;
}

function createMarks(schema: Schema, marks?: WysiwygMark[]): Mark[] | null {
    if (!marks || marks.length === 0) {
        return null;
    }

    const result: Mark[] = [];
    for (const mark of marks) {
        const type = schema.marks[mark.type];
        if (!type) {
            continue;
        }
        result.push(type.create(mark.attrs || undefined));
    }

    return result.length > 0 ? result : null;
}

function buildPmNode(schema: Schema, node: WysiwygNode): ProseMirrorNode | null {
    if (node.type === 'text') {
        return schema.text(node.text || '', createMarks(schema, node.marks) || undefined);
    }

    const type = schema.nodes[node.type];
    if (!type) {
        return null;
    }

    const attrs = node.attrs ? { ...node.attrs } : undefined;
    const content = node.content
        ? node.content.map(child => buildPmNode(schema, child)).filter(Boolean) as ProseMirrorNode[]
        : undefined;

    return type.create(attrs, content || undefined);
}

export function wysiwygDocToProseMirror(schema: Schema, doc: WysiwygDoc): ProseMirrorNode {
    const content = doc.content ? doc.content.map(child => buildPmNode(schema, child)).filter(Boolean) as ProseMirrorNode[] : [];
    return schema.nodes.doc.create(undefined, content);
}

function buildWysiwygMarks(marks: readonly Mark[]): WysiwygMark[] | undefined {
    if (!marks || marks.length === 0) {
        return undefined;
    }

    return marks.map(mark => ({
        type: mark.type.name,
        attrs: mark.attrs && Object.keys(mark.attrs).length > 0 ? { ...mark.attrs } : undefined
    }));
}

function buildWysiwygNode(node: ProseMirrorNode): WysiwygNode {
    if (node.isText) {
        return {
            type: 'text',
            text: node.text || '',
            marks: buildWysiwygMarks(node.marks)
        };
    }

    const content = node.content?.size
        ? fragmentToArray(node).map(child => buildWysiwygNode(child))
        : undefined;

    return {
        type: node.type.name,
        attrs: node.attrs && Object.keys(node.attrs).length > 0 ? { ...node.attrs } : undefined,
        content
    };
}

export function proseMirrorToWysiwygDoc(node: ProseMirrorNode): WysiwygDoc {
    const content = fragmentToArray(node).map(child => buildWysiwygNode(child));
    return { type: 'doc', content };
}
