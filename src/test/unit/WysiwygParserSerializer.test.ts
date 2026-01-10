import { parseMarkdownItTokens } from '../../wysiwyg/tokenParser';
import { serializeWysiwygDoc } from '../../wysiwyg/serializer';
import { MarkdownItToken, WysiwygDoc } from '../../wysiwyg/types';

function findNodeByType(nodes: WysiwygDoc['content'], type: string) {
    return nodes?.find(node => node.type === type);
}

describe('WYSIWYG token parser', () => {
    it('maps markdown-it tokens into WYSIWYG nodes and marks', () => {
        const tokens: MarkdownItToken[] = [
            { type: 'paragraph_open', tag: 'p', nesting: 1 },
            {
                type: 'inline',
                children: [
                    { type: 'text', content: 'Hello ' },
                    { type: 'strong_open', markup: '**' },
                    { type: 'text', content: 'world' },
                    { type: 'strong_close', markup: '**' },
                    { type: 'text', content: ' and ' },
                    { type: 'em_open', markup: '_' },
                    { type: 'text', content: 'underline' },
                    { type: 'em_close', markup: '_' },
                    { type: 'text', content: ' ' },
                    { type: 'tag', content: 'todo' },
                    { type: 'text', content: ' ' },
                    { type: 'wiki_link_open', attrs: [['data-document', 'Doc']] },
                    { type: 'text', content: 'Doc Title' },
                    { type: 'wiki_link_close' },
                    { type: 'text', content: ' ' },
                    { type: 'temporal_tag', content: 'w12', meta: { type: 'week' } },
                    { type: 'text', content: ' ' },
                    { type: 'include_content', attrs: [['data-include-file', 'inline.md']] }
                ]
            },
            { type: 'paragraph_close', tag: 'p', nesting: -1 },
            { type: 'include_block', filePath: 'block.md' },
            { type: 'container_note_open', tag: 'div', nesting: 1 },
            { type: 'paragraph_open', tag: 'p', nesting: 1 },
            { type: 'inline', children: [{ type: 'text', content: 'Inside' }] },
            { type: 'paragraph_close', tag: 'p', nesting: -1 },
            { type: 'container_note_close', tag: 'div', nesting: -1 },
            { type: 'multicolumn_open', tag: 'div', nesting: 1 },
            { type: 'multicolumn_block_open', tag: 'div', nesting: 1, meta: { growth: 2 } },
            { type: 'paragraph_open', tag: 'p', nesting: 1 },
            { type: 'inline', children: [{ type: 'text', content: 'Col' }] },
            { type: 'paragraph_close', tag: 'p', nesting: -1 },
            { type: 'multicolumn_block_close', tag: 'div', nesting: -1 },
            { type: 'multicolumn_close', tag: 'div', nesting: -1 }
        ];

        const doc = parseMarkdownItTokens(tokens);
        expect(doc.type).toBe('doc');
        expect(doc.content?.length).toBe(4);

        const paragraph = doc.content?.[0];
        expect(paragraph?.type).toBe('paragraph');
        const paragraphContent = paragraph?.content ?? [];

        const strongText = paragraphContent.find(node => node.text === 'world');
        expect(strongText).toMatchObject({ marks: [{ type: 'strong' }] });

        const underlineText = paragraphContent.find(node => node.text === 'underline');
        expect(underlineText).toMatchObject({ marks: [{ type: 'underline' }] });

        const tagNode = paragraphContent.find(node => node.type === 'tag');
        expect(tagNode).toMatchObject({ attrs: { value: 'todo', flavor: 'tag' } });

        const wikiLink = paragraphContent.find(node => node.type === 'wiki_link');
        expect(wikiLink).toMatchObject({ attrs: { document: 'Doc', title: 'Doc Title' } });

        const temporal = paragraphContent.find(node => node.type === 'temporal_tag');
        expect(temporal).toMatchObject({ attrs: { value: 'w12', kind: 'week' } });

        const includeInline = paragraphContent.find(node => node.type === 'include_inline');
        expect(includeInline).toMatchObject({ attrs: { path: 'inline.md', includeType: 'regular', missing: false } });

        const includeBlock = findNodeByType(doc.content, 'include_block');
        expect(includeBlock).toMatchObject({ attrs: { path: 'block.md', includeType: 'regular' } });

        const container = findNodeByType(doc.content, 'container');
        expect(container).toMatchObject({ attrs: { kind: 'note' } });

        const multicolumn = findNodeByType(doc.content, 'multicolumn');
        const column = multicolumn?.content?.[0];
        expect(column).toMatchObject({ type: 'multicolumn_column', attrs: { growth: 2 } });
    });
});

describe('WYSIWYG markdown serializer', () => {
    it('serializes core blocks, inline nodes, and marks', () => {
        const doc: WysiwygDoc = {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Hello ' },
                        { type: 'text', text: 'world', marks: [{ type: 'strong' }] },
                        { type: 'text', text: ' with ' },
                        { type: 'text', text: 'underline', marks: [{ type: 'underline' }] },
                        { type: 'text', text: ' and ' },
                        { type: 'text', text: 'strike', marks: [{ type: 'strike', attrs: { style: 'dash' } }] }
                    ]
                },
                {
                    type: 'bullet_list',
                    content: [
                        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }] },
                        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 2' }] }] }
                    ]
                },
                {
                    type: 'ordered_list',
                    attrs: { order: 3 },
                    content: [
                        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third' }] }] },
                        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fourth' }] }] }
                    ]
                },
                { type: 'code_block', attrs: { params: 'js' }, content: [{ type: 'text', text: 'const x = 1;' }] },
                { type: 'diagram_fence', attrs: { lang: 'mermaid', code: 'graph TD' } },
                { type: 'container', attrs: { kind: 'note' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note body' }] }] },
                {
                    type: 'multicolumn',
                    content: [
                        { type: 'multicolumn_column', attrs: { growth: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left' }] }] },
                        { type: 'multicolumn_column', attrs: { growth: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] }
                    ]
                },
                { type: 'include_block', attrs: { path: './file.md', includeType: 'regular' } },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'See ' },
                        { type: 'include_inline', attrs: { path: 'inline.md', includeType: 'regular', missing: false } },
                        { type: 'text', text: ' plus ' },
                        { type: 'wiki_link', attrs: { document: 'Doc', title: 'Doc Title' } },
                        { type: 'text', text: ' ' },
                        { type: 'tag', attrs: { value: 'todo', flavor: 'tag' } },
                        { type: 'text', text: ' ' },
                        { type: 'date_tag', attrs: { value: '2025-01-28', kind: 'date' } },
                        { type: 'text', text: ' ' },
                        { type: 'temporal_tag', attrs: { value: 'w12', kind: 'week' } }
                    ]
                },
                { type: 'speaker_note', attrs: { raw: 'line1\nline2' }, content: [{ type: 'text', text: 'line1\nline2' }] },
                { type: 'html_block', attrs: { raw: '<div>Raw</div>', mode: 'block' }, content: [{ type: 'text', text: '<div>Raw</div>' }] },
                { type: 'html_block', attrs: { raw: 'comment', mode: 'comment' }, content: [{ type: 'text', text: 'comment' }] }
            ]
        };

        const serialized = serializeWysiwygDoc(doc);
        const expected = [
            '## Title',
            'Hello **world** with _underline_ and --strike--',
            '- Item 1\n- Item 2',
            '3. Third\n4. Fourth',
            '```js\nconst x = 1;\n```',
            '```mermaid\ngraph TD\n```',
            '::: note\nNote body\n:::',
            '---: 1\nLeft\n:--: 2\nRight\n:---',
            '!!!include(./file.md)!!!',
            'See !!!include(inline.md)!!! plus [[Doc|Doc Title]] #todo @2025-01-28 .w12',
            ';;line1\n;;line2',
            '<div>Raw</div>',
            '<!--comment-->'
        ].join('\n\n');

        expect(serialized).toBe(expected);
    });
});
