import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView, NodeView } from 'prosemirror-view';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands';
import { inputRules, smartQuotes, ellipsis, emDash, InputRule, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules';
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

type MediaPathHelpers = {
    buildWebviewResourceUrl?: (pathValue: string, encodeSegments?: boolean) => string;
    isRelativeResourcePath?: (value: string) => boolean;
    isWindowsAbsolutePath?: (value: string) => boolean;
    normalizeWindowsAbsolutePath?: (value: string, shouldDecode?: boolean) => string;
    safeDecodePath?: (value: string) => string;
    resolveRelativePath?: (baseDir: string, relativePath: string) => string;
    currentFilePath?: string;
    currentTaskIncludeContext?: { includeDir?: string };
    handleImageNotFound?: (img: HTMLImageElement, originalSrc: string) => void;
    queueDiagramRender?: (id: string, filePath: string, diagramType: string, includeDir?: string) => void;
    queuePDFPageRender?: (id: string, filePath: string, pageNumber: number, includeDir?: string) => void;
    queuePDFSlideshow?: (id: string, filePath: string, includeDir?: string) => void;
    queueMermaidRender?: (id: string, code: string) => void;
    queuePlantUMLRender?: (id: string, code: string) => void;
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

    if (isMermaid && typeof api.queueMermaidRender === 'function') {
        api.queueMermaidRender(previewId, code);
        return;
    }
    if (isPlantUml && typeof api.queuePlantUMLRender === 'function') {
        api.queuePlantUMLRender(previewId, code);
    }
}

function syncWysiwygDiagramFile(dom: HTMLElement, originalSrc: string): void {
    const api = window as unknown as MediaPathHelpers;
    const diagramInfo = getDiagramFileInfo(originalSrc);
    if (!diagramInfo) {
        return;
    }

    dom.dataset.wysiwygDiagram = 'true';
    const placeholderId = makePreviewId('wysiwyg-media');
    const placeholder = document.createElement('div');
    placeholder.id = placeholderId;
    placeholder.className = 'diagram-placeholder';
    dom.innerHTML = '';
    dom.appendChild(placeholder);

    const includeDir = api.currentTaskIncludeContext?.includeDir;
    if (diagramInfo.mode === 'diagram' && diagramInfo.diagramType && typeof api.queueDiagramRender === 'function') {
        api.queueDiagramRender(placeholderId, diagramInfo.filePath, diagramInfo.diagramType, includeDir);
        return;
    }
    if (diagramInfo.mode === 'pdf-page' && typeof api.queuePDFPageRender === 'function') {
        api.queuePDFPageRender(placeholderId, diagramInfo.filePath, diagramInfo.pageNumber || 1, includeDir);
        return;
    }
    if (diagramInfo.mode === 'pdf-slideshow' && typeof api.queuePDFSlideshow === 'function') {
        api.queuePDFSlideshow(placeholderId, diagramInfo.filePath, includeDir);
    }
}

function createMediaInlineView(node: any): NodeView {
    const dom = document.createElement('span');

    const render = (currentNode: any) => {
        const mediaType = currentNode.attrs?.mediaType || 'image';
        const src = currentNode.attrs?.src || '';
        const alt = currentNode.attrs?.alt || '';
        const title = currentNode.attrs?.title || '';

        dom.innerHTML = '';
        dom.className = mediaType === 'image' ? 'image-path-overlay-container wysiwyg-media' : 'wysiwyg-media';
        dom.dataset.type = mediaType;

        if (mediaType === 'image') {
            dom.dataset.imagePath = src;
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

function createDiagramFenceView(node: any): NodeView {
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

    const render = (currentNode: any) => {
        const lang = currentNode.attrs?.lang || '';
        dom.dataset.lang = lang;
        pre.dataset.lang = lang;
        renderDiagramPreview(preview, lang, currentNode.textContent || '');
    };

    render(node);

    return {
        dom,
        contentDOM: code,
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
        const originalSrc = overlay?.dataset?.imagePath || img.dataset.originalSrc || img.getAttribute('data-original-src') || img.getAttribute('src') || '';
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
        if (overlay && !overlay.dataset.imagePath) {
            overlay.dataset.imagePath = originalSrc;
        }
        if (!(img as unknown as { __wysiwygImageHandler?: boolean }).__wysiwygImageHandler) {
            (img as unknown as { __wysiwygImageHandler?: boolean }).__wysiwygImageHandler = true;
            img.onerror = () => {
                if (typeof api.handleImageNotFound === 'function') {
                    api.handleImageNotFound(img, originalSrc);
                }
            };
        }
    });
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

function getTagFlavor(value: string): string {
    if (value.startsWith('gather_')) {
        return 'gather';
    }
    if (/^(\+\+|\+|\u00f8|\u00d8|--|-)$/u.test(value)) {
        return 'polarity';
    }
    return 'tag';
}

function isDateLike(value: string): boolean {
    if (!value) {
        return false;
    }
    if (/[0-9]/.test(value)) {
        return true;
    }
    return /^w\d+/i.test(value) || /[:/.-]/.test(value);
}

function replaceInlineWithNode(state: any, match: RegExpMatchArray, start: number, end: number, node: any): any {
    const full = match[0] || '';
    const hasLeadingSpace = full.length > 0 && /\s/.test(full[0]);
    const hasTrailingSpace = full.length > 0 && /\s/.test(full[full.length - 1]);
    const replaceStart = start + (hasLeadingSpace ? 1 : 0);
    const replaceEnd = end - (hasTrailingSpace ? 1 : 0);
    if (replaceEnd <= replaceStart) {
        return null;
    }
    return state.tr.replaceWith(replaceStart, replaceEnd, node);
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
            const attrs: Record<string, unknown> = { src, mediaType: 'image' };
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
            const attrs: Record<string, unknown> = { src, mediaType: 'image' };
            if (alt) {
                attrs.alt = alt;
            }
            if (title) {
                attrs.title = title;
            }
            return replaceInlineWithNode(state, match, start, end, schema.nodes.media_inline.create(attrs));
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
            return replaceInlineWithNode(state, match, start, end, textNode);
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
            return replaceInlineWithNode(state, match, start, end, schema.nodes.include_inline.create({ path, includeType: 'regular', missing: false }));
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
            return replaceInlineWithNode(state, match, start, end, schema.nodes.wiki_link.create({ document, title: title || document }));
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
            return replaceInlineWithNode(state, match, start, end, schema.nodes.tag.create({ value, flavor }));
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
                return replaceInlineWithNode(state, match, start, end, schema.nodes.date_tag.create({ value, kind: 'date' }));
            }
            if (schema.nodes.person_tag) {
                return replaceInlineWithNode(state, match, start, end, schema.nodes.person_tag.create({ value }));
            }
            if (schema.nodes.date_tag) {
                return replaceInlineWithNode(state, match, start, end, schema.nodes.date_tag.create({ value, kind: 'date' }));
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
            return replaceInlineWithNode(state, match, start, end, schema.nodes.temporal_tag.create({ value, kind: 'generic' }));
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
            nodeViews: {
                media_inline: (node) => createMediaInlineView(node),
                diagram_fence: (node) => createDiagramFenceView(node)
            },
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
                    const container = imageMenuButton.closest('.image-path-overlay-container') as HTMLElement | null;
                    const imagePath = container?.dataset?.imagePath ||
                        container?.querySelector('img')?.getAttribute('data-original-src') ||
                        container?.querySelector('img')?.getAttribute('data-image-path') ||
                        container?.querySelector('img')?.getAttribute('src');
                    const menuApi = window as unknown as { toggleImagePathMenu?: (container: HTMLElement, imagePath: string) => void };
                    if (container && imagePath && typeof menuApi.toggleImagePathMenu === 'function') {
                        event.preventDefault();
                        event.stopPropagation();
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
                syncWysiwygImages(this.view.dom);
            }
        });

        this.lastMarkdown = this.serializeState(this.view.state);
        syncWysiwygImages(this.view.dom);
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
        syncWysiwygImages(this.view.dom);
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
