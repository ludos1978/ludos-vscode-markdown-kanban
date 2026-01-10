// WYSIWYG spec-only definitions (no runtime editor dependency yet).

export type WysiwygAttrSpec = Record<string, { default?: unknown }>;

export type WysiwygNodeSpec = {
    group?: string;
    inline?: boolean;
    atom?: boolean;
    code?: boolean;
    defining?: boolean;
    draggable?: boolean;
    selectable?: boolean;
    marks?: string;
    content?: string;
    attrs?: WysiwygAttrSpec;
};

export type WysiwygMarkSpec = {
    attrs?: WysiwygAttrSpec;
    inclusive?: boolean;
    excludes?: string;
};

export type WysiwygSchemaSpec = {
    nodes: Record<string, WysiwygNodeSpec>;
    marks: Record<string, WysiwygMarkSpec>;
};

export const wysiwygSchemaSpec: WysiwygSchemaSpec = {
    nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*' },
        heading: {
            group: 'block',
            content: 'inline*',
            attrs: { level: { default: 1 } }
        },
        blockquote: { group: 'block', content: 'block+' },
        bullet_list: { group: 'block', content: 'list_item+' },
        ordered_list: {
            group: 'block',
            content: 'list_item+',
            attrs: { order: { default: 1 } }
        },
        list_item: { group: 'block', content: 'block+' },
        code_block: {
            group: 'block',
            content: 'text*',
            code: true,
            attrs: { params: { default: '' } }
        },
        horizontal_rule: { group: 'block', atom: true },
        table: { group: 'block', content: 'table_row+' },
        table_row: { content: 'table_cell+' },
        table_cell: {
            content: 'block+',
            attrs: { align: { default: null } }
        },
        multicolumn: { group: 'block', content: 'multicolumn_column+' },
        multicolumn_column: {
            group: 'block',
            content: 'block+',
            attrs: { growth: { default: 1 } }
        },
        container: {
            group: 'block',
            content: 'block+',
            attrs: { kind: { default: 'note' } }
        },
        include_block: {
            group: 'block',
            atom: true,
            attrs: { path: { default: '' }, includeType: { default: 'regular' } }
        },
        speaker_note: {
            group: 'block',
            content: 'text*',
            attrs: { raw: { default: '' } }
        },
        html_block: {
            group: 'block',
            content: 'text*',
            attrs: { raw: { default: '' }, mode: { default: 'hidden' } }
        },
        diagram_fence: {
            group: 'block',
            content: 'text*',
            code: true,
            marks: '',
            attrs: { lang: { default: '' } }
        },
        include_inline: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: { path: { default: '' }, includeType: { default: 'regular' }, missing: { default: false } }
        },
        wiki_link: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: { document: { default: '' }, title: { default: '' } }
        },
        tag: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: { value: { default: '' }, flavor: { default: 'tag' } }
        },
        date_tag: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: { value: { default: '' }, kind: { default: 'date' } }
        },
        person_tag: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: { value: { default: '' } }
        },
        temporal_tag: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: { value: { default: '' }, kind: { default: 'generic' } }
        },
        media_inline: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: {
                src: { default: '' },
                mediaType: { default: 'image' },
                alt: { default: '' },
                title: { default: '' }
            }
        },
        footnote: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: { id: { default: '' }, block: { default: false } }
        },
        text: { group: 'inline' }
    },
    marks: {
        em: {},
        strong: {},
        code: {},
        strike: { attrs: { style: { default: 'tilde' } } },
        underline: {},
        mark: {},
        sub: {},
        sup: {},
        ins: {},
        link: { attrs: { href: { default: '' }, title: { default: '' } } },
        abbr: { attrs: { title: { default: '' } } }
    }
};

export type TokenMapping = {
    tokens: string[];
    node?: string;
    mark?: string;
    attrs?: string[];
    notes?: string;
};

export const tokenMappings: TokenMapping[] = [
    { tokens: ['paragraph_open', 'paragraph_close'], node: 'paragraph' },
    { tokens: ['figure_open', 'figure_close'], node: 'paragraph', notes: 'markdown-it-image-figures wraps image-only paragraphs as figure' },
    { tokens: ['heading_open', 'heading_close'], node: 'heading', attrs: ['level'] },
    { tokens: ['blockquote_open', 'blockquote_close'], node: 'blockquote' },
    { tokens: ['bullet_list_open', 'bullet_list_close'], node: 'bullet_list' },
    { tokens: ['ordered_list_open', 'ordered_list_close'], node: 'ordered_list', attrs: ['order'] },
    { tokens: ['list_item_open', 'list_item_close'], node: 'list_item' },
    { tokens: ['fence'], node: 'diagram_fence', attrs: ['lang', 'code'], notes: 'Route non-diagram to code_block' },
    { tokens: ['code_block'], node: 'code_block', attrs: ['params'] },
    { tokens: ['hr'], node: 'horizontal_rule' },
    { tokens: ['table_open', 'table_close'], node: 'table' },
    { tokens: ['tr_open', 'tr_close'], node: 'table_row' },
    { tokens: ['th_open', 'th_close', 'td_open', 'td_close'], node: 'table_cell', attrs: ['align'] },
    { tokens: ['multicolumn_open', 'multicolumn_close'], node: 'multicolumn' },
    { tokens: ['multicolumn_block_open', 'multicolumn_block_close'], node: 'multicolumn_column', attrs: ['growth'] },
    { tokens: ['container_open', 'container_close'], node: 'container', attrs: ['kind'] },
    { tokens: ['include_block'], node: 'include_block', attrs: ['path', 'includeType'] },
    { tokens: ['include_content', 'include_placeholder'], node: 'include_inline', attrs: ['path', 'missing'] },
    { tokens: ['html_block'], node: 'html_block', attrs: ['raw', 'mode'] },
    { tokens: ['html_inline'], node: 'html_block', attrs: ['raw', 'mode'], notes: 'Use inline node or mark if needed' },
    { tokens: ['html_comment'], node: 'html_block', attrs: ['raw', 'mode'] },
    { tokens: ['speaker_note'], node: 'speaker_note', attrs: ['raw'] },
    { tokens: ['wiki_link_open', 'wiki_link_close'], node: 'wiki_link', attrs: ['document', 'title'] },
    { tokens: ['tag'], node: 'tag', attrs: ['value', 'flavor'] },
    { tokens: ['date_person_tag'], node: 'date_tag', attrs: ['value', 'kind'] },
    { tokens: ['temporal_tag'], node: 'temporal_tag', attrs: ['value', 'kind'] },
    { tokens: ['em_open', 'em_close'], mark: 'em' },
    { tokens: ['strong_open', 'strong_close'], mark: 'strong' },
    { tokens: ['s_open', 's_close'], mark: 'strike', attrs: ['style'] },
    { tokens: ['em_open', 'em_close'], mark: 'underline', notes: 'markdown-it-underline uses em tokens with markup "_" and <u> tag' },
    { tokens: ['mark_open', 'mark_close'], mark: 'mark' },
    { tokens: ['sub_open', 'sub_close'], mark: 'sub' },
    { tokens: ['sup_open', 'sup_close'], mark: 'sup' },
    { tokens: ['ins_open', 'ins_close'], mark: 'ins' },
    { tokens: ['code_inline'], mark: 'code', notes: 'Inline leaf token' },
    { tokens: ['link_open', 'link_close'], mark: 'link', attrs: ['href', 'title'] },
    { tokens: ['abbr_open', 'abbr_close'], mark: 'abbr', attrs: ['title'] },
    { tokens: ['image', 'audio', 'video'], node: 'media_inline', attrs: ['src', 'mediaType', 'alt', 'title'] },
    { tokens: ['footnote_ref', 'footnote_block'], node: 'footnote', notes: 'Doc-level store required' }
];

export type SerializerRule = {
    node?: string;
    mark?: string;
    strategy: string;
    notes?: string;
};

export const serializerRules: SerializerRule[] = [
    { node: 'diagram_fence', strategy: 'fenced code block with lang + raw code' },
    { node: 'multicolumn', strategy: '---: <growth> / :--: / :--- markers' },
    { node: 'include_block', strategy: '!!!include(path)!!! on its own line' },
    { node: 'include_inline', strategy: '!!!include(path)!!! inline' },
    { node: 'html_block', strategy: 'preserve raw content as-is', notes: 'Visibility is config-only' },
    { node: 'speaker_note', strategy: 'prefix each line with ;;' },
    { node: 'wiki_link', strategy: '[[doc|title]] or [[doc]]' },
    { node: 'tag', strategy: '#tag with original content' },
    { node: 'date_tag', strategy: '@date or @W12' },
    { node: 'person_tag', strategy: '@name' },
    { node: 'temporal_tag', strategy: '.token' },
    { mark: 'strike', strategy: 'preserve delimiter style (~~ or --)' },
    { mark: 'underline', strategy: '_underline_ (not emphasis)' },
    { mark: 'mark', strategy: '==mark==' },
    { mark: 'sub', strategy: '~sub~' },
    { mark: 'sup', strategy: '^sup^' },
    { mark: 'ins', strategy: '++ins++' },
    { mark: 'abbr', strategy: 'keep title in definition store' },
    { node: 'media_inline', strategy: 'markdown-it-media syntax where available' },
    { node: 'footnote', strategy: 'preserve ids and definition ordering' }
];
