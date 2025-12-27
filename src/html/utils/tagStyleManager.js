/**
 * Tag Style Manager
 *
 * Generates CSS styles for tag-based theming.
 * Handles dynamic style injection for tag colors, borders, bars, and badges.
 *
 * Extracted from boardRenderer.js for better code organization.
 *
 * Dependencies:
 * - colorUtils.js (must be loaded before this file)
 * - window.tagColors (configuration from backend)
 */

// ============================================================================
// MODULE STATE
// ============================================================================

// Cache CSS variables for performance
let cachedEditorBg = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets the editor background color from CSS variables
 * Caches the value for performance
 * @returns {string} The editor background color
 */
function getEditorBackground() {
    if (!cachedEditorBg) {
        cachedEditorBg = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background') || '#ffffff';
    }
    return cachedEditorBg;
}

/**
 * Helper function to check if dark theme is active
 * @returns {boolean} True if dark theme is active
 */
function isDarkTheme() {
    return document.body.classList.contains('vscode-dark') ||
           document.body.classList.contains('vscode-high-contrast');
}

// ============================================================================
// TAG CONFIGURATION
// ============================================================================

/**
 * Helper function to get tag configuration from grouped or flat structure
 * @param {string} tagName - The tag name to look up
 * @returns {object|null} The tag configuration, or null if not found
 */
function getTagConfig(tagName) {
    if (!window.tagColors) {return null;}

    // Skip default configuration
    if (tagName === 'default') {return null;}

    // Normalize tag name to lowercase for case-insensitive matching
    const normalizedTagName = tagName.toLowerCase();

    // Check all keys in tagColors dynamically (supports any group name)
    for (const key of Object.keys(window.tagColors)) {
        const value = window.tagColors[key];
        // Check if this is a group (object containing tag configs)
        if (value && typeof value === 'object' && !value.light && !value.dark &&
            !value.headerBar && !value.footerBar && !value.border && !value.cornerBadge) {
            // This looks like a group - check if it contains the tag (case-insensitive)
            for (const tagKey of Object.keys(value)) {
                if (tagKey.toLowerCase() === normalizedTagName) {
                    return value[tagKey];
                }
            }
        }
    }

    // Check flat structure (direct tag config at root level) - case-insensitive
    for (const key of Object.keys(window.tagColors)) {
        if (key.toLowerCase() === normalizedTagName) {
            return window.tagColors[key];
        }
    }

    return null;
}

// ============================================================================
// STYLE GENERATION
// ============================================================================

/**
 * Generates all CSS styles for tag-based theming
 * Purpose: Creates dynamic styles for colors, borders, bars
 * Used by: applyTagStyles() on board render
 * @returns {string} Complete CSS text for all tag styles
 * Note: Handles theme detection, color interpolation
 */
function generateTagStyles() {
    if (!window.tagColors) {
        return '';
    }

    // Safety check: ensure document.body exists before accessing classList
    if (!document.body) {
        console.warn('[generateTagStyles] document.body not ready yet, skipping');
        return '';
    }

    const isDark = document.body.classList.contains('vscode-dark') ||
                        document.body.classList.contains('vscode-high-contrast');
    const themeKey = isDark ? 'dark' : 'light';

    let styles = '';

    // Add base styles for corner badges
    // Add default styles for elements without tags only when explicitly enabled
    if (window.tagColors.default) {
        const defaultConfig = window.tagColors.default;

        // Default column styles (gated)
        if (defaultConfig.column && (defaultConfig.column.applyBackground === true || defaultConfig.column.enable === true)) {
            const columnColors = defaultConfig.column[themeKey] || defaultConfig.column.light || {};
            if (columnColors.background) {
                const editorBg = getEditorBackground();
                const bgDark = columnColors.backgroundDark || columnColors.background;

                const columnBg = colorUtils.interpolateColor(editorBg, bgDark, 0.15);

                // Calculate text color from the ACTUAL interpolated background
                const { textColor: defaultColumnTextColor, textShadow: defaultColumnTextShadow } =
                    colorUtils ? colorUtils.getTextColorsForBackground(columnBg) : { textColor: '#000000', textShadow: '' };

                // Default column header background
                styles += `.kanban-full-height-column:not([data-column-tag]) .column-header {
                    background-color: ${columnBg} !important;
                }\n`;

                styles += `.kanban-full-height-column:not([data-column-tag]) .column-title {
                    background-color: ${columnBg} !important;
                }\n`;

                // Default column title text color - higher specificity
                styles += `.kanban-full-height-column:not([data-column-tag]) .column-title .column-title-text,
.kanban-full-height-column:not([data-column-tag]) .column-title .column-title-text * {
                    color: ${defaultColumnTextColor} !important;${defaultColumnTextShadow ? `\n                    text-shadow: ${defaultColumnTextShadow} !important;` : ''}
                }\n`;

                // Default column content background
                styles += `.kanban-full-height-column:not([data-column-tag]) .column-content {
                    background-color: ${columnBg} !important;
                }\n`;

                // Default column footer background and text
                styles += `.kanban-full-height-column:not([data-column-tag]) .column-footer {
                    background-color: ${columnBg} !important;
                }\n`;

                styles += `.kanban-full-height-column:not([data-column-tag]) .column-footer,
.kanban-full-height-column:not([data-column-tag]) .column-footer * {
                    color: ${defaultColumnTextColor} !important;${defaultColumnTextShadow ? `\n                    text-shadow: ${defaultColumnTextShadow} !important;` : ''}
                }\n`;

                const columnCollapsedBg = colorUtils.interpolateColor(editorBg, bgDark, 0.2);

                // Calculate text color from the ACTUAL collapsed background
                const { textColor: defaultCollapsedTextColor, textShadow: defaultCollapsedTextShadow } =
                    colorUtils ? colorUtils.getTextColorsForBackground(columnCollapsedBg) : { textColor: '#000000', textShadow: '' };

                // Default collapsed column header background
                styles += `.kanban-full-height-column.collapsed:not([data-column-tag]) .column-header {
                    background-color: ${columnCollapsedBg} !important;
                }\n`;

                styles += `.kanban-full-height-column.collapsed:not([data-column-tag]) .column-title {
                    background-color: ${columnCollapsedBg} !important;
                }\n`;

                // Default collapsed title text color - higher specificity
                styles += `.kanban-full-height-column.collapsed:not([data-column-tag]) .column-title .column-title-text,
.kanban-full-height-column.collapsed:not([data-column-tag]) .column-title .column-title-text * {
                    color: ${defaultCollapsedTextColor} !important;${defaultCollapsedTextShadow ? `\n                    text-shadow: ${defaultCollapsedTextShadow} !important;` : ''}
                }\n`;

                // Default collapsed column footer background and text
                styles += `.kanban-full-height-column.collapsed:not([data-column-tag]) .column-footer {
                    background-color: ${columnCollapsedBg} !important;
                }\n`;

                styles += `.kanban-full-height-column.collapsed:not([data-column-tag]) .column-footer,
.kanban-full-height-column.collapsed:not([data-column-tag]) .column-footer * {
                    color: ${defaultCollapsedTextColor} !important;${defaultCollapsedTextShadow ? `\n                    text-shadow: ${defaultCollapsedTextShadow} !important;` : ''}
                }\n`;
            }
        }

        // Default card styles (gated)
        if (defaultConfig.card && (defaultConfig.card.applyBackground === true || defaultConfig.card.enable === true)) {
            const cardColors = defaultConfig.card[themeKey] || defaultConfig.card.light || {};
            if (cardColors.text && cardColors.background) {
                const editorBg = getEditorBackground();
                const bgDark = cardColors.backgroundDark || cardColors.background;

                const cardBg = colorUtils.interpolateColor(editorBg, bgDark, 0.25);
                styles += `.task-item:not([data-task-tag]) {
                    background-color: ${cardBg} !important;
                    position: relative;
                }\n`;

                const cardHoverBg = colorUtils.interpolateColor(editorBg, bgDark, 0.35);
                styles += `.task-item:not([data-task-tag]):hover {
                    background-color: ${cardHoverBg} !important;
                }\n`;
            }
        }

        // Default card border (always allowed if provided)
        if (defaultConfig.card && defaultConfig.card.border) {
            const b = defaultConfig.card.border;
            const bStyle = b.style;
            const bWidth = b.width;
            const bColor = b.color;
            if (b.position === 'left') {
                styles += `.task-item:not([data-task-tag]) { border-left: ${bWidth} ${bStyle} ${bColor} !important; }\n`;
            } else {
                styles += `.task-item:not([data-task-tag]) { border: ${bWidth} ${bStyle} ${bColor} !important; }\n`;
            }
        }
    }

    // Function to process tags from either grouped or flat structure
    const processTags = (tags) => {
        for (const [tagName, config] of Object.entries(tags)) {
            // Skip the default configuration
            if (tagName === 'default') {continue;}

            // Skip if this is a group (has nested objects with light/dark themes)
            if (config.light || config.dark) {
                const themeColors = config[themeKey] || config.light || {};
                const lowerTagName = tagName.toLowerCase();
                // For attribute selectors: Use unescaped tag name (quoted values are literal)
                const attrTagName = lowerTagName;  // Use this in [data-tag="..."]

                // Tag pill styles (the tag text itself) - only if background is configured
                if (themeColors.background) {
                    // Strip alpha channel from background for luminance calculation
                    // Alpha affects blending but not the opaque color's luminance
                    const opaqueBackground = themeColors.background.length === 9 ? themeColors.background.substring(0, 7) : themeColors.background;

                    // Calculate automatic text color based on background luminance
                    const { textColor: tagTextColor, textShadow: tagTextShadow } =
                        colorUtils ? colorUtils.getTextColorsForBackground(opaqueBackground) : { textColor: '#000000', textShadow: '' };

                    styles += `.kanban-tag[data-tag="${attrTagName}"] {
                        color: ${tagTextColor} !important;
                        background-color: ${themeColors.background} !important;
                        border: 1px solid ${themeColors.background};${tagTextShadow ? `\n                        text-shadow: ${tagTextShadow};` : ''}
                    }\n`;

                    // Highlight lines/paragraphs containing this tag in descriptions
                    // Only p and li elements, not the task-section div wrappers
                    const lineBgAlpha = themeColors.background + '20'; // Add 20 for ~12% opacity
                    styles += `.task-description-display p:has(.kanban-tag[data-tag="${attrTagName}"]),
.task-description-display li:has(.kanban-tag[data-tag="${attrTagName}"]) {
    background-color: ${lineBgAlpha} !important;
    border-left: 2px solid ${themeColors.background} !important;
    padding: 2px 4px !important;
    margin: 2px 0 !important;
    border-radius: 3px !important;
}\n`;

                    // Get the base background color (or use editor background as default)
                    const editorBg = getEditorBackground();
                    const bgDark = themeColors.backgroundDark || themeColors.background;

                    // Column background styles - only for primary tag
                    // Interpolate 15% towards the darker color
                    const columnBg = colorUtils.interpolateColor(editorBg, bgDark, 0.15);

                    // Calculate text color from the ACTUAL interpolated background, not the original color
                    const { textColor: columnTextColor, textShadow: columnTextShadow } =
                        colorUtils ? colorUtils.getTextColorsForBackground(columnBg) : { textColor: '#000000', textShadow: '' };

                    // Column header background
                    styles += `.kanban-full-height-column[data-column-bg-tag="${attrTagName}"] .column-header {
                        background-color: ${columnBg} !important;
                    }\n`;

                    styles += `.kanban-full-height-column[data-column-bg-tag="${attrTagName}"] .column-title {
                        background-color: ${columnBg} !important;
                    }\n`;

                    // Column title text color - higher specificity to override base CSS
                    styles += `.kanban-full-height-column[data-column-bg-tag="${attrTagName}"] .column-title .column-title-text,
.kanban-full-height-column[data-column-bg-tag="${attrTagName}"] .column-title .column-title-text * {
                        color: ${columnTextColor} !important;${columnTextShadow ? `\n                        text-shadow: ${columnTextShadow} !important;` : ''}
                    }\n`;

                    // Column content background
                    styles += `.kanban-full-height-column[data-column-bg-tag="${attrTagName}"] .column-content {
                        background-color: ${columnBg} !important;
                    }\n`;

                    // Column footer background and text
                    styles += `.kanban-full-height-column[data-column-bg-tag="${attrTagName}"] .column-footer {
                        background-color: ${columnBg} !important;
                    }\n`;

                    styles += `.kanban-full-height-column[data-column-bg-tag="${attrTagName}"] .column-footer,
.kanban-full-height-column[data-column-bg-tag="${attrTagName}"] .column-footer * {
                        color: ${columnTextColor} !important;${columnTextShadow ? `\n                        text-shadow: ${columnTextShadow} !important;` : ''}
                    }\n`;

                    // Column collapsed state - interpolate 20% towards the darker color
                    const columnCollapsedBg = colorUtils.interpolateColor(editorBg, bgDark, 0.2);

                    // Calculate text color from the ACTUAL collapsed background
                    const { textColor: collapsedTextColor, textShadow: collapsedTextShadow } =
                        colorUtils ? colorUtils.getTextColorsForBackground(columnCollapsedBg) : { textColor: '#000000', textShadow: '' };

                    // Collapsed column header background
                    styles += `.kanban-full-height-column.collapsed[data-column-bg-tag="${attrTagName}"] .column-header {
                        background-color: ${columnCollapsedBg} !important;
                    }\n`;

                    styles += `.kanban-full-height-column.collapsed[data-column-bg-tag="${attrTagName}"] .column-title {
                        background-color: ${columnCollapsedBg} !important;
                    }\n`;

                    // Collapsed title text color - higher specificity
                    styles += `.kanban-full-height-column.collapsed[data-column-bg-tag="${attrTagName}"] .column-title .column-title-text,
.kanban-full-height-column.collapsed[data-column-bg-tag="${attrTagName}"] .column-title .column-title-text * {
                        color: ${collapsedTextColor} !important;${collapsedTextShadow ? `\n                        text-shadow: ${collapsedTextShadow} !important;` : ''}
                    }\n`;

                    // Collapsed column footer background and text
                    styles += `.kanban-full-height-column.collapsed[data-column-bg-tag="${attrTagName}"] .column-footer {
                        background-color: ${columnCollapsedBg} !important;
                    }\n`;

                    styles += `.kanban-full-height-column.collapsed[data-column-bg-tag="${attrTagName}"] .column-footer,
.kanban-full-height-column.collapsed[data-column-bg-tag="${attrTagName}"] .column-footer * {
                        color: ${collapsedTextColor} !important;${collapsedTextShadow ? `\n                        text-shadow: ${collapsedTextShadow} !important;` : ''}
                    }\n`;

                    // Card background styles - only for primary tag
                    // Interpolate 25% towards the darker color
                    const cardBg = colorUtils.interpolateColor(editorBg, bgDark, 0.25);
                    styles += `.task-item[data-task-bg-tag="${attrTagName}"] {
                        background-color: ${cardBg} !important;
                        position: relative;
                    }\n`;

                    // Card hover state - interpolate 35% towards the darker color
                    const cardHoverBg = colorUtils.interpolateColor(editorBg, bgDark, 0.35);
                    styles += `.task-item[data-task-bg-tag="${attrTagName}"]:hover {
                        background-color: ${cardHoverBg} !important;
                    }\n`;
                }

                // Stackable border styles - works even without background colors
                if (config.border) {
                        const borderColor = config.border.color || themeColors.background;
                        const borderWidth = config.border.width || '2px';
                        const borderStyle = config.border.style || 'solid';

                        if (config.border.position === 'left') {
                            // Use data-column-border-tag for left border on all column parts
                            styles += `.kanban-full-height-column[data-column-border-tag="${attrTagName}"] .column-header {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n`;
                            styles += `.kanban-full-height-column[data-column-border-tag="${attrTagName}"] .column-title {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n`;
                            styles += `.kanban-full-height-column[data-column-border-tag="${attrTagName}"] .column-inner {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n`;
                            styles += `.kanban-full-height-column[data-column-border-tag="${attrTagName}"] .column-footer {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n`;
                            styles += `.task-item[data-task-border-tag="${attrTagName}"] {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n`;
                        } else {
                            // Full border split the border for top and bottom part
                            styles += `.kanban-full-height-column[data-column-border-tag="${attrTagName}"] .column-header {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                                border-right: ${borderWidth} ${borderStyle} ${borderColor} !important;
                                border-top: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n
														.kanban-full-height-column[data-column-border-tag="${attrTagName}"] .column-title {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                                border-right: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n
														.kanban-full-height-column[data-column-border-tag="${attrTagName}"] .column-inner {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                                border-right: ${borderWidth} ${borderStyle} ${borderColor} !important;
                                border-bottom: none !important;
                            }\n
														.kanban-full-height-column[data-column-border-tag="${attrTagName}"] .column-footer {
                                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
                                border-right: ${borderWidth} ${borderStyle} ${borderColor} !important;
                                border-bottom: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n`;
                            styles += `.task-item[data-task-border-tag="${attrTagName}"] {
                                border: ${borderWidth} ${borderStyle} ${borderColor} !important;
                            }\n`;
                        }
                    }

                    // Stackable header bar with text
                    if (config.headerBar) {
                        const headerColor = config.headerBar.color || themeColors.background;
                        const headerHeight = config.headerBar.label ? '20px' : (config.headerBar.height || '4px');
                        const headerText = config.headerBar.label || '';

                        // Calculate automatic text color from header bar background
                        // ALWAYS use automatic calculation, ignore configured labelColor
                        const opaqueHeaderColor = headerColor.length === 9 ? headerColor.substring(0, 7) : headerColor;
                        const { textColor: headerTextColor, textShadow: headerTextShadow } =
                            colorUtils ? colorUtils.getTextColorsForBackground(opaqueHeaderColor) : { textColor: '#ffffff', textShadow: '' };

                        // Create a unique class for this header bar - always solid color
                        styles += `.header-bar-${lowerTagName} {
                            /* position: absolute; */
                            left: 0;
                            right: 0;
                            height: ${headerHeight};
                            background: ${headerColor};
                            z-index: 1;
                            ${headerText ? `
                                color: ${headerTextColor} !important;
                                font-size: 10px;
                                font-weight: bold;
                                display: flex;
                                align-items: center;
                                justify-content: center;${headerTextShadow ? `\n                                text-shadow: ${headerTextShadow};` : ''}
                            ` : ''}
                        }\n`;

                        if (headerText) {
                            styles += `.header-bar-${lowerTagName}::after {
                                content: '${headerText}';
                            }\n`;

                            // Collapsed state with label - needs full height
                            styles += `.kanban-full-height-column.collapsed .header-bar-${lowerTagName} {
                                height: 20px !important;
                                padding: 0 2px !important;
                            }\n`;
                        } else {
                            // Collapsed state without label - keep original height
                            styles += `.kanban-full-height-column.collapsed .header-bar-${lowerTagName} {
                                height: ${headerHeight} !important;
                            }\n`;
                        }
                    }

                    // Stackable footer bar with text
                    if (config.footerBar) {
                        const footerColor = config.footerBar.color || themeColors.background;
                        const footerHeight = config.footerBar.label ? '20px' : (config.footerBar.height || '3px');
                        const footerText = config.footerBar.label || '';

                        // Calculate automatic text color from footer bar background
                        // ALWAYS use automatic calculation, ignore configured labelColor
                        const opaqueFooterColor = footerColor.length === 9 ? footerColor.substring(0, 7) : footerColor;
                        const { textColor: footerTextColor, textShadow: footerTextShadow } =
                            colorUtils ? colorUtils.getTextColorsForBackground(opaqueFooterColor) : { textColor: '#ffffff', textShadow: '' };

                        // Create a unique class for this footer bar
                        styles += `.footer-bar-${lowerTagName} {
                            /* position: absolute; */
                            left: 0;
                            right: 0;
                            height: ${footerHeight};
                            background: ${footerColor};
                            z-index: 1;
                            ${footerText ? `
                                color: ${footerTextColor} !important;
                                font-size: 10px;
                                font-weight: bold;
                                display: flex;
                                align-items: center;
                                justify-content: center;${footerTextShadow ? `\n                                text-shadow: ${footerTextShadow};` : ''}
                            ` : ''}
                        }\n`;

                        if (footerText) {
                            styles += `.footer-bar-${lowerTagName}::after {
                                content: '${footerText}';
                            }\n`;

                            // Collapsed state with label - needs full height
                            styles += `.kanban-full-height-column.collapsed .footer-bar-${lowerTagName} {
                                height: 20px !important;
                                padding: 0 2px !important;
                            }\n`;
                        } else {
                            // Collapsed state without label - keep original height
                            styles += `.kanban-full-height-column.collapsed .footer-bar-${lowerTagName} {
                                height: ${footerHeight} !important;
                            }\n`;
                        }
                    }

                    // Corner badge styles with image support
                    if (config.cornerBadge) {
                        const badgeColor = config.cornerBadge.color || themeColors.background;

                        // Calculate automatic text color from badge background
                        // ALWAYS use automatic calculation, ignore configured labelColor
                        const opaqueBadgeColor = badgeColor.length === 9 ? badgeColor.substring(0, 7) : badgeColor;
                        const badgeTextColor = colorUtils ? colorUtils.getContrastText(opaqueBadgeColor) : '#ffffff';

                        const badgeStyle = config.cornerBadge.style || 'circle';
                        const badgeImage = config.cornerBadge.image || '';

                        let shapeStyles = '';
                        switch (badgeStyle) {
                            case 'circle':
                                shapeStyles = 'width: 20px; height: 20px; border-radius: 50%;';
                                break;
                            case 'square':
                                shapeStyles = 'width: 20px; height: 20px; border-radius: 3px;';
                                break;
                            case 'ribbon':
                                shapeStyles = 'padding: 2px 8px; border-radius: 3px; min-width: 20px;';
                                break;
                        }

                        // Encode special characters for CSS class names to avoid invalid selectors
                        // E.g., ++ becomes plusplus, -- becomes minusminus, ø becomes oslash
                        let cssClassName = lowerTagName;
                        if (cssClassName === '++') cssClassName = 'plusplus';
                        else if (cssClassName === '+') cssClassName = 'plus';
                        else if (cssClassName === '--') cssClassName = 'minusminus';
                        else if (cssClassName === '-') cssClassName = 'minus';
                        else if (cssClassName === 'ø') cssClassName = 'oslash';
                        else {
                            // For other tags, just use as-is (they start with alphanumeric)
                            cssClassName = lowerTagName;
                        }

                        styles += `.corner-badge-${cssClassName} {
                            ${shapeStyles}
                            background: ${badgeColor} !important;
                            color: ${badgeTextColor} !important;
                            ${badgeImage ? `
                                background-image: url('${badgeImage}') !important;
                                background-size: contain;
                                background-repeat: no-repeat;
                                background-position: center;
                            ` : ''}
                        }\n`;
                    }
            }
        }
    };

    // Process all tag configs dynamically - no hardcoded group names
    // Iterate over all keys in tagColors and detect structure automatically
    Object.keys(window.tagColors).forEach(key => {
        const value = window.tagColors[key];
        if (!value || typeof value !== 'object') return;

        // Check if this is a direct tag config (has theme colors or style properties)
        const isDirectTagConfig = value.light || value.dark ||
            value.headerBar || value.footerBar || value.border || value.cornerBadge;

        if (isDirectTagConfig) {
            // This is a direct tag config at root level - process as single tag
            const singleTagObj = {};
            singleTagObj[key] = value;
            processTags(singleTagObj);
        } else {
            // This is a group containing multiple tags - process the group
            processTags(value);
        }
    });

    return styles;
}

// ============================================================================
// STYLE APPLICATION
// ============================================================================

/**
 * Applies all tag-based CSS styles to the document
 * Purpose: Injects dynamic CSS for tag colors, borders, and effects
 * Used by: renderBoard() after board content is rendered
 * Called when: Board updates, tag configurations change
 * Side effects: Modifies document.head with style element
 */
function applyTagStyles() {

    // Remove existing dynamic styles
    const existingStyles = document.getElementById('dynamic-tag-styles');
    if (existingStyles) {
        existingStyles.remove();
    }

    // Generate new styles
    const styles = generateTagStyles();

    if (styles) {
        // Create and inject style element
        const styleElement = document.createElement('style');
        styleElement.id = 'dynamic-tag-styles';
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);

        // Debug: Check what columns have tags
        document.querySelectorAll('.kanban-full-height-column[data-column-tag]').forEach(col => {
        });
    }
}

/**
 * Ensures a specific tag's CSS exists without full regeneration
 * Purpose: Optimizes performance by adding single tag styles on-demand
 * Used by: Tag toggle operations, real-time tag updates
 */
function ensureTagStyleExists(tagName) {
    const config = getTagConfig(tagName);
    if (!config) {
        return;
    }

    // Safety check: ensure document.body exists before accessing classList
    if (!document.body) {
        console.warn('[applyTagHighlight] document.body not ready yet, skipping');
        return;
    }

    const isDark = document.body.classList.contains('vscode-dark') ||
                        document.body.classList.contains('vscode-high-contrast');
    const themeKey = isDark ? 'dark' : 'light';

    // Check if style already exists
    let styleElement = document.getElementById('dynamic-tag-styles');
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'dynamic-tag-styles';
        document.head.appendChild(styleElement);
    }

    // Check if this tag's styles already exist
    const existingStyles = styleElement.textContent || '';
    if (existingStyles.includes(`[data-column-bg-tag="${tagName}"]`) ||
        existingStyles.includes(`[data-task-bg-tag="${tagName}"]`) ||
        existingStyles.includes(`[data-column-border-tag="${tagName}"]`) ||
        existingStyles.includes(`[data-task-border-tag="${tagName}"]`)) {
        return;
    }

    // Generate styles for this specific tag
    const tagConfig = config;
    const editorBg = getEditorBackground();
    let newStyles = '';

    // Generate column styles for this tag
    if (tagConfig.column) {
        const columnColors = tagConfig.column[themeKey] || tagConfig.column.light || {};
        if (columnColors.background) {
            const bgDark = columnColors.backgroundDark || columnColors.background;
            const columnBg = colorUtils.interpolateColor(editorBg, bgDark, 0.15);
            const columnCollapsedBg = colorUtils.interpolateColor(editorBg, bgDark, 0.2);

            newStyles += `.kanban-full-height-column[data-column-bg-tag="${tagName}"] .column-header {
    background-color: ${columnBg} !important;
}
.kanban-full-height-column[data-column-bg-tag="${tagName}"] .column-title {
    background-color: ${columnBg} !important;
}
.kanban-full-height-column[data-column-bg-tag="${tagName}"] .column-content {
    background-color: ${columnBg} !important;
}
.kanban-full-height-column[data-column-bg-tag="${tagName}"] .column-footer {
    background-color: ${columnBg} !important;
}
.kanban-full-height-column.collapsed[data-column-bg-tag="${tagName}"] .column-header {
    background-color: ${columnCollapsedBg} !important;
}
.kanban-full-height-column.collapsed[data-column-bg-tag="${tagName}"] .column-title {
    background-color: ${columnCollapsedBg} !important;
}
.kanban-full-height-column.collapsed[data-column-bg-tag="${tagName}"] .column-footer {
    background-color: ${columnCollapsedBg} !important;
}\n`;
        }
    }

    // Generate card styles for this tag
    if (tagConfig.card) {
        const cardColors = tagConfig.card[themeKey] || tagConfig.card.light || {};
        if (cardColors.background) {
            const bgDark = cardColors.backgroundDark || cardColors.background;
            const cardBg = colorUtils.interpolateColor(editorBg, bgDark, 0.25);
            const cardHoverBg = colorUtils.interpolateColor(editorBg, bgDark, 0.35);

            newStyles += `.task-item[data-task-bg-tag="${tagName}"] {
    background-color: ${cardBg} !important;
}
.task-item[data-task-bg-tag="${tagName}"]:hover {
    background-color: ${cardHoverBg} !important;
}\n`;
        }
    }

    // Generate border styles for this tag
    if (tagConfig.border) {
        const borderColor = tagConfig.border.color || (tagConfig[themeKey]?.background || tagConfig.light?.background);
        const borderWidth = tagConfig.border.width || '2px';
        const borderStyle = tagConfig.border.style || 'solid';

        if (tagConfig.border.position === 'left') {
            newStyles += `.kanban-full-height-column[data-column-border-tag="${tagName}"] .column-header {
                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
            }
.kanban-full-height-column[data-column-border-tag="${tagName}"] .column-content {
                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
            }
.task-item[data-task-border-tag="${tagName}"] {
                border-left: ${borderWidth} ${borderStyle} ${borderColor} !important;
            }\n`;
        } else {
            newStyles += `.kanban-full-height-column[data-column-border-tag="${tagName}"] .column-header {
                border: ${borderWidth} ${borderStyle} ${borderColor} !important;
            }
.kanban-full-height-column[data-column-border-tag="${tagName}"] .column-content {
                border: ${borderWidth} ${borderStyle} ${borderColor} !important;
                border-top: none !important;
            }
.task-item[data-task-border-tag="${tagName}"] {
                border: ${borderWidth} ${borderStyle} ${borderColor} !important;
            }\n`;
        }
    }

    // Generate footer bar styles for this tag
    if (tagConfig.footerBar) {
        const footerColor = tagConfig.footerBar.color || (tagConfig[themeKey]?.background || tagConfig.light?.background);
        const footerHeight = tagConfig.footerBar.label ? '20px' : (tagConfig.footerBar.height || '3px');
        const footerText = tagConfig.footerBar.label || '';
        const footerTextColor = tagConfig.footerBar.labelColor || (tagConfig[themeKey]?.text || tagConfig.light?.text);

        // Use relative positioning to work with flex layout (like original system)
        newStyles += `.footer-bar-${tagName.toLowerCase()} {
            position: relative;
            width: 100%;
            height: ${footerHeight};
            background-color: ${footerColor} !important;
            color: ${footerTextColor} !important;
            font-size: 10px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            flex-shrink: 0;
            pointer-events: none;
            transition: all 0.2s ease;
        }\n`;

        if (footerText) {
            newStyles += `.footer-bar-${tagName.toLowerCase()}::after {
                content: '${footerText}';
            }\n`;
        }

        // Collapsed state styles
        newStyles += `.kanban-full-height-column.collapsed .footer-bar-${tagName.toLowerCase()} {
            position: relative !important;
            bottom: auto !important;
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            height: ${footerText ? '20px' : footerHeight} !important;
            writing-mode: horizontal-tb !important;
            transform: none !important;
            font-size: 9px !important;
            ${footerText ? 'padding: 0 2px !important;' : ''}
        }\n`;
    }

    // Generate header bar styles for this tag
    if (tagConfig.headerBar) {
        const headerColor = tagConfig.headerBar.color || (tagConfig[themeKey]?.background || tagConfig.light?.background);
        const headerHeight = tagConfig.headerBar.label ? '20px' : (tagConfig.headerBar.height || '3px');
        const headerText = tagConfig.headerBar.label || '';
        const headerTextColor = tagConfig.headerBar.labelColor || (tagConfig[themeKey]?.text || tagConfig.light?.text);

        // Use relative positioning to work with flex layout (like original system)
        newStyles += `.header-bar-${tagName.toLowerCase()} {
            /* position: relative; */
            width: 100%;
            height: ${headerHeight};
            background-color: ${headerColor} !important;
            color: ${headerTextColor} !important;
            font-size: 10px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            flex-shrink: 0;
            pointer-events: none;
            transition: all 0.2s ease;
        }\n`;

        if (headerText) {
            newStyles += `.header-bar-${tagName.toLowerCase()}::after {
                content: '${headerText}';
            }\n`;
        }

        // Collapsed state styles
        newStyles += `.kanban-full-height-column.collapsed .header-bar-${tagName.toLowerCase()} {
            /* position: relative !important; */
            width: 100% !important;
            height: ${headerText ? '20px' : headerHeight} !important;
            writing-mode: horizontal-tb !important;
            transform: none !important;
            font-size: 9px !important;
            ${headerText ? 'padding: 0 2px !important;' : ''}
        }\n`;
    }

    // Generate corner badge styles for this tag
    if (tagConfig.cornerBadge) {
        const badgeColor = tagConfig.cornerBadge.color || (tagConfig[themeKey]?.background || tagConfig.light?.background);
        const badgeTextColor = tagConfig.cornerBadge.labelColor || (tagConfig[themeKey]?.text || tagConfig.light?.text);
        const badgeStyle = tagConfig.cornerBadge.style || 'circle';

        newStyles += `.corner-badge-${tagName.toLowerCase()} {
            background-color: ${badgeColor} !important;
            color: ${badgeTextColor} !important;
            ${badgeStyle === 'square' ? 'border-radius: 2px;' : 'border-radius: 50%;'}
            width: 16px;
            height: 16px;
            min-width: 16px;
            font-size: 10px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            position: absolute;
            z-index: 100;
            transition: all 0.2s ease;
        }\n`;
    }

    // Append new styles
    if (newStyles) {
        styleElement.textContent += newStyles;
    }
}

/**
 * Update tag styles when theme changes
 * Clears cached editor background and re-applies all styles
 */
function updateTagStylesForTheme() {
    // Clear cached editor background to re-read from new theme
    cachedEditorBg = null;
    applyTagStyles();
}

// ============================================================================
// WINDOW EXPORTS
// ============================================================================

window.getEditorBackground = getEditorBackground;
window.isDarkTheme = isDarkTheme;
window.getTagConfig = getTagConfig;
window.generateTagStyles = generateTagStyles;
window.applyTagStyles = applyTagStyles;
window.ensureTagStyleExists = ensureTagStyleExists;
window.updateTagStylesForTheme = updateTagStylesForTheme;
