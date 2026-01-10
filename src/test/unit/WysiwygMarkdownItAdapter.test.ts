import { parseMarkdownToWysiwygDoc } from '../../wysiwyg/markdownItAdapter';
import { createWysiwygMarkdownIt } from '../../wysiwyg/markdownItFactory';

function getInlineTypes(doc: any) {
    return doc.content?.[0]?.content?.map((node: any) => node.type) ?? [];
}

describe('WYSIWYG markdown-it adapter', () => {
    it('parses custom tag, temporal, wiki link, and include syntax', () => {
        const md = createWysiwygMarkdownIt({ temporalPrefix: '!' });
        const markdown = 'Hello #todo !w12 [[Doc|Title]] and !!!include(inline.md)!!!';

        const doc = parseMarkdownToWysiwygDoc(markdown, md);
        const inlineTypes = getInlineTypes(doc);

        expect(inlineTypes).toContain('tag');
        expect(inlineTypes).toContain('temporal_tag');
        expect(inlineTypes).toContain('wiki_link');
        expect(inlineTypes).toContain('include_inline');
    });

    it('parses include blocks as include_block nodes', () => {
        const md = createWysiwygMarkdownIt({ temporalPrefix: '!' });
        const markdown = '!!!include(block.md)!!!\n\nNext paragraph';

        const doc = parseMarkdownToWysiwygDoc(markdown, md);
        const includeNode = doc.content?.find(node => node.type === 'include_block');

        expect(includeNode).toBeDefined();
        expect(includeNode?.attrs?.path).toBe('block.md');
    });
});
