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
            this.onChange = options.onChange;
            this.onSubmit = options.onSubmit;
            this.temporalPrefix = options.temporalPrefix || (window.TAG_PREFIXES?.TEMPORAL || '!');
        }

        activate() {
            if (!this.container || typeof window.WysiwygEditor !== 'function') { return; }
            window.currentTaskIncludeContext = state.taskRef?.includeContext || null;
            if (!this.editor) {
                this.container.innerHTML = '';
                this.editor = new window.WysiwygEditor(this.container, {
                    markdown: state.draft || '',
                    temporalPrefix: this.temporalPrefix,
                    onChange: (markdown) => {
                        state.draft = markdown;
                        if (typeof this.onChange === 'function') {
                            this.onChange(markdown);
                        }
                    },
                    onSubmit: () => {
                        if (typeof this.onSubmit === 'function') {
                            this.onSubmit();
                        }
                    }
                });
            } else if (typeof this.editor.setMarkdown === 'function') {
                this.editor.setMarkdown(state.draft || '');
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
            return state.draft || '';
        }

        setValue(value) {
            state.draft = value || '';
            if (this.editor && typeof this.editor.setMarkdown === 'function') {
                this.editor.setMarkdown(state.draft);
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
    const adapters = {
        markdown: new MarkdownAdapter(elements.textarea, elements.previewWrap, () => {
            const value = elements.textarea ? elements.textarea.value : '';
            setState({ draft: value }, { renderPreview: true });
        }),
        wysiwyg: new WysiwygAdapter(elements.wysiwygWrap, {
            onChange: (markdown) => {
                setState({ draft: markdown });
            },
            onSubmit: () => handleSave()
        })
    };
    const dropHandler = new DropHandler(elements.panel, () => activeAdapter);
    let activeAdapter = getAdapterForMode(state.mode);
    let keydownHandler = null;
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
            shouldUpdatePreview = true;
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
            if (persistFontScale) {
                persistPreference(configKeys.fontScale, nextScale);
            }
        }
        if (shouldUpdatePreview) {
            updatePreview({ immediate: immediatePreview });
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
        setState(
            { mode },
            {
                persistMode: options.persist === true,
                renderPreview: true,
                immediatePreview: true
            }
        );
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
        if (activeAdapter && typeof activeAdapter.setValue === 'function') {
            activeAdapter.setValue(nextDraft);
        }
        if (activeAdapter && typeof activeAdapter.focus === 'function') {
            activeAdapter.focus();
        }
        if (dropHandler && typeof dropHandler.attach === 'function') {
            dropHandler.attach();
        }
        if (!keydownHandler) {
            keydownHandler = (event) => {
                if (event.key === 'Escape') {
                    closeOverlay();
                    return;
                }
                if (event.key === 'Enter' && event.altKey) {
                    handleSave();
                }
            };
            document.addEventListener('keydown', keydownHandler);
        }
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
        if (keydownHandler) {
            document.removeEventListener('keydown', keydownHandler);
            keydownHandler = null;
        }
    }

    function handleSave() {
        // Requires: save task + re-render only affected task.
        const resolved = state.taskData || resolveTaskData(state.taskRef);
        if (!resolved || !resolved.task || !resolved.column) {
            closeOverlay();
            return;
        }
        const { task, column } = resolved;
        const nextValue = activeAdapter && typeof activeAdapter.getValue === 'function'
            ? activeAdapter.getValue()
            : state.draft;
        const normalizedValue = typeof nextValue === 'string' ? nextValue : '';
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
                handleSave();
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
            elements.backdrop.addEventListener('click', closeOverlay);
        }
    }

    loadSettingsFromConfig();
    attachHandlers();

    // Expose minimal API for integration (task burger menu + global toggle).
    window.taskOverlayEditor = {
        open: openOverlay,
        close: closeOverlay,
        setMode,
        applySettings,
        registry: commandRegistry
    };
})();
