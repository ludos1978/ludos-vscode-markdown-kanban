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
        taskRef: null // { taskId, columnId, includeContext }
    };

    const elements = {
        backdrop: overlay.querySelector('.task-overlay-backdrop'),
        panel: overlay.querySelector('.task-overlay-panel'),
        header: overlay.querySelector('.task-overlay-header'),
        tools: overlay.querySelector('.task-overlay-tools'),
        markdownWrap: overlay.querySelector('.task-overlay-markdown'),
        previewWrap: overlay.querySelector('.task-overlay-preview'),
        wysiwygWrap: overlay.querySelector('.task-overlay-wysiwyg'),
        textarea: overlay.querySelector('.task-overlay-textarea'),
        settings: overlay.querySelector('.task-overlay-settings'),
        settingsMenu: overlay.querySelector('.task-overlay-settings-menu'),
        buttons: overlay.querySelectorAll('.task-overlay-btn'),
        fontScaleButtons: overlay.querySelectorAll('[data-font-scale]')
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
        constructor(textarea, preview) {
            this.textarea = textarea;
            this.preview = preview;
        }

        activate() {}
        deactivate() {}

        getValue() {
            return this.textarea ? this.textarea.value : '';
        }

        setValue(value) {
            if (this.textarea) {
                this.textarea.value = value || '';
            }
        }

        insertText(text) {
            if (!this.textarea) { return; }
            const { selectionStart = 0, selectionEnd = 0, value = '' } = this.textarea;
            const before = value.slice(0, selectionStart);
            const after = value.slice(selectionEnd);
            this.textarea.value = `${before}${text}${after}`;
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
        constructor(container) {
            this.container = container;
        }

        activate() {}
        deactivate() {}
        getValue() { return ''; }
        setValue() {}
        insertText() {}
        setFontScale() {}
        focus() {}
    }

    class DropHandler {
        // Requires: convert external file drops into markdown link/image insertions.
        constructor(target, adapters) {
            this.target = target;
            this.adapters = adapters;
        }

        attach() {}
        detach() {}
    }

    const commandRegistry = new CommandRegistry();
    const adapters = {
        markdown: new MarkdownAdapter(elements.textarea, elements.previewWrap),
        wysiwyg: new WysiwygAdapter(elements.wysiwygWrap)
    };
    const dropHandler = new DropHandler(elements.panel, adapters);
    let activeAdapter = adapters.markdown;
    let keydownHandler = null;

    function persistPreference(key, value) {
        if (window.configManager) {
            window.configManager.setPreference(key, value);
        } else if (window.vscode?.postMessage) {
            window.vscode.postMessage({ type: 'setPreference', key, value });
        }
        if (window.cachedConfig) {
            window.cachedConfig[key] = value;
        }
    }

    function applyFontScale(scale, options = {}) {
        const { persist = false } = options;
        const nextScale = Number.isFinite(scale) ? scale : state.fontScale;
        state.fontScale = nextScale;
        overlay.style.setProperty('--task-overlay-font-scale', `${nextScale}`);
        if (activeAdapter && typeof activeAdapter.setFontScale === 'function') {
            activeAdapter.setFontScale(nextScale);
        }
        if (persist) {
            persistPreference(configKeys.fontScale, nextScale);
        }
    }

    function setActiveAdapter(mode) {
        if (activeAdapter && typeof activeAdapter.deactivate === 'function') {
            activeAdapter.deactivate();
        }
        activeAdapter = mode === 'wysiwyg' ? adapters.wysiwyg : adapters.markdown;
        if (activeAdapter && typeof activeAdapter.activate === 'function') {
            activeAdapter.activate();
        }
    }

    function openOverlay(taskRef) {
        // Requires: block board-level drag/drop and focus traps while open.
        state.taskRef = taskRef;
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
        setMode(state.mode);
        applyFontScale(state.fontScale);
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
        state.taskRef = null;
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
        closeOverlay();
    }

    function setMode(mode, options = {}) {
        // Requires: mode switching for markdown, dual, and wysiwyg.
        const { persist = false } = options;
        if (!supportedModes.has(mode)) { return; }
        state.mode = mode;
        overlay.dataset.mode = mode;
        setActiveAdapter(mode);
        if (persist) {
            persistPreference(configKeys.defaultMode, mode);
        }
    }

    function applySettings(settings = {}) {
        if (typeof settings.enabled === 'boolean') {
            state.enabled = settings.enabled;
        }
        if (typeof settings.mode === 'string') {
            setMode(settings.mode);
        }
        if (Number.isFinite(settings.fontScale)) {
            applyFontScale(settings.fontScale);
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
        elements.buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const fontScale = Number.parseFloat(btn.dataset.fontScale);
                if (Number.isFinite(fontScale)) {
                    applyFontScale(fontScale, { persist: true });
                    toggleSettingsMenu(false);
                    return;
                }
                if (action === 'save') {
                    handleSave();
                }
                if (action === 'settings') {
                    toggleSettingsMenu();
                }
                if (action === 'mode-markdown') {
                    setMode('markdown', { persist: true });
                }
                if (action === 'mode-dual') {
                    setMode('dual', { persist: true });
                }
                if (action === 'mode-wysiwyg') {
                    setMode('wysiwyg', { persist: true });
                }
            });
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
