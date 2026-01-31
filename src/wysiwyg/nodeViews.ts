import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { Selection } from 'prosemirror-state';
import { convertMediaBlockToInline } from './commands';

export type MediaPathHelpers = {
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

const DIAGRAM_PREVIEW_DEBOUNCE_MS = 200;
const diagramPreviewTimers = new WeakMap<HTMLElement, number>();

// --- DOM construction helpers ---

function createMenuButton(className: string, action: string, label: string = '☰'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.type = 'button';
    btn.title = 'Path options';
    btn.textContent = label;
    btn.setAttribute('data-action', action);
    btn.contentEditable = 'false';
    return btn;
}

function createEditButton(action: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'wysiwyg-edit-btn';
    btn.type = 'button';
    btn.textContent = 'Edit';
    btn.setAttribute('data-action', action);
    btn.contentEditable = 'false';
    return btn;
}

// --- Path resolution ---

export function resolveDisplaySrc(originalSrc: string): string {
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

// --- Diagram detection ---

function makePreviewId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDiagramFileInfo(src: string): { mode: 'diagram' | 'pdf-page' | 'pdf-slideshow'; filePath: string; diagramType?: string; pageNumber?: number } | null {
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

// --- Diagram preview rendering ---

function renderDiagramPreview(preview: HTMLElement, lang: string, code: string): void {
    const api = window as unknown as MediaPathHelpers;
    const lowerLang = (lang || '').toLowerCase();
    const isMermaid = lowerLang === 'mermaid';
    const isPlantUml = lowerLang === 'plantuml' || lowerLang === 'puml';

    const existingTimer = diagramPreviewTimers.get(preview);
    if (existingTimer) {
        clearTimeout(existingTimer);
        diagramPreviewTimers.delete(preview);
    }

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

// --- Diagram file rendering (drawio, excalidraw, PDF) ---

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
    dom.appendChild(createMenuButton('image-menu-btn', 'image-menu'));

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

// --- Per-type render functions for createMediaView ---

function renderImageNode(dom: HTMLElement, src: string, alt: string, title: string): void {
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
    img.src = resolveDisplaySrc(src);
    img.contentEditable = 'false';

    img.addEventListener('error', () => dom.classList.add('image-broken'));
    img.addEventListener('load', () => dom.classList.remove('image-broken'));

    dom.appendChild(img);
    dom.appendChild(createMenuButton('image-menu-btn', 'image-menu'));
}

function renderVideoAudioNode(dom: HTMLElement, src: string, mediaType: string): void {
    dom.dataset.src = src;
    dom.dataset.filePath = src;

    const mediaEl = document.createElement(mediaType === 'audio' ? 'audio' : 'video');
    mediaEl.controls = true;
    mediaEl.src = resolveDisplaySrc(src);
    mediaEl.dataset.originalSrc = src;
    mediaEl.contentEditable = 'false';

    if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
        const api = window as unknown as MediaPathHelpers;
        mediaEl.addEventListener('error', () => {
            if (typeof api.handleMediaNotFound === 'function') {
                api.handleMediaNotFound(mediaEl, src, 'video');
            }
        });
    }

    dom.appendChild(mediaEl);
    dom.appendChild(createMenuButton('video-menu-btn', 'video-menu'));
}

function renderFallbackNode(dom: HTMLElement, src: string): void {
    dom.dataset.src = src;
    dom.appendChild(createEditButton('media'));
    if (src) {
        dom.appendChild(document.createTextNode(src));
    }
}

// --- Media NodeView factory ---

function createMediaView(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    isBlock: boolean
): NodeView {
    const dom = document.createElement(isBlock ? 'div' : 'span');

    dom.addEventListener('mousedown', (evt) => {
        const e = evt as MouseEvent;
        const pos = getPos();
        if (pos === undefined) {
            return;
        }

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
        const mediaType = currentNode.attrs.mediaType || 'image';
        const src = currentNode.attrs.src || '';
        const blockClass = isBlock ? ' wysiwyg-media-block' : '';

        dom.innerHTML = '';
        dom.dataset.type = mediaType;

        if (mediaType === 'image') {
            dom.className = `image-path-overlay-container wysiwyg-media${blockClass}`;
            renderImageNode(dom, src, currentNode.attrs.alt || '', currentNode.attrs.title || '');
        } else if (mediaType === 'video' || mediaType === 'audio') {
            dom.className = `video-path-overlay-container wysiwyg-media${blockClass}`;
            renderVideoAudioNode(dom, src, mediaType);
        } else {
            dom.className = `wysiwyg-media${blockClass}`;
            renderFallbackNode(dom, src);
        }
    };

    render(node);

    return {
        dom,
        update: (nextNode) => {
            if (nextNode.type !== node.type) {
                return false;
            }
            const needsUpdate = nextNode.attrs.src !== node.attrs.src ||
                nextNode.attrs.mediaType !== node.attrs.mediaType ||
                nextNode.attrs.alt !== node.attrs.alt ||
                nextNode.attrs.title !== node.attrs.title;
            node = nextNode;
            if (needsUpdate) {
                render(nextNode);
            }
            return true;
        }
    };
}

export function createMediaInlineView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView {
    return createMediaView(node, view, getPos, false);
}

export function createMediaBlockView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView {
    return createMediaView(node, view, getPos, true);
}

// --- Diagram fence NodeView ---

export function createDiagramFenceView(node: ProseMirrorNode): NodeView {
    const dom = document.createElement('div');
    dom.className = 'wysiwyg-diagram-block';

    const preview = document.createElement('div');
    preview.className = 'wysiwyg-diagram-preview';
    preview.contentEditable = 'false';

    const pre = document.createElement('pre');
    pre.className = 'wysiwyg-diagram';
    const code = document.createElement('code');
    pre.appendChild(code);

    dom.appendChild(preview);
    dom.appendChild(createEditButton('diagram'));
    dom.appendChild(pre);

    const render = (currentNode: ProseMirrorNode) => {
        const lang = currentNode.attrs.lang || '';
        dom.dataset.lang = lang;
        pre.dataset.lang = lang;
        renderDiagramPreview(preview, lang, currentNode.textContent);
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
            const langChanged = nextNode.attrs.lang !== node.attrs.lang;
            const codeChanged = nextNode.textContent !== node.textContent;
            node = nextNode;
            if (langChanged || codeChanged) {
                render(nextNode);
            }
            return true;
        }
    };
}

// --- Image sync utility ---

export function syncWysiwygImages(container: HTMLElement): void {
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
