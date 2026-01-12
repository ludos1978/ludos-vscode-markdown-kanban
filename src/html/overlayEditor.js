// Overlay editor scaffold for task editing.
// This file defines the high-level structure and integration points.

(function initOverlayEditor() {
    const overlay = document.getElementById('task-overlay-editor');
    if (!overlay) { return; }

    const supportedModes = new Set(['markdown', 'dual', 'wysiwyg']);
    const configKeys = {
        enabled: 'overlayEditorEnabled',
        defaultMode: 'overlayEditorDefaultMode',
        fontScale: 'overlayEditorFontScale'
    };

    const state = {
        // Requires: global settings (enable toggle, default mode, font scale).
        enabled: false,
        mode: 'markdown', // markdown | dual | wysiwyg
        fontScale: 1.2,
        draft: '',
        taskRef: null, // { taskId, columnId, includeContext, title }
        taskData: null // { task, column }
    };

    const elements = {
        backdrop: overlay.querySelector('.task-overlay-backdrop'),
        panel: overlay.querySelector('.task-overlay-panel'),
        title: overlay.querySelector('.task-overlay-title'),
        previewWrap: overlay.querySelector('.task-overlay-preview'),
        wysiwygWrap: overlay.querySelector('.task-overlay-wysiwyg'),
        textarea: overlay.querySelector('.task-overlay-textarea'),
        settings: overlay.querySelector('.task-overlay-settings')
    };

    class CommandRegistry {
        // Requires: shared toolbar command registry that routes to adapters.
        constructor() {
            this.handlers = new Map();
        }

        register(command, handler) {
            this.handlers.set(command, handler);
        }

        execute(command, payload) {
            const handler = this.handlers.get(command);
            if (handler) {
                handler(payload);
            }
        }
    }

    class MarkdownAdapter {
        // Requires: textarea + preview rendering via markdownRenderer pipeline.
        constructor(textarea, preview, onChange) {
            this.textarea = textarea;
            this.preview = preview;
            this.onChange = onChange;
            this.inputHandler = null;
        }

        activate() {
            if (!this.textarea || this.inputHandler) { return; }
            this.inputHandler = () => {
                if (typeof this.onChange === 'function') {
                    this.onChange();
                }
            };
            this.textarea.addEventListener('input', this.inputHandler);
        }

        deactivate() {
            if (this.textarea && this.inputHandler) {
                this.textarea.removeEventListener('input', this.inputHandler);
            }
            this.inputHandler = null;
        }

        getValue() {
            return this.textarea ? this.textarea.value : '';
        }

        setValue(value) {
            if (this.textarea) {
                this.textarea.value = value || '';
            }
            if (typeof this.onChange === 'function') {
                this.onChange();
            }
        }

        insertText(text) {
            if (!this.textarea) { return; }
            const { selectionStart = 0, selectionEnd = 0, value = '' } = this.textarea;
            const before = value.slice(0, selectionStart);
            const after = value.slice(selectionEnd);
            this.textarea.value = `${before}${text}${after}`;
            if (typeof this.onChange === 'function') {
                this.onChange();
            }
        }

        setFontScale() {}
        focus() {
            if (this.textarea) {
                this.textarea.focus();
            }
        }
    }

    class WysiwygAdapter {
        // Requires: WysiwygEditor integration with toolbar + markdown-it tokens.
        constructor(container, options = {}) {
            this.container = container;
            this.editor = null;
            this.context = options.context;
            this.temporalPrefix = options.temporalPrefix || (window.TAG_PREFIXES?.TEMPORAL || '!');
        }

        activate() {
            if (!this.container || typeof window.WysiwygEditor !== 'function') { return; }
            const taskRef = this.context?.getTaskRef?.() || null;
            const draft = this.context?.getDraft?.() || '';
            window.currentTaskIncludeContext = taskRef?.includeContext || null;
            if (!this.editor) {
                this.container.innerHTML = '';
                this.editor = new window.WysiwygEditor(this.container, {
                    markdown: draft,
                    temporalPrefix: this.temporalPrefix,
                    onChange: (markdown) => {
                        if (this.context?.setDraft) {
                            this.context.setDraft(markdown);
                        }
                    },
                    onSubmit: () => {
                        if (this.context?.onSubmit) {
                            this.context.onSubmit();
                        }
                    },
                    onSelectionChange: (selectionState) => {
                        if (this.context?.onSelectionChange) {
                            this.context.onSelectionChange(selectionState);
                        }
                    }
                });
            } else if (typeof this.editor.setMarkdown === 'function') {
                this.editor.setMarkdown(draft);
            }
        }

        deactivate() {
            if (this.editor && typeof this.editor.destroy === 'function') {
                this.editor.destroy();
            }
            this.editor = null;
            if (this.container) {
                this.container.innerHTML = '';
            }
        }

        getValue() {
            if (this.editor && typeof this.editor.getMarkdown === 'function') {
                return this.editor.getMarkdown();
            }
            return this.context?.getDraft?.() || '';
        }

        setValue(value) {
            if (this.context?.setDraft) {
                this.context.setDraft(value || '');
            }
            if (this.editor && typeof this.editor.setMarkdown === 'function') {
                this.editor.setMarkdown(value || '');
            }
        }

        insertText(text) {
            if (this.editor && typeof this.editor.insertText === 'function') {
                this.editor.insertText(text);
                return;
            }
            if (this.editor && typeof this.editor.getMarkdown === 'function' &&
                typeof this.editor.setMarkdown === 'function') {
                const current = this.editor.getMarkdown() || '';
                this.editor.setMarkdown(current + text);
                return;
            }
        }

        applyCommand(command) {
            if (this.editor && typeof this.editor.applyCommand === 'function') {
                return this.editor.applyCommand(command);
            }
            return false;
        }

        setFontScale(scale) {
            if (this.container) {
                this.container.style.fontSize = `calc(1em * ${scale})`;
            }
        }

        focus() {
            if (this.editor && typeof this.editor.focus === 'function') {
                this.editor.focus();
            }
        }
    }

    class DropHandler {
        // Requires: convert external file drops into markdown link/image insertions.
        constructor(target, getAdapter) {
            this.target = target;
            this.getAdapter = getAdapter;
            this.attached = false;
            this.handleDragOver = null;
            this.handleDrop = null;
        }

        attach() {
            if (this.attached || !this.target) { return; }
            this.attached = true;
            this.handleDragOver = (event) => {
                if (!overlay.classList.contains('visible')) { return; }
                if (!this.target.contains(event.target)) { return; }
                event.preventDefault();
                event.stopPropagation();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'copy';
                }
            };
            this.handleDrop = async (event) => {
                if (!overlay.classList.contains('visible')) { return; }
                if (!this.target.contains(event.target)) { return; }
                event.preventDefault();
                event.stopPropagation();
                const markdown = await resolveDropContent(event.dataTransfer);
                if (!markdown) { return; }
                const adapter = typeof this.getAdapter === 'function' ? this.getAdapter() : null;
                if (adapter && typeof adapter.insertText === 'function') {
                    adapter.insertText(markdown);
                } else if (elements.textarea) {
                    elements.textarea.value += markdown;
                    setState({ draft: elements.textarea.value }, { renderPreview: true });
                }
            };
            this.target.addEventListener('dragover', this.handleDragOver);
            this.target.addEventListener('drop', this.handleDrop);
        }

        detach() {
            if (!this.attached || !this.target) { return; }
            this.attached = false;
            if (this.handleDragOver) {
                this.target.removeEventListener('dragover', this.handleDragOver);
            }
            if (this.handleDrop) {
                this.target.removeEventListener('drop', this.handleDrop);
            }
            this.handleDragOver = null;
            this.handleDrop = null;
        }
    }

    function isUrl(text) {
        return /^https?:\/\//i.test(text);
    }

    function normalizeUriList(uriList) {
        if (!uriList) { return []; }
        return uriList
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
                if (line.startsWith('file://')) {
                    let filePath = line.replace('file://', '');
                    if (filePath.startsWith('/')) {
                        filePath = filePath.replace(/^\/([A-Za-z]:\/)/, '$1');
                    }
                    try {
                        return decodeURIComponent(filePath);
                    } catch (error) {
                        return filePath;
                    }
                }
                return line;
            });
    }

    function buildMarkdownLinks(paths) {
        const linkFn = (typeof createFileMarkdownLink === 'function')
            ? createFileMarkdownLink
            : (path) => path;
        return paths.map(path => linkFn(path)).join('\n');
    }

    async function resolveDropContent(dataTransfer) {
        if (!dataTransfer) { return null; }
        const files = Array.from(dataTransfer.files || []);
        if (files.length > 0) {
            const paths = files.map(file => file.path || file.name).filter(Boolean);
            if (paths.length > 0) {
                return buildMarkdownLinks(paths);
            }
        }
        const uriList = dataTransfer.getData('text/uri-list');
        if (uriList) {
            const uris = normalizeUriList(uriList);
            if (uris.length > 0) {
                return buildMarkdownLinks(uris);
            }
        }
        const text = dataTransfer.getData('text/plain');
        if (text && text.trim()) {
            const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            if (lines.length > 1) {
                const linkable = lines.filter(line => (window.isFilePath && window.isFilePath(line)) || isUrl(line));
                if (linkable.length > 0) {
                    return buildMarkdownLinks(linkable);
                }
            }
            if (typeof processClipboardText === 'function') {
                try {
                    const processed = await processClipboardText(text.trim());
                    if (processed?.content) {
                        return processed.content;
                    }
                } catch (error) {
                    // Fallback to raw text insert.
                }
            }
            return text;
        }
        return null;
    }

    const commandRegistry = new CommandRegistry();
    const commandSnippets = {
        bold: '**bold**',
        italic: '*italic*',
        underline: '_underline_',
        strike: '~~strike~~',
        mark: '==mark==',
        sub: 'H~2~O',
        sup: '29^th^',
        link: '[text](url)',
        image: '![alt](path)',
        code: '`code`',
        'code-block': '```\ncode\n```',
        multicolumn: '---:\n\n:--:\n\n:---',
        footnote: 'Footnote reference[^1]\n\n[^1]: Footnote text',
        emoji: ':smile:',
        wiki: '[[Page]]',
        include: '!!!include(path)!!!',
        'container-note': '::: note\n\n:::\n',
        'container-comment': '::: comment\n\n:::\n',
        'container-highlight': '::: highlight\n\n:::\n',
        'container-mark-red': '::: mark-red\n\n:::\n',
        'container-mark-green': '::: mark-green\n\n:::\n',
        'container-mark-blue': '::: mark-blue\n\n:::\n',
        'container-mark-cyan': '::: mark-cyan\n\n:::\n',
        'container-mark-magenta': '::: mark-magenta\n\n:::\n',
        'container-mark-yellow': '::: mark-yellow\n\n:::\n',
        'container-center': '::: center\n\n:::\n',
        'container-center100': '::: center100\n\n:::\n',
        'container-right': '::: right\n\n:::\n',
        'container-caption': '::: caption\n\n:::\n'
    };

    const commandMarkMap = {
        bold: 'strong',
        italic: 'em',
        underline: 'underline',
        strike: 'strike',
        mark: 'mark',
        sub: 'sub',
        sup: 'sup',
        code: 'code',
        link: 'link',
        ins: 'ins'
    };

    function updateWysiwygToolbar(selectionState) {
        const toolbar = overlay.querySelector('.task-overlay-tools');
        if (!toolbar) { return; }
        const marks = new Set(selectionState?.marks || []);
        const block = selectionState?.block || '';
        const toolButtons = toolbar.querySelectorAll('.task-overlay-tool');
        toolButtons.forEach((button) => {
            const command = button.dataset.command;
            let isActive = false;
            if (command === 'code-block') {
                isActive = block === 'code_block';
            } else if (command && commandMarkMap[command]) {
                isActive = marks.has(commandMarkMap[command]);
            }
            button.classList.toggle('active', isActive);
        });
    }

    function insertSnippet(snippet) {
        if (!snippet) { return; }
        const adapter = activeAdapter;
        if (adapter && typeof adapter.insertText === 'function') {
            adapter.insertText(snippet);
            if (typeof adapter.focus === 'function') {
                adapter.focus();
            }
        }
    }

    function replaceSelection(text) {
        if (typeof text !== 'string') { return; }
        const adapter = activeAdapter;
        if (adapter && typeof adapter.insertText === 'function') {
            adapter.insertText(text);
            if (typeof adapter.focus === 'function') {
                adapter.focus();
            }
            return;
        }
        if (elements.textarea) {
            const { selectionStart = 0, selectionEnd = 0, value = '' } = elements.textarea;
            const before = value.slice(0, selectionStart);
            const after = value.slice(selectionEnd);
            elements.textarea.value = `${before}${text}${after}`;
            setState({ draft: elements.textarea.value }, { renderPreview: true });
            if (typeof elements.textarea.focus === 'function') {
                elements.textarea.focus();
            }
        }
    }

    Object.entries(commandSnippets).forEach(([key, snippet]) => {
        commandRegistry.register(key, (payload = {}) => {
            const adapter = payload.adapter || activeAdapter;
            if (adapter && typeof adapter.applyCommand === 'function') {
                const handled = adapter.applyCommand(key);
                if (handled) {
                    return;
                }
            }
            insertSnippet(snippet);
        });
    });
    const adapterContext = {
        getDraft: () => state.draft,
        setDraft: (value, options = {}) => {
            setState({ draft: value }, options);
        },
        getTaskRef: () => state.taskRef,
        onSubmit: () => handleSave(),
        onSelectionChange: (selectionState) => updateWysiwygToolbar(selectionState)
    };

    const adapters = {
        markdown: new MarkdownAdapter(elements.textarea, elements.previewWrap, () => {
            const value = elements.textarea ? elements.textarea.value : '';
            setState({ draft: value }, { renderPreview: true });
        }),
        wysiwyg: new WysiwygAdapter(elements.wysiwygWrap, {
            context: adapterContext
        })
    };
    const dropHandler = new DropHandler(elements.panel, () => activeAdapter);
    let activeAdapter = getAdapterForMode(state.mode);
    let previewTimer = null;
    const previewDelayMs = 80;

    function resolveTaskData(taskRef) {
        if (!taskRef || !window.cachedBoard || !taskRef.taskId || !taskRef.columnId) {
            return null;
        }
        const column = window.cachedBoard.columns?.find(c => c.id === taskRef.columnId);
        if (!column) { return null; }
        const task = column.tasks?.find(t => t.id === taskRef.taskId);
        if (!task) { return null; }
        return { task, column };
    }

    function updateHeaderTitle(task) {
        if (!elements.title) { return; }
        if (!task?.title) {
            elements.title.textContent = 'Edit Task';
            return;
        }
        const displayTitle = window.removeTagsForDisplay ? window.removeTagsForDisplay(task.title) : task.title;
        elements.title.textContent = displayTitle || 'Edit Task';
    }

    function renderPreview() {
        if (!elements.previewWrap) { return; }
        const draft = state.draft || '';
        const includeContext = state.taskRef?.includeContext;
        const taskTitle = state.taskRef?.title;
        if (taskTitle && window.tagUtils?.extractTimeSlotTag) {
            window.currentRenderingTimeSlot = window.tagUtils.extractTimeSlotTag(taskTitle);
        }
        let rendered = typeof window.renderMarkdown === 'function'
            ? window.renderMarkdown(draft, includeContext)
            : (window.escapeHtml ? window.escapeHtml(draft) : draft);
        window.currentRenderingTimeSlot = null;
        if (typeof window.wrapTaskSections === 'function') {
            rendered = window.wrapTaskSections(rendered);
        }
        elements.previewWrap.innerHTML = rendered;
    }

    function normalizeDraft(value) {
        return typeof value === 'string' ? value : '';
    }

    function updateModeButtons() {
        const buttons = overlay.querySelectorAll('.task-overlay-btn[data-action^="mode-"]');
        buttons.forEach((button) => {
            const action = button.dataset.action || '';
            const isActive = action === `mode-${state.mode}`;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    function updatePreview(options = {}) {
        const { immediate = false } = options;
        if (state.mode !== 'dual') {
            if (previewTimer) {
                window.clearTimeout(previewTimer);
                previewTimer = null;
            }
            return;
        }
        if (previewTimer) {
            window.clearTimeout(previewTimer);
        }
        if (immediate) {
            previewTimer = null;
            renderPreview();
            return;
        }
        previewTimer = window.setTimeout(() => {
            renderPreview();
        }, previewDelayMs);
    }

    function updateWysiwygHeight() {
        if (!overlay.classList.contains('visible')) { return; }
        if (!elements.wysiwygWrap) { return; }
        const rect = elements.wysiwygWrap.getBoundingClientRect();
        if (!rect.height) { return; }
        const maxHeight = Math.floor(rect.height * 0.8);
        overlay.style.setProperty('--task-overlay-wysiwyg-height', `${maxHeight}px`);
    }

    function persistPreference(key, value) {
        if (!window.configManager || typeof window.configManager.setPreference !== 'function') {
            console.error('[OverlayEditor] configManager missing, cannot persist preference', key);
            return;
        }
        window.configManager.setPreference(key, value);
        if (window.cachedConfig) {
            window.cachedConfig[key] = value;
        }
    }

    function getAdapterForMode(mode) {
        return mode === 'wysiwyg' ? adapters.wysiwyg : adapters.markdown;
    }

    function syncDraftFromActiveAdapter() {
        if (!activeAdapter || typeof activeAdapter.getValue !== 'function') {
            return state.draft;
        }
        const adapterValue = normalizeDraft(activeAdapter.getValue());
        if (adapterValue !== state.draft) {
            setState({ draft: adapterValue }, { renderPreview: true });
        }
        return adapterValue;
    }

    function syncDraftToActiveAdapter() {
        if (!activeAdapter || typeof activeAdapter.setValue !== 'function') { return; }
        const draft = normalizeDraft(state.draft);
        const adapterValue = typeof activeAdapter.getValue === 'function'
            ? normalizeDraft(activeAdapter.getValue())
            : null;
        if (adapterValue !== null && adapterValue === draft) { return; }
        activeAdapter.setValue(draft);
    }

    function setActiveAdapter(nextAdapter) {
        if (activeAdapter === nextAdapter) {
            if (activeAdapter && typeof activeAdapter.activate === 'function') {
                activeAdapter.activate();
            }
            return;
        }
        if (activeAdapter && typeof activeAdapter.deactivate === 'function') {
            activeAdapter.deactivate();
        }
        activeAdapter = nextAdapter;
        if (activeAdapter && typeof activeAdapter.activate === 'function') {
            activeAdapter.activate();
        }
    }

    function setState(nextState = {}, options = {}) {
        const {
            persistMode = false,
            persistFontScale = false,
            renderPreview = false,
            immediatePreview = false
        } = options;
        let shouldUpdatePreview = false;
        let shouldUpdateWysiwyg = false;

        if (Object.prototype.hasOwnProperty.call(nextState, 'taskRef')) {
            state.taskRef = nextState.taskRef;
        }
        if (Object.prototype.hasOwnProperty.call(nextState, 'taskData')) {
            state.taskData = nextState.taskData;
        }
        if (Object.prototype.hasOwnProperty.call(nextState, 'enabled')) {
            state.enabled = Boolean(nextState.enabled);
        }
        if (Object.prototype.hasOwnProperty.call(nextState, 'draft')) {
            state.draft = typeof nextState.draft === 'string' ? nextState.draft : '';
            if (renderPreview) {
                shouldUpdatePreview = true;
            }
        }
        if (Object.prototype.hasOwnProperty.call(nextState, 'mode') && supportedModes.has(nextState.mode)) {
            state.mode = nextState.mode;
            overlay.dataset.mode = nextState.mode;
            setActiveAdapter(getAdapterForMode(nextState.mode));
            updateModeButtons();
            shouldUpdatePreview = true;
            shouldUpdateWysiwyg = state.mode === 'wysiwyg';
            if (persistMode) {
                persistPreference(configKeys.defaultMode, nextState.mode);
            }
        }
        if (Object.prototype.hasOwnProperty.call(nextState, 'fontScale')) {
            const nextScale = Number.isFinite(nextState.fontScale) ? nextState.fontScale : state.fontScale;
            state.fontScale = nextScale;
            overlay.style.setProperty('--task-overlay-font-scale', `${nextScale}`);
            if (activeAdapter && typeof activeAdapter.setFontScale === 'function') {
                activeAdapter.setFontScale(nextScale);
            }
            shouldUpdateWysiwyg = shouldUpdateWysiwyg || state.mode === 'wysiwyg';
            if (persistFontScale) {
                persistPreference(configKeys.fontScale, nextScale);
            }
        }
        if (shouldUpdatePreview) {
            updatePreview({ immediate: immediatePreview });
        }
        if (shouldUpdateWysiwyg && overlay.classList.contains('visible')) {
            requestAnimationFrame(() => updateWysiwygHeight());
        }
    }

    function applyFontScale(scale, options = {}) {
        setState(
            { fontScale: scale },
            { persistFontScale: options.persist === true }
        );
    }

    function setMode(mode, options = {}) {
        // Requires: mode switching for markdown, dual, and wysiwyg.
        syncDraftFromActiveAdapter();
        setState(
            { mode },
            {
                persistMode: options.persist === true,
                renderPreview: true,
                immediatePreview: true
            }
        );
        syncDraftToActiveAdapter();
    }

    function openOverlay(taskRef) {
        // Requires: block board-level drag/drop and focus traps while open.
        const resolved = resolveTaskData(taskRef);
        const task = resolved?.task || null;
        const column = resolved?.column || null;
        const nextTaskRef = {
            taskId: taskRef?.taskId,
            columnId: taskRef?.columnId,
            includeContext: task?.includeContext || null,
            title: task?.title || ''
        };
        const nextDraft = task?.description || '';
        setState(
            {
                taskRef: nextTaskRef,
                taskData: resolved ? { task, column } : null,
                draft: nextDraft,
                mode: state.mode,
                fontScale: state.fontScale
            },
            { renderPreview: true, immediatePreview: true }
        );
        updateHeaderTitle(task);
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
        syncDraftToActiveAdapter();
        if (activeAdapter && typeof activeAdapter.focus === 'function') {
            activeAdapter.focus();
        }
        requestAnimationFrame(() => updateWysiwygHeight());
        if (dropHandler && typeof dropHandler.attach === 'function') {
            dropHandler.attach();
        }
    }

    function requestClose(reason) {
        if (!overlay.classList.contains('visible')) { return; }
        handleSave();
    }

    function closeOverlay() {
        // Requires: close on Alt+Enter, Escape, Save, and click outside.
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
        if (elements.settings) {
            elements.settings.classList.remove('open');
        }
        setState({ taskRef: null, taskData: null, draft: '' });
        window.currentTaskIncludeContext = null;
        if (dropHandler && typeof dropHandler.detach === 'function') {
            dropHandler.detach();
        }
    }

    function handleSave() {
        // Requires: save task + re-render only affected task.
        const resolved = state.taskData || resolveTaskData(state.taskRef);
        if (!resolved || !resolved.task || !resolved.column) {
            closeOverlay();
            return;
        }
        syncDraftFromActiveAdapter();
        const { task, column } = resolved;
        const normalizedValue = normalizeDraft(state.draft);
        const currentValue = task.description || '';
        if (normalizedValue === currentValue && !task.includeMode) {
            closeOverlay();
            return;
        }
        setState({ draft: normalizedValue });
        task.description = normalizedValue;
        if (typeof window.renderSingleTask === 'function') {
            window.renderSingleTask(task.id, task, column.id);
        } else if (typeof window.renderSingleColumn === 'function') {
            window.renderSingleColumn(column.id, column);
        } else if (typeof window.renderBoard === 'function') {
            window.renderBoard();
        }
        if (typeof window.applyStackedColumnStyles === 'function') {
            requestAnimationFrame(() => {
                window.applyStackedColumnStyles(column.id);
            });
        }
        if (window.vscode?.postMessage) {
            window.vscode.postMessage({
                type: 'editTask',
                taskId: task.id,
                columnId: column.id,
                taskData: task
            });
        }
        closeOverlay();
    }

    function applySettings(settings = {}) {
        const nextState = {};
        if (typeof settings.enabled === 'boolean') {
            nextState.enabled = settings.enabled;
        }
        if (typeof settings.mode === 'string') {
            nextState.mode = settings.mode;
        }
        if (Number.isFinite(settings.fontScale)) {
            nextState.fontScale = settings.fontScale;
        }
        if (Object.keys(nextState).length > 0) {
            setState(nextState, { renderPreview: true, immediatePreview: true });
        }
    }

    function loadSettingsFromConfig() {
        const config = window.cachedConfig || {};
        const resolvedMode = typeof config.overlayEditorDefaultMode === 'string'
            ? config.overlayEditorDefaultMode
            : (window.configManager?.getConfig?.(configKeys.defaultMode, state.mode) ?? state.mode);
        const resolvedFontScale = Number.isFinite(config.overlayEditorFontScale)
            ? config.overlayEditorFontScale
            : (window.configManager?.getConfig?.(configKeys.fontScale, state.fontScale) ?? state.fontScale);
        const resolvedEnabled = typeof config.overlayEditorEnabled === 'boolean'
            ? config.overlayEditorEnabled
            : (window.configManager?.getConfig?.(configKeys.enabled, state.enabled) ?? state.enabled);
        applySettings({
            enabled: resolvedEnabled,
            mode: resolvedMode,
            fontScale: resolvedFontScale
        });
    }

    function toggleSettingsMenu(forceOpen) {
        if (!elements.settings) { return; }
        if (typeof forceOpen === 'boolean') {
            elements.settings.classList.toggle('open', forceOpen);
            return;
        }
        elements.settings.classList.toggle('open');
    }

    function attachHandlers() {
        // Requires: save + mode switch handlers.
        document.addEventListener('keydown', (event) => {
            if (!overlay.classList.contains('visible')) { return; }
            if (handleEditorShortcut(event)) {
                return;
            }
            if (event.key === 'Escape') {
                requestClose('escape');
                return;
            }
            if (event.key === 'Enter' && event.altKey) {
                requestClose('save');
            }
        }, true);

        overlay.addEventListener('click', (event) => {
            const toolButton = event.target.closest('.task-overlay-tool');
            if (toolButton && overlay.contains(toolButton)) {
                const command = toolButton.dataset.command;
                if (command) {
                    commandRegistry.execute(command, { adapter: activeAdapter });
                }
                return;
            }

            const button = event.target.closest('.task-overlay-btn');
            if (!button || !overlay.contains(button)) { return; }
            const action = button.dataset.action;
            const fontScale = Number.parseFloat(button.dataset.fontScale);
            if (Number.isFinite(fontScale)) {
                applyFontScale(fontScale, { persist: true });
                toggleSettingsMenu(false);
                return;
            }
            if (action === 'save') {
                requestClose('save');
                return;
            }
            if (action === 'settings') {
                toggleSettingsMenu();
                return;
            }
            if (action === 'mode-markdown') {
                setMode('markdown', { persist: true });
                return;
            }
            if (action === 'mode-dual') {
                setMode('dual', { persist: true });
                return;
            }
            if (action === 'mode-wysiwyg') {
                setMode('wysiwyg', { persist: true });
            }
        });

        overlay.addEventListener('change', (event) => {
            const select = event.target.closest('.task-overlay-tool-select');
            if (!select || !overlay.contains(select)) { return; }
            const command = select.value;
            if (command) {
                commandRegistry.execute(command, { adapter: activeAdapter });
                select.value = '';
            }
        });

        if (elements.backdrop) {
            elements.backdrop.addEventListener('click', () => requestClose('backdrop'));
        }

        window.addEventListener('resize', () => updateWysiwygHeight());
    }

    function handleEditorShortcut(event) {
        if (!event) {
            return false;
        }
        const hasModifier = event.altKey || event.metaKey || event.ctrlKey;
        if (!hasModifier) {
            return false;
        }
        const hasCode = typeof event.code === 'string' && event.code.length > 0;
        const isShortcutKey = hasCode && (
            event.code.match(/^Key[A-Z]$/) ||
            event.code.match(/^Digit[0-9]$/)
        );
        const isFallbackKey = !isShortcutKey && typeof event.key === 'string' &&
            event.key.length === 1 && /^[a-z0-9]$/i.test(event.key);
        if (!isShortcutKey && !isFallbackKey) {
            return false;
        }

        const modifiers = [];
        if (event.ctrlKey) modifiers.push('ctrl');
        if (event.metaKey) modifiers.push('meta');
        if (event.altKey) modifiers.push('alt');
        if (event.shiftKey) modifiers.push('shift');

        let keyChar = event.key;
        if (event.code && event.code.match(/^Key[A-Z]$/)) {
            keyChar = event.code.replace('Key', '').toLowerCase();
        } else if (event.code && event.code.match(/^Digit[0-9]$/)) {
            keyChar = event.code.replace('Digit', '');
        } else if (typeof keyChar === 'string') {
            keyChar = keyChar.toLowerCase();
        }

        const shortcut = modifiers.length > 0 ? `${modifiers.join('+')}+${keyChar}` : keyChar;
        const cachedShortcuts = window.cachedShortcuts || {};
        const entry = cachedShortcuts[shortcut];
        if (!entry) {
            if (!window._shortcutRequestPending && window.vscode?.postMessage) {
                window._shortcutRequestPending = true;
                window.vscode.postMessage({ type: 'requestShortcuts' });
                setTimeout(() => { window._shortcutRequestPending = false; }, 1000);
            }
            return false;
        }

        const commandInfo = typeof entry === 'string' ? { command: entry } : entry;
        if (!commandInfo || !commandInfo.command) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const activeElement = document.activeElement;
        const selectionStart = activeElement?.selectionStart ?? 0;
        const selectionEnd = activeElement?.selectionEnd ?? selectionStart;
        const selectedText = activeElement?.value?.substring(selectionStart, selectionEnd) || '';
        const fullText = typeof activeAdapter?.getValue === 'function' ? activeAdapter.getValue() : '';

        if (window.vscode?.postMessage) {
            window.vscode.postMessage({
                type: 'handleEditorShortcut',
                shortcut: shortcut,
                command: commandInfo.command,
                args: commandInfo.args,
                key: event.key,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                cursorPosition: selectionStart,
                selectionStart: selectionStart,
                selectionEnd: selectionEnd,
                selectedText: selectedText,
                fullText: fullText,
                fieldType: 'task-description',
                taskId: state.taskRef?.taskId,
                columnId: state.taskRef?.columnId
            });
        }

        return true;
    }

    loadSettingsFromConfig();
    attachHandlers();

    // Expose minimal API for integration (task burger menu + global toggle).
    window.taskOverlayEditor = {
        open: openOverlay,
        close: closeOverlay,
        setMode,
        applySettings,
        registry: commandRegistry,
        replaceSelection,
        insertText: (text) => {
            if (activeAdapter && typeof activeAdapter.insertText === 'function') {
                activeAdapter.insertText(text);
                if (typeof activeAdapter.focus === 'function') {
                    activeAdapter.focus();
                }
            }
        },
        isVisible: () => overlay.classList.contains('visible')
    };
})();
