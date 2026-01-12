// Overlay editor scaffold for task editing.
// This file defines the high-level structure and integration points.

(function initOverlayEditor() {
    const overlay = document.getElementById('task-overlay-editor');
    if (!overlay) { return; }

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
        buttons: overlay.querySelectorAll('.task-overlay-btn')
    };

    function openOverlay(taskRef) {
        // Requires: block board-level drag/drop and focus traps while open.
        state.taskRef = taskRef;
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
    }

    function closeOverlay() {
        // Requires: close on Alt+Enter, Escape, Save, and click outside.
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
        state.taskRef = null;
    }

    function setMode(mode) {
        // Requires: mode switching for markdown, dual, and wysiwyg.
        state.mode = mode;
        overlay.dataset.mode = mode;
    }

    function attachHandlers() {
        // Requires: save, close, and mode switch handlers.
        elements.buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'close') { closeOverlay(); }
                if (action === 'save') {
                    // Requires: save task + re-render only affected task.
                    closeOverlay();
                }
            });
        });

        if (elements.backdrop) {
            elements.backdrop.addEventListener('click', closeOverlay);
        }
    }

    attachHandlers();

    // Expose minimal API for integration (task burger menu + global toggle).
    window.taskOverlayEditor = {
        open: openOverlay,
        close: closeOverlay,
        setMode
    };
})();
