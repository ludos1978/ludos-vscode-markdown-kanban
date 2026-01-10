import { roundTripMarkdown } from '../../wysiwyg/pipeline';


describe('WYSIWYG pipeline', () => {
    it('round-trips markdown through token parsing and serialization', () => {
        const input = 'Hello #todo !w12';
        const result = roundTripMarkdown(input, {
            markdownItOptions: { temporalPrefix: '!' },
            serializerOptions: { temporalPrefix: '!' }
        });

        expect(result.doc.type).toBe('doc');
        expect(result.markdown).toBe('Hello #todo !w12');
    });
});
