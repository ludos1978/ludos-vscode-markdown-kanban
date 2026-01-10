import { WysiwygDoc, WysiwygNode } from './types';
import { serializerRules } from './spec';

// Minimal skeleton to be expanded once ProseMirror is wired in.
// This returns a stable string without altering content while we build out rules.

export function serializeWysiwygDoc(doc: WysiwygDoc): string {
    if (!doc || !doc.content || doc.content.length === 0) {
        return '';
    }

    return doc.content.map(node => serializeNode(node)).join('\n\n');
}

function serializeNode(node: WysiwygNode): string {
    const rule = serializerRules.find(entry => entry.node === node.type);
    if (!rule) {
        return serializeFallback(node);
    }

    // Placeholder behavior: fall back until concrete rules are implemented.
    return serializeFallback(node);
}

function serializeFallback(node: WysiwygNode): string {
    if (node.text) {
        return node.text;
    }

    if (node.content && node.content.length > 0) {
        return node.content.map(child => serializeFallback(child)).join('');
    }

    return '';
}
