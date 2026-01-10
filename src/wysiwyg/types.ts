// WYSIWYG data types (editor-agnostic). No runtime dependency on ProseMirror yet.

export type WysiwygMark = {
    type: string;
    attrs?: Record<string, unknown>;
};

export type WysiwygNode = {
    type: string;
    attrs?: Record<string, unknown>;
    content?: WysiwygNode[];
    marks?: WysiwygMark[];
    text?: string;
};

export type WysiwygDoc = WysiwygNode & { type: 'doc' };

export type MarkdownItToken = {
    type: string;
    tag?: string;
    attrs?: Array<[string, string]>;
    content?: string;
    info?: string;
    markup?: string;
    nesting?: number;
    level?: number;
    block?: boolean;
    map?: number[];
    meta?: Record<string, unknown>;
    children?: MarkdownItToken[];
    filePath?: string;
    attrGet?: (name: string) => string | null;
};
