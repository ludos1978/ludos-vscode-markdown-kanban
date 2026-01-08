/**
 * String Utilities for Webview
 *
 * Provides shared escaping helpers across webview scripts.
 */

(function () {
    'use strict';

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeRegExp(value) {
        return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (typeof window !== 'undefined') {
        if (!window.escapeHtml) {
            window.escapeHtml = escapeHtml;
        }
        if (!window.escapeRegExp) {
            window.escapeRegExp = escapeRegExp;
        }
        if (!window.stringUtils) {
            window.stringUtils = {
                escapeHtml: window.escapeHtml,
                escapeRegExp: window.escapeRegExp
            };
        }
    }
})();
