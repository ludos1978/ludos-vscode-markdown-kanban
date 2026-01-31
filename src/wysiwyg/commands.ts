import { EditorView } from 'prosemirror-view';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

export function convertMediaBlockToInline(view: EditorView, nodePos: number, placeAfter: boolean, insertText?: string): boolean {
    const { state } = view;
    const mediaBlock = state.schema.nodes.media_block;
    const mediaInline = state.schema.nodes.media_inline;
    const paragraph = state.schema.nodes.paragraph;
    if (!mediaBlock || !mediaInline || !paragraph) {
        return false;
    }
    const node = state.doc.nodeAt(nodePos);
    if (!node || node.type !== mediaBlock) {
        return false;
    }

    const inlineNode = mediaInline.create({ ...node.attrs });
    const para = paragraph.create(null, [inlineNode]);
    let tr = state.tr.replaceWith(nodePos, nodePos + node.nodeSize, para);
    let selectionPos = nodePos + 1 + (placeAfter ? inlineNode.nodeSize : 0);
    if (insertText) {
        tr = tr.insertText(insertText, selectionPos, selectionPos);
        selectionPos += insertText.length;
    }
    tr = tr.setSelection(TextSelection.create(tr.doc, selectionPos));
    view.dispatch(tr);
    view.focus();
    return true;
}

export function toggleTaskCheckbox(view: EditorView, nodePos: number, node: ProseMirrorNode): boolean {
    if (!node || node.type.name !== 'task_checkbox') {
        return false;
    }
    const checked = Boolean(node.attrs.checked);
    const nextAttrs = { ...node.attrs, checked: !checked };
    const tr = view.state.tr.setNodeMarkup(nodePos, undefined, nextAttrs);
    view.dispatch(tr);
    return true;
}

export function insertTextNextToSelectedMediaBlock(view: EditorView, text: string): boolean {
    const { state } = view;
    const selection = state.selection;
    if (!(selection instanceof NodeSelection)) {
        return false;
    }
    const mediaBlock = state.schema.nodes.media_block;
    if (!mediaBlock || selection.node.type !== mediaBlock) {
        return false;
    }
    return convertMediaBlockToInline(view, selection.from, true, text);
}

function updateNodeAttrs(view: EditorView, pos: number, attrs: Record<string, unknown>): void {
    const tr = view.state.tr.setNodeMarkup(pos, undefined, attrs);
    view.dispatch(tr);
}

function getModalApi(): { showInputModal?: (...args: unknown[]) => void } {
    return window as unknown as { showInputModal?: (...args: unknown[]) => void };
}

function openAttrEditor(
    view: EditorView,
    node: { attrs?: Record<string, unknown> },
    pos: number,
    attrName: string,
    modalTitle: string,
    modalDescription: string,
    label: string
): void {
    const currentValue = typeof node.attrs?.[attrName] === 'string' ? node.attrs[attrName] as string : '';
    const modalApi = getModalApi();
    if (typeof modalApi.showInputModal === 'function') {
        modalApi.showInputModal(
            modalTitle,
            modalDescription,
            label,
            (value: string) => {
                updateNodeAttrs(view, pos, { ...node.attrs, [attrName]: value });
            },
            null,
            { defaultValue: currentValue }
        );
        return;
    }
    const nextValue = window.prompt(label, currentValue);
    if (nextValue !== null) {
        updateNodeAttrs(view, pos, { ...node.attrs, [attrName]: nextValue });
    }
}

export function openPathEditor(view: EditorView, node: { attrs?: Record<string, unknown> }, pos: number): void {
    openAttrEditor(view, node, pos, 'path', 'Edit include path', 'Update include path', 'Path');
}

export function openMediaEditor(view: EditorView, node: { attrs?: Record<string, unknown> }, pos: number): void {
    openAttrEditor(view, node, pos, 'src', 'Edit media source', 'Update media source URL/path', 'Source');
}

function focusDiagram(view: EditorView, nodePos: number): void {
    const start = Math.min(nodePos + 1, view.state.doc.content.size);
    const selection = TextSelection.create(view.state.doc, start);
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
}

type WysiwygDomWithView = HTMLElement & { __wysiwygView?: EditorView };

export function getWysiwygViewFromDom(target: HTMLElement | null): EditorView | null {
    if (!target) {
        return null;
    }
    const root = target.closest('.ProseMirror') as WysiwygDomWithView | null;
    return root?.__wysiwygView ?? null;
}

export function attachViewToDom(dom: HTMLElement, view: EditorView): void {
    (dom as WysiwygDomWithView).__wysiwygView = view;
}

function findDiagramNodeFromDom(view: EditorView, block: HTMLElement): { nodePos: number; node: ProseMirrorNode } | null {
    let pos: number;
    try {
        pos = view.posAtDOM(block, 0);
    } catch {
        return null;
    }
    const $pos = view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth);
        if (node.type.name === 'diagram_fence') {
            return { nodePos: $pos.before(depth), node };
        }
    }
    const node = view.state.doc.nodeAt(pos);
    if (node?.type?.name === 'diagram_fence') {
        return { nodePos: pos, node };
    }
    return null;
}

export function toggleDiagramEditing(view: EditorView, block: HTMLElement, nodePos?: number, node?: ProseMirrorNode): boolean {
    const resolved = nodePos !== undefined && node
        ? { nodePos, node }
        : findDiagramNodeFromDom(view, block);
    if (!resolved) {
        return false;
    }
    const isEditing = block.classList.toggle('is-editing');
    if (!isEditing) {
        const after = resolved.nodePos + resolved.node.nodeSize;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after)));
        view.focus();
        return true;
    }
    focusDiagram(view, resolved.nodePos);
    return true;
}

export function addMulticolumnColumn(view: EditorView, node: ProseMirrorNode, nodePos: number): void {
    if (!node || node.type.name !== 'multicolumn') {
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

export function removeMulticolumnColumn(view: EditorView, node: ProseMirrorNode, nodePos: number): void {
    if (!node || node.type.name !== 'multicolumn') {
        return;
    }
    if (node.childCount <= 1) {
        return;
    }
    let lastOffset: number | null = null;
    let lastSize = 0;
    node.forEach((child: ProseMirrorNode, offset: number) => {
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

export function wrapSelectionWithText(view: EditorView, start: string, end: string): boolean {
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

export function inlineNodeToMarkdown(node: ProseMirrorNode, temporalPrefix: string): string | null {
    if (!node) {
        return null;
    }
    switch (node.type.name) {
        case 'media_inline': {
            const src = node.attrs.src || '';
            if (!src) {
                return null;
            }
            const alt = node.attrs.alt || '';
            const title = node.attrs.title ? ` "${node.attrs.title}"` : '';
            return `![${alt}](${src}${title})`;
        }
        case 'include_inline': {
            const path = node.attrs.path || '';
            return path ? `!!!include(${path})!!!` : null;
        }
        case 'wiki_link': {
            const document = node.attrs.document || '';
            const title = node.attrs.title || '';
            if (!document) {
                return null;
            }
            return title && title !== document ? `[[${document}|${title}]]` : `[[${document}]]`;
        }
        case 'tag': {
            const value = node.attrs.value || '';
            return value ? `#${value}` : null;
        }
        case 'date_tag':
        case 'person_tag': {
            const value = node.attrs.value || '';
            return value ? `@${value}` : null;
        }
        case 'temporal_tag': {
            const value = node.attrs.value || '';
            return value ? `${temporalPrefix}${value}` : null;
        }
        case 'footnote': {
            const id = node.attrs.id || '';
            return id ? `[^${id}]` : null;
        }
        default:
            return null;
    }
}
