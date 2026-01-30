(function() { 'use strict';

/**
 * Task Checkbox Plugin for markdown-it (browser version)
 * Handles - [ ] / - [x] task list syntax.
 * Extracted from markdownRenderer.js — Phase 5.
 */
window.markdownitTaskCheckbox = function(md) {
    md.core.ruler.after('inline', 'task-checkbox', function(state) {
        var env = state.env || {};
        var checkboxIndex = Number.isFinite(env.taskCheckboxIndex) ? env.taskCheckboxIndex : 0;

        for (var i = 0; i < state.tokens.length; i++) {
            var token = state.tokens[i];
            if (token.type !== 'inline' || !token.children || token.children.length === 0) {
                continue;
            }

            var prev = state.tokens[i - 1];
            var prevPrev = state.tokens[i - 2];
            if (!prev || !prevPrev || prev.type !== 'paragraph_open' || prevPrev.type !== 'list_item_open') {
                continue;
            }

            var firstChild = token.children[0];
            if (!firstChild || firstChild.type !== 'text') {
                continue;
            }

            var match = firstChild.content.match(/^\[( |x|X)\]\s+/);
            if (!match) {
                continue;
            }

            var checked = match[1].toLowerCase() === 'x';
            var checkboxToken = new state.Token('task_checkbox', 'span', 0);
            checkboxToken.meta = {
                checked: checked,
                index: checkboxIndex
            };
            checkboxIndex += 1;

            firstChild.content = firstChild.content.slice(match[0].length);
            token.children.unshift(checkboxToken);
        }

        env.taskCheckboxIndex = checkboxIndex;
        state.env = env;
    });

    md.renderer.rules.task_checkbox = function(tokens, idx) {
        var meta = tokens[idx] && tokens[idx].meta ? tokens[idx].meta : {};
        var checked = !!meta.checked;
        var index = Number.isFinite(meta.index) ? meta.index : 0;
        var classes = 'md-task-checkbox' + (checked ? ' checked' : '');
        var aria = checked ? 'true' : 'false';
        return '<span class="' + classes + '" data-checkbox-index="' + index + '" data-checked="' + (checked ? 'true' : 'false') + '" role="checkbox" aria-checked="' + aria + '" tabindex="0"></span>';
    };
};

})();
