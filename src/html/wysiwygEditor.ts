import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands';
import { inputRules, smartQuotes, ellipsis, emDash } from 'prosemirror-inputrules';
import { wrapInList } from 'prosemirror-schema-list';

import { buildProseMirrorSchema } from '../wysiwyg/prosemirrorSchema';
import { proseMirrorToWysiwygDoc, wysiwygDocToProseMirror } from '../wysiwyg/prosemirrorAdapter';
import { markdownToWysiwygDoc, wysiwygDocToMarkdown } from '../wysiwyg/pipeline';

export type WysiwygEditorOptions = {
    markdown: string;
    temporalPrefix?: string;
    onChange?: (markdown: string) => void;
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

export class WysiwygEditor {
    private view: EditorView;
    private lastMarkdown: string;
    private temporalPrefix: string;
    private onChange?: (markdown: string) => void;

    constructor(container: HTMLElement, options: WysiwygEditorOptions) {
        this.temporalPrefix = options.temporalPrefix || '!';
        this.onChange = options.onChange;

        const schema = buildProseMirrorSchema();
        const initialDoc = markdownToWysiwygDoc(options.markdown || '', {
            markdownItOptions: { temporalPrefix: this.temporalPrefix },
            serializerOptions: { temporalPrefix: this.temporalPrefix }
        });
        const pmDoc = wysiwygDocToProseMirror(schema, initialDoc);

        const plugins = [
            history(),
            inputRules({ rules: smartQuotes.concat(ellipsis, emDash) }),
            keymap({
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
                const button = target.closest?.('.wysiwyg-edit-btn') as HTMLElement | null;
                if (!button) {
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
