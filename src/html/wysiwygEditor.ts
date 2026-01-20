import { EditorState, NodeSelection, TextSelection, Selection, Transaction } from 'prosemirror-state';
import type { MarkType, Node as ProseMirrorNode, Schema } from 'prosemirror-model';
import { EditorView, NodeView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands';
import { inputRules, smartQuotes, ellipsis, emDash, InputRule, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules';
import { wrapInList } from 'prosemirror-schema-list';

import { buildProseMirrorSchema } from '../wysiwyg/prosemirrorSchema';
import { proseMirrorToWysiwygDoc, wysiwygDocToProseMirror } from '../wysiwyg/prosemirrorAdapter';
import { markdownToWysiwygDoc, wysiwygDocToMarkdown } from '../wysiwyg/pipeline';
import { inferMediaTypeFromSrc, getTagFlavor, isDateLike } from '../wysiwyg/utils';

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

const DIAGRAM_PREVIEW_DEBOUNCE_MS = 200;
const diagramPreviewTimers = new WeakMap<HTMLElement, number>();

type MediaPathHelpers = {
    buildWebviewResourceUrl?: (pathValue: string, encodeSegments?: boolean) => string;
    isRelativeResourcePath?: (value: string) => boolean;
    isWindowsAbsolutePath?: (value: string) => boolean;
    normalizeWindowsAbsolutePath?: (value: string, shouldDecode?: boolean) => string;
    safeDecodePath?: (value: string) => string;
    resolveRelativePath?: (baseDir: string, relativePath: string) => string;
    currentFilePath?: string;
    currentTaskIncludeContext?: { includeDir?: string };
    handleMediaNotFound?: (element: HTMLElement, originalSrc: string, mediaType: 'image' | 'video') => void;
    queueDiagramRender?: (id: string, filePath: string, diagramType: string, includeDir?: string) => void;
    queuePDFPageRender?: (id: string, filePath: string, pageNumber: number, includeDir?: string) => void;
    queuePDFSlideshow?: (id: string, filePath: string, includeDir?: string) => void;
    queueMermaidRender?: (id: string, code: string) => void;
    queuePlantUMLRender?: (id: string, code: string) => void;
    processDiagramQueue?: () => void;
};

function resolveDisplaySrc(originalSrc: string): string {
    if (!originalSrc) {
        return '';
    }
    if (
        originalSrc.startsWith('data:') ||
        originalSrc.startsWith('blob:') ||
        originalSrc.startsWith('http://') ||
        originalSrc.startsWith('https://') ||
        originalSrc.startsWith('vscode-webview://')
    ) {
        return originalSrc;
    }

    const api = window as unknown as MediaPathHelpers;
    const safeDecode = typeof api.safeDecodePath === 'function' ? api.safeDecodePath : (value: string) => value;
    const resolveRelative = typeof api.resolveRelativePath === 'function'
        ? api.resolveRelativePath
        : (baseDir: string, relativePath: string) => `${baseDir.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`;
    const isWindowsAbsolute = typeof api.isWindowsAbsolutePath === 'function'
        ? api.isWindowsAbsolutePath
        : (value: string) => /^[A-Za-z]:[\\/]/.test(value);
    const isRelative = typeof api.isRelativeResourcePath === 'function'
        ? api.isRelativeResourcePath
        : (value: string) => !value.startsWith('/') && !isWindowsAbsolute(value) && !/^https?:\/\//.test(value) && !value.startsWith('vscode-webview://');
    const buildUrl = typeof api.buildWebviewResourceUrl === 'function' ? api.buildWebviewResourceUrl : null;
    const normalizeWindows = typeof api.normalizeWindowsAbsolutePath === 'function'
        ? api.normalizeWindowsAbsolutePath
        : (value: string) => value.replace(/\\/g, '/');

    if (!buildUrl) {
        return originalSrc;
    }

    const includeDir = api.currentTaskIncludeContext?.includeDir;
    if (includeDir && isRelative(originalSrc)) {
        const resolvedPath = resolveRelative(safeDecode(includeDir), safeDecode(originalSrc));
        return buildUrl(resolvedPath, true);
    }

    if (isRelative(originalSrc) && api.currentFilePath) {
        const docPath = api.currentFilePath.replace(/\\/g, '/');
        const lastSlash = docPath.lastIndexOf('/');
        const docDir = lastSlash > 0 ? docPath.substring(0, lastSlash) : '';
        const resolvedPath = resolveRelative(docDir, safeDecode(originalSrc));
        return buildUrl(resolvedPath, true);
    }

    if (isWindowsAbsolute(originalSrc)) {
        const normalized = normalizeWindows(originalSrc, true);
        return buildUrl(normalized, true);
    }

    if (originalSrc.startsWith('/')) {
        return buildUrl(safeDecode(originalSrc), true);
    }

    return originalSrc;
}

function makePreviewId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDiagramFileInfo(src: string): { mode: 'diagram' | 'pdf-page' | 'pdf-slideshow'; filePath: string; diagramType?: string; pageNumber?: number } | null {
    if (!src) {
        return null;
    }
    const pdfPageMatch = src.match(/^(.+\.pdf)#(\d+)$/i);
    if (pdfPageMatch) {
        return { mode: 'pdf-page', filePath: pdfPageMatch[1], pageNumber: Number.parseInt(pdfPageMatch[2], 10) };
    }
    if (/\.pdf$/i.test(src)) {
        return { mode: 'pdf-slideshow', filePath: src };
    }
    if (/\.(drawio|dio)$/i.test(src)) {
        return { mode: 'diagram', filePath: src, diagramType: 'drawio' };
    }
    if (/\.(excalidraw|excalidraw\.json|excalidraw\.svg)$/i.test(src)) {
        return { mode: 'diagram', filePath: src, diagramType: 'excalidraw' };
    }
    return null;
}

function renderDiagramPreview(preview: HTMLElement, lang: string, code: string): void {
    if (!preview) {
        return;
    }
    const api = window as unknown as MediaPathHelpers;
    const normalizedLang = (lang || '').toLowerCase();
    const isMermaid = normalizedLang === 'mermaid';
    const isPlantUml = normalizedLang === 'plantuml' || normalizedLang === 'puml';

    if (!isMermaid && !isPlantUml) {
        const existingTimer = diagramPreviewTimers.get(preview);
        if (existingTimer) {
            clearTimeout(existingTimer);
            diagramPreviewTimers.delete(preview);
        }
        preview.innerHTML = '';
        preview.style.display = 'none';
        return;
    }

    preview.style.display = '';
    preview.innerHTML = '';
    const placeholder = document.createElement('div');
    const previewId = makePreviewId('wysiwyg-diagram');
    placeholder.id = previewId;
    placeholder.className = isMermaid ? 'mermaid-placeholder' : 'plantuml-placeholder';
    placeholder.textContent = isMermaid ? 'Rendering Mermaid diagram...' : 'Rendering PlantUML diagram...';
    preview.appendChild(placeholder);

    const existingTimer = diagramPreviewTimers.get(preview);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
        if (isMermaid && typeof api.queueMermaidRender === 'function') {
            api.queueMermaidRender(previewId, code);
            return;
        }
        if (isPlantUml && typeof api.queuePlantUMLRender === 'function') {
            api.queuePlantUMLRender(previewId, code);
        }
    }, DIAGRAM_PREVIEW_DEBOUNCE_MS);
    diagramPreviewTimers.set(preview, timer);
}

function syncWysiwygDiagramFile(dom: HTMLElement, originalSrc: string): void {
    const api = window as unknown as MediaPathHelpers;
    const diagramInfo = getDiagramFileInfo(originalSrc);
    if (!diagramInfo) {
        return;
    }

    dom.dataset.wysiwygDiagram = 'true';
    dom.classList.add('wysiwyg-diagram-file');
    const placeholderId = makePreviewId('wysiwyg-media');
    const placeholder = document.createElement('span');
    placeholder.id = placeholderId;
    placeholder.className = 'diagram-placeholder';
    placeholder.dataset.wysiwygHost = 'true';
    dom.innerHTML = '';
    dom.appendChild(placeholder);
    const menuBtn = document.createElement('button');
    menuBtn.className = 'image-menu-btn';
    menuBtn.type = 'button';
    menuBtn.title = 'Path options';
    menuBtn.textContent = '☰';
    menuBtn.setAttribute('data-action', 'image-menu');
    menuBtn.contentEditable = 'false';
    dom.appendChild(menuBtn);

    const includeDir = api.currentTaskIncludeContext?.includeDir;
    const scheduleProcess = () => {
        if (typeof api.processDiagramQueue !== 'function') {
            return;
        }
        requestAnimationFrame(() => {
            api.processDiagramQueue?.();
            setTimeout(() => api.processDiagramQueue?.(), 50);
        });
    };

    if (diagramInfo.mode === 'diagram' && diagramInfo.diagramType && typeof api.queueDiagramRender === 'function') {
        api.queueDiagramRender(placeholderId, diagramInfo.filePath, diagramInfo.diagramType, includeDir);
        scheduleProcess();
        return;
    }
    if (diagramInfo.mode === 'pdf-page' && typeof api.queuePDFPageRender === 'function') {
        api.queuePDFPageRender(placeholderId, diagramInfo.filePath, diagramInfo.pageNumber || 1, includeDir);
        scheduleProcess();
        return;
    }
    if (diagramInfo.mode === 'pdf-slideshow' && typeof api.queuePDFSlideshow === 'function') {
        api.queuePDFSlideshow(placeholderId, diagramInfo.filePath, includeDir);
        scheduleProcess();
    }
}

function createMediaView(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    isBlock: boolean
): NodeView {
    const dom = document.createElement(isBlock ? 'div' : 'span');

    // Handle clicks on the container to set proper selection
    dom.addEventListener('mousedown', (evt) => {
        const e = evt as MouseEvent;
        const pos = getPos();
        if (pos === undefined) {
            return;
        }

        // Don't interfere with menu button clicks
        const target = e.target as HTMLElement;
        if (target.closest('.image-menu-btn') || target.closest('.video-menu-btn')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const nodeSize = node.nodeSize;
        const rect = dom.getBoundingClientRect();
        const clickX = e.clientX;
        const placeAfter = clickX >= rect.left + rect.width / 2;
        if (isBlock) {
            const converted = convertMediaBlockToInline(view, pos, placeAfter);
            if (converted) {
                return;
            }
        }

        const targetPos = placeAfter ? pos + nodeSize : pos;
        const $pos = view.state.doc.resolve(targetPos);
        const selection = Selection.near($pos, placeAfter ? 1 : -1);

        view.dispatch(view.state.tr.setSelection(selection));
        view.focus();
    });

    const render = (currentNode: ProseMirrorNode) => {
        const mediaType = currentNode.attrs?.mediaType || 'image';
        const src = currentNode.attrs?.src || '';
        const alt = currentNode.attrs?.alt || '';
        const title = currentNode.attrs?.title || '';
        const blockClass = isBlock ? ' wysiwyg-media-block' : '';

        dom.innerHTML = '';
        dom.className = mediaType === 'image'
            ? `image-path-overlay-container wysiwyg-media${blockClass}`
            : (mediaType === 'video' || mediaType === 'audio')
                ? `video-path-overlay-container wysiwyg-media${blockClass}`
                : `wysiwyg-media${blockClass}`;
        dom.dataset.type = mediaType;

        if (mediaType === 'image') {
            dom.dataset.filePath = src;
            dom.dataset.src = src;

            const diagramInfo = getDiagramFileInfo(src);
            if (diagramInfo) {
                syncWysiwygDiagramFile(dom, src);
                return;
            }

            const img = document.createElement('img');
            img.className = 'markdown-image';
            img.alt = alt;
            img.title = title;
            img.dataset.originalSrc = src;
            img.setAttribute('data-original-src', src);
            img.src = resolveDisplaySrc(src);
            img.contentEditable = 'false';

            // Handle broken images - show menu button always
            img.addEventListener('error', () => {
                if (dom && dom.classList) {
                    dom.classList.add('image-broken');
                }
            });
            img.addEventListener('load', () => {
                if (dom && dom.classList) {
                    dom.classList.remove('image-broken');
                }
            });

            const menuBtn = document.createElement('button');
            menuBtn.className = 'image-menu-btn';
            menuBtn.type = 'button';
            menuBtn.title = 'Path options';
            menuBtn.textContent = '☰';
            menuBtn.setAttribute('data-action', 'image-menu');
            menuBtn.contentEditable = 'false';

            dom.appendChild(img);
            dom.appendChild(menuBtn);
            return;
        }

        if (mediaType === 'video' || mediaType === 'audio') {
            dom.dataset.src = src;
            dom.dataset.filePath = src;

            const mediaEl = document.createElement(mediaType === 'audio' ? 'audio' : 'video');
            mediaEl.controls = true;
            mediaEl.src = resolveDisplaySrc(src);
            mediaEl.dataset.originalSrc = src;
            mediaEl.setAttribute('data-original-src', src);
            mediaEl.contentEditable = 'false';

            if ((mediaType === 'video' || mediaType === 'audio') && src && !src.startsWith('data:') && !src.startsWith('blob:')) {
                const api = window as unknown as MediaPathHelpers;
                mediaEl.addEventListener('error', () => {
                    if (typeof api.handleMediaNotFound === 'function') {
                        api.handleMediaNotFound(mediaEl, src, 'video');
                    }
                });
            }

            const menuBtn = document.createElement('button');
            menuBtn.className = 'video-menu-btn';
            menuBtn.type = 'button';
            menuBtn.title = 'Path options';
            menuBtn.textContent = '☰';
            menuBtn.setAttribute('data-action', 'video-menu');
            menuBtn.contentEditable = 'false';

            dom.appendChild(mediaEl);
            dom.appendChild(menuBtn);
            return;
        }

        dom.dataset.src = src;
        const button = document.createElement('button');
        button.className = 'wysiwyg-edit-btn';
        button.type = 'button';
        button.setAttribute('data-action', 'media');
        button.textContent = 'Edit';
        button.contentEditable = 'false';
        dom.appendChild(button);
        if (src) {
            dom.appendChild(document.createTextNode(src));
        }
    };

    render(node);

    return {
        dom,
        update: (nextNode) => {
            if (nextNode.type !== node.type) {
                return false;
            }
            const nextSrc = nextNode.attrs?.src || '';
            const nextType = nextNode.attrs?.mediaType || 'image';
            const nextAlt = nextNode.attrs?.alt || '';
            const nextTitle = nextNode.attrs?.title || '';
            const needsUpdate = nextSrc !== node.attrs?.src ||
                nextType !== node.attrs?.mediaType ||
                nextAlt !== node.attrs?.alt ||
                nextTitle !== node.attrs?.title;
            node = nextNode;
            if (needsUpdate) {
                render(nextNode);
            }
            return true;
        }
    };
}

function createMediaInlineView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView {
    return createMediaView(node, view, getPos, false);
}

function createMediaBlockView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView {
    return createMediaView(node, view, getPos, true);
}

function createDiagramFenceView(node: ProseMirrorNode): NodeView {
    const dom = document.createElement('div');
    dom.className = 'wysiwyg-diagram-block';

    const preview = document.createElement('div');
    preview.className = 'wysiwyg-diagram-preview';
    preview.contentEditable = 'false';

    const editBtn = document.createElement('button');
    editBtn.className = 'wysiwyg-edit-btn';
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.setAttribute('data-action', 'diagram');
    editBtn.contentEditable = 'false';

    const pre = document.createElement('pre');
    pre.className = 'wysiwyg-diagram';
    const code = document.createElement('code');
    pre.appendChild(code);

    dom.appendChild(preview);
    dom.appendChild(editBtn);
    dom.appendChild(pre);

    const render = (currentNode: ProseMirrorNode) => {
        const lang = currentNode.attrs?.lang || '';
        dom.dataset.lang = lang;
        pre.dataset.lang = lang;
        renderDiagramPreview(preview, lang, currentNode.textContent || '');
    };

    render(node);

    return {
        dom,
        contentDOM: code,
        ignoreMutation: (mutation) => !code.contains(mutation.target as Node),
        update: (nextNode) => {
            if (nextNode.type !== node.type) {
                return false;
            }
            const langChanged = nextNode.attrs?.lang !== node.attrs?.lang;
            const codeChanged = nextNode.textContent !== node.textContent;
            node = nextNode;
            if (langChanged || codeChanged) {
                render(nextNode);
            }
            return true;
        }
    };
}

function syncWysiwygImages(container: HTMLElement): void {
    if (!container) {
        return;
    }
    const api = window as unknown as MediaPathHelpers;
    const images = container.querySelectorAll<HTMLImageElement>('.image-path-overlay-container img');
    images.forEach((img) => {
        const overlay = img.closest('.image-path-overlay-container') as HTMLElement | null;
        const diagramHost = overlay?.closest?.('[data-wysiwyg-diagram="true"]') as HTMLElement | null;
        if (img.classList.contains('diagram-rendered') || diagramHost) {
            return;
        }
        const originalSrc = overlay?.dataset?.filePath || img.dataset.originalSrc || img.getAttribute('data-original-src') || img.getAttribute('src') || '';
        if (!originalSrc) {
            return;
        }
        const displaySrc = resolveDisplaySrc(originalSrc);
        if (displaySrc && img.getAttribute('src') !== displaySrc) {
            img.setAttribute('src', displaySrc);
        }
        if (!img.dataset.originalSrc) {
            img.dataset.originalSrc = originalSrc;
        }
        if (overlay && !overlay.dataset.filePath) {
            overlay.dataset.filePath = originalSrc;
        }
        if (!(img as unknown as { __wysiwygImageHandler?: boolean }).__wysiwygImageHandler) {
            (img as unknown as { __wysiwygImageHandler?: boolean }).__wysiwygImageHandler = true;
            img.onerror = () => {
                if (typeof api.handleMediaNotFound === 'function') {
                    api.handleMediaNotFound(img, originalSrc, 'image');
                }
            };
        }
    });
}

function normalizeMediaBlocks(state: EditorState) {
    const mediaInline = state.schema.nodes.media_inline;
    const mediaBlock = state.schema.nodes.media_block;
    if (!mediaInline || !mediaBlock) {
        return null;
    }

    const targets: Array<{ pos: number; size: number; nodes: ProseMirrorNode[] }> = [];
    const selectionFrom = state.selection.from;
    const selectionTo = state.selection.to;
    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name !== 'paragraph') {
            return;
        }
        const paragraphStart = pos;
        const paragraphEnd = pos + node.nodeSize;
        const selectionInside = selectionFrom > paragraphStart && selectionTo < paragraphEnd;
        const mediaNodes: ProseMirrorNode[] = [];
        let hasOther = false;
        node.forEach((child) => {
            if (child.type === mediaInline) {
                mediaNodes.push(child);
                return;
            }
            if (child.isText && (child.text || '').trim() === '') {
                return;
            }
            hasOther = true;
        });
        if (hasOther || mediaNodes.length === 0 || selectionInside) {
            return;
        }
        const blockNodes = mediaNodes.map(child => mediaBlock.create({ ...child.attrs }));
        targets.push({ pos, size: node.nodeSize, nodes: blockNodes });
    });

    if (targets.length === 0) {
        return null;
    }

    let tr = state.tr;
    for (let i = targets.length - 1; i >= 0; i -= 1) {
        const target = targets[i];
        tr = tr.replaceWith(target.pos, target.pos + target.size, target.nodes);
    }

    const firstChild = tr.doc.content.firstChild;
    const lastChild = tr.doc.content.lastChild;
    if (firstChild && firstChild.isAtom) {
        tr = tr.insert(0, state.schema.nodes.paragraph.create());
    }
    if (lastChild && lastChild.isAtom) {
        tr = tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create());
    }

    return tr;
}

function normalizeBlockBoundaries(state: EditorState): Transaction | null {
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) {
        return null;
    }

    const insertions = new Set<number>();

    const inspectContainer = (node: ProseMirrorNode, pos: number) => {
        if (!(node.isBlock || node.type.name === 'doc')) {
            return;
        }
        const contentSpec = node.type?.spec?.content || '';
        if (!contentSpec.includes('block')) {
            return;
        }
        if (node.childCount === 0) {
            return;
        }

        const children: Array<{ node: ProseMirrorNode; offset: number }> = [];
        node.forEach((child, offset) => {
            children.push({ node: child, offset });
        });

        children.forEach((entry, index) => {
            const child = entry.node;
            const needsBoundary = child.isTextblock && child.type.name === 'diagram_fence';
            if (child.isTextblock && !needsBoundary) {
                return;
            }
            const prev = index > 0 ? children[index - 1].node : null;
            const next = index < children.length - 1 ? children[index + 1].node : null;
            const childPos = (node.type.name === 'doc' ? pos : pos + 1) + entry.offset;
            if (!prev || !prev.isTextblock) {
                insertions.add(childPos);
            }
            if (!next || !next.isTextblock) {
                insertions.add(childPos + child.nodeSize);
            }
        });
    };

    inspectContainer(state.doc, 0);
    state.doc.descendants((node, pos) => {
        inspectContainer(node, pos);
    });

    if (insertions.size === 0) {
        return null;
    }

    const positions = Array.from(insertions).sort((a, b) => b - a);
    let tr = state.tr;
    positions.forEach((insertPos) => {
        tr = tr.insert(insertPos, paragraph.create());
    });
    return tr;
}

function normalizeTaskCheckboxes(state: EditorState): Transaction | null {
    const checkboxNode = state.schema.nodes.task_checkbox;
    const paragraph = state.schema.nodes.paragraph;
    const listItem = state.schema.nodes.list_item;
    if (!checkboxNode || !paragraph || !listItem) {
        return null;
    }

    const targets: Array<{ from: number; to: number; nodes: ProseMirrorNode[] }> = [];

    state.doc.descendants((node, pos) => {
        if (node.type !== listItem) {
            return;
        }
        let paragraphNode: ProseMirrorNode | null = null;
        let paragraphPos = 0;
        node.forEach((child: ProseMirrorNode, offset: number) => {
            if (!paragraphNode && child.type === paragraph) {
                paragraphNode = child;
                paragraphPos = pos + 1 + offset;
            }
        });
        if (!paragraphNode) {
            return;
        }
        const paragraphValue = paragraphNode as ProseMirrorNode;

        let firstInline: { node: ProseMirrorNode; pos: number } | null = null;
        let inlineOffset = 0;
        for (let i = 0; i < paragraphValue.childCount; i += 1) {
            const child = paragraphValue.child(i);
            if (child.type === checkboxNode) {
                firstInline = { node: child, pos: paragraphPos + 1 + inlineOffset };
                break;
            }
            if (child.isText && (child.text || '').trim() === '') {
                inlineOffset += child.nodeSize;
                continue;
            }
            firstInline = { node: child, pos: paragraphPos + 1 + inlineOffset };
            break;
        }

        const inlineTarget: { node: ProseMirrorNode; pos: number } | null = firstInline;
        if (!inlineTarget || inlineTarget.node.type === checkboxNode || !inlineTarget.node.isText) {
            return;
        }

        const text = inlineTarget.node.text || '';
        const match = text.match(/^\[( |x|X)\]\s+/);
        if (!match) {
            return;
        }

        const checked = match[1].toLowerCase() === 'x';
        const rest = text.slice(match[0].length);
        const replacement: ProseMirrorNode[] = [checkboxNode.create({ checked })];
        if (rest) {
            replacement.push(state.schema.text(rest, inlineTarget.node.marks));
        }
        targets.push({ from: inlineTarget.pos, to: inlineTarget.pos + inlineTarget.node.nodeSize, nodes: replacement });
    });

    if (targets.length === 0) {
        return null;
    }

    let tr = state.tr;
    for (let i = targets.length - 1; i >= 0; i -= 1) {
        const target = targets[i];
        tr = tr.replaceWith(target.from, target.to, target.nodes);
    }
    return tr;
}

function normalizeEditableDoc(schema: Schema, doc: ProseMirrorNode): ProseMirrorNode {
    let state = EditorState.create({ schema, doc });
    const mediaTr = normalizeMediaBlocks(state);
    if (mediaTr) {
        state = state.apply(mediaTr);
    }
    const boundaryTr = normalizeBlockBoundaries(state);
    if (boundaryTr) {
        state = state.apply(boundaryTr);
    }
    const checkboxTr = normalizeTaskCheckboxes(state);
    if (checkboxTr) {
        state = state.apply(checkboxTr);
    }
    return state.doc;
}

function convertMediaBlockToInline(view: EditorView, nodePos: number, placeAfter: boolean, insertText?: string): boolean {
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

function toggleTaskCheckbox(view: EditorView, nodePos: number, node: ProseMirrorNode): boolean {
    if (!node || node.type.name !== 'task_checkbox') {
        return false;
    }
    const checked = Boolean(node.attrs?.checked);
    const nextAttrs = { ...node.attrs, checked: !checked };
    const tr = view.state.tr.setNodeMarkup(nodePos, undefined, nextAttrs);
    view.dispatch(tr);
    return true;
}

function insertTextNextToSelectedMediaBlock(view: EditorView, text: string): boolean {
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

type WysiwygDomWithView = HTMLElement & { __wysiwygView?: EditorView };

function getWysiwygViewFromDom(target: HTMLElement | null): EditorView | null {
    if (!target) {
        return null;
    }
    const root = target.closest('.ProseMirror') as WysiwygDomWithView | null;
    return root?.__wysiwygView ?? null;
}

function findDiagramNodeFromDom(view: EditorView, block: HTMLElement): { nodePos: number; node: ProseMirrorNode } | null {
    let pos: number | null = null;
    try {
        pos = view.posAtDOM(block, 0);
    } catch {
        pos = null;
    }
    if (pos === null) {
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

function toggleDiagramEditing(view: EditorView, block: HTMLElement, nodePos?: number, node?: ProseMirrorNode): boolean {
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

function addMulticolumnColumn(view: EditorView, node: ProseMirrorNode, nodePos: number): void {
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

function removeMulticolumnColumn(view: EditorView, node: ProseMirrorNode, nodePos: number): void {
    if (!node || node.type?.name !== 'multicolumn') {
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

function replaceInlineWithNodePreserveSpace(state: EditorState, match: RegExpMatchArray, start: number, end: number, node: ProseMirrorNode): Transaction | null {
    const full = match[0] || '';
    const leadingSpace = full.length > 0 && /\s/.test(full[0]) ? full[0] : '';
    const trailingSpace = full.length > 0 && /\s/.test(full[full.length - 1]) ? full[full.length - 1] : '';
    const replaceStart = start + (leadingSpace ? 1 : 0);
    const replaceEnd = end;
    if (replaceEnd <= replaceStart) {
        return null;
    }
    let tr = state.tr.replaceWith(replaceStart, replaceEnd, node);
    if (trailingSpace) {
        const insertPos = tr.mapping.map(replaceStart) + node.nodeSize;
        tr = tr.insertText(trailingSpace, insertPos, insertPos);
    }
    return tr;
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

function inlineNodeToMarkdown(node: ProseMirrorNode, temporalPrefix: string): string | null {
    if (!node || !node.type?.name) {
        return null;
    }
    switch (node.type.name) {
        case 'media_inline': {
            const src = node.attrs?.src || '';
            if (!src) {
                return null;
            }
            const alt = node.attrs?.alt || '';
            const title = node.attrs?.title ? ` "${node.attrs.title}"` : '';
            return `![${alt}](${src}${title})`;
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

// Multicolumn helper functions
function isInsideMulticolumn(state: EditorState): boolean {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'multicolumn') {
            return true;
        }
    }
    return false;
}

function findMulticolumnAncestor(state: EditorState): { node: ProseMirrorNode; pos: number; depth: number } | null {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === 'multicolumn') {
            return { node, pos: $from.before(d), depth: d };
        }
    }
    return null;
}

function createMulticolumnTransaction(
    state: EditorState,
    schema: Schema,
    growth: number,
    _start: number,
    _end: number
): Transaction | null {
    if (!schema.nodes.multicolumn || !schema.nodes.multicolumn_column || !schema.nodes.paragraph) {
        return null;
    }

    // Find the parent paragraph and replace it entirely
    const { $from } = state.selection;
    let paragraphDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'paragraph') {
            paragraphDepth = d;
            break;
        }
    }

    if (paragraphDepth === -1) {
        return null;
    }

    const paragraphStart = $from.before(paragraphDepth);
    const paragraphEnd = $from.after(paragraphDepth);

    const sourceParagraph = $from.node(paragraphDepth);
    const beforeParagraph = schema.nodes.paragraph.create(null, sourceParagraph.content);
    const afterParagraph = schema.nodes.paragraph.create();

    // Create: paragraph (before) + multicolumn + paragraph (after)
    const columnParagraph = schema.nodes.paragraph.create();
    const column = schema.nodes.multicolumn_column.create({ growth }, columnParagraph);
    const multicolumn = schema.nodes.multicolumn.create(null, column);

    const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, [
        beforeParagraph,
        multicolumn,
        afterParagraph
    ]);

    const multicolumnPos = paragraphStart + beforeParagraph.nodeSize;
    const selectionPos = multicolumnPos + 3;
    return tr.setSelection(TextSelection.create(tr.doc, selectionPos));
}

function addColumnTransaction(
    state: EditorState,
    schema: Schema,
    growth: number,
    start: number,
    end: number
): Transaction | null {
    const ancestor = findMulticolumnAncestor(state);
    if (!ancestor || !schema.nodes.multicolumn_column || !schema.nodes.paragraph) {
        return null;
    }

    // Find the current column and add a new one after it
    const { $from } = state.selection;
    let columnDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'multicolumn_column') {
            columnDepth = d;
            break;
        }
    }

    if (columnDepth === -1) {
        return null;
    }

    // Delete the typed text and insert new column after current column
    const columnEnd = $from.after(columnDepth);
    const paragraph = schema.nodes.paragraph.create();
    const newColumn = schema.nodes.multicolumn_column.create({ growth }, paragraph);

    const tr = state.tr.delete(start, end);
    // Adjust position after deletion
    const adjustedPos = columnEnd - (end - start);
    return tr.insert(adjustedPos, newColumn);
}

function closeMulticolumnTransaction(
    state: EditorState,
    schema: Schema,
    start: number,
    end: number
): Transaction | null {
    const ancestor = findMulticolumnAncestor(state);
    if (!ancestor || !schema.nodes.paragraph) {
        return null;
    }

    // Delete the typed text and add a paragraph after the multicolumn
    const multicolumnEnd = ancestor.pos + ancestor.node.nodeSize;
    const paragraph = schema.nodes.paragraph.create();

    const tr = state.tr.delete(start, end);
    // Adjust position after deletion
    const adjustedPos = multicolumnEnd - (end - start);
    return tr.insert(adjustedPos, paragraph);
}

function buildMarkdownInputRules(schema: Schema): InputRule[] {
    const rules: InputRule[] = [];

    if (schema.nodes.bullet_list) {
        rules.push(wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));
    }

    if (schema.nodes.ordered_list) {
        rules.push(wrappingInputRule(/^\s*(\d+)\.\s$/, schema.nodes.ordered_list, (match: RegExpMatchArray) => ({ order: Number.parseInt(match[1], 10) }), (match, node) => node.childCount + node.attrs.order === Number.parseInt(match[1], 10)));
    }

    if (schema.nodes.blockquote) {
        rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
    }

    if (schema.nodes.heading) {
        rules.push(textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match: RegExpMatchArray) => ({ level: match[1].length })));
    }

    if (schema.nodes.media_inline) {
        rules.push(new InputRule(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/, (state, match, start, end) => {
            const alt = match[1] || '';
            const src = match[2] || '';
            const title = match[3] || '';
            if (!src) {
                return null;
            }
            const inferred = inferMediaTypeFromSrc(src);
            const attrs: Record<string, unknown> = { src, mediaType: inferred || 'image' };
            if (alt) {
                attrs.alt = alt;
            }
            if (title) {
                attrs.title = title;
            }
            return state.tr.replaceWith(start, end, schema.nodes.media_inline.create(attrs));
        }));

        rules.push(new InputRule(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)\s$/, (state, match, start, end) => {
            const alt = match[1] || '';
            const src = match[2] || '';
            const title = match[3] || '';
            if (!src) {
                return null;
            }
            const inferred = inferMediaTypeFromSrc(src);
            const attrs: Record<string, unknown> = { src, mediaType: inferred || 'image' };
            if (alt) {
                attrs.alt = alt;
            }
            if (title) {
                attrs.title = title;
            }
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.media_inline.create(attrs));
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

        rules.push(new InputRule(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)\s$/, (state, match, start, end) => {
            const text = match[1] || '';
            const href = match[2] || '';
            const title = match[3] || '';
            if (!text || !href) {
                return null;
            }
            const mark = schema.marks.link.create({ href, title });
            const textNode = schema.text(text, [mark]);
            return replaceInlineWithNodePreserveSpace(state, match, start, end, textNode);
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

        rules.push(new InputRule(/!!!include\(([^)]+)\)!!!\s$/, (state, match, start, end) => {
            const path = match[1]?.trim() || '';
            if (!path) {
                return null;
            }
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.include_inline.create({ path, includeType: 'regular', missing: false }));
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

        rules.push(new InputRule(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]\s$/, (state, match, start, end) => {
            const document = match[1]?.trim() || '';
            const title = match[2]?.trim() || '';
            if (!document) {
                return null;
            }
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.wiki_link.create({ document, title: title || document }));
        }));
    }

    if (schema.nodes.tag) {
        rules.push(new InputRule(/(?:^|\s)(#([^\s#]+|(\+\+|\+|--|-|\u00f8|\u00d8)))\s$/, (state, match, start, end) => {
            const raw = match[1] || '';
            const value = raw.startsWith('#') ? raw.slice(1) : raw;
            if (!value) {
                return null;
            }
            const flavor = getTagFlavor(value);
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.tag.create({ value, flavor }));
        }));
    }

    if (schema.nodes.person_tag || schema.nodes.date_tag) {
        rules.push(new InputRule(/(?:^|\s)(@([^\s@]+))\s$/, (state, match, start, end) => {
            const raw = match[1] || '';
            const value = raw.startsWith('@') ? raw.slice(1) : raw;
            if (!value) {
                return null;
            }
            const dateLike = isDateLike(value);
            if (dateLike && schema.nodes.date_tag) {
                return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.date_tag.create({ value, kind: 'date' }));
            }
            if (schema.nodes.person_tag) {
                return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.person_tag.create({ value }));
            }
            if (schema.nodes.date_tag) {
                return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.date_tag.create({ value, kind: 'date' }));
            }
            return null;
        }));
    }

    if (schema.nodes.temporal_tag) {
        rules.push(new InputRule(/(?:^|\s)(!([^\s!]+))\s$/, (state, match, start, end) => {
            const raw = match[1] || '';
            const value = raw.startsWith('!') ? raw.slice(1) : raw;
            if (!value) {
                return null;
            }
            return replaceInlineWithNodePreserveSpace(state, match, start, end, schema.nodes.temporal_tag.create({ value, kind: 'generic' }));
        }));
    }

    // Multicolumn input rules
    if (schema.nodes.multicolumn) {
        // ---: or ---: N at start of paragraph + space → create multicolumn
        rules.push(new InputRule(/^---:\s*(\d*)\s$/, (state, match, start, end) => {
            // Only create if NOT already inside a multicolumn
            if (isInsideMulticolumn(state)) {
                return null;
            }
            const growth = parseInt(match[1]) || 1;
            return createMulticolumnTransaction(state, schema, growth, start, end);
        }));

        // :--: or :--: N inside multicolumn + space → add column separator
        rules.push(new InputRule(/^:--:\s*(\d*)\s$/, (state, match, start, end) => {
            if (!isInsideMulticolumn(state)) {
                return null;
            }
            const growth = parseInt(match[1]) || 1;
            return addColumnTransaction(state, schema, growth, start, end);
        }));

        // :--- inside multicolumn + space → close/exit multicolumn
        rules.push(new InputRule(/^:---\s$/, (state, match, start, end) => {
            if (!isInsideMulticolumn(state)) {
                return null;
            }
            return closeMulticolumnTransaction(state, schema, start, end);
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
                return false; // Don't handle, let handleClickOn take over
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
                const imageMenuButton = target.closest?.('.image-menu-btn') as HTMLElement | null;
                if (imageMenuButton) {
                    const container = imageMenuButton.closest('.image-path-overlay-container') as HTMLElement | null;
                    const imagePath = container?.dataset?.filePath ||
                        container?.querySelector('img')?.getAttribute('data-original-src') ||
                        container?.querySelector('img')?.getAttribute('data-file-path') ||
                        container?.querySelector('img')?.getAttribute('src');
                    const menuApi = window as unknown as { toggleImagePathMenu?: (container: HTMLElement, imagePath: string) => void };
                    if (container && imagePath && typeof menuApi.toggleImagePathMenu === 'function') {
                        event.preventDefault();
                        event.stopPropagation();
                        menuApi.toggleImagePathMenu(container, imagePath);
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
                    const menuApi = window as unknown as { toggleVideoPathMenu?: (container: HTMLElement, videoPath: string) => void };
                    if (container && videoPath && typeof menuApi.toggleVideoPathMenu === 'function') {
                        event.preventDefault();
                        event.stopPropagation();
                        menuApi.toggleVideoPathMenu(container, videoPath);
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

        (this.view.dom as WysiwygDomWithView).__wysiwygView = this.view;

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
