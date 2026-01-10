import { buildWysiwygSchemaSpec } from '../../wysiwyg/schemaBuilder';

describe('WYSIWYG schema builder', () => {
    it('normalizes required node fields for editor schema use', () => {
        const schema = buildWysiwygSchemaSpec();

        expect(schema.nodes.doc.content).toBeDefined();
        expect(schema.nodes.text.inline).toBe(true);
        expect(schema.nodes.text.group).toBe('inline');
        expect(schema.nodes.paragraph.content).toBe('inline*');
        expect(schema.marks.strong).toBeDefined();
    });
});
