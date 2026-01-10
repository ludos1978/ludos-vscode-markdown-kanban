import { MarkdownItToken, WysiwygDoc, WysiwygNode } from './types';
import { tokenMappings } from './spec';

// Minimal skeleton to be expanded once ProseMirror is wired in.
// For now we only provide structure and mapping lookup.

export function parseMarkdownItTokens(tokens: MarkdownItToken[]): WysiwygDoc {
    const doc: WysiwygDoc = { type: 'doc', content: [] };

    if (!tokens || tokens.length === 0) {
        return doc;
    }

    // TODO: Implement full token -> node tree mapping.
    // This placeholder walks tokens to validate mapping coverage only.
    for (const token of tokens) {
        const mapping = tokenMappings.find(entry => entry.tokens.includes(token.type));
        if (!mapping) {
            continue;
        }

        // Placeholder node to prove mapping can be resolved.
        const node: WysiwygNode = {
            type: mapping.node || 'paragraph',
            attrs: {},
            content: []
        };

        if (token.content) {
            node.content = [{ type: 'text', text: token.content }];
        }

        if (doc.content) {
            doc.content.push(node);
        }
    }

    return doc;
}
