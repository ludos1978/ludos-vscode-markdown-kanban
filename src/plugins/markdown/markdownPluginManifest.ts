/**
 * Markdown-it Plugin Manifest
 *
 * Single source of truth for ALL markdown-it plugins used across the
 * three rendering runtimes (frontend webview, WYSIWYG backend, Marp export).
 *
 * Priority determines load order (lower = loaded earlier).
 * Custom plugins: 10–80, NPM/CDN plugins: 100–240.
 *
 * @module plugins/markdown/markdownPluginManifest
 */

import { MarkdownPluginEntry } from '../interfaces/MarkdownProcessorPlugin';

/**
 * Complete manifest of all markdown-it plugins.
 *
 * Each entry maps to a plugin used in at least one of:
 * - Frontend webview (markdownRenderer.js via window.* globals)
 * - WYSIWYG backend (markdownItFactory.ts via TypeScript imports)
 * - Marp export engine (engine.js via Node.js require)
 */
export const MARKDOWN_PLUGIN_MANIFEST: MarkdownPluginEntry[] = [
    // =========================================================================
    // Custom plugins (priority 10–80) — extracted from markdownRenderer.js
    // =========================================================================
    {
        id: 'wiki-links',
        name: 'Wiki Links Plugin',
        priority: 10,
        scope: 'both',
        type: 'custom',
        windowGlobal: 'markdownitWikiLinks',
    },
    {
        id: 'tag',
        name: 'Tag Detection Plugin',
        priority: 20,
        scope: 'both',
        type: 'custom',
        windowGlobal: 'markdownitTag',
    },
    {
        id: 'task-checkbox',
        name: 'Task Checkbox Plugin',
        priority: 30,
        scope: 'both',
        type: 'custom',
        windowGlobal: 'markdownitTaskCheckbox',
    },
    {
        id: 'date-person-tag',
        name: 'Date & Person Tag Plugin',
        priority: 40,
        scope: 'both',
        type: 'custom',
        windowGlobal: 'markdownitDatePersonTag',
    },
    {
        id: 'temporal-tag',
        name: 'Temporal Tag Plugin',
        priority: 50,
        scope: 'both',
        type: 'custom',
        windowGlobal: 'markdownitTemporalTag',
    },
    {
        id: 'enhanced-strikethrough',
        name: 'Enhanced Strikethrough Plugin',
        priority: 60,
        scope: 'both',
        type: 'custom',
        windowGlobal: 'markdownitEnhancedStrikethrough',
    },
    {
        id: 'speaker-note',
        name: 'Speaker Note Plugin',
        priority: 70,
        scope: 'both',
        type: 'custom',
        windowGlobal: 'markdownitSpeakerNote',
    },
    {
        id: 'html-comment',
        name: 'HTML Comment & Content Plugin',
        priority: 80,
        scope: 'both',
        type: 'custom',
        windowGlobal: 'markdownitHtmlComment',
    },

    // =========================================================================
    // NPM / CDN plugins (priority 100–240)
    // =========================================================================
    {
        id: 'emoji',
        name: 'Emoji Plugin',
        priority: 100,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitEmoji',
        npmPackage: 'markdown-it-emoji',
    },
    {
        id: 'footnote',
        name: 'Footnote Plugin',
        priority: 110,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitFootnote',
        npmPackage: 'markdown-it-footnote',
    },
    {
        id: 'multicolumn',
        name: 'Multicolumn Layout Plugin',
        priority: 120,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownItMulticolumn',
        npmPackage: 'markdown-it-multicolumn',
    },
    {
        id: 'mark',
        name: 'Mark Plugin',
        priority: 130,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitMark',
        npmPackage: 'markdown-it-mark',
    },
    {
        id: 'sub',
        name: 'Subscript Plugin',
        priority: 140,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitSub',
        npmPackage: 'markdown-it-sub',
    },
    {
        id: 'sup',
        name: 'Superscript Plugin',
        priority: 150,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitSup',
        npmPackage: 'markdown-it-sup',
    },
    {
        id: 'ins',
        name: 'Insert Plugin',
        priority: 160,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitIns',
        npmPackage: 'markdown-it-ins',
    },
    {
        id: 'strikethrough-alt',
        name: 'Strikethrough Alt Plugin',
        priority: 170,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitStrikethroughAlt',
        npmPackage: 'markdown-it-strikethrough-alt',
    },
    {
        id: 'underline',
        name: 'Underline Plugin',
        priority: 180,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitUnderline',
        npmPackage: 'markdown-it-underline',
    },
    {
        id: 'abbr',
        name: 'Abbreviation Plugin',
        priority: 190,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitAbbr',
        npmPackage: 'markdown-it-abbr',
    },
    {
        id: 'container',
        name: 'Container Plugin',
        priority: 200,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownitContainer',
        npmPackage: 'markdown-it-container',
        containerTypes: [
            'note', 'comment', 'highlight',
            'mark-red', 'mark-green', 'mark-blue',
            'mark-cyan', 'mark-magenta', 'mark-yellow',
            'center', 'center100', 'right', 'caption'
        ],
    },
    {
        id: 'include',
        name: 'Include Plugin',
        priority: 210,
        scope: 'frontend',
        type: 'npm',
        windowGlobal: 'markdownItInclude',
    },
    {
        id: 'image-figures',
        name: 'Image Figures Plugin',
        priority: 220,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownItImageFigures',
        npmPackage: 'markdown-it-image-figures',
        options: { figcaption: 'title' },
    },
    {
        id: 'image-attrs',
        name: 'Image Attributes Plugin',
        priority: 225,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownItImageAttrs',
        npmPackage: 'markdown-it-image-attrs',
    },
    {
        id: 'media',
        name: 'Media Plugin',
        priority: 230,
        scope: 'both',
        type: 'npm',
        windowGlobal: 'markdownItMediaCustom',
        options: {
            controls: true,
            attrs: { image: {}, audio: {}, video: {} },
        },
    },
];
