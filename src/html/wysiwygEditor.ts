import { EditorState } from 'prosemirror-state';
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
