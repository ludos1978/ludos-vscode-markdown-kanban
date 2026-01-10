import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands';
import { inputRules, smartQuotes, ellipsis, emDash, InputRule } from 'prosemirror-inputrules';
import { wrapInList } from 'prosemirror-schema-list';

import { buildProseMirrorSchema } from '../wysiwyg/prosemirrorSchema';
import { proseMirrorToWysiwygDoc, wysiwygDocToProseMirror } from '../wysiwyg/prosemirrorAdapter';
import { markdownToWysiwygDoc, wysiwygDocToMarkdown } from '../wysiwyg/pipeline';

export type WysiwygEditorOptions = {
    markdown: string;
    temporalPrefix?: string;
    onChange?: (markdown: string) => void;
    onSubmit?: () => void;
};

const STYLE_PAIRS: Record<string, { start: string; end: string }> = {
    '*': { start: '*', end: '*' },
    '_': { start: '_', end: '_' },
    '~': { start: '~', end: '~' },
    '^': { start: '^', end: '^' },
    '`': { start: '`', end: '`' },
    '"': { start: '"', end: '"' },
    "'": { start: "'", end: "'" },
    '[': { start: '[', end: ']' },
    '(': { start: '(', end: ')' },
    '{': { start: '{', end: '}' },
    '<': { start: '<', end: '>' }
};

const TILDE_DEAD_CODES = new Set([
    'IntlBackslash',
    'Backquote',
    'Quote',
    'IntlRo',
    'KeyN',
    'BracketRight',
    'Digit4'
]);

function updateNodeAttrs(view: EditorView, pos: number, attrs: Record<string, unknown>): void {
    const tr = view.state.tr.setNodeMarkup(pos, undefined, attrs);
    view.dispatch(tr);
}

function getModalApi(): { showInputModal?: (...args: unknown[]) => void } {
    return window as unknown as { showInputModal?: (...args: unknown[]) => void };
}

function openPathEditor(view: EditorView, node: { attrs?: Record<string, unknown> }, pos: number): void {
    const currentPath = typeof node.attrs?.path === 'string' ? node.attrs.path : '';
    const modalApi = getModalApi();
    if (typeof modalApi.showInputModal === 'function') {
        modalApi.showInputModal(
            'Edit include path',
            'Update include path',
            'Path',
            (value: string) => {
                updateNodeAttrs(view, pos, { ...node.attrs, path: value });
            },
            null,
            { defaultValue: currentPath }
        );
        return;
    }
    const nextValue = window.prompt('Include path', currentPath);
    if (nextValue !== null) {
        updateNodeAttrs(view, pos, { ...node.attrs, path: nextValue });
    }
}

function openMediaEditor(view: EditorView, node: { attrs?: Record<string, unknown> }, pos: number): void {
    const currentSrc = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
    const modalApi = getModalApi();
    if (typeof modalApi.showInputModal === 'function') {
        modalApi.showInputModal(
            'Edit media source',
            'Update media source URL/path',
            'Source',
            (value: string) => {
                updateNodeAttrs(view, pos, { ...node.attrs, src: value });
            },
            null,
            { defaultValue: currentSrc }
        );
        return;
    }
    const nextValue = window.prompt('Media source', currentSrc);
    if (nextValue !== null) {
        updateNodeAttrs(view, pos, { ...node.attrs, src: nextValue });
    }
}

function focusDiagram(view: EditorView, nodePos: number): void {
    const start = Math.min(nodePos + 1, view.state.doc.content.size);
    const selection = TextSelection.create(view.state.doc, start);
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
}

function addMulticolumnColumn(view: EditorView, node: any, nodePos: number): void {
    if (!node || node.type?.name !== 'multicolumn') {
        return;
    }
    const schema = view.state.schema;
    const columnNode = schema.nodes.multicolumn_column.createAndFill({ growth: 1 });
    if (!columnNode) {
        return;
    }
    const insertPos = nodePos + node.nodeSize - 1;
    view.dispatch(view.state.tr.insert(insertPos, columnNode));
}

function removeMulticolumnColumn(view: EditorView, node: any, nodePos: number): void {
    if (!node || node.type?.name !== 'multicolumn') {
        return;
    }
    if (node.childCount <= 1) {
        return;
    }
    let lastOffset: number | null = null;
    let lastSize = 0;
    node.forEach((child: any, offset: number) => {
        lastOffset = offset;
        lastSize = child.nodeSize;
    });
    if (lastOffset === null) {
        return;
    }
    const from = nodePos + 1 + lastOffset;
    const to = from + lastSize;
    view.dispatch(view.state.tr.delete(from, to));
}

function getStyleKey(event: KeyboardEvent): string | null {
    if (!event) {
        return null;
    }
    if (event.key && STYLE_PAIRS[event.key]) {
        return event.key;
    }
    if (event.key === 'Dead' && event.code && TILDE_DEAD_CODES.has(event.code)) {
        return '~';
    }
    return null;
}

function wrapSelectionWithText(view: EditorView, start: string, end: string): boolean {
    const { from, to } = view.state.selection;
    if (from === to) {
        return false;
    }

    const tr = view.state.tr;
    tr.insertText(end, to, to);
    tr.insertText(start, from, from);
    tr.setSelection(TextSelection.create(tr.doc, from + start.length, to + start.length));
    view.dispatch(tr);
    return true;
}

function inlineNodeToMarkdown(node: any, temporalPrefix: string): string | null {
    if (!node || !node.type?.name) {
        return null;
    }
    switch (node.type.name) {
        case 'media_inline': {
            const mediaType = node.attrs?.mediaType || 'image';
            const src = node.attrs?.src || '';
            if (!src) {
                return null;
            }
            if (mediaType === 'image') {
                const alt = node.attrs?.alt || '';
                const title = node.attrs?.title ? ` "${node.attrs.title}"` : '';
                return `![${alt}](${src}${title})`;
            }
            const tag = mediaType === 'audio' ? 'audio' : 'video';
            return `<${tag} src="${src}" controls></${tag}>`;
        }
        case 'include_inline': {
            const path = node.attrs?.path || '';
            return path ? `!!!include(${path})!!!` : null;
        }
        case 'wiki_link': {
            const document = node.attrs?.document || '';
            const title = node.attrs?.title || '';
            if (!document) {
                return null;
            }
            return title && title !== document ? `[[${document}|${title}]]` : `[[${document}]]`;
        }
        case 'tag': {
            const value = node.attrs?.value || '';
            return value ? `#${value}` : null;
        }
        case 'date_tag': {
            const value = node.attrs?.value || '';
            return value ? `@${value}` : null;
        }
        case 'person_tag': {
            const value = node.attrs?.value || '';
            return value ? `@${value}` : null;
        }
        case 'temporal_tag': {
            const value = node.attrs?.value || '';
            return value ? `${temporalPrefix}${value}` : null;
        }
        case 'footnote': {
            const id = node.attrs?.id || '';
            return id ? `[^${id}]` : null;
        }
        default:
            return null;
    }
}

function buildMarkdownInputRules(schema: any): InputRule[] {
    const rules: InputRule[] = [];

    if (schema.nodes.media_inline) {
        rules.push(new InputRule(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/, (state, match, start, end) => {
            const alt = match[1] || '';
            const src = match[2] || '';
            const title = match[3] || '';
            if (!src) {
                return null;
            }
            const attrs: Record<string, unknown> = { src, mediaType: 'image' };
            if (alt) {
                attrs.alt = alt;
            }
            if (title) {
                attrs.title = title;
            }
            return state.tr.replaceWith(start, end, schema.nodes.media_inline.create(attrs));
        }));
    }

    if (schema.marks.link) {
        rules.push(new InputRule(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/, (state, match, start, end) => {
            const text = match[1] || '';
            const href = match[2] || '';
            const title = match[3] || '';
            if (!text || !href) {
                return null;
            }
            const mark = schema.marks.link.create({ href, title });
            const textNode = schema.text(text, [mark]);
            return state.tr.replaceWith(start, end, textNode);
        }));
    }

    if (schema.nodes.include_inline) {
        rules.push(new InputRule(/!!!include\(([^)]+)\)!!!$/, (state, match, start, end) => {
            const path = match[1]?.trim() || '';
            if (!path) {
                return null;
            }
            return state.tr.replaceWith(start, end, schema.nodes.include_inline.create({ path, includeType: 'regular', missing: false }));
        }));
    }

    if (schema.nodes.wiki_link) {
        rules.push(new InputRule(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/, (state, match, start, end) => {
            const document = match[1]?.trim() || '';
            const title = match[2]?.trim() || '';
            if (!document) {
                return null;
            }
            return state.tr.replaceWith(start, end, schema.nodes.wiki_link.create({ document, title: title || document }));
        }));
    }

    return rules;
}

export class WysiwygEditor {
    private view: EditorView;
    private lastMarkdown: string;
    private temporalPrefix: string;
    private onChange?: (markdown: string) => void;
    private onSubmit?: () => void;

    constructor(container: HTMLElement, options: WysiwygEditorOptions) {
        this.temporalPrefix = options.temporalPrefix || '!';
        this.onChange = options.onChange;
        this.onSubmit = options.onSubmit;

        const schema = buildProseMirrorSchema();
        const initialDoc = markdownToWysiwygDoc(options.markdown || '', {
            markdownItOptions: { temporalPrefix: this.temporalPrefix },
            serializerOptions: { temporalPrefix: this.temporalPrefix }
        });
        const pmDoc = wysiwygDocToProseMirror(schema, initialDoc);

        const plugins = [
            history(),
            inputRules({ rules: smartQuotes.concat(ellipsis, emDash, buildMarkdownInputRules(schema)) }),
            keymap({
                Tab: (state, dispatch) => {
                    const indent = '  ';
                    const selection = state.selection;
                    if (selection.empty) {
                        if (!dispatch) {
                            return true;
                        }
                        const tr = state.tr.insertText(indent, selection.from, selection.to);
                        tr.setSelection(TextSelection.create(tr.doc, selection.from + indent.length));
                        dispatch(tr);
                        return true;
                    }

                    const positions: number[] = [];
                    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
                        if (node.isTextblock) {
                            const start = pos + 1;
                            if (!positions.includes(start)) {
                                positions.push(start);
                            }
                        }
                    });

                    if (positions.length === 0) {
                        if (!dispatch) {
                            return true;
                        }
                        const tr = state.tr.insertText(indent, selection.from, selection.to);
                        dispatch(tr);
                        return true;
                    }

                    if (!dispatch) {
                        return true;
                    }
                    let tr = state.tr;
                    positions.sort((a, b) => a - b).forEach((pos) => {
                        const mapped = tr.mapping.map(pos);
                        tr = tr.insertText(indent, mapped, mapped);
                    });
                    dispatch(tr);
                    return true;
                },
                'Shift-Tab': (state, dispatch) => {
                    const indent = '  ';
                    const selection = state.selection;
                    if (selection.empty) {
                        const from = selection.from;
                        const start = Math.max(0, from - indent.length);
                        const text = state.doc.textBetween(start, from, '\n', '\n');
                        if (!text) {
                            return false;
                        }
                        const removeLength = text.endsWith('\t') ? 1 : (text.endsWith(indent) ? indent.length : 0);
                        if (!removeLength) {
                            return false;
                        }
                        if (!dispatch) {
                            return true;
                        }
                        const tr = state.tr.delete(from - removeLength, from);
                        dispatch(tr);
                        return true;
                    }

                    const positions: number[] = [];
                    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
                        if (node.isTextblock) {
                            const start = pos + 1;
                            if (!positions.includes(start)) {
                                positions.push(start);
                            }
                        }
                    });
                    if (positions.length === 0) {
                        return false;
                    }
                    if (!dispatch) {
                        return true;
                    }
                    let tr = state.tr;
                    positions.sort((a, b) => a - b).forEach((pos) => {
                        const mapped = tr.mapping.map(pos);
                        const prefix = tr.doc.textBetween(mapped, mapped + indent.length, '\n', '\n');
                        if (prefix.startsWith(indent)) {
                            tr = tr.delete(mapped, mapped + indent.length);
                            return;
                        }
                        if (prefix.startsWith('\t')) {
                            tr = tr.delete(mapped, mapped + 1);
                        }
                    });
                    dispatch(tr);
                    return true;
                },
                'Alt-Enter': () => {
                    if (this.onSubmit) {
                        this.onSubmit();
                        return true;
                    }
                    return false;
                },
                Backspace: (state, dispatch) => {
                    const selection = state.selection;
                    if (!selection.empty) {
                        return false;
                    }
                    const $from = selection.$from;
                    const nodeBefore = $from.nodeBefore;
                    if (!nodeBefore) {
                        return false;
                    }
                    const markdown = inlineNodeToMarkdown(nodeBefore, this.temporalPrefix);
                    if (!markdown) {
                        return false;
                    }
                    const from = $from.pos - nodeBefore.nodeSize;
                    const tr = state.tr.insertText(markdown, from, $from.pos);
                    tr.setSelection(TextSelection.create(tr.doc, from + markdown.length));
                    if (dispatch) {
                        dispatch(tr);
                    }
                    return true;
                },
                'Mod-z': undo,
                'Shift-Mod-z': redo,
                'Mod-y': redo,
                'Mod-b': toggleMark(schema.marks.strong),
                'Mod-i': toggleMark(schema.marks.em),
                'Mod-`': toggleMark(schema.marks.code),
                'Shift-Ctrl-8': wrapInList(schema.nodes.bullet_list),
                'Shift-Ctrl-9': wrapInList(schema.nodes.ordered_list),
                'Shift-Ctrl-0': setBlockType(schema.nodes.paragraph),
                'Shift-Ctrl-1': setBlockType(schema.nodes.heading, { level: 1 }),
                'Shift-Ctrl-2': setBlockType(schema.nodes.heading, { level: 2 }),
                'Shift-Ctrl-3': setBlockType(schema.nodes.heading, { level: 3 })
            }),
            keymap(baseKeymap)
        ];

        this.view = new EditorView(container, {
            state: EditorState.create({
                schema,
                doc: pmDoc,
                plugins
            }),
            handleKeyDown: (view, event) => {
                const styleKey = getStyleKey(event);
                if (!styleKey) {
                    return false;
                }
                const pair = STYLE_PAIRS[styleKey];
                if (!pair) {
                    return false;
                }
                const handled = wrapSelectionWithText(view, pair.start, pair.end);
                if (handled) {
                    event.preventDefault();
                }
                return handled;
            },
            handleDoubleClickOn: (view, pos, node, nodePos) => {
                if (!node) {
                    return false;
                }
                if (node.type.name === 'media_inline') {
                    openMediaEditor(view, node, nodePos);
                    return true;
                }
                if (node.type.name === 'include_inline' || node.type.name === 'include_block') {
                    openPathEditor(view, node, nodePos);
                    return true;
                }
                return false;
            },
            handleClickOn: (view, pos, node, nodePos, event) => {
                const target = event?.target as HTMLElement | null;
                if (!target) {
                    return false;
                }
                const imageMenuButton = target.closest?.('.image-menu-btn') as HTMLElement | null;
                if (imageMenuButton) {
                    event.preventDefault();
                    event.stopPropagation();
                    const container = imageMenuButton.closest('.image-path-overlay-container') as HTMLElement | null;
                    const imagePath = container?.dataset?.imagePath;
                    const menuApi = window as unknown as { toggleImagePathMenu?: (container: HTMLElement, imagePath: string) => void };
                    if (container && imagePath && typeof menuApi.toggleImagePathMenu === 'function') {
                        menuApi.toggleImagePathMenu(container, imagePath);
                        return true;
                    }
                }
                const button = target.closest?.('.wysiwyg-edit-btn') as HTMLElement | null;
                if (!button) {
                    const columnButton = target.closest?.('.wysiwyg-multicolumn-btn') as HTMLElement | null;
                    if (columnButton && node?.type?.name === 'multicolumn') {
                        const action = columnButton.dataset?.action || '';
                        if (action === 'add') {
                            addMulticolumnColumn(view, node, nodePos);
                            return true;
                        }
                        if (action === 'remove') {
                            removeMulticolumnColumn(view, node, nodePos);
                            return true;
                        }
                    }
                    return false;
                }
                event.preventDefault();
                event.stopPropagation();
                const action = button.dataset?.action || '';
                if (action === 'media' && node?.type?.name === 'media_inline') {
                    openMediaEditor(view, node, nodePos);
                    return true;
                }
                if (action === 'include' && (node?.type?.name === 'include_inline' || node?.type?.name === 'include_block')) {
                    openPathEditor(view, node, nodePos);
                    return true;
                }
                if (action === 'diagram' && node?.type?.name === 'diagram_fence') {
                    focusDiagram(view, nodePos);
                    return true;
                }
                return false;
            },
            dispatchTransaction: (transaction) => {
                const newState = this.view.state.apply(transaction);
                this.view.updateState(newState);

                if (transaction.docChanged) {
                    this.lastMarkdown = this.serializeState(newState);
                    if (this.onChange) {
                        this.onChange(this.lastMarkdown);
                    }
                }
            }
        });

        this.lastMarkdown = this.serializeState(this.view.state);
    }

    focus(): void {
        this.view.focus();
    }

    destroy(): void {
        this.view.destroy();
    }

    getMarkdown(): string {
        return this.lastMarkdown;
    }

    setMarkdown(markdown: string): void {
        const schema = this.view.state.schema;
        const doc = markdownToWysiwygDoc(markdown || '', {
            markdownItOptions: { temporalPrefix: this.temporalPrefix },
            serializerOptions: { temporalPrefix: this.temporalPrefix }
        });
        const pmDoc = wysiwygDocToProseMirror(schema, doc);
        const newState = EditorState.create({
            schema,
            doc: pmDoc,
            plugins: this.view.state.plugins
        });
        this.view.updateState(newState);
        this.lastMarkdown = this.serializeState(this.view.state);
    }

    getViewDom(): HTMLElement {
        return this.view.dom;
    }

    private serializeState(state: EditorState): string {
        const doc = proseMirrorToWysiwygDoc(state.doc);
        return wysiwygDocToMarkdown(doc, {
            serializerOptions: { temporalPrefix: this.temporalPrefix }
        });
    }
}

(function exposeWysiwygEditor() {
    const globalWindow = window as unknown as { WysiwygEditor?: typeof WysiwygEditor };
    globalWindow.WysiwygEditor = WysiwygEditor;
})();
