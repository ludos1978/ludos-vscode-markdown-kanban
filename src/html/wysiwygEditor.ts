import { EditorState, TextSelection, Selection, Transaction } from 'prosemirror-state';
import type { MarkType, Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands';
import { inputRules, smartQuotes, ellipsis, emDash } from 'prosemirror-inputrules';
import { wrapInList } from 'prosemirror-schema-list';

import { buildProseMirrorSchema } from '../wysiwyg/prosemirrorSchema';
import { proseMirrorToWysiwygDoc, wysiwygDocToProseMirror } from '../wysiwyg/prosemirrorAdapter';
import { markdownToWysiwygDoc, wysiwygDocToMarkdown } from '../wysiwyg/pipeline';

import { createMediaInlineView, createMediaBlockView, createDiagramFenceView, syncWysiwygImages } from '../wysiwyg/nodeViews';
import { normalizeEditableDoc, normalizeMediaBlocks, normalizeBlockBoundaries, normalizeTaskCheckboxes } from '../wysiwyg/normalizer';
import { buildMarkdownInputRules, createMulticolumnTransaction } from '../wysiwyg/inputRules';
import {
    convertMediaBlockToInline,
    toggleTaskCheckbox,
    insertTextNextToSelectedMediaBlock,
    openPathEditor,
    openMediaEditor,
    toggleDiagramEditing,
    addMulticolumnColumn,
    removeMulticolumnColumn,
    wrapSelectionWithText,
    inlineNodeToMarkdown,
    getWysiwygViewFromDom,
    attachViewToDom
} from '../wysiwyg/commands';

export type WysiwygEditorOptions = {
    markdown: string;
    temporalPrefix?: string;
    onChange?: (markdown: string) => void;
    onSubmit?: () => void;
    onSelectionChange?: (state: WysiwygSelectionState) => void;
};

export type WysiwygSelectionState = {
    marks: string[];
    block: string | null;
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

function isMarkActive(state: EditorState, type: MarkType): boolean {
    const { from, to, empty, $from } = state.selection;
    if (empty) {
        const marks = state.storedMarks || $from.marks();
        return Boolean(type?.isInSet(marks));
    }
    return Boolean(type && state.doc.rangeHasMark(from, to, type));
}

function buildSelectionState(state: EditorState): WysiwygSelectionState {
    const marks: string[] = [];
    const schemaMarks = state.schema?.marks || {};
    Object.entries(schemaMarks).forEach(([name, type]) => {
        if (isMarkActive(state, type)) {
            marks.push(name);
        }
    });
    const block = state.selection.$from.parent?.type?.name || null;
    return { marks, block };
}

function isLikelyPathSelection(value: string): boolean {
    const text = (value || '').trim();
    if (!text) {
        return false;
    }
    if (/[\\/]/.test(text)) {
        return true;
    }
    if (/\s/.test(text)) {
        return false;
    }
    return /\.[A-Za-z0-9]{1,5}$/.test(text);
}

function toggleMarkOnce(markType: MarkType) {
    return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
        let nextTr: Transaction | null = null;
        const handled = toggleMark(markType)(state, (tr) => {
            nextTr = tr;
        });
        if (!handled || !nextTr) {
            return handled;
        }
        if (!state.selection.empty) {
            (nextTr as Transaction).setStoredMarks([]);
        }
        if (dispatch) {
            dispatch(nextTr);
        }
        return true;
    };
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

export class WysiwygEditor {
    private view: EditorView;
    private lastMarkdown: string;
    private temporalPrefix: string;
    private onChange?: (markdown: string) => void;
    private onSubmit?: () => void;
    private onSelectionChange?: (state: WysiwygSelectionState) => void;
    private overlayClickHandler?: (event: MouseEvent) => void;
    private container: HTMLElement;

    constructor(container: HTMLElement, options: WysiwygEditorOptions) {
        this.container = container;
        this.temporalPrefix = options.temporalPrefix || '!';
        this.onChange = options.onChange;
        this.onSubmit = options.onSubmit;
        this.onSelectionChange = options.onSelectionChange;

        const schema = buildProseMirrorSchema();
        const initialDoc = markdownToWysiwygDoc(options.markdown || '', {
            markdownItOptions: { temporalPrefix: this.temporalPrefix },
            serializerOptions: { temporalPrefix: this.temporalPrefix }
        });
        let pmDoc = normalizeEditableDoc(schema, wysiwygDocToProseMirror(schema, initialDoc));

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
                'Mod-b': toggleMarkOnce(schema.marks.strong),
                'Mod-i': toggleMarkOnce(schema.marks.em),
                'Mod-`': toggleMarkOnce(schema.marks.code),
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
            nodeViews: {
                media_inline: (node, view, getPos) => createMediaInlineView(node, view, getPos as () => number | undefined),
                media_block: (node, view, getPos) => createMediaBlockView(node, view, getPos as () => number | undefined),
                diagram_fence: (node) => createDiagramFenceView(node)
            },
            handleKeyDown: (view, event) => {
                if (event.key === ' ' && insertTextNextToSelectedMediaBlock(view, ' ')) {
                    event.preventDefault();
                    return true;
                }
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
            handleTextInput: (view, _from, _to, text) => {
                return insertTextNextToSelectedMediaBlock(view, text);
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
            handleClick: () => {
                return false;
            },
            handleClickOn: (view, pos, node, nodePos, event) => {
                if (event?.altKey) {
                    console.log('[WYSIWYG-DEBUG] click', {
                        nodeType: node?.type?.name,
                        nodePos,
                        clickX: event?.clientX,
                        target: (event?.target as HTMLElement | null)?.className || ''
                    });
                }
                const target = event?.target as HTMLElement | null;
                if (!target) {
                    return false;
                }
                if (node?.type?.name === 'task_checkbox') {
                    event.preventDefault();
                    event.stopPropagation();
                    return toggleTaskCheckbox(view, nodePos, node);
                }
                const menuApi = window as unknown as { togglePathMenu?: (container: HTMLElement, filePath: string, mediaType: string) => void };
                const imageMenuButton = target.closest?.('.image-menu-btn') as HTMLElement | null;
                if (imageMenuButton) {
                    const container = imageMenuButton.closest('.image-path-overlay-container') as HTMLElement | null;
                    const imagePath = container?.dataset?.filePath ||
                        container?.querySelector('img')?.getAttribute('data-original-src') ||
                        container?.querySelector('img')?.getAttribute('data-file-path') ||
                        container?.querySelector('img')?.getAttribute('src');
                    if (container && imagePath && typeof menuApi.togglePathMenu === 'function') {
                        event.preventDefault();
                        event.stopPropagation();
                        menuApi.togglePathMenu(container, imagePath, 'image');
                        return true;
                    }
                }
                const videoMenuButton = target.closest?.('.video-menu-btn') as HTMLElement | null;
                if (videoMenuButton) {
                    const container = videoMenuButton.closest('.video-path-overlay-container') as HTMLElement | null;
                    const videoPath = container?.dataset?.filePath ||
                        container?.querySelector('video')?.getAttribute('data-original-src') ||
                        container?.querySelector('audio')?.getAttribute('data-original-src') ||
                        container?.querySelector('video')?.getAttribute('src') ||
                        container?.querySelector('audio')?.getAttribute('src');
                    if (container && videoPath && typeof menuApi.togglePathMenu === 'function') {
                        event.preventDefault();
                        event.stopPropagation();
                        menuApi.togglePathMenu(container, videoPath, 'video');
                        return true;
                    }
                }
                if (node?.type?.name === 'media_block') {
                    const host = target.closest?.('.wysiwyg-media') as HTMLElement | null;
                    const rect = (host || target).getBoundingClientRect();
                    const clickX = event?.clientX ?? rect.left;
                    const placeAfter = clickX >= rect.left + rect.width / 2;
                    if (event?.altKey) {
                        console.log('[WYSIWYG-DEBUG] media block click', { placeAfter, rect });
                    }
                    return convertMediaBlockToInline(view, nodePos, placeAfter);
                }
                if (node?.type?.name === 'media_inline') {
                    const host = target.closest?.('.wysiwyg-media') as HTMLElement | null;
                    const rect = (host || target).getBoundingClientRect();
                    const clickX = event?.clientX ?? rect.left;
                    const placeAfter = clickX >= rect.left + rect.width / 2;
                    const targetPos = placeAfter ? nodePos + node.nodeSize : nodePos;
                    const $pos = view.state.doc.resolve(targetPos);
                    const selection = Selection.near($pos, placeAfter ? 1 : -1);
                    view.dispatch(view.state.tr.setSelection(selection));
                    view.focus();
                    return true;
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
                    const block = target.closest?.('.wysiwyg-diagram-block') as HTMLElement | null;
                    if (!block) {
                        return false;
                    }
                    return toggleDiagramEditing(view, block, nodePos, node);
                }
                return false;
            },
            dispatchTransaction: (transaction) => {
                let newState = this.view.state.apply(transaction);
                let normalized = null;
                let boundaryNormalized = null;
                let checkboxNormalized = null;
                if (transaction.docChanged) {
                    normalized = normalizeMediaBlocks(newState);
                    if (normalized) {
                        newState = newState.apply(normalized);
                    }
                    boundaryNormalized = normalizeBlockBoundaries(newState);
                    if (boundaryNormalized) {
                        newState = newState.apply(boundaryNormalized);
                    }
                    checkboxNormalized = normalizeTaskCheckboxes(newState);
                    if (checkboxNormalized) {
                        newState = newState.apply(checkboxNormalized);
                    }
                }
                const docChanged = transaction.docChanged || Boolean(normalized) || Boolean(boundaryNormalized) || Boolean(checkboxNormalized);
                this.view.updateState(newState);
                const selectionChanged = transaction.selectionSet || transaction.storedMarksSet || transaction.docChanged;

                if (docChanged) {
                    this.lastMarkdown = this.serializeState(newState);
                    if (this.onChange) {
                        this.onChange(this.lastMarkdown);
                    }
                    syncWysiwygImages(this.view.dom);
                }
                if (selectionChanged) {
                    this.emitSelectionChange(newState);
                }
            }
        });

        attachViewToDom(this.view.dom, this.view);

        this.lastMarkdown = this.serializeState(this.view.state);
        syncWysiwygImages(this.view.dom);
        this.emitSelectionChange(this.view.state);

        if (this.container.classList.contains('task-overlay-wysiwyg')) {
            this.overlayClickHandler = (event: MouseEvent) => {
                if (event.button !== 0) {
                    return;
                }
                const target = event.target as HTMLElement | null;
                if (!target || target !== this.container) {
                    return;
                }
                const editorRect = this.view.dom.getBoundingClientRect();
                if (event.clientY <= editorRect.bottom + 1) {
                    return;
                }
                event.preventDefault();
                const selection = Selection.atEnd(this.view.state.doc);
                this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView());
                this.view.focus();
            };
            this.container.addEventListener('mousedown', this.overlayClickHandler);
        }
    }

    focus(): void {
        this.view.focus();
    }

    destroy(): void {
        if (this.overlayClickHandler) {
            this.container.removeEventListener('mousedown', this.overlayClickHandler);
            this.overlayClickHandler = undefined;
        }
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
        const pmDoc = normalizeEditableDoc(schema, wysiwygDocToProseMirror(schema, doc));
        const newState = EditorState.create({
            schema,
            doc: pmDoc,
            plugins: this.view.state.plugins
        });
        this.view.updateState(newState);
        this.lastMarkdown = this.serializeState(this.view.state);
        syncWysiwygImages(this.view.dom);
        this.emitSelectionChange(this.view.state);
    }

    getViewDom(): HTMLElement {
        return this.view.dom;
    }

    insertText(text: string): void {
        const value = text ?? '';
        const state = this.view.state;
        const { from, to } = state.selection;
        let tr = state.tr.insertText(value, from, to);
        const nextPos = Math.min(tr.doc.content.size, from + value.length);
        tr = tr.setSelection(TextSelection.create(tr.doc, nextPos));
        this.view.dispatch(tr);
        this.view.focus();
    }

    applyCommand(command: string): boolean {
        const state = this.view.state;
        const dispatch = this.view.dispatch.bind(this.view);
        const schema = state.schema;

        switch (command) {
            case 'bold':
                return schema.marks.strong ? toggleMarkOnce(schema.marks.strong)(state, dispatch) : false;
            case 'italic':
                return schema.marks.em ? toggleMarkOnce(schema.marks.em)(state, dispatch) : false;
            case 'underline':
                return schema.marks.underline ? toggleMarkOnce(schema.marks.underline)(state, dispatch) : false;
            case 'strike':
                return schema.marks.strike ? toggleMarkOnce(schema.marks.strike)(state, dispatch) : false;
            case 'mark':
                return schema.marks.mark ? toggleMarkOnce(schema.marks.mark)(state, dispatch) : false;
            case 'sub':
                return schema.marks.sub ? toggleMarkOnce(schema.marks.sub)(state, dispatch) : false;
            case 'sup':
                return schema.marks.sup ? toggleMarkOnce(schema.marks.sup)(state, dispatch) : false;
            case 'code':
                return schema.marks.code ? toggleMarkOnce(schema.marks.code)(state, dispatch) : false;
            case 'ins':
                return schema.marks.ins ? toggleMarkOnce(schema.marks.ins)(state, dispatch) : false;
            case 'link': {
                const { from, to, empty } = state.selection;
                const selectedText = empty
                    ? ''
                    : state.doc.textBetween(from, to, '\n', '\n');
                const isPath = selectedText ? isLikelyPathSelection(selectedText) : false;
                const textPart = isPath ? 'text' : (selectedText || 'text');
                const urlPart = isPath ? (selectedText || 'url') : 'url';
                const linkText = `[${textPart}](${urlPart})`;
                const tr = state.tr.insertText(linkText, from, to);
                let selectionStart = from + 1;
                let selectionEnd = selectionStart + textPart.length;
                if (isPath || empty) {
                    selectionStart = from + 1 + textPart.length + 2;
                    selectionEnd = selectionStart + urlPart.length;
                }
                dispatch(tr.setSelection(TextSelection.create(tr.doc, selectionStart, selectionEnd)));
                this.view.focus();
                return true;
            }
            case 'code-block':
                return schema.nodes.code_block ? setBlockType(schema.nodes.code_block)(state, dispatch) : false;
            case 'multicolumn': {
                const tr = createMulticolumnTransaction(state, schema, 1, state.selection.from, state.selection.to);
                if (!tr) {
                    return false;
                }
                dispatch(tr);
                return true;
            }
            default:
                return false;
        }
    }

    private emitSelectionChange(state: EditorState): void {
        if (!this.onSelectionChange) {
            return;
        }
        this.onSelectionChange(buildSelectionState(state));
    }

    private serializeState(state: EditorState): string {
        const doc = proseMirrorToWysiwygDoc(state.doc);
        return wysiwygDocToMarkdown(doc, {
            serializerOptions: { temporalPrefix: this.temporalPrefix }
        });
    }
}

(function exposeWysiwygEditor() {
    const globalWindow = window as unknown as {
        WysiwygEditor?: typeof WysiwygEditor;
        toggleWysiwygDiagramEdit?: (container: HTMLElement) => boolean;
    };
    globalWindow.WysiwygEditor = WysiwygEditor;
    globalWindow.toggleWysiwygDiagramEdit = (container: HTMLElement) => {
        const block = container.closest('.wysiwyg-diagram-block') as HTMLElement | null;
        if (!block) {
            return false;
        }
        const view = getWysiwygViewFromDom(block);
        if (!view) {
            return false;
        }
        return toggleDiagramEditing(view, block);
    };
})();
