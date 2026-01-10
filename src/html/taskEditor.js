/**
 * TaskEditor Class - Manages inline editing of titles and descriptions
 * Purpose: Provides in-place editing functionality for all text fields
 * Used by: Column titles, task titles, task descriptions
 * Features: Tab transitions, auto-resize, save/cancel with keyboard
 */
const MARKDOWN_STYLE_PAIRS = {
    '*': { start: '*', end: '*' },
    "-": { start: "-", end: "-" },
    '_': { start: '_', end: '_' },
    '~': { start: '~', end: '~' },
    '^': { start: '^', end: '^' },
    '`': { start: '`', end: '`' },
    '"': { start: '"', end: '"' },
    "'": { start: "'", end: "'" },
    '[': { start: '[', end: ']' },
    '(': { start: '(', end: ')' },
    '{': { start: '{', end: '}' },
    '<': { start: '<', end: '>' },
};
//    ')': { start: '(', end: ')' },
//    ']': { start: '[', end: ']' },
//    '}': { start: '{', end: '}' }

// Dead key codes that produce tilde (~) across various keyboard layouts
const TILDE_DEAD_CODES = new Set([
    'IntlBackslash',  // Many international layouts
    'Backquote',      // US International, UK
    'Quote',          // Some layouts
    'IntlRo',         // Japanese/Brazilian
    'KeyN',           // macOS Option+N
    'BracketRight',   // Spanish, Portuguese
    'Digit4',         // French AZERTY (AltGr+4)
]);

// Dead key codes that produce circumflex (^) across various keyboard layouts
const CIRCUMFLEX_DEAD_CODES = new Set([
    'KeyI',           // macOS Option+I
    'Digit6',         // US International (Shift+6)
    'BracketLeft',    // German, some international
    'IntlBackslash',  // Some layouts
    'Equal',          // Swiss/German (with Shift)
    'Digit9',         // French AZERTY
    'BracketRight',   // Some Nordic layouts
    'Backquote',      // Some layouts
]);

// Dead key codes that produce backtick (`) across various keyboard layouts
const BACKTICK_DEAD_CODES = new Set([
    'Equal',          // Swiss/German (without Shift)
    'Backquote',      // Some layouts
    'IntlBackslash',  // Some layouts
]);

// Codes where the same key can produce different style characters depending on keyboard layout/shift
// These need deferred detection via compositionupdate since we can't reliably predict the character
const AMBIGUOUS_DEAD_CODES = new Set([
    'Equal',          // Swiss/German keyboard: can produce ^ or ` depending on Shift/layout
    'Backquote',      // Can produce ` or ~ depending on layout
]);

// Dead key codes that produce apostrophe/acute (') across various keyboard layouts
const APOSTROPHE_DEAD_CODES = new Set([
    'Quote',          // US International, many layouts
    'KeyE',           // macOS Option+E (acute accent)
    'BracketLeft',    // Some layouts
    'Equal',          // Some layouts
    'Minus',          // Some Nordic layouts
]);

function getMarkdownStyleKey(event) {
    if (!event) { return null; }
    const key = event.key;
    if (key && MARKDOWN_STYLE_PAIRS[key]) {
        return key;
    }
    if (key === 'Dead' && event.code) {
        // For ambiguous codes, return special marker - actual character will be detected via compositionupdate
        if (AMBIGUOUS_DEAD_CODES.has(event.code)) {
            return 'AMBIGUOUS_DEAD';
        }
        if (TILDE_DEAD_CODES.has(event.code)) {
            return '~';
        }
        if (CIRCUMFLEX_DEAD_CODES.has(event.code)) {
            return '^';
        }
        if (BACKTICK_DEAD_CODES.has(event.code)) {
            return '`';
        }
        if (APOSTROPHE_DEAD_CODES.has(event.code)) {
            return "'";
        }
    }
    return null;
}

class TaskEditor {
    constructor() {
        this.currentEditor = null;
        this.isTransitioning = false;
        this.keystrokeTimeout = null;
        this.lastEditContext = null; // Track what was last being edited
        this.indentUnit = '  ';
        this._stackLayoutNeedsFullRecalc = false;
        this._stackLayoutPendingColumns = new Set();
        this._wysiwygRecalcTimeout = null;
        this.setupGlobalHandlers();
    }

    /**
     * Get current editing state and content for saving
     * Purpose: Allow saving board while editing is in progress
     * Returns: Object with edit details or null if nothing is being edited
     */
    getCurrentEditState() {
        if (!this.currentEditor) {
            return null;
        }

        const value = this.currentEditor.wysiwyg
            ? this.currentEditor.wysiwyg.getMarkdown()
            : (this.currentEditor.element.value || this.currentEditor.element.textContent);

        return {
            type: this.currentEditor.type,
            taskId: this.currentEditor.taskId,
            columnId: this.currentEditor.columnId,
            value: value,
            originalValue: this.currentEditor.originalValue
        };
    }

    /**
     * Apply current edit state to board before saving
     * Purpose: Include in-progress edits when saving board
     */
    applyCurrentEditToBoard(board) {
        const editState = this.getCurrentEditState();
        if (!editState) {
            return board; // No changes needed
        }

        // Make a deep copy to avoid modifying the original
        const boardCopy = JSON.parse(JSON.stringify(board));

        if (editState.type === 'task-title' || editState.type === 'task-description') {
            const column = boardCopy.columns.find(c => c.id === editState.columnId);
            if (column) {
                const task = column.tasks.find(t => t.id === editState.taskId);
                if (task) {
                    if (editState.type === 'task-title') {
                        task.title = editState.value;
                    } else if (editState.type === 'task-description') {
                        task.description = editState.value;
                    }
                }
            }
        } else if (editState.type === 'column-title') {
            const column = boardCopy.columns.find(c => c.id === editState.columnId);
            if (column) {
                column.title = editState.value;
            }
        }

        return boardCopy;
    }

    /**
     * Update editor after save to maintain consistency
     * Purpose: Keep editor in sync when content is saved while editing
     */
    handlePostSaveUpdate() {
        if (!this.currentEditor) {
            return;
        }

        // Update the original value to match what was just saved
        // This prevents the editor from thinking there are still changes
        const currentValue = this.currentEditor.wysiwyg
            ? this.currentEditor.wysiwyg.getMarkdown()
            : (this.currentEditor.element.value || this.currentEditor.element.textContent);
        this.currentEditor.originalValue = currentValue;

    }

    /**
     * Sets up global keyboard and mouse event handlers
     * Purpose: Handle editing interactions across the entire document
     * Used by: Constructor on initialization
     * Handles: Tab, Enter, Escape keys, click outside to save
     */
    setupGlobalHandlers() {

        // Global paste handler for title fields - strip newlines
        const self = this;
        document.addEventListener('paste', (e) => {
            const target = e.target;
            const isTitleField = target && (target.classList.contains('task-title-edit') ||
                target.classList.contains('column-title-edit'));

            // Normal paste for title fields only: strip newlines but preserve spaces
            if (isTitleField) {
                e.preventDefault();
                let text = (e.clipboardData || window.clipboardData).getData('text');
                const cleanText = text.replace(/[\r\n]+/g, ' ').trim();

                // Insert at cursor position
                const start = target.selectionStart;
                const end = target.selectionEnd;
                const currentValue = target.value;
                target.value = currentValue.substring(0, start) + cleanText + currentValue.substring(end);

                // Set cursor position after inserted text
                const newPosition = start + cleanText.length;
                target.selectionStart = target.selectionEnd = newPosition;

                // Auto-resize textarea if it's a textarea
                if (target.tagName === 'TEXTAREA' && self.autoResize) {
                    self.autoResize(target);
                }
            }
        });

        // Detect Shift+Cmd+V / Shift+Ctrl+V for smart paste (URL encoding + image handling)
        document.addEventListener('keydown', async (e) => {
            const target = e.target;
            const isTitleField = target && (target.classList.contains('task-title-edit') ||
                target.classList.contains('column-title-edit'));
            const isDescriptionField = target && target.classList.contains('task-description-edit');

            // Shift+Cmd+V (Mac) or Shift+Ctrl+V (Windows) - URL encoding paste + image handling
            if ((isTitleField || isDescriptionField) &&
                e.shiftKey && (e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
                e.preventDefault(); // Prevent default paste

                try {
                    // First check if clipboard has an image
                    let clipboardItems;
                    try {
                        clipboardItems = await navigator.clipboard.read();
                    } catch (readError) {
                        clipboardItems = null;
                    }

                    // Check for image in clipboard
                    if (clipboardItems) {
                        for (const item of clipboardItems) {
                            for (const type of item.types) {
                                if (type.startsWith('image/')) {

                                    // Get the image blob
                                    const blob = await item.getType(type);

                                    // Convert blob to base64
                                    const reader = new FileReader();
                                    const base64Promise = new Promise((resolve, reject) => {
                                        reader.onloadend = () => resolve(reader.result);
                                        reader.onerror = reject;
                                        reader.readAsDataURL(blob);
                                    });

                                    const base64Data = await base64Promise;

                                    // Calculate MD5 hash for unique filename
                                    let md5Hash = '';
                                    if (typeof md5 === 'function') {
                                        md5Hash = md5(base64Data);
                                    } else {
                                        md5Hash = Date.now().toString();
                                    }

                                    // Create image data object
                                    const imageData = {
                                        type: 'base64',
                                        imageType: type,
                                        data: base64Data,
                                        md5Hash: md5Hash
                                    };

                                    // Store cursor position for later
                                    const cursorPos = target.selectionStart;

                                    // Set up one-time handler for image save response
                                    const imageHandler = (event) => {
                                        if (event.data.type === 'imagePastedIntoField' && event.data.cursorPosition === cursorPos) {
                                            window.removeEventListener('message', imageHandler);

                                            if (event.data.success) {
                                                // Insert the image markdown at cursor position (URL-encode path)
                                                const safePath = (typeof escapeFilePath === 'function')
                                                    ? escapeFilePath(event.data.relativePath)
                                                    : event.data.relativePath;
                                                const imageMarkdown = `![](${safePath})`;
                                                const start = target.selectionStart;
                                                const end = target.selectionEnd;
                                                const currentValue = target.value;
                                                target.value = currentValue.substring(0, start) + imageMarkdown + currentValue.substring(end);

                                                // Set cursor position after inserted markdown
                                                const newPosition = start + imageMarkdown.length;
                                                target.selectionStart = target.selectionEnd = newPosition;

                                                // Auto-resize textarea
                                                if (target.tagName === 'TEXTAREA' && self.autoResize) {
                                                    self.autoResize(target);
                                                }

                                            } else {
                                                console.error('[Kanban Paste] Failed to save image');
                                            }
                                        }
                                    };

                                    window.addEventListener('message', imageHandler);

                                    // Send to backend to save the image
                                    vscode.postMessage({
                                        type: 'pasteImageIntoField',
                                        imageData: imageData.data,
                                        imageType: type,
                                        md5Hash: md5Hash,
                                        cursorPosition: cursorPos
                                    });

                                    return; // Exit early - image found and handled
                                }
                            }
                        }
                    }

                    // No image found, process as text
                    const text = await navigator.clipboard.readText();

                    // Use existing processClipboardText function to convert URLs and file paths
                    let cleanText;
                    if (typeof processClipboardText === 'function') {
                        try {
                            const processed = await processClipboardText(text);
                            cleanText = processed ? processed.content : text;
                        } catch (error) {
                            console.error('[Kanban Paste] Error processing:', error);
                            cleanText = text;
                        }
                    } else {
                        cleanText = text;
                    }

                    // For title fields, strip newlines
                    if (isTitleField) {
                        cleanText = cleanText.replace(/[\r\n]+/g, ' ').trim();
                    }

                    // Insert at cursor position
                    const start = target.selectionStart;
                    const end = target.selectionEnd;
                    const currentValue = target.value;
                    target.value = currentValue.substring(0, start) + cleanText + currentValue.substring(end);

                    // Set cursor position after inserted text
                    const newPosition = start + cleanText.length;
                    target.selectionStart = target.selectionEnd = newPosition;

                    // Auto-resize textarea if it's a textarea
                    if (target.tagName === 'TEXTAREA' && self.autoResize) {
                        self.autoResize(target);
                    }
                } catch (error) {
                    console.error('[Kanban Paste] Failed to read clipboard:', error);
                }
            }
        }, true); // Use capture phase to catch before other handlers

        // Single global keydown handler
        // IMPORTANT: Use capture phase (true) to intercept events BEFORE VSCode handlers
        document.addEventListener('keydown', (e) => {
            if (!this.currentEditor) {return;}

            const element = this.currentEditor.element;

            // Debug: Log ALL keypresses with modifiers to diagnose Option key issue
            if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) {
            }

            // Check if this is a potential VS Code shortcut (any modifier + key)
            // Forward ALL modifier combinations to VS Code so extensions can handle them
            const hasModifier = e.altKey || e.metaKey || e.ctrlKey;
            const isVSCodeShortcut = hasModifier && (
                // Letter keys with modifiers
                (e.code && e.code.match(/^Key[A-Z]$/)) ||
                // Number keys with modifiers
                (e.code && e.code.match(/^Digit[0-9]$/))
            );

            // Check if this is a known VS Code shortcut
            // Only handle shortcuts that have commands bound - let all others pass through normally
            if (isVSCodeShortcut) {
                // Build modifier string
                const modifiers = [];
                if (e.ctrlKey) modifiers.push('ctrl');
                if (e.metaKey) modifiers.push('meta');
                if (e.altKey) modifiers.push('alt');
                if (e.shiftKey) modifiers.push('shift');

                // Extract the actual key letter from e.code (e.g., "KeyT" -> "t")
                let keyChar = e.key;
                if (e.code && e.code.match(/^Key[A-Z]$/)) {
                    keyChar = e.code.replace('Key', '').toLowerCase();
                } else if (e.code && e.code.match(/^Digit[0-9]$/)) {
                    keyChar = e.code.replace('Digit', '');
                }

                const shortcut = modifiers.length > 0 ? `${modifiers.join('+')}+${keyChar}` : keyChar;

                // Check if this shortcut has a command bound
                const cachedShortcuts = window.cachedShortcuts || {};
                const hasCommand = !!cachedShortcuts[shortcut];

                // Only process if we know this shortcut has a command
                if (hasCommand) {
                    // ⚠️ CRITICAL: Prevent VSCode from handling this shortcut!
                    // preventDefault() stops default browser behavior
                    // stopPropagation() prevents event from bubbling to VSCode handlers
                    // stopImmediatePropagation() stops other handlers on same element
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    // Get current cursor position and text for context
                    const cursorPos = element.selectionStart;
                    const selectionStart = element.selectionStart;
                    const selectionEnd = element.selectionEnd;
                    const selectedText = element.value.substring(selectionStart, selectionEnd);

                    // Send to VS Code to execute the command
                    if (typeof vscode !== 'undefined') {
                        vscode.postMessage({
                            type: 'handleEditorShortcut',
                            shortcut: shortcut,
                            command: cachedShortcuts[shortcut], // Send the command name so backend doesn't need to reload
                            key: e.key,
                            ctrlKey: e.ctrlKey,
                            metaKey: e.metaKey,
                            altKey: e.altKey,
                            shiftKey: e.shiftKey,
                            cursorPosition: cursorPos,
                            selectionStart: selectionStart,
                            selectionEnd: selectionEnd,
                            selectedText: selectedText,
                            fullText: element.value,
                            fieldType: this.currentEditor.type,
                            taskId: this.currentEditor.taskId,
                            columnId: this.currentEditor.columnId
                        });
                    }
                }
                // If no command is bound, do nothing - let the key behave normally
            }

            // Check for other system shortcuts that might cause focus loss
            const isSystemShortcut = (e.metaKey || e.ctrlKey) && (
                e.key === 'w' || e.key === 't' || e.key === 'n' || // Window/tab shortcuts
                e.key === 'r' || e.key === 'f' || e.key === 'p' || // Reload/find/print shortcuts
                e.key === 'l' || e.key === 'd' || e.key === 'h' || // Location/bookmark shortcuts
                e.key === '+' || e.key === '-' || e.key === '0' // Zoom shortcuts
            );

            // If it's a system shortcut, temporarily prevent auto-save on blur
            if (isSystemShortcut) {
                this.isTransitioning = true;
                const currentElement = element; // Store reference to current editor

                // Reset the flag and restore focus after the shortcut completes
                setTimeout(() => {
                    this.isTransitioning = false;

                    // Restore focus if we're still editing the same element
                    if (this.currentEditor && this.currentEditor.element === currentElement) {
                        currentElement.focus();
                    }
                }, 300);
                return; // Let the system handle the shortcut
            }

            if (this._handleMarkdownStyleInsertion(e, element)) {
                return;
            }

            if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) {
                    this._unindentSelection(element);
                } else {
                    this._indentSelection(element);
                }
            } else if (e.key === 'Enter' && e.altKey) {
                e.preventDefault();
                this.save();
            } else if (e.key === 'Enter' && !e.shiftKey) {
                if (element.classList.contains('task-title-edit') ||
                    element.classList.contains('column-title-edit')) {
                    e.preventDefault();
                    this.save();
                }
            } else if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter: End editing (save changes)
                if (element.classList.contains('task-title-edit') ||
                    element.classList.contains('column-title-edit')) {
                    e.preventDefault();
                    this.save();
                }
            } else if (e.key === 'Escape') {
                // Escape: End editing (save changes, don't cancel)
                e.preventDefault();
                this.save();
            }
        }, true); // ⚠️ CAPTURE PHASE: Intercept events BEFORE VSCode handlers run!

        // Add window focus handler to restore editor focus after system shortcuts
        window.addEventListener('focus', () => {
            // If we have an active editor and the document regains focus, restore editor focus
            if (this.currentEditor && this.currentEditor.element && document.hasFocus()) {
                // Small delay to ensure the window focus event has fully processed
                setTimeout(() => {
                    if (this.currentEditor && this.currentEditor.element) {
                        this.currentEditor.element.focus();
                    }
                }, 50);
            }
        });

        // Add document visibility change handler for tab switching
        document.addEventListener('visibilitychange', () => {
            // When the document becomes visible again (user returns to this tab)
            if (!document.hidden && this.currentEditor && this.currentEditor.element) {
                setTimeout(() => {
                    if (this.currentEditor && this.currentEditor.element) {
                        this.currentEditor.element.focus();
                    }
                }, 100);
            }
        });

        // Improved global click handler that doesn't interfere with text selection
        document.addEventListener('click', (e) => {
            // Don't close menus or interfere if we're clicking inside an editor
            if (this.currentEditor && this.currentEditor.element && 
                this.currentEditor.element.contains(e.target)) {
                return; // Allow normal text selection and editing behavior
            }
            
            // Only close menus if clicking outside both menu and editor
            // Also check if clicking inside moved dropdowns
            const inDonutMenu = e.target.closest('.donut-menu');
            const inMovedDropdown = e.target.closest('.donut-menu-dropdown.moved-to-body, .file-bar-menu-dropdown.moved-to-body');

            if (!inDonutMenu && !inMovedDropdown) {
                document.querySelectorAll('.donut-menu.active').forEach(menu => {
                    menu.classList.remove('active');
                });
            }
        });

        // Prevent interference with text selection during editing
        document.addEventListener('mousedown', (e) => {
            // If we're in editing mode and clicking within the editor, don't interfere
            if (this.currentEditor && this.currentEditor.element && 
                this.currentEditor.element.contains(e.target)) {
                return; // Allow normal text selection behavior
            }
        });

        document.addEventListener('mouseup', (e) => {
            // If we're in editing mode and within the editor, don't interfere
            if (this.currentEditor && this.currentEditor.element && 
                this.currentEditor.element.contains(e.target)) {
                return; // Allow normal text selection behavior
            }
        });
    }

    /**
     * Finds the position before the first tag in a title string
     * Purpose: Position cursor intelligently before tags when editing
     * @param {string} text - The title text to analyze
     * @returns {number} - The position to place the cursor (before first tag + 1 space)
     */
    findPositionBeforeFirstTag(text) {
        // Match any hashtag (including #row, #stack, #span, etc.)
        const tagMatch = text.match(/#\w+/);
        if (tagMatch && tagMatch.index !== undefined) {
            const tagPosition = tagMatch.index;
            // Position cursor before the space that precedes the tag
            // If there's a space before the tag, position before that space
            if (tagPosition > 0 && text[tagPosition - 1] === ' ') {
                return tagPosition - 1;
            }
            // If tag is at start or no space before it, position at the tag
            return tagPosition;
        }
        // No tags found, position at end
        return text.length;
    }

    // ============= startEdit HELPER METHODS =============

    /**
     * Get display, edit, and container elements based on edit type
     * @private
     */
    _getEditElements(element, type) {
        let displayElement, editElement, containerElement;

        if (type === 'task-title') {
            containerElement = element.closest('.task-item') || element;
            displayElement = containerElement.querySelector('.task-title-display');
            editElement = containerElement.querySelector('.task-title-edit');
        } else if (type === 'task-description') {
            containerElement = element.closest('.task-description-container') || element;
            displayElement = containerElement.querySelector('.task-description-display');
            editElement = containerElement.querySelector('.task-description-edit');
        } else if (type === 'column-title') {
            containerElement = element.closest('.kanban-full-height-column') || element;
            displayElement = containerElement.querySelector('.column-title-text');
            editElement = containerElement.querySelector('.column-title-edit');
        }

        return { displayElement, editElement, containerElement };
    }

    /**
     * Initialize column title value for editing (show full title with tags)
     * @private
     */
    _initializeColumnTitleValue(editElement, columnId) {
        const column = window.cachedBoard?.columns.find(col => col.id === columnId);
        if (column && column.title) {
            editElement.value = column.title;
            editElement.setAttribute('data-original-title', column.title);
        }
    }

    /**
     * Initialize task description value for editing (preserves leading newlines)
     * @private
     */
    _initializeTaskDescriptionValue(editElement, taskId, columnId) {
        const column = window.cachedBoard?.columns.find(col => col.id === columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (task) {
            editElement.value = task.description || '';
        }
    }

    // ============= INDENTATION HELPERS =============

    _getLineRange(value, selectionStart, selectionEnd) {
        const start = selectionStart ?? 0;
        const end = selectionEnd ?? start;
        const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const lineEndIndex = value.indexOf('\n', end);
        const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
        return { lineStart, lineEnd };
    }

    _handleMarkdownStyleInsertion(event, element) {
        if (!element || !event) {
            return false;
        }
        console.log('[STYLE-DEBUG] keydown:', { key: event.key, code: event.code, altKey: event.altKey });
        const styleKey = getMarkdownStyleKey(event);
        console.log('[STYLE-DEBUG] styleKey:', styleKey);
        if (!styleKey) {
            return false;
        }
        const selectionStart = element.selectionStart ?? 0;
        const selectionEnd = element.selectionEnd ?? selectionStart;
        if (selectionEnd <= selectionStart) {
            return false;
        }
        // For ambiguous dead keys, save selection and defer wrap until compositionupdate reveals the character
        if (styleKey === 'AMBIGUOUS_DEAD') {
            console.log('[STYLE-DEBUG] Ambiguous dead key - deferring wrap until compositionupdate');
            element._pendingAmbiguousWrap = {
                selectionStart,
                selectionEnd,
                value: element.value
            };
            // Don't prevent default - let composition proceed, we'll handle it in compositionupdate
            return false;
        }
        const style = MARKDOWN_STYLE_PAIRS[styleKey];
        if (!style) {
            return false;
        }
        const isDeadKey = event.key === 'Dead';
        console.log('[STYLE-DEBUG] Doing wrap, isDeadKey:', isDeadKey, 'value before:', element.value);
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const value = element.value;
        const before = value.slice(0, selectionStart);
        const selected = value.slice(selectionStart, selectionEnd);
        const after = value.slice(selectionEnd);
        element.value = before + style.start + selected + style.end + after;
        console.log('[STYLE-DEBUG] value after wrap:', element.value);
        const cursorStart = selectionStart + style.start.length;
        const cursorEnd = cursorStart + selected.length;
        if (isDeadKey) {
            // For dead keys, store expected state to restore after composition corrupts it
            const cursorPos = cursorEnd + style.end.length;
            element._expectedAfterDeadKey = {
                value: element.value,
                cursorPos: cursorPos
            };
            element.selectionStart = cursorPos;
            element.selectionEnd = cursorPos;
            console.log('[STYLE-DEBUG] Set _expectedAfterDeadKey, cursor at:', cursorPos);
        } else {
            element.selectionStart = cursorStart;
            element.selectionEnd = cursorEnd;
        }
        if (element.tagName === 'TEXTAREA' && this.autoResize) {
            this.autoResize(element);
        }
        if (typeof window.updateSpecialCharOverlay === 'function') {
            window.updateSpecialCharOverlay(element);
        }
        return true;
    }

    _indentSelection(element) {
        const value = element.value;
        const start = element.selectionStart ?? 0;
        const end = element.selectionEnd ?? start;

        if (start === end) {
            const insert = this.indentUnit;
            element.value = value.slice(0, start) + insert + value.slice(end);
            const cursor = start + insert.length;
            element.selectionStart = cursor;
            element.selectionEnd = cursor;
            if (element.tagName === 'TEXTAREA' && this.autoResize) {
                this.autoResize(element);
            }
            if (typeof window.updateSpecialCharOverlay === 'function') {
                window.updateSpecialCharOverlay(element);
            }
            return;
        }

        const { lineStart, lineEnd } = this._getLineRange(value, start, end);
        const selected = value.slice(lineStart, lineEnd);
        const lines = selected.split('\n');
        const indentedLines = lines.map(line => this.indentUnit + line);
        const replacement = indentedLines.join('\n');

        element.value = value.slice(0, lineStart) + replacement + value.slice(lineEnd);

        const newSelectionStart = start + this.indentUnit.length;
        const newSelectionEnd = end + (this.indentUnit.length * lines.length);
        element.selectionStart = newSelectionStart;
        element.selectionEnd = newSelectionEnd;
        if (element.tagName === 'TEXTAREA' && this.autoResize) {
            this.autoResize(element);
        }
        if (typeof window.updateSpecialCharOverlay === 'function') {
            window.updateSpecialCharOverlay(element);
        }
    }

    _unindentSelection(element) {
        const value = element.value;
        const start = element.selectionStart ?? 0;
        const end = element.selectionEnd ?? start;

        const { lineStart, lineEnd } = this._getLineRange(value, start, end);
        if (start === end && start > lineStart && start > 0) {
            const indentLen = this.indentUnit.length;
            const beforeCursorStart = Math.max(0, start - indentLen);
            const precedingSegment = value.slice(beforeCursorStart, start);
            const charBefore = value.charAt(start - 1);
            let removeCount = 0;
            if (charBefore === '\t') {
                removeCount = 1;
            } else if (precedingSegment.length === indentLen && [...precedingSegment].every(c => c === ' ')) {
                removeCount = indentLen;
            } else if (charBefore === ' ') {
                removeCount = 1;
            }

            if (removeCount > 0) {
                element.value = value.slice(0, start - removeCount) + value.slice(end);
                const newCursor = start - removeCount;
                element.selectionStart = newCursor;
                element.selectionEnd = newCursor;
                if (element.tagName === 'TEXTAREA' && this.autoResize) {
                    this.autoResize(element);
                }
                if (typeof window.updateSpecialCharOverlay === 'function') {
                    window.updateSpecialCharOverlay(element);
                }
                return;
            }
        }
        const selected = value.slice(lineStart, lineEnd);
        const lines = selected.split('\n');
        const removedCounts = [];
        const unindentedLines = lines.map(line => {
            let removed = 0;
            while (removed < this.indentUnit.length && line.charAt(removed) === ' ') {
                removed += 1;
            }
            removedCounts.push(removed);
            return line.slice(removed);
        });

        const replacement = unindentedLines.join('\n');
        element.value = value.slice(0, lineStart) + replacement + value.slice(lineEnd);

        const totalRemoved = removedCounts.reduce((sum, count) => sum + count, 0);
        const newSelectionStart = Math.max(lineStart, start - removedCounts[0]);
        const newSelectionEnd = Math.max(newSelectionStart, end - totalRemoved);
        element.selectionStart = newSelectionStart;
        element.selectionEnd = newSelectionEnd;
        if (element.tagName === 'TEXTAREA' && this.autoResize) {
            this.autoResize(element);
        }
        if (typeof window.updateSpecialCharOverlay === 'function') {
            window.updateSpecialCharOverlay(element);
        }
    }

    /**
     * Show edit element and hide display element
     * @private
     */
    _setupEditVisibility(displayElement, editElement, wysiwygContainer = null) {
        if (displayElement) { displayElement.style.display = 'none'; }
        if (wysiwygContainer) {
            editElement.style.display = 'none';
            wysiwygContainer.style.display = 'block';
        } else {
            editElement.style.display = 'block';
        }

        // Fix the ENTIRE VIEW height during editing to prevent scroll jumps
        // The kanban-board is the actual scroll container when multi-row is active
        const kanbanBoard = document.querySelector('.kanban-board');
        if (kanbanBoard && !kanbanBoard._editingMinHeight) {
            const currentHeight = kanbanBoard.scrollHeight;
            kanbanBoard.style.minHeight = currentHeight + 'px';
            kanbanBoard._editingMinHeight = currentHeight; // Store for later cleanup
        }

        if (!wysiwygContainer) {
            this.autoResize(editElement);
        }
    }

    /**
     * Recalculate stack layout after edit element is shown
     * @private
     */
    _recalculateStackLayout(containerElement) {
        const stack = containerElement.closest('.kanban-column-stack');
        if (!stack || stack.querySelectorAll('.kanban-full-height-column').length <= 1) { return; }

        const column = containerElement.closest('.kanban-full-height-column');
        const stackColumnId = column ? column.dataset.columnId : null;
        this._requestStackLayoutRecalc(stackColumnId);
    }

    /**
     * Position cursor in edit element
     * @private
     */
    _positionCursor(editElement, type, preserveCursor, wysiwygEditor = null) {
        if (wysiwygEditor) {
            wysiwygEditor.focus();
            return;
        }

        editElement.focus();

        if (!preserveCursor) {
            // Default behavior: move cursor to end
            editElement.setSelectionRange(editElement.value.length, editElement.value.length);
        } else if (type === 'task-title' || type === 'column-title') {
            // For title fields, position cursor before first tag
            const cursorPosition = this.findPositionBeforeFirstTag(editElement.value);
            editElement.setSelectionRange(cursorPosition, cursorPosition);
        }
        // For description fields with preserveCursor=true, don't move cursor
    }

    /**
     * Store current editor state
     * @private
     */
    _storeEditorState(editElement, displayElement, type, taskId, columnId, wysiwygContext = null) {
        this.currentEditor = {
            element: editElement,
            displayElement: displayElement,
            type: type,
            taskId: taskId || window.getTaskIdFromElement(editElement),
            columnId: columnId || window.getColumnIdFromElement(editElement),
            originalValue: editElement.value,
            wysiwyg: wysiwygContext?.editor || null,
            wysiwygContainer: wysiwygContext?.container || null
        };

        if (!wysiwygContext && typeof window.createSpecialCharOverlay === 'function') {
            window.createSpecialCharOverlay(editElement);
        }
    }

    /**
     * Notify backend that editing has started
     * @private
     */
    _notifyEditingStarted(type, taskId, columnId) {
        // Notify VS Code context for task editing
        if (type === 'task-title' || type === 'task-description') {
            if (typeof vscode !== 'undefined') {
                vscode.postMessage({
                    type: 'setContext',
                    key: 'kanbanTaskEditing',
                    value: true
                });
            }
        }

        // Tell backend editing has started to block board regenerations
        vscode.postMessage({
            type: 'editingStarted',
            editType: type,
            taskId: taskId,
            columnId: columnId
        });

        if (typeof window.setTaskEditorActive === 'function') {
            window.setTaskEditorActive(true);
        }
    }

    /**
     * Set up input handler with auto-resize and throttled stack recalculation
     * @private
     */
    _setupInputHandler(editElement, containerElement) {
        // GUARD: Prevent duplicate event handler attachment
        if (editElement._inputHandlerAttached) {
            if (window.kanbanDebug?.enabled) {
                console.log('[SETUP-DEBUG] Input handler already attached, skipping');
            }
            return;
        }
        editElement._inputHandlerAttached = true;

        let recalcTimeout = null;
        let lastRecalcTime = 0;
        const MIN_DELAY_BETWEEN_RECALC = 300;
        let autoResizePending = false;

        // DEBUG: Log how many edit elements exist
        if (window.kanbanDebug?.enabled) {
            const allEditElements = document.querySelectorAll('.task-description-edit');
            console.log('[SETUP-DEBUG] Setting up input handler', {
                editElementCount: allEditElements.length,
                elementId: editElement.closest('[data-task-id]')?.dataset?.taskId
            });
        }

        // DEBUG: Track ALL events on the edit element (only when debug mode active)
        editElement.addEventListener('keydown', (e) => {
            if (window.kanbanDebug?.enabled) {
                const container = document.getElementById('kanban-container');
                console.log('[KEYDOWN-DEBUG]', {
                    key: e.key,
                    code: e.code,
                    target: e.target.className,
                    activeElement: document.activeElement?.className,
                    scrollTop: container?.scrollTop,
                    isEditing: !!this.currentEditor
                });
            }
        });

        // DEBUG: Track keyup to see scroll state after key processing
        editElement.addEventListener('keyup', (e) => {
            if (window.kanbanDebug?.enabled) {
                const container = document.getElementById('kanban-container');
                console.log('[KEYUP-DEBUG]', {
                    key: e.key,
                    scrollTop: container?.scrollTop,
                    isEditing: !!this.currentEditor
                });
            }
        });

        editElement.addEventListener('focus', () => {
            if (window.kanbanDebug?.enabled) {
                console.log('[FOCUS-DEBUG] Edit element gained focus');
            }
        });

        editElement.addEventListener('blur', (e) => {
            if (window.kanbanDebug?.enabled) {
                console.log('[BLUR-DEBUG] Edit element LOST focus!', {
                    relatedTarget: e.relatedTarget?.className || 'null',
                    newActiveElement: document.activeElement?.className
                });
            }
        });

        editElement.addEventListener('compositionstart', (e) => {
            console.log('[STYLE-DEBUG] compositionstart:', { data: e.data, hasPending: !!editElement._pendingAmbiguousWrap, value: editElement.value });
        });
        editElement.addEventListener('compositionupdate', (e) => {
            console.log('[STYLE-DEBUG] compositionupdate:', { data: e.data, hasPending: !!editElement._pendingAmbiguousWrap, value: editElement.value });
            // Handle deferred wrap for ambiguous dead keys
            if (editElement._pendingAmbiguousWrap && e.data) {
                const char = e.data;
                const style = MARKDOWN_STYLE_PAIRS[char];
                if (style) {
                    console.log('[STYLE-DEBUG] Ambiguous dead key resolved to:', char);
                    const pending = editElement._pendingAmbiguousWrap;
                    editElement._pendingAmbiguousWrap = null;
                    // Cancel composition by making element readonly temporarily
                    editElement.readOnly = true;
                    setTimeout(() => {
                        editElement.readOnly = false;
                        // Restore original value and apply wrap
                        const before = pending.value.slice(0, pending.selectionStart);
                        const selected = pending.value.slice(pending.selectionStart, pending.selectionEnd);
                        const after = pending.value.slice(pending.selectionEnd);
                        editElement.value = before + style.start + selected + style.end + after;
                        const cursorPos = pending.selectionEnd + style.start.length + style.end.length;
                        editElement.selectionStart = cursorPos;
                        editElement.selectionEnd = cursorPos;
                        editElement.focus();
                        console.log('[STYLE-DEBUG] Ambiguous wrap applied:', { char, value: editElement.value });
                    }, 0);
                } else {
                    // Not a style character, clear pending
                    editElement._pendingAmbiguousWrap = null;
                }
            }
        });
        editElement.addEventListener('compositionend', (e) => {
            console.log('[STYLE-DEBUG] compositionend:', { data: e.data, value: editElement.value });
            // Clear pending if composition ended without wrap
            editElement._pendingAmbiguousWrap = null;
        });
        editElement.addEventListener('beforeinput', (e) => {
            console.log('[STYLE-DEBUG] beforeinput:', { data: e.data, inputType: e.inputType, hasExpected: !!editElement._expectedAfterDeadKey, value: editElement.value });
        });

        editElement.oninput = () => {
            console.log('[STYLE-DEBUG] oninput fired, value:', editElement.value, 'hasExpected:', !!editElement._expectedAfterDeadKey);
            // Restore value after dead key composition corrupted it
            if (editElement._expectedAfterDeadKey) {
                const expected = editElement._expectedAfterDeadKey;
                editElement._expectedAfterDeadKey = null;
                if (editElement.value !== expected.value) {
                    console.log('[STYLE-DEBUG] Restoring value after composition corruption');
                    editElement.value = expected.value;
                    editElement.selectionStart = expected.cursorPos;
                    editElement.selectionEnd = expected.cursorPos;
                    return; // Skip normal oninput processing
                }
            }
            if (window.kanbanDebug?.enabled) {
                const container = document.getElementById('kanban-container');
                console.log('[ONINPUT-DEBUG] Input event fired!', {
                    valueLength: editElement.value.length,
                    containerScrollTop: container?.scrollTop,
                    textareaScrollTop: editElement.scrollTop,
                    cursorPosition: editElement.selectionStart,
                    textareaHeight: editElement.offsetHeight
                });
            }
            const container = document.getElementById('kanban-container');

            // Throttle autoResize to max 60fps
            if (!autoResizePending) {
                autoResizePending = true;
                requestAnimationFrame(() => {
                    const scrollBeforeResize = container?.scrollTop || 0;
                    this.autoResize(editElement);
                    const scrollAfterResize = container?.scrollTop || 0;

                    if (scrollBeforeResize !== scrollAfterResize && window.kanbanDebug?.enabled) {
                        console.log('[INPUT-DEBUG] autoResize changed scroll:', {
                            before: scrollBeforeResize,
                            after: scrollAfterResize,
                            delta: scrollAfterResize - scrollBeforeResize
                        });
                    }
                    autoResizePending = false;
                });
            }

            if (typeof window.updateSpecialCharOverlay === 'function') {
                window.updateSpecialCharOverlay(editElement);
            }

            // Throttled stack layout recalculation
            if (typeof window.applyStackedColumnStyles !== 'function') { return; }

            const stack = containerElement.closest('.kanban-column-stack');
            if (!stack || stack.querySelectorAll('.kanban-full-height-column').length <= 1) { return; }

            const column = containerElement.closest('.kanban-full-height-column');
            const colId = column ? column.dataset.columnId : null;
            const now = Date.now();
            const timeSinceLastRecalc = now - lastRecalcTime;

            if (timeSinceLastRecalc >= MIN_DELAY_BETWEEN_RECALC) {
                if (recalcTimeout) { clearTimeout(recalcTimeout); recalcTimeout = null; }
                lastRecalcTime = now;
                this._requestStackLayoutRecalc(colId);
                if (typeof window.logViewMovement === 'function') {
                    window.logViewMovement('taskEditor.queueStackLayout.immediate', {
                        columnId: colId,
                        valueLength: editElement.value.length,
                        editorType: this.currentEditor?.type
                    });
                }
            } else {
                if (recalcTimeout) { clearTimeout(recalcTimeout); }
                const delay = MIN_DELAY_BETWEEN_RECALC - timeSinceLastRecalc;
                recalcTimeout = setTimeout(() => {
                    lastRecalcTime = Date.now();
                    this._requestStackLayoutRecalc(colId);
                    if (typeof window.logViewMovement === 'function') {
                        window.logViewMovement('taskEditor.queueStackLayout.delayed', {
                            columnId: colId,
                            delay,
                            valueLength: editElement.value.length,
                            editorType: this.currentEditor?.type
                        });
                    }
                    recalcTimeout = null;
                }, delay);
            }
        };
    }

    /**
     * Queue a stack layout recalculation until editing ends
     * @private
     */
    _requestStackLayoutRecalc(columnId = null, forceFull = false) {
        if (forceFull || columnId === null) {
            this._stackLayoutNeedsFullRecalc = true;
        } else if (!this._stackLayoutNeedsFullRecalc && columnId) {
            this._stackLayoutPendingColumns.add(columnId);
        }
    }

    /**
     * Flush any queued stack layout recalculations
     * @private
     */
    _flushStackLayoutRecalc() {
        if (!this._stackLayoutNeedsFullRecalc && this._stackLayoutPendingColumns.size === 0) {
            return;
        }

        if (typeof window.applyStackedColumnStyles !== 'function') {
            this._stackLayoutNeedsFullRecalc = false;
            this._stackLayoutPendingColumns.clear();
            return;
        }

        const pendingCount = this._stackLayoutPendingColumns.size;
        const columnId = this._stackLayoutNeedsFullRecalc || pendingCount !== 1
            ? null
            : Array.from(this._stackLayoutPendingColumns)[0];

        if (typeof window.logViewMovement === 'function') {
            window.logViewMovement('taskEditor.flushStackLayout', {
                columnId,
                pendingCount,
                needsFullRecalc: this._stackLayoutNeedsFullRecalc,
                editorType: this.currentEditor?.type
            });
        }

        window.applyStackedColumnStyles(columnId);
        this._stackLayoutNeedsFullRecalc = false;
        this._stackLayoutPendingColumns.clear();
    }

    /**
     * Set up blur handler to save on focus loss
     * @private
     */
    _setupBlurHandler(editElement) {
        editElement.onblur = () => {
            if (this.isTransitioning) { return; }

            setTimeout(() => {
                if (document.activeElement !== editElement &&
                    !this.isTransitioning &&
                    !document.hidden &&
                    document.hasFocus()) {

                    const activeElement = document.activeElement;
                    const isEditingElsewhere = activeElement && (
                        activeElement.classList.contains('task-title-edit') ||
                        activeElement.classList.contains('task-description-edit') ||
                        activeElement.classList.contains('column-title-edit')
                    );
                    if (!isEditingElsewhere) {
                        this.save();
                    }
                }
            }, 150);
        };
    }

    /**
     * Set up mouse event handlers to prevent propagation during editing
     * @private
     */
    _setupMouseHandlers(editElement) {
        editElement.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        editElement.addEventListener('dblclick', (e) => {
            e.stopPropagation();
        });
    }

    _shouldUseWysiwyg(type) {
        if (type !== 'task-description') {
            return false;
        }
        if (typeof window.WysiwygEditor !== 'function') {
            return false;
        }
        const configValue = window.configManager?.getConfig('wysiwygEnabled', true);
        return configValue !== false;
    }

    _setupWysiwygEditor(editElement, containerElement) {
        if (!containerElement || typeof window.WysiwygEditor !== 'function') {
            return null;
        }

        const descriptionContainer = editElement?.closest?.('.task-description-container') || containerElement;
        let wysiwygContainer = descriptionContainer.querySelector('.task-description-wysiwyg');
        if (!wysiwygContainer) {
            wysiwygContainer = document.createElement('div');
            wysiwygContainer.className = 'task-description-wysiwyg task-description-edit';
            wysiwygContainer.setAttribute('data-field', 'description');
            descriptionContainer.appendChild(wysiwygContainer);
        }

        wysiwygContainer.innerHTML = '';

        const temporalPrefix = window.TAG_PREFIXES?.TEMPORAL || '!';
        const editor = new window.WysiwygEditor(wysiwygContainer, {
            markdown: editElement.value || '',
            temporalPrefix,
            onChange: (markdown) => {
                editElement.value = markdown;
                this._handleWysiwygInput(containerElement);
            }
        });

        return { editor, container: wysiwygContainer };
    }

    _setupWysiwygHandlers(editor, wysiwygContainer, containerElement) {
        const dom = editor.getViewDom();

        dom.addEventListener('blur', () => {
            if (this.isTransitioning) { return; }

            setTimeout(() => {
                if (document.activeElement !== dom &&
                    !this.isTransitioning &&
                    !document.hidden &&
                    document.hasFocus()) {

                    const activeElement = document.activeElement;
                    const isEditingElsewhere = activeElement && (
                        activeElement.classList.contains('task-title-edit') ||
                        activeElement.classList.contains('task-description-edit') ||
                        activeElement.classList.contains('column-title-edit') ||
                        (activeElement.closest && activeElement.closest('.task-description-wysiwyg'))
                    );
                    if (!isEditingElsewhere) {
                        this.save();
                    }
                }
            }, 150);
        });

        this._setupMouseHandlers(dom);

        if (wysiwygContainer) {
            wysiwygContainer.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        this._handleWysiwygInput(containerElement);
    }

    _handleWysiwygInput(containerElement) {
        if (!containerElement) { return; }
        if (this._wysiwygRecalcTimeout) {
            clearTimeout(this._wysiwygRecalcTimeout);
        }

        this._wysiwygRecalcTimeout = setTimeout(() => {
            const column = containerElement.closest('.kanban-full-height-column');
            const columnId = column ? column.dataset.columnId : null;
            this._requestStackLayoutRecalc(columnId);
            this._flushStackLayoutRecalc();
            this._wysiwygRecalcTimeout = null;
        }, 150);
    }

    // ============= MAIN startEdit METHOD =============

    /**
     * Starts editing mode for an element
     * Purpose: Switch from display to edit mode
     * Used by: Click handlers on editable elements
     * @param {HTMLElement} element - Element to edit
     * @param {string} type - 'task-title', 'task-description', 'column-title'
     * @param {string} taskId - Task ID if editing task
     * @param {string} columnId - Column ID
     * @param {boolean} preserveCursor - Whether to preserve cursor position (default: false, moves to end)
     */
    startEdit(element, type, taskId = null, columnId = null, preserveCursor = false) {
        // If transitioning, don't interfere
        if (this.isTransitioning) { return; }

        const container = document.getElementById('kanban-container');
        const scrollAtStart = container?.scrollTop || 0;

        // DEBUG: Track scroll position through edit initialization
        if (window.kanbanDebug?.enabled) {
            console.log('[START-EDIT] Begin', { type, taskId, scrollTop: scrollAtStart });
        }

        // Get the appropriate elements based on type
        const { displayElement, editElement, containerElement } = this._getEditElements(element, type);
        if (!editElement) { return; }

        // Check if we're already editing this exact element
        const isAlreadyEditing = this.currentEditor &&
                                this.currentEditor.element === editElement &&
                                editElement.style.display !== 'none';
        if (isAlreadyEditing) { return; }

        // Save any current editor first (different element)
        if (this.currentEditor && !this.isTransitioning) {
            this.save();
        }

        // Initialize value based on type
        if (type === 'column-title' && columnId) {
            this._initializeColumnTitleValue(editElement, columnId);
        } else if (type === 'task-description' && taskId) {
            this._initializeTaskDescriptionValue(editElement, taskId, columnId);
        }

        if (window.kanbanDebug?.enabled) {
            console.log('[START-EDIT] After init value', { scrollTop: container?.scrollTop });
        }

        const useWysiwyg = this._shouldUseWysiwyg(type);
        let wysiwygContext = null;

        if (useWysiwyg) {
            wysiwygContext = this._setupWysiwygEditor(editElement, containerElement);
        }

        // Show edit element and setup visibility
        this._setupEditVisibility(displayElement, editElement, wysiwygContext?.container);

        if (window.kanbanDebug?.enabled) {
            console.log('[START-EDIT] After visibility', { scrollTop: container?.scrollTop });
        }

        // Recalculate stack layout if needed
        this._recalculateStackLayout(containerElement);

        if (window.kanbanDebug?.enabled) {
            console.log('[START-EDIT] After stack recalc', { scrollTop: container?.scrollTop });
        }

        // Position cursor
        this._positionCursor(editElement, type, preserveCursor, wysiwygContext?.editor);

        if (window.kanbanDebug?.enabled) {
            console.log('[START-EDIT] After cursor position', { scrollTop: container?.scrollTop });
        }

        // Store editor state
        this._storeEditorState(editElement, displayElement, type, taskId, columnId, wysiwygContext);

        // Notify backend
        this._notifyEditingStarted(type, taskId, columnId);

        // Setup event handlers
        if (wysiwygContext?.editor) {
            this._setupWysiwygHandlers(wysiwygContext.editor, wysiwygContext.container, containerElement);
        } else {
            this._setupInputHandler(editElement, containerElement);
            this._setupBlurHandler(editElement);
            this._setupMouseHandlers(editElement);
        }
    }

    /**
     * Transitions from title editing to description editing
     * Purpose: Smooth Tab key navigation between fields
     * Used by: Tab key handler when editing title
     * Side effects: Saves title, starts description edit
     */
    transitionToDescription() {
        if (!this.currentEditor || this.currentEditor.type !== 'task-title') {return;}

        this.isTransitioning = true;

        const taskId = this.currentEditor.taskId;
        const columnId = this.currentEditor.columnId;
        const taskItem = this.currentEditor.element.closest('.task-item');

        // Use the same save logic as regular saves to handle task includes correctly
        this.saveCurrentField();
        
        // Remove blur handler
        this.currentEditor.element.onblur = null;
        
        // Hide title editor
        this.currentEditor.element.style.display = 'none';
        if (this.currentEditor.displayElement) {
            this.currentEditor.displayElement.style.removeProperty('display');
        }

        // Clear current editor
        this.currentEditor = null;
        
        // Immediately start editing description (no async needed)
        this.isTransitioning = false;
        const descContainer = taskItem.querySelector('.task-description-container');
        if (descContainer) {
            this.startEdit(descContainer, 'task-description', taskId, columnId);
        }
    }

    /**
     * Saves current edit and exits edit mode
     * Purpose: Commit changes to data model
     * Used by: Enter key, click outside, blur events
     * Side effects: Updates pending changes, closes editor
     */
    save() {
        if (!this.currentEditor || this.isTransitioning) {return;}

        try {
            this.saveCurrentField();
            this.closeEditor();
        } catch (error) {
            console.error('[TaskEditor] Error during save:', error);
            // Force close the editor even if save fails
            this.closeEditor();
        }
    }

    cancel() {
        if (!this.currentEditor || this.isTransitioning) {return;}
        
        // Restore original value
        if (this.currentEditor.wysiwyg) {
            this.currentEditor.wysiwyg.setMarkdown(this.currentEditor.originalValue);
        } else {
            this.currentEditor.element.value = this.currentEditor.originalValue;
        }
        this.closeEditor();
    }

    /**
     * Main entry point for saving the current field
     * Dispatches to specialized methods based on field type
     */
    saveCurrentField() {
        if (!this.currentEditor) { return; }
        if (!window.cachedBoard || !window.cachedBoard.columns) { return; }

        const { type } = this.currentEditor;
        if (this.currentEditor.wysiwyg) {
            this.currentEditor.element.value = this.currentEditor.wysiwyg.getMarkdown();
        }

        switch (type) {
            case 'column-title':
                this._saveColumnTitle();
                break;
            case 'task-title':
            case 'task-description':
                this._saveTaskField();
                break;
        }
    }

    /**
     * Save column title changes
     * Handles: include syntax, layout tags, display updates, visual state
     */
    _saveColumnTitle() {
        const { element } = this.currentEditor;
        const columnId = this.currentEditor.columnId;
        const value = element.value;

        const column = window.cachedBoard.columns.find(c => c.id === columnId);
        if (!column) { return; }

        // Determine the new title (with or without reconstruction)
        const newTitle = this._computeNewColumnTitle(value, element, column);

        // Check if the title actually changed
        if (column.title === newTitle) {
            // No change - just update display and exit
            this._updateColumnDisplay(column, columnId);
            return;
        }

        // Create context for this edit
        this.lastEditContext = `column-title-${columnId}`;

        // Check for include syntax changes
        const oldIncludeMatches = (column.title || '').match(/!!!include\(([^)]+)\)!!!/g) || [];
        const newIncludeMatches = newTitle.match(/!!!include\(([^)]+)\)!!!/g) || [];
        const hasOrHadIncludes = newIncludeMatches.length > 0 || oldIncludeMatches.length > 0;

        if (hasOrHadIncludes) {
            // Handle column with includes (add/change/remove)
            this._saveColumnTitleWithIncludes(column, columnId, newTitle, newIncludeMatches.length > 0, element);
            return;
        }

        // Regular column title edit (no includes)
        this._saveRegularColumnTitle(column, columnId, newTitle, element);
    }

    /**
     * Compute the new column title, handling reconstruction of hidden layout tags
     */
    _computeNewColumnTitle(value, element, column) {
        const hasIncludes = /!!!include\([^)]+\)!!!/.test(value);

        if (hasIncludes) {
            // Includes bypass reconstruction (no hidden layout tag preservation)
            return value.trim();
        }

        // No includes: Reconstruct to merge user input with preserved hidden tags
        try {
            return this.reconstructColumnTitle(value.trim(), element.getAttribute('data-original-title') || column.title);
        } catch (error) {
            console.error('[TaskEditor] Error in reconstructColumnTitle:', error);
            return value.trim();
        }
    }

    /**
     * Save column title that has include syntax (add/change/remove)
     */
    _saveColumnTitleWithIncludes(column, columnId, newTitle, hasIncludes, element) {
        column.title = newTitle;

        // Get column element and current column ID by position
        const columnElement = element.closest('.kanban-full-height-column');
        let currentColumnId = columnId;
        if (columnElement) {
            const allColumns = Array.from(document.querySelectorAll('.kanban-full-height-column'));
            const columnIndex = allColumns.indexOf(columnElement);
            if (columnIndex !== -1 && window.currentBoard?.columns?.[columnIndex]) {
                currentColumnId = window.currentBoard.columns[columnIndex].id;
            }
        }

        // Send to backend
        vscode.postMessage({
            type: 'editColumnTitle',
            columnId: currentColumnId,
            title: newTitle
        });

        // Update display with include badges
        if (this.currentEditor && this.currentEditor.displayElement) {
            let displayTitle = newTitle;
            if (hasIncludes) {
                displayTitle = this._renderIncludeBadges(displayTitle);
            }
            const renderFn = window.renderMarkdown || (typeof renderMarkdown !== 'undefined' ? renderMarkdown : null);
            this.currentEditor.displayElement.innerHTML = renderFn ? renderFn(displayTitle) : displayTitle;
            this.currentEditor.displayElement.style.removeProperty('display');
            this.currentEditor.element.style.display = 'none';
        }

        // Update visual tag state
        if (columnElement) {
            const allTags = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(newTitle) : [];
            const isCollapsed = columnElement.classList.contains('collapsed');
            if (window.updateVisualTagState) {
                window.updateVisualTagState(columnElement, allTags, 'column', isCollapsed);
            }
        }

        // Handle layout changes
        const originalTitleForLayout = element.getAttribute('data-original-title') || '';
        this._handleLayoutChanges(originalTitleForLayout, newTitle, columnId);

        if (typeof markUnsavedChanges === 'function') {
            markUnsavedChanges();
        }
    }

    /**
     * Replace !!!include(path)!!! with HTML badges
     */
    _renderIncludeBadges(title) {
        return title.replace(/!!!include\(([^)]+)\)!!!/g, function(match, filepath) {
            const parts = filepath.split('/').length > 1 ? filepath.split('/') : filepath.split('\\');
            const filename = parts[parts.length - 1];
            const escapeHtml = function(text) {
                return text.replace(/[&<>"']/g, function(char) {
                    const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
                    return map[char];
                });
            };
            const escapedPath = escapeHtml(filepath);
            const escapedFilename = escapeHtml(filename);
            return '<span class="columninclude-link" data-file-path="' + escapedPath + '" title="Include: ' + escapedPath + '">!(' + escapedFilename + ')!</span>';
        });
    }

    /**
     * Save regular column title (no includes)
     */
    _saveRegularColumnTitle(column, columnId, newTitle, element) {
        column.title = newTitle;

        // Send to backend - action system handles undo capture
        vscode.postMessage({
            type: 'editColumnTitle',
            columnId: columnId,
            title: newTitle
        });

        // Handle layout changes
        const originalTitle = element.getAttribute('data-original-title') || '';
        this._handleLayoutChanges(originalTitle, newTitle, columnId);

        // Update display and styling
        this._updateColumnDisplay(column, columnId);
        this._updateColumnSpanClasses(column, columnId);
        this._updateColumnTagStyling(column, columnId);
        this._trackPendingColumnChange(columnId, newTitle);
    }

    /**
     * Handle layout tag changes (#stack, #row, #span)
     */
    _handleLayoutChanges(originalTitle, newTitle, columnId) {
        if (!this.hasLayoutChanged(originalTitle, newTitle)) { return; }

        const stackChanged = this.hasStackTagChanged(originalTitle, newTitle);

        if (stackChanged && typeof window.reorganizeStacksForColumn === 'function') {
            window.reorganizeStacksForColumn(columnId);
        } else {
            // Other layout changes need full re-render
            const savedEditor = this.currentEditor;
            this.currentEditor = null;

            if (typeof window.renderBoard === 'function' && window.cachedBoard) {
                window.renderBoard();
            }
            this._requestStackLayoutRecalc(null, true);

            this.currentEditor = savedEditor;
        }
    }

    /**
     * Update column display element
     */
    _updateColumnDisplay(column, columnId) {
        if (!this.currentEditor || !this.currentEditor.displayElement) { return; }

        if (window.tagUtils) {
            const renderedTitle = window.tagUtils.getColumnDisplayTitle(column, window.removeTagsForDisplay);
            this.currentEditor.displayElement.innerHTML = renderedTitle;
        } else {
            this.currentEditor.displayElement.innerHTML = column.title || '';
        }

        this.currentEditor.displayElement.style.removeProperty('display');
        this.currentEditor.element.style.display = 'none';
    }

    /**
     * Update column span CSS classes
     */
    _updateColumnSpanClasses(column, columnId) {
        const columnElement = document.querySelector(`[data-column-id="${columnId}"]`);
        if (!columnElement) { return; }

        columnElement.classList.remove('column-span-2', 'column-span-3', 'column-span-4');

        const spanMatch = column.title.match(/#span(\d+)\b/i);
        const hasViewportWidth = window.currentColumnWidth && (window.currentColumnWidth === '50percent' || window.currentColumnWidth === '100percent');
        if (spanMatch && !hasViewportWidth) {
            const spanCount = parseInt(spanMatch[1]);
            if (spanCount >= 2 && spanCount <= 4) {
                columnElement.classList.add(`column-span-${spanCount}`);
            }
        }
    }

    /**
     * Update column tag-based styling (primary tag, temporal attributes, visual state)
     */
    _updateColumnTagStyling(column, columnId) {
        const columnElement = document.querySelector(`[data-column-id="${columnId}"]`);
        if (!columnElement) { return; }

        const titleTags = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(column.title || '') : [];

        // Update primary tag
        const primaryTag = window.extractFirstTag ? window.extractFirstTag(column.title) : null;
        if (primaryTag && !primaryTag.startsWith('row') && !primaryTag.startsWith('gather_') && !primaryTag.startsWith('span')) {
            columnElement.setAttribute('data-column-tag', primaryTag);
        } else {
            columnElement.removeAttribute('data-column-tag');
        }

        // Update temporal attributes
        this._updateColumnTemporalAttributes(columnElement, column.title || '');

        // Update visual tag state
        const isCollapsed = columnElement.classList.contains('collapsed');
        if (window.updateVisualTagState) {
            window.updateVisualTagState(columnElement, titleTags, 'column', isCollapsed);
        }
    }

    /**
     * Update column temporal attributes (current day/week/weekday/hour/time)
     */
    _updateColumnTemporalAttributes(columnElement, colText) {
        if (!window.tagUtils) { return; }

        // Remove all temporal attributes first
        columnElement.removeAttribute('data-current-day');
        columnElement.removeAttribute('data-current-week');
        columnElement.removeAttribute('data-current-weekday');
        columnElement.removeAttribute('data-current-hour');
        columnElement.removeAttribute('data-current-time');

        // Set only the active ones
        if (window.tagUtils.isCurrentDate(colText)) columnElement.setAttribute('data-current-day', 'true');
        if (window.tagUtils.isCurrentWeek(colText)) columnElement.setAttribute('data-current-week', 'true');
        if (window.tagUtils.isCurrentWeekday(colText)) columnElement.setAttribute('data-current-weekday', 'true');
        if (window.tagUtils.isCurrentTime(colText)) columnElement.setAttribute('data-current-hour', 'true');
        if (window.tagUtils.isCurrentTimeSlot(colText)) columnElement.setAttribute('data-current-time', 'true');
    }

    /**
     * Track pending column change for refresh button state
     */
    _trackPendingColumnChange(columnId, newTitle) {
        if (!window.pendingColumnChanges) {
            window.pendingColumnChanges = new Map();
        }
        window.pendingColumnChanges.set(columnId, { columnId, title: newTitle });

        const totalPending = (window.pendingColumnChanges?.size || 0) + (window.pendingTaskChanges?.size || 0);
        if (window.updateRefreshButtonState) {
            window.updateRefreshButtonState('pending', totalPending);
        }
    }

    /**
     * Save task field (title or description)
     * Handles: include syntax, display updates, tag styling, temporal attributes
     */
    _saveTaskField() {
        const { element, type, taskId } = this.currentEditor;
        let columnId = this.currentEditor.columnId;
        const value = element.value;

        // Find task (may have been moved to different column)
        let { column, task } = this._findTask(taskId, columnId);
        if (!task) { return; }

        // Update columnId if task was found in different column
        if (column.id !== columnId) {
            this.currentEditor.columnId = column.id;
            columnId = column.id;
        }

        // Capture original values
        const originalTitle = task.title || '';
        const originalDisplayTitle = task.displayTitle || '';
        const originalDescription = task.description || '';

        // Handle based on field type
        if (type === 'task-title') {
            const handled = this._saveTaskTitle(task, value, taskId, columnId, element);
            if (handled) { return; } // Early return for include handling
        } else if (type === 'task-description') {
            this._saveTaskDescription(task, value, taskId, columnId);
        }

        // Update display
        this._updateTaskDisplay(task, type, value, taskId);

        // Update tag styling
        this._updateTaskTagStyling(task, taskId, columnId);

        // Send to backend
        vscode.postMessage({
            type: 'editTask',
            taskId: taskId,
            columnId: columnId,
            taskData: task
        });

        // Update refresh button state
        if (window.updateRefreshButtonState) {
            const totalPending = (window.pendingColumnChanges?.size || 0);
            window.updateRefreshButtonState(totalPending > 0 ? 'pending' : 'default', totalPending);
        }
    }

    /**
     * Find task by ID, searching all columns if not in expected column
     */
    _findTask(taskId, expectedColumnId) {
        let column = window.cachedBoard.columns.find(c => c.id === expectedColumnId);
        let task = column?.tasks.find(t => t.id === taskId);

        if (!task) {
            for (const col of window.cachedBoard.columns) {
                task = col.tasks.find(t => t.id === taskId);
                if (task) {
                    column = col;
                    break;
                }
            }
        }

        return { column, task };
    }

    /**
     * Save task title
     * Returns true if handled (include case with early return), false otherwise
     */
    _saveTaskTitle(task, value, taskId, columnId, element) {
        const newIncludeMatches = value.match(/!!!include\(([^)]+)\)!!!/g) || [];
        const oldIncludeMatches = (task.title || '').match(/!!!include\(([^)]+)\)!!!/g) || [];

        const hasIncludeChanges =
            oldIncludeMatches.length !== newIncludeMatches.length ||
            oldIncludeMatches.some((match, index) => match !== newIncludeMatches[index]);

        if (newIncludeMatches.length > 0 || hasIncludeChanges) {
            // Handle include syntax (new, changed, or removed)
            this._saveTaskTitleWithIncludes(task, value, taskId, columnId, element);
            return true;
        }

        if (task.includeMode && oldIncludeMatches.length > 0) {
            // Include task with unchanged include syntax - don't update
            return true;
        }

        // Regular task title editing
        if (task.title !== value) {
            this.lastEditContext = `task-title-${taskId}-${columnId}`;
            task.title = value;
        }

        return false;
    }

    /**
     * Save task title with include syntax
     */
    _saveTaskTitleWithIncludes(task, value, taskId, columnId, element) {
        this.lastEditContext = `task-title-${taskId}-${columnId}`;
        task.title = value;

        vscode.postMessage({
            type: 'editTask',
            taskId: taskId,
            columnId: columnId,
            taskData: { title: value }
        });

        // Update display
        if (this.currentEditor.displayElement && window.renderMarkdownWithTags) {
            const renderedHtml = window.renderMarkdownWithTags(value);
            this.currentEditor.displayElement.innerHTML = window.wrapTaskSections ? window.wrapTaskSections(renderedHtml) : renderedHtml;
        }

        // Update visual tag state
        const taskElement = element.closest('.task-item');
        if (taskElement) {
            const allTags = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(value) : [];
            const isCollapsed = taskElement.classList.contains('collapsed');
            if (window.updateVisualTagState) {
                window.updateVisualTagState(taskElement, allTags, 'task', isCollapsed);
            }
        }
    }

    /**
     * Save task description
     */
    _saveTaskDescription(task, value, taskId, columnId) {
        const currentRawValue = task.description || '';
        if (currentRawValue === value && !task.includeMode) { return; }

        this.lastEditContext = `task-description-${taskId}-${columnId}`;
        task.description = value;
    }

    /**
     * Update task display element
     */
    _updateTaskDisplay(task, type, value, taskId) {
        if (!this.currentEditor.displayElement) { return; }

        if (value.trim()) {
            // Determine correct display value for includes
            let displayValue = value;
            if (type === 'task-description' && task.includeMode) {
                displayValue = task.description || '';
            } else if (type === 'task-title' && task.includeMode) {
                displayValue = task.displayTitle || '';
            }

            // Set time slot context for description rendering
            if (type === 'task-description' && window.tagUtils && window.tagUtils.extractTimeSlotTag) {
                window.currentRenderingTimeSlot = window.tagUtils.extractTimeSlotTag(task.title || '');
            }

            let renderedHtml = renderMarkdown(displayValue, task.includeContext);
            window.currentRenderingTimeSlot = null;

            // Wrap in sections for keyboard navigation
            if (type === 'task-description' && typeof window.wrapTaskSections === 'function') {
                renderedHtml = window.wrapTaskSections(renderedHtml);
            }
            this.currentEditor.displayElement.innerHTML = renderedHtml;
        } else {
            // Handle empty values
            if (type === 'task-description' && typeof window.wrapTaskSections === 'function') {
                this.currentEditor.displayElement.innerHTML = window.wrapTaskSections('');
            } else {
                this.currentEditor.displayElement.innerHTML = '';
            }
        }

        this.currentEditor.displayElement.style.removeProperty('display');

        // For task includes, also update title display when description is edited
        if (type === 'task-description' && task.includeMode) {
            const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
            if (taskElement) {
                const titleDisplayElement = taskElement.querySelector('.task-title-display');
                if (titleDisplayElement) {
                    const displayHtml = window.tagUtils ? window.tagUtils.getTaskDisplayTitle(task) : renderMarkdown(task.displayTitle || '', task.includeContext);
                    titleDisplayElement.innerHTML = displayHtml;
                }
            }
        }
    }

    /**
     * Update task tag-based styling (primary tag, temporal attributes, visual state)
     */
    _updateTaskTagStyling(task, taskId, columnId) {
        const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
        if (!taskElement) { return; }

        const titleTags = window.getActiveTagsInTitle ? window.getActiveTagsInTitle(task.title || '') : [];

        // Update primary tag
        const primaryTag = window.extractFirstTag ? window.extractFirstTag(task.title) : null;
        if (primaryTag && !primaryTag.startsWith('row') && !primaryTag.startsWith('gather_') && !primaryTag.startsWith('span')) {
            taskElement.setAttribute('data-task-tag', primaryTag);
        } else {
            taskElement.removeAttribute('data-task-tag');
        }

        // Update temporal attributes with hierarchical gating
        this._updateTaskTemporalAttributes(taskElement, task, columnId);

        // Update visual tag state
        const isCollapsed = taskElement.classList.contains('collapsed');
        if (window.updateVisualTagState) {
            window.updateVisualTagState(taskElement, titleTags, 'task', isCollapsed);
        }
    }

    /**
     * Update task temporal attributes with hierarchical gating
     */
    _updateTaskTemporalAttributes(taskElement, task, columnId) {
        if (!window.tagUtils || !window.getActiveTemporalAttributes) { return; }

        const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
        const columnTitle = column?.title || '';

        // Remove all temporal attributes first
        taskElement.removeAttribute('data-current-day');
        taskElement.removeAttribute('data-current-week');
        taskElement.removeAttribute('data-current-weekday');
        taskElement.removeAttribute('data-current-hour');
        taskElement.removeAttribute('data-current-time');

        // Get active temporal attributes with hierarchical gating
        const activeAttrs = window.getActiveTemporalAttributes(columnTitle, task.title || '', task.description || '');

        // Set only the active ones
        for (const [attr, isActive] of Object.entries(activeAttrs)) {
            if (isActive) {
                taskElement.setAttribute(attr, 'true');
            }
        }
    }

    closeEditor() {
        if (!this.currentEditor) {return;}

        const { element, displayElement, type, wysiwyg, wysiwygContainer } = this.currentEditor;

        if (!wysiwyg && typeof window.removeSpecialCharOverlay === 'function') {
            window.removeSpecialCharOverlay(element);
        }

        // Clean up event listeners
        element.onblur = null;
        element.removeEventListener('mousedown', this._handleMouseDown);
        element.removeEventListener('dblclick', this._handleDblClick);

        if (wysiwyg) {
            wysiwyg.destroy();
            if (wysiwygContainer) {
                wysiwygContainer.style.display = 'none';
                wysiwygContainer.innerHTML = '';
            }
            element.style.display = 'none';
        } else {
            // Hide edit element
            element.style.display = 'none';
        }

        // Show display element
        if (displayElement) {
            displayElement.style.removeProperty('display');
        }

        // Release the fixed view height that was set during editing
        const kanbanBoard = document.querySelector('.kanban-board');
        if (kanbanBoard && kanbanBoard._editingMinHeight) {
            kanbanBoard.style.removeProperty('min-height');
            delete kanbanBoard._editingMinHeight;
        }

        const col = element.closest('.kanban-full-height-column');
        const closeColumnId = col ? col.dataset.columnId || null : null;
        this._requestStackLayoutRecalc(closeColumnId);
        this._flushStackLayoutRecalc();

        // Focus the card after editing ends
        if (type === 'task-title' || type === 'task-description') {
            // Find the task item to focus
            const taskItem = element.closest('.task-item');
            if (taskItem) {
                // Small delay to ensure display element is visible
                setTimeout(() => {
                    taskItem.focus();
                }, 10);
            }
        }

        // Notify VS Code that task editing has stopped (only for task editing, not column editing)
        if (type === 'task-title' || type === 'task-description') {
            if (typeof vscode !== 'undefined') {
                vscode.postMessage({
                    type: 'setContext',
                    key: 'kanbanTaskEditing',
                    value: false
                });
            }
        }

        // CRITICAL: Notify backend that editing has stopped (for ALL edit types)
        // This allows backend to clear _isInEditMode flag
        if (typeof vscode !== 'undefined') {
            vscode.postMessage({
                type: 'editingStoppedNormal'  // Different from 'editingStopped' (backend request response)
            });
        }

        // Update alternative title if task has no title and is collapsed
        if (type === 'task-title' || type === 'task-description') {
            const taskItem = element.closest('.task-item');
            if (taskItem) {
                const taskId = taskItem.getAttribute('data-task-id');
                const isCollapsed = taskItem.classList.contains('collapsed');

                if (taskId && isCollapsed) {
                    // Get task data from cached board
                    const task = findTaskById(taskId);
                    if (task) {
                        const hasNoTitle = !task.title || !task.title.trim();

                        // Update title display if task has no title
                        if (hasNoTitle && task.description) {
                            const titleDisplay = taskItem.querySelector('.task-title-display');
                            if (titleDisplay && typeof generateAlternativeTitle === 'function') {
                                const alternativeTitle = generateAlternativeTitle(task.description);
                                if (alternativeTitle) {
                                    titleDisplay.innerHTML = `<span class="task-alternative-title">${escapeHtml(alternativeTitle)}</span>`;
                                } else {
                                    titleDisplay.innerHTML = '';
                                }
                            }
                        }
                    }
                }
            }
        }

        this.currentEditor = null;

        if (typeof window.setTaskEditorActive === 'function') {
            window.setTaskEditorActive(false);
        }
    }


    /**
     * Saves undo state immediately for different operations
     * Purpose: Immediate undo state for switching between different cards/columns
     * @param {string} operation - The operation type
     * @param {string} taskId - Task ID (null for column operations)
     * @param {string} columnId - Column ID
     */
    saveUndoStateImmediately(operation, taskId, columnId) {
        // Clear any pending keystroke timeout since this is a different operation
        if (this.keystrokeTimeout) {
            clearTimeout(this.keystrokeTimeout);
            this.keystrokeTimeout = null;
        }
        
        vscode.postMessage({ 
            type: 'saveUndoState', 
            operation: operation,
            taskId: taskId,
            columnId: columnId,
            currentBoard: window.cachedBoard
        });
    }

    /**
     * Schedules undo state saving with debouncing for same-field keystrokes
     * Purpose: Group keystrokes within the same field to avoid excessive undo states
     * @param {string} operation - The operation type
     * @param {string} taskId - Task ID (null for column operations)
     * @param {string} columnId - Column ID
     */
    scheduleKeystrokeUndoSave(operation, taskId, columnId) {
        // Clear existing timeout to debounce keystrokes
        if (this.keystrokeTimeout) {
            clearTimeout(this.keystrokeTimeout);
        }
        
        
        // Schedule undo state saving after keystroke delay
        this.keystrokeTimeout = setTimeout(() => {
            vscode.postMessage({ 
                type: 'saveUndoState', 
                operation: operation,
                taskId: taskId,
                columnId: columnId,
                currentBoard: window.cachedBoard
            });
            this.keystrokeTimeout = null;
        }, 500); // 500ms delay to group keystrokes within same field
    }

    /**
     * Auto-resizes textarea to fit content
     * Purpose: Dynamic height adjustment for better UX
     * Used by: Input events on textareas
     * @param {HTMLTextAreaElement} textarea - Textarea to resize
     */
    autoResize(textarea) {
        // Get current dimensions
        const currentHeight = textarea.offsetHeight;
        const scrollHeight = textarea.scrollHeight;

        // ONLY GROW - never collapse during editing (collapsing causes scroll jump)
        // Shrinking will happen naturally when editing ends and element is recreated
        if (scrollHeight > currentHeight) {
            textarea.style.height = scrollHeight + 'px';
        }
    }

    /**
     * Reconstructs column title by merging user input with preserved hidden tags
     * Handles conflict resolution and tag visibility rules
     * @param {string} userInput - What the user typed in the editor
     * @param {string} originalTitle - The original full title with all tags
     * @returns {string} - The reconstructed title with proper tag handling
     */
    reconstructColumnTitle(userInput, originalTitle) {
        // Extract different types of tags from the original title
        const rowMatch = originalTitle.match(/#row(\d+)\b/i);
        const originalRow = rowMatch ? rowMatch[0] : null;

        const spanMatch = originalTitle.match(/#span(\d+)\b/i);
        const originalSpan = spanMatch ? spanMatch[0] : null;

        const stackMatch = originalTitle.match(/#stack\b/i);
        const originalStack = stackMatch ? stackMatch[0] : null;

        // Check what the user added in their input
        const userRowMatch = userInput.match(/#row(\d+)\b/i);
        const userRow = userRowMatch ? userRowMatch[0] : null;

        const userSpanMatch = userInput.match(/#span(\d+)\b/i);
        const userSpan = userSpanMatch ? userSpanMatch[0] : null;

        const userStackMatch = userInput.match(/#stack\b/i);
        const userStack = userStackMatch ? userStackMatch[0] : null;

        const userNoSpanMatch = userInput.match(/#nospan\b/i);
        const userNoSpan = !!userNoSpanMatch;

        const userNoStackMatch = userInput.match(/#nostack\b/i);
        const userNoStack = !!userNoStackMatch;

        // Clean the user input of all layout tags to get the base title
        let cleanTitle = userInput
            .replace(/#row\d+\b/gi, '')
            .replace(/#span\d+\b/gi, '')
            .replace(/#stack\b/gi, '')
            .replace(/#nospan\b/gi, '')
            .replace(/#nostack\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        let result = cleanTitle;

        // Handle row tags (preserve original unless user specified different)
        const finalRow = userRow || originalRow;
        if (finalRow && finalRow !== '#row1') {
            result += ` ${finalRow}`;
        }

        // Handle span tags with conflict resolution
        if (userNoSpan) {
            // User explicitly disabled span - don't add any span tag
        } else if (userSpan) {
            // User specified a span tag - use it (overrides original)
            result += ` ${userSpan}`;
        } else if (originalSpan) {
            // Keep original span tag if user didn't specify one
            result += ` ${originalSpan}`;
        }

        // Handle stack tags - user sees full title with #stack, so if they removed it, respect that
        // (Unlike hidden tags that users can't see, #stack is visible in editor)
        if (userNoStack) {
            // User explicitly disabled stack - don't add stack tag
        } else if (userStack) {
            // User kept or added stack tag - use it
            result += ` #stack`;
        }
        // If originalStack existed but userStack is null, user intentionally removed it - don't re-add

        return result.trim();
    }

    /**
     * Checks if layout-affecting tags changed between old and new titles
     * @param {string} oldTitle - Original title
     * @param {string} newTitle - New title
     * @returns {boolean} - True if layout changed
     */
    hasLayoutChanged(oldTitle, newTitle) {
        // Extract layout tags from both titles
        const getLayoutTags = (title) => {
            const span = title.match(/#span(\d+)\b/i)?.[0] || '';
            const stack = title.match(/#stack\b/i)?.[0] || '';
            const row = title.match(/#row(\d+)\b/i)?.[0] || '';
            return `${span}|${stack}|${row}`;
        };

        return getLayoutTags(oldTitle) !== getLayoutTags(newTitle);
    }

    /**
     * Checks if only the #stack tag changed (not #row or #span)
     * Used to determine if we can use optimized stack reorganization
     * @param {string} oldTitle - Original title
     * @param {string} newTitle - New title
     * @returns {boolean} - True if only #stack changed
     */
    hasStackTagChanged(oldTitle, newTitle) {
        const oldStack = /#stack\b/i.test(oldTitle);
        const newStack = /#stack\b/i.test(newTitle);
        const oldSpan = oldTitle.match(/#span(\d+)\b/i)?.[0] || '';
        const newSpan = newTitle.match(/#span(\d+)\b/i)?.[0] || '';
        const oldRow = oldTitle.match(/#row(\d+)\b/i)?.[0] || '';
        const newRow = newTitle.match(/#row(\d+)\b/i)?.[0] || '';

        // Only #stack changed if: stack is different AND span/row are the same
        return (oldStack !== newStack) && (oldSpan === newSpan) && (oldRow === newRow);
    }

    /**
     * Replace the currently selected text with new text
     * Used by extension commands like translation
     */
    replaceSelection(newText) {
        if (!this.currentEditor) {
            return;
        }

        const element = this.currentEditor.element;
        const start = element.selectionStart;
        const end = element.selectionEnd;

        // Replace the selection
        const before = element.value.substring(0, start);
        const after = element.value.substring(end);
        element.value = before + newText + after;

        // Set cursor position after the replaced text
        const newCursorPos = start + newText.length;
        element.setSelectionRange(newCursorPos, newCursorPos);

        // Focus the element
        element.focus();

    }
}

// Initialize the editor system (with guard to prevent duplicate initialization on webview revival)
if (!window.taskEditor) {
    const taskEditor = new TaskEditor();
    window.taskEditor = taskEditor;
    window.taskEditorManager = taskEditor; // Alias for compatibility
}

/**
 * Triggers title editing for a task
 * Purpose: Public API for starting task title edit
 * Used by: onclick handlers in task HTML
 * @param {HTMLElement} element - Title element
 * @param {string} taskId - Task ID
 * @param {string} columnId - Parent column ID
 */
function editTitle(element, taskId, columnId) {

    // Don't start editing if we're already editing this field
    if (taskEditor.currentEditor &&
        taskEditor.currentEditor.type === 'task-title' &&
        taskEditor.currentEditor.taskId === taskId &&
        taskEditor.currentEditor.columnId === columnId) {
        return; // Already editing this title
    }

    taskEditor.startEdit(element, 'task-title', taskId, columnId, true); // preserveCursor=true for clicks
}

/**
 * Triggers description editing for a task
 * Purpose: Public API for starting task description edit
 * Used by: onclick handlers in task HTML
 * @param {HTMLElement} element - Description element
 * @param {string} taskId - Task ID
 * @param {string} columnId - Parent column ID
 */
function editDescription(element, taskId, columnId) {
    // DEBUG: Log scroll position at editDescription entry
    if (window.kanbanDebug?.enabled) {
        const container = document.getElementById('kanban-container');
        console.log('[CLICK-DEBUG] editDescription entry', {
            scrollTop: container?.scrollTop,
            taskId
        });
    }

    // Don't start editing if we're already editing this field
    if (taskEditor.currentEditor &&
        taskEditor.currentEditor.type === 'task-description' &&
        taskEditor.currentEditor.taskId === taskId &&
        taskEditor.currentEditor.columnId === columnId) {
        return; // Already editing this description
    }

    // Don't allow editing description for broken task includes
    const column = window.cachedBoard?.columns?.find(c => c.id === columnId);
    const task = column?.tasks?.find(t => t.id === taskId);
    if (task?.includeError) {
        console.warn('[editDescription] Cannot edit description for broken task include:', taskId);
        return;
    }

    // Find the actual container if needed
    const container = element.closest('.task-description-container') || element;
    taskEditor.startEdit(container, 'task-description', taskId, columnId, true); // preserveCursor=true for clicks
}

/**
 * Triggers title editing for a column
 * Purpose: Public API for starting column title edit
 * Used by: onclick handlers in column HTML
 * @param {string} columnId - Column ID to edit
 * @param {HTMLElement} columnElement - Optional: The column DOM element (avoids searching)
 */
function editColumnTitle(columnId, columnElement = null) {
    // Don't start editing if we're already editing this column
    if (taskEditor.currentEditor &&
        taskEditor.currentEditor.type === 'column-title' &&
        taskEditor.currentEditor.columnId === columnId) {
        return; // Already editing this column title
    }

    // If column element not provided, find it using specific selector
    if (!columnElement) {
        columnElement = document.querySelector(`.kanban-full-height-column[data-column-id="${columnId}"]`);
    }

    if (columnElement) {
        taskEditor.startEdit(columnElement, 'column-title', null, columnId, true); // preserveCursor=true
    } else {
        console.error(`[editColumnTitle] No column element found for columnId: "${columnId}"`);
    }
}

// Expose functions to window for use in onclick handlers
window.editTitle = editTitle;
window.editDescription = editDescription;
window.editColumnTitle = editColumnTitle;
