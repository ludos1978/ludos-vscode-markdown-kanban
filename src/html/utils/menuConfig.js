/**
 * Menu Configuration
 *
 * Single source of truth for all menu options and their CSS values.
 * This module centralizes menu configuration previously in webview.js.
 */

// Font size configuration
const fontSizeMultipliers = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];

// Base configuration options - single source of truth for all menu items and CSS values
// This is the ONLY place where option values and their CSS conversions are defined
const baseOptions = {
    // Column width options
    columnWidth: [
        { label: "250px", value: "250px", css: "250px" },
        { label: "350px", value: "350px", css: "350px" },
        { label: "450px", value: "450px", css: "450px" },
        { label: "650px", value: "650px", css: "650px" },
        { label: "1/3 Screen", value: "33percent", css: "31.5vw", separator: true },
        { label: "1/2 Screen", value: "50percent", css: "48vw" },
        { label: "2/3 Screen", value: "66percent", css: "63vw"},
        { label: "Full Width", value: "100percent", css: "95vw" }
    ],

    // Card height options
    cardHeight: [
        { label: "Auto", value: "auto", css: "auto" },
        { label: "Small", value: "200px", css: "200px", separator: true },
        { label: "Medium", value: "400px", css: "400px" },
        { label: "Large", value: "600px", css: "600px" },
        { label: "1/3 Screen", value: "33percent", css: "26.5vh", separator: true },
        { label: "1/2 Screen", value: "50percent", css: "43.5vh" },
        { label: "2/3 Screen", value: "66percent", css: "59vh" },
        { label: "Full Screen", value: "100percent", css: "92vh" }
    ],

    // Section height options
    sectionHeight: [
        { label: "Auto", value: "auto", css: "auto" },
        { label: "Small", value: "200px", css: "200px", separator: true },
        { label: "Medium", value: "400px", css: "400px" },
        { label: "Large", value: "600px", css: "600px" },
        { label: "1/3 Screen", value: "33percent", css: "17vh", separator: true },
        { label: "1/2 Screen", value: "50percent", css: "33vh" },
        { label: "2/3 Screen", value: "66percent", css: "48vh" },
        { label: "Full Screen", value: "100percent", css: "80vh" }
    ],

    // Task section height options
    taskSectionHeight: [
        { label: "Auto", value: "auto", css: "auto" },
        { label: "Small", value: "150px", css: "150px", separator: true },
        { label: "Medium", value: "300px", css: "300px" },
        { label: "Large", value: "500px", css: "500px" },
        { label: "1/3 Screen", value: "33percent", css: "17vh", separator: true },
        { label: "1/2 Screen", value: "50percent", css: "33vh" },
        { label: "2/3 Screen", value: "66percent", css: "48vh" },
        { label: "Full Screen", value: "100percent", css: "80vh" }
    ],

    // Row height options
    rowHeight: [
        { label: "Auto", value: "auto", css: "auto" },
        { label: "Small", value: "300px", css: "300px", separator: true },
        { label: "Medium", value: "500px", css: "500px" },
        { label: "Large", value: "700px", css: "700px" },
        { label: "1/3 Screen", value: "33percent", css: "31.5vh", separator: true },
        { label: "1/2 Screen", value: "50percent", css: "48vh" },
        { label: "2/3 Screen", value: "66percent", css: "63vh" },
        { label: "Full Screen", value: "100percent", css: "95vh" }
    ],

    // Whitespace options
    whitespace: [
        { label: "Compact", value: "4px", css: "4px" },
        { label: "Default", value: "8px", css: "8px" },
        { label: "Comfortable", value: "12px", css: "12px" },
        { label: "Spacious", value: "16px", css: "16px" },
        { label: "Large", value: "24px", css: "24px" },
        { label: "XL", value: "36px", css: "36px" },
        { label: "XXL", value: "48px", css: "48px" },
        { label: "XXXL", value: "60px", css: "60px" }
    ],

    // Font size options
    fontSize: fontSizeMultipliers.map((multiplier, index) => ({
        label: `${multiplier}x`,
        value: `${multiplier.toString().replace('.', '_')}x`,
        css: multiplier, // Multiplier value (used for body class, not direct CSS)
        icon: multiplier < 1 ? "a" : "A",
        iconStyle: `font-size: ${10 + index}px;`
    })),

    // Layout rows options
    layoutRows: [
        { label: "1 Row", value: 1, css: 1 },
        { label: "2 Rows", value: 2, css: 2 },
        { label: "3 Rows", value: 3, css: 3 },
        { label: "4 Rows", value: 4, css: 4 },
        { label: "5 Rows", value: 5, css: 5 },
        { label: "6 Rows", value: 6, css: 6 }
    ],

    // Sticky stack mode options
    stickyStackMode: [
        { label: "Full Stack", value: "full", css: "full", description: "Header, title, footer & margin all sticky" },
        { label: "Title Only", value: "titleonly", css: "titleonly", description: "Only title sticky (default)" }
    ],

    // Tag visibility options
    tagVisibility: [
        { label: "All Tags", value: "all", description: "Show all tags including #span, #row, and @ tags" },
        { label: "All Excluding Layout", value: "allexcludinglayout", description: "Show all except #span and #row (includes @ tags)" },
        { label: "Custom Tags Only", value: "customonly", description: "Show only custom tags (not configured ones) and @ tags" },
        { label: "@ Tags Only", value: "mentionsonly", description: "Show only @ tags" },
        { label: "No Tags", value: "none", description: "Hide all tags" }
    ],

    // HTML Comments render mode options
    htmlCommentRenderMode: [
        { label: "Hidden", value: "hidden", description: "Hide HTML comments (default markdown behavior)" },
        { label: "As Text", value: "text", description: "Render HTML comments as visible text" }
    ],

    // HTML Content render mode options
    htmlContentRenderMode: [
        { label: "As HTML", value: "html", description: "Render HTML tags as HTML (default)" },
        { label: "As Text", value: "text", description: "Render HTML tags as visible text" }
    ],

    // Arrow key focus scroll options
    arrowKeyFocusScroll: [
        { label: "Center", value: "center", css: "center", description: "Center the focused item in the viewport" },
        { label: "Nearest", value: "nearest", css: "nearest", description: "Scroll just enough to bring the item into view" }
    ]
};

/**
 * Convert option value to CSS value
 * @param {string} optionType - The option category (e.g., 'columnWidth', 'cardHeight')
 * @param {string} value - The option value to convert
 * @returns {string} The corresponding CSS value
 */
function getCSS(optionType, value) {
    if (!baseOptions[optionType]) {
        return value;
    }
    const option = baseOptions[optionType].find(opt => opt.value === value);
    return option ? option.css : value;
}

/**
 * Convert CSS value back to option value
 * @param {string} optionType - The option category
 * @param {string} css - The CSS value to convert back
 * @returns {string} The corresponding option value
 */
function getValue(optionType, css) {
    if (!baseOptions[optionType]) {
        return css;
    }
    const option = baseOptions[optionType].find(opt => opt.css === css);
    return option ? option.value : css;
}

// MenuConfig - generated from baseOptions for menu display
const menuConfig = {
    columnWidth: null, // Generated
    cardHeight: null, // Generated
    sectionHeight: null, // Generated
    taskSectionHeight: null, // Generated
    rowHeight: null, // Generated
    whitespace: null, // Generated
    fontSize: null, // Generated
    layoutRows: null, // Generated
    tagVisibility: null, // Generated
    fontFamily: [
        { label: "System Default", value: "system", icon: "Aa" },
        { label: "Roboto", value: "roboto", icon: "Aa", iconStyle: "font-family: 'Roboto', sans-serif;" },
        { label: "Open Sans", value: "opensans", icon: "Aa", iconStyle: "font-family: 'Open Sans', sans-serif;" },
        { label: "Lato", value: "lato", icon: "Aa", iconStyle: "font-family: 'Lato', sans-serif;" },
        { label: "Poppins", value: "poppins", icon: "Aa", iconStyle: "font-family: 'Poppins', sans-serif;" },
        { label: "Inter", value: "inter", icon: "Aa", iconStyle: "font-family: 'Inter', sans-serif;" },
        { separator: true },
        { label: "Helvetica", value: "helvetica", icon: "Aa", iconStyle: "font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;" },
        { label: "Arial", value: "arial", icon: "Aa", iconStyle: "font-family: Arial, sans-serif;" },
        { label: "Georgia", value: "georgia", icon: "Aa", iconStyle: "font-family: Georgia, serif;" },
        { label: "Times New Roman", value: "times", icon: "Aa", iconStyle: "font-family: 'Times New Roman', serif;" },
        { separator: true },
        { label: "Fira Code", value: "firacode", icon: "{ }", iconStyle: "font-family: 'Fira Code', monospace;" },
        { label: "JetBrains Mono", value: "jetbrains", icon: "{ }", iconStyle: "font-family: 'JetBrains Mono', monospace;" },
        { label: "Source Code Pro", value: "sourcecodepro", icon: "{ }", iconStyle: "font-family: 'Source Code Pro', monospace;" },
        { label: "Consolas", value: "consolas", icon: "{ }", iconStyle: "font-family: Consolas, monospace;" }
    ]
};

// Generate menu configurations from base options
['columnWidth', 'cardHeight', 'sectionHeight', 'taskSectionHeight', 'rowHeight', 'whitespace', 'fontSize', 'layoutRows', 'stickyStackMode', 'tagVisibility', 'htmlCommentRenderMode', 'htmlContentRenderMode', 'arrowKeyFocusScroll'].forEach(key => {
    if (baseOptions[key]) {
        menuConfig[key] = baseOptions[key].map(option => {
            const result = {
                label: option.label + (option.value !== 'auto' && option.value !== option.label ? ` (${option.description || option.value})` : ''),
                value: option.value
            };
            if (option.description) {
                result.description = option.description;
            }
            if (option.icon) {
                result.icon = option.icon;
            }
            if (option.iconStyle) {
                result.iconStyle = option.iconStyle;
            }
            if (option.separator) {
                result.separator = true;
            }
            return result;
        });
    }
});

/**
 * Get current setting value for menu indicators
 * @param {string} configKey - The configuration key
 * @returns {*} The current value for that setting
 */
function getCurrentSettingValue(configKey) {
    switch (configKey) {
        case 'columnWidth':
            return window.currentColumnWidth || '350px';
        case 'cardHeight':
            return window.currentTaskMinHeight || 'auto';
        case 'sectionHeight':
            return window.currentSectionHeight || 'auto';
        case 'taskSectionHeight':
            return window.currentTaskSectionHeight || 'auto';
        case 'whitespace':
            return window.currentWhitespace || '8px';
        case 'fontSize':
            return window.currentFontSize || '1x';
        case 'fontFamily':
            return window.currentFontFamily || 'system';
        case 'layoutRows':
            return window.currentLayoutRows || 1;
        case 'rowHeight':
            return window.currentRowHeight || 'auto';
        case 'stickyStackMode':
            return window.currentStickyStackMode || 'titleonly';
        case 'tagVisibility':
            return window.currentTagVisibility || 'allexcludinglayout';
        case 'htmlCommentRenderMode':
            return window.currentHtmlCommentRenderMode || 'hidden';
        case 'htmlContentRenderMode':
            return window.currentHtmlContentRenderMode || 'html';
        case 'arrowKeyFocusScroll':
            return window.currentArrowKeyFocusScroll || 'center';
        default:
            return null;
    }
}

/**
 * Generate menu HTML from configuration
 * @param {string} configKey - The menu configuration key
 * @param {string} onClickFunction - The function name to call on click
 * @returns {string} Generated HTML
 */
function generateMenuHTML(configKey, onClickFunction) {
    const config = menuConfig[configKey];
    if (!config) {return '';}

    const currentValue = getCurrentSettingValue(configKey);

    let html = '';
    for (const item of config) {
        if (item.separator) {
            html += '<div class="file-bar-menu-divider"></div>';
        } else {
            const iconHtml = item.icon ? `<span class="menu-icon"${item.iconStyle ? ` style="${item.iconStyle}"` : ''}>${item.icon}</span> ` : '';
            const isSelected = item.value === currentValue;
            const selectedClass = isSelected ? ' selected' : '';
            const checkmark = isSelected ? '<span class="menu-checkmark">✓</span>' : '';
            html += `<button class="file-bar-menu-item${selectedClass}" onclick="${onClickFunction}('${item.value}')">${iconHtml}${item.label}${checkmark}</button>`;
        }
    }
    return html;
}

/**
 * Update all menu indicators based on current settings
 */
function updateAllMenuIndicators() {
    const menuMappings = [
        { selector: '[data-menu="columnWidth"]', config: 'columnWidth', function: 'setColumnWidth' },
        { selector: '[data-menu="cardHeight"]', config: 'cardHeight', function: 'setTaskMinHeight' },
        { selector: '[data-menu="sectionHeight"]', config: 'sectionHeight', function: 'setSectionHeight' },
        { selector: '[data-menu="taskSectionHeight"]', config: 'taskSectionHeight', function: 'setTaskSectionHeight' },
        { selector: '[data-menu="whitespace"]', config: 'whitespace', function: 'setWhitespace' },
        { selector: '[data-menu="fontSize"]', config: 'fontSize', function: 'setFontSize' },
        { selector: '[data-menu="fontFamily"]', config: 'fontFamily', function: 'setFontFamily' },
        { selector: '[data-menu="layoutRows"]', config: 'layoutRows', function: 'setLayoutRows' },
        { selector: '[data-menu="rowHeight"]', config: 'rowHeight', function: 'setRowHeight' },
        { selector: '[data-menu="stickyStackMode"]', config: 'stickyStackMode', function: 'setStickyStackMode' },
        { selector: '[data-menu="tagVisibility"]', config: 'tagVisibility', function: 'setTagVisibility' },
        { selector: '[data-menu="htmlCommentRenderMode"]', config: 'htmlCommentRenderMode', function: 'setHtmlCommentRenderMode' },
        { selector: '[data-menu="htmlContentRenderMode"]', config: 'htmlContentRenderMode', function: 'setHtmlContentRenderMode' }
    ];

    menuMappings.forEach(mapping => {
        const container = document.querySelector(mapping.selector);
        if (container) {
            container.innerHTML = generateMenuHTML(mapping.config, mapping.function);
        }
    });
}

/**
 * Populate dynamic menus when DOM is ready
 */
function populateDynamicMenus() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', populateDynamicMenus);
        return;
    }
    updateAllMenuIndicators();
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.baseOptions = baseOptions;
    window.menuConfig = menuConfig;
    window.getCSS = getCSS;
    window.getValue = getValue;
    window.getCurrentSettingValue = getCurrentSettingValue;
    window.generateMenuHTML = generateMenuHTML;
    window.updateAllMenuIndicators = updateAllMenuIndicators;
    window.populateDynamicMenus = populateDynamicMenus;
}
