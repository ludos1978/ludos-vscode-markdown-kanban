import { MarkSpec, NodeSpec, Schema } from 'prosemirror-model';
import { buildWysiwygSchemaSpec } from './schemaBuilder';
import { WysiwygSchemaSpec, WysiwygNodeSpec, wysiwygSchemaSpec } from './spec';

function buildAttrs(spec?: WysiwygNodeSpec['attrs']): Record<string, { default?: unknown }> | undefined {
    if (!spec) {
        return undefined;
    }

    const attrs: Record<string, { default?: unknown }> = {};
    for (const [key, value] of Object.entries(spec)) {
        attrs[key] = { default: value.default };
    }
    return attrs;
}

function buildNodeToDOM(name: string, spec: WysiwygNodeSpec): NodeSpec['toDOM'] {
    switch (name) {
        case 'paragraph':
            return () => ['p', 0];
        case 'heading':
            return (node) => ['h' + (node.attrs.level || 1), 0];
        case 'blockquote':
            return () => ['blockquote', 0];
        case 'bullet_list':
            return () => ['ul', 0];
        case 'ordered_list':
            return (node) => ['ol', node.attrs.order ? { start: node.attrs.order } : {}, 0];
        case 'list_item':
            return () => ['li', 0];
        case 'code_block':
            return () => ['pre', ['code', 0]];
        case 'horizontal_rule':
            return () => ['hr'];
        case 'table':
            return () => ['table', ['tbody', 0]];
        case 'table_row':
            return () => ['tr', 0];
        case 'table_cell':
            return (node) => {
                const attrs: Record<string, string> = {};
                if (node.attrs.align) {
                    attrs.style = `text-align: ${node.attrs.align}`;
                }
                return ['td', attrs, 0];
            };
        case 'multicolumn':
            return () => [
                'div',
                { class: 'wysiwyg-multicolumn' },
                [
                    'div',
                    { class: 'wysiwyg-multicolumn-toolbar' },
                    ['button', { class: 'wysiwyg-multicolumn-btn', 'data-action': 'remove', type: 'button', contenteditable: 'false', title: 'Remove column' }, '−'],
                    ['button', { class: 'wysiwyg-multicolumn-btn', 'data-action': 'add', type: 'button', contenteditable: 'false', title: 'Add column' }, '+']
                ],
                ['div', { class: 'wysiwyg-multicolumn-columns' }, 0]
            ];
        case 'multicolumn_column':
            return (node) => [
                'div',
                {
                    class: 'wysiwyg-multicolumn-column',
                    'data-growth': node.attrs.growth,
                    style: `flex: ${node.attrs.growth || 1} 1 0%`
                },
                0
            ];
        case 'container':
            return (node) => ['div', { class: `wysiwyg-container wysiwyg-container-${node.attrs.kind || 'note'}`, 'data-kind': node.attrs.kind || 'note' }, 0];
        case 'include_block':
            return (node) => [
                'div',
                { class: 'wysiwyg-include-block', 'data-path': node.attrs.path || '' },
                ['button', { class: 'wysiwyg-edit-btn', 'data-action': 'include', type: 'button', contenteditable: 'false' }, 'Edit'],
                `!!!include(${node.attrs.path || ''})!!!`
            ];
        case 'speaker_note':
            return () => ['div', { class: 'wysiwyg-speaker-note' }, 0];
        case 'html_block':
            return (node) => ['div', { class: 'wysiwyg-html-block', 'data-mode': node.attrs.mode || 'block' }, node.attrs.raw || ''];
        case 'diagram_fence':
            return (node) => [
                'div',
                { class: 'wysiwyg-diagram-block', 'data-lang': node.attrs.lang || '' },
                ['button', { class: 'wysiwyg-edit-btn', 'data-action': 'diagram', type: 'button', contenteditable: 'false' }, 'Edit'],
                ['pre', { class: 'wysiwyg-diagram', 'data-lang': node.attrs.lang || '' }, ['code', 0]]
            ];
        case 'include_inline':
            return (node) => [
                'span',
                { class: 'wysiwyg-include-inline', 'data-path': node.attrs.path || '' },
                ['button', { class: 'wysiwyg-edit-btn', 'data-action': 'include', type: 'button', contenteditable: 'false' }, 'Edit'],
                `!!!include(${node.attrs.path || ''})!!!`
            ];
        case 'wiki_link':
            return (node) => ['span', { class: 'wysiwyg-wiki-link', 'data-document': node.attrs.document || '' }, node.attrs.title || node.attrs.document || ''];
        case 'tag':
            return (node) => ['span', { class: 'wysiwyg-tag', 'data-value': node.attrs.value || '' }, `#${node.attrs.value || ''}`];
        case 'date_tag':
            return (node) => ['span', { class: 'wysiwyg-date-tag', 'data-value': node.attrs.value || '' }, `@${node.attrs.value || ''}`];
        case 'person_tag':
            return (node) => ['span', { class: 'wysiwyg-person-tag', 'data-value': node.attrs.value || '' }, `@${node.attrs.value || ''}`];
        case 'temporal_tag':
            return (node) => ['span', { class: 'wysiwyg-temporal-tag', 'data-value': node.attrs.value || '' }, `!${node.attrs.value || ''}`];
        case 'media_inline':
            return (node) => (
                (node.attrs.mediaType || 'image') === 'image'
                    ? [
                        'span',
                        {
                            class: 'image-path-overlay-container wysiwyg-media',
                            'data-image-path': node.attrs.src || '',
                            'data-src': node.attrs.src || '',
                            'data-type': node.attrs.mediaType || 'image'
                        },
                        ['img', {
                            src: node.attrs.src || '',
                            alt: node.attrs.alt || '',
                            title: node.attrs.title || '',
                            class: 'markdown-image',
                            'data-original-src': node.attrs.src || '',
                            contenteditable: 'false'
                        }],
                        ['button', { class: 'image-menu-btn', 'data-action': 'image-menu', type: 'button', title: 'Path options', contenteditable: 'false' }, '☰']
                    ]
                    : [
                        'span',
                        { class: 'wysiwyg-media', 'data-src': node.attrs.src || '', 'data-type': node.attrs.mediaType || 'image' },
                        ['button', { class: 'wysiwyg-edit-btn', 'data-action': 'media', type: 'button', contenteditable: 'false' }, 'Edit'],
                        node.attrs.src || ''
                    ]
            );
        case 'media_block':
            return (node) => (
                (node.attrs.mediaType || 'image') === 'image'
                    ? [
                        'div',
                        {
                            class: 'image-path-overlay-container wysiwyg-media wysiwyg-media-block',
                            'data-image-path': node.attrs.src || '',
                            'data-src': node.attrs.src || '',
                            'data-type': node.attrs.mediaType || 'image'
                        },
                        ['img', {
                            src: node.attrs.src || '',
                            alt: node.attrs.alt || '',
                            title: node.attrs.title || '',
                            class: 'markdown-image',
                            'data-original-src': node.attrs.src || '',
                            contenteditable: 'false'
                        }],
                        ['button', { class: 'image-menu-btn', 'data-action': 'image-menu', type: 'button', title: 'Path options', contenteditable: 'false' }, '☰']
                    ]
                    : [
                        'div',
                        { class: 'video-path-overlay-container wysiwyg-media wysiwyg-media-block', 'data-src': node.attrs.src || '', 'data-type': node.attrs.mediaType || 'image' },
                        ['button', { class: 'video-menu-btn', 'data-action': 'video-menu', type: 'button', title: 'Path options', contenteditable: 'false' }, '☰'],
                        node.attrs.src || ''
                    ]
            );
        case 'footnote':
            return (node) => ['span', { class: 'wysiwyg-footnote', 'data-id': node.attrs.id || '' }, `[^${node.attrs.id || ''}]`];
        case 'text':
            return undefined;
        default:
            if (spec.inline) {
                return () => ['span', 0];
            }
            return () => ['div', 0];
    }
}

function buildMarkToDOM(name: string): MarkSpec['toDOM'] {
    switch (name) {
        case 'em':
            return () => ['em', 0];
        case 'strong':
            return () => ['strong', 0];
        case 'code':
            return () => ['code', 0];
        case 'strike':
            return () => ['del', 0];
        case 'underline':
            return () => ['u', 0];
        case 'mark':
            return () => ['mark', 0];
        case 'sub':
            return () => ['sub', 0];
        case 'sup':
            return () => ['sup', 0];
        case 'ins':
            return () => ['ins', 0];
        case 'link':
            return (mark) => ['a', { href: mark.attrs.href || '', title: mark.attrs.title || '' }, 0];
        case 'abbr':
            return (mark) => ['abbr', { title: mark.attrs.title || '' }, 0];
        default:
            return () => ['span', 0];
    }
}

export function buildProseMirrorSchema(source: WysiwygSchemaSpec = wysiwygSchemaSpec): Schema {
    const normalized = buildWysiwygSchemaSpec(source);

    const nodes: Record<string, NodeSpec> = {};
    for (const [name, spec] of Object.entries(normalized.nodes)) {
        nodes[name] = {
            content: spec.content,
            group: spec.group,
            inline: spec.inline,
            atom: spec.atom,
            code: spec.code,
            defining: spec.defining,
            draggable: spec.draggable,
            selectable: spec.selectable,
            marks: spec.marks,
            attrs: buildAttrs(spec.attrs),
            toDOM: name === 'text' ? undefined : buildNodeToDOM(name, spec)
        };
    }

    const marks: Record<string, MarkSpec> = {};
    for (const [name, spec] of Object.entries(normalized.marks)) {
        marks[name] = {
            attrs: buildAttrs(spec.attrs),
            inclusive: spec.inclusive,
            excludes: spec.excludes,
            toDOM: buildMarkToDOM(name)
        };
    }

    return new Schema({ nodes, marks });
}
